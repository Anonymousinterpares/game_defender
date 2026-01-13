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
import { ContactDamageSystem } from './ecs/systems/ContactDamageSystem';
import { ProjectileSystem } from './ecs/systems/ProjectileSystem';
import { DropSystem } from './ecs/systems/DropSystem';
import { RenderSystem } from './ecs/systems/RenderSystem';
import { System } from './ecs/System';
import { TransformComponent } from './ecs/components/TransformComponent';
import { PhysicsComponent } from './ecs/components/PhysicsComponent';
import { HealthComponent } from './ecs/components/HealthComponent';
import { FireComponent } from './ecs/components/FireComponent';
import { TagComponent } from './ecs/components/TagComponent';
import { RenderComponent } from './ecs/components/RenderComponent';
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
    private contactDamageSystem: ContactDamageSystem;
    public projectileSystem: ProjectileSystem;
    private dropSystem: DropSystem;
    public renderSystem: RenderSystem;
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
        this.renderSystem = new RenderSystem();
        this.pluginManager = new PluginManager(this);

        // Initialize Player at center
        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;

        this.player = new Player(centerX, centerY, null as any);
        this.player.setEntityManager(this.entityManager);
        this.entities.push(this.player);

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
            this.entityManager.addComponent(seg.id, new RenderComponent('player_segment', '#cfaa6e', seg.radius));
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
        this.physicsSystem = new PhysicsSystem(this.world, this.spatialGrid);
        this.aiSystem = new AISystem(this.world);
        this.contactDamageSystem = new ContactDamageSystem();
        this.projectileSystem = new ProjectileSystem(this.world, this.heatMap, this.spatialGrid, this.combatSystem);
        this.dropSystem = new DropSystem(this);
        this.fireSystem = new FireSystem();
        this.renderSystem = new RenderSystem();
        this.pluginManager = new PluginManager(this);

        const centerX = this.world.getWidthPixels() / 2;
        const centerY = this.world.getHeightPixels() / 2;

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
            this.entityManager.addComponent(seg.id, new RenderComponent('player_segment', '#cfaa6e', seg.radius));
        });

        this.entities = [this.player, ...this.remotePlayers];
        this.enemies = [];
        this.drops = [];
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

        this.customSystems.forEach(s => s.update(dt, this.entityManager));

        if (this.role !== SimulationRole.CLIENT) {
            this.updateSpawning(dt);
        }

        this.player.update(dt);
        this.enemies.forEach(e => e.update(dt, this.player));

        const fireDPS = ConfigManager.getInstance().get<number>('Fire', 'dps');
        const baseExtinguish = ConfigManager.getInstance().get<number>('Fire', 'baseExtinguishChance');
        const catchChance = ConfigManager.getInstance().get<number>('Fire', 'catchChance');

        [this.player, ...this.enemies, ...this.remotePlayers].forEach(e => {
            e.handleFireLogic(dt, fireDPS, baseExtinguish);
            if (e.active && !e.isOnFire && this.heatMap) {
                const bodies = e.getAllBodies();
                let isDangerous = false;
                for (const b of bodies) {
                    if (this.heatMap.checkFireArea(b.x, b.y, b.radius) ||
                        this.heatMap.getMaxIntensityArea(b.x, b.y, b.radius) > 0.8) {
                        isDangerous = true;
                        break;
                    }
                }
                if (isDangerous && Math.random() < catchChance * dt) {
                    e.isOnFire = true;
                }
            }
        });
        this.drops.forEach(d => d.update(dt));
        this.remotePlayers.forEach(rp => rp.update(dt));

        // Cleanup Inactive Entities
        this.enemies = this.enemies.filter(e => {
            if (!e.active) {
                this.combatSystem.createExplosion(e.x, e.y, 20, 0);
                this.entityManager.removeEntity(e.id);
            }
            return e.active;
        });

        this.projectiles = this.projectiles.filter(p => {
            const health = this.entityManager.getComponent<HealthComponent>(p.id, 'health');
            if (health && !health.active) {
                this.entityManager.removeEntity(p.id);
                return false;
            }
            return p.active;
        });

        this.drops = this.drops.filter(d => {
            const health = this.entityManager.getComponent<HealthComponent>(d.id, 'health');
            if (health && !health.active) {
                this.entityManager.removeEntity(d.id);
                return false;
            }
            return d.active;
        });

        this.updateSpatialGrid();
        this.heatMap.update(dt);
    }

    public render(ctx: CanvasRenderingContext2D): void {
        this.renderSystem.update(0, this.entityManager, ctx, this.physicsSystem.alpha);
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
                const id = EntityFactory.createEnemy(this.entityManager, ex, ey, type);
                const e = new Enemy(ex, ey);
                e.id = id;
                e.setEntityManager(this.entityManager);
                this.enemies.push(e);
                break;
            }
        }
    }

    public spawnDrop(): void {
        const pos = this.getRandomValidPos();
        const type = Math.random() < 0.8 ? DropType.COIN : DropType.BOOSTER;
        const id = EntityFactory.createDrop(this.entityManager, pos.x, pos.y, type);
        const d = new Drop(pos.x, pos.y, type);
        d.id = id;
        d.setEntityManager(this.entityManager);
        this.drops.push(d);
    }

    public spawnDropWithId(id: string, x: number, y: number, type: DropType): void {
        EntityFactory.createDrop(this.entityManager, x, y, type);
        const ecsDrops = this.entityManager.query(['tag']).filter(eid => this.entityManager.getComponent<TagComponent>(eid, 'tag')?.tag === 'drop');
        const lastDrop = ecsDrops[ecsDrops.length - 1];
        if (lastDrop) this.reassignEntityId(lastDrop, id);
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