export const SHADOW_EXTRUSION_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_extrude; // 0.0 = Base, 1.0 = Cap (Extruded)

uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform vec2 u_lightDir; // For Directional Light
uniform float u_shadowLen;

void main() {
    vec2 pos = a_pos;

    if (a_extrude > 0.5) {
        // Extrude this vertex along the light direction
        pos += u_lightDir * u_shadowLen;
    }

    // Convert to Clip Space [-1, 1]
    vec2 screenPos = pos - u_camera;
    vec2 ndc = (screenPos / u_resolution) * 2.0 - 1.0;
    ndc.y = -ndc.y; // Flip Y for WebGL

    gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const SHADOW_EXTRUSION_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_normalTex;
uniform vec2 u_resolution;

out vec4 fragColor;

void main() {
    // Masking: Only draw shadows on the GROUND.
    // Ground writes '1.0' to the Blue channel of Normal Attachment.
    // Walls write 'v_z / 100.0' which is typically < 0.9.
    
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec4 norm = texture(u_normalTex, uv);
    
    if (norm.b < 0.95) {
        discard; // It's a wall, don't shadow it.
    }

    // Shadow mask is typically red or alpha-based. 
    // In our accumulation buffer setup, we might simple write '1.0' to R channel 
    // or use blending to subtract light.
    
    fragColor = vec4(0.0, 0.0, 0.0, 1.0); // Opaque Black Shadow
}
`;
