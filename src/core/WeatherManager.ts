import { ConfigManager } from '../config/MasterConfig';

export enum WeatherType {
    CLEAR = 'clear',
    CLOUDY = 'cloudy',
    FOG = 'fog',
    RAIN = 'rain',
    SNOW = 'snow'
}

export enum CloudType {
    NONE = 'none',
    SCATTERED = 'scattered',
    BROKEN = 'broken',
    OVERCAST = 'overcast'
}

export interface WeatherState {
    type: WeatherType;
    cloudType: CloudType;
    fogDensity: number;
    precipitationIntensity: number; // 0 to 1
    snowAccumulation: number; // 0 to 1
    ambientMultiplier: number; // 1.0 = normal, 0.5 = dark
    windDir: { x: number, y: number };
    windSpeed: number;
    cloudWindDir: { x: number, y: number }; // Separate movement for clouds
    cloudWindSpeed: number;
}

export class WeatherManager {
    private static instance: WeatherManager;

    private currentType: WeatherType = WeatherType.CLEAR;
    private currentCloudType: CloudType = CloudType.NONE;

    // State values for interpolation
    private fogDensity: number = 0;
    private rainIntensity: number = 0;
    private snowIntensity: number = 0;
    private snowAccumulation: number = 0;
    private cloudCoverage: number = 0; // 0 to 1

    private windAngle: number = 0;
    private windSpeed: number = 1.0;
    private windTimer: number = 0;

    private cloudWindAngle: number = 0;
    private cloudWindSpeed: number = 1.5;

    private targetFogDensity: number = 0;
    private targetCloudCoverage: number = 0;
    private targetRainIntensity: number = 0;
    private targetSnowIntensity: number = 0;
    private targetWindSpeed: number = 1.0;
    private targetCloudWindSpeed: number = 1.5;
    private targetCloudWindAngle: number = 0;

    // Per-tile snow removal (0 = fully removed, 1 = full snow)
    // Similar to HeatMap structure: Map<"tx,ty", Float32Array[100]> for 10x10 sub-tiles
    private snowRemovalData: Map<string, Float32Array> = new Map();
    private readonly subDiv: number = 10;

    private constructor() {
        this.initializeFromConfig();
        this.subscribeToEvents();
    }

    public static getInstance(): WeatherManager {
        if (!WeatherManager.instance) {
            WeatherManager.instance = new WeatherManager();
        }
        return WeatherManager.instance;
    }

    public reset(): void {
        this.snowAccumulation = 0;
        this.snowRemovalData.clear();
        this.initializeFromConfig();
    }

    public refreshConfig(): void {
        this.initializeFromConfig();
    }

    private subscribeToEvents(): void {
        const eb = (window as any).EventBusInstance;
        if (eb) {
            // Listen for explosions to remove snow
            eb.on('explosion', (data: { x: number, y: number, radius: number }) => {
                this.removeSnowInArea(data.x, data.y, data.radius);
            });
        }
    }

    private initializeFromConfig(): void {
        const initial = ConfigManager.getInstance().get<string>('Weather', 'initialWeather');
        let type = initial as WeatherType;

        if (initial === 'random') {
            const types = [WeatherType.CLEAR, WeatherType.CLOUDY, WeatherType.FOG, WeatherType.RAIN, WeatherType.SNOW];
            type = types[Math.floor(Math.random() * types.length)];
        }

        this.setWeather(type, true);

        // Initial ground wind
        this.windAngle = Math.random() * Math.PI * 2;
        this.windSpeed = 1.0 + Math.random() * 2.0;

        // Cloud wind is more stable and often different from ground wind
        this.cloudWindAngle = this.windAngle + (Math.random() - 0.5) * 1.5;
        this.targetCloudWindAngle = this.cloudWindAngle;
        this.cloudWindSpeed = 1.0 + Math.random() * 3.0;
        this.targetCloudWindSpeed = this.cloudWindSpeed;
    }

    public setWeather(type: WeatherType, immediate: boolean = false): void {
        this.currentType = type;

        switch (type) {
            case WeatherType.CLEAR:
                this.targetFogDensity = 0;
                this.targetCloudCoverage = Math.random() * 0.15; // Rare clouds
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0;
                this.targetWindSpeed = 0.5 + Math.random() * 1.5;
                this.targetCloudWindSpeed = 0.8 + Math.random() * 2.0;
                break;
            case WeatherType.CLOUDY:
                this.targetFogDensity = 0;
                this.targetCloudCoverage = 0.4 + Math.random() * 0.5; // Distinctly cloudy
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0;
                this.targetWindSpeed = 1.0 + Math.random() * 2.0;
                this.targetCloudWindSpeed = 2.0 + Math.random() * 4.0;
                break;
            case WeatherType.FOG:
                this.targetFogDensity = 0.6 + Math.random() * 0.4;
                this.targetCloudCoverage = 0.4 + Math.random() * 0.4;
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0;
                this.targetWindSpeed = 0.05 + Math.random() * 0.1;
                this.targetCloudWindSpeed = 0.5 + Math.random() * 1.0;
                break;
            case WeatherType.RAIN:
                this.targetFogDensity = 0.2 + Math.random() * 0.3;
                this.targetCloudCoverage = 1.0;
                this.targetRainIntensity = 0.5 + Math.random() * 0.5;
                this.targetSnowIntensity = 0;
                this.targetWindSpeed = 2.0 + Math.random() * 3.0;
                this.targetCloudWindSpeed = 3.0 + Math.random() * 5.0;
                break;
            case WeatherType.SNOW:
                this.targetFogDensity = 0.3 + Math.random() * 0.4;
                this.targetCloudCoverage = 1.0;
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0.5 + Math.random() * 0.5;
                this.targetWindSpeed = 1.0 + Math.random() * 2.0;
                this.targetCloudWindSpeed = 1.5 + Math.random() * 3.0;
                break;
        }

        if (immediate) {
            this.fogDensity = Math.min(1.0, this.targetFogDensity);
            this.cloudCoverage = Math.min(1.0, this.targetCloudCoverage);
            this.rainIntensity = Math.min(1.0, this.targetRainIntensity);
            this.snowIntensity = Math.min(1.0, this.targetSnowIntensity);
            this.windSpeed = this.targetWindSpeed;
            this.cloudWindSpeed = this.targetCloudWindSpeed;
        }
    }

    public update(dt: number): void {
        const lerpSpeed = ConfigManager.getInstance().get<number>('Weather', 'transitionSpeed') * dt;

        // Fog/Wind Interdependency: High wind scatters fog
        if (this.windSpeed > 1.0 && this.targetFogDensity > 0) {
            this.targetFogDensity = Math.max(0, this.targetFogDensity - (this.windSpeed - 1.0) * dt * 0.1);
        }

        // Interpolate densities with strict clamping
        this.fogDensity = Math.max(0, Math.min(1.0, this.fogDensity + (this.targetFogDensity - this.fogDensity) * lerpSpeed));
        this.cloudCoverage = Math.max(0, Math.min(1.0, this.cloudCoverage + (this.targetCloudCoverage - this.cloudCoverage) * lerpSpeed));
        this.rainIntensity = Math.max(0, Math.min(1.0, this.rainIntensity + (this.targetRainIntensity - this.rainIntensity) * lerpSpeed));
        this.snowIntensity = Math.max(0, Math.min(1.0, this.snowIntensity + (this.targetSnowIntensity - this.snowIntensity) * lerpSpeed));

        // Snow accumulation
        if (this.snowIntensity > 0.1) {
            this.snowAccumulation = Math.min(1.0, this.snowAccumulation + this.snowIntensity * dt * 0.01);
        } else if (this.currentType === WeatherType.CLEAR || this.currentType === WeatherType.RAIN) {
            // Melting
            const meltSpeed = this.currentType === WeatherType.RAIN ? 0.05 : 0.01;
            this.snowAccumulation = Math.max(0, this.snowAccumulation - meltSpeed * dt);
        }

        // Determine Cloud Type based on coverage
        if (this.cloudCoverage < 0.2) this.currentCloudType = CloudType.NONE;
        else if (this.cloudCoverage < 0.5) this.currentCloudType = CloudType.SCATTERED;
        else if (this.cloudCoverage < 0.8) this.currentCloudType = CloudType.BROKEN;
        else this.currentCloudType = CloudType.OVERCAST;

        // Update Wind
        this.windTimer += dt;

        // Base wind speed transitions
        this.windSpeed += (this.targetWindSpeed - this.windSpeed) * lerpSpeed;
        this.cloudWindSpeed += (this.targetCloudWindSpeed - this.cloudWindSpeed) * lerpSpeed;

        this.windAngle += Math.sin(this.windTimer * 0.1) * 0.01; // Slow direction drift

        // Clouds move in a very stable direction. 
        // We lerp the angle extremely slowly.
        let angleDiff = this.targetCloudWindAngle - this.cloudWindAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.cloudWindAngle += angleDiff * (lerpSpeed * 0.05);

        // Gradually restore removed snow when snowing
        if (this.snowIntensity > 0.1) {
            this.snowRemovalData.forEach((data, key) => {
                let fullyRestored = true;
                for (let i = 0; i < data.length; i++) {
                    if (data[i] < 1.0) {
                        // Restore at 0.01/second (much slower than initial accumulation)
                        data[i] = Math.min(1.0, data[i] + dt * 0.01);
                        if (data[i] < 0.99) fullyRestored = false;
                    }
                }
                if (fullyRestored) {
                    this.snowRemovalData.delete(key);
                }
            });
        } else if (this.snowAccumulation <= 0.01) {
            // Optimization: Clear all removal data if snow is gone
            if (this.snowRemovalData.size > 0) {
                this.snowRemovalData.clear();
            }
        }

        // Periodically fluctuate targets to prevent "stuck" high intensities
        // This ensures weather feels dynamic and doesn't just crawl to a max and stay there.
        if (Math.random() < 0.0005 * dt) {
            if (this.currentType === WeatherType.RAIN) {
                this.targetRainIntensity = 0.4 + Math.random() * 0.5; // Fluctuate between 0.4 and 0.9
            } else if (this.currentType === WeatherType.SNOW) {
                this.targetSnowIntensity = 0.4 + Math.random() * 0.5;
            }

            if (this.currentType === WeatherType.FOG) {
                this.targetFogDensity = 0.5 + Math.random() * 0.4; // Max 0.9 for visibility safety
            }

            this.targetWindSpeed = 1.0 + Math.random() * 4.0;
        }

        // Very rarely change the cloud wind target direction
        if (Math.random() < 0.0001 * dt) {
            this.targetCloudWindAngle += (Math.random() - 0.5) * 0.5;
        }
    }

    public getWeatherState(): WeatherState {
        // Ambient light is dimmed by clouds and fog
        // Max dimming: 0.6 from clouds (Overcast), 0.2 from fog. 
        let ambientMult = 1.0 - (this.cloudCoverage * 0.5);
        ambientMult -= (this.fogDensity * 0.25);
        ambientMult = Math.max(0.3, ambientMult); // Floor at 30% brightness

        // Add wind fluctuation to the state
        const windVariation = Math.sin(this.windTimer * 0.2) * 0.5 + Math.sin(this.windTimer * 0.5) * 0.2;
        const currentWindSpeed = Math.max(0.05, this.windSpeed + windVariation * this.windSpeed * 0.3);

        return {
            type: this.currentType,
            cloudType: this.currentCloudType,
            fogDensity: this.fogDensity,
            precipitationIntensity: Math.max(this.rainIntensity, this.snowIntensity),
            snowAccumulation: this.snowAccumulation,
            ambientMultiplier: ambientMult,
            windDir: { x: Math.cos(this.windAngle), y: Math.sin(this.windAngle) },
            windSpeed: currentWindSpeed,
            cloudWindDir: { x: Math.cos(this.cloudWindAngle), y: Math.sin(this.cloudWindAngle) },
            cloudWindSpeed: this.cloudWindSpeed
        };
    }

    public getSnowAccumulation(): number {
        return this.snowAccumulation;
    }

    /**
     * Get effective snow coverage at a specific world position (0-1 scale)
     * Takes global accumulation and applies local removal data
     */
    public getSnowCoverageAt(worldX: number, worldY: number, tileSize: number): number {
        if (this.snowAccumulation < 0.1) return 0;

        const tx = Math.floor(worldX / tileSize);
        const ty = Math.floor(worldY / tileSize);
        const key = `${tx},${ty}`;
        const removalData = this.snowRemovalData.get(key);

        if (!removalData) return this.snowAccumulation;

        const subX = Math.floor((worldX - tx * tileSize) / (tileSize / this.subDiv));
        const subY = Math.floor((worldY - ty * tileSize) / (tileSize / this.subDiv));
        const idx = subY * this.subDiv + subX;

        // removalData[idx]: 0 = fully removed, 1 = full snow
        return this.snowAccumulation * removalData[idx];
    }

    /**
     * Get tile-level snow removal data for rendering
     */
    public getTileSnowRemoval(tx: number, ty: number): Float32Array | null {
        return this.snowRemovalData.get(`${tx},${ty}`) || null;
    }

    /**
     * Remove snow in area (called by explosions)
     */
    public removeSnowInArea(worldX: number, worldY: number, radius: number, tileSize: number = 32): void {
        const tx = Math.floor(worldX / tileSize);
        const ty = Math.floor(worldY / tileSize);
        const tileRadius = Math.ceil(radius / tileSize);

        for (let ry = -tileRadius; ry <= tileRadius; ry++) {
            for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                this.removeSnowInTile(tx + rx, ty + ry, worldX, worldY, radius, tileSize);
            }
        }
    }

    private removeSnowInTile(tx: number, ty: number, hitX: number, hitY: number, radius: number, tileSize: number): void {
        const key = `${tx},${ty}`;
        let data = this.snowRemovalData.get(key);

        if (!data) {
            data = new Float32Array(this.subDiv * this.subDiv);
            data.fill(1.0); // Start with full snow
            this.snowRemovalData.set(key, data);
        }

        const tileWorldX = tx * tileSize;
        const tileWorldY = ty * tileSize;
        const subSize = tileSize / this.subDiv;

        for (let i = 0; i < data.length; i++) {
            const subX = i % this.subDiv;
            const subY = Math.floor(i / this.subDiv);
            const centerX = tileWorldX + (subX + 0.5) * subSize;
            const centerY = tileWorldY + (subY + 0.5) * subSize;

            const dx = centerX - hitX;
            const dy = centerY - hitY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius) {
                // Remove snow completely within explosion radius
                data[i] = 0;
            }
        }
    }

    /**
     * Remove snow from heated tiles (called by update with HeatMap data)
     * Simplified for performance: melts local sub-tiles based on their heat.
     */
    public removeSnowFromHeat(tx: number, ty: number, heatData: Float32Array, tileSize: number = 32, maxHeat: number = 1.0): void {
        if (this.snowAccumulation < 0.01) return;
        if (maxHeat < 0.3) return;

        const key = `${tx},${ty}`;
        let data = this.snowRemovalData.get(key);

        if (!data) {
            data = new Float32Array(this.subDiv * this.subDiv);
            data.fill(1.0); // Start with full snow
            this.snowRemovalData.set(key, data);
        }

        const heatThreshold = 0.3;

        for (let i = 0; i < heatData.length; i++) {
            if (heatData[i] > heatThreshold) {
                // Remove snow from hot sub-tile - faster melt than spread
                data[i] = Math.max(0, data[i] - 0.1); 
            }
        }
    }
}
