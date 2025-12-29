export class SoundManager {
  private static instance: SoundManager;
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private sounds: Map<string, AudioBuffer> = new Map();

  private constructor() {
    // Init Audio Context on first interaction usually, but here we prep it.
    // We'll resume it on user interaction if needed.
  }

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public init(): void {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted && this.audioCtx) {
      this.audioCtx.suspend();
    } else if (this.audioCtx) {
      this.audioCtx.resume();
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
    if (this.isMuted || !this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const buffer = this.sounds.get(name);
    if (buffer) {
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);
      source.start();
    } else {
      // Fallback synthesis based on name
      if (name === 'ping') this.synthesizePing();
    }
  }

  private synthesizePing(): void {
    if (!this.audioCtx) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.1);
  }
}
