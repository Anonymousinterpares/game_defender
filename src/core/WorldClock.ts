import { ConfigManager } from '../config/MasterConfig';
import { WeatherManager } from './WeatherManager';

export interface LightState {
    direction: { x: number, y: number };
    color: string;
    intensity: number;
    shadowLen: number;
    active: boolean;
    altitude: number;
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

    public reset(): void {
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
        this.lastWasDay = true;
    }

    public static getInstance(): WorldClock {
        if (!WorldClock.instance) {
            WorldClock.instance = new WorldClock();
            (window as any).WorldClockInstance = WorldClock.instance;
        }
        return WorldClock.instance;
    }

    private randomizeShadowLen(): void {
        const minLen = ConfigManager.getInstance().get<number>('Lighting', 'moonShadowMinLen') || 50;
        const maxLen = ConfigManager.getInstance().get<number>('Lighting', 'moonShadowMaxLen') || 250;
        this.currentNightShadowLen = minLen + Math.random() * (maxLen - minLen);
    }

    public update(dt: number): void {
        const speed = ConfigManager.getInstance().get<number>('TimeSystem', 'realSecondsPerHour') || 120;
        const gameSecondsPassed = dt * (3600 / speed);
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

    public setHour(hour: number): void {
        this.gameSeconds = (hour % 24) * 3600;
    }

    public getHour(): number {
        return (this.gameSeconds / 3600) % 24;
    }

    public setMoonPhase(phase: number): void {
        this.moonPhase = Math.max(0, Math.min(1, phase));
    }

    public getMoonPhase(): number {
        return this.moonPhase;
    }

    public getTimeState(): TimeState {
        const totalSeconds = this.gameSeconds;
        const hour = Math.floor(totalSeconds / 3600);
        const minute = Math.floor((totalSeconds % 3600) / 60);
        const timeDecimal = hour + (minute / 60);

        const weather = WeatherManager.getInstance().getWeatherState();
        const ambMult = weather.ambientMultiplier;

        // --- SUN LOGIC ---
        const sunRise = 5.0, sunSet = 20.5;
        const isSunUp = timeDecimal >= sunRise && timeDecimal <= sunSet;
        let sunIntensity = 0;
        let sunAngle = 0;
        if (isSunUp) {
            const progress = (timeDecimal - sunRise) / (sunSet - sunRise);
            sunAngle = progress * Math.PI + 0.3;
            const weatherDim = 0.7 + (ambMult * 0.3);
            // Smooth curve for intensity
            sunIntensity = Math.min(1.0, Math.sin(progress * Math.PI) * 1.8) * weatherDim;
        }
        const sunAltitude = isSunUp ? Math.sin((timeDecimal - sunRise) / (sunSet - sunRise) * Math.PI) : 0;
        const sunColor = this.getSunColor(timeDecimal);

        // --- MOON LOGIC ---
        const moonRise = 18.5, moonSet = 7.0;
        const isMoonUp = timeDecimal >= moonRise || timeDecimal <= moonSet;
        let moonAngle = 0;
        let moonBaseIntensity = 0;
        if (isMoonUp) {
            const range = (24 - moonRise + moonSet);
            const progress = timeDecimal >= moonRise ? (timeDecimal - moonRise) / range : (24 - moonRise + timeDecimal) / range;
            moonAngle = progress * Math.PI + 2.8;
            const weatherDim = 0.6 + (ambMult * 0.4);
            moonBaseIntensity = Math.min(1.0, Math.sin(progress * Math.PI) * 1.5) * this.moonPhase * weatherDim;
        }
        const moonProgress = timeDecimal >= moonRise ? (timeDecimal - moonRise) / (24 - moonRise + moonSet) : (24 - moonRise + timeDecimal) / (24 - moonRise + moonSet);
        const moonAltitude = isMoonUp ? Math.sin(moonProgress * Math.PI) : 0;
        const moonColor = ConfigManager.getInstance().get<string>('Lighting', 'moonColor') || '#aaccff';

        // Calculate base ambient with weather dimming
        const baseAmbientStr = this.getBaseAmbient(timeDecimal);
        // Extract RGB
        const rgb = baseAmbientStr.match(/\d+/g)?.map(Number) || [30, 30, 30];
        const dimmedAmbient = `rgb(${Math.floor(rgb[0] * ambMult)}, ${Math.floor(rgb[1] * ambMult)}, ${Math.floor(rgb[2] * ambMult)})`;

        return {
            hour, minute, totalSeconds,
            sun: {
                direction: { x: Math.cos(sunAngle), y: Math.sin(sunAngle) },
                color: sunColor,
                intensity: sunIntensity,
                shadowLen: 40 + 130 * (1.0 - Math.pow(sunIntensity, 0.4)),
                active: isSunUp && sunIntensity > 0.01,
                altitude: sunAltitude
            },
            moon: {
                direction: { x: Math.cos(moonAngle), y: Math.sin(moonAngle) },
                color: moonColor,
                intensity: moonBaseIntensity * 0.5,
                shadowLen: this.currentNightShadowLen,
                active: isMoonUp && moonBaseIntensity > 0.01,
                altitude: moonAltitude
            },
            baseAmbient: dimmedAmbient,
            moonPhase: this.moonPhase,
            isDaylight: hour >= 6 && hour < 19
        };
    }

    private lerpColor(c1: number[], c2: number[], t: number): string {
        const r = Math.floor(c1[0] + (c2[0] - c1[0]) * t);
        const g = Math.floor(c1[1] + (c2[1] - c1[1]) * t);
        const b = Math.floor(c1[2] + (c2[2] - c1[2]) * t);
        return `rgb(${r}, ${g}, ${b})`;
    }

    private getSunColor(t: number): string {
        // Define keyframes: [time, R, G, B]
        const keyframes: [number, number, number, number][] = [
            [0, 0, 0, 0],
            [5.0, 50, 10, 0],     // Pre-dawn glow
            [6.0, 255, 70, 10],   // Sunrise (Deep Vibrant Orange/Red)
            [7.5, 255, 170, 40],  // Golden Hour (Gold)
            [9.5, 255, 245, 210], // Morning (Warm Yellow)
            [12.0, 255, 255, 240],// Noon (Clear Warm White)
            [15.5, 255, 250, 210],// Afternoon (Warm Yellow)
            [18.5, 255, 150, 30], // Golden Hour (Gold/Orange)
            [19.8, 255, 50, 10],  // Sunset (Deep Vibrant Red/Orange)
            [21.0, 60, 15, 50],   // Dusk (Deep Magenta/Purple)
            [22.5, 0, 0, 0],
            [24, 0, 0, 0]
        ];

        for (let i = 0; i < keyframes.length - 1; i++) {
            const k1 = keyframes[i];
            const k2 = keyframes[i + 1];
            if (t >= k1[0] && t <= k2[0]) {
                const range = k2[0] - k1[0];
                const progress = range === 0 ? 0 : (t - k1[0]) / range;
                return this.lerpColor([k1[1], k1[2], k1[3]], [k2[1], k2[2], k2[3]], progress);
            }
        }
        return 'rgb(255, 255, 255)';
    }

    private getBaseAmbient(t: number): string {
        // Ambient floor also needs to transition to avoid "pale" day
        const keyframes: [number, number, number, number][] = [
            [0, 5, 8, 15],       // Night (Deep Blue)
            [5.0, 10, 10, 25],   // Early Dawn
            [6.5, 50, 35, 60],   // Sunrise Ambient (Warm Purple/Blue)
            [8.5, 60, 55, 65],   // Morning (Clear)
            [12.0, 70, 70, 75],  // Noon Ambient (Neutral/Warm)
            [17.0, 65, 55, 60],  // Afternoon (Slightly warmer)
            [19.5, 50, 30, 55],  // Sunset Ambient (Rich Purple)
            [21.5, 15, 15, 30],  // Dusk
            [24, 5, 8, 15]
        ];

        for (let i = 0; i < keyframes.length - 1; i++) {
            const k1 = keyframes[i];
            const k2 = keyframes[i + 1];
            if (t >= k1[0] && t <= k2[0]) {
                const range = k2[0] - k1[0];
                const progress = range === 0 ? 0 : (t - k1[0]) / range;
                return this.lerpColor([k1[1], k1[2], k1[3]], [k2[1], k2[2], k2[3]], progress);
            }
        }
        return 'rgb(30, 30, 30)';
    }
}
