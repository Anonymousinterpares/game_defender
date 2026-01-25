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
uniform sampler2D u_normalTex;
in vec2 v_uv;
out vec4 outColor;

void main() {
    vec2 fragPos = v_uv * u_resolution;
    vec2 bottomUpLightPos = vec2(u_lightPos.x, u_resolution.y - u_lightPos.y);
    float dist = distance(fragPos, bottomUpLightPos);
    if (dist > u_lightRadius) discard;

    // Sample Normal from G-Buffer
    vec4 normData = texture(u_normalTex, v_uv);
    vec2 normal = normData.xy * 2.0 - 1.0;
    float height = normData.z * 100.0; // Decode z from (0,1) to (-100,0) approx

    // Calculate Direction to Light in 2D
    vec2 dirToLight = normalize(bottomUpLightPos - fragPos);
    
    // Lambertian-ish shading: how much face points to light
    float dotNL = dot(normal, dirToLight);
    if (length(normal) < 0.1) {
        dotNL = 1.0; // Sky-facing surfaces get full light
    } else {
        dotNL = max(0.1, dotNL); // Minimum bounce light for walls
    }
    
    float d = dist / u_lightRadius;
    float falloff = pow(clamp(1.0 - d*d, 0.0, 1.0), 2.0);
    float attenuation = 1.0 / (1.0 + dist * dist * 0.0001);
    
    vec3 color = u_lightColor * u_lightIntensity * falloff * attenuation * dotNL;
    outColor = vec4(color, 1.0);
}
`;

export const DEFERRED_DIRECTIONAL_FRAG = `#version 300 es
precision highp float;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec2 u_lightDir; // Logical top-down direction
uniform sampler2D u_normalTex;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

void main() {
    // Map lightDir (top-down) to bottom-up NDC screen space
    vec2 dir = normalize(vec2(u_lightDir.x, -u_lightDir.y));

    // Sample Normal from G-Buffer
    vec4 normData = texture(u_normalTex, v_uv);
    vec2 normal = normData.xy * 2.0 - 1.0;
    
    // Directional shading
    float dotNL = dot(normal, -dir);
    if (length(normal) < 0.1) {
        dotNL = 1.0; // Sky-facing surfaces get full light
    } else {
        dotNL = max(0.1, dotNL); 
    }
    
    // Color toning: multiply by intensity and add a touch of tinting
    vec3 color = u_lightColor * u_lightIntensity * dotNL;
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
