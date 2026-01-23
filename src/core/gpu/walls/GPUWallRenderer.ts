import { World } from "../../World";
import { Shader } from "../Shader";
import { WALL_PARALLAX_VERT, WALL_PARALLAX_FRAG } from "./shaders/wall.glsl";
import { GROUND_VERT, GROUND_FRAG } from "./shaders/ground.glsl";
import { WallMeshBuilder } from "./WallMeshBuilder";
import { GPUHeatSystem } from "../heatmap/GPUHeatSystem";
import { WorldClock } from "../../WorldClock";
import { ConfigManager } from "../../../config/MasterConfig";
import { GPULightBuffer } from "../GPULightBuffer";

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
    private lastWorld: World | null = null;

    // High-Resolution Structure Map (10px per tile)
    private structureTexture: WebGLTexture | null = null;
    private structureW: number = 0;
    private structureH: number = 0;
    private dirtyTiles: Set<string> = new Set();

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

    private initStructureMap(world: World): void {
        const gl = this.gl!;
        this.structureW = world.getWidth() * 10;
        this.structureH = world.getHeight() * 10;

        this.structureTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.structureTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Initial state: 0 (empty)
        const totalSize = this.structureW * this.structureH;
        const initialData = new Uint8Array(totalSize).fill(0);

        // Fill initial solid tiles (if any)
        for (let ty = 0; ty < world.getHeight(); ty++) {
            for (let tx = 0; tx < world.getWidth(); tx++) {
                const mat = world.getTile(tx, ty);
                if (mat !== 0) {
                    // Full solid block
                    for (let sy = 0; sy < 10; sy++) {
                        const rowIdx = (ty * 10 + sy) * this.structureW + (tx * 10);
                        initialData.fill(255, rowIdx, rowIdx + 10);
                    }
                }
            }
        }

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.structureW, this.structureH, 0, gl.RED, gl.UNSIGNED_BYTE, initialData);

        // Register listener for incremental updates
        world.onTileChange((tx, ty) => {
            this.dirtyTiles.add(`${tx},${ty}`);
        });

        console.log(`[GPU Walls] Structure Map initialized: ${this.structureW}x${this.structureH}`);
    }

    public updateConfig(): void {
        this.meshBuilder.updateConfig();
    }

    public clear(): void {
        this.lastMeshVersion = -1;
        this.lastWorld = null;
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
        image.src = `${import.meta.env.BASE_URL}textures/GROUND/Ground103_1K-JPG/Ground103_1K-JPG_Color.jpg`;
    }

    public render(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem, lightBuffer: GPULightBuffer, worldMap: WebGLTexture | null): void {
        if (!this.initialized || !this.gl) return;
        const gl = this.gl;
        const timeState = WorldClock.getInstance().getTimeState();

        this.renderGround(world, cameraX, cameraY, screenW, screenH, heatSystem, lightBuffer, worldMap, timeState);

        if (this.lastWorld !== world) {
            this.lastWorld = world;
            this.lastMeshVersion = -1;
            this.meshBuilder.reset();
            this.initStructureMap(world);
            this.dirtyTiles.clear();
        }

        this.updateStructureMap(world);

        this.renderGround(world, cameraX, cameraY, screenW, screenH, heatSystem, lightBuffer, worldMap, timeState);

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

            const shadowRange = ConfigManager.getInstance().get<number>('Lighting', 'explosionShadowRangeTiles') || 40.0;
            this.shader.setUniform1f("u_shadowRange", shadowRange);
            this.shader.setUniform2f("u_structureSize", this.structureW, this.structureH);
            this.shader.setUniform1f("u_tileSize", world.getTileSize());

            const { sun, moon } = timeState;
            this.shader.setUniform3f("u_sunDir", sun.direction.x, sun.direction.y, 1.0);
            this.shader.setUniform3f("u_sunColor", ...this.parseColor(sun.color));
            this.shader.setUniform1f("u_sunIntensity", sun.active ? sun.intensity : 0.0);

            this.shader.setUniform3f("u_moonDir", moon.direction.x, moon.direction.y, 1.0);
            this.shader.setUniform3f("u_moonColor", ...this.parseColor(moon.color));
            this.shader.setUniform1f("u_moonIntensity", moon.active ? moon.intensity : 0.0);

            this.shader.setUniform3f("u_ambientColor", ...this.parseColor(timeState.baseAmbient));

            lightBuffer.bind(this.shader.getProgram(), "LightBlock", 0);

            const heatTex = heatSystem.getHeatTexture();
            if (heatTex) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, heatTex);
                this.shader.setUniform1i("u_heatTexture", 0);
            }

            if (this.structureTexture) {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.structureTexture);
                this.shader.setUniform1i("u_structureMap", 1);
            }

            gl.drawArrays(gl.TRIANGLES, 0, this.meshBuilder.getVertexCount());
        }

        this.cleanupWebGLState();
    }

    private renderGround(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem, lightBuffer: GPULightBuffer, worldMap: WebGLTexture | null, timeState: any): void {
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

        const shadowRange = ConfigManager.getInstance().get<number>('Lighting', 'explosionShadowRangeTiles') || 40.0;
        shader.setUniform1f("u_shadowRange", shadowRange);

        const { sun, moon } = timeState;
        shader.setUniform1f("u_sunIntensity", sun.active ? sun.intensity : 0.0);
        shader.setUniform3f("u_sunColor", ...this.parseColor(sun.color));
        shader.setUniform3f("u_sunDir", sun.direction.x, sun.direction.y, 1.0);

        shader.setUniform1f("u_moonIntensity", moon.active ? moon.intensity : 0.0);
        shader.setUniform3f("u_moonColor", ...this.parseColor(moon.color));
        shader.setUniform3f("u_moonDir", moon.direction.x, moon.direction.y, 1.0);

        shader.setUniform3f("u_ambientColor", ...this.parseColor(timeState.baseAmbient));

        lightBuffer.bind(shader.getProgram(), "LightBlock", 0);

        // Texture Units
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.groundTexture);
        shader.setUniform1i("u_groundTexture", 0);

        const heatTex = heatSystem.getHeatTexture();
        if (heatTex) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, heatTex);
            shader.setUniform1i("u_heatTexture", 1);
        }

        if (worldMap) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, worldMap);
            shader.setUniform1i("u_worldMap", 2);
        }

        if (this.structureTexture) {
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.structureTexture);
            shader.setUniform1i("u_structureMap", 3);
            shader.setUniform2f("u_structureSize", this.structureW, this.structureH);
        } else {
            // Unbind to prevent stale texture reading
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    private updateStructureMap(world: World): void {
        if (this.dirtyTiles.size === 0 || !this.gl || !this.structureTexture) return;
        const gl = this.gl;
        const hm = world.getHeatMap();
        if (!hm) return;

        gl.bindTexture(gl.TEXTURE_2D, this.structureTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        this.dirtyTiles.forEach(key => {
            const parts = key.split(',');
            const tx = parseInt(parts[0]);
            const ty = parseInt(parts[1]);
            const material = world.getTile(tx, ty);
            const hpData = hm.getTileHP(tx, ty);

            const tileData = new Uint8Array(10 * 10);
            if (material === 0) {
                tileData.fill(0);
            } else if (!hpData) {
                tileData.fill(255);
            } else {
                for (let i = 0; i < 100; i++) {
                    tileData[i] = hpData[i] > 0 ? 255 : 0;
                }
            }

            gl.texSubImage2D(gl.TEXTURE_2D, 0, tx * 10, ty * 10, 10, 10, gl.RED, gl.UNSIGNED_BYTE, tileData);
        });

        this.dirtyTiles.clear();
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
