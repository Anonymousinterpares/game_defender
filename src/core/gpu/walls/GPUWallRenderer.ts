import { World } from "../../World";
import { Shader } from "../Shader";
import { WALL_PARALLAX_VERT, WALL_PARALLAX_FRAG } from "./shaders/wall.glsl";
import { GROUND_VERT, GROUND_FRAG } from "./shaders/ground.glsl";
import { WallChunk } from "./WallChunk";
import { GPUHeatSystem } from "../heatmap/GPUHeatSystem";
import { WorldClock } from "../../WorldClock";
import { ConfigManager } from "../../../config/MasterConfig";
import { GPULightBuffer } from "../GPULightBuffer";
import { GPUEntityBuffer } from "../GPUEntityBuffer";
import { GPULightingSystem } from "../lighting/GPULightingSystem";

export class GPUWallRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private shader: Shader | null = null;
    private groundShader: Shader | null = null;

    private chunks: WallChunk[] = [];
    private chunkSize: number = 16;
    private chunksX: number = 0;
    private chunksY: number = 0;

    private quadBuffer: WebGLBuffer | null = null;

    private groundTexture: WebGLTexture | null = null;
    private groundTextureLoaded: boolean = false;

    private lastMeshVersion: number = -1;
    private lastWallHeight: number = -1;
    private initialized: boolean = false;
    private lastWorld: World | null = null;

    // High-Resolution Structure Map (10px per tile)
    private structureTexture: WebGLTexture | null = null;
    private structureW: number = 0;
    private structureH: number = 0;
    private dirtyTiles: Set<string> = new Set();

    constructor() {
        // WallMeshBuilder removed
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;
        this.shader = new Shader(gl, WALL_PARALLAX_VERT, WALL_PARALLAX_FRAG);
        this.groundShader = new Shader(gl, GROUND_VERT, GROUND_FRAG);

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

        const totalSize = this.structureW * this.structureH;
        const initialData = new Uint8Array(totalSize).fill(0);

        for (let ty = 0; ty < world.getHeight(); ty++) {
            for (let tx = 0; tx < world.getWidth(); tx++) {
                const mat = world.getTile(tx, ty);
                if (mat !== 0) {
                    for (let sy = 0; sy < 10; sy++) {
                        const rowIdx = (ty * 10 + sy) * this.structureW + (tx * 10);
                        initialData.fill(255, rowIdx, rowIdx + 10);
                    }
                }
            }
        }

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.structureW, this.structureH, 0, gl.RED, gl.UNSIGNED_BYTE, initialData);

        world.onTileChange((tx, ty) => {
            this.dirtyTiles.add(`${tx},${ty}`);
        });
    }

    public updateConfig(): void {
        this.chunks.forEach(c => c.markDirty());
    }

    public reset(): void {
        this.clear();
        const gl = this.gl;
        if (gl) {
            if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
            if (this.structureTexture) gl.deleteTexture(this.structureTexture);
        }
        this.chunks.forEach(c => c.destroy());
        this.chunks = [];
        this.initialized = false;
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
        };
        image.src = `${import.meta.env.BASE_URL}textures/GROUND/Ground103_1K-JPG/Ground103_1K-JPG_Color.jpg`;
    }

    public render(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem, lightBuffer: GPULightBuffer, entityBuffer: GPUEntityBuffer, worldMap: WebGLTexture | null, lightingSystem: GPULightingSystem | null, time: number): void {
        if (!this.initialized || !this.gl) return;
        const gl = this.gl;
        const timeState = WorldClock.getInstance().getTimeState();

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);

        if (this.lastWorld !== world) {
            this.lastWorld = world;
            this.lastMeshVersion = -1;
            this.initStructureMap(world);
            this.dirtyTiles.clear();
            this.initChunks(world);
        }

        const currentWallHeight = ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32.0;
        const currentVersion = world.getMeshVersion();

        if (currentVersion !== this.lastMeshVersion || currentWallHeight !== this.lastWallHeight) {
            const worldDirtyTiles = world.getDirtyTilesForGPU();
            worldDirtyTiles.forEach(key => {
                const [tx, ty] = key.split(',').map(Number);
                const cx = Math.floor(tx / this.chunkSize);
                const cy = Math.floor(ty / this.chunkSize);
                const cidx = cy * this.chunksX + cx;
                if (this.chunks[cidx]) this.chunks[cidx].markDirty();

                // Keep local dirtyTiles set in sync for structureMap update
                this.dirtyTiles.add(key);
            });

            this.lastMeshVersion = currentVersion;
            this.lastWallHeight = currentWallHeight;
        }

        this.updateStructureMap(world);
        this.renderGround(world, cameraX, cameraY, screenW, screenH, heatSystem, lightBuffer, entityBuffer, worldMap, lightingSystem, timeState);

        // Update dirty chunks that are visible OR close to visible
        this.chunks.forEach(chunk => {
            if (chunk.isVisible(cameraX, cameraY, screenW, screenH, 200)) {
                chunk.update(world, currentWallHeight);
            }
        });

        if (this.shader) {
            this.shader.use();
            // Per-chunk VAO binding is handled in chunk.render()

            const left = cameraX, right = cameraX + screenW, top = cameraY, bottom = cameraY + screenH;
            const m = new Float32Array([
                2 / (right - left), 0, 0, 0,
                0, 2 / (top - bottom), 0, 0,
                0, 0, -1, 0,
                -(right + left) / (right - left), -(top + bottom) / (top - bottom), 0, 1
            ]);

            this.shader.setUniformMatrix4fv("u_viewProj", m);
            this.shader.setUniform2f("u_cameraCenter", cameraX + screenW / 2, cameraY + screenH / 2);
            this.shader.setUniform1f("u_perspectiveStrength", ConfigManager.getInstance().get<number>('Visuals', 'perspectiveStrength') || 0.0015);
            this.shader.setUniform2f("u_worldPixels", world.getWidthPixels(), world.getHeightPixels());
            this.shader.setUniform1f("u_shadowRange", ConfigManager.getInstance().get<number>('Lighting', 'explosionShadowRangeTiles') || 40.0);
            this.shader.setUniform2f("u_structureSize", this.structureW, this.structureH);
            this.shader.setUniform1f("u_time", time);
            this.shader.setUniform1f("u_tileSize", world.getTileSize());
            this.shader.setUniform1f("u_useDeferred", lightingSystem ? 0.0 : 1.0);
            this.shader.setUniform1f("u_wallHeight", currentWallHeight);

            const { sun, moon } = timeState;
            const primaryShadowLen = sun.active ? sun.shadowLen : (moon.active ? moon.shadowLen : 100.0);
            this.shader.setUniform1f("u_directionalShadowLen", primaryShadowLen);

            this.shader.setUniform3f("u_sunDir", sun.direction.x, sun.direction.y, 1.0);
            this.shader.setUniform3f("u_sunColor", ...this.parseColor(sun.color));
            this.shader.setUniform1f("u_sunIntensity", sun.active ? sun.intensity : 0.0);
            this.shader.setUniform3f("u_moonDir", moon.direction.x, moon.direction.y, 1.0);
            this.shader.setUniform3f("u_moonColor", ...this.parseColor(moon.color));
            this.shader.setUniform1f("u_moonIntensity", moon.active ? moon.intensity : 0.0);
            this.shader.setUniform3f("u_ambientColor", ...this.parseColor(timeState.baseAmbient));

            lightBuffer.bind(this.shader.getProgram(), "LightBlock", 0);
            entityBuffer.bind(this.shader.getProgram(), "EntityBlock", 1);

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

            if (lightingSystem && lightingSystem.isInitialized) {
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, lightingSystem.getSDFTexture());
                this.shader.setUniform1i("u_sdfTexture", 4);

                gl.activeTexture(gl.TEXTURE5);
                gl.bindTexture(gl.TEXTURE_2D, lightingSystem.getEmissiveTexture());
                this.shader.setUniform1i("u_emissiveTexture", 5);
            }

            // Render visible chunks
            this.chunks.forEach(chunk => {
                if (chunk.isVisible(cameraX, cameraY, screenW, screenH)) {
                    chunk.render();
                }
            });
        }

        this.cleanupWebGLState();
    }

    private renderGround(world: World, cameraX: number, cameraY: number, screenW: number, screenH: number, heatSystem: GPUHeatSystem, lightBuffer: GPULightBuffer, entityBuffer: GPUEntityBuffer, worldMap: WebGLTexture | null, lightingSystem: GPULightingSystem | null, timeState: any): void {
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
        shader.setUniform1f("u_textureScale", 10.0);
        shader.setUniform1f("u_time", performance.now() * 0.001);
        shader.setUniform1f("u_shadowRange", ConfigManager.getInstance().get<number>('Lighting', 'explosionShadowRangeTiles') || 40.0);
        shader.setUniform1f("u_useDeferred", lightingSystem ? 0.0 : 1.0);

        const currentWallHeight = ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32.0;
        shader.setUniform1f("u_wallHeight", currentWallHeight);
        const { sun, moon } = timeState;
        const primaryShadowLen = sun.active ? sun.shadowLen : (moon.active ? moon.shadowLen : 100.0);
        shader.setUniform1f("u_directionalShadowLen", primaryShadowLen);

        shader.setUniform1f("u_sunIntensity", sun.active ? sun.intensity : 0.0);
        shader.setUniform3f("u_sunColor", ...this.parseColor(sun.color));
        shader.setUniform3f("u_sunDir", sun.direction.x, sun.direction.y, 1.0);
        shader.setUniform1f("u_moonIntensity", moon.active ? moon.intensity : 0.0);
        shader.setUniform3f("u_moonColor", ...this.parseColor(moon.color));
        shader.setUniform3f("u_moonDir", moon.direction.x, moon.direction.y, 1.0);
        shader.setUniform3f("u_ambientColor", ...this.parseColor(timeState.baseAmbient));

        lightBuffer.bind(shader.getProgram(), "LightBlock", 0);
        entityBuffer.bind(shader.getProgram(), "EntityBlock", 1);

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

        const scorchTex = heatSystem.getScorchTexture();
        if (scorchTex) {
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, scorchTex);
            shader.setUniform1i("u_scorchTexture", 6);
        }

        if (this.structureTexture) {
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this.structureTexture);
            shader.setUniform1i("u_structureMap", 3);
            shader.setUniform2f("u_structureSize", this.structureW, this.structureH);
        }

        if (lightingSystem && lightingSystem.isInitialized) {
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, lightingSystem.getSDFTexture());
            shader.setUniform1i("u_sdfTexture", 4);

            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, lightingSystem.getEmissiveTexture());
            shader.setUniform1i("u_emissiveTexture", 5);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    public updateStructureMap(world: World): void {
        if (this.dirtyTiles.size === 0 || !this.gl || !this.structureTexture) return;
        const gl = this.gl;
        const hm = world.getHeatMap();
        if (!hm) return;

        gl.bindTexture(gl.TEXTURE_2D, this.structureTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        this.dirtyTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            const material = world.getTile(tx, ty);
            const hpData = hm.getTileHP(tx, ty);
            const tileData = new Uint8Array(10 * 10);
            if (material === 0) tileData.fill(0);
            else if (!hpData) tileData.fill(255);
            else {
                for (let i = 0; i < 100; i++) tileData[i] = hpData[i] > 0 ? 255 : 0;
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
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(true);
        for (let i = 0; i < 8; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
    }

    public getStructureTexture(): WebGLTexture | null { return this.structureTexture; }

    private initChunks(world: World): void {
        this.chunks.forEach(c => c.destroy());
        this.chunks = [];

        const tw = world.getWidth();
        const th = world.getHeight();
        const ts = world.getTileSize();

        this.chunksX = Math.ceil(tw / this.chunkSize);
        this.chunksY = Math.ceil(th / this.chunkSize);

        for (let cy = 0; cy < this.chunksY; cy++) {
            for (let cx = 0; cx < this.chunksX; cx++) {
                const startTx = cx * this.chunkSize;
                const startTy = cy * this.chunkSize;
                const actualW = Math.min(this.chunkSize, tw - startTx);
                const actualH = Math.min(this.chunkSize, th - startTy);

                this.chunks.push(new WallChunk(this.gl!, startTx, startTy, actualW, actualH, ts));
            }
        }
    }
}

