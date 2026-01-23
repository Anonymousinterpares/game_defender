import { World } from "../../World";
import { MaterialType } from "../../HeatMap";

export class WallMeshBuilder {
    private positions: Float32Array = new Float32Array(0);
    private uvs: Float32Array = new Float32Array(0);
    private materials: Float32Array = new Float32Array(0);
    private normals: Float32Array = new Float32Array(0);
    private vertexCount: number = 0;

    private readonly subDiv = 10;
    private wallHeight: number = -32; // Default, will be updated from config if possible

    constructor() { }

    public build(world: World): void {
        const width = world.getWidth();
        const height = world.getHeight();
        const ts = world.getTileSize();
        const heatMap = world.getHeatMap();

        // Estimation: 1000 tiles * 30 vertices/tile = 30k vertices. 
        // We use a large buffer and slice it.
        const posBuffer = new Float32Array(width * height * 300 * 3);
        const uvBuffer = new Float32Array(width * height * 300 * 2);
        const matBuffer = new Float32Array(width * height * 300);
        const normBuffer = new Float32Array(width * height * 300 * 2);

        let vIdx = 0;

        for (let ty = 0; ty < height; ty++) {
            for (let tx = 0; tx < width; tx++) {
                const material = world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;

                const hpData = heatMap?.state.hpData.get(`${tx},${ty}`);
                const isDamaged = hpData !== undefined;

                if (!isDamaged) {
                    this.buildHealthyTile(world, tx, ty, ts, material, posBuffer, uvBuffer, matBuffer, normBuffer, vIdx);
                    vIdx += 30; // Max vertices for healthy (Top + 4 Sides)
                } else {
                    vIdx = this.buildDamagedTile(world, tx, ty, ts, material, hpData, posBuffer, uvBuffer, matBuffer, normBuffer, vIdx);
                }
            }
        }

        this.positions = posBuffer.slice(0, vIdx * 3);
        this.uvs = uvBuffer.slice(0, vIdx * 2);
        this.materials = matBuffer.slice(0, vIdx);
        this.normals = normBuffer.slice(0, vIdx * 2);
        this.vertexCount = vIdx;
    }

    private buildHealthyTile(world: World, tx: number, ty: number, ts: number, mat: number, pos: Float32Array, uv: Float32Array, mBuf: Float32Array, norm: Float32Array, startIdx: number): void {
        const wx = tx * ts;
        const wy = ty * ts;
        const h = this.wallHeight;
        let v = startIdx;

        // 1. TOP FACE (Z = wallHeight)
        this.addQuad(pos, uv, mBuf, norm, v, wx, wy, h, wx + ts, wy, h, wx, wy + ts, h, wx + ts, wy + ts, h, 0, 0, 1, 1, mat, 0, 0);
        v += 6;

        // 2. SIDES (Only if neighbor is NONE)
        // Top Side (Facing Up/North: normal [0, -1])
        if (world.getTile(tx, ty - 1) === MaterialType.NONE) {
            this.addQuad(pos, uv, mBuf, norm, v, wx, wy, 0, wx + ts, wy, 0, wx, wy, h, wx + ts, wy, h, 0, 0, 1, 0, mat, 0, -1);
            v += 6;
        }
        // Bottom Side (Facing Down/South: normal [0, 1])
        if (world.getTile(tx, ty + 1) === MaterialType.NONE) {
            this.addQuad(pos, uv, mBuf, norm, v, wx, wy + ts, 0, wx + ts, wy + ts, 0, wx, wy + ts, h, wx + ts, wy + ts, h, 0, 1, 1, 1, mat, 0, 1);
            v += 6;
        }
        // Left Side (Facing Left/West: normal [-1, 0])
        if (world.getTile(tx - 1, ty) === MaterialType.NONE) {
            this.addQuad(pos, uv, mBuf, norm, v, wx, wy, 0, wx, wy + ts, 0, wx, wy, h, wx, wy + ts, h, 0, 0, 0, 1, mat, -1, 0);
            v += 6;
        }
        // Right Side (Facing Right/East: normal [1, 0])
        if (world.getTile(tx + 1, ty) === MaterialType.NONE) {
            this.addQuad(pos, uv, mBuf, norm, v, wx + ts, wy, 0, wx + ts, wy + ts, 0, wx + ts, wy, h, wx + ts, wy + ts, h, 1, 0, 1, 1, mat, 1, 0);
            v += 6;
        }
    }

    private buildDamagedTile(world: World, tx: number, ty: number, ts: number, mat: number, hpData: Float32Array, pos: Float32Array, uv: Float32Array, mBuf: Float32Array, norm: Float32Array, startIdx: number): number {
        const wx = tx * ts;
        const wy = ty * ts;
        const h = this.wallHeight;
        const subTs = ts / this.subDiv;
        let v = startIdx;

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

                // 1. Sub-Tile TOP FACE
                this.addQuad(pos, uv, mBuf, norm, v, swx, swy, h, swx + subTs, swy, h, swx, swy + subTs, h, swx + subTs, swy + subTs, h, suvX0, suvY0, suvX1, suvY1, mat, 0, 0);
                v += 6;

                // 2. Sub-Tile SIDES
                // Top
                let hasTop = false;
                if (sy > 0) hasTop = hpData[(sy - 1) * this.subDiv + sx] > 0;
                else hasTop = world.getTile(tx, ty - 1) !== MaterialType.NONE;
                if (!hasTop) {
                    this.addQuad(pos, uv, mBuf, norm, v, swx, swy, 0, swx + subTs, swy, 0, swx, swy, h, swx + subTs, swy, h, suvX0, suvY0, suvX1, suvY0, mat, 0, -1);
                    v += 6;
                }

                // Bottom
                let hasBottom = false;
                if (sy < this.subDiv - 1) hasBottom = hpData[(sy + 1) * this.subDiv + sx] > 0;
                else hasBottom = world.getTile(tx, ty + 1) !== MaterialType.NONE;
                if (!hasBottom) {
                    this.addQuad(pos, uv, mBuf, norm, v, swx, swy + subTs, 0, swx + subTs, swy + subTs, 0, swx, swy + subTs, h, swx + subTs, swy + subTs, h, suvX0, suvY1, suvX1, suvY1, mat, 0, 1);
                    v += 6;
                }

                // Left
                let hasLeft = false;
                if (sx > 0) hasLeft = hpData[sy * this.subDiv + (sx - 1)] > 0;
                else hasLeft = world.getTile(tx - 1, ty) !== MaterialType.NONE;
                if (!hasLeft) {
                    this.addQuad(pos, uv, mBuf, norm, v, swx, swy, 0, swx, swy + subTs, 0, swx, swy, h, swx, swy + subTs, h, suvX0, suvY0, suvX0, suvY1, mat, -1, 0);
                    v += 6;
                }

                // Right
                let hasRight = false;
                if (sx < this.subDiv - 1) hasRight = hpData[sy * this.subDiv + (sx + 1)] > 0;
                else hasRight = world.getTile(tx + 1, ty) !== MaterialType.NONE;
                if (!hasRight) {
                    this.addQuad(pos, uv, mBuf, norm, v, swx + subTs, swy, 0, swx + subTs, swy + subTs, 0, swx + subTs, swy, h, swx + subTs, swy + subTs, h, suvX1, suvY0, suvX1, suvY1, mat, 1, 0);
                    v += 6;
                }
            }
        }
        return v;
    }

    private addQuad(pos: Float32Array, uv: Float32Array, mBuf: Float32Array, norm: Float32Array, v: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number, u0: number, v0: number, u1: number, v1: number, mat: number, nx: number, ny: number) {
        // Tri 1
        this.setVertex(pos, uv, mBuf, norm, v + 0, x0, y0, z0, u0, v0, mat, nx, ny);
        this.setVertex(pos, uv, mBuf, norm, v + 1, x1, y1, z1, u1, v0, mat, nx, ny);
        this.setVertex(pos, uv, mBuf, norm, v + 2, x2, y2, z2, u0, v1, mat, nx, ny);
        // Tri 2
        this.setVertex(pos, uv, mBuf, norm, v + 3, x2, y2, z2, u0, v1, mat, nx, ny);
        this.setVertex(pos, uv, mBuf, norm, v + 4, x1, y1, z1, u1, v0, mat, nx, ny);
        this.setVertex(pos, uv, mBuf, norm, v + 5, x3, y3, z3, u1, v1, mat, nx, ny);
    }

    private setVertex(pos: Float32Array, uv: Float32Array, mBuf: Float32Array, norm: Float32Array, idx: number, x: number, y: number, z: number, u: number, v: number, m: number, nx: number, ny: number) {
        pos[idx * 3 + 0] = x;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = z;
        uv[idx * 2 + 0] = u;
        uv[idx * 2 + 1] = v;
        mBuf[idx] = m;
        norm[idx * 2 + 0] = nx;
        norm[idx * 2 + 1] = ny;
    }

    public getPositions(): Float32Array { return this.positions; }
    public getUVs(): Float32Array { return this.uvs; }
    public getMaterials(): Float32Array { return this.materials; }
    public getNormals(): Float32Array { return this.normals; }
    public getVertexCount(): number { return this.vertexCount; }
}
