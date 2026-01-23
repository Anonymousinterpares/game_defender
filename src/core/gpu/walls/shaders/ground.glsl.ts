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

uniform sampler2D u_heatTexture;
uniform sampler2D u_groundTexture;
uniform vec2 u_worldPixels;
uniform vec2 u_camera;
uniform vec2 u_resolution;
uniform float u_tileSize;
uniform vec3 u_ambientColor;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_textureScale; // How many tiles per texture repeat

in vec2 v_worldPos; // NDC [-1, 1]
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
    // 1. Calculate World Position from NDC
    vec2 screenUV = v_worldPos * 0.5 + 0.5;
    vec2 worldPos = u_camera + vec2(screenUV.x * u_resolution.x, (1.0 - screenUV.y) * u_resolution.y);
    
    // Boundary Check: Discard fragments outside the world
    if (worldPos.x < 0.0 || worldPos.x > u_worldPixels.x || worldPos.y < 0.0 || worldPos.y > u_worldPixels.y) {
        discard;
    }
    
    // 2. Sample Ground Texture
    // Tile the texture every u_textureScale tiles
    float textureTileSize = u_tileSize * u_textureScale;
    vec2 textureUV = mod(worldPos, textureTileSize) / textureTileSize;
    vec3 texColor = texture(u_groundTexture, textureUV).rgb;
    
    // 3. Apply Lighting
    vec3 litColor = texColor * (u_ambientColor + u_lightColor * u_lightIntensity * 0.5);
    
    // 4. Grid Overlay
    vec2 gridPos = mod(worldPos, u_tileSize);
    float gridLine = step(u_tileSize - 1.0, gridPos.x) + step(u_tileSize - 1.0, gridPos.y);
    litColor = mix(litColor, litColor * 0.7, gridLine * 0.3);

    // 5. Sample Heat
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
