import { Entity } from '../core/Entity';
import { Player } from './Player';

export class Enemy extends Entity {
  public health: number = 20;
  public active: boolean = true;
  private speed: number = 150;

  constructor(x: number, y: number) {
    super(x, y);
    this.color = '#ff3333'; // Red
    this.radius = 12;
  }

  update(dt: number, player?: Player): void {
    if (!player) return;

    // Basic Chase AI
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
      this.vx = (dx / dist) * this.speed;
      this.vy = (dy / dist) * this.speed;
      this.rotation = Math.atan2(dy, dx);
    }

    // Position update is handled by PhysicsEngine
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Body (Iron/Rust)
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    
    const grad = ctx.createRadialGradient(this.x - 3, this.y - 3, 1, this.x, this.y, this.radius);
    grad.addColorStop(0, '#757575');
    grad.addColorStop(0.6, '#434b4d'); // Iron
    grad.addColorStop(1, '#2a2a2a');
    
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.stroke();

    // Eye (Glowing Ember)
    const eyeX = this.x + Math.cos(this.rotation) * 6;
    const eyeY = this.y + Math.sin(this.rotation) * 6;
    
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff4500';
    ctx.fillStyle = '#ff4500';
    
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0; // Reset
  }

  takeDamage(amount: number): void {
    this.health -= amount;
    if (this.health <= 0) {
      this.active = false;
    }
  }
}
