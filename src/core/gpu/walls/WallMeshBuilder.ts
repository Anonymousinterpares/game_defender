import { World } from "../../World";

export class WallMeshBuilder {
    private positions: Float32Array = new Float32Array(0);
    private uvs: Float32Array = new Float32Array(0);
    private materials: Float32Array = new Float32Array(0);
    private vertexCount: number = 0;

    constructor() { }

    public build(world: World): void {
        const width = world.getWidth();
        const height = world.getHeight();
        const ts = world.getTileSize();

        // 6 vertices per tile (2 triangles)
        // Each vertex has 2 position floats, 2 UV floats, 1 material float
        const maxTiles = width * height;
        const posBuffer = new Float32Array(maxTiles * 6 * 2);
        const uvBuffer = new Float32Array(maxTiles * 6 * 2);
        const matBuffer = new Float32Array(maxTiles * 6);

        let vIdx = 0;
        let tIdx = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const mat = world.getTile(x, y);
                if (mat === 0) continue; // NONE

                const wx = x * ts;
                const wy = y * ts;

                // Triangle 1
                this.addVertex(posBuffer, uvBuffer, matBuffer, tIdx++, wx, wy, 0, 0, mat);
                this.addVertex(posBuffer, uvBuffer, matBuffer, tIdx++, wx + ts, wy, 1, 0, mat);
                this.addVertex(posBuffer, uvBuffer, matBuffer, tIdx++, wx, wy + ts, 0, 1, mat);

                // Triangle 2
                this.addVertex(posBuffer, uvBuffer, matBuffer, tIdx++, wx, wy + ts, 0, 1, mat);
                this.addVertex(posBuffer, uvBuffer, matBuffer, tIdx++, wx + ts, wy, 1, 0, mat);
                this.addVertex(posBuffer, uvBuffer, matBuffer, tIdx++, wx + ts, wy + ts, 1, 1, mat);
            }
        }

        this.positions = posBuffer.slice(0, tIdx * 2);
        this.uvs = uvBuffer.slice(0, tIdx * 2);
        this.materials = matBuffer.slice(0, tIdx);
        this.vertexCount = tIdx;
    }

    private addVertex(pos: Float32Array, uv: Float32Array, mat: Float32Array, idx: number, x: number, y: number, u: number, v: number, m: number) {
        pos[idx * 2] = x;
        pos[idx * 2 + 1] = y;
        uv[idx * 2] = u;
        uv[idx * 2 + 1] = v;
        mat[idx] = m;
    }

    public getPositions(): Float32Array { return this.positions; }
    public getUVs(): Float32Array { return this.uvs; }
    public getMaterials(): Float32Array { return this.materials; }
    public getVertexCount(): number { return this.vertexCount; }
}
