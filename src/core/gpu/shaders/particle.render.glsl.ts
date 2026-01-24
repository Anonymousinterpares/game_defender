export const PARTICLE_RENDER_VERT = `#version 300 es
layout(location = 0) in vec4 a_posLife;      // x, y, z, life
layout(location = 1) in vec4 a_velMaxLife;   // vx, vy, vz, maxLife
layout(location = 2) in vec4 a_props;       // type, flags, variation, extra
layout(location = 3) in vec2 a_quadPos;     

uniform vec2 u_camera;
uniform vec2 u_cameraCenter;
uniform vec2 u_resolution;
uniform vec2 u_worldSize;
uniform float u_time;
uniform float u_perspectiveStrength;

out vec4 v_color;
out float v_lifeRatio;
out float v_type;
out vec2 v_uv;

#define TYPE_SMOKE 4.0
#define TYPE_FIRE 5.0
#define TYPE_MOLTEN 3.0

void main() {
    float life = a_posLife.w;
    float maxLife = a_velMaxLife.w;
    float type = a_props.x;
    float flags = a_props.y;
    float variation = a_props.z;

    v_type = type + variation; 
    v_lifeRatio = life / maxLife;
    v_uv = a_quadPos;

    if (life <= 0.0 || flags < 1.0) {
        gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); 
        return;
    }

    float size = 1.0;
    vec4 baseColor = vec4(1.0);

    if (abs(type - TYPE_SMOKE) < 0.1) {
        size = 12.0 + (1.0 - v_lifeRatio) * 60.0; 
        float gray = 0.6 - (variation * 0.5); 
        baseColor = vec4(vec3(gray), 1.0);
    } else if (abs(type - TYPE_MOLTEN) < 0.1) {
        size = 40.0; 
        baseColor = vec4(1.0, 0.5 + v_lifeRatio * 0.5, 0.0, 1.0);
    } else if (abs(type - TYPE_FIRE) < 0.1) {
        size = 15.0 * (0.5 + v_lifeRatio * 0.5);
        baseColor = vec4(1.0, 0.8, 0.2, 1.0); 
    } else {
        size = 3.0;
        baseColor = vec4(1.0, 1.0, 1.0, 1.0);
    }

    v_color = baseColor;

    // --- PSEUDO 3D PERSPECTIVE PROJECTION ---
    vec3 worldPos = a_posLife.xyz;
    
    // Parallax Lean
    vec2 delta = worldPos.xy - u_cameraCenter;
    float h = -worldPos.z; // negative for UP
    vec2 leanOffset = delta * h * u_perspectiveStrength;
    
    vec2 projectedXY = worldPos.xy + leanOffset;
    float projectedY = projectedXY.y + worldPos.z; // Vertical shift from height
    
    // Quad expansion in Screen Space
    vec2 finalWorldPos = vec2(projectedXY.x, projectedY) + a_quadPos * size;

    vec2 screenPos = finalWorldPos - u_camera;
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
#define TYPE_FIRE 5.0

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
        // --- INCANDESCENT MOLTEN COOLING RAMP ---
        float flicker = noise(vec2(u_time * 12.0, v_lifeRatio * 7.0)) * 0.15 + 0.85;
        
        float core = 1.0 - smoothstep(0.0, 0.12, dist);
        float glowArea = pow(1.0 - dist, 4.0);
        
        // Dynamic Color Ramp
        vec3 color;
        if (v_lifeRatio > 0.8) {
            // White-hot to Yellow
            color = mix(vec3(1.0, 0.9, 0.4), vec3(1.0, 1.0, 1.0), (v_lifeRatio - 0.8) * 5.0);
        } else if (v_lifeRatio > 0.5) {
            // Yellow to Orange
            color = mix(vec3(1.0, 0.4, 0.0), vec3(1.0, 0.9, 0.4), (v_lifeRatio - 0.5) * 3.33);
        } else if (v_lifeRatio > 0.2) {
            // Orange to Deep Red
            color = mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.4, 0.0), (v_lifeRatio - 0.2) * 3.33);
        } else {
            // Deep Red to Dark Cold Grey
            color = mix(vec3(0.1, 0.1, 0.1), vec3(0.5, 0.0, 0.0), v_lifeRatio * 5.0);
        }
        
        finalColor.rgb = color * flicker;
        
        // Alpha follows "heat" - cold particles are much dimmer
        float heatAlpha = mix(0.1, 1.0, smoothstep(0.0, 0.4, v_lifeRatio));
        alpha = (glowArea * 0.6 + core) * heatAlpha * flicker;
    } else if (abs(type - TYPE_FIRE) < 0.1) {
        // --- FLICKERING FLAME VISUALS ---
        float flicker = noise(vec2(u_time * 25.0, v_lifeRatio * 10.0));
        
        // Elongated shape (teardrop-ish approximation)
        float shape = 1.0 - smoothstep(0.0, 0.5 + flicker * 0.3, dist);
        shape *= (1.0 - v_uv.y * 0.5); // Narrower at top
        
        // Color Ramp for Flames
        vec3 color;
        if (v_lifeRatio > 0.8)      color = mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 1.0, 1.0), (v_lifeRatio - 0.8) * 5.0); // Inner white core
        else if (v_lifeRatio > 0.4) color = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.8, 0.2), (v_lifeRatio - 0.4) * 2.5); // Yellow/Orange
        else                        color = mix(vec3(0.4, 0.0, 0.0), vec3(1.0, 0.3, 0.0), v_lifeRatio * 2.5);         // Red/Orange bottom
        
        finalColor.rgb = color * (0.8 + 0.4 * flicker);
        alpha = shape * (0.4 + 0.6 * v_lifeRatio);
    } else {
        // Hard circle
        if (dist > 0.8) alpha = 0.0;
    }

    if (alpha <= 0.01) discard;
    outColor = vec4(finalColor.rgb * alpha, alpha);
}
`;
