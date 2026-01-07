import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { RenderComponent } from "../components/RenderComponent";
import { HealthComponent } from "../components/HealthComponent";
import { FireComponent } from "../components/FireComponent";
import { Entity } from "../../Entity";

export class RenderSystem implements System {
    public readonly id = 'render';

    update(dt: number, entityManager: EntityManager, ctx: CanvasRenderingContext2D): void {
        const entities = entityManager.query(['transform', 'render']);

        for (const id of entities) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const render = entityManager.getComponent<RenderComponent>(id, 'render')!;
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            const fire = entityManager.getComponent<FireComponent>(id, 'fire');

            const ix = transform.x; // Simplified, no interpolation yet in ECS
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
                this.drawByType(ctx, render, ix, iy, rotation, health, fire);
            }

            ctx.restore();
        }
    }

    private drawByType(ctx: CanvasRenderingContext2D, render: RenderComponent, x: number, y: number, rotation: number, health?: HealthComponent, fire?: FireComponent): void {
        switch (render.renderType) {
            case 'player':
                this.drawPlayer(ctx, x, y, rotation, render.radius, health);
                break;
            case 'enemy':
                this.drawEnemy(ctx, x, y, rotation, render.radius, health);
                break;
            case 'projectile':
                this.drawProjectile(ctx, x, y, rotation, render.radius);
                break;
        }

        if (fire?.isOnFire) {
            // Re-use fire rendering from Entity if possible or implement here
            // For now, simple orange glow
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

        // Cannon
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

    private drawEnemy(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number, health?: HealthComponent): void {
        const grad = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, radius);
        grad.addColorStop(0, '#757575');
        grad.addColorStop(0.6, '#434b4d');
        grad.addColorStop(1, '#2a2a2a');
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.stroke();

        // Eye
        const eyeX = x + Math.cos(rotation) * 6;
        const eyeY = y + Math.sin(rotation) * 6;
        ctx.fillStyle = '#ff4500';
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    private drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number): void {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}
