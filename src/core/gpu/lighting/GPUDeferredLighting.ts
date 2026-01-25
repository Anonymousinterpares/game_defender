import { Shader } from "../Shader";
import { DEFERRED_VERT, DEFERRED_AMBIENT_FRAG, DEFERRED_COMPOSE_FRAG, DEFERRED_LIGHT_FRAG, DEFERRED_SHADOW_VERT, DEFERRED_SHADOW_FRAG } from "./shaders/deferred.glsl";
import { ShadowVolumeGenerator, Point } from "./ShadowVolumeGenerator";
import { LightSource } from "../../LightManager";

export class GPUDeferredLighting {
    private gl: WebGL2RenderingContext | null = null;
    private _initialized = false;
    private width: number = 0;
    private height: number = 0;

    private accumulationFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private tempLightFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private bloomFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;

    private ambientShader: Shader | null = null;
    private lightShader: Shader | null = null;
    private shadowShader: Shader | null = null;
    private composeShader: Shader | null = null;
    private shadowBuffer: WebGLBuffer | null = null;
    private quadBuffer: WebGLBuffer | null = null;

    constructor() { }

    public get isInitialized(): boolean {
        return this._initialized;
    }

    public init(gl: WebGL2RenderingContext, width: number, height: number): void {
        this.gl = gl;
        this.width = width;
        this.height = height;

        // Create FBOs
        this.accumulationFBO = this.createFBO(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
        this.tempLightFBO = this.createFBO(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
        this.bloomFBO = this.createFBO(gl, width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);

        // Create Shaders
        this.ambientShader = new Shader(gl, DEFERRED_VERT, DEFERRED_AMBIENT_FRAG);
        this.lightShader = new Shader(gl, DEFERRED_VERT, DEFERRED_LIGHT_FRAG);
        this.shadowShader = new Shader(gl, DEFERRED_SHADOW_VERT, DEFERRED_SHADOW_FRAG);
        this.composeShader = new Shader(gl, DEFERRED_VERT, DEFERRED_COMPOSE_FRAG);

        // Quad
        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        // Shadow Polygon Buffer (Dynamic)
        this.shadowBuffer = gl.createBuffer();

        console.log("[GPU Deferred] Pipeline Initialized (Phase 1)");
        this._initialized = true;
    }

    public resize(width: number, height: number): void {
        if (!this.gl || (this.width === width && this.height === height)) return;

        console.log(`[GPU Deferred] Resizing to ${width}x${height}`);
        this.width = width;
        this.height = height;

        // Cleanup old FBOs
        [this.accumulationFBO, this.tempLightFBO, this.bloomFBO].forEach(f => {
            if (f) {
                this.gl!.deleteFramebuffer(f.fbo);
                this.gl!.deleteTexture(f.tex);
            }
        });

        // Recreate at new size
        this.accumulationFBO = this.createFBO(this.gl!, width, height, this.gl!.RGBA16F, this.gl!.RGBA, this.gl!.HALF_FLOAT);
        this.tempLightFBO = this.createFBO(this.gl!, width, height, this.gl!.RGBA16F, this.gl!.RGBA, this.gl!.HALF_FLOAT);
        this.bloomFBO = this.createFBO(this.gl!, width, height, this.gl!.RGBA16F, this.gl!.RGBA, this.gl!.HALF_FLOAT);
    }

    private createFBO(gl: WebGL2RenderingContext, w: number, h: number, internalFormat: number, format: number, type: number): { fbo: WebGLFramebuffer, tex: WebGLTexture } {
        const fbo = gl.createFramebuffer()!;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, tex };
    }

    public update(
        cameraX: number,
        cameraY: number,
        width: number,
        height: number,
        lights: LightSource[],
        segments: { a: Point, b: Point }[],
        ambientColor: string
    ): void {
        if (!this._initialized || !this.gl) return;
        const gl = this.gl;

        // 1. Fill Accumulation with Ambient
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFBO!.fbo);
        gl.viewport(0, 0, this.width, this.height);
        this.ambientShader!.use();
        const amb = this.parseColor(ambientColor);
        this.ambientShader!.setUniform3f("u_ambientColor", amb[0], amb[1], amb[2]);
        this.renderQuad();

        // 2. Clear Bloom (for later phases)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO!.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 3. Process each light
        lights.forEach(light => {
            if (light.intensity <= 0 || light.radius <= 0) return;

            // Convert world to screen coordinates
            const screenLPos = { x: light.x - cameraX, y: light.y - cameraY };

            // Render light into Temp Buffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.tempLightFBO!.fbo);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            this.lightShader!.use();
            this.lightShader!.setUniform2f("u_resolution", this.width, this.height);
            this.lightShader!.setUniform2f("u_lightPos", screenLPos.x, screenLPos.y);
            const lColor = this.parseColor(light.color);
            this.lightShader!.setUniform3f("u_lightColor", lColor[0], lColor[1], lColor[2]);
            this.lightShader!.setUniform1f("u_lightIntensity", light.intensity);
            this.lightShader!.setUniform1f("u_lightRadius", light.radius);
            this.renderQuad();

            // 4. Punch out Shadow Volumes
            if (light.castsShadows !== false) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
                this.shadowShader!.use();
                this.shadowShader!.setUniform2f("u_resolution", this.width, this.height);

                for (const seg of segments) {
                    // Culling: Only shadow for segments near the light
                    const dx = ((seg.a.x + seg.b.x) / 2) - light.x;
                    const dy = ((seg.a.y + seg.b.y) / 2) - light.y;
                    if (dx * dx + dy * dy > (light.radius * 1.5) * (light.radius * 1.5)) continue;

                    const screenA = { x: seg.a.x - cameraX, y: seg.a.y - cameraY };
                    const screenB = { x: seg.b.x - cameraX, y: seg.b.y - cameraY };

                    const volume = ShadowVolumeGenerator.getShadowVolumeFromSegment(screenLPos, screenA, screenB, light.radius);
                    if (volume) {
                        this.renderShadowPolygon(volume.vertices);
                    }
                }
                gl.disable(gl.BLEND);
            }

            // 5. Accumulate into main buffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFBO!.fbo);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE); // Additive

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.tempLightFBO!.tex);
            this.composeShader!.use();
            this.composeShader!.setUniform1i("u_accumulationTex", 0);
            this.composeShader!.setUniform1i("u_bloomTex", 1); // Not used yet
            this.renderQuad();
            gl.disable(gl.BLEND);
        });

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    private parseColor(color: string): [number, number, number] {
        if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            if (matches) return [parseInt(matches[0]) / 255, parseInt(matches[1]) / 255, parseInt(matches[2]) / 255];
        } else if (color.startsWith('#')) {
            return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255];
        } else {
            // Named colors fallback
            const ctx = document.createElement('canvas').getContext('2d')!;
            ctx.fillStyle = color;
            const hex = ctx.fillStyle; // converts to hex
            if (hex.startsWith('#')) return this.parseColor(hex);
        }
        return [1, 1, 1];
    }

    private renderShadowPolygon(vertices: Point[]): void {
        const gl = this.gl!;
        const data = new Float32Array(vertices.length * 2);
        for (let i = 0; i < vertices.length; i++) {
            data[i * 2] = vertices[i].x;
            data[i * 2 + 1] = vertices[i].y;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, vertices.length);
    }

    private renderQuad(): void {
        const gl = this.gl!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    public getResultTexture(): WebGLTexture | null {
        if (!this._initialized) return null;
        return this.accumulationFBO!.tex;
    }

    public cleanup(): void {
        if (!this._initialized || !this.gl) return;
        const gl = this.gl;
        [this.accumulationFBO, this.tempLightFBO, this.bloomFBO].forEach(f => {
            if (f) {
                gl.deleteFramebuffer(f.fbo);
                gl.deleteTexture(f.tex);
            }
        });
    }
}
