import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { RenderComponent, RenderType } from "../components/RenderComponent";
import { HealthComponent } from "../components/HealthComponent";
import { FireComponent } from "../components/FireComponent";
import { AIComponent } from "../components/AIComponent";
import { ProjectileType } from "../components/ProjectileComponent";
import { DropType } from "../components/DropComponent";
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
            let ix = transform.prevX + (transform.x - transform.prevX) * alpha;
            let iy = transform.prevY + (transform.y - transform.prevY) * alpha;
            const rotation = transform.rotation;

            // Safety check for NaN or undefined (shouldn't happen with proper init, but good to have)
            if (isNaN(ix) || isNaN(iy)) {
                ix = transform.x;
                iy = transform.y;
            }

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

                // NPC Health Bar: Only show if damaged
                if (health && health.health < health.maxHealth && health.active) {
                    this.drawHealthBar(ctx, x, y, render.radius, health.health, health.maxHealth);
                }
                break;
            case 'projectile':
                const proj = entityManager.getComponent<any>(id, 'projectile');
                this.drawProjectile(ctx, x, y, rotation, render.radius, proj?.projectileType, proj?.isArmed);
                break;
            case 'drop':
                const drop = entityManager.getComponent<any>(id, 'drop');
                this.drawDrop(ctx, x, y, render.radius, drop?.dropType, drop?.bobTime);
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
        const dossier = ai?.dossier;
        const color = dossier?.visuals.color || '#ff3333';
        const shape = dossier?.visuals.shape || 'circle';
        const glowColor = dossier?.visuals.glowColor || 'rgba(255, 69, 0, 0.5)';

        ctx.save();

        // Setup common styles
        ctx.shadowBlur = 10;
        ctx.shadowColor = glowColor;
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#222';

        // 1. Draw Shape Body
        ctx.beginPath();
        if (shape === 'square') {
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.rect(-radius, -radius, radius * 2, radius * 2);
            // Gradient for square (Heavy)
            const grad = ctx.createLinearGradient(-radius, -radius, radius, radius);
            grad.addColorStop(0, '#555');
            grad.addColorStop(1, color);
            ctx.fillStyle = grad;
        } else if (shape === 'triangle') {
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.moveTo(radius, 0);
            ctx.lineTo(-radius, -radius);
            ctx.lineTo(-radius, radius);
            ctx.closePath();
            // Gradient for triangle (Scout)
            const grad = ctx.createLinearGradient(-radius, 0, radius, 0);
            grad.addColorStop(0, '#333');
            grad.addColorStop(1, color);
            ctx.fillStyle = grad;
        } else if (shape === 'rocket') {
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.moveTo(radius, 0);
            ctx.lineTo(-radius, -radius * 0.8);
            ctx.lineTo(-radius * 0.5, 0);
            ctx.lineTo(-radius, radius * 0.8);
            ctx.closePath();
            ctx.fillStyle = color;
        } else {
            // Circle (Default / Iron Style)
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, radius);
            grad.addColorStop(0, '#757575');
            grad.addColorStop(0.6, '#434b4d');
            grad.addColorStop(1, '#2a2a2a');
            ctx.fillStyle = grad;
        }

        ctx.fill();
        ctx.stroke();

        // 2. Damage Flash Overlay
        if (damageFlash > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = `rgba(255, 0, 0, ${0.5 * (damageFlash / 0.2)})`;
            ctx.fill(); // Re-fills the current path
            ctx.restore();
        }

        // 3. Eye / Core Detail
        ctx.shadowBlur = 0;

        if (shape === 'circle') {
            // Glowing Ember Eye for Circle
            const eyeX = x + Math.cos(rotation) * 6;
            const eyeY = y + Math.sin(rotation) * 6;
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff4500';
            ctx.fillStyle = '#ff4500';
            ctx.beginPath();
            ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Mechanical Center for others
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            if (shape === 'square' || shape === 'triangle' || shape === 'rocket') {
                // Determine center in local space (0,0)
                ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
            } else {
                ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        ctx.restore();
    }

    private drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number, type: ProjectileType = ProjectileType.CANNON, isArmed: boolean = true): void {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);

        if (type === ProjectileType.MINE) {
            const pulse = isArmed ? Math.sin(Date.now() * 0.01) * 2 : 0;
            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = isArmed ? '#ff3333' : '#ff0000';
            ctx.beginPath();
            ctx.arc(0, 0, radius + pulse, 0, Math.PI * 2);
            ctx.fill();
        } else if (type === ProjectileType.ROCKET || type === ProjectileType.MISSILE) {
            ctx.rotate(Math.PI / 2);
            const scale = (radius * 4) / 128;
            ctx.scale(scale, scale);
            ctx.translate(-32, -64);

            const drawPixel = (px: number, py: number, w: number, h: number, fill: string) => {
                ctx.fillStyle = fill;
                ctx.fillRect(px, py, w, h);
            };

            // Simplified pixel art from Projectile.ts
            drawPixel(30, 4, 4, 4, "#cc2200"); // Nose
            drawPixel(22, 12, 20, 8, "#cc2200");
            drawPixel(14, 20, 36, 60, "#e8e8e8"); // Body
            drawPixel(26, 36, 12, 12, "#3399cc"); // Window
            drawPixel(6, 84, 8, 16, "#cc2200"); // Fins
            drawPixel(50, 84, 8, 16, "#cc2200");

            // Flame
            if (Math.random() > 0.5) {
                drawPixel(26, 108, 12, 12, "#ffff00");
            } else {
                drawPixel(28, 108, 8, 16, "#ff6600");
            }
        } else {
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    private drawDrop(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, type: DropType = DropType.COIN, bobTime: number = 0): void {
        const yOffset = Math.sin(bobTime) * 5;

        ctx.save();
        ctx.translate(x, y + yOffset);

        if (type === DropType.COIN) {
            // Draw Gear (Coin)
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffd700';
            ctx.fillStyle = '#cfaa6e'; // Brass gold

            ctx.rotate(bobTime); // Spin

            // Gear shape
            const outer = radius;
            const inner = radius * 0.6;
            const teeth = 6;

            ctx.beginPath();
            for (let i = 0; i < teeth * 2; i++) {
                const angle = (Math.PI * 2 * i) / (teeth * 2);
                const r = (i % 2 === 0) ? outer : inner;
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();
            ctx.fill();

            // Hole in center
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Booster (Glowing Crystal / Box)
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#3498db';
            ctx.fillStyle = '#3498db';

            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, health: number, maxHealth: number): void {
        const width = radius * 2.5;
        const height = 4;
        const barX = x - width / 2;
        const barY = y - radius - 12;

        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.8;

        // Background
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, width, height);

        // Fill
        const pct = Math.max(0, health / maxHealth);
        if (pct > 0.6) ctx.fillStyle = '#2ecc71'; // Green
        else if (pct > 0.3) ctx.fillStyle = '#f1c40f'; // Yellow
        else ctx.fillStyle = '#e74c3c'; // Red

        ctx.fillRect(barX, barY, width * pct, height);

        // Border
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, width, height);

        ctx.restore();
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
                    const ai = entityManager.getComponent<AIComponent>(id, 'ai');
                    const shape = ai?.dossier?.visuals.shape || 'circle';

                    ctx.beginPath();
                    if (shape === 'square') {
                        ctx.translate(ix, iy);
                        ctx.rotate(rotation);
                        ctx.rect(-render.radius, -render.radius, render.radius * 2, render.radius * 2);
                    } else if (shape === 'triangle') {
                        ctx.translate(ix, iy);
                        ctx.rotate(rotation);
                        ctx.moveTo(render.radius, 0);
                        ctx.lineTo(-render.radius, -render.radius);
                        ctx.lineTo(-render.radius, render.radius);
                        ctx.closePath();
                    } else if (shape === 'rocket') {
                        ctx.translate(ix, iy);
                        ctx.rotate(rotation);
                        ctx.moveTo(render.radius, 0);
                        ctx.lineTo(-render.radius, -render.radius * 0.8);
                        ctx.lineTo(-render.radius * 0.5, 0);
                        ctx.lineTo(-render.radius, render.radius * 0.8);
                        ctx.closePath();
                    } else {
                        ctx.arc(ix, iy, render.radius, 0, Math.PI * 2);
                    }
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