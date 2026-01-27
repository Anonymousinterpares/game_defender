import { Shader } from "../Shader";
import { WEATHER_UPDATE_VERT, WEATHER_RENDER_VERT, WEATHER_RENDER_FRAG } from "../shaders/weather.glsl";
import { WeatherManager, WeatherType } from "../../WeatherManager";
import { ConfigManager } from "../../../config/MasterConfig";
import { World } from "../../World";

export class GPUWeatherSystem {
    private gl!: WebGL2RenderingContext;
    public initialized: boolean = false;

    // Configuration
    private readonly MAX_PARTICLES = 100000; // High count for dense rain/snow

    // Double Buffering
    private updateVaos: WebGLVertexArrayObject[] = [];
    private renderVaos: WebGLVertexArrayObject[] = [];
    private buffers: WebGLBuffer[] = [];
    private tfIndex: number = 0;

    private updateShader: Shader | null = null;
    private renderShader: Shader | null = null;

    private quadBuffer: WebGLBuffer | null = null;
    private world: World | null = null;

    constructor() { }

    public init(gl: WebGL2RenderingContext, world: World): void {
        this.gl = gl;
        this.world = world;

        // 1. Compile Shaders
        this.updateShader = new Shader(gl, WEATHER_UPDATE_VERT, "#version 300 es\nprecision highp float;\nvoid main(){}", ['v_pos', 'v_vel']);
        this.renderShader = new Shader(gl, WEATHER_RENDER_VERT, WEATHER_RENDER_FRAG);

        // 2. Setup Quad (Billboards)
        const quadVerts = new Float32Array([
            -0.5, -0.5,
            0.5, -0.5,
            -0.5, 0.5,
            0.5, -0.5,
            0.5, 0.5,
            -0.5, 0.5
        ]);
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

        // 3. Setup Particle Buffers
        // 8 floats per particle (32 bytes): pos(x,y,z,type) + vel(vx,vy,vz,life)
        const initialData = new Float32Array(this.MAX_PARTICLES * 8);

        // Initialize with random positions to avoid "clumping" on start
        for (let i = 0; i < this.MAX_PARTICLES; i++) {
            const idx = i * 8;
            initialData[idx] = Math.random() * world.getWidthPixels();
            initialData[idx + 1] = Math.random() * world.getHeightPixels();
            initialData[idx + 2] = Math.random() * 1000.0; // Random Z height
            initialData[idx + 3] = 0.0; // Type: Rain default

            initialData[idx + 4] = 0.0; // VX
            initialData[idx + 5] = 0.0; // VY
            initialData[idx + 6] = -100.0; // VZ (Down)
            initialData[idx + 7] = 1.0; // Life
        }

        for (let i = 0; i < 2; i++) {
            const vbo = gl.createBuffer();
            if (!vbo) throw new Error("Failed to create Weather GPU buffers");

            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, initialData, gl.DYNAMIC_COPY);
            this.buffers.push(vbo);

            // A. UPDATE VAO
            const uVao = gl.createVertexArray();
            gl.bindVertexArray(uVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

            // Attribute 0: pos (vec4)
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);

            // Attribute 1: vel (vec4)
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);

            this.updateVaos.push(uVao!);

            // B. RENDER VAO
            const rVao = gl.createVertexArray();
            gl.bindVertexArray(rVao);

            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

            // Instanced attributes
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
            gl.vertexAttribDivisor(0, 1); // 1 per instance

            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
            gl.vertexAttribDivisor(1, 1);

            // Shared Quad attributes
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(2, 0); // Per vertex

            this.renderVaos.push(rVao!);
        }

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.initialized = true;
        console.log(`[GPU] Weather System Initialized (${this.MAX_PARTICLES} particles)`);
    }


    public update(dt: number, time: number): void {
        if (!this.initialized || !this.world) return;
        const gl = this.gl;
        const wm = WeatherManager.getInstance();
        const weather = wm.getWeatherState();

        const sourceVAO = this.updateVaos[this.tfIndex];
        const destBuffer = this.buffers[1 - this.tfIndex];

        if (!this.updateShader) return;
        this.updateShader.use();
        this.updateShader.setUniform1f("u_dt", dt);
        this.updateShader.setUniform1f("u_time", time);

        const ppm = ConfigManager.getInstance().getPixelsPerMeter();
        // Wind: x, y, z, intensity
        this.updateShader.setUniform4f("u_wind",
            weather.windDir.x * weather.windSpeed * ppm,
            weather.windDir.y * weather.windSpeed * ppm,
            0.0,
            weather.precipitationIntensity
        );

        const g = ConfigManager.getInstance().get<number>('Physics', 'gravity') || 9.81;
        this.updateShader.setUniform3f("u_gravity", 0.0, 0.0, -g * ppm * 15.0); // Amplify gravity for visuals

        let targetType = 0.0; // Rain
        if (weather.type === WeatherType.SNOW) targetType = 1.0;

        this.updateShader!.setUniform1f("u_targetType", targetType);
        this.updateShader!.setUniform2f("u_worldSize", this.world.getWidthPixels(), this.world.getHeightPixels());
        this.updateShader!.setUniform1f("u_zFloor", 0.0);

        // Bind for Transform Feedback
        gl.bindVertexArray(sourceVAO);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, destBuffer);

        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);

        // Only update active count based on intensity? 
        // No, update all, letting shader handle logic or keeping them alive.
        // For simpler logic, we update all 100k always.
        // Modern GPUs handle 100k vertex ops easily.
        gl.drawArrays(gl.POINTS, 0, this.MAX_PARTICLES);

        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);

        gl.bindVertexArray(null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

        this.tfIndex = 1 - this.tfIndex;
    }

    public render(camX: number, camY: number, screenW: number, screenH: number): void {
        if (!this.initialized) return;

        // Visibility Check
        const wm = WeatherManager.getInstance();
        const weather = wm.getWeatherState();
        // Force render for debug
        if (weather.precipitationIntensity < 0.01 && weather.type !== WeatherType.SNOW && weather.type !== WeatherType.RAIN) {
            if (weather.precipitationIntensity <= 0.0) return;
        }

        const gl = this.gl;
        const renderVAO = this.renderVaos[this.tfIndex];

        // Blend Mode: Additive for splashes/snow? Normal for rain?
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive-like for distinct visibility

        this.renderShader!.use();
        this.renderShader!.setUniform2f("u_camera", camX, camY);
        this.renderShader!.setUniform2f("u_resolution", screenW, screenH);
        this.renderShader!.setUniform3f("u_cameraPos", camX + screenW / 2, camY + screenH / 2, 500.0);
        this.renderShader!.setUniform1f("u_perspectiveStrength", ConfigManager.getInstance().get<number>('Visuals', 'perspectiveStrength') || 0.0015);
        this.renderShader!.setUniform1f("u_time", performance.now() * 0.001);

        gl.bindVertexArray(renderVAO);
        // Instanced Draw
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.MAX_PARTICLES);
        gl.bindVertexArray(null);

        gl.disable(gl.BLEND);
    }

    public clear(): void {
        // Just reset logic if needed, but for rain/snow we probably don't even need to clear buffers
        // because new positions are random anyway. 
        // But maybe we want to kill existing particles instantly?
        // Let's explicitly NOT destroy resources here.
    }

    public cleanup(): void {
        if (!this.initialized) return;
        const gl = this.gl;
        this.buffers.forEach(b => gl.deleteBuffer(b));
        this.updateVaos.forEach(v => gl.deleteVertexArray(v));
        this.renderVaos.forEach(v => gl.deleteVertexArray(v));
        if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
        if (this.updateShader) this.updateShader.dispose();
        if (this.renderShader) this.renderShader.dispose();
        this.initialized = false;
    }
}
