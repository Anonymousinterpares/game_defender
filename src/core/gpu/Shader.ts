export class Shader {
    private program: WebGLProgram;

    constructor(private gl: WebGL2RenderingContext, vertSource: string, fragSource: string, varyings?: string[]) {
        const vert = this.compile(gl.VERTEX_SHADER, vertSource);
        const frag = this.compile(gl.FRAGMENT_SHADER, fragSource);

        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create shader program");

        gl.attachShader(program, vert);
        gl.attachShader(program, frag);

        if (varyings && varyings.length > 0) {
            gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
        }

        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Shader link failed: ${log}`);
        }

        this.program = program;
    }

    private compile(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) throw new Error("Failed to create shader");

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const log = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(`Shader compile failed: ${log}\nSource: ${source}`);
        }

        return shader;
    }

    public use(): void {
        this.gl.useProgram(this.program);
    }

    public getUniformLocation(name: string): WebGLUniformLocation | null {
        return this.gl.getUniformLocation(this.program, name);
    }

    public getAttribLocation(name: string): number {
        return this.gl.getAttribLocation(this.program, name);
    }

    public setUniform2f(name: string, x: number, y: number): void {
        const loc = this.getUniformLocation(name);
        if (loc) this.gl.uniform2f(loc, x, y);
    }

    public setUniform1f(name: string, val: number): void {
        const loc = this.getUniformLocation(name);
        if (loc) this.gl.uniform1f(loc, val);
    }
}
