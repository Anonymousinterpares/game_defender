import { GPUContext } from "./GPUContext";
import { World } from "../World";
import { ConfigManager } from "../../config/MasterConfig";
import { WorldShader } from "./WorldShader";
import { GPUParticleSystem } from "./particles/GPUParticleSystem";
import { FluidSimulation } from "./FluidSimulation";
import { ParticleSystem } from "../ParticleSystem";
import { FluidShader } from "./FluidShader";
import { GPUHeatSystem } from "./heatmap/GPUHeatSystem";
import { GPUWallRenderer } from "./walls/GPUWallRenderer";

export class GPURenderer {
    private static _instance: GPURenderer | null = null;

    public static getInstance(): GPURenderer {
        if (!this._instance) {
            this._instance = new GPURenderer();
        }
        return this._instance;
    }

    // Deprecated static instance property for backward compatibility
    public static get instance(): GPURenderer | null {
        return this._instance;
    }

    private context: GPUContext;
    private world: World | null = null;
    private active: boolean = false;
    private worldShader: WorldShader | null = null;
    private fluidShader: FluidShader | null = null;
    private quadBuffer: WebGLBuffer | null = null;
    private particleSystem: GPUParticleSystem;
    private fluidSimulation: FluidSimulation;
    private heatSystem: GPUHeatSystem;
    private wallRenderer: GPUWallRenderer;
    private worldMapTexture: WebGLTexture | null = null;
    private lastMeshVersion: number = -1;
    private lastEntityPositions: Map<number, { x: number, y: number }> = new Map();

    public getParticleSystem(): GPUParticleSystem | null {
        return this.particleSystem;
    }

    private constructor() {
        this.context = new GPUContext();
        this.particleSystem = new GPUParticleSystem();
        this.fluidSimulation = new FluidSimulation();
        this.heatSystem = new GPUHeatSystem();
        this.wallRenderer = new GPUWallRenderer();

        // Register callback ONCE for the life of the app
        const ps = ParticleSystem.getInstance();
        ps.onSmokeSpawned = this.handleSmokeSpawned;
        ps.onVelocitySplatRequested = this.handleVelocitySplat; // Phase 3
        ps.onClear = () => this.clear();

        this.updateConfig();
    }

    // Phase 3: Handler for projectile/explosion velocity injection
    private handleVelocitySplat = (x: number, y: number, vx: number, vy: number, radius: number) => {
        if (!this.active || !this.fluidSimulation || !this.world) {
            return;
        }
        const wpW = this.world.getWidthPixels();
        const wpH = this.world.getHeightPixels();
        this.fluidSimulation.splatVelocity(x, y, radius, vx, vy, wpW, wpH);
    };

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

        if (this.fluidSimulation && !this.fluidSimulation.isInitialized) {
            console.log("[GPU] Initializing Fluid Solver (256x256)...");
            this.fluidSimulation.init(gl, 256, 256);
        }

        if (this.heatSystem && !this.heatSystem.isInitialized) {
            console.log("[GPU] Initializing Heat System (512x512)...");
            this.heatSystem.init(gl, 512, 512);
        }

        if (this.wallRenderer && !this.wallRenderer['initialized']) {
            console.log("[GPU] Initializing Wall Renderer...");
            this.wallRenderer.init(gl);
        }
    }

    private handleSmokeSpawned = (x: number, y: number, color: string) => {
        // Diagnostic: Check for valid numbers immediately
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return;
        }

        if (!this.active || !this.fluidSimulation || !this.world) {
            return;
        }

        // Eulerian Splat: R=Density, G=Temperature, B=Variation
        // Phase 6: Apply user-configurable density multiplier
        const densityMult = ConfigManager.getInstance().get<number>('Visuals', 'smokeDensityMultiplier') || 1.0;

        // CALIBRATED VALUES (Phase 1): Reduced density for realistic transparency
        let density = 0.12 * densityMult;
        let temp = 0.15;
        let variation = 0.5;

        if (color === '#000' || color === '#111' || color === '#222') {
            density = 0.2 * densityMult;   // Dark/thick smoke (was 1.1)
            temp = 0.8;      // Hot (was 4.0)
            variation = 0.05;
        } else if (color === '#888' || color === '#666' || color === '#555') {
            density = 0.15 * densityMult;  // Medium smoke (was 0.8)
            temp = 0.3;      // Warm (was 1.5)
            variation = 0.5;
        } else {
            density = 0.08 * densityMult;  // Light smoke (was 0.5)
            temp = 0.1;      // Cool (was 0.6)
            variation = 0.9;
        }

        const wpW = this.world.getWidthPixels();
        const wpH = this.world.getHeightPixels();
        const ppm = ConfigManager.getInstance().getPixelsPerMeter();
        const radius = (3.0 + Math.random() * 2.0) * ppm; // Smaller radius (was 5-9)

        this.fluidSimulation.splat(x, y, radius, density, temp, variation, wpW, wpH);

        // Phase 3: Increased velocity injection for better interaction
        const vx = (Math.random() - 0.5) * 20.0 * ppm;
        const vy = (Math.random() - 0.5) * 20.0 * ppm;
        this.fluidSimulation.splatVelocity(x, y, radius * 0.8, vx, vy, wpW, wpH);
    };

    public setWorld(world: World): void {
        this.world = world;

        // Link HeatMap events to GPU simulation
        const hm = world.getHeatMap();
        if (hm) {
            hm.onHeatAdded = (x: number, y: number, amount: number, radius: number) => {
                if (this.active && this.heatSystem) {
                    this.heatSystem.splatHeat(x, y, radius, amount, world.getWidthPixels(), world.getHeightPixels());
                }
            };
            hm.onIgnite = (x: number, y: number, radius: number) => {
                if (this.active && this.heatSystem) {
                    this.heatSystem.splatHeat(x, y, radius, 0.5, world.getWidthPixels(), world.getHeightPixels());
                }
            };
        }
    }

    private updateWorldTexture(): void {
        if (!this.world || !this.active) return;
        const gl = this.context.getGL();

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
        const buffer = this.world.getTilesSharedBuffer();
        const data = new Uint8Array(buffer, 0, width * height);

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    }

    public updateConfig(): void {
        const wasActive = this.active;
        this.active = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled') || false;

        if (this.active) {
            if (!wasActive) {
                console.log("[GPU] Pipeline Activated");
                this.context.init();
                this.initResources();
            }
        } else if (wasActive) {
            console.log("[GPU] Pipeline Deactivated");
        }
    }

    public clear(): void {
        if (this.particleSystem) this.particleSystem.clear();
        if (this.fluidSimulation) this.fluidSimulation.clear();
        if (this.heatSystem) this.heatSystem.clear();
    }

    public update(dt: number, entities: { x: number, y: number }[] = []): void {
        if (!this.active || !this.particleSystem || !this.world) return;

        this.updateWorldTexture();
        if (this.worldMapTexture) {
            this.particleSystem.setWorldMap(this.worldMapTexture, this.world.getWidth(), this.world.getHeight(), this.world.getTileSize());
        }
        this.particleSystem.setEntities(entities);
        this.particleSystem.update(dt, performance.now() * 0.001, 0, 0);

        if (this.fluidSimulation) {
            const ppm = ConfigManager.getInstance().getPixelsPerMeter();
            const wpW = this.world.getWidthPixels();
            const wpH = this.world.getHeightPixels();

            for (let i = 0; i < entities.length; i++) {
                const e = entities[i];
                const last = this.lastEntityPositions.get(i);
                if (last) {
                    const vx = (e.x - last.x) / dt;
                    const vy = (e.y - last.y) / dt;
                    const speedSq = vx * vx + vy * vy;
                    if (speedSq > (0.5 * ppm) * (0.5 * ppm)) {
                        const radius = 1.5 * ppm;
                        // Phase 3: Increased from 0.5 to 2.0 for stronger entity interaction
                        this.fluidSimulation.splatVelocity(e.x, e.y, radius, vx * 2.0, vy * 2.0, wpW, wpH);
                    }
                }
                this.lastEntityPositions.set(i, { x: e.x, y: e.y });
            }
            this.fluidSimulation.update(dt, wpW, wpH);
        }

        if (this.heatSystem) {
            this.heatSystem.update(dt);
        }
    }

    public render(cameraX: number, cameraY: number, width: number, height: number): void {
        if (!this.active || !this.worldShader) return;

        this.context.resize(width, height);
        const gl = this.context.getGL();

        // ROOT CAUSE FIX: Force update viewport! 
        // FluidSimulation messes with viewport (256x256) and if resize() caches values, this doesn't get reset.
        gl.viewport(0, 0, width, height);

        // State Hygiene
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(null);
        this.context.clear();

        // 1. Render World (Ground + Walls)
        if (this.world) {
            this.wallRenderer.render(this.world, cameraX, cameraY, width, height, this.heatSystem);
        }

        // 2. Render Fluid Field
        if (this.fluidSimulation) {
            this.renderFluid(cameraX, cameraY, width, height);
        }

        // 3. Render Particles
        if (this.particleSystem) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.particleSystem.render(cameraX, cameraY, width, height);
            gl.disable(gl.BLEND);
        }

        // Final Cleanup
        gl.useProgram(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    public renderFluid(cameraX: number, cameraY: number, screenW: number, screenH: number): void {
        if (!this.active || !this.fluidSimulation || !this.world || !this.fluidShader) return;

        const gl = this.context.getGL();
        const canvas = this.context.getCanvas();
        gl.viewport(0, 0, canvas.width, canvas.height);

        const tex = this.fluidSimulation.getDensityTexture();
        if (!tex) return;

        const shader = this.fluidShader;
        shader.use();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = shader.getAttribLocation("a_position");
        gl.enableVertexAttribArray(posLoc || 0);
        gl.vertexAttribPointer(posLoc || 0, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        shader.setUniform1i("u_density", 0);

        shader.setUniform2f("u_camera", cameraX, cameraY);
        shader.setUniform2f("u_resolution", screenW, screenH);
        shader.setUniform1f("u_time", performance.now() * 0.001);
        shader.setUniform2f("u_worldPixels", this.world.getWidthPixels(), this.world.getHeightPixels());

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.BLEND);

        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    public compositeToContext(ctx: CanvasRenderingContext2D): void {
        if (!this.active) return;
        const gpuCanvas = this.context.getCanvas();
        ctx.drawImage(gpuCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    public renderHeat(cameraX: number, cameraY: number, screenW: number, screenH: number): void {
        if (!this.active || !this.heatSystem || !this.world) return;

        const gl = this.context.getGL();
        const tex = this.heatSystem.getHeatTexture();
        if (!tex) return;

        const shaderManager = this.heatSystem.getShaderManager();
        if (!shaderManager) return;

        const shader = shaderManager.renderShader;
        shader.use();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = shader.getAttribLocation("a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        shader.setUniform1i("u_heatTex", 0);

        shader.setUniform2f("u_camera", cameraX, cameraY);
        shader.setUniform2f("u_resolution", screenW, screenH);
        shader.setUniform2f("u_worldPixels", this.world.getWidthPixels(), this.world.getHeightPixels());

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.BLEND);

        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    public isActive(): boolean {
        return this.active;
    }

    public dispose(): void {
        // Singleton is persistent.
        this.active = false;
    }
}
