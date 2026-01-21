import { GPUContext } from "./GPUContext";
import { World } from "../World";
import { ConfigManager } from "../../config/MasterConfig";
import { WorldShader } from "./WorldShader";
import { GPUParticleSystem } from "./particles/GPUParticleSystem";


export class GPURenderer {
    private context: GPUContext;
    private world: World | null = null;
    private active: boolean = false;
    private worldShader: WorldShader | null = null;
    private quadBuffer: WebGLBuffer | null = null;
    private particleSystem: GPUParticleSystem | null = null;
    private worldMapTexture: WebGLTexture | null = null;
    private lastMeshVersion: number = -1;

    public getParticleSystem(): GPUParticleSystem | null {
        return this.particleSystem;
    }

    constructor() {
        this.context = new GPUContext();
        this.particleSystem = new GPUParticleSystem();
    }

    private initResources(): void {
        const gl = this.context.getGL();
        if (!this.worldShader) {
            this.worldShader = new WorldShader(gl);
        }

        if (!this.quadBuffer) {
            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            const positions = new Float32Array([
                -1, -1,
                1, -1,
                -1, 1,
                -1, 1,
                1, -1,
                1, 1,
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        }

        if (this.particleSystem && !this.particleSystem['initialized']) {
             this.particleSystem.init(gl);
        }
    }

    public setWorld(world: World): void {
        this.world = world;
    }

    private updateWorldTexture(): void {
        if (!this.world || !this.active) return;
        const gl = this.context.getGL();

        // Check if world mesh has changed (walls destroyed etc)
        // Accessing private meshVersion via public getter if available, or just check dirty flag?
        // World.ts has getMeshVersion()
        const currentVer = this.world.getMeshVersion();
        if (this.worldMapTexture && currentVer === this.lastMeshVersion) return;

        this.lastMeshVersion = currentVer;

        if (!this.worldMapTexture) {
            this.worldMapTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.worldMapTexture);
            // R8 is enough for MaterialType (uint8)
            // But WebGL2 needs careful format. LUMINANCE or RED.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }

        gl.bindTexture(gl.TEXTURE_2D, this.worldMapTexture);
        
        const width = this.world.getWidth();
        const height = this.world.getHeight();
        const buffer = this.world.getTilesSharedBuffer(); // SharedArrayBuffer
        
        // Ensure we only pass the exact bytes needed
        const byteLength = width * height;
        const data = new Uint8Array(buffer, 0, byteLength);

        // Upload
        // internalFormat: R8, format: RED, type: UNSIGNED_BYTE
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    }

    public updateConfig(): void {
        const wasActive = this.active;
        this.active = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled') || false;

        if (this.active && !wasActive) {
            console.log("[GPU] Context Request...");
            this.context.init();
            this.initResources();
            console.log("[GPU] Pipeline Activated");
        } else if (!this.active && wasActive) {
            console.log("[GPU] Pipeline Deactivated");
        }
    }

    public update(dt: number, entities: {x: number, y: number}[] = []): void {
        if (this.active && this.particleSystem && this.world) {
            this.updateWorldTexture();
            
            // Pass texture and world info
            if (this.worldMapTexture) {
                this.particleSystem.setWorldMap(this.worldMapTexture, this.world.getWidth(), this.world.getHeight(), this.world.getTileSize());
            }

            // Pass entities for particle interaction
            this.particleSystem.setEntities(entities);

            this.particleSystem.update(dt, performance.now() * 0.001, 0, 0);
        }
    }

    public render(cameraX: number, cameraY: number, width: number, height: number): void {
        if (!this.active || !this.worldShader) return;

        this.context.resize(width, height);
        this.context.clear();

        const gl = this.context.getGL();
        const shader = this.worldShader;

        shader.use();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = shader.getAttribLocation("a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        shader.setUniform2f("u_resolution", gl.canvas.width, gl.canvas.height);
        shader.setUniform2f("u_camera", cameraX, cameraY);
        shader.setUniform1f("u_tileSize", this.world?.getTileSize() || 32);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Draw Particles
        if (this.particleSystem) {
            this.particleSystem.render(cameraX, cameraY, width, height);
        }
    }

    /**
     * Composites the GPU-rendered content onto the main 2D canvas.
     * Call this after render() and after the main 2D world has been drawn.
     */
    public compositeToContext(ctx: CanvasRenderingContext2D): void {
        if (!this.active) return;

        const gpuCanvas = this.context.getCanvas();
        // Draw the GPU canvas on top of the existing 2D content
        ctx.drawImage(gpuCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    public isActive(): boolean {
        return this.active;
    }

    public dispose(): void {
        this.context.dispose();
    }
}
