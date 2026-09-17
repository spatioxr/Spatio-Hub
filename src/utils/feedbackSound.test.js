import test from 'node:test';
import assert from 'node:assert/strict';
import { enableFeedbackAudio, playFeedbackSound } from './feedbackSound.js';

test('feedback sound waits for interaction, plays a short chime, and fails quietly', () => {
  const listeners = new Map();
  let starts = 0;
  let resumes = 0;
  let audio;
  class MockAudio {
    constructor() { this.state = 'suspended'; this.currentTime = 1; this.destination = {}; audio = this; }
    resume() { resumes++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() { starts++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  globalThis.window = { AudioContext: MockAudio, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  try {
    playFeedbackSound();
    assert.equal(starts, 0);
    const cleanup = enableFeedbackAudio();
    assert.equal(resumes, 0);
    listeners.get('pointerdown')();
    playFeedbackSound();
    assert.equal(resumes, 1);
    assert.equal(starts, 2);
    audio.state = 'suspended'; playFeedbackSound();
    assert.equal(starts, 2);
    audio.state = 'running'; audio.createOscillator = () => { throw new Error('Audio unavailable'); };
    assert.doesNotThrow(playFeedbackSound);
    cleanup(); assert.equal(listeners.size, 0);
  } finally { delete globalThis.window; }
});
