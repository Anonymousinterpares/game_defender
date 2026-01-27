import { Shader } from "./Shader";
import { FLUID_VERT, FLUID_ADVECT, FLUID_SPLAT, FLUID_DIVERGENCE, FLUID_PRESSURE, FLUID_GRADIENT_SUBTRACT, FLUID_FORCES, FLUID_VORTICITY, FLUID_APPLY_VORTICITY } from "./shaders/fluid.glsl";
import { WeatherManager } from "../WeatherManager";
import { ConfigManager } from "../../config/MasterConfig";

export class FluidSimulation {
    private gl: WebGL2RenderingContext | null = null;
    private width: number = 0;
    private height: number = 0;

    private velocityFBOs: { fbo: WebGLFramebuffer, tex: WebGLTexture }[] = [];
    private densityFBOs: { fbo: WebGLFramebuffer, tex: WebGLTexture }[] = [];
    private pressureFBOs: { fbo: WebGLFramebuffer, tex: WebGLTexture }[] = [];
    private divergenceFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private vorticityFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;

    private advectShader: Shader | null = null;
    private pressureShader: Shader | null = null;
    private divergenceShader: Shader | null = null;
    private subtractShader: Shader | null = null;
    private splatShader: Shader | null = null;
    private forcesShader: Shader | null = null;
    private vorticityShader: Shader | null = null;
    private applyVorticityShader: Shader | null = null;

    private quadBuffer: WebGLBuffer | null = null;
    private velocityIdx: number = 0;
    private densityIdx: number = 0;
    private pressureIdx: number = 0;

    private _initialized = false;

    constructor() { }

    public get isInitialized(): boolean {
        return this._initialized;
    }

    public init(gl: WebGL2RenderingContext, width: number, height: number): void {
        this.gl = gl;
        this.width = width;
        this.height = height;

        const floatExt = gl.getExtension('EXT_color_buffer_float');
        const linearExt = gl.getExtension('OES_texture_float_linear');

        if (!floatExt) console.warn("[GPU] EXT_color_buffer_float not supported. Simulation might fail.");
        if (!linearExt) console.warn("[GPU] OES_texture_float_linear not supported. Rendering will be pixelated.");

        this.velocityFBOs = [this.createFBO(), this.createFBO()];
        this.densityFBOs = [this.createFBO(), this.createFBO()];
        this.pressureFBOs = [this.createFBO(), this.createFBO()];
        this.divergenceFBO = this.createFBO();
        this.vorticityFBO = this.createFBO();

        this.advectShader = new Shader(gl, FLUID_VERT, FLUID_ADVECT);
        this.pressureShader = new Shader(gl, FLUID_VERT, FLUID_PRESSURE);
        this.divergenceShader = new Shader(gl, FLUID_VERT, FLUID_DIVERGENCE);
        this.subtractShader = new Shader(gl, FLUID_VERT, FLUID_GRADIENT_SUBTRACT);
        this.splatShader = new Shader(gl, FLUID_VERT, FLUID_SPLAT);
        this.forcesShader = new Shader(gl, FLUID_VERT, FLUID_FORCES);
        this.vorticityShader = new Shader(gl, FLUID_VERT, FLUID_VORTICITY);
        this.applyVorticityShader = new Shader(gl, FLUID_VERT, FLUID_APPLY_VORTICITY);

        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        this.clear(); // Zero out everything
        this._initialized = true;
    }

    public clear(): void {
        if (!this.gl) return;
        const gl = this.gl;
        gl.viewport(0, 0, this.width, this.height);

        const fbos = [
            ...this.velocityFBOs,
            ...this.densityFBOs,
            ...this.pressureFBOs,
            this.divergenceFBO!,
            this.vorticityFBO!
        ];

        fbos.forEach(f => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        });

        this.velocityIdx = 0;
        this.densityIdx = 0;
        this.pressureIdx = 0;
    }

    private createFBO(): { fbo: WebGLFramebuffer, tex: WebGLTexture } {
        const gl = this.gl!;
        const fbo = gl.createFramebuffer()!;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.width, this.height, 0, gl.RGBA, gl.HALF_FLOAT, null);

        // Fallback to NEAREST if linear isn't supported for float textures
        const filter = gl.getExtension('OES_texture_float_linear') ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error("[GPU] Framebuffer incomplete for fluid simulation");
        }

        return { fbo, tex };
    }

    private renderQuad(): void {
        const gl = this.gl!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    public update(dt: number, worldW: number, worldH: number): void {
        if (!this._initialized) return;
        const gl = this.gl!;

        // Fixed Timestep safety: Ensure dt is not too large or zero
        const safeDt = Math.min(dt, 0.033);
        if (safeDt <= 0) return;

        // Fetch wind and scale factors
        const config = ConfigManager.getInstance();
        const mpt = config.getMetersPerTile();
        const tileSize = config.get<number>('World', 'tileSize');
        const worldWidthMeters = (worldW / tileSize) * mpt;
        const worldHeightMeters = (worldH / tileSize) * mpt;

        const weather = WeatherManager.getInstance().getWeatherState();

        // Phase 2: Physics-to-grid amplification for wind (reduced from 100 to 10 for realistic speed)
        const windScale = 10.0;
        const uvWindX = weather ? (weather.windDir.x * weather.windSpeed * windScale) / worldWidthMeters : 0;
        const uvWindY = weather ? (weather.windDir.y * weather.windSpeed * windScale) / worldHeightMeters : 0;

        // 1. Advection
        // Advect velocity using itself - WITH DRAG (0.99 dissipation)
        this.advect(
            this.velocityFBOs[this.velocityIdx].tex,
            this.velocityFBOs[this.velocityIdx].tex,
            this.velocityFBOs[1 - this.velocityIdx].fbo,
            safeDt, 0.99 // Use 0.99 for velocity drag (air resistance)
        );
        this.velocityIdx = 1 - this.velocityIdx;

        // 4. Advection of Density
        // Phase 1: Increased dissipation from 0.995 to 0.98 for faster smoke decay
        this.advect(
            this.velocityFBOs[this.velocityIdx].tex,
            this.densityFBOs[this.densityIdx].tex,
            this.densityFBOs[1 - this.densityIdx].fbo,
            safeDt, 0.98
        );
        this.densityIdx = 1 - this.densityIdx;

        // 2. Forces (Buoyancy + Wind)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1 - this.velocityIdx].fbo);
        this.forcesShader!.use();
        this.forcesShader!.setUniform1f("u_dt", safeDt);
        this.forcesShader!.setUniform1f("u_time", performance.now() * 0.001);
        this.forcesShader!.setUniform2f("u_wind", uvWindX, uvWindY);
        // Phase 4: Increased from 0.5 to 5.0 for stronger buoyancy
        this.forcesShader!.setUniform1f("u_buoyancy", 5.0 / worldHeightMeters);
        this.forcesShader!.setUniform1i("u_velocity", 0);
        this.forcesShader!.setUniform1i("u_density", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[this.velocityIdx].tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.densityFBOs[this.densityIdx].tex);
        this.renderQuad();
        this.velocityIdx = 1 - this.velocityIdx;

        // 3. Vorticity Confinement
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.vorticityFBO!.fbo);
        this.vorticityShader!.use();
        this.vorticityShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.vorticityShader!.setUniform1i("u_velocity", 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[this.velocityIdx].tex);
        this.renderQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1 - this.velocityIdx].fbo);
        this.applyVorticityShader!.use();
        this.applyVorticityShader!.setUniform1f("u_dt", safeDt);
        this.applyVorticityShader!.setUniform1f("u_curl", 30.0); // Confinement strength
        this.applyVorticityShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.applyVorticityShader!.setUniform1i("u_velocity", 0);
        this.applyVorticityShader!.setUniform1i("u_vorticity", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[this.velocityIdx].tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.vorticityFBO!.tex);
        this.renderQuad();
        this.velocityIdx = 1 - this.velocityIdx;

        // 4. Divergence
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergenceFBO!.fbo);
        this.divergenceShader!.use();
        this.divergenceShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.divergenceShader!.setUniform1i("u_velocity", 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[this.velocityIdx].tex);
        this.renderQuad();

        // 5. Jacobi Pressure
        for (let i = 0; i < 20; i++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressureFBOs[1 - this.pressureIdx].fbo);
            this.pressureShader!.use();
            this.pressureShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
            this.pressureShader!.setUniform1i("u_pressure", 0);
            this.pressureShader!.setUniform1i("u_divergence", 1);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressureFBOs[this.pressureIdx].tex);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.divergenceFBO!.tex);
            this.renderQuad();
            this.pressureIdx = 1 - this.pressureIdx;
        }

        // 6. Subtract Gradient
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1 - this.velocityIdx].fbo);
        this.subtractShader!.use();
        this.subtractShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.subtractShader!.setUniform1i("u_pressure", 0);
        this.subtractShader!.setUniform1i("u_velocity", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressureFBOs[this.pressureIdx].tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[this.velocityIdx].tex);
        this.renderQuad();
        this.velocityIdx = 1 - this.velocityIdx;

        // Cleanup: Unbind framebuffer and textures to prevent state leaks/flickering
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.useProgram(null);
        gl.bindVertexArray(null);
    }

    private advect(vel: WebGLTexture, src: WebGLTexture, dest: WebGLFramebuffer, dt: number, dissipation: number): void {
        const gl = this.gl!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
        this.advectShader!.use();
        this.advectShader!.setUniform1f("u_dt", dt);
        this.advectShader!.setUniform1f("u_dissipation", dissipation);
        this.advectShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.advectShader!.setUniform1i("u_velocity", 0);
        this.advectShader!.setUniform1i("u_source", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src);
        this.renderQuad();
    }

    public splat(x: number, y: number, radius: number, r: number, g: number, b: number, worldW: number, worldH: number): void {
        if (!this.gl) return;
        const debug = ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug');
        const gl = this.gl;

        const uvX = x / worldW;
        const uvY = 1.0 - (y / worldH);

        // PROTECTION: Skip splat if coordinates or parameters are invalid (Infinity/NaN)
        if (!Number.isFinite(uvX) || !Number.isFinite(uvY) || !Number.isFinite(radius) || !Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
            return;
        }

        // Atomic Viewport: Simulation happens in grid space
        gl.viewport(0, 0, this.width, this.height);

        // FIXED ACCUMULATION: Read from current idx, write to 1-idx, then toggle
        // This ensures consecutive splats in same frame accumulate instead of overwrite
        const srcIdx = this.densityIdx;
        const dstIdx = 1 - srcIdx;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityFBOs[dstIdx].fbo);
        this.splatShader!.use();

        if (debug) console.log(`[GPU] Fluid Splat UV: (${uvX.toFixed(3)}, ${uvY.toFixed(3)})`);

        this.splatShader!.setUniform2f("u_point", uvX, uvY);
        this.splatShader!.setUniform1f("u_radius", radius); // Now in pixels
        this.splatShader!.setUniform2f("u_worldPixels", worldW, worldH);
        this.splatShader!.setUniform1i("u_source", 0);
        this.splatShader!.setUniform4f("u_color", r, g, b, 1.0);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.densityFBOs[srcIdx].tex);
        this.renderQuad();

        // Toggle so next splat reads from output of this one
        this.densityIdx = dstIdx;

        // SANITY SHIELD CLEANUP: No leaking state
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.useProgram(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.disableVertexAttribArray(0);
    }

    public splatVelocity(x: number, y: number, radius: number, vx: number, vy: number, worldW: number, worldH: number): void {
        if (!this.gl) return;
        const gl = this.gl;

        const uvX = x / worldW;
        const uvY = 1.0 - (y / worldH);

        if (!Number.isFinite(uvX) || !Number.isFinite(uvY) || !Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(radius)) {
            return;
        }

        // Atomic Viewport: Simulation happens in grid space
        gl.viewport(0, 0, this.width, this.height);

        // FIXED ACCUMULATION: Read from current idx, write to 1-idx, then toggle
        const srcIdx = this.velocityIdx;
        const dstIdx = 1 - srcIdx;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[dstIdx].fbo);
        this.splatShader!.use();

        this.splatShader!.setUniform2f("u_point", uvX, uvY);
        this.splatShader!.setUniform1f("u_radius", radius);
        this.splatShader!.setUniform2f("u_worldPixels", worldW, worldH);
        this.splatShader!.setUniform1i("u_source", 0);
        // VELOCITY MUST BE IN UV UNITS PER SECOND for the advection shader
        this.splatShader!.setUniform4f("u_color", vx / worldW, -vy / worldH, 0.0, 1.0);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[srcIdx].tex);
        this.renderQuad();

        // Toggle so next splat reads from output of this one
        this.velocityIdx = dstIdx;

        // SANITY SHIELD CLEANUP
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.useProgram(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.disableVertexAttribArray(0);
    }

    public getDensityTexture(): WebGLTexture | null {
        return this._initialized ? this.densityFBOs[this.densityIdx].tex : null;
    }

    public cleanup(): void {
        if (!this._initialized || !this.gl) return;
        const gl = this.gl;

        const fbos = [
            ...this.velocityFBOs,
            ...this.densityFBOs,
            ...this.pressureFBOs,
            this.divergenceFBO,
            this.vorticityFBO
        ];

        fbos.forEach(f => {
            if (f) {
                gl.deleteFramebuffer(f.fbo);
                gl.deleteTexture(f.tex);
            }
        });

        this.velocityFBOs = [];
        this.densityFBOs = [];
        this.pressureFBOs = [];
        this.divergenceFBO = null;
        this.vorticityFBO = null;

        [this.advectShader, this.pressureShader, this.divergenceShader, this.subtractShader, this.splatShader, this.forcesShader, this.vorticityShader, this.applyVorticityShader].forEach(s => {
            if (s) s.dispose();
        });

        if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);

        this._initialized = false;
    }
}
