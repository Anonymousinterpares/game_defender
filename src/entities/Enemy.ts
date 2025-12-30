import { Entity } from '../core/Entity';
import { Player } from './Player';
import { ConfigManager } from '../config/MasterConfig';

export class Enemy extends Entity {
  private speed: number = 150;

  constructor(x: number, y: number) {
    super(x, y);
    this.color = '#ff3333'; // Red
    this.radius = 12;
    this.health = 20;
    this.maxHealth = 20;
  }

  update(dt: number, player?: Player): void {
    const fireDPS = ConfigManager.getInstance().get<number>('Fire', 'dps');
    const baseExtinguish = ConfigManager.getInstance().get<number>('Fire', 'baseExtinguishChance');
    this.handleFireLogic(dt, fireDPS, baseExtinguish);

    if (!player || !this.active) return;

    // Basic Chase AI
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
      this.vx = (dx / dist) * this.speed;
      this.vy = (dy / dist) * this.speed;
      this.rotation = Math.atan2(dy, dx);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.active) return;
    
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
}