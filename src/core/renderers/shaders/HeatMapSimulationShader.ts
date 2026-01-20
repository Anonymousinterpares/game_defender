export const HEATMAP_SIM_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const HEATMAP_SIM_FS = `#version 300 es
precision highp float;

uniform sampler2D u_prevHeat;
uniform float u_dt;
uniform float u_decayRate;
uniform float u_spreadRate;
uniform vec2 u_texelSize;

in vec2 v_uv;
out vec4 outColor;

void main() {
    // Channel mapping:
    // R: Heat (0.0 to 1.0)
    // G: Fire Intensity
    // B: Molten Intensity
    // A: Wall HP / Metadata

    vec4 self = texture(u_prevHeat, v_uv);
    float heat = self.r;

    // Heat Diffusion (4-way neighbor average)
    float sum = heat;
    sum += texture(u_prevHeat, v_uv + vec2(u_texelSize.x, 0.0)).r;
    sum += texture(u_prevHeat, v_uv + vec2(-u_texelSize.x, 0.0)).r;
    sum += texture(u_prevHeat, v_uv + vec2(0.0, u_texelSize.y)).r;
    sum += texture(u_prevHeat, v_uv + vec2(0.0, -u_texelSize.y)).r;
    
    float avg = sum / 5.0;
    
    // Diffusion + Decay
    float nextHeat = heat + (avg - heat) * u_spreadRate;
    nextHeat -= u_decayRate * u_dt;
    
    outColor = vec4(clamp(nextHeat, 0.0, 1.0), self.g, self.b, self.a);
}
`;
