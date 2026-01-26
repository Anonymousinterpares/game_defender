export interface EntityData {
    x: number;
    y: number;
    radius: number;
    height: number;
}

export class GPUEntityBuffer {
    private gl: WebGL2RenderingContext | null = null;
    private maxEntities: number = 32;
    private buffer: WebGLBuffer | null = null;
    private data: Float32Array;

    constructor(maxEntities: number = 32) {
        this.maxEntities = maxEntities;
        // Each entity: x, y, radius, height (4 floats)
        this.data = new Float32Array(maxEntities * 4);
    }

    public init(gl: WebGL2RenderingContext): void {
        this.gl = gl;
        this.buffer = gl.createBuffer();
    }

    public update(entities: EntityData[]): void {
        if (!this.gl || !this.buffer) return;

        const count = Math.min(entities.length, this.maxEntities);
        this.data.fill(0);

        for (let i = 0; i < count; i++) {
            const e = entities[i];
            const offset = i * 4;

            this.data[offset] = e.x;
            this.data[offset + 1] = e.y;
            this.data[offset + 2] = e.radius;
            this.data[offset + 3] = e.height;
        }

        const gl = this.gl;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
        gl.bufferData(gl.UNIFORM_BUFFER, this.data, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    }

    public bind(program: WebGLProgram, blockName: string, bindingPoint: number = 1): void {
        if (!this.gl || !this.buffer) return;
        const gl = this.gl;
        const blockIndex = gl.getUniformBlockIndex(program, blockName);
        if (blockIndex === gl.INVALID_INDEX) return;

        gl.uniformBlockBinding(program, blockIndex, bindingPoint);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, bindingPoint, this.buffer);
    }

    public getBuffer(): WebGLBuffer | null { return this.buffer; }
    public getMaxEntities(): number { return this.maxEntities; }

    public getData(): EntityData[] {
        const entities: EntityData[] = [];
        for (let i = 0; i < this.maxEntities; i++) {
            const offset = i * 4;
            const height = this.data[offset + 3];
            if (height < 0.1) continue; // Skip inactive entities

            entities.push({
                x: this.data[offset],
                y: this.data[offset + 1],
                radius: this.data[offset + 2],
                height: height
            });
        }
        return entities;
    }
}
