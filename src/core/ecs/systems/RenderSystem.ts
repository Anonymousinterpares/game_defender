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
import { ProjectionUtils } from "../../../utils/ProjectionUtils";
import { ConfigManager } from "../../../config/MasterConfig";

export class RenderSystem implements System {
    public readonly id = 'render';

    private fireAsset: HTMLImageElement | null = null;
    private glowCache: Map<string, HTMLCanvasElement> = new Map();

    constructor() { }

    public collectRenderables(entityManager: EntityManager, alpha: number, centerX: number, centerY: number): any[] {
        const entities = entityManager.query(['transform', 'render']);
        const renderables: any[] = [];

        // Ensure fire asset is ready
        if (!this.fireAsset) {
            try {
                this.fireAsset = AssetRegistry.getInstance().getImage('fire_spritesheet');
            } catch (e) { }
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
            const iz = transform.prevZ + (transform.z - transform.prevZ) * alpha;
            const rotation = transform.rotation;

            // Perspective Projection: Lean away from center
            const offset = ProjectionUtils.getProjectedOffset(ix, iy, iz, centerX, centerY);
            const renderX = ix + offset.x;
            const renderY = iy + iz + offset.y;

            const scale = health?.visualScale ?? render.visualScale;
            const damageFlash = health?.damageFlash ?? render.damageFlash;

            renderables.push({
                y: iy, // Sorting by ground Y
                render: (ctx: CanvasRenderingContext2D) => {
                    ctx.save();
                    // 1. Draw Shadow first
                    this.drawShadow(ctx, ix, iy, render.radius, iz, scale);

                    // 2. Draw Entity with Z-offset and perspective lean
                    ctx.save();
                    if (scale !== 1.0) {
                        ctx.translate(renderX, renderY);
                        ctx.scale(scale, scale);
                        ctx.translate(-renderX, -renderY);
                    }

                    if (render.renderFn) {
                        render.renderFn(ctx, renderX, renderY, rotation, scale);
                    } else {
                        this.drawByType(ctx, id, entityManager, render, renderX, renderY, rotation, scale, damageFlash, health, fire);
                    }
                    ctx.restore();

                    // Render Fire Effect on top - Only if GPU is NOT handling it
                    const gpuEnabled = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled');
                    if (fire?.isOnFire && !gpuEnabled) {
                        this.drawFire(ctx, renderX, renderY, render.radius, id);
                    }
                    ctx.restore();
                }
            });
        }
        return renderables;
    }

    update(dt: number, entityManager: EntityManager, ctx: CanvasRenderingContext2D, alpha: number = 0, cameraX: number = 0, cameraY: number = 0): void {
        const viewWidth = ctx.canvas.width;
        const viewHeight = ctx.canvas.height;
        const centerX = cameraX + viewWidth / 2;
        const centerY = cameraY + viewHeight / 2;

        const renderables = this.collectRenderables(entityManager, alpha, centerX, centerY);
        // In simple update, we just render them unsorted for now, 
        // but GameplayScene will use collectRenderables + sorting.
        renderables.forEach(r => r.render(ctx));
    }

    private drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, z: number, scale: number): void {
        // Shadow gets smaller and lighter as Z increases (more negative)
        // PhysicsSystem: z is 0 on ground, z < 0 in air.
        const heightFactor = Math.abs(z) / 200; // Normalized height
        const shadowScale = Math.max(0.4, 1.0 - heightFactor * 0.5) * scale;
        const shadowAlpha = Math.max(0.1, 0.4 - heightFactor * 0.3);

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(shadowScale, shadowScale * 0.6); // Flattened ellipse

        ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
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

    private getGlowSprite(color: string, radius: number): HTMLCanvasElement {
        const key = `${color}_${radius}`;
        if (this.glowCache.has(key)) return this.glowCache.get(key)!;

        const size = radius * 4;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;

        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        // Ensure color has alpha for the gradient
        const baseColor = color.startsWith('rgba') ? color.replace(/[\d.]+\)$/, '0)') : color;
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        this.glowCache.set(key, canvas);
        return canvas;
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

        // Use pre-rendered glow instead of shadowBlur
        const glow = this.getGlowSprite(glowColor, radius * 1.5);
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(glow, x - radius * 3, y - radius * 3, radius * 6, radius * 6);
        ctx.globalCompositeOperation = 'source-over';

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#222';

        // 1. Draw Shape Body
        ctx.beginPath();
        if (shape === 'square') {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.rect(-radius, -radius, radius * 2, radius * 2);
            // Gradient for square (Heavy)
            const grad = ctx.createLinearGradient(-radius, -radius, radius, radius);
            grad.addColorStop(0, '#555');
            grad.addColorStop(1, color);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else if (shape === 'triangle') {
            ctx.save();
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
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else if (shape === 'rocket') {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.moveTo(radius, 0);
            ctx.lineTo(-radius, -radius * 0.8);
            ctx.lineTo(-radius * 0.5, 0);
            ctx.lineTo(-radius, radius * 0.8);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else {
            // Circle (Default / Iron Style)
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, radius);
            grad.addColorStop(0, '#757575');
            grad.addColorStop(0.6, '#434b4d');
            grad.addColorStop(1, '#2a2a2a');
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.stroke();
        }

        // 2. Damage Flash Overlay
        if (damageFlash > 0) {
            ctx.save();
            // Re-path for source-atop clipping if needed, but for simplicity:
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = `rgba(255, 0, 0, ${0.5 * (damageFlash / 0.2)})`;
            // For circles it's easy, for others we need the path.
            // Simplification: just fill a large rect, source-atop handles the mask.
            ctx.fillRect(x - radius * 2, y - radius * 2, radius * 4, radius * 4);
            ctx.restore();
        }

        // 3. Eye / Core Detail
        if (shape === 'circle') {
            // Glowing Ember Eye for Circle
            const eyeX = x + Math.cos(rotation) * 6;
            const eyeY = y + Math.sin(rotation) * 6;
            const eyeGlow = this.getGlowSprite('#ff4500', 4);
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(eyeGlow, eyeX - 8, eyeY - 8, 16, 16);
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#ff4500';
            ctx.beginPath();
            ctx.arc(eyeX, eyeY, 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Mechanical Center for others
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();
    }

    private drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, radius: number, type: ProjectileType = ProjectileType.CANNON, isArmed: boolean = true): void {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);

        if (type === ProjectileType.MINE) {
            const pulse = isArmed ? Math.sin(Date.now() * 0.01) * 2 : 0;
            const glowColor = isArmed ? '#ff3333' : '#ff0000';
            const glow = this.getGlowSprite(glowColor, radius);
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(glow, -radius * 2, -radius * 2, radius * 4, radius * 4);
            ctx.globalCompositeOperation = 'source-over';

            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = glowColor;
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

            // Simplified pixel art
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
            const glow = this.getGlowSprite('#ffd700', radius);
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(glow, -radius * 2, -radius * 2, radius * 4, radius * 4);
            ctx.globalCompositeOperation = 'source-over';

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
            // Booster
            const glow = this.getGlowSprite('#3498db', radius);
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(glow, -radius * 2, -radius * 2, radius * 4, radius * 4);
            ctx.globalCompositeOperation = 'source-over';

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

    public renderSilhouettes(entityManager: EntityManager, ctx: CanvasRenderingContext2D, alpha: number, color: string, cameraX: number = 0, cameraY: number = 0): void {
        const entities = entityManager.query(['transform', 'render']);

        const viewWidth = ctx.canvas.width;
        const viewHeight = ctx.canvas.height;
        const centerX = cameraX + viewWidth / 2;
        const centerY = cameraY + viewHeight / 2;

        for (const id of entities) {
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const render = entityManager.getComponent<RenderComponent>(id, 'render')!;

            if (render.renderType === 'custom') continue;

            // Interpolation
            const ix = transform.prevX + (transform.x - transform.prevX) * alpha;
            const iy = transform.prevY + (transform.y - transform.prevY) * alpha;
            const iz = transform.prevZ + (transform.z - transform.prevZ) * alpha;
            const rotation = transform.rotation;
            const scale = health?.visualScale ?? render.visualScale;

            // Perspective Projection
            const offset = ProjectionUtils.getProjectedOffset(ix, iy, iz, centerX, centerY);
            const renderX = ix + offset.x;
            const renderY = iy + iz + offset.y;

            ctx.save();

            if (scale !== 1.0) {
                ctx.translate(renderX, renderY);
                ctx.scale(scale, scale);
                ctx.translate(-renderX, -renderY);
            }

            // Draw Silhouette
            ctx.fillStyle = color;

            switch (render.renderType) {
                case 'player':
                    // Head
                    ctx.beginPath();
                    ctx.arc(renderX, renderY, render.radius, 0, Math.PI * 2);
                    ctx.fill();
                    // Cannon
                    ctx.save();
                    ctx.translate(renderX, renderY);
                    ctx.rotate(rotation);
                    ctx.fillRect(0, -3, 25, 6);
                    ctx.restore();
                    break;
                case 'player_segment':
                    ctx.beginPath();
                    ctx.arc(renderX, renderY, render.radius, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                case 'enemy':
                    const ai = entityManager.getComponent<AIComponent>(id, 'ai');
                    const shape = ai?.dossier?.visuals.shape || 'circle';

                    ctx.beginPath();
                    if (shape === 'square') {
                        ctx.translate(renderX, renderY);
                        ctx.rotate(rotation);
                        ctx.rect(-render.radius, -render.radius, render.radius * 2, render.radius * 2);
                    } else if (shape === 'triangle') {
                        ctx.translate(renderX, renderY);
                        ctx.rotate(rotation);
                        ctx.moveTo(render.radius, 0);
                        ctx.lineTo(-render.radius, -render.radius);
                        ctx.lineTo(-render.radius, render.radius);
                        ctx.closePath();
                    } else if (shape === 'rocket') {
                        ctx.translate(renderX, renderY);
                        ctx.rotate(rotation);
                        ctx.moveTo(render.radius, 0);
                        ctx.lineTo(-render.radius, -render.radius * 0.8);
                        ctx.lineTo(-render.radius * 0.5, 0);
                        ctx.lineTo(-render.radius, render.radius * 0.8);
                        ctx.closePath();
                    } else {
                        ctx.arc(renderX, renderY, render.radius, 0, Math.PI * 2);
                    }
                    ctx.fill();
                    break;
                case 'projectile':
                    ctx.beginPath();
                    ctx.arc(renderX, renderY, render.radius, 0, Math.PI * 2);
                    ctx.fill();
                    break;
            }

            ctx.restore();
        }
    }
}