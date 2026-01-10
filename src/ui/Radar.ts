import { Entity } from '../core/Entity';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import { EventBus, GameEvent } from '../core/EventBus';

interface RadarBlip {
    id: string; // Entity ID for tracking
    x: number;
    y: number;
    type: string;
    life: number; // 1.0 down to 0 for fading
    color?: string;
}

export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  // Persistence
  private blips: Map<string, RadarBlip> = new Map();
  
  // Pulse logic
  private pulseTimer: number = 0;
  private pulseVisual: number = 0; // 0 to 1 for expanding circle
  private currentInterval: number = 2.0;
  
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
    this.canvas.style.boxShadow = '0 0 15px rgba(0, 255, 0, 0.3)';
    
    document.getElementById('ui-layer')?.appendChild(this.canvas);
  }

  public destroy(): void {
    this.canvas.remove();
  }

  public update(dt: number): void {
    // Pulse Visual Animation
    if (this.pulseVisual < 1.0) {
        this.pulseVisual += dt * (1.5 / this.currentInterval); 
    }

    // Decay blips
    this.blips.forEach((blip, id) => {
        blip.life -= dt * 0.4; // Slightly slower fade
        if (blip.life <= 0) this.blips.delete(id);
    });

    this.pulseTimer -= dt;
  }

  public render(player: Player, entities: Entity[]): void {
    const center = this.size / 2;
    const scale = (this.size / 2) / this.range;

    // 1. Calculate next pulse interval based on closest entity
    let minDist = this.range;
    let foundAny = false;

    entities.forEach(entity => {
        if (entity instanceof Player) return;
        const dx = entity.x - player.x;
        const dy = entity.y - player.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < this.range) {
            foundAny = true;
            if (dist < minDist) minDist = dist;
        }
    });

    // Frequency logic: 0.3s (closest) to 2.0s (furthest/idle)
    const targetInterval = foundAny ? 0.3 + (minDist / this.range) * 1.7 : 2.5;
    this.currentInterval = targetInterval;

    // 2. Trigger Pulse
    if (this.pulseTimer <= 0) {
        this.pulseTimer = this.currentInterval;
        this.pulseVisual = 0; // Reset visual animation

        // Play Ping Sound
        EventBus.getInstance().emit(GameEvent.SOUND_PLAY_SPATIAL, {
            soundId: 'ping',
            x: player.x,
            y: player.y
        });

        // Update all blips at once
        entities.forEach(entity => {
            if (entity instanceof Player) return;
            const dx = entity.x - player.x;
            const dy = entity.y - player.y;
            const distSq = dx*dx + dy*dy;
            
            if (distSq <= this.range * this.range) {
                // Use actual entity ID if available, otherwise construct unique key
                const uniqueId = entity.id; 
                
                let specificColor: string | undefined;
                if (entity instanceof RemotePlayer) specificColor = entity.color;

                this.blips.set(uniqueId, {
                    id: uniqueId,
                    x: dx * scale,
                    y: dy * scale,
                    type: entity.constructor.name,
                    life: 1.0,
                    color: specificColor
                });
            }
        });
    }

    // 2.5 Prune Blips of Dead/Removed Entities
    // Create a Set of current entity IDs for O(1) lookup
    const activeEntityIds = new Set(entities.map(e => e.id));
    
    // Check existing blips
    for (const [key, blip] of this.blips) {
        if (!activeEntityIds.has(blip.id)) {
            this.blips.delete(key);
        }
    }

    // 3. Drawing
    this.ctx.clearRect(0, 0, this.size, this.size);
    
    // Draw Static Grid
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

    // Pulse Visual Ring
    if (this.pulseVisual < 1.0) {
        const ringAlpha = (1.0 - this.pulseVisual) * 0.4;
        this.ctx.strokeStyle = `rgba(0, 255, 0, ${ringAlpha})`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(center, center, this.pulseVisual * (this.size / 2), 0, Math.PI * 2);
        this.ctx.stroke();
    }

    // Render Blips
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
        this.ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        this.ctx.fill();
    });
    this.ctx.shadowBlur = 0;
    this.ctx.globalAlpha = 1.0;

    // Player (Fixed at center)
    this.ctx.fillStyle = '#fff';
    this.ctx.beginPath();
    this.ctx.arc(center, center, 3, 0, Math.PI * 2);
    this.ctx.fill();
  }
}