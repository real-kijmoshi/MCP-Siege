/** Browser-only synthesized audio. It observes the game but never feeds state back into it. */
export type SoundCue = 'select' | 'acknowledge' | 'order' | 'info' | 'warning' | 'critical' | 'capture' | 'victory' | 'defeat';
export type CombatCue = 'melee' | 'arrow' | 'siege';

const MUTE_KEY = 'siege:sound-muted';
const MASTER_LEVEL = 0.55;
const SILENCE = 0.0001;
type Bus = 'interface' | 'battle';

interface ToneOptions { type?: OscillatorType; from: number; to?: number; delay?: number; duration: number; volume?: number; attack?: number }
interface NoiseOptions { delay?: number; duration: number; volume?: number; cutoff?: number; cutoffTo?: number; highpass?: number }

/** Wall-clock rate limiting belongs here, outside the deterministic simulation. */
export class CombatCueLimiter {
  private meleeAt = Number.NEGATIVE_INFINITY;
  private arrowAt = Number.NEGATIVE_INFINITY;
  private siegeAt = Number.NEGATIVE_INFINITY;

  public accept(kind: CombatCue, now: number): boolean {
    const gap = kind === 'siege' ? 300 : kind === 'arrow' ? 150 : 95;
    const previous = kind === 'siege' ? this.siegeAt : kind === 'arrow' ? this.arrowAt : this.meleeAt;
    if (now - previous < gap) return false;
    if (kind === 'siege') this.siegeAt = now;
    else if (kind === 'arrow') this.arrowAt = now;
    else this.meleeAt = now;
    return true;
  }

  public reset(): void {
    this.meleeAt = Number.NEGATIVE_INFINITY;
    this.arrowAt = Number.NEGATIVE_INFINITY;
    this.siegeAt = Number.NEGATIVE_INFINITY;
  }
}

class Synthesizer {
  private readonly master: GainNode;
  private readonly interfaceBus: GainNode;
  private readonly battleBus: GainNode;
  private readonly noiseBuffer: AudioBuffer;

  public constructor(private readonly context: AudioContext, muted: boolean) {
    this.master = context.createGain();
    this.interfaceBus = context.createGain();
    this.battleBus = context.createGain();
    const compressor = context.createDynamicsCompressor();
    this.master.gain.value = muted ? SILENCE : MASTER_LEVEL;
    this.interfaceBus.gain.value = 0.8;
    this.battleBus.gain.value = 0.62;
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    this.interfaceBus.connect(this.master);
    this.battleBus.connect(this.master);
    this.master.connect(compressor);
    compressor.connect(context.destination);

    // One reusable source replaces a new random buffer allocation for every blow.
    this.noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  }

  public setMuted(muted: boolean): void {
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(SILENCE, this.master.gain.value), now);
    this.master.gain.exponentialRampToValueAtTime(muted ? SILENCE : MASTER_LEVEL, now + 0.025);
  }

  public tone(bus: Bus, options: ToneOptions): void {
    const { type = 'sine', from, to = from, delay = 0, duration, volume = 0.14, attack = 0.006 } = options;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, from), start);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    envelope.gain.setValueAtTime(SILENCE, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(attack, duration / 2));
    envelope.gain.exponentialRampToValueAtTime(SILENCE, start + duration);
    oscillator.connect(envelope);
    envelope.connect(bus === 'interface' ? this.interfaceBus : this.battleBus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  public noise(bus: Bus, options: NoiseOptions): void {
    const { delay = 0, duration, volume = 0.14, cutoff = 900, cutoffTo = cutoff, highpass = 35 } = options;
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const low = this.context.createBiquadFilter();
    const high = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = this.noiseBuffer;
    low.type = 'lowpass';
    high.type = 'highpass';
    low.frequency.setValueAtTime(Math.max(1, cutoff), start);
    if (cutoffTo !== cutoff) low.frequency.exponentialRampToValueAtTime(Math.max(1, cutoffTo), start + duration);
    high.frequency.value = highpass;
    envelope.gain.setValueAtTime(SILENCE, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.004, duration / 2));
    envelope.gain.exponentialRampToValueAtTime(SILENCE, start + duration);
    source.connect(low); low.connect(high); high.connect(envelope);
    envelope.connect(bus === 'interface' ? this.interfaceBus : this.battleBus);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}

/** Owns audio lifecycle, preference persistence, mixing, and cue design. */
export class SoundManager {
  private context: AudioContext | null = null;
  private synth: Synthesizer | null = null;
  private muted: boolean;
  private readonly combatLimiter = new CombatCueLimiter();

  public constructor() {
    this.muted = this.readMuted();
    document.getElementById('sound-toggle')?.addEventListener('click', this.onToggle);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.dispose, { once: true });
    this.syncToggle();
  }

  public get isMuted(): boolean { return this.muted; }

  public toggle(): boolean {
    this.muted = !this.muted;
    try { window.localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* Optional. */ }
    this.syncToggle();
    if (!this.muted) {
      this.ensureSynth()?.setMuted(false);
      this.resume();
      this.play('select');
    } else {
      this.synth?.setMuted(true);
      this.combatLimiter.reset();
    }
    return this.muted;
  }

  public play(cue: SoundCue): void {
    if (this.muted) return;
    const synth = this.ensureSynth();
    if (synth === null) return;
    this.resume();
    switch (cue) {
      case 'select': synth.tone('interface', { type: 'square', from: 1320, to: 880, duration: 0.045, volume: 0.055 }); break;
      case 'acknowledge':
        synth.noise('interface', { duration: 0.075, volume: 0.07, cutoff: 720 });
        synth.tone('interface', { type: 'triangle', from: 210, to: 155, duration: 0.08, volume: 0.075 }); break;
      case 'order':
        synth.tone('interface', { type: 'sawtooth', from: 300, to: 175, duration: 0.13, volume: 0.075 });
        synth.noise('interface', { duration: 0.11, volume: 0.045, cutoff: 1300 }); break;
      case 'info': synth.tone('interface', { from: 660, duration: 0.15, volume: 0.07 }); break;
      case 'warning':
        synth.tone('interface', { type: 'triangle', from: 440, duration: 0.11, volume: 0.09 });
        synth.tone('interface', { type: 'triangle', from: 330, delay: 0.12, duration: 0.18, volume: 0.09 }); break;
      case 'critical':
        synth.tone('interface', { type: 'square', from: 196, duration: 0.11, volume: 0.09 });
        synth.tone('interface', { type: 'square', from: 196, delay: 0.15, duration: 0.2, volume: 0.09 }); break;
      case 'capture': synth.tone('interface', { type: 'triangle', from: 294, to: 587, duration: 0.34, volume: 0.095 }); break;
      case 'victory': this.chord(synth, [523.25, 659.25, 783.99], false); break;
      case 'defeat': this.chord(synth, [392, 329.63, 261.63], true); break;
    }
  }

  public playAlert(severity: 'info' | 'warning' | 'critical'): void { this.play(severity); }

  public playCombat(kind: CombatCue): void {
    if (this.muted || !this.combatLimiter.accept(kind, performance.now())) return;
    const synth = this.ensureSynth();
    if (synth === null) return;
    this.resume();
    if (kind === 'melee') {
      synth.noise('battle', { duration: 0.065, volume: 0.075, cutoff: 600, cutoffTo: 170 });
      synth.tone('battle', { type: 'sawtooth', from: 155, to: 105, duration: 0.055, volume: 0.035 });
    } else if (kind === 'arrow') {
      synth.noise('battle', { duration: 0.14, volume: 0.055, cutoff: 1900, cutoffTo: 350, highpass: 180 });
    } else {
      synth.noise('battle', { duration: 0.36, volume: 0.18, cutoff: 700, cutoffTo: 80 });
      synth.tone('battle', { from: 105, to: 38, duration: 0.34, volume: 0.14 });
    }
  }

  public readonly dispose = (): void => {
    document.getElementById('sound-toggle')?.removeEventListener('click', this.onToggle);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.context !== null && this.context.state !== 'closed') void this.context.close();
    this.context = null; this.synth = null;
  };

  private chord(synth: Synthesizer, frequencies: readonly number[], descending: boolean): void {
    for (let i = 0; i < frequencies.length; i += 1) {
      synth.tone('interface', { type: 'triangle', from: frequencies[i] ?? 440, delay: i * 0.14, duration: i === 2 ? 0.42 : 0.18, volume: 0.1 });
    }
    if (descending) synth.noise('interface', { delay: 0.28, duration: 0.32, volume: 0.025, cutoff: 260 });
  }

  private ensureSynth(): Synthesizer | null {
    if (this.synth !== null) return this.synth;
    if (typeof AudioContext === 'undefined') return null;
    try {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.synth = new Synthesizer(this.context, this.muted);
      return this.synth;
    } catch { return null; }
  }

  private resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => undefined);
  }

  private readMuted(): boolean {
    try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }

  private readonly onToggle = (): void => { this.toggle(); };
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && !this.muted) this.resume();
  };

  private syncToggle(): void {
    const button = document.getElementById('sound-toggle');
    const glyph = document.getElementById('sound-toggle-glyph');
    const enabled = !this.muted;
    button?.setAttribute('aria-pressed', String(enabled));
    if (button !== null) {
      button.setAttribute('aria-label', enabled ? 'Mute sound effects' : 'Enable sound effects');
      button.title = enabled ? 'Sound effects on — click to mute' : 'Sound effects off — click to enable';
    }
    if (glyph !== null) glyph.textContent = enabled ? '♪' : '×';
  }
}
