import { ConfigManager } from '../config/MasterConfig';

export enum WeatherType {
    CLEAR = 'clear',
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

    private targetFogDensity: number = 0;
    private targetCloudCoverage: number = 0;
    private targetRainIntensity: number = 0;
    private targetSnowIntensity: number = 0;

    private constructor() {
        this.initializeFromConfig();
    }

    public static getInstance(): WeatherManager {
        if (!WeatherManager.instance) {
            WeatherManager.instance = new WeatherManager();
        }
        return WeatherManager.instance;
    }

    private initializeFromConfig(): void {
        const initial = ConfigManager.getInstance().get<string>('Weather', 'initialWeather');
        let type = initial as WeatherType;

        if (initial === 'random') {
            const types = [WeatherType.CLEAR, WeatherType.FOG, WeatherType.RAIN, WeatherType.SNOW];
            type = types[Math.floor(Math.random() * types.length)];
        }

        this.setWeather(type, true);
        
        // Initial wind
        this.windAngle = Math.random() * Math.PI * 2;
        this.windSpeed = 1.0 + Math.random() * 2.0;
    }

    public setWeather(type: WeatherType, immediate: boolean = false): void {
        this.currentType = type;
        
        switch (type) {
            case WeatherType.CLEAR:
                this.targetFogDensity = 0;
                this.targetCloudCoverage = Math.random() * 0.3;
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0;
                break;
            case WeatherType.FOG:
                this.targetFogDensity = 0.6 + Math.random() * 0.4;
                this.targetCloudCoverage = 0.4 + Math.random() * 0.4;
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0;
                break;
            case WeatherType.RAIN:
                this.targetFogDensity = 0.2 + Math.random() * 0.3;
                this.targetCloudCoverage = 0.7 + Math.random() * 0.3;
                this.targetRainIntensity = 0.5 + Math.random() * 0.5;
                this.targetSnowIntensity = 0;
                break;
            case WeatherType.SNOW:
                this.targetFogDensity = 0.3 + Math.random() * 0.4;
                this.targetCloudCoverage = 0.8 + Math.random() * 0.2;
                this.targetRainIntensity = 0;
                this.targetSnowIntensity = 0.5 + Math.random() * 0.5;
                break;
        }

        if (immediate) {
            this.fogDensity = this.targetFogDensity;
            this.cloudCoverage = this.targetCloudCoverage;
            this.rainIntensity = this.targetRainIntensity;
            this.snowIntensity = this.targetSnowIntensity;
        }
    }

    public update(dt: number): void {
        const lerpSpeed = ConfigManager.getInstance().get<number>('Weather', 'transitionSpeed') * dt;
        
        // Interpolate densities
        this.fogDensity += (this.targetFogDensity - this.fogDensity) * lerpSpeed;
        this.cloudCoverage += (this.targetCloudCoverage - this.cloudCoverage) * lerpSpeed;
        this.rainIntensity += (this.targetRainIntensity - this.rainIntensity) * lerpSpeed;
        this.snowIntensity += (this.targetSnowIntensity - this.snowIntensity) * lerpSpeed;

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
        // Periodic wind variation using sine waves
        const windBaseSpeed = (ConfigManager.getInstance().get<number>('Weather', 'windMinSpeed') + ConfigManager.getInstance().get<number>('Weather', 'windMaxSpeed')) / 2;
        const windRange = ConfigManager.getInstance().get<number>('Weather', 'windMaxSpeed') - windBaseSpeed;
        
        this.windSpeed = windBaseSpeed + Math.sin(this.windTimer * 0.2) * windRange * 0.5 + Math.sin(this.windTimer * 0.5) * windRange * 0.2;
        this.windAngle += Math.sin(this.windTimer * 0.1) * 0.01; // Slow direction drift
    }

    public getWeatherState(): WeatherState {
        // Ambient light is dimmed by clouds and fog
        // Max dimming: 0.5 from clouds, 0.2 from fog. 
        // We want a floor that isn't pitch black.
        let ambientMult = 1.0 - (this.cloudCoverage * 0.4);
        ambientMult -= (this.fogDensity * 0.2);
        ambientMult = Math.max(0.35, ambientMult); // Floor at 35% brightness

        return {
            type: this.currentType,
            cloudType: this.currentCloudType,
            fogDensity: this.fogDensity,
            precipitationIntensity: Math.max(this.rainIntensity, this.snowIntensity),
            snowAccumulation: this.snowAccumulation,
            ambientMultiplier: ambientMult,
            windDir: { x: Math.cos(this.windAngle), y: Math.sin(this.windAngle) },
            windSpeed: this.windSpeed
        };
    }
    
    public getSnowAccumulation(): number {
        return this.snowAccumulation;
    }
}
