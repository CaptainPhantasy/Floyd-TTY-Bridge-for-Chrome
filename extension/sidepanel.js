// sidepanel.js — Floyd's Labs TTY Bridge v4.5 (Bulletproof Edition)
'use strict';

console.log('[Floyd] sidepanel.js initializing...');

// Dynamic import for Gemini Live
let LiveSession = null;
let resetGenAI = null;
import('./live-service.js')
  .then(mod => { 
    LiveSession = mod.LiveSession;
    resetGenAI = mod.resetGenAI;
    console.log('[Floyd] Live service loaded'); 
  })
  .catch(err => console.warn('[Floyd] Live service unavailable:', err.message));

/**
 * Robust Terminal Initialization
 */
function initTerminal() {
  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('[Floyd] Fatal: #terminal-container not found');
    return null;
  }

  const term = new (window.Terminal || Terminal)({
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    cursorWidth: 2,
    fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "Courier New", monospace',
    fontWeight: 'bold',
    fontSize: 12,
    lineHeight: 1.2,
    scrollback: 10000,
    convertEol: true,
    theme: {
      background: '#0a0a0a',
      foreground: '#e0e0e0',
      cursor: '#00ff88',
      cursorAccent: '#0a0a0a',
      selectionBackground: '#3388ff44',
      black: '#0a0a0a',
      red: '#ff3388',
      green: '#00ff88',
      yellow: '#ffcc00',
      blue: '#3388ff',
      magenta: '#cc66ff',
      cyan: '#00ccff',
      white: '#e0e0e0',
    }
  });

  term.open(container);
  
  // Force a specific renderer path that is stable in Side Panels
  try {
    if (term.options) {
      term.options.rendererType = 'dom';
    }
  } catch (e) {
    console.log('[Floyd] Renderer fallback active');
  }

  // Ensure cursor is visible via escape sequence
  term.write('\x1b[?25h'); 
  term.focus();

  return term;
}

const term = initTerminal();

/**
 * Connection & Message Handling
 */
let port = null;
let requestCounter = 0;
const pendingCallbacks = new Map();
const MAX_PENDING_CALLBACKS = 100;

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'floyd-tty-panel' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'pty_output') {
        term.write(msg.data);
      } else if (msg.type === 'tool_response') {
        if (msg.requestId && pendingCallbacks.has(msg.requestId)) {
          pendingCallbacks.get(msg.requestId)(msg);
          pendingCallbacks.delete(msg.requestId);
        }
      } else if (msg.type === 'system_event') {
        handleSystemEvent(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      setStatus('disconnected', 'NATIVE HOST DISCONNECTED');
      term.writeln('\r\n\x1b[31;1m[NATIVE HOST DISCONNECTED]\x1b[0m');
    });

    console.log('[Floyd] Native Messaging port connected');
  } catch (err) {
    console.error('[Floyd] Connection failed:', err);
    setStatus('error', 'CONNECTION FAILED');
  }
}

function handleSystemEvent(msg) {
  switch (msg.event) {
    case 'panel_ready':
      setStatus(msg.nativeConnected ? 'connected' : 'connecting',
                msg.nativeConnected ? 'CONNECTED' : 'CONNECTING...');
      break;
    case 'native_connected':
      setStatus('connected', 'CONNECTED');
      term.writeln('\x1b[32;1m[Native Host Connected]\x1b[0m');
      setTimeout(fitTerminal, 100);
      break;
    case 'context_captured':
      showToast('Context captured — results sent to agent');
      break;
  }
}

/**
 * Input & Focus Handling
 */
term.onData((data) => {
  if (!port) return;
  
  // Enterprise Hardening: Chunk large inputs
  const CHUNK_SIZE = 8192; // 8KB chunks
  if (data.length <= CHUNK_SIZE) {
    try { port.postMessage({ type: 'pty_input', data }); } catch (e) {}
  } else {
    let offset = 0;
    const sendNextChunk = () => {
      if (offset < data.length && port) {
        const chunk = data.substring(offset, offset + CHUNK_SIZE);
        try { port.postMessage({ type: 'pty_input', data: chunk }); } catch (e) {}
        offset += CHUNK_SIZE;
        setTimeout(sendNextChunk, 0);
      }
    };
    sendNextChunk();
  }
});

// Prevent Chrome side panel from intercepting terminal keys (arrows, Tab, etc.)
// Without this, curses/TUI apps can't receive arrow key escape sequences.
const TERMINAL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'Tab', 'Escape', 'Backspace', 'Delete',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
]);

document.addEventListener('keydown', (e) => {
  const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (!isInput && TERMINAL_KEYS.has(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

term.attachCustomKeyEventHandler(() => true);

// Aggressive focus trap
const termContainer = document.getElementById('terminal-container');
if (termContainer) {
  termContainer.addEventListener('mousedown', () => {
    setTimeout(() => term.focus(), 10);
  });
}

window.addEventListener('click', (e) => {
  const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
  const sideNav = document.getElementById('side-nav');
  const isNav = sideNav ? sideNav.contains(e.target) : false;
  
  if (!isInput && !isNav) {
    term.focus();
  }
});

window.addEventListener('focus', () => term.focus());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(() => term.focus(), 50);
});

/**
 * Resize Logic
 */
let isResizing = false;
let lastCols = 0;
let lastRows = 0;

function fitTerminal() {
  if (isResizing || !term) return;
  isResizing = true;

  try {
    const container = document.getElementById('terminal-container');
    if (!container || container.clientWidth === 0) return;

    const charMeasure = document.createElement('span');
    
    let fontFamily = '"SF Mono", monospace';
    let fontSize = 12;

    if (term.options) {
      fontFamily = term.options.fontFamily || fontFamily;
      fontSize = term.options.fontSize || fontSize;
    }

    charMeasure.style.cssText = `position:absolute;top:-9999px;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:${fontSize}px;`;
    charMeasure.textContent = 'WWWWWWWWWW';
    document.body.appendChild(charMeasure);
    
    const rect = charMeasure.getBoundingClientRect();
    const cellWidth = rect.width / 10;
    const cellHeight = rect.height;
    document.body.removeChild(charMeasure);

    if (cellWidth === 0 || cellHeight === 0) return;

    const padding = 12; 
    const cols = Math.max(2, Math.floor((container.clientWidth - padding) / cellWidth));
    const rows = Math.max(1, Math.floor((container.clientHeight - padding) / cellHeight));

    if (cols !== lastCols || rows !== lastRows) {
      term.resize(cols, rows);
      lastCols = cols;
      lastRows = rows;
      if (port) {
        port.postMessage({ type: 'pty_resize', rows, cols });
      }
    }
  } catch (e) {
    console.warn('[Floyd] Resize error:', e);
  } finally {
    isResizing = false;
  }
}

const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(fitTerminal);
});
resizeObserver.observe(document.getElementById('terminal-container'));

/**
 * UI Utilities
 */
function setStatus(state, text) {
  const dot = document.getElementById('native-dot');
  const label = document.getElementById('status-text');
  if (dot) dot.className = 'status-dot ' + state;
  if (label) label.textContent = text;
}

function showToast(message) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

function countLandmarks(landmarks) {
  if (!landmarks || typeof landmarks !== 'object') return 0;
  return Object.values(landmarks).reduce((count, selectors) => {
    return count + (Array.isArray(selectors) ? selectors.length : 0);
  }, 0);
}

function getAnalyzeIssueSummary(result) {
  const accessibilitySnapshot = result.accessibility_snapshot || {};
  const accessibilitySignals =
    (accessibilitySnapshot.missing_alt || 0) +
    (accessibilitySnapshot.missing_labels || 0);

  return {
    landmarks: countLandmarks(result.landmarks),
    accessibilitySignals,
    contrastIssues: result.contrast_issues?.length || 0,
    technicalIssues: result.technical_issues?.length || 0,
  };
}

// ─── Tool Call Infrastructure ───

function sendToolCall(tool, args = {}) {
  const requestId = 'panel_' + (++requestCounter) + '_' + Date.now();
  return new Promise((resolve) => {
    if (pendingCallbacks.size >= MAX_PENDING_CALLBACKS) {
      const oldest = pendingCallbacks.keys().next().value;
      const oldCb = pendingCallbacks.get(oldest);
      pendingCallbacks.delete(oldest);
      if (oldCb) oldCb({ success: false, error: 'Evicted' });
    }
    pendingCallbacks.set(requestId, resolve);
    setTimeout(() => {
      if (pendingCallbacks.has(requestId)) {
        pendingCallbacks.delete(requestId);
        resolve({ success: false, error: 'Timeout' });
      }
    }, 30000);

    if (port) {
      port.postMessage({ type: 'tool_call', requestId, tool, args });
    } else {
      resolve({ success: false, error: 'Not connected' });
    }
  });
}

function writeToolResult(label, result) {
  term.writeln('');
  term.writeln(`\x1b[1;35m━━━ ${label} ━━━\x1b[0m`);

  const json = JSON.stringify(result, null, 2);
  const lines = json.split('\n');
  for (const line of lines) {
    const colored = line
      .replace(/"([^"]+)":/g, '\x1b[36m"$1"\x1b[0m:')
      .replace(/: "([^"]+)"/g, ': \x1b[33m"$1"\x1b[0m')
      .replace(/: (\d+)/g, ': \x1b[32m$1\x1b[0m')
      .replace(/: (true|false)/g, ': \x1b[35m$1\x1b[0m');
    term.writeln(colored);
  }
  term.writeln(`\x1b[1;35m━━━━━━━━━━━━━━━━\x1b[0m`);
  term.writeln('');
}

// ─── Tool Buttons (Vision Engine) ───

document.getElementById('btn-analyze')?.addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Analyzing page...]\x1b[0m');
  const result = await sendToolCall('analyze_page', { include_css: true, include_accessibility: true });
  if (result.success) {
    const r = result.result;
    const summary = getAnalyzeIssueSummary(r);
    term.writeln(`\x1b[1;32m[Page Analysis Complete]\x1b[0m`);
    term.writeln(`  URL: \x1b[36m${r.url}\x1b[0m`);
    term.writeln(`  Title: ${r.title}`);
    term.writeln(`  Score: \x1b[${r.score >= 80 ? '32' : r.score >= 50 ? '33' : '31'}m${r.score}/100\x1b[0m`);
    term.writeln(`  Landmarks: ${summary.landmarks} | Headings: ${r.headings?.length || 0}`);
    term.writeln(`  Issues: ${summary.technicalIssues} technical, ${summary.accessibilitySignals} a11y signals, ${summary.contrastIssues} contrast`);
    term.writeln(`  Interactive: ${r.interactive_elements?.length || 0} elements`);
    if (r.technical_issues?.length > 0) {
      term.writeln(`\x1b[1;31m  Technical Issues:\x1b[0m`);
      r.technical_issues.forEach(i => { term.writeln(`    - ${i}`); });
    }
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

document.getElementById('btn-dom')?.addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Fetching DOM tree...]\x1b[0m');
  const result = await sendToolCall('analyze_page', { include_css: false, include_accessibility: false });
  if (result.success) {
    writeToolResult('DOM Structure', {
      landmarks: result.result.landmarks,
      headings: result.result.headings,
      forms: result.result.forms,
      interactive: result.result.interactive_elements?.slice(0, 15),
    });
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

document.getElementById('btn-a11y')?.addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Running accessibility audit...]\x1b[0m');
  const result = await sendToolCall('check_accessibility', { level: 'AA' });
  if (result.success) {
    const r = result.result;
    term.writeln(`\x1b[1;${r.violations_count === 0 ? '32' : '31'}m[A11Y Audit: ${r.violations_count} violations (${r.applied_rule_set}, requested ${r.requested_level})]\x1b[0m`);
    (r.violations || []).forEach(v => {
      const color = v.severity === 'error' ? '31' : '33';
      term.writeln(`  \x1b[${color}m[${v.severity}]\x1b[0m ${v.rule}`);
      term.writeln(`    Element: \x1b[36m${v.element}\x1b[0m`);
      term.writeln(`    Fix: ${v.fix}`);
    });
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

document.getElementById('btn-screenshot')?.addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Capturing screenshot...]\x1b[0m');
  const result = await sendToolCall('take_screenshot', {});
  if (result.success) {
    term.writeln(`\x1b[1;32m[Screenshot captured]\x1b[0m`);
    term.writeln(`  Format: ${result.result.format}`);
    term.writeln(`  Size: ${Math.round(result.result.screenshot?.length / 1024)}KB base64`);
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

// ─── Gemini Live Session ───

let liveSession = null;
let audioStream = null;

async function liveToolExecutor(toolName, args) {
  const result = await sendToolCall(toolName, args);
  if (result.success) {
    return result.result;
  }
  throw new Error(result.error || 'Tool call failed');
}

document.getElementById('btn-live')?.addEventListener('click', async () => {
  const btnLive = document.getElementById('btn-live');

  if (!LiveSession) {
    showToast('Gemini Live not available');
    return;
  }

  if (liveSession && liveSession.getState() !== 'idle') {
    term.writeln('\x1b[1;33m[Disconnecting Gemini Live...]\x1b[0m');
    liveSession.disconnect();
    liveSession = null;
    btnLive.classList.remove('live-active');
    btnLive.textContent = 'LIVE';
    document.getElementById('btn-screen').classList.remove('media-active');
    document.getElementById('btn-camera').classList.remove('media-active');
    if (audioStream) {
      audioStream.getTracks().forEach(t => { t.stop(); });
      audioStream = null;
    }
    term.writeln('\x1b[1;32m[Live session ended]\x1b[0m');
    return;
  }

  const data = await chrome.storage.local.get(['gemini_api_key', 'live_voice']);
  if (!data.gemini_api_key) {
    showToast('Set your Gemini API key first (SET button)');
    document.getElementById('settings-modal').classList.add('visible');
    return;
  }

  term.writeln('\x1b[1;33m[Starting Gemini Live session...]\x1b[0m');
  btnLive.classList.add('live-active');
  btnLive.textContent = 'STOP';

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    liveSession = new LiveSession(
      (text) => term.writeln(`\x1b[1;36m[Tom]\x1b[0m ${text}`),
      () => {},
      (error) => {
        term.writeln(`\x1b[1;31m[Live Error: ${error.message || JSON.stringify(error)}]\x1b[0m`);
        if (!error.retrying) {
          btnLive.classList.remove('live-active');
          btnLive.textContent = 'LIVE';
        }
      },
      (status) => {
        const colors = { idle: '90', connecting: '33', connected: '32', reconnecting: '33', disconnecting: '31' };
        term.writeln(`\x1b[${colors[status] || '0'}m[Live: ${status}]\x1b[0m`);
        if (status === 'idle') {
          btnLive.classList.remove('live-active');
          btnLive.textContent = 'LIVE';
          document.getElementById('btn-screen').classList.remove('media-active');
          document.getElementById('btn-camera').classList.remove('media-active');
        }
      },
      liveToolExecutor
    );

    await liveSession.connect(audioStream, undefined, { voice: data.live_voice || 'Puck' });
    term.writeln('\x1b[1;32m[Live session connected — speak to Tom]\x1b[0m');
  } catch (err) {
    term.writeln(`\x1b[1;31m[Failed to start live: ${err.message}]\x1b[0m`);
    liveSession = null;
    btnLive.classList.remove('live-active');
    btnLive.textContent = 'LIVE';
    if (audioStream) {
      audioStream.getTracks().forEach(t => { t.stop(); });
      audioStream = null;
    }
  }
});

document.getElementById('btn-screen')?.addEventListener('click', async () => {
  const btnScreen = document.getElementById('btn-screen');

  if (!liveSession || liveSession.getState() !== 'connected') {
    showToast('Start a Live session first');
    return;
  }

  if (btnScreen.classList.contains('media-active')) {
    liveSession.stopVideoStream();
    btnScreen.classList.remove('media-active');
    term.writeln('\x1b[1;33m[Screen sharing stopped]\x1b[0m');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', cursor: 'always' }
    });

    liveSession.startVideoStream(stream);
    btnScreen.classList.add('media-active');
    document.getElementById('btn-camera').classList.remove('media-active');
    term.writeln('\x1b[1;32m[Screen sharing active — 3 FPS to Gemini]\x1b[0m');

    stream.getVideoTracks()[0].onended = () => {
      liveSession.stopVideoStream();
      btnScreen.classList.remove('media-active');
      term.writeln('\x1b[1;33m[Screen sharing ended]\x1b[0m');
    };
  } catch (err) {
    term.writeln(`\x1b[1;31m[Screen share failed: ${err.message}]\x1b[0m`);
  }
});

document.getElementById('btn-camera')?.addEventListener('click', async () => {
  const btnCamera = document.getElementById('btn-camera');

  if (!liveSession || liveSession.getState() !== 'connected') {
    showToast('Start a Live session first');
    return;
  }

  if (btnCamera.classList.contains('media-active')) {
    liveSession.stopVideoStream();
    btnCamera.classList.remove('media-active');
    term.writeln('\x1b[1;33m[Camera stopped]\x1b[0m');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' }
    });

    liveSession.startVideoStream(stream);
    btnCamera.classList.add('media-active');
    document.getElementById('btn-screen').classList.remove('media-active');
    term.writeln('\x1b[1;32m[Camera active — 3 FPS to Gemini]\x1b[0m');

    stream.getVideoTracks()[0].onended = () => {
      liveSession.stopVideoStream();
      btnCamera.classList.remove('media-active');
      term.writeln('\x1b[1;33m[Camera stopped]\x1b[0m');
    };
  } catch (err) {
    term.writeln(`\x1b[1;31m[Camera failed: ${err.message}]\x1b[0m`);
  }
});

// ─── Settings ───

document.getElementById('btn-settings')?.addEventListener('click', async () => {
  const modal = document.getElementById('settings-modal');
  const keyInput = document.getElementById('input-api-key');
  const voiceInput = document.getElementById('input-voice');

  const data = await chrome.storage.local.get(['gemini_api_key', 'live_voice']);
  keyInput.value = data.gemini_api_key || '';
  voiceInput.value = data.live_voice || 'Puck';

  modal.classList.add('visible');
});

document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
  const key = document.getElementById('input-api-key').value.trim();
  const voice = document.getElementById('input-voice').value.trim() || 'Puck';

  await chrome.storage.local.set({ gemini_api_key: key, live_voice: voice });
  if (resetGenAI) resetGenAI();
  document.getElementById('settings-modal').classList.remove('visible');
  showToast('Settings saved');
  term.writeln(`\x1b[1;32m[Settings saved — API key ${key ? 'configured' : 'cleared'}, voice: ${voice}]\x1b[0m`);
});

document.getElementById('btn-settings-cancel')?.addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('visible');
});

document.getElementById('settings-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') {
    document.getElementById('settings-modal').classList.remove('visible');
  }
});

document.getElementById('btn-reconnect')?.addEventListener('click', () => {
  term.writeln('\x1b[1;33m[Reconnecting native host...]\x1b[0m');
  if (port) port.disconnect();
  setTimeout(connect, 500);
});

/**
 * Boot Sequence
 */
term.writeln('\x1b[1;32m╔══════════════════════════════════════════╗\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[1;37mFloyd\'s Labs TTY Bridge\x1b[0m \x1b[1;35mv4.6\x1b[0m            \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m╚══════════════════════════════════════════╝\x1b[0m');
term.writeln('\x1b[90mReady for connection...\x1b[0m');

connect();
fitTerminal();
