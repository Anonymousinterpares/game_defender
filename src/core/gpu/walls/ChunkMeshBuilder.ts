import { World } from "../../World";
import { MaterialType } from "../../../core/HeatMap";

export interface MeshData {
    positions: Float32Array;
    uvs: Float32Array;
    materials: Float32Array;
    normals: Float32Array;
    vertexCount: number;
}

export class ChunkMeshBuilder {
    private static readonly subDiv = 10;

    // 256 tiles * 2400 vertices = 614,400 vertices total for a 16x16 chunk
    private static posPool = new Float32Array(614400 * 3);
    private static uvPool = new Float32Array(614400 * 2);
    private static matPool = new Float32Array(614400);
    private static normPool = new Float32Array(614400 * 2);

    public static build(world: World, startTx: number, startTy: number, width: number, height: number, wallHeight: number): MeshData {
        let v = 0;
        const ts = world.getTileSize();
        const heatMap = world.getHeatMap();
        const h = -wallHeight;

        for (let ty = startTy; ty < startTy + height; ty++) {
            for (let tx = startTx; tx < startTx + width; tx++) {
                const material = world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;

                const key = `${tx},${ty}`;
                const hpData = heatMap?.getTileHP(tx, ty);
                const isDamaged = hpData !== null;

                if (!isDamaged) {
                    v = this.buildHealthyTile(world, tx, ty, ts, material, h, v);
                } else {
                    v = this.buildDamagedTile(world, tx, ty, ts, material, hpData, h, v);
                }
            }
        }

        return {
            positions: this.posPool.slice(0, v * 3),
            uvs: this.uvPool.slice(0, v * 2),
            materials: this.matPool.slice(0, v),
            normals: this.normPool.slice(0, v * 2),
            vertexCount: v
        };
    }

    private static buildHealthyTile(world: World, tx: number, ty: number, ts: number, mat: number, h: number, v: number): number {
        const wx = tx * ts;
        const wy = ty * ts;

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

        // Top Face (Roof)
        this.setQuad(v, wx, wy, h, wx + ts, wy, h, wx, wy + ts, h, wx + ts, wy + ts, h, 0, 0, 1, 1, mat, 0, 0);
        v += 6;

        return v;
    }

    private static buildDamagedTile(world: World, tx: number, ty: number, ts: number, mat: number, hpData: Float32Array, h: number, v: number): number {
        const wx = tx * ts;
        const wy = ty * ts;
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

                // Top Face (Roof)
                this.setQuad(v, swx, swy, h, swx + subTs, swy, h, swx, swy + subTs, h, swx + subTs, swy + subTs, h, suvX0, suvY0, suvX1, suvY1, mat, 0, 0);
                v += 6;
            }
        }

        return v;
    }

    private static setQuad(v: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number, u0: number, v0: number, u1: number, v1: number, mat: number, nx: number, ny: number): void {
        this.setVertex(v + 0, x0, y0, z0, u0, v0, mat, nx, ny);
        this.setVertex(v + 1, x1, y1, z1, u1, v0, mat, nx, ny);
        this.setVertex(v + 2, x2, y2, z2, u0, v1, mat, nx, ny);
        this.setVertex(v + 3, x2, y2, z2, u0, v1, mat, nx, ny);
        this.setVertex(v + 4, x1, y1, z1, u1, v0, mat, nx, ny);
        this.setVertex(v + 5, x3, y3, z3, u1, v1, mat, nx, ny);
    }

    private static setVertex(idx: number, x: number, y: number, z: number, u: number, v: number, m: number, nx: number, ny: number): void {
        this.posPool[idx * 3 + 0] = x;
        this.posPool[idx * 3 + 1] = y;
        this.posPool[idx * 3 + 2] = z;
        this.uvPool[idx * 2 + 0] = u;
        this.uvPool[idx * 2 + 1] = v;
        this.matPool[idx] = m;
        this.normPool[idx * 2 + 0] = nx;
        this.normPool[idx * 2 + 1] = ny;
    }
}
