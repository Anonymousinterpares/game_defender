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
import { Projectile, ProjectileType } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Drop } from '../entities/Drop';
import { ParticleSystem } from './ParticleSystem';
import { SoundManager } from './SoundManager';
import { Quadtree } from '../utils/Quadtree';
import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from './HeatMap';

export class MultiplayerGameplayScene extends GameplayScene {
  // remotePlayers is already defined here, but as a Map. 
  // We need to expose it as an array for CombatSystem or bridge it.
  // We'll rename the map to remotePlayersMap and expose remotePlayers getter/property.
  private remotePlayersMap: Map<string, RemotePlayer> = new Map();
  private scores: Map<string, number> = new Map();
  private networkTickRate: number = 0.033; // ~30 times per second
  private networkTimer: number = 0;
  private envSyncTimer: number = 0;
  private lastActiveState: boolean = true;
  private respawnTimer: number = 0;
  public lastKilledBy: string | null = null;
  private isSpawned: boolean = false;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    super(sceneManager, inputManager);
  }

  public get myId(): string {
      return MultiplayerManager.getInstance().myId;
  }

  private updateRemotePlayersArray(): void {
      this.remotePlayers.length = 0;
      this.remotePlayersMap.forEach(rp => {
          if (rp.active) this.remotePlayers.push(rp);
      });
  }

  onEnter(): void {
    super.onEnter();
    
    const mm = MultiplayerManager.getInstance();
    mm.clearMessageCallbacks();
    
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
        case NetworkMessageType.PLAYER_HIT:
          this.handlePlayerHit(msg.d);
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
                        this.isSpawned = true;
                    }
                }
            });
            // Tell host we are ready to receive seed/spawn
            mm.broadcast(NetworkMessageType.CHAT, { system: 'READY' });
        }
    }

    if (mm.isHost) this.isSpawned = true;
  }

  private handlePlayerHit(data: any): void {
      const { id, damage, killerId } = data;
      
      if (id === this.myId && this.player) {
          this.player.takeDamage(damage);
          if (this.player.health <= 0) {
              this.lastKilledBy = killerId;
          }
      } else {
          const rp = this.remotePlayersMap.get(id);
          if (rp) {
              rp.takeDamage(damage);
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
          
          // Reset rendering systems for the new world
          this.lightingRenderer.clearCache();
          this.spatialGrid = new Quadtree<Entity>({ 
              x: 0, 
              y: 0, 
              w: this.world.getWidthPixels(), 
              h: this.world.getHeightPixels() 
          });
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
    if (!this.isSpawned) return;
    
    const mm = MultiplayerManager.getInstance();

    // 1. Update Core Gameplay (with custom logic for client/host)
    this.updateMultiplayerCore(dt);

    // 2. Update remote players (visual only)
    this.remotePlayersMap.forEach(rp => {
        rp.update(dt);
        if (!rp.active) {
            // Force active if we are receiving updates
             if (this.networkTimer > 0) rp.active = true;
        }
    });

    // Debug Log for Visibility
    if (this.remotePlayers.length > 0 && Math.random() < 0.01) {
        const rp = this.remotePlayers[0];
        console.log(`[VIS] RP ${rp.id} | Pos: ${Math.round(rp.x)},${Math.round(rp.y)} | Active: ${rp.active} | InGrid: ?`);
    }
    
    // 3. Radar update
    if (this.radar && this.player) this.radar.update(dt);

    // 4. Network Sync
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

    for (const [key, weaponName] of Object.entries(this.weaponSlots)) {
        if (this.inputManager.isKeyJustPressed(key)) {
            if (this.unlockedWeapons.has(weaponName)) {
                ConfigManager.getInstance().set('Player', 'activeWeapon', weaponName);
                SoundManager.getInstance().playSound('ui_click');
            }
        }
    }

    this.updateRemotePlayersArray();
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
                // Add weapon type to the projectile
                const activeWeapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon') as ProjectileType;
                p.type = activeWeapon;
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

    this.projectiles = this.projectiles.filter(p => { 
        const active = p.update(dt); 
        
        if (p.active && this.world && this.heatMap) {
            const mapW = this.world.getWidthPixels();
            const mapH = this.world.getHeightPixels();
            const hitPoint = this.world.checkWallCollision(p.x, p.y, p.radius);
            const hitBorder = p.x < 0 || p.x > mapW || p.y < 0 || p.y > mapH;

            if (hitPoint || hitBorder) {
                // LOCAL VISUALS (Always play for local satisfaction)
                if (p.aoeRadius > 0) {
                    this.combatSystem.createExplosion(p.x, p.y, p.aoeRadius, p.damage);
                } else if (hitPoint) {
                    const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                    SoundManager.getInstance().playSoundSpatial(sfx, hitPoint.x, hitPoint.y);
                    this.combatSystem.createImpactParticles(hitPoint.x, hitPoint.y, p.color);
                }

                if (mm.isHost && hitPoint) {
                    const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                    const tx = Math.floor(hitPoint.x / tileSize);
                    const ty = Math.floor(hitPoint.y / tileSize);
                    
                    // HOST EFFECT (Actually modifies the map)
                    p.onWorldHit(this.heatMap, hitPoint.x, hitPoint.y);
                    
                    // BROADCAST to all clients
                    const tiles = (this.world as any).tiles;
                    const hpData = this.heatMap.getTileHP(tx, ty);
                    
                    mm.broadcast(NetworkMessageType.WORLD_UPDATE, {
                        tx, ty, 
                        m: tiles[ty][tx],
                        hp: hpData ? Array.from(hpData) : null,
                        pt: p.type, // Send projectile type for better client-side effects
                        hx: hitPoint.x,
                        hy: hitPoint.y
                    });
                }
                
                p.active = false;
            }
        }
        
        return p.active; 
    });
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
    this.remotePlayersMap.forEach(rp => {
        if (rp.active) {
            this.spatialGrid.insert(rp);
            rp.segments.forEach(s => this.spatialGrid.insert(s));
        }
    });
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

  render(ctx: CanvasRenderingContext2D): void {
      if (!this.isSpawned) return;
      super.render(ctx);
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
      const p = new Projectile(data.x, data.y, data.a, data.type);
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
          // data: { tx, ty, m, hp, pt, hx, hy }
          const { tx, ty, m, hp, pt, hx, hy } = data;
          
          // Update World Tile
          (this.world as any).tiles[ty][tx] = m;
          
          // Update HeatMap HP
          if (hp) {
              const currentHP = this.heatMap.getTileHP(tx, ty);
              if (currentHP) {
                  for (let i = 0; i < hp.length; i++) currentHP[i] = hp[i];
              } else {
                  this.heatMap.setMaterial(tx, ty, m);
                  const newHP = this.heatMap.getTileHP(tx, ty);
                  if (newHP) {
                      for (let i = 0; i < hp.length; i++) newHP[i] = hp[i];
                  }
              }
          }

          this.world.invalidateTileCache(tx, ty);
          this.world.markMeshDirty();

          // Trigger visual effects on Client if they weren't already played
          if (!MultiplayerManager.getInstance().isHost && pt && hx !== undefined && hy !== undefined) {
              const cfg = ConfigManager.getInstance();
              if (pt === ProjectileType.ROCKET || pt === ProjectileType.MISSILE || pt === ProjectileType.MINE) {
                  const aoe = (pt === ProjectileType.MINE ? cfg.get<number>('Weapons', 'mineAOE') : (pt === ProjectileType.ROCKET ? cfg.get<number>('Weapons', 'rocketAOE') : cfg.get<number>('Weapons', 'missileAOE'))) * cfg.get<number>('World', 'tileSize');
                  this.combatSystem.createExplosion(hx, hy, aoe, 0);
              } else {
                  const sfx = pt === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                  SoundManager.getInstance().playSoundSpatial(sfx, hx, hy);
                  const color = pt === ProjectileType.CANNON ? '#ffff00' : '#ff6600';
                  this.combatSystem.createImpactParticles(hx, hy, color);
              }
          }
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
        h: Math.round(this.player.health),
        l: this.player.segments.length, // Send segment count
        w: ConfigManager.getInstance().get<string>('Player', 'activeWeapon') // Send weapon
      };

      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_STATE, state);
  }

  private handlePlayerState(data: any): void {
    const { id, x, y, r, n, h, l, w } = data;
    if (id === MultiplayerManager.getInstance().myId) return;

    let rp = this.remotePlayersMap.get(id);
    if (!rp) {
      rp = new RemotePlayer(id, x, y);
      this.remotePlayersMap.set(id, rp);
      this.updateRemotePlayersArray();
      
      // Add head and segments to physics for collision
      this.physics.addBody(rp);
      rp.segments.forEach(s => this.physics.addBody(s));
    }

    // Sync body length if it changed
    if (l !== undefined && rp.segments.length !== l) {
        // Remove old segments from physics
        rp.segments.forEach(s => this.physics.removeBody(s));
        
        // Update segments
        rp.setBodyLength(l);
        
        // Add new segments to physics
        rp.segments.forEach(s => this.physics.addBody(s));
    }
    
    // Sync weapon (could be used for visuals later)
    if (w) (rp as any).activeWeapon = w;

    rp.updateFromNetwork(x, y, this.rotationFromNetwork(r), n, h);
  }

  private rotationToNetwork(rad: number): number { return Math.round(rad * 1000); }
  private rotationFromNetwork(net: number): number { return net / 1000; }
}
