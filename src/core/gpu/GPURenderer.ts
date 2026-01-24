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
import { GPULightBuffer } from "./GPULightBuffer";
import { LightManager } from "../LightManager";

export class GPURenderer {
    private static _instance: GPURenderer | null = null;

    public static getInstance(): GPURenderer {
        if (!this._instance) {
            this._instance = new GPURenderer();
        }
        return this._instance;
    }

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
    private lightBuffer: GPULightBuffer;
    private worldMapTexture: WebGLTexture | null = null;
    private lastMeshVersion: number = -1;
    private lastEntityPositions: Map<number, { x: number, y: number }> = new Map();

    public getParticleSystem(): GPUParticleSystem {
        return this.particleSystem;
    }

    private constructor() {
        this.context = new GPUContext();
        this.particleSystem = new GPUParticleSystem();
        this.fluidSimulation = new FluidSimulation();
        this.heatSystem = new GPUHeatSystem();
        this.wallRenderer = new GPUWallRenderer();
        this.lightBuffer = new GPULightBuffer(32);

        const ps = ParticleSystem.getInstance();
        ps.onSmokeSpawned = this.handleSmokeSpawned;
        ps.onVelocitySplatRequested = this.handleVelocitySplat;
        ps.onClear = () => this.clear();

        this.updateConfig();
    }

    private handleVelocitySplat = (x: number, y: number, vx: number, vy: number, radius: number) => {
        if (!this.active || !this.fluidSimulation || !this.world) return;
        const wpW = this.world.getWidthPixels();
        const wpH = this.world.getHeightPixels();
        this.fluidSimulation.splatVelocity(x, y, radius, vx, vy, wpW, wpH);
    };

    private initResources(): void {
        const gl = this.context.getGL();
        if (!this.worldShader) this.worldShader = new WorldShader(gl);
        if (!this.fluidShader) this.fluidShader = new FluidShader(gl);

        if (!this.quadBuffer) {
            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        }

        if (!this.particleSystem['initialized']) this.particleSystem.init(gl);
        if (!this.fluidSimulation.isInitialized) this.fluidSimulation.init(gl, 256, 256);
        if (!this.heatSystem.isInitialized) this.heatSystem.init(gl, 512, 512);
        if (!this.wallRenderer['initialized']) this.wallRenderer.init(gl);
        this.lightBuffer.init(gl);
    }

    private handleSmokeSpawned = (x: number, y: number, color: string) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !this.active || !this.fluidSimulation || !this.world) return;

        const densityMult = ConfigManager.getInstance().get<number>('Visuals', 'smokeDensityMultiplier') || 1.0;
        let density = 0.12 * densityMult, temp = 0.15, variation = 0.5;

        if (color === '#000' || color === 'black') {
            density = 1.0 * densityMult; temp = 0.98; variation = 0.005;
        } else if (color === '#111' || color === '#222') {
            density = 0.7 * densityMult; temp = 0.8; variation = 0.02;
        } else if (color === '#888' || color === '#666' || color === '#555') {
            density = 0.4 * densityMult; temp = 0.4; variation = 0.5;
        }

        const wpW = this.world.getWidthPixels(), wpH = this.world.getHeightPixels();
        const ts = this.world.getTileSize();
        // Smoke puff radius: ~0.5 to 1.0 tile
        const radius = (0.5 + Math.random() * 0.5) * ts;

        this.fluidSimulation.splat(x, y, radius, density, temp, variation, wpW, wpH);

        // Random drift velocity while spawning
        const driftX = (Math.random() - 0.5) * 50;
        const driftY = (Math.random() - 0.5) * 50;
        this.fluidSimulation.splatVelocity(x, y, radius * 1.2, driftX, driftY, wpW, wpH);
    };

    public setWorld(world: World): void {
        this.world = world;
        const hm = world.getHeatMap();
        if (hm) {
            hm.onHeatAdded = (x: number, y: number, amount: number, radius: number) => {
                if (this.active && this.heatSystem) this.heatSystem.splatHeat(x, y, radius, amount, world.getWidthPixels(), world.getHeightPixels());
            };
            hm.onIgnite = (x: number, y: number, radius: number) => {
                // If it's ignition, we want FULL heat immediately
                if (this.active && this.heatSystem) this.heatSystem.splatHeat(x, y, radius, 1.0, world.getWidthPixels(), world.getHeightPixels());
            };
        }
    }

    public updateConfig(): void {
        const wasActive = this.active;
        this.active = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled') || false;
        if (this.active) {
            this.wallRenderer.updateConfig();
            if (!wasActive) {
                this.context.init();
                this.initResources();
            }
        }
    }

    public clear(): void {
        if (this.particleSystem) this.particleSystem.clear();
        if (this.fluidSimulation) this.fluidSimulation.clear();
        if (this.heatSystem) this.heatSystem.clear();
        if (this.wallRenderer) this.wallRenderer.clear();
    }

    public update(dt: number, entities: { x: number, y: number }[] = []): void {
        if (!this.active || !this.particleSystem || !this.world) return;
        this.updateWorldTexture();
        if (this.worldMapTexture) this.particleSystem.setWorldMap(this.worldMapTexture, this.world.getWidth(), this.world.getHeight(), this.world.getTileSize());
        this.particleSystem.setEntities(entities);
        this.particleSystem.update(dt, performance.now() * 0.001, 0, 0);

        if (this.fluidSimulation) {
            const ppm = ConfigManager.getInstance().getPixelsPerMeter();
            const wpW = this.world.getWidthPixels(), wpH = this.world.getHeightPixels();
            for (let i = 0; i < entities.length; i++) {
                const e = entities[i], last = this.lastEntityPositions.get(i);
                if (last) {
                    const vx = (e.x - last.x) / dt, vy = (e.y - last.y) / dt;
                    if (vx * vx + vy * vy > (0.5 * ppm) * (0.5 * ppm)) this.fluidSimulation.splatVelocity(e.x, e.y, 1.5 * ppm, vx * 2.0, vy * 2.0, wpW, wpH);
                }
                this.lastEntityPositions.set(i, { x: e.x, y: e.y });
            }
            this.fluidSimulation.update(dt, wpW, wpH);
        }
        if (this.heatSystem) this.heatSystem.update(dt);

        // Update Light Buffer
        const lights = LightManager.getInstance().getLights();
        this.lightBuffer.update(lights);
    }

    private updateWorldTexture(): void {
        if (!this.world || !this.active) return;
        const gl = this.context.getGL();
        if (!this.worldMapTexture) {
            this.worldMapTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.worldMapTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        gl.bindTexture(gl.TEXTURE_2D, this.worldMapTexture);
        const width = this.world.getWidth(), height = this.world.getHeight();
        const data = new Uint8Array(this.world.getTilesSharedBuffer(), 0, width * height);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    }

    public renderEnvironment(cameraX: number, cameraY: number, width: number, height: number): void {
        if (!this.active || !this.world) return;
        this.context.resize(width, height);
        const gl = this.context.getGL();
        const canvas = this.context.getCanvas();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.context.clear();
        this.wallRenderer.render(this.world, cameraX, cameraY, width, height, this.heatSystem, this.lightBuffer, this.worldMapTexture, performance.now() * 0.001);
    }

    public renderFX(cameraX: number, cameraY: number, width: number, height: number): void {
        if (!this.active) return;
        const gl = this.context.getGL();
        const canvas = this.context.getCanvas();

        // IMPORTANT: Clear the buffer for the FX pass so it only contains transparent FX
        // Otherwise the second compositeToContext will blit the environment again, covering entities.
        gl.viewport(0, 0, canvas.width, canvas.height);
        this.context.clear(false); // Preserve depth buffer for occlusion

        // FX pass: Read from depth (to be behind walls) but don't write to it (to avoid particle-on-particle clipping)
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);

        if (this.fluidSimulation) this.renderFluid(cameraX, cameraY, width, height);
        if (this.particleSystem) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.particleSystem.render(cameraX, cameraY, width, height);
            gl.disable(gl.BLEND);
        }

        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(true);
    }

    private renderFluid(cameraX: number, cameraY: number, width: number, height: number): void {
        const gl = this.context.getGL();
        const tex = this.fluidSimulation.getDensityTexture();
        if (!tex || !this.fluidShader) return;
        this.fluidShader.use();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = this.fluidShader.getAttribLocation("a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        this.fluidShader.setUniform1i("u_densityTex", 0);
        this.fluidShader.setUniform2f("u_camera", cameraX, cameraY);
        this.fluidShader.setUniform2f("u_resolution", width, height);
        this.fluidShader.setUniform2f("u_worldPixels", this.world!.getWidthPixels(), this.world!.getHeightPixels());

        // Fix for premultiplied alpha: Use ONE instead of SRC_ALPHA
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.BLEND);
    }

    public compositeToContext(ctx: CanvasRenderingContext2D): void {
        if (!this.active) return;

        ctx.save();
        // Reset transform to identity to draw in Screen Space
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.context.getCanvas(), 0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
    }

    public isActive(): boolean { return this.active; }
}
