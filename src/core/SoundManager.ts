export class SoundManager {
  private static instance: SoundManager;
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;
  private sounds: Map<string, AudioBuffer> = new Map();

  private constructor() {}

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public init(): void {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);
    }
  }

  public setVolume(val: number): void {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.audioCtx) {
        this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, this.audioCtx.currentTime, 0.05);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.audioCtx) {
        this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, this.audioCtx.currentTime, 0.05);
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public async loadSound(name: string, url: string): Promise<void> {
    if (!this.audioCtx) this.init();
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioCtx!.decodeAudioData(arrayBuffer);
      this.sounds.set(name, audioBuffer);
    } catch (e) {
      console.warn(`Failed to load sound ${name} from ${url}. Using fallback.`);
    }
  }

  public playSound(name: string): void {
    if (this.isMuted || !this.audioCtx || !this.masterGain) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const buffer = this.sounds.get(name);
    if (buffer) {
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.masterGain);
      source.start();
    } else {
      // Fallback synthesis based on name
      switch(name) {
          case 'ping': this.synthesizePing(); break;
          case 'shoot_cannon': this.synthesizeShoot(400, 0.15, 'square', 0.1); break;
          case 'shoot_laser': this.synthesizeShoot(1200, 0.08, 'sine', 0.05); break;
          case 'shoot_ray': this.synthesizeShoot(200, 0.25, 'sawtooth', 0.08); break;
          case 'shoot_rocket': this.synthesizeShoot(300, 0.35, 'sawtooth', 0.1); break;
          case 'shoot_missile': this.synthesizeShoot(500, 0.25, 'sine', 0.08); break;
          case 'place_mine': this.synthesizeShoot(150, 0.15, 'triangle', 0.1); break;
          case 'explosion_large': this.synthesizeExplosion(); break;
          case 'hit_cannon': this.synthesizeShoot(300, 0.1, 'triangle', 0.15); break;
          case 'hit_laser': this.synthesizeShoot(2000, 0.04, 'sine', 0.05); break;
          case 'hit_ray': this.synthesizeShoot(150, 0.15, 'sawtooth', 0.1); break;
          case 'ui_click': this.synthesizeShoot(800, 0.05, 'square', 0.1); break;
          case 'collect_coin': this.synthesizePing(); break; // reuse
          default: this.synthesizeShoot(600, 0.1, 'sine', 0.1); break;
      }
    }
  }

  private synthesizeShoot(freq: number, duration: number, type: OscillatorType, volume: number = 0.05): void {
      if (!this.audioCtx || !this.masterGain) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq / 3, this.audioCtx.currentTime + duration);
      gain.gain.setValueAtTime(volume, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
  }

  private synthesizeExplosion(): void {
      if (!this.audioCtx || !this.masterGain) return;
      const noise = this.audioCtx.createBufferSource();
      const bufferSize = this.audioCtx.sampleRate * 0.5;
      const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.5);
      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.5);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start();
      noise.stop(this.audioCtx.currentTime + 0.5);
  }

  private synthesizePing(): void {
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.1);
  }
}
