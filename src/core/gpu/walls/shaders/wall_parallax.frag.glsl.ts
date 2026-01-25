export const WALL_PARALLAX_FRAG = `#version 300 es
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
uniform vec2 u_worldPixels;

uniform vec3 u_sunDir;     
uniform vec3 u_sunColor;   
uniform float u_sunIntensity;

uniform vec3 u_moonDir;
uniform vec3 u_moonColor;
uniform float u_moonIntensity;

uniform vec3 u_ambientColor; 
uniform sampler2D u_structureMap;
uniform sampler2D u_sdfTexture;    
uniform sampler2D u_emissiveTexture; 
uniform vec2 u_structureSize;
uniform float u_shadowRange;
uniform float u_tileSize;
in vec2 v_worldPos; 
in float v_time;
uniform float u_useDeferred; // Phase 4: Toggle old lighting

in vec2 v_uv;
in float v_mat;
in vec2 v_faceNormal;
in float v_z;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outNormal;

// Pseudo-random hash
float hash12(vec2 p) {
	vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// 2D Noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
	vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash12(i + vec2(0.0,0.0)), hash12(i + vec2(1.0,0.0)), u.x),
               mix(hash12(i + vec2(0.0,1.0)), hash12(i + vec2(1.0,1.0)), u.x), u.y);
}

// Fire Color Ramp
vec3 getHeatColor(float t) {
    if (t < 0.1) return mix(vec3(0.0), vec3(0.6, 0.0, 0.0), t / 0.1);
    if (t < 0.3) return mix(vec3(0.6, 0.0, 0.0), vec3(1.0, 0.4, 0.0), (t - 0.1) / 0.2);
    if (t < 0.6) return mix(vec3(1.0, 0.4, 0.0), vec3(1.0, 0.9, 0.2), (t - 0.3) / 0.3);
    return mix(vec3(1.0, 0.9, 0.2), vec3(2.0, 2.0, 2.0), (t - 0.6) / 0.4); 
}

// Improved SDF Shadow
float getSDFShadow(vec2 startPos, vec2 dir, float maxDist, sampler2D sdfMap, vec2 worldPixels) {
    vec2 rayDir = normalize(-dir.xy);
    float t = 5.0; 
    
    for (int i = 0; i < 32; i++) {
        vec2 currPos = startPos + rayDir * t;
        vec2 uv = currPos / worldPixels;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        
        float d = texture(sdfMap, uv).r;
        if (d < 1.0) return 0.0;
        
        t += d;
        if (t > maxDist) break;
    }
    return 1.0;
}

// Stochastic Emissive Pathtracing
vec3 sampleEmissivePathtraced(vec2 worldPos, sampler2D sdfMap, sampler2D emissiveMap, vec2 worldPixels) {
    vec3 indirect = vec3(0.0);
    int samples = 8;
    float seed = hash12(worldPos + v_time);
    
    for (int i = 0; i < samples; i++) {
        float angle = (float(i) + seed) * (6.28318 / float(samples));
        vec2 rayDir = vec2(cos(angle), sin(angle));
        float t = 2.0;
        
        for (int j = 0; j < 16; j++) {
            vec2 currPos = worldPos + rayDir * t;
            vec2 uv = currPos / worldPixels;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            
            float d = texture(sdfMap, uv).r;
            if (d < 1.0) { 
                float structureCheck = texture(u_structureMap, uv).r;
                if (structureCheck > 0.5) {
                    indirect += texture(emissiveMap, uv).rgb * (1.0 / (1.0 + t * t * 0.0001));
                }
                break;
            }
            t += d;
            if (t > 200.0) break;
        }
    }
    return indirect / float(samples);
}

// Analytical Entity Shadow
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
            if (isDirectional && projection > 300.0) continue;
            vec2 closestPoint = entPos + dir * projection;
            float distToRay = distance(worldPos, closestPoint);
            
            if (distToRay < entRad) {
                float softness = isDirectional ? smoothstep(entRad, 0.0, distToRay) * (1.0 - projection / 300.0) : 1.0 - smoothstep(entRad * 0.8, entRad, distToRay);
                shadow = max(shadow, softness);
            }
        }
    }
    return shadow;
}

void main() {
    if (v_worldPos.x < 0.0 || v_worldPos.x > u_worldPixels.x || v_worldPos.y < 0.0 || v_worldPos.y > u_worldPixels.y) {
        discard;
    }

    // 1. Material Base Color
    vec3 baseColor = vec3(0.5);
    if (v_mat == 1.0) baseColor = vec3(0.4, 0.2, 0.1); 
    else if (v_mat == 2.0) baseColor = vec3(0.6, 0.2, 0.2); 
    else if (v_mat == 3.0) baseColor = vec3(0.4, 0.4, 0.4); 
    else if (v_mat == 4.0) baseColor = vec3(0.3, 0.3, 0.5); 
    else if (v_mat == 5.0) baseColor = vec3(0.1, 0.1, 0.1); 

    // 2. Multi-Light Calculation
    vec3 lightAcc = u_ambientColor * 1.5;
    
    // Directional (Sun/Moon)
    float sunSDF = 1.0;
    float moonSDF = 1.0;
    
    if (v_z < -0.1) {
        sunSDF = getSDFShadow(v_worldPos, u_sunDir.xy, 150.0, u_sdfTexture, u_worldPixels);
        moonSDF = getSDFShadow(v_worldPos, u_moonDir.xy, 120.0, u_sdfTexture, u_worldPixels);
        float sunEShadow = getEntityShadow(v_worldPos, vec2(0.0), 0.0, u_sunDir.xy, true);
        lightAcc += u_sunColor * u_sunIntensity * 1.0 * min(sunSDF, 1.0 - sunEShadow);
        float moonEShadow = getEntityShadow(v_worldPos, vec2(0.0), 0.0, u_moonDir.xy, true);
        lightAcc += u_moonColor * u_moonIntensity * 1.2 * min(moonSDF, 1.0 - moonEShadow);
    } else {
        float dotSun = max(0.0, -dot(v_faceNormal, u_sunDir.xy));
        float sunEShadow = getEntityShadow(v_worldPos, vec2(0.0), 0.0, u_sunDir.xy, true);
        lightAcc += u_sunColor * u_sunIntensity * dotSun * 1.2 * (1.0 - sunEShadow);
        float dotMoon = max(0.0, -dot(v_faceNormal, u_moonDir.xy));
        float moonEShadow = getEntityShadow(v_worldPos, vec2(0.0), 0.0, u_moonDir.xy, true);
        lightAcc += u_moonColor * u_moonIntensity * dotMoon * 1.5 * (1.0 - moonEShadow);
    }
    
    lightAcc += sampleEmissivePathtraced(v_worldPos, u_sdfTexture, u_emissiveTexture, u_worldPixels) * 10.0;

    // Point Lights - SKIP IF DEFERRED
    if (u_useDeferred < 0.5) {
        for (int i = 0; i < 32; i++) {
            if (u_lights[i].posRad.w < 0.5) continue;
            vec2 lPos = u_lights[i].posRad.xy;
            float lRad = u_lights[i].posRad.z;
            float dist = distance(v_worldPos, lPos);
            if (dist < lRad) {
                float d = dist / lRad;
                float falloff = (1.0 / (1.0 + (dist * dist) * 0.0001)) * (1.0 - d * d) * (1.0 - d * d);
                vec2 dirToLight = normalize(lPos - v_worldPos);
                float dotPL = max(0.1, dot(v_faceNormal, dirToLight));
                float shadow = 1.0;
                if (u_lights[i].posRad.w > 1.5) {
                    vec2 rayOrigin = v_worldPos + v_faceNormal * 0.5;
                    shadow = getSDFShadow(rayOrigin, -dirToLight, u_shadowRange * u_tileSize, u_sdfTexture, u_worldPixels);
                }
                float eShadow = getEntityShadow(v_worldPos, lPos, lRad, vec2(0.0), false);
                lightAcc += u_lights[i].colInt.rgb * u_lights[i].colInt.w * falloff * dotPL * 5.0 * shadow * (1.0 - eShadow);
            }
        }
    }

    float edge = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
    float edgeFactor = smoothstep(0.0, 0.05, edge); 
    vec3 litColor = baseColor * lightAcc * (0.5 + 0.5 * edgeFactor);

    vec2 heatSamplePos = v_worldPos;
    if (length(v_faceNormal) > 0.1) heatSamplePos -= v_faceNormal * u_tileSize * 0.5;
    vec2 heatUV = vec2(heatSamplePos.x / u_worldPixels.x, 1.0 - (heatSamplePos.y / u_worldPixels.y));
    float heat = texture(u_heatTexture, heatUV).r;
    
    vec3 finalColor = litColor;

    if (heat > 0.01) {
        float flicker = 0.8 + 0.2 * noise(vec2(v_time * 20.0, v_worldPos.x));
        float flame = noise(v_worldPos * 0.1 + vec2(0.0, -v_time * 5.0 - v_z * 0.2));
        float combinedHeat = heat * (0.7 + 0.5 * flame) * flicker;
        vec3 heatCol = getHeatColor(clamp(combinedHeat, 0.0, 1.0));
        if (heat < 0.3) {
             finalColor = mix(litColor, litColor * 0.15, smoothstep(0.0, 0.3, heat));
             finalColor = mix(finalColor, heatCol * 1.5, smoothstep(0.1, 0.3, heat)); 
        } else {
             finalColor = mix(litColor * 0.05, heatCol * 2.5, smoothstep(0.3, 0.7, heat));
        }
    }

    outColor = vec4(finalColor, 1.0);
    // Write normals to the second attachment. v_faceNormal is already in world space.
    // We encode (-1, 1) to (0, 1) to store in the texture.
    outNormal = vec4(v_faceNormal * 0.5 + 0.5, v_z / 100.0, 1.0);
}
`;
