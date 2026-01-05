import { Entity } from '../core/Entity';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SoundManager } from '../core/SoundManager';

interface RadarBlip {
    x: number;
    y: number;
    type: string;
    life: number; // 1.0 down to 0 for fading
    color?: string;
}

export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scanAngle: number = 0;
  private lastScanAngle: number = 0;
  
  // Persistence
  private blips: Map<string, RadarBlip> = new Map();
  
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
    this.scanAngle += dt * 3; // Slightly faster scan
    if (this.scanAngle > Math.PI * 2) {
        this.scanAngle -= Math.PI * 2;
        this.lastScanAngle -= Math.PI * 2;
    }

    // Decay blips
    this.blips.forEach((blip, id) => {
        blip.life -= dt * 0.5; // Fades out over 2 seconds
        if (blip.life <= 0) this.blips.delete(id);
    });
  }

  public render(player: Player, entities: Entity[]): void {
    this.ctx.clearRect(0, 0, this.size, this.size);
    
    const center = this.size / 2;
    const scale = (this.size / 2) / this.range;

    // 1. Draw Static Grid
    this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(center, center, this.size * 0.25, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(center, center, this.size * 0.45, 0, Math.PI * 2);
    this.ctx.stroke();
    
    // Crosshair
    this.ctx.beginPath();
    this.ctx.moveTo(0, center); this.ctx.lineTo(this.size, center);
    this.ctx.moveTo(center, 0); this.ctx.lineTo(center, this.size);
    this.ctx.stroke();

    // 2. Process Scanning
    let pingTriggered = false;

    entities.forEach(entity => {
      if (entity instanceof Player) return; // Player is always at center

      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      
      if (Math.abs(dx) > this.range || Math.abs(dy) > this.range) return;

      // Angle relative to radar (up is -PI/2)
      let angle = Math.atan2(dy, dx); 
      if (angle < 0) angle += Math.PI * 2;
      
      // If scan line passes the entity's angle
      if (this.isAngleBetween(angle, this.lastScanAngle, this.scanAngle)) {
          // Use a semi-unique ID (using instance for simplicity in this prototype)
          // In a real game use entity.id
          const id = entity.constructor.name + "_" + Math.floor(entity.x) + "_" + Math.floor(entity.y);
          
          let specificColor: string | undefined;
          if (entity instanceof RemotePlayer) specificColor = entity.color;

          this.blips.set(id, {
              x: dx * scale,
              y: dy * scale,
              type: entity.constructor.name,
              life: 1.0,
              color: specificColor
          });
          pingTriggered = true;
      }
    });

    if (pingTriggered) {
        SoundManager.getInstance().playSoundSpatial('ping', player.x, player.y);
    }

    // 3. Render Blips
    this.blips.forEach(blip => {
        const x = center + blip.x;
        const y = center + blip.y;
        
        let color = '#ff0000'; // Default Red (Enemy)
        if (blip.type === 'Projectile') color = '#ffff00';
        if (blip.type === 'Drop') color = '#00ffff';
        if (blip.color) color = blip.color;

        this.ctx.globalAlpha = blip.life;
        this.ctx.fillStyle = color;
        this.ctx.shadowBlur = 5 * blip.life;
        this.ctx.shadowColor = color;
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, 2, 0, Math.PI * 2);
        this.ctx.fill();
    });
    this.ctx.shadowBlur = 0;
    this.ctx.globalAlpha = 1.0;

    // 4. Player (Fixed at center)
    this.ctx.fillStyle = '#fff';
    this.ctx.beginPath();
    this.ctx.arc(center, center, 3, 0, Math.PI * 2);
    this.ctx.fill();

    // 5. Draw Scan Line with trailing sweep
    const sweepSegments = 20;
    for (let i = 0; i < sweepSegments; i++) {
        const alpha = (1 - i / sweepSegments) * 0.5;
        const angle = this.scanAngle - (i * 0.05);
        this.ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
        this.ctx.lineWidth = i === 0 ? 2 : 1;
        this.ctx.beginPath();
        this.ctx.moveTo(center, center);
        this.ctx.lineTo(center + Math.cos(angle) * (this.size/2), center + Math.sin(angle) * (this.size/2));
        this.ctx.stroke();
    }
  }

  private isAngleBetween(target: number, start: number, end: number): boolean {
      if (start <= end) {
          return target >= start && target < end;
      } else {
          // Wrap around case (e.g. start=350 deg, end=10 deg)
          return target >= start || target < end;
      }
  }
}