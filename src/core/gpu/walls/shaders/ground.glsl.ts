export const GROUND_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_heatTexture;
uniform vec2 u_worldPixels;
uniform vec2 u_camera;
uniform vec2 u_resolution;
uniform float u_tileSize;

in vec2 v_worldPos; // This will just be the screen position for a full-quad ground
out vec4 outColor;

vec3 getHeatColor(float t) {
    if (t < 0.4) {
        float r = 0.39 + 0.61 * (t / 0.4);
        return vec3(r, 0.0, 0.0);
    } else if (t < 0.8) {
        float g = (t - 0.4) / 0.4;
        return vec3(1.0, g, 0.0);
    } else {
        float b = (t - 0.8) / 0.2;
        return vec3(1.0, 1.0, b);
    }
}

void main() {
    // 1. Calculate World Position from screen v_uv (v_worldPos here is NDC)
    vec2 screenUV = v_worldPos * 0.5 + 0.5;
    vec2 worldPos = u_camera + vec2(screenUV.x * u_resolution.x, (1.0 - screenUV.y) * u_resolution.y);
    
    // 2. Sample Heat
    vec2 heatUV = vec2(worldPos.x / u_worldPixels.x, 1.0 - (worldPos.y / u_worldPixels.y));
    float heat = texture(u_heatTexture, heatUV).r;

    // 3. Base Ground Color + Grid
    vec3 baseColor = vec3(0.27, 0.27, 0.29); // Dark grey ground
    
    // Dynamic Grid
    vec2 gridPos = mod(worldPos, u_tileSize);
    float gridLine = step(u_tileSize - 1.0, gridPos.x) + step(u_tileSize - 1.0, gridPos.y);
    baseColor = mix(baseColor, vec3(0.13), gridLine * 0.5);

    // 4. Heat integration
    vec3 color = baseColor;
    if (heat > 0.01) {
        vec3 glow = getHeatColor(heat);
        // On the ground, heat looks like molten metal / glowing cracks
        color = mix(baseColor, glow, smoothstep(0.05, 0.9, heat));
    }

    outColor = vec4(color, 1.0);
}
`;
