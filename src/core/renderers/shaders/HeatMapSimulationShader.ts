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

uniform sampler2D u_prevHeat;
uniform float u_dt;
uniform float u_decayRate;
uniform float u_spreadRate;
uniform float u_fireSpeed;
uniform vec2 u_texelSize;
uniform float u_seed;

in vec2 v_uv;
out vec4 outColor;

// Random function for fire catch chance
float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
}

void main() {
    // Channel mapping:
    // R: Heat (0.0 to 1.0)
    // G: Fire Intensity
    // B: Molten Intensity
    // A: Packed (MaterialType + HP fraction)
    // MaterialTypes: NONE=0, WOOD=1, BRICK=2, STONE=3, METAL=4, INDESTRUCTIBLE=5

    vec4 self = texture(u_prevHeat, v_uv);
    float heat = self.r;
    float fire = self.g;
    float molten = self.b;
    float packed = self.a;

    int matType = int(floor(packed));
    float hp = fract(packed);
    bool isWall = matType > 0 && hp > 0.0;
    bool isDestroyed = matType > 0 && hp <= 0.0;

    // --- 1. HEAT DIFFUSION ---
    float sumHeat = heat;
    float neighbors[4];
    neighbors[0] = texture(u_prevHeat, v_uv + vec2(u_texelSize.x, 0.0)).r;
    neighbors[1] = texture(u_prevHeat, v_uv + vec2(-u_texelSize.x, 0.0)).r;
    neighbors[2] = texture(u_prevHeat, v_uv + vec2(0.0, u_texelSize.y)).r;
    neighbors[3] = texture(u_prevHeat, v_uv + vec2(0.0, -u_texelSize.y)).r;
    
    for(int i=0; i<4; i++) sumHeat += neighbors[i];
    float avgHeat = sumHeat / 5.0;
    
    float nextHeat = heat + (avgHeat - heat) * u_spreadRate;
    nextHeat = max(0.0, nextHeat - u_decayRate * u_dt);

    float nextFire = fire;
    float nextHP = hp;
    float nextMolten = molten;

    // --- 2. FIRE LOGIC ---
    if (matType == 1 && isWall) { // WOOD
        if (fire > 0.0) {
            float fireInc = u_dt * 0.5 * u_fireSpeed;
            nextFire = clamp(fire + fireInc, 0.0, 1.0);
            nextHeat = clamp(nextHeat + nextFire * 0.2, 0.0, 1.0);
            nextHP = max(0.0, hp - u_dt * 0.25 * u_fireSpeed); // Slow destruction
            
            if (nextHP <= 0.0) {
                nextFire = 0.0;
                nextHeat = 0.2; // Residue heat
            }
        } else if (nextHeat > 0.6) {
            // Auto-ignition from heat
            nextFire = 0.1;
        }

        // Spread to neighbors (simplified: if neighbor is fire, chance to ignite)
        if (nextFire == 0.0) {
            for(int i=0; i<4; i++) {
                float nFire = texture(u_prevHeat, v_uv + vec2(
                    (i==0 ? u_texelSize.x : (i==1 ? -u_texelSize.x : 0.0)),
                    (i==2 ? u_texelSize.y : (i==3 ? -u_texelSize.y : 0.0))
                )).g;
                if (nFire > 0.3 && rand(v_uv + float(i)) < 0.2 * u_fireSpeed) {
                    nextFire = 0.05;
                    break;
                }
            }
        }
    }

    // --- 3. METAL MELTING ---
    if (matType == 4 && isWall && nextHeat > 0.5) {
        // Vaporize/Melt metal
        nextHP = max(0.0, hp - u_dt * 0.2); // Vaporization speed
        if (nextHP <= 0.0) {
            nextMolten = 1.0;
            nextHeat = 0.5;
        }
    }

    // --- 4. MOLTEN FLOW ---
    if (molten > 0.0) {
        float pressure = molten + nextHeat * 0.5;
        if (pressure > 0.15) {
            // Flow to destroyed neighbors
            for(int i=0; i<4; i++) {
                vec2 nUv = v_uv + vec2(
                    (i==0 ? u_texelSize.x : (i==1 ? -u_texelSize.x : 0.0)),
                    (i==2 ? u_texelSize.y : (i==3 ? -u_texelSize.y : 0.0))
                );
                vec4 nData = texture(u_prevHeat, nUv);
                float nPacked = nData.a;
                int nMat = int(floor(nPacked));
                float nHp = fract(nPacked);
                
                if (nMat == 0 || nHp <= 0.0) {
                    float flowRate = 2.0 * (1.0 + nextHeat);
                    float spreadAmount = (pressure - 0.05) * flowRate * u_dt * 0.25; // /4 because 4 directions
                    nextMolten = max(0.0, nextMolten - spreadAmount * 0.9);
                }
            }
        }
        
        // Cooling
        if (nextHeat < 0.2) {
            nextMolten = max(0.0, nextMolten - u_dt * 0.5);
        }
    }

    outColor = vec4(clamp(nextHeat, 0.0, 1.0), clamp(nextFire, 0.0, 1.0), clamp(nextMolten, 0.0, 2.0), float(matType) + nextHP);
}
`;
