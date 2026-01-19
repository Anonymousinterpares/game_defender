import { World } from './World';
import { ParticleType, FLAG_ACTIVE, FLAG_IS_FLAME, MAX_PARTICLES } from './ParticleConstants';
import { EventBus, GameEvent } from './EventBus';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { WeatherManager } from './WeatherManager';
import { ConfigManager } from '../config/MasterConfig';

export interface ParticleTarget {
    x: number;
    y: number;
    radius: number;
    active: boolean;
    isOnFire: boolean;
}

export class ParticleSystem {
    private static instance: ParticleSystem;

    private sharedBuffer: SharedArrayBuffer;
    private x: Float32Array;
    private y: Float32Array;
    private z: Float32Array;
    private prevX: Float32Array;
    private prevY: Float32Array;
    private prevZ: Float32Array;
    private vx: Float32Array;
    private vy: Float32Array;
    private vz: Float32Array;
    private life: Float32Array;
    private maxLife: Float32Array;
    private radius: Float32Array;
    private startRadius: Float32Array;
    private type: Uint8Array;
    private flags: Uint8Array;
    private colorIdx: Uint32Array;

    private colorPalette: string[] = [];
    private nextFreeIdx: number = 0;
    private activeIndices: Uint32Array;
    private activeCount: number = 0;

    private smokeInterval: number = 0;

    // Bucket map for O(N) rendering: Map<hash, bucket>
    private buckets: Map<number, { count: number, x: Float32Array, y: Float32Array, r: Float32Array }>;

    // Pre-allocated batching buffers to avoid object creation
    private batchBufferX = new Float32Array(MAX_PARTICLES);
    private batchBufferY = new Float32Array(MAX_PARTICLES);
    private batchBufferR = new Float32Array(MAX_PARTICLES);
    private batchBufferA = new Float32Array(MAX_PARTICLES);

    private spriteCache: Map<string, HTMLCanvasElement> = new Map();

    private smokeCanvas: HTMLCanvasElement | null = null;
    private smokeCtx: CanvasRenderingContext2D | null = null;

    private worker: Worker;
    private isWorkerBusy: boolean = false;

    // For handling events from worker
    private pendingDamage: { targetIdx: number, damage: number }[] = [];
    private pendingHeat: { x: number, y: number, intensity: number, radius: number }[] = [];

    private constructor() {
        // Calculate total size: 13 Float32 arrays + 1 Uint32 array + 2 Uint8 arrays
        // Note: Uint8 arrays need 4-byte alignment for subsequent 32-bit arrays
        const count = MAX_PARTICLES;
        const f32Size = count * 4;
        const u32Size = count * 4;
        const u8SizeAligned = (count + 3) & ~3;

        const totalSize = (13 * f32Size) + (1 * u32Size) + (2 * u8SizeAligned);

        try {
            this.sharedBuffer = new (window.SharedArrayBuffer || ArrayBuffer)(totalSize) as any;
        } catch (e) {
            console.warn("SharedArrayBuffer not available, falling back to main thread physics.");
            this.sharedBuffer = new ArrayBuffer(totalSize) as any;
        }

        let offset = 0;
        const getF32 = () => {
            const arr = new Float32Array(this.sharedBuffer, offset, count);
            offset += f32Size;
            return arr;
        };
        const getU32 = () => {
            const arr = new Uint32Array(this.sharedBuffer, offset, count);
            offset += u32Size;
            return arr;
        };
        const getU8 = () => {
            const arr = new Uint8Array(this.sharedBuffer, offset, count);
            offset += u8SizeAligned;
            return arr;
        };

        this.x = getF32(); this.y = getF32(); this.z = getF32();
        this.prevX = getF32(); this.prevY = getF32(); this.prevZ = getF32();
        this.vx = getF32(); this.vy = getF32(); this.vz = getF32();
        this.life = getF32(); this.maxLife = getF32();
        this.radius = getF32(); this.startRadius = getF32();
        this.type = getU8();
        this.flags = getU8();
        this.colorIdx = getU32();
        this.activeIndices = new Uint32Array(count);
        this.buckets = new Map();

        // Initialize Worker
        this.worker = new Worker(new URL('../workers/particle.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'updated') {
                this.isWorkerBusy = false;
            } else if (type === 'events') {
                this.pendingDamage.push(...data.damageEvents);
                this.pendingHeat.push(...data.heatEvents);
            }
        };

        this.generateSprites();
        this.subscribeToEvents();
    }

    private subscribeToEvents(): void {
        const eb = EventBus.getInstance();

        eb.on(GameEvent.EXPLOSION, (data) => {
            const x = data.x;
            const y = data.y;
            const radius = data.radius;

            // 1. Initial Flash
            this.spawnFlash(x, y, radius * 2.5);

            // 2. Shockwave
            this.spawnShockwave(x, y, radius * 1.8);

            // 3. Fireballs
            const fireCount = 12 + Math.floor(Math.random() * 6);
            for (let i = 0; i < fireCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 100 + Math.random() * 300;
                const life = 0.3 + Math.random() * 0.4;
                const idx = this.spawnParticle(x, y, '#fffbe6', Math.cos(angle) * speed, Math.sin(angle) * speed, life);
                this.setFlame(idx, true);
            }

            // 4. Smoke
            const smokeCount = 15 + Math.floor(Math.random() * 10);
            for (let i = 0; i < smokeCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 40 + Math.random() * 80;
                const life = 2.0 + Math.random() * 1.5;
                const color = Math.random() < 0.5 ? '#222' : '#444';
                this.spawnSmoke(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, life, 15 + Math.random() * 15, color);
            }

            // 5. Molten Metal (Shrapnel)
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
            // General impact sparks/debris
            const count = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 30 + Math.random() * 100;
                this.spawnParticle(data.x, data.y, '#ccc', Math.cos(angle) * speed, Math.sin(angle) * speed, 0.2 + Math.random() * 0.2);
            }
            // Small puff of smoke on impact
            if (ConfigManager.getInstance().get<boolean>('Visuals', 'enableSmoke')) {
                this.spawnSmoke(data.x, data.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 1.0, 10, '#555');
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
            // Muzzle flash / smoke
            if (data.weaponType === 'cannon' || data.weaponType === 'rocket' || data.weaponType === 'missile') {
                const count = 5;
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 20 + Math.random() * 50;
                    this.spawnParticle(data.x, data.y, '#666', Math.cos(angle) * speed, Math.sin(angle) * speed, 0.3);
                }

                // BACKBLAST SMOKE
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

    private generateSprites(): void {
        const createCachedCanvas = (size: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            draw(canvas.getContext('2d')!);
            return canvas;
        };

        // 1. Generic White Glow (for Flash and Molten core)
        this.spriteCache.set('glow_white', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.3, 'rgba(255, 255, 220, 0.8)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 2. Flame Glows for different colors
        const flameColors = ['#fffbe6', '#ffcc00', '#ff4400', '#333', '#222', '#444', '#555', '#888'];
        flameColors.forEach(color => {
            this.spriteCache.set(`flame_${color}`, createCachedCanvas(32, ctx => {
                const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
                grad.addColorStop(0, color);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 32, 32);
            }));
        });

        // 3. Molten Outer Glow
        this.spriteCache.set('molten_glow', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.2, 'rgba(255, 255, 0, 0.8)');
            grad.addColorStop(0.5, 'rgba(255, 68, 0, 0.5)');
            grad.addColorStop(1, 'rgba(255, 68, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 4. Smoke Sprite (Softer)
        this.spriteCache.set('smoke_soft', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 5. BLACK Smoke Sprite (Pre-rendered for visibility)
        this.spriteCache.set('smoke_black', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
            grad.addColorStop(0.4, 'rgba(20, 20, 20, 0.5)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));
    }

    public static getInstance(): ParticleSystem {
        if (!ParticleSystem.instance) {
            ParticleSystem.instance = new ParticleSystem();
        }
        return ParticleSystem.instance;
    }

    public initWorker(world: World, role: string = 'single'): void {
        this.worker.postMessage({
            type: 'init',
            data: {
                buffer: this.sharedBuffer,
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

    private getNextIndex(): number {
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const idx = (this.nextFreeIdx + i) % MAX_PARTICLES;
            if (!(this.flags[idx] & FLAG_ACTIVE)) {
                this.nextFreeIdx = (idx + 1) % MAX_PARTICLES;
                return idx;
            }
        }
        return -1;
    }

    private getColorIndex(color: string): number {
        let idx = this.colorPalette.indexOf(color);
        if (idx === -1) {
            idx = this.colorPalette.length;
            this.colorPalette.push(color);
        }
        return idx;
    }

    public spawnParticle(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = 0;
        this.life[i] = life; this.maxLife[i] = life;
        this.radius[i] = 1 + Math.random() * 2;
        this.startRadius[i] = this.radius[i];
        this.type[i] = ParticleType.STANDARD;
        this.colorIdx[i] = this.getColorIndex(color);
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnSmoke(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = 0;
        this.life[i] = life; this.maxLife[i] = life;
        this.radius[i] = size * 0.5;
        this.startRadius[i] = this.radius[i];
        this.type[i] = ParticleType.SMOKE;
        this.colorIdx[i] = this.getColorIndex(color);
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnShockwave(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
        this.life[i] = 0.4; this.maxLife[i] = 0.4;
        this.radius[i] = radius;
        this.type[i] = ParticleType.SHOCKWAVE;
        this.colorIdx[i] = this.getColorIndex('#fff');
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnFlash(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
        this.life[i] = 0.15; this.maxLife[i] = 0.15;
        this.radius[i] = radius;
        this.type[i] = ParticleType.FLASH;
        this.colorIdx[i] = this.getColorIndex('#fff');
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnMoltenMetal(x: number, y: number, vx: number, vy: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        const life = 5.0 + Math.random() * 2.0;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = vx; this.vy[i] = vy;
        this.vz[i] = -60 - Math.random() * 40;
        this.life[i] = life; this.maxLife[i] = life;
        this.radius[i] = 4 + Math.random() * 2;
        this.type[i] = ParticleType.MOLTEN;
        this.colorIdx[i] = this.getColorIndex('#ffff00');
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public setFlame(idx: number, isFlame: boolean): void {
        if (idx === -1) return;
        if (isFlame) this.flags[idx] |= FLAG_IS_FLAME;
        else this.flags[idx] &= ~FLAG_IS_FLAME;
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

    public update(dt: number, world: World | null, player: ParticleTarget | null, enemies: ParticleTarget[]): void {

        // STOCHASTIC SMOKE EMISSION
        if (ConfigManager.getInstance().get<boolean>('Visuals', 'enableSmoke') && world) {
            this.smokeInterval += dt;
            if (this.smokeInterval > 0.05) { // 20 times per second
                this.smokeInterval = 0;
                this.emitHeatSmoke(world);
                this.emitEntitySmoke(player, enemies);
            }
        }

        const useWorker = typeof SharedArrayBuffer !== 'undefined' && this.sharedBuffer instanceof SharedArrayBuffer;

        if (useWorker) {
            if (!this.isWorkerBusy) {
                this.isWorkerBusy = true;
                this.worker.postMessage({
                    type: 'update',
                    data: {
                        dt,
                        player: player ? { x: player.x, y: player.y, radius: player.radius, active: player.active } : null,
                        enemies: enemies.map(e => ({ x: e.x, y: e.y, radius: e.radius, active: e.active })),
                        weather: WeatherManager.getInstance().getWeatherState()
                    }
                });
            }
        } else {
            // Fallback: Run same logic as worker but on main thread
            this.updateMainThread(dt, world, player, enemies);
        }

        // Populate activeIndices and handle main-thread color shifts
        this.activeCount = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!(this.flags[i] & FLAG_ACTIVE)) continue;

            // Track active particle for faster rendering
            this.activeIndices[this.activeCount++] = i;

            const lifeRatio = this.life[i] / this.maxLife[i];
            if (this.flags[i] & FLAG_IS_FLAME) {
                if (lifeRatio > 0.7) this.colorIdx[i] = this.getColorIndex('#fffbe6');
                else if (lifeRatio > 0.4) this.colorIdx[i] = this.getColorIndex('#ffcc00');
                else if (lifeRatio > 0.2) this.colorIdx[i] = this.getColorIndex('#ff4400');
                else this.colorIdx[i] = this.getColorIndex('#333');
            } else if (this.type[i] === ParticleType.MOLTEN) {
                if (this.z[i] >= 0) {
                    const moltenLifeRatio = this.life[i] / 7.0;
                    if (moltenLifeRatio > 0.6) this.colorIdx[i] = this.getColorIndex('#ffff00');
                    else if (moltenLifeRatio > 0.3) this.colorIdx[i] = this.getColorIndex('#ffaa00');
                    else if (moltenLifeRatio > 0.1) this.colorIdx[i] = this.getColorIndex('#ff4400');
                    else this.colorIdx[i] = this.getColorIndex('#222');
                }
            }
        }
    }

    private emitHeatSmoke(world: World): void {
        const heatMap = world.getHeatMap();
        if (!heatMap) return;
        const activeTiles = (heatMap as any).activeTiles;
        const tileSize = world.getTileSize();

        activeTiles.forEach((key: string) => {
            const summary = heatMap.getTileSummary(key);
            if (!summary) return;

            const [tx, ty] = key.split(',').map(Number);
            const centerX = tx * tileSize + tileSize / 2;
            const centerY = ty * tileSize + tileSize / 2;

            // 1. DENSE FIRE SMOKE (Major Tile Level)
            if (summary.burningCount > 0) {
                const fireIntensity = summary.burningCount / 100; // 10x10 subDiv

                if (Math.random() < fireIntensity * 0.9 + 0.3) {
                    const count = 1 + Math.floor(fireIntensity * 4);
                    for (let i = 0; i < count; i++) {
                        const offset = (Math.random() - 0.5) * tileSize;
                        const life = 3.0 + Math.random() * 2.0;
                        const size = (tileSize * 2.5) + (fireIntensity * tileSize * 2.5);

                        this.spawnSmoke(
                            centerX + offset,
                            centerY + offset,
                            (Math.random() - 0.5) * 30,
                            -30 - Math.random() * 50,
                            life,
                            size,
                            '#000'
                        );
                    }
                }
            }

            // 2. RESIDUE HEAT SMOKE (Smaller/Lighter)
            if (summary.maxHeat > 0.4 && Math.random() < summary.avgHeat * 0.4) {
                this.spawnSmoke(
                    centerX + (Math.random() - 0.5) * tileSize,
                    centerY + (Math.random() - 0.5) * tileSize,
                    (Math.random() - 0.5) * 15,
                    -15 - Math.random() * 20,
                    2.0,
                    tileSize * 1.2,
                    '#666'
                );
            }
        });
    }

    private emitEntitySmoke(player: ParticleTarget | null, enemies: ParticleTarget[]): void {
        const targets = player ? [player, ...enemies] : enemies;
        targets.forEach(t => {
            if (t.active && (t as any).isOnFire) {
                // Persistent dense smoke trailing from burning characters
                for (let i = 0; i < 2; i++) {
                    const wx = t.x + (Math.random() - 0.5) * t.radius;
                    const wy = t.y + (Math.random() - 0.5) * t.radius;
                    this.spawnSmoke(wx, wy, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 1.5 + Math.random(), 18 + Math.random() * 12, '#000');
                }
            }
        });
    }


    private updateMainThread(dt: number, world: World | null, player: ParticleTarget | null, enemies: ParticleTarget[]): void {
        const weather = WeatherManager.getInstance().getWeatherState();
        const windX = weather.windDir.x * weather.windSpeed;
        const windY = weather.windDir.y * weather.windSpeed;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!(this.flags[i] & FLAG_ACTIVE)) continue;

            this.prevX[i] = this.x[i];
            this.prevY[i] = this.y[i];
            this.prevZ[i] = this.z[i];

            const pType = this.type[i];

            if (pType === ParticleType.SMOKE) {
                const driftY = -15; // Rising heat
                const time = Date.now() * 0.001 + i;
                const turbX = Math.sin(time * 2) * 10;
                const turbY = Math.cos(time * 1.5) * 5;

                this.vx[i] += (windX * 20 + turbX - this.vx[i] * 0.5) * dt;
                this.vy[i] += (windY * 20 + driftY + turbY - this.vy[i] * 0.5) * dt;

                this.x[i] += this.vx[i] * dt;
                this.y[i] += this.vy[i] * dt;

                const lifeRatio = this.life[i] / this.maxLife[i];
                this.radius[i] = this.startRadius[i] + (1.0 - lifeRatio) * (this.startRadius[i] * 2);
            }
            else if (pType === ParticleType.STANDARD || pType === ParticleType.MOLTEN) {
                const nextX = this.x[i] + this.vx[i] * dt;
                const nextY = this.y[i] + this.vy[i] * dt;
                const isFlame = this.flags[i] & FLAG_IS_FLAME;

                if (world && world.isWall(nextX, nextY)) {
                    if (isFlame) {
                        this.vx[i] = 0; this.vy[i] = 0; this.life[i] *= 0.5;
                    } else if (pType === ParticleType.MOLTEN) {
                        this.vx[i] *= -0.3; this.vy[i] *= -0.3;
                    }
                } else {
                    this.x[i] = nextX;
                    this.y[i] = nextY;
                }

                if (pType === ParticleType.MOLTEN) {
                    this.vz[i] += 80 * dt;
                    this.z[i] += this.vz[i] * dt;
                    this.vx[i] *= 0.995; this.vy[i] *= 0.995;

                    if (this.z[i] > 0 && this.vz[i] > 0) {
                        const mm = (window as any).MultiplayerManager?.getInstance();
                        const isHost = !mm || mm.isHost;
                        if (this.z[i] !== 0 && (world as any)?.heatMap && isHost) {
                            (world as any).heatMap.addHeat(this.x[i], this.y[i], 0.6, 20);
                        }
                        this.z[i] = 0; this.vz[i] = 0; this.vx[i] = 0; this.vy[i] = 0;
                    }

                    if (this.z[i] < -2) {
                        const targets = player ? [player, ...enemies] : enemies;
                        for (const t of targets) {
                            if (t && t.active) {
                                const dx = t.x - this.x[i];
                                const dy = t.y - this.y[i];
                                const rSum = t.radius + this.radius[i];
                                if (dx * dx + dy * dy < rSum * rSum) {
                                    const targetIdx = (t === player) ? -1 : enemies.indexOf(t);
                                    this.pendingDamage.push({ targetIdx, damage: 5 });
                                    this.flags[i] &= ~FLAG_ACTIVE;
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    this.vx[i] *= 0.95; this.vy[i] *= 0.95;
                }
            }

            this.life[i] -= dt;
            if (this.life[i] <= 0) this.flags[i] &= ~FLAG_ACTIVE;
        }
    }

    public render(ctx: CanvasRenderingContext2D, camX: number, camY: number, alpha: number = 0): void {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const margin = 100;

        const config = ConfigManager.getInstance();
        const resScale = config.get<number>('Visuals', 'smokeResolutionScale') || 0.5;
        const maxSmoke = config.get<number>('Visuals', 'smokeMaxParticles') || 5000;

        // Initialize or resize smoke buffer if needed
        if (!this.smokeCanvas || this.smokeCanvas.width !== Math.ceil(w * resScale) || this.smokeCanvas.height !== Math.ceil(h * resScale)) {
            this.smokeCanvas = document.createElement('canvas');
            this.smokeCanvas.width = Math.ceil(w * resScale);
            this.smokeCanvas.height = Math.ceil(h * resScale);
            this.smokeCtx = this.smokeCanvas.getContext('2d', { alpha: true })!;
        }

        const sCtx = this.smokeCtx!;
        sCtx.clearRect(0, 0, this.smokeCanvas.width, this.smokeCanvas.height);
        sCtx.save();
        sCtx.scale(resScale, resScale);
        sCtx.translate(-camX, -camY);

        let currentAlpha = 1.0;
        let currentGCO = 'source-over';
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';

        if (!this.buckets) {
            this.buckets = new Map();
        }

        // Clear existing buckets
        this.buckets.forEach(bucket => bucket.count = 0);

        let smokeCount = 0;

        for (let j = 0; j < this.activeCount; j++) {
            const i = this.activeIndices[j];

            const ix = this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha;
            const iy = this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha;

            const screenX = ix - camX;
            const screenY = iy - camY;
            if (screenX < -margin || screenX > w + margin || screenY < -margin || screenY > h + margin) {
                continue;
            }

            const iz = this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha;
            const pType = this.type[i];
            const colorIdx = this.colorIdx[i];
            const lifeRatio = this.life[i] / this.maxLife[i];

            if (pType === ParticleType.STANDARD || pType === ParticleType.SMOKE) {
                if (this.flags[i] & FLAG_IS_FLAME) {
                    const targetAlpha = Math.max(0, lifeRatio);
                    if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
                        ctx.globalAlpha = currentAlpha = targetAlpha;
                    }
                    const targetGCO = lifeRatio > 0.4 ? 'screen' : 'source-over';
                    if (currentGCO !== targetGCO) {
                        ctx.globalCompositeOperation = currentGCO = targetGCO;
                    }

                    const colorStr = this.colorPalette[colorIdx];
                    const sprite = this.spriteCache.get(`flame_${colorStr}`);
                    if (sprite) {
                        const r = this.radius[i];
                        ctx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2);
                    }
                } else if (pType === ParticleType.SMOKE) {
                    // BUDGETING: Skip smoke if over limit
                    smokeCount++;
                    if (smokeCount > maxSmoke) continue;

                    const colorStr = this.colorPalette[colorIdx];
                    const isBlack = colorStr === '#000' || colorStr === '#111';

                    const targetAlpha = Math.max(0, lifeRatio * (isBlack ? 0.4 : 0.25));
                    
                    // Draw to LOW-RES buffer
                    sCtx.globalAlpha = targetAlpha;
                    const sprite = this.spriteCache.get(isBlack ? 'smoke_black' : 'smoke_soft');
                    if (sprite) {
                        const r = this.radius[i];
                        sCtx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2);

                        if (isBlack && lifeRatio > 0.7) {
                            sCtx.drawImage(sprite, ix - r * 0.6, iy - r * 0.6, r * 1.2, r * 1.2);
                        }
                    }
                } else {
                    // Standard solid particles - BUCKET THEM for high-res pass
                    const pAlpha = Math.max(0, lifeRatio);
                    const alphaIdx = Math.min(5, Math.ceil(pAlpha * 5)); // 1..5
                    const bucketKey = (colorIdx << 3) | alphaIdx; // Simple hash

                    let bucket = this.buckets.get(bucketKey);
                    if (!bucket) {
                        bucket = { count: 0, x: new Float32Array(MAX_PARTICLES), y: new Float32Array(MAX_PARTICLES), r: new Float32Array(MAX_PARTICLES) };
                        this.buckets.set(bucketKey, bucket);
                    }

                    bucket.x[bucket.count] = ix;
                    bucket.y[bucket.count] = iy;
                    bucket.r[bucket.count] = this.radius[i];
                    bucket.count++;
                }
            }
            else if (pType === ParticleType.SHOCKWAVE) {
                const ratio = 1 - lifeRatio;
                const currentRadius = this.radius[i] * Math.pow(ratio, 0.5);
                const targetAlpha = Math.max(0, 1 - ratio);
                if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
                    ctx.globalAlpha = currentAlpha = targetAlpha;
                }
                if (currentGCO !== 'source-over') {
                    ctx.globalCompositeOperation = currentGCO = 'source-over';
                }

                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(ix, iy, currentRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            else if (pType === ParticleType.FLASH) {
                if (currentGCO !== 'screen') {
                    ctx.globalCompositeOperation = currentGCO = 'screen';
                }
                const sprite = this.spriteCache.get('glow_white');
                if (sprite) {
                    const r = this.radius[i];
                    if (Math.abs(currentAlpha - lifeRatio) > 0.01) {
                        ctx.globalAlpha = currentAlpha = lifeRatio;
                    }
                    ctx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2);
                }
            }
            else if (pType === ParticleType.MOLTEN) {
                const ry = iy + iz;
                if (currentGCO !== 'screen') {
                    ctx.globalCompositeOperation = currentGCO = 'screen';
                }
                const glowRadius = this.radius[i] * (iz < 0 ? 6 : 4);
                const sprite = this.spriteCache.get('molten_glow');
                if (sprite) {
                    const mAlpha = iz < 0 ? 0.9 : (this.life[i] / 7.0) * 0.9;
                    const targetAlpha = Math.max(0, mAlpha);
                    if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
                        ctx.globalAlpha = currentAlpha = targetAlpha;
                    }
                    ctx.drawImage(sprite, ix - glowRadius, ry - glowRadius, glowRadius * 2, glowRadius * 2);
                }

                if (currentAlpha !== 1.0) {
                    ctx.globalAlpha = currentAlpha = 1.0;
                }
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(ix, ry, this.radius[i] * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // COMPOSITE SMOKE BUFFER BACK
        sCtx.restore();
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
        ctx.imageSmoothingEnabled = true;
        // Draw the offscreen canvas at full size
        ctx.drawImage(this.smokeCanvas, camX, camY, w, h);
        ctx.restore();

        // Render Buckets (High-res particles)
        if (currentGCO !== 'source-over') {
            ctx.globalCompositeOperation = 'source-over';
        }

        this.buckets.forEach((bucket, key) => {
            if (bucket.count === 0) return;

            const colorIdx = key >> 3;
            const alphaIdx = key & 7;
            const bucketAlpha = alphaIdx / 5; // 0.2, 0.4 ...

            ctx.fillStyle = this.colorPalette[colorIdx];
            ctx.globalAlpha = Math.min(1.0, bucketAlpha);
            ctx.beginPath();

            for (let k = 0; k < bucket.count; k++) {
                ctx.moveTo(bucket.x[k] + bucket.r[k], bucket.y[k]);
                ctx.arc(bucket.x[k], bucket.y[k], bucket.r[k], 0, Math.PI * 2);
            }
            ctx.fill();
        });

        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
    }

    public getParticles(): any[] {
        const active = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.flags[i] & FLAG_ACTIVE) {
                active.push({
                    x: this.x[i], y: this.y[i], z: this.z[i],
                    vx: this.vx[i], vy: this.vy[i], vz: this.vz[i],
                    life: this.life[i],
                    color: this.colorPalette[this.colorIdx[i]],
                    id: `p_${i}`,
                    type: this.type[i],
                    active: true
                });
            }
        }
        return active;
    }

    public clear(): void {
        this.flags.fill(0);
        this.x.fill(0);
        this.y.fill(0);
        this.z.fill(0);
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
        this.life.fill(0);
    }
}
