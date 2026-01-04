import { GameplayScene } from '../core/GameplayScene';
import { ParticleSystem } from '../core/ParticleSystem';
import { WeatherManager, WeatherType } from '../core/WeatherManager';
import { ConfigManager } from '../config/MasterConfig';

export class BenchmarkSystem {
    private isRunning: boolean = false;
    private phase: number = 0;
    private timer: number = 0;
    private results: any[] = [];

    constructor(private scene: GameplayScene) {}

    public start(): void {
        console.log("Starting Benchmark...");
        this.isRunning = true;
        this.phase = 0;
        this.timer = 0;
        this.results = [];
        this.scene.handleCommand('dev_on');
        this.scene.handleCommand('spawn_off');
    }

    public update(dt: number): void {
        if (!this.isRunning) return;
        this.timer += dt;

        // Phase 1: Heavy Particles (10 seconds)
        if (this.phase === 0) {
            if (this.timer % 0.1 < dt) {
                for(let i=0; i<50; i++) {
                    const x = this.scene.player!.x + (Math.random()-0.5)*1000;
                    const y = this.scene.player!.y + (Math.random()-0.5)*1000;
                    ParticleSystem.getInstance().spawnMoltenMetal(x, y, (Math.random()-0.5)*200, (Math.random()-0.5)*200);
                }
            }
            if (this.timer > 10) { this.phase++; this.timer = 0; }
        }
        // Phase 2: Weather + Particles (10 seconds)
        else if (this.phase === 1) {
            WeatherManager.getInstance().setWeather(WeatherType.RAIN);
            if (this.timer % 0.05 < dt) {
                 const x = this.scene.player!.x;
                 const y = this.scene.player!.y;
                 ParticleSystem.getInstance().spawnFlash(x + (Math.random()-0.5)*800, y + (Math.random()-0.5)*800, 200);
            }
            if (this.timer > 10) { this.phase++; this.timer = 0; }
        }
        // Phase 3: Stress All Systems
        else if (this.phase === 2) {
             WeatherManager.getInstance().setWeather(WeatherType.SNOW);
             // Logic to spawn many enemies could go here
             if (this.timer > 10) {
                 this.isRunning = false;
                 console.log("Benchmark Complete.");
                 WeatherManager.getInstance().setWeather(WeatherType.CLEAR);
             }
        }
    }

    public isActive(): boolean {
        return this.isRunning;
    }
}
