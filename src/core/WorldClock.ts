import { ConfigManager } from '../config/MasterConfig';

export interface TimeState {
    hour: number;
    minute: number;
    totalSeconds: number;
    ambientIntensity: number;
    sunColor: string;
    sunAngle: number; // 0 to 2*PI
    sunDirection: {x: number, y: number};
    isDaylight: boolean;
}

export class WorldClock {
    private static instance: WorldClock;
    private gameSeconds: number = 0;
    private realSecondsPerHour: number = 120;

    private constructor() {
        const startHour = ConfigManager.getInstance().get<number>('TimeSystem', 'startHour') ?? 10;
        this.realSecondsPerHour = ConfigManager.getInstance().get<number>('TimeSystem', 'realSecondsPerHour') || 120;
        this.gameSeconds = startHour * 3600;
    }

    public static getInstance(): WorldClock {
        if (!WorldClock.instance) {
            WorldClock.instance = new WorldClock();
        }
        return WorldClock.instance;
    }

    public update(dt: number): void {
        // Convert real dt to game seconds
        // 3600 game seconds / realSecondsPerHour
        const gameSecondsPassed = dt * (3600 / this.realSecondsPerHour);
        this.gameSeconds = (this.gameSeconds + gameSecondsPassed) % (24 * 3600);
    }

    public getTimeState(): TimeState {
        const totalSeconds = this.gameSeconds;
        const hour = Math.floor(totalSeconds / 3600);
        const minute = Math.floor((totalSeconds % 3600) / 60);

        const sunrise = ConfigManager.getInstance().get<number>('TimeSystem', 'sunriseHour') || 6;
        const sunset = ConfigManager.getInstance().get<number>('TimeSystem', 'sunsetHour') || 19;
        
        // Sun Angle: Ensure it's never perfectly 90 degrees (vertical)
        const dayProgress = (totalSeconds / (24 * 3600)); 
        const sunAngle = (dayProgress * Math.PI * 2) + 0.5; // Constant offset ensures slant
        
        const sunDirection = {
            x: Math.cos(sunAngle),
            y: Math.sin(sunAngle)
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
            isDaylight: hour >= 7 && hour < 18
        };
    }

    private calculateAmbient(h: number, m: number, sInHour: number): { intensity: number, color: string } {
        const timeDecimal = h + (m / 60) + (sInHour / 3600);
        
        // Intensity: Peaks from 7AM to 6PM
        const minAmb = ConfigManager.getInstance().get<number>('Lighting', 'ambientMin') || 0.05;
        const maxAmb = ConfigManager.getInstance().get<number>('Lighting', 'ambientMax') || 1.0;
        
        let intensity = minAmb;
        if (timeDecimal >= 5 && timeDecimal < 7) { // 5-7 Sunrise transition
            const t = (timeDecimal - 5) / 2;
            intensity = minAmb + (maxAmb - minAmb) * t;
        } else if (timeDecimal >= 7 && timeDecimal < 18) { // 7-18 Full Day
            intensity = maxAmb;
        } else if (timeDecimal >= 18 && timeDecimal < 20) { // 18-20 Sunset transition
            const t = (timeDecimal - 18) / 2;
            intensity = maxAmb - (maxAmb - minAmb) * t;
        }

        // Color
        let r = 255, g = 255, b = 255;
        
        if (timeDecimal >= 5 && timeDecimal < 6) { // 5-6 Dusk: Deep Blue to Greenish Teal
            const t = (timeDecimal - 5);
            r = Math.floor(20 * (1 - t) + 40 * t);
            g = Math.floor(30 * (1 - t) + 120 * t);
            b = Math.floor(100 * (1 - t) + 120 * t);
        } else if (timeDecimal >= 6 && timeDecimal < 7) { // 6-7 Sunrise: Teal to Golden Orange
            const t = (timeDecimal - 6);
            r = Math.floor(40 * (1 - t) + 255 * t);
            g = Math.floor(120 * (1 - t) + 180 * t);
            b = Math.floor(120 * (1 - t) + 80 * t);
        } else if (timeDecimal >= 7 && timeDecimal < 9) { // 7-9 Early Morning: Orange to Soft Yellow
            const t = (timeDecimal - 7) / 2;
            r = 255;
            g = Math.floor(180 * (1 - t) + 255 * t);
            b = Math.floor(80 * (1 - t) + 200 * t);
        } else if (timeDecimal >= 9 && timeDecimal < 16) { // 9-16 Day: Neutral White
            r = 255; g = 255; b = 255;
        } else if (timeDecimal >= 16 && timeDecimal < 18) { // 16-18 Late Afternoon: White to Golden
            const t = (timeDecimal - 16) / 2;
            r = 255;
            g = Math.floor(255 * (1 - t) + 220 * t);
            b = Math.floor(255 * (1 - t) + 150 * t);
        } else if (timeDecimal >= 18 && timeDecimal < 19) { // 18-19 Sunset: Golden to Deep Red/Orange
            const t = (timeDecimal - 18);
            r = 255;
            g = Math.floor(220 * (1 - t) + 80 * t);
            b = Math.floor(150 * (1 - t) + 40 * t);
        } else if (timeDecimal >= 19 && timeDecimal < 21) { // 19-21 Dawn: Red to Deep Midnight Blue
            const t = (timeDecimal - 19) / 2;
            r = Math.floor(255 * (1 - t) + 15 * t);
            g = Math.floor(80 * (1 - t) + 15 * t);
            b = Math.floor(40 * (1 - t) + 60 * t);
        } else { // Night
            r = 15; g = 15; b = 60;
        }

        return { intensity, color: `rgb(${r},${g},${b})` };
    }
}
