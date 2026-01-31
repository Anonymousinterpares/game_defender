import { GPUContext } from "./GPUContext";
import { World } from "../World";
import { WeatherManager, WeatherType } from "../WeatherManager";
import { Shader } from "./Shader";
import { ConfigManager } from "../../config/MasterConfig";
import { WorldShader } from "./WorldShader";
import { GPUParticleSystem } from "./particles/GPUParticleSystem";
import { FluidSimulation } from "./FluidSimulation";
import { ParticleSystem } from "../ParticleSystem";
import { FluidShader } from "./FluidShader";
import { GPUHeatSystem } from "./heatmap/GPUHeatSystem";
import { GPUWallRenderer } from "./walls/GPUWallRenderer";
import { GPULightBuffer } from "./GPULightBuffer";
import { GPUEntityBuffer } from "./GPUEntityBuffer";
import { LightManager } from "../LightManager";
import { GPULightingSystem } from "./lighting/GPULightingSystem";
import { GPUDeferredLighting } from "./lighting/GPUDeferredLighting";
import { GPUWeatherSystem } from "./particles/GPUWeatherSystem";
import { NoiseTexture } from "./textures/NoiseTexture";
import { WorldClock } from "../WorldClock";
import { ExplosionLibrary } from "../effects/ExplosionLibrary";
import { EventBus, GameEvent } from "../EventBus";

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
    private entityBuffer: GPUEntityBuffer;
    private lightingSystem: GPULightingSystem;
    private deferredLighting: GPUDeferredLighting;
    private weatherSystem: GPUWeatherSystem;
    private noiseTexture: NoiseTexture | null = null;
    private copyShader: Shader | null = null;
    private worldMapTexture: WebGLTexture | null = null;
    private lastWorldWidth: number = -1;
    private lastWorldHeight: number = -1;
    private lastEntityPositions: Map<number, { x: number, y: number }> = new Map();

    public getParticleSystem(): GPUParticleSystem {
        return this.particleSystem;
    }

    public getLightingSystem(): GPULightingSystem {
        return this.lightingSystem;
    }

    public getHeatSystem(): GPUHeatSystem {
        return this.heatSystem;
    }

    public getFluidSimulation(): FluidSimulation {
        return this.fluidSimulation;
    }

    public getWorld(): World | null {
        return this.world;
    }

    private constructor() {
        this.context = new GPUContext();
        this.particleSystem = new GPUParticleSystem();
        this.fluidSimulation = new FluidSimulation();
        this.heatSystem = new GPUHeatSystem();
        this.wallRenderer = new GPUWallRenderer();
        this.lightBuffer = new GPULightBuffer(32);
        this.entityBuffer = new GPUEntityBuffer(32);
        this.lightingSystem = new GPULightingSystem();
        this.deferredLighting = new GPUDeferredLighting();
        this.weatherSystem = new GPUWeatherSystem();
        this.subscribeToEvents();

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
            const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]); // Standard CCW triangles
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        }

        if (!this.copyShader) {
            const vert = `#version 300 es
                layout(location = 0) in vec2 a_position;
                out vec2 v_uv;
                void main() {
                    v_uv = a_position * 0.5 + 0.5;
                    gl_Position = vec4(a_position, 0.0, 1.0);
                }
            `;
            const frag = `#version 300 es
                precision highp float;
                uniform sampler2D u_tex;
                in vec2 v_uv;
                out vec4 outColor;
                void main() {
                    outColor = texture(u_tex, v_uv);
                }
            `;
            this.copyShader = new Shader(gl, vert, frag);
        }

        if (!this.particleSystem['initialized']) this.particleSystem.init(gl);
        if (this.fluidSimulation && !this.fluidSimulation.isInitialized) this.fluidSimulation.init(gl, 256, 256);
        if (this.heatSystem && !this.heatSystem.isInitialized) this.heatSystem.init(gl, 1024, 1024);
        if (this.wallRenderer && !this.wallRenderer['initialized']) this.wallRenderer.init(gl);
        this.lightBuffer.init(gl);
        this.entityBuffer.init(gl);
        if (this.lightingSystem && !this.lightingSystem.isInitialized) {
            // Lighting map resolution: 2048x2048 or world-relative
            this.lightingSystem.init(gl, 1024, 1024);
        }
        if (this.deferredLighting && !this.deferredLighting.isInitialized) {
            this.deferredLighting.init(gl, 1, 1); // Size will be updated on first update()
        }
        if (this.weatherSystem && !this.weatherSystem.initialized && this.world) {
            this.weatherSystem.init(gl, this.world);
        }
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

    private subscribeToEvents(): void {
        const eb = EventBus.getInstance();
        eb.on(GameEvent.EXPLOSION, (data) => {
            if (!this.active) return;
            ExplosionLibrary.spawnStandardExplosion(data.x, data.y, data.radius, 'rocket');
        });
    }

    public setWorld(world: World): void {
        const isNewInstance = this.world !== world;
        this.world = world;
        if (isNewInstance && this.active) {
            console.log("[GPU] New world instance detected, forcing resource refresh.");
            this.handleWorldChange();
            this.lastWorldWidth = world.getWidth();
            this.lastWorldHeight = world.getHeight();
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

    public resetWorld(world: World): void {
        console.log("[GPU] Explicitly resetting world reference and resources...");
        this.world = world;
        if (this.active) {
            this.handleWorldChange();
        }
    }

    public clear(): void {
        if (this.particleSystem) this.particleSystem.clear();
        if (this.fluidSimulation) this.fluidSimulation.clear();
        if (this.heatSystem) this.heatSystem.clear();
        if (this.wallRenderer) this.wallRenderer.clear();
        if (this.weatherSystem) this.weatherSystem.clear();
    }

    private handleWorldChange(): void {
        const gl = this.context.getGL();
        if (!gl || !this.world) return;

        console.log("[GPU] Cleaning up resources for world re-initialization...");
        this.fluidSimulation.cleanup();
        this.heatSystem.cleanup();
        this.lightingSystem.cleanup();
        this.deferredLighting.cleanup();
        this.weatherSystem.cleanup();
        this.wallRenderer.reset();

        // Re-init systems that depend on world scale
        this.fluidSimulation.init(gl, 256, 256);
        this.heatSystem.init(gl, 1024, 1024);
        this.lightingSystem.init(gl, 1024, 1024);
        this.deferredLighting.init(gl, 1, 1);
        this.wallRenderer.init(gl);
        this.wallRenderer.init(gl);
        if (this.world) this.weatherSystem.init(gl, this.world);

        this.noiseTexture = new NoiseTexture(gl);
    }

    public update(dt: number, entities: { x: number, y: number, radius: number, height: number, z?: number }[] = [], cameraX: number = 0, cameraY: number = 0, width: number = 800, height: number = 600): void {
        if (!this.active || !this.particleSystem || !this.world) return;

        this.updateWorldTexture();
        if (this.worldMapTexture) this.particleSystem.setWorldMap(this.worldMapTexture, this.world.getWidth(), this.world.getHeight(), this.world.getTileSize());
        this.particleSystem.setEntities(entities);

        const centerX = cameraX + width / 2;
        const centerY = cameraY + height / 2;
        this.particleSystem.update(dt, performance.now() * 0.001, centerX, centerY);
        this.weatherSystem.update(dt, performance.now() * 0.001);

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

        const lights = LightManager.getInstance().getLights();
        this.lightBuffer.update(lights);

        // Deferred lighting update moved to renderEnvironment() for camera sync
        const useDeferred = ConfigManager.getInstance().get<boolean>('Visuals', 'useDeferredLighting') || false;

        // Update Entity Buffer (Pass nearest entities to GPU for internal shadows)
        this.entityBuffer.update(entities.map(e => ({ x: e.x, y: e.y, radius: e.radius, height: e.height })));

        // SKIP old lighting update if Deferred is active
        if (!useDeferred && this.lightingSystem && this.heatSystem && this.wallRenderer) {
            // CRITICAL: Update the structure map BEFORE the lighting pass.
            // This ensures that if a wall was destroyed this frame, the light flash
            // sees the "hole" and doesn't get occluded by a ghost wall.
            this.wallRenderer.updateStructureMap(this.world);

            const hTex = this.heatSystem.getHeatTexture();
            const sTex = this.wallRenderer.getStructureTexture();
            if (hTex && sTex) {
                this.lightingSystem.update(
                    hTex,
                    this.fluidSimulation ? this.fluidSimulation.getDensityTexture() : null, // Assuming fluidSystem was a typo for fluidSimulation
                    this.heatSystem.getScorchTexture(),
                    sTex,
                    this.world.getWidthPixels(),
                    this.world.getHeightPixels(),
                    cameraX, // Using the passed cameraX
                    cameraY, // Using the passed cameraY
                    width,   // Using the passed width
                    height,  // Using the passed height
                    this.lightBuffer,
                    this.entityBuffer
                );
            }
        }
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

        const useDeferred = ConfigManager.getInstance().get<boolean>('Visuals', 'useDeferredLighting') || false;

        // 1. Setup G-Buffer for Geometry Pass
        if (useDeferred && this.deferredLighting.isInitialized) {
            this.deferredLighting.bindGBuffer();
        } else {
            // If not deferred, ensure we bind backbuffer (or intermediate)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, canvas.width, canvas.height);

            // In Forward mode, we might want to preserve depth if we are compositing? 
            // But usually we clear at start of frame.
            // GPURenderer.update() clears usually? No, renderEnvironment is the first visual pass.
            this.context.clear(true);
        }

        // 2. Render World Geometry (Walls/Ground)
        // This must happen regardless of deferred/forward.
        // If deferred, it writes to G-Buffer. If forward, it writes to Screen.
        // WallRenderer handles shader selection internally via 'u_useDeferred' uniform?
        // Actually WallRenderer.render uses u_useDeferred uniform to switch output mode.
        this.wallRenderer.render(
            this.world!,
            cameraX, cameraY, width, height,
            this.heatSystem,
            this.lightBuffer,
            this.entityBuffer,
            this.worldMapTexture,
            useDeferred ? null : this.lightingSystem, // If deferred, pass null to disable old lighting
            performance.now() * 0.001
        );

        // 3. Deferred Lighting Pass
        if (useDeferred && this.deferredLighting.isInitialized) {
            this.deferredLighting.unbindGBuffer();

            // Prepare State
            const timeState = WorldClock.getInstance().getTimeState();
            const sun = timeState.sun;
            const weather = WeatherManager.getInstance().getWeatherState();
            const snowIntensity = (weather.type === WeatherType.SNOW) ? weather.precipitationIntensity : 0.0;

            // Compute ViewProj
            const left = cameraX, right = cameraX + width, top = cameraY, bottom = cameraY + height;
            const viewProj = new Float32Array([
                2 / (right - left), 0, 0, 0,
                0, 2 / (top - bottom), 0, 0,
                0, 0, -1, 0,
                -(right + left) / (right - left), -(top + bottom) / (top - bottom), 0, 1
            ]);

            // Helper
            const parseColor = (c: string): { r: number, g: number, b: number } => {
                const rgb = c.match(/\d+/g)?.map(Number) || [255, 255, 255];
                return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 };
            };

            // A. Snow/Weather Cover Pass (re-using Directional Light shader logic for snow)
            // Wait, this was calling renderDirectionalLight for EVERYTHING related to Directional + Snow.
            // But deferredLighting.update() ALSO calls renderDirectionalLight inside it?
            // Let's check deferredLighting.update().
            // It processes sun/moon internally.

            // If I call renderDirectionalLight HERE, I am duplicating work or doing a specific "Weather Pass"?
            // The previous code had a specific call for "Snow Cover" using renderDirectionalLight.
            // AND then called deferredLighting.update.
            // If deferredLighting.update handles sun/moon, do I need this manual call?

            // The manual call was passing `noiseTex`. `deferredLighting.update` arguments do NOT include noiseTex.
            // So `deferredLighting.update` -> `renderDirectionalLight` (internal) has no noise tex?
            // AND I modified `renderDirectionalLight` signature to accept `weather`.
            // BUT `deferredLighting.update` signature does NOT accept weather?

            // I should update `deferredLighting.update` signature to accept weather params to avoid duplication.
            // OR I just pass the snow parameters into the update call?

            // For now, to keep it working as designed in the polish phase:
            // I will inject the weather params into the `deferredLighting.update` call.
            // I need to update `GPUDeferredLighting.update` signature first?
            // OR I can just set the texture globally?

            // Actually, the previous code called `renderDirectionalLight` MANUALLY inside GPURenderer.
            // And then called `update`? 
            // If `update` clears the light buffer (`gl.clear(gl.COLOR_BUFFER_BIT)`), then the first manual call is wiped!

            // Let's check `GPUDeferredLighting.renderDirectionalLight`.
            // It calls `gl.clear`.

            // So if I call it manually, then call `update` (which calls it again internally), the first one is lost.

            // CONCLUSION: I must pass weather params to `deferredLighting.update` and let IT handle the call.
            // I will fix `GPURenderer` to call `update` properly with weather context.
            // But `update` signature needs change.

            // FOR THIS STEP: 
            // I will perform the manual call logic BUT I realize it conflicts with `update`.
            // I will assume `deferredLighting.update` is the MAIN entry point.
            // I need to change `GPUDeferredLighting.update` signature.

            // But I am editing `GPURenderer.ts` now.
            // I will leave a comment and pass the weather info to `update` (forcing a signature mismatch I will fix in next step).

            // Wait, I can't break the build.
            // I will use `(this.deferredLighting as any).update(...)` or just modify the file in next step.

            const lights = LightManager.getInstance().getLights();
            this.deferredLighting.resize(width, height);

            // Pass weather data via a new argument (I will update definition next)
            // Actually, let's just piggyback on `sun` object? No, strict types.

            // I'll call update() as is, but I know it won't render snow.
            // CRITICAL: I need to mod `update` signature.

            this.deferredLighting.update(
                cameraX, cameraY, width, height,
                lights, this.world!, timeState.baseAmbient,
                timeState.sun, timeState.moon,
                this.entityBuffer,
                viewProj,
                {
                    snowIntensity: snowIntensity,
                    noiseTex: this.noiseTexture ? this.noiseTexture.getTexture() : null
                }
            );

            // 4. Composite to Screen
            const unlitTex = this.deferredLighting.getGBufferColorTexture();
            if (unlitTex) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Composite to screen
                gl.viewport(0, 0, canvas.width, canvas.height);
                this.context.clear(false);
                this.renderSimpleTexture(unlitTex);
            }

            const lightTex = this.deferredLighting.getResultTexture();
            if (lightTex) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.DST_COLOR, gl.ZERO);
                this.renderSimpleTexture(lightTex);
                gl.disable(gl.BLEND);
            }

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);
            this.deferredLighting.renderEmissive();
            gl.disable(gl.BLEND);
        }
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

        if (this.weatherSystem) {
            // Weather usually covers the screen, but follows camera.
            this.weatherSystem.render(cameraX, cameraY, width, height);
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

    public renderSimpleTexture(tex: WebGLTexture): void {
        const gl = this.context.getGL();
        if (!this.copyShader || !this.quadBuffer) return;

        this.copyShader.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        this.copyShader.setUniform1i("u_tex", 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = this.copyShader.getAttribLocation("a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    public isActive(): boolean { return this.active; }
}
