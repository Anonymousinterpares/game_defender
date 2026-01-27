import { GameplayScene } from './GameplayScene';
import { EntityFactory } from './ecs/EntityFactory';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { WeatherManager } from './WeatherManager';
import { LightManager } from './LightManager';
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
import { TransformComponent } from './ecs/components/TransformComponent';
import { PhysicsComponent } from './ecs/components/PhysicsComponent';
import { HealthComponent } from './ecs/components/HealthComponent';
import { ProjectileComponent } from './ecs/components/ProjectileComponent';
import { FireComponent } from './ecs/components/FireComponent';
import { RenderComponent } from './ecs/components/RenderComponent';
import { TagComponent } from './ecs/components/TagComponent';
import { SegmentComponent } from './ecs/components/SegmentComponent';
import { WeatherTimePlugin } from './plugins/WeatherTimePlugin';
import { ChaosPlugin } from './plugins/ChaosPlugin';
import { ProjectionUtils } from '../utils/ProjectionUtils';
import { GPURenderer } from './gpu/GPURenderer';

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
    private pingTimer: number = 0;
    private pingStartTime: number = 0;

    constructor(sceneManager: SceneManager, inputManager: InputManager) {
        super(sceneManager, inputManager);
    }

    async onEnter(): Promise<void> {
        this.loadingScreen.show();

        // Multiplayer-specific flow: onEnter already called super.onEnter() but we need more control
        // Reset Singletons
        WorldClock.getInstance().reset();
        LightManager.getInstance().reset();
        WeatherManager.getInstance().reset();
        SoundManager.getInstance().reset();

        const mm = MultiplayerManager.getInstance();
        const role = mm.isHost ? SimulationRole.HOST : SimulationRole.CLIENT;

        // Set the correct role for simulation
        this.simulation.setRole(role);
        this.simulation.player.inputManager = this.inputManager;

        mm.clearMessageCallbacks();
        mm.onMessage((msg, _conn) => {
            if (!this.hostId && !mm.isHost) this.hostId = _conn.peer;

            switch (msg.t) {
                case NetworkMessageType.PING_PONG:
                    if (msg.d.ping) {
                        mm.broadcast(NetworkMessageType.PING_PONG, { pong: true });
                    } else if (msg.d.pong) {
                        const now = performance.now();
                        mm.setPing(Math.round(now - this.pingStartTime));
                    }
                    break;
                case NetworkMessageType.PLAYER_STATE: this.handlePlayerState(msg.d); break;
                case NetworkMessageType.PROJECTILE: this.handleRemoteProjectile(msg.d); break;
                case NetworkMessageType.WORLD_DAMAGE_REQUEST: this.handleWorldDamageRequest(msg.d); break;
                case NetworkMessageType.ENTITY_SPAWN: this.handleEntitySpawn(msg.d); break;
                case NetworkMessageType.ENTITY_DESTROY: this.handleEntityDestroy(msg.d); break;
                case NetworkMessageType.WORLD_UPDATE: this.handleWorldUpdate(msg.d); break;
                case NetworkMessageType.WORLD_SEED:
                    this.handleWorldSeed(msg.d);
                    // World seed received, world is recreated, we can proceed to render/hide
                    this.isSpawned = true;
                    break;
                case NetworkMessageType.PLAYER_DEATH: this.handleRemoteDeath(msg.d); break;
                case NetworkMessageType.PLAYER_HIT: this.handlePlayerHit(msg.d); break;
                case NetworkMessageType.EXPLOSION: this.handleRemoteExplosion(msg.d); break;
                case NetworkMessageType.WORLD_HEAT_SYNC: if (this.heatMap) this.heatMap.applyDeltaState(msg.d); break;
                case NetworkMessageType.PLUGIN_SYNC: this.simulation.pluginManager.applySyncStates(msg.d); break;
            }
        });

        if (mm.isHost) {
            const seed = Math.floor(Math.random() * 1000000);
            const width = ConfigManager.getInstance().get<number>('World', 'width');
            const height = ConfigManager.getInstance().get<number>('World', 'height');
            this.recreateWorld(seed, width, height);
            const config = ConfigManager.getInstance();
            mm.broadcast(NetworkMessageType.WORLD_SEED, {
                seed,
                w: width,
                h: height,
                mpt: config.get('World', 'metersPerTile'),
                ts: config.get('World', 'tileSize'),
                wh: config.get('World', 'wallHeight')
            });
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

        // Listen for item collection to sync destruction in MP
        EventBus.getInstance().on(GameEvent.ITEM_COLLECTED, this.onItemCollected);

        // Wait for sync (client) or just a small warm-up (host)
        const checkSync = async () => {
            let attempts = 0;
            while (!this.isSpawned && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }

            // Render one frame hidden
            this.render(this.sceneManager['ctx']);
            await new Promise(r => setTimeout(r, 500));
            this.loadingScreen.hide();
        };

        checkSync();
    }

    private onItemCollected = (data: any) => {
        const mm = MultiplayerManager.getInstance();
        if (mm.isHost && data.dropId) {
            mm.broadcast(NetworkMessageType.ENTITY_DESTROY, { id: data.dropId });
        }
    };

    onExit(): void {
        super.onExit();
        EventBus.getInstance().off(GameEvent.ITEM_COLLECTED, this.onItemCollected);
    }

    private findPlayerByAnyId(id: string): any | null {
        // 1. Check local player
        if (id === this.myId || (this.player && this.player.id === id)) return this.player;
        if (this.player && this.player.segments.some(s => s.id === id)) return this.player;

        // 2. Check remote players
        const rp = this.remotePlayersMap.get(id);
        if (rp) return rp;

        for (const remote of this.remotePlayersMap.values()) {
            if (remote.segments.some(s => s.id === id)) return remote;
        }

        return null;
    }

    private handlePlayerHit(data: any): void {
        const { id, damage, killerId, ignite } = data;
        const target = this.findPlayerByAnyId(id);

        if (target) {
            target.takeDamage(damage);
            if (ignite) target.isOnFire = true;

            if (target === this.player) {
                if (target.health <= 0) this.lastKilledBy = killerId;
            }
        } else if (MultiplayerManager.getInstance().isHost && id.startsWith('e_')) {
            // Apply damage to NPC on Host
            const health = this.simulation.entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && health.active) {
                health.health -= damage;
                health.damageFlash = 0.2;
                if (health.health <= 0) {
                    health.health = 0;
                    health.active = false;
                }
            }
        }
    }

    private handleWorldDamageRequest(data: any): void {
        const mm = MultiplayerManager.getInstance();
        if (!mm.isHost || !this.world || !this.heatMap) return;
        const { tx, ty, m, pt, hx, hy } = data;
        this.world.setTile(tx, ty, m);
        this.worldRenderer.invalidateTileCache(tx, ty);
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
        if (!MultiplayerManager.getInstance().isHost) {
            this.recreateWorld(data.seed, data.w, data.h, data.mpt, data.ts, data.wh);
        }
    }

    private recreateWorld(seed: number, width?: number, height?: number, mpt?: number, ts?: number, wh?: number): void {
        this.simulation.reset(seed, width, height, mpt, ts, wh);
        this.simulation.pluginManager.install(new WeatherTimePlugin());
        this.simulation.player.inputManager = this.inputManager;
        this.worldRenderer = new WorldRenderer(this.simulation.world);
        this.lightingRenderer.clearCache();
        GPURenderer.getInstance().resetWorld(this.simulation.world);
    }

    private getSafePVPSpawn(p1Pos: { x: number, y: number }): { x: number, y: number } {
        const minTilesDist = 20; const tileSize = 32; const minDist = minTilesDist * tileSize;
        for (let i = 0; i < 50; i++) {
            const pos = (this.simulation as any).getRandomValidPos();
            const dx = pos.x - p1Pos.x; const dy = pos.y - p1Pos.y;
            if (Math.sqrt(dx * dx + dy * dy) >= minDist) return pos;
        }
        return { x: 100, y: 100 };
    }

    update(dt: number): void {
        if (!this.isSpawned) return;

        // Ping loop: every 1 second
        this.pingTimer += dt;
        if (this.isSpawned && this.player) {
            const alpha = this.simulation.physicsSystem.alpha;
            const px = this.player.prevX + (this.player.x - this.player.prevX) * alpha;
            const py = this.player.prevY + (this.player.y - this.player.prevY) * alpha;

            this.cameraX = px - window.innerWidth / 2;
            this.cameraY = py - window.innerHeight / 2;
            SoundManager.getInstance().updateListener(px, py);
        }
        if (this.pingTimer >= 1.0) {
            this.pingTimer = 0;
            this.pingStartTime = performance.now();
            MultiplayerManager.getInstance().broadcast(NetworkMessageType.PING_PONG, { ping: true });

            // LOGGING POSITIONS for Diagnosis
            if (ConfigManager.getInstance().get<boolean>('Debug', 'multiplayerLogs')) {
                const mm = MultiplayerManager.getInstance();
                if (mm.isHost) {
                    let logMsg = `[MP-HOST] MyPos: (${Math.round(this.player?.x || 0)}, ${Math.round(this.player?.y || 0)})`;
                    let i = 1;
                    this.remotePlayersMap.forEach(rp => {
                        logMsg += ` | Client${i}: (${Math.round(rp.x)}, ${Math.round(rp.y)})`;
                        i++;
                    });
                    console.log(logMsg);
                } else {
                    let logMsg = `[MP-CLIENT] MyPos: (${Math.round(this.player?.x || 0)}, ${Math.round(this.player?.y || 0)})`;
                    // Ideally we want to know where HOST is. We can find host if we knew their ID,
                    // but for now, listing all remote players (one of which is host)
                    this.remotePlayersMap.forEach(rp => {
                        logMsg += ` | Remote(${rp.id.substr(0, 4)}): (${Math.round(rp.x)}, ${Math.round(rp.y)})`;
                    });
                    console.log(logMsg);
                }
            }
        }

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
                const actualDist = hit ? Math.sqrt((hit.x - rp.x) ** 2 + (hit.y - rp.y) ** 2) : maxDist;

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

                    const alpha = this.simulation.physicsSystem.alpha;
                    const rx = rp.prevX + (rp.x - rp.prevX) * alpha;
                    const ry = rp.prevY + (rp.y - rp.prevY) * alpha;
                    const rz = (rp as any).prevZ !== undefined ? (rp as any).prevZ + ((rp as any).z - (rp as any).prevZ) * alpha : (rp.z || 0);

                    // Perspective offset for the beam start point
                    const centerX = this.cameraX + ctx.canvas.width / 2;
                    const centerY = this.cameraY + ctx.canvas.height / 2;
                    const pOffset = ProjectionUtils.getProjectedOffset(rx, ry, rz, centerX, centerY);

                    ctx.beginPath();
                    ctx.moveTo(rx + pOffset.x, ry + rz + pOffset.y);
                    ctx.lineTo(endX, endY);
                    ctx.strokeStyle = type === 'laser' ? '#ff0000' : 'rgba(0, 255, 255, 0.8)';
                    ctx.lineWidth = type === 'laser' ? 2 : 15; ctx.stroke();
                }
            }
        });
        ctx.restore();
    }


    private sendWorldSync(): void {
        const enemyData = this.enemies.map(e => {
            const id = (e as any).id;
            const type = (e as any).type || 'Scout';
            const transform = this.simulation.entityManager.getComponent<TransformComponent>(id, 'transform');
            return {
                id,
                t: type,
                x: Math.round(e.x),
                y: Math.round(e.y),
                z: transform ? Math.round(transform.z) : 0,
                r: Math.round((e.rotation || 0) * 100) / 100,
                h: Math.round((e as any).health || 0)
            };
        });
        const dropData = this.drops.map(d => {
            const id = (d as any).id;
            const type = (d as any).dropType || (d as any).type;
            return { id, x: Math.round(d.x), y: Math.round(d.y), t: type };
        });
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
        const id = EntityFactory.createProjectile(
            this.simulation.entityManager,
            data.x, data.y, data.a, data.type, data.sid
        );

        const p = new Projectile(data.x, data.y, data.a, data.type);
        p.id = id;
        p.setEntityManager(this.simulation.entityManager);
        if (data.sid) p.shooterId = data.sid;

        if (p.type === ProjectileType.MISSILE) {
            const target = this.simulation.combatSystem.findNearestTarget(p.x, p.y, p.shooterId);
            p.target = target;

            // Sync to ECS
            const pComp = this.simulation.entityManager.getComponent<ProjectileComponent>(id, 'projectile');
            if (pComp) {
                pComp.targetId = target?.id || null;
            }
        }

        this.simulation.projectiles.push(p);
        SoundManager.getInstance().playSoundSpatial('shoot_' + p.type, p.x, p.y);
    }

    private handleEntitySpawn(data: any): void {
        if (data.enemies) {
            data.enemies.forEach((ed: any) => {
                const em = this.simulation.entityManager;
                if (!em.hasEntity(ed.id)) {
                    EntityFactory.createEnemy(em, ed.x, ed.y, ed.t || 'Scout', ed.id);
                }
                const transform = em.getComponent<TransformComponent>(ed.id, 'transform');
                if (transform) {
                    // If moving significantly, let PhysicsSystem handle prevX update naturally.
                    // If it's the first sync of an existing entity we just found, or jump, sync it.
                    const distSq = (transform.x - ed.x) ** 2 + (transform.y - ed.y) ** 2;
                    if (distSq > 10000) { // Large jump
                        transform.prevX = ed.x;
                        transform.prevY = ed.y;
                        transform.prevZ = ed.z || 0;
                    }
                    transform.x = ed.x;
                    transform.y = ed.y;
                    transform.z = ed.z || 0;
                    transform.rotation = ed.r;
                }
                const health = em.getComponent<HealthComponent>(ed.id, 'health');
                if (health) {
                    health.health = ed.h;
                }
            });
        }
        if (data.drops) {
            data.drops.forEach((dd: any) => {
                const em = this.simulation.entityManager;
                if (!em.hasEntity(dd.id)) {
                    EntityFactory.createDrop(em, dd.x, dd.y, dd.t, dd.id);
                }
                const transform = em.getComponent<TransformComponent>(dd.id, 'transform');
                if (transform) {
                    // Drops are static, so always sync prev position to prevent jitter
                    transform.prevX = dd.x;
                    transform.prevY = dd.y;
                    transform.x = dd.x;
                    transform.y = dd.y;
                }
            });
        }
    }

    private handleEntityDestroy(data: any): void {
        const em = this.simulation.entityManager;
        if (!em.hasEntity(data.id)) return;

        const health = em.getComponent<HealthComponent>(data.id, 'health');
        if (health) {
            health.active = false;
        } else {
            em.removeEntity(data.id);
        }
    }

    private handleRemoteExplosion(data: any): void {
        if (!this.world || !this.heatMap) return;
        const { x, y, radius, mc, pt, tiles } = data;

        // 1. Update all affected tiles
        if (tiles && tiles.length > 0) {
            tiles.forEach((t: any) => {
                const { tx, ty, m, hp } = t;
                // Use public setTile which also marks mesh as dirty
                this.world!.setTile(tx, ty, m);

                if (hp) {
                    let currentHP = this.heatMap!.getTileHP(tx, ty);
                    if (!currentHP) {
                        this.heatMap!.setMaterial(tx, ty, m);
                        currentHP = this.heatMap!.getTileHP(tx, ty);
                    }

                    if (currentHP) {
                        for (let i = 0; i < hp.length; i++) {
                            currentHP[i] = hp[i];
                        }
                    }
                }
                this.worldRenderer.invalidateTileCache(tx, ty);
            });
        }

        // 2. Trigger Visual Explosion
        this.simulation.removeProjectileAt(x, y, 40);
        this.simulation.combatSystem.createExplosion(x, y, radius, 0, null, pt, mc);
    }

    private handleWorldUpdate(data: any): void {
        if (this.world && this.heatMap) {
            const { tx, ty, m, hp, pt, hx, hy } = data;
            this.world.setTile(tx, ty, m);
            if (hp) {
                let currentHP = this.heatMap.getTileHP(tx, ty);
                if (!currentHP) {
                    this.heatMap.setMaterial(tx, ty, m);
                    currentHP = this.heatMap.getTileHP(tx, ty);
                }
                if (currentHP) {
                    for (let i = 0; i < hp.length; i++) currentHP[i] = hp[i];
                }
            }
            this.worldRenderer.invalidateTileCache(tx, ty);

            if (!MultiplayerManager.getInstance().isHost && pt && hx !== undefined && hy !== undefined) {
                // This is now only for SINGLE tile updates (non-AOE)
                this.simulation.removeProjectileAt(hx, hy, 40);
                EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, {
                    x: hx, y: hy,
                    projectileType: pt === ProjectileType.CANNON ? 'cannon' : 'rocket',
                    hitType: 'wall'
                });
            }
        }
    }

    private sendLocalState(): void {
        if (!this.player) return;
        const state = {
            id: MultiplayerManager.getInstance().myId,
            x: Math.round(this.player.x), y: Math.round(this.player.y),
            z: Math.round(this.player.z),
            r: Math.round(this.player.rotation * 1000), n: MultiplayerManager.getInstance().myName,
            h: Math.round(this.player.health), l: this.player.segments.length,
            segs: this.player.segments.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), z: Math.round(s.z), f: s.isOnFire })),
            f: this.player.isOnFire, w: ConfigManager.getInstance().get<string>('Player', 'activeWeapon'),
            a: this.player.active
        };
        MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_STATE, state);
    }

    private handlePlayerState(data: any): void {
        const { id, x, y, z, r, n, h, l, segs, f, w, a } = data;
        if (id === MultiplayerManager.getInstance().myId) return;
        let rp = this.remotePlayersMap.get(id);
        if (!rp) {
            rp = new RemotePlayer(id, x, y);
            this.remotePlayersMap.set(id, rp);
            this.simulation.remotePlayers.push(rp);

            // ECS Link for Remote Player
            rp.setEntityManager(this.simulation.entityManager);
            this.simulation.entityManager.addComponent(rp.id, new TagComponent('remote_player'));
            this.simulation.entityManager.addComponent(rp.id, new TransformComponent(x, y, r / 1000, z || 0));
            this.simulation.entityManager.addComponent(rp.id, new PhysicsComponent(0, 0, rp.radius));
            this.simulation.entityManager.addComponent(rp.id, new HealthComponent(h, 100));
            this.simulation.entityManager.addComponent(rp.id, new FireComponent());
            this.simulation.entityManager.addComponent(rp.id, new RenderComponent('custom', rp.color, rp.radius));
        }

        // Reactivate and Sync active state
        if (a !== undefined) rp.active = a;
        else rp.active = true; // Fallback

        if (l !== undefined && rp.segments.length !== l) {
            rp.setBodyLength(l);
        }

        // Ensure segments are also in ECS
        rp.segments.forEach((seg, i) => {
            if (!this.simulation.entityManager.getComponent(seg.id, 'transform')) {
                seg.setEntityManager(this.simulation.entityManager);
                const sx = segs && segs[i] ? segs[i].x : seg.x;
                const sy = segs && segs[i] ? segs[i].y : seg.y;
                const sz = segs && segs[i] ? (segs[i].z || 0) : 0;
                this.simulation.entityManager.addComponent(seg.id, new TransformComponent(sx, sy, 0, sz));
                this.simulation.entityManager.addComponent(seg.id, new PhysicsComponent(0, 0, seg.radius));
                this.simulation.entityManager.addComponent(seg.id, new HealthComponent(100, 100));
                this.simulation.entityManager.addComponent(seg.id, new FireComponent());

                // Add SegmentComponent for smooth interpolation in ECS
                const leaderId = i === 0 ? rp.id : rp.segments[i - 1].id;
                this.simulation.entityManager.addComponent(seg.id, new SegmentComponent(leaderId, 35));
            }
        });

        if (segs && segs.length === rp.segments.length) {
            for (let i = 0; i < segs.length; i++) {
                const s = rp.segments[i];
                if (segs[i].z !== undefined) s.z = segs[i].z;
                if (segs[i].f !== undefined) s.isOnFire = segs[i].f;
            }
        }
        if (w) (rp as any).activeWeapon = w;
        if (f !== undefined) rp.isOnFire = f;
        rp.z = z || 0;
        rp.updateFromNetwork(x, y, r / 1000, n, h);
    }
}
