/**
 * Tom the Peep — Transcript Capture Payload v1.0
 *
 * Injected via osascript into the Tom the Peep browser tab.
 * Captures transcript text, tool calls, memory checkpoints, and session events
 * by wrapping console.log with a SAFE, non-destructive observer.
 *
 * Safety guarantees:
 *   1. Original console.log is called FIRST, synchronously, before any capture logic.
 *   2. All capture logic is inside try/catch — exceptions never propagate.
 *   3. Kill switch: set window.__tomTranscriptOff = true to disable instantly.
 *   4. Arguments and return values are never modified.
 */
(function () {
  'use strict';

  // Idempotency guard — don't double-inject
  if (window.__tomTranscriptActive) {
    return 'ALREADY_ACTIVE:' + window.__tomTranscript.entries.length + ' entries';
  }

  // ── 1. Ring Buffer Accumulator ──────────────────────────────────────────────
  var MAX_ENTRIES = 500;

  var transcript = {
    entries: [],
    startedAt: Date.now(),

    push: function (entry) {
      if (window.__tomTranscriptOff) return;
      entry.ts = entry.ts || Date.now();
      entry.iso = new Date(entry.ts).toISOString();
      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) this.entries.shift();
      try {
        window.dispatchEvent(new CustomEvent('tom-transcript', { detail: entry }));
      } catch (_) {}
    },

    /** Return all entries as JSON string */
    dump: function () {
      return JSON.stringify(this.entries);
    },

    /** Return entries since a given unix timestamp */
    since: function (ts) {
      return this.entries.filter(function (e) { return e.ts >= ts; });
    },

    /** Return entries as human-readable text */
    text: function () {
      return this.entries.map(function (e) {
        return '[' + e.iso + '] [' + e.type + '] ' + (e.text || '');
      }).join('\n');
    },

    /** Drain: return all entries and clear buffer */
    drain: function () {
      var copy = this.entries.slice();
      this.entries.length = 0;
      return copy;
    },

    /** Clear the buffer */
    clear: function () {
      this.entries.length = 0;
    },

    /** Return count of entries */
    count: function () {
      return this.entries.length;
    }
  };

  // Non-writable to prevent accidental overwrite
  Object.defineProperty(window, '__tomTranscript', {
    value: transcript,
    writable: false,
    configurable: true
  });

  Object.defineProperty(window, '__tomTranscriptActive', {
    value: true,
    writable: true,
    configurable: true
  });

  // Kill switch — defaults to off (capture enabled)
  window.__tomTranscriptOff = false;

  // ── 2. Safe Console.log Wrapper ─────────────────────────────────────────────
  //
  // Captures the CURRENT console.log (which may already be the extension's
  // wrapper) and wraps around it. The original is ALWAYS called first.

  var _currentLog = console.log;

  console.log = function () {
    // STEP 1: Call the original FIRST, synchronously, unconditionally
    _currentLog.apply(console, arguments);

    // STEP 2: Capture (fire-and-forget, fully guarded)
    try {
      if (window.__tomTranscriptOff) return;

      var arg0 = arguments[0];
      if (typeof arg0 !== 'string' && arg0 !== 'T:' && arg0 !== 'A:') return;

      // Pattern: console.log('T:', text) — Tom's transcript
      if (arg0 === 'T:' && arguments.length >= 2) {
        transcript.push({
          type: 'transcript',
          role: 'assistant',
          text: String(arguments[1])
        });
      }
      // Pattern: console.log('A:', length) — Audio chunk indicator
      else if (arg0 === 'A:' && arguments.length >= 2) {
        transcript.push({
          type: 'audio_chunk',
          text: 'Audio chunk: ' + String(arguments[1]) + ' bytes'
        });
      }
      // Pattern: '[Vision Agent] Tool call: name'
      else if (typeof arg0 === 'string' && arg0.indexOf('[Vision Agent]') === 0) {
        var parts = Array.prototype.slice.call(arguments).map(String);
        transcript.push({
          type: 'tool_call',
          text: parts.join(' ')
        });
      }
      // Pattern: '[Memory] Live session checkpointed:'
      else if (typeof arg0 === 'string' && arg0.indexOf('[Memory]') === 0) {
        transcript.push({
          type: 'memory',
          text: Array.prototype.slice.call(arguments).map(String).join(' ')
        });
      }
      // Pattern: 'Live session connected' / 'Live session closed'
      else if (typeof arg0 === 'string' && arg0.indexOf('Live session') === 0) {
        transcript.push({
          type: 'session',
          text: String(arg0)
        });
      }
    } catch (_) {
      // Never propagate — transcript capture must be invisible
    }
  };

  // Preserve reference for kill/restore
  window.__tomTranscriptRestore = function () {
    console.log = _currentLog;
    window.__tomTranscriptOff = true;
    window.__tomTranscriptActive = false;
    return 'Transcript capture disabled, original console.log restored.';
  };

  // ── 3. Confirmation ────────────────────────────────────────────────────────
  transcript.push({
    type: 'session',
    text: 'Transcript capture injected successfully'
  });

  return 'CAPTURE_ACTIVE:ring_buffer=' + MAX_ENTRIES + ':kill_switch=window.__tomTranscriptOff=true';
})();
