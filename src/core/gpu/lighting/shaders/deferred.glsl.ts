export const DEFERRED_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const DEFERRED_SHADOW_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
uniform vec2 u_resolution;

void main() {
    // a_position is in screen pixel coordinates (top-down)
    // Map to bottom-up NDC: y=0 -> 1.0, y=height -> -1.0
    float normY = 1.0 - (a_position.y / u_resolution.y);
    float ndcX = (a_position.x / u_resolution.x) * 2.0 - 1.0;
    float ndcY = normY * 2.0 - 1.0;
    gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
}
`;

export const DEFERRED_SHADOW_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
    // Shadow volume: Output high alpha to "punch out" the light
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export const DEFERRED_AMBIENT_FRAG = `#version 300 es
precision highp float;
uniform vec3 u_ambientColor;
out vec4 outColor;
void main() {
    outColor = vec4(u_ambientColor, 1.0);
}
`;

export const DEFERRED_LIGHT_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_lightPos;     // screen pixels from top-left
uniform float u_lightRadius;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

void main() {
    // fragPos is 0,0 at bottom-left in standard gl_Position quad
    vec2 fragPos = v_uv * u_resolution;
    
    // Map u_lightPos (top-down) to bottom-up
    vec2 bottomUpLightPos = vec2(u_lightPos.x, u_resolution.y - u_lightPos.y);
    
    float dist = distance(fragPos, bottomUpLightPos);
    if (dist > u_lightRadius) discard;
    
    // Smooth inverse square falloff with windowing
    float d = dist / u_lightRadius;
    float falloff = pow(clamp(1.0 - d*d, 0.0, 1.0), 2.0);
    float attenuation = 1.0 / (1.0 + dist * dist * 0.0001);
    
    vec3 color = u_lightColor * u_lightIntensity * falloff * attenuation;
    outColor = vec4(color, 1.0);
}
`;

export const DEFERRED_COMPOSE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_accumulationTex;
uniform sampler2D u_bloomTex;
in vec2 v_uv;
out vec4 outColor;

void main() {
    vec3 light = texture(u_accumulationTex, v_uv).rgb;
    vec3 bloom = texture(u_bloomTex, v_uv).rgb;
    
    // For accumulation phase: just output light
    outColor = vec4(light + bloom, 1.0);
}
`;
