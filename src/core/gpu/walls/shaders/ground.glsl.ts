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

uniform sampler2D u_heatTexture;
uniform sampler2D u_groundTexture;
uniform sampler2D u_worldMap; 
uniform sampler2D u_structureMap; // High-res structure data
uniform vec2 u_worldPixels;
uniform vec2 u_structureSize; // Typically Width*10, Height*10
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
uniform float u_shadowRange; // Max distance in tiles

in vec2 v_worldPos; 
in float v_time;
out vec4 outColor;

vec3 getHeatColor(float t) {
    if (t < 0.2) return mix(vec3(0.0), vec3(0.5, 0.0, 0.0), t / 0.2);
    if (t < 0.4) return mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.2, 0.0), (t - 0.2) / 0.2);
    if (t < 0.7) return mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.8, 0.2), (t - 0.4) / 0.3);
    return mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 1.0, 1.0), (t - 0.7) / 0.3);
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

// Unified Shadow Function (DDA Algorithm)
float getShadow(vec2 startPos, vec2 dir, float maxDist, sampler2D structMap, vec2 worldPixels) {
    if (length(dir) < 0.001) return 0.0;
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
    vec2 screenUV = v_worldPos * 0.5 + 0.5;
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

    // Sun
    if (u_sunIntensity > 0.01) {
        float shadow = getShadow(worldPos, u_sunDir.xy, 150.0, u_structureMap, u_worldPixels);
        lightAcc += u_sunColor * u_sunIntensity * 0.7 * (1.0 - shadow);
    }
    
    // Moon
    if (u_moonIntensity > 0.01) {
        float shadow = getShadow(worldPos, u_moonDir.xy, 120.0, u_structureMap, u_worldPixels);
        lightAcc += u_moonColor * u_moonIntensity * 1.2 * (1.0 - shadow);
    }
    
    // Point Lights
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
            
            float shadow = 0.0;
            if (u_lights[i].posRad.w > 1.5) {
                vec2 dirToLight = normalize(lPos - worldPos);
                shadow = getShadow(worldPos, -dirToLight, u_shadowRange * u_tileSize, u_structureMap, u_worldPixels);
            }
            
            lightAcc += u_lights[i].colInt.rgb * u_lights[i].colInt.w * falloff * 5.0 * (1.0 - shadow);
        }
    }
    
    vec3 litColor = texColor * lightAcc;
    
    // Grid Overlay
    vec2 gridPos = mod(worldPos, u_tileSize);
    float gridLine = step(u_tileSize - 1.0, gridPos.x) + step(u_tileSize - 1.0, gridPos.y);
    litColor = mix(litColor, litColor * 0.7, gridLine * 0.3);

    // Heat & Animated Ember Glow
    vec2 heatUV = vec2(worldPos.x / u_worldPixels.x, 1.0 - (worldPos.y / u_worldPixels.y));
    float heat = texture(u_heatTexture, heatUV).r;
    vec3 finalColor = litColor;
    
    if (heat > 0.01) {
        float flicker = 0.8 + 0.2 * noise(worldPos * 0.1 + vec2(0.0, v_time * 2.0));
        vec3 glow = getHeatColor(clamp(heat * flicker, 0.0, 1.0));
        
        finalColor = mix(litColor, litColor * 0.1, smoothstep(0.0, 0.4, heat));
        finalColor = mix(finalColor, glow, smoothstep(0.1, 0.8, heat));
    }

    outColor = vec4(finalColor, 1.0);
}
`;
