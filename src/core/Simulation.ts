import { World } from './World';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
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
import { PhysicsSystem } from './ecs/systems/PhysicsSystem';
import { FireSystem } from './ecs/systems/FireSystem';
import { InputSystem } from './ecs/systems/InputSystem';
import { AISystem } from './ecs/systems/AISystem';
import { RenderSystem } from './ecs/systems/RenderSystem';
import { System } from './ecs/System';
import { TransformComponent } from './ecs/components/TransformComponent';
import { PhysicsComponent } from './ecs/components/PhysicsComponent';
import { HealthComponent } from './ecs/components/HealthComponent';
import { FireComponent } from './ecs/components/FireComponent';
import { TagComponent } from './ecs/components/TagComponent';
import { RenderComponent } from './ecs/components/RenderComponent';
import { EntityFactory } from './ecs/EntityFactory';

import { PluginManager } from './plugins/PluginManager';

export enum SimulationRole {
    SINGLEPLAYER,
    HOST,
    CLIENT
}

export class Simulation implements WeaponParent, CombatParent {
    public world: World;
    public heatMap: HeatMap;
    public player: Player; // KEEPING for compatibility for now, but will transition
    public playerEntityId: string = '';
    public spatialGrid: Quadtree<Entity>;
    
    public entities: Entity[] = [];
    public enemies: Enemy[] = [];
    public remotePlayers: RemotePlayer[] = [];
    public drops: Drop[] = [];
    public projectiles: Projectile[] = [];
    
    // ECS
    public entityManager: EntityManager;
    public physicsSystem: PhysicsSystem;
    private fireSystem: FireSystem;
    private inputSystem: InputSystem;
    private aiSystem: AISystem;
    private renderSystem: RenderSystem;
    private customSystems: System[] = [];

    public pluginManager: PluginManager;
    
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
        this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
        
        this.world.setHeatMap(this.heatMap);
        
        this.weaponSystem = new WeaponSystem(this);
        this.combatSystem = new CombatSystem(this);
        
        // ECS Init
        this.entityManager = new EntityManager();
        this.physicsSystem = new PhysicsSystem(this.world);
        this.fireSystem = new FireSystem();
        this.inputSystem = new InputSystem();
        this.aiSystem = new AISystem();
        this.renderSystem = new RenderSystem();
        this.pluginManager = new PluginManager(this);
        
        this.spatialGrid = new Quadtree<Entity>({ 
            x: 0, 
            y: 0, 
            w: this.world.getWidthPixels(), 
            h: this.world.getHeightPixels() 
        });

        // Initialize Player at center
        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;
        
        // LEGACY PLAYER (Still needed for some parts)
        this.player = new Player(centerX, centerY, null as any); 
        this.player.setEntityManager(this.entityManager); // LINKING
        this.entities.push(this.player);

        // ECS PLAYER (Created for all roles, as every simulation has a 'local' player)
        this.playerEntityId = EntityFactory.createPlayer(this.entityManager, centerX, centerY);
        const ecsPlayer = this.entityManager.query(['tag']).find(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'player');
        if (ecsPlayer && ecsPlayer !== this.player.id) {
            this.reassignEntityId(ecsPlayer, this.player.id);
            this.playerEntityId = this.player.id;
        }

        // Link segments
        this.player.segments.forEach(seg => {
            seg.setEntityManager(this.entityManager);
            this.entityManager.addComponent(seg.id, new TransformComponent(seg.x, seg.y, seg.rotation));
            this.entityManager.addComponent(seg.id, new PhysicsComponent(0, 0, seg.radius));
            this.entityManager.addComponent(seg.id, new HealthComponent(seg.health, seg.maxHealth));
            this.entityManager.addComponent(seg.id, new FireComponent());
        });

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

    public registerSystem(system: System): void {
        this.customSystems.push(system);
    }

    public unregisterSystem(systemId: string): void {
        this.customSystems = this.customSystems.filter(s => (s as any).id !== systemId);
    }

    private reassignEntityId(oldId: string, newId: string): void {
        const comps = ['transform', 'physics', 'health', 'fire', 'render', 'tag', 'input', 'ai'];
        comps.forEach(type => {
            const c = this.entityManager.getComponent(oldId, type);
            if (c) {
                this.entityManager.addComponent(newId, c);
                this.entityManager.removeComponent(oldId, type);
            }
        });
        this.entityManager.removeEntity(oldId);
    }

    public reset(seed?: number): void {
        this.world = new World(seed);
        this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
        this.world.setHeatMap(this.heatMap);

        // ECS Reset
        this.entityManager.clear();
        this.physicsSystem = new PhysicsSystem(this.world);
        
        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;
        
        // Re-init local player ECS components
        this.playerEntityId = EntityFactory.createPlayer(this.entityManager, centerX, centerY);
        const ecsPlayer = this.entityManager.query(['tag']).find(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'player');
        if (ecsPlayer && ecsPlayer !== this.player.id) {
            this.reassignEntityId(ecsPlayer, this.player.id);
            this.playerEntityId = this.player.id;
        }

        // Link segments
        this.player.segments.forEach(seg => {
            seg.setEntityManager(this.entityManager);
            this.entityManager.addComponent(seg.id, new TransformComponent(seg.x, seg.y, seg.rotation));
            this.entityManager.addComponent(seg.id, new PhysicsComponent(0, 0, seg.radius));
            this.entityManager.addComponent(seg.id, new HealthComponent(seg.health, seg.maxHealth));
            this.entityManager.addComponent(seg.id, new FireComponent());
        });
        
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
        // Plugin Update
        this.pluginManager.update(dt);

        // 1. Systems Update
        if (inputManager) {
            this.inputSystem.update(dt, this.entityManager, inputManager);
            this.weaponSystem.update(dt, inputManager);
        }
        
        if (this.role !== SimulationRole.CLIENT) {
            this.aiSystem.update(dt, this.entityManager);
        }

        this.combatSystem.update(dt);
        
        this.fireSystem.update(dt, this.entityManager);
        
        // 2. Physics & Movement (Consolidated)
        this.physicsSystem.update(dt, this.entityManager);
        Entity.setInterpolationAlpha(this.physicsSystem.alpha);

        // Update Custom Systems
        this.customSystems.forEach(s => s.update(dt, this.entityManager));

        // 3. Spawning (Only SP or Host)
        if (this.role !== SimulationRole.CLIENT) {
            this.updateSpawning(dt);
        }

        // 4. Entity Updates
        this.player.update(dt);
        this.enemies.forEach(e => e.update(dt, this.player));

        // 5. Entity Visual Updates (legacy cleanup/flash timers only)
        const fireDPS = ConfigManager.getInstance().get<number>('Fire', 'dps');
        const baseExtinguish = ConfigManager.getInstance().get<number>('Fire', 'baseExtinguishChance');
        const catchChance = ConfigManager.getInstance().get<number>('Fire', 'catchChance');

        [this.player, ...this.enemies, ...this.remotePlayers].forEach(e => {
            e.handleFireLogic(dt, fireDPS, baseExtinguish);
            
            // Environmental Fire: Catch fire from burning tiles, high heat, or molten surfaces
            if (e.active && !e.isOnFire && this.heatMap) {
                const bodies = e.getAllBodies();
                let isDangerous = false;

                for (const b of bodies) {
                    const isTouchingFire = this.heatMap.checkFireArea(b.x, b.y, b.radius);
                    const heatIntensity = this.heatMap.getMaxIntensityArea(b.x, b.y, b.radius);
                    const moltenIntensity = this.heatMap.getMaxMoltenArea(b.x, b.y, b.radius);
                    
                    if (isTouchingFire || heatIntensity > 0.8 || moltenIntensity > 0.1) {
                        isDangerous = true;
                        break;
                    }
                }

                if (isDangerous && Math.random() < catchChance * dt) {
                    e.isOnFire = true;
                    // If it's the local player, broadcast this to others
                    if (e === this.player && this.role !== SimulationRole.SINGLEPLAYER) {
                        MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_HIT, {
                            id: this.myId,
                            damage: 0,
                            killerId: 'environment',
                            ignite: true
                        });
                    }
                }
            }
        });

        this.drops.forEach(d => d.update(dt));
        this.remotePlayers.forEach(rp => rp.update(dt));

        // Projectile world hits
        this.updateProjectiles(dt);

        // 5. Cleanup
        this.cleanupEntities();

        // 6. Spatial Grid Update
        this.updateSpatialGrid();

        this.heatMap.update(dt);
    }

    public render(ctx: CanvasRenderingContext2D): void {
        this.renderSystem.update(0, this.entityManager, ctx);
    }

    private updateProjectiles(dt: number): void {
        this.projectiles = this.projectiles.filter(p => {
            const oldX = p.x;
            const oldY = p.y;
            p.update(dt);

            if (p.active && this.world) {
                const dx = p.x - oldX;
                const dy = p.y - oldY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const angle = Math.atan2(dy, dx);
                const hit = dist > 1 ? this.world.raycast(oldX, oldY, angle, dist) : null;
                const hitPoint = hit || this.world.checkWallCollision(p.x, p.y, p.radius);
                const hitBorder = p.x < 0 || p.x > this.world.getWidthPixels() || p.y < 0 || p.y > this.world.getHeightPixels();

                if (hitPoint || hitBorder) {
                    const cx = hitPoint ? hitPoint.x : p.x;
                    const cy = hitPoint ? hitPoint.y : p.y;
                    p.active = false;
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
                MultiplayerManager.getInstance().broadcast(NetworkMessageType.WORLD_DAMAGE_REQUEST, {
                    tx, ty, m: this.world.getTile(tx, ty), pt: p.type, hx: x, hy: y
                });
            } else if (this.role === SimulationRole.HOST) {
                const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                const tx = Math.floor(x / tileSize);
                const ty = Math.floor(y / tileSize);
                const hpData = this.heatMap.getTileHP(tx, ty);
                MultiplayerManager.getInstance().broadcast(NetworkMessageType.WORLD_UPDATE, {
                    tx, ty, m: this.world.getTile(tx, ty),
                    hp: hpData ? Array.from(hpData) : null,
                    pt: p.type, hx: x, hy: y
                });
            }
        }
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

    private cleanupEntities(): void {
        this.enemies = this.enemies.filter(e => {
            if (!e.active) {
                // Death Animation: small explosion, no damage
                this.combatSystem.createExplosion(e.x, e.y, 20, 0);

                if (this.role === SimulationRole.HOST) {
                    MultiplayerManager.getInstance().broadcast(NetworkMessageType.ENTITY_DESTROY, { type: 'enemy', id: e.id });
                }
                
                // Remove from ECS
                this.entityManager.removeEntity(e.id);
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

    public removeProjectileAt(x: number, y: number, radius: number): number {
        let count = 0;
        this.projectiles.forEach(p => {
            const dx = p.x - x;
            const dy = p.y - y;
            if (p.active && Math.sqrt(dx*dx + dy*dy) < radius) {
                p.active = false;
                count++;
            }
        });
        return count;
    }

    public spawnEnemy(): void {
        for(let i=0; i<10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 400 + Math.random() * 400;
            const ex = this.player.x + Math.cos(angle) * dist;
            const ey = this.player.y + Math.sin(angle) * dist;
            if (!this.world.isWall(ex, ey)) {
                const id = EntityFactory.createEnemy(this.entityManager, ex, ey);
                
                const e = new Enemy(ex, ey);
                e.id = id; 
                e.setEntityManager(this.entityManager); // LINKING
                this.enemies.push(e);
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