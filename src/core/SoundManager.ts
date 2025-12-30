import { World } from './World';
import { SoundRaycaster, AudiblePath } from '../utils/SoundRaycaster';

interface SpatialVoice {
    source: AudioBufferSourceNode | OscillatorNode;
    gain: GainNode;
    panner: StereoPannerNode;
    filter: BiquadFilterNode;
    x: number;
    y: number;
}

export class SoundManager {
  private static instance: SoundManager;
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;
  private sounds: Map<string, AudioBuffer> = new Map();
  private activeLoops: Map<string, { osc: OscillatorNode | AudioBufferSourceNode, gain: GainNode, startTime?: number, isEnding?: boolean }> = new Map();
  
  private spatialLoops: Map<string, SpatialVoice> = new Map();
  private listenerX: number = 0;
  private listenerY: number = 0;
  private world: World | null = null;

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

  public setWorld(world: World): void {
      this.world = world;
  }

  public updateListener(x: number, y: number): void {
      this.listenerX = x;
      this.listenerY = y;
      
      // Update spatial loops
      if (this.world) {
          this.spatialLoops.forEach((voice) => {
              this.updateVoiceSpatial(voice);
          });
      }
  }

  private updateVoiceSpatial(voice: SpatialVoice): void {
      if (!this.world || !this.audioCtx) return;

      const paths = SoundRaycaster.calculateAudiblePaths(voice.x, voice.y, this.listenerX, this.listenerY, this.world);
      
      if (paths.length === 0) {
          voice.gain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.1);
          return;
      }

      // Summation of paths:
      // Total Volume = sqrt(sum of squares) - energy based
      // Pan = weighted average based on volume
      // Filter = lowest cutoff (most muffled)
      let totalEnergy = 0;
      let weightedPan = 0;
      let minCutoff = 20000;

      for (const p of paths) {
          totalEnergy += p.volume * p.volume;
          weightedPan += p.pan * p.volume;
          minCutoff = Math.min(minCutoff, p.filterCutoff);
      }

      const finalVolume = Math.min(1.0, Math.sqrt(totalEnergy));
      const finalPan = paths.reduce((acc, p) => acc + p.volume, 0) > 0 
          ? weightedPan / paths.reduce((acc, p) => acc + p.volume, 0) 
          : 0;

      const now = this.audioCtx.currentTime;
      voice.gain.gain.setTargetAtTime(finalVolume, now, 0.1);
      voice.panner.pan.setTargetAtTime(finalPan, now, 0.1);
      voice.filter.frequency.setTargetAtTime(minCutoff, now, 0.1);
  }

  public playSoundSpatial(name: string, x: number, y: number): void {
    if (this.isMuted || !this.audioCtx || !this.masterGain || !this.world) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    const paths = SoundRaycaster.calculateAudiblePaths(x, y, this.listenerX, this.listenerY, this.world);
    if (paths.length === 0) return;

    let totalEnergy = 0;
    let weightedPan = 0;
    let minCutoff = 20000;
    for (const p of paths) {
        totalEnergy += p.volume * p.volume;
        weightedPan += p.pan * p.volume;
        minCutoff = Math.min(minCutoff, p.filterCutoff);
    }
    const finalVolume = Math.min(1.0, Math.sqrt(totalEnergy));
    const totalVol = paths.reduce((acc, p) => acc + p.volume, 0);
    const finalPan = totalVol > 0 ? weightedPan / totalVol : 0;

    const buffer = this.sounds.get(name);
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = minCutoff;

    const panner = this.audioCtx.createStereoPanner();
    panner.pan.value = finalPan;

    const gain = this.audioCtx.createGain();
    gain.gain.value = finalVolume;

    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.masterGain);

    if (buffer) {
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(filter);
        source.start();
    } else {
        this.synthesizeSpatial(name, filter);
    }
  }

  private synthesizeSpatial(name: string, destination: AudioNode): void {
    if (!this.audioCtx) return;
    // Simplified version of synthesizeShoot that connects to destination
    const duration = 0.15;
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
    osc.connect(destination);
    osc.start();
    osc.stop(this.audioCtx.currentTime + duration);
  }

  public startLoopSpatial(name: string, x: number, y: number): void {
    if (this.isMuted || !this.audioCtx || !this.masterGain || this.spatialLoops.has(name)) return;
    
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    const panner = this.audioCtx.createStereoPanner();
    const gain = this.audioCtx.createGain();

    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.masterGain);

    const buffer = this.sounds.get(name);
    let source: AudioBufferSourceNode | OscillatorNode;

    if (buffer) {
        const bSource = this.audioCtx.createBufferSource();
        bSource.buffer = buffer;
        bSource.loop = true;
        source = bSource;
    } else {
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        source = osc;
    }

    source.connect(filter);
    source.start();

    const voice: SpatialVoice = { source, gain, panner, filter, x, y };
    this.spatialLoops.set(name, voice);
    this.updateVoiceSpatial(voice);
  }

  public updateLoopPosition(name: string, x: number, y: number): void {
      const voice = this.spatialLoops.get(name);
      if (voice) {
          voice.x = x;
          voice.y = y;
          // updateVoiceSpatial is called in updateListener, but we can call it here too for immediate update
          this.updateVoiceSpatial(voice);
      }
  }

  public stopLoopSpatial(name: string): void {
      const voice = this.spatialLoops.get(name);
      if (voice && this.audioCtx) {
          const now = this.audioCtx.currentTime;
          voice.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          voice.source.stop(now + 0.1);
          this.spatialLoops.delete(name);
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
          case 'weapon_reload': this.synthesizeReload(); break;
          case 'explosion_large': this.synthesizeExplosion(); break;
          case 'hit_cannon': this.synthesizeShoot(300, 0.1, 'triangle', 0.15); break;
          case 'hit_missile': this.synthesizeShoot(600, 0.1, 'sine', 0.1); break;
          case 'hit_laser': this.synthesizeShoot(2000, 0.04, 'sine', 0.05); break;
          case 'hit_ray': this.synthesizeShoot(150, 0.15, 'sawtooth', 0.1); break;
          case 'ui_click': this.synthesizeShoot(800, 0.05, 'square', 0.1); break;
          case 'collect_coin': this.synthesizePing(); break; // reuse
          default: this.synthesizeShoot(600, 0.1, 'sine', 0.1); break;
      }
    }
  }

  public startLoop(name: string): void {
      if (this.isMuted || !this.audioCtx || !this.masterGain || this.activeLoops.has(name)) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      if (name === 'shoot_ray') {
          this.startRayLoop();
          return;
      }

      const gain = this.audioCtx.createGain();
      gain.connect(this.masterGain);
      
      const buffer = this.sounds.get(name);
      if (buffer) {
          const source = this.audioCtx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(gain);
          source.start();
          this.activeLoops.set(name, { osc: source, gain, startTime: this.audioCtx.currentTime });
      } else {
          // Synthesis loop
          const osc = this.audioCtx.createOscillator();
          let freq = 440;
          let type: OscillatorType = 'sine';
          let vol = 0.05;

          if (name === 'shoot_laser') { freq = 1200; type = 'sine'; vol = 0.05; }
          else if (name === 'shoot_ray') { freq = 200; type = 'sawtooth'; vol = 0.08; } // Should not be reached now
          else if (name === 'hit_laser') { freq = 2000; type = 'sine'; vol = 0.03; }
          else if (name === 'hit_ray') { freq = 150; type = 'sawtooth'; vol = 0.05; }

          osc.type = type;
          osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
          // Add some modulation for hit sounds
          if (name.startsWith('hit_')) {
              osc.frequency.exponentialRampToValueAtTime(freq * 0.8, this.audioCtx.currentTime + 0.1);
          }

          gain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
          osc.connect(gain);
          osc.start();
          this.activeLoops.set(name, { osc, gain, startTime: this.audioCtx.currentTime });
      }
  }

  private startRayLoop(): void {
    if (!this.audioCtx || !this.masterGain) return;
    
    const buffer = this.sounds.get('shoot_ray');
    const gain = this.audioCtx.createGain();
    gain.connect(this.masterGain);

    if (buffer) {
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        // Logic: 0-4s then loop 2-4s
        // WebAudio doesn't support complex loop segments easily on a single source.
        // We will play the first part (0-4), then schedule the loop (2-4).
        source.connect(gain);
        source.start(0, 0, 4);
        
        this.activeLoops.set('shoot_ray', { osc: source, gain, startTime: this.audioCtx.currentTime });

        const scheduleLoop = () => {
            if (!this.activeLoops.has('shoot_ray') || this.activeLoops.get('shoot_ray')?.isEnding) return;
            const loopSource = this.audioCtx!.createBufferSource();
            loopSource.buffer = buffer;
            loopSource.loop = true;
            loopSource.loopStart = 2;
            loopSource.loopEnd = 4;
            loopSource.connect(gain);
            loopSource.start(0, 2);
            this.activeLoops.get('shoot_ray')!.osc = loopSource;
        };

        source.onended = scheduleLoop;
    } else {
        // Synthesis fallback for complex ray
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, this.audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(250, this.audioCtx.currentTime + 4);
        gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
        osc.connect(gain);
        osc.start();
        this.activeLoops.set('shoot_ray', { osc, gain, startTime: this.audioCtx.currentTime });
    }
  }

  public stopLoop(name: string, fadeTime: number = 0.05): void {
      const loop = this.activeLoops.get(name);
      if (loop && this.audioCtx) {
          if (name === 'shoot_ray' && !loop.isEnding) {
              this.stopRayLoop(loop);
              return;
          }
          const now = this.audioCtx.currentTime;
          loop.gain.gain.cancelScheduledValues(now);
          loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
          loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeTime);
          loop.osc.stop(now + fadeTime);
          this.activeLoops.delete(name);
      }
  }

  private stopRayLoop(loop: any): void {
    if (!this.audioCtx || !this.masterGain) return;
    const buffer = this.sounds.get('shoot_ray');
    
    // Stop current source
    loop.osc.stop();
    loop.isEnding = true;

    if (buffer) {
        const tail = this.audioCtx.createBufferSource();
        tail.buffer = buffer;
        tail.connect(loop.gain);
        // Play from 5th second till end
        tail.start(0, 5);
        tail.onended = () => {
            this.activeLoops.delete('shoot_ray');
        };
        loop.osc = tail;
    } else {
        // Synthesis tail
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(250, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, this.audioCtx.currentTime + 0.5);
        loop.gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.5);
        osc.connect(loop.gain);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.5);
        setTimeout(() => this.activeLoops.delete('shoot_ray'), 500);
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

  private synthesizeReload(): void {
      if (!this.audioCtx || !this.masterGain) return;
      const now = this.audioCtx.currentTime;
      // Three mechanical clicks
      [0, 0.1, 0.2].forEach((offset) => {
          const osc = this.audioCtx!.createOscillator();
          const gain = this.audioCtx!.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(200 + offset * 1000, now + offset);
          gain.gain.setValueAtTime(0.05, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.05);
          osc.connect(gain);
          gain.connect(this.masterGain!);
          osc.start(now + offset);
          osc.stop(now + offset + 0.05);
      });
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
