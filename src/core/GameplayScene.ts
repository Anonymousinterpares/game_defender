import { Scene } from './Scene';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { World } from './World';
import { Player } from '../entities/Player';
import { PhysicsEngine } from './PhysicsEngine';
import { Radar } from '../ui/Radar';
import { Entity } from './Entity';
import { ConfigManager } from '../config/MasterConfig';
import { Projectile } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Drop, DropType } from '../entities/Drop';
import { TurretUpgrade, ShieldUpgrade } from '../entities/upgrades/Upgrade';

export class GameplayScene implements Scene {
  private world: World | null = null;
  private player: Player | null = null;
  private physics: PhysicsEngine;
  private radar: Radar | null = null;
  
  private entities: Entity[] = [];
  private enemies: Enemy[] = [];
  private drops: Drop[] = [];
  private projectiles: Projectile[] = [];
  
  private lastShotTime: number = 0;
  private shootCooldown: number = 0.2;
  private nextDropSpawn: number = 5;
  private nextEnemySpawn: number = 3; 

  private coinsCollected: number = 0;
  private isDockOpen: boolean = false;
  private dockContainer: HTMLDivElement | null = null;
  
  private cameraX: number = 0;
  private cameraY: number = 0;
  
  private backButton: HTMLButtonElement | null = null;
  private dockButton: HTMLButtonElement | null = null;

  constructor(
    private sceneManager: SceneManager,
    private inputManager: InputManager
  ) {
    this.physics = new PhysicsEngine();
  }

  onEnter(): void {
    this.world = new World();
    this.physics.setWorld(this.world);
    
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
  }

  private createUI(): void {
      this.backButton = document.createElement('button');
      this.backButton.textContent = 'MENU';
      this.backButton.className = 'hud-btn';
      this.backButton.style.position = 'absolute';
      this.backButton.style.top = '10px';
      this.backButton.style.right = '10px';
      this.backButton.addEventListener('click', () => {
          this.sceneManager.switchScene('menu');
      });
      document.body.appendChild(this.backButton);

      this.dockButton = document.createElement('button');
      this.dockButton.textContent = 'DOCK (P)';
      this.dockButton.className = 'hud-btn';
      this.dockButton.style.position = 'absolute';
      this.dockButton.style.top = '10px';
      this.dockButton.style.right = '100px';
      this.dockButton.addEventListener('click', () => {
          this.toggleDock();
      });
      document.body.appendChild(this.dockButton);
  }

  private cleanupUI(): void {
      if (this.backButton) { this.backButton.remove(); this.backButton = null; }
      if (this.dockButton) { this.dockButton.remove(); this.dockButton = null; }
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
              this.coinsCollected -= repairCost;
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-speed')?.addEventListener('click', () => {
          if (this.coinsCollected >= speedCost) {
              this.coinsCollected -= speedCost;
              const currentSpeed = ConfigManager.getInstance().get<number>('Player', 'baseSpeed');
              ConfigManager.getInstance().set('Player', 'baseSpeed', currentSpeed + 1);
              if (this.player) this.player.refreshConfig();
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-fire')?.addEventListener('click', () => {
          if (this.coinsCollected >= fireRateCost) {
              this.coinsCollected -= fireRateCost;
              const currentRate = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
              ConfigManager.getInstance().set('Player', 'shootCooldown', Math.max(0.05, currentRate - 0.02));
              this.shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
              this.updateDockContent(repairCost, speedCost, fireRateCost);
          }
      });

      this.dockContainer.querySelector('#buy-slot')?.addEventListener('click', () => {
          if (this.coinsCollected >= slotCost && this.player) {
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

    this.physics.update(dt);

    this.nextDropSpawn -= dt;
    if (this.nextDropSpawn <= 0) {
        this.spawnDrop();
        this.nextDropSpawn = 5 + Math.random() * 10;
    }

    this.nextEnemySpawn -= dt;
    if (this.nextEnemySpawn <= 0) {
        this.spawnEnemy();
        this.nextEnemySpawn = 4 + Math.random() * 4;
    }

    if (this.inputManager.isKeyDown('Space') && this.player) {
      const now = performance.now() / 1000;
      if (now - this.lastShotTime > this.shootCooldown) {
        this.lastShotTime = now;
        const p = new Projectile(this.player.x, this.player.y, this.player.rotation);
        this.projectiles.push(p);
      }
    }

    if (this.player) {
      for (const p of this.projectiles) {
        // Projectile vs World (Walls and Borders)
        if (this.world) {
            const mapW = this.world.getWidthPixels();
            const mapH = this.world.getHeightPixels();
            
            // Wall Collision
            if (this.world.isWall(p.x, p.y)) {
                p.active = false;
            }
            // Border Collision
            else if (p.x < 0 || p.x > mapW || p.y < 0 || p.y > mapH) {
                p.active = false;
            }
        }

        // Projectile vs Enemy
        for (const e of this.enemies) {
          if (this.physics.checkCollision(p, e)) {
            e.takeDamage(10);
            p.active = false;
          }
        }
      }

      for (const d of this.drops) {
        if (this.physics.checkCollision(this.player, d)) {
          d.active = false;
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
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (!this.world || !this.player) return;

    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.world.render(ctx, this.cameraX, this.cameraY);
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
    ctx.restore();

    if (this.radar) {
        // Pass everything to radar (Radar will filter based on distance and type)
        const radarEntities: Entity[] = [this.player, ...this.enemies, ...this.projectiles];
        this.radar.render(this.player, radarEntities);
    }
    
    ctx.fillStyle = '#fff';
    ctx.font = '14px Courier';
    ctx.fillText(`POS: ${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}`, 10, 20);
    ctx.fillText(`COINS: ${this.coinsCollected}`, 10, 40);
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
}
