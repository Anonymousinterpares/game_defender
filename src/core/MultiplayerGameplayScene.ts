import { GameplayScene } from './GameplayScene';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { WorldClock } from './WorldClock';
import { LightManager } from './LightManager';
import { FloorDecalManager } from './FloorDecalManager';
import { Entity } from './Entity';
import { Player } from '../entities/Player';
import { Projectile } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { ParticleSystem } from './ParticleSystem';
import { SoundManager } from './SoundManager';

export class MultiplayerGameplayScene extends GameplayScene {
  private remotePlayers: Map<string, RemotePlayer> = new Map();
  private networkTickRate: number = 0.05; // 20 times per second
  private networkTimer: number = 0;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    super(sceneManager, inputManager);
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
        case NetworkMessageType.WORLD_UPDATE:
          this.handleWorldUpdate(msg.d);
          break;
      }
    });

    // PVP SPAWNING LOGIC
    if (this.player && this.world) {
        // Find safe spot for Player 1 (Host or Client, they both do it locally first)
        const p1Pos = this.getRandomValidPos();
        this.player.x = p1Pos.x;
        this.player.y = p1Pos.y;
        this.player.prevX = p1Pos.x;
        this.player.prevY = p1Pos.y;
        
        if (mm.isHost) {
            console.log('Host: Waiting for Client READY...');
            mm.onMessage((msg) => {
                if (msg.t === NetworkMessageType.CHAT && msg.d.system === 'READY') {
                    console.log('Host: Client is READY, sending spawn pos');
                    const p2Pos = this.getSafePVPSpawn(p1Pos);
                    mm.broadcast(NetworkMessageType.CHAT, { system: 'SPAWN_POS', x: p2Pos.x, y: p2Pos.y });
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
            // Tell host we are ready
            mm.broadcast(NetworkMessageType.CHAT, { system: 'READY' });
        }
    }
  }

  private getSafePVPSpawn(p1Pos: {x: number, y: number}): {x: number, y: number} {
      const minTilesDist = 15;
      const tileSize = (this.world as any).tileSize || 32;
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
    this.remotePlayers.clear();
  }

  update(dt: number): void {
    const mm = MultiplayerManager.getInstance();

    // 1. Update Core Gameplay (with custom logic for client/host)
    this.updateMultiplayerCore(dt);

    // 2. Update remote players (visual only)
    this.remotePlayers.forEach(rp => rp.update(dt));

    // 3. Network Sync
    this.networkTimer += dt;
    if (this.networkTimer >= this.networkTickRate) {
      this.sendLocalState();
      if (mm.isHost) {
          this.sendWorldSync();
      }
      this.networkTimer = 0;
    }
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
                this.projectiles.push(p);
                // NETWORK BROADCAST
                mm.broadcast(NetworkMessageType.PROJECTILE, { x, y, a: angle, type: p.type });
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
        this.enemies = this.enemies.filter(e => { if(!e.active) this.physics.removeBody(e); return e.active; });
    }

    // Camera and other visual logic...
    if (this.player) {
        this.cameraX = this.player.interpolatedX - window.innerWidth / 2;
        this.cameraY = this.player.interpolatedY - window.innerHeight / 2;
        SoundManager.getInstance().updateListener(this.player.interpolatedX, this.player.interpolatedY);
    }

    this.spatialGrid.clear();
    if (this.player) this.spatialGrid.insert(this.player);
    this.remotePlayers.forEach(rp => this.spatialGrid.insert(rp));
    this.enemies.forEach(e => this.spatialGrid.insert(e));
    this.projectiles.forEach(p => this.spatialGrid.insert(p));

    this.heatMap?.update(dt);
  }

  protected getRadarEntities(): Entity[] {
      return [this.player!, ...this.remotePlayers.values(), ...this.enemies, ...this.projectiles];
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

      if (enemyData.length > 0) {
          MultiplayerManager.getInstance().broadcast(NetworkMessageType.ENTITY_SPAWN, { enemies: enemyData });
      }
  }

  private handleRemoteProjectile(data: any): void {
      const p = new Projectile(data.x, data.y, data.a);
      // Optional: Set projectile type if supported
      this.projectiles.push(p);
  }

  private handleEntitySpawn(data: any): void {
      if (data.enemies) {
          data.enemies.forEach((ed: any) => {
              let enemy = this.enemies.find(e => e.id === ed.id);
              if (!enemy) {
                  // New enemy spawned on host, create it locally
                  enemy = new Enemy(ed.x, ed.y);
                  enemy.id = ed.id;
                  this.enemies.push(enemy);
                  // We don't add to physics on client to prevent jitter/conflict
              }
              
              if (enemy) {
                  // Update state from host
                  enemy.prevX = enemy.x;
                  enemy.prevY = enemy.y;
                  enemy.x = ed.x;
                  enemy.y = ed.y;
                  enemy.rotation = ed.r;
                  enemy.health = ed.h;
              }
          });
      }
  }

  private handleWorldUpdate(data: any): void {
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
        r: this.rotationToNetwork(this.player.rotation)
      };

      MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_STATE, state);
  }

  private handlePlayerState(data: any): void {
    const { id, x, y, r } = data;
    if (id === MultiplayerManager.getInstance().myId) return;

    let rp = this.remotePlayers.get(id);
    if (!rp) {
      rp = new RemotePlayer(id, x, y);
      this.remotePlayers.set(id, rp);
    }

    rp.updateFromNetwork(x, y, this.rotationFromNetwork(r));
  }

  private rotationToNetwork(rad: number): number { return Math.round(rad * 1000); }
  private rotationFromNetwork(net: number): number { return net / 1000; }
}
