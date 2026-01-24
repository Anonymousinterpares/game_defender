import { World } from './World';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { Entity } from './Entity';
import { Projectile, ProjectileType } from '../entities/Projectile';
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
import { AIComponent } from './ecs/components/AIComponent';
import { ContactDamageSystem } from './ecs/systems/ContactDamageSystem';
import { ProjectileSystem } from './ecs/systems/ProjectileSystem';
import { DropSystem } from './ecs/systems/DropSystem';
import { DropComponent, DropType } from './ecs/components/DropComponent';
import { PlayerSegmentSystem } from './ecs/systems/PlayerSegmentSystem';
import { RenderSystem } from './ecs/systems/RenderSystem';
import { ParticleSystemECS } from './ecs/systems/ParticleSystemECS';
import { WeatherSystemECS } from './ecs/systems/WeatherSystemECS';
import { System } from './ecs/System';
import { TransformComponent } from './ecs/components/TransformComponent';
import { PhysicsComponent } from './ecs/components/PhysicsComponent';
import { HealthComponent } from './ecs/components/HealthComponent';
import { FireComponent } from './ecs/components/FireComponent';
import { TagComponent } from './ecs/components/TagComponent';
import { RenderComponent } from './ecs/components/RenderComponent';
import { SegmentComponent } from './ecs/components/SegmentComponent';
import { EntityFactory } from './ecs/EntityFactory';
import { EnemyRegistry } from '../entities/enemies/EnemyRegistry';

import { PluginManager } from './plugins/PluginManager';

export enum SimulationRole {
    SINGLEPLAYER,
    HOST,
    CLIENT
}

export class Simulation implements WeaponParent, CombatParent {
    public world: World;
    public heatMap: HeatMap;
    public player: Player;
    public playerEntityId: string = '';
    public spatialGrid: Quadtree<Entity>;

    public remotePlayers: RemotePlayer[] = [];
    public projectiles: Projectile[] = [];

    public cleanup(): void {
        this.projectiles = [];
        this.remotePlayers = [];
        // Reset heat map state if needed, though world rebuilds usually handle it. 
        // Explicit clear is safer.
        if (this.heatMap) this.heatMap.clear();
        this.entityManager.clear();
        this.spatialGrid.clear();
    }

    // Compatibility getters for systems not yet fully ECS-ified
    public get enemies(): any[] {
        const ids = this.entityManager.query(['tag']).filter(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'enemy');
        // This is a bridge. ideally WeaponSystem should query ECS directly.
        // For now, we return a minimalist object that looks like an Entity to satisfy checkHitbox/takeDamage
        return ids.map(id => {
            const transform = this.entityManager.getComponent<TransformComponent>(id, 'transform');
            const physics = this.entityManager.getComponent<PhysicsComponent>(id, 'physics');
            const health = this.entityManager.getComponent<HealthComponent>(id, 'health');

            if (!transform || !physics || !health) return null;

            return {
                id,
                type: this.entityManager.getComponent<AIComponent>(id, 'ai')?.dossier?.name || 'Scout',
                tag: 'enemy',
                x: transform.x,
                y: transform.y,
                rotation: transform.rotation,
                radius: physics.radius,
                active: health.active,
                checkHitbox: (px: number, py: number) => {
                    const dx = transform.x - px, dy = transform.y - py;
                    return dx * dx + dy * dy < physics.radius * physics.radius;
                },
                takeDamage: (amt: number) => {
                    health.health -= amt;
                    health.damageFlash = 0.2;
                    if (health.health <= 0) {
                        health.health = 0;
                        health.active = false;
                    }
                },
                getAllBodies: () => [{ x: transform.x, y: transform.y, radius: physics.radius }]
            };
        }).filter(e => e !== null);
    }

    public get drops(): any[] {
        const ids = this.entityManager.query(['tag']).filter(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'drop');
        return ids.map(id => {
            const transform = this.entityManager.getComponent<TransformComponent>(id, 'transform');
            const health = this.entityManager.getComponent<HealthComponent>(id, 'health');
            const drop = this.entityManager.getComponent<DropComponent>(id, 'drop');
            if (!transform || !health || !drop) return null;
            return {
                id,
                x: transform.x,
                y: transform.y,
                active: health.active,
                dropType: drop.dropType,
                type: drop.dropType, // Compatibility
                value: drop.value
            };
        }).filter(d => d !== null);
    }

    // ECS
    public entityManager: EntityManager;
    public physicsSystem: PhysicsSystem;
    private fireSystem: FireSystem;
    private inputSystem: InputSystem;
    private aiSystem: AISystem;
    private contactDamageSystem: ContactDamageSystem;
    public projectileSystem: ProjectileSystem;
    private dropSystem: DropSystem;
    private playerSegmentSystem: PlayerSegmentSystem;
    public renderSystem: RenderSystem;
    private particleSystemECS: ParticleSystemECS;
    public weatherSystemECS: WeatherSystemECS;
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
        (this.entityManager as any).heatMap = this.heatMap;
        this.spatialGrid = new Quadtree<Entity>({
            x: 0,
            y: 0,
            w: this.world.getWidthPixels(),
            h: this.world.getHeightPixels()
        });

        this.physicsSystem = new PhysicsSystem(this.world, this.spatialGrid);
        this.fireSystem = new FireSystem();
        this.inputSystem = new InputSystem();
        this.aiSystem = new AISystem(this.world);
        this.contactDamageSystem = new ContactDamageSystem();
        this.projectileSystem = new ProjectileSystem(this.world, this.heatMap, this.spatialGrid, this.combatSystem);
        this.dropSystem = new DropSystem(this);
        this.playerSegmentSystem = new PlayerSegmentSystem();
        this.renderSystem = new RenderSystem();
        this.particleSystemECS = new ParticleSystemECS(this.world);
        this.weatherSystemECS = new WeatherSystemECS();
        this.pluginManager = new PluginManager(this);

        // Particle Worker Init
        const roleStr = role === SimulationRole.HOST ? 'host' : (role === SimulationRole.CLIENT ? 'client' : 'single');
        ParticleSystem.getInstance().initWorker(this.world, roleStr);

        // Initialize Player at center
        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;

        this.player = new Player(centerX, centerY, null as any);
        this.player.setEntityManager(this.entityManager);

        this.playerEntityId = EntityFactory.createPlayer(this.entityManager, centerX, centerY);
        const ecsPlayer = this.entityManager.query(['tag']).find(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'player');
        if (ecsPlayer && ecsPlayer !== this.player.id) {
            this.reassignEntityId(ecsPlayer, this.player.id);
            this.playerEntityId = this.player.id;
        }

        // Link segments
        let leaderId = this.player.id;
        this.player.segments.forEach(seg => {
            seg.setEntityManager(this.entityManager);
            this.entityManager.addComponent(seg.id, new TransformComponent(seg.x, seg.y, seg.rotation));
            this.entityManager.addComponent(seg.id, new PhysicsComponent(0, 0, seg.radius));
            this.entityManager.addComponent(seg.id, new HealthComponent(seg.health, seg.maxHealth));
            this.entityManager.addComponent(seg.id, new FireComponent());
            this.entityManager.addComponent(seg.id, new RenderComponent('player_segment', '#cfaa6e', seg.radius));
            this.entityManager.addComponent(seg.id, new SegmentComponent(leaderId, 35));
            leaderId = seg.id;
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
        return (window as any).MultiplayerManagerInstance?.myId || 'pending';
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

    public reassignEntityId(oldId: string, newId: string): void {
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

        this.spatialGrid = new Quadtree<Entity>({
            x: 0,
            y: 0,
            w: this.world.getWidthPixels(),
            h: this.world.getHeightPixels()
        });

        this.entityManager.clear();
        (this.entityManager as any).heatMap = this.heatMap;
        this.physicsSystem = new PhysicsSystem(this.world, this.spatialGrid);
        this.aiSystem = new AISystem(this.world);
        this.contactDamageSystem = new ContactDamageSystem();
        this.projectileSystem = new ProjectileSystem(this.world, this.heatMap, this.spatialGrid, this.combatSystem);
        this.dropSystem = new DropSystem(this);
        this.fireSystem = new FireSystem();
        this.particleSystemECS = new ParticleSystemECS(this.world);
        this.weatherSystemECS = new WeatherSystemECS();
        this.renderSystem = new RenderSystem();
        this.pluginManager = new PluginManager(this);

        // Particle Worker Init
        const roleStr = this.role === SimulationRole.HOST ? 'host' : (this.role === SimulationRole.CLIENT ? 'client' : 'single');
        ParticleSystem.getInstance().initWorker(this.world, roleStr);

        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;

        this.playerEntityId = EntityFactory.createPlayer(this.entityManager, centerX, centerY);
        const ecsPlayer = this.entityManager.query(['tag']).find(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'player');
        if (ecsPlayer && ecsPlayer !== this.player.id) {
            this.reassignEntityId(ecsPlayer, this.player.id);
            this.playerEntityId = this.player.id;
        }

        // Link segments
        let leaderId = this.player.id;
        this.player.segments.forEach(seg => {
            seg.setEntityManager(this.entityManager);
            this.entityManager.addComponent(seg.id, new TransformComponent(seg.x, seg.y, seg.rotation));
            this.entityManager.addComponent(seg.id, new PhysicsComponent(0, 0, seg.radius));
            this.entityManager.addComponent(seg.id, new HealthComponent(seg.health, seg.maxHealth));
            this.entityManager.addComponent(seg.id, new FireComponent());
            this.entityManager.addComponent(seg.id, new RenderComponent('player_segment', '#cfaa6e', seg.radius));
            this.entityManager.addComponent(seg.id, new SegmentComponent(leaderId, 35));
            leaderId = seg.id;
        });

        this.remotePlayers = [];
        this.projectiles = [];
    }

    public update(dt: number, inputManager?: any): void {
        this.pluginManager.update(dt);

        if (inputManager) {
            this.inputSystem.update(dt, this.entityManager, inputManager);
            this.weaponSystem.update(dt, inputManager);
        }

        if (this.role !== SimulationRole.CLIENT) {
            this.aiSystem.update(dt, this.entityManager);
            this.contactDamageSystem.update(dt, this.entityManager);
            this.dropSystem.update(dt, this.entityManager);
        }

        this.combatSystem.update(dt);
        this.projectileSystem.update(dt, this.entityManager);
        this.fireSystem.update(dt, this.entityManager);
        this.physicsSystem.update(dt, this.entityManager);
        this.playerSegmentSystem.update(dt, this.entityManager);
        this.particleSystemECS.update(dt, this.entityManager);
        this.weatherSystemECS.update(dt, this.entityManager);

        this.customSystems.forEach(s => s.update(dt, this.entityManager));

        if (this.role !== SimulationRole.CLIENT) {
            this.updateSpawning(dt);
        }

        this.player.update(dt);
        this.remotePlayers.forEach(rp => rp.update(dt));

        // Cleanup Inactive Entities
        const enemyIds = this.entityManager.query(['tag', 'health']).filter(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'enemy');
        for (const eid of enemyIds) {
            const health = this.entityManager.getComponent<HealthComponent>(eid, 'health')!;
            if (!health.active) {
                const transform = this.entityManager.getComponent<TransformComponent>(eid, 'transform');
                if (transform) {
                    this.combatSystem.createExplosion(transform.x, transform.y, 20, 0);
                }
                this.entityManager.removeEntity(eid);
            }
        }

        this.projectiles = this.projectiles.filter(p => {
            const health = this.entityManager.getComponent<HealthComponent>(p.id, 'health');
            if (health && !health.active) {
                this.entityManager.removeEntity(p.id);
                return false;
            }
            return p.active;
        });

        const dropIds = this.entityManager.query(['tag', 'health']).filter(id => this.entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'drop');
        for (const did of dropIds) {
            const health = this.entityManager.getComponent<HealthComponent>(did, 'health')!;
            if (!health.active) {
                this.entityManager.removeEntity(did);
            }
        }

        this.updateSpatialGrid();
        this.heatMap.update(dt);
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number = 0, cameraY: number = 0): void {
        this.renderSystem.update(0, this.entityManager, ctx, this.physicsSystem.alpha, cameraX, cameraY);
    }

    private updateSpawning(dt: number): void {
        this.nextDropSpawn -= dt;
        if (this.nextDropSpawn <= 0) {
            this.spawnDrop();
            this.nextDropSpawn = 5 + Math.random() * 10;
        }

        this.nextEnemySpawn -= dt;
        if (this.nextEnemySpawn <= 0 && ConfigManager.getInstance().get<boolean>('Debug', 'enableEnemySpawning')) {
            this.spawnEnemy();
            this.nextEnemySpawn = 4 + Math.random() * 4;
        }
    }

    private updateSpatialGrid(): void {
        this.spatialGrid.clear();

        // Manual insertion for legacy/player objects that might not be fully in ECS query or need specific handling
        this.spatialGrid.insert(this.player);
        this.player.segments.forEach(s => this.spatialGrid.insert(s));

        // Insert all active physics entities from ECS
        const physicsEntities = this.entityManager.query(['transform', 'physics']);
        physicsEntities.forEach(id => {
            // Skip player (already inserted)
            if (id === this.player.id || this.player.segments.some(s => s.id === id)) return;

            const transform = this.entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = this.entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const health = this.entityManager.getComponent<HealthComponent>(id, 'health');

            if (health && !health.active) return;

            // Bridge to legacy Entity interface for Quadtree
            this.spatialGrid.insert({
                id,
                x: transform.x,
                y: transform.y,
                radius: physics.radius
            } as any);
        });

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
            const dx = p.x - x, dy = p.y - y;
            if (p.active && Math.sqrt(dx * dx + dy * dy) < radius) {
                p.active = false;
                count++;
            }
        });
        return count;
    }

    public spawnEnemy(): void {
        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2, dist = 400 + Math.random() * 400;
            const ex = this.player.x + Math.cos(angle) * dist, ey = this.player.y + Math.sin(angle) * dist;
            if (!this.world.isWall(ex, ey)) {
                const type = EnemyRegistry.getInstance().getRandomName();
                EntityFactory.createEnemy(this.entityManager, ex, ey, type);
                break;
            }
        }
    }

    public spawnDrop(): void {
        const pos = this.getRandomValidPos();
        const type = Math.random() < 0.8 ? DropType.COIN : DropType.BOOSTER;
        EntityFactory.createDrop(this.entityManager, pos.x, pos.y, type);
    }

    private getRandomValidPos(): { x: number, y: number } {
        for (let i = 0; i < 20; i++) {
            const rx = Math.random() * this.world.getWidthPixels(), ry = Math.random() * this.world.getHeightPixels();
            if (!this.world.isWall(rx, ry)) return { x: rx, y: ry };
        }
        return { x: 100, y: 100 };
    }

    public setLastShotTime(time: number): void { this.lastShotTime = time; }
    public startReload(weapon: string): void {
        if (this.weaponReloading.get(weapon)) return;
        const reloadTime = ConfigManager.getInstance().get<number>('Weapons', weapon + 'ReloadTime');
        const configKey = weapon === 'laser' || weapon === 'ray' || weapon === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
        if (reloadTime <= 0) {
            this.weaponAmmo.set(weapon, ConfigManager.getInstance().get<number>('Weapons', weapon + configKey));
            return;
        }
        this.weaponReloading.set(weapon, true);
        this.weaponReloadTimer.set(weapon, reloadTime);
        EventBus.getInstance().emit(GameEvent.WEAPON_RELOAD, { x: this.player.x, y: this.player.y, ownerId: this.myId });
    }
}