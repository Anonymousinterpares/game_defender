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
import { Particle } from '../entities/Particle';
import { TurretUpgrade, ShieldUpgrade } from '../entities/upgrades/Upgrade';
import { HeatMap, MaterialType } from './HeatMap';
import { WorldClock } from './WorldClock';
import { LightManager } from './LightManager';
import { VisibilitySystem, Point } from './VisibilitySystem';
import { FloorDecalManager } from './FloorDecalManager';

export class GameplayScene implements Scene {
  private world: World | null = null;
  private player: Player | null = null;
  private physics: PhysicsEngine;
  private radar: Radar | null = null;
  
  private entities: Entity[] = [];
  private enemies: Enemy[] = [];
  private drops: Drop[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  
  private cameraX: number = 0;
  private cameraY: number = 0;
  private coinsCollected: number = 0;
  
  private lastShotTime: number = 0;
  private shootCooldown: number = 0.2;
  private nextDropSpawn: number = 5;
  private nextEnemySpawn: number = 3; 

  // UI elements
  private container: HTMLElement | null = null;
  private backButton: HTMLButtonElement | null = null;
  private muteButton: HTMLButtonElement | null = null;
  private volumeSlider: HTMLInputElement | null = null;
  private clockDisplay: HTMLElement | null = null;
  private dockButton: HTMLButtonElement | null = null;
  private dockContainer: HTMLElement | null = null;
  private isDockOpen: boolean = false;

  // Weapon State
  private weaponAmmo: Map<string, number> = new Map();
  private unlockedWeapons: Set<string> = new Set(['cannon']);
  private weaponReloading: Map<string, boolean> = new Map();
  private weaponReloadTimer: Map<string, number> = new Map();
  private lastActiveWeapon: string = '';

  private readonly weaponSlots: { [key: string]: string } = {
    'Digit1': 'cannon',
    'Digit2': 'rocket',
    'Digit3': 'missile',
    'Digit4': 'laser',
    'Digit5': 'ray',
    'Digit6': 'mine',
    'Digit7': 'flamethrower'
  };

  // Dev Mode
  private isDevMode: boolean = false;
  private spawnEnemies: boolean = true;

  // Beam state
  private isFiringBeam: boolean = false;
  private isFiringFlamethrower: boolean = false;
  private beamEndPos: { x: number, y: number } = { x: 0, y: 0 };
  
  // Heat Simulation
  private heatMap: HeatMap | null = null;

  // Fog of War state
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;

  // Lighting System
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private lightUpdateCounter: number = 0;
  private lightPolygonCache: Map<string, Point[]> = new Map();
  private meshVersion: number = 0;

  // Static Shadow Cache (Ambient + Sun)
  private shadowChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: string }> = new Map();
  private chunkSize: number = 512;

  constructor(private sceneManager: SceneManager, private inputManager: InputManager) {
    this.physics = new PhysicsEngine();
  }

  onEnter(): void {
    this.world = new World();
    this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
    this.world.setHeatMap(this.heatMap);
    this.physics.setWorld(this.world);
    
    // Load Sounds
    const sm = SoundManager.getInstance();
    sm.init(); // Initialize with config values
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

    // Automatically discover and load all material hit variants
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
    
    // Initialize Ammo
    const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
    const alwaysOn = ConfigManager.getInstance().get<boolean>('Debug', 'devModeAlwaysOn');
    
    weapons.forEach(w => {
        const configKey = w === 'laser' || w === 'ray' || w === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
        const max = ConfigManager.getInstance().get<number>('Weapons', w + configKey);
        this.weaponAmmo.set(w, max);
        this.weaponReloading.set(w, false);
        this.weaponReloadTimer.set(w, 0);
        
        if (alwaysOn) {
            this.unlockedWeapons.add(w);
        }
    });

    this.initWeaponState();
    
    // Dev Mode initialization
    this.spawnEnemies = ConfigManager.getInstance().get<boolean>('Debug', 'enableEnemySpawning');

    // Init Fog Canvas
    this.fogCanvas = document.createElement('canvas');
    this.fogCtx = this.fogCanvas.getContext('2d');

    // Init Light Canvas
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d');

    this.createUI();
  }

  onExit(): void {
    if (this.radar) {
      this.radar.destroy();
      this.radar = null;
    }
    this.cleanupUI();
    this.entities = [];
    this.enemies = [];
    this.drops = [];
    this.projectiles = [];
    this.physics = new PhysicsEngine();
    this.fogCanvas = null;
    this.fogCtx = null;
    this.lightCanvas = null;
    this.lightCtx = null;
    this.shadowChunks.clear();
    FloorDecalManager.getInstance().clear();
    SoundManager.getInstance().stopLoopSpatial('shoot_laser');
    SoundManager.getInstance().stopLoopSpatial('shoot_ray');
    SoundManager.getInstance().stopLoopSpatial('hit_laser');
    SoundManager.getInstance().stopLoopSpatial('hit_ray');
  }

  private createUI(): void {
      const uiLayer = document.getElementById('ui-layer');
      if (!uiLayer) return;

      this.backButton = document.createElement('button');
      this.backButton.textContent = 'MENU';
      this.backButton.className = 'hud-btn';
      this.backButton.style.position = 'absolute';
      this.backButton.style.top = '10px';
      this.backButton.style.right = '10px';
      this.backButton.addEventListener('click', () => {
          SoundManager.getInstance().playSound('ui_click');
          this.sceneManager.switchScene('menu');
      });
      uiLayer.appendChild(this.backButton);

      this.muteButton = document.createElement('button');
      this.updateMuteButtonText();
      this.muteButton.className = 'hud-btn';
      this.muteButton.style.position = 'absolute';
      this.muteButton.style.top = '10px';
      this.muteButton.style.right = '100px';
      this.muteButton.addEventListener('click', () => {
          SoundManager.getInstance().playSound('ui_click');
          SoundManager.getInstance().toggleMute();
          this.updateMuteButtonText();
      });
      uiLayer.appendChild(this.muteButton);

      this.volumeSlider = document.createElement('input');
      this.volumeSlider.type = 'range';
      this.volumeSlider.min = '0';
      this.volumeSlider.max = '1';
      this.volumeSlider.step = '0.01';
      this.volumeSlider.value = SoundManager.getInstance().getVolume().toString();
      this.volumeSlider.className = 'hud-slider';
      this.volumeSlider.style.position = 'absolute';
      this.volumeSlider.style.top = '15px';
      this.volumeSlider.style.right = '190px';
      this.volumeSlider.style.width = '80px';
      this.volumeSlider.style.pointerEvents = 'auto';
      this.volumeSlider.addEventListener('input', (e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          SoundManager.getInstance().setVolume(val);
      });
      uiLayer.appendChild(this.volumeSlider);

      this.clockDisplay = document.createElement('div');
      this.clockDisplay.className = 'hud-text';
      this.clockDisplay.style.position = 'absolute';
      this.clockDisplay.style.top = '10px';
      this.clockDisplay.style.right = '390px'; // 280 + 100 for dock + padding
      this.clockDisplay.style.fontSize = '1.2em';
      this.clockDisplay.style.color = '#cfaa6e';
      this.clockDisplay.style.fontFamily = '"Share Tech Mono", monospace';
      this.clockDisplay.style.padding = '5px 10px';
      this.clockDisplay.style.background = 'rgba(0,0,0,0.5)';
      this.clockDisplay.style.borderRadius = '5px';
      this.clockDisplay.textContent = '00:00';
      uiLayer.appendChild(this.clockDisplay);

      this.dockButton = document.createElement('button');
      this.dockButton.textContent = 'DOCK (P)';
      this.dockButton.className = 'hud-btn';
      this.dockButton.style.position = 'absolute';
      this.dockButton.style.top = '10px';
      this.dockButton.style.right = '280px';
      this.dockButton.addEventListener('click', () => {
          SoundManager.getInstance().playSound('ui_click');
          this.toggleDock();
      });
      uiLayer.appendChild(this.dockButton);
  }

  private updateMuteButtonText(): void {
    if (!this.muteButton) return;
    const muted = SoundManager.getInstance().getMuted();
    this.muteButton.textContent = muted ? 'UNMUTE' : 'MUTE';
  }

  private cleanupUI(): void {
      if (this.backButton) { this.backButton.remove(); this.backButton = null; }
      if (this.dockButton) { this.dockButton.remove(); this.dockButton = null; }
      if (this.muteButton) { this.muteButton.remove(); this.muteButton = null; }
      if (this.volumeSlider) { this.volumeSlider.remove(); this.volumeSlider = null; }
      if (this.clockDisplay) { this.clockDisplay.remove(); this.clockDisplay = null; }
      if (this.dockContainer) { this.dockContainer.remove(); this.dockContainer = null; }
  }

  private toggleDock(): void {
      this.isDockOpen = !this.isDockOpen;
      if (this.isDockOpen) {
          this.openDockUI();
      } else {
          if (this.dockContainer) {
              this.dockContainer.remove();
              this.dockContainer = null;
          }
      }
  }

  private openDockUI(): void {
      const uiLayer = document.getElementById('ui-layer');
      if (!uiLayer) return;

      this.dockContainer = document.createElement('div');
      this.dockContainer.className = 'ui-panel';
      this.dockContainer.style.zIndex = '2000';
      
      const speedCost = ConfigManager.getInstance().get<number>('Upgrades', 'speedUpgradeCost');
      const fireRateCost = ConfigManager.getInstance().get<number>('Upgrades', 'fireRateUpgradeCost');
      const repairCost = ConfigManager.getInstance().get<number>('Upgrades', 'hullRepairCost');

      uiLayer.appendChild(this.dockContainer);
      this.updateDockContent(repairCost, speedCost, fireRateCost);
  }

  private updateDockContent(repairCost: number, speedCost: number, fireRateCost: number): void {
      if (!this.dockContainer) return;

      const slotCost = ConfigManager.getInstance().get<number>('Upgrades', 'slotUpgradeCost');
      const turretCost = ConfigManager.getInstance().get<number>('Upgrades', 'turretUpgradeCost');
      const shieldCost = ConfigManager.getInstance().get<number>('Upgrades', 'shieldUpgradeCost');
      
      this.dockContainer.innerHTML = `
        <h2>ENGINEERING DOCK</h2>
        <p style="text-align: center; color: #cfaa6e; font-size: 1.2em;">COINS: ${this.coinsCollected}</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <button id="buy-repair" ${this.coinsCollected < repairCost ? 'disabled style="opacity:0.5"' : ''}>Repair Hull (${repairCost})</button>
            <button id="buy-speed" ${this.coinsCollected < speedCost ? 'disabled style="opacity:0.5"' : ''}>Engine Tune (${speedCost})</button>
            <button id="buy-fire" ${this.coinsCollected < fireRateCost ? 'disabled style="opacity:0.5"' : ''}>Weapon Sys (${fireRateCost})</button>
            <button id="buy-slot" ${this.coinsCollected < slotCost ? 'disabled style="opacity:0.5"' : ''}>New Slot (${slotCost})</button>
            <button id="buy-turret" ${this.coinsCollected < turretCost ? 'disabled style="opacity:0.5"' : ''}>Equip Turret (${turretCost})</button>
            <button id="buy-shield" ${this.coinsCollected < shieldCost ? 'disabled style="opacity:0.5"' : ''}>Equip Shield (${shieldCost})</button>
        </div>
        <button id="btn-close-dock" style="margin-top: 20px; background: #594326;">CLOSE DOCK</button>
      `;

      this.dockContainer.querySelector('#buy-repair')?.addEventListener('click', () => {
          if (this.coinsCollected >= repairCost) {
              SoundManager.getInstance().playSound('ui_click');
              this.coinsCollected -= repairCost;
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-speed')?.addEventListener('click', () => {
          if (this.coinsCollected >= speedCost) {
              SoundManager.getInstance().playSound('ui_click');
              this.coinsCollected -= speedCost;
              const currentSpeed = ConfigManager.getInstance().get<number>('Player', 'baseSpeed');
              ConfigManager.getInstance().set('Player', 'baseSpeed', currentSpeed + 1);
              if (this.player) this.player.refreshConfig();
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-fire')?.addEventListener('click', () => {
          if (this.coinsCollected >= fireRateCost) {
              SoundManager.getInstance().playSound('ui_click');
              this.coinsCollected -= fireRateCost;
              const currentRate = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
              ConfigManager.getInstance().set('Player', 'shootCooldown', Math.max(0.05, currentRate - 0.02));
              this.shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-slot')?.addEventListener('click', () => {
          if (this.coinsCollected >= slotCost && this.player) {
              SoundManager.getInstance().playSound('ui_click');
              this.coinsCollected -= slotCost;
              this.player.addSlot();
              const allBodies = this.player.getAllBodies();
              this.physics.addBody(allBodies[allBodies.length - 1]);
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-turret')?.addEventListener('click', () => {
          if (this.coinsCollected >= turretCost && this.player) {
              const freeSlotIdx = this.findFreeSlot();
              if (freeSlotIdx !== -1) {
                  SoundManager.getInstance().playSound('ui_click');
                  this.coinsCollected -= turretCost;
                  const slot = this.player.segments[freeSlotIdx];
                  this.player.upgrades.set(freeSlotIdx, new TurretUpgrade(slot));
                  this.updateDockContent(repairCost, speedCost, fireRateCost);
              } else {
                  alert("NO FREE SLOTS!");
              }
          }
      });

      this.dockContainer.querySelector('#buy-shield')?.addEventListener('click', () => {
          if (this.coinsCollected >= shieldCost && this.player) {
              const freeSlotIdx = this.findFreeSlot();
              if (freeSlotIdx !== -1) {
                  SoundManager.getInstance().playSound('ui_click');
                  this.coinsCollected -= shieldCost;
                  const slot = this.player.segments[freeSlotIdx];
                  this.player.upgrades.set(freeSlotIdx, new ShieldUpgrade(slot));
                  this.updateDockContent(repairCost, speedCost, fireRateCost);
              } else {
                  alert("NO FREE SLOTS!");
              }
          }
      });

      this.dockContainer.querySelector('#btn-close-dock')?.addEventListener('click', () => {
          SoundManager.getInstance().playSound('ui_click');
          this.toggleDock();
      });
  }

  private findFreeSlot(): number {
      if (!this.player) return -1;
      for (let i = 0; i < this.player.segments.length; i++) {
          if (!this.player.upgrades.has(i)) return i;
      }
      return -1;
  }

  update(dt: number): void {
    if (this.inputManager.isKeyJustPressed('Escape')) {
      this.sceneManager.switchScene('menu');
      return;
    }

    // Update Systems
    WorldClock.getInstance().update(dt);
    LightManager.getInstance().update(dt);
    this.lightUpdateCounter++;
    
    if (this.clockDisplay) {
        const state = WorldClock.getInstance().getTimeState();
        const ampm = state.hour >= 12 ? 'PM' : 'AM';
        let displayHour = state.hour % 12;
        if (displayHour === 0) displayHour = 12;
        
        const hh = displayHour.toString().padStart(2, '0');
        const mm = state.minute.toString().padStart(2, '0');
        this.clockDisplay.textContent = `${hh}:${mm} ${ampm}`;
    }
    
    const dockKey = ConfigManager.getInstance().get<string>('Keybindings', 'openDock');
    if (this.inputManager.isKeyJustPressed(dockKey)) {
        this.toggleDock();
    }

    if (this.isDockOpen) return;

    // --- Weapon Switching ---
    for (const [key, weaponName] of Object.entries(this.weaponSlots)) {
        if (this.inputManager.isKeyJustPressed(key)) {
            if (this.unlockedWeapons.has(weaponName)) {
                ConfigManager.getInstance().set('Player', 'activeWeapon', weaponName);
                SoundManager.getInstance().playSound('ui_click');
            } else {
                console.warn(`Weapon ${weaponName} not unlocked yet.`);
            }
        }
    }

    // --- Weapon / Ammo Logic ---
    const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
    if (weapon !== this.lastActiveWeapon) {
        this.initWeaponState();
    }

    // Update all reload timers
    this.weaponReloadTimer.forEach((timer, w) => {
        if (this.weaponReloading.get(w)) {
            const newTimer = timer - dt;
            this.weaponReloadTimer.set(w, newTimer);
            if (newTimer <= 0) {
                this.finishReload(w);
            }
        }
    });

    this.physics.update(dt);
    if (this.player) {
        SoundManager.getInstance().updateListener(this.player.x, this.player.y);
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

    // --- WEAPON LOGIC ---
    this.isFiringBeam = false;
    this.isFiringFlamethrower = false;
    const isReloading = this.weaponReloading.get(weapon);
    const currentAmmo = this.weaponAmmo.get(weapon) || 0;

    if (this.inputManager.isKeyDown('Space') && this.player && !isReloading) {
      const now = performance.now() / 1000;
      
      if (weapon === 'cannon' || weapon === 'rocket' || weapon === 'missile' || weapon === 'mine') {
          // ... [existing logic] ...
      } else if (weapon === 'laser' || weapon === 'ray' || weapon === 'flamethrower') {
          if (currentAmmo > 0) {
            if (weapon === 'flamethrower') {
                this.isFiringFlamethrower = true;
                this.handleFlamethrowerFiring(dt);
            } else {
                this.isFiringBeam = true;
                this.handleBeamFiring(weapon, dt);
            }
            const loopSfx = weapon === 'laser' ? 'shoot_laser' : (weapon === 'ray' ? 'shoot_ray' : 'shoot_flamethrower');
            SoundManager.getInstance().startLoopSpatial(loopSfx, this.player.x, this.player.y);
            SoundManager.getInstance().updateLoopPosition(loopSfx, this.player.x, this.player.y);
            
            const depletion = ConfigManager.getInstance().get<number>('Weapons', weapon + 'DepletionRate');
            const newAmmo = Math.max(0, currentAmmo - depletion * dt);
            this.weaponAmmo.set(weapon, newAmmo);
            
            if (newAmmo <= 0) {
                this.startReload(weapon);
            }
          } else {
            this.startReload(weapon);
          }
      }
    }

    if (!this.isFiringBeam) {
        SoundManager.getInstance().stopLoopSpatial('shoot_laser');
        SoundManager.getInstance().stopLoopSpatial('shoot_ray');
        SoundManager.getInstance().stopLoopSpatial('hit_laser');
        SoundManager.getInstance().stopLoopSpatial('hit_ray');
    }
    
    if (!this.isFiringFlamethrower) {
        SoundManager.getInstance().stopLoopSpatial('shoot_flamethrower');
    }

    if (this.player) {
      for (const p of this.projectiles) {
        // Projectile vs World
        if (this.world) {
            const mapW = this.world.getWidthPixels();
            const mapH = this.world.getHeightPixels();
            const hitWall = this.world.isWall(p.x, p.y);
            const hitBorder = p.x < 0 || p.x > mapW || p.y < 0 || p.y > mapH;

            if (hitWall || hitBorder) {
                if (hitWall && this.heatMap) {
                    p.onWorldHit(this.heatMap, p.x, p.y);
                }
                
                if (p.aoeRadius > 0) {
                    this.createExplosion(p.x, p.y, p.aoeRadius, p.damage);
                } else {
                    const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                    SoundManager.getInstance().playSoundSpatial(sfx, p.x, p.y);
                    this.createImpactParticles(p.x, p.y, p.color);
                }
                p.active = false;
                continue;
            }
        }

        // Projectile vs Enemy
        if (p.active) {
            for (const e of this.enemies) {
              if (this.physics.checkCollision(p, e)) {
                if (p.type === ProjectileType.MINE && !p.isArmed) continue;
                
                if (p.aoeRadius > 0) {
                    this.createExplosion(p.x, p.y, p.aoeRadius, p.damage);
                } else {
                    e.takeDamage(p.damage);
                    const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                    SoundManager.getInstance().playSoundSpatial(sfx, p.x, p.y);
                }
                p.active = false;
                break;
              }
            }
        }
      }

      for (const d of this.drops) {
        if (this.physics.checkCollision(this.player, d)) {
          d.active = false;
          SoundManager.getInstance().playSound('collect_coin');
          if (d.type === DropType.COIN) this.coinsCollected += 10;
        }
      }
    }

    // --- Updates ---
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
    this.particles = this.particles.filter(p => { p.update(dt, this.world); return p.active; });
    this.enemies = this.enemies.filter(e => { if(!e.active) this.physics.removeBody(e); return e.active; });
    this.drops = this.drops.filter(d => d.active);

    if (this.player) {
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;

      // Check environment effects for all entities
      const allActiveEntities: Entity[] = [this.player, ...this.player.segments, ...this.enemies];
      
      allActiveEntities.forEach(e => {
          if (this.heatMap) {
              const maxIntensity = this.heatMap.getMaxIntensityArea(e.x, e.y, e.radius);
              
              // 1. Dynamic Ignition from Heat (if not already on fire)
              if (!e.isOnFire && maxIntensity > 0.05) {
                  // Probability: 10% at min (0.05ish) to 100% at max (1.0)
                  // P = round(10 + 90 * intensity)
                  const ignitionPercent = Math.round(10 + 90 * maxIntensity);
                  const catchProbability = (ignitionPercent / 100) * dt;
                  
                  if (Math.random() < catchProbability) {
                      e.isOnFire = true;
                  }
              }

              // 2. Damage from hot floor (any material)
              if (maxIntensity > 0.05) {
                  const heatDPS = Math.ceil(20 * maxIntensity);
                  e.takeDamage(heatDPS * dt);
              }

              // 3. Fallback check for active fire tiles (guaranteed check)
              if (!e.isOnFire && this.heatMap.checkFireArea(e.x, e.y, e.radius)) {
                  this.tryIgniteEntity(e, dt);
              }
          }
      });

      // Entity vs Entity fire spread
      const allBurning = allActiveEntities.filter(e => e.isOnFire && e.active);
      const catchChance = ConfigManager.getInstance().get<number>('Fire', 'catchChance');

      allBurning.forEach(source => {
          allActiveEntities.forEach(target => {
              if (source !== target && target.active && !target.isOnFire) {
                  const dx = source.x - target.x;
                  const dy = source.y - target.y;
                  const dist = Math.sqrt(dx*dx + dy*dy);
                  if (dist < source.radius + target.radius) {
                      if (Math.random() < catchChance * dt) {
                          target.isOnFire = true;
                      }
                  }
              }
          });
      });

      this.cameraX = this.player.x - screenW / 2;
      this.cameraY = this.player.y - screenH / 2;
    }

    if (this.radar && this.player) {
      this.radar.update(dt);
    }

    const timeState = WorldClock.getInstance().getTimeState();
    if (timeState.ambientIntensity < 0.8) {
        this.updateLightClusters();
        this.updateProjectileLights();
    } else {
        // Ensure constant lights from previous frames are cleared if it just became day
        LightManager.getInstance().clearConstantLights();
        LightManager.getInstance().clearType('fire');
    }
    
    this.heatMap?.update(dt);
  }

  private updateProjectileLights(): void {
      const lm = LightManager.getInstance();
      lm.clearConstantLights();

      this.projectiles.forEach((p, i) => {
          if (p.type === ProjectileType.ROCKET || p.type === ProjectileType.MISSILE) {
              lm.addConstantLight({
                  id: `const_proj_${i}`,
                  x: p.x,
                  y: p.y,
                  radius: 120,
                  color: p.type === ProjectileType.ROCKET ? '#ff6600' : '#00ffff',
                  intensity: 1.0,
                  type: 'transient'
              });
          }
      });

      if (this.isFiringFlamethrower && this.player) {
          const time = performance.now() * 0.001;
          const flicker = Math.sin(time * 30) * 0.2 + Math.random() * 0.1;
          const intensity = 1.2 + flicker;
          const range = (this as any).flameHitDist || (ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerRange') * ConfigManager.getInstance().get<number>('World', 'tileSize'));
          
          // Slight color jitter: shift between orange and reddish-orange
          const r = Math.floor(255);
          const g = Math.floor(160 + Math.sin(time * 15) * 40);
          const b = Math.floor(0);
          const fireColor = `rgb(${r}, ${g}, ${b})`;

          // Light at nozzle
          lm.addConstantLight({
              id: 'flamethrower_nozzle',
              x: this.player.x + Math.cos(this.player.rotation) * 20,
              y: this.player.y + Math.sin(this.player.rotation) * 20,
              radius: 120,
              color: fireColor,
              intensity: intensity,
              type: 'transient'
          });

          // Light along the flame stream
          const segments = 3;
          for (let i = 1; i <= segments; i++) {
              const t = i / segments;
              const dist = t * range;
              const lx = this.player.x + Math.cos(this.player.rotation) * dist;
              const ly = this.player.y + Math.sin(this.player.rotation) * dist;
              
              lm.addConstantLight({
                  id: `flame_stream_${i}`,
                  x: lx,
                  y: ly,
                  radius: 80 * t + 60,
                  color: t > 0.7 ? '#ff4400' : fireColor,
                  intensity: intensity * (1 - t * 0.4),
                  type: 'transient'
              });
          }
      }

      if (this.isFiringBeam && this.player) {
          const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
          const color = weapon === 'laser' ? '#ff0000' : '#00ffff';
          const dist = Math.sqrt((this.beamEndPos.x - this.player.x)**2 + (this.beamEndPos.y - this.player.y)**2);
          const segments = 5;
          for (let i = 0; i <= segments; i++) {
              const t = i / segments;
              const lx = this.player.x + (this.beamEndPos.x - this.player.x) * t;
              const ly = this.player.y + (this.beamEndPos.y - this.player.y) * t;
              lm.addConstantLight({
                  id: `const_beam_${i}`,
                  x: lx,
                  y: ly,
                  radius: weapon === 'laser' ? 60 : 100,
                  color: color,
                  intensity: 0.8,
                  type: 'transient'
              });
          }
      }
  }

  private handleBeamFiring(type: string, dt: number): void {
      if (!this.player || !this.world || !this.heatMap) return;
      
      const maxDist = type === 'laser' ? 800 : 500;
      const step = 8;
      let dist = 0;
      let hitEnemy: Enemy | null = null;
      let hitSomething = false;

      const mapW = this.world.getWidthPixels();
      const mapH = this.world.getHeightPixels();
      
      // Raycast for beam
      while (dist < maxDist) {
          const tx = this.player.x + Math.cos(this.player.rotation) * dist;
          const ty = this.player.y + Math.sin(this.player.rotation) * dist;
          
          if (this.world.isWall(tx, ty) || tx < 0 || tx > mapW || ty < 0 || ty > mapH) {
              hitSomething = true;
              break;
          }
          
          // Check enemy hits
          for (const e of this.enemies) {
              const dx = e.x - tx;
              const dy = e.y - ty;
              if (Math.sqrt(dx*dx + dy*dy) < e.radius) {
                  hitEnemy = e;
                  hitSomething = true;
                  break;
              }
          }
          if (hitEnemy) break;
          dist += step;
      }
      
      this.beamEndPos = {
          x: this.player.x + Math.cos(this.player.rotation) * dist,
          y: this.player.y + Math.sin(this.player.rotation) * dist
      };
      
      const hitSfx = type === 'laser' ? 'hit_laser' : 'hit_ray';

      if (hitSomething) {
          SoundManager.getInstance().startLoopSpatial(hitSfx, this.beamEndPos.x, this.beamEndPos.y);
          SoundManager.getInstance().updateLoopPosition(hitSfx, this.beamEndPos.x, this.beamEndPos.y);
          
          if (!hitEnemy) { // Only heat up environment
              const heatAmount = type === 'laser' ? 0.4 : 0.6; // Heat per frame
              this.heatMap.addHeat(this.beamEndPos.x, this.beamEndPos.y, heatAmount * dt * 5, 12);
              
              // Emit Sparks if very hot
              if (this.heatMap.getIntensityAt(this.beamEndPos.x, this.beamEndPos.y) > 0.8 && Math.random() < 0.3) {
                  this.createImpactParticles(this.beamEndPos.x, this.beamEndPos.y, '#fff');
              }
          }

          if (hitEnemy) {
            if (type === 'laser') {
                hitEnemy.takeDamage(ConfigManager.getInstance().get<number>('Weapons', 'laserDPS') * dt);
            } else {
                const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                const distInTiles = dist / tileSize;
                const base = ConfigManager.getInstance().get<number>('Weapons', 'rayBaseDamage');
                const damage = (base / (1 + distInTiles * distInTiles)) * dt;
                hitEnemy.takeDamage(damage);
            }
          }
      } else {
          SoundManager.getInstance().stopLoop(hitSfx, 0.5);
      }
  }

  private handleFlamethrowerFiring(dt: number): void {
      if (!this.player || !this.world || !this.heatMap) return;

      const rangeTiles = ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerRange');
      const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
      const range = rangeTiles * tileSize;
      const damage = ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerDamage');
      const coneAngle = Math.PI / 4; // 45 degrees

      // 1. Damage & Ignition
      const targets: Entity[] = [...this.enemies];
      targets.forEach(e => {
          const dx = e.x - this.player!.x;
          const dy = e.y - this.player!.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < range) {
              const angleToTarget = Math.atan2(dy, dx);
              let diff = angleToTarget - this.player!.rotation;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;

              if (Math.abs(diff) < coneAngle / 2) {
                  e.takeDamage(damage * dt);
                  e.isOnFire = true; // Immediate burn status
              }
          }
      });

      // 2. Environment Ignition & Raycasting stop
      const steps = 10;
      let finalRange = range;

      for (let i = 1; i <= steps; i++) {
          const dist = (i / steps) * range;
          const tx = this.player.x + Math.cos(this.player.rotation) * dist;
          const ty = this.player.y + Math.sin(this.player.rotation) * dist;
          
          if (this.world.isWall(tx, ty)) {
              finalRange = dist;
              
              // Only ignite if it's wood
              const mat = this.heatMap!.getMaterialAt(tx, ty);
              if (mat === MaterialType.WOOD) {
                  // Jitter ignition around the hit point
                  for (let j = 0; j < 3; j++) {
                      const jx = tx + (Math.random() - 0.5) * 10;
                      const jy = ty + (Math.random() - 0.5) * 10;
                      this.heatMap!.forceIgniteArea(jx, jy, 12);
                      this.heatMap!.addHeat(jx, jy, 0.8 * dt * 10, 15);
                  }
              }
              break; // Stop raycasting
          }
      }

      // Update flameHitDist for lighting reference
      (this as any).flameHitDist = finalRange;

      // 3. Particle Effects for Flames
      const flameCount = 3;
      for (let i = 0; i < flameCount; i++) {
          const angleOffset = (Math.random() - 0.5) * coneAngle;
          const pAngle = this.player.rotation + angleOffset;
          const speed = (finalRange / 0.5) * (0.8 + Math.random() * 0.4); 
          const vx = Math.cos(pAngle) * speed + this.player.vx * 0.5;
          const vy = Math.sin(pAngle) * speed + this.player.vy * 0.5;
          
          const p = new Particle(
              this.player.x + Math.cos(this.player.rotation) * 15,
              this.player.y + Math.sin(this.player.rotation) * 15,
              Math.random() < 0.3 ? '#ffcc00' : '#ff4400',
              vx, vy,
              0.4 + Math.random() * 0.2
          );
          p.isFlame = true;
          this.particles.push(p);
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

  private renderHUD(ctx: CanvasRenderingContext2D): void {
      if (!this.player) return;
      ctx.fillStyle = '#fff';
      ctx.font = '14px Courier';
      ctx.fillText(`POS: ${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}`, 10, 20);
      ctx.fillText(`COINS: ${this.coinsCollected}`, 10, 40);

      const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
      const isReloading = this.weaponReloading.get(weapon);
      const reloadTimer = this.weaponReloadTimer.get(weapon) || 0;
      const currentAmmo = this.weaponAmmo.get(weapon) || 0;

      let ammoText = "";
      if (weapon === 'cannon') {
          ammoText = "AMMO: ∞";
      } else {
          const displayAmmo = weapon === 'laser' || weapon === 'ray' ? currentAmmo.toFixed(1) : Math.floor(currentAmmo);
          ammoText = isReloading ? `RELOADING... (${reloadTimer.toFixed(1)}s)` : `AMMO: ${displayAmmo}`;
      }
      
      ctx.fillStyle = isReloading ? '#ff4500' : '#cfaa6e';
      ctx.font = 'bold 16px "Share Tech Mono"';
      ctx.fillText(`${weapon.toUpperCase()} | ${ammoText}`, 10, 70);

      ctx.font = '12px "Share Tech Mono"';
      let slotX = 10;
      Object.entries(this.weaponSlots).forEach(([key, name], i) => {
          const isSelected = name === weapon;
          const isUnlocked = this.unlockedWeapons.has(name);
          ctx.fillStyle = isSelected ? '#00ff00' : (isUnlocked ? '#888' : '#444');
          ctx.fillText(`${i+1}: ${name.toUpperCase()}${isSelected ? ' <' : ''}`, slotX, 90 + i * 15);
      });
  }

  private renderEntityShadow(ctx: CanvasRenderingContext2D, e: Entity, sunDir: {x: number, y: number}, len: number): void {
      const ex = e.x - this.cameraX;
      const ey = e.y - this.cameraY;
      const r = e.radius;

      // Calculate tangent points for a circle shadow
      const angle = Math.atan2(sunDir.y, sunDir.x);
      const t1x = ex + Math.cos(angle - Math.PI/2) * r;
      const t1y = ey + Math.sin(angle - Math.PI/2) * r;
      const t2x = ex + Math.cos(angle + Math.PI/2) * r;
      const t2y = ey + Math.sin(angle + Math.PI/2) * r;

      const t3x = t2x + sunDir.x * len;
      const t3y = t2y + sunDir.y * len;
      const t4x = t1x + sunDir.x * len;
      const t4y = t1y + sunDir.y * len;

      ctx.beginPath();
      ctx.moveTo(t1x, t1y);
      ctx.lineTo(t2x, t2y);
      ctx.lineTo(t3x, t3y);
      ctx.lineTo(t4x, t4y);
      ctx.closePath();
      ctx.fill();

      // Add a circle at the end to round it off
      ctx.beginPath();
      ctx.arc(ex + sunDir.x * len, ey + sunDir.y * len, r, 0, Math.PI * 2);
      ctx.fill();
  }

  private renderLighting(ctx: CanvasRenderingContext2D): void {
      const lightingEnabled = ConfigManager.getInstance().get<boolean>('Lighting', 'enabled');
      if (!lightingEnabled || !this.lightCanvas || !this.lightCtx || !this.world) return;

      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      
      if (this.lightCanvas.width !== w || this.lightCanvas.height !== h) {
          this.lightCanvas.width = w; this.lightCanvas.height = h;
      }

      const { ambientIntensity, sunColor, sunDirection } = WorldClock.getInstance().getTimeState();
      const worldMeshVersion = this.world.getMeshVersion();
      
      // Calculate a bake version that includes sun position (rounded to avoid too many bakes)
      const sunAngle = Math.atan2(sunDirection.y, sunDirection.x);
      const bakeVersion = `${worldMeshVersion}_${Math.round(sunAngle * 10)}`; 
      
      // --- 1. ACCUMULATE STATIC SHADOWS (CHUNKED) ---
      const lctx = this.lightCtx;
      lctx.globalCompositeOperation = 'source-over'; 
      lctx.fillStyle = sunColor; // The "Sunlight" color (e.g. white or yellow)
      lctx.fillRect(0, 0, w, h);

      const startGX = Math.floor(this.cameraX / this.chunkSize);
      const startGY = Math.floor(this.cameraY / this.chunkSize);
      const endGX = Math.floor((this.cameraX + w) / this.chunkSize);
      const endGY = Math.floor((this.cameraY + h) / this.chunkSize);

      for (let gy = startGY; gy <= endGY; gy++) {
          for (let gx = startGX; gx <= endGX; gx++) {
              const key = `${gx},${gy}`;
              let chunk = this.shadowChunks.get(key);
              if (!chunk) {
                  const canvas = document.createElement('canvas');
                  canvas.width = this.chunkSize;
                  canvas.height = this.chunkSize;
                  chunk = { canvas, ctx: canvas.getContext('2d')!, version: '' };
                  this.shadowChunks.set(key, chunk);
              }

              if (chunk.version !== bakeVersion) {
                  this.rebuildShadowChunk(chunk, gx, gy, sunDirection, ambientIntensity);
                  chunk.version = bakeVersion;
              }

              lctx.drawImage(chunk.canvas, gx * this.chunkSize - this.cameraX, gy * this.chunkSize - this.cameraY);
          }
      }

      // --- 1.5 ACCUMULATE DYNAMIC ENTITY SHADOWS ---
      const { sunDirection: sunDir, ambientIntensity: intensity } = WorldClock.getInstance().getTimeState();
      const shadowLen = 20 + 150 * (1.0 - Math.pow(intensity, 0.4));
      
      if (intensity > 0.1) {
          lctx.save();
          lctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          
          const entitiesToShadow = [];
          if (this.player) {
              entitiesToShadow.push(this.player);
              entitiesToShadow.push(...this.player.segments);
          }
          entitiesToShadow.push(...this.enemies);

          entitiesToShadow.forEach(e => {
              if (e.active) {
                  this.renderEntityShadow(lctx, e, sunDir, shadowLen);
              }
          });
          lctx.restore();
      }

      // --- 2. ACCUMULATE DYNAMIC LIGHTS ---
      if (ambientIntensity < 0.95) {
          const lights = LightManager.getInstance().getLights();
          const segments = this.world.getOcclusionSegments(this.cameraX, this.cameraY, w, h);
          
          const shadowLights = lights.filter(l => l.castsShadows);
          const glowLights = lights.filter(l => !l.castsShadows);

          // 2a. Shadow lights
          shadowLights.forEach(light => {
              const screenX = light.x - this.cameraX;
              const screenY = light.y - this.cameraY;
              
              if (screenX < -light.radius || screenX > w + light.radius || 
                  screenY < -light.radius || screenY > h + light.radius) return;

              lctx.save();
              lctx.globalCompositeOperation = 'screen';
              lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);

              let polygon = this.lightPolygonCache.get(light.id);
              const lastPos = (light as any)._lastShadowPos || {x: 0, y: 0};
              const lightMoved = Math.abs(light.x - lastPos.x) > 2 || Math.abs(light.y - lastPos.y) > 2;

              if (!polygon || worldMeshVersion !== this.meshVersion || lightMoved) {
                  polygon = VisibilitySystem.calculateVisibility({x: light.x, y: light.y}, segments);
                  this.lightPolygonCache.set(light.id, polygon);
                  (light as any)._lastShadowPos = {x: light.x, y: light.y};
              }

              if (polygon.length > 0) {
                  lctx.beginPath();
                  lctx.moveTo(polygon[0].x - this.cameraX, polygon[0].y - this.cameraY);
                  for (let i = 1; i < polygon.length; i++) {
                      lctx.lineTo(polygon[i].x - this.cameraX, polygon[i].y - this.cameraY);
                  }
                  lctx.closePath();
                  lctx.clip();
              }

              const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
              grad.addColorStop(0, light.color);
              grad.addColorStop(1, 'rgba(0,0,0,0)');
              lctx.fillStyle = grad;
              lctx.fillRect(screenX - light.radius, screenY - light.radius, light.radius * 2, light.radius * 2);
              lctx.restore();
          });

          // 2b. Glow lights (Batched)
          if (glowLights.length > 0) {
              lctx.save();
              lctx.globalCompositeOperation = 'screen';
              glowLights.forEach(light => {
                  const screenX = light.x - this.cameraX;
                  const screenY = light.y - this.cameraY;
                  
                  if (screenX < -light.radius || screenX > w + light.radius || 
                      screenY < -light.radius || screenY > h + light.radius) return;

                  lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);
                  const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
                  grad.addColorStop(0, light.color);
                  grad.addColorStop(1, 'rgba(0,0,0,0)');
                  lctx.fillStyle = grad;
                  lctx.fillRect(screenX - light.radius, screenY - light.radius, light.radius * 2, light.radius * 2);
              });
              lctx.restore();
          }
      }

      // --- 3. UN-SHADOW CASTERS (Mathematically Correct unshadowing for multiply) ---
      lctx.save();
      lctx.globalCompositeOperation = 'source-over';
      lctx.translate(-this.cameraX, -this.cameraY);
      this.world.renderAsSilhouette(lctx, this.cameraX, this.cameraY, '#ffffff');
      
      // Unshadow entities
      if (this.player) {
          this.player.renderAsSilhouette(lctx, '#ffffff');
      }
      this.enemies.forEach(e => {
          e.renderAsSilhouette(lctx, '#ffffff');
      });
      lctx.restore();

      this.meshVersion = worldMeshVersion;

      // Final Multiply
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.lightCanvas, 0, 0);
      ctx.restore();
  }

  private rebuildShadowChunk(chunk: any, gx: number, gy: number, sunDir: {x: number, y: number}, intensity: number): void {
    const sctx = chunk.ctx;
    sctx.clearRect(0, 0, this.chunkSize, this.chunkSize);
    if (intensity <= 0.1 || !this.world) return;

    const worldX = gx * this.chunkSize;
    const worldY = gy * this.chunkSize;
    const segments = this.world.getOcclusionSegments(worldX, worldY, this.chunkSize, this.chunkSize);
    
    sctx.save();
    // Darker, high-contrast shadows
    sctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; 
    const shadowLen = 20 + 150 * (1.0 - Math.pow(intensity, 0.4)); 
    
    sctx.beginPath();
    segments.forEach(seg => {
        const a = { x: seg.a.x - worldX, y: seg.a.y - worldY };
        const b = { x: seg.b.x - worldX, y: seg.b.y - worldY };
        const a2 = { x: a.x + sunDir.x * shadowLen, y: a.y + sunDir.y * shadowLen };
        const b2 = { x: b.x + sunDir.x * shadowLen, y: b.y + sunDir.y * shadowLen };
        sctx.moveTo(a.x, a.y);
        sctx.lineTo(b.x, b.y);
        sctx.lineTo(b2.x, b2.y);
        sctx.lineTo(a2.x, a2.y);
        sctx.closePath();
    });
    sctx.fill();
    sctx.restore();
  }

  private renderHeatMarks(ctx: CanvasRenderingContext2D): void {
      if (!this.heatMap) return;
      this.heatMap.render(ctx, this.cameraX, this.cameraY);
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.world || !this.player) return;

    // --- PHASE 1: WORLD PASS (Full Brightness) ---
    // 1. Background & Floor Decals
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.world.render(ctx, this.cameraX, this.cameraY);
    FloorDecalManager.getInstance().render(ctx, this.cameraX, this.cameraY);
    this.renderHeatMarks(ctx);
    
    // 2. Entities (Player, Enemies, Drops)
    this.drops.forEach(d => d.render(ctx));
    this.player.render(ctx);
    
    const renderDist = ConfigManager.getInstance().get<number>('World', 'renderDistance') * ConfigManager.getInstance().get<number>('World', 'tileSize');
    this.enemies.forEach(e => {
        const dx = e.x - this.player!.x;
        const dy = e.y - this.player!.y;
        if (Math.abs(dx) < renderDist && Math.abs(dy) < renderDist) {
            e.render(ctx);
        }
    });

    // 3. Projectiles & Particles
    this.projectiles.forEach(p => p.render(ctx));
    this.particles.forEach(p => p.render(ctx));
    
    // Render Continuous Beams
    if (this.isFiringBeam && this.player) {
        const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
        ctx.beginPath();
        ctx.moveTo(this.player.x, this.player.y);
        ctx.lineTo(this.beamEndPos.x, this.beamEndPos.y);
        
        if (weapon === 'laser') {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        } else {
            const grad = ctx.createLinearGradient(this.player.x, this.player.y, this.beamEndPos.x, this.beamEndPos.y);
            grad.addColorStop(0, 'rgba(0, 255, 255, 0.8)');
            grad.addColorStop(1, 'rgba(0, 255, 255, 0.1)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 15 + Math.random() * 5;
            ctx.stroke();
        }
    }
    ctx.restore();

    // --- PHASE 2: LIGHT PASS (Accumulation) ---
    this.renderLighting(ctx);

    // --- PHASE 3: ATMOSPHERE & UI ---
    const useFog = ConfigManager.getInstance().get<boolean>('Visuals', 'fogOfWar');
    if (useFog && this.fogCanvas && this.fogCtx && this.player) {
        this.renderFogOfWar(ctx);
    }

    if (this.radar) {
        const radarEntities: Entity[] = [this.player, ...this.enemies, ...this.projectiles];
        this.radar.render(this.player, radarEntities);
    }
    
    this.renderHUD(ctx);
  }

  private spawnDrop(): void {
    if (!this.world) return;
    const pos = this.getRandomValidPos();
    const type = Math.random() < 0.8 ? DropType.COIN : DropType.BOOSTER;
    const d = new Drop(pos.x, pos.y, type);
    this.drops.push(d);
  }

  private spawnEnemy(): void {
    if (!this.world || !this.player) return;
    let attempts = 0;
    while(attempts < 10) {
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
        attempts++;
    }
  }

  private getRandomValidPos(): {x: number, y: number} {
    if (!this.world) return {x: 0, y: 0};
    let attempts = 0;
    while(attempts < 20) {
        const rx = Math.random() * this.world.getWidthPixels();
        const ry = Math.random() * this.world.getHeightPixels();
        if (!this.world.isWall(rx, ry)) return {x: rx, y: ry};
        attempts++;
    }
    return {x: 100, y: 100};
  }

  private renderFogOfWar(mainCtx: CanvasRenderingContext2D): void {
      if (!this.fogCanvas || !this.fogCtx || !this.player || !this.world) return;

      const { ambientIntensity } = WorldClock.getInstance().getTimeState();
      let fogAlpha = (1.0 - (ambientIntensity - 0.05) / 0.75) * 0.85;
      if (ambientIntensity > 0.8) fogAlpha = 0;
      if (fogAlpha < 0) fogAlpha = 0;

      if (fogAlpha === 0) return;

      const w = mainCtx.canvas.width;
      const h = mainCtx.canvas.height;
      if (this.fogCanvas.width !== w || this.fogCanvas.height !== h) {
          this.fogCanvas.width = w;
          this.fogCanvas.height = h;
      }

      const fctx = this.fogCtx;
      const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');

      fctx.globalCompositeOperation = 'source-over';
      fctx.fillStyle = `rgba(0, 0, 0, ${fogAlpha})`;
      fctx.fillRect(0, 0, w, h);

      fctx.globalCompositeOperation = 'destination-out';
      
      // 1. Light sources punch holes in fog
      const lights = LightManager.getInstance().getLights();
      lights.forEach(light => {
          const screenX = light.x - this.cameraX;
          const screenY = light.y - this.cameraY;
          if (screenX < -light.radius || screenX > w + light.radius || 
              screenY < -light.radius || screenY > h + light.radius) return;

          const grad = fctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
          const alpha = Math.min(1.0, light.intensity * 0.8);
          grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          
          fctx.fillStyle = grad;
          fctx.beginPath();
          fctx.arc(screenX, screenY, light.radius, 0, Math.PI * 2);
          fctx.fill();
      });

      // 2. Personal radius around segments
      const segRad = ConfigManager.getInstance().get<number>('Visuals', 'segmentVisibilityRadius') * tileSize;
      const coneDist = ConfigManager.getInstance().get<number>('Visuals', 'coneDistance') * tileSize;
      const coneAngleDeg = ConfigManager.getInstance().get<number>('Visuals', 'coneAngle');
      const coneAngleRad = (coneAngleDeg * Math.PI) / 180;

      // Punch circles around all segments
      const bodies = this.player.getAllBodies();
      bodies.forEach(b => {
          const screenX = b.x - this.cameraX;
          const screenY = b.y - this.cameraY;
          
          const grad = fctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, segRad);
          grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
          grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.8)');
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          
          fctx.fillStyle = grad;
          fctx.beginPath();
          fctx.arc(screenX, screenY, segRad, 0, Math.PI * 2);
          fctx.fill();
      });

      // Vision Cone with Obstacle Check (Simple Raycasting)
      const playerScreenX = this.player.x - this.cameraX;
      const playerScreenY = this.player.y - this.cameraY;
      
      const startAngle = this.player.rotation - coneAngleRad / 2;
      const rayCount = 60; // One ray per degree roughly
      
      fctx.beginPath();
      fctx.moveTo(playerScreenX, playerScreenY);
      
      for (let i = 0; i <= rayCount; i++) {
          const angle = startAngle + (i / rayCount) * coneAngleRad;
          const rayX = Math.cos(angle);
          const rayY = Math.sin(angle);
          
          let dist = 0;
          const step = tileSize / 2;
          // Trace ray
          while (dist < coneDist) {
              const testX = this.player.x + rayX * dist;
              const testY = this.player.y + rayY * dist;
              if (this.world.isWall(testX, testY)) break;
              dist += step;
          }
          
          const endX = playerScreenX + rayX * dist;
          const endY = playerScreenY + rayY * dist;
          fctx.lineTo(endX, endY);
      }
      fctx.closePath();
      
      const coneGrad = fctx.createRadialGradient(playerScreenX, playerScreenY, 0, playerScreenX, playerScreenY, coneDist);
      coneGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      coneGrad.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
      fctx.fillStyle = coneGrad;
      fctx.fill();

      // 3. Draw the fog overlay onto main canvas
      mainCtx.drawImage(this.fogCanvas, 0, 0);
  }

  private createExplosion(x: number, y: number, radius: number, damage: number): void {
      SoundManager.getInstance().playSoundSpatial('explosion_large', x, y);
      LightManager.getInstance().addTransientLight('explosion', x, y);
      FloorDecalManager.getInstance().addScorchMark(x, y, radius);
      
      // Hit sound for explosion center
      if (this.heatMap) {
          const mat = this.heatMap.getMaterialAt(x, y);
          if (mat !== MaterialType.NONE) {
              const matName = MaterialType[mat].toLowerCase();
              SoundManager.getInstance().playMaterialHit(matName, x, y);
          }
      }

      // Damage enemies in radius
      this.enemies.forEach(e => {
          const dx = e.x - x;
          const dy = e.y - y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < radius) {
              const falloff = 1 - (dist / radius);
              e.takeDamage(damage * falloff);
          }
      });
      // Visual feedback placeholder could be added here
  }

  private createImpactParticles(x: number, y: number, color: string): void {
      LightManager.getInstance().addTransientLight('impact', x, y);
      const count = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 50 + Math.random() * 150;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          this.particles.push(new Particle(x, y, color, vx, vy, 0.3 + Math.random() * 0.4));
      }
  }

  private initWeaponState(): void {
      const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
      this.lastActiveWeapon = weapon;
  }

  private startReload(weapon: string): void {
      if (this.weaponReloading.get(weapon)) return;
      
      const reloadTime = ConfigManager.getInstance().get<number>('Weapons', weapon + 'ReloadTime');
      if (reloadTime <= 0) {
          this.finishReload(weapon);
          return;
      }

      this.weaponReloading.set(weapon, true);
      this.weaponReloadTimer.set(weapon, reloadTime);
      
      if (weapon === ConfigManager.getInstance().get<string>('Player', 'activeWeapon') && this.player) {
        SoundManager.getInstance().playSoundSpatial('weapon_reload', this.player.x, this.player.y);
      }
  }

  private tryIgniteEntity(e: Entity, dt: number): void {
      if (e.isOnFire) return;
      const catchChance = ConfigManager.getInstance().get<number>('Fire', 'catchChance');
      // If catchChance is 0.5, it means 50% chance per second.
      // We want environment fire to be quite dangerous, so we'll boost this for environmental contact
      if (Math.random() < catchChance * dt * 5) { 
          e.isOnFire = true;
      }
  }

  private finishReload(weapon: string): void {
      this.weaponReloading.set(weapon, false);
      this.weaponReloadTimer.set(weapon, 0);
      
      const configKey = weapon === 'laser' || weapon === 'ray' ? 'MaxEnergy' : 'MaxAmmo';
      const max = ConfigManager.getInstance().get<number>('Weapons', weapon + configKey);
      this.weaponAmmo.set(weapon, max);
  }

  public handleCommand(cmd: string): boolean {
    const cleanCmd = cmd.trim().toLowerCase();
    
    if (cleanCmd === 'dev_on') {
        this.isDevMode = true;
        console.log('Dev mode activated');
        return true;
    }

    const alwaysOn = ConfigManager.getInstance().get<boolean>('Debug', 'devModeAlwaysOn');
    if (!this.isDevMode && !alwaysOn) return false;

    if (cleanCmd.startsWith('add_weapon')) {
        const num = parseInt(cleanCmd.replace('add_weapon', ''));
        const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
        if (num >= 1 && num <= 7) {
            const wName = weapons[num-1];
            this.unlockedWeapons.add(wName);
            ConfigManager.getInstance().set('Player', 'activeWeapon', wName);
            this.initWeaponState();
            console.log(`Added and equipped weapon: ${wName}`);
            return true;
        }
    }

    if (cleanCmd === 'activate_enemy_spawn' || cleanCmd === 'spawn_on') {
        this.spawnEnemies = true;
        ConfigManager.getInstance().set('Debug', 'enableEnemySpawning', true);
        console.log('Enemy spawning activated');
        return true;
    }

    if (cleanCmd === 'deactivate_enemy_spawn' || cleanCmd === 'spawn_off') {
        this.spawnEnemies = false;
        ConfigManager.getInstance().set('Debug', 'enableEnemySpawning', false);
        console.log('Enemy spawning deactivated');
        return true;
    }

    return false;
  }
}
