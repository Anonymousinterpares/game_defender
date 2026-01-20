export const HEATMAP_RENDER_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
uniform vec2 u_offset;
uniform vec2 u_viewDim;
uniform vec2 u_worldDim;

out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    
    // Convert screen coordinates to clip space
    // a_position is in range [-1, 1] relative to the quad's bounds
    // We want the quad to cover the whole world area (or visible part)
    // But since we are drawing per-tile or for the whole map, we use the provided world dimensions.
    
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const HEATMAP_RENDER_FS = `#version 300 es
precision highp float;

uniform sampler2D u_simTexture;
uniform sampler2D u_fluidTexture;
uniform vec2 u_camera;
uniform vec2 u_viewDim;
uniform vec2 u_worldDim;

in vec2 v_uv;
out vec4 outColor;

// Noise for smoke fluffiness
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

vec3 getHeatColor(float intensity) {
    if (intensity < 0.4) {
        return vec3(0.39 + 0.61 * (intensity / 0.4), 0.0, 0.0);
    } else if (intensity < 0.8) {
        return vec3(1.0, (intensity - 0.4) / 0.4, 0.0);
    } else {
        return vec3(1.0, 1.0, (intensity - 0.8) / 0.2);
    }
}

void main() {
    vec2 worldPos = u_camera + vec2(v_uv.x, 1.0 - v_uv.y) * u_viewDim;
    vec2 simUV = worldPos / u_worldDim;
    
    if (simUV.x < 0.0 || simUV.x > 1.0 || simUV.y < 0.0 || simUV.y > 1.0) {
        discard;
    }

    vec4 simData = texture(u_simTexture, simUV);
    vec4 fluidData = texture(u_fluidTexture, simUV);
    
    float heat = simData.r;
    float fire = simData.g;
    float molten = simData.b;
    float hp = fract(simData.a);
    float smoke = fluidData.r;

    vec4 finalColor = vec4(0.0);

    // 1. Heat Glow (Bottom Layer)
    if (heat > 0.01 && hp < 0.8) {
        vec3 hColor = getHeatColor(heat);
        float alpha = (heat < 0.8 ? (0.4 + heat * 0.6) : 1.0) * 0.7;
        finalColor = vec4(hColor, alpha);
    }

    // 2. Molten Metal
    if (molten > 0.05) {
        vec3 mColor = vec3(1.0, 0.7 + molten * 0.3, 0.0);
        float mAlpha = clamp(molten * 0.8, 0.0, 0.95);
        finalColor = mix(finalColor, vec4(mColor, mAlpha), mAlpha);
    }

    // 3. Fire
    if (fire > 0.05) {
        vec3 fColor = vec3(1.0, 0.4 + fire * 0.6, 0.0);
        float fAlpha = clamp(fire * 0.9, 0.0, 0.9);
        // Additive-like blend for fire
        finalColor.rgb += fColor * fAlpha;
        finalColor.a = max(finalColor.a, fAlpha);
    }

    // 4. Volumetric Smoke (Top Layer)
    if (smoke > 0.05) {
        float n = noise(worldPos * 0.05); // Noise for fluffiness
        float sAlpha = smoke * 0.6 * (0.4 + 0.6 * n);
        vec3 sColor = vec3(0.2, 0.2, 0.2) + n * 0.1; // Dark gray with variation
        
        // Blend smoke on top
        finalColor.rgb = mix(finalColor.rgb, sColor, sAlpha);
        finalColor.a = max(finalColor.a, sAlpha);
    }

    if (finalColor.a < 0.01) discard;
    outColor = finalColor;
}
`;
