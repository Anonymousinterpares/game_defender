export const PARTICLE_RENDER_VERT = `#version 300 es
layout(location = 0) in vec4 a_posVel;      // Instance Data
layout(location = 1) in vec4 a_props;       // Instance Data
layout(location = 2) in vec2 a_quadPos;     // Vertex Data (Quad corners -1..1)

uniform vec2 u_camera;
uniform vec2 u_resolution;

out vec4 v_color;
out float v_lifeRatio;
out float v_type;
out vec2 v_uv;

// Constants
#define TYPE_STANDARD 0.0
#define TYPE_SHOCKWAVE 1.0
#define TYPE_FLASH 2.0
#define TYPE_MOLTEN 3.0
#define TYPE_SMOKE 4.0

void main() {
    float life = a_props.x;
    float maxLife = a_props.y;
    float type = a_props.z;
    float flags = a_props.w;

    v_type = type;
    v_lifeRatio = life / maxLife;
    v_uv = a_quadPos;

    if (life <= 0.0 || flags < 1.0) {
        gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); // Clip
        return;
    }

    float size = 1.0;
    vec4 baseColor = vec4(1.0);

    if (abs(type - TYPE_SMOKE) < 0.1) {
        // Expand smoke over time
        size = 20.0 + (1.0 - v_lifeRatio) * 40.0; 
        // Fade out
        float alpha = 0.4 * v_lifeRatio; 
        baseColor = vec4(0.6, 0.6, 0.6, alpha);
    } else if (abs(type - TYPE_MOLTEN) < 0.1) {
        size = 40.0; // Increased from 4.0 to match CPU glow radius
        // Hot orange/yellow to red
        // CPU uses white -> yellow -> red -> dark
        baseColor = vec4(1.0, 0.5 + v_lifeRatio * 0.5, 0.0, 1.0);
    } else {
        size = 3.0;
        baseColor = vec4(1.0, 1.0, 1.0, 1.0);
    }

    v_color = baseColor;

    vec2 worldPos = a_posVel.xy + a_quadPos * size;
    vec2 screenPos = worldPos - u_camera;
    
    // Convert to Clip Space (-1 to 1)
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
in vec2 v_uv;

out vec4 outColor;

// Constants
#define TYPE_STANDARD 0.0
#define TYPE_SHOCKWAVE 1.0
#define TYPE_FLASH 2.0
#define TYPE_MOLTEN 3.0
#define TYPE_SMOKE 4.0

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    vec4 finalColor = v_color;
    float alpha = v_color.a;

    if (abs(v_type - TYPE_SMOKE) < 0.1) {
        // Soft circle for smoke
        // dist 0 -> 1. 
        // Soft edge from 0.0 to 1.0
        float shape = 1.0 - smoothstep(0.0, 1.0, dist);
        // Add some noise or variation? For now smooth puff.
        alpha *= shape;
    } else if (abs(v_type - TYPE_MOLTEN) < 0.1) {
        // Bright core, soft glow
        // CPU: Core radius ~2-4px, Glow ~20-30px.
        // Quad is 40px (dist 1.0 = 20px).
        // Core is roughly 0.1 of dist.
        
        float core = 1.0 - smoothstep(0.0, 0.15, dist);
        float glow = 1.0 - smoothstep(0.1, 1.0, dist); // Broad glow
        
        // Accumulate
        vec3 glowColor = vec3(1.0, 0.4, 0.0); // Orange glow
        vec3 coreColor = vec3(1.0, 1.0, 0.8); // White-yellow core
        
        vec3 combined = mix(glowColor, coreColor, core);
        finalColor.rgb = combined;
        
        // Alpha logic
        alpha = glow * 0.8 + core; // Core is opaque
        alpha *= v_color.a; // Fade out with life
    } else {
        // Hard circle
        if (dist > 0.8) alpha = 0.0;
    }

    if (alpha <= 0.01) discard;
    outColor = vec4(finalColor.rgb, alpha);
}
`;
