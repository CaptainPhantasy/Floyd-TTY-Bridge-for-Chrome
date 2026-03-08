// sidepanel.js — Floyd's Labs TTY Bridge v4.5 (Bulletproof Edition)
'use strict';

console.log('[Floyd] sidepanel.js initializing...');

// Dynamic import for Gemini Live
let LiveSession = null;
import('./live-service.js')
  .then(mod => { 
    LiveSession = mod.LiveSession; 
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
    // xterm.js compatibility: use .options or .setOption
    if (term.setOption) {
      term.setOption('rendererType', 'dom');
    } else {
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

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'floyd-tty-panel' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'pty_output') {
        // Direct write for maximum responsiveness and to prevent "lost" frames
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
      // Trigger a resize to sync dimensions immediately
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
  if (port) {
    port.postMessage({ type: 'pty_input', data });
  }
});

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
  // Safe check: if sideNav exists, check if it contains the target. Otherwise, false.
  const isNav = sideNav ? sideNav.contains(e.target) : false;
  
  if (!isInput && !isNav) {
    term.focus();
  }
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

    // Robust measurement ghost: handles both old (term.getOption) and new (term.options) xterm.js APIs
    const charMeasure = document.createElement('span');
    
    let fontFamily = '"SF Mono", monospace';
    let fontSize = 12;

    if (typeof term.getOption === 'function') {
      fontFamily = term.getOption('fontFamily') || fontFamily;
      fontSize = term.getOption('fontSize') || fontSize;
    } else if (term.options) {
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

/**
 * Button Listeners
 */
document.getElementById('btn-analyze')?.addEventListener('click', async () => {
  term.writeln('\x1b[1;33m[Analyzing page...]\x1b[0m');
  const result = await sendToolCall('analyze_page', { include_css: true, include_accessibility: true });
  if (result.success) {
    term.writeln(`\x1b[1;32m[Analysis Complete] Score: ${result.result.score}/100\x1b[0m`);
  } else {
    term.writeln(`\x1b[1;31m[Error: ${result.error}]\x1b[0m`);
  }
});

document.getElementById('btn-reconnect')?.addEventListener('click', () => {
  if (port) port.disconnect();
  setTimeout(connect, 500);
});

/**
 * Boot Sequence
 */
term.writeln('\x1b[1;32m╔══════════════════════════════════════════╗\x1b[0m');
term.writeln('\x1b[1;32m║\x1b[0m  \x1b[1;37mFloyd\'s Labs TTY Bridge\x1b[0m \x1b[1;35mv4.5\x1b[0m            \x1b[1;32m║\x1b[0m');
term.writeln('\x1b[1;32m╚══════════════════════════════════════════╝\x1b[0m');
term.writeln('\x1b[90mReady for connection...\x1b[0m');

connect();
fitTerminal();
