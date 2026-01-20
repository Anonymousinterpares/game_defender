import { GPUContext } from "./GPUContext";
import { World } from "../World";
import { ConfigManager } from "../../config/MasterConfig";
import { WorldShader } from "./WorldShader";

export class GPURenderer {
    private context: GPUContext;
    private world: World | null = null;
    private active: boolean = false;
    private worldShader: WorldShader | null = null;
    private quadBuffer: WebGLBuffer | null = null;

    constructor() {
        this.context = new GPUContext();
    }

    private initResources(): void {
        const gl = this.context.getGL();
        if (!this.worldShader) {
            this.worldShader = new WorldShader(gl);
        }

        if (!this.quadBuffer) {
            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            const positions = new Float32Array([
                -1, -1,
                1, -1,
                -1, 1,
                -1, 1,
                1, -1,
                1, 1,
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        }
    }

    public setWorld(world: World): void {
        this.world = world;
    }

    public updateConfig(): void {
        const wasActive = this.active;
        this.active = ConfigManager.getInstance().get<boolean>('Visuals', 'gpuEnabled') || false;

        if (this.active && !wasActive) {
            console.log("[GPU] Context Request...");
            this.context.init();
            this.initResources();
            console.log("[GPU] Pipeline Activated");
        } else if (!this.active && wasActive) {
            console.log("[GPU] Pipeline Deactivated");
        }
    }

    public render(cameraX: number, cameraY: number, width: number, height: number): void {
        if (!this.active || !this.worldShader) return;

        this.context.resize(width, height);
        this.context.clear();

        const gl = this.context.getGL();
        const shader = this.worldShader;

        shader.use();

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        const posLoc = shader.getAttribLocation("a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        shader.setUniform2f("u_resolution", gl.canvas.width, gl.canvas.height);
        shader.setUniform2f("u_camera", cameraX, cameraY);
        shader.setUniform1f("u_tileSize", this.world?.getTileSize() || 32);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /**
     * Composites the GPU-rendered content onto the main 2D canvas.
     * Call this after render() and after the main 2D world has been drawn.
     */
    public compositeToContext(ctx: CanvasRenderingContext2D): void {
        if (!this.active) return;

        const gpuCanvas = this.context.getCanvas();
        // Draw the GPU canvas on top of the existing 2D content
        ctx.drawImage(gpuCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    public isActive(): boolean {
        return this.active;
    }

    public dispose(): void {
        this.context.dispose();
    }
}
