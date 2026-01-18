import { World } from '../World';
import { MaterialType } from '../HeatMap';
import { WeatherManager } from '../WeatherManager';
import { ConfigManager } from '../../config/MasterConfig';
import { ProjectionUtils } from '../../utils/ProjectionUtils';

export class WorldRenderer {
    private world: World;
    private tileSize: number;
    private groundChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dirty: boolean }> = new Map();
    private chunkSize: number = 512;
    private lastSnowAccumulation: number = 0;

    // Wall settings
    private readonly WALL_HEIGHT = -32; // Negative for UP

    private scratchCanvas: HTMLCanvasElement;
    private scratchCtx: CanvasRenderingContext2D;
    
    // Batched melted ground rendering
    private meltedBatchCanvas: HTMLCanvasElement;
    private meltedBatchCtx: CanvasRenderingContext2D;
    private meltedBatchData: ImageData | null = null;
    private meltedBatchWidth: number = 0;
    private meltedBatchHeight: number = 0;

    constructor(world: World) {
        this.world = world;
        this.tileSize = world.getTileSize();

        this.world.onTileChange((tx, ty) => this.invalidateGroundCache(tx, ty));

        this.scratchCanvas = document.createElement('canvas');
        this.scratchCanvas.width = this.chunkSize;
        this.scratchCanvas.height = this.chunkSize;
        this.scratchCtx = this.scratchCanvas.getContext('2d')!;

        // Initialize batch canvas
        this.meltedBatchCanvas = document.createElement('canvas');
        this.meltedBatchCtx = this.meltedBatchCanvas.getContext('2d', { willReadFrequently: true })!;
    }

    public invalidateGroundCache(tx: number, ty: number): void {
        const gx = Math.floor((tx * this.tileSize) / this.chunkSize);
        const gy = Math.floor((ty * this.tileSize) / this.chunkSize);
        const chunk = this.groundChunks.get(`${gx},${gy}`);
        if (chunk) {
            chunk.dirty = true;
        }
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
        const viewWidth = ctx.canvas.width;
        const viewHeight = ctx.canvas.height;
        const cameraCenterX = cameraX + viewWidth / 2;
        const cameraCenterY = cameraY + viewHeight / 2;

        const currentSnow = WeatherManager.getInstance().getSnowAccumulation();
        if (Math.abs(currentSnow - this.lastSnowAccumulation) > 0.05) {
            this.groundChunks.forEach(c => c.dirty = true);
            this.lastSnowAccumulation = currentSnow;
        }

        // 1. RENDER GROUND PLANE (Cached Chunks)
        this.renderGround(ctx, cameraX, cameraY, viewWidth, viewHeight);

        // 2. RENDER DYNAMIC WALLS (Center-Out Parallax)
        this.renderWalls(ctx, cameraX, cameraY, viewWidth, viewHeight, cameraCenterX, cameraCenterY);
    }

    public renderAsSilhouette(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, color?: string): void {
        // For walls, we just render them normally into the silhouette buffer.
        // The LightingRenderer will use globalCompositeOperation to color them.
        this.render(ctx, cameraX, cameraY);
    }

    private renderGround(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): void {
        const currentSnow = WeatherManager.getInstance().getSnowAccumulation();
        
        let groundColor = '#1c1c1c';
        if (currentSnow > 0) {
            const r = Math.floor(28 + (200 - 28) * currentSnow);
            const g = Math.floor(28 + (210 - 28) * currentSnow);
            const b = Math.floor(28 + (230 - 28) * currentSnow);
            groundColor = `rgb(${r},${g},${b})`;
        }

        ctx.fillStyle = groundColor;
        ctx.fillRect(cameraX, cameraY, viewWidth, viewHeight);

        // Grid (Local view)
        ctx.beginPath();
        ctx.strokeStyle = currentSnow > 0.5 ? 'rgba(255,255,255,0.1)' : '#222222';
        ctx.lineWidth = 1;

        const startX = Math.floor(cameraX / this.tileSize) * this.tileSize;
        const endX = cameraX + viewWidth;
        const startY = Math.floor(cameraY / this.tileSize) * this.tileSize;
        const endY = cameraY + viewHeight;

        for (let x = startX; x <= endX; x += this.tileSize) {
            ctx.moveTo(x, cameraY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += this.tileSize) {
            ctx.moveTo(cameraX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();

        // Melted patches
        if (currentSnow > 0.1) {
            const startTx = Math.floor(cameraX / this.tileSize);
            const startTy = Math.floor(cameraY / this.tileSize);
            const screenWTiles = Math.ceil(viewWidth / this.tileSize) + 1;
            const screenHTiles = Math.ceil(viewHeight / this.tileSize) + 1;
            this.renderMeltedGround(ctx, startTx, startTy, screenWTiles, screenHTiles, cameraX, cameraY);
        }
    }

    private renderWalls(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number, centerX: number, centerY: number): void {
        const startTx = Math.floor(cameraX / this.tileSize);
        const endTx = Math.ceil((cameraX + viewWidth) / this.tileSize);
        const startTy = Math.floor(cameraY / this.tileSize);
        const endTy = Math.ceil((cameraY + viewHeight) / this.tileSize);

        // Painter's Algorithm: Sort order based on camera to avoid overlap issues
        const yDir = centerY > (startTy + endTy) * this.tileSize / 2 ? 1 : -1;
        const xDir = centerX > (startTx + endTx) * this.tileSize / 2 ? 1 : -1;

        const yRange = [];
        for (let ty = startTy; ty <= endTy; ty++) yRange.push(ty);
        if (yDir === -1) yRange.reverse();

        const xRange = [];
        for (let tx = startTx; tx <= endTx; tx++) xRange.push(tx);
        if (xDir === -1) xRange.reverse();

        for (const ty of yRange) {
            if (ty < 0 || ty >= this.world.getHeight()) continue;
            for (const tx of xRange) {
                if (tx < 0 || tx >= this.world.getWidth()) continue;

                const material = this.world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;

                this.renderSingleWall(ctx, tx, ty, material, centerX, centerY);
            }
        }
    }

    private renderSingleWall(ctx: CanvasRenderingContext2D, tx: number, ty: number, material: MaterialType, centerX: number, centerY: number): void {
        const worldX = tx * this.tileSize;
        const worldY = ty * this.tileSize;
        
        // Base points
        const x0 = worldX;
        const y0 = worldY;
        const x1 = worldX + this.tileSize;
        const y1 = worldY + this.tileSize;

        // Projected points for the top face
        const offset = ProjectionUtils.getProjectedOffset(worldX + this.tileSize/2, worldY + this.tileSize/2, this.WALL_HEIGHT, centerX, centerY);
        const tx0 = x0 + offset.x;
        const ty0 = y0 + offset.y;
        const tx1 = x1 + offset.x;
        const ty1 = y1 + offset.y;

        let color = '#2a2a2a';
        let sideColor = '#1a1a1a';
        let topColorBase = '#444';

        switch (material) {
            case MaterialType.WOOD: color = '#5d4037'; sideColor = '#3e2723'; topColorBase = '#795548'; break;
            case MaterialType.BRICK: color = '#a52a2a'; sideColor = '#800000'; topColorBase = '#c62828'; break;
            case MaterialType.STONE: color = '#616161'; sideColor = '#424242'; topColorBase = '#9e9e9e'; break;
            case MaterialType.METAL: color = '#37474f'; sideColor = '#263238'; topColorBase = '#546e7a'; break;
            case MaterialType.INDESTRUCTIBLE: color = '#1a1a1a'; sideColor = '#000000'; topColorBase = '#333333'; break;
        }

        // Draw Sides (only if visible based on camera position)
        ctx.fillStyle = sideColor;
        
        // Top side (visible if leaning down)
        if (offset.y > 0) {
            ctx.beginPath();
            ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
            ctx.lineTo(tx1, ty0); ctx.lineTo(tx0, ty0);
            ctx.fill();
        }
        // Bottom side (visible if leaning up)
        if (offset.y < 0) {
            ctx.beginPath();
            ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
            ctx.lineTo(tx1, ty1); ctx.lineTo(tx0, ty1);
            ctx.fill();
        }
        // Left side (visible if leaning right)
        if (offset.x > 0) {
            ctx.beginPath();
            ctx.moveTo(x0, y0); ctx.lineTo(x0, y1);
            ctx.lineTo(tx0, ty1); ctx.lineTo(tx0, ty0);
            ctx.fill();
        }
        // Right side (visible if leaning left)
        if (offset.x < 0) {
            ctx.beginPath();
            ctx.moveTo(x1, y0); ctx.lineTo(x1, y1);
            ctx.lineTo(tx1, ty1); ctx.lineTo(tx1, ty0);
            ctx.fill();
        }

        // Draw Top Face (with 10x10 destruction logic)
        this.renderWallTop(ctx, tx, ty, tx0, ty0, material, topColorBase);
    }

    private renderWallTop(ctx: CanvasRenderingContext2D, tx: number, ty: number, px: number, py: number, material: MaterialType, topColorBase: string): void {
        const heatMap = this.world.getHeatMap();
        const hpData = heatMap ? heatMap.getTileHP(tx, ty) : null;
        const heatData = heatMap ? heatMap.getTileHeat(tx, ty) : null;
        const sData = heatMap ? heatMap.getTileScorch(tx, ty) : null;
        const snow = WeatherManager.getInstance().getSnowAccumulation();

        if (!hpData) {
            ctx.fillStyle = topColorBase;
            ctx.fillRect(px, py, this.tileSize, this.tileSize);
            if (snow > 0.1) {
                ctx.fillStyle = `rgba(240, 245, 255, ${snow})`;
                ctx.fillRect(px, py, this.tileSize, this.tileSize);
            }
            return;
        }

        const subDiv = 10;
        const subSize = this.tileSize / subDiv;

        for (let sy = 0; sy < subDiv; sy++) {
            for (let sx = 0; sx < subDiv; sx++) {
                const idx = sy * subDiv + sx;
                if (hpData[idx] > 0) {
                    const lx = px + sx * subSize;
                    const ly = py + sy * subSize;

                    ctx.fillStyle = topColorBase;
                    ctx.fillRect(lx, ly, subSize, subSize);

                    if (sData && sData[idx]) {
                        ctx.fillStyle = material === MaterialType.WOOD ? 'rgba(28, 28, 28, 0.8)' : 'rgba(0,0,0,0.5)';
                        ctx.fillRect(lx, ly, subSize, subSize);
                    }

                    if (heatData && heatData[idx] > 0.05) {
                        const heat = heatData[idx];
                        const r = Math.floor(100 + 155 * Math.min(1, heat / 0.6));
                        ctx.fillStyle = `rgba(${r}, 0, 0, ${0.2 + heat * 0.4})`;
                        ctx.fillRect(lx, ly, subSize, subSize);
                    }

                    if (snow > 0.1) {
                        const tileHeat = heatData && heatData[idx] ? heatData[idx] : 0;
                        if (tileHeat < 0.3) {
                            const removalData = WeatherManager.getInstance().getTileSnowRemoval(tx, ty);
                            const snowFactor = removalData ? removalData[idx] : 1.0;
                            if (snowFactor > 0.01) {
                                ctx.fillStyle = `rgba(240, 245, 255, ${snow * snowFactor})`;
                                ctx.fillRect(lx, ly, subSize, subSize);
                            }
                        }
                    }
                }
            }
        }
    }

    private renderMeltedGround(ctx: CanvasRenderingContext2D, startTx: number, startTy: number, w: number, h: number, camX: number, camY: number): void {
        const wm = WeatherManager.getInstance();
        const subDiv = 10;
        const requiredW = w * subDiv;
        const requiredH = h * subDiv;

        if (this.meltedBatchWidth !== requiredW || this.meltedBatchHeight !== requiredH) {
            this.meltedBatchWidth = requiredW;
            this.meltedBatchHeight = requiredH;
            this.meltedBatchCanvas.width = requiredW;
            this.meltedBatchCanvas.height = requiredH;
            this.meltedBatchData = this.meltedBatchCtx.createImageData(requiredW, requiredH);
        }

        const imgData = this.meltedBatchData!;
        new Uint32Array(imgData.data.buffer).fill(0);

        let hasPixels = false;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const tx = startTx + x;
                const ty = startTy + y;
                const removal = wm.getTileSnowRemoval(tx, ty);
                if (removal) {
                    hasPixels = true;
                    const bufferStartX = x * subDiv;
                    const bufferStartY = y * subDiv;
                    for (let sy = 0; sy < subDiv; sy++) {
                        const rowOffset = (bufferStartY + sy) * requiredW * 4;
                        for (let sx = 0; sx < subDiv; sx++) {
                            const factor = removal[sy * subDiv + sx];
                            if (factor < 0.99) {
                                const bufferIdx = rowOffset + (bufferStartX + sx) * 4;
                                const alpha = Math.floor((1.0 - factor) * 255);
                                imgData.data[bufferIdx] = 28;
                                imgData.data[bufferIdx + 1] = 28;
                                imgData.data[bufferIdx + 2] = 28;
                                imgData.data[bufferIdx + 3] = alpha;
                            }
                        }
                    }
                }
            }
        }

        if (hasPixels) {
            this.meltedBatchCtx.putImageData(imgData, 0, 0);
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            const worldX = startTx * this.tileSize;
            const worldY = startTy * this.tileSize;
            const widthWorld = w * this.tileSize;
            const heightWorld = h * this.tileSize;
            ctx.drawImage(this.meltedBatchCanvas, worldX, worldY, widthWorld, heightWorld);
            ctx.restore();
        }
    }

    public invalidateTileCache(tx: number, ty: number): void {
        this.invalidateGroundCache(tx, ty);
    }

    public clearCache(): void {
        this.groundChunks.clear();
    }
}