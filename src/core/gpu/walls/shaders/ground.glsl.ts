export const GROUND_VERT = `#version 300 es
layout(location = 0) in vec2 a_position; // NDC position [-1, 1]

uniform float u_time;
out vec2 v_worldPos;
out float v_time;

void main() {
    v_worldPos = a_position;
    v_time = u_time;
    gl_Position = vec4(a_position, 0.999, 1.0);
}
`;

export const GROUND_FRAG = `#version 300 es
precision highp float;

struct Light {
    vec4 posRad; // x, y, radius, active
    vec4 colInt; // r, g, b, intensity
};

layout(std140) uniform LightBlock {
    Light u_lights[32];
};

struct Entity {
    vec4 posRad; // x, y, radius, active
};

layout(std140) uniform EntityBlock {
    Entity u_entities[32];
};

uniform sampler2D u_heatTexture;
uniform sampler2D u_groundTexture;
uniform sampler2D u_worldMap; 
uniform sampler2D u_structureMap; 
uniform sampler2D u_sdfTexture;    
uniform sampler2D u_emissiveTexture; 
uniform sampler2D u_scorchTexture; // New permanent scorch layer
uniform vec2 u_worldPixels;
uniform vec2 u_structureSize;
uniform vec2 u_camera;
uniform vec2 u_resolution;
uniform float u_tileSize;
uniform vec3 u_ambientColor;

uniform vec3 u_sunColor;
uniform float u_sunIntensity;
uniform vec3 u_sunDir; 

uniform vec3 u_moonColor;
uniform float u_moonIntensity;
uniform vec3 u_moonDir;

uniform float u_textureScale;
uniform float u_shadowRange; 
uniform float u_useDeferred; // Phase 4 toggle

in vec2 v_worldPos; 
in float v_time;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outNormal;

vec3 getHeatColor(float t) {
    if (t < 0.15) return mix(vec3(0.1, 0.0, 0.0), vec3(0.5, 0.0, 0.0), t / 0.15); // Dark Red
    if (t < 0.4) return mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.2, 0.0), (t - 0.15) / 0.25); // Red to Orange
    if (t < 0.7) return mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.8, 0.2), (t - 0.4) / 0.3); // Orange to Yellow
    return mix(vec3(1.0, 0.8, 0.2), vec3(2.0, 2.0, 2.0), (t - 0.7) / 0.3); // Yellow to White-Hot
}

float hash12(vec2 p) {
	vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
	vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash12(i + vec2(0.0,0.0)), hash12(i + vec2(1.0,0.0)), u.x),
               mix(hash12(i + vec2(0.0,1.0)), hash12(i + vec2(1.0,1.0)), u.x), u.y);
}

// Improved SDF Shadow (Viewport Relative)
float getSDFShadow(vec2 startPos, vec2 rayDir, float maxDist, sampler2D sdfMap, vec2 camera, vec2 resolution) {
    float t = 5.0; // Bias to exit wall
    for (int i = 0; i < 32; i++) {
        vec2 currPos = startPos + rayDir * t;
        // Map world currPos to Screen UV for SDF lookup
        vec2 uv = (currPos - camera) / resolution;
        uv.y = 1.0 - uv.y; // Standard flip: Logical Y to Screen UV
        
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        
        float d = texture(sdfMap, uv).r;
        if (d < 1.0) return 0.0;
        
        t += d;
        if (t > maxDist) break;
    }
    return 1.0;
}

// Stochastic Emissive Pathtracing (High Fidelity Smooth Sweeps)
vec3 sampleEmissivePathtraced(vec2 worldPos, sampler2D sdfMap, sampler2D emissiveMap, vec2 camera, vec2 resolution) {
    vec3 indirect = vec3(0.0);
    int samples = 32; // Scientist-Grade sampling for smooth sweeps
    float jitter = hash12(worldPos + v_time);
    
    for (int i = 0; i < samples; i++) {
        float angle = (float(i) + jitter) * (6.28318 / float(samples));
        vec2 rayDir = vec2(cos(angle), sin(angle));
        
        // Start ray slightly jittered and offset to prevent precision self-occlusion
        float t = 6.0 + (hash12(worldPos * float(i+1) + v_time) * 4.0);
        
        for (int j = 0; j < 16; j++) {
            vec2 currPos = worldPos + rayDir * t;
            vec2 uv = (currPos - camera) / resolution;
            uv.y = 1.0 - uv.y;
            
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            
            float d = texture(sdfMap, uv).r;
            if (d < 1.0) { // Hit a wall
                // We add the emissive contribution from the wall.
                // We weight by distance squared falloff.
                indirect += texture(emissiveMap, uv).rgb * (1.0 / (1.0 + t * t * 0.0001));
                break;
            }
            // Step carefully to avoid skipping thin wall fragments
            t += max(d * 0.8, 4.0);
            if (t > 400.0) break;
        }
    }
    return indirect / float(samples);
}

// Analytical Entity Shadow (Circle Projection) - Kept for entities as they are dynamic
float getEntityShadow(vec2 worldPos, vec2 lightPos, float lightRad, vec2 lightDir, bool isDirectional) {
    float shadow = 0.0;
    for (int i = 0; i < 32; i++) {
        if (u_entities[i].posRad.w < 0.5) continue;
        
        vec2 entPos = u_entities[i].posRad.xy;
        float entRad = u_entities[i].posRad.z;
        
        vec2 dir;
        float distToLight;
        
        if (isDirectional) {
            dir = -normalize(lightDir);
            distToLight = 99999.0;
        } else {
            dir = normalize(worldPos - lightPos);
            distToLight = distance(lightPos, worldPos);
            if (distance(lightPos, entPos) > distToLight) continue;
        }
        
        vec2 entToPixel = worldPos - entPos;
        float projection = dot(entToPixel, dir);
        
        if (projection > 0.0) {
            // Apply maximum shadow distance for directional lights (Sun/Moon)
            if (isDirectional && projection > 300.0) continue;
            
            vec2 closestPoint = entPos + dir * projection;
            float distToRay = distance(worldPos, closestPoint);
            
            if (distToRay < entRad) {
                // Softness increases with distance for directional shadows
                float softness = isDirectional ? smoothstep(entRad, 0.0, distToRay) * (1.0 - projection / 300.0) : 1.0 - smoothstep(entRad * 0.8, entRad, distToRay);
                shadow = max(shadow, softness);
            }
        }
    }
    return shadow;
}

void main() {
    vec2 screenUV = v_worldPos * 0.5 + 0.5; // NDC [-1, 1] to UV [0, 1]
    vec2 worldPos = u_camera + vec2(screenUV.x * u_resolution.x, (1.0 - screenUV.y) * u_resolution.y);
    
    if (worldPos.x < 0.0 || worldPos.x > u_worldPixels.x || worldPos.y < 0.0 || worldPos.y > u_worldPixels.y) {
        discard;
    }
    
    // 1. Base Texture
    float textureTileSize = u_tileSize * u_textureScale;
    vec2 textureUV = mod(worldPos, textureTileSize) / textureTileSize;
    vec3 texColor = texture(u_groundTexture, textureUV).rgb;
    
    // 2. Multi-Light Calculation
    vec3 lightAcc = u_ambientColor * 1.5;

    // Static Wall Shadows (SDF) + Directional Lights
    float sunSDF = getSDFShadow(worldPos, -normalize(u_sunDir.xy), 150.0, u_sdfTexture, u_camera, u_resolution);
    lightAcc += u_sunColor * u_sunIntensity * 0.7 * min(sunSDF, 1.0);
    
    float moonSDF = getSDFShadow(worldPos, -normalize(u_moonDir.xy), 120.0, u_sdfTexture, u_camera, u_resolution);
    lightAcc += u_moonColor * u_moonIntensity * 1.2 * min(moonSDF, 1.0);
    
    // Unified Pathtraced Lighting (Fire + Point Lights)
    float emissiveMultiplier = mix(10.0, 0.4, u_sunIntensity);
    lightAcc += sampleEmissivePathtraced(worldPos, u_sdfTexture, u_emissiveTexture, u_camera, u_resolution) * emissiveMultiplier;

    // Remaining Dynamic Point Lights 
    if (u_useDeferred < 0.5) {
        for (int i = 0; i < 32; i++) {
            if (u_lights[i].posRad.w < 0.5) continue;
            
            vec2 lPos = u_lights[i].posRad.xy;
            float lRad = u_lights[i].posRad.z;
            float dist = distance(worldPos, lPos);
            
            if (dist < lRad) {
                float d = dist / lRad;
                float denom = 1.0 + (dist * dist) * 0.0001;
                float window = (1.0 - d * d);
                float falloff = (1.0 / denom) * window * window; 
                
                float shadow = 1.0;
                if (u_lights[i].posRad.w > 1.5) {
                    vec2 dirToLight = normalize(lPos - worldPos);
                    shadow = getSDFShadow(worldPos, dirToLight, lRad, u_sdfTexture, u_camera, u_resolution);
                }
                
                float eShadow = getEntityShadow(worldPos, lPos, lRad, vec2(0.0), false);
                lightAcc += u_lights[i].colInt.rgb * u_lights[i].colInt.w * falloff * 2.0 * shadow * (1.0 - eShadow);
            }
        }
    }
    
    vec3 litColor = texColor * lightAcc;
    
    // Grid Overlay
    vec2 gridPos = mod(worldPos, u_tileSize);
    float gridLine = step(u_tileSize - 1.0, gridPos.x) + step(u_tileSize - 1.0, gridPos.y);
    litColor = mix(litColor, litColor * 0.7, gridLine * 0.3);

    // Heat & Animated Ember Glow
    vec2 heatUV = worldPos / u_worldPixels;
    float heat = texture(u_heatTexture, heatUV).r;
    float scorch = texture(u_scorchTexture, heatUV).r;
    
    vec3 finalColor = litColor;
    
    if (scorch > 0.01) {
        finalColor = mix(finalColor, finalColor * 0.2, smoothstep(0.0, 0.6, scorch));
    }

    if (heat > 0.01) {
        float flicker = 0.8 + 0.2 * noise(worldPos * 0.1 + vec2(0.0, v_time * 2.0));
        vec3 glow = getHeatColor(clamp(heat * flicker, 0.0, 1.0));
        finalColor = mix(finalColor, finalColor * 0.1, smoothstep(0.0, 0.4, heat));
        finalColor = mix(finalColor, glow, smoothstep(0.1, 0.8, heat));
    }
    
    outColor = vec4(finalColor, 1.0);
    // Ground is flat, normal is straight UP (0.5, 0.5, 1.0) encoded
    outNormal = vec4(0.5, 0.5, 1.0, 1.0); 
}
`;
