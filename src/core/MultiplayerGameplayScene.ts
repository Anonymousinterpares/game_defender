import { GameplayScene } from './GameplayScene';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { WeatherManager } from './WeatherManager';
import { WorldClock } from './WorldClock';
import { Entity } from './Entity';
import { Projectile, ProjectileType } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Drop } from '../entities/Drop';
import { ParticleSystem } from './ParticleSystem';
import { SoundManager } from './SoundManager';
import { EventBus, GameEvent } from './EventBus';
import { ConfigManager } from '../config/MasterConfig';
import { Simulation, SimulationRole } from './Simulation';
import { WorldRenderer } from './renderers/WorldRenderer';

export class MultiplayerGameplayScene extends GameplayScene {
  private remotePlayersMap: Map<string, RemotePlayer> = new Map();
  private scores: Map<string, number> = new Map();
  private networkTickRate: number = 0.033; // ~30 times per second
  private networkTimer: number = 0;
  private envSyncTimer: number = 0;
  private lastActiveState: boolean = true;
  private respawnTimer: number = 0;
  public lastKilledBy: string | null = null;
  private isSpawned: boolean = false;
  private hostId: string | null = null;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    super(sceneManager, inputManager);
  }

  async onEnter(): Promise<void> {
    await super.onEnter(); // Initialize radar, sound, etc.
    const mm = MultiplayerManager.getInstance();
    const role = mm.isHost ? SimulationRole.HOST : SimulationRole.CLIENT;
    
    // Set the correct role for simulation
    this.simulation.setRole(role);
    this.simulation.player.inputManager = this.inputManager;
    
    mm.clearMessageCallbacks();
    mm.onMessage((msg, _conn) => {
      if (!this.hostId && !mm.isHost) this.hostId = _conn.peer;
      
      switch (msg.t) {
        case NetworkMessageType.PLAYER_STATE: this.handlePlayerState(msg.d); break;
        case NetworkMessageType.PROJECTILE: this.handleRemoteProjectile(msg.d); break;
        case NetworkMessageType.WORLD_DAMAGE_REQUEST: this.handleWorldDamageRequest(msg.d); break;
        case NetworkMessageType.ENTITY_SPAWN: this.handleEntitySpawn(msg.d); break;
        case NetworkMessageType.ENTITY_DESTROY: this.handleEntityDestroy(msg.d); break;
        case NetworkMessageType.WORLD_UPDATE: this.handleWorldUpdate(msg.d); break;
        case NetworkMessageType.WORLD_SEED: this.handleWorldSeed(msg.d); break;
        case NetworkMessageType.PLAYER_DEATH: this.handleRemoteDeath(msg.d); break;
        case NetworkMessageType.PLAYER_HIT: this.handlePlayerHit(msg.d); break;
        case NetworkMessageType.WORLD_HEAT_SYNC: if (this.heatMap) this.heatMap.applyDeltaState(msg.d); break;
        case NetworkMessageType.PLUGIN_SYNC: this.simulation.pluginManager.applySyncStates(msg.d); break;
      }
    });

    if (mm.isHost) {
        const seed = Math.floor(Math.random() * 1000000);
        this.recreateWorld(seed);
        mm.broadcast(NetworkMessageType.WORLD_SEED, { seed });
        this.isSpawned = true;
    } else {
        mm.onMessage((msg) => {
            if (msg.t === NetworkMessageType.CHAT && msg.d.system === 'SPAWN_POS') {
                if (this.player) {
                    this.player.x = msg.d.x; this.player.y = msg.d.y;
                    this.player.prevX = msg.d.x; this.player.prevY = msg.d.y;
                    this.isSpawned = true;
                }
            }
        });
        mm.broadcast(NetworkMessageType.CHAT, { system: 'READY' });
    }

    // Host specifically listens for Client READY to send spawn pos
    if (mm.isHost) {
        mm.onMessage((msg) => {
            if (msg.t === NetworkMessageType.CHAT && msg.d.system === 'READY') {
                if (this.player) {
                    const p2Pos = this.getSafePVPSpawn({ x: this.player.x, y: this.player.y });
                    mm.broadcast(NetworkMessageType.CHAT, { system: 'SPAWN_POS', x: p2Pos.x, y: p2Pos.y });
                }
            }
        });
    }

    ParticleSystem.getInstance().clear();
    const roleStr = mm.isHost ? 'host' : 'client';
    ParticleSystem.getInstance().initWorker(this.world, roleStr);
    SoundManager.getInstance().init();
    SoundManager.getInstance().setWorld(this.world);
    this.hud.create();
  }

  private handlePlayerHit(data: any): void {
      const { id, damage, killerId } = data;
      if (id === this.myId && this.player) {
          this.player.takeDamage(damage);
          if (this.player.health <= 0) this.lastKilledBy = killerId;
      } else {
          const rp = this.remotePlayersMap.get(id);
          if (rp) rp.takeDamage(damage);
      }
  }

  private handleWorldDamageRequest(data: any): void {
      const mm = MultiplayerManager.getInstance();
      if (!mm.isHost || !this.world || !this.heatMap) return;
      const { tx, ty, m, pt, hx, hy } = data;
      (this.world as any).tiles[ty][tx] = m;
      this.worldRenderer.invalidateTileCache(tx, ty);
      this.world.markMeshDirty();
      const hpData = this.heatMap.getTileHP(tx, ty);
      mm.broadcast(NetworkMessageType.WORLD_UPDATE, { tx, ty, m, hp: hpData ? Array.from(hpData) : null, pt, hx, hy });
  }

  private handleLocalDeath(): void {
      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_DEATH, { id: this.myId, killerId: this.lastKilledBy });
      this.lastKilledBy = null;
      SoundManager.getInstance().playSound('explosion_large');
  }

  private handleRemoteDeath(data: any): void {
      const { id, killerId } = data;
      if (killerId) {
          this.scores.set(killerId, (this.scores.get(killerId) || 0) + 1);
      }
      const rp = this.remotePlayersMap.get(id);
      if (rp) {
          rp.active = false;
          this.simulation.combatSystem.createExplosion(rp.x, rp.y, 60, 0);
      }
  }

  private respawnPlayer(): void {
      if (!this.player) return;
      const pos = this.getSafePVPSpawn({ x: 0, y: 0 });
      this.player.x = pos.x; this.player.y = pos.y;
      this.player.prevX = pos.x; this.player.prevY = pos.y;
      this.player.health = this.player.maxHealth;
      this.player.active = true; this.player.isOnFire = false;
  }

  private handleWorldSeed(data: any): void {
      if (!MultiplayerManager.getInstance().isHost) this.recreateWorld(data.seed);
  }

  private recreateWorld(seed: number): void {
      this.simulation.reset(seed);
      this.simulation.player.inputManager = this.inputManager;
      this.worldRenderer = new WorldRenderer(this.simulation.world);
      this.lightingRenderer.clearCache();
  }

  private getSafePVPSpawn(p1Pos: {x: number, y: number}): {x: number, y: number} {
      const minTilesDist = 20; const tileSize = 32; const minDist = minTilesDist * tileSize;
      for (let i = 0; i < 50; i++) {
          const pos = (this.simulation as any).getRandomValidPos();
          const dx = pos.x - p1Pos.x; const dy = pos.y - p1Pos.y;
          if (Math.sqrt(dx*dx + dy*dy) >= minDist) return pos;
      }
      return { x: 100, y: 100 };
  }

  update(dt: number): void {
    if (!this.isSpawned) return;
    
    // 1. Sync remotePlayers array for simulation systems
    this.simulation.remotePlayers = Array.from(this.remotePlayersMap.values());

    // 2. Run Core Simulation (duplication removed!)
    super.update(dt);

    // 3. Remote Player Heat/Firing Simulation (Visuals only)
    this.updateRemoteVisuals(dt);

    // 4. Network Sync
    this.networkTimer += dt;
    if (this.networkTimer >= this.networkTickRate) {
      this.sendLocalState();
      if (MultiplayerManager.getInstance().isHost) {
          this.sendWorldSync();
          this.envSyncTimer += this.networkTimer;
          if (this.envSyncTimer >= 1.0) {
              this.sendPluginSync();
              if (this.heatMap) {
                  const delta = this.heatMap.getDeltaState();
                  if (delta.length > 0) MultiplayerManager.getInstance().broadcast(NetworkMessageType.WORLD_HEAT_SYNC, delta);
              }
              this.envSyncTimer = 0;
          }
      }
      this.networkTimer = 0;
    }

    // 5. Death Logic
    if (this.player) {
        if (this.lastActiveState && !this.player.active) this.handleLocalDeath();
        this.lastActiveState = this.player.active;
        if (!this.player.active) {
            this.respawnTimer += dt;
            if (this.respawnTimer >= 3.0) { this.respawnPlayer(); this.respawnTimer = 0; }
        }
    }
  }

  private updateRemoteVisuals(dt: number): void {
      if (!this.heatMap) return;
      this.remotePlayersMap.forEach(rp => {
          if ((rp as any).remoteFiringTimer > 0) {
              const type = (rp as any).remoteFiringType;
              const angle = (rp as any).remoteFiringAngle || rp.rotation;
              const maxDist = type === 'laser' ? 800 : (type === 'ray' ? 500 : 180);
              const hit = this.world?.raycast(rp.x, rp.y, angle, maxDist);
              const actualDist = hit ? Math.sqrt((hit.x - rp.x)**2 + (hit.y - rp.y)**2) : maxDist;

              const steps = type === 'flamethrower' ? 5 : 8;
              for (let i = 1; i <= steps; i++) {
                  const d = (i / steps) * actualDist;
                  const hx = rp.x + Math.cos(angle) * d;
                  const hy = rp.y + Math.sin(angle) * d;
                  if (type === 'flamethrower') {
                      this.heatMap!.addHeat(hx, hy, 0.8 * dt * 10, 25);
                      if (Math.random() < 0.2 * dt * 10) this.heatMap!.forceIgniteArea(hx, hy, 15);
                  } else {
                      this.heatMap!.addHeat(hx, hy, (type === 'laser' ? 0.3 : 0.5) * dt * 10, 10);
                  }
              }
              (rp as any).remoteFiringTimer -= dt;
          }
      });
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isSpawned || !this.world || !this.player) return;
    super.render(ctx);

    // Custom render for remote player beams
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.remotePlayersMap.forEach(rp => {
        if ((rp as any).remoteFiringTimer > 0) {
            const type = (rp as any).remoteFiringType;
            if (type === 'laser' || type === 'ray') {
                const angle = (rp as any).remoteFiringAngle || rp.rotation;
                const hit = this.world!.raycast(rp.x, rp.y, angle, type === 'laser' ? 800 : 500);
                const endX = hit ? hit.x : rp.x + Math.cos(angle) * (type === 'laser' ? 800 : 500);
                const endY = hit ? hit.y : rp.y + Math.sin(angle) * (type === 'laser' ? 800 : 500);
                ctx.beginPath(); ctx.moveTo(rp.interpolatedX, rp.interpolatedY); ctx.lineTo(endX, endY);
                ctx.strokeStyle = type === 'laser' ? '#ff0000' : 'rgba(0, 255, 255, 0.8)';
                ctx.lineWidth = type === 'laser' ? 2 : 15; ctx.stroke();
            }
        }
    });
    ctx.restore();
  }

  protected getRadarEntities(): Entity[] {
      return [this.player!, ...this.remotePlayersMap.values(), ...this.enemies, ...this.projectiles];
  }

  private sendWorldSync(): void {
      const enemyData = this.enemies.map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), r: Math.round(e.rotation * 100) / 100, h: Math.round(e.health) }));
      const dropData = this.drops.map(d => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), t: d.type }));
      MultiplayerManager.getInstance().broadcast(NetworkMessageType.ENTITY_SPAWN, { enemies: enemyData, drops: dropData });
  }

  private sendPluginSync(): void {
      const states = this.simulation.pluginManager.getSyncStates();
      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLUGIN_SYNC, states);
  }

  private handleRemoteProjectile(data: any): void {
      if (data.type === 'laser' || data.type === 'ray' || data.type === 'flamethrower') {
          const rp = this.remotePlayersMap.get(data.sid);
          if (rp) {
              (rp as any).remoteFiringType = data.type;
              (rp as any).remoteFiringTimer = 0.5;
              (rp as any).remoteFiringAngle = data.a;
              SoundManager.getInstance().playSoundSpatial('shoot_' + data.type, data.x, data.y);
          }
          return;
      }
      const p = new Projectile(data.x, data.y, data.a, data.type);
      if (data.sid) p.shooterId = data.sid;
      this.simulation.projectiles.push(p);
      SoundManager.getInstance().playSoundSpatial('shoot_' + p.type, p.x, p.y);
  }

  private handleEntitySpawn(data: any): void {
      if (data.enemies) {
          data.enemies.forEach((ed: any) => {
              let enemy = this.enemies.find(e => e.id === ed.id);
              if (!enemy) { enemy = new Enemy(ed.x, ed.y); enemy.id = ed.id; this.enemies.push(enemy); }
              enemy.prevX = enemy.x; enemy.prevY = enemy.y; enemy.x = ed.x; enemy.y = ed.y; enemy.rotation = ed.r; enemy.health = ed.h;
          });
      }
      if (data.drops) {
          data.drops.forEach((dd: any) => {
              if (!this.drops.find(d => d.id === dd.id)) {
                  const newDrop = new Drop(dd.x, dd.y, dd.t); newDrop.id = dd.id; this.drops.push(newDrop);
              }
          });
      }
  }

  private handleEntityDestroy(data: any): void {
      if (data.type === 'drop') {
          const drop = this.drops.find(d => d.id === data.id); if (drop) drop.active = false;
      } else if (data.type === 'enemy') {
          const enemy = this.enemies.find(e => e.id === data.id); if (enemy) enemy.active = false;
      }
  }

  private handleWorldUpdate(data: any): void {
      if (this.world && this.heatMap) {
          const { tx, ty, m, hp, pt, hx, hy } = data;
          (this.world as any).tiles[ty][tx] = m;
          if (hp) {
              const currentHP = this.heatMap.getTileHP(tx, ty);
              if (currentHP) { for (let i = 0; i < hp.length; i++) currentHP[i] = hp[i]; }
              else {
                  this.heatMap.setMaterial(tx, ty, m);
                  const newHP = this.heatMap.getTileHP(tx, ty);
                  if (newHP) for (let i = 0; i < hp.length; i++) newHP[i] = hp[i];
              }
          }
          this.worldRenderer.invalidateTileCache(tx, ty); this.world.markMeshDirty();
          if (!MultiplayerManager.getInstance().isHost && pt && hx !== undefined && hy !== undefined) {
              // Clear any local projectile that might have "passed through"
              this.simulation.removeProjectileAt(hx, hy, 40);

              if (pt === ProjectileType.ROCKET || pt === ProjectileType.MISSILE || pt === ProjectileType.MINE) {
                  const cfg = ConfigManager.getInstance();
                  const aoe = (pt === ProjectileType.MINE ? cfg.get<number>('Weapons', 'mineAOE') : (pt === ProjectileType.ROCKET ? cfg.get<number>('Weapons', 'rocketAOE') : cfg.get<number>('Weapons', 'missileAOE'))) * cfg.get<number>('World', 'tileSize');
                  this.simulation.combatSystem.createExplosion(hx, hy, aoe, 0);
              } else {
                  EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, {
                      x: hx, y: hy,
                      projectileType: pt === ProjectileType.CANNON ? 'cannon' : 'rocket',
                      hitType: 'wall'
                  });
              }
          }
      }
  }

  private sendLocalState(): void {
      if (!this.player) return;
      const state = {
        id: MultiplayerManager.getInstance().myId,
        x: Math.round(this.player.x), y: Math.round(this.player.y),
        r: Math.round(this.player.rotation * 1000), n: MultiplayerManager.getInstance().myName,
        h: Math.round(this.player.health), l: this.player.segments.length, 
        segs: this.player.segments.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), f: s.isOnFire })),
        f: this.player.isOnFire, w: ConfigManager.getInstance().get<string>('Player', 'activeWeapon'),
        a: this.player.active
      };
      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_STATE, state);
  }

  private handlePlayerState(data: any): void {
    const { id, x, y, r, n, h, l, segs, f, w, a } = data;
    if (id === MultiplayerManager.getInstance().myId) return;
    let rp = this.remotePlayersMap.get(id);
    if (!rp) {
      rp = new RemotePlayer(id, x, y);
      this.remotePlayersMap.set(id, rp);
      this.simulation.remotePlayers.push(rp);
      this.physics.addBody(rp);
    }
    
    // Reactivate and Sync active state
    if (a !== undefined) rp.active = a;
    else rp.active = true; // Fallback

    if (l !== undefined && rp.segments.length !== l) {
        rp.setBodyLength(l);
    }
    if (segs && segs.length === rp.segments.length) {
        for (let i = 0; i < segs.length; i++) {
            const s = rp.segments[i];
            s.prevX = s.x; s.prevY = s.y; // Prepare for interpolation
            s.x = segs[i].x; s.y = segs[i].y;
            if (segs[i].f !== undefined) s.isOnFire = segs[i].f;
        }
    }
    if (w) (rp as any).activeWeapon = w;
    if (f !== undefined) rp.isOnFire = f;
    rp.updateFromNetwork(x, y, r / 1000, n, h);
  }
}
