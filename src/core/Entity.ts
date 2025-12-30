import { PhysicsBody, PhysicsEngine } from './PhysicsEngine';
import { ConfigManager } from '../config/MasterConfig';

export abstract class Entity implements PhysicsBody {
  public id: string = Math.random().toString(36).substr(2, 9);
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 10;
  public isStatic: boolean = false;
  public color: string = '#fff';
  public rotation: number = 0;
  
  // Health and Fire State
  public health: number = 100;
  public maxHealth: number = 100;
  public active: boolean = true;
  public isOnFire: boolean = false;
  protected fireTimer: number = 0;
  protected extinguishChance: number = 0.5;

  // Visual Feedback
  public damageFlash: number = 0;
  public visualScale: number = 1.0;

  private static fireAsset: HTMLImageElement | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    
    if (!Entity.fireAsset && ConfigManager.getInstance().get<boolean>('Fire', 'isFireSpritesheet')) {
        Entity.fireAsset = new Image();
        Entity.fireAsset.src = '/assets/visuals/fire_spritesheet.svg';
    }
  }

  public takeDamage(amount: number): void {
    if (amount <= 0) return;
    
    this.health -= amount;
    
    // Trigger damage feedback if not already flashing intensely
    if (this.damageFlash <= 0.1) {
        this.damageFlash = 0.2; // 200ms
        this.visualScale = 1.2;  // 20% bump
    }

    if (this.health <= 0) {
      this.health = 0;
      this.active = false;
    }
  }

  public handleFireLogic(dt: number, fireDPS: number, baseExtinguishChance: number): void {
      // Update visual feedback timers
      if (this.damageFlash > 0) this.damageFlash -= dt;
      if (this.visualScale > 1.0) {
          this.visualScale -= dt * 1.0; // Return to 1.0 over 200ms
          if (this.visualScale < 1.0) this.visualScale = 1.0;
      }

      if (!this.isOnFire) return;

      this.fireTimer += dt;
      
      // Apply Damage
      this.takeDamage(fireDPS * dt);

      // Extinguish logic every 1000ms
      if (this.fireTimer >= 1.0) {
          this.fireTimer -= 1.0;
          if (Math.random() < this.extinguishChance) {
              this.isOnFire = false;
              this.extinguishChance = baseExtinguishChance;
          } else {
              this.extinguishChance = Math.min(1.0, this.extinguishChance + 0.1);
          }
      }
  }

  public renderFire(ctx: CanvasRenderingContext2D): void {
      if (!this.isOnFire || !Entity.fireAsset) return;

      const time = performance.now() * 0.001;
      const frameCount = 8;
      const frame = Math.floor((time * 15 + parseInt(this.id, 36)) % frameCount);
      
      const fw = Entity.fireAsset.width / frameCount;
      const fh = Entity.fireAsset.height;
      const fx = frame * fw;
      
      // Proportional fire: make it covers the entity radius
      const displaySize = this.radius * 2.5;
      ctx.drawImage(
          Entity.fireAsset, 
          fx, 0, fw, fh, 
          this.x - displaySize / 2, 
          this.y - displaySize * 0.8, 
          displaySize, 
          displaySize
      );

      // Simple procedural sparks
      if (Math.random() < 0.2) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(this.x + (Math.random() - 0.5) * this.radius * 2, this.y - Math.random() * this.radius * 2, 2, 2);
      }
  }

  abstract update(dt: number, ...args: any[]): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
}