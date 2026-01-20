import { MAX_PARTICLES } from "../../ParticleConstants";
import { Shader } from "../Shader";
import { PARTICLE_UPDATE_VERT, PARTICLE_UPDATE_FRAG } from "../shaders/particle.update.glsl";
import { PARTICLE_RENDER_VERT, PARTICLE_RENDER_FRAG } from "../shaders/particle.render.glsl";

export class GPUParticleSystem {
    private gl!: WebGL2RenderingContext;
    private initialized: boolean = false;

    // Double Buffering for Transform Feedback
    private vaos: WebGLVertexArrayObject[] = [];
    private buffers: WebGLBuffer[] = []; // [StateA, StateB] (Interleaved pos/vel + props?)
    // Actually, we usually split static vs dynamic, but all is dynamic here for simplicity.
    // Let's use 2 VBOs per set? Or 1 interleaved VBO per set?
    // Shader expects: 
    // in 0: a_posVel (vec4)
    // in 1: a_props (vec4)
    // 2 vec4s = 32 bytes per particle.

    private tfIndex: number = 0; // 0 or 1 (Source)

    private updateShader: Shader | null = null;
    private renderShader: Shader | null = null;

    // Render Quad
    private quadBuffer: WebGLBuffer | null = null; // Coordinates for the billboard quad

    constructor() { }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;

        // 1. Compile Shaders
        this.updateShader = new Shader(gl, PARTICLE_UPDATE_VERT, PARTICLE_UPDATE_FRAG, ['v_posVel', 'v_props']);
        this.renderShader = new Shader(gl, PARTICLE_RENDER_VERT, PARTICLE_RENDER_FRAG);

        // 2. Setup Buffers
        // We need 2 sets of buffers for Ping-Pong
        // Each set contains:
        // - VBO for Particle Data (Pos, Vel, Life, etc)
        // - VAO to describe layout

        const particleSize = 32; // 2 * vec4 * 4 bytes
        const totalSize = MAX_PARTICLES * particleSize;
        const initialData = new Float32Array(MAX_PARTICLES * 8); // 8 floats per particle

        for (let i = 0; i < 2; i++) {
            const vao = gl.createVertexArray();
            const vbo = gl.createBuffer();

            if (!vao || !vbo) throw new Error("Failed to create GPU buffers");

            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, initialData, gl.DYNAMIC_COPY);

            // Layout: 0 -> a_posVel, 1 -> a_props
            // Stride: 32 bytes
            // Offset 0: posVel
            // Offset 16: props
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);

            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);

            // For instanced rendering, these advance once per instance
            gl.vertexAttribDivisor(0, 1);
            gl.vertexAttribDivisor(1, 1);

            this.vaos.push(vao);
            this.buffers.push(vbo);
        }

        // Unbind
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // 3. Quad Buffer (Shared)
        // -1,-1 to 1,1
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

        this.initialized = true;
    }

    public spawn(x: number, y: number, count: number, type: number): void {
        // GPU approach: We can't easily "push" one particle without separate upload or mapped buffer.
        // Option 1: Upload a small buffer of "new particles" and merge?
        // Option 2: CPU maintains list and we re-upload? No, defeats purpose.
        // Option 3: "Emitter" Shader pass? 
        // Or simply: use `gl.bufferSubData` to inject into "dead" slots?
        // Finding dead slots on CPU is O(N).
        // For Phase 1.1, user asked for "Visuals moved to GPU".
        // Let's implement a simple "Injector":
        // We find the first N inactive slots (locally in a tracking generic array?) or 
        // just ring-buffer overwrite?

        // Simplest: We treat the buffer as a ring for spawns?
        // But simulation needs valid state.

        // Let's assume for Phase 1.1 we spawn EVERYTHING on GPU via a "Spawn Shader" or 
        // we accept a CPU -> GPU upload for *newly spawned* particles.
        // Since `ParticleEmitter` is active on CPU, let's keep spawning on CPU but only upload the NEW list.
        // Wait, transferring 100k particles is heavy.

        // CRITICAL DECISION: Logic Split.
        // User wants "Heavy calculations" on GPU.
        // Spawning is rare compared to updating.
        // We can just execute a `spawn` method that uploads `gl.bufferSubData` to a known free range.
        // We need an index.
    }

    // Minimal "Blind" spawn for now to test rendering
    // We will need a `nextFreeIndex` tracked on CPU side (blindly incrementing).
    private nextSpawnIdx = 0;

    public uploadParticle(x: number, y: number, vx: number, vy: number, life: number, type: number, flags: number): void {
        if (!this.initialized) return;
        const gl = this.gl;

        const data = new Float32Array([
            x, y, vx, vy,
            life, life, type, flags
        ]);

        // Write to the CURRENT source buffer (which will be read next frame)
        // Or write to BOTH? No, source is enough.

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[this.tfIndex]);
        // 32 bytes * index
        gl.bufferSubData(gl.ARRAY_BUFFER, this.nextSpawnIdx * 32, data);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.nextSpawnIdx = (this.nextSpawnIdx + 1) % MAX_PARTICLES;
    }

    public update(dt: number, time: number, windX: number, windY: number): void {
        if (!this.initialized) return;
        const gl = this.gl;

        const sourceVAO = this.vaos[this.tfIndex];
        const destBuffer = this.buffers[1 - this.tfIndex]; // Write to other

        // 1. Transform Feedback Pass
        this.updateShader!.use();
        this.updateShader!.setUniform1f("u_dt", dt);
        this.updateShader!.setUniform1f("u_time", time);
        this.updateShader!.setUniform2f("u_wind", windX, windY);
        this.updateShader!.setUniform2f("u_worldSize", gl.canvas.width, gl.canvas.height);

        gl.bindVertexArray(sourceVAO);

        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, destBuffer);

        gl.enable(gl.RASTERIZER_DISCARD); // No rendering

        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);
        gl.endTransformFeedback();

        gl.disable(gl.RASTERIZER_DISCARD);

        gl.bindVertexArray(null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

        // Swap buffers
        this.tfIndex = 1 - this.tfIndex;
    }

    public render(camX: number, camY: number, screenW: number, screenH: number): void {
        if (!this.initialized) return;
        const gl = this.gl;

        // Draw from the NEW source (destination of previous step)
        const sourceVAO = this.vaos[this.tfIndex];

        this.renderShader!.use();
        this.renderShader!.setUniform2f("u_camera", camX, camY);
        this.renderShader!.setUniform2f("u_resolution", screenW, screenH);

        gl.bindVertexArray(sourceVAO);

        // Bind Quad Buffer to attribute 2
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(2, 0); // Per-vertex, not per-instance

        // Draw Instanced
        // 6 vertices per quad, MAX_PARTICLES instances
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, MAX_PARTICLES);

        gl.bindVertexArray(null);
    }
}
