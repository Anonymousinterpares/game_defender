import { World } from '../World';
import { MaterialType } from '../HeatMap';
import { WeatherManager } from '../WeatherManager';
import { ConfigManager } from '../../config/MasterConfig';

export class WorldRenderer {
    private world: World;
    private tileSize: number;
    private tileCanvasCache: Map<string, HTMLCanvasElement> = new Map();
    private wallChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dirty: boolean }> = new Map();
    private chunkSize: number = 512;
    private lastSnowAccumulation: number = 0;

    private scratchCanvas: HTMLCanvasElement;
    private scratchCtx: CanvasRenderingContext2D;
    private meltedGroundScratch: HTMLCanvasElement;
    private meltedGroundCtx: CanvasRenderingContext2D;

    constructor(world: World) {
        this.world = world;
        this.tileSize = world.getTileSize();

        this.world.onTileChange((tx, ty) => this.invalidateTileCache(tx, ty));

        this.scratchCanvas = document.createElement('canvas');
        this.scratchCanvas.width = this.chunkSize;
        this.scratchCanvas.height = this.chunkSize + 32;
        this.scratchCtx = this.scratchCanvas.getContext('2d')!;

        this.meltedGroundScratch = document.createElement('canvas');
        this.meltedGroundScratch.width = 10;
        this.meltedGroundScratch.height = 10;
        this.meltedGroundCtx = this.meltedGroundScratch.getContext('2d')!;
    }

    public invalidateTileCache(tx: number, ty: number): void {
        this.tileCanvasCache.delete(`${tx},${ty}`);

        const gx = Math.floor((tx * this.tileSize) / this.chunkSize);
        const gy = Math.floor((ty * this.tileSize) / this.chunkSize);
        const chunk = this.wallChunks.get(`${gx},${gy}`);
        if (chunk) {
            chunk.dirty = true;
        }
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
        this.renderInternal(ctx, cameraX, cameraY, false);
    }

    public renderAsSilhouette(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, color?: string): void {
        this.renderInternal(ctx, cameraX, cameraY, true, color);
    }

    private renderInternal(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, silhouette: boolean, silColor?: string): void {
        const viewWidth = ctx.canvas.width;
        const viewHeight = ctx.canvas.height;

        const currentSnow = WeatherManager.getInstance().getSnowAccumulation();
        if (Math.abs(currentSnow - this.lastSnowAccumulation) > 0.05) {
            this.tileCanvasCache.clear();
            this.wallChunks.forEach(c => c.dirty = true);
            this.lastSnowAccumulation = currentSnow;
        }

        if (!silhouette) {
            let groundColor = '#1c1c1c';
            if (currentSnow > 0) {
                const r = Math.floor(28 + (200 - 28) * currentSnow);
                const g = Math.floor(28 + (210 - 28) * currentSnow);
                const b = Math.floor(28 + (230 - 28) * currentSnow);
                groundColor = `rgb(${r},${g},${b})`;
            }

            ctx.fillStyle = groundColor;
            ctx.fillRect(cameraX, cameraY, viewWidth, viewHeight);

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

            // Render melted ground patches (dark ground showing through snow)
            if (currentSnow > 0.1) {
                const startTx = Math.floor(cameraX / this.tileSize);
                const startTy = Math.floor(cameraY / this.tileSize);
                const screenWTiles = Math.ceil(viewWidth / this.tileSize) + 1;
                const screenHTiles = Math.ceil(viewHeight / this.tileSize) + 1;

                this.renderMeltedGround(ctx, startTx, startTy, screenWTiles, screenHTiles);
            }
        }

        const startGX = Math.floor(cameraX / this.chunkSize);
        const endGX = Math.floor((cameraX + viewWidth) / this.chunkSize);
        const startGY = Math.floor(cameraY / this.chunkSize);
        const endGY = Math.floor((cameraY + viewHeight) / this.chunkSize);

        for (let gy = startGY; gy <= endGY; gy++) {
            for (let gx = startGX; gx <= endGX; gx++) {
                if (gx < 0 || gx >= Math.ceil(this.world.getWidthPixels() / this.chunkSize) ||
                    gy < 0 || gy >= Math.ceil(this.world.getHeightPixels() / this.chunkSize)) continue;

                const key = `${gx},${gy}`;
                let chunk = this.wallChunks.get(key);

                if (!chunk) {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.chunkSize;
                    canvas.height = this.chunkSize + 32;
                    chunk = { canvas, ctx: canvas.getContext('2d')!, dirty: true };
                    this.wallChunks.set(key, chunk);
                }

                if (chunk.dirty) {
                    this.rebuildWallChunk(chunk, gx, gy);
                    chunk.dirty = false;
                }

                if (silhouette) {
                    ctx.save();
                    if (silColor) {
                        const sctx = this.scratchCtx;
                        sctx.clearRect(0, 0, this.chunkSize, this.chunkSize + 32);
                        sctx.drawImage(chunk.canvas, 0, 0);
                        sctx.globalCompositeOperation = 'source-in';
                        sctx.fillStyle = silColor;
                        sctx.fillRect(0, 0, this.chunkSize, this.chunkSize + 32);
                        sctx.globalCompositeOperation = 'source-over';

                        ctx.drawImage(this.scratchCanvas, gx * this.chunkSize, gy * this.chunkSize - 8);
                    } else {
                        ctx.drawImage(chunk.canvas, gx * this.chunkSize, gy * this.chunkSize - 8);
                    }
                    ctx.restore();
                } else {
                    ctx.drawImage(chunk.canvas, gx * this.chunkSize, gy * this.chunkSize - 8);
                }
            }
        }
    }

    private rebuildWallChunk(chunk: any, gx: number, gy: number): void {
        const ctx = chunk.ctx;
        ctx.clearRect(0, 0, this.chunkSize, this.chunkSize + 32);

        const startCol = Math.floor((gx * this.chunkSize) / this.tileSize);
        const endCol = Math.ceil(((gx + 1) * this.chunkSize) / this.tileSize);
        const startRow = Math.floor((gy * this.chunkSize) / this.tileSize);
        const endRow = Math.ceil(((gy + 1) * this.chunkSize) / this.tileSize);

        for (let y = startRow; y < endRow; y++) {
            if (y < 0 || y >= this.world.getHeight()) continue;
            for (let x = startCol; x < endCol; x++) {
                if (x < 0 || x >= this.world.getWidth()) continue;

                const tileType = this.world.getTile(x, y);
                if (tileType === MaterialType.NONE) continue;

                const cacheKey = `${x},${y}`;
                let cached = this.tileCanvasCache.get(cacheKey);
                if (!cached) {
                    cached = this.renderTileToCache(x, y, tileType);
                }
                ctx.drawImage(cached, (x * this.tileSize) - (gx * this.chunkSize), (y * this.tileSize) - (gy * this.chunkSize));
            }
        }
    }

    private renderTileToCache(tx: number, ty: number, tileType: MaterialType): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = this.tileSize;
        canvas.height = this.tileSize + 16;
        const ctx = canvas.getContext('2d')!;

        let color = '#2a2a2a';
        let sideColor = '#1a1a1a';
        let topColor = '#444';

        switch (tileType) {
            case MaterialType.WOOD: color = '#5d4037'; sideColor = '#3e2723'; topColor = '#795548'; break;
            case MaterialType.BRICK: color = '#a52a2a'; sideColor = '#800000'; topColor = '#c62828'; break;
            case MaterialType.STONE: color = '#616161'; sideColor = '#424242'; topColor = '#9e9e9e'; break;
            case MaterialType.METAL: color = '#37474f'; sideColor = '#263238'; topColor = '#546e7a'; break;
            case MaterialType.INDESTRUCTIBLE: color = '#1a1a1a'; sideColor = '#000000'; topColor = '#333333'; break;
        }

        const h = 8;
        const subDiv = 10;
        const subSize = this.tileSize / subDiv;
        const hData = this.world.getHeatMap() ? this.world.getHeatMap().getTileHP(tx, ty) : null;
        const heatData = this.world.getHeatMap() ? this.world.getHeatMap().getTileHeat(tx, ty) : null;
        const sData = this.world.getHeatMap() ? this.world.getHeatMap().getTileScorch(tx, ty) : null;

        if (hData) {
            for (let sy = 0; sy < subDiv; sy++) {
                for (let sx = 0; sx < subDiv; sx++) {
                    const idx = sy * subDiv + sx;
                    if (hData[idx] > 0) {
                        const lx = sx * subSize;
                        const ly = sy * subSize + h;

                        ctx.fillStyle = sideColor;
                        ctx.fillRect(lx, ly, subSize, subSize);
                        ctx.fillStyle = color;
                        ctx.fillRect(lx, ly - h, subSize, subSize);

                        if (sData && sData[idx]) {
                            ctx.fillStyle = tileType === MaterialType.WOOD ? 'rgba(28, 28, 28, 0.8)' : 'rgba(0,0,0,0.5)';
                            ctx.fillRect(lx, ly - h, subSize, subSize);
                        }

                        if (heatData && heatData[idx] > 0.05) {
                            const heat = heatData[idx];
                            if (heat < 0.6) {
                                const r = Math.floor(100 + 155 * (heat / 0.4));
                                ctx.fillStyle = `rgba(${r}, 0, 0, ${0.2 + heat * 0.4})`;
                                ctx.fillRect(lx, ly - h, subSize, subSize);
                            }
                        }

                        // Snow accumulation on walls (applied after heat/scorch)
                        const snow = WeatherManager.getInstance().getSnowAccumulation();
                        if (snow > 0.1) {
                            // Prevent snow on very hot tiles
                            const tileHeat = heatData && heatData[idx] ? heatData[idx] : 0;
                            if (tileHeat < 0.3) {
                                // Check for local snow removal
                                const removalData = WeatherManager.getInstance().getTileSnowRemoval(tx, ty);
                                const snowFactor = removalData ? removalData[idx] : 1.0;

                                if (snowFactor > 0.01) { // Only render if some snow remains
                                    // Simple pseudo-random variation per sub-tile for natural look
                                    const variation = ((tx * 7 + ty * 13 + sx * 3 + sy * 5) % 100) / 100;
                                    const snowThreshold = 0.15 - (variation * 0.1); // 0.05 to 0.15

                                    const effectiveSnow = snow * snowFactor; // Apply local removal

                                    if (effectiveSnow > snowThreshold) {
                                        // Progressive coverage based on accumulation
                                        // Light: 0.1-0.3 (10-30% opacity)
                                        // Moderate: 0.3-0.6 (40-60% opacity)
                                        // Heavy: 0.6-1.0 (70-90% opacity)
                                        const normalizedSnow = Math.min(1.0, (effectiveSnow - snowThreshold) / (1.0 - snowThreshold));
                                        const opacity = 0.1 + (normalizedSnow * 0.8);

                                        // Top surface gets more snow (gravity)
                                        const isTopSurface = sy === 0;
                                        const finalOpacity = isTopSurface ? opacity : opacity * 0.7;

                                        ctx.fillStyle = `rgba(240, 245, 255, ${finalOpacity})`;
                                        ctx.fillRect(lx, ly - h, subSize, subSize);
                                    }
                                }
                            }
                        }

                        if (sy === 0 || sx === 0) {
                            ctx.fillStyle = topColor;
                            if (sy === 0) ctx.fillRect(lx, ly - h, subSize, 1);
                            if (sx === 0) ctx.fillRect(lx, ly - h, 1, subSize);
                        }
                    }
                }
            }
        } else {
            ctx.fillStyle = sideColor;
            ctx.fillRect(0, h, this.tileSize, this.tileSize);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, this.tileSize, this.tileSize);

            const snow = WeatherManager.getInstance().getSnowAccumulation();
            if (snow > 0.1) {
                ctx.fillStyle = `rgba(240, 245, 255, ${snow})`;
                ctx.fillRect(0, 0, this.tileSize, 2 + snow * 4);
            }

            ctx.fillStyle = topColor;
            ctx.fillRect(0, 0, this.tileSize, 2);
            ctx.fillRect(0, 0, 2, this.tileSize);
        }

        this.tileCanvasCache.set(`${tx},${ty}`, canvas);
        return canvas;
    }

    public clearCache(): void {
        this.tileCanvasCache.clear();
        this.wallChunks.clear();
    }

    private renderMeltedGround(ctx: CanvasRenderingContext2D, startTx: number, startTy: number, w: number, h: number): void {
        const wm = WeatherManager.getInstance();
        const sCtx = this.meltedGroundCtx;
        const sCanv = this.meltedGroundScratch;
        const imgData = sCtx.createImageData(10, 10);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const tx = startTx + x;
                const ty = startTy + y;

                const removal = wm.getTileSnowRemoval(tx, ty);
                if (removal) {
                    let hasPixels = false;

                    for (let i = 0; i < 100; i++) {
                        const factor = removal[i];
                        const idx = i * 4;
                        if (factor < 0.99) {
                            hasPixels = true;
                            const alpha = Math.floor((1.0 - factor) * 255);
                            imgData.data[idx] = 28;   // R
                            imgData.data[idx + 1] = 28; // G
                            imgData.data[idx + 2] = 28; // B
                            imgData.data[idx + 3] = alpha;
                        } else {
                            imgData.data[idx + 3] = 0; // Transparent
                        }
                    }

                    if (hasPixels) {
                        sCtx.putImageData(imgData, 0, 0);
                        const worldX = tx * this.tileSize;
                        const worldY = ty * this.tileSize;

                        ctx.save();
                        ctx.imageSmoothingEnabled = true; // Smooths the sub-pixels
                        ctx.drawImage(sCanv, worldX, worldY, this.tileSize, this.tileSize);
                        ctx.restore();
                    }
                }
            }
        }
    }
}
