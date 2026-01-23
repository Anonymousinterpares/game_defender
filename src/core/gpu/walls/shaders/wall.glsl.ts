export const WALL_VERT = `#version 300 es
layout(location = 0) in vec2 a_position; // World position
layout(location = 1) in vec2 a_uv;       // Tile UV
layout(location = 2) in float a_mat;     // Material type

uniform mat4 u_viewProj;

out vec2 v_worldPos;
out vec2 v_uv;
out float v_mat;

void main() {
    v_worldPos = a_position;
    v_uv = a_uv;
    v_mat = a_mat;
    gl_Position = u_viewProj * vec4(a_position, 0.0, 1.0);
}
`;

export const WALL_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_heatTexture;
uniform vec2 u_worldPixels;

in vec2 v_worldPos;
in vec2 v_uv;
in float v_mat;

out vec4 outColor;

// Blackbody radiation color ramp
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
    // 1. Determine base wall color based on material ID
    // MaterialType: WOOD=1, BRICK=2, STONE=3, METAL=4, INDESTRUCTIBLE=5
    vec3 baseColor = vec3(0.5); // Default grey
    
    if (v_mat == 1.0) baseColor = vec3(0.4, 0.2, 0.1); // Wood (Brown)
    else if (v_mat == 2.0) baseColor = vec3(0.6, 0.2, 0.2); // Brick (Reddish)
    else if (v_mat == 3.0) baseColor = vec3(0.4, 0.4, 0.4); // Stone (Grey)
    else if (v_mat == 4.0) baseColor = vec3(0.3, 0.3, 0.5); // Metal (Blue-ish Grey)
    else if (v_mat == 5.0) baseColor = vec3(0.1, 0.1, 0.1); // Indestructible (Dark)

    // Add a subtle grid/texture pattern based on UV
    float grid = (sin(v_uv.x * 20.0) * 0.5 + 0.5) * (sin(v_uv.y * 20.0) * 0.5 + 0.5);
    baseColor *= (0.8 + 0.2 * grid);

    // 2. Sample heat at this fragment's world position
    vec2 heatUV = vec2(v_worldPos.x / u_worldPixels.x, 1.0 - (v_worldPos.y / u_worldPixels.y));
    float heat = texture(u_heatTexture, heatUV).r;

    // 3. Integrate heat into wall visuals
    vec3 color = baseColor;
    if (heat > 0.01) {
        vec3 glow = getHeatColor(heat);
        // Blend base texture with glow. If very hot, glow dominates.
        color = mix(baseColor, glow, smoothstep(0.1, 0.8, heat));
    }

    // Premultiply alpha for the pipeline (assuming opaque walls)
    outColor = vec4(color, 1.0);
}
`;
