export const WALL_PARALLAX_FRAG = `#version 300 es
precision highp float;

struct Light {
    vec4 posRad; // x, y, radius, active
    vec4 colInt; // r, g, b, intensity
};

layout(std140) uniform LightBlock {
    Light u_lights[32];
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
uniform vec2 u_structureSize;
uniform float u_shadowRange;
uniform float u_tileSize;

in vec2 v_worldPos;
in vec2 v_uv;
in float v_mat;
in vec2 v_faceNormal;
in float v_z;

out vec4 outColor;

vec3 getHeatColor(float t) {
    if (t < 0.4) return vec3(0.39 + 0.61 * (t / 0.4), 0.0, 0.0);
    else if (t < 0.8) return vec3(1.0, (t - 0.4) / 0.4, 0.0);
    else return vec3(1.0, 1.0, (t - 0.8) / 0.2);
}

// Raymarching DDA shadow function
float getShadow(vec2 startPos, vec2 dir, float maxDist, sampler2D structMap, vec2 worldPixels) {
    vec2 rayDir = -normalize(dir.xy); 
    vec2 structSize = vec2(textureSize(structMap, 0));
    vec2 pos = (startPos / worldPixels) * structSize;
    vec2 step = sign(rayDir);
    vec2 deltaDist = abs(1.0 / rayDir);
    vec2 sideDist;
    
    if (rayDir.x < 0.0) sideDist.x = (pos.x - floor(pos.x)) * deltaDist.x;
    else sideDist.x = (floor(pos.x) + 1.0 - pos.x) * deltaDist.x;
    
    if (rayDir.y < 0.0) sideDist.y = (pos.y - floor(pos.y)) * deltaDist.y;
    else sideDist.y = (floor(pos.y) + 1.0 - pos.y) * deltaDist.y;
    
    float distTraveled = 0.0;
    float shadow = 0.0;
    
    for(int i = 0; i < 80; i++) {
        if (distTraveled > (maxDist / worldPixels.x) * structSize.x) break;
        vec2 sampleUV = (floor(pos) + 0.5) / structSize;
        float val = texture(structMap, sampleUV).r;
        if (val > 0.4) {
            shadow = smoothstep(0.4, 0.6, val);
            break;
        }
        if (sideDist.x < sideDist.y) {
            distTraveled = sideDist.x;
            sideDist.x += deltaDist.x;
            pos.x += step.x;
        } else {
            distTraveled = sideDist.y;
            sideDist.y += deltaDist.y;
            pos.y += step.y;
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
    vec3 lightAcc = u_ambientColor;
    
    // Directional Lights (Sun + Moon)
    // Top Face Logic
    if (v_z < -0.1) {
        lightAcc += u_sunColor * u_sunIntensity * 0.8;
        lightAcc += u_moonColor * u_moonIntensity * 0.8;
    } else {
        // Side Face Logic
        float dotSun = max(0.0, -dot(v_faceNormal, u_sunDir.xy));
        lightAcc += u_sunColor * u_sunIntensity * dotSun * 0.9;
        
        float dotMoon = max(0.0, -dot(v_faceNormal, u_moonDir.xy));
        lightAcc += u_moonColor * u_moonIntensity * dotMoon * 0.9;
    }
    
    // Point Lights
    for (int i = 0; i < 32; i++) {
        if (u_lights[i].posRad.w < 0.5) continue;
        
        vec2 lPos = u_lights[i].posRad.xy;
        float lRad = u_lights[i].posRad.z;
        float dist = distance(v_worldPos, lPos);
        
        if (dist < lRad) {
            float falloff = 1.0 - smoothstep(0.0, lRad, dist);
            vec2 dirToLight = normalize(lPos - v_worldPos);
            float dotPL = max(0.1, dot(v_faceNormal, dirToLight));
            
            float shadow = 0.0;
            if (u_lights[i].posRad.w > 1.5) {
                // Raymarch to check if this specific wall face is shadowed
                // We use a slight offset from v_worldPos to avoid self-shadowing acne
                vec2 rayOrigin = v_worldPos + v_faceNormal * 0.5;
                shadow = getShadow(rayOrigin, -dirToLight, u_shadowRange * 32.0, u_structureMap, u_worldPixels);
            }
            
            lightAcc += u_lights[i].colInt.rgb * u_lights[i].colInt.w * falloff * dotPL * 1.5 * (1.0 - shadow);
        }
    }

    // Edge Darkening
    float edge = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
    float edgeFactor = smoothstep(0.0, 0.05, edge); 
    vec3 litColor = baseColor * lightAcc * (0.5 + 0.5 * edgeFactor);

    // Heat
    vec2 heatUV = vec2(v_worldPos.x / u_worldPixels.x, 1.0 - (v_worldPos.y / u_worldPixels.y));
    float heat = texture(u_heatTexture, heatUV).r;
    vec3 finalColor = litColor;
    if (heat > 0.01) {
        vec3 glow = getHeatColor(heat);
        finalColor = mix(litColor, glow, smoothstep(0.1, 0.8, heat));
    }

    outColor = vec4(finalColor, 1.0);
}
`;
