import { World } from "../../World";
import { MaterialType } from "../../HeatMap";
import { ConfigManager } from "../../../config/MasterConfig";

// Maximum vertices per tile:
// - Healthy tile: 4 sides × 6 vertices = 24 vertices max
// - Damaged tile: 10×10 sub-tiles × 4 sides × 6 vertices = 2400 vertices max
// We'll use a conservative max to balance memory vs flexibility
const MAX_VERTICES_PER_TILE = 2400;
const VERTICES_PER_QUAD = 6;

interface TileSlot {
    offset: number;      // Start index in the main buffer
    vertexCount: number; // Actual vertices used (rest are degenerate)
}

export class WallMeshBuilder {
    private positions: Float32Array = new Float32Array(0);
    private uvs: Float32Array = new Float32Array(0);
    private materials: Float32Array = new Float32Array(0);
    private normals: Float32Array = new Float32Array(0);

    private totalVertexCapacity: number = 0;
    private activeVertexCount: number = 0;

    private readonly subDiv = 10;
    private wallHeight: number = -32;

    // Tile slot management - each tile gets a fixed slot
    private tileSlots: Map<string, TileSlot> = new Map();
    private nextSlotOffset: number = 0;
    private freeSlots: number[] = []; // Recycled slot offsets

    private dirtyTiles: Set<string> = new Set();
    private needsFullRebuild: boolean = true;
    private worldWidth: number = 0;
    private worldHeight: number = 0;

    // Track if GPU buffers need update
    private pendingBufferUpdates: { offset: number, count: number }[] = [];

    constructor() {
        this.updateConfig();
    }

    public updateConfig(): void {
        this.wallHeight = -ConfigManager.getInstance().get<number>('World', 'wallHeight');
    }

    public markTilesDirty(tiles: Set<string>): void {
        tiles.forEach(t => this.dirtyTiles.add(t));
    }

    public build(world: World): boolean {
        if (this.needsFullRebuild || this.positions.length === 0) {
            this.fullRebuild(world);
            this.needsFullRebuild = false;
            return true;
        } else if (this.dirtyTiles.size > 0) {
            return this.incrementalUpdate(world);
        }
        return false;
    }

    private fullRebuild(world: World): void {
        this.updateConfig();
        this.worldWidth = world.getWidth();
        this.worldHeight = world.getHeight();

        // Count wall tiles
        let wallTileCount = 0;
        for (let ty = 0; ty < this.worldHeight; ty++) {
            for (let tx = 0; tx < this.worldWidth; tx++) {
                if (world.getTile(tx, ty) !== MaterialType.NONE) {
                    wallTileCount++;
                }
            }
        }

        // Pre-allocate buffers with some headroom
        this.totalVertexCapacity = Math.max(wallTileCount * MAX_VERTICES_PER_TILE, 100000);
        this.positions = new Float32Array(this.totalVertexCapacity * 3);
        this.uvs = new Float32Array(this.totalVertexCapacity * 2);
        this.materials = new Float32Array(this.totalVertexCapacity);
        this.normals = new Float32Array(this.totalVertexCapacity * 2);

        this.tileSlots.clear();
        this.freeSlots = [];
        this.nextSlotOffset = 0;
        this.activeVertexCount = 0;

        // Build all tiles
        for (let ty = 0; ty < this.worldHeight; ty++) {
            for (let tx = 0; tx < this.worldWidth; tx++) {
                if (world.getTile(tx, ty) !== MaterialType.NONE) {
                    this.buildTileIntoBuffer(world, tx, ty);
                }
            }
        }

        this.dirtyTiles.clear();
        this.pendingBufferUpdates = []; // Full rebuild = full upload
    }

    private incrementalUpdate(world: World): boolean {
        if (this.dirtyTiles.size === 0) return false;

        this.updateConfig();
        let hasChanges = false;

        this.dirtyTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            if (tx < 0 || tx >= this.worldWidth || ty < 0 || ty >= this.worldHeight) return;

            const material = world.getTile(tx, ty);
            const existingSlot = this.tileSlots.get(key);

            if (material === MaterialType.NONE) {
                // Tile destroyed - clear its slot
                if (existingSlot) {
                    this.clearSlot(existingSlot);
                    this.freeSlots.push(existingSlot.offset);
                    this.tileSlots.delete(key);
                    this.pendingBufferUpdates.push({ offset: existingSlot.offset, count: existingSlot.vertexCount });
                    hasChanges = true;
                }
            } else {
                // Tile exists - rebuild it
                this.buildTileIntoBuffer(world, tx, ty);
                hasChanges = true;
            }
        });

        this.dirtyTiles.clear();
        return hasChanges;
    }

    private buildTileIntoBuffer(world: World, tx: number, ty: number): void {
        const key = `${tx},${ty}`;
        const ts = world.getTileSize();
        const material = world.getTile(tx, ty);

        if (material === MaterialType.NONE) return;

        const heatMap = world.getHeatMap();
        const hpData = heatMap?.state?.hpData?.get(key);
        const isDamaged = hpData !== undefined;

        // Get or allocate slot
        let slot = this.tileSlots.get(key);
        if (!slot) {
            const offset = this.freeSlots.length > 0
                ? this.freeSlots.pop()!
                : this.nextSlotOffset;

            if (offset === this.nextSlotOffset) {
                this.nextSlotOffset += MAX_VERTICES_PER_TILE;
            }

            slot = { offset, vertexCount: 0 };
            this.tileSlots.set(key, slot);
        }

        // Clear previous data in slot
        const startIdx = slot.offset;
        for (let i = 0; i < MAX_VERTICES_PER_TILE * 3; i++) {
            this.positions[startIdx * 3 + i] = 0;
        }

        // Build geometry into slot
        let vertexIdx = startIdx;

        if (!isDamaged) {
            vertexIdx = this.buildHealthyTileAt(world, tx, ty, ts, material, vertexIdx);
        } else {
            vertexIdx = this.buildDamagedTileAt(world, tx, ty, ts, material, hpData, vertexIdx);
        }

        const vertexCount = vertexIdx - startIdx;
        slot.vertexCount = vertexCount;

        // Track buffer region that needs GPU update
        this.pendingBufferUpdates.push({ offset: startIdx, count: Math.max(vertexCount, slot.vertexCount) });

        // Update active vertex count
        this.recalculateActiveVertexCount();
    }

    private recalculateActiveVertexCount(): void {
        let maxUsedVertex = 0;
        this.tileSlots.forEach(slot => {
            const endVertex = slot.offset + slot.vertexCount;
            if (endVertex > maxUsedVertex) maxUsedVertex = endVertex;
        });
        this.activeVertexCount = maxUsedVertex;
    }

    private clearSlot(slot: TileSlot): void {
        const start = slot.offset * 3;
        const end = start + MAX_VERTICES_PER_TILE * 3;
        this.positions.fill(0, start, end);
    }

    private buildHealthyTileAt(world: World, tx: number, ty: number, ts: number, mat: number, v: number): number {
        const wx = tx * ts;
        const wy = ty * ts;
        const h = this.wallHeight;

        // Top Side
        if (world.getTile(tx, ty - 1) === MaterialType.NONE) {
            this.setQuad(v, wx, wy, 0, wx + ts, wy, 0, wx, wy, h, wx + ts, wy, h, 0, 0, 1, 0, mat, 0, -1);
            v += 6;
        }
        // Bottom Side
        if (world.getTile(tx, ty + 1) === MaterialType.NONE) {
            this.setQuad(v, wx, wy + ts, 0, wx + ts, wy + ts, 0, wx, wy + ts, h, wx + ts, wy + ts, h, 0, 1, 1, 1, mat, 0, 1);
            v += 6;
        }
        // Left Side
        if (world.getTile(tx - 1, ty) === MaterialType.NONE) {
            this.setQuad(v, wx, wy, 0, wx, wy + ts, 0, wx, wy, h, wx, wy + ts, h, 0, 0, 0, 1, mat, -1, 0);
            v += 6;
        }
        // Right Side
        if (world.getTile(tx + 1, ty) === MaterialType.NONE) {
            this.setQuad(v, wx + ts, wy, 0, wx + ts, wy + ts, 0, wx + ts, wy, h, wx + ts, wy + ts, h, 1, 0, 1, 1, mat, 1, 0);
            v += 6;
        }

        return v;
    }

    private buildDamagedTileAt(world: World, tx: number, ty: number, ts: number, mat: number, hpData: Float32Array, v: number): number {
        const wx = tx * ts;
        const wy = ty * ts;
        const h = this.wallHeight;
        const subTs = ts / this.subDiv;

        for (let sy = 0; sy < this.subDiv; sy++) {
            for (let sx = 0; sx < this.subDiv; sx++) {
                const idx = sy * this.subDiv + sx;
                if (hpData[idx] <= 0) continue;

                const swx = wx + sx * subTs;
                const swy = wy + sy * subTs;
                const suvX0 = sx / this.subDiv;
                const suvY0 = sy / this.subDiv;
                const suvX1 = (sx + 1) / this.subDiv;
                const suvY1 = (sy + 1) / this.subDiv;

                // Top
                let hasTop = sy > 0 ? hpData[(sy - 1) * this.subDiv + sx] > 0 : world.getTile(tx, ty - 1) !== MaterialType.NONE;
                if (!hasTop) {
                    this.setQuad(v, swx, swy, 0, swx + subTs, swy, 0, swx, swy, h, swx + subTs, swy, h, suvX0, suvY0, suvX1, suvY0, mat, 0, -1);
                    v += 6;
                }

                // Bottom
                let hasBottom = sy < this.subDiv - 1 ? hpData[(sy + 1) * this.subDiv + sx] > 0 : world.getTile(tx, ty + 1) !== MaterialType.NONE;
                if (!hasBottom) {
                    this.setQuad(v, swx, swy + subTs, 0, swx + subTs, swy + subTs, 0, swx, swy + subTs, h, swx + subTs, swy + subTs, h, suvX0, suvY1, suvX1, suvY1, mat, 0, 1);
                    v += 6;
                }

                // Left
                let hasLeft = sx > 0 ? hpData[sy * this.subDiv + (sx - 1)] > 0 : world.getTile(tx - 1, ty) !== MaterialType.NONE;
                if (!hasLeft) {
                    this.setQuad(v, swx, swy, 0, swx, swy + subTs, 0, swx, swy, h, swx, swy + subTs, h, suvX0, suvY0, suvX0, suvY1, mat, -1, 0);
                    v += 6;
                }

                // Right
                let hasRight = sx < this.subDiv - 1 ? hpData[sy * this.subDiv + (sx + 1)] > 0 : world.getTile(tx + 1, ty) !== MaterialType.NONE;
                if (!hasRight) {
                    this.setQuad(v, swx + subTs, swy, 0, swx + subTs, swy + subTs, 0, swx + subTs, swy, h, swx + subTs, swy + subTs, h, suvX1, suvY0, suvX1, suvY1, mat, 1, 0);
                    v += 6;
                }
            }
        }

        return v;
    }

    private setQuad(v: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number, u0: number, v0: number, u1: number, v1: number, mat: number, nx: number, ny: number): void {
        // Tri 1
        this.setVertex(v + 0, x0, y0, z0, u0, v0, mat, nx, ny);
        this.setVertex(v + 1, x1, y1, z1, u1, v0, mat, nx, ny);
        this.setVertex(v + 2, x2, y2, z2, u0, v1, mat, nx, ny);
        // Tri 2
        this.setVertex(v + 3, x2, y2, z2, u0, v1, mat, nx, ny);
        this.setVertex(v + 4, x1, y1, z1, u1, v0, mat, nx, ny);
        this.setVertex(v + 5, x3, y3, z3, u1, v1, mat, nx, ny);
    }

    private setVertex(idx: number, x: number, y: number, z: number, u: number, v: number, m: number, nx: number, ny: number): void {
        this.positions[idx * 3 + 0] = x;
        this.positions[idx * 3 + 1] = y;
        this.positions[idx * 3 + 2] = z;
        this.uvs[idx * 2 + 0] = u;
        this.uvs[idx * 2 + 1] = v;
        this.materials[idx] = m;
        this.normals[idx * 2 + 0] = nx;
        this.normals[idx * 2 + 1] = ny;
    }

    public getPositions(): Float32Array { return this.positions; }
    public getUVs(): Float32Array { return this.uvs; }
    public getMaterials(): Float32Array { return this.materials; }
    public getNormals(): Float32Array { return this.normals; }
    public getPendingUpdates(): { offset: number, count: number }[] {
        const updates = this.pendingBufferUpdates;
        this.pendingBufferUpdates = [];
        return updates;
    }
    public reset(): void {
        this.needsFullRebuild = true;
        this.tileSlots.clear();
        this.freeSlots = [];
        this.nextSlotOffset = 0;
        this.activeVertexCount = 0;
        this.dirtyTiles.clear();
    }
    public getVertexCount(): number { return this.activeVertexCount; }
}
