import { Simulation } from "../Simulation";
import { IPlugin } from "./IPlugin";
import { WorldClock } from "../WorldClock";
import { WeatherManager } from "../WeatherManager";

export class WeatherTimePlugin implements IPlugin {
    public readonly id = "core-weather-time";
    public readonly name = "Weather & Time System";

    private clock: WorldClock;
    private weather: WeatherManager;

    constructor() {
        this.clock = WorldClock.getInstance();
        this.weather = WeatherManager.getInstance();
    }

    public onInstall(sim: Simulation): void {
        console.log("Weather & Time Plugin Installed");
    }

    public update(dt: number): void {
        this.clock.update(dt);
        this.weather.update(dt);
    }

    public onUninstall(sim: Simulation): void {
        // Singletons persist, but we could reset them here if needed
    }

    public getSyncState(): any {
        return {
            time: (this.clock as any).gameSeconds,
            weather: (this.weather as any).currentType,
            snow: (this.weather as any).snowAccumulation
        };
    }

    public applySyncState(state: any): void {
        if (state.time !== undefined) {
            (this.clock as any).gameSeconds = state.time;
        }
        if (state.weather !== undefined) {
            this.weather.setWeather(state.weather);
        }
        if (state.snow !== undefined) {
            (this.weather as any).snowAccumulation = state.snow;
        }
    }
}
