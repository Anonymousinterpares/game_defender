import { World } from './World';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { PhysicsEngine } from './PhysicsEngine';
import { Entity } from './Entity';
import { Projectile, ProjectileType } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Drop, DropType } from '../entities/Drop';
import { HeatMap, MaterialType } from './HeatMap';
import { Quadtree } from '../utils/Quadtree';
import { ConfigManager } from '../config/MasterConfig';
import { WeaponSystem, WeaponParent } from '../systems/WeaponSystem';
import { CombatSystem, CombatParent } from '../systems/CombatSystem';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { ParticleSystem } from './ParticleSystem';
import { EventBus, GameEvent } from './EventBus';

import { EntityManager } from './ecs/EntityManager';
import { MovementSystem } from './ecs/systems/MovementSystem';
import { FireSystem } from './ecs/systems/FireSystem';
import { TransformComponent } from './ecs/components/TransformComponent';
import { PhysicsComponent } from './ecs/components/PhysicsComponent';
import { HealthComponent } from './ecs/components/HealthComponent';
import { FireComponent } from './ecs/components/FireComponent';

export enum SimulationRole {
    SINGLEPLAYER,
    HOST,
    CLIENT
}

export class Simulation implements WeaponParent, CombatParent {
    public world: World;
    public physics: PhysicsEngine;
    public heatMap: HeatMap;
    public player: Player;
    public spatialGrid: Quadtree<Entity>;
    
    public entities: Entity[] = [];
    public enemies: Enemy[] = [];
    public remotePlayers: RemotePlayer[] = [];
    public drops: Drop[] = [];
    public projectiles: Projectile[] = [];
    
    // ECS
    public entityManager: EntityManager;
    private movementSystem: MovementSystem;
    private fireSystem: FireSystem;
    
    public weaponSystem: WeaponSystem;
    public combatSystem: CombatSystem;
    
    public coinsCollected: number = 0;
    public lastShotTime: number = 0;
    public shootCooldown: number = 0.2;
    
    public weaponAmmo: Map<string, number> = new Map();
    public unlockedWeapons: Set<string> = new Set(['cannon']);
    public weaponReloading: Map<string, boolean> = new Map();
    public weaponReloadTimer: Map<string, number> = new Map();

    private nextDropSpawn: number = 5;
    private nextEnemySpawn: number = 3;
    private role: SimulationRole;

    constructor(role: SimulationRole, seed?: number) {
        this.role = role;
        this.world = new World(seed);
        this.physics = new PhysicsEngine();
        this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
        
        this.world.setHeatMap(this.heatMap);
        this.physics.setWorld(this.world);
        
        this.weaponSystem = new WeaponSystem(this);
        this.combatSystem = new CombatSystem(this);
        
        // ECS Init
        this.entityManager = new EntityManager();
        this.movementSystem = new MovementSystem();
        this.fireSystem = new FireSystem();
        
        this.spatialGrid = new Quadtree<Entity>({ 
            x: 0, 
            y: 0, 
            w: this.world.getWidthPixels(), 
            h: this.world.getHeightPixels() 
        });

        // Initialize Player at center
        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;
        // We'll let the Scene pass the InputManager to the player later or here
        // For now, we just need a player instance.
        this.player = new Player(centerX, centerY, null as any); 
        this.entities.push(this.player);
        this.physics.addBody(this.player);
        // Player segments are not added to physics individually by default, 
        // they are managed by Player class but can be retrieved via getAllBodies() if needed.
        // For RemotePlayers, we MUST NOT add segments to physics locally.

        this.initWeapons();
        this.shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
        this.coinsCollected = ConfigManager.getInstance().get<number>('Debug', 'startingCoins') || 0;
    }

    private initWeapons(): void {
        const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
        const alwaysOn = ConfigManager.getInstance().get<boolean>('Debug', 'devModeAlwaysOn');
        
        weapons.forEach(w => {
            const configKey = w === 'laser' || w === 'ray' || w === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
            const max = ConfigManager.getInstance().get<number>('Weapons', w + configKey);
            this.weaponAmmo.set(w, max);
            this.weaponReloading.set(w, false);
            this.weaponReloadTimer.set(w, 0);
            if (alwaysOn) this.unlockedWeapons.add(w);
        });
    }

    public get myId(): string {
        if (this.role === SimulationRole.SINGLEPLAYER) return 'local';
        return MultiplayerManager.getInstance().myId || 'pending';
    }

    public setRole(role: SimulationRole): void {
        this.role = role;
    }

    public reset(seed?: number): void {
        this.world = new World(seed);
        this.physics = new PhysicsEngine();
        this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
        
        this.world.setHeatMap(this.heatMap);
        this.physics.setWorld(this.world);
        
        // Re-add players to new physics
        this.physics.addBody(this.player);
        this.remotePlayers.forEach(rp => this.physics.addBody(rp));
        
        // Clear logic state
        this.entities = [this.player, ...this.remotePlayers];
        this.enemies = [];
        this.drops = [];
        this.projectiles = [];
        
        this.spatialGrid = new Quadtree<Entity>({ 
            x: 0, 
            y: 0, 
            w: this.world.getWidthPixels(), 
            h: this.world.getHeightPixels() 
        });
    }

    public update(dt: number, inputManager?: any): void {
        // ECS Sync (Phase 4 bridge)
        this.syncEntitiesToECS();

        // 1. Systems Update
        if (inputManager) {
            this.weaponSystem.update(dt, inputManager);
        }
        this.combatSystem.update(dt);
        
        this.fireSystem.update(dt, this.entityManager);
        this.movementSystem.update(dt, this.entityManager);

        // Sync BACK to legacy objects
        this.syncBackFromECS();

        // 2. Physics Step
        this.physics.update(dt);
        Entity.setInterpolationAlpha(this.physics.alpha);

        // 3. Spawning (Only SP or Host)
        if (this.role !== SimulationRole.CLIENT) {
            this.updateSpawning(dt);
        }

        // 4. Entity Updates
        this.updateEntities(dt);

        // 5. Fire & Heat Logic
        this.updateEnvironmentLogic(dt);

        // 6. Cleanup
        this.cleanupEntities();

        // 7. Spatial Grid Update
        this.updateSpatialGrid();

        this.heatMap.update(dt);
    }

    private syncBackFromECS(): void {
        const all = [this.player, ...this.player.segments, ...this.enemies, ...this.remotePlayers];
        all.forEach(e => {
            const id = e.id;
            const t = this.entityManager.getComponent<TransformComponent>(id, 'transform');
            const h = this.entityManager.getComponent<HealthComponent>(id, 'health');
            const f = this.entityManager.getComponent<FireComponent>(id, 'fire');

            if (t) {
                e.x = t.x;
                e.y = t.y;
                e.rotation = t.rotation;
                e.prevX = t.prevX;
                e.prevY = t.prevY;
            }
            if (h) {
                e.health = h.health;
                e.damageFlash = h.damageFlash;
                e.visualScale = h.visualScale;
                e.active = h.active;
            }
            if (f) {
                e.isOnFire = f.isOnFire;
                (e as any).fireTimer = f.fireTimer;
                (e as any).extinguishChance = f.extinguishChance;
            }
        });
    }

    private syncEntitiesToECS(): void {
        const all = [this.player, ...this.player.segments, ...this.enemies, ...this.remotePlayers];
        all.forEach(e => this.syncLegacyEntity(e));
    }

    private syncLegacyEntity(e: Entity): void {
        const id = e.id;
        if (!this.entityManager.hasComponent(id, 'transform')) {
            this.entityManager.addComponent(id, new TransformComponent(e.x, e.y, e.rotation, e.prevX, e.prevY));
            this.entityManager.addComponent(id, new PhysicsComponent(e.vx, e.vy, e.radius, e.isStatic));
            this.entityManager.addComponent(id, new HealthComponent(e.health, e.maxHealth, e.damageFlash, e.visualScale, e.active));
            this.entityManager.addComponent(id, new FireComponent(e.isOnFire, (e as any).fireTimer || 0, (e as any).extinguishChance || 0.5));
        }

        const t = this.entityManager.getComponent<TransformComponent>(id, 'transform')!;
        const p = this.entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
        const h = this.entityManager.getComponent<HealthComponent>(id, 'health')!;
        const f = this.entityManager.getComponent<FireComponent>(id, 'fire')!;

        t.x = e.x; t.y = e.y; t.rotation = e.rotation;
        p.vx = e.vx; p.vy = e.vy;
        h.health = e.health; h.active = e.active;
        f.isOnFire = e.isOnFire;
    }

    private updateSpawning(dt: number): void {
        this.nextDropSpawn -= dt;
        if (this.nextDropSpawn <= 0) {
            this.spawnDrop();
            this.nextDropSpawn = 5 + Math.random() * 10;
        }

        this.nextEnemySpawn -= dt;
        if (this.nextEnemySpawn <= 0) {
            if (ConfigManager.getInstance().get<boolean>('Debug', 'enableEnemySpawning')) {
                this.spawnEnemy();
            }
            this.nextEnemySpawn = 4 + Math.random() * 4;
        }
    }

    private updateEntities(dt: number): void {
        this.player.update(dt);
        
        // Host/SP updates enemies AI
        if (this.role !== SimulationRole.CLIENT) {
            this.enemies.forEach(e => e.update(dt, this.player));
        }

        this.drops.forEach(d => d.update(dt));
        this.remotePlayers.forEach(rp => rp.update(dt));

        this.projectiles = this.projectiles.filter(p => {
            const oldX = p.x;
            const oldY = p.y;
            p.update(dt);

            if (p.active && this.world) {
                // RAYCAST CCD
                const dx = p.x - oldX;
                const dy = p.y - oldY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const angle = Math.atan2(dy, dx);
                
                // Only raycast if moving significantly
                const hit = dist > 1 ? this.world.raycast(oldX, oldY, angle, dist) : null;
                const hitPoint = hit || this.world.checkWallCollision(p.x, p.y, p.radius);
                const hitBorder = p.x < 0 || p.x > this.world.getWidthPixels() || p.y < 0 || p.y > this.world.getHeightPixels();

                if (hitPoint || hitBorder) {
                    const cx = hitPoint ? hitPoint.x : p.x;
                    const cy = hitPoint ? hitPoint.y : p.y;
                    
                    // Stop visually for everyone immediately
                    p.active = false;

                    // Authoritative logic: Only Host/SP or local owner (for request) handles damage
                    if (this.role !== SimulationRole.CLIENT || p.shooterId === this.myId) {
                        this.handleProjectileWorldHit(p, cx, cy);
                    }
                }
            }
            return p.active;
        });
    }

    private handleProjectileWorldHit(p: Projectile, x: number, y: number): void {
        if (p.aoeRadius > 0) {
            this.combatSystem.createExplosion(x, y, p.aoeRadius, p.damage, p.shooterId, p.type);
        } else {
            p.onWorldHit(this.heatMap, x, y);
            EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, { 
                x, y, 
                projectileType: p.type, 
                hitType: 'wall' 
            });

            // Sync for Multiplayer
            if (this.role === SimulationRole.CLIENT) {
                const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                const tx = Math.floor(x / tileSize);
                const ty = Math.floor(y / tileSize);
                // We need to know who the host is. In this phase, we'll assume there is a way to get it or just broadcast.
                // Actually, sendTo host is better. We'll use a hack or just broadcast for now as MultiplayerManager.broadcast 
                // from a client sends to the host in a 1:1 connection.
                MultiplayerManager.getInstance().broadcast(NetworkMessageType.WORLD_DAMAGE_REQUEST, {
                    tx, ty, m: (this.world as any).tiles[ty][tx], pt: p.type, hx: x, hy: y
                });
            } else if (this.role === SimulationRole.HOST) {
                const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                const tx = Math.floor(x / tileSize);
                const ty = Math.floor(y / tileSize);
                const hpData = this.heatMap.getTileHP(tx, ty);
                MultiplayerManager.getInstance().broadcast(NetworkMessageType.WORLD_UPDATE, {
                    tx, ty, m: (this.world as any).tiles[ty][tx],
                    hp: hpData ? Array.from(hpData) : null,
                    pt: p.type, hx: x, hy: y
                });
            }
        }
    }

    private updateEnvironmentLogic(dt: number): void {
        const fireDPS = ConfigManager.getInstance().get<number>('Fire', 'dps');
        const baseExtinguish = ConfigManager.getInstance().get<number>('Fire', 'baseExtinguishChance');
        const catchChance = ConfigManager.getInstance().get<number>('Fire', 'catchChance');

        const allPotential = [this.player, ...this.player.segments, ...this.enemies, ...this.remotePlayers];
        
        allPotential.forEach(e => {
            if (!e.active) return;
            
            // Heat damage & Ignition
            const maxIntensity = this.heatMap.getMaxIntensityArea(e.x, e.y, e.radius);
            if (!e.isOnFire && maxIntensity > 0.05) {
                if (Math.random() < (10 + 90 * maxIntensity) / 100 * dt) e.isOnFire = true;
            }
            if (maxIntensity > 0.05) e.takeDamage(Math.ceil(20 * maxIntensity) * dt);
            
            if (!e.isOnFire && this.heatMap.checkFireArea(e.x, e.y, e.radius)) {
                if (Math.random() < catchChance * dt * 5) e.isOnFire = true;
            }

            e.handleFireLogic(dt, fireDPS, baseExtinguish);
        });

        // Fire spread
        const allActive = allPotential.filter(e => e.active);
        const allBurning = allActive.filter(e => e.isOnFire);
        allBurning.forEach(source => {
            allActive.forEach(target => {
                if (source !== target && !target.isOnFire) {
                    const dx = source.x - target.x;
                    const dy = source.y - target.y;
                    if (dx*dx + dy*dy < (source.radius + target.radius)**2) {
                        if (Math.random() < catchChance * dt) target.isOnFire = true;
                    }
                }
            });
        });
    }

    private cleanupEntities(): void {
        this.enemies = this.enemies.filter(e => {
            if (!e.active) {
                this.physics.removeBody(e);
                if (this.role === SimulationRole.HOST) {
                    MultiplayerManager.getInstance().broadcast(NetworkMessageType.ENTITY_DESTROY, { type: 'enemy', id: e.id });
                }
            }
            return e.active;
        });
        this.drops = this.drops.filter(d => d.active);
    }

    private updateSpatialGrid(): void {
        this.spatialGrid.clear();
        this.spatialGrid.insert(this.player);
        this.enemies.forEach(e => this.spatialGrid.insert(e));
        this.projectiles.forEach(p => this.spatialGrid.insert(p));
        this.remotePlayers.forEach(rp => {
            if (rp.active) {
                this.spatialGrid.insert(rp);
                rp.segments.forEach(s => this.spatialGrid.insert(s));
            }
        });
    }

    public removeProjectileAt(x: number, y: number, radius: number): void {
        this.projectiles.forEach(p => {
            const dx = p.x - x;
            const dy = p.y - y;
            if (Math.sqrt(dx*dx + dy*dy) < radius) {
                p.active = false;
            }
        });
    }

    public spawnEnemy(): void {
        for(let i=0; i<10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 400 + Math.random() * 400;
            const ex = this.player.x + Math.cos(angle) * dist;
            const ey = this.player.y + Math.sin(angle) * dist;
            if (!this.world.isWall(ex, ey)) {
                const e = new Enemy(ex, ey);
                this.enemies.push(e);
                this.physics.addBody(e);
                break;
            }
        }
    }

    public spawnDrop(): void {
        const pos = this.getRandomValidPos();
        this.drops.push(new Drop(pos.x, pos.y, Math.random() < 0.8 ? DropType.COIN : DropType.BOOSTER));
    }

    private getRandomValidPos(): {x: number, y: number} {
        for(let i=0; i<20; i++) {
            const rx = Math.random() * this.world.getWidthPixels();
            const ry = Math.random() * this.world.getHeightPixels();
            if (!this.world.isWall(rx, ry)) return {x: rx, y: ry};
        }
        return {x: 100, y: 100};
    }

    // WeaponParent implementation
    public setLastShotTime(time: number): void { this.lastShotTime = time; }
    public startReload(weapon: string): void {
        if (this.weaponReloading.get(weapon)) return;
        const reloadTime = ConfigManager.getInstance().get<number>('Weapons', weapon + 'ReloadTime');
        if (reloadTime <= 0) {
            const configKey = weapon === 'laser' || weapon === 'ray' || weapon === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
            this.weaponAmmo.set(weapon, ConfigManager.getInstance().get<number>('Weapons', weapon + configKey));
            return;
        }
        this.weaponReloading.set(weapon, true);
        this.weaponReloadTimer.set(weapon, reloadTime);
        EventBus.getInstance().emit(GameEvent.WEAPON_RELOAD, { 
            x: this.player.x, y: this.player.y, 
            ownerId: this.myId 
        });
    }
}