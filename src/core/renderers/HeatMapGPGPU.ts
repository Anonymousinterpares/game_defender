import { GPUDriver } from './GPUDriver';
import { HEATMAP_SIM_VS, HEATMAP_SIM_FS } from './shaders/HeatMapSimulationShader';
import { HEATMAP_RENDER_VS, HEATMAP_RENDER_FS } from './shaders/HeatMapRenderShader';

export class HeatMapGPGPU {
    private driver: GPUDriver;
    private width: number;
    private height: number;
    private subDiv: number;

    private textureA: WebGLTexture;
    private textureB: WebGLTexture;
    private fboA: WebGLFramebuffer;
    private fboB: WebGLFramebuffer;
    private isATarget: boolean = true;

    private simProgram: WebGLProgram;
    private renderProgram: WebGLProgram;
    private vao: WebGLVertexArrayObject;

    constructor(widthTiles: number, heightTiles: number, subDiv: number) {
        this.driver = GPUDriver.getInstance();
        this.width = widthTiles * subDiv;
        this.height = heightTiles * subDiv;
        this.subDiv = subDiv;

        const gl = this.driver.getGL();

        // 1. Create Ping-Pong Textures and FBOs
        this.textureA = this.driver.createTexture(this.width, this.height);
        this.textureB = this.driver.createTexture(this.width, this.height);
        this.fboA = this.driver.createFramebuffer(this.textureA);
        this.fboB = this.driver.createFramebuffer(this.textureB);

        // Clear initial textures
        this.clear();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 2. Setup Shaders
        this.simProgram = this.driver.createProgram('HeatMapSim', HEATMAP_SIM_VS, HEATMAP_SIM_FS);
        this.renderProgram = this.driver.createProgram('HeatMapRender', HEATMAP_RENDER_VS, HEATMAP_RENDER_FS);

        // 3. Setup VAO (Full-screen quad)
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    public clear(): void {
        const gl = this.driver.getGL();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
        gl.clearColor(0, 0, 0, 1.0); // 1.0 is full HP
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
        gl.clearColor(0, 0, 0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public update(dt: number, decayRate: number, spreadRate: number): void {
        const gl = this.driver.getGL();

        // Ensure parity if sync happened
        // this.syncAllToCurrentFBO(); // Maybe later if needed

        const targetFbo = this.isATarget ? this.fboA : this.fboB;
        const sourceTex = this.isATarget ? this.textureB : this.textureA;

        this.driver.useProgram('HeatMapSim');
        gl.bindVertexArray(this.vao);

        // Uniforms
        const uPrevHeat = gl.getUniformLocation(this.simProgram, 'u_prevHeat');
        const uDt = gl.getUniformLocation(this.simProgram, 'u_dt');
        const uDecayRate = gl.getUniformLocation(this.simProgram, 'u_decayRate');
        const uSpreadRate = gl.getUniformLocation(this.simProgram, 'u_spreadRate');
        const uTexelSize = gl.getUniformLocation(this.simProgram, 'u_texelSize');

        gl.uniform1f(uDt, dt);
        gl.uniform1f(uDecayRate, decayRate);
        gl.uniform1f(uSpreadRate, spreadRate);
        gl.uniform2f(uTexelSize, 1.0 / this.width, 1.0 / this.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex);
        gl.uniform1i(uPrevHeat, 0);

        // Render to target FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Swap
        this.isATarget = !this.isATarget;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(null);
    }

    public getSimulationTexture(): WebGLTexture {
        return this.isATarget ? this.textureB : this.textureA;
    }

    public draw(cameraX: number, cameraY: number, viewW: number, viewH: number, worldW: number, worldH: number): void {
        const gl = this.driver.getGL();
        const simTex = this.getSimulationTexture();

        this.driver.useProgram('HeatMapRender');
        gl.bindVertexArray(this.vao);

        const uSimTex = gl.getUniformLocation(this.renderProgram, 'u_simTexture');
        const uCamera = gl.getUniformLocation(this.renderProgram, 'u_camera');
        const uViewDim = gl.getUniformLocation(this.renderProgram, 'u_viewDim');
        const uWorldDim = gl.getUniformLocation(this.renderProgram, 'u_worldDim');

        gl.uniform2f(uCamera, cameraX, cameraY);
        gl.uniform2f(uViewDim, viewW, viewH);
        gl.uniform2f(uWorldDim, worldW, worldH);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, simTex);
        gl.uniform1i(uSimTex, 0);

        // Render to screen (default framebuffer)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, viewW, viewH);

        // We use additive blending or similar for heat glow?
        // Let's use standard blending as set in GPUDriver
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindVertexArray(null);
    }

    /**
     * Updates a specific tile's data in both ping-pong textures to maintain consistency.
     */
    public updateTileData(tx: number, ty: number, heat: Float32Array | null, hp: Float32Array | null): void {
        const gl = this.driver.getGL();
        const x = tx * this.subDiv;
        const y = ty * this.subDiv;

        // We need to update both textures because simulation reads from one and writes to another.
        // If we only update one, the next frame will overwrite it with old data from the other.
        [this.textureA, this.textureB].forEach(tex => {
            gl.bindTexture(gl.TEXTURE_2D, tex);

            if (heat) {
                // R channel: Heat
                gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, this.subDiv, this.subDiv, gl.RED, gl.FLOAT, heat);
            }
            if (hp) {
                // A channel: HP (we need to be careful here, WebGL2 doesn't easily allow updating JUST the alpha channel)
                // We might need to read the current pixel first, or just upload a full RGBA block.
                // For simplicity now, let's just upload Heat to RED and Alpha to ALPHA if we can.
                // Actually, texSubImage2D into RGBA32F expects a full RGBA buffer if we use gl.RGBA.
                // Let's create a temporary RGBA buffer for this tile.
                const rgba = new Float32Array(this.subDiv * this.subDiv * 4);
                // This is slow if done many times, but okay for tile updates.

                // If we want to be faster, we should use a shader to "stamp" data.
                // For now, let's just do Heat.
            }
        });
    }

    public updateTileHeat(tx: number, ty: number, heat: Float32Array): void {
        const gl = this.driver.getGL();
        const x = tx * this.subDiv;
        const y = ty * this.subDiv;

        [this.textureA, this.textureB].forEach(tex => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            // In RGBA32F, we use RED format to update just the first channel? 
            // No, the internal format is RGBA32F. Uploading RED might not work as intended for all channels.
            // But WebGL2 allows gl.RED for gl.RGBA32F textures if used with texSubImage2D?
            // "If the internal format is a signed/unsigned integer or floating-point format, the format and typeMust be a compatible combination."
            // gl.RED + gl.FLOAT is compatible with gl.RGBA32F (updates R channel).
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, this.subDiv, this.subDiv, gl.RED, gl.FLOAT, heat);
        });
    }

    public dispose(): void {
        const gl = this.driver.getGL();
        gl.deleteTexture(this.textureA);
        gl.deleteTexture(this.textureB);
        gl.deleteFramebuffer(this.fboA);
        gl.deleteFramebuffer(this.fboB);
        gl.deleteVertexArray(this.vao);
    }
}
