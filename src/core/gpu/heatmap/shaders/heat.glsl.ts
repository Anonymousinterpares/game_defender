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
    
    outColor = vec4(newHeat, 0.0, 0.0, 1.0);
}
`;

export const HEAT_SPLAT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_heatIn;
uniform vec2 u_point;
uniform float u_radius;
uniform float u_amount;

in vec2 v_uv;
out vec4 outColor;

void main() {
    float center = texture(u_heatIn, v_uv).r;
    
    float dist = distance(v_uv, u_point);
    float falloff = 1.0 - smoothstep(0.0, u_radius, dist);
    
    // Accumulate heat, capped at 1.0
    float newHeat = min(1.0, center + falloff * u_amount);
    
    outColor = vec4(newHeat, 0.0, 0.0, 1.0);
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
    if (t < 0.4) {
        float r = 0.39 + 0.61 * (t / 0.4); // 100/255 approx 0.39
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
    // v_uv is screen 0..1 (bottom-left to top-right in standard WebGL quad)
    // Map screen UV to World Position
    vec2 worldPos = u_camera + vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
    
    // Map World Position to Heat Texture UV (0..1 across entire world)
    vec2 gridUV = vec2(worldPos.x / u_worldPixels.x, 1.0 - (worldPos.y / u_worldPixels.y));
    
    // Safety check: clip to world bounds
    if (gridUV.x < 0.0 || gridUV.x > 1.0 || gridUV.y < 0.0 || gridUV.y > 1.0) {
        discard;
    }

    float heat = texture(u_heatTex, gridUV).r;
    
    // Threshold to keep edges clean and performance up
    if (heat < 0.005) {
        discard;
    }
    
    vec3 color = getHeatColor(heat);
    
    // Alpha ramp matching CPU logic: 0.4 + intensity * 0.6
    float alpha = 0.4 + heat * 0.6;
    
    // Limit max alpha to avoid total opaque blocks unless very hot
    alpha = min(alpha, 0.95);

    // Premultiply alpha for correct additive/alpha blending in GPURenderer
    outColor = vec4(color * alpha, alpha);
}
`;
