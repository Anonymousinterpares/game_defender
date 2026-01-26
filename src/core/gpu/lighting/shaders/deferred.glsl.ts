export const DEFERRED_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
uniform vec2 u_resolution;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const DEFERRED_SHADOW_VERT = `#version 300 es
layout(location = 0) in vec2 a_position; // World Coordinates
uniform mat4 u_viewProj;
uniform vec2 u_camera;
uniform vec2 u_resolution;
out vec2 v_uv;

void main() {
    // Correct UV calculation for G-Buffer sampling (World to Screen to UV)
    vec2 screenPos = a_position - u_camera;
    v_uv = vec2(screenPos.x / u_resolution.x, 1.0 - (screenPos.y / u_resolution.y));
    
    // Use the SAME viewProj as the walls for perfect bit-level alignment
    // We use Z=0.998 to be just in front of ground but behind walls
    // Since u_viewProj handles worldY -> NDC Z, we override Z manually
    vec4 pos = u_viewProj * vec4(a_position, 0.0, 1.0);
    gl_Position = vec4(pos.xy, 0.998, 1.0);
}
`;

export const DEFERRED_SHADOW_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_normalTex;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;
void main() {
    // Sample Normal from G-Buffer
    vec4 normData = texture(u_normalTex, v_uv);
    // normData.z corresponds to height (v_z/100). For ground it is 1.0. For walls it is <= 0.0.
    if (normData.z < 0.1) discard; 

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
uniform float u_wallHeight;
uniform float u_directionalShadowLen;

struct Entity {
    vec4 posRad; // x, y, radius, height
};

layout(std140) uniform EntityBlock {
    Entity u_entities[32];
};

uniform vec2 u_camera; // camera position in world space
uniform sampler2D u_normalTex;
in vec2 v_uv;
out vec4 outColor;

float getEntityShadow(vec2 fragPos, vec2 lightPos, vec2 lightDir, bool isDirectional) {
    float shadow = 0.0;
    for (int i = 0; i < 32; i++) {
        float entHeight = u_entities[i].posRad.w;
        if (entHeight < 0.1) continue;
        
        vec2 entWorldPos = u_entities[i].posRad.xy;
        // Convert entity world position to screen space (Y-down, origin top-left)
        vec2 screenEntPos = entWorldPos - u_camera;
        // NOTE: v_uv is Y-up (0 at bottom, 1 at top), so fragPos is Y-up.
        // We need screenEntPos to also be Y-up for consistent math.
        screenEntPos.y = u_resolution.y - screenEntPos.y;
        float entRad = u_entities[i].posRad.z;
        
        vec2 shadowDir;
        float effectiveShadowLen;
        if (isDirectional) {
            // lightDir is the direction FROM the sun TO the scene (world coords, Y-down).
            // Shadow extends AWAY from the light, i.e., in the +lightDir direction.
            // Convert to screen-space (Y-up): flip the Y component.
            shadowDir = normalize(vec2(lightDir.x, -lightDir.y));
            effectiveShadowLen = u_directionalShadowLen * (entHeight / u_wallHeight);
        } else {
            // Point light: shadow extends away from light position
            shadowDir = normalize(screenEntPos - lightPos);
            if (distance(lightPos, screenEntPos) > distance(lightPos, fragPos)) continue;
            effectiveShadowLen = u_lightRadius * (entHeight / u_wallHeight);
        }
        
        // Vector from entity to fragment
        vec2 entToFrag = fragPos - screenEntPos;
        // Project entToFrag onto the shadow direction
        float projection = dot(entToFrag, shadowDir);
        
        if (projection > 0.0 && projection < effectiveShadowLen) {
            // Find the closest point on the shadow ray to the fragment
            vec2 pointOnRay = screenEntPos + shadowDir * projection;
            float distToRay = distance(fragPos, pointOnRay);
            
            if (distToRay < entRad) {
                float distFade = 1.0 - (projection / effectiveShadowLen);
                float radiusFade = 1.0 - smoothstep(entRad * 0.5, entRad, distToRay);
                shadow = max(shadow, distFade * radiusFade);
            }
        }
    }
    return shadow;
}

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
    
    float shadow = getEntityShadow(fragPos, bottomUpLightPos, vec2(0.0), false);
    
    // Shadow Bleeding: Shadows are not 100% pitch black
    float shadowFactor = 1.0 - (shadow * 0.85); 
    
    vec3 color = u_lightColor * u_lightIntensity * falloff * attenuation * dotNL * shadowFactor;
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
uniform vec2 u_camera;
uniform float u_wallHeight;
uniform float u_directionalShadowLen;
in vec2 v_uv;
out vec4 outColor;

struct Entity {
    vec4 posRad; // x, y, radius, height
};

layout(std140) uniform EntityBlock {
    Entity u_entities[32];
};

float getEntityShadow(vec2 fragPos, vec2 lightDir) {
    float shadow = 0.0;
    for (int i = 0; i < 32; i++) {
        float entHeight = u_entities[i].posRad.w;
        if (entHeight < 0.1) continue;
        
        vec2 entWorldPos = u_entities[i].posRad.xy;
        // Convert entity world position to screen space (Y-down, origin top-left)
        vec2 screenEntPos = entWorldPos - u_camera;
        // NOTE: v_uv is Y-up (0 at bottom, 1 at top), so fragPos is Y-up.
        // We need screenEntPos to also be Y-up for consistent math.
        screenEntPos.y = u_resolution.y - screenEntPos.y;
        float entRad = u_entities[i].posRad.z;
        
        // Directional light only - shadow extends in the light direction
        // lightDir is the direction FROM the sun TO the scene (world coords, Y-down).
        // Shadow extends AWAY from the light, i.e., in the +lightDir direction.
        // Convert to screen-space (Y-up): flip the Y component.
        vec2 shadowDir = normalize(vec2(lightDir.x, -lightDir.y));
        float effectiveShadowLen = u_directionalShadowLen * (entHeight / u_wallHeight);

        
        // Vector from entity to fragment
        vec2 entToFrag = fragPos - screenEntPos;
        // Project entToFrag onto the shadow direction
        float projection = dot(entToFrag, shadowDir);
        
        if (projection > 0.0 && projection < effectiveShadowLen) {
            // Find the closest point on the shadow ray to the fragment
            vec2 pointOnRay = screenEntPos + shadowDir * projection;
            float distToRay = distance(fragPos, pointOnRay);
            
            if (distToRay < entRad) {
                float distFade = 1.0 - (projection / effectiveShadowLen);
                float radiusFade = 1.0 - smoothstep(entRad * 0.5, entRad, distToRay);
                shadow = max(shadow, distFade * radiusFade);
            }
        }
    }
    return shadow;
}

uniform float u_lightAltitude; // 0 (horizon) to 1 (zenith)

void main() {
    // Map lightDir (top-down) to bottom-up NDC screen space
    vec2 dir = normalize(vec2(u_lightDir.x, -u_lightDir.y));

    // Sample Normal from G-Buffer
    vec4 normData = texture(u_normalTex, v_uv);
    vec2 normal = normData.xy * 2.0 - 1.0;
    
    // Directional shading
    float dotNL = dot(normal, -dir);
    
    // Altitude-based ground shading
    if (length(normal) < 0.1) {
        // Ground receives light based on altitude
        dotNL = clamp(u_lightAltitude, 0.05, 1.0); 
    } else {
        // Walls receive light based on 2D dot product, scaled by altitude
        dotNL = max(0.05, dotNL) * (0.3 + 0.7 * clamp(u_lightAltitude * 2.0, 0.0, 1.0)); 
    }
    
    // Color toning
    vec3 color = u_lightColor * u_lightIntensity * dotNL;
    
    // Entity Shadows for directional light
    vec2 fragPos = v_uv * u_resolution;
    float shadow = getEntityShadow(fragPos, u_lightDir);
    
    // Shadow Bleeding
    float shadowFactor = 1.0 - (shadow * 0.85);
    
    outColor = vec4(color * shadowFactor, 1.0);
}
`;

export const DEFERRED_EMISSIVE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_normalTex; // Normal.a has heat intensity
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

vec3 getHeatColor(float t) {
    if (t < 0.1) return mix(vec3(0.0), vec3(0.6, 0.0, 0.0), t / 0.1);
    if (t < 0.3) return mix(vec3(0.6, 0.0, 0.0), vec3(1.0, 0.4, 0.0), (t - 0.1) / 0.2);
    if (t < 0.6) return mix(vec3(1.0, 0.4, 0.0), vec3(1.0, 0.9, 0.2), (t - 0.3) / 0.3);
    return mix(vec3(1.0, 0.9, 0.2), vec3(2.0, 2.0, 2.0), (t - 0.6) / 0.4); 
}

void main() {
    float heatValue = texture(u_normalTex, v_uv).a;
    if (heatValue < 0.01) discard;
    
    vec3 glow = getHeatColor(clamp(heatValue, 0.0, 1.0));
    // Boost intensity for bloom/emissive look
    outColor = vec4(glow * 2.0, 1.0);
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
