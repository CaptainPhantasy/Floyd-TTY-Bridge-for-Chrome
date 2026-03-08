// background.js — Floyd's Labs TTY Bridge v4.2 Service Worker
'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let nativePort = null;
let panelPort = null;
let offscreenReady = false;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;

// ─── Startup Logic ──────────────────────────────────────────────────────────
const TARGET_KEY = ''; // REMOVED: Never hardcode secrets.

chrome.storage.local.get(['gemini_api_key'], (data) => {
  // Always ensure the latest key is set for this session
  if (TARGET_KEY && data.gemini_api_key !== TARGET_KEY) {
    console.log('[Floyd] Setting rotated API key...');
    chrome.storage.local.set({ gemini_api_key: TARGET_KEY });
  }
});

// ─── 1. Side Panel Setup ────────────────────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Seed API key on install if not already set
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['gemini_api_key'], (data) => {
    if (!data.gemini_api_key && TARGET_KEY) {
      chrome.storage.local.set({ gemini_api_key: TARGET_KEY });
    }
  });
});

// ─── 2. Native Messaging Connection ─────────────────────────────────────────
async function connectNative() {
  if (nativePort) return; // Already connected
  console.log('[Floyd] connectNative called, attempt:', reconnectAttempt);

  // Permission-gated connection (pattern from Claude extension)
  const hasPermission = await chrome.permissions.contains({ permissions: ['nativeMessaging'] });
  if (!hasPermission) {
    console.error('[Floyd] nativeMessaging permission not granted');
    if (panelPort) {
      panelPort.postMessage({
        type: 'system_event',
        event: 'native_error',
        error: 'nativeMessaging permission not granted'
      });
    }
    return;
  }

  try {
    nativePort = chrome.runtime.connectNative('com.floyd.tty');
    console.log('[Floyd] nativePort created:', !!nativePort);

    nativePort.onMessage.addListener(handleNativeMessage);

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.error('[Floyd] NATIVE DISCONNECT:', error?.message || 'unknown', error);
      nativePort = null;
      // Stop keep-alive alarm
      chrome.alarms.clear('floyd-keep-alive');
      
      // Notify side panel
      if (panelPort) {
        panelPort.postMessage({
          type: 'system_event',
          event: 'native_disconnected',
          error: error?.message
        });
      }

      // Auto-reconnect logic with exponential backoff
      if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt), 30000);
        reconnectAttempt++;
        console.log(`[Floyd] Retrying native connection in ${delay}ms...`);
        setTimeout(connectNative, delay);
      } else {
        notifyUser('Floyd TTY Bridge', 'Native host disconnected: Permanent failure after max retries.');
      }
    });

    // Reset reconnection count on success
    reconnectAttempt = 0;

    // Start keep-alive alarm to prevent service worker termination
    chrome.alarms.create('floyd-keep-alive', { periodInMinutes: 0.4 });

    // Notify side panel of connection
    if (panelPort) {
      panelPort.postMessage({ type: 'system_event', event: 'native_connected' });
    }
  } catch (e) {
    console.error('[Floyd] Failed to connect native host:', e);
  }
}

// ─── 2a. Keep-Alive Alarm ──────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'floyd-keep-alive') {
    if (nativePort) {
      // Ping native host to keep service worker alive
      nativePort.postMessage({ type: 'ping' });
    } else {
      // No connection — stop the alarm
      chrome.alarms.clear('floyd-keep-alive');
    }
  }
});

// ─── 2b. Desktop Notifications ─────────────────────────────────────────────
function notifyUser(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2
  });
}

// ─── 2c. Offscreen Document ────────────────────────────────────────────────
async function ensureOffscreen() {
  if (offscreenReady) return;
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Gemini Live audio output playback'
    });
  }
  offscreenReady = true;
}

// ─── 3. Handle Native Host Messages ─────────────────────────────────────────
async function handleNativeMessage(msg) {
  if (!msg) return;

  // Keep-alive pong — no action needed
  if (msg.type === 'pong' || msg.type === 'ready') return;

  if (msg.type === 'tool_call') {
    // Route tool call to content script in active tab
    const result = await routeToolCall(msg);
    // Send result back to native host
    if (nativePort) {
      nativePort.postMessage({
        type: 'tool_response',
        requestId: msg.requestId,
        ...result
      });
    }
    return;
  }

  if (msg.type === 'pty_output') {
    // Forward terminal output to side panel
    if (panelPort) {
      panelPort.postMessage({ type: 'pty_output', data: msg.data });
    }
    return;
  }
}

// ─── 4. Route Tool Calls to Content Script ──────────────────────────────────
async function routeToolCall(msg) {
  try {
    // Get active tab in the last focused window, because currentWindow is undefined in service workers
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    
    // Fallback if no window is technically "focused"
    if (!tab) {
      const tabs = await chrome.tabs.query({ active: true });
      if (tabs.length > 0) tab = tabs[0];
    }
    
    // Handle tools that need chrome.* APIs directly (can't run in content script)
    const browserApiResult = await handleBrowserApiTool(msg.tool, msg.args, tab);
    if (browserApiResult !== null) {
      return browserApiResult;
    }

    if (!tab?.id) {
      return { success: false, error: 'No active tab found' };
    }

    // Send to content script and await response
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'tool_call',
        requestId: msg.requestId,
        tool: msg.tool,
        args: msg.args || {}
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not injected — try injecting it first
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js']
          }).then(() => {
            // Retry after injection
            chrome.tabs.sendMessage(tab.id, {
              type: 'tool_call',
              requestId: msg.requestId,
              tool: msg.tool,
              args: msg.args || {}
            }, (retryResponse) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: 'Content script failed: ' + chrome.runtime.lastError.message });
              } else {
                resolve(retryResponse || { success: false, error: 'No response from content script' });
              }
            });
          }).catch(err => {
            resolve({ success: false, error: 'Cannot inject into this page: ' + err.message });
          });
        } else {
          resolve(response || { success: false, error: 'No response from content script' });
        }
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── 5. Browser API Tools (handled directly in background) ──────────────────
async function handleBrowserApiTool(tool, args, activeTab) {
  switch (tool) {
    case 'open_tab': {
      const newTab = await chrome.tabs.create({ url: args.url });
      return { success: true, result: { tabId: newTab.id, url: args.url } };
    }
    case 'close_tab': {
      await chrome.tabs.remove(args.tab_id);
      return { success: true, result: { closed: args.tab_id } };
    }
    case 'switch_tab': {
      await chrome.tabs.update(args.tab_id, { active: true });
      return { success: true, result: { switched: args.tab_id } };
    }
    case 'list_tabs': {
      const tabs = await chrome.tabs.query({});
      return { success: true, result: tabs.map(t => ({
        tabId: t.id, url: t.url, title: t.title, active: t.active, status: t.status
      }))};
    }
    case 'take_screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      return { success: true, result: { screenshot: dataUrl, format: 'png' } };
    }
    case 'get_tab_state': {
      const tabId = args.tab_id || activeTab?.id;
      if (!tabId) return { success: false, error: 'No tab ID' };
      const tab = await chrome.tabs.get(tabId);
      return { success: true, result: {
        tabId: tab.id, url: tab.url, title: tab.title,
        status: tab.status, active: tab.active
      }};
    }
    case 'execute_local_shell': {
      // Forward this to native host to execute
      if (!nativePort) return { success: false, error: 'Native host not connected' };
      return new Promise((resolve) => {
        const requestId = 'shell_' + Date.now();
        const listener = (msg) => {
          if (msg.type === 'tool_response' && msg.requestId === requestId) {
            nativePort.onMessage.removeListener(listener);
            resolve(msg);
          }
        };
        nativePort.onMessage.addListener(listener);
        nativePort.postMessage({
          type: 'execute_shell',
          requestId,
          command: args.command
        });
      });
    }
    default:
      return null; // Not a browser API tool — route to content script
  }
}

// ─── 6. Side Panel Connection ───────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Floyd] Port connected:', port.name);
  if (port.name === 'floyd-tty-panel') {
    panelPort = port;

    // Connect to native host when panel opens
    if (!nativePort) connectNative();

    // Handle messages from panel
    port.onMessage.addListener((msg) => {
      if (msg.type === 'pty_input' && nativePort) {
        nativePort.postMessage({ type: 'pty_input', data: msg.data });
      }
      if (msg.type === 'pty_resize' && nativePort) {
        nativePort.postMessage({ type: 'resize', rows: msg.rows, cols: msg.cols });
      }
      if (msg.type === 'tool_call') {
        // Panel-initiated tool call
        routeToolCall(msg).then(result => {
          port.postMessage({ type: 'tool_response', requestId: msg.requestId, ...result });
        });
      }
    });

    // Clean up on disconnect
    port.onDisconnect.addListener(() => {
      panelPort = null;
    });

    // Send current status
    port.postMessage({
      type: 'system_event',
      event: 'panel_ready',
      nativeConnected: !!nativePort
    });
  }
});

// ─── 7. Handle Messages from Content Script (delegated browser API calls) ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Content script delegating a browser API call
  if (message.action) {
    handleBrowserApiTool(message.action, message, { id: sender.tab?.id })
      .then(result => {
        sendResponse(result || { success: false, error: 'Unknown action' });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async
  }

  // 2. Interceptor events (console.error, network failures)
  if (message.type === 'interceptor_event') {
    if (nativePort) {
      // Format as red text for the agent terminal
      const { payload } = message;
      let text = `\r\n\x1b[31;1m[BROWSER ERROR]\x1b[0m `;
      if (payload.type === 'console_error') {
        text += `Console: ${payload.message}`;
      } else if (payload.type === 'network_error') {
        text += `Network: ${payload.method} ${payload.url} (${payload.status || payload.error})`;
      } else if (payload.type === 'unhandled_exception') {
        text += `Exception: ${payload.message} at ${payload.filename}:${payload.lineno}`;
      } else if (payload.type === 'unhandled_rejection') {
        text += `Promise Rejection: ${payload.reason}`;
      }
      text += '\r\n';
      
      // Inject directly into the terminal stream for the agent to see
      nativePort.postMessage({ type: 'pty_input', data: text });
    }
  }

  // 3. System events (DOM mutations, etc.)
  if (message.type === 'system_event') {
    if (nativePort) {
      const osc = `\x1b]7701;${JSON.stringify({ type: 'system_event', ...message })}\x07`;
      nativePort.postMessage({ type: 'pty_input', data: osc });
    }
    // Also notify panel
    if (panelPort) panelPort.postMessage(message);
  }
});

// ─── 8. Keyboard Shortcuts ──────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open_side_panel') {
    const win = await chrome.windows.getLastFocused();
    chrome.sidePanel.open({ windowId: win.id });
  }

  if (command === 'capture_context') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;

    // Run analyze_page in the active tab
    const result = await routeToolCall({
      requestId: 'hotkey_' + Date.now(),
      tool: 'analyze_page',
      args: { include_css: true, include_accessibility: true }
    });

    // Send to native host if connected
    if (nativePort) {
      nativePort.postMessage({
        type: 'tool_response',
        requestId: 'hotkey_capture',
        ...result
      });
    }

    // Also notify panel
    if (panelPort) {
      panelPort.postMessage({ type: 'system_event', event: 'context_captured', result });
    }
  }

  if (command === 'toggle_vision') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'toggle_vision_overlay' });
  }
});

// ─── 9. Web Navigation Tracking ────────────────────────────────────────────
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0 && panelPort) {
    panelPort.postMessage({
      type: 'system_event',
      event: 'tab_navigated',
      url: details.url,
      tabId: details.tabId
    });
  }
});

// ─── 10. Offscreen Audio Routing ───────────────────────────────────────────
// Side panel or native host can request audio playback via background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_PCM_AUDIO' || message.type === 'PLAY_AUDIO_URL') {
    ensureOffscreen().then(() => {
      // Forward to offscreen document
      chrome.runtime.sendMessage(message, sendResponse);
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});
