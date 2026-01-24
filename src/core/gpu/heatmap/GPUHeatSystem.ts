import { HeatShaderManager } from "./HeatShaderManager";

export class GPUHeatSystem {
    private gl: WebGL2RenderingContext | null = null;
    private width: number = 0;
    private height: number = 0;

    private heatFBOs: { fbo: WebGLFramebuffer, tex: WebGLTexture }[] = [];
    private heatIdx: number = 0;

    private shaders: HeatShaderManager | null = null;
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

        // Ensure float textures are supported
        const floatExt = gl.getExtension('EXT_color_buffer_float');
        if (!floatExt) {
            console.warn("[GPU Heat] EXT_color_buffer_float not supported. Simulation might fail.");
        }

        this.heatFBOs = [this.createFBO(), this.createFBO()];
        this.shaders = new HeatShaderManager(gl);

        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        this.clear();
        this._initialized = true;
    }

    private createFBO(): { fbo: WebGLFramebuffer, tex: WebGLTexture } {
        const gl = this.gl!;
        const fbo = gl.createFramebuffer()!;
        const tex = gl.createTexture()!;

        gl.bindTexture(gl.TEXTURE_2D, tex);
        // Use R16F for high precision and efficiency
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, this.width, this.height, 0, gl.RED, gl.HALF_FLOAT, null);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error("[GPU Heat] Framebuffer incomplete");
        }

        return { fbo, tex };
    }

    public clear(): void {
        if (!this.gl) return;
        const gl = this.gl;
        gl.viewport(0, 0, this.width, this.height);

        this.heatFBOs.forEach(f => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        });

        this.heatIdx = 0;
    }

    private renderQuad(): void {
        const gl = this.gl!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    public update(dt: number): void {
        if (!this._initialized || !this.gl || !this.shaders) return;
        const gl = this.gl;

        const srcIdx = this.heatIdx;
        const dstIdx = 1 - srcIdx;

        gl.viewport(0, 0, this.width, this.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.heatFBOs[dstIdx].fbo);

        const shader = this.shaders.updateShader;
        shader.use();

        shader.setUniform1f("u_dt", dt);
        shader.setUniform1f("u_spreadRate", 0.15); // Increased slightly for faster spread
        shader.setUniform1f("u_decayRate", 0.012); // Tuned for longer-lasting heat
        shader.setUniform2f("u_texelSize", 1.0 / this.width, 1.0 / this.height);

        shader.setUniform1i("u_heatIn", 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.heatFBOs[srcIdx].tex);

        this.renderQuad();

        this.heatIdx = dstIdx;

        // Cleanup
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public splatHeat(x: number, y: number, radius: number, intensity: number, worldW: number, worldH: number): void {
        if (!this._initialized || !this.gl || !this.shaders) return;
        const gl = this.gl;

        const uvX = x / worldW;
        const uvY = 1.0 - (y / worldH);

        if (!Number.isFinite(uvX) || !Number.isFinite(uvY)) return;

        const srcIdx = this.heatIdx;
        const dstIdx = 1 - srcIdx;

        gl.viewport(0, 0, this.width, this.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.heatFBOs[dstIdx].fbo);

        const shader = this.shaders.splatShader;
        shader.use();

        shader.setUniform2f("u_point", uvX, uvY);
        shader.setUniform1f("u_radius", radius); // Now in pixels
        shader.setUniform1f("u_amount", intensity);
        shader.setUniform2f("u_worldPixels", worldW, worldH);

        shader.setUniform1i("u_heatIn", 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.heatFBOs[srcIdx].tex);

        this.renderQuad();

        this.heatIdx = dstIdx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // EXTRA STEP: Synchronize the FBOs to prevent losing multi-splat data
        // For heat, we can just copy the new state to both if multiple splats occur?
        // Better: splat everything to ONE target using Additive Blending if possible.
        // But since we use capped accumulation, we keep ping-pong.
        // To fix multi-splat, we should really do one toggle per frame, not per splat.
        // However, for now, we'll sync by drawing to the source in the next pass.
    }

    public getHeatTexture(): WebGLTexture | null {
        return this._initialized ? this.heatFBOs[this.heatIdx].tex : null;
    }

    public getShaderManager(): HeatShaderManager | null {
        return this.shaders;
    }
}
