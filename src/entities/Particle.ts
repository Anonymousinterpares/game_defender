import { Entity } from '../core/Entity';

export class Particle extends Entity {
    public active: boolean = true;
    public isFlame: boolean = false;
    private life: number = 1.0;
    private maxLife: number = 1.0;
    private alpha: number = 1.0;
    private startRadius: number = 0;

    constructor(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5) {
        super(x, y);
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.life = life;
        this.maxLife = life;
        this.radius = 1 + Math.random() * 2;
        this.startRadius = this.radius;
    }

    update(dt: number, world?: any): void {
        const nextX = this.x + this.vx * dt;
        const nextY = this.y + this.vy * dt;

        if (this.isFlame && world && world.isWall(nextX, nextY)) {
            this.vx = 0;
            this.vy = 0;
            this.life *= 0.5; // Die faster on hit
        } else {
            this.x = nextX;
            this.y = nextY;
        }
        
        // Simple friction
        this.vx *= 0.95;
        this.vy *= 0.95;

        this.life -= dt;
        const lifeRatio = this.life / this.maxLife;
        this.alpha = Math.max(0, lifeRatio);
        
        if (this.isFlame) {
            // Flames grow and then fade
            this.radius = this.startRadius + (1 - lifeRatio) * 10;
            
            // Color shift from yellow/white to orange/red to dark gray
            if (lifeRatio > 0.7) this.color = '#fffbe6';
            else if (lifeRatio > 0.4) this.color = '#ffcc00';
            else if (lifeRatio > 0.2) this.color = '#ff4400';
            else this.color = '#333';
        }

        if (this.life <= 0) {
            this.active = false;
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.fillStyle = this.color;
        
        if (this.isFlame) {
            ctx.globalCompositeOperation = this.alpha > 0.4 ? 'screen' : 'source-over';
            // Soft glow for flame
            const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
            grad.addColorStop(0, this.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
        }

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

export class ShockwaveParticle extends Entity {
    public active: boolean = true;
    public id: string = Math.random().toString(36).substr(2, 9);
    private life: number = 0.4;
    private maxLife: number = 0.4;
    private maxRadius: number;

    constructor(x: number, y: number, radius: number) {
        super(x, y);
        this.maxRadius = radius;
    }

    update(dt: number): void {
        this.life -= dt;
        if (this.life <= 0) this.active = false;
    }

    render(ctx: CanvasRenderingContext2D): void {
        const ratio = 1 - (this.life / this.maxLife);
        const currentRadius = this.maxRadius * Math.pow(ratio, 0.5);
        const alpha = 0.8 * (1 - ratio);

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, currentRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

export class FlashParticle extends Entity {
    public active: boolean = true;
    public id: string = Math.random().toString(36).substr(2, 9);
    private life: number = 0.1;
    private maxLife: number = 0.1;
    private radius: number;

    constructor(x: number, y: number, radius: number) {
        super(x, y);
        this.radius = radius;
    }

    update(dt: number): void {
        this.life -= dt;
        if (this.life <= 0) this.active = false;
    }

    render(ctx: CanvasRenderingContext2D): void {
        const ratio = this.life / this.maxLife;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
        grad.addColorStop(0, `rgba(255, 255, 255, ${ratio})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

export class MoltenMetalParticle extends Particle {
    private gravity: number = 80; // Very low gravity for slow motion feel
    private vz: number = -60 - Math.random() * 40; // Gentle upward burst
    private z: number = 0;
    public damage: number = 5;

    constructor(x: number, y: number, vx: number, vy: number) {
        // High life to ensure they stay on ground for a bit
        super(x, y, '#ffff00', vx, vy, 5.0 + Math.random() * 2.0);
        this.radius = 4 + Math.random() * 2;
    }

    update(dt: number, world?: any): void {
        const nextX = this.x + this.vx * dt;
        const nextY = this.y + this.vy * dt;

        // Collision with walls while in air
        if (world && world.isWall(nextX, nextY)) {
            this.vx *= -0.3; // Very soft bounce
            this.vy *= -0.3;
        } else {
            this.x = nextX;
            this.y = nextY;
        }
        
        // Z-axis simulation (arc)
        this.vz += this.gravity * dt;
        this.z += this.vz * dt;

        // Minimal friction for consistent slow glide
        this.vx *= 0.995;
        this.vy *= 0.995;

        if (this.z > 0 && this.vz > 0) {
            // Landed
            if (this.z !== 0) { // First time landing
                if (world && world.heatMap) {
                    world.heatMap.addHeat(this.x, this.y, 0.6, 20);
                }
            }
            this.z = 0;
            this.vz = 0;
            this.vx = 0;
            this.vy = 0;
        }

        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
        }
        
        // Pure bright glow while in air, cooling on ground
        if (this.z < 0) {
            this.color = '#fffbe6'; // White-ish yellow
        } else {
            const lifeRatio = this.life / 7.0;
            if (lifeRatio > 0.6) this.color = '#ffff00';
            else if (lifeRatio > 0.3) this.color = '#ffaa00';
            else if (lifeRatio > 0.1) this.color = '#ff4400';
            else this.color = '#222';
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        const rx = this.x;
        const ry = this.y + this.z; // Apply Z offset

        ctx.save();
        ctx.globalCompositeOperation = 'screen'; // additive-like glow
        
        // Larger, more intense white-heat glow for visibility
        const glowRadius = this.radius * (this.z < 0 ? 6 : 4);
        const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, glowRadius);
        const alpha = this.z < 0 ? 0.9 : (this.life / 7.0) * 0.9;
        
        grad.addColorStop(0, '#ffffff'); // Pure white center
        grad.addColorStop(0.2, '#ffff00'); // Yellow transition
        grad.addColorStop(0.5, this.color);
        grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
        
        ctx.fillStyle = grad;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(rx, ry, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Solid core for definition
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(rx, ry, this.radius * 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

    }
}
