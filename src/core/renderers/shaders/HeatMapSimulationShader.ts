export const HEATMAP_SIM_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const HEATMAP_SIM_FS = `#version 300 es
precision highp float;

uniform sampler2D u_prevStruct;
uniform sampler2D u_prevFluid;
uniform int u_pass; // 0: Structural, 1: Fluid
uniform float u_dt;
uniform float u_decayRate;
uniform float u_spreadRate;
uniform float u_fireSpeed;
uniform vec2 u_texelSize;
uniform float u_seed;

in vec2 v_uv;
out vec4 outColor;

// Random function
float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
}

void main() {
    vec4 structData = texture(u_prevStruct, v_uv);
    vec4 fluidData = texture(u_prevFluid, v_uv);

    if (u_pass == 0) {
        // --- PASS 0: STRUCTURAL (Heat, Fire, Molten, Material/HP) ---
        float heat = structData.r;
        float fire = structData.g;
        float molten = structData.b;
        float packed = structData.a;

        int matType = int(floor(packed));
        float hp = fract(packed);
        bool isWall = matType > 0 && hp > 0.0;

        // 1. Heat Diffusion
        float neighborsHeat = (
            texture(u_prevStruct, v_uv + vec2(u_texelSize.x, 0.0)).r +
            texture(u_prevStruct, v_uv + vec2(-u_texelSize.x, 0.0)).r +
            texture(u_prevStruct, v_uv + vec2(0.0, u_texelSize.y)).r +
            texture(u_prevStruct, v_uv + vec2(0.0, -u_texelSize.y)).r
        );
        float nextHeat = heat + (neighborsHeat / 4.0 - heat) * u_spreadRate;
        nextHeat = max(0.0, nextHeat - u_decayRate * u_dt);

        float nextFire = fire;
        float nextHP = hp;
        float nextMolten = molten;

        // 2. Fire Logic (WOOD)
        if (matType == 1 && isWall) {
            if (fire > 0.0) {
                float fireInc = u_dt * 0.5 * u_fireSpeed;
                nextFire = clamp(fire + fireInc, 0.0, 1.0);
                nextHeat = clamp(nextHeat + nextFire * 0.2, 0.0, 1.0);
                nextHP = max(0.0, hp - u_dt * 0.25 * u_fireSpeed);
                if (nextHP <= 0.0) { nextFire = 0.0; nextHeat = 0.2; }
            } else if (nextHeat > 0.6) {
                nextFire = 0.1;
            } else {
                // Chance to ignite from neighbors
                float nFire = max(max(
                    texture(u_prevStruct, v_uv + vec2(u_texelSize.x, 0.0)).g,
                    texture(u_prevStruct, v_uv + vec2(-u_texelSize.x, 0.0)).g),
                    max(texture(u_prevStruct, v_uv + vec2(0.0, u_texelSize.y)).g,
                    texture(u_prevStruct, v_uv + vec2(0.0, -u_texelSize.y)).g)
                );
                if (nFire > 0.3 && rand(v_uv) < 0.2 * u_fireSpeed) nextFire = 0.05;
            }
        }

        // 3. Metal Logic (METAL)
        if (matType == 4 && isWall && nextHeat > 0.5) {
            nextHP = max(0.0, hp - u_dt * 0.2);
            if (nextHP <= 0.0) { nextMolten = 1.0; nextHeat = 0.5; }
        }

        // 4. Molten Flow
        if (molten > 0.0) {
            float pressure = molten + nextHeat * 0.5;
            if (pressure > 0.15) {
                for(int i=0; i<4; i++) {
                    vec2 nUv = v_uv + vec2(
                        (i==0 ? u_texelSize.x : (i==1 ? -u_texelSize.x : 0.0)),
                        (i==2 ? u_texelSize.y : (i==3 ? -u_texelSize.y : 0.0))
                    );
                    vec4 nData = texture(u_prevStruct, nUv);
                    if (fract(nData.a) <= 0.01) { // Empty tile
                        nextMolten = max(0.0, nextMolten - pressure * 0.5 * u_dt);
                    }
                }
            }
            if (nextHeat < 0.2) nextMolten = max(0.0, nextMolten - u_dt * 0.5);
        }

        outColor = vec4(clamp(nextHeat, 0.0, 1.0), clamp(nextFire, 0.0, 1.0), clamp(nextMolten, 0.0, 2.0), float(matType) + nextHP);
    } else {
        // --- PASS 1: FLUID (Smoke/Steam) ---
        // R: Smoke Density, G: Steam/Mist, B: Unused, A: Unused
        float smoke = fluidData.r;
        float fire = structData.g;

        // 1. Diffusion + Drift (Smoke rises "up", which is -Y in UV space usually, but world space depends on camera)
        // Let's assume a global 'drift' up for smoke.
        vec2 drift = vec2(0.0, u_texelSize.y * 0.5); // Drift "up" on screen
        
        float neighborsSmoke = (
            texture(u_prevFluid, v_uv + vec2(u_texelSize.x, 0.0) - drift).r +
            texture(u_prevFluid, v_uv + vec2(-u_texelSize.x, 0.0) - drift).r +
            texture(u_prevFluid, v_uv + vec2(0.0, u_texelSize.y) - drift).r +
            texture(u_prevFluid, v_uv + vec2(0.0, -u_texelSize.y) - drift).r
        );
        
        float nextSmoke = smoke + (neighborsSmoke / 4.0 - smoke) * 0.1; // Slower spread for smoke
        
        // 2. Production (from Fire)
        if (fire > 0.05) {
            nextSmoke += fire * u_dt * 2.0;
        }

        // 3. Decay
        nextSmoke = max(0.0, nextSmoke - 0.1 * u_dt);
        
        outColor = vec4(clamp(nextSmoke, 0.0, 1.0), 0.0, 0.0, 1.0);
    }
}
`;
