import { ConfigManager } from '../config/MasterConfig';

export interface LightState {
    direction: {x: number, y: number};
    color: string;
    intensity: number;
    shadowLen: number;
    active: boolean;
}

export interface TimeState {
    hour: number;
    minute: number;
    totalSeconds: number;
    sun: LightState;
    moon: LightState;
    baseAmbient: string; 
    moonPhase: number;
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
            this.isMoonPhaseIncreasing = this.moonPhase < 0.5;
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
        this.gameSeconds = (this.gameSeconds + gameSecondsPassed) % (24 * 3600);

        const phaseChange = (gameSecondsPassed / (24 * 3600)) * 0.1;
        if (this.isMoonPhaseIncreasing) {
            this.moonPhase += phaseChange;
            if (this.moonPhase >= 1) { this.moonPhase = 1; this.isMoonPhaseIncreasing = false; }
        } else {
            this.moonPhase -= phaseChange;
            if (this.moonPhase <= 0) { this.moonPhase = 0; this.isMoonPhaseIncreasing = true; }
        }

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
        const timeDecimal = hour + (minute / 60);

        // --- SUN LOGIC ---
        const sunRise = 5.5, sunSet = 19.5;
        const isSunUp = timeDecimal >= sunRise && timeDecimal <= sunSet;
        let sunIntensity = 0;
        let sunAngle = 0;
        if (isSunUp) {
            const progress = (timeDecimal - sunRise) / (sunSet - sunRise);
            sunAngle = progress * Math.PI + 0.3; // Path from ~Right-Down to ~Left-Up
            // Intensity fades at edges
            sunIntensity = Math.min(1.0, Math.sin(progress * Math.PI) * 1.5);
        }
        const sunColor = this.getSunColor(timeDecimal);

        // --- MOON LOGIC ---
        const moonRise = 18.0, moonSet = 7.5;
        const isMoonUp = timeDecimal >= moonRise || timeDecimal <= moonSet;
        let moonAngle = 0;
        let moonBaseIntensity = 0;
        if (isMoonUp) {
            const range = (24 - moonRise + moonSet);
            const progress = timeDecimal >= moonRise ? (timeDecimal - moonRise) / range : (24 - moonRise + timeDecimal) / range;
            moonAngle = progress * Math.PI + 2.8; // Different path from Sun
            moonBaseIntensity = Math.min(1.0, Math.sin(progress * Math.PI) * 1.5) * this.moonPhase;
        }
        const moonColor = ConfigManager.getInstance().get<string>('Lighting', 'moonColor') || '#aaccff';

        return {
            hour, minute, totalSeconds,
            sun: {
                direction: { x: Math.cos(sunAngle), y: Math.sin(sunAngle) },
                color: sunColor,
                intensity: sunIntensity,
                shadowLen: 20 + 150 * (1.0 - Math.pow(sunIntensity, 0.4)),
                active: isSunUp && sunIntensity > 0.05
            },
            moon: {
                direction: { x: Math.cos(moonAngle), y: Math.sin(moonAngle) },
                color: moonColor,
                intensity: moonBaseIntensity * 0.5, // Brighter but still "pale"
                shadowLen: this.currentNightShadowLen,
                active: isMoonUp && moonBaseIntensity > 0.05
            },
            baseAmbient: this.getBaseAmbient(timeDecimal),
            moonPhase: this.moonPhase,
            isDaylight: hour >= 7 && hour < 18
        };
    }

    private getSunColor(t: number): string {
        if (t < 5 || t > 20) return 'rgb(0,0,0)';
        // Simplified sun color ramp
        if (t >= 5.5 && t < 7) return 'rgb(255, 180, 100)'; // Sunrise
        if (t >= 7 && t < 17) return 'rgb(255, 255, 255)';  // Day
        if (t >= 17 && t < 19.5) return 'rgb(255, 120, 50)'; // Sunset
        return 'rgb(0,0,0)';
    }

    private getBaseAmbient(t: number): string {
        // Absolute dark floor
        if (t >= 7 && t < 18) return 'rgb(30, 30, 30)'; // Day floor
        return 'rgb(5, 8, 15)'; // Night floor
    }
}
