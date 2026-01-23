import { World } from "../../World";
import { Shader } from "../Shader";
import { WALL_PARALLAX_VERT, WALL_PARALLAX_FRAG } from "./shaders/wall.glsl";
import { GROUND_VERT, GROUND_FRAG } from "./shaders/ground.glsl";
import { WallMeshBuilder } from "./WallMeshBuilder";
import { GPUHeatSystem } from "../heatmap/GPUHeatSystem";
import { WorldClock } from "../../WorldClock";
import { ConfigManager } from "../../../config/MasterConfig";

export class GPUWallRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private shader: Shader | null = null;
    private groundShader: Shader | null = null;
    private meshBuilder: WallMeshBuilder;

    private vao: WebGLVertexArrayObject | null = null;
    private posBuffer: WebGLBuffer | null = null;
    private uvBuffer: WebGLBuffer | null = null;
    private matBuffer: WebGLBuffer | null = null;
    private normBuffer: WebGLBuffer | null = null;
    private quadBuffer: WebGLBuffer | null = null;

    private groundTexture: WebGLTexture | null = null;
    private groundTextureLoaded: boolean = false;

    private lastMeshVersion: number = -1;
    private initialized: boolean = false;

    constructor() {
        this.meshBuilder = new WallMeshBuilder();
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;
        this.shader = new Shader(gl, WALL_PARALLAX_VERT, WALL_PARALLAX_FRAG);
        this.groundShader = new Shader(gl, GROUND_VERT, GROUND_FRAG);

        this.vao = gl.createVertexArray();
        this.posBuffer = gl.createBuffer();
        this.uvBuffer = gl.createBuffer();
        this.matBuffer = gl.createBuffer();
        this.normBuffer = gl.createBuffer();

        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        this.loadGroundTexture();
        this.initialized = true;
    }

    public updateConfig(): void {
        this.meshBuilder.updateConfig();
    }

    private loadGroundTexture(): void {
        if (!this.gl) return;
        const gl = this.gl;

        this.groundTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.groundTexture);
        // Placeholder pixel until image loads
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([80, 70, 60, 255]));

        const image = new Image();
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, this.groundTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            this.groundTextureLoaded = true;
            console.log("[GPU Walls] Ground texture loaded.");
        };
        image.onerror = () => console.error("[GPU Walls] Failed to load ground texture.");
        image.src = `${import.meta.env.BASE_URL}textures/Ground103_1K-JPG/Ground103_1K-JPG_Color.jpg`;
    }

    public render(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem): void {
        if (!this.initialized || !this.gl) return;
        const gl = this.gl;
        const timeState = WorldClock.getInstance().getTimeState();

        this.renderGround(world, cameraX, cameraY, screenW, screenH, heatSystem, timeState);

        if (world.getMeshVersion() !== this.lastMeshVersion) {
            this.meshBuilder.build(world);
            this.lastMeshVersion = world.getMeshVersion();
            this.updateBuffers();
        }

        if (this.meshBuilder.getVertexCount() === 0) {
            this.cleanupWebGLState();
            return;
        }

        if (this.shader) {
            this.shader.use();
            gl.bindVertexArray(this.vao);

            const left = cameraX, right = cameraX + screenW, top = cameraY, bottom = cameraY + screenH;
            const m = new Float32Array([
                2 / (right - left), 0, 0, 0,
                0, 2 / (top - bottom), 0, 0,
                0, 0, -1, 0,
                -(right + left) / (right - left), -(top + bottom) / (top - bottom), 0, 1
            ]);

            this.shader.setUniformMatrix4fv("u_viewProj", m);
            this.shader.setUniform2f("u_cameraCenter", cameraX + screenW / 2, cameraY + screenH / 2);

            const strength = ConfigManager.getInstance().get<number>('Visuals', 'perspectiveStrength') || 0.0015;
            this.shader.setUniform1f("u_perspectiveStrength", strength);
            this.shader.setUniform2f("u_worldPixels", world.getWidthPixels(), world.getHeightPixels());

            const light = timeState.isDaylight ? timeState.sun : timeState.moon;
            this.shader.setUniform3f("u_lightDir", light.direction.x, light.direction.y, 1.0);
            this.shader.setUniform3f("u_lightColor", ...this.parseColor(light.color));
            this.shader.setUniform1f("u_lightIntensity", light.intensity);
            this.shader.setUniform3f("u_ambientColor", ...this.parseColor(timeState.baseAmbient));

            const heatTex = heatSystem.getHeatTexture();
            if (heatTex) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, heatTex);
                this.shader.setUniform1i("u_heatTexture", 0);
            }

            gl.drawArrays(gl.TRIANGLES, 0, this.meshBuilder.getVertexCount());
        }

        this.cleanupWebGLState();
    }

    private renderGround(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem, timeState: any): void {
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
        shader.setUniform1f("u_textureScale", 10.0); // Tile texture every 10 tiles

        const light = timeState.isDaylight ? timeState.sun : timeState.moon;
        shader.setUniform3f("u_ambientColor", ...this.parseColor(timeState.baseAmbient));
        shader.setUniform3f("u_lightColor", ...this.parseColor(light.color));
        shader.setUniform1f("u_lightIntensity", light.intensity);

        // Texture unit 0: Ground texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.groundTexture);
        shader.setUniform1i("u_groundTexture", 0);

        // Texture unit 1: Heat
        const heatTex = heatSystem.getHeatTexture();
        if (heatTex) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, heatTex);
            shader.setUniform1i("u_heatTexture", 1);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    private parseColor(color: string): [number, number, number] {
        if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            if (matches) return [parseInt(matches[0]) / 255, parseInt(matches[1]) / 255, parseInt(matches[2]) / 255];
        } else if (color.startsWith('#')) {
            return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255];
        }
        return [1, 1, 1];
    }

    private cleanupWebGLState(): void {
        if (!this.gl) return;
        const gl = this.gl;
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    private updateBuffers(): void {
        if (!this.gl) return;
        const gl = this.gl;
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getPositions(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getUVs(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.matBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getMaterials(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.meshBuilder.getNormals(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }
}
