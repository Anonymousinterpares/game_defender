export const WALL_PARALLAX_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_heatTexture;
uniform vec2 u_worldPixels;
uniform vec3 u_lightDir;     // Normalized sun/moon direction
uniform vec3 u_lightColor;   // Color of active light
uniform float u_lightIntensity;
uniform vec3 u_ambientColor; // Base ambient

in vec2 v_worldPos;
in vec2 v_uv;
in float v_mat;
in vec2 v_faceNormal;
in float v_z;

out vec4 outColor;

vec3 getHeatColor(float t) {
    if (t < 0.4) {
        float r = 0.39 + 0.61 * (t / 0.4);
        return vec3(r, 0.0, 0.0);
    } else if (t < 0.8) {
        float g = (t - 0.4) / 0.4;
        return vec3(1.0, g, 0.0);
    } else {
        float b = (t - 0.8) / 0.2;
        return vec3(1.0, 1.0, b);
    }
}

void main() {
    // 1. Material Base Color
    vec3 baseColor = vec3(0.5);
    if (v_mat == 1.0) baseColor = vec3(0.4, 0.2, 0.1); // Wood
    else if (v_mat == 2.0) baseColor = vec3(0.6, 0.2, 0.2); // Brick
    else if (v_mat == 3.0) baseColor = vec3(0.4, 0.4, 0.4); // Stone
    else if (v_mat == 4.0) baseColor = vec3(0.3, 0.3, 0.5); // Metal
    else if (v_mat == 5.0) baseColor = vec3(0.1, 0.1, 0.1); // Indestructible

    // 2. Lighting Calculation
    // For top faces (v_z < 0), logic is different from side faces
    float shading = 0.5; // Ambient base
    
    if (v_z < -0.1) {
        // Top Face: Gets more light when sun is high (Z-up-ish)
        // We simulate this with a boost related to intensity
        shading = 0.6 + u_lightIntensity * 0.7;
    } else {
        // Side Face: Dot product with normal
        float dotNL = max(0.0, -dot(v_faceNormal, u_lightDir.xy));
        shading = 0.5 + dotNL * u_lightIntensity * 0.8;
    }
    
    // EDGE DARKENING (New)
    // Darken the edges of the wall faces to simulate occlusion/outline
    float edgeX = min(v_uv.x, 1.0 - v_uv.x);
    float edgeY = min(v_uv.y, 1.0 - v_uv.y);
    float edge = min(edgeX, edgeY);
    // Darken pixels very extremely close to the UV edge (the "corner")
    float edgeFactor = smoothstep(0.0, 0.05, edge); 
    shading *= (0.5 + 0.5 * edgeFactor);

    vec3 litColor = baseColor * shading * (u_ambientColor + u_lightColor * u_lightIntensity);

    // 3. Heat Integration
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
