export const HEAT_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const HEAT_UPDATE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_heatIn;
uniform vec2 u_texelSize;
uniform float u_spreadRate;
uniform float u_decayRate;
uniform float u_dt;

in vec2 v_uv;
out vec4 outColor;

void main() {
    float center = texture(u_heatIn, v_uv).r;
    
    // Sample 4 neighbors (heat spreads everywhere, walls heat up too)
    float left  = texture(u_heatIn, v_uv + vec2(-u_texelSize.x, 0.0)).r;
    float right = texture(u_heatIn, v_uv + vec2( u_texelSize.x, 0.0)).r;
    float up    = texture(u_heatIn, v_uv + vec2(0.0,  u_texelSize.y)).r;
    float down  = texture(u_heatIn, v_uv + vec2(0.0, -u_texelSize.y)).r;
    
    // Gaussian blur / diffusion averaging
    float avg = (center + left + right + up + down) / 5.0;
    float newHeat = center + (avg - center) * u_spreadRate;
    
    // Decay logic (organic cooling)
    newHeat = max(0.0, newHeat - u_decayRate * u_dt);
    
    // Safety clamp (prevent massive accumulation from additive splats)
    newHeat = min(5.0, newHeat);
    
    outColor = vec4(newHeat, 0.0, 0.0, 1.0);
}
`;

export const HEAT_SPLAT_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_point;   // UV space
uniform float u_radius;  // Pixel space
uniform float u_amount;
uniform vec2 u_worldPixels;

in vec2 v_uv;
out vec4 outColor;

void main() {
    // Map both UVs to pixel space for distance
    vec2 p1 = v_uv * u_worldPixels;
    vec2 p2 = u_point * u_worldPixels;
    
    float dist = distance(p1, p2);
    float falloff = 1.0 - smoothstep(0.0, u_radius, dist);
    
    // Output ONLY the delta (additive blending handles accumulation)
    outColor = vec4(falloff * u_amount, 0.0, 0.0, 1.0);
}
`;

export const HEAT_RENDER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_heatTex;
uniform vec2 u_camera;
uniform vec2 u_resolution;
uniform vec2 u_worldPixels;

in vec2 v_uv;
out vec4 outColor;

vec3 getHeatColor(float t) {
    // Range 0.0 to 3.0
    if (t < 0.5) {
        // Dark Red to Red
        return vec3(0.5 + t, 0.0, 0.0);
    } else if (t < 1.5) {
        // Red to Orange/Yellow
        float g = (t - 0.5) / 1.0; 
        return vec3(1.0, g * 0.8, 0.0);
    } else if (t < 2.5) {
        // Yellow to White-Hot
        float b = (t - 1.5) / 1.0;
        return vec3(1.0, 0.8 + b * 0.2, b);
    } else {
        // Pure blinding white
        return vec3(1.0, 1.0, 1.0);
    }
}

void main() {
    // v_uv is screen 0..1 (bottom=0).
    // Game Logic: Y increases Downwards. Screen (0,1) [Top] is World Camera Y.
    // Screen (0,0) [Bottom] is World Camera Y + Resolution Y.
    vec2 worldPos = u_camera + vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
    
    // Map World Position to Heat Texture UV (Top-Down Logical)
    vec2 gridUV = worldPos / u_worldPixels;
    
    // Safety check: clip to world bounds
    if (gridUV.x < 0.0 || gridUV.x > 1.0 || gridUV.y < 0.0 || gridUV.y > 1.0) {
        discard;
    }

    float heat = texture(u_heatTex, gridUV).r;
    
    // Threshold to keep edges clean and performance up
    if (heat < 0.01) {
        discard;
    }
    
    vec3 color = getHeatColor(heat);
    
    // Alpha ramp:
    // Low heat (0.1) -> Low alpha (0.3)
    // High heat (3.0) -> High alpha (0.9)
    float alpha = smoothstep(0.0, 2.0, heat) * 0.7 + 0.2;
    
    // Limit max alpha to avoid total opaque blocks unless very hot
    alpha = min(alpha, 0.90);

    // Premultiply alpha for correct additive/alpha blending in GPURenderer
    outColor = vec4(color * alpha, alpha);
}
`;
