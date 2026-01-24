import { Shader } from "./Shader";

const FLUID_RENDER_VERT = `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 a_position;
    out vec2 v_uv;
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const FLUID_RENDER_FRAG = `#version 300 es
    precision highp float;
    uniform sampler2D u_density;
    uniform vec2 u_camera;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_worldPixels; // World size in pixels
    in vec2 v_uv;
    out vec4 outColor;

    // Simple noise for wisps
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
    }

    void main() {
        // v_uv is screen 0..1 (bottom-left to top-right)
        // Correct screen-to-world mapping:
        // worldPos.y = camera.y + (1.0 - v_uv.y) * resolution.y (since screen Y is 0 at top in Canvas2D)
        vec2 worldPos = u_camera + vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
        
        // Boundary Check: Discard fragments outside the world
        if (worldPos.x < 0.0 || worldPos.x > u_worldPixels.x || worldPos.y < 0.0 || worldPos.y > u_worldPixels.y) {
            discard;
        }
        
        // Map to Grid UV (0..1 across entire world)
        // Grid UV.y = 1.0 - (worldY / worldH) to match WebGL FBO space
        vec2 gridUV = vec2(worldPos.x / u_worldPixels.x, 1.0 - (worldPos.y / u_worldPixels.y));
        
        // Sample Density
        vec4 densityData = texture(u_density, gridUV);
        float density = densityData.r;
        float temp = densityData.g;
        float variation = densityData.b;

        // Discard threshold for performance and clean edges
        if (density < 0.0001) discard;

        // High-quality volumetric noise blending
        float n = noise(worldPos * 0.01 + u_time * 0.3) * 0.5 + 
                  noise(worldPos * 0.02 - u_time * 0.1) * 0.25 +
                  noise(worldPos * 0.04 + u_time * 0.2) * 0.125;
        
        float noiseDensity = density * (0.6 + n * 0.8);

        // Map variation to smoke color
        // Low variation = Black (darker than before), High = Light grey
        vec3 color = mix(vec3(0.02), vec3(0.15, 0.15, 0.2), variation);
        
        // Final alpha blending (Exponential Tonemapping for physical transparency)
        // Shift curve to be more opaque at low densities
        float alpha = 1.0 - exp(-noiseDensity * 0.8);
        
        // Boost noise visibility at low densities
        float hazeCleanliness = smoothstep(0.0, 0.15, density);
        alpha *= mix(0.4 + n * 0.6, 1.0, hazeCleanliness);
        
        outColor = vec4(color * alpha, alpha);
    }
`;

export class FluidShader extends Shader {
    constructor(gl: WebGL2RenderingContext) {
        super(gl, FLUID_RENDER_VERT, FLUID_RENDER_FRAG);
    }
}
