// All audio is synthesized locally; no downloads, timers or autoplay are needed.
export class Sound {
  constructor(isEnabled = () => true, contextFactory = () => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    return Context ? new Context() : null;
  }) {
    this.isEnabled = isEnabled;
    this.contextFactory = contextFactory;
    this.context = null;
    this.master = null;
    this.music = null;
    this.playing = false;
    this.nextBeat = null;
    this.beat = 0;
    this.voices = new Set();
  }

  enabled() {
    try { return this.isEnabled() === true; } catch { return false; }
  }

  fade(node, value, seconds = 0.025) {
    if (!node || !this.context) return;
    try {
      node.gain.cancelScheduledValues(this.context.currentTime);
      node.gain.setTargetAtTime(value, this.context.currentTime, seconds);
    } catch { /* An unavailable audio device must not interrupt a flight. */ }
  }

  unlock() {
    if (!this.enabled()) {
      this.fade(this.master, 0, 0.012);
      this.stopVoices();
      this.nextBeat = null;
      return;
    }
    try {
      if (!this.context) {
        const context = this.contextFactory();
        if (!context) return;
        this.context = context;
        this.master = context.createGain();
        this.master.gain.setValueAtTime(0, context.currentTime);
        this.master.connect(context.destination);
        this.music = context.createGain();
        this.music.gain.setValueAtTime(0, context.currentTime);
        this.music.connect(this.master);
      }
      Promise.resolve(this.context.resume()).catch(() => {});
      this.fade(this.master, 0.7);
      this.fade(this.music, this.playing ? 0.22 : 0, 0.08);
    } catch { /* Unsupported or blocked audio is optional. */ }
  }

  stopVoices(musicOnly = false) {
    if (!this.context) return;
    for (const voice of this.voices) {
      if (musicOnly && !voice.music) continue;
      try { voice.oscillator.stop(this.context.currentTime + 0.04); } catch { /* Already ended. */ }
    }
  }

  setPlaying(active) {
    this.playing = Boolean(active);
    this.nextBeat = null;
    this.fade(this.music, this.playing && this.enabled() ? 0.22 : 0, 0.06);
    if (!this.playing) this.stopVoices(true);
  }

  tone(frequency, duration, delay, type, volume, pan = 0, music = false, endFrequency = frequency) {
    if (!this.enabled() || !this.context || this.context.state !== 'running' || !this.master) return;
    try {
      const context = this.context;
      const at = context.currentTime + Math.max(0, delay);
      const length = Math.max(0.04, duration);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const panner = context.createStereoPanner?.();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, at);
      if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + length);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      oscillator.connect(gain);
      const destination = music ? this.music : this.master;
      if (panner) {
        panner.pan.setValueAtTime(pan, at);
        gain.connect(panner);
        panner.connect(destination);
      } else gain.connect(destination);
      const voice = { oscillator, music };
      this.voices.add(voice);
      oscillator.onended = () => {
        this.voices.delete(voice);
        oscillator.disconnect();
        gain.disconnect();
        panner?.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + length + 0.02);
    } catch { /* Audio failures never change the game state. */ }
  }

  note(frequency, duration = 0.1, delay = 0, type = 'sine', volume = 0.05) {
    this.tone(frequency, duration, delay, type, volume);
  }

  switch(lane = 0) {
    const pan = lane === 0 ? -0.45 : 0.45;
    this.tone(lane === 0 ? 430 : 250, 0.12, 0, 'sine', 0.035, pan, false, lane === 0 ? 250 : 430);
    this.tone(650, 0.09, 0.025, 'triangle', 0.012, pan);
  }

  collect(chain, lane = 0) {
    const notes = [523.25, 587.33, 659.25, 783.99, 880];
    const base = notes[(Math.max(1, chain) - 1) % notes.length];
    const pan = lane === 0 ? -0.25 : 0.25;
    this.tone(base, 0.22, 0, 'sine', 0.045, pan);
    this.tone(base * 1.5, 0.2, 0.045, 'sine', 0.018, -pan);
    if (chain % 3 === 0 && chain <= 9) {
      this.tone(base * 2, 0.32, 0.09, 'sine', 0.025);
      this.tone(base * 2.5, 0.26, 0.15, 'sine', 0.012);
    }
  }

  start() {
    this.beat = 0;
    [261.63, 329.63, 392, 523.25].forEach((frequency, index) => this.note(frequency, 0.3, index * 0.07, 'sine', 0.032));
  }

  crash() {
    this.tone(180, 0.42, 0, 'triangle', 0.065, 0, false, 42);
    this.tone(85, 0.56, 0.05, 'sine', 0.055, 0, false, 30);
  }

  sector(sector) {
    const root = [293.66, 329.63, 261.63, 349.23][(sector - 1) % 4];
    [1, 1.5, 2].forEach((ratio, index) => this.note(root * ratio, 0.48, index * 0.1, 'sine', 0.025));
  }

  tick(elapsed, multiplier = 1) {
    if (!this.playing || !this.enabled() || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.nextBeat === null) { this.nextBeat = now + 0.14; return; }
    if (now < this.nextBeat) return;
    // Schedule one fresh beat after a delayed frame, never a burst of missed notes.
    this.nextBeat = now + Math.max(0.34, 0.44 - (multiplier - 1) * 0.025);
    const root = [146.83, 164.81, 130.81, 174.61][Math.floor(elapsed / 20) % 4];
    const melody = [0, 7, 12, 7, 3, 10, 12, 7];
    const pitch = root * 2 ** (melody[this.beat % melody.length] / 12);
    this.tone(pitch, 0.36, 0, 'sine', 0.018, Math.sin(this.beat * 0.7) * 0.35, true);
    if (this.beat % 4 === 0) this.tone(root / 2, 0.6, 0, 'sine', 0.028, 0, true);
    this.beat += 1;
  }
}
