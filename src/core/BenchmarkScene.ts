import { GameplayScene } from './GameplayScene';
import { ParticleSystem } from './ParticleSystem';
import { WeatherManager, WeatherType } from './WeatherManager';
import { ConfigManager } from '../config/MasterConfig';
import { WorldClock } from './WorldClock';
import { PerfMonitor } from '../utils/PerfMonitor';
import { SoundManager } from './SoundManager';
import { Enemy } from '../entities/Enemy';
import { LightManager } from './LightManager';

export class BenchmarkScene extends GameplayScene {
    private benchmarkTimer: number = 0;
    private currentPhase: number = 0;
    private isFinished: boolean = false;
    private finalReport: string = "";

    onEnter(): Promise<void> {
        return super.onEnter().then(() => {
            this.benchmarkTimer = 0;
            this.currentPhase = 0;
            this.isFinished = false;
            this.finalReport = "";

            // 1. Force state for clean testing
            this.handleCommand('dev_on');
            this.handleCommand('spawn_off');
            ConfigManager.getInstance().set('Benchmark', 'showPerfMetrics', true);
            
            // 2. Invincibility
            if (this.player) {
                this.player.takeDamage = () => {}; // Override with NOOP
            }

            // 3. Clear existing world state
            (this.simulation as any).enemies = [];
            (this.simulation as any).projectiles = [];
            ParticleSystem.getInstance().clear();

            // 4. Start recording
            PerfMonitor.getInstance().startSession();
            console.log("=== BENCHMARK STARTED ===");
        });
    }

    onExit(): void {
        super.onExit();
        PerfMonitor.getInstance().endSession();
    }

    update(dt: number): void {
        if (this.isFinished) {
            if (this.inputManager.isKeyJustPressed('Space') || this.inputManager.isKeyJustPressed('Enter')) {
                this.sceneManager.switchScene('menu');
            }
            return;
        }

        this.benchmarkTimer += dt;
        
        // Automated Player Movement (Circle)
        if (this.player) {
            const centerX = this.world!.getWidthPixels() / 2;
            const centerY = this.world!.getHeightPixels() / 2;
            const radius = 200;
            const speed = 1.5;
            this.player.x = centerX + Math.cos(this.benchmarkTimer * speed) * radius;
            this.player.y = centerY + Math.sin(this.benchmarkTimer * speed) * radius;
            this.player.rotation = this.benchmarkTimer * speed + Math.PI/2;
        }

        // --- PREDETERMINED SEQUENCE ---
        
        // Phase 0: Clear Weather, Base Physics (0-5s)
        if (this.benchmarkTimer < 5) {
            this.currentPhase = 0;
        } 
        // Phase 1: Heavy Rain (5-10s)
        else if (this.benchmarkTimer < 10) {
            if (this.currentPhase !== 1) {
                this.currentPhase = 1;
                WeatherManager.getInstance().setWeather(WeatherType.RAIN);
            }
        } 
        // Phase 2: Heavy Snow + Parallax (10-15s)
        else if (this.benchmarkTimer < 15) {
            if (this.currentPhase !== 2) {
                this.currentPhase = 2;
                WeatherManager.getInstance().setWeather(WeatherType.SNOW);
            }
        } 
        // Phase 3: Massive Explosions & High Particle Count (15-25s)
        else if (this.benchmarkTimer < 25) {
            this.currentPhase = 3;
            // Stress lighting and particles simultaneously
            if (this.benchmarkTimer % 0.3 < dt) {
                const ox = (Math.random()-0.5) * 800;
                const oy = (Math.random()-0.5) * 800;
                this.spawnMassiveExplosion(this.player!.x + ox, this.player!.y + oy);
            }
            // Background molten stress
            for(let i=0; i<30; i++) {
                const rx = this.player!.x + (Math.random()-0.5)*1200;
                const ry = this.player!.y + (Math.random()-0.5)*1200;
                ParticleSystem.getInstance().spawnMoltenMetal(rx, ry, (Math.random()-0.5)*100, (Math.random()-0.5)*100);
            }
        } 
        // Phase 4: Night + Fog + Shadow Stress (25-35s)
        else if (this.benchmarkTimer < 35) {
            if (this.currentPhase !== 4) {
                this.currentPhase = 4;
                WeatherManager.getInstance().setWeather(WeatherType.FOG);
                WorldClock.getInstance().setHour(23); // Total darkness
            }
            // Spawn multiple moving shadow casters (enemies as ghosts)
            if (this.enemies.length < 20) {
                this.spawnGhostEnemy();
            }
        }
        // Finalize
        else {
            this.finishBenchmark();
        }

        // Call super but with DISABLED input processing
        // We bypass player.update and weaponSystem.update to keep it passive
        this.runPassiveUpdate(dt);
    }

    private runPassiveUpdate(dt: number): void {
        PerfMonitor.getInstance().begin('update_total');
        WorldClock.getInstance().update(dt);
        this.hud.update(dt);
        ParticleSystem.getInstance().update(dt, this.world, this.player, this.enemies);
        this.heatMap?.update(dt);
        this.enemies.forEach(e => e.update(dt, this.player || undefined));
        (this.simulation as any).projectiles = this.projectiles.filter(p => { p.update(dt); return p.active; });
        PerfMonitor.getInstance().end('update_total');
    }

    private spawnMassiveExplosion(x: number, y: number): void {
        ParticleSystem.getInstance().spawnFlash(x, y, 400);
        for(let i=0; i<200; i++) {
            const angle = Math.random() * Math.PI * 2;
            const spd = 50 + Math.random() * 400;
            ParticleSystem.getInstance().spawnParticle(x, y, '#ff8800', Math.cos(angle)*spd, Math.sin(angle)*spd, 1.0);
        }
        LightManager.getInstance().addTransientLight('explosion', x, y);
        SoundManager.getInstance().playSoundSpatial('explosion_large', x, y);
    }

    private spawnGhostEnemy(): void {
        const angle = Math.random() * Math.PI * 2;
        const ex = this.player!.x + Math.cos(angle) * 300;
        const ey = this.player!.y + Math.sin(angle) * 300;
        const e = new Enemy(ex, ey);
        e.takeDamage = () => {}; // Invincible
        this.simulation.enemies.push(e);
    }

    private finishBenchmark(): void {
        this.isFinished = true;
        PerfMonitor.getInstance().endSession();
        this.finalReport = PerfMonitor.getInstance().generateReport();
        console.log(this.finalReport);
    }

    render(ctx: CanvasRenderingContext2D): void {
        super.render(ctx);
        
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        if (!this.isFinished) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, w, 60);
            ctx.fillStyle = '#ffff00';
            ctx.font = 'bold 24px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`BENCHMARK RUNNING - PHASE ${this.currentPhase}/4 - ${this.benchmarkTimer.toFixed(1)}s`, w/2, 40);
        } else {
            // Darken background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(0, 0, w, h);

            // Report Panel
            const pw = 600;
            const ph = 400;
            const px = (w - pw) / 2;
            const py = (h - ph) / 2;

            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, pw, ph);
            
            ctx.fillStyle = '#00ff00';
            ctx.font = 'bold 28px monospace';
            ctx.textAlign = 'center';
            ctx.fillText("PERFORMANCE SCORECARD", w/2, py + 40);

            ctx.font = '16px monospace';
            ctx.textAlign = 'left';
            const lines = this.finalReport.split('\n');
            let ly = py + 80;
            lines.forEach(line => {
                ctx.fillText(line, px + 40, ly);
                ly += 22;
            });

            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText("Press SPACE or ENTER to return to menu", w/2, py + ph - 30);
        }
    }
}
