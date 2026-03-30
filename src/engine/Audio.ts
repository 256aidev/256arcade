export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted = false;
  private volume = 0.5;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  playTone(freq: number, duration: number, type: OscillatorType = 'square') {
    if (this.muted) return;
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = this.volume * 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  playNoise(duration: number) {
    if (this.muted) return;
    const ctx = this.getCtx();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = this.volume * 0.2;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  // Quick retro sound presets
  hit() { this.playTone(440, 0.1, 'square'); }
  score() { this.playTone(660, 0.15, 'square'); this.playTone(880, 0.15, 'square'); }
  lose() { this.playTone(200, 0.3, 'sawtooth'); }
  jump() {
    if (this.muted) return;
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
    gain.gain.value = this.volume * 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }
  powerup() { this.playTone(523, 0.1, 'square'); this.playTone(659, 0.1, 'square'); this.playTone(784, 0.15, 'square'); }
  explosion() { this.playNoise(0.3); }

  toggleMute() { this.muted = !this.muted; return this.muted; }
  isMuted() { return this.muted; }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); }
}

export const audio = new AudioManager();
