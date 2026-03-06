// sidepanel.js — Floyd's Labs TTY Bridge v4.0 Side Panel
'use strict';
console.log('[Floyd] sidepanel.js loaded');

// Dynamic import — keeps terminal working even if Gemini SDK fails to load
let LiveSession = null;
import('./live-service.js')
  .then(mod => { LiveSession = mod.LiveSession; console.log('[Floyd] Live service loaded'); })
  .catch(err => console.warn('[Floyd] Live service unavailable:', err.message));

try {

// ─── Terminal Setup ───

const term = new (window.Terminal || Terminal)({
  cursorBlink: true,
  cursorStyle: 'block',
  fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "Courier New", monospace',
  fontWeight: 'bold',
  fontSize: 11,
  letterSpacing: 0,
  lineHeight: 1.2,
  allowTransparency: false,
  scrollback: 10000,
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
    brightBlack: '#444444',
    brightRed: '#ff6699',
    brightGreen: '#66ffaa',
    brightYellow: '#ffdd44',
    brightBlue: '#66aaff',
    brightMagenta: '#dd88ff',
    brightCyan: '#44ddff',
    brightWhite: '#ffffff',
  }
});

term.open(document.getElementById('terminal-container'));
term.focus();

// Re-focus terminal when clicking on it (xterm needs explicit focus for keyboard)
document.getElementById('terminal-container').addEventListener('click', () => term.focus());

// ─── Auto-resize terminal to fit container ───

function fitTerminal() {
  try {
    const container = document.getElementById('terminal-container');
    const dims = term._core._renderService?.dimensions;
    if (!dims?.css?.cell) return;
    const cellWidth = dims.css.cell.width;
    const cellHeight = dims.css.cell.height;
    if (cellWidth <= 0 || cellHeight <= 0) return;
    const cols = Math.max(2, Math.floor(container.clientWidth / cellWidth));
    const rows = Math.max(1, Math.floor(container.clientHeight / cellHeight));
    if (cols === term.cols && rows === term.rows) return;
    term.resize(cols, rows);
    if (port) {
      port.postMessage({ type: 'pty_resize', rows, cols });
    }
  } catch (e) {
    // Swallow resize errors (e.g. when DevTools shrinks panel to near-zero)
  }
}

setTimeout(fitTerminal, 100);
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitTerminal, 50);
}).observe(document.getElementById('terminal-container'));

// ─── Connection Management ───

let port = null;
let requestCounter = 0;
const pendingCallbacks = new Map();

function connect() {
  port = chrome.runtime.connect({ name: 'floyd-tty-panel' });

  port.onMessage.addListener(handleMessage);

  port.onDisconnect.addListener(() => {
    port = null;
    setStatus('disconnected', 'NATIVE HOST DISCONNECTED');
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'pty_output':
      term.write(msg.data);
      break;

    case 'tool_response':
      if (msg.requestId && pendingCallbacks.has(msg.requestId)) {
        pendingCallbacks.get(msg.requestId)(msg);
        pendingCallbacks.delete(msg.requestId);
      }
      break;

    case 'system_event':
      handleSystemEvent(msg);
      break;
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
      break;
    case 'native_disconnected':
      setStatus('error', 'DISCONNECTED: ' + (msg.error || 'unknown'));
      break;
    case 'context_captured':
      showToast('Context captured — results sent to agent');
      break;
  }
}

// ─── Status UI ───

function setStatus(state, text) {
  const dot = document.getElementById('native-dot');
  const label = document.getElementById('status-text');
  dot.className = 'status-dot ' + state;
  label.textContent = text;
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('error-toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), duration);
}

// ─── Terminal Data → Native Host ───

term.onData((data) => {
  if (port) {
    port.postMessage({ type: 'pty_input', data });
  }
});

// ─── Tool Call Infrastructure ───

function sendToolCall(tool, args = {}) {
  const requestId = 'panel_' + (++requestCounter) + '_' + Date.now();

  return new Promise((resolve) => {
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

document.getElementById('btn-analyze').addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Analyzing page...]\x1b[0m');
  const result = await sendToolCall('analyze_page', { include_css: true, include_accessibility: true });
  if (result.success) {
    const r = result.result;
    term.writeln(`\x1b[1;32m[Page Analysis Complete]\x1b[0m`);
    term.writeln(`  URL: \x1b[36m${r.url}\x1b[0m`);
    term.writeln(`  Title: ${r.title}`);
    term.writeln(`  Score: \x1b[${r.score >= 80 ? '32' : r.score >= 50 ? '33' : '31'}m${r.score}/100\x1b[0m`);
    term.writeln(`  Landmarks: ${r.landmarks?.length || 0} | Headings: ${r.headings?.length || 0}`);
    term.writeln(`  Issues: ${r.technical_issues?.length || 0} technical, ${r.accessibility?.violations_count || 0} a11y, ${r.contrast_issues?.length || 0} contrast`);
    term.writeln(`  Interactive: ${r.interactive_elements?.length || 0} elements`);
    if (r.technical_issues?.length > 0) {
      term.writeln(`\x1b[1;31m  Technical Issues:\x1b[0m`);
      r.technical_issues.forEach(i => term.writeln(`    - ${i}`));
    }
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

document.getElementById('btn-dom').addEventListener('click', async () => {
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

document.getElementById('btn-a11y').addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Running accessibility audit...]\x1b[0m');
  const result = await sendToolCall('check_accessibility', { level: 'AA' });
  if (result.success) {
    const r = result.result;
    term.writeln(`\x1b[1;${r.violations_count === 0 ? '32' : '31'}m[A11Y Audit: ${r.violations_count} violations (WCAG ${r.level_checked})]\x1b[0m`);
    (r.violations || []).forEach(v => {
      const color = v.severity === 'serious' ? '31' : '33';
      term.writeln(`  \x1b[${color}m[${v.severity}]\x1b[0m ${v.rule}`);
      term.writeln(`    Element: \x1b[36m${v.element}\x1b[0m`);
      term.writeln(`    Fix: ${v.fix}`);
    });
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

document.getElementById('btn-screenshot').addEventListener('click', async () => {
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

// Tool executor: routes Gemini's tool calls through the extension to the content script
async function liveToolExecutor(toolName, args) {
  const result = await sendToolCall(toolName, args);
  if (result.success) {
    return result.result;
  }
  throw new Error(result.error || 'Tool call failed');
}

async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['gemini_api_key'], (data) => {
      resolve(data.gemini_api_key || '');
    });
  });
}

async function getVoice() {
  return new Promise(resolve => {
    chrome.storage.local.get(['live_voice'], (data) => {
      resolve(data.live_voice || 'Puck');
    });
  });
}

document.getElementById('btn-live').addEventListener('click', async () => {
  const btnLive = document.getElementById('btn-live');

  if (!LiveSession) {
    showToast('Gemini Live not available — check console for errors');
    return;
  }

  // If already live, disconnect
  if (liveSession && liveSession.getState() !== 'idle') {
    term.writeln('\x1b[1;33m[Disconnecting Gemini Live...]\x1b[0m');
    liveSession.disconnect();
    btnLive.classList.remove('live-active');
    btnLive.textContent = 'LIVE';
    document.getElementById('btn-screen').classList.remove('media-active');
    document.getElementById('btn-camera').classList.remove('media-active');
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      audioStream = null;
    }
    term.writeln('\x1b[1;32m[Live session ended]\x1b[0m');
    return;
  }

  // Check for API key
  const apiKey = await getApiKey();
  if (!apiKey) {
    showToast('Set your Gemini API key first (SET button)');
    document.getElementById('settings-modal').classList.add('visible');
    return;
  }

  term.writeln('\x1b[1;33m[Starting Gemini Live session...]\x1b[0m');
  btnLive.classList.add('live-active');
  btnLive.textContent = 'STOP';

  try {
    // Get microphone
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const voice = await getVoice();

    liveSession = new LiveSession(
      // onMessage
      (text) => {
        term.writeln(`\x1b[1;36m[Tom]\x1b[0m ${text}`);
      },
      // onAudioData — audio plays internally, we just log activity
      () => {},
      // onError
      (error) => {
        const msg = error.message || JSON.stringify(error);
        term.writeln(`\x1b[1;31m[Live Error: ${msg}]\x1b[0m`);
        if (!error.retrying) {
          btnLive.classList.remove('live-active');
          btnLive.textContent = 'LIVE';
        }
      },
      // onStatusChange
      (status) => {
        const statusColors = {
          idle: '90', connecting: '33', connected: '32', reconnecting: '33', disconnecting: '31'
        };
        term.writeln(`\x1b[${statusColors[status] || '0'}m[Live: ${status}]\x1b[0m`);
        if (status === 'idle') {
          btnLive.classList.remove('live-active');
          btnLive.textContent = 'LIVE';
          document.getElementById('btn-screen').classList.remove('media-active');
          document.getElementById('btn-camera').classList.remove('media-active');
        }
      },
      // toolExecutor — routes Gemini tool calls through the extension
      liveToolExecutor
    );

    await liveSession.connect(audioStream, undefined, { voice });
    term.writeln('\x1b[1;32m[Live session connected — speak to Tom]\x1b[0m');
  } catch (err) {
    term.writeln(`\x1b[1;31m[Failed to start live: ${err.message}]\x1b[0m`);
    btnLive.classList.remove('live-active');
    btnLive.textContent = 'LIVE';
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
      audioStream = null;
    }
  }
});

// ─── Screen Share / Camera ───

document.getElementById('btn-screen').addEventListener('click', async () => {
  const btnScreen = document.getElementById('btn-screen');

  if (!liveSession || liveSession.getState() !== 'connected') {
    showToast('Start a Live session first');
    return;
  }

  // Toggle off
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

document.getElementById('btn-camera').addEventListener('click', async () => {
  const btnCamera = document.getElementById('btn-camera');

  if (!liveSession || liveSession.getState() !== 'connected') {
    showToast('Start a Live session first');
    return;
  }

  // Toggle off
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

document.getElementById('btn-settings').addEventListener('click', async () => {
  const modal = document.getElementById('settings-modal');
  const keyInput = document.getElementById('input-api-key');
  const voiceInput = document.getElementById('input-voice');

  // Load current values
  const data = await chrome.storage.local.get(['gemini_api_key', 'live_voice']);
  keyInput.value = data.gemini_api_key || '';
  voiceInput.value = data.live_voice || 'Puck';

  modal.classList.add('visible');
});

document.getElementById('btn-settings-save').addEventListener('click', async () => {
  const key = document.getElementById('input-api-key').value.trim();
  const voice = document.getElementById('input-voice').value.trim() || 'Puck';

  await chrome.storage.local.set({ gemini_api_key: key, live_voice: voice });
  document.getElementById('settings-modal').classList.remove('visible');
  showToast('Settings saved');
  term.writeln(`\x1b[1;32m[Settings saved — API key ${key ? 'configured' : 'cleared'}, voice: ${voice}]\x1b[0m`);
});

document.getElementById('btn-settings-cancel').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('visible');
});

// Close modal on backdrop click
document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') {
    document.getElementById('settings-modal').classList.remove('visible');
  }
});

// ─── Reconnect ───

document.getElementById('btn-reconnect').addEventListener('click', () => {
  term.writeln('\x1b[1;33m[Reconnecting native host...]\x1b[0m');
  if (port) {
    port.disconnect();
    port = null;
  }
  setTimeout(() => {
    connect();
    term.writeln('\x1b[1;32m[Reconnection attempted]\x1b[0m');
  }, 500);
});

// ─── Boot Sequence ───

term.writeln('\x1b[1;32m╔══════════════════════════════════════════╗\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[1;37mFloyd\'s Labs TTY Bridge\x1b[0m \x1b[1;35mv4.1\x1b[0m            \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[90mBrowser Control Protocol: \x1b[32mACTIVE\x1b[0m         \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[90mVision Engine: \x1b[36mTom the Peep\x1b[0m             \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[90mKnowledge Base: \x1b[33m12,419 docs\x1b[0m             \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[90mGemini Live: \x1b[35mReady\x1b[0m                      \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m╚══════════════════════════════════════════╝\x1b[0m');
term.writeln('');
term.writeln('\x1b[90mAgent Protocol: OSC 7701/7702 escape sequences\x1b[0m');
term.writeln('\x1b[90mHotkeys: Cmd+Shift+Y (panel) | Cmd+Shift+L (capture) | Cmd+Shift+E (vision)\x1b[0m');
term.writeln('\x1b[90mLive: Click LIVE to start voice session | SCREEN/CAM for video\x1b[0m');
term.writeln('');

// Auto-set API key from .env if provided during build (dev convenience)
chrome.storage.local.get(['gemini_api_key'], (data) => {
  if (!data.gemini_api_key) {
    term.writeln('\x1b[1;33m[No Gemini API key set — click SET to configure]\x1b[0m');
  }
});

connect();

} catch (err) {
  console.error('[Floyd] FATAL sidepanel error:', err);
  const el = document.getElementById('terminal-container') || document.body;
  el.innerHTML = '<pre style="color:#ff3388;padding:1em;font-size:14px;white-space:pre-wrap;">[Floyd] sidepanel.js crashed:\n' + err.stack + '</pre>';
}
