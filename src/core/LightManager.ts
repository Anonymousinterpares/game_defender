import { ConfigManager } from '../config/MasterConfig';
import { EventBus, GameEvent } from './EventBus';

export interface LightSource {
    id: string;
    x: number;
    y: number;
    radius: number;
    color: string;
    intensity: number;
    type: 'static' | 'transient' | 'fire';
    ttl?: number;
    createdAt?: number; // Absolute timestamp for safety
    maxAge?: number;    // Maximum lifespan in seconds
    decay?: boolean;
    castsShadows?: boolean;
    active?: boolean; // For pooling/reuse
}

export class LightManager {
    private static instance: LightManager;
    private lights: Map<string, LightSource> = new Map();
    private transientCounter: number = 0;

    private constructor() {
        this.subscribeToEvents();
    }

    public static getInstance(): LightManager {
        if (!LightManager.instance) {
            LightManager.instance = new LightManager();
        }
        return LightManager.instance;
    }

    public reset(): void {
        this.lights.clear();
        this.transientCounter = 0;
    }

    private subscribeToEvents(): void {
        const eb = EventBus.getInstance();

        eb.on(GameEvent.EXPLOSION, (data) => {
            // Force log to confirm event reception
            console.log(`[LightManager] EVENT: EXPLOSION at ${data.x.toFixed(0)}, ${data.y.toFixed(0)}`);
            this.addTransientLight('explosion', data.x, data.y);
        });

        eb.on(GameEvent.PROJECTILE_HIT, (data) => {
            this.addTransientLight('impact', data.x, data.y);
        });

        eb.on(GameEvent.WEAPON_FIRED, (data) => {
            this.addTransientLight('muzzle', data.x, data.y);
        });
    }

    public addLight(light: LightSource): void {
        light.active = true;
        this.lights.set(light.id, light);
    }

    public updateOrAddLight(light: LightSource): void {
        const existing = this.lights.get(light.id);
        if (existing) {
            existing.x = light.x;
            existing.y = light.y;
            existing.radius = light.radius;
            existing.color = light.color;
            existing.intensity = light.intensity;
            existing.active = true;
            existing.castsShadows = light.castsShadows;
            // Constant lights are refreshed every frame, so we update their timestamp
            existing.createdAt = performance.now() * 0.001;
        } else {
            light.active = true;
            light.createdAt = performance.now() * 0.001;
            this.lights.set(light.id, light);
        }
    }

    public addTransientLight(type: 'muzzle' | 'impact' | 'explosion', x: number, y: number): void {
        const config = ConfigManager.getInstance().get<any>('Lighting', 'transientLights');
        const settings = config[type];

        if (!settings) return;

        // Force log for debugging
        console.log(`[LightManager] Add Transient: ${type} (ttl=${settings.ttl})`);

        const id = `transient_${type}_${this.transientCounter++}`;
        this.addLight({
            id,
            x,
            y,
            radius: settings.radius,
            color: settings.color,
            intensity: settings.intensity,
            type: 'transient',
            ttl: settings.ttl || 0.5,
            maxAge: (settings.ttl || 0.5) * 2.0, // Safety margin
            createdAt: performance.now() * 0.001,
            decay: true,
            castsShadows: type === 'explosion',
            active: true
        });
    }

    public update(dt: number): void {
        const now = performance.now() * 0.001;
        const idsToRemove: string[] = [];

        for (const [id, light] of this.lights.entries()) {
            if (light.type === 'transient') {
                // 1. Standard TTL Decay
                if (light.ttl !== undefined) {
                    light.ttl -= dt;
                    if (light.ttl <= 0) {
                        idsToRemove.push(id);
                        continue;
                    }
                }

                // 2. Absolute Safety Timeout (catch-all for glitches)
                if (light.createdAt !== undefined && light.maxAge !== undefined) {
                    if (now - light.createdAt > light.maxAge) {
                        console.warn(`[LightManager] FORCE REMOVING stuck light: ${id}`);
                        idsToRemove.push(id);
                        continue;
                    }
                }
            }
        }

        // Batch remove to avoid iterator invalidation
        idsToRemove.forEach(id => {
            this.lights.delete(id);
        });
    }

    public getLights(): LightSource[] {
        const result: LightSource[] = [];
        this.lights.forEach(l => {
            if (l.active !== false) result.push(l);
        });
        return result;
    }

    public removeLight(id: string): void {
        this.lights.delete(id);
    }

    public clearType(type: 'fire' | 'transient' | 'static'): void {
        for (const [id, light] of this.lights.entries()) {
            if (light.type === type) {
                light.active = false;
            }
        }
    }

    public clearConstantLights(): void {
        for (const [id, light] of this.lights.entries()) {
            if (id.startsWith('const_')) {
                light.active = false;
            }
        }
    }

    public addConstantLight(light: LightSource): void {
        const existing = this.lights.get(light.id);
        if (existing) {
            existing.x = light.x;
            existing.y = light.y;
            existing.radius = light.radius;
            existing.color = light.color;
            existing.intensity = light.intensity;
            existing.active = true;
            existing.castsShadows = light.castsShadows;
            existing.createdAt = performance.now() * 0.001; // Keep alive
        } else {
            this.lights.set(light.id, {
                ...light,
                type: 'transient',
                ttl: 0.1, // Short TTL for constant lights, they must be refreshed
                decay: false,
                castsShadows: light.castsShadows,
                active: true,
                createdAt: performance.now() * 0.001
            });
        }
    }

    public updateFireLights(fireClusters: { x: number, y: number, intensity: number, color?: string }[]): void {
        this.clearType('fire');
        const defaultColor = ConfigManager.getInstance().get<string>('Lighting', 'fireLightColor') || '#ff6600';
        const baseRadius = ConfigManager.getInstance().get<number>('Lighting', 'fireLightRadius') || 350;
        const baseIntensity = ConfigManager.getInstance().get<number>('Lighting', 'fireLightIntensity') || 1.6;

        fireClusters.forEach((cluster, index) => {
            this.addConstantLight({
                id: `fire_cluster_${index}`,
                x: cluster.x,
                y: cluster.y,
                radius: baseRadius * (0.6 + cluster.intensity * 0.4),
                color: cluster.color || defaultColor,
                intensity: baseIntensity * Math.min(1.5, cluster.intensity),
                type: 'fire',
                castsShadows: true
            });
        });
    }
}
