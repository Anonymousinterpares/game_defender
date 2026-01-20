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
uniform float u_time;

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
    // Non-linear ramp for more "glowy" feel
    float t = intensity;
    if (t < 0.4) {
        // Dark red to bright red
        return vec3(0.2 + 0.8 * pow(t / 0.4, 1.5), 0.0, 0.0);
    } else if (t < 0.8) {
        // Red to Orange/Yellow
        float f = (t - 0.4) / 0.4;
        return vec3(1.0, pow(f, 1.2), 0.0);
    } else {
        // Yellow to White
        float f = (t - 0.8) / 0.2;
        return vec3(1.0, 1.0, f);
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
    float packed = simData.a;
    float hp = fract(packed);
    
    // R: Smoke Density, G: Steam/Mist, B: Scorch
    float smoke = fluidData.r;
    float steam = fluidData.g;
    float scorch = fluidData.b;

    vec4 finalColor = vec4(0.0);

    // 0. Scorch Marks (Deepest Layer - Darken ground)
    if (scorch > 0.01 && hp >= 0.9) { // Only on ground or healthy walls? No, mostly ground.
        float sAlpha = scorch * 0.7;
        finalColor = vec4(0.0, 0.0, 0.0, sAlpha);
    }

    // 1. Heat Glow (Bottom Layer - shows on ground and damaged walls)
    if (heat > 0.01) {
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

    // 3. Fire (Middle Layer)
    if (fire > 0.05) {
        // Dynamic Fire Shape & Flicker using u_time
        float n = noise(worldPos * 0.2 - vec2(0.0, u_time * 4.0));
        float flicker = 0.8 + 0.2 * sin(u_time * 15.0 + worldPos.x * 0.1);
        
        float fAlpha = fire * 0.8 * (0.4 + 0.6 * n) * flicker;
        // Fire color: transitions through getHeatColor, but boosted
        vec3 fBaseColor = getHeatColor(clamp(fire + 0.3 + 0.2 * n, 0.0, 1.0));
        vec3 fColor = fBaseColor * (1.3 + 0.4 * flicker);
        
        finalColor.rgb = mix(finalColor.rgb, fColor, fAlpha);
        finalColor.a = max(finalColor.a, fAlpha);
    }

    // 4. Volumetric Smoke (Top Layer)
    if (smoke > 0.05) {
        float n = noise(worldPos * 0.05 + vec2(u_time * 0.5, -u_time * 1.0)); // Drifting noise
        float sAlpha = smoke * 0.6 * (0.3 + 0.7 * n);
        vec3 sColor = vec3(0.15, 0.15, 0.15) + n * 0.1; // Darker core
        
        finalColor.rgb = mix(finalColor.rgb, sColor, sAlpha);
        finalColor.a = max(finalColor.a, sAlpha);
    }

    // 5. Steam (Topmost gas Layer)
    if (steam > 0.05) {
        float n = noise(worldPos * 0.1 + vec2(u_camera.x * 0.01, 0.0));
        float stAlpha = steam * 0.4 * (0.3 + 0.7 * n);
        vec3 stColor = vec3(0.9, 0.95, 1.0); // Light blueish white
        
        finalColor.rgb = mix(finalColor.rgb, stColor, stAlpha);
        finalColor.a = max(finalColor.a, stAlpha);
    }

    if (finalColor.a < 0.01) discard;
    outColor = finalColor;
}
`;
