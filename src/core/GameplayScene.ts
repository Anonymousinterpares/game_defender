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
import { HeatMap } from './HeatMap';

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
  private dockButton: HTMLButtonElement | null = null;
  private dockContainer: HTMLElement | null = null;
  private isDockOpen: boolean = false;

  // Weapon State
  private currentAmmo: number = 0;
  private isReloading: boolean = false;
  private reloadTimer: number = 0;
  private lastActiveWeapon: string = '';

  // Dev Mode
  private isDevMode: boolean = false;
  private spawnEnemies: boolean = true;

  // Beam state
  private isFiringBeam: boolean = false;
  private beamEndPos: { x: number, y: number } = { x: 0, y: 0 };
  
  // Heat Simulation
  private heatMap: HeatMap | null = null;

  // Fog of War state
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;

  constructor(
    private sceneManager: SceneManager,
    private inputManager: InputManager
  ) {
    this.physics = new PhysicsEngine();
  }

  onEnter(): void {
    this.world = new World();
    this.heatMap = new HeatMap(ConfigManager.getInstance().get<number>('World', 'tileSize'));
    this.physics.setWorld(this.world);
    
    // Load Sounds
    const sm = SoundManager.getInstance();
    sm.loadSound('ping', '/assets/sounds/ping.wav');
    sm.loadSound('shoot_cannon', '/assets/sounds/shoot_cannon.wav');
    sm.loadSound('shoot_laser', '/assets/sounds/shoot_laser.wav');
    sm.loadSound('shoot_ray', '/assets/sounds/shoot_ray.wav');
    sm.loadSound('shoot_rocket', '/assets/sounds/shoot_rocket.wav');
    sm.loadSound('shoot_missile', '/assets/sounds/shoot_missile.wav');
    sm.loadSound('place_mine', '/assets/sounds/place_mine.wav');
    sm.loadSound('weapon_reload', '/assets/sounds/weapon_reload.wav');
    sm.loadSound('hit_cannon', '/assets/sounds/hit_cannon.wav');
    sm.loadSound('hit_laser', '/assets/sounds/hit_laser.wav');
    sm.loadSound('hit_ray', '/assets/sounds/hit_ray.wav');
    sm.loadSound('explosion_large', '/assets/sounds/explosion_large.wav');
    sm.loadSound('collect_coin', '/assets/sounds/collect_coin.wav');
    sm.loadSound('ui_click', '/assets/sounds/ui_click.wav');

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
    this.initWeaponState();
    
    // Init Fog Canvas
    this.fogCanvas = document.createElement('canvas');
    this.fogCtx = this.fogCanvas.getContext('2d');

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
    SoundManager.getInstance().stopLoop('shoot_laser');
    SoundManager.getInstance().stopLoop('shoot_ray');
    SoundManager.getInstance().stopLoop('hit_laser');
    SoundManager.getInstance().stopLoop('hit_ray');
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
    if (this.inputManager.isKeyDown('Escape')) {
      this.sceneManager.switchScene('menu');
      return;
    }
    
    const dockKey = ConfigManager.getInstance().get<string>('Keybindings', 'openDock');
    if (this.inputManager.isKeyJustPressed(dockKey)) {
        this.toggleDock();
    }

    if (this.isDockOpen) return;

    // --- Weapon / Ammo Logic ---
    const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
    if (weapon !== this.lastActiveWeapon) {
        this.initWeaponState();
    }

    if (this.isReloading) {
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) {
            this.finishReload();
        }
    }

    this.physics.update(dt);

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
    if (this.inputManager.isKeyDown('Space') && this.player && !this.isReloading) {
      const now = performance.now() / 1000;
      
      if (weapon === 'cannon' || weapon === 'rocket' || weapon === 'missile' || weapon === 'mine') {
          if (now - this.lastShotTime > this.shootCooldown) {
            if (this.currentAmmo > 0) {
                this.currentAmmo--;
                this.lastShotTime = now;
                let pType = ProjectileType.CANNON;
                let sfx = 'shoot_cannon';
                
                if (weapon === 'rocket') { pType = ProjectileType.ROCKET; sfx = 'shoot_rocket'; }
                if (weapon === 'missile') { pType = ProjectileType.MISSILE; sfx = 'shoot_missile'; }
                if (weapon === 'mine') { pType = ProjectileType.MINE; sfx = 'place_mine'; }
                
                const p = new Projectile(this.player.x, this.player.y, this.player.rotation, pType);
                
                if (weapon === 'missile') {
                    // Find closest enemy for missile
                    let bestDist = 1000;
                    let target: Enemy | null = null;
                    this.enemies.forEach(e => {
                        const d = Math.sqrt((e.x-p.x)**2 + (e.y-p.y)**2);
                        if (d < bestDist) { bestDist = d; target = e; }
                    });
                    p.target = target;
                }
                
                this.projectiles.push(p);
                SoundManager.getInstance().playSound(sfx);

                if (this.currentAmmo <= 0) {
                    this.startReload();
                }
            } else {
                this.startReload();
            }
          }
      } else if (weapon === 'laser' || weapon === 'ray') {
          if (this.currentAmmo > 0) {
            this.isFiringBeam = true;
            this.handleBeamFiring(weapon, dt);
            SoundManager.getInstance().startLoop(weapon === 'laser' ? 'shoot_laser' : 'shoot_ray');
            
            const depletion = ConfigManager.getInstance().get<number>('Weapons', weapon + 'DepletionRate');
            this.currentAmmo -= depletion * dt;
            if (this.currentAmmo <= 0) {
                this.currentAmmo = 0;
                this.startReload();
            }
          } else {
            this.startReload();
          }
      }
    }

    if (!this.isFiringBeam) {
        SoundManager.getInstance().stopLoop('shoot_laser');
        SoundManager.getInstance().stopLoop('shoot_ray');
        SoundManager.getInstance().stopLoop('hit_laser', 0.5);
        SoundManager.getInstance().stopLoop('hit_ray', 0.5);
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
                if (p.aoeRadius > 0) {
                    this.createExplosion(p.x, p.y, p.aoeRadius, p.damage);
                } else {
                    const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                    SoundManager.getInstance().playSound(sfx);
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
                    SoundManager.getInstance().playSound(sfx);
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
    this.particles = this.particles.filter(p => { p.update(dt); return p.active; });
    this.enemies = this.enemies.filter(e => { if(!e.active) this.physics.removeBody(e); return e.active; });
    this.drops = this.drops.filter(d => d.active);

    if (this.player) {
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      this.cameraX = this.player.x - screenW / 2;
      this.cameraY = this.player.y - screenH / 2;
    }

    if (this.radar && this.player) {
      this.radar.update(dt);
    }

    this.heatMap?.update(dt);
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
          SoundManager.getInstance().startLoop(hitSfx);
          
          // --- Heat Simulation Update ---
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

  private renderHeatMarks(ctx: CanvasRenderingContext2D): void {
      if (!this.heatMap) return;
      this.heatMap.render(ctx, this.cameraX, this.cameraY);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (!this.world || !this.player) return;

    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.world.render(ctx, this.cameraX, this.cameraY);
    this.renderHeatMarks(ctx);
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
            // Core
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

    // --- Fog of War ---
    const useFog = ConfigManager.getInstance().get<boolean>('Visuals', 'fogOfWar');
    if (useFog && this.fogCanvas && this.fogCtx && this.player) {
        this.renderFogOfWar(ctx);
    }

    if (this.radar) {
        // Pass everything to radar (Radar will filter based on distance and type)
        const radarEntities: Entity[] = [this.player, ...this.enemies, ...this.projectiles];
        this.radar.render(this.player, radarEntities);
    }
    
    ctx.fillStyle = '#fff';
    ctx.font = '14px Courier';
    ctx.fillText(`POS: ${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}`, 10, 20);
    ctx.fillText(`COINS: ${this.coinsCollected}`, 10, 40);

    const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
    const displayAmmo = weapon === 'laser' || weapon === 'ray' ? this.currentAmmo.toFixed(1) : Math.floor(this.currentAmmo);
    const ammoText = this.isReloading ? `RELOADING... (${this.reloadTimer.toFixed(1)}s)` : `AMMO: ${displayAmmo}`;
    
    ctx.fillStyle = this.isReloading ? '#ff4500' : '#cfaa6e';
    ctx.font = 'bold 16px "Share Tech Mono"';
    ctx.fillText(`${weapon.toUpperCase()} | ${ammoText}`, 10, 70);
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

      const w = mainCtx.canvas.width;
      const h = mainCtx.canvas.height;
      if (this.fogCanvas.width !== w || this.fogCanvas.height !== h) {
          this.fogCanvas.width = w;
          this.fogCanvas.height = h;
      }

      const fctx = this.fogCtx;
      const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');

      // 1. Fill with darkness
      fctx.globalCompositeOperation = 'source-over';
      fctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      fctx.fillRect(0, 0, w, h);

      // 2. Punch holes (Destination-Out)
      fctx.globalCompositeOperation = 'destination-out';
      
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
      SoundManager.getInstance().playSound('explosion_large');
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
      this.isReloading = false;
      this.reloadTimer = 0;
      
      const configKey = weapon === 'laser' || weapon === 'ray' ? 'MaxEnergy' : 'MaxAmmo';
      this.currentAmmo = ConfigManager.getInstance().get<number>('Weapons', weapon + configKey);
  }

  private startReload(): void {
      if (this.isReloading) return;
      this.isReloading = true;
      const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
      this.reloadTimer = ConfigManager.getInstance().get<number>('Weapons', weapon + 'ReloadTime');
      SoundManager.getInstance().playSound('weapon_reload');
  }

  private finishReload(): void {
      this.isReloading = false;
      const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
      const configKey = weapon === 'laser' || weapon === 'ray' ? 'MaxEnergy' : 'MaxAmmo';
      this.currentAmmo = ConfigManager.getInstance().get<number>('Weapons', weapon + configKey);
  }

  public handleCommand(cmd: string): boolean {
    const cleanCmd = cmd.trim().toLowerCase();
    
    if (cleanCmd === 'dev_on') {
        this.isDevMode = true;
        console.log('Dev mode activated');
        return true;
    }

    if (!this.isDevMode) return false;

    if (cleanCmd.startsWith('add_weapon')) {
        const num = parseInt(cleanCmd.replace('add_weapon', ''));
        const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine'];
        if (num >= 1 && num <= 6) {
            ConfigManager.getInstance().set('Player', 'activeWeapon', weapons[num-1]);
            this.initWeaponState();
            console.log(`Added weapon ${weapons[num-1]}`);
            return true;
        }
    }

    if (cleanCmd === 'activate_enemy_spawn') {
        this.spawnEnemies = true;
        console.log('Enemy spawning activated');
        return true;
    }

    if (cleanCmd === 'deactivate_enemy_spawn') {
        this.spawnEnemies = false;
        console.log('Enemy spawning deactivated');
        return true;
    }

    return false;
  }
}
