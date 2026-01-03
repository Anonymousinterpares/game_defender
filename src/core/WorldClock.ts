import { ConfigManager } from '../config/MasterConfig';

export interface TimeState {
    hour: number;
    minute: number;
    totalSeconds: number;
    ambientIntensity: number;
    sunColor: string;
    sunAngle: number; // 0 to 2*PI
    sunDirection: {x: number, y: number};
    moonDirection: {x: number, y: number};
    moonIntensity: number;
    moonPhase: number;
    moonShadowLen: number;
    isDaylight: boolean;
}

export class WorldClock {
    private static instance: WorldClock;
    private gameSeconds: number = 0;
    private realSecondsPerHour: number = 120;
    
    private moonPhase: number = 1.0;
    private isMoonPhaseIncreasing: boolean = true;
    private currentNightShadowLen: number = 100;
    private lastWasDay: boolean = true;

    private constructor() {
        const config = ConfigManager.getInstance();
        const startHour = config.get<number>('TimeSystem', 'startHour') ?? 10;
        this.realSecondsPerHour = config.get<number>('TimeSystem', 'realSecondsPerHour') || 120;
        this.gameSeconds = startHour * 3600;

        const randomPhase = config.get<boolean>('TimeSystem', 'randomMoonPhase');
        if (randomPhase) {
            this.moonPhase = Math.random();
            this.isMoonPhaseIncreasing = Math.random() > 0.5;
        } else {
            this.moonPhase = config.get<number>('TimeSystem', 'moonPhase') ?? 1.0;
            this.isMoonPhaseIncreasing = this.moonPhase < 0.5; // Arbitrary: if low phase, increase it
        }

        this.randomizeShadowLen();
    }

    public static getInstance(): WorldClock {
        if (!WorldClock.instance) {
            WorldClock.instance = new WorldClock();
        }
        return WorldClock.instance;
    }

    private randomizeShadowLen(): void {
        const minLen = ConfigManager.getInstance().get<number>('Lighting', 'moonShadowMinLen') || 50;
        const maxLen = ConfigManager.getInstance().get<number>('Lighting', 'moonShadowMaxLen') || 250;
        this.currentNightShadowLen = minLen + Math.random() * (maxLen - minLen);
    }

    public update(dt: number): void {
        const gameSecondsPassed = dt * (3600 / this.realSecondsPerHour);
        const oldSeconds = this.gameSeconds;
        this.gameSeconds = (this.gameSeconds + gameSecondsPassed) % (24 * 3600);

        // Update moon phase slowly (e.g. 0.05 per game day)
        const phaseChange = (gameSecondsPassed / (24 * 3600)) * 0.1;
        if (this.isMoonPhaseIncreasing) {
            this.moonPhase += phaseChange;
            if (this.moonPhase >= 1) {
                this.moonPhase = 1;
                this.isMoonPhaseIncreasing = false;
            }
        } else {
            this.moonPhase -= phaseChange;
            if (this.moonPhase <= 0) {
                this.moonPhase = 0;
                this.isMoonPhaseIncreasing = true;
            }
        }

        // New night check
        const hour = Math.floor(this.gameSeconds / 3600);
        const isDay = hour >= 6 && hour < 19;
        if (this.lastWasDay && !isDay) {
            this.randomizeShadowLen();
        }
        this.lastWasDay = isDay;
    }

    public getTimeState(): TimeState {
        const totalSeconds = this.gameSeconds;
        const hour = Math.floor(totalSeconds / 3600);
        const minute = Math.floor((totalSeconds % 3600) / 60);

        // Sun Angle: Ensure it's never perfectly 90 degrees (vertical)
        const dayProgress = (totalSeconds / (24 * 3600)); 
        const sunAngle = (dayProgress * Math.PI * 2) + 0.5; 
        
        const sunDirection = {
            x: Math.cos(sunAngle),
            y: Math.sin(sunAngle)
        };

        // Moon Direction: Opposite to sun
        const moonAngle = sunAngle + Math.PI;
        const moonDirection = {
            x: Math.cos(moonAngle),
            y: Math.sin(moonAngle)
        };

        const ambient = this.calculateAmbient(hour, minute, totalSeconds % 3600);
        
        return {
            hour,
            minute,
            totalSeconds,
            ambientIntensity: ambient.intensity,
            sunColor: ambient.color,
            sunAngle: sunAngle,
            sunDirection,
            moonDirection,
            moonIntensity: this.moonPhase,
            moonPhase: this.moonPhase,
            moonShadowLen: this.currentNightShadowLen,
            isDaylight: hour >= 7 && hour < 18
        };
    }

    private calculateAmbient(h: number, m: number, sInHour: number): { intensity: number, color: string } {
        const timeDecimal = h + (m / 60) + (sInHour / 3600);
        
        const minAmb = ConfigManager.getInstance().get<number>('Lighting', 'ambientMin') || 0.05;
        const maxAmb = ConfigManager.getInstance().get<number>('Lighting', 'ambientMax') || 1.0;
        
        let intensity = minAmb;
        if (timeDecimal >= 5 && timeDecimal < 7) { 
            const t = (timeDecimal - 5) / 2;
            intensity = minAmb + (maxAmb - minAmb) * t;
        } else if (timeDecimal >= 7 && timeDecimal < 18) { 
            intensity = maxAmb;
        } else if (timeDecimal >= 18 && timeDecimal < 20) { 
            const t = (timeDecimal - 18) / 2;
            intensity = maxAmb - (maxAmb - minAmb) * t;
        }

        let r = 255, g = 255, b = 255;
        
        if (timeDecimal >= 5 && timeDecimal < 6) { 
            const t = (timeDecimal - 5);
            r = Math.floor(20 * (1 - t) + 40 * t);
            g = Math.floor(30 * (1 - t) + 120 * t);
            b = Math.floor(100 * (1 - t) + 120 * t);
        } else if (timeDecimal >= 6 && timeDecimal < 7) { 
            const t = (timeDecimal - 6);
            r = Math.floor(40 * (1 - t) + 255 * t);
            g = Math.floor(120 * (1 - t) + 180 * t);
            b = Math.floor(120 * (1 - t) + 80 * t);
        } else if (timeDecimal >= 7 && timeDecimal < 9) { 
            const t = (timeDecimal - 7) / 2;
            r = 255; g = Math.floor(180 * (1 - t) + 255 * t); b = Math.floor(80 * (1 - t) + 200 * t);
        } else if (timeDecimal >= 9 && timeDecimal < 16) { 
            r = 255; g = 255; b = 255;
        } else if (timeDecimal >= 16 && timeDecimal < 18) { 
            const t = (timeDecimal - 16) / 2;
            r = 255; g = Math.floor(255 * (1 - t) + 220 * t); b = Math.floor(255 * (1 - t) + 150 * t);
        } else if (timeDecimal >= 18 && timeDecimal < 19) { 
            const t = (timeDecimal - 18);
            r = 255; g = Math.floor(220 * (1 - t) + 80 * t); b = Math.floor(150 * (1 - t) + 40 * t);
        } else if (timeDecimal >= 19 && timeDecimal < 21) { 
            const t = (timeDecimal - 19) / 2;
            r = Math.floor(255 * (1 - t) + 15 * t); g = Math.floor(80 * (1 - t) + 15 * t); b = Math.floor(40 * (1 - t) + 60 * t);
        } else { // Night
            const moonColorHex = ConfigManager.getInstance().get<string>('Lighting', 'moonColor') || '#aaccff';
            const mR = parseInt(moonColorHex.slice(1, 3), 16);
            const mG = parseInt(moonColorHex.slice(3, 5), 16);
            const mB = parseInt(moonColorHex.slice(5, 7), 16);
            
            // Base floor (very dark)
            const floorR = 2, floorG = 3, floorB = 8;
            
            // Moonlight contribution (scales with phase) - Doubled to 0.5
            const moonContrib = 0.5 * this.moonPhase;
            
            r = Math.floor(floorR + (mR - floorR) * moonContrib);
            g = Math.floor(floorG + (mG - floorG) * moonContrib);
            b = Math.floor(floorB + (mB - floorB) * moonContrib);
            
            // Intensity must be > 0.1 for shadows to render
            intensity = 0.15 + (0.35 * this.moonPhase);
        }

        return { intensity, color: `rgb(${r},${g},${b})` };
    }
}
