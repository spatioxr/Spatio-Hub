let context;
// Browsers allow audio only after a user gesture; never block a prompt on audio.
export function enableFeedbackAudio() {
  const unlock = () => {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context ||= new Audio();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* Audio is optional. */ }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
}
export function playFeedbackSound() {
  if (!context || context.state !== 'running') return;
  try {
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + index * 0.12);
      gain.gain.linearRampToValueAtTime(0.045, start + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + index * 0.12 + 0.3);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start + index * 0.12); oscillator.stop(start + index * 0.12 + 0.32);
    });
  } catch { /* Audio is optional. */ }
}
