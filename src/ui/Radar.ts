import { Entity } from '../core/Entity';
import { Player } from '../entities/Player';
import { SoundManager } from '../core/SoundManager';

export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scanAngle: number = 0;
  private lastScanAngle: number = 0;
  
  // Config
  private size: number = 200;
  private range: number = 1000; // World units covered by radar

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.className = 'ui-radar';
    this.ctx = this.canvas.getContext('2d')!;
    
    // Style
    this.canvas.style.position = 'absolute';
    this.canvas.style.bottom = '20px';
    this.canvas.style.right = '20px';
    this.canvas.style.borderRadius = '50%';
    this.canvas.style.border = '2px solid #00ff00';
    this.canvas.style.backgroundColor = 'rgba(0, 20, 0, 0.8)';
    
    document.getElementById('ui-layer')?.appendChild(this.canvas);
  }

  public destroy(): void {
    this.canvas.remove();
  }

  public update(dt: number): void {
    this.lastScanAngle = this.scanAngle;
    // Rotate scanner
    this.scanAngle += dt * 2; // Speed of rotation
    if (this.scanAngle > Math.PI * 2) {
        this.scanAngle -= Math.PI * 2;
        this.lastScanAngle -= Math.PI * 2;
    }
  }

  public render(player: Player, entities: Entity[]): void {
    // Clear
    this.ctx.clearRect(0, 0, this.size, this.size);
    
    const center = this.size / 2;
    const scale = (this.size / 2) / this.range;

    // Draw Grid Rings
    this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
    this.ctx.beginPath();
    this.ctx.arc(center, center, this.size * 0.25, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(center, center, this.size * 0.45, 0, Math.PI * 2);
    this.ctx.stroke();

    // Check for pings
    let pingTriggered = false;

    // Draw Entities
    entities.forEach(entity => {
      // Calculate relative position
      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      
      // Check range
      if (Math.abs(dx) > this.range || Math.abs(dy) > this.range) return;

      const radarX = center + dx * scale;
      const radarY = center + dy * scale;
      
      // Calculate fading based on scan line
      // Angle of entity relative to center
      let angle = Math.atan2(dy, dx); 
      if (angle < 0) angle += Math.PI * 2;
      
      // Check if scan line passed this angle in this frame
      // We check if angle is between lastScanAngle and scanAngle
      if (angle >= this.lastScanAngle && angle < this.scanAngle) {
          // Play ping for enemies only? Or everything? 
          // Let's ping for enemies (Entities that are not Player)
          if (entity !== player) pingTriggered = true;
      }
      
      const typeName = entity.constructor.name;
      if (entity instanceof Player) {
          this.ctx.fillStyle = '#00ff00';
          this.ctx.beginPath();
          this.ctx.arc(radarX, radarY, 3, 0, Math.PI * 2);
          this.ctx.fill();
      } else if (typeName === 'Enemy') {
          this.ctx.fillStyle = '#ff0000';
          this.ctx.beginPath();
          this.ctx.arc(radarX, radarY, 3, 0, Math.PI * 2);
          this.ctx.fill();
      } else if (typeName === 'Projectile') {
          this.ctx.fillStyle = '#ffff00';
          this.ctx.beginPath();
          this.ctx.arc(radarX, radarY, 2, 0, Math.PI * 2);
          this.ctx.fill();
      }
    });

    if (pingTriggered) {
        SoundManager.getInstance().playSound('ping');
    }

    // Draw Player Center
    this.ctx.fillStyle = '#fff';
    this.ctx.beginPath();
    this.ctx.arc(center, center, 2, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw Scan Line
    this.ctx.beginPath();
    this.ctx.moveTo(center, center);
    this.ctx.lineTo(center + Math.cos(this.scanAngle) * (this.size/2), center + Math.sin(this.scanAngle) * (this.size/2));
    this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    
    // Draw "Swipe" gradient behind line
    // ... (omitted for brevity, complex gradient)
  }
}
