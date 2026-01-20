import { Shader } from "./Shader";

export class WorldShader extends Shader {
    constructor(gl: WebGL2RenderingContext) {
        const vert = `#version 300 es
            in vec2 a_position;

            void main() {
                gl_Position = vec4(a_position, 0, 1);
            }
        `;

        const frag = `#version 300 es
            precision highp float;
            uniform vec2 u_resolution;
            uniform vec2 u_camera;
            uniform float u_tileSize;
            out vec4 outColor;

            void main() {
                // gl_FragCoord is in window coordinates (pixels)
                // We need to account for Y flip if necessary, but standard WebGL is bottom-up
                // Our camera space is top-down (0,0 is top-left)
                vec2 screenPos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
                vec2 worldPos = screenPos + u_camera;
                
                // Simple grid pattern based on world position
                vec2 grid = mod(worldPos, u_tileSize);
                float line = 0.0;
                if (grid.x < 1.0 || grid.y < 1.0) {
                    line = 0.8;
                }

                // Phase 0 Success: BRIGHT NEON GREEN grid lines.
                // Using PREMULTIPLIED ALPHA: Since WebGL canvas defaults to premultiplied alpha in the browser compositor,
                // any pixel with alpha 0.0 MUST have RGB 0.0 to stay transparent.
                float alpha = line * 0.4;
                outColor = vec4(0.0, alpha, 0.0, alpha);
            }
        `;

        super(gl, vert, frag);
    }
}
