/// <reference types="vite/client" />
import { Scene } from './Scene';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { World } from './World';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SoundManager } from './SoundManager';
import { Radar } from '../ui/Radar';
import { Entity } from './Entity';
import { ConfigManager } from '../config/MasterConfig';
import { ProjectileType } from '../entities/Projectile';
import { WorldClock } from './WorldClock';
import { LightManager } from './LightManager';
import { FloorDecalManager } from './FloorDecalManager';
import { GameplayHUD, HUDParent } from '../ui/GameplayHUD';
import { LightingRenderer, LightingParent } from './renderers/LightingRenderer';
import { WeatherManager, WeatherType } from './WeatherManager';
import { ParticleSystem } from './ParticleSystem';
import { ParticleType } from './ParticleConstants';
import { PerfMonitor } from '../utils/PerfMonitor';
import { BenchmarkSystem } from '../utils/BenchmarkSystem';
import { Rect } from '../utils/Quadtree';
import { Simulation, SimulationRole } from './Simulation';
import { WorldRenderer } from './renderers/WorldRenderer';
import { MaterialType } from './HeatMap';
import { WeatherTimePlugin } from './plugins/WeatherTimePlugin';
import { ChaosPlugin } from './plugins/ChaosPlugin';

export class GameplayScene implements Scene, HUDParent, LightingParent {
    public simulation: Simulation;
    public worldRenderer: WorldRenderer;
    protected radar: Radar | null = null;
    protected hud: GameplayHUD;
    protected lightingRenderer: LightingRenderer;
    protected benchmark: BenchmarkSystem;
    protected inputManager: InputManager;

    public cameraX: number = 0;
    public cameraY: number = 0;

    // Getters to bridge to simulation for HUD/Renderer compatibility
    public get world() { return this.simulation.world; }
    public get player() { return this.simulation.player; }
    public get heatMap() { return this.simulation.heatMap; }
    public get enemies() { return this.simulation.enemies; }
    public get remotePlayers() { return this.simulation.remotePlayers; }
    public get drops() { return this.simulation.drops; }
    public get projectiles() { return this.simulation.projectiles; }
    public get coinsCollected() { return this.simulation.coinsCollected; }
    public set coinsCollected(val: number) { this.simulation.coinsCollected = val; }
    public get myId() { return this.simulation.myId; }

    public get weaponAmmo() { return this.simulation.weaponAmmo; }
    public get unlockedWeapons() { return this.simulation.unlockedWeapons; }
    public get weaponReloading() { return this.simulation.weaponReloading; }
    public get weaponReloadTimer() { return this.simulation.weaponReloadTimer; }

    private isDevMode: boolean = false;
    private lightUpdateCounter: number = 0;

    public get isFiringBeam() { return this.simulation.weaponSystem.isFiringBeam; }
    public get isFiringFlamethrower() { return this.simulation.weaponSystem.isFiringFlamethrower; }
    public get beamEndPos() { return this.simulation.weaponSystem.beamEndPos; }

    public readonly weaponSlots: { [key: string]: string } = {
        'Digit1': 'cannon', 'Digit2': 'rocket', 'Digit3': 'missile', 'Digit4': 'laser', 'Digit5': 'ray', 'Digit6': 'mine', 'Digit7': 'flamethrower'
    };

    constructor(public sceneManager: SceneManager, inputManager: InputManager) {
        this.inputManager = inputManager;
        this.simulation = new Simulation(SimulationRole.SINGLEPLAYER);
        this.worldRenderer = new WorldRenderer(this.simulation.world);
        this.hud = new GameplayHUD(this);
        this.lightingRenderer = new LightingRenderer(this);
        this.benchmark = new BenchmarkSystem(this);
    }

    public subtractCoins(amount: number): boolean {
        if (this.simulation.coinsCollected >= amount) {
            this.simulation.coinsCollected -= amount;
            return true;
        }
        return false;
    }

    public refreshHUD(): void {
        this.simulation.shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
    }

    async onEnter(): Promise<void> {
        // Reset Singletons for clean state
        WorldClock.getInstance().reset();
        LightManager.getInstance().reset();
        WeatherManager.getInstance().reset();
        SoundManager.getInstance().reset();

        const seed = ConfigManager.getInstance().get<number>('Debug', 'forcedSeed');
        this.simulation = new Simulation(SimulationRole.SINGLEPLAYER, seed);
        this.simulation.pluginManager.install(new WeatherTimePlugin());
        this.simulation.player.inputManager = this.inputManager; // Link input
        this.worldRenderer = new WorldRenderer(this.simulation.world);

        ParticleSystem.getInstance().clear();

        this.radar = new Radar();
        this.hud.create();

        const sm = SoundManager.getInstance();
        await sm.init();
        sm.setWorld(this.simulation.world);
    }

    onExit(): void {
        if (this.radar) { this.radar.destroy(); this.radar = null; }
        this.hud.cleanup();
        this.lightingRenderer.clearCache();
        FloorDecalManager.getInstance().clear();
        SoundManager.getInstance().stopLoopSpatial('shoot_laser');
        SoundManager.getInstance().stopLoopSpatial('shoot_ray');
        SoundManager.getInstance().stopLoopSpatial('hit_laser');
        SoundManager.getInstance().stopLoopSpatial('hit_ray');
    }

    update(dt: number): void {
        PerfMonitor.getInstance().begin('update_total');
        if (this.inputManager.isKeyJustPressed('Escape')) {
            this.sceneManager.switchScene('menu');
            return;
        }

        this.benchmark.update(dt);
        LightManager.getInstance().update(dt);
        FloorDecalManager.getInstance().update(dt);
        this.lightUpdateCounter++;

        this.hud.update(dt);

        const dockKey = ConfigManager.getInstance().get<string>('Keybindings', 'openDock');
        if (this.inputManager.isKeyJustPressed(dockKey)) {
            this.hud.toggleDock();
        }

        if (this.hud.isDockOpen) return;

        for (const [key, weaponName] of Object.entries(this.weaponSlots)) {
            if (this.inputManager.isKeyJustPressed(key)) {
                if (this.simulation.unlockedWeapons.has(weaponName)) {
                    ConfigManager.getInstance().set('Player', 'activeWeapon', weaponName);
                    SoundManager.getInstance().playSound('ui_click');
                }
            }
        }

        // UPDATE SIMULATION
        this.simulation.update(dt, this.inputManager);

        if (this.player) {
            const alpha = this.simulation.physicsSystem.alpha;
            const px = this.player.prevX + (this.player.x - this.player.prevX) * alpha;
            const py = this.player.prevY + (this.player.y - this.player.prevY) * alpha;

            SoundManager.getInstance().updateListener(px, py);
            this.cameraX = px - window.innerWidth / 2;
            this.cameraY = py - window.innerHeight / 2;

            // Update WeatherSystemECS Camera for correct World Wrapping and Repulsion
            if (this.simulation.weatherSystemECS) {
                this.simulation.weatherSystemECS.setCamera(this.cameraX, this.cameraY, window.innerWidth, window.innerHeight);
            }
        }

        if (this.radar && this.player) this.radar.update(dt);

        const timeState = WorldClock.getInstance().getTimeState();
        const useFog = ConfigManager.getInstance().get<boolean>('Visuals', 'fogOfWar');
        if (timeState.sun.intensity < 0.8 || useFog) {
            this.updateLightClusters();
            this.updateProjectileLights();
        } else {
            LightManager.getInstance().clearConstantLights();
            LightManager.getInstance().clearType('fire');
        }
        PerfMonitor.getInstance().end('update_total');
    }

    private updateProjectileLights(): void {
        const lm = LightManager.getInstance();
        lm.clearConstantLights();
        ParticleSystem.getInstance().getParticles().forEach((p) => {
            if (p.type === ParticleType.MOLTEN && p.active) {
                const intensity = (p as any).z < 0 ? 0.8 : 0.6 * (p.life / 7.0);
                if (intensity > 0.1) {
                    lm.addConstantLight({
                        id: `molten_${p.id}`, x: p.x, y: p.y + (p as any).z, radius: 80, color: p.color, intensity: intensity, type: 'transient'
                    });
                }
            }
        });
        this.projectiles.forEach((p) => {
            if (p.type === ProjectileType.ROCKET || p.type === ProjectileType.MISSILE) {
                lm.addConstantLight({
                    id: `const_proj_${p.id}`, x: p.x, y: p.y, radius: 120, color: p.type === ProjectileType.ROCKET ? '#ff6600' : '#00ffff', intensity: 1.0, type: 'transient'
                });
            }
        });
        if (this.isFiringFlamethrower && this.player) {
            const time = performance.now() * 0.001;
            const flicker = Math.sin(time * 30) * 0.2 + Math.random() * 0.1;
            const intensity = 1.2 + flicker;
            const range = (this.simulation.weaponSystem as any).flameHitDist || (ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerRange') * ConfigManager.getInstance().get<number>('World', 'tileSize'));
            const fireColor = `rgb(255, ${Math.floor(160 + Math.sin(time * 15) * 40)}, 0)`;
            lm.addConstantLight({ id: 'flamethrower_nozzle', x: this.player.x + Math.cos(this.player.rotation) * 20, y: this.player.y + Math.sin(this.player.rotation) * 20, radius: 120, color: fireColor, intensity: intensity, type: 'transient' });
            for (let i = 1; i <= 3; i++) {
                const t = i / 3;
                lm.addConstantLight({ id: `flame_stream_${i}`, x: this.player.x + Math.cos(this.player.rotation) * (t * range), y: this.player.y + Math.sin(this.player.rotation) * (t * range), radius: 80 * t + 60, color: t > 0.7 ? '#ff4400' : fireColor, intensity: intensity * (1 - t * 0.4), type: 'transient' });
            }
        }
        if (this.isFiringBeam && this.player) {
            const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
            const color = weapon === 'laser' ? '#ff0000' : '#00ffff';
            for (let i = 0; i <= 5; i++) {
                const t = i / 5;
                lm.addConstantLight({ id: `const_beam_${i}`, x: this.player.x + (this.beamEndPos.x - this.player.x) * t, y: this.player.y + (this.beamEndPos.y - this.player.y) * t, radius: weapon === 'laser' ? 60 : 100, color: color, intensity: 0.8, type: 'transient' });
            }
        }
    }

    private updateLightClusters(): void {
        const freq = ConfigManager.getInstance().get<number>('Lighting', 'updateFrequency') || 3;
        if (this.lightUpdateCounter % freq !== 0) return;
        if (this.heatMap) {
            const clusters = this.heatMap.getFireClusters(128);
            LightManager.getInstance().updateFireLights(clusters);
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.world || !this.player) return;
        PerfMonitor.getInstance().begin('render_world');
        ctx.save();
        ctx.translate(-this.cameraX, -this.cameraY);

        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const centerX = this.cameraX + viewW / 2;
        const centerY = this.cameraY + viewH / 2;

        // 1. Render Ground
        this.worldRenderer.render(ctx, this.cameraX, this.cameraY);
        FloorDecalManager.getInstance().render(ctx, this.cameraX, this.cameraY, this.world.getWidthPixels(), this.world.getHeightPixels());
        if (this.heatMap) this.heatMap.render(ctx, this.cameraX, this.cameraY);

        // 2. Render Wall Sides (Bottom to Top)
        this.worldRenderer.renderSides(ctx, this.cameraX, this.cameraY);

        // 3. COLLECT & SORT FOREGROUND (Entities + Wall Tops)
        const alpha = this.simulation.physicsSystem.alpha;
        const renderables: any[] = this.simulation.renderSystem.collectRenderables(this.simulation.entityManager, alpha, centerX, centerY);

        // Add Wall Tops as renderables
        const tileSize = this.world.getTileSize();
        const startTx = Math.floor(this.cameraX / tileSize);
        const endTx = Math.ceil((this.cameraX + viewW) / tileSize);
        const startTy = Math.floor(this.cameraY / tileSize);
        const endTy = Math.ceil((this.cameraY + viewH) / tileSize);

        for (let ty = startTy; ty <= endTy; ty++) {
            if (ty < 0 || ty >= this.world.getHeight()) continue;
            for (let tx = startTx; tx <= endTx; tx++) {
                if (tx < 0 || tx >= this.world.getWidth()) continue;
                const material = this.world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;
                
                renderables.push({
                    y: (ty + 1) * tileSize, // Base Y of the wall
                    render: (c: CanvasRenderingContext2D) => {
                        this.worldRenderer.renderWallTopOnly(c, tx, ty, material, centerX, centerY);
                    }
                });
            }
        }

        // Sort by Y (Painter's Algorithm)
        renderables.sort((a, b) => a.y - b.y);

        // DRAW SORTED
        renderables.forEach(r => r.render(ctx));

        // 4. Custom Entities & Plugins
        const viewport: Rect = { x: this.cameraX, y: this.cameraY, w: viewW, h: viewH };
        const visibleEntities = this.simulation.spatialGrid.retrieve(viewport);
        visibleEntities.forEach(e => {
            const render = this.simulation.entityManager.getComponent<any>(e.id, 'render');
            if (!render || render.renderType === 'custom') {
                if (typeof (e as any).render === 'function') {
                    (e as any).render(ctx);
                }
            }
        });

        this.simulation.pluginManager.render(ctx);

        PerfMonitor.getInstance().begin('render_particles');
        ParticleSystem.getInstance().render(ctx, this.cameraX, this.cameraY, this.simulation.physicsSystem.alpha);
        PerfMonitor.getInstance().end('render_particles');

        if (this.isFiringBeam && this.player) {
            const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
            ctx.beginPath(); ctx.moveTo(this.player.x, this.player.y); ctx.lineTo(this.beamEndPos.x, this.beamEndPos.y);
            if (weapon === 'laser') { ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.5; ctx.stroke(); }
            else { ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; ctx.lineWidth = 15 + Math.random() * 5; ctx.stroke(); }
        }
        ctx.restore();
        PerfMonitor.getInstance().end('render_world');

        PerfMonitor.getInstance().begin('render_lighting');
        this.lightingRenderer.render(ctx);
        PerfMonitor.getInstance().end('render_lighting');

        if (this.player) {
            const mm = (window as any).MultiplayerManagerInstance || null;
            this.hud.renderEntityOverlay(ctx, this.player, this.cameraX, this.cameraY, mm ? mm.myName : 'Player');
        }

        if (this.radar && this.player) {
            this.radar.render(this.player.x, this.player.y, this.simulation.entityManager);
        }
        this.hud.render(ctx);

        if (ConfigManager.getInstance().get<boolean>('Benchmark', 'showPerfMetrics')) {
            PerfMonitor.getInstance().render(ctx);
        }
    }

    // DEPRECATED: Radar now queries EntityManager directly
    protected getRadarEntities(): any[] {
        return [];
    }

    public handleCommand(cmd: string): boolean {
        const cleanCmd = cmd.trim().toLowerCase();
        if (cleanCmd === 'dev_on') { this.isDevMode = true; return true; }
        if (!this.isDevMode && !ConfigManager.getInstance().get<boolean>('Debug', 'devModeAlwaysOn')) return false;
        if (cleanCmd.startsWith('add_weapon')) {
            const num = parseInt(cleanCmd.replace('add_weapon', ''));
            const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
            if (num >= 1 && num <= 7) {
                const wName = weapons[num - 1];
                this.simulation.unlockedWeapons.add(wName);
                ConfigManager.getInstance().set('Player', 'activeWeapon', wName);
                return true;
            }
        }
        if (cleanCmd.startsWith('add_coins')) {
            const amount = parseInt(cleanCmd.replace('add_coins', ''));
            if (!isNaN(amount)) { this.simulation.coinsCollected += amount; return true; }
        }
        if (cleanCmd === 'spawn_on') { ConfigManager.getInstance().set('Debug', 'enableEnemySpawning', true); return true; }
        if (cleanCmd === 'spawn_off') { ConfigManager.getInstance().set('Debug', 'enableEnemySpawning', false); return true; }
        if (cleanCmd === 'perf_benchmark') { this.benchmark.start(); return true; }

        if (cleanCmd === 'set_weather_clear') { WeatherManager.getInstance().setWeather(WeatherType.CLEAR); return true; }
        if (cleanCmd === 'set_weather_cloudy') { WeatherManager.getInstance().setWeather(WeatherType.CLOUDY); return true; }
        if (cleanCmd === 'set_weather_fog') { WeatherManager.getInstance().setWeather(WeatherType.FOG); return true; }
        if (cleanCmd === 'set_weather_rain') { WeatherManager.getInstance().setWeather(WeatherType.RAIN); return true; }
        if (cleanCmd === 'set_weather_snow') { WeatherManager.getInstance().setWeather(WeatherType.SNOW); return true; }

        if (cleanCmd === 'chaos_on') {
            this.simulation.pluginManager.install(new ChaosPlugin());
            return true;
        }
        if (cleanCmd === 'chaos_off') {
            this.simulation.pluginManager.uninstall('debug-chaos');
            return true;
        }

        if (cleanCmd.startsWith('set_time_speed ')) {
            const val = parseFloat(cleanCmd.split(' ')[1]);
            if (!isNaN(val)) { ConfigManager.getInstance().set('TimeSystem', 'realSecondsPerHour', val); return true; }
        }
        if (cleanCmd.startsWith('set_time_hour ')) {
            const val = parseFloat(cleanCmd.split(' ')[1]);
            if (!isNaN(val)) { WorldClock.getInstance().setHour(val); return true; }
        }
        return false;
    }
}
