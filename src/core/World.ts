import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from './HeatMap';
import { PhysicsSystem } from './ecs/systems/PhysicsSystem';

export class World {
    private width: number;
    private height: number;
    private tileSize: number;
    private tiles: MaterialType[][]; // Material of the tile
    private heatMapRef: any = null;

    private seed: number;
    private rngState: number;

    // Optimized Shadow Geometry - Incremental Updates
    private cachedSegments: { a: { x: number, y: number }, b: { x: number, y: number } }[] = [];
    private spatialGrid: Map<string, { a: { x: number, y: number }, b: { x: number, y: number } }[]> = new Map();
    private gridCellSize: number = 256;
    private meshVersion: number = 0;

    // Incremental rebuild tracking
    private dirtyTiles: Set<string> = new Set();
    private tileSegments: Map<string, { a: { x: number, y: number }, b: { x: number, y: number } }[]> = new Map();
    private needsFullRebuild: boolean = true;

    private sharedTiles: Uint8Array | null = null;
    private onTileChangeCallbacks: ((tx: number, ty: number) => void)[] = [];

    constructor(seed?: number) {
        this.width = ConfigManager.getInstance().get('World', 'width');
        this.height = ConfigManager.getInstance().get('World', 'height');
        this.tileSize = ConfigManager.getInstance().get('World', 'tileSize');
        this.tiles = [];

        // Init Seed
        this.seed = seed !== undefined ? seed : Date.now();
        this.rngState = this.seed;
        console.log(`World initialized with Seed: ${this.seed}`);

        this.generate();
    }

    public getWidth(): number { return this.width; }
    public getHeight(): number { return this.height; }
    public getTileSize(): number { return this.tileSize; }
    public getTile(x: number, y: number): MaterialType {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return MaterialType.NONE;
        return this.tiles[y][x];
    }
    public setTile(x: number, y: number, mat: MaterialType): void {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.tiles[y][x] = mat;
            this.markMeshDirty(x, y);
        }
    }
    public getHeatMap(): any { return this.heatMapRef; }

    public onTileChange(cb: (tx: number, ty: number) => void): void {
        this.onTileChangeCallbacks.push(cb);
    }

    public notifyTileChange(tx: number, ty: number): void {
        this.onTileChangeCallbacks.forEach(cb => cb(tx, ty));
    }

    private seededRandom(): number {
        const a = 1664525;
        const c = 1013904223;
        const m = 4294967296;
        this.rngState = (a * this.rngState + c) % m;
        return this.rngState / m;
    }

    public setHeatMap(hm: any): void {
        this.heatMapRef = hm;
        this.heatMapRef.setWorldRef(this);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] !== MaterialType.NONE) {
                    this.heatMapRef.setMaterial(x, y, this.tiles[y][x]);
                }
            }
        }
    }

    public markMeshDirty(tx?: number, ty?: number): void {
        this.meshVersion++;
        if (tx !== undefined && ty !== undefined) {
            // Targeted tile update - mark only affected tiles
            this.dirtyTiles.add(`${tx},${ty}`);
            // Also mark neighbors as dirty (edge changes affect adjacent tiles)
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const ntx = tx + dx, nty = ty + dy;
                if (ntx >= 0 && ntx < this.width && nty >= 0 && nty < this.height) {
                    this.dirtyTiles.add(`${ntx},${nty}`);
                }
            }
            // Incremental sync - only the affected tile
            this.synchronizeSharedBufferTile(tx, ty);
        } else {
            // Full rebuild requested (e.g., initial load or major world change)
            this.needsFullRebuild = true;
            this.synchronizeSharedBuffer();
        }
    }

    public checkTileDestruction(tx: number, ty: number): void {
        if (this.heatMapRef && this.heatMapRef.isTileMostlyDestroyed(tx, ty)) {
            this.tiles[ty][tx] = MaterialType.NONE;
            this.markMeshDirty(tx, ty);
        }
    }

    public getMeshVersion(): number {
        return this.meshVersion;
    }

    public getDirtyTilesForGPU(): Set<string> {
        // Return a copy of dirty tiles for GPU renderer use
        // This is called before getOcclusionSegments clears the set
        return new Set(this.dirtyTiles);
    }

    public needsFullMeshRebuild(): boolean {
        return this.needsFullRebuild;
    }

    public getTilesSharedBuffer(): SharedArrayBuffer {
        if (!this.sharedTiles) {
            const size = this.width * this.height;
            let buffer: any;
            try {
                buffer = new (window.SharedArrayBuffer || ArrayBuffer)(size);
            } catch (e) {
                buffer = new ArrayBuffer(size);
            }
            this.sharedTiles = new Uint8Array(buffer);
            this.synchronizeSharedBuffer();
        }
        return this.sharedTiles.buffer as SharedArrayBuffer;
    }

    public synchronizeSharedBuffer(): void {
        if (!this.sharedTiles) return;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.sharedTiles[y * this.width + x] = this.tiles[y][x];
            }
        }
    }

    private synchronizeSharedBufferTile(tx: number, ty: number): void {
        if (!this.sharedTiles) return;
        if (tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
            this.sharedTiles[ty * this.width + tx] = this.tiles[ty][tx];
        }
    }

    private generate(): void {
        const materials = [MaterialType.WOOD, MaterialType.BRICK, MaterialType.STONE, MaterialType.METAL];

        for (let y = 0; y < this.height; y++) {
            const row: MaterialType[] = [];
            for (let x = 0; x < this.width; x++) {
                if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
                    row.push(MaterialType.INDESTRUCTIBLE);
                } else {
                    if (this.seededRandom() < 0.05) {
                        const mat = materials[Math.floor(this.seededRandom() * materials.length)];
                        row.push(mat);
                    } else {
                        row.push(MaterialType.NONE);
                    }
                }
            }
            this.tiles.push(row);
        }
    }

    public getWidthPixels(): number {
        return this.width * this.tileSize;
    }

    public getHeightPixels(): number {
        return this.height * this.tileSize;
    }

    public checkWallCollision(x: number, y: number, radius: number): { x: number, y: number } | null {
        // Delegate to the Single Source of Truth in PhysicsSystem
        const result = PhysicsSystem.checkCircleVsTile(this, x, y, radius);

        // Adaptation: PhysicsSystem corrects position. 
        // checkWallCollision expects to return the NEW position (conceptually "the point of collision resolved") 
        // OR null if no collision.

        if (result.hit) {
            return { x: result.x, y: result.y };
        }
        return null;
    }

    public isWall(x: number, y: number): boolean {
        const gx = Math.floor(x / this.tileSize);
        const gy = Math.floor(y / this.tileSize);
        if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return true;
        if (this.tiles[gy][gx] === MaterialType.NONE) return false;
        if (this.heatMapRef && this.heatMapRef.isSubTileDestroyed(x, y)) return false;
        return true;
    }

    public isWallByTile(tx: number, ty: number): boolean {
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return true;
        return this.tiles[ty][tx] !== MaterialType.NONE;
    }

    public raycast(startX: number, startY: number, angle: number, maxDist: number): { x: number, y: number } | null {
        const step = 2;
        const dx = Math.cos(angle) * step;
        const dy = Math.sin(angle) * step;

        let curX = startX;
        let curY = startY;
        let dist = 0;

        while (dist < maxDist) {
            curX += dx;
            curY += dy;
            dist += step;

            if (this.isWall(curX, curY)) {
                return { x: curX, y: curY };
            }

            if (curX < 0 || curX > this.getWidthPixels() || curY < 0 || curY > this.getHeightPixels()) {
                return { x: curX, y: curY };
            }
        }

        return null;
    }

    private rebuildMesh(): void {
        // Full rebuild - populate all tile segments
        this.tileSegments.clear();
        this.spatialGrid.clear();

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const segs = this.buildTileSegments(x, y);
                if (segs.length > 0) {
                    this.tileSegments.set(`${x},${y}`, segs);
                }
            }
        }

        this.rebuildSpatialGrid();
        this.needsFullRebuild = false;
        this.dirtyTiles.clear();
    }

    private updateDirtyTiles(): void {
        // Incremental update - only process dirty tiles
        if (this.dirtyTiles.size === 0) return;

        this.dirtyTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            // Remove old segments from spatial grid
            const oldSegs = this.tileSegments.get(key);
            if (oldSegs) {
                this.removeSegmentsFromGrid(oldSegs);
            }
            // Build new segments for this tile
            const newSegs = this.buildTileSegments(tx, ty);
            if (newSegs.length > 0) {
                this.tileSegments.set(key, newSegs);
                this.addSegmentsToGrid(newSegs);
            } else {
                this.tileSegments.delete(key);
            }
        });

        this.dirtyTiles.clear();
    }

    private buildTileSegments(tx: number, ty: number): { a: { x: number, y: number }, b: { x: number, y: number } }[] {
        const segs: { a: { x: number, y: number }, b: { x: number, y: number } }[] = [];
        const ts = this.tileSize;

        if (this.tiles[ty][tx] === MaterialType.NONE) return segs;

        const hasDamageData = this.heatMapRef && this.heatMapRef.hasTileData(tx, ty);
        const hData = hasDamageData ? this.heatMapRef.getTileHP(tx, ty) : null;
        const wx = tx * ts;
        const wy = ty * ts;

        if (!hData) {
            // Healthy tile - generate simple edge segments
            const hasTileAbove = ty > 0 && this.tiles[ty - 1][tx] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(tx, ty - 1));
            const hasTileBelow = ty < this.height - 1 && this.tiles[ty + 1][tx] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(tx, ty + 1));
            const hasTileLeft = tx > 0 && this.tiles[ty][tx - 1] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(tx - 1, ty));
            const hasTileRight = tx < this.width - 1 && this.tiles[ty][tx + 1] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(tx + 1, ty));

            if (!hasTileAbove) segs.push({ a: { x: wx, y: wy }, b: { x: wx + ts, y: wy } });
            if (!hasTileBelow) segs.push({ a: { x: wx, y: wy + ts }, b: { x: wx + ts, y: wy + ts } });
            if (!hasTileLeft) segs.push({ a: { x: wx, y: wy }, b: { x: wx, y: wy + ts } });
            if (!hasTileRight) segs.push({ a: { x: wx + ts, y: wy }, b: { x: wx + ts, y: wy + ts } });
        } else {
            // Damaged tile - generate sub-cell edge segments
            const subDiv = 10;
            const ss = ts / subDiv;

            // Horizontal edges within tile
            for (let sy = 0; sy <= subDiv; sy++) {
                let startX: number | null = null;
                for (let sx = 0; sx < subDiv; sx++) {
                    const idx = sy * subDiv + sx;
                    const idxAbove = (sy - 1) * subDiv + sx;
                    const needsEdge = (sy === 0 && hData[idx] > 0) ||
                        (sy === subDiv && hData[idxAbove] > 0) ||
                        (sy > 0 && sy < subDiv && (hData[idx] > 0) !== (hData[idxAbove] > 0));
                    if (needsEdge) { if (startX === null) startX = sx; }
                    else if (startX !== null) {
                        segs.push({ a: { x: wx + startX * ss, y: wy + sy * ss }, b: { x: wx + sx * ss, y: wy + sy * ss } });
                        startX = null;
                    }
                }
                if (startX !== null) segs.push({ a: { x: wx + startX * ss, y: wy + sy * ss }, b: { x: wx + ts, y: wy + sy * ss } });
            }

            // Vertical edges within tile
            for (let sx = 0; sx <= subDiv; sx++) {
                let startY: number | null = null;
                for (let sy = 0; sy < subDiv; sy++) {
                    const idx = sy * subDiv + sx;
                    const idxLeft = sy * subDiv + (sx - 1);
                    const needsEdge = (sx === 0 && hData[idx] > 0) ||
                        (sx === subDiv && hData[idxLeft] > 0) ||
                        (sx > 0 && sx < subDiv && (hData[idx] > 0) !== (hData[idxLeft] > 0));
                    if (needsEdge) { if (startY === null) startY = sy; }
                    else if (startY !== null) {
                        segs.push({ a: { x: wx + sx * ss, y: wy + startY * ss }, b: { x: wx + sx * ss, y: wy + sy * ss } });
                        startY = null;
                    }
                }
                if (startY !== null) segs.push({ a: { x: wx + sx * ss, y: wy + startY * ss }, b: { x: wx + sx * ss, y: wy + ts } });
            }
        }

        return segs;
    }

    private removeSegmentsFromGrid(segs: { a: { x: number, y: number }, b: { x: number, y: number } }[]): void {
        segs.forEach(seg => {
            const gx1 = Math.floor(Math.min(seg.a.x, seg.b.x) / this.gridCellSize);
            const gy1 = Math.floor(Math.min(seg.a.y, seg.b.y) / this.gridCellSize);
            const gx2 = Math.floor(Math.max(seg.a.x, seg.b.x) / this.gridCellSize);
            const gy2 = Math.floor(Math.max(seg.a.y, seg.b.y) / this.gridCellSize);

            for (let gy = gy1; gy <= gy2; gy++) {
                for (let gx = gx1; gx <= gx2; gx++) {
                    const key = `${gx},${gy}`;
                    const cell = this.spatialGrid.get(key);
                    if (cell) {
                        const idx = cell.indexOf(seg);
                        if (idx !== -1) cell.splice(idx, 1);
                    }
                }
            }
        });
    }

    private addSegmentsToGrid(segs: { a: { x: number, y: number }, b: { x: number, y: number } }[]): void {
        segs.forEach(seg => {
            const gx1 = Math.floor(Math.min(seg.a.x, seg.b.x) / this.gridCellSize);
            const gy1 = Math.floor(Math.min(seg.a.y, seg.b.y) / this.gridCellSize);
            const gx2 = Math.floor(Math.max(seg.a.x, seg.b.x) / this.gridCellSize);
            const gy2 = Math.floor(Math.max(seg.a.y, seg.b.y) / this.gridCellSize);

            for (let gy = gy1; gy <= gy2; gy++) {
                for (let gx = gx1; gx <= gx2; gx++) {
                    const key = `${gx},${gy}`;
                    if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
                    this.spatialGrid.get(key)!.push(seg);
                }
            }
        });
    }

    private rebuildSpatialGrid(): void {
        this.spatialGrid.clear();
        this.tileSegments.forEach(segs => {
            this.addSegmentsToGrid(segs);
        });
    }

    public getOcclusionSegments(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): { a: { x: number, y: number }, b: { x: number, y: number } }[] {
        // Handle full rebuild or incremental update
        if (this.needsFullRebuild) {
            this.rebuildMesh();
        } else if (this.dirtyTiles.size > 0) {
            this.updateDirtyTiles();
        }

        const gx1 = Math.floor((cameraX - 64) / this.gridCellSize);
        const gy1 = Math.floor((cameraY - 64) / this.gridCellSize);
        const gx2 = Math.floor((cameraX + viewWidth + 64) / this.gridCellSize);
        const gy2 = Math.floor((cameraY + viewHeight + 64) / this.gridCellSize);

        const result: Set<{ a: { x: number, y: number }, b: { x: number, y: number } }> = new Set();
        for (let gy = gy1; gy <= gy2; gy++) {
            for (let gx = gx1; gx <= gx2; gx++) {
                const cell = this.spatialGrid.get(`${gx},${gy}`);
                if (cell) cell.forEach(s => result.add(s));
            }
        }
        return Array.from(result);
    }
}