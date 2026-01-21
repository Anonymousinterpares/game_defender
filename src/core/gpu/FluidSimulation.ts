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

    private clear(): void {
        const gl = this.gl!;
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

        gl.viewport(0, 0, this.width, this.height);

        // Fetch wind
        const weather = WeatherManager.getInstance().getWeatherState();
        const windX = weather ? weather.windDir.x * weather.windSpeed : 0;
        const windY = weather ? weather.windDir.y * weather.windSpeed : 0;

        // 1. Advection
        this.advect(this.velocityFBOs[0].tex, this.velocityFBOs[0].tex, this.velocityFBOs[1].fbo, safeDt, 1.0);
        this.velocityFBOs.reverse();
        this.advect(this.velocityFBOs[0].tex, this.densityFBOs[0].tex, this.densityFBOs[1].fbo, safeDt, 0.992);
        this.densityFBOs.reverse();

        // 2. Forces (Buoyancy + Wind)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1].fbo);
        this.forcesShader!.use();
        this.forcesShader!.setUniform1f("u_dt", safeDt);
        this.forcesShader!.setUniform2f("u_wind", windX, windY);
        this.forcesShader!.setUniform2f("u_worldSize", worldW, worldH);
        this.forcesShader!.setUniform1i("u_velocity", 0);
        this.forcesShader!.setUniform1i("u_density", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[0].tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.densityFBOs[0].tex);
        this.renderQuad();
        this.velocityFBOs.reverse();

        // 3. Vorticity Confinement
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.vorticityFBO!.fbo);
        this.vorticityShader!.use();
        this.vorticityShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.vorticityShader!.setUniform1i("u_velocity", 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[0].tex);
        this.renderQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1].fbo);
        this.applyVorticityShader!.use();
        this.applyVorticityShader!.setUniform1f("u_dt", safeDt);
        this.applyVorticityShader!.setUniform1f("u_curl", 30.0); // Confinement strength
        this.applyVorticityShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.applyVorticityShader!.setUniform1i("u_velocity", 0);
        this.applyVorticityShader!.setUniform1i("u_vorticity", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[0].tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.vorticityFBO!.tex);
        this.renderQuad();
        this.velocityFBOs.reverse();

        // 4. Divergence
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergenceFBO!.fbo);
        this.divergenceShader!.use();
        this.divergenceShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.divergenceShader!.setUniform1i("u_velocity", 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[0].tex);
        this.renderQuad();

        // 5. Jacobi Pressure
        for (let i = 0; i < 20; i++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressureFBOs[1].fbo);
            this.pressureShader!.use();
            this.pressureShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
            this.pressureShader!.setUniform1i("u_pressure", 0);
            this.pressureShader!.setUniform1i("u_divergence", 1);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressureFBOs[0].tex);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.divergenceFBO!.tex);
            this.renderQuad();
            this.pressureFBOs.reverse();
        }

        // 6. Subtract Gradient
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1].fbo);
        this.subtractShader!.use();
        this.subtractShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.subtractShader!.setUniform1i("u_pressure", 0);
        this.subtractShader!.setUniform1i("u_velocity", 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pressureFBOs[0].tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[0].tex);
        this.renderQuad();
        this.velocityFBOs.reverse();

        // Cleanup: Unbind framebuffer to return to main drawing target
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
        const debug = ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug');
        const gl = this.gl!;
        gl.viewport(0, 0, this.width, this.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityFBOs[1].fbo);
        this.splatShader!.use();

        const uvX = x / worldW;
        const uvY = 1.0 - (y / worldH);
        if (debug) console.log(`[GPU] Fluid Splat UV: (${uvX.toFixed(3)}, ${uvY.toFixed(3)})`);

        this.splatShader!.setUniform2f("u_point", uvX, uvY);

        // Scale radius to grid size: 1.0 in world is 1/worldW in UV. 
        // We want radius in grid texels, but Gaussian shader expects (UV_dist^2 / radius_factor).
        // A radius of 0.005 in UV space is approx 1.28 texels in a 256 grid.
        const uvRadius = (radius / worldW) * 500.0; // Boosted factor for visibility
        this.splatShader!.setUniform1f("u_radius", uvRadius);

        this.splatShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.splatShader!.setUniform1i("u_source", 0);
        this.splatShader!.setUniform4f("u_color", r, g, b, 1.0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.densityFBOs[0].tex);
        this.renderQuad();
        this.densityFBOs.reverse();

        // Cleanup
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public splatVelocity(x: number, y: number, radius: number, vx: number, vy: number, worldW: number, worldH: number): void {
        const gl = this.gl!;
        gl.viewport(0, 0, this.width, this.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocityFBOs[1].fbo);
        this.splatShader!.use();
        this.splatShader!.setUniform2f("u_point", x / worldW, 1.0 - (y / worldH));

        const uvRadius = (radius / worldW) * 500.0;
        this.splatShader!.setUniform1f("u_radius", uvRadius);
        this.splatShader!.setUniform2f("u_texelSize", 1 / this.width, 1 / this.height);
        this.splatShader!.setUniform1i("u_source", 0);

        // Normalize velocity injection: vx is pixels/sec. 
        // We convert to UV/sec (vx/worldW).
        this.splatShader!.setUniform4f("u_color", vx / worldW, -vy / worldH, 0.0, 1.0);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velocityFBOs[0].tex);
        this.renderQuad();
        this.velocityFBOs.reverse();

        // Cleanup
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public getDensityTexture(): WebGLTexture | null {
        return this._initialized ? this.densityFBOs[0].tex : null;
    }
}
