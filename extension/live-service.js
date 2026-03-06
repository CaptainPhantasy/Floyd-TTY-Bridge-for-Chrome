/**
 * live-service.js
 *
 * Vanilla JavaScript ES module conversion of Tom_The_Peep/services/liveService.ts
 * for use in a Chrome extension side panel.
 *
 * Changes from the TypeScript original:
 *   - All TypeScript types/annotations removed
 *   - GoogleGenAI imported from local ./lib/genai.mjs
 *   - VISION_TOOLS imported from sibling ./vision-tools.js
 *   - API key sourced from chrome.storage.local instead of process.env
 *   - Memory system (memoryManager, generateMemoryPatch) removed; checkpoint is a no-op
 *   - getLiveVoice() removed; voice defaults to 'Puck'
 *   - executeToolCall replaced by a toolExecutor callback passed to the constructor
 *   - AudioWorklet path kept as /audio/pcm-processor.worklet.js with ScriptProcessor fallback
 */

import { GoogleGenAI, Modality } from './lib/genai.mjs';
import { VISION_TOOLS } from './vision-tools.js';

// ---------------------------------------------------------------------------
// Cached GoogleGenAI singleton
// ---------------------------------------------------------------------------

let _genAI = null;

/**
 * Retrieve (or lazily create) a GoogleGenAI instance.
 * The API key is read from chrome.storage.local asynchronously, so this
 * function returns a Promise.
 *
 * @returns {Promise<GoogleGenAI>}
 */
async function getGenAI() {
  if (_genAI) return _genAI;

  const result = await chrome.storage.local.get('gemini_api_key');
  const apiKey = result.gemini_api_key;
  if (!apiKey) {
    throw new Error(
      'Missing Gemini API key. Set "gemini_api_key" in chrome.storage.local before calling Gemini services.',
    );
  }
  _genAI = new GoogleGenAI({ apiKey });
  return _genAI;
}

// ---------------------------------------------------------------------------
// LiveSession
// ---------------------------------------------------------------------------

class LiveSession {
  // State management
  /** @type {'idle'|'connecting'|'connected'|'reconnecting'|'disconnecting'} */
  state = 'idle';

  // Audio contexts and nodes
  /** @type {AudioContext|null} */
  inputAudioContext = null;
  /** @type {AudioContext|null} */
  outputAudioContext = null;
  /** @type {MediaStreamAudioSourceNode|null} */
  inputSource = null;
  /** @type {ScriptProcessorNode|null} */
  processor = null;
  /** @type {AudioWorkletNode|null} */
  workletNode = null;
  /** @type {GainNode|null} */
  outputNode = null;
  nextStartTime = 0;
  /** @type {Set<AudioBufferSourceNode>} */
  sources = new Set();
  suppressOutputUntilMs = 0;
  lastOutputAtMs = 0;

  // Noise gate thresholds for echo rejection
  // When AI is silent, use low threshold so user speech is detected easily.
  // When AI is speaking, raise threshold so speaker echo doesn't trigger barge-in.
  silenceThreshold = 0.015;       // RMS floor when AI is silent
  echoRejectThreshold = 0.06;     // RMS floor when AI is speaking (rejects speaker bleed)
  echoTailMs = 600;               // Keep elevated threshold this long after AI stops

  // Session management
  /** @type {Promise|null} */
  activeSession = null;
  /** @type {MediaStream|null} */
  stream = null;
  /** @type {AbortController|null} */
  abortController = null;

  // Reconnection management
  reconnectAttempts = 0;
  maxReconnectAttempts = 5;
  reconnectDelay = 1000; // Start at 1s, max 30s
  isIntentionalDisconnect = false;
  /** @type {number|null} */
  reconnectTimeout = null;

  // Memory and video
  /** @type {string|null} */
  currentSessionId = null;
  /** @type {HTMLVideoElement|null} */
  videoElement = null;
  /** @type {HTMLCanvasElement|null} */
  canvasElement = null;
  /** @type {number|null} */
  videoInterval = null;
  /** @type {MediaStream|null} */
  videoStream = null;
  /** @type {string[]} */
  transcriptBuffer = [];

  /**
   * @param {(text: string) => void} onMessage
   * @param {(base64: string) => void} onAudioData
   * @param {(error: object) => void} [onError]
   * @param {(status: string) => void} [onStatusChange]
   * @param {(toolName: string, args: object) => Promise<any>} [toolExecutor]
   */
  constructor(onMessage, onAudioData, onError, onStatusChange, toolExecutor) {
    this.onMessage = onMessage;
    this.onAudioData = onAudioData;
    this.onError = onError;
    this.onStatusChange = onStatusChange;
    this.toolExecutor = toolExecutor;
  }

  /**
   * Get current connection state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if session is currently connected
   */
  isConnected() {
    return this.state === 'connected';
  }

  /**
   * Whether the agent currently has audio playing/queued locally.
   * Used for barge-in interruption.
   */
  isSpeaking() {
    return this.sources.size > 0;
  }

  /**
   * Consider the agent "speaking" for a short grace window after the most recent
   * output chunk. This avoids missing barge-in during gaps between audio chunks.
   */
  isSpeakingOrRecently(graceMs = 1200) {
    if (this.isSpeaking()) return true;
    return Date.now() - this.lastOutputAtMs < graceMs;
  }

  /**
   * Interrupt agent speech (barge-in): stop local playback immediately and
   * optionally suppress new audio chunks for a short window.
   *
   * This mirrors the "interruptions" behavior described in turn-taking systems.
   * See: https://docs.livekit.io/agents/logic-structure/turns/
   */
  interrupt(options) {
    const suppressMs = options?.suppressMs ?? 1200;
    this.suppressOutputUntilMs = Date.now() + suppressMs;

    // Stop all currently scheduled/playing audio immediately.
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch (_) { /* ignore */ }
    });
    this.sources.clear();

    // Reset scheduling so we don't "resume" old queued audio.
    this.nextStartTime = 0;

    // Best-effort: if the underlying session supports an interrupt API, call it.
    // (Kept as optional to avoid coupling to a specific SDK shape.)
    this.activeSession
      ?.then((session) => {
        try {
          session.interrupt?.();
        } catch (_) { /* ignore */ }
      })
      .catch(() => {});
  }

  /**
   * Connect to Gemini Live API with robustness features.
   *
   * @param {MediaStream} [externalStream] - Optional external MediaStream
   * @param {string} [systemInstruction] - Optional system instruction override
   * @param {{ voice?: string }} [options] - Additional options (e.g. voice name)
   */
  async connect(externalStream, systemInstruction, options) {
    // State machine guard
    if (this.state !== 'idle' && this.state !== 'reconnecting') {
      console.warn(`Cannot connect: state is ${this.state}`);
      return;
    }

    // Abort any pending operations
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Update state
    const wasReconnecting = this.state === 'reconnecting';
    this.state = wasReconnecting ? 'reconnecting' : 'connecting';
    this.onStatusChange?.(this.state);

    // Memory system removed -- no-op placeholder
    const memoryContext = 'No previous session data.';

    try {
      // Check abort before async operations
      if (signal.aborted) return;

      // Use external stream or create new one
      this.stream = externalStream || (await navigator.mediaDevices.getUserMedia({ audio: true }));

      if (signal.aborted) {
        this.stream.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }

      // Input context for sending audio to Gemini (16kHz)
      const WebkitAudioContext = window.webkitAudioContext;
      const AudioContextCtor = window.AudioContext ?? WebkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('AudioContext is not available in this browser.');
      }
      this.inputAudioContext = new AudioContextCtor({ sampleRate: 16000 });

      // Output context for playing Gemini's response (24kHz)
      this.outputAudioContext = new AudioContextCtor({ sampleRate: 24000 });
      this.outputNode = this.outputAudioContext.createGain();
      this.outputNode.connect(this.outputAudioContext.destination);
      this.nextStartTime = 0;

      if (signal.aborted) return;

      // Voice defaults to 'Puck'; callers may override via options.voice
      const voiceName = options?.voice || 'Puck';

      // Final fallback for system instruction if not provided
      const finalInstruction =
        systemInstruction ||
        `You are Tom the Peep, a web browsing and accessibility expert.

## Session Memory (Grounding)
${memoryContext}

Keep answers concise and helpful.`;

      // getGenAI() is now async (reads API key from chrome.storage.local)
      const genAI = await getGenAI();

      if (signal.aborted) return;

      // Connect to Gemini Live
      const sessionPromise = genAI.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction: finalInstruction,
          tools: [VISION_TOOLS],
        },
        callbacks: {
          onopen: () => {
            if (signal.aborted) return;

            console.log('Live session connected');
            this.state = 'connected';
            this.reconnectAttempts = 0; // Reset on successful connection
            this.onStatusChange?.(this.state);

            // Initialize audio input (with fallback)
            const stream = this.stream;
            if (!stream) return;
            this.initAudioInput(stream, sessionPromise).catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error('Audio input initialization failed:', err);
              this.onError?.({ type: 'audio_context_error', message: msg });
            });
          },
          onmessage: async (message) => {
            if (signal.aborted || this.state !== 'connected') return;

            // Handle Function Calls from Gemini (Vision Agent Tools)
            const toolCall = message.toolCall;
            if (toolCall?.functionCalls) {
              const functionResponses = [];
              for (const fc of toolCall.functionCalls) {
                console.log(`[Vision Agent] Tool call: ${fc.name}`, fc.args);
                try {
                  // Use the injected toolExecutor callback
                  const result = this.toolExecutor
                    ? await this.toolExecutor(fc.name, fc.args || {})
                    : { error: 'No tool executor configured' };
                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: { result: JSON.stringify(result) },
                  });
                  this.onMessage(`[Tool: ${fc.name}] Done`);
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  functionResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: { error: errMsg },
                  });
                  console.error(`[Vision Agent] Tool error: ${fc.name}`, err);
                }
              }

              // Send function responses back to the session
              sessionPromise
                .then((session) => {
                  if (this.state === 'connected' && session) {
                    try {
                      session.sendToolResponse({ functionResponses });
                    } catch (err) {
                      console.warn('Failed to send tool response:', err);
                    }
                  }
                })
                .catch(() => {});
              return;
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              // If we've recently interrupted, drop output chunks for a short window.
              if (Date.now() < this.suppressOutputUntilMs) return;
              this.playAudioChunk(base64Audio);
              this.onAudioData(base64Audio);
            }

            // Handle Text/Transcript Output (if available)
            const modelText = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (modelText) {
              this.onMessage(modelText);
              this.handleMemoryCheckpoint(modelText);
            }
          },
          onclose: () => {
            console.log('Live session closed');

            // Only attempt reconnect if not intentional and not already disconnecting/idle
            if (
              !this.isIntentionalDisconnect &&
              this.state !== 'disconnecting' &&
              this.state !== 'idle' &&
              this.state === 'connected'
            ) {
              this.attemptReconnect();
            } else {
              // Intentional disconnect or already disconnecting - just update state
              if (this.state !== 'idle') {
                this.state = 'idle';
                this.onStatusChange?.(this.state);
              }
            }
          },
          onerror: (err) => {
            console.error('Live session error', err);

            // Don't show errors or reconnect if this is an intentional disconnect
            if (this.isIntentionalDisconnect || this.state === 'disconnecting') {
              this.state = 'idle';
              this.onStatusChange?.(this.state);
              return;
            }

            const errorMessage = err instanceof Error ? err.message : String(err);
            this.onError?.({
              type: 'api_error',
              message: errorMessage,
            });

            // Attempt reconnect on error if not intentional and still connected
            if (this.state === 'connected') {
              this.attemptReconnect();
            } else {
              this.state = 'idle';
              this.onStatusChange?.(this.state);
            }
          },
        },
      });

      this.activeSession = sessionPromise;
      return sessionPromise;
    } catch (err) {
      // Handle permission errors
      if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        this.onError?.({ type: 'permission_denied', device: 'microphone' });
      } else {
        this.onError?.({
          type: 'api_error',
          message: err instanceof Error ? err.message : 'Connection failed',
        });
      }

      this.state = 'idle';
      this.onStatusChange?.(this.state);
      throw err;
    }
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  async attemptReconnect() {
    // Don't reconnect if intentionally disconnected or already disconnecting
    if (this.isIntentionalDisconnect || this.state === 'disconnecting' || this.state === 'idle') {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError?.({
        type: 'network_error',
        retrying: false,
        attempt: this.reconnectAttempts,
        message: 'Connection lost. Please try again.',
      });
      this.state = 'idle';
      this.onStatusChange?.(this.state);
      return;
    }

    this.state = 'reconnecting';
    this.onStatusChange?.(this.state);

    const delay = Math.min(
      this.reconnectDelay * 2 ** this.reconnectAttempts,
      30000, // Max 30 seconds
    );
    this.reconnectAttempts++;

    this.onError?.({
      type: 'network_error',
      retrying: true,
      attempt: this.reconnectAttempts,
      message: `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
    });

    this.reconnectTimeout = window.setTimeout(async () => {
      // Double-check before attempting reconnect (user might have disconnected)
      if (this.isIntentionalDisconnect || this.state === 'disconnecting' || this.state === 'idle') {
        return;
      }

      try {
        await this.connect(this.stream || undefined);
      } catch (err) {
        // Will trigger another reconnect attempt via onerror handler (if not intentional)
        if (!this.isIntentionalDisconnect) {
          console.error('Reconnection attempt failed:', err);
        }
      }
    }, delay);
  }

  /**
   * Initialize audio input with AudioWorklet (modern) or fallback to ScriptProcessor.
   *
   * NOTE: The worklet path is /audio/pcm-processor.worklet.js. If the worklet
   * fails to load (e.g. the file is missing or the browser doesn't support
   * AudioWorklet), the legacy ScriptProcessor path is used as a fallback.
   *
   * @param {MediaStream} stream
   * @param {Promise} sessionPromise
   */
  async initAudioInput(stream, sessionPromise) {
    if (!this.inputAudioContext) return;

    // Try AudioWorklet first (modern approach)
    if (this.inputAudioContext.audioWorklet) {
      try {
        await this.startAudioInputModern(stream, sessionPromise);
        return;
      } catch (err) {
        console.warn('AudioWorklet failed, falling back to ScriptProcessor:', err);
        // Fall through to legacy method
      }
    }

    // Fallback to ScriptProcessor (legacy, deprecated but widely supported)
    this.startAudioInputLegacy(stream, sessionPromise);
  }

  /**
   * Modern AudioWorklet-based audio input processing
   */
  async startAudioInputModern(stream, sessionPromise) {
    const inputCtx = this.inputAudioContext;
    if (!inputCtx) return;

    // Load the worklet module
    await inputCtx.audioWorklet.addModule(chrome.runtime.getURL('audio/pcm-processor.worklet.js'));

    // Create source and worklet node
    this.inputSource = inputCtx.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(inputCtx, 'pcm-processor');

    // Handle messages from worklet
    this.workletNode.port.onmessage = (e) => {
      if (this.state !== 'connected' || this.abortController?.signal.aborted) return;

      const pcmData = e.data.pcmData;

      // Noise gate: skip quiet chunks to prevent echo-triggered interrupts
      if (!this.shouldSendAudio(pcmData)) return;

      const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));

      sessionPromise
        .then((session) => {
          if (this.state === 'connected' && session) {
            try {
              session.sendRealtimeInput({
                media: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: base64Data,
                },
              });
            } catch (err) {
              // Silently handle send errors (connection may be closing)
              if (this.state === 'connected') {
                console.warn('Failed to send audio chunk:', err);
              }
            }
          }
        })
        .catch(() => {});
    };

    // Connect the audio graph
    this.inputSource.connect(this.workletNode);
  }

  /**
   * Legacy ScriptProcessor-based audio input processing (fallback)
   */
  startAudioInputLegacy(stream, sessionPromise) {
    if (!this.inputAudioContext) return;

    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this.state !== 'connected' || this.abortController?.signal.aborted) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = this.float32ToInt16(inputData);

      // Noise gate: skip quiet chunks to prevent echo-triggered interrupts
      if (!this.shouldSendAudio(pcmData)) return;

      const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));

      sessionPromise
        .then((session) => {
          if (this.state === 'connected' && session) {
            try {
              session.sendRealtimeInput({
                media: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: base64Data,
                },
              });
            } catch (err) {
              // Silently handle send errors (connection may be closing)
              if (this.state === 'connected') {
                console.warn('Failed to send audio chunk:', err);
              }
            }
          }
        })
        .catch(() => {});
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  async playAudioChunk(base64) {
    if (!this.outputAudioContext || !this.outputNode || this.state !== 'connected') return;
    if (Date.now() < this.suppressOutputUntilMs) return;

    try {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBuffer = await this.decodePCM(bytes, this.outputAudioContext);

      // Ensure proper timing - don't let chunks overlap
      const currentTime = this.outputAudioContext.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.start(this.nextStartTime);

      // Track output activity for barge-in gating (covers chunk gaps).
      this.lastOutputAtMs = Date.now();

      this.nextStartTime += audioBuffer.duration;

      source.onended = () => this.sources.delete(source);
      this.sources.add(source);
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }

  /**
   * @param {Uint8Array} data
   * @param {AudioContext} ctx
   * @returns {Promise<AudioBuffer>}
   */
  async decodePCM(data, ctx) {
    const int16Data = new Int16Array(data.buffer);
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    const buffer = ctx.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);
    return buffer;
  }

  /**
   * @param {Float32Array} float32
   * @returns {Int16Array}
   */
  float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  /**
   * Returns true if the audio chunk is loud enough to send to Gemini.
   * Uses a higher threshold while the AI is speaking to reject speaker echo.
   */
  shouldSendAudio(pcmInt16Array) {
    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < pcmInt16Array.length; i++) {
      const s = pcmInt16Array[i] / 32768;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / pcmInt16Array.length);

    // Pick threshold: high during AI speech + tail, low otherwise
    const aiActive = this.isSpeaking() || (Date.now() - this.lastOutputAtMs < this.echoTailMs);
    const threshold = aiActive ? this.echoRejectThreshold : this.silenceThreshold;

    return rms >= threshold;
  }

  /**
   * Periodically checkpoints the conversation to long-term memory.
   *
   * NOTE: The memory system (memoryManager, generateMemoryPatch) has been
   * stripped out for the Chrome extension build. This is a no-op placeholder
   * that logs transcript fragments. Plug in your memory back-end here later.
   */
  async handleMemoryCheckpoint(modelText) {
    this.transcriptBuffer.push(`Assistant: ${modelText}`);

    if (this.transcriptBuffer.length >= 2) {
      console.log('[Memory] Checkpoint stub -- transcript buffer length:', this.transcriptBuffer.length);
      // Keep only the most recent context in buffer to avoid re-processing old turns
      this.transcriptBuffer = this.transcriptBuffer.slice(-2);
    }
  }

  // --- Video Streaming ---

  /**
   * Start streaming video frames to the live session at ~3 FPS.
   * @param {MediaStream} stream
   */
  startVideoStream(stream) {
    if (this.state !== 'connected' || !this.activeSession) return;
    this.videoStream = stream;

    this.videoElement = document.createElement('video');
    this.videoElement.srcObject = stream;
    this.videoElement.autoplay = true;
    this.videoElement.play();
    this.videoElement.muted = true; // prevent feedback loop if audio is included

    this.canvasElement = document.createElement('canvas');
    const ctx = this.canvasElement.getContext('2d');
    if (!ctx) return;

    // Send a frame every 333ms (~3 FPS)
    this.videoInterval = window.setInterval(async () => {
      if (!this.videoElement || !this.canvasElement || !ctx || this.state !== 'connected') return;

      if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
        this.canvasElement.width = this.videoElement.videoWidth;
        this.canvasElement.height = this.videoElement.videoHeight;
        ctx.drawImage(this.videoElement, 0, 0);

        const base64Data = this.canvasElement.toDataURL('image/jpeg', 0.85).split(',')[1];

        this.activeSession
          .then((session) => {
            if (this.state === 'connected' && session) {
              try {
                session.sendRealtimeInput({
                  media: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                  },
                });
              } catch (err) {
                // Silently handle send errors
                if (this.state === 'connected') {
                  console.warn('Failed to send video frame:', err);
                }
              }
            }
          })
          .catch(() => {});
      }
    }, 333);
  }

  stopVideoStream() {
    if (this.videoInterval) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.videoStream = null;
    }
    this.videoElement = null;
    this.canvasElement = null;
  }

  /**
   * Disconnect from session with proper cleanup
   */
  disconnect() {
    // Mark as intentional FIRST to prevent any reconnection attempts
    this.isIntentionalDisconnect = true;

    // Cancel any pending reconnection immediately
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Reset reconnect attempts to prevent any messages
    this.reconnectAttempts = 0;

    // Abort any pending operations
    this.abortController?.abort();

    // Update state
    if (this.state !== 'idle' && this.state !== 'disconnecting') {
      this.state = 'disconnecting';
      this.onStatusChange?.(this.state);
    }

    // Stop video stream if active
    this.stopVideoStream();

    // Stop all playing audio immediately
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch (_) { /* ignore */ }
    });
    this.sources.clear();

    // Clean up audio processing nodes
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }

    // Close audio contexts
    if (this.inputAudioContext) {
      this.inputAudioContext.close().catch(() => {});
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      this.outputAudioContext.close().catch(() => {});
      this.outputAudioContext = null;
    }

    // Close Gemini session
    if (this.activeSession) {
      this.activeSession
        .then((s) => {
          try {
            s.close?.();
          } catch (_) { /* ignore */ }
        })
        .catch(() => {});
      this.activeSession = null;
    }

    // Reset state
    this.state = 'idle';
    this.isIntentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.onStatusChange?.(this.state);
  }
}

export { LiveSession };
