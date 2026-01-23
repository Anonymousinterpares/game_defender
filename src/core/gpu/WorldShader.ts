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
            uniform vec2 u_mapSize;
            out vec4 outColor;

            void main() {
                // gl_FragCoord is in window coordinates (pixels)
                // We need to account for Y flip if necessary, but standard WebGL is bottom-up
                // Our camera space is top-down (0,0 is top-left)
                vec2 screenPos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
                vec2 worldPos = screenPos + u_camera;
                
                // Boundary Check: Discard fragments outside the world
                // Note: We use u_mapSize * u_tileSize since u_worldPixels isn't a uniform here yet
                vec2 worldLimit = u_mapSize * u_tileSize;
                if (worldPos.x < 0.0 || worldPos.x > worldLimit.x || worldPos.y < 0.0 || worldPos.y > worldLimit.y) {
                    discard;
                }
                
                // Simple grid pattern based on world position
                vec2 grid = mod(worldPos, u_tileSize);
                float line = 0.0;
                if (grid.x < 1.0 || grid.y < 1.0) {
                    line = 0.8;
                }

                // Fixed: Changed from debug NEON GREEN to subtle dark grid
                // This prevents the "Green Screen" flash when fluid sim has gaps
                float alpha = line * 0.1;
                // PREMULTIPLY ALPHA: RGB must be scaled by Alpha for correct blending
                // vec4(0.0) when alpha is 0.0 to prevent brightening the background
                outColor = vec4(0.1 * alpha, 0.1 * alpha, 0.1 * alpha, alpha);
            }
        `;

        super(gl, vert, frag);
    }
}
