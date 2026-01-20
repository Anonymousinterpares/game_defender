import { ConfigManager } from '../../config/MasterConfig';

export class GPUDriver {
    private static instance: GPUDriver;
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | null = null;
    private programs: Map<string, WebGLProgram> = new Map();
    private isAvailable: boolean = false;

    private constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.style.display = 'none';

        const useGPU = ConfigManager.getInstance().get<boolean>('Visuals', 'useGPUAcceleration');
        if (!useGPU) {
            console.log('GPU Acceleration disabled in MasterConfig.');
            return;
        }

        try {
            const gl = this.canvas.getContext('webgl2', {
                alpha: true,
                antialias: false,
                depth: true,
                stencil: false,
                premultipliedAlpha: true,
                preserveDrawingBuffer: false
            });

            if (!gl) {
                console.warn('WebGL2 not supported on this browser/hardware. Falling back to CPU.');
                return;
            }

            this.gl = gl;
            this.isAvailable = true;

            // Setup default states
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            console.log('GPUDriver: WebGL2 Initialized.');
        } catch (e) {
            console.error('GPUDriver: Failed to initialize WebGL2', e);
        }
    }

    public static getInstance(): GPUDriver {
        if (!GPUDriver.instance) {
            GPUDriver.instance = new GPUDriver();
        }
        return GPUDriver.instance;
    }

    public isReady(): boolean {
        return this.isAvailable && this.gl !== null;
    }

    public getGL(): WebGL2RenderingContext {
        if (!this.gl) throw new Error('WebGL2 context not available');
        return this.gl;
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public resize(width: number, height: number): void {
        if (!this.isAvailable) return;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl!.viewport(0, 0, width, height);
        }
    }

    public clear(): void {
        if (!this.gl) return;
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }

    public createProgram(name: string, vsSource: string, fsSource: string): WebGLProgram {
        if (!this.gl) throw new Error('WebGL2 context not available');
        const gl = this.gl;
        const vs = this.compileShader(vsSource, gl.VERTEX_SHADER);
        const fs = this.compileShader(fsSource, gl.FRAGMENT_SHADER);

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('Linker Error: ' + log);
        }

        this.programs.set(name, program);
        return program;
    }

    private compileShader(source: string, type: number): WebGLShader {
        const gl = this.gl!;
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader Error (' + (type === gl.VERTEX_SHADER ? 'VS' : 'FS') + '): ' + info);
        }
        return shader;
    }

    public useProgram(name: string): WebGLProgram {
        if (!this.gl) throw new Error('WebGL2 context not available');
        const program = this.programs.get(name);
        if (!program) throw new Error(`Program ${name} not found`);
        this.gl.useProgram(program);
        return program;
    }

    // --- GPGPU Helpers ---

    public createTexture(width: number, height: number, internalFormat: number = WebGL2RenderingContext.RGBA32F): WebGLTexture {
        const gl = this.getGL();
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // RGBA32F requires EXT_color_buffer_float for rendering to it
        if (internalFormat === gl.RGBA32F) {
            const ext = gl.getExtension('EXT_color_buffer_float');
            if (!ext) console.warn('GPUDriver: EXT_color_buffer_float not supported. GPGPU might fail.');
        }

        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.FLOAT, null);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return texture;
    }

    public createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
        const gl = this.getGL();
        const fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`GPUDriver: Framebuffer incomplete: ${status}`);
        }

        return fbo;
    }

    public readPixels(x: number, y: number, width: number, height: number, format: number, type: number, pixels: ArrayBufferView): void {
        const gl = this.getGL();
        gl.readPixels(x, y, width, height, format, type, pixels);
    }
}
