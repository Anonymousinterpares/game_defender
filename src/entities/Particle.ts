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
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
