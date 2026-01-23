import { LightSource } from "../LightManager";

export class GPULightBuffer {
    private gl: WebGL2RenderingContext | null = null;
    private maxLights: number = 32;
    private buffer: WebGLBuffer | null = null;
    private data: Float32Array;

    constructor(maxLights: number = 32) {
        this.maxLights = maxLights;
        // Each light: 4 floats for pos/radius, 4 floats for color/intensity
        this.data = new Float32Array(maxLights * 8);
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;
        this.buffer = gl.createBuffer();
    }

    public update(lights: LightSource[]): void {
        if (!this.gl || !this.buffer) return;

        const count = Math.min(lights.length, this.maxLights);
        this.data.fill(0);

        for (let i = 0; i < count; i++) {
            const l = lights[i];
            const offset = i * 8;

            this.data[offset] = l.x;
            this.data[offset + 1] = l.y;
            this.data[offset + 2] = l.radius;
            // 0: Inactive, 1: Active, 2: Active + Shadows
            this.data[offset + 3] = l.active ? (l.castsShadows ? 2.0 : 1.0) : 0.0;

            // Parse color
            const color = this.parseColor(l.color);
            this.data[offset + 4] = color[0];
            this.data[offset + 5] = color[1];
            this.data[offset + 6] = color[2];
            this.data[offset + 7] = l.intensity;
        }

        const gl = this.gl;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
        gl.bufferData(gl.UNIFORM_BUFFER, this.data, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    }

    public bind(program: WebGLProgram, blockName: string, bindingPoint: number = 0): void {
        if (!this.gl || !this.buffer) return;
        const gl = this.gl;
        const blockIndex = gl.getUniformBlockIndex(program, blockName);
        if (blockIndex === gl.INVALID_INDEX) return;

        gl.uniformBlockBinding(program, blockIndex, bindingPoint);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, bindingPoint, this.buffer);
    }

    private parseColor(color: string): [number, number, number] {
        if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            if (matches) return [parseInt(matches[0]) / 255, parseInt(matches[1]) / 255, parseInt(matches[2]) / 255];
        } else if (color.startsWith('#')) {
            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;
            return [r, g, b];
        }
        return [1, 1, 1];
    }

    public getBuffer(): WebGLBuffer | null { return this.buffer; }
    public getMaxLights(): number { return this.maxLights; }
}
