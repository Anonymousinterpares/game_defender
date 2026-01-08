import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { RenderComponent } from "../components/RenderComponent";
import { HealthComponent } from "../components/HealthComponent";
import { FireComponent } from "../components/FireComponent";
import { AIComponent } from "../components/AIComponent";

export class RenderSystem implements System {
    public readonly id = 'render';

    update(dt: number, entityManager: EntityManager, ctx: CanvasRenderingContext2D): void {
        const entities = entityManager.query(['transform', 'render']);

        for (const id of entities) {
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const render = entityManager.getComponent<RenderComponent>(id, 'render')!;
            const fire = entityManager.getComponent<FireComponent>(id, 'fire');

            if (render.renderType === 'custom') continue;

            const ix = transform.x;
            const iy = transform.y;
            const rotation = transform.rotation;
            const scale = health?.visualScale || 1.0;

            ctx.save();
            
            if (scale !== 1.0) {
                ctx.translate(ix, iy);
                ctx.scale(scale, scale);
                ctx.translate(-ix, -iy);
            }

            if (render.renderFn) {
                render.renderFn(ctx, ix, iy, rotation, scale);
            } else {
                this.drawByType(ctx, id, entityManager, render, ix, iy, rotation, health, fire);
            }

            ctx.restore();
        }
    }

    private drawByType(
        ctx: CanvasRenderingContext2D, 
        id: string,
        entityManager: EntityManager,
        render: RenderComponent, 
        x: number, 
        y: number, 
        rotation: number, 
        health?: HealthComponent, 
        fire?: FireComponent
    ): void {
        switch (render.renderType) {
            case 'player':
                this.drawPlayer(ctx, x, y, rotation, render.radius, health);
                break;
            case 'enemy':
                const ai = entityManager.getComponent<AIComponent>(id, 'ai');
                this.drawEnemy(ctx, x, y, rotation, render.radius, health, ai);
                break;
            case 'projectile':
                this.drawProjectile(ctx, x, y, rotation, render.radius);
                break;
        }

        if (fire?.isOnFire) {
            ctx.beginPath();
            ctx.arc(x, y, render.radius * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 100, 0, 0.4)';
            ctx.fill();
        }
    }

    private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number, health?: HealthComponent): void {
        const headGrad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, radius);
        headGrad.addColorStop(0, '#ffdf80');
        headGrad.addColorStop(0.5, '#cfaa6e');
        headGrad.addColorStop(1, '#8c6a36');
        ctx.fillStyle = headGrad;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#594326';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(25, 0);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.restore();
    }

    private drawEnemy(
        ctx: CanvasRenderingContext2D, 
        x: number, 
        y: number, 
        rotation: number, 
        radius: number, 
        health?: HealthComponent,
        ai?: AIComponent
    ): void {
        const dossier = ai?.dossier;
        const color = dossier?.visuals.color || '#ff3333';
        const shape = dossier?.visuals.shape || 'circle';
        const glowColor = dossier?.visuals.glowColor || 'rgba(0,0,0,0.5)';

        ctx.save();
        
        // Shadow/Glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = glowColor;

        ctx.fillStyle = color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;

        if (shape === 'circle') {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (shape === 'square') {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
            ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
            ctx.restore();
        } else if (shape === 'triangle') {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(-radius, -radius);
            ctx.lineTo(-radius, radius);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else if (shape === 'rocket') {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.beginPath();
            ctx.moveTo(radius, 0);
            ctx.lineTo(-radius, -radius * 0.8);
            ctx.lineTo(-radius * 0.5, 0);
            ctx.lineTo(-radius, radius * 0.8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // Eye/Core
        const eyeX = x + Math.cos(rotation) * (radius * 0.5);
        const eyeY = y + Math.sin(rotation) * (radius * 0.5);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, radius * 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Health Bar (only if damaged)
        if (health && health.health < health.maxHealth) {
            const barW = radius * 2.5;
            const barH = 4;
            const barY = y + radius + 8;
            
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(x - barW/2, barY, barW, barH);
            
            const pct = Math.max(0, health.health / health.maxHealth);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(x - barW/2, barY, barW * pct, barH);
        }
    }

    private drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number): void {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}