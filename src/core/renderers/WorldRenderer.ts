import { World } from '../World';
import { HeatMap, MaterialType } from '../HeatMap';
import { WeatherManager } from '../WeatherManager';
import { ConfigManager } from '../../config/MasterConfig';
import { ProjectionUtils } from '../../utils/ProjectionUtils';
import { WorldClock } from '../WorldClock';

export class WorldRenderer {
    private world: World;
    private tileSize: number;
    private groundChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dirty: boolean }> = new Map();
    private damagedTileCache: Map<string, {
        exposedFaces: { sx: number, sy: number, face: number }[],
        holeIndices: number[],
        solidIndices: number[]
    }> = new Map();
    private chunkSize: number = 512;
    private lastSnowAccumulation: number = 0;

    // Wall settings
    private wallHeight: number = -32; // Negative for UP

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
        this.meltedBatchCtx = this.meltedBatchCanvas.getContext('2d')!;
    }

    public invalidateGroundCache(tx: number, ty: number): void {
        const gx = Math.floor((tx * this.tileSize) / this.chunkSize);
        const gy = Math.floor((ty * this.tileSize) / this.chunkSize);
        this.damagedTileCache.delete(`${tx},${ty}`);
        const chunk = this.groundChunks.get(`${gx},${gy}`);
        if (chunk) {
            chunk.dirty = true;
        }
    }

    private getDamagedTileData(tx: number, ty: number, hpData: Float32Array): {
        exposedFaces: { sx: number, sy: number, face: number }[],
        holeIndices: number[],
        solidIndices: number[]
    } {
        const key = `${tx},${ty}`;
        if (this.damagedTileCache.has(key)) return this.damagedTileCache.get(key)!;

        const exposedFaces: { sx: number, sy: number, face: number }[] = [];
        const holeIndices: number[] = [];
        const solidIndices: number[] = [];
        const subDiv = 10;

        for (let sy = 0; sy < subDiv; sy++) {
            for (let sx = 0; sx < subDiv; sx++) {
                const idx = sy * subDiv + sx;
                if (hpData[idx] <= 0) {
                    holeIndices.push(idx);
                    continue;
                }
                solidIndices.push(idx);

                // 0:Top, 1:Bottom, 2:Left, 3:Right
                if (sy === 0) {
                    if (this.world.getTile(tx, ty - 1) === MaterialType.NONE) exposedFaces.push({ sx, sy, face: 0 });
                } else if (hpData[(sy - 1) * subDiv + sx] <= 0) exposedFaces.push({ sx, sy, face: 0 });

                if (sy === subDiv - 1) {
                    if (this.world.getTile(tx, ty + 1) === MaterialType.NONE) exposedFaces.push({ sx, sy, face: 1 });
                } else if (hpData[(sy + 1) * subDiv + sx] <= 0) exposedFaces.push({ sx, sy, face: 1 });

                if (sx === 0) {
                    if (this.world.getTile(tx - 1, ty) === MaterialType.NONE) exposedFaces.push({ sx, sy, face: 2 });
                } else if (hpData[sy * subDiv + (sx - 1)] <= 0) exposedFaces.push({ sx, sy, face: 2 });

                if (sx === subDiv - 1) {
                    if (this.world.getTile(tx + 1, ty) === MaterialType.NONE) exposedFaces.push({ sx, sy, face: 3 });
                } else if (hpData[sy * subDiv + (sx + 1)] <= 0) exposedFaces.push({ sx, sy, face: 3 });
            }
        }

        const data = { exposedFaces, holeIndices, solidIndices };
        this.damagedTileCache.set(key, data);
        return data;
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, gpuActive: boolean = false): void {
        // Skip world rendering if GPU is handling it
        if (gpuActive) return;

        this.wallHeight = -ConfigManager.getInstance().get<number>('World', 'wallHeight');
        const viewWidth = ctx.canvas.width;
        const viewHeight = ctx.canvas.height;

        const currentSnow = WeatherManager.getInstance().getSnowAccumulation();
        if (Math.abs(currentSnow - this.lastSnowAccumulation) > 0.05) {
            this.groundChunks.forEach(c => c.dirty = true);
            this.damagedTileCache.clear();
            this.lastSnowAccumulation = currentSnow;
        }

        // 1. RENDER GROUND PLANE (Cached Chunks)
        this.renderGround(ctx, cameraX, cameraY, viewWidth, viewHeight);
    }

    public renderSides(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, gpuActive: boolean = false): void {
        if (gpuActive) return;

        this.wallHeight = -ConfigManager.getInstance().get<number>('World', 'wallHeight');
        const viewWidth = window.innerWidth;
        const viewHeight = window.innerHeight;
        const centerX = cameraX + viewWidth / 2;
        const centerY = cameraY + viewHeight / 2;

        const startTx = Math.floor(cameraX / this.tileSize);
        const endTx = Math.ceil((cameraX + viewWidth) / this.tileSize);
        const startTy = Math.floor(cameraY / this.tileSize);
        const endTy = Math.ceil((cameraY + viewHeight) / this.tileSize);

        for (let ty = startTy; ty <= endTy; ty++) {
            if (ty < 0 || ty >= this.world.getHeight()) continue;
            for (let tx = startTx; tx <= endTx; tx++) {
                if (tx < 0 || tx >= this.world.getWidth()) continue;
                const material = this.world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;
                this.renderWallSidesOnly(ctx, tx, ty, material, centerX, centerY);
            }
        }
    }

    private adjustColor(hex: string, multiplier: number): string {
        const { r, g, b } = this.hexToRgb(hex);
        return `rgb(${Math.min(255, Math.floor(r * multiplier))}, ${Math.min(255, Math.floor(g * multiplier))}, ${Math.min(255, Math.floor(b * multiplier))})`;
    }

    private hexToRgb(hex: string): { r: number, g: number, b: number } {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return { r, g, b };
    }

    private renderWallSidesOnly(ctx: CanvasRenderingContext2D, tx: number, ty: number, material: MaterialType, centerX: number, centerY: number): void {
        const worldX = tx * this.tileSize;
        const worldY = ty * this.tileSize;
        const ts = this.tileSize;

        const x0 = worldX; const y0 = worldY;
        const x1 = worldX + ts; const y1 = worldY + ts;

        const v0 = ProjectionUtils.projectPoint(x0, y0, this.wallHeight, centerX, centerY);
        const v1 = ProjectionUtils.projectPoint(x1, y0, this.wallHeight, centerX, centerY);
        const v2 = ProjectionUtils.projectPoint(x1, y1, this.wallHeight, centerX, centerY);
        const v3 = ProjectionUtils.projectPoint(x0, y1, this.wallHeight, centerX, centerY);

        let sideColorBase = '#1a1a1a';
        switch (material) {
            case MaterialType.WOOD: sideColorBase = '#3e2723'; break;
            case MaterialType.BRICK: sideColorBase = '#800000'; break;
            case MaterialType.STONE: sideColorBase = '#424242'; break;
            case MaterialType.METAL: sideColorBase = '#263238'; break;
            case MaterialType.INDESTRUCTIBLE: sideColorBase = '#080808'; break;
        }

        // --- SHADING LOGIC ---
        const { sun, moon } = WorldClock.getInstance().getTimeState();
        const activeLight = sun.active ? sun : (moon.active ? moon : null);

        const getShadedColor = (nx: number, ny: number) => {
            if (!activeLight) return sideColorBase;
            // Dot product (Light Dir vs Face Normal)
            // Normal points OUT from wall. Light dir points FROM source.
            // If dot is negative, light is hitting the face.
            const dot = activeLight.direction.x * nx + activeLight.direction.y * ny;
            const shading = Math.max(0, -dot) * activeLight.intensity;
            // Base ambient (0.5) to light (1.3)
            return this.adjustColor(sideColorBase, 0.5 + shading * 0.8);
        };

        const topCol = getShadedColor(0, -1);
        const bottomCol = getShadedColor(0, 1);
        const leftCol = getShadedColor(-1, 0);
        const rightCol = getShadedColor(1, 0);

        const hasTop = ty > 0 && this.world.getTile(tx, ty - 1) !== MaterialType.NONE;
        const hasBottom = ty < this.world.getHeight() - 1 && this.world.getTile(tx, ty + 1) !== MaterialType.NONE;
        const hasLeft = tx > 0 && this.world.getTile(tx - 1, ty) !== MaterialType.NONE;
        const hasRight = tx < this.world.getWidth() - 1 && this.world.getTile(tx + 1, ty) !== MaterialType.NONE;

        const heatMap = this.world.getHeatMap();
        const hpData = heatMap?.getTileHP(tx, ty);
        const heatData = heatMap?.getTileHeat(tx, ty);
        const sData = heatMap?.getTileScorch(tx, ty);
        const isDamaged = heatMap?.hasTileData(tx, ty) && hpData;
        const subDiv = 10;

        if (!isDamaged) {
            // Fast path for healthy tiles
            if (!hasTop && v0.y > y0) {
                ctx.fillStyle = topCol;
                ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(v1.x, v1.y); ctx.lineTo(v0.x, v0.y); ctx.fill();
            }
            if (!hasBottom && v3.y < y1) {
                ctx.fillStyle = bottomCol;
                ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(v2.x, v2.y); ctx.lineTo(v3.x, v3.y); ctx.fill();
            }
            if (!hasLeft && v0.x > x0) {
                ctx.fillStyle = leftCol;
                ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(v3.x, v3.y); ctx.lineTo(v0.x, v0.y); ctx.fill();
            }
            if (!hasRight && v1.x < x1) {
                ctx.fillStyle = rightCol;
                ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(v2.x, v2.y); ctx.lineTo(v1.x, v1.y); ctx.fill();
            }
        } else {
            // ROBUST DAMAGED SIDES: Render only exposed sub-tile faces
            const data = this.getDamagedTileData(tx, ty, hpData);

            const canSeeTop = v0.y > y0;
            const canSeeBottom = v3.y < y1;
            const canSeeLeft = v0.x > x0;
            const canSeeRight = v1.x < x1;

            data.exposedFaces.forEach(f => {
                // Only render if camera angle allows seeing this face
                if (f.face === 0 && !canSeeTop) return;
                if (f.face === 1 && !canSeeBottom) return;
                if (f.face === 2 && !canSeeLeft) return;
                if (f.face === 3 && !canSeeRight) return;

                const fsx0 = f.sx / subDiv; const fsx1 = (f.sx + 1) / subDiv;
                const fsy0 = f.sy / subDiv; const fsy1 = (f.sy + 1) / subDiv;

                let p0_side, p1_side, b0_side, b1_side;
                let faceCol = sideColorBase;

                if (f.face === 0) { // Top
                    p0_side = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy0);
                    p1_side = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy0);
                    b0_side = { x: x0 + fsx0 * ts, y: y0 + fsy0 * ts };
                    b1_side = { x: x0 + fsx1 * ts, y: y0 + fsy0 * ts };
                    faceCol = topCol;
                } else if (f.face === 1) { // Bottom
                    p0_side = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy1);
                    p1_side = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy1);
                    b0_side = { x: x0 + fsx0 * ts, y: y0 + fsy1 * ts };
                    b1_side = { x: x0 + fsx1 * ts, y: y0 + fsy1 * ts };
                    faceCol = bottomCol;
                } else if (f.face === 2) { // Left
                    p0_side = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy0);
                    p1_side = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy1);
                    b0_side = { x: x0 + fsx0 * ts, y: y0 + fsy0 * ts };
                    b1_side = { x: x0 + fsx0 * ts, y: y0 + fsy1 * ts };
                    faceCol = leftCol;
                } else { // Right
                    p0_side = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy0);
                    p1_side = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy1);
                    b0_side = { x: x0 + fsx1 * ts, y: y0 + fsy0 * ts };
                    b1_side = { x: x0 + fsx1 * ts, y: y0 + fsy1 * ts };
                    faceCol = rightCol;
                }

                ctx.fillStyle = faceCol;
                ctx.beginPath();
                ctx.moveTo(b0_side.x, b0_side.y); ctx.lineTo(b1_side.x, b1_side.y);
                ctx.lineTo(p1_side.x, p1_side.y); ctx.lineTo(p0_side.x, p0_side.y);
                ctx.fill();

                // Simple Overlays (Scorch/Heat) on exposed sides
                const idx = f.sy * subDiv + f.sx;
                if (sData && sData[idx]) {
                    ctx.fillStyle = material === MaterialType.WOOD ? 'rgba(28, 28, 28, 0.4)' : 'rgba(0,0,0,0.25)';
                    ctx.beginPath();
                    ctx.moveTo(b0_side.x, b0_side.y); ctx.lineTo(b1_side.x, b1_side.y);
                    ctx.lineTo(p1_side.x, p1_side.y); ctx.lineTo(p0_side.x, p0_side.y);
                    ctx.fill();
                }
                if (heatData && heatData[idx] > 0.05) {
                    const heat = heatData[idx];
                    const { r, g, b } = HeatMap.getHeatColorComponents(heat);
                    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 + heat * 0.2})`;
                    ctx.beginPath();
                    ctx.moveTo(b0_side.x, b0_side.y); ctx.lineTo(b1_side.x, b1_side.y);
                    ctx.lineTo(p1_side.x, p1_side.y); ctx.lineTo(p0_side.x, p0_side.y);
                    ctx.fill();
                }
            });
        }
    }

    public renderWallTopOnly(ctx: CanvasRenderingContext2D, tx: number, ty: number, material: MaterialType, centerX: number, centerY: number, gpuActive: boolean = false): void {

        this.wallHeight = -ConfigManager.getInstance().get<number>('World', 'wallHeight');
        const worldX = tx * this.tileSize;
        const worldY = ty * this.tileSize;
        const ts = this.tileSize;

        const v0 = ProjectionUtils.projectPoint(worldX, worldY, this.wallHeight, centerX, centerY);
        const v1 = ProjectionUtils.projectPoint(worldX + ts, worldY, this.wallHeight, centerX, centerY);
        const v2 = ProjectionUtils.projectPoint(worldX + ts, worldY + ts, this.wallHeight, centerX, centerY);
        const v3 = ProjectionUtils.projectPoint(worldX, worldY + ts, this.wallHeight, centerX, centerY);

        let topColorBase = '#444';
        switch (material) {
            case MaterialType.WOOD: topColorBase = '#795548'; break;
            case MaterialType.BRICK: topColorBase = '#c62828'; break;
            case MaterialType.STONE: topColorBase = '#9e9e9e'; break;
            case MaterialType.METAL: topColorBase = '#546e7a'; break;
            case MaterialType.INDESTRUCTIBLE: topColorBase = '#333333'; break;
        }

        this.renderWallTop(ctx, tx, ty, v0, v1, v2, v3, material, topColorBase);
    }

    public renderAsSilhouette(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, color: string = '#000000'): void {
        const viewWidth = window.innerWidth;
        const viewHeight = window.innerHeight;
        const centerX = cameraX + viewWidth / 2;
        const centerY = cameraY + viewHeight / 2;

        const startTx = Math.floor(cameraX / this.tileSize);
        const endTx = Math.ceil((cameraX + viewWidth) / this.tileSize);
        const startTy = Math.floor(cameraY / this.tileSize);
        const endTy = Math.ceil((cameraY + viewHeight) / this.tileSize);

        for (let ty = startTy; ty <= endTy; ty++) {
            if (ty < 0 || ty >= this.world.getHeight()) continue;
            for (let tx = startTx; tx <= endTx; tx++) {
                if (tx < 0 || tx >= this.world.getWidth()) continue;
                const material = this.world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;

                const worldX = tx * this.tileSize;
                const worldY = ty * this.tileSize;
                const ts = this.tileSize;

                const v0 = ProjectionUtils.projectPoint(worldX, worldY, this.wallHeight, centerX, centerY);
                const v1 = ProjectionUtils.projectPoint(worldX + ts, worldY, this.wallHeight, centerX, centerY);
                const v2 = ProjectionUtils.projectPoint(worldX + ts, worldY + ts, this.wallHeight, centerX, centerY);
                const v3 = ProjectionUtils.projectPoint(worldX, worldY + ts, this.wallHeight, centerX, centerY);

                // Draw the side volume and top as a solid color for the mask
                ctx.fillStyle = color;

                // Sides
                const x0 = worldX; const y0 = worldY;
                const x1 = worldX + ts; const y1 = worldY + ts;
                if (v0.y > y0) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(v1.x, v1.y); ctx.lineTo(v0.x, v0.y); ctx.fill(); }
                if (v3.y < y1) { ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(v2.x, v2.y); ctx.lineTo(v3.x, v3.y); ctx.fill(); }
                if (v0.x > x0) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(v3.x, v3.y); ctx.lineTo(v0.x, v0.y); ctx.fill(); }
                if (v1.x < x1) { ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(v2.x, v2.y); ctx.lineTo(v1.x, v1.y); ctx.fill(); }

                // Top
                ctx.beginPath();
                ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y);
                ctx.lineTo(v2.x, v2.y); ctx.lineTo(v3.x, v3.y);
                ctx.fill();
            }
        }
    }

    private renderGround(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): void {
        const currentSnow = WeatherManager.getInstance().getSnowAccumulation();
        const { sun, moon, isDaylight } = (window as any).WorldClockInstance ? (window as any).WorldClockInstance.getTimeState() : { sun: { active: false, color: '#fff', intensity: 0 }, moon: { active: false, color: '#aaf', intensity: 0 }, isDaylight: true };

        // Neutral base color (mid-grey) to allow lightmap multiplication to work
        let r = 70, g = 70, b = 75;

        // Apply sunlight/moonlight 'reflection' to base ground color
        if (isDaylight && sun.active) {
            const sCol = sun.color.match(/\d+/g)?.map(Number) || [255, 255, 255];
            r = Math.min(255, r + sCol[0] * sun.intensity * 0.2);
            g = Math.min(255, g + sCol[1] * sun.intensity * 0.2);
            b = Math.min(255, b + sCol[2] * sun.intensity * 0.2);
        } else if (moon.active) {
            const mCol = moon.color.match(/#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i);
            if (mCol) {
                r = Math.min(255, r + parseInt(mCol[1], 16) * moon.intensity * 0.3);
                g = Math.min(255, g + parseInt(mCol[2], 16) * moon.intensity * 0.3);
                b = Math.min(255, b + parseInt(mCol[3], 16) * moon.intensity * 0.3);
            }
        }

        if (currentSnow > 0) {
            r = Math.floor(r + (200 - r) * currentSnow);
            g = Math.floor(g + (210 - g) * currentSnow);
            b = Math.floor(b + (230 - b) * currentSnow);
        }

        const worldW = this.world.getWidthPixels();
        const worldH = this.world.getHeightPixels();

        ctx.fillStyle = `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;

        // Fill ground color only within world bounds
        const drawX = Math.max(cameraX, 0);
        const drawY = Math.max(cameraY, 0);
        const drawW = Math.min(cameraX + viewWidth, worldW) - drawX;
        const drawH = Math.min(cameraY + viewHeight, worldH) - drawY;

        if (drawW > 0 && drawH > 0) {
            ctx.fillRect(drawX, drawY, drawW, drawH);
        }

        // Grid (Local view) - Also clamp to world bounds
        ctx.beginPath();
        ctx.strokeStyle = currentSnow > 0.5 ? 'rgba(255,255,255,0.1)' : '#222222';
        ctx.lineWidth = 1;

        const startX = Math.max(Math.floor(cameraX / this.tileSize) * this.tileSize, 0);
        const endX = Math.min(cameraX + viewWidth, worldW);
        const startY = Math.max(Math.floor(cameraY / this.tileSize) * this.tileSize, 0);
        const endY = Math.min(cameraY + viewHeight, worldH);

        for (let x = startX; x <= endX; x += this.tileSize) {
            ctx.moveTo(x, drawY);
            ctx.lineTo(x, drawY + drawH);
        }
        for (let y = startY; y <= endY; y += this.tileSize) {
            ctx.moveTo(drawX, y);
            ctx.lineTo(drawX + drawW, y);
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

    private renderWallTop(ctx: CanvasRenderingContext2D, tx: number, ty: number, v0: any, v1: any, v2: any, v3: any, material: MaterialType, topColorBase: string): void {
        const heatMap = this.world.getHeatMap();
        const hpData = heatMap ? heatMap.getTileHP(tx, ty) : null;
        const heatData = heatMap ? heatMap.getTileHeat(tx, ty) : null;
        const sData = heatMap ? heatMap.getTileScorch(tx, ty) : null;
        const snow = WeatherManager.getInstance().getSnowAccumulation();

        const isDamaged = heatMap?.hasTileData(tx, ty) && hpData;

        // --- TOP SHADING (Hybrid GPU/CPU Sync) ---
        const clock = (window as any).WorldClockInstance || WorldClock.getInstance();
        const timeState = clock.getTimeState();
        const { sun, moon, baseAmbient } = timeState;

        // Parse Base Ambient
        const amb = baseAmbient.match(/\d+/g)?.map(Number) || [30, 30, 30];
        const ambR = amb[0] / 255; const ambG = amb[1] / 255; const ambB = amb[2] / 255;

        // Parse Wall Base Color
        const wallBase = this.hexToRgb(topColorBase);

        // Final Lighting Components
        let rAcc = 0, gAcc = 0, bAcc = 0;

        // 1. Ambient Baseline
        rAcc = wallBase.r * ambR;
        gAcc = wallBase.g * ambG;
        bAcc = wallBase.b * ambB;

        // 2. Direct Light (Sun/Moon)
        const activeLight = sun.active ? sun : (moon.active ? moon : null);
        if (activeLight) {
            const lCol = activeLight.color.startsWith('#') ? this.hexToRgb(activeLight.color) : { r: 255, g: 255, b: 255 };
            const lR = lCol.r / 255; const lG = lCol.g / 255; const lB = lCol.b / 255;

            // Roof faces UP. Light impact depends on verticality.
            // We simulate this with intensity and a zenith boost.
            let intensity = activeLight.intensity * 0.7;
            if (!sun.active) intensity *= 0.6; // Moonlight is softer

            rAcc += wallBase.r * lR * intensity;
            gAcc += wallBase.g * lG * intensity;
            bAcc += wallBase.b * lB * intensity;
        }

        const shadedTopColor = `rgb(${Math.min(255, Math.floor(rAcc))}, ${Math.min(255, Math.floor(gAcc))}, ${Math.min(255, Math.floor(bAcc))})`;

        if (!isDamaged) {
            ctx.fillStyle = shadedTopColor;
            ctx.beginPath();
            ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y); ctx.lineTo(v3.x, v3.y);
            ctx.fill();

            if (snow > 0.1) {
                ctx.fillStyle = `rgba(240, 245, 255, ${snow})`;
                ctx.fill();
            }
            return;
        }

        const data = this.getDamagedTileData(tx, ty, hpData!);

        // SEAMLESS TOP FACE: Draw solid wall minus holes using Even-Odd rule
        ctx.fillStyle = shadedTopColor;
        ctx.beginPath();
        // 1. Outer boundary
        ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y); ctx.lineTo(v3.x, v3.y);
        ctx.closePath();

        const subDiv = 10;
        data.holeIndices.forEach(idx => {
            const sx = idx % subDiv;
            const sy = Math.floor(idx / subDiv);
            const fsx0 = sx / subDiv; const fsx1 = (sx + 1) / subDiv;
            const fsy0 = sy / subDiv; const fsy1 = (sy + 1) / subDiv;
            const p0 = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy0);
            const p1 = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy0);
            const p2 = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy1);
            const p3 = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy1);
            ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
            ctx.closePath();
        });
        ctx.fill('evenodd');

        // Draw overlays (scorching, heat, snow) segmented as before since they are transparent
        data.solidIndices.forEach(idx => {
            const sx = idx % subDiv;
            const sy = Math.floor(idx / subDiv);
            const fsx0 = sx / subDiv; const fsx1 = (sx + 1) / subDiv;
            const fsy0 = sy / subDiv; const fsy1 = (sy + 1) / subDiv;

            const p0 = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy0);
            const p1 = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy0);
            const p2 = this.lerpQuad(v0, v1, v2, v3, fsx1, fsy1);
            const p3 = this.lerpQuad(v0, v1, v2, v3, fsx0, fsy1);

            if (sData && sData[idx]) {
                ctx.fillStyle = material === MaterialType.WOOD ? 'rgba(28, 28, 28, 0.8)' : 'rgba(0,0,0,0.5)';
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.fill();
            }

            if (heatData && heatData[idx] > 0.05) {
                const heat = heatData[idx];
                const { r, g, b } = HeatMap.getHeatColorComponents(heat);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.2 + heat * 0.4})`;
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.fill();
            }

            if (snow > 0.1) {
                const tileHeat = heatData && heatData[idx] ? heatData[idx] : 0;
                if (tileHeat < 0.3) {
                    const removalData = WeatherManager.getInstance().getTileSnowRemoval(tx, ty);
                    const snowFactor = removalData ? removalData[idx] : 1.0;
                    if (snowFactor > 0.01) {
                        ctx.fillStyle = `rgba(240, 245, 255, ${snow * snowFactor})`;
                        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.fill();
                    }
                }
            }
        });
    }

    private lerpQuad(v0: any, v1: any, v2: any, v3: any, x: number, y: number) {
        // Bilinear interpolation between 4 points
        const topX = v0.x + (v1.x - v0.x) * x;
        const topY = v0.y + (v1.y - v0.y) * x;
        const botX = v3.x + (v2.x - v3.x) * x;
        const botY = v3.y + (v2.y - v3.y) * x;

        return {
            x: topX + (botX - topX) * y,
            y: topY + (botY - topY) * y
        };
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
        this.damagedTileCache.clear();
    }
}