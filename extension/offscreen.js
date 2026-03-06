// offscreen.js — Floyd's Labs TTY Bridge v4.2
// Offscreen document for audio playback (Gemini Live output)
// Runs in a hidden document context that can play audio without restrictions.
'use strict';

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioCtx();

async function playPcmAudio(base64Data, sampleRate) {
  try {
    const raw = atob(base64Data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    // 16-bit PCM LE mono
    const samples = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 32768;

    const buffer = audioContext.createBuffer(1, float32.length, sampleRate || 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    if (audioContext.state === 'suspended') await audioContext.resume();

    source.start(0);

    return new Promise((resolve, reject) => {
      source.onended = () => resolve();
      source.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.error('[Floyd Offscreen] PCM playback error:', err);
    throw err;
  }
}

async function playAudioUrl(url, volume) {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume || 1.0;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (audioContext.state === 'suspended') await audioContext.resume();

    source.start(0);

    return new Promise((resolve, reject) => {
      source.onended = () => resolve();
      source.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.error('[Floyd Offscreen] URL playback error:', err);
    throw err;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_PCM_AUDIO') {
    playPcmAudio(message.data, message.sampleRate)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'PLAY_AUDIO_URL') {
    playAudioUrl(message.url, message.volume)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
