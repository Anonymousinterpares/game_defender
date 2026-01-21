import { GPUContext } from "./GPUContext";
import { World } from "../World";
import { ConfigManager } from "../../config/MasterConfig";
import { WorldShader } from "./WorldShader";
import { GPUParticleSystem } from "./particles/GPUParticleSystem";
import { FluidSimulation } from "./FluidSimulation";
import { ParticleSystem } from "../ParticleSystem";
import { FluidShader } from "./FluidShader";


export class GPURenderer {
    private context: GPUContext;
    private world: World | null = null;
    private active: boolean = false;
    private worldShader: WorldShader | null = null;
    private fluidShader: FluidShader | null = null;
    private quadBuffer: WebGLBuffer | null = null;
    private particleSystem: GPUParticleSystem | null = null;
    private fluidSim: FluidSimulation | null = null;
    private worldMapTexture: WebGLTexture | null = null;
    private lastMeshVersion: number = -1;

    public getParticleSystem(): GPUParticleSystem | null {
        return this.particleSystem;
    }

    constructor() {
        this.context = new GPUContext();
        this.particleSystem = new GPUParticleSystem();
        this.fluidSim = new FluidSimulation();
    }

    private initResources(): void {
        const gl = this.context.getGL();
        if (!this.worldShader) {
            this.worldShader = new WorldShader(gl);
        }
        if (!this.fluidShader) {
            this.fluidShader = new FluidShader(gl);
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

        if (this.fluidSim && !this.fluidSim.isInitialized) {
            console.log("[GPU] Initializing Fluid Solver (256x256)...");
            this.fluidSim.init(gl, 256, 256); // 256x256 fluid grid

            // Bridge CPU Particle System events to Fluid Splats
            // Use a persistent reference to prevent multiple registrations if initResources is called twice
            ParticleSystem.getInstance().onSmokeSpawned = (x, y, color) => {
                const debug = ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug');
                if (debug) console.log(`[GPU] Smoke Spawned at (${x.toFixed(1)}, ${y.toFixed(1)}) color: ${color}`);

                if (!this.active || !this.fluidSim || !this.world) {
                    if (debug && !this.active) console.warn("[GPU] Smoke dropped: GPU not active");
                    return;
                }

                // Eulerian Splat: R=Density, G=Temperature, B=Variation
                let density = 0.6;
                let temp = 0.5;
                let variation = 0.5;

                if (color === '#000' || color === '#111' || color === '#222') {
                    density = 1.1;
                    temp = 4.0; // High buoyancy for fire
                    variation = 0.05; // Darker
                } else if (color === '#888' || color === '#666' || color === '#555') {
                    density = 0.8;
                    temp = 1.5;
                    variation = 0.5; // Gray
                } else {
                    density = 0.5;
                    temp = 0.6;
                    variation = 0.9; // Light
                }

                const wpW = this.world.getWidthPixels();
                const wpH = this.world.getHeightPixels();
                // Randomize radius a bit for more natural puffs
                const radius = 35.0 + Math.random() * 25.0;

                if (debug) console.log(`[GPU] Splat: density=${density}, temp=${temp}, radius=${radius.toFixed(1)}`);
                this.fluidSim.splat(x, y, radius, density, temp, variation, wpW, wpH);

                // Add some initial velocity "burst" to push smoke outwards
                const vx = (Math.random() - 0.5) * 60.0;
                const vy = (Math.random() - 0.5) * 60.0;
                this.fluidSim.splatVelocity(x, y, radius * 0.7, vx, vy, wpW, wpH);
            };
        }
    }

    public setWorld(world: World): void {
        this.world = world;
    }

    private updateWorldTexture(): void {
        if (!this.world || !this.active) return;
        const gl = this.context.getGL();

        // Check if world mesh has changed (walls destroyed etc)
        const currentVer = this.world.getMeshVersion();
        if (this.worldMapTexture && currentVer === this.lastMeshVersion) return;

        this.lastMeshVersion = currentVer;

        if (!this.worldMapTexture) {
            this.worldMapTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.worldMapTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }

        gl.bindTexture(gl.TEXTURE_2D, this.worldMapTexture);

        const width = this.world.getWidth();
        const height = this.world.getHeight();
        const buffer = this.world.getTilesSharedBuffer(); // SharedArrayBuffer

        const byteLength = width * height;
        const data = new Uint8Array(buffer, 0, byteLength);

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

    public update(dt: number, entities: { x: number, y: number }[] = []): void {
        if (this.active && this.particleSystem && this.world) {
            this.updateWorldTexture();

            // Pass texture and world info
            if (this.worldMapTexture) {
                this.particleSystem.setWorldMap(this.worldMapTexture, this.world.getWidth(), this.world.getHeight(), this.world.getTileSize());
            }

            // Pass entities for particle interaction
            this.particleSystem.setEntities(entities);

            this.particleSystem.update(dt, performance.now() * 0.001, 0, 0);

            if (this.fluidSim) {
                this.fluidSim.update(dt, this.world.getWidthPixels(), this.world.getHeightPixels());
            }
        }
    }

    private frameCount: number = 0;

    public render(cameraX: number, cameraY: number, width: number, height: number): void {
        const debug = ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug');
        if (!this.active || !this.worldShader) {
            if (debug && this.frameCount % 120 === 0) console.log("[GPU] Render skipped: active=" + this.active);
            this.frameCount++;
            return;
        }

        if (debug && this.frameCount % 120 === 0) {
            console.log(`[GPU] Rendering frame ${this.frameCount} at (${cameraX.toFixed(0)}, ${cameraY.toFixed(0)}) size: ${width}x${height}`);
        }
        this.frameCount++;

        this.context.resize(width, height);

        const gl = this.context.getGL();

        // --- State Cleanup ---
        // Ensure we are drawing to the screen and not a leakes FBO from update
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // Ensure we aren't corrupting the Particle System's VAO
        gl.bindVertexArray(null);

        this.context.clear();

        // 1. Render World (Floor/Walls)
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

        // 2. Render Fluid Field (Smoke)
        if (this.fluidSim) {
            gl.bindVertexArray(null); // Protection
            gl.viewport(0, 0, width, height); // Reset to screen resolution
            this.renderFluid(cameraX, cameraY, width, height);
        }

        // 3. Render Particles
        if (this.particleSystem) {
            gl.viewport(0, 0, width, height); // Just in case
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Premultiplied
            this.particleSystem.render(cameraX, cameraY, width, height);
            gl.disable(gl.BLEND);
        }
    }

    private renderFluid(cameraX: number, cameraY: number, width: number, height: number): void {
        const gl = this.context.getGL();
        const tex = this.fluidSim!.getDensityTexture();
        if (!tex) return;

        const shader = this.fluidShader!;
        shader.use();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        shader.setUniform1i("u_density", 0);

        shader.setUniform2f("u_camera", cameraX, cameraY);
        shader.setUniform2f("u_resolution", width, height);
        shader.setUniform1f("u_time", performance.now() * 0.001);
        shader.setUniform2f("u_worldPixels", this.world!.getWidthPixels(), this.world!.getHeightPixels());

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);

        // Cleanup state
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
        ParticleSystem.getInstance().onSmokeSpawned = null;
        this.context.dispose();
    }
}
