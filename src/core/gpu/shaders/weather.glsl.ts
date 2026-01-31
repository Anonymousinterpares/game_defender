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
uniform float u_time;

out vec2 v_uv;
out float v_type;
out float v_life;

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
    
    vec3 worldPos = pos;
    vec2 offset = a_quadPos;
    
    // Parallax Lean Base
    // Use positive Z for height. High objects lean AWAY from center?
    // In standard parallax: P' = P + (P - C) * depth * scale.
    // Here Z is height, so "closer" to camera (effectively). 
    // Usually high objects shift relative to ground based on view angle.
    // If center is (0,0), top-left is (-W,-H).
    // If we lean "outwards", a tower top is further from center than base.
    float h = worldPos.z; 
    
    // Fix: Parallax was too aggressive
    vec2 delta = worldPos.xy - (u_camera + u_resolution * 0.5);
    vec2 leanOffset = delta * h * u_perspectiveStrength; 
    
    // FIX 1: Assign UVs for fragment shader so we get circles, not squares/triangles!
    v_uv = a_quadPos * 2.0; 

    if (type == TYPE_RAIN) {
        // --- RAIN PHYSICS & PROJECTION ---
        
        // Improve "Cinematic Fall" feel
        // Instead of pure 3D perspective which makes rain falling "away" (down Z) converge 
        // to center bottom, we want a "slanted rain" look.
        
        // 1. Calculate future position based on velocity
        vec3 nextPos = worldPos + vel * 0.05; // 50ms trail
        
        // 2. Project both points (Start & End)
        // Standard Top-Down Parallax: 
        // ScreenPos = WorldXY + Lean(XY, Z)
        
        // Current Pos Projection
        vec2 d1 = worldPos.xy - (u_camera + u_resolution * 0.5);
        vec2 lean1 = d1 * worldPos.z * u_perspectiveStrength;
        
        

        
        // Standard Height Projection (y - z)
        // High Z = Lower Y (Visual shift up?)
        
        vec2 p1 = worldPos.xy + lean1;
        float y1 = worldPos.y - worldPos.z;

        // Next Pos Projection
        vec2 d2 = nextPos.xy - (u_camera + u_resolution * 0.5);
        vec2 lean2 = d2 * nextPos.z * u_perspectiveStrength;
        
        vec2 p2 = nextPos.xy + lean2;
        float y2 = nextPos.y - nextPos.z;
        
        // Screen Velocity Vector
        vec2 screenVel = vec2(p2.x - p1.x, y2 - y1);
        
        // Force a minimum vertical component for "Rain" feel if camera is looking straight down
        // This avoids the "converging to center" look when rain is directly overhead.
        // We simulate a slight camera tilt "forward".
        screenVel.y += 10.0; 
        
        float speed = length(screenVel);
        vec2 dir = (speed > 0.001) ? normalize(screenVel) : vec2(0.0, 1.0);
        
        // Streak Logic
        vec2 axisY = dir;
        vec2 axisX = vec2(-dir.y, dir.x);
        
        float streakLen = 40.0 + speed * 1.5;
        streakLen = min(streakLen, 300.0);
        
        vec2 rotOffset = axisX * offset.x * 2.0 + axisY * offset.y * streakLen * 0.5;
        
        // Final Position
        vec2 projectedXY = worldPos.xy + leanOffset;
        float projectedY = projectedXY.y - worldPos.z;
        
        vec2 finalScreenPos = vec2(projectedXY.x, projectedY) + rotOffset;
        
        // Convert to Clip Space
        vec2 screenPos = finalScreenPos - u_camera;
        float clipX = (screenPos.x / u_resolution.x) * 2.0 - 1.0;
        float clipY = 1.0 - (screenPos.y / u_resolution.y) * 2.0;
        
        gl_Position = vec4(clipX, clipY, 0.0, 1.0);
        
    } else if (type == TYPE_SPLASH) {
        float size = (1.0 - life * life) * 24.0;
        worldPos.xy += offset * size;
        worldPos.z += 1.0;
        
        vec2 delta = worldPos.xy - (u_camera + u_resolution * 0.5);
        vec2 leanOffset = delta * worldPos.z * u_perspectiveStrength;
        
        vec2 projectedXY = worldPos.xy + leanOffset;
        float projectedY = projectedXY.y - worldPos.z;
        vec2 screenPos = vec2(projectedXY.x, projectedY) - u_camera;
        
        gl_Position = vec4(
            (screenPos.x / u_resolution.x) * 2.0 - 1.0,
            1.0 - (screenPos.y / u_resolution.y) * 2.0,
            0.0, 1.0
        );
        
    } else {
        // SNOW
        float wobble = sin(u_time * 5.0 + float(gl_VertexID)) * 4.0;
        worldPos.x += wobble;
        
        float size = 5.0; 
        worldPos.xy += offset * size;
        
        vec2 delta = worldPos.xy - (u_camera + u_resolution * 0.5);
        vec2 leanOffset = delta * worldPos.z * u_perspectiveStrength;
        
        vec2 projectedXY = worldPos.xy + leanOffset;
        float projectedY = projectedXY.y - worldPos.z;
        vec2 screenPos = vec2(projectedXY.x, projectedY) - u_camera;
        
        gl_Position = vec4(
            (screenPos.x / u_resolution.x) * 2.0 - 1.0,
            1.0 - (screenPos.y / u_resolution.y) * 2.0,
            0.0, 1.0
        );
    }
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
        // Tapered ends
        float alpha = 1.0 - abs(v_uv.x * 3.0);
        alpha *= smoothstep(1.0, 0.0, abs(v_uv.y)); // Soft tips
        
        if (alpha < 0.05) discard;
        // Whiter rain for visibility
        outColor = vec4(0.85, 0.9, 1.0, 0.5 * alpha);
    } 
    else if (v_type == TYPE_SPLASH) {
        float ring = smoothstep(0.6, 0.8, dist) * (1.0 - smoothstep(0.8, 1.0, dist));
        float opacity = v_life * ring * 0.4;
        if (opacity < 0.01) discard;
        outColor = vec4(0.9, 0.95, 1.0, opacity);
    }
    else {
        // Snow (Soft Circle)
        if (dist > 1.0) discard;
        float alpha = smoothstep(1.0, 0.2, dist);
        outColor = vec4(1.0, 1.0, 1.0, 0.9 * alpha);
    }
}
`;
