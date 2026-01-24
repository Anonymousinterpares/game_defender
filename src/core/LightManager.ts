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
        } else {
            light.active = true;
            this.lights.set(light.id, light);
        }
    }

    public addTransientLight(type: 'muzzle' | 'impact' | 'explosion', x: number, y: number): void {
        const config = ConfigManager.getInstance().get<any>('Lighting', 'transientLights');
        const settings = config[type];

        if (!settings) return;

        const id = `transient_${type}_${this.transientCounter++}`;
        this.addLight({
            id,
            x,
            y,
            radius: settings.radius,
            color: settings.color,
            intensity: settings.intensity,
            type: 'transient',
            ttl: settings.ttl,
            decay: true,
            castsShadows: type === 'explosion', // Only explosions cast shadows for performance
            active: true
        });
    }

    public update(dt: number): void {
        for (const [id, light] of this.lights.entries()) {
            if (light.type === 'transient' && light.ttl !== undefined) {
                light.ttl -= dt;
                if (light.ttl <= 0) {
                    this.lights.delete(id);
                }
            }
        }
    }

    public getLights(): LightSource[] {
        // Only return active lights
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
                light.active = false; // Mark for reuse
            }
        }
    }

    public clearConstantLights(): void {
        for (const [id, light] of this.lights.entries()) {
            if (id.startsWith('const_')) {
                light.active = false; // Mark for reuse
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
        } else {
            this.lights.set(light.id, { ...light, type: 'transient', ttl: 0.05, decay: false, castsShadows: light.castsShadows, active: true });
        }
    }

    public updateFireLights(fireClusters: { x: number, y: number, intensity: number, color?: string }[]): void {
        this.clearType('fire');
        const defaultColor = ConfigManager.getInstance().get<string>('Lighting', 'fireLightColor') || '#ff6600';
        const baseRadius = ConfigManager.getInstance().get<number>('Lighting', 'fireLightRadius') || 350;
        const baseIntensity = ConfigManager.getInstance().get<number>('Lighting', 'fireLightIntensity') || 1.6;

        fireClusters.forEach((cluster, index) => {
            this.addConstantLight({ // Reusing logic for consistency
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
