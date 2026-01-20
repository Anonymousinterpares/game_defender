export const PARTICLE_RENDER_VERT = `#version 300 es
layout(location = 0) in vec4 a_posVel;      // Instance Data
layout(location = 1) in vec4 a_props;       // Instance Data
layout(location = 2) in vec2 a_quadPos;     // Vertex Data (Quad corners)

uniform vec2 u_camera;
uniform vec2 u_resolution;

out vec4 v_color;
out float v_lifeRatio;
out float v_type;

// Constants
#define TYPE_STANDARD 0.0
#define TYPE_SMOKE 1.0
#define TYPE_SHOCKWAVE 2.0
#define TYPE_FLASH 3.0
#define TYPE_MOLTEN 4.0

void main() {
    float life = a_props.x;
    float maxLife = a_props.y;
    float type = a_props.z;
    float flags = a_props.w;

    v_type = type;
    v_lifeRatio = life / maxLife;

    if (life <= 0.0 || flags < 1.0) {
        gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); // Clip
        return;
    }

    float size = 1.0;
    if (type == TYPE_SMOKE) {
        size = 20.0 + (1.0 - v_lifeRatio) * 30.0; // Expand
        // Fade out smoke
        v_color = vec4(0.5, 0.5, 0.5, 0.2 * v_lifeRatio); 
    } else {
        size = 3.0;
        v_color = vec4(1.0, 1.0, 1.0, 1.0);
    }

    vec2 worldPos = a_posVel.xy + a_quadPos * size;
    
    // Screenspace conversion (Top-Left 0,0)
    vec2 screenPos = worldPos - u_camera;
    
    // Convert to Clip Space (-1 to 1)
    // WebGL is Bottom-Left (-1,-1), Top-Right (1,1)
    // Canvas coords: X(0..W), Y(0..H)
    
    float clipX = (screenPos.x / u_resolution.x) * 2.0 - 1.0;
    float clipY = 1.0 - (screenPos.y / u_resolution.y) * 2.0;

    gl_Position = vec4(clipX, clipY, 0.0, 1.0);
}
`;

export const PARTICLE_RENDER_FRAG = `#version 300 es
precision highp float;

in vec4 v_color;
in float v_lifeRatio;
in float v_type;

out vec4 outColor;

void main() {
    // Simple circle shape
    vec2 coord = gl_PointCoord * 2.0 - 1.0; // -1 to 1 // BUT we use a_quadPos 
    // Wait, we are using quads, so we don't have gl_PointCoord unless using POINTS primitive.
    // We didn't pass UVs. But a_quadPos is -1..1.
    // Let's assume we can compute UV or just use color for now.
    
    // Actually, we need UVs from the quad.
    // Let's keep it simple: just draw a square/circle based on distance from center logic if we have UVs passed as varyings.
    // For now, solid block to verify.
    
    outColor = v_color;
}
`;
