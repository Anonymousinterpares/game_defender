import { PhysicsBody, PhysicsEngine } from './PhysicsEngine';

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

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  public takeDamage(amount: number): void {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.active = false;
    }
  }

  public handleFireLogic(dt: number, fireDPS: number, baseExtinguishChance: number): void {
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

  abstract update(dt: number): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
}
