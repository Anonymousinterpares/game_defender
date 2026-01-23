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
            // Simple N dot L for point lights: Assume normal facing away from point?
            // For walls, we use the face normal.
            vec2 dirToLight = normalize(lPos - v_worldPos);
            float dotPL = max(0.1, dot(v_faceNormal, dirToLight));
            lightAcc += u_lights[i].colInt.rgb * u_lights[i].colInt.w * falloff * dotPL * 1.5;
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
