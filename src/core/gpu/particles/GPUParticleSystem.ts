import { MAX_PARTICLES } from "../../ParticleConstants";
import { Shader } from "../Shader";
import { PARTICLE_UPDATE_VERT, PARTICLE_UPDATE_FRAG } from "../shaders/particle.update.glsl";
import { PARTICLE_RENDER_VERT, PARTICLE_RENDER_FRAG } from "../shaders/particle.render.glsl";
import { WeatherManager } from "../../WeatherManager";
import { ConfigManager } from "../../../config/MasterConfig";

export class GPUParticleSystem {
    private gl!: WebGL2RenderingContext;
    public initialized: boolean = false;

    // Double Buffering for Transform Feedback
    private updateVaos: WebGLVertexArrayObject[] = [];
    private renderVaos: WebGLVertexArrayObject[] = [];
    private buffers: WebGLBuffer[] = [];

    private tfIndex: number = 0; // 0 or 1 (Source)

    private updateShader: Shader | null = null;
    private renderShader: Shader | null = null;

    // Render Quad
    private quadBuffer: WebGLBuffer | null = null;

    // World Data
    private worldMap: WebGLTexture | null = null;
    private worldW: number = 0;
    private worldH: number = 0;
    private tileSize: number = 32;

    // Disturbers (Player/Enemies)
    private entities: Float32Array = new Float32Array(16); // 8 vec2s

    constructor() { }

    public setEntities(positions: { x: number, y: number }[]): void {
        this.entities.fill(0);
        for (let i = 0; i < Math.min(positions.length, 8); i++) {
            this.entities[i * 2] = positions[i].x;
            this.entities[i * 2 + 1] = positions[i].y;
        }
    }

    public setWorldMap(tex: WebGLTexture, w: number, h: number, tileSize: number): void {
        this.worldMap = tex;
        this.worldW = w;
        this.worldH = h;
        this.tileSize = tileSize;
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;

        // 1. Compile Shaders
        this.updateShader = new Shader(gl, PARTICLE_UPDATE_VERT, PARTICLE_UPDATE_FRAG, ['v_posVel', 'v_props']);
        this.renderShader = new Shader(gl, PARTICLE_RENDER_VERT, PARTICLE_RENDER_FRAG);

        // 2. Setup Quad Buffer
        const quadVerts = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, -1,
            1, 1,
            -1, 1
        ]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

        // 3. Setup Particle Buffers and VAOs
        const initialData = new Float32Array(MAX_PARTICLES * 8);

        for (let i = 0; i < 2; i++) {
            const vbo = gl.createBuffer();
            if (!vbo) throw new Error("Failed to create GPU buffers");

            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, initialData, gl.DYNAMIC_COPY);
            this.buffers.push(vbo);

            // A. UPDATE VAO (Divisor 0 - processes each particle individually)
            const uVao = gl.createVertexArray();
            if (!uVao) throw new Error("Failed to create Update VAO");
            gl.bindVertexArray(uVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

            gl.enableVertexAttribArray(0); // a_posVel
            gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
            gl.vertexAttribDivisor(0, 0);

            gl.enableVertexAttribArray(1); // a_props
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
            gl.vertexAttribDivisor(1, 0);

            this.updateVaos.push(uVao);

            // B. RENDER VAO (Divisor 1 - for instanced rendering)
            const rVao = gl.createVertexArray();
            if (!rVao) throw new Error("Failed to create Render VAO");
            gl.bindVertexArray(rVao);

            // Instanced Particle Data
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
            gl.vertexAttribDivisor(0, 1); // Advance once per instance

            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
            gl.vertexAttribDivisor(1, 1); // Advance once per instance

            // Shared Quad Data
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(2); // a_quadPos
            gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(2, 0); // Advance once per vertex

            this.renderVaos.push(rVao);
        }

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.initialized = true;
        const debug = ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug');
        if (debug) console.log("[GPU] Particle System initialized.");
    }

    public spawn(x: number, y: number, count: number, type: number): void {
        // Placeholder
    }

    private nextSpawnIdx = 0;

    public uploadParticle(x: number, y: number, vx: number, vy: number, life: number, type: number, flags: number): void {
        const debug = ConfigManager.getInstance().get<boolean>('Debug', 'webgl_debug');
        if (!this.initialized) {
            if (debug) console.warn("[GPU] Particle System not initialized, dropping particle");
            return;
        }
        const gl = this.gl;

        if (debug && type >= 4.0) {
            console.log(`[GPU] Particle Upload: type=${type.toFixed(1)}, pos=(${x.toFixed(1)}, ${y.toFixed(1)}), idx=${this.nextSpawnIdx}`);
        }

        const data = new Float32Array([
            x, y, vx, vy,
            life, life, type, flags
        ]);

        // Upload to the current SOURCE buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[this.tfIndex]);
        gl.bufferSubData(gl.ARRAY_BUFFER, this.nextSpawnIdx * 32, data);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.nextSpawnIdx = (this.nextSpawnIdx + 1) % MAX_PARTICLES;
    }

    public update(dt: number, time: number, _wx: number, _wy: number): void {
        if (!this.initialized) return;
        const gl = this.gl;

        const sourceVAO = this.updateVaos[this.tfIndex];
        const destBuffer = this.buffers[1 - this.tfIndex];

        // Fetch actual wind
        const weather = WeatherManager.getInstance().getWeatherState();
        let windX = 0;
        let windY = 0;
        if (weather) {
            windX = weather.windDir.x * weather.windSpeed;
            windY = weather.windDir.y * weather.windSpeed;
        }

        // 1. Transform Feedback Pass
        this.updateShader!.use();
        this.updateShader!.setUniform1f("u_dt", dt);
        this.updateShader!.setUniform1f("u_time", time);
        this.updateShader!.setUniform2f("u_wind", windX, windY);
        this.updateShader!.setUniform2fv("u_entities", this.entities);

        // Use actual world dimensions in pixels for boundary checks
        const worldPixelW = this.worldW * this.tileSize;
        const worldPixelH = this.worldH * this.tileSize;
        this.updateShader!.setUniform2f("u_worldSize", worldPixelW, worldPixelH);

        // Pass Map
        if (this.worldMap) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.worldMap);
            this.updateShader!.setUniform1i("u_worldMap", 0);

            this.updateShader!.setUniform1f("u_tileSize", this.tileSize);
            this.updateShader!.setUniform2f("u_mapSize", this.worldW, this.worldH);
        }

        gl.bindVertexArray(sourceVAO);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, destBuffer);

        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);

        gl.bindVertexArray(null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

        this.tfIndex = 1 - this.tfIndex;
    }

    public render(camX: number, camY: number, screenW: number, screenH: number): void {
        if (!this.initialized) return;
        const gl = this.gl;

        // Draw from the NEW source (destination of previous update)
        const renderVAO = this.renderVaos[this.tfIndex];

        this.renderShader!.use();
        this.renderShader!.setUniform2f("u_camera", camX, camY);
        this.renderShader!.setUniform2f("u_resolution", screenW, screenH);
        this.renderShader!.setUniform1f("u_time", performance.now() * 0.001);

        gl.bindVertexArray(renderVAO);

        // Draw Instanced: 6 vertices per quad, MAX_PARTICLES instances
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, MAX_PARTICLES);

        gl.bindVertexArray(null);
    }
}
