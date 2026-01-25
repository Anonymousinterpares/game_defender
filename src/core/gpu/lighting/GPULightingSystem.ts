import { Shader } from "../Shader";
import {
    LIGHTING_VERT,
    EMISSIVE_PASS_FRAG,
    OCCLUDER_PASS_FRAG,
    JFA_INIT_FRAG,
    JFA_STEP_FRAG,
    SDF_FINAL_FRAG
} from "./shaders/lighting.glsl";
import { GPULightBuffer } from "../GPULightBuffer";
import { GPUEntityBuffer } from "../GPUEntityBuffer";

export class GPULightingSystem {
    private gl: WebGL2RenderingContext | null = null;
    private width: number = 0;
    private height: number = 0;

    // FBOs
    private emissiveFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private occluderFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private jfaFBOs: { fbo: WebGLFramebuffer, tex: WebGLTexture }[] = [];
    private sdfFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;

    // Shaders
    private emissiveShader: Shader | null = null;
    private occluderShader: Shader | null = null;
    private jfaInitShader: Shader | null = null;
    private jfaStepShader: Shader | null = null;
    private sdfFinalShader: Shader | null = null;

    private quadBuffer: WebGLBuffer | null = null;
    private _initialized = false;

    public get isInitialized(): boolean { return this._initialized; }

    constructor() { }

    public init(gl: WebGL2RenderingContext, width: number, height: number): void {
        this.gl = gl;
        this.width = width;
        this.height = height;

        // Ensure float extensions
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');

        // Shaders
        this.emissiveShader = new Shader(gl, LIGHTING_VERT, EMISSIVE_PASS_FRAG);
        this.occluderShader = new Shader(gl, LIGHTING_VERT, OCCLUDER_PASS_FRAG);
        this.jfaInitShader = new Shader(gl, LIGHTING_VERT, JFA_INIT_FRAG);
        this.jfaStepShader = new Shader(gl, LIGHTING_VERT, JFA_STEP_FRAG);
        this.sdfFinalShader = new Shader(gl, LIGHTING_VERT, SDF_FINAL_FRAG);

        // FBOs
        // JFA needs Float32 to store exact coordinates reliably
        this.emissiveFBO = this.createFBO(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
        this.occluderFBO = this.createFBO(gl, width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
        this.jfaFBOs = [
            this.createFBO(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT),
            this.createFBO(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT)
        ];
        this.sdfFBO = this.createFBO(gl, width, height, gl.R16F, gl.RED, gl.HALF_FLOAT);

        // Quad
        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        this._initialized = true;
    }

    private createFBO(gl: WebGL2RenderingContext, w: number, h: number, internalFormat: number, format: number, type: number): { fbo: WebGLFramebuffer, tex: WebGLTexture } {
        const fbo = gl.createFramebuffer()!;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, tex };
    }

    public update(
        heatTex: WebGLTexture,
        fluidTex: WebGLTexture | null,
        scorchTex: WebGLTexture | null, // Added Scorch Texture
        structureTex: WebGLTexture,
        worldPixelsW: number,
        worldPixelsH: number,
        lightBuffer: GPULightBuffer,
        entityBuffer: GPUEntityBuffer
    ): void {
        if (!this._initialized || !this.gl) return;
        const gl = this.gl;

        gl.viewport(0, 0, this.width, this.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // 1. Emissive Pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.emissiveFBO!.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.emissiveShader!.use();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heatTex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, structureTex);
        if (fluidTex) {
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fluidTex);
            this.emissiveShader!.setUniform1i("u_fluidTexture", 2);
        } else {
            // Bind heatTex as placeholder if no fluid (safe fallback)
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, heatTex);
            this.emissiveShader!.setUniform1i("u_fluidTexture", 0);
        }

        if (scorchTex) {
            gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, scorchTex);
            this.emissiveShader!.setUniform1i("u_scorchTexture", 3);
        } else {
            gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, structureTex);
            this.emissiveShader!.setUniform1i("u_scorchTexture", 1);
        }

        this.emissiveShader!.setUniform1i("u_heatTexture", 0);
        this.emissiveShader!.setUniform1i("u_structureMap", 1);
        this.emissiveShader!.setUniform2f("u_worldPixels", worldPixelsW, worldPixelsH);
        lightBuffer.bind(this.emissiveShader!.getProgram(), "LightBlock", 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // 2. Occluder Pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.occluderFBO!.fbo);
        this.occluderShader!.use();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, structureTex);
        this.occluderShader!.setUniform1i("u_structureMap", 0);
        this.occluderShader!.setUniform2f("u_worldPixels", worldPixelsW, worldPixelsH);
        entityBuffer.bind(this.occluderShader!.getProgram(), "EntityBlock", 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // 3. JFA Init
        let pingPong = 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaFBOs[pingPong].fbo);
        this.jfaInitShader!.use();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.occluderFBO!.tex);
        this.jfaInitShader!.setUniform1i("u_occluderMap", 0);
        this.jfaInitShader!.setUniform2f("u_resolution", this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // 4. JFA Steps
        this.jfaStepShader!.use();
        this.jfaStepShader!.setUniform2f("u_resolution", this.width, this.height);
        let step = Math.max(this.width, this.height) / 2;
        while (step >= 1.0) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.jfaFBOs[1 - pingPong].fbo);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.jfaFBOs[pingPong].tex);
            this.jfaStepShader!.setUniform1i("u_source", 0);
            this.jfaStepShader!.setUniform1f("u_step", step);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            pingPong = 1 - pingPong;
            step /= 2.0;
        }

        // 5. SDF Final
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sdfFBO!.fbo);
        this.sdfFinalShader!.use();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.jfaFBOs[pingPong].tex);
        this.sdfFinalShader!.setUniform1i("u_jfa", 0);
        this.sdfFinalShader!.setUniform2f("u_resolution", this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public getEmissiveTexture(): WebGLTexture | null { return this.emissiveFBO?.tex || null; }
    public getSDFTexture(): WebGLTexture | null { return this.sdfFBO?.tex || null; }
}
