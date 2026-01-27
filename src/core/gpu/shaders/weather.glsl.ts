export const WEATHER_UPDATE_VERT = `#version 300 es
layout(location = 0) in vec4 a_pos;      // x, y, z, type (0=RAIN, 1=SNOW, 2=SPLASH)
layout(location = 1) in vec4 a_vel;      // vx, vy, vz, life

uniform float u_dt;
uniform vec4 u_wind; // x, y, z (unused), speed
uniform vec3 u_gravity;
uniform vec2 u_worldSize; // Width, Height in pixels
uniform float u_zFloor;   // Z level for floor collision (usually 0)
uniform float u_time;
uniform float u_targetType; // 0=RAIN, 1=SNOW

out vec4 v_pos;
out vec4 v_vel;

#define TYPE_RAIN 0.0
#define TYPE_SNOW 1.0
#define TYPE_SPLASH 2.0

// Hash function for randomness
float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
    vec3 pos = a_pos.xyz;
    float type = a_pos.w;
    vec3 vel = a_vel.xyz;
    float life = a_vel.w;

    float id = float(gl_VertexID);
    float rand = hash(id + u_time);

    // --- PHYSICS UPDATE ---

    if (type == TYPE_SPLASH) {
        // Splash logic: simple expand/fade, no movement
        life -= u_dt * 4.0; // Fast decay
        if (life <= 0.0) {
            // Respawn as falling particle
            // Randomize position across world
            pos.x = mod(hash(id * 1.1 + u_time) * u_worldSize.x * 100.0, u_worldSize.x);
            pos.y = mod(hash(id * 2.2 + u_time) * u_worldSize.y * 100.0, u_worldSize.y);
            pos.z = 500.0 + hash(id * 3.3) * 500.0; // Spawn high up
            
            // Pick type based on ID parity or uniform? For now assume mixed
            // But usually the system handles one type at a time. 
            // We'll reset to original type passed in uniform if needed, 
            // but for now let's assume type is encoded in buffer init.
            // If it was a splash, it came from something.
            // Since we don't have per-particle 'original type' storage here without extra buffer,
            // we'll hack it: Splashes from Rain become Rain. Splashes from Snow become Snow?
            // Actually, let's just use a uniform toggle for 'Current Weather' to determine spawn type.
            // But we can't easily change 'type' attribute permanently without logic.
            // Simplified: If type was SPLASH, it resets to RAIN (default) or whatever the buffer defines.
            
            // Recover type hack: We'll cycle 0->2->0.
            // But for mixed weather... let's assume we stick to one main weather type active.
            // Let's reset to RAIN/SNOW based on a uniform or just generic reset.
            // For this implementation, we'll assume the buffer was initialized with the correct 'main' type
            // and we revert to 0 or 1.
            
            // Revert to Target Type (Rain/Snow)
            type = u_targetType;
            
            life = 1.0;
            vel = vec3(0.0, 0.0, -100.0); // Initial drop velocity
        }
    } else {
        // Falling Physics
        // Apply Gravity
        float gMult = (type == TYPE_SNOW) ? 0.1 : 1.0;
        vel += u_gravity * gMult * u_dt;

        // Apply Wind with Drag
        // Rain is heavy/aero, Snow is light
        float drag = (type == TYPE_SNOW) ? 2.0 : 0.5;
        
        // Wind influence
        vec3 windForce = vec3(u_wind.x, u_wind.y, 0.0);
        if (type == TYPE_SNOW) {
            // Snow flutter
            float t = u_time * 2.0;
            windForce.x += sin(pos.z * 0.05 + t) * 50.0;
            windForce.y += cos(pos.z * 0.05 + t) * 50.0;
        }
        
        vel += (windForce - vel * drag) * u_dt;
        pos += vel * u_dt;

        // Ground Collision
        if (pos.z <= u_zFloor) {
            if (type == TYPE_RAIN) {
                // Spawn Splash
                type = TYPE_SPLASH;
                pos.z = u_zFloor + 1.0; // Lift slightly to avoid z-fight
                life = 1.0; // Start splash animation
                vel.xy = vec2(0.0); // Stop horizontal movement
            } else if (type == TYPE_SNOW) {
                // Snow just disappears/respawns (or piles up logic elsewhere)
                // For now, respawn at top
                pos.z = 1000.0;
                pos.x = mod(pos.x + hash(u_time) * 100.0, u_worldSize.x);
                pos.y = mod(pos.y + hash(u_time + 1.0) * 100.0, u_worldSize.y);
                vel.z = -50.0;
            }
        }
    }

    // World Wraparound (XY)
    if (pos.x < 0.0) pos.x += u_worldSize.x;
    if (pos.x > u_worldSize.x) pos.x -= u_worldSize.x;
    if (pos.y < 0.0) pos.y += u_worldSize.y;
    if (pos.y > u_worldSize.y) pos.y -= u_worldSize.y;
    
    // Bounds safety (Z)
    if (pos.z < -10.0) {
        pos.z = 1000.0;
        life = 1.0;
        type = 0.0; // Reset
    }

    v_pos = vec4(pos, type);
    v_vel = vec4(vel, life);
}
`;

export const WEATHER_RENDER_VERT = `#version 300 es
layout(location = 0) in vec4 a_pos;      // x, y, z, type
layout(location = 1) in vec4 a_vel;      // vx, vy, vz, life
layout(location = 2) in vec2 a_quadPos;  // Billboard vertex offsets

uniform mat4 u_viewProj; // Standard Camera ViewProj
uniform vec2 u_camera;   // Camera World Pos
uniform vec2 u_resolution;// Screen Resolution
uniform vec3 u_cameraPos; // 3D Camera Pos
uniform float u_perspectiveStrength;

out vec2 v_uv;
out float v_type;
out float v_life;
out float v_depth;

#define TYPE_RAIN 0.0
#define TYPE_SNOW 1.0
#define TYPE_SPLASH 2.0

void main() {
    vec3 pos = a_pos.xyz;
    float type = a_pos.w;
    vec3 vel = a_vel.xyz;
    float life = a_vel.w;

    v_type = type;
    v_life = life;
    
    // Billboard Logic & Streak Logic
    vec3 worldPos = pos;
    
    vec2 offset = a_quadPos;
    
    if (type == TYPE_RAIN) {
        // Streak alignment: Stretch along velocity vector
        // Normalize 2D velocity direction
        vec2 dir = normalize(vel.xy);
        float speed = length(vel.xy);
        
        // Rotate offset to align with velocity
        // Basic 2D rotation matrix: [cos -sin, sin cos]
        // Cos/Sin derived from direction normal
        // This makes particles point in move direction
        
        // Simpler: Just stretch in Z (vertical) for rain falling down?
        // Rain falls primarily in Z, but also moves XY with wind.
        // We want streaks to look 3D.
        
        // Scaling
        offset.y *= 10.0; // Long streaks
        offset.x *= 0.5;  // Thin
        
        // 3D Billboard facing camera? Or Fixed Vertical?
        // Rain is often rendered as vertical billboards that rotate to face camera around Y only.
        
        // Let's assume standard billboard facing camera plane
        worldPos.xy += offset;
        
    } else if (type == TYPE_SPLASH) {
        // Flat on ground
        offset *= (1.0 - life) * 20.0; // Expand as life decreases (1->0 is backwards)
        // Wait, update sets life 1->0 decay.
        // So size should be (1.0 - life) * MAX_SIZE ?? Start small, end big?
        // Or if life stands for "Age", it grows.
        // If life is "Time Remaining", it starts at 1.0 and goes to 0.0.
        // Splash should start small (life=1) and grow (life=0).
        // Let's invert: size = (1.0 - life) * 32.0.
        float size = (1.0 - life * life) * 24.0;
        worldPos.xy += offset * (size / 24.0); // Simple scaling
        worldPos.z += 1.0; // Slightly above ground
        
    } else {
        // SNOW: standard billboard
        float size = 4.0;
        worldPos.xy += offset * size;
    }

    // Perspective Projection (Simulated)
    // Similar to particle.render.glsl logic
    
    // Parallax Lean
    vec2 delta = worldPos.xy - (u_camera + vec2(400.0, 300.0)); // Center approx
    float h = -worldPos.z; // negative for UP
    vec2 leanOffset = delta * h * u_perspectiveStrength;
    
    vec2 projectedXY = worldPos.xy + leanOffset;
    float projectedY = projectedXY.y + worldPos.z; // Vertical shift from height
    
    // Screen Space
    vec2 screenPos = projectedXY - u_camera;
    
    // Normalize to NDC
    float clipX = (screenPos.x / u_resolution.x) * 2.0 - 1.0;
    float clipY = 1.0 - (screenPos.y / u_resolution.y) * 2.0; // Y-down to Y-up transform

    gl_Position = vec4(clipX, clipY, 0.0, 1.0);
}
`;

export const WEATHER_RENDER_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_type;
in float v_life;

out vec4 outColor;

#define TYPE_RAIN 0.0
#define TYPE_SNOW 1.0
#define TYPE_SPLASH 2.0

void main() {
    float dist = length(v_uv); // Assumes quad -1..1
    
    if (v_type == TYPE_RAIN) {
        // Streak Texture
        float alpha = 1.0 - abs(v_uv.x * 2.0); // Fade on edges X
        alpha *= 1.0 - abs(v_uv.y); // Fade on tips Y
        if (alpha < 0.1) discard;
        outColor = vec4(0.7, 0.8, 1.0, 0.6 * alpha);
    } 
    else if (v_type == TYPE_SPLASH) {
        // Ring Texture
        float ring = smoothstep(0.6, 0.8, dist) * (1.0 - smoothstep(0.8, 1.0, dist));
        // Fade out over lifetime
        float opacity = v_life * ring * 0.5;
        if (opacity < 0.01) discard;
        outColor = vec4(0.8, 0.9, 1.0, opacity);
    }
    else {
        // Snow (Soft Circle)
        if (dist > 1.0) discard;
        float alpha = 1.0 - smoothstep(0.5, 1.0, dist);
        outColor = vec4(1.0, 1.0, 1.0, 0.8 * alpha);
    }
}
`;
