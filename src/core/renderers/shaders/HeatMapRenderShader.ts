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
uniform vec2 u_camera;
uniform vec2 u_viewDim;
uniform vec2 u_worldDim;

in vec2 v_uv;
out vec4 outColor;

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
    // Correct UV calculation based on camera and world dimensions
    vec2 worldPos = u_camera + v_uv * u_viewDim;
    vec2 simUV = worldPos / u_worldDim;
    
    if (simUV.x < 0.0 || simUV.x > 1.0 || simUV.y < 0.0 || simUV.y > 1.0) {
        discard;
    }

    vec4 simData = texture(u_simTexture, simUV);
    float heat = simData.r;
    float hp = simData.a;

    // Only render heat if wall is destroyed (HP <= 0) - matching CPU logic
    if (heat < 0.01 || hp > 0.1) {
        discard;
    }

    vec3 color = getHeatColor(heat);
    float alpha = heat < 0.8 ? (0.4 + heat * 0.6) : 1.0;
    
    outColor = vec4(color, alpha);
}
`;
