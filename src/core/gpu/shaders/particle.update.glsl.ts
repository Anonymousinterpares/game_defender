export const PARTICLE_UPDATE_VERT = `#version 300 es
layout(location = 0) in vec4 a_posVel;      // x, y, vx, vy
layout(location = 1) in vec4 a_props;       // life, maxLife, type, flags

// Standard Physics Uniforms
uniform float u_dt;
uniform vec2 u_wind;
uniform float u_gravity;
uniform float u_ppm;
uniform vec2 u_worldSize; // width, height (pixels)
uniform float u_time;     // For noise/turbulence
uniform vec2 u_entities[8]; // Player/Enemy positions

// Map Collision
uniform sampler2D u_worldMap;
uniform float u_tileSize;
uniform vec2 u_mapSize; // width, height (tiles)

// Output to Transform Feedback
out vec4 v_posVel;
out vec4 v_props;

// Constants
#define FLAG_ACTIVE 1.0
#define TYPE_STANDARD 0.0
#define TYPE_SHOCKWAVE 1.0
#define TYPE_FLASH 2.0
#define TYPE_MOLTEN 3.0
#define TYPE_SMOKE 4.0

// Simple Psuedo Random
float rand(vec2 co){
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec4 posVel = a_posVel;
    vec4 props = a_props;
    
    float life = props.x;
    float maxLife = props.y;
    float typeWithVar = props.z;
    float flags = props.w;
    
    float type = floor(typeWithVar);
    float variation = fract(typeWithVar);

    // Early exit for dead particles
    if (life <= 0.0 || flags < 1.0) {
        life = 0.0;
        props.x = life;
        v_posVel = posVel;
        v_props = props;
        return;
    }

// --- Entity Interaction (Repulsion) ---
    // If bit 3 (FLAG_GROUNDED = 4.0) is set, skip repulsion
    bool isGrounded = mod(flags, 8.0) >= 4.0;
    
    if (!isGrounded) {
        for (int i = 0; i < 8; i++) {
            if (u_entities[i].x == 0.0 && u_entities[i].y == 0.0) continue;
            
            vec2 dir = posVel.xy - u_entities[i];
            float distSq = dot(dir, dir);
            float radius = 60.0; // Slightly larger interaction
            if (distSq < radius * radius && distSq > 0.01) {
                float dist = sqrt(distSq);
                float force = (1.0 - dist / radius) * 300.0;
                // Smoke is lighter, pushed harder
                float m = (abs(type - TYPE_SMOKE) < 0.1) ? 2.0 : 1.0;
                posVel.zw += (dir / dist) * force * m * u_dt;
            }
        }
    }

    // Apply Physics
    if (abs(type - TYPE_SMOKE) < 0.1) {
        // Smoke Physics: Wind + Drift + Curl Turbulence
        // Drift: Rising at ~2.0 m/s
        float driftY = -2.0 * u_ppm; 
        
        float id = float(gl_VertexID);
        float t = u_time * 1.5;
        
        // Approximation of Curl Noise / Vortices
        vec2 p = posVel.xy * 0.01;
        float noise1 = sin(p.x + t) * cos(p.y + t);
        float noise2 = sin(p.y - t) * cos(p.x - t);
        
        float turbX = noise1 * 1.5 * u_ppm;
        float turbY = noise2 * 0.8 * u_ppm;

        // Velocity Damping + Forces
        float drag = 0.5; // Matched to CPU
        posVel.z += (u_wind.x + turbX - posVel.z * drag) * u_dt;
        posVel.w += (u_wind.y + driftY + turbY - posVel.w * drag) * u_dt;
    } else {
        // Standard / Molten Physics
        if (!isGrounded) {
            // Time-based Damping (Friction)
            float drag = 2.0; // Damping factor
            if (abs(type - TYPE_MOLTEN) < 0.1) drag = 1.0; // Molten flies further
            
            // Apply Gravity to Molten
            if (abs(type - TYPE_MOLTEN) < 0.1) {
                posVel.w += u_gravity * u_dt; // u_gravity already scaled by ppm in TS
            }
            
            posVel.z -= posVel.z * drag * u_dt;
            posVel.w -= posVel.w * drag * u_dt;

            // Ground checking for molten: if moving very slowly, it might have settled
            if (abs(type - TYPE_MOLTEN) < 0.1) {
                if (length(posVel.zw) < 1.0) {
                    flags += 4.0; // Set FLAG_GROUNDED
                    isGrounded = true;
                    posVel.zw = vec2(0.0);
                }
            }
        } else {
            // Particle is grounded - no movement
            posVel.zw = vec2(0.0);
        }
    }

    // Predictive Collision
    if (!isGrounded) {
        vec2 nextPos = posVel.xy + posVel.zw * u_dt;
        ivec2 gridPos = ivec2(nextPos / u_tileSize);
        
        // Bounds Check & Wall Collision
        bool hit = false;
        
        if (gridPos.x >= 0 && gridPos.x < int(u_mapSize.x) && gridPos.y >= 0 && gridPos.y < int(u_mapSize.y)) {
            float cell = texelFetch(u_worldMap, gridPos, 0).r;
            
            if (cell > 0.0) {
                hit = true;
                
                // Resolve Collision (Simple Slide/Bounce)
                vec2 testX = posVel.xy + vec2(posVel.z * u_dt, 0.0);
                ivec2 gridX = ivec2(testX / u_tileSize);
                if (gridX.x >= 0 && gridX.x < int(u_mapSize.x) && texelFetch(u_worldMap, gridX, 0).r > 0.0) {
                    posVel.z *= -0.5; // Bounce X
                }
                
                vec2 testY = posVel.xy + vec2(0.0, posVel.w * u_dt);
                ivec2 gridY = ivec2(testY / u_tileSize);
                if (gridY.y >= 0 && gridY.y < int(u_mapSize.y) && texelFetch(u_worldMap, gridY, 0).r > 0.0) {
                    posVel.w *= -0.5; // Bounce Y
                }

                // If molten hits a wall, it immediately grounds (lands)
                if (abs(type - TYPE_MOLTEN) < 0.1) {
                    flags += 4.0; 
                    isGrounded = true;
                    posVel.zw = vec2(0.0);
                }
            }
        }

        // Commit Move
        posVel.x += posVel.z * u_dt;
        posVel.y += posVel.w * u_dt;
    }

    // Decay Life
    life -= u_dt;
    if (life <= 0.0) {
        life = 0.0;
        flags = 0.0; // Mark inactive
    }

    props.x = life;
    props.w = flags;

    v_posVel = posVel;
    v_props = props;
}
`;

export const PARTICLE_UPDATE_FRAG = `#version 300 es
precision highp float;
void main() {
    // No-op for transform feedback
}
`;
