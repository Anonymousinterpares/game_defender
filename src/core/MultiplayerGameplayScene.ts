import { GameplayScene } from './GameplayScene';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { World } from './World';
import { HeatMap } from './HeatMap';
import { WeatherManager } from './WeatherManager';
import { WorldClock } from './WorldClock';
import { LightManager } from './LightManager';
import { FloorDecalManager } from './FloorDecalManager';
import { Entity } from './Entity';
import { Player } from '../entities/Player';
import { Projectile } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Drop } from '../entities/Drop';
import { ParticleSystem } from './ParticleSystem';
import { SoundManager } from './SoundManager';

export class MultiplayerGameplayScene extends GameplayScene {
  // remotePlayers is already defined here, but as a Map. 
  // We need to expose it as an array for CombatSystem or bridge it.
  // We'll rename the map to remotePlayersMap and expose remotePlayers getter/property.
  private remotePlayersMap: Map<string, RemotePlayer> = new Map();
  private scores: Map<string, number> = new Map();
  private networkTickRate: number = 0.05; // 20 times per second
  private networkTimer: number = 0;
  private envSyncTimer: number = 0;
  private lastActiveState: boolean = true;
  private respawnTimer: number = 0;
  public lastKilledBy: string | null = null;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    super(sceneManager, inputManager);
  }

  public get myId(): string {
      return MultiplayerManager.getInstance().myId;
  }

  private updateRemotePlayersArray(): void {
      this.remotePlayers.length = 0;
      this.remotePlayersMap.forEach(rp => this.remotePlayers.push(rp));
  }

  onEnter(): void {
    super.onEnter();
    
    const mm = MultiplayerManager.getInstance();
    
    // Listen for network messages
    mm.onMessage((msg, _conn) => {
      switch (msg.t) {
        case NetworkMessageType.PLAYER_STATE:
          this.handlePlayerState(msg.d);
          break;
        case NetworkMessageType.PROJECTILE:
          this.handleRemoteProjectile(msg.d);
          break;
        case NetworkMessageType.ENTITY_SPAWN:
          this.handleEntitySpawn(msg.d);
          break;
        case NetworkMessageType.ENTITY_DESTROY:
          this.handleEntityDestroy(msg.d);
          break;
        case NetworkMessageType.WORLD_UPDATE:
          this.handleWorldUpdate(msg.d);
          break;
        case NetworkMessageType.WORLD_SEED:
          this.handleWorldSeed(msg.d);
          break;
        case NetworkMessageType.PLAYER_DEATH:
          this.handleRemoteDeath(msg.d);
          break;
      }
    });

    // PVP SPAWNING LOGIC
    if (this.player && this.world) {
        if (mm.isHost) {
            // Host: Pick a seed and broadcast it
            const seed = Math.floor(Math.random() * 1000000);
            this.recreateWorld(seed);
            mm.broadcast(NetworkMessageType.WORLD_SEED, { seed });

            console.log('Host: Waiting for Client READY...');
            mm.onMessage((msg) => {
                if (msg.t === NetworkMessageType.CHAT && msg.d.system === 'READY') {
                    console.log('Host: Client is READY, sending spawn pos');
                    // Send seed again just in case
                    mm.broadcast(NetworkMessageType.WORLD_SEED, { seed });
                    
                    if (this.player) {
                        const p1Pos = { x: this.player.x, y: this.player.y };
                        const p2Pos = this.getSafePVPSpawn(p1Pos);
                        mm.broadcast(NetworkMessageType.CHAT, { system: 'SPAWN_POS', x: p2Pos.x, y: p2Pos.y });
                    }
                }
            });
        } else {
            // Client listens for its spawn pos
            mm.onMessage((msg) => {
                if (msg.t === NetworkMessageType.CHAT && msg.d.system === 'SPAWN_POS') {
                    console.log('Client: Received spawn pos from Host');
                    if (this.player) {
                        this.player.x = msg.d.x;
                        this.player.y = msg.d.y;
                        this.player.prevX = msg.d.x;
                        this.player.prevY = msg.d.y;
                    }
                }
            });
            // Tell host we are ready to receive seed/spawn
            mm.broadcast(NetworkMessageType.CHAT, { system: 'READY' });
        }
    }
  }

  private handleLocalDeath(): void {
      console.log('Local player DIED!');
      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_DEATH, { 
          id: this.myId,
          killerId: this.lastKilledBy
      });
      this.lastKilledBy = null;
      SoundManager.getInstance().playSound('explosion_large');
  }

  private handleRemoteDeath(data: any): void {
      const killerId = data.killerId;
      const victimId = data.id;

      if (killerId) {
          const current = this.scores.get(killerId) || 0;
          this.scores.set(killerId, current + 1);
          console.log(`Player ${killerId} killed ${victimId}. New score: ${current + 1}`);
      }

      const rp = this.remotePlayersMap.get(victimId);
      if (rp) {
          rp.active = false;
          // Visual explosion at their last pos
          this.combatSystem.createExplosion(rp.x, rp.y, 60, 0);
      }
  }

  private respawnPlayer(): void {
      if (!this.player) return;
      const pos = this.getSafePVPSpawn({ x: 0, y: 0 }); // Just find a valid spot
      this.player.x = pos.x;
      this.player.y = pos.y;
      this.player.prevX = pos.x;
      this.player.prevY = pos.y;
      this.player.health = this.player.maxHealth;
      this.player.active = true;
      this.player.isOnFire = false;
      console.log('Local player RESPAWNED');
  }

  private handleWorldSeed(data: any): void {
      if (!MultiplayerManager.getInstance().isHost) {
          console.log(`Client: Syncing World Seed: ${data.seed}`);
          this.recreateWorld(data.seed);
      }
  }

  private recreateWorld(seed: number): void {
      this.world = new World(seed);
      this.heatMap = new HeatMap(32); 
      if (this.world) {
          this.world.setHeatMap(this.heatMap);
          this.physics.setWorld(this.world);
          SoundManager.getInstance().setWorld(this.world);
          ParticleSystem.getInstance().initWorker(this.world);
      }
  }

  private getSafePVPSpawn(p1Pos: {x: number, y: number}): {x: number, y: number} {
      const minTilesDist = 20;
      const tileSize = 32;
      const minDist = minTilesDist * tileSize;
      
      for (let i = 0; i < 50; i++) {
          const pos = this.getRandomValidPos();
          const dx = pos.x - p1Pos.x;
          const dy = pos.y - p1Pos.y;
          if (Math.sqrt(dx*dx + dy*dy) >= minDist) {
              return pos;
          }
      }
      return { x: 100, y: 100 }; // Fallback
  }

  onExit(): void {
    super.onExit();
    this.remotePlayersMap.clear();
  }

  update(dt: number): void {
    const mm = MultiplayerManager.getInstance();

    // 1. Update Core Gameplay (with custom logic for client/host)
    this.updateMultiplayerCore(dt);

    // 2. Update remote players (visual only)
    this.remotePlayersMap.forEach(rp => rp.update(dt));

    // 3. Network Sync
    this.networkTimer += dt;
    if (this.networkTimer >= this.networkTickRate) {
      this.sendLocalState();
      if (mm.isHost) {
          this.sendWorldSync();

          this.envSyncTimer += this.networkTimer;
          if (this.envSyncTimer >= 1.0) {
              this.sendEnvironmentSync();
              this.envSyncTimer = 0;
          }
      }
      this.networkTimer = 0;
    }
  }

  private sendEnvironmentSync(): void {
      const time = WorldClock.getInstance().getTimeState();
      const weather = WeatherManager.getInstance().getWeatherState();
      MultiplayerManager.getInstance().broadcast(NetworkMessageType.WORLD_UPDATE, { 
          env: {
              t: time.totalSeconds,
              w: weather.type
          }
      });
  }

  private updateMultiplayerCore(dt: number): void {
    // This is a partial copy of GameplayScene.update but adapted for network
    const mm = MultiplayerManager.getInstance();

    this.benchmark.update(dt);
    WorldClock.getInstance().update(dt);
    LightManager.getInstance().update(dt);
    FloorDecalManager.getInstance().update(dt);
    
    this.hud.update(dt);

    if (this.hud.isDockOpen) return;

    this.weaponSystem.update(dt, this.inputManager);
    this.combatSystem.update(dt);

    this.physics.update(dt);
    Entity.setInterpolationAlpha(this.physics.alpha);

    // Only host spawns drops and enemies
    if (mm.isHost) {
        this.updateHostSpawning(dt);
    }

    // Update local entities
    this.entities.forEach(e => {
        if (e instanceof Player) {
            e.update(dt, this.enemies, (x: number, y: number, angle: number) => {
                // LOCAL SPAWN
                const p = new Projectile(x, y, angle);
                p.shooterId = this.myId;
                this.projectiles.push(p);
                // NETWORK BROADCAST
                mm.broadcast(NetworkMessageType.PROJECTILE, { 
                    x, y, a: angle, type: p.type, 
                    sid: this.myId 
                });
            });
        }
        else e.update(dt);
    });

    // Clients don't process enemy AI/Physics, they just follow Host data
    if (mm.isHost) {
        this.enemies.forEach(e => e.update(dt, this.player || undefined));
    }

    this.projectiles = this.projectiles.filter(p => { p.update(dt); return p.active; });
    ParticleSystem.getInstance().update(dt, this.world!, this.player!, this.enemies);

    if (mm.isHost) {
        this.enemies = this.enemies.filter(e => { 
            if(!e.active) {
                this.physics.removeBody(e);
                mm.broadcast(NetworkMessageType.ENTITY_DESTROY, { type: 'enemy', id: e.id });
            }
            return e.active; 
        });
    }

    // Camera and other visual logic...
    if (this.player) {
        this.cameraX = this.player.interpolatedX - window.innerWidth / 2;
        this.cameraY = this.player.interpolatedY - window.innerHeight / 2;
        SoundManager.getInstance().updateListener(this.player.interpolatedX, this.player.interpolatedY);
    }

    this.spatialGrid.clear();
    if (this.player) this.spatialGrid.insert(this.player);
    this.remotePlayersMap.forEach(rp => this.spatialGrid.insert(rp));
    this.enemies.forEach(e => this.spatialGrid.insert(e));
    this.projectiles.forEach(p => this.spatialGrid.insert(p));

    this.heatMap?.update(dt);

    // Death & Respawn Logic
    if (this.player) {
        if (this.lastActiveState && !this.player.active) {
            this.handleLocalDeath();
        }
        this.lastActiveState = this.player.active;

        if (!this.player.active) {
            this.respawnTimer += dt;
            if (this.respawnTimer >= 3.0) {
                this.respawnPlayer();
                this.respawnTimer = 0;
            }
        }
    }
  }

  protected getRadarEntities(): Entity[] {
      return [this.player!, ...this.remotePlayersMap.values(), ...this.enemies, ...this.projectiles];
  }

  private updateHostSpawning(_dt: number): void {
      // Logic moved from GameplayScene
      // (Simplified for this phase)
  }

  private sendWorldSync(): void {
      // Host sends enemy positions to all clients
      const enemyData = this.enemies.map(e => ({
          id: e.id,
          x: Math.round(e.x),
          y: Math.round(e.y),
          r: Math.round(e.rotation * 100) / 100,
          h: Math.round(e.health)
      }));

      const dropData = this.drops.map(d => ({
          id: d.id,
          x: Math.round(d.x),
          y: Math.round(d.y),
          t: d.type
      }));

      MultiplayerManager.getInstance().broadcast(NetworkMessageType.ENTITY_SPAWN, { 
          enemies: enemyData,
          drops: dropData
      });
  }

  private handleRemoteProjectile(data: any): void {
      const p = new Projectile(data.x, data.y, data.a);
      if (data.type) p.type = data.type; 
      if (data.sid) p.shooterId = data.sid;
      
      this.projectiles.push(p);

      // Play sound
      SoundManager.getInstance().playSoundSpatial('shoot_' + p.type, p.x, p.y);
  }

  private handleEntitySpawn(data: any): void {
      if (data.enemies) {
          data.enemies.forEach((ed: any) => {
              let enemy = this.enemies.find(e => e.id === ed.id);
              if (!enemy) {
                  enemy = new Enemy(ed.x, ed.y);
                  enemy.id = ed.id;
                  this.enemies.push(enemy);
              }
              if (enemy) {
                  enemy.prevX = enemy.x;
                  enemy.prevY = enemy.y;
                  enemy.x = ed.x;
                  enemy.y = ed.y;
                  enemy.rotation = ed.r;
                  enemy.health = ed.h;
              }
          });
      }

      if (data.drops) {
          data.drops.forEach((dd: any) => {
              let existingDrop = this.drops.find(d => d.id === dd.id);
              if (!existingDrop) {
                  const newDrop = new Drop(dd.x, dd.y, dd.t);
                  newDrop.id = dd.id;
                  this.drops.push(newDrop);
              }
          });
      }
  }

  private handleEntityDestroy(data: any): void {
      if (data.type === 'drop') {
          const drop = this.drops.find(d => d.id === data.id);
          if (drop) drop.active = false;
      } else if (data.type === 'enemy') {
          const enemy = this.enemies.find(e => e.id === data.id);
          if (enemy) enemy.active = false;
      }
  }

  private handleWorldUpdate(data: any): void {
      if (data.env) {
          (WorldClock.getInstance() as any).gameSeconds = data.env.t;
          if (data.env.w !== undefined) {
              WeatherManager.getInstance().setWeather(data.env.w);
          }
          return;
      }

      if (this.world && this.heatMap) {
          // data: { tx, ty, m }
          (this.world as any).tiles[data.ty][data.tx] = data.m;
          this.world.invalidateTileCache(data.tx, data.ty);
          this.world.markMeshDirty();
      }
  }

  private sendLocalState(): void {
      if (!this.player) return;

      const state = {
        id: MultiplayerManager.getInstance().myId,
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        r: this.rotationToNetwork(this.player.rotation),
        n: MultiplayerManager.getInstance().myName,
        h: Math.round(this.player.health)
      };

      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_STATE, state);
  }

  private handlePlayerState(data: any): void {
    const { id, x, y, r, n, h } = data;
    if (id === MultiplayerManager.getInstance().myId) return;

    let rp = this.remotePlayersMap.get(id);
    if (!rp) {
      rp = new RemotePlayer(id, x, y);
      this.remotePlayersMap.set(id, rp);
      this.updateRemotePlayersArray();
    }

    rp.updateFromNetwork(x, y, this.rotationFromNetwork(r), n, h);
  }

  private rotationToNetwork(rad: number): number { return Math.round(rad * 1000); }
  private rotationFromNetwork(net: number): number { return net / 1000; }
}
