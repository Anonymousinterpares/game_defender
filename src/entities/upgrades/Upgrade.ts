import { Entity } from '../../core/Entity';
import { ConfigManager } from '../../config/MasterConfig';

export abstract class Upgrade {
  constructor(protected parent: Entity, public readonly mass: number = 1.0) { }
  abstract update(dt: number, enemies: Entity[], spawnProjectile: (x: number, y: number, angle: number) => void): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
}

export class TurretUpgrade extends Upgrade {
  private fireTimer: number = 0;
  private range: number = 300;
  private fireRate: number = 1.0; // shots per sec
  private target: Entity | null = null;

  constructor(parent: Entity) {
    const mass = ConfigManager.getInstance().get<number>('Mass', 'turretModule') || 8.0;
    super(parent, mass);
  }

  update(dt: number, enemies: Entity[], spawnProjectile: (x: number, y: number, angle: number) => void): void {
    this.fireTimer += dt;

    // Find target
    if (!this.target || !enemies.includes(this.target) || this.distTo(this.target) > this.range) {
      this.target = enemies.find(e => this.distTo(e) < this.range) || null;
    }

    if (this.target && this.fireTimer >= 1 / this.fireRate) {
      this.fireTimer = 0;
      const angle = Math.atan2(this.target.y - this.parent.y, this.target.x - this.parent.x);
      spawnProjectile(this.parent.x, this.parent.y, angle);
    }
  }

  private distTo(e: Entity): number {
    const dx = e.x - this.parent.x;
    const dy = e.y - this.parent.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private shoot(): void {
    // Logic handled by update via spawnProjectile callback
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#434b4d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.parent.x, this.parent.y);
    const angle = this.target ? Math.atan2(this.target.y - this.parent.y, this.target.x - this.parent.x) : 0;
    ctx.lineTo(this.parent.x + Math.cos(angle) * 15, this.parent.y + Math.sin(angle) * 15);
    ctx.stroke();
  }
}

export class ShieldUpgrade extends Upgrade {
  private radius: number = 40;
  private strength: number = 100;

  constructor(parent: Entity) {
    const mass = ConfigManager.getInstance().get<number>('Mass', 'shieldModule') || 12.0;
    super(parent, mass);
  }

  update(dt: number, enemies: Entity[], spawnProjectile: (x: number, y: number, angle: number) => void): void {
    // Shield logic
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.parent.x, this.parent.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.fill();
  }
}
