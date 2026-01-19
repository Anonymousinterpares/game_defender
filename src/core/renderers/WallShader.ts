export const WALL_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in float a_height; // 0 for base, wallHeight for top
layout(location = 2) in vec3 a_color;
layout(location = 3) in vec2 a_normal;

uniform vec2 u_cameraCenter;
uniform float u_perspectiveStrength;
uniform vec2 u_viewOffset; // -cameraX, -cameraY
uniform vec2 u_viewportSize;

out vec3 v_color;
out vec2 v_normal;

void main() {
    float h = -a_height;
    vec2 worldPos = a_position;
    
    // 1. Perspective Lean (Exact replica of ProjectionUtils.projectPoint)
    vec2 d = worldPos - u_cameraCenter;
    vec2 projected = worldPos;
    projected.x += d.x * h * u_perspectiveStrength;
    projected.y += a_height + d.y * h * u_perspectiveStrength;

    // 2. Camera Translation
    vec2 screenPos = projected + u_viewOffset;

    // 3. Normalized Device Coordinates (NDC)
    // screenPos is in pixels, 0,0 is top-left
    vec2 ndc = (screenPos / u_viewportSize) * 2.0 - 1.0;
    
    // Invert Y because screen space is Y-down
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
    
    v_color = a_color;
    v_normal = a_normal;
}
`;

export const WALL_FS = `#version 300 es
precision highp float;

in vec3 v_color;
in vec2 v_normal;

uniform vec2 u_lightDir;
uniform float u_lightIntensity;

out vec4 outColor;

void main() {
    // Normal is 2D (out from wall)
    // Sun/Moon direction is also 2D
    // Dot product for shading: normal points OUT, lightDir points FROM source
    float dotProduct = dot(u_lightDir, v_normal);
    float shading = max(0.0, -dotProduct) * u_lightIntensity;
    
    // Base ambient (0.5) to full (0.5 + 0.8 = 1.3)
    float factor = 0.5 + shading * 0.8;
    
    outColor = vec4(v_color * factor, 1.0);
}
`;
