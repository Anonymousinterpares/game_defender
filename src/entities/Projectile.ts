import { Entity } from '../core/Entity';

export class Projectile extends Entity {
  public active: boolean = true;
  private lifeTime: number = 2.0; // Seconds
  private speed: number = 800;

  constructor(x: number, y: number, angle: number) {
    super(x, y);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
    this.radius = 4;
    this.color = '#ffff00';
  }

  update(dt: number): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    
    this.lifeTime -= dt;
    if (this.lifeTime <= 0) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Trail effect
    ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
    ctx.beginPath();
    ctx.arc(this.x - this.vx * 0.01, this.y - this.vy * 0.01, this.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}
