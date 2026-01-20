export const PARTICLE_UPDATE_VERT = `#version 300 es
layout(location = 0) in vec4 a_posVel;      // x, y, vx, vy
layout(location = 1) in vec4 a_props;       // life, maxLife, type, flags

// Standard Physics Uniforms
uniform float u_dt;
uniform vec2 u_wind;
uniform vec2 u_worldSize; // width, height (pixels)
uniform float u_time;     // For noise/turbulence

// Output to Transform Feedback
out vec4 v_posVel;
out vec4 v_props;

// Constants
#define FLAG_ACTIVE 1.0
#define TYPE_STANDARD 0.0
#define TYPE_SMOKE 1.0
#define TYPE_SHOCKWAVE 2.0
#define TYPE_FLASH 3.0
#define TYPE_MOLTEN 4.0

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
        // Reset or keep dead
        life = 0.0;
        props.x = life;
        // Optionally reset pos to hide?
        // We just trust render shader to clip/discard
        v_posVel = posVel;
        v_props = props;
        return;
    }

    // Apply Physics
    if (type == TYPE_SMOKE) {
        // Smoke Physics: Wind + Drift + Turbulence
        float driftY = -15.0; // Rising
        
        // Simple procedural turbulence
        float t = u_time * 0.001;
        float turbX = sin(t * 2.0 + float(gl_VertexID)) * 10.0;
        float turbY = cos(t * 1.5 + float(gl_VertexID)) * 5.0;

        // Velocity Damping + Forces
        posVel.z += (u_wind.x * 20.0 + turbX - posVel.z * 0.5) * u_dt;
        posVel.w += (u_wind.y * 20.0 + driftY + turbY - posVel.w * 0.5) * u_dt;
    } else {
        // Standard Euler
        // Drag
        posVel.z *= 0.95;
        posVel.w *= 0.95;
    }

    // Move
    posVel.x += posVel.z * u_dt;
    posVel.y += posVel.w * u_dt;

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
