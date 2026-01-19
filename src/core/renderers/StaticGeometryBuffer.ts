import { GPUDriver } from './GPUDriver';
import { WALL_VS, WALL_FS } from './WallShader';
import { MaterialType } from '../HeatMap';
import { World } from '../World';

export class StaticGeometryBuffer {
    private gl: WebGL2RenderingContext;
    private vao: WebGLVertexArrayObject;
    private vbo: WebGLBuffer;
    private program: WebGLProgram;
    private vertexCount: number = 0;
    private wallHeight: number = 32;

    constructor() {
        const driver = GPUDriver.getInstance();
        this.gl = driver.getGL();
        this.program = driver.createProgram('wall', WALL_VS, WALL_FS);
        this.vao = this.gl.createVertexArray()!;
        this.vbo = this.gl.createBuffer()!;
        this.setupAttributes();
    }

    private setupAttributes() {
        this.gl.bindVertexArray(this.vao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);

        // a_position: vec2 (x, y)
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 32, 0);

        // a_height: float (z)
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(1, 1, this.gl.FLOAT, false, 32, 8);

        // a_color: vec3 (r, g, b)
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(2, 3, this.gl.FLOAT, false, 32, 12);

        // a_normal: vec2 (nx, ny)
        this.gl.enableVertexAttribArray(3);
        this.gl.vertexAttribPointer(3, 2, this.gl.FLOAT, false, 32, 24);

        this.gl.bindVertexArray(null);
    }

    public rebuild(world: World, wallHeight: number) {
        this.wallHeight = wallHeight;
        const heatMap = world.getHeatMap();
        const tileSize = world.getTileSize();
        const vertices: number[] = [];

        for (let ty = 0; ty < world.getHeight(); ty++) {
            for (let tx = 0; tx < world.getWidth(); tx++) {
                const material = world.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;
                
                // Skip if damaged (CPU handles those)
                if (heatMap?.hasTileData(tx, ty)) continue;

                this.addTileGeometry(vertices, tx, ty, material, world, tileSize);
            }
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
        this.vertexCount = vertices.length / 8; // 8 floats per vertex
    }

    private addTileGeometry(v: number[], tx: number, ty: number, mat: MaterialType, world: World, ts: number) {
        const x0 = tx * ts; const y0 = ty * ts;
        const x1 = x0 + ts; const y1 = y0 + ts;
        const h = -this.wallHeight; // Wall top height

        const color = this.getMaterialColor(mat);

        // Faces: Only add if neighbor is NONE
        // Top Face (Normal 0, -1)
        if (ty === 0 || world.getTile(tx, ty - 1) === MaterialType.NONE) {
            this.addQuad(v, x0, y0, x1, y0, 0, h, color, 0, -1);
        }
        // Bottom Face (Normal 0, 1)
        if (ty === world.getHeight() - 1 || world.getTile(tx, ty + 1) === MaterialType.NONE) {
            this.addQuad(v, x0, y1, x1, y1, 0, h, color, 0, 1);
        }
        // Left Face (Normal -1, 0)
        if (tx === 0 || world.getTile(tx - 1, ty) === MaterialType.NONE) {
            this.addQuad(v, x0, y0, x0, y1, 0, h, color, -1, 0);
        }
        // Right Face (Normal 1, 0)
        if (tx === world.getWidth() - 1 || world.getTile(tx + 1, ty) === MaterialType.NONE) {
            this.addQuad(v, x1, y0, x1, y1, 0, h, color, 1, 0);
        }
    }

    private addQuad(v: number[], x0: number, y0: number, x1: number, y1: number, zBase: number, zTop: number, color: number[], nx: number, ny: number) {
        // Two triangles (6 vertices)
        const v1 = [x0, y0, zBase, ...color, nx, ny];
        const v2 = [x1, y1, zBase, ...color, nx, ny];
        const v3 = [x0, y0, zTop, ...color, nx, ny];
        const v4 = [x1, y1, zTop, ...color, nx, ny];

        // Triangle 1: Base0, Base1, Top0
        v.push(...v1, ...v2, ...v3);
        // Triangle 2: Base1, Top1, Top0
        v.push(...v2, ...v4, ...v3);
    }

    private getMaterialColor(mat: MaterialType): number[] {
        switch (mat) {
            case MaterialType.WOOD: return [0.24, 0.15, 0.14]; // #3e2723
            case MaterialType.BRICK: return [0.5, 0.0, 0.0];  // #800000
            case MaterialType.STONE: return [0.26, 0.26, 0.26]; // #424242
            case MaterialType.METAL: return [0.15, 0.2, 0.22];  // #263238
            case MaterialType.INDESTRUCTIBLE: return [0.03, 0.03, 0.03]; // #080808
            default: return [0.1, 0.1, 0.1];
        }
    }

    public draw(cameraX: number, cameraY: number, viewW: number, viewH: number, perspectiveStrength: number, lightDir: {x: number, y: number}, lightIntensity: number) {
        if (this.vertexCount === 0) return;

        const gl = this.gl;
        const driver = GPUDriver.getInstance();
        driver.useProgram('wall');

        const prog = this.program;
        gl.uniform2f(gl.getUniformLocation(prog, 'u_cameraCenter'), cameraX + viewW / 2, cameraY + viewH / 2);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_perspectiveStrength'), perspectiveStrength);
        gl.uniform2f(gl.getUniformLocation(prog, 'u_viewOffset'), -cameraX, -cameraY);
        gl.uniform2f(gl.getUniformLocation(prog, 'u_viewportSize'), viewW, viewH);
        gl.uniform2f(gl.getUniformLocation(prog, 'u_lightDir'), lightDir.x, lightDir.y);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_lightIntensity'), lightIntensity);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
        gl.bindVertexArray(null);
    }
}
