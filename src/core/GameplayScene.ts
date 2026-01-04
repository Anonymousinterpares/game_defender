import { Scene } from './Scene';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { World } from './World';
import { Player } from '../entities/Player';
import { PhysicsEngine } from './PhysicsEngine';
import { SoundManager } from './SoundManager';
import { Radar } from '../ui/Radar';
import { Entity } from './Entity';
import { ConfigManager } from '../config/MasterConfig';
import { Projectile, ProjectileType } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Drop, DropType } from '../entities/Drop';
import { MoltenMetalParticle } from '../entities/Particle';
import { HeatMap, MaterialType } from './HeatMap';
import { WorldClock } from './WorldClock';
import { LightManager } from './LightManager';
import { FloorDecalManager } from './FloorDecalManager';
import { GameplayHUD, HUDParent } from '../ui/GameplayHUD';
import { WeaponSystem, WeaponParent } from '../systems/WeaponSystem';
import { CombatSystem, CombatParent } from '../systems/CombatSystem';
import { LightingRenderer, LightingParent } from './renderers/LightingRenderer';
import { WeatherManager, WeatherType } from './WeatherManager';
import { ParticleSystem } from './ParticleSystem';

export class GameplayScene implements Scene, HUDParent, WeaponParent, CombatParent, LightingParent {
  public world: World | null = null;
  public player: Player | null = null;
  public physics: PhysicsEngine;
  private radar: Radar | null = null;
  private hud: GameplayHUD;
  private weaponSystem: WeaponSystem;
  private combatSystem: CombatSystem;
  private lightingRenderer: LightingRenderer;
  
  public entities: Entity[] = [];
  public enemies: Enemy[] = [];
  public drops: Drop[] = [];
  public projectiles: Projectile[] = [];
  
  public cameraX: number = 0;
  public cameraY: number = 0;
  public coinsCollected: number = 0;
  
  public lastShotTime: number = 0;
  public shootCooldown: number = 0.2;
  private nextDropSpawn: number = 5;
  private nextEnemySpawn: number = 3; 

  // Weapon State
  public weaponAmmo: Map<string, number> = new Map();
  public unlockedWeapons: Set<string> = new Set(['cannon']);
  public weaponReloading: Map<string, boolean> = new Map();
  public weaponReloadTimer: Map<string, number> = new Map();

  public readonly weaponSlots: { [key: string]: string } = {
    'Digit1': 'cannon',
    'Digit2': 'rocket',
    'Digit3': 'missile',
    'Digit4': 'laser',
    'Digit5': 'ray',
    'Digit6': 'mine',
    'Digit7': 'flamethrower'
  };

  private isDevMode: boolean = false;
  private spawnEnemies: boolean = true;

  // Beam state - managed by weaponSystem now
  public get isFiringBeam() { return this.weaponSystem.isFiringBeam; }
  public get isFiringFlamethrower() { return this.weaponSystem.isFiringFlamethrower; }
  public get beamEndPos() { return this.weaponSystem.beamEndPos; }
  
  public heatMap: HeatMap | null = null;
  private lightUpdateCounter: number = 0;

  constructor(public sceneManager: SceneManager, private inputManager: InputManager) {
    this.physics = new PhysicsEngine();
    this.hud = new GameplayHUD(this);
    this.weaponSystem = new WeaponSystem(this);
    this.combatSystem = new CombatSystem(this);
    this.lightingRenderer = new LightingRenderer(this);
  }

  public setLastShotTime(time: number): void {
      this.lastShotTime = time;
  }

  public subtractCoins(amount: number): boolean {
    if (this.coinsCollected >= amount) {
        this.coinsCollected -= amount;
        return true;
    }
    return false;
  }

  public refreshHUD(): void {
      this.shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
  }

  onEnter(): void {
    this.world = new World();
    this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
    this.world.setHeatMap(this.heatMap);
    this.physics.setWorld(this.world);
    
    const sm = SoundManager.getInstance();
    sm.init();
    sm.setWorld(this.world);
    sm.loadSound('ping', '/assets/sounds/ping.wav');
    sm.loadSound('shoot_cannon', '/assets/sounds/shoot_cannon.wav');
    sm.loadSound('shoot_laser', '/assets/sounds/shoot_laser.wav');
    sm.loadSound('shoot_ray', '/assets/sounds/shoot_ray.wav');
    sm.loadSound('shoot_rocket', '/assets/sounds/shoot_rocket.wav');
    sm.loadSound('shoot_missile', '/assets/sounds/shoot_missile.wav');
    sm.loadSound('place_mine', '/assets/sounds/place_mine.wav');
    sm.loadSound('shoot_flamethrower', '/assets/sounds/shoot_flamethrower.wav');
    sm.loadSound('weapon_reload', '/assets/sounds/weapon_reload.wav');
    sm.loadSound('hit_cannon', '/assets/sounds/hit_cannon.wav');
    sm.loadSound('hit_missile', '/assets/sounds/hit_missile.wav');
    sm.loadSound('hit_laser', '/assets/sounds/hit_laser.wav');
    sm.loadSound('hit_ray', '/assets/sounds/hit_ray.wav');
    sm.loadSound('explosion_large', '/assets/sounds/explosion_large.wav');
    sm.loadSound('collect_coin', '/assets/sounds/collect_coin.wav');
    sm.loadSound('ui_click', '/assets/sounds/ui_click.wav');
    sm.loadSound('fire', '/assets/sounds/fire.wav');

    sm.discoverMaterialVariants(['wood', 'brick', 'stone', 'metal', 'indestructible']);

    const centerX = this.world.getWidthPixels() / 2;
    const centerY = this.world.getHeightPixels() / 2;
    this.player = new Player(centerX, centerY, this.inputManager);
    
    this.entities.push(this.player);
    this.physics.addBody(this.player);
    this.player.getAllBodies().forEach(b => {
        if (b !== this.player) this.physics.addBody(b);
    });

    this.radar = new Radar();
    this.shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
    this.coinsCollected = ConfigManager.getInstance().get<number>('Debug', 'startingCoins') || 0;
    
    const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
    const alwaysOn = ConfigManager.getInstance().get<boolean>('Debug', 'devModeAlwaysOn');
    
    weapons.forEach(w => {
        const configKey = w === 'laser' || w === 'ray' || w === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
        const max = ConfigManager.getInstance().get<number>('Weapons', w + configKey);
        this.weaponAmmo.set(w, max);
        this.weaponReloading.set(w, false);
        this.weaponReloadTimer.set(w, 0);
        if (alwaysOn) this.unlockedWeapons.add(w);
    });

    this.spawnEnemies = ConfigManager.getInstance().get<boolean>('Debug', 'enableEnemySpawning');
    this.hud.create();
  }

  onExit(): void {
    if (this.radar) {
      this.radar.destroy();
      this.radar = null;
    }
    this.hud.cleanup();
    this.entities = [];
    this.enemies = [];
    this.drops = [];
    this.projectiles = [];
    this.physics = new PhysicsEngine();
    this.lightingRenderer.clearCache();
    FloorDecalManager.getInstance().clear();
    SoundManager.getInstance().stopLoopSpatial('shoot_laser');
    SoundManager.getInstance().stopLoopSpatial('shoot_ray');
    SoundManager.getInstance().stopLoopSpatial('hit_laser');
    SoundManager.getInstance().stopLoopSpatial('hit_ray');
  }

  update(dt: number): void {
    if (this.inputManager.isKeyJustPressed('Escape')) {
      this.sceneManager.switchScene('menu');
      return;
    }

    WorldClock.getInstance().update(dt);
    LightManager.getInstance().update(dt);
    this.lightUpdateCounter++;
    
    this.hud.update(dt);
    
    const dockKey = ConfigManager.getInstance().get<string>('Keybindings', 'openDock');
    if (this.inputManager.isKeyJustPressed(dockKey)) {
        this.hud.toggleDock();
    }

    if (this.hud.isDockOpen) return;

    for (const [key, weaponName] of Object.entries(this.weaponSlots)) {
        if (this.inputManager.isKeyJustPressed(key)) {
            if (this.unlockedWeapons.has(weaponName)) {
                ConfigManager.getInstance().set('Player', 'activeWeapon', weaponName);
                SoundManager.getInstance().playSound('ui_click');
            }
        }
    }

    this.weaponSystem.update(dt, this.inputManager);
    this.combatSystem.update(dt);

    this.physics.update(dt);
    Entity.setInterpolationAlpha(this.physics.alpha);

    if (this.player) {
        SoundManager.getInstance().updateListener(this.player.interpolatedX, this.player.interpolatedY);
    }

    this.nextDropSpawn -= dt;
    if (this.nextDropSpawn <= 0) {
        this.spawnDrop();
        this.nextDropSpawn = 5 + Math.random() * 10;
    }

    this.nextEnemySpawn -= dt;
    if (this.nextEnemySpawn <= 0) {
        if (this.spawnEnemies) {
            this.spawnEnemy();
        }
        this.nextEnemySpawn = 4 + Math.random() * 4;
    }

    this.entities.forEach(e => {
        if (e instanceof Player) {
            e.update(dt, this.enemies, (x, y, angle) => {
                this.projectiles.push(new Projectile(x, y, angle));
            });
        }
        else e.update(dt);
    });
    this.enemies.forEach(e => e.update(dt, this.player || undefined));
    this.drops.forEach(d => d.update(dt));
    
    this.projectiles = this.projectiles.filter(p => { p.update(dt); return p.active; });
    
    ParticleSystem.getInstance().update(dt, this.world, this.player, this.enemies);

    this.enemies = this.enemies.filter(e => { if(!e.active) this.physics.removeBody(e); return e.active; });
    this.drops = this.drops.filter(d => d.active);

    if (this.player) {
      const allActiveEntities: Entity[] = [this.player, ...this.player.segments, ...this.enemies];
      allActiveEntities.forEach(e => {
          if (this.heatMap) {
              const maxIntensity = this.heatMap.getMaxIntensityArea(e.x, e.y, e.radius);
              if (!e.isOnFire && maxIntensity > 0.05) {
                  const ignitionPercent = Math.round(10 + 90 * maxIntensity);
                  if (Math.random() < (ignitionPercent / 100) * dt) e.isOnFire = true;
              }
              if (maxIntensity > 0.05) {
                  const heatDPS = Math.ceil(20 * maxIntensity);
                  e.takeDamage(heatDPS * dt);
              }
              if (!e.isOnFire && this.heatMap.checkFireArea(e.x, e.y, e.radius)) {
                  this.tryIgniteEntity(e, dt);
              }
          }
      });

      const allBurning = allActiveEntities.filter(e => e.isOnFire && e.active);
      const catchChance = ConfigManager.getInstance().get<number>('Fire', 'catchChance');
      allBurning.forEach(source => {
          allActiveEntities.forEach(target => {
              if (source !== target && target.active && !target.isOnFire) {
                  const dx = source.x - target.x;
                  const dy = source.y - target.y;
                  if (dx*dx + dy*dy < (source.radius + target.radius)**2) {
                      if (Math.random() < catchChance * dt) target.isOnFire = true;
                  }
              }
          });
      });

      this.cameraX = this.player.interpolatedX - window.innerWidth / 2;
      this.cameraY = this.player.interpolatedY - window.innerHeight / 2;
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
    this.heatMap?.update(dt);
  }

  private updateProjectileLights(): void {
      const lm = LightManager.getInstance();
      lm.clearConstantLights();
      ParticleSystem.getInstance().getParticles().forEach((p) => {
          if (p instanceof MoltenMetalParticle && p.active) {
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
          const range = (this as any).flameHitDist || (ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerRange') * ConfigManager.getInstance().get<number>('World', 'tileSize'));
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
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.world.render(ctx, this.cameraX, this.cameraY);
    FloorDecalManager.getInstance().render(ctx, this.cameraX, this.cameraY);
    if (this.heatMap) this.heatMap.render(ctx, this.cameraX, this.cameraY);
    this.drops.forEach(d => d.render(ctx));
    this.player.render(ctx);
    const renderDist = ConfigManager.getInstance().get<number>('World', 'renderDistance') * ConfigManager.getInstance().get<number>('World', 'tileSize');
    this.enemies.forEach(e => {
        if (Math.abs(e.x - this.player!.x) < renderDist && Math.abs(e.y - this.player!.y) < renderDist) e.render(ctx);
    });
    this.projectiles.forEach(p => p.render(ctx));
    ParticleSystem.getInstance().render(ctx);
    if (this.isFiringBeam && this.player) {
        const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
        ctx.beginPath(); ctx.moveTo(this.player.x, this.player.y); ctx.lineTo(this.beamEndPos.x, this.beamEndPos.y);
        if (weapon === 'laser') { ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.5; ctx.stroke(); }
        else { ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; ctx.lineWidth = 15 + Math.random() * 5; ctx.stroke(); }
    }
    ctx.restore();
    this.lightingRenderer.render(ctx);
    if (this.radar) this.radar.render(this.player, [this.player, ...this.enemies, ...this.projectiles]);
    this.hud.render(ctx);
  }

  private spawnDrop(): void {
    if (!this.world) return;
    const pos = this.getRandomValidPos();
    this.drops.push(new Drop(pos.x, pos.y, Math.random() < 0.8 ? DropType.COIN : DropType.BOOSTER));
  }

  private spawnEnemy(): void {
    if (!this.world || !this.player) return;
    for(let i=0; i<10; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 400 + Math.random() * 400;
        const ex = this.player.x + Math.cos(angle) * dist;
        const ey = this.player.y + Math.sin(angle) * dist;
        if (!this.world.isWall(ex, ey)) {
            const e = new Enemy(ex, ey);
            this.enemies.push(e);
            this.physics.addBody(e);
            break;
        }
    }
  }

  private getRandomValidPos(): {x: number, y: number} {
    if (!this.world) return {x: 0, y: 0};
    for(let i=0; i<20; i++) {
        const rx = Math.random() * this.world.getWidthPixels();
        const ry = Math.random() * this.world.getHeightPixels();
        if (!this.world.isWall(rx, ry)) return {x: rx, y: ry};
    }
    return {x: 100, y: 100};
  }

  public createImpactParticles(x: number, y: number, color: string): void {
      this.combatSystem.createImpactParticles(x, y, color);
  }

  public startReload(weapon: string): void {
      if (this.weaponReloading.get(weapon)) return;
      const reloadTime = ConfigManager.getInstance().get<number>('Weapons', weapon + 'ReloadTime');
      if (reloadTime <= 0) {
          this.weaponAmmo.set(weapon, ConfigManager.getInstance().get<number>('Weapons', weapon + (weapon === 'laser' || weapon === 'ray' ? 'MaxEnergy' : 'MaxAmmo')));
          return;
      }
      this.weaponReloading.set(weapon, true);
      this.weaponReloadTimer.set(weapon, reloadTime);
      if (weapon === ConfigManager.getInstance().get<string>('Player', 'activeWeapon') && this.player) SoundManager.getInstance().playSoundSpatial('weapon_reload', this.player.x, this.player.y);
  }

  private tryIgniteEntity(e: Entity, dt: number): void {
      if (e.isOnFire) return;
      if (Math.random() < ConfigManager.getInstance().get<number>('Fire', 'catchChance') * dt * 5) e.isOnFire = true;
  }

  public handleCommand(cmd: string): boolean {
    const cleanCmd = cmd.trim().toLowerCase();
    if (cleanCmd === 'dev_on') { this.isDevMode = true; return true; }
    if (!this.isDevMode && !ConfigManager.getInstance().get<boolean>('Debug', 'devModeAlwaysOn')) return false;
    if (cleanCmd.startsWith('add_weapon')) {
        const num = parseInt(cleanCmd.replace('add_weapon', ''));
        const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
        if (num >= 1 && num <= 7) {
            const wName = weapons[num-1];
            this.unlockedWeapons.add(wName);
            ConfigManager.getInstance().set('Player', 'activeWeapon', wName);
            return true;
        }
    }
    if (cleanCmd.startsWith('add_coins')) {
        const amount = parseInt(cleanCmd.replace('add_coins', ''));
        if (!isNaN(amount)) { this.coinsCollected += amount; return true; }
    }
    if (cleanCmd === 'spawn_on') { this.spawnEnemies = true; ConfigManager.getInstance().set('Debug', 'enableEnemySpawning', true); return true; }
    if (cleanCmd === 'spawn_off') { this.spawnEnemies = false; ConfigManager.getInstance().set('Debug', 'enableEnemySpawning', false); return true; }
    
    // Weather Commands
    if (cleanCmd === 'set_weather_clear') { WeatherManager.getInstance().setWeather(WeatherType.CLEAR); return true; }
    if (cleanCmd === 'set_weather_cloudy') { WeatherManager.getInstance().setWeather(WeatherType.CLOUDY); return true; }
    if (cleanCmd === 'set_weather_fog') { WeatherManager.getInstance().setWeather(WeatherType.FOG); return true; }
    if (cleanCmd === 'set_weather_rain') { WeatherManager.getInstance().setWeather(WeatherType.RAIN); return true; }
    if (cleanCmd === 'set_weather_snow') { WeatherManager.getInstance().setWeather(WeatherType.SNOW); return true; }

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