import { ConfigManager } from "../../config/MasterConfig";

export class GPUContext {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    private initialized: boolean = false;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'gpu-surface';
        // This canvas is now OFFSCREEN - we will composite it onto the main 2D canvas
        // This avoids browser alpha compositing issues entirely

        const gl = this.canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            premultipliedAlpha: true,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: true
        });

        if (!gl) {
            throw new Error("WebGL2 not supported. GPU Acceleration disabled.");
        }

        this.gl = gl;

        // Initial clear to transparent
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    public init(): void {
        // Now a no-op since we are offscreen
        this.initialized = true;
    }

    private lastW: number = 0;
    private lastH: number = 0;

    public resize(width: number, height: number): void {
        if (this.lastW === width && this.lastH === height) return;

        this.lastW = width;
        this.lastH = height;

        const scale = ConfigManager.getInstance().get<number>('Visuals', 'gpuResolutionScale') || 1.0;
        this.canvas.width = width * scale;
        this.canvas.height = height * scale;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    public getGL(): WebGL2RenderingContext {
        return this.gl;
    }

    public clear(): void {
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    public dispose(): void {
        this.initialized = false;
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }
}
