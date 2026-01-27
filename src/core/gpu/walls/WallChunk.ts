import { ChunkMeshBuilder, MeshData } from "./ChunkMeshBuilder";
import { World } from "../../World";

export class WallChunk {
    private vao: WebGLVertexArrayObject | null = null;
    private buffers: {
        pos: WebGLBuffer | null;
        uv: WebGLBuffer | null;
        mat: WebGLBuffer | null;
        norm: WebGLBuffer | null;
    } = { pos: null, uv: null, mat: null, norm: null };

    private vertexCount: number = 0;
    private initialized: boolean = false;
    private dirty: boolean = true;

    private worldX: number;
    private worldY: number;
    private worldW: number;
    private worldH: number;

    constructor(
        private gl: WebGL2RenderingContext,
        private tx: number,
        private ty: number,
        private tw: number,
        private th: number,
        private tileSize: number
    ) {
        this.worldX = tx * tileSize;
        this.worldY = ty * tileSize;
        this.worldW = tw * tileSize;
        this.worldH = th * tileSize;
    }

    public isVisible(camX: number, camY: number, screenW: number, screenH: number, padding: number = 100): boolean {
        // Simple frustum check with padding
        return (
            this.worldX < camX + screenW + padding &&
            this.worldX + this.worldW > camX - padding &&
            this.worldY < camY + screenH + padding &&
            this.worldY + this.worldH > camY - padding
        );
    }

    public markDirty(): void {
        this.dirty = true;
    }

    public update(world: World, wallHeight: number): void {
        if (!this.dirty) return;

        const data = ChunkMeshBuilder.build(world, this.tx, this.ty, this.tw, this.th, wallHeight);
        this.vertexCount = data.vertexCount;

        if (this.vertexCount > 0) {
            this.uploadData(data);
        }

        this.dirty = false;
        this.initialized = true;
    }

    private uploadData(data: MeshData): void {
        const gl = this.gl;
        if (!this.vao) {
            this.vao = gl.createVertexArray();
            this.buffers.pos = gl.createBuffer();
            this.buffers.uv = gl.createBuffer();
            this.buffers.mat = gl.createBuffer();
            this.buffers.norm = gl.createBuffer();
        }

        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
        gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.uv);
        gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.mat);
        gl.bufferData(gl.ARRAY_BUFFER, data.materials, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.norm);
        gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    public render(): void {
        if (!this.initialized || this.vertexCount === 0) return;

        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }

    public destroy(): void {
        const gl = this.gl;
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.buffers.pos) gl.deleteBuffer(this.buffers.pos);
        if (this.buffers.uv) gl.deleteBuffer(this.buffers.uv);
        if (this.buffers.mat) gl.deleteBuffer(this.buffers.mat);
        if (this.buffers.norm) gl.deleteBuffer(this.buffers.norm);
        this.initialized = false;
    }
}
