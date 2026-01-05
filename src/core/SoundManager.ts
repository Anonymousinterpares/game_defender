/// <reference types="vite/client" />
import { World } from './World';
import { SoundRaycaster, AudiblePath } from '../utils/SoundRaycaster';
import { ConfigManager } from '../config/MasterConfig';

interface SpatialVoice {
    source: AudioBufferSourceNode | OscillatorNode;
    gain: GainNode;
    panner: StereoPannerNode;
    filter: BiquadFilterNode;
    x: number;
    y: number;
    baseVolume: number; // Store base volume from config
    lastSeen?: number; // Persistence for area sounds
    intensity?: number; // Current intensity for area sounds
}

interface QueuedSound {
    name: string;
    x: number;
    y: number;
    count: number;
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

  // Track available variants per material category
  private materialVariants: Map<string, string[]> = new Map();

  // Sound Accumulator
  private soundQueue: Map<string, QueuedSound> = new Map();
  private readonly CLUSTER_GRID_SIZE = 64;

  // Area Sound Management (for persistent effects like fire)
  private areaSoundQueue: Map<string, { x: number, y: number, intensity: number }> = new Map();
  private activeAreaLoops: Map<string, SpatialVoice> = new Map();

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
      
      const configVol = ConfigManager.getInstance().get<number>('Audio', 'masterVolume');
      this.volume = configVol;

      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);
    }
  }

  public setWorld(world: World): void {
      this.world = world;
  }

  public updateAreaSound(name: string, x: number, y: number, intensity: number): void {
    const clusterSize = ConfigManager.getInstance().get<number>('Fire', 'soundClusterSize') || 128;
    const gx = Math.floor(x / clusterSize);
    const gy = Math.floor(y / clusterSize);
    const key = `${name}_${gx}_${gy}`;

    const existing = this.areaSoundQueue.get(key);
    if (existing) {
        // Weighted centroid position
        const totalIntensity = existing.intensity + intensity;
        existing.x = (existing.x * existing.intensity + x * intensity) / totalIntensity;
        existing.y = (existing.y * existing.intensity + y * intensity) / totalIntensity;
        existing.intensity = totalIntensity;
    } else {
        this.areaSoundQueue.set(key, { x, y, intensity });
    }
  }

  private processAreaSounds(): void {
    if (!this.audioCtx || !this.masterGain || !this.world) return;

    const now = this.audioCtx.currentTime;
    const clusterVolScale = ConfigManager.getInstance().get<number>('Fire', 'volumePerSubTile') || 0.005;
    const maxClusterVol = ConfigManager.getInstance().get<number>('Fire', 'maxClusterVolume') || 0.8;
    const ttl = ConfigManager.getInstance().get<number>('Fire', 'soundTTL') || 0.2;

    // 1. Update active loops from the queue (new data available)
    this.areaSoundQueue.forEach((data, key) => {
        const soundName = key.split('_')[0];
        let voice = this.activeAreaLoops.get(key);

        if (!voice) {
            const filter = this.audioCtx!.createBiquadFilter();
            filter.type = 'lowpass';
            const panner = this.audioCtx!.createStereoPanner();
            const gain = this.audioCtx!.createGain();
            gain.gain.value = 0;

            filter.connect(panner);
            panner.connect(gain);
            gain.connect(this.masterGain!);

            const buffer = this.sounds.get(soundName);
            let source: AudioBufferSourceNode | OscillatorNode;

            if (buffer) {
                const bSource = this.audioCtx!.createBufferSource();
                bSource.buffer = buffer;
                bSource.loop = true;
                source = bSource;
            } else {
                const osc = this.audioCtx!.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = 200;
                source = osc;
            }

            source.connect(filter);
            source.start();

            const baseVolume = ConfigManager.getInstance().get<number>('Audio', 'vol_' + soundName) || 1.0;
            voice = { source, gain, panner, filter, x: data.x, y: data.y, baseVolume, lastSeen: now, intensity: data.intensity };
            this.activeAreaLoops.set(key, voice);
        } else {
            // New simulation update received
            voice.x = data.x;
            voice.y = data.y;
            voice.intensity = data.intensity;
            voice.lastSeen = now;
        }
    });

    // 2. Process all active loops (even if queue was empty this frame)
    this.activeAreaLoops.forEach((voice, key) => {
        const timeSinceSeen = now - (voice.lastSeen || 0);

        if (timeSinceSeen > ttl) {
            // It's been too long without an update - fire is probably out
            voice.gain.gain.setTargetAtTime(0, now, 0.1);
            if (timeSinceSeen > ttl + 0.5) {
                voice.source.stop();
                this.activeAreaLoops.delete(key);
            }
        } else {
            // Loop is still active (either updated this frame or within TTL window)
            const paths = SoundRaycaster.calculateAudiblePaths(voice.x, voice.y, this.listenerX, this.listenerY, this.world!);
            
            if (paths.length === 0) {
                voice.gain.gain.setTargetAtTime(0, now, 0.1);
            } else {
                let totalEnergy = 0;
                let weightedPan = 0;
                let minCutoff = 20000;
                for (const p of paths) {
                    totalEnergy += p.volume * p.volume;
                    weightedPan += p.pan * p.volume;
                    minCutoff = Math.min(minCutoff, p.filterCutoff);
                }

                const spatialVol = Math.sqrt(totalEnergy);
                const intensityVol = Math.min(maxClusterVol, (voice.intensity || 0) * clusterVolScale);
                const finalVol = spatialVol * intensityVol;

                const totalPathVol = paths.reduce((acc, p) => acc + p.volume, 0);
                const finalPan = totalPathVol > 0 ? weightedPan / totalPathVol : 0;

                voice.gain.gain.setTargetAtTime(finalVol, now, 0.1);
                voice.panner.pan.setTargetAtTime(finalPan, now, 0.1);
                voice.filter.frequency.setTargetAtTime(minCutoff, now, 0.1);
            }
        }
    });

    this.areaSoundQueue.clear();
  }

  public queueSoundSpatial(name: string, x: number, y: number): void {
    // Clustering Logic: Group by Sound Name + Grid Cell
    const gx = Math.floor(x / this.CLUSTER_GRID_SIZE);
    const gy = Math.floor(y / this.CLUSTER_GRID_SIZE);
    const key = `${name}_${gx}_${gy}`;

    const existing = this.soundQueue.get(key);
    if (existing) {
        // Centroid calculation: average positions
        const n = existing.count;
        existing.x = (existing.x * n + x) / (n + 1);
        existing.y = (existing.y * n + y) / (n + 1);
        existing.count++;
    } else {
        this.soundQueue.set(key, { name, x, y, count: 1 });
    }
  }

  public processQueue(): void {
      if (this.soundQueue.size === 0) return;

      this.soundQueue.forEach((q) => {
          // Calculate volume boost based on count
          const boost = 1 + Math.log10(q.count);
          this.playSoundSpatial(q.name, q.x, q.y, boost);
      });
      this.soundQueue.clear();
  }

  public playMaterialHit(material: string, x: number, y: number): void {
    const matLower = material.toLowerCase();
    const available = this.materialVariants.get(matLower);
    
    if (available && available.length > 0) {
        // Pick randomly from only what was actually loaded
        const name = available[Math.floor(Math.random() * available.length)];
        this.queueSoundSpatial(name, x, y);
    }
  }

  public updateListener(x: number, y: number): void {
      this.listenerX = x;
      this.listenerY = y;
      
      this.processQueue(); 
      this.processAreaSounds(); // Process looping area effects (like fire)

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

      const finalVolume = Math.min(1.0, Math.sqrt(totalEnergy) * voice.baseVolume);
      const finalPan = paths.reduce((acc, p) => acc + p.volume, 0) > 0 
          ? weightedPan / paths.reduce((acc, p) => acc + p.volume, 0) 
          : 0;

      const now = this.audioCtx.currentTime;
      voice.gain.gain.setTargetAtTime(finalVolume, now, 0.1);
      voice.panner.pan.setTargetAtTime(finalPan, now, 0.1);
      voice.filter.frequency.setTargetAtTime(minCutoff, now, 0.1);
  }

  public playSoundSpatial(name: string, x: number, y: number, volumeScale: number = 1.0): void {
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

    const pathVol = Math.sqrt(totalEnergy);
    const totalVol = paths.reduce((acc, p) => acc + p.volume, 0);
    const finalPan = totalVol > 0 ? weightedPan / totalVol : 0;

    // Load base volume from config
    let baseVol = ConfigManager.getInstance().get<number>('Audio', 'vol_' + name);
    
    // Fallback for material hits (e.g., wood_hit_1 -> vol_hit_material)
    if (baseVol === undefined) {
        if (name.includes('_hit_')) {
            baseVol = ConfigManager.getInstance().get<number>('Audio', 'vol_hit_material');
        }
    }
    
    if (baseVol === undefined) baseVol = 1.0;

    const finalVolume = Math.min(2.0, pathVol * baseVol * volumeScale);

    if (ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
        console.log(`[Audio 3D] Playing ${name} at (${Math.round(x)},${Math.round(y)}) | Dist: ${Math.round(paths[0].distance)} | Vol: ${finalVolume.toFixed(2)} | Cutoff: ${minCutoff}`);
    }

    const buffer = this.sounds.get(name);
    if (!buffer) {
        console.warn(`Sound buffer not found: ${name}. Falling back to synthesis.`);
    }

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

    let baseVolume = ConfigManager.getInstance().get<number>('Audio', 'vol_' + name);
    if (baseVolume === undefined) baseVolume = 1.0;

    const voice: SpatialVoice = { source, gain, panner, filter, x, y, baseVolume };
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

  public async loadSound(name: string, url: string): Promise<boolean> {
    if (!this.audioCtx) this.init();
    
    const tryLoad = async (u: string): Promise<AudioBuffer> => {
        const response = await fetch(u);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (response.headers.get('content-type')?.includes('text/html')) throw new Error('Received HTML instead of Audio');
        const arrayBuffer = await response.arrayBuffer();
        return await this.audioCtx!.decodeAudioData(arrayBuffer);
    };

    try {
      const buffer = await tryLoad(url);
      this.sounds.set(name, buffer);
      
      // Track material variants
      if (name.includes('_hit_')) {
          const category = name.split('_hit_')[0];
          if (!this.materialVariants.has(category)) this.materialVariants.set(category, []);
          if (!this.materialVariants.get(category)!.includes(name)) this.materialVariants.get(category)!.push(name);
      }
      return true;
    } catch (e) {
      // Retry with simple relative path if we used a base-prefixed one
      // This catches cases where BASE_URL might be interfering with local dev resolving
      if (url.startsWith('/') || url.startsWith('http')) {
         try {
             const relativeUrl = 'assets/sounds/' + url.split('assets/sounds/')[1];
             console.log(`Retrying ${name} with relative path: ${relativeUrl}`);
             const buffer = await tryLoad(relativeUrl);
             this.sounds.set(name, buffer);
             return true;
         } catch (e2) {
             // Second attempt failed
         }
      }

      // Do not log warning for material hit probing (expected to fail eventually)
      if (!name.includes('_hit_')) {
          console.error(`Failed to load sound ${name} from ${url}. Error:`, e);
      }
      return false;
    }
  }

  /**
   * Automatically discovers and loads material hit variants by probing 
   * until a file is not found.
   */
  public async discoverMaterialVariants(materials: string[]): Promise<void> {
      for (const mat of materials) {
          let i = 1;
          let found = true;
          while (found && i < 20) { // Safety cap of 20 variants
              const name = `${mat}_hit_${i}`;
              const url = `${import.meta.env.BASE_URL}assets/sounds/${name}.wav`;
              found = await this.loadSound(name, url);
              if (found) {
                  i++;
              }
          }
          console.log(`Discovered ${i-1} variants for material: ${mat}`);
      }
  }

  public playSound(name: string): void {
    if (this.isMuted || !this.audioCtx || !this.masterGain) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const shouldLog = ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs');

    const buffer = this.sounds.get(name);
    if (buffer) {
      // FIX: Use individual volume config for 2D sounds too
      let baseVol = ConfigManager.getInstance().get<number>('Audio', 'vol_' + name);
      if (baseVol === undefined) baseVol = 1.0;

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      
      const gain = this.audioCtx.createGain();
      gain.gain.value = baseVol;
      
      source.connect(gain);
      gain.connect(this.masterGain);
      source.start();

      if (shouldLog) console.log(`[Audio 2D] Playing ${name} | Vol: ${baseVol}`);
    } else {
      if (shouldLog) console.log(`[Audio 2D] Synthesizing ${name}`);
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
