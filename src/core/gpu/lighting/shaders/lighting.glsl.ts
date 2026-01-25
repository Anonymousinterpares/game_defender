export const LIGHTING_VERT = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const EMISSIVE_PASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_heatTexture;
uniform sampler2D u_fluidTexture;
uniform sampler2D u_scorchTexture;
uniform sampler2D u_structureMap;
uniform vec2 u_worldPixels;
uniform vec2 u_camera;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

struct Light {
    vec4 posRad; // x, y, radius, active
    vec4 colInt; // r, g, b, intensity
};

layout(std140) uniform LightBlock {
    Light u_lights[32];
};

vec3 getHeatColor(float t) {
    if (t < 0.2) return mix(vec3(0.0), vec3(0.5, 0.0, 0.0), t / 0.2);
    if (t < 0.4) return mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.2, 0.0), (t - 0.2) / 0.2);
    if (t < 0.7) return mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.8, 0.2), (t - 0.4) / 0.3);
    return mix(vec3(1.0, 0.8, 0.2), vec3(4.0, 4.0, 4.0), (t - 0.7) / 0.3);
}

void main() {
    // Fragment World Position (Logical: Y increases Downwards)
    // v_uv and Screen: (0,0) is Bottom, (0,1) is Top.
    // Screen Top (1.0) -> Camera Y. Screen Bottom (0.0) -> Camera Y + Res Y.
    vec2 worldPos = u_camera + vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
    
    // World Mapping (Logical 0 is Texture UV.y=0)
    // No flips needed for world-space texture sampling from worldPos.
    vec2 worldUV = worldPos / u_worldPixels;
    
    vec3 emissive = vec3(0.0);

    // 1. Heat/Fire Emissive - REMOVED from pathtracer to prevent spikes.
    // The ground visualization is handled directly in the ground shader.
    // Permanent Scorch glow is handled in Section 4 below.
    // 4. Scorch Faint Glow (Residual heat in charred marks)
    float heat = texture(u_heatTexture, worldUV).r;
    // Fluid texture: R=density, G=temp, B=variation, A=unused
    vec4 fluid = texture(u_fluidTexture, worldUV);
    float temp = fluid.g;
    
    // Threshold: Only emit light if temperature is high enough (Fire)
    // Avoids "Black Smoke Emitting Light" by ensuring low-temp smoke (temp < 1.0) emits zero light
    if (temp > 1.5) {
        // Map temp to Fire Color: Orange -> Yellow -> White
        vec3 fireCol = vec3(0.0);
        float intensity = 0.0;
        
        if (temp < 3.0) {
            // Orange Fire
            fireCol = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.6, 0.0), (temp - 1.5) / 1.5);
            intensity = 2.0;
        } else if (temp < 6.0) {
            // Yellow to White Hot
            fireCol = mix(vec3(1.0, 0.6, 0.0), vec3(2.0, 2.0, 2.0), (temp - 3.0) / 3.0);
            intensity = 4.0;
        } else {
            // Blinding
            fireCol = vec3(3.0, 3.0, 3.0);
            intensity = 6.0;
        }
        
        emissive += fireCol * intensity;
    }

    // 3. Point Lights - REMOVED sharp cores. 
    // Direct point lighting (including explosion flashes) is now handled 
    // by the smooth analytic loop in ground.glsl. 
    // We only keep the Fluid Fire (Section 2) for softened raytraced glow.

    // 4. Scorch Faint Glow (Residual heat in charred marks)
    float scorch = texture(u_scorchTexture, worldUV).r;
    if (scorch > 0.1) {
        // Very scattered, low radius light
        emissive += vec3(0.3, 0.05, 0.0) * scorch * 0.5;
    }

    outColor = vec4(emissive, 1.0);
}
`;

export const OCCLUDER_PASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_structureMap;
uniform vec2 u_worldPixels;
uniform vec2 u_camera;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

struct Entity {
    vec4 posRad; // x, y, radius, active
};

layout(std140) uniform EntityBlock {
    Entity u_entities[32];
};

void main() {
    // Fragment World Position
    vec2 worldPos = u_camera + vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
    vec2 worldUV = worldPos / u_worldPixels;
    
    float wall = texture(u_structureMap, worldUV).r;
    
    // Check if current fragment is inside an entity
    float entityOcc = 0.0;
    
    for (int i = 0; i < 32; i++) {
        if (u_entities[i].posRad.w < 0.5) continue;
        float d = distance(worldPos, u_entities[i].posRad.xy);
        if (d < u_entities[i].posRad.z) {
            entityOcc = 1.0;
            break;
        }
    }
    
    // 1.0 = Occulder, 0.0 = Free space
    outColor = vec4(vec3(max(wall > 0.5 ? 1.0 : 0.0, entityOcc)), 1.0);
}
`;

export const JFA_INIT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_occluderMap;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

void main() {
    float occ = texture(u_occluderMap, v_uv).r;
    if (occ > 0.5) {
        outColor = vec4(gl_FragCoord.xy, 0.0, 1.0);
    } else {
        outColor = vec4(-10000.0, -10000.0, 0.0, 1.0);
    }
}
`;

export const JFA_STEP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform float u_step;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

void main() {
    float minDist = 1e10;
    vec2 bestCoord = vec2(-10000.0);
    
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * u_step;
            vec2 sampUV = v_uv + offset / u_resolution;
            if (sampUV.x < 0.0 || sampUV.x > 1.0 || sampUV.y < 0.0 || sampUV.y > 1.0) continue;
            
            vec2 res = texture(u_source, sampUV).xy;
            if (res.x > -5000.0) {
                float d = distance(res, gl_FragCoord.xy);
                if (d < minDist) {
                    minDist = d;
                    bestCoord = res;
                }
            }
        }
    }
    
    outColor = vec4(bestCoord, 0.0, 1.0);
}
`;

export const SDF_FINAL_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_jfa;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

void main() {
    vec2 bestCoord = texture(u_jfa, v_uv).xy;
    float dist = distance(bestCoord, gl_FragCoord.xy);
    // Output distance normalized to some range, or raw pixels (requires highp)
    outColor = vec4(dist, 0.0, 0.0, 1.0);
}
`;
