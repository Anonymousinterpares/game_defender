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

        // 1. Heat Diffusion - EXACT CPU LOGIC (lines 681-683 of HeatMap.ts)
        // CPU: sum neighbors, avg = sum/count, new = val + (avg - val) * spreadRate, then decay
        float neighborsHeat = (
            texture(u_prevStruct, v_uv + vec2(u_texelSize.x, 0.0)).r +
            texture(u_prevStruct, v_uv + vec2(-u_texelSize.x, 0.0)).r +
            texture(u_prevStruct, v_uv + vec2(0.0, u_texelSize.y)).r +
            texture(u_prevStruct, v_uv + vec2(0.0, -u_texelSize.y)).r
        );
        float avg = (heat + neighborsHeat) / 5.0; // Include self in average like CPU (val in sum, count starts at 1)
        
        // CPU formula: val + (avg - val) * spreadRate
        float nextHeat = heat + (avg - heat) * u_spreadRate;
        
        // CPU decay: max(0, heat - decayRate * dt)
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

        // 0. Material Destruction & Melting
        if (nextHP > 0.0) {
            if (nextHeat > 0.95) {
                // High heat vaporizes or melts
                nextHP -= u_dt * 0.5; // Vaporize rate
                if (matType == 4) { // METAL melts
                    nextMolten += (1.0 - nextHP) * 0.1;
                }
            }
        }
        
        // Ensure molten metal stays bright at destruction site (prevents flickering)
        if (nextHP <= 0.01 && matType == 4) {
            nextMolten = max(nextMolten, 0.85); // Keep bright
            // Also maintain some residual heat to prevent sudden cooling
            nextHeat = max(nextHeat, 0.3);
        }
        
        // 4. Molten Flow (only if NOT at destruction site to prevent premature drain)
        if (molten > 0.0 && (nextHP > 0.01 || matType != 4)) {
            float pressure = molten + nextHeat * 0.5;
            if (pressure > 0.15) {
                for(int i=0; i<4; i++) {
                    vec2 nUv = v_uv + vec2(
                        (i==0 ? u_texelSize.x : (i==1 ? -u_texelSize.x : 0.0)),
                        (i==2 ? u_texelSize.y : (i==3 ? -u_texelSize.y : 0.0))
                    );
                    vec4 nData = texture(u_prevStruct, nUv);
                    if (fract(nData.a) <= 0.01) { // Empty tile
                        nextMolten = max(0.0, nextMolten - pressure * 0.3 * u_dt); // Slower drain
                    }
                }
            }
            // Slower cooling decay - only when heat is very low
            if (nextHeat < 0.1) nextMolten = max(0.0, nextMolten - u_dt * 0.2);
        }

        outColor = vec4(clamp(nextHeat, 0.0, 1.0), clamp(nextFire, 0.0, 1.0), clamp(nextMolten, 0.0, 2.0), float(matType) + nextHP);
    } else {
        // --- PASS 1: FLUID (Smoke/Steam/Scorch) ---
        // R: Smoke Density, G: Steam/Mist, B: Scorch, A: Unused
        float smoke = fluidData.r;
        float steam = fluidData.g;
        float scorch = fluidData.b;
        
        float heat = structData.r;
        float fire = structData.g;

        // 1. Scorch Accumulation (Permanent until cleared)
        float nextScorch = max(scorch, heat * 0.8);
        
        // 2. Smoke/Steam: Simple diffusion with upward bias
        // Sample from neighbors with slight upward bias (sample from below, contribute to above)
        vec4 aboveFluid = texture(u_prevFluid, v_uv + vec2(0.0, -u_texelSize.y));  // Above in world
        vec4 belowFluid = texture(u_prevFluid, v_uv + vec2(0.0, u_texelSize.y));   // Below in world
        vec4 leftFluid = texture(u_prevFluid, v_uv + vec2(-u_texelSize.x, 0.0));
        vec4 rightFluid = texture(u_prevFluid, v_uv + vec2(u_texelSize.x, 0.0));
        
        // Weighted average: receive more from below (rises), less from above
        float nextSmoke = smoke * 0.9;  // Retain and fade
        nextSmoke += belowFluid.r * 0.15;  // Receive from below (creates upward motion)
        nextSmoke += (leftFluid.r + rightFluid.r) * 0.02;  // Slight horizontal spread
        nextSmoke -= aboveFluid.r * 0.05;  // Give to above (limits accumulation)
        
        float nextSteam = steam * 0.85;
        nextSteam += belowFluid.g * 0.2;
        nextSteam -= aboveFluid.g * 0.05;
        
        // 3. Smoke Production (from Fire AND high heat smoldering)
        if (fire > 0.05) {
            nextSmoke += fire * u_dt * 1.5;
        } else if (heat > 0.7) {
            nextSmoke += (heat - 0.7) * u_dt * 0.5;
        }

        // 4. Steam Production (when Heat is high - evaporation)
        if (heat > 0.4) {
             nextSteam += (heat - 0.4) * u_dt * 1.0;
        }

        // 5. Strong Decay to prevent infinite accumulation
        nextSmoke = max(0.0, nextSmoke - 0.4 * u_dt);
        nextSteam = max(0.0, nextSteam - 0.8 * u_dt);
        
        outColor = vec4(clamp(nextSmoke, 0.0, 1.0), clamp(nextSteam, 0.0, 1.0), clamp(nextScorch, 0.0, 1.0), 1.0);
    }
}
`;
