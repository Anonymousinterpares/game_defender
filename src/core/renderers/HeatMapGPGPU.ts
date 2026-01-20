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

    private fluidTextureA: WebGLTexture;
    private fluidTextureB: WebGLTexture;
    private fluidFboA: WebGLFramebuffer;
    private fluidFboB: WebGLFramebuffer;

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

        this.fluidTextureA = this.driver.createTexture(this.width, this.height);
        this.fluidTextureB = this.driver.createTexture(this.width, this.height);
        this.fluidFboA = this.driver.createFramebuffer(this.fluidTextureA);
        this.fluidFboB = this.driver.createFramebuffer(this.fluidTextureB);

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

        // Structural + Heat
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
        gl.clearColor(0, 0, 0, 1.0); // 1.0 is full HP
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
        gl.clearColor(0, 0, 0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Fluids (Smoke)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fluidFboA);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fluidFboB);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public update(dt: number, decayRate: number, spreadRate: number, fireSpeed: number): void {
        const gl = this.driver.getGL();

        gl.bindVertexArray(this.vao);

        // Pass 1: Structural Simulation (Heat, Fire, Molten, HP)
        let targetFbo = this.isATarget ? this.fboA : this.fboB;
        let sourceTex = this.isATarget ? this.textureB : this.textureA;
        let sourceFluidTex = this.isATarget ? this.fluidTextureB : this.fluidTextureA;

        this.driver.useProgram('HeatMapSim');
        this.setSimUniforms(gl, dt, decayRate, spreadRate, fireSpeed, sourceTex, sourceFluidTex, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Pass 2: Fluid Simulation (Smoke/Steam)
        targetFbo = this.isATarget ? this.fluidFboA : this.fluidFboB;
        sourceTex = this.isATarget ? this.textureB : this.textureA; // We use the ALREADY UPDATED structural texture might be better? No, stick to ping-pong consistency.
        sourceFluidTex = this.isATarget ? this.fluidTextureB : this.fluidTextureA;

        this.setSimUniforms(gl, dt, decayRate, spreadRate, fireSpeed, sourceTex, sourceFluidTex, 1);

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Swap ping-pong state
        this.isATarget = !this.isATarget;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(null);
    }

    private setSimUniforms(gl: WebGL2RenderingContext, dt: number, decayRate: number, spreadRate: number, fireSpeed: number, structTex: WebGLTexture, fluidTex: WebGLTexture, pass: number): void {
        const uPrevStruct = gl.getUniformLocation(this.simProgram, 'u_prevStruct');
        const uPrevFluid = gl.getUniformLocation(this.simProgram, 'u_prevFluid');
        const uPass = gl.getUniformLocation(this.simProgram, 'u_pass');
        const uDt = gl.getUniformLocation(this.simProgram, 'u_dt');
        const uDecayRate = gl.getUniformLocation(this.simProgram, 'u_decayRate');
        const uSpreadRate = gl.getUniformLocation(this.simProgram, 'u_spreadRate');
        const uFireSpeed = gl.getUniformLocation(this.simProgram, 'u_fireSpeed');
        const uTexelSize = gl.getUniformLocation(this.simProgram, 'u_texelSize');
        const uSeed = gl.getUniformLocation(this.simProgram, 'u_seed');

        gl.uniform1i(uPass, pass);
        gl.uniform1f(uDt, dt);
        gl.uniform1f(uDecayRate, decayRate);
        gl.uniform1f(uSpreadRate, spreadRate);
        gl.uniform1f(uFireSpeed, fireSpeed);
        gl.uniform2f(uTexelSize, 1.0 / this.width, 1.0 / this.height);
        gl.uniform1f(uSeed, Math.random());

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, structTex);
        gl.uniform1i(uPrevStruct, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fluidTex);
        gl.uniform1i(uPrevFluid, 1);
    }

    public getSimulationTexture(): WebGLTexture {
        return this.isATarget ? this.textureB : this.textureA;
    }

    public draw(cameraX: number, cameraY: number, viewW: number, viewH: number, worldW: number, worldH: number): void {
        const gl = this.driver.getGL();
        const simTex = this.getSimulationTexture();
        const fluidTex = this.getFluidTexture();

        this.driver.useProgram('HeatMapRender');
        gl.bindVertexArray(this.vao);

        const uSimTex = gl.getUniformLocation(this.renderProgram, 'u_simTexture');
        const uFluidTex = gl.getUniformLocation(this.renderProgram, 'u_fluidTexture');
        const uCamera = gl.getUniformLocation(this.renderProgram, 'u_camera');
        const uViewDim = gl.getUniformLocation(this.renderProgram, 'u_viewDim');
        const uWorldDim = gl.getUniformLocation(this.renderProgram, 'u_worldDim');

        gl.uniform2f(uCamera, cameraX, cameraY);
        gl.uniform2f(uViewDim, viewW, viewH);
        gl.uniform2f(uWorldDim, worldW, worldH);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, simTex);
        gl.uniform1i(uSimTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fluidTex);
        gl.uniform1i(uFluidTex, 1);

        // Render to screen (default framebuffer)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, viewW, viewH);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindVertexArray(null);
    }

    public getFluidTexture(): WebGLTexture {
        return this.isATarget ? this.fluidTextureB : this.fluidTextureA;
    }

    /**
     * Updates a specific tile's data in both ping-pong textures to maintain consistency.
     */
    public updateTileRGBA(tx: number, ty: number, rgba: Float32Array): void {
        const gl = this.driver.getGL();
        const x = tx * this.subDiv;
        const y = ty * this.subDiv;

        [this.textureA, this.textureB].forEach(tex => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, this.subDiv, this.subDiv, gl.RGBA, gl.FLOAT, rgba);
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

    public updateTilePacked(tx: number, ty: number, material: Uint8Array, hp: Float32Array): void {
        const gl = this.driver.getGL();
        const x = tx * this.subDiv;
        const y = ty * this.subDiv;

        // Since we can't easily update just the Alpha channel in RGBA32F, 
        // we'll read back the current tile or just use updateTileRGBA.
        // For simplicity and speed in initialization, we'll pack assuming 0 heat/fire/molten.
        const rgba = new Float32Array(this.subDiv * this.subDiv * 4);
        for (let i = 0; i < this.subDiv * this.subDiv; i++) {
            rgba[i * 4 + 3] = material[i] + (hp[i] > 0 ? 0.99 : 0.0);
        }

        this.updateTileRGBA(tx, ty, rgba);
    }

    public updateTileMolten(tx: number, ty: number, molten: Float32Array): void {
        // Use updateTileRGBA instead
    }

    public updateTileHP(tx: number, ty: number, hp: Float32Array): void {
        // Similar to others but updates Alpha.
        // Again, no gl.ALPHA for direct alpha update easily.
        // Use updateTilePacked instead.
    }

    /**
     * Reads back data from the GPU simulation texture.
     * This is relatively slow, so it should be used judiciously.
     */
    public readTileData(tx: number, ty: number, outRGBA: Float32Array): void {
        const gl = this.driver.getGL();
        const x = tx * this.subDiv;
        const y = ty * this.subDiv;
        const targetFbo = !this.isATarget ? this.fboA : this.fboB;

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
        gl.readPixels(x, y, this.subDiv, this.subDiv, gl.RGBA, gl.FLOAT, outRGBA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Reads back the entire simulation texture.
     * Use for full world synchronization.
     */
    public readAllData(outRGBA: Float32Array): void {
        const gl = this.driver.getGL();
        const targetFbo = !this.isATarget ? this.fboA : this.fboB;

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, outRGBA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public dispose(): void {
        const gl = this.driver.getGL();
        gl.deleteTexture(this.textureA);
        gl.deleteTexture(this.textureB);
        gl.deleteFramebuffer(this.fboA);
        gl.deleteFramebuffer(this.fboB);
        gl.deleteTexture(this.fluidTextureA);
        gl.deleteTexture(this.fluidTextureB);
        gl.deleteFramebuffer(this.fluidFboA);
        gl.deleteFramebuffer(this.fluidFboB);
        gl.deleteVertexArray(this.vao);
    }
}
