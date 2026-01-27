import { Shader } from "../Shader";
import { HEAT_VERT, HEAT_UPDATE_FRAG, HEAT_SPLAT_FRAG, HEAT_RENDER_FRAG } from "./shaders/heat.glsl";

export class HeatShaderManager {
    public updateShader: Shader;
    public splatShader: Shader;
    public renderShader: Shader;

    constructor(gl: WebGL2RenderingContext) {
        this.updateShader = new Shader(gl, HEAT_VERT, HEAT_UPDATE_FRAG);
        this.splatShader = new Shader(gl, HEAT_VERT, HEAT_SPLAT_FRAG);
        this.renderShader = new Shader(gl, HEAT_VERT, HEAT_RENDER_FRAG);
    }

    public dispose(): void {
        this.updateShader.dispose();
        this.splatShader.dispose();
        this.renderShader.dispose();
    }
}
