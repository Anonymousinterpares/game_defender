import { World } from './World';
import { ParticleType, FLAG_ACTIVE, MAX_PARTICLES } from './ParticleConstants';
import { EventBus, GameEvent } from './EventBus';
import { ConfigManager } from '../config/MasterConfig';
import { ParticleData, ParticleTarget } from './particles/ParticleData';
import { ParticleEmitter } from './particles/ParticleEmitter';
import { ParticleSimulation, WorldCollision } from './particles/ParticleSimulation';
import { CPUParticleRenderer } from './particles/CPUParticleRenderer';
import { GPUParticleSystem } from './gpu/particles/GPUParticleSystem';
import { WeatherManager } from './WeatherManager';

export type { ParticleTarget };

export class ParticleSystem {
    private static instance: ParticleSystem;

    private data: ParticleData;
    private emitter: ParticleEmitter;
    private renderer: CPUParticleRenderer;
    private gpuSystem: GPUParticleSystem | null = null;

    public onSmokeSpawned: ((x: number, y: number, color: string) => void) | null = null;
    // Phase 3: Add callback for projectile/explosion velocity injection
    public onVelocitySplatRequested: ((x: number, y: number, vx: number, vy: number, radius: number) => void) | null = null;
    public onClear: (() => void) | null = null;

    public setGPUSystem(sys: GPUParticleSystem | null) {
        this.gpuSystem = sys;
    }

    private worker: Worker;
    private isWorkerBusy: boolean = false;

    // For handling events from worker
    private pendingDamage: { targetIdx: number, damage: number }[] = [];
    private pendingHeat: { x: number, y: number, intensity: number, radius: number }[] = [];

    private constructor() {
        this.data = new ParticleData();
        this.emitter = new ParticleEmitter(this.data);
        this.renderer = new CPUParticleRenderer(this.data);

        // Initialize Worker
        this.worker = new Worker(new URL('../workers/particle.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'updated') {
                this.isWorkerBusy = false;
            } else if (type === 'events') {
                if (data.damageEvents) this.pendingDamage.push(...data.damageEvents);
                if (data.heatEvents) this.pendingHeat.push(...data.heatEvents);
            }
        };

        this.subscribeToEvents();
    }

    public static getInstance(): ParticleSystem {
        if (!ParticleSystem.instance) {
            ParticleSystem.instance = new ParticleSystem();
            (globalThis as any).ParticleSystem = ParticleSystem;
        }
        return ParticleSystem.instance;
    }

    private subscribeToEvents(): void {
        const eb = EventBus.getInstance();

        eb.on(GameEvent.EXPLOSION, (data) => {
            const x = data.x;
            const y = data.y;
            const radius = data.radius;

            this.spawnFlash(x, y, radius * 2.5);
            this.spawnShockwave(x, y, radius * 1.8);

            const fireCount = 12 + Math.floor(Math.random() * 6);
            for (let i = 0; i < fireCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 100 + Math.random() * 300;
                const life = 0.3 + Math.random() * 0.4;
                // FLAG_IS_FLAME = 2 (1 << 1)
                this.spawnParticle(x, y, '#fffbe6', Math.cos(angle) * speed, Math.sin(angle) * speed, life, 2);
            }

            const smokeCount = 15 + Math.floor(Math.random() * 10);
            for (let i = 0; i < smokeCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 40 + Math.random() * 80;
                const life = 2.0 + Math.random() * 1.5;
                const color = Math.random() < 0.5 ? '#222' : '#444';
                this.spawnSmoke(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, life, 15 + Math.random() * 15, color);

                // Phase 3: Inject radial velocity impulses into fluid
                if (this.onVelocitySplatRequested) {
                    const offsetDist = radius * 0.3;
                    this.onVelocitySplatRequested(
                        x + Math.cos(angle) * offsetDist,
                        y + Math.sin(angle) * offsetDist,
                        Math.cos(angle) * speed * 2.0,
                        Math.sin(angle) * speed * 2.0,
                        radius * 1.5
                    );
                }
            }

            if (data.moltenCount && data.moltenCount > 0) {
                const actualParticles = Math.min(150, data.moltenCount);
                for (let i = 0; i < actualParticles; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 64 + Math.random() * 96;
                    const speed = (dist / 0.75);
                    this.spawnMoltenMetal(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
                }
            }
        });

        eb.on(GameEvent.PROJECTILE_HIT, (data) => {
            const count = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 30 + Math.random() * 100;
                this.spawnParticle(data.x, data.y, '#ccc', Math.cos(angle) * speed, Math.sin(angle) * speed, 0.2 + Math.random() * 0.2);
            }
            if (ConfigManager.getInstance().get<boolean>('Visuals', 'enableSmoke')) {
                this.spawnSmoke(data.x, data.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 1.0, 10, '#555');

                // Phase 3: Add velocity impulse from projectile impact (random direction)
                if (this.onVelocitySplatRequested) {
                    const impactAngle = Math.random() * Math.PI * 2;
                    const impactSpeed = 50;
                    this.onVelocitySplatRequested(
                        data.x, data.y,
                        Math.cos(impactAngle) * impactSpeed,
                        Math.sin(impactAngle) * impactSpeed,
                        40
                    );
                }
            }
        });

        eb.on(GameEvent.ENTITY_HIT, (data) => {
            if (data.color) {
                const count = 5 + Math.floor(Math.random() * 5);
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 50 + Math.random() * 150;
                    const vx = Math.cos(angle) * speed;
                    const vy = Math.sin(angle) * speed;
                    this.spawnParticle(data.x, data.y, data.color, vx, vy, 0.3 + Math.random() * 0.4);
                }
            }
        });

        eb.on(GameEvent.WEAPON_FIRED, (data) => {
            if (data.weaponType === 'cannon' || data.weaponType === 'rocket' || data.weaponType === 'missile') {
                const count = 5;
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 20 + Math.random() * 50;
                    this.spawnParticle(data.x, data.y, '#666', Math.cos(angle) * speed, Math.sin(angle) * speed, 0.3);
                }

                if (ConfigManager.getInstance().get<boolean>('Visuals', 'enableSmoke') && (data.weaponType === 'rocket' || data.weaponType === 'missile')) {
                    const rot = (data as any).rotation || 0;
                    const backAngle = rot + Math.PI;
                    for (let i = 0; i < 8; i++) {
                        const spread = (Math.random() - 0.5) * 0.5;
                        const speed = 100 + Math.random() * 100;
                        this.spawnSmoke(
                            data.x, data.y,
                            Math.cos(backAngle + spread) * speed,
                            Math.sin(backAngle + spread) * speed,
                            0.8 + Math.random() * 0.4,
                            12 + Math.random() * 10,
                            '#888'
                        );
                    }
                }
            }
        });
    }

    public initWorker(world: World, role: string = 'single'): void {
        this.worker.postMessage({
            type: 'init',
            data: {
                buffer: this.data.sharedBuffer,
                role: role,
                worldData: {
                    width: (world as any).width,
                    height: (world as any).height,
                    tileSize: (world as any).tileSize,
                    tilesBuffer: world.getTilesSharedBuffer()
                }
            }
        });
    }

    // Proxy methods to Emitter
    public spawnParticle(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5, flags: number = 0): number {
        if (this.gpuSystem && ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled')) {
            // 0 for TYPE_STANDARD
            const combinedFlags = FLAG_ACTIVE | flags;
            this.gpuSystem.uploadParticle(x, y, vx, vy, life, 0, combinedFlags);
            return -1;
        }
        return this.emitter.spawnParticle(x, y, color, vx, vy, life);
    }
    public spawnSmoke(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, z: number = 0, vz: number = 0): number {
        const gpuEnabled = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled');

        if (gpuEnabled) {
            if (this.onSmokeSpawned) {
                // Pass color to handler, but also upload actual particle if needed
                // Currently handleSmokeSpawned in GPURenderer only does fluid splat
                // I should ALSO spawn a smoke puff particle if I want volumetric blobs
                this.onSmokeSpawned(x, y, color);
            }

            // Spawn high-density smoke particle
            if (this.gpuSystem) {
                // variation based on color
                const colorVar = color === '#000' ? 0.9 : 0.4;
                this.gpuSystem.uploadParticle(x, y, vx, vy, life, 4, 1, z, vz);
            }

            return -1;
        }

        return this.emitter.spawnSmoke(x, y, vx, vy, life, size, color);
    }
    public spawnShockwave(x: number, y: number, radius: number): number {
        return this.emitter.spawnShockwave(x, y, radius); // Keep CPU for now or port? Porting is easy.
    }
    public spawnFlash(x: number, y: number, radius: number): number {
        return this.emitter.spawnFlash(x, y, radius);
    }
    public spawnMoltenMetal(x: number, y: number, vx: number, vy: number): number {
        if (this.gpuSystem && ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled')) {
            const life = 5.0 + Math.random() * 2.0; // Matched to CPU life
            // TYPE_MOLTEN = 3
            this.gpuSystem.uploadParticle(x, y, vx, vy, life, 3, FLAG_ACTIVE);
            return -1;
        }
        return this.emitter.spawnMoltenMetal(x, y, vx, vy);
    }
    public setFlame(idx: number, isFlame: boolean): void {
        this.emitter.setFlame(idx, isFlame);
    }

    public consumeEvents(): { damageEvents: { targetIdx: number, damage: number }[], heatEvents: { x: number, y: number, intensity: number, radius: number }[] } {
        const events = {
            damageEvents: [...this.pendingDamage],
            heatEvents: [...this.pendingHeat]
        };
        this.pendingDamage = [];
        this.pendingHeat = [];
        return events;
    }

    public update(dt: number, world: World | null, player: ParticleTarget | null, enemies: ParticleTarget[], cameraCenterX: number = 0, cameraCenterY: number = 0): void {
        if (ConfigManager.getInstance().get<boolean>('Visuals', 'enableSmoke') && world) {
            this.smokeInterval += dt;
            if (this.smokeInterval > 0.05) { // 20 times per second
                this.smokeInterval = 0;
                this.emitHeatSmoke(world);
                this.emitEntitySmoke(player, enemies);
            }

            this.fireInterval += dt;
            if (this.fireInterval > 0.033) { // 30 times per second
                this.fireInterval = 0;
                this.emitEntityFire(player, enemies);
                this.emitEnvironmentFire(world);
            }
        }

        // 1. Spawning
        this.emitter.update(dt, world, player, enemies);

        // 2. Simulation
        const useWorker = typeof SharedArrayBuffer !== 'undefined' && this.data.sharedBuffer instanceof SharedArrayBuffer;

        if (useWorker) {
            if (!this.isWorkerBusy) {
                this.isWorkerBusy = true;
                this.worker.postMessage({
                    type: 'update',
                    data: {
                        dt,
                        player: player ? { x: player.x, y: player.y, radius: player.radius, active: player.active } : null,
                        enemies: enemies.map(e => ({ x: e.x, y: e.y, radius: e.radius, active: e.active })),
                        weather: WeatherManager.getInstance().getWeatherState(),
                        pixelsPerMeter: ConfigManager.getInstance().getPixelsPerMeter()
                    }
                });
            }
        } else {
            // ... (CPU Fallback clipped for space, will handle if needed)
        }

        if (this.gpuSystem) {
            this.gpuSystem.update(dt, performance.now() * 0.001, cameraCenterX, cameraCenterY);
        }

        // ALWAYS run CPU simulation if there are active CPU particles or if we need to emit events
        // This prevents "frozen" particles (like Flash/Shockwave which are always CPU)
        if (world) {
            const mm = (window as any).MultiplayerManager?.getInstance();
            const isHost = !mm || mm.isHost;
            const ppm = ConfigManager.getInstance().getPixelsPerMeter();

            // Run CPU Update (ParticleSimulation.update handles checking for active flags internally)
            // But we can optimize by checking activeCount if available, though ParticleSimulation.update does iteration.
            // We use the shared simulation regardless of GPU presence to ensure Flash/Shockwave decay.

            const events = ParticleSimulation.update(
                dt,
                this.data,
                world,
                player,
                enemies,
                WeatherManager.getInstance().getWeatherState(),
                isHost,
                ppm
            );

            // Accumulate events
            if (events.damageEvents.length > 0) this.pendingDamage.push(...events.damageEvents);
            if (events.heatEvents.length > 0) this.pendingHeat.push(...events.heatEvents);
        }

        // 3. Post-Update (Visuals & Pruning for Renderer)
        this.emitter.updateColorsAndPrune();
    }

    public render(ctx: CanvasRenderingContext2D, camX: number, camY: number, alpha: number = 0): void {
        this.renderer.render(ctx, camX, camY, alpha);
    }

    public getParticles(): any[] {
        const active = [];
        const d = this.data;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (d.flags[i] & FLAG_ACTIVE) {
                active.push({
                    x: d.x[i], y: d.y[i], z: d.z[i],
                    vx: d.vx[i], vy: d.vy[i], vz: d.vz[i],
                    life: d.life[i],
                    color: d.colorPalette[d.colorIdx[i]],
                    id: `p_${i}`,
                    type: d.type[i],
                    active: true
                });
            }
        }
        return active;
    }

    private smokeInterval: number = 0;
    private fireInterval: number = 0;

    private emitHeatSmoke(world: World): void {
        const heatMap = world.getHeatMap();
        if (!heatMap) return;
        const activeTiles = heatMap.activeTiles;
        const tileSize = world.getTileSize();
        const wallHeight = ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32;

        activeTiles.forEach((key: string) => {
            const summary = heatMap.getTileSummary(key);
            if (!summary) return;

            const [tx, ty] = key.split(',').map(Number);
            const centerX = tx * tileSize + tileSize / 2;
            const centerY = ty * tileSize + tileSize / 2;

            const isWall = world.getTile(tx, ty) !== 0;
            const baseZ = isWall ? -wallHeight : 0;

            // 1. DENSE FIRE SMOKE
            if (summary.burningCount > 0) {
                const fireIntensity = summary.burningCount / 100;
                const ppm = ConfigManager.getInstance().getPixelsPerMeter();

                if (Math.random() < fireIntensity * 0.9 + 0.3) {
                    const count = 1 + Math.floor(fireIntensity * 4);
                    for (let i = 0; i < count; i++) {
                        const offset = (Math.random() - 0.5) * tileSize;
                        const life = 3.0 + Math.random() * 2.0;
                        const size = (tileSize * 2.5) + (fireIntensity * tileSize * 2.5);

                        const vx = (Math.random() - 0.5) * 5 * ppm;
                        const vy = (Math.random() - 0.5) * 5 * ppm;
                        const vz = -20 - Math.random() * 30;

                        this.spawnSmoke(centerX + offset, centerY + offset, vx, vy, life, size, '#000', baseZ, vz);
                    }
                }
            }

            // 2. RESIDUE HEAT SMOKE
            if (summary.maxHeat > 0.4 && Math.random() < summary.avgHeat * 0.4) {
                const ppm = ConfigManager.getInstance().getPixelsPerMeter();
                const vx = (Math.random() - 0.5) * 2 * ppm;
                const vy = (Math.random() - 0.5) * 2 * ppm;
                const vz = -10 - Math.random() * 10;

                this.spawnSmoke(centerX + (Math.random() - 0.5) * tileSize, centerY + (Math.random() - 0.5) * tileSize, vx, vy, 2.0, tileSize * 1.2, '#666', baseZ, vz);
            }
        });
    }

    private emitEntitySmoke(player: ParticleTarget | null, enemies: ParticleTarget[]): void {
        const targets = player ? [player, ...enemies] : enemies;

        targets.forEach(t => {
            if (t.active && (t as any).isOnFire) {
                for (let i = 0; i < 2; i++) {
                    const wx = t.x + (Math.random() - 0.5) * t.radius;
                    const wy = t.y + (Math.random() - 0.5) * t.radius;
                    this.spawnSmoke(wx, wy, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 1.5 + Math.random(), 18 + Math.random() * 12, '#000');
                }
            }
        });
    }

    private emitEntityFire(player: ParticleTarget | null, enemies: ParticleTarget[]): void {
        const targets = player ? [player, ...enemies] : enemies;
        const gpuActive = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled');

        targets.forEach(t => {
            if (t.active && (t as any).isOnFire) {
                const count = Math.ceil(t.radius / 5);
                for (let i = 0; i < count; i++) {
                    const offset = (Math.random() - 0.5) * t.radius * 2.0;
                    const wx = t.x + offset;
                    const wy = t.y + (Math.random() - 0.5) * t.radius;

                    const vx = (Math.random() - 0.5) * 40;
                    const vy = (Math.random() - 0.5) * 40;
                    const life = 0.5 + Math.random() * 0.5;

                    // Use actual height for entity: start at feet and rise? 
                    // No, fire usually covers the whole body.
                    const z = (t as any).z || 0;
                    const localZ = z - Math.random() * t.radius;
                    const vz = -40 - Math.random() * 60; // Upward rise

                    this.spawnFireParticle(wx, wy, vx, vy, life, localZ, vz);
                }
            }
        });
    }

    public spawnFireParticle(x: number, y: number, vx: number, vy: number, life: number, z: number = 0, vz: number = 0): void {
        if (this.gpuSystem && ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled')) {
            // TYPE_FIRE = 5, FLAG_ACTIVE = 1
            this.gpuSystem.uploadParticle(x, y, vx, vy, life, 5, 1, z, vz);
        } else {
            this.spawnParticle(x, y, '#ff9900', vx, vy, life, 2);
        }
    }

    private emitEnvironmentFire(world: World): void {
        const heatMap = world.getHeatMap();
        if (!heatMap) return;
        const activeTiles = heatMap.activeTiles;
        const tileSize = world.getTileSize();
        const wallHeight = ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32;

        activeTiles.forEach((key: string) => {
            const summary = heatMap.getTileSummary(key);
            if (!summary || summary.burningCount === 0) return;

            const [tx, ty] = key.split(',').map(Number);
            // Check if it's a solid tile (Wall)
            const tileMat = world.getTile(tx, ty);
            const isWall = tileMat !== 0; // MaterialType.NONE is 0

            // Density based on how many sub-tiles are burning
            const intensity = summary.burningCount / 100;
            const count = Math.ceil(intensity * 4); // 1-4 per frame

            for (let i = 0; i < count; i++) {
                const ox = (Math.random() - 0.5) * tileSize;
                const oy = (Math.random() - 0.5) * tileSize;

                let z = 0;
                let vz = -40 - Math.random() * 60; // Initial rise

                if (isWall) {
                    // Fire "ON TOP" of walls: 
                    // Start at the top cap (-wallHeight) or slightly below it to look like it's coming from the top face
                    z = -(wallHeight - 2 + Math.random() * 5);
                } else {
                    // Ground fire
                    z = 0;
                }

                this.spawnFireParticle(
                    tx * tileSize + tileSize / 2 + ox,
                    ty * tileSize + tileSize / 2 + oy,
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                    0.4 + Math.random() * 0.4,
                    z,
                    vz
                );
            }
        });
    }

    public clear(): void {
        this.data.clear();
        if (this.gpuSystem) this.gpuSystem.clear();
        if (this.onClear) this.onClear();
    }
}
