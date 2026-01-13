import { EventBus, GameEvent } from '../core/EventBus';
import { EntityManager } from '../core/ecs/EntityManager';
import { TransformComponent } from '../core/ecs/components/TransformComponent';
import { RenderComponent } from '../core/ecs/components/RenderComponent';
import { HealthComponent } from '../core/ecs/components/HealthComponent';

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

    public render(playerX: number, playerY: number, entityManager: EntityManager): void {
        const center = this.size / 2;
        const scale = (this.size / 2) / this.range;

        // 1. Query entities from ECS
        const entityIds = entityManager.query(['transform', 'render']);

        // Calculate next pulse interval based on closest entity
        let minDist = this.range;
        let foundAny = false;

        for (const id of entityIds) {
            // Skip player segments and the player itself for frequency calculation
            const render = entityManager.getComponent<RenderComponent>(id, 'render')!;
            if (render.renderType === 'player' || render.renderType === 'player_segment') continue;

            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const dx = transform.x - playerX;
            const dy = transform.y - playerY;
            const distSq = dx * dx + dy * dy;

            if (distSq < this.range * this.range) {
                foundAny = true;
                const dist = Math.sqrt(distSq);
                if (dist < minDist) minDist = dist;
            }
        }

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
                x: playerX,
                y: playerY
            });

            // Update all blips at once
            for (const id of entityIds) {
                const render = entityManager.getComponent<RenderComponent>(id, 'render')!;
                // Skip player, segments, and inactive entities
                if (render.renderType === 'player' || render.renderType === 'player_segment') continue;

                const health = entityManager.getComponent<HealthComponent>(id, 'health');
                if (health && !health.active) continue;

                const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
                const dx = transform.x - playerX;
                const dy = transform.y - playerY;
                const distSq = dx * dx + dy * dy;

                if (distSq <= this.range * this.range) {
                    this.blips.set(id, {
                        id: id,
                        x: dx * scale,
                        y: dy * scale,
                        type: render.renderType,
                        life: 1.0,
                        color: render.color
                    });
                }
            }
        }

        // 2.5 Prune Blips of Dead/Removed Entities
        // We only keep blips for entities that still exist in ECS and are active
        for (const [key, blip] of this.blips) {
            const transform = entityManager.getComponent<TransformComponent>(blip.id, 'transform');
            const health = entityManager.getComponent<HealthComponent>(blip.id, 'health');

            if (!transform || (health && !health.active)) {
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
            if (blip.type === 'projectile') color = '#ffff00';
            if (blip.type === 'drop') color = '#00ffff';
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