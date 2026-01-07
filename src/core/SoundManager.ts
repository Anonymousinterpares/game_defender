/// <reference types="vite/client" />
import { World } from './World';
import { SoundRaycaster, AudiblePath } from '../utils/SoundRaycaster';
import { ConfigManager } from '../config/MasterConfig';
import { EventBus, GameEvent } from './EventBus';
import { AssetRegistry } from './AssetRegistry';

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

  public async init(): Promise<void> {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioCtx.createGain();
      
      const configVol = ConfigManager.getInstance().get<number>('Audio', 'masterVolume');
      this.volume = configVol;

      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);
      
      this.subscribeToEvents();
      await this.loadFromRegistry();
    }
  }

  private async loadFromRegistry(): Promise<void> {
    const registry = AssetRegistry.getInstance();
    const soundIds = [
        'brick_hit_1', 'brick_hit_2', 'brick_hit_3', 'collect_coin', 'explosion_large', 'fire',
        'hit_cannon', 'hit_laser', 'hit_missile', 'hit_ray', 'indestructible_hit_1',
        'metal_hit_1', 'metal_hit_2', 'metal_hit_3', 'metal_hit_4', 'metal_hit_5', 'metal_hit_6',
        'ping', 'place_mine', 'shoot_cannon', 'shoot_laser', 'shoot_missile', 'shoot_ray', 'shoot_rocket',
        'stone_hit_1', 'ui_click', 'weapon_reload', 'wood_hit_1', 'wood_hit_2', 'wood_hit_3'
    ];

    const promises = soundIds.map(async (id) => {
        try {
            const arrayBuffer = registry.getAudioData(id);
            const audioBuffer = await this.audioCtx!.decodeAudioData(arrayBuffer);
            this.sounds.set(id, audioBuffer);

            if (id.includes('_hit_')) {
                const category = id.split('_hit_')[0];
                if (!this.materialVariants.has(category)) this.materialVariants.set(category, []);
                this.materialVariants.get(category)!.push(id);
            }
        } catch (e) {
            console.warn(`[SoundManager] Failed to decode ${id}:`, e);
        }
    });

    await Promise.all(promises);
    console.log(`[SoundManager] Decoded ${this.sounds.size} sounds from registry`);
  }

  private subscribeToEvents(): void {
    const eb = EventBus.getInstance();

    eb.on(GameEvent.WEAPON_FIRED, (data) => {
        this.playSoundSpatial('shoot_' + data.weaponType, data.x, data.y);
    });

    eb.on(GameEvent.WEAPON_RELOAD, (data) => {
        this.playSoundSpatial('weapon_reload', data.x, data.y);
    });

    eb.on(GameEvent.PROJECTILE_HIT, (data) => {
        const sfx = data.projectileType === 'missile' ? 'hit_missile' : 'hit_cannon';
        this.playSoundSpatial(sfx, data.x, data.y);
    });

    eb.on(GameEvent.EXPLOSION, (data) => {
        this.playSoundSpatial('explosion_large', data.x, data.y);
    });

    eb.on(GameEvent.MATERIAL_HIT, (data) => {
        this.playMaterialHit(data.material, data.x, data.y);
    });

    eb.on(GameEvent.ITEM_COLLECTED, () => {
        this.playSound('collect_coin');
    });

    eb.on(GameEvent.UI_CLICK, () => {
        this.playSound('ui_click');
    });

    eb.on(GameEvent.SOUND_PLAY, (data) => {
        this.playSound(data.soundId);
    });

    eb.on(GameEvent.SOUND_PLAY_SPATIAL, (data) => {
        this.playSoundSpatial(data.soundId, data.x, data.y, data.volume);
    });

    eb.on(GameEvent.SOUND_LOOP_START, (data) => {
        this.startLoopSpatial(data.soundId, data.x, data.y);
    });

    eb.on(GameEvent.SOUND_LOOP_STOP, (data) => {
        this.stopLoopSpatial(data.soundId);
    });

    eb.on(GameEvent.SOUND_LOOP_MOVE, (data) => {
        this.updateLoopPosition(data.soundId, data.x, data.y);
    });
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
            voice.x = data.x;
            voice.y = data.y;
            voice.intensity = data.intensity;
            voice.lastSeen = now;
        }
    });

    this.activeAreaLoops.forEach((voice, key) => {
        const timeSinceSeen = now - (voice.lastSeen || 0);

        if (timeSinceSeen > ttl) {
            voice.gain.gain.setTargetAtTime(0, now, 0.1);
            if (timeSinceSeen > ttl + 0.5) {
                voice.source.stop();
                this.activeAreaLoops.delete(key);
            }
        } else {
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
    const gx = Math.floor(x / this.CLUSTER_GRID_SIZE);
    const gy = Math.floor(y / this.CLUSTER_GRID_SIZE);
    const key = `${name}_${gx}_${gy}`;

    const existing = this.soundQueue.get(key);
    if (existing) {
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
          const boost = 1 + Math.log10(q.count);
          this.playSoundSpatial(q.name, q.x, q.y, boost);
      });
      this.soundQueue.clear();
  }

  public playMaterialHit(material: string, x: number, y: number): void {
    const matLower = material.toLowerCase();
    const available = this.materialVariants.get(matLower);
    
    if (available && available.length > 0) {
        const name = available[Math.floor(Math.random() * available.length)];
        this.queueSoundSpatial(name, x, y);
    }
  }

  public updateListener(x: number, y: number): void {
      this.listenerX = x;
      this.listenerY = y;
      
      this.processQueue(); 
      this.processAreaSounds(); 

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

    let baseVol = ConfigManager.getInstance().get<number>('Audio', 'vol_' + name);
    
    if (baseVol === undefined) {
        if (name.includes('_hit_')) {
            baseVol = ConfigManager.getInstance().get<number>('Audio', 'vol_hit_material');
        }
    }
    
    if (baseVol === undefined) baseVol = 1.0;

    const finalVolume = Math.min(2.0, pathVol * baseVol * volumeScale);

    const buffer = this.sounds.get(name);
    if (!buffer) {
        this.synthesizeSpatialFallback(name, x, y, finalVolume, finalPan, minCutoff);
        return;
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

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(filter);
    source.start();
  }

  private synthesizeSpatialFallback(name: string, x: number, y: number, volume: number, pan: number, cutoff: number): void {
    if (!this.audioCtx || !this.masterGain) return;
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const panner = this.audioCtx.createStereoPanner();
    panner.pan.value = pan;
    const gain = this.audioCtx.createGain();
    gain.gain.value = volume;
    filter.connect(panner); panner.connect(gain); gain.connect(this.masterGain);
    
    const duration = 0.15;
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
    osc.connect(filter);
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
    gain.connect(this.masterGain!);

    const buffer = this.sounds.get(name);
    let source: AudioBufferSourceNode | OscillatorNode;

    if (buffer) {
        const bSource = this.audioCtx!.createBufferSource();
        bSource.buffer = buffer;
        bSource.loop = true;
        source = bSource;
    } else {
        const osc = this.audioCtx!.createOscillator();
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

  public playSound(name: string): void {
    if (this.isMuted || !this.audioCtx || !this.masterGain) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    const buffer = this.sounds.get(name);
    if (buffer) {
      let baseVol = ConfigManager.getInstance().get<number>('Audio', 'vol_' + name);
      if (baseVol === undefined) baseVol = 1.0;
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      const gain = this.audioCtx.createGain();
      gain.gain.value = baseVol;
      source.connect(gain);
      gain.connect(this.masterGain);
      source.start();
    } else {
      // Fallback synthesis
      this.synthesizeFallback(name);
    }
  }

  private synthesizeFallback(name: string): void {
      if (!this.audioCtx || !this.masterGain) return;
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
          case 'collect_coin': this.synthesizePing(); break;
          default: this.synthesizeShoot(600, 0.1, 'sine', 0.1); break;
      }
  }

  public startLoop(name: string): void {
      if (this.isMuted || !this.audioCtx || !this.masterGain || this.activeLoops.has(name)) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

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
      }
  }

  public stopLoop(name: string, fadeTime: number = 0.05): void {
      const loop = this.activeLoops.get(name);
      if (loop && this.audioCtx) {
          const now = this.audioCtx.currentTime;
          loop.gain.gain.cancelScheduledValues(now);
          loop.gain.gain.setValueAtTime(loop.gain.gain.value, now);
          loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeTime);
          loop.osc.stop(now + fadeTime);
          this.activeLoops.delete(name);
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