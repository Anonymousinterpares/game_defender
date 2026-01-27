import { Shader } from "../Shader";
import { DEFERRED_VERT, DEFERRED_AMBIENT_FRAG, DEFERRED_COMPOSE_FRAG, DEFERRED_LIGHT_FRAG, DEFERRED_SHADOW_VERT, DEFERRED_SHADOW_FRAG, DEFERRED_DIRECTIONAL_FRAG, DEFERRED_EMISSIVE_FRAG } from "./shaders/deferred.glsl";
import { SHADOW_EXTRUSION_VERT, SHADOW_EXTRUSION_FRAG } from "./shaders/shadow_extrusion.glsl";
import { ShadowVolumeGenerator, Point } from "./ShadowVolumeGenerator";
import { LightSource } from "../../LightManager";
import { GPUEntityBuffer } from "../GPUEntityBuffer";
import { ConfigManager } from "../../../config/MasterConfig";
import { World } from "../../World";

interface PointLightShadowCache {
    batchData: Float32Array;
    lastLightPos: { x: number, y: number };
    lastLocalVersion: number;
}

interface DirectionalShadowCache {
    batchData: Float32Array;
    lastDirection: { x: number, y: number };
    lastVersion: number;
    lastViewport: { x: number, y: number, w: number, h: number };
}

export class GPUDeferredLighting {
    private gl: WebGL2RenderingContext | null = null;
    private _initialized = false;
    private width: number = 0;
    private height: number = 0;

    private accumulationFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private tempLightFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private bloomFBO: { fbo: WebGLFramebuffer, tex: WebGLTexture } | null = null;
    private gBufferFBO: { fbo: WebGLFramebuffer, colorTex: WebGLTexture, normalTex: WebGLTexture, depthRB: WebGLRenderbuffer } | null = null;

    private ambientShader: Shader | null = null;
    private lightShader: Shader | null = null;
    private shadowShader: Shader | null = null;
    private composeShader: Shader | null = null;
    private directionalShader: Shader | null = null;
    private emissiveShader: Shader | null = null;
    private shadowExtrusionShader: Shader | null = null;
    private shadowBuffer: WebGLBuffer | null = null;
    private quadBuffer: WebGLBuffer | null = null;

    // Static GPU Shadow Buffer (AAA Optimization)
    private staticShadowBuffer: WebGLBuffer | null = null;
    private staticShadowCount: number = 0;
    private lastStaticMeshVersion: number = -1;

    // Batched shadow rendering
    private shadowBatchData: Float32Array = new Float32Array(0);
    private shadowBatchOffset: number = 0;
    private readonly MAX_SHADOW_VERTICES = 100000; // ~50K triangles max
    private readonly MAX_SHADOW_LIGHTS = 8;

    // Per-light shadow cache
    private pointLightShadowCache: Map<string, PointLightShadowCache> = new Map();
    private sunShadowCache: DirectionalShadowCache | null = null;
    private moonShadowCache: DirectionalShadowCache | null = null;

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
        this.gBufferFBO = this.createGBuffer(gl, width, height);

        // Create Shaders
        this.ambientShader = new Shader(gl, DEFERRED_VERT, DEFERRED_AMBIENT_FRAG);
        this.lightShader = new Shader(gl, DEFERRED_VERT, DEFERRED_LIGHT_FRAG);
        this.shadowShader = new Shader(gl, DEFERRED_SHADOW_VERT, DEFERRED_SHADOW_FRAG);
        this.composeShader = new Shader(gl, DEFERRED_VERT, DEFERRED_COMPOSE_FRAG);
        this.directionalShader = new Shader(gl, DEFERRED_VERT, DEFERRED_DIRECTIONAL_FRAG);
        this.emissiveShader = new Shader(gl, DEFERRED_VERT, DEFERRED_EMISSIVE_FRAG);

        // Quad
        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        // Shadow Polygon Buffer (Dynamic) - pre-allocate for batching
        this.shadowBuffer = gl.createBuffer();
        this.shadowBatchData = new Float32Array(this.MAX_SHADOW_VERTICES * 2);

        // Static Shadow Buffer
        this.staticShadowBuffer = gl.createBuffer();
        this.shadowExtrusionShader = new Shader(gl, SHADOW_EXTRUSION_VERT, SHADOW_EXTRUSION_FRAG);

        console.log("[GPU Deferred] Pipeline Initialized (Phase 5: AAA GPU Extrusion)");
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

        if (this.gBufferFBO) {
            this.gl!.deleteFramebuffer(this.gBufferFBO.fbo);
            this.gl!.deleteTexture(this.gBufferFBO.colorTex);
            this.gl!.deleteTexture(this.gBufferFBO.normalTex);
            this.gl!.deleteRenderbuffer(this.gBufferFBO.depthRB);
        }

        // Recreate at new size
        this.accumulationFBO = this.createFBO(this.gl!, width, height, this.gl!.RGBA16F, this.gl!.RGBA, this.gl!.HALF_FLOAT);
        this.tempLightFBO = this.createFBO(this.gl!, width, height, this.gl!.RGBA16F, this.gl!.RGBA, this.gl!.HALF_FLOAT);
        this.bloomFBO = this.createFBO(this.gl!, width, height, this.gl!.RGBA16F, this.gl!.RGBA, this.gl!.HALF_FLOAT);
        this.gBufferFBO = this.createGBuffer(this.gl!, width, height);
    }

    private createGBuffer(gl: WebGL2RenderingContext, w: number, h: number): { fbo: WebGLFramebuffer, colorTex: WebGLTexture, normalTex: WebGLTexture, depthRB: WebGLRenderbuffer } {
        const fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        // Attachment 0: World Color (RGBA)
        const colorTex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, colorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);

        // Attachment 1: Normals (RGB16F)
        const normalTex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, normalTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normalTex, 0);

        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

        // Add Depth Renderbuffer for the G-Buffer pass
        const rb = gl.createRenderbuffer()!;
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error("[GPU Deferred] G-Buffer FBO Incomplete:", status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, colorTex, normalTex, depthRB: rb };
    }

    public bindGBuffer(): void {
        if (!this.gl || !this.gBufferFBO) return;
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.gBufferFBO.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

        // Clear G-Buffer for the new frame
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    public unbindGBuffer(): void {
        if (!this.gl) return;
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    public getWidth(): number { return this.width; }
    public getHeight(): number { return this.height; }
    public getGBufferColorTexture(): WebGLTexture | null { return this.gBufferFBO ? this.gBufferFBO.colorTex : null; }
    public getGBufferNormalTexture(): WebGLTexture | null { return this.gBufferFBO ? this.gBufferFBO.normalTex : null; }

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
        world: World,
        ambientColor: string,
        sun: { active: boolean, color: string, intensity: number, direction: { x: number, y: number }, altitude: number, shadowLen: number },
        moon: { active: boolean, color: string, intensity: number, direction: { x: number, y: number }, altitude: number, shadowLen: number },
        entityBuffer: GPUEntityBuffer,
        viewProj: Float32Array
    ): void {
        if (!this._initialized || !this.gl) return;
        const gl = this.gl;

        // Cleanup stale cache entries (simple limit-based cleanup)
        if (this.pointLightShadowCache.size > 100) this.pointLightShadowCache.clear();

        // 1. Fill Accumulation with Ambient
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFBO!.fbo);
        gl.viewport(0, 0, this.width, this.height);
        this.ambientShader!.use();
        const amb = this.parseColor(ambientColor);
        this.ambientShader!.setUniform3f("u_ambientColor", amb[0], amb[1], amb[2]);
        this.renderQuad();

        // 2. Process Sun/Moon (Directional) - WITH CACHING
        if (sun.active) this.renderDirectionalSmart(gl, sun, world, cameraX, cameraY, width, height, entityBuffer, viewProj, true);
        if (moon.active) this.renderDirectionalSmart(gl, moon, world, cameraX, cameraY, width, height, entityBuffer, viewProj, false);

        // 3. Process each point light
        let shadowLightsCount = 0;
        lights.forEach(light => {
            if (light.intensity <= 0 || light.radius <= 0) return;

            const screenLPos = { x: light.x - cameraX, y: light.y - cameraY };

            // Render light into Temp Buffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.tempLightFBO!.fbo);
            // Attach shared depth buffer to enable depth testing against walls
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.gBufferFBO!.depthRB);

            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT); // DON'T CLEAR DEPTH, we need it for testing

            this.lightShader!.use();
            this.lightShader!.setUniform2f("u_resolution", this.width, this.height);
            this.lightShader!.setUniform2f("u_camera", cameraX, cameraY);
            this.lightShader!.setUniform2f("u_lightPos", screenLPos.x, screenLPos.y);
            const lColor = this.parseColor(light.color);
            this.lightShader!.setUniform3f("u_lightColor", lColor[0], lColor[1], lColor[2]);
            this.lightShader!.setUniform1f("u_lightIntensity", light.intensity);
            this.lightShader!.setUniform1f("u_lightRadius", light.radius);
            this.lightShader!.setUniform1f("u_wallHeight", ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32.0);
            this.lightShader!.setUniform1f("u_directionalShadowLen", 0.0); // Not used for point lights

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.gBufferFBO!.normalTex);
            this.lightShader!.setUniform1i("u_normalTex", 0);

            // Bind Entity UBO for entity shadows
            entityBuffer.bind(this.lightShader!.getProgram(), "EntityBlock", 1);

            this.renderQuad();

            // Accumulate Light Emission (Only)
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFBO!.fbo);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.tempLightFBO!.tex);
            this.composeShader!.use();
            this.composeShader!.setUniform1i("u_accumulationTex", 0);
            this.renderQuad();
            gl.disable(gl.BLEND);
        });

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    private buildStaticShadowBuffer(world: World): void {
        const gl = this.gl!;
        // 1. Get ALL segments (Global) - yes, we upload the whole world once.
        // For a 500x500 world, this is acceptable. Streaming is overkill for this 2D engine.
        // We use a large enough bound to catch everything.
        const segments = world.getOcclusionSegments(0, 0, world.getWidthPixels(), world.getHeightPixels());

        // We need 6 vertices per segment (2 Triangles)
        // V0 (A, 0) - V1 (B, 0) - V2 (B, 1)
        // V0 (A, 0) - V2 (B, 1) - V3 (A, 1)
        const data = new Float32Array(segments.length * 6 * 3);
        let offset = 0;

        for (const seg of segments) {
            // Triangle 1
            data[offset++] = seg.a.x; data[offset++] = seg.a.y; data[offset++] = 0.0;
            data[offset++] = seg.b.x; data[offset++] = seg.b.y; data[offset++] = 0.0;
            data[offset++] = seg.b.x; data[offset++] = seg.b.y; data[offset++] = 1.0;

            // Triangle 2
            data[offset++] = seg.a.x; data[offset++] = seg.a.y; data[offset++] = 0.0;
            data[offset++] = seg.b.x; data[offset++] = seg.b.y; data[offset++] = 1.0;
            data[offset++] = seg.a.x; data[offset++] = seg.a.y; data[offset++] = 1.0;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.staticShadowBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        this.staticShadowCount = segments.length * 6;
        this.lastStaticMeshVersion = world.getMeshVersion();

        console.log(`[GPU Deferred] Built Static Shadow Buffer: ${segments.length} segments, ${this.staticShadowCount} vertices (AAA GPU Shadows).`);
    }

    private renderDirectionalSmart(
        gl: WebGL2RenderingContext,
        light: any,
        world: World,
        cameraX: number,
        cameraY: number,
        width: number,
        height: number,
        entityBuffer: GPUEntityBuffer,
        viewProj: Float32Array,
        isSun: boolean
    ): void {
        // 0. Check for Static Mesh Updates
        if (this.lastStaticMeshVersion === -1 || world.getMeshVersion() !== this.lastStaticMeshVersion) {
            this.buildStaticShadowBuffer(world);
        }

        // 1. Render Directional Light into Temp
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.tempLightFBO!.fbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.gBufferFBO!.depthRB);

        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.directionalShader!.use();
        this.directionalShader!.setUniform2f("u_resolution", this.width, this.height);
        this.directionalShader!.setUniform2f("u_camera", cameraX, cameraY);
        const sc = this.parseColor(light.color);
        this.directionalShader!.setUniform3f("u_lightColor", sc[0], sc[1], sc[2]);
        this.directionalShader!.setUniform1f("u_lightIntensity", light.intensity);
        this.directionalShader!.setUniform2f("u_lightDir", light.direction.x, light.direction.y);
        this.directionalShader!.setUniform1f("u_lightAltitude", light.altitude);
        this.directionalShader!.setUniform1f("u_wallHeight", ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32.0);
        this.directionalShader!.setUniform1f("u_directionalShadowLen", light.shadowLen || 100.0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.gBufferFBO!.normalTex);
        this.directionalShader!.setUniform1i("u_normalTex", 0);

        // Bind Entity UBO
        entityBuffer.bind(this.directionalShader!.getProgram(), "EntityBlock", 1);

        this.renderQuad();

        // 2. Punch out Shadows - BATCHED & CACHED
        const sDir = this.normalize(light.direction);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);

        const shadowExtrude = light.shadowLen || 100.0;
        const viewportVersion = world.getGridVersionForRect(cameraX, cameraY, width, height);

        // Draw Static Walls
        this.shadowExtrusionShader!.use();
        this.shadowExtrusionShader!.setUniform2f("u_resolution", this.width, this.height);
        this.shadowExtrusionShader!.setUniform2f("u_camera", cameraX, cameraY);
        this.shadowExtrusionShader!.setUniform2f("u_lightDir", sDir.x, sDir.y);
        this.shadowExtrusionShader!.setUniform1f("u_shadowLen", light.shadowLen || 100.0);
        this.shadowExtrusionShader!.setUniform1i("u_normalTex", 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.staticShadowBuffer);
        // Layout: 0: vec2 pos, 1: float extrude. Stride = 12 bytes
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0); // Pos
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8); // Extrude

        // Depth test important to not draw over walls!
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);

        gl.drawArrays(gl.TRIANGLES, 0, this.staticShadowCount);

        gl.disableVertexAttribArray(0);
        gl.disableVertexAttribArray(1);

        // Clear dynamic batch
        this.beginShadowBatch();

        // 3. Add Entity Shadows (DYNAMIC - RUN EVERY FRAME)
        // Entity Shadows are rendered after restoring the cache to ensure they follow entities graciously
        const wallHeight = ConfigManager.getInstance().get<number>('World', 'wallHeight') || 32.0;
        const entities = entityBuffer.getData();
        for (const entity of entities) {
            const entShadowLen = shadowExtrude * (entity.height / wallHeight);
            const volume = ShadowVolumeGenerator.getCircleShadowVolume(
                sDir,
                { x: entity.x, y: entity.y },
                entity.radius,
                entShadowLen
            );
            if (volume) this.appendShadowPolygon(volume.vertices);
        }

        // Single flush for both Static + Dynamic
        this.flushShadowBatch(viewProj, cameraX, cameraY);

        gl.disable(gl.BLEND);

        // 3. Accumulate
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFBO!.fbo);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tempLightFBO!.tex);
        this.composeShader!.use();
        this.composeShader!.setUniform1i("u_accumulationTex", 0);
        this.renderQuad();
        gl.disable(gl.BLEND);
    }

    public renderEmissive(): void {
        if (!this._initialized || !this.gl) return;
        const gl = this.gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.gBufferFBO!.normalTex);

        this.emissiveShader!.use();
        this.emissiveShader!.setUniform1i("u_normalTex", 0);
        this.emissiveShader!.setUniform2f("u_resolution", this.width, this.height);

        this.renderQuad();
    }

    private normalize(p: Point): Point {
        const len = Math.sqrt(p.x * p.x + p.y * p.y);
        return len > 0 ? { x: p.x / len, y: p.y / len } : { x: 0, y: 0 };
    }

    private parseColor(color: string): [number, number, number] {
        if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            if (matches) return [parseInt(matches[0]) / 255, parseInt(matches[1]) / 255, parseInt(matches[2]) / 255];
        } else if (color.startsWith('#')) {
            return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255];
        } else {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = color;
                const hex = ctx.fillStyle;
                if (hex.startsWith('#')) return this.parseColor(hex);
            }
        }
        return [1, 1, 1];
    }

    private renderShadowPolygon(vertices: Point[], viewProj: Float32Array, cameraX: number, cameraY: number): void {
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

        // Depth Test against walls: Shadows only draw on ground
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);

        this.shadowShader!.use();
        this.shadowShader!.setUniformMatrix4fv("u_viewProj", viewProj);
        this.shadowShader!.setUniform2f("u_camera", cameraX, cameraY);
        this.shadowShader!.setUniform2f("u_resolution", this.width, this.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.gBufferFBO!.normalTex);
        this.shadowShader!.setUniform1i("u_normalTex", 0);

        gl.drawArrays(gl.TRIANGLE_FAN, 0, vertices.length);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(true);
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

        // FBOs
        [this.accumulationFBO, this.tempLightFBO, this.bloomFBO].forEach(f => {
            if (f) {
                gl.deleteFramebuffer(f.fbo);
                gl.deleteTexture(f.tex);
            }
        });
        if (this.gBufferFBO) {
            gl.deleteFramebuffer(this.gBufferFBO.fbo);
            gl.deleteTexture(this.gBufferFBO.colorTex);
            gl.deleteTexture(this.gBufferFBO.normalTex);
            gl.deleteRenderbuffer(this.gBufferFBO.depthRB);
        }

        // Shaders
        [this.ambientShader, this.lightShader, this.shadowShader, this.composeShader, this.directionalShader, this.emissiveShader, this.shadowExtrusionShader].forEach(s => {
            if (s) s.dispose();
        });

        // Buffers
        if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
        if (this.shadowBuffer) gl.deleteBuffer(this.shadowBuffer);
        if (this.staticShadowBuffer) gl.deleteBuffer(this.staticShadowBuffer);

        this._initialized = false;
        this.lastStaticMeshVersion = -1;
        this.pointLightShadowCache.clear();
        this.sunShadowCache = null;
        this.moonShadowCache = null;
    }

    // ===== Batched Shadow Rendering =====

    private beginShadowBatch(): void {
        this.shadowBatchOffset = 0;
    }

    private appendShadowPolygon(vertices: Point[]): void {
        // Convert TRIANGLE_FAN to individual triangles for batching
        // Fan: v0, v1, v2, v3, v4... → Triangles: (v0,v1,v2), (v0,v2,v3), (v0,v3,v4)...
        if (vertices.length < 3) return;

        const numTriangles = vertices.length - 2;
        const neededFloats = numTriangles * 6; // 3 vertices * 2 floats each

        if (this.shadowBatchOffset + neededFloats > this.shadowBatchData.length) {
            // Buffer full, skip (shouldn't happen with MAX_SHADOW_VERTICES)
            return;
        }

        const v0 = vertices[0];
        for (let i = 1; i < vertices.length - 1; i++) {
            const v1 = vertices[i];
            const v2 = vertices[i + 1];

            this.shadowBatchData[this.shadowBatchOffset++] = v0.x;
            this.shadowBatchData[this.shadowBatchOffset++] = v0.y;
            this.shadowBatchData[this.shadowBatchOffset++] = v1.x;
            this.shadowBatchData[this.shadowBatchOffset++] = v1.y;
            this.shadowBatchData[this.shadowBatchOffset++] = v2.x;
            this.shadowBatchData[this.shadowBatchOffset++] = v2.y;
        }
    }

    private flushShadowBatch(viewProj: Float32Array, cameraX: number, cameraY: number): void {
        if (this.shadowBatchOffset === 0) return;

        const gl = this.gl!;
        const vertexCount = this.shadowBatchOffset / 2;

        // Upload batch data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.shadowBatchData.subarray(0, this.shadowBatchOffset), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // Depth test setup
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);

        this.shadowShader!.use();
        this.shadowShader!.setUniformMatrix4fv("u_viewProj", viewProj);
        this.shadowShader!.setUniform2f("u_camera", cameraX, cameraY);
        this.shadowShader!.setUniform2f("u_resolution", this.width, this.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.gBufferFBO!.normalTex);
        this.shadowShader!.setUniform1i("u_normalTex", 0);

        // Single draw call for all shadows!
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(true);
    }
}
