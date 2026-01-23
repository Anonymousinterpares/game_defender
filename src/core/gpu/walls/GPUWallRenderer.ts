import { World } from "../../World";
import { Shader } from "../Shader";
import { WALL_VERT, WALL_FRAG } from "./shaders/wall.glsl";
import { GROUND_FRAG } from "./shaders/ground.glsl";
import { WallMeshBuilder } from "./WallMeshBuilder";
import { GPUHeatSystem } from "../heatmap/GPUHeatSystem";

export class GPUWallRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private shader: Shader | null = null;
    private groundShader: Shader | null = null;
    private meshBuilder: WallMeshBuilder;

    private vao: WebGLVertexArrayObject | null = null;
    private posBuffer: WebGLBuffer | null = null;
    private uvBuffer: WebGLBuffer | null = null;
    private matBuffer: WebGLBuffer | null = null;
    private quadBuffer: WebGLBuffer | null = null;

    private lastMeshVersion: number = -1;
    private initialized: boolean = false;

    constructor() {
        this.meshBuilder = new WallMeshBuilder();
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;
        this.shader = new Shader(gl, WALL_VERT, WALL_FRAG);
        this.groundShader = new Shader(gl, WALL_VERT, GROUND_FRAG);

        this.vao = gl.createVertexArray();
        this.posBuffer = gl.createBuffer();
        this.uvBuffer = gl.createBuffer();
        this.matBuffer = gl.createBuffer();

        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        this.initialized = true;
    }

    public render(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem): void {
        if (!this.initialized || !this.gl) return;
        const gl = this.gl;

        // 1. Draw Ground first
        this.renderGround(world, cameraX, cameraY, screenW, screenH, heatSystem);

        // 2. Check if mesh needs rebuild
        if (world.getMeshVersion() !== this.lastMeshVersion) {
            this.meshBuilder.build(world);
            this.lastMeshVersion = world.getMeshVersion();
            this.updateBuffers();
        }

        if (this.meshBuilder.getVertexCount() === 0) {
            this.cleanupWebGLState();
            return;
        }

        // 3. Setup Wall rendering
        if (this.shader) {
            this.shader.use();
            gl.bindVertexArray(this.vao);

            const left = cameraX;
            const right = cameraX + screenW;
            const top = cameraY;
            const bottom = cameraY + screenH;

            const m = new Float32Array([
                2 / (right - left), 0, 0, 0,
                0, 2 / (top - bottom), 0, 0,
                0, 0, -1, 0,
                -(right + left) / (right - left), -(top + bottom) / (top - bottom), 0, 1
            ]);

            const projLoc = this.shader.getUniformLocation("u_viewProj");
            if (projLoc) gl.uniformMatrix4fv(projLoc, false, m);

            this.shader.setUniform2f("u_worldPixels", world.getWidthPixels(), world.getHeightPixels());

            // Bind Heat Texture
            const heatTex = heatSystem.getHeatTexture();
            if (heatTex) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, heatTex);
                this.shader.setUniform1i("u_heatTexture", 0);
            }

            // Draw Walls
            gl.drawArrays(gl.TRIANGLES, 0, this.meshBuilder.getVertexCount());
        }

        this.cleanupWebGLState();
    }

    private renderGround(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem): void {
        if (!this.gl || !this.groundShader) return;
        const gl = this.gl;
        const shader = this.groundShader;
        shader.use();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        shader.setUniform2f("u_camera", cameraX, cameraY);
        shader.setUniform2f("u_resolution", screenW, screenH);
        shader.setUniform2f("u_worldPixels", world.getWidthPixels(), world.getHeightPixels());
        shader.setUniform1f("u_tileSize", world.getTileSize());

        const heatTex = heatSystem.getHeatTexture();
        if (heatTex) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, heatTex);
            shader.setUniform1i("u_heatTexture", 0);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    private cleanupWebGLState(): void {
        if (!this.gl) return;
        const gl = this.gl;
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    private updateBuffers(): void {
        if (!this.gl) return;
        const gl = this.gl;

        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getPositions(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getUVs(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.matBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getMaterials(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }
}
