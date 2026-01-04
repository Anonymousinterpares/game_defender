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
      this.renderInternal(ctx, false);
  }

  public renderAsSilhouette(ctx: CanvasRenderingContext2D, color: string): void {
      this.renderInternal(ctx, true, color);
  }

  private renderInternal(ctx: CanvasRenderingContext2D, silhouette: boolean, silColor?: string): void {
    if (!this.active) return;
    
    const ix = this.interpolatedX;
    const iy = this.interpolatedY;
    
    ctx.save();
    
    // Apply visual scale bump
    if (!silhouette && this.visualScale !== 1.0) {
        ctx.translate(ix, iy);
        ctx.scale(this.visualScale, this.visualScale);
        ctx.translate(-ix, -iy);
    }

    // Body (Iron/Rust)
    ctx.beginPath();
    ctx.arc(ix, iy, this.radius, 0, Math.PI * 2);
    
    if (silhouette) {
        ctx.fillStyle = silColor || '#fff';
    } else {
        const grad = ctx.createRadialGradient(ix - 3, iy - 3, 1, ix, iy, this.radius);
        grad.addColorStop(0, '#757575');
        grad.addColorStop(0.6, '#434b4d'); // Iron
        grad.addColorStop(1, '#2a2a2a');
        ctx.fillStyle = grad;
    }
    
    ctx.fill();

    if (!silhouette) {
        ctx.strokeStyle = '#222';
        ctx.stroke();

        // Eye (Glowing Ember)
        const eyeX = ix + Math.cos(this.rotation) * 6;
        const eyeY = iy + Math.sin(this.rotation) * 6;
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ff4500';
        ctx.fillStyle = '#ff4500';
        
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.shadowBlur = 0; // Reset

        // Damage Flash Overlay (Applied to the body path)
        if (this.damageFlash > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(ix, iy, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 0, 0, ${0.5 * (this.damageFlash / 0.2)})`;
            ctx.fill();
            ctx.restore();
        }
    }

    ctx.restore();

    if (!silhouette) {
        // Render fire if burning (outside the scale/tint for clarity)
        this.renderFire(ctx);
    }
  }
}