export const GROUND_VERT = `#version 300 es
layout(location = 0) in vec2 a_position; // NDC position [-1, 1]

out vec2 v_worldPos; // Pass NDC to fragment shader

void main() {
    v_worldPos = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
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

in vec2 v_worldPos; 
out vec4 outColor;

vec3 getHeatColor(float t) {
    if (t < 0.4) return vec3(0.39 + 0.61 * (t / 0.4), 0.0, 0.0);
    else if (t < 0.8) return vec3(1.0, (t - 0.4) / 0.4, 0.0);
    else return vec3(1.0, 1.0, (t - 0.8) / 0.2);
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
    vec3 lightAcc = u_ambientColor;
    
    // Sun
    if (u_sunIntensity > 0.01) {
        float shadow = 0.0;
        vec2 dir = -normalize(u_sunDir.xy); 
        // Sub-pixel ray-marching for precision
        for(float d = 4.0; d < 150.0; d += 6.0) {
            vec2 checkPos = worldPos + dir * d;
            vec2 checkUV = vec2(checkPos.x / u_worldPixels.x, checkPos.y / u_worldPixels.y);
            // Sample the high-res structure map
            float wall = texture(u_structureMap, checkUV).r;
            if (wall > 0.0) {
                shadow = 1.0;
                break;
            }
        }
        lightAcc += u_sunColor * u_sunIntensity * 0.7 * (1.0 - shadow);
    }
    
    // Moon
    if (u_moonIntensity > 0.01) {
        float shadow = 0.0;
        vec2 dir = -normalize(u_moonDir.xy);
        for(float d = 4.0; d < 120.0; d += 8.0) {
            vec2 checkPos = worldPos + dir * d;
            vec2 checkUV = vec2(checkPos.x / u_worldPixels.x, checkPos.y / u_worldPixels.y);
            float wall = texture(u_structureMap, checkUV).r;
            if (wall > 0.0) {
                shadow = 1.0;
                break;
            }
        }
        lightAcc += u_moonColor * u_moonIntensity * 0.5 * (1.0 - shadow);
    }
    
    // Point Lights from UBO
    for (int i = 0; i < 32; i++) {
        if (u_lights[i].posRad.w < 0.5) continue;
        
        vec2 lPos = u_lights[i].posRad.xy;
        float lRad = u_lights[i].posRad.z;
        float dist = distance(worldPos, lPos);
        
        if (dist < lRad) {
            float falloff = 1.0 - smoothstep(0.0, lRad, dist);
            lightAcc += u_lights[i].colInt.rgb * u_lights[i].colInt.w * falloff * 1.5;
        }
    }
    
    vec3 litColor = texColor * lightAcc;
    
    // Grid Overlay
    vec2 gridPos = mod(worldPos, u_tileSize);
    float gridLine = step(u_tileSize - 1.0, gridPos.x) + step(u_tileSize - 1.0, gridPos.y);
    litColor = mix(litColor, litColor * 0.7, gridLine * 0.3);

    // Heat
    vec2 heatUV = vec2(worldPos.x / u_worldPixels.x, 1.0 - (worldPos.y / u_worldPixels.y));
    float heat = texture(u_heatTexture, heatUV).r;
    vec3 finalColor = litColor;
    if (heat > 0.01) {
        vec3 glow = getHeatColor(heat);
        finalColor = mix(litColor, glow, smoothstep(0.05, 0.9, heat));
    }

    outColor = vec4(finalColor, 1.0);
}
`;
