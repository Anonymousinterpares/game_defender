import { Entity } from '../core/Entity';

export class Particle extends Entity {
    public active: boolean = true;
    private life: number = 1.0;
    private maxLife: number = 1.0;
    private alpha: number = 1.0;

    constructor(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5) {
        super(x, y);
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.life = life;
        this.maxLife = life;
        this.radius = 1 + Math.random() * 2;
    }

    update(dt: number): void {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        // Simple friction
        this.vx *= 0.95;
        this.vy *= 0.95;

        this.life -= dt;
        this.alpha = Math.max(0, this.life / this.maxLife);
        
        if (this.life <= 0) {
            this.active = false;
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
