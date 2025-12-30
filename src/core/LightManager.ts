import { ConfigManager } from '../config/MasterConfig';

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
}

export class LightManager {
    private static instance: LightManager;
    private lights: Map<string, LightSource> = new Map();
    private transientCounter: number = 0;

    private constructor() {}

    public static getInstance(): LightManager {
        if (!LightManager.instance) {
            LightManager.instance = new LightManager();
        }
        return LightManager.instance;
    }

    public addLight(light: LightSource): void {
        this.lights.set(light.id, light);
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
            castsShadows: false // Explosions/Muzzles just glow
        });
    }

    public update(dt: number): void {
        // Update transient lights
        for (const [id, light] of this.lights.entries()) {
            if (light.type === 'transient' && light.ttl !== undefined) {
                light.ttl -= dt;
                if (light.decay) {
                    // Simple linear decay for transient lights
                    // We don't have the original TTL here, so it's a bit rough
                    // but we can assume they just fade out
                }
                
                if (light.ttl <= 0) {
                    this.lights.delete(id);
                }
            }
        }
    }

    public getLights(): LightSource[] {
        return Array.from(this.lights.values());
    }

    public removeLight(id: string): void {
        this.lights.delete(id);
    }

    public clearType(type: 'fire' | 'transient' | 'static'): void {
        for (const [id, light] of this.lights.entries()) {
            if (light.type === type) {
                this.lights.delete(id);
            }
        }
    }

    public clearConstantLights(): void {
        for (const [id, light] of this.lights.entries()) {
            if (id.startsWith('const_')) {
                this.lights.delete(id);
            }
        }
    }

    public addConstantLight(light: LightSource): void {
        this.lights.set(light.id, { ...light, type: 'transient', ttl: 0.05, decay: false, castsShadows: false });
    }

    /**
     * Clusters fire light sources based on burning sub-tiles.
     * Called by GameplayScene using HeatMap data.
     */
    public updateFireLights(fireClusters: {x: number, y: number, intensity: number, color?: string}[]): void {
        this.clearType('fire');
        const defaultColor = ConfigManager.getInstance().get<string>('Lighting', 'fireLightColor') || '#ff6600';
        const baseRadius = ConfigManager.getInstance().get<number>('Lighting', 'fireLightRadius') || 250;

        fireClusters.forEach((cluster, index) => {
            this.addLight({
                id: `fire_cluster_${index}`,
                x: cluster.x,
                y: cluster.y,
                radius: baseRadius * (0.5 + cluster.intensity * 0.5),
                color: cluster.color || defaultColor,
                intensity: Math.min(1.5, cluster.intensity),
                type: 'fire',
                castsShadows: false
            });
        });
    }
}
