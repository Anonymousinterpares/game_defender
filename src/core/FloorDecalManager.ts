export interface Decal {
    x: number;
    y: number;
    radius: number;
    color: string;
    opacity: number;
    rotation: number;
}

export class FloorDecalManager {
    private static instance: FloorDecalManager;
    private decals: Decal[] = [];
    private maxDecals: number = 1000;

    private constructor() {}

    public static getInstance(): FloorDecalManager {
        if (!FloorDecalManager.instance) {
            FloorDecalManager.instance = new FloorDecalManager();
        }
        return FloorDecalManager.instance;
    }

    public addScorchMark(x: number, y: number, radius: number): void {
        this.decals.push({
            x,
            y,
            radius: radius * (0.8 + Math.random() * 0.4),
            color: '#000000',
            opacity: 0.4 + Math.random() * 0.3,
            rotation: Math.random() * Math.PI * 2
        });

        if (this.decals.length > this.maxDecals) {
            this.decals.shift();
        }
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;

        this.decals.forEach(d => {
            // Culling
            if (d.x + d.radius < cameraX || d.x - d.radius > cameraX + viewW ||
                d.y + d.radius < cameraY || d.y - d.radius > cameraY + viewH) return;

            ctx.save();
            ctx.globalAlpha = d.opacity;
            ctx.translate(d.x, d.y);
            ctx.rotate(d.rotation);

            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, d.radius);
            grad.addColorStop(0, d.color);
            grad.addColorStop(0.6, d.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, d.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        });
    }

    public clear(): void {
        this.decals = [];
    }
}
