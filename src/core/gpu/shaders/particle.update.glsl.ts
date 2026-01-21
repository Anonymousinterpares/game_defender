export const PARTICLE_UPDATE_VERT = `#version 300 es
layout(location = 0) in vec4 a_posVel;      // x, y, vx, vy
layout(location = 1) in vec4 a_props;       // life, maxLife, type, flags

// Standard Physics Uniforms
uniform float u_dt;
uniform vec2 u_wind;
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
    float type = props.z;
    float flags = props.w;

    // Early exit for dead particles
    if (life <= 0.0 || flags < 1.0) {
        life = 0.0;
        props.x = life;
        v_posVel = posVel;
        v_props = props;
        return;
    }

    // --- Entity Interaction (Repulsion) ---
    for (int i = 0; i < 8; i++) {
        if (u_entities[i].x == 0.0 && u_entities[i].y == 0.0) continue;
        
        vec2 dir = posVel.xy - u_entities[i];
        float distSq = dot(dir, dir);
        float radius = 50.0; // Interaction radius
        if (distSq < radius * radius && distSq > 0.01) {
            float dist = sqrt(distSq);
            float force = (1.0 - dist / radius) * 200.0;
            posVel.zw += (dir / dist) * force * u_dt;
        }
    }

    // Apply Physics
    if (abs(type - TYPE_SMOKE) < 0.1) {
        // Smoke Physics: Wind + Drift + Turbulence
        float driftY = -15.0; // Rising
        
        // Swirling turbulence based on particle ID and time
        float id = float(gl_VertexID);
        float t = u_time * 2.0;
        float turbX = sin(t + id * 0.1) * 15.0 + cos(t * 0.5 + id * 0.05) * 10.0;
        float turbY = cos(t * 0.7 + id * 0.1) * 10.0;

        // Velocity Damping + Forces
        float drag = 0.8; // Slightly more drag for smoke to keep it wispy
        posVel.z += (u_wind.x * 25.0 + turbX - posVel.z * drag) * u_dt;
        posVel.w += (u_wind.y * 25.0 + driftY + turbY - posVel.w * drag) * u_dt;
    } else {
        // Standard / Molten Physics
        // Time-based Damping (Friction)
        float drag = 2.0; // Damping factor
        if (abs(type - TYPE_MOLTEN) < 0.1) drag = 1.0; // Molten flies further
        
        posVel.z -= posVel.z * drag * u_dt;
        posVel.w -= posVel.w * drag * u_dt;
    }

    // Predictive Collision
    vec2 nextPos = posVel.xy + posVel.zw * u_dt;
    ivec2 gridPos = ivec2(nextPos / u_tileSize);
    
    // Bounds Check & Wall Collision
    bool hit = false;
    
    if (gridPos.x >= 0 && gridPos.x < int(u_mapSize.x) && gridPos.y >= 0 && gridPos.y < int(u_mapSize.y)) {
        // Sample R8 Texture (Red channel contains MaterialType)
        // texelFetch expects (x, y) integer coords
        float cell = texelFetch(u_worldMap, gridPos, 0).r;
        
        if (cell > 0.0) {
            hit = true;
            
            // Resolve Collision (Simple Slide/Bounce)
            // Check X
            vec2 testX = posVel.xy + vec2(posVel.z * u_dt, 0.0);
            ivec2 gridX = ivec2(testX / u_tileSize);
            if (gridX.x >= 0 && gridX.x < int(u_mapSize.x) && texelFetch(u_worldMap, gridX, 0).r > 0.0) {
                posVel.z *= -0.5; // Bounce X
            }
            
            // Check Y
            vec2 testY = posVel.xy + vec2(0.0, posVel.w * u_dt);
            ivec2 gridY = ivec2(testY / u_tileSize);
            if (gridY.y >= 0 && gridY.y < int(u_mapSize.y) && texelFetch(u_worldMap, gridY, 0).r > 0.0) {
                posVel.w *= -0.5; // Bounce Y
            }
        }
    }

    if (!hit) {
        // Commit Move
        posVel.x += posVel.z * u_dt;
        posVel.y += posVel.w * u_dt;
    } else {
        // Move with modified velocity (slide)
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
