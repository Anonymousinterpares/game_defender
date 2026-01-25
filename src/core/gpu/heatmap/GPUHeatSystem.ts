import { HeatShaderManager } from "./HeatShaderManager";
import { ConfigManager } from "../../../config/MasterConfig";

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

        // 1. Flip buffers
        const srcIdx = this.heatIdx;
        const dstIdx = 1 - srcIdx;

        gl.viewport(0, 0, this.width, this.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.heatFBOs[dstIdx].fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const shader = this.shaders.updateShader;
        shader.use();

        shader.setUniform1f("u_dt", dt);
        shader.setUniform1f("u_spreadRate", 0.15);
        shader.setUniform1f("u_decayRate", 1.5); // Fast decay: 1.0 -> 0.0 in ~0.66s
        shader.setUniform2f("u_texelSize", 1.0 / this.width, 1.0 / this.height);

        shader.setUniform1i("u_heatIn", 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.heatFBOs[srcIdx].tex);

        gl.disable(gl.BLEND);
        this.renderQuad();

        this.heatIdx = dstIdx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Splats heat into the current FBO.
     * x, y in world pixels. amount 0..1, radius in pixels.
     */
    public splatHeat(x: number, y: number, amount: number, radius: number, worldW: number, worldH: number): void {
        if (!this._initialized || !this.gl || !this.shaders) return;
        const gl = this.gl;

        const uvX = x / worldW;
        const uvY = 1.0 - (y / worldH);

        if (!Number.isFinite(uvX) || !Number.isFinite(uvY)) return;

        // Standardized safety clamping: relaxed to 3.0 to allow for "Hot Core" persistence
        const safeAmount = Math.min(3.0, Math.max(0.0, amount));
        const safeRadius = Math.max(1.0, radius);

        // Forced logs to console.error to bypass any default filters
        if (ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug')) {
            console.error(`[GPU Heat] SPLAT: pos=(${x.toFixed(0)}, ${y.toFixed(0)}) scale=(${worldW}x${worldH}) amount=${safeAmount.toFixed(2)} radius=${safeRadius.toFixed(0)}`);
        }

        gl.viewport(0, 0, this.width, this.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.heatFBOs[this.heatIdx].fbo);

        // Blending MUST be additive for multiple events per frame
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        const shader = this.shaders.splatShader;
        shader.use();

        // MATCHING SHADER UNIFORMS IN heat.glsl.ts
        shader.setUniform2f("u_point", uvX, uvY);
        shader.setUniform1f("u_radius", safeRadius);
        shader.setUniform1f("u_amount", safeAmount);
        shader.setUniform2f("u_worldPixels", worldW, worldH);

        this.renderQuad();
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public getHeatTexture(): WebGLTexture | null {
        return this._initialized ? this.heatFBOs[this.heatIdx].tex : null;
    }
}
