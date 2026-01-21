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
    float typeWithVar = a_props.z;
    float flags = a_props.w;

    float type = floor(typeWithVar);
    float variation = fract(typeWithVar); // 0.0 (white), 0.5 (gray), 1.0 (black)

    v_type = typeWithVar; // Pass full value to fragment
    v_lifeRatio = life / maxLife;
    v_uv = a_quadPos;

    if (life <= 0.0 || flags < 1.0) {
        gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); // Clip
        return;
    }

    float size = 1.0;
    vec4 baseColor = vec4(1.0);

    if (abs(type - TYPE_SMOKE) < 0.1) {
        // --- VOLUMETRIC SMOKE SIZE ---
        // Start small, expand significantly
        size = 12.0 + (1.0 - v_lifeRatio) * 60.0; 
        
        // Color based on variation
        float gray = 0.6 - (variation * 0.5); // 0.6 to 0.1
        baseColor = vec4(vec3(gray), 1.0);
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

uniform float u_time;

// Constants
#define TYPE_STANDARD 0.0
#define TYPE_SHOCKWAVE 1.0
#define TYPE_FLASH 2.0
#define TYPE_MOLTEN 3.0
#define TYPE_SMOKE 4.0

// 2D Hash for noise
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Simple Value Noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// Fractal Brownian Motion (fBm)
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    // 3 Octaves for balance between detail and perf
    for (int i = 0; i < 3; ++i) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    float dist = length(v_uv);
    if (dist > 1.0) discard;

    float type = floor(v_type);
    float variation = fract(v_type);

    vec4 finalColor = v_color;
    float alpha = v_color.a;

    if (abs(type - TYPE_SMOKE) < 0.1) {
        // --- VOLUMETRIC NOISY SMOKE ---
        float t = u_time * 0.4;
        
        // Use fBm for wispy detail
        vec2 p = v_uv * 2.0 + vec2(t, t * 0.5);
        float n = fbm(p);
        
        // Soft boundary that fluctuates with noise
        float boundary = 0.6 + n * 0.4;
        float shape = 1.0 - smoothstep(0.0, boundary, dist);
        
        // Very low alpha per particle for volumetric stacking
        float baseAlpha = 0.15 * (1.0 - variation * 0.5); // Black smoke is more opaque
        alpha = shape * baseAlpha * v_lifeRatio;
        
        // Darken center slightly for depth
        finalColor.rgb *= (0.7 + n * 0.3);
    } else if (abs(type - TYPE_MOLTEN) < 0.1) {
        // --- INCANDESCENT MOLTEN ---
        // Flicker based on time and life
        float flicker = noise(vec2(u_time * 10.0, v_lifeRatio * 5.0)) * 0.2 + 0.9;
        
        float core = 1.0 - smoothstep(0.0, 0.15, dist);
        float glow = pow(1.0 - dist, 4.0); // Natural exponential falloff
        
        vec3 glowColor = vec3(1.0, 0.3, 0.0); // Richer orange
        vec3 coreColor = vec3(1.0, 1.0, 0.9); // White-hot
        
        vec3 combined = mix(glowColor, coreColor, core);
        finalColor.rgb = combined * flicker;
        
        // Boost glow for incandescence
        alpha = (glow * 0.7 + core) * v_color.a * flicker;
    } else {
        // Hard circle
        if (dist > 0.8) alpha = 0.0;
    }

    if (alpha <= 0.01) discard;
    outColor = vec4(finalColor.rgb, alpha);
}
`;
