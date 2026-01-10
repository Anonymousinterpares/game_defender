import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { RenderComponent, RenderType } from "../components/RenderComponent";
import { HealthComponent } from "../components/HealthComponent";
import { FireComponent } from "../components/FireComponent";
import { AIComponent } from "../components/AIComponent";
import { AssetRegistry } from "../../AssetRegistry";

export class RenderSystem implements System {
    public readonly id = 'render';

    private fireAsset: HTMLImageElement | null = null;

    constructor() {
        // Pre-load fire asset if possible, or wait for it
        try {
            // We can't guarantee it's loaded yet, but we can try to get it if it is.
            // A safer way is to check in update or trust AssetRegistry's state.
            // For now, we'll lazily fetch it in drawFire if needed, or cache it here.
        } catch (e) {
            // Asset might not be loaded yet
        }
    }

    update(dt: number, entityManager: EntityManager, ctx: CanvasRenderingContext2D, alpha: number = 0): void {
        const entities = entityManager.query(['transform', 'render']);

        // Ensure fire asset is ready
        if (!this.fireAsset) {
            try {
                // We check if AssetRegistry is loaded. 
                // If the game has started, assets should be loaded.
                this.fireAsset = AssetRegistry.getInstance().getImage('fire_spritesheet');
            } catch (e) {
                // Not ready yet
            }
        }

        for (const id of entities) {
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const render = entityManager.getComponent<RenderComponent>(id, 'render')!;
            const fire = entityManager.getComponent<FireComponent>(id, 'fire');

            if (render.renderType === 'custom') continue;

            // Interpolation
            const ix = transform.prevX + (transform.x - transform.prevX) * alpha;
            const iy = transform.prevY + (transform.y - transform.prevY) * alpha;
            const rotation = transform.rotation;
            
            // Sync visual properties from HealthComponent if available (Legacy/Compat)
            // Ideally RenderComponent should hold these, but logic updates HealthComponent currently.
            // Let's copy them over for the frame or just use HealthComponent directly.
            // The RenderComponent now has these fields, but the game logic updates HealthComponent.
            // We should use the HealthComponent values as source of truth for now.
            const scale = health?.visualScale ?? render.visualScale;
            const damageFlash = health?.damageFlash ?? render.damageFlash;

            ctx.save();
            
            // Apply scale if needed
            if (scale !== 1.0) {
                ctx.translate(ix, iy);
                ctx.scale(scale, scale);
                ctx.translate(-ix, -iy);
            }

            if (render.renderFn) {
                render.renderFn(ctx, ix, iy, rotation, scale);
            } else {
                this.drawByType(ctx, id, entityManager, render, ix, iy, rotation, scale, damageFlash, health, fire);
            }

            ctx.restore();

            // Render Fire Effect on top (without scale affect usually, or with? 
            // Original code: "Render fire if burning (outside the scale/tint for clarity)"
            // So we draw it here, after restore.
            if (fire?.isOnFire) {
                this.drawFire(ctx, ix, iy, render.radius, id);
            }
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
        scale: number,
        damageFlash: number,
        health?: HealthComponent, 
        fire?: FireComponent
    ): void {
        switch (render.renderType) {
            case 'player':
                this.drawPlayer(ctx, x, y, rotation, render.radius, damageFlash);
                break;
            case 'player_segment':
                this.drawPlayerSegment(ctx, x, y, render.radius, damageFlash);
                break;
            case 'enemy':
                const ai = entityManager.getComponent<AIComponent>(id, 'ai');
                this.drawEnemy(ctx, x, y, rotation, render.radius, damageFlash, health, ai);
                break;
            case 'projectile':
                this.drawProjectile(ctx, x, y, rotation, render.radius);
                break;
        }
    }

    private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number, damageFlash: number): void {
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

        if (damageFlash > 0) {
            ctx.fillStyle = `rgba(255, 0, 0, ${0.5 * (damageFlash / 0.2)})`;
            ctx.fill();
        }

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
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(25, 0);
        ctx.strokeStyle = '#434b4d';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.restore();
    }

    private drawPlayerSegment(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, damageFlash: number): void {
        const grad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, radius);
        grad.addColorStop(0, '#ebd5b3'); 
        grad.addColorStop(0.5, '#b58d4a'); 
        grad.addColorStop(1, '#594326'); 
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#3d2e1e';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (damageFlash > 0) {
            ctx.fillStyle = `rgba(255, 0, 0, ${0.5 * (damageFlash / 0.2)})`;
            ctx.fill();
        }
    }

    private drawEnemy(
        ctx: CanvasRenderingContext2D, 
        x: number, 
        y: number, 
        rotation: number, 
        radius: number, 
        damageFlash: number,
        health?: HealthComponent,
        ai?: AIComponent
    ): void {
        // Default visuals if no AI/Dossier
        const color = ai?.dossier?.visuals.color || '#ff3333';
        // const shape = ai?.dossier?.visuals.shape || 'circle'; // Assuming circle for now based on old Enemy.ts logic which only did circle

        // Original Enemy.ts logic:
        // Body (Iron/Rust) Gradient
        const grad = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, radius);
        grad.addColorStop(0, '#757575');
        grad.addColorStop(0.6, '#434b4d'); // Iron
        grad.addColorStop(1, '#2a2a2a');
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#222';
        ctx.stroke();

        // Eye (Glowing Ember)
        const eyeX = x + Math.cos(rotation) * 6;
        const eyeY = y + Math.sin(rotation) * 6;
        
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ff4500';
        ctx.fillStyle = '#ff4500';
        
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.shadowBlur = 0; // Reset

        // Damage Flash Overlay
        if (damageFlash > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 0, 0, ${0.5 * (damageFlash / 0.2)})`;
            ctx.fill();
            ctx.restore();
        }

        // Health Bar (Optional, wasn't in original renderInternal but was in previous RenderSystem)
        // Original Enemy.ts DID NOT have a health bar in renderInternal.
        // It's cleaner without it for the "Visual Style" phase, but if we want to keep it:
        // Let's stick to the Enemy.ts source which did NOT have it.
    }

    private drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number): void {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    private drawFire(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, id: string): void {
        if (!this.fireAsset || !this.fireAsset.complete || this.fireAsset.naturalWidth === 0) return;

        const time = performance.now() * 0.001;
        const frameCount = 8;
        // Use a hash of ID to offset animation
        const idHash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const frame = Math.floor((time * 15 + idHash) % frameCount);
        
        const fw = this.fireAsset.width / frameCount;
        const fh = this.fireAsset.height;
        const fx = frame * fw;
        
        // Proportional fire: make it covers the entity radius
        const displaySize = radius * 2.5;
        ctx.drawImage(
            this.fireAsset, 
            fx, 0, fw, fh, 
            x - displaySize / 2, 
            y - displaySize * 0.8, 
            displaySize, 
            displaySize
        );

        // Simple procedural sparks
        if (Math.random() < 0.2) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(x + (Math.random() - 0.5) * radius * 2, y - Math.random() * radius * 2, 2, 2);
        }
    }

    public renderSilhouettes(entityManager: EntityManager, ctx: CanvasRenderingContext2D, alpha: number, color: string): void {
        const entities = entityManager.query(['transform', 'render']);

        for (const id of entities) {
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const render = entityManager.getComponent<RenderComponent>(id, 'render')!;

            if (render.renderType === 'custom') continue; // Custom entities handled elsewhere? Or skip?

            // Interpolation
            const ix = transform.prevX + (transform.x - transform.prevX) * alpha;
            const iy = transform.prevY + (transform.y - transform.prevY) * alpha;
            const rotation = transform.rotation;
            const scale = health?.visualScale ?? render.visualScale;

            ctx.save();
            
            if (scale !== 1.0) {
                ctx.translate(ix, iy);
                ctx.scale(scale, scale);
                ctx.translate(-ix, -iy);
            }

            // Draw Silhouette
            ctx.fillStyle = color;
            
            switch (render.renderType) {
                case 'player':
                    // Head
                    ctx.beginPath();
                    ctx.arc(ix, iy, render.radius, 0, Math.PI * 2);
                    ctx.fill();
                    // Cannon (optional for silhouette? Yes, adds detail)
                    ctx.save();
                    ctx.translate(ix, iy);
                    ctx.rotate(rotation);
                    ctx.fillRect(0, -3, 25, 6);
                    ctx.restore();
                    break;
                case 'player_segment':
                    ctx.beginPath();
                    ctx.arc(ix, iy, render.radius, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                case 'enemy':
                    ctx.beginPath();
                    ctx.arc(ix, iy, render.radius, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                case 'projectile':
                     // Projectiles usually don't cast shadows/block light in this game? 
                     // But if they do:
                     ctx.beginPath();
                     ctx.arc(ix, iy, render.radius, 0, Math.PI * 2);
                     ctx.fill();
                     break;
            }

            ctx.restore();
        }
    }
}