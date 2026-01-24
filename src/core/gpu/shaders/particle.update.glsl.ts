export const PARTICLE_UPDATE_VERT = `#version 300 es
layout(location = 0) in vec4 a_posLife;      // x, y, z, life
layout(location = 1) in vec4 a_velMaxLife;   // vx, vy, vz, maxLife
layout(location = 2) in vec4 a_props;        // type, flags, variation, unused

uniform float u_dt;
uniform vec2 u_wind;
uniform float u_gravity;
uniform float u_ppm;
uniform vec2 u_worldSize; 
uniform float u_time;     
uniform vec2 u_entities[8]; 
uniform float u_perspectiveStrength;
uniform vec2 u_cameraCenter;
uniform sampler2D u_worldMap;
uniform float u_tileSize;
uniform vec2 u_mapSize; 

out vec4 v_posLife;
out vec4 v_velMaxLife;
out vec4 v_props;

#define TYPE_SMOKE 4.0
#define TYPE_FIRE 5.0
#define TYPE_MOLTEN 3.0

void main() {
    vec3 pos = a_posLife.xyz;
    float life = a_posLife.w;
    vec3 vel = a_velMaxLife.xyz;
    float maxLife = a_velMaxLife.w;
    float type = a_props.x;
    float flags = a_props.y;
    float variation = a_props.z;

    if (life <= 0.0 || flags < 1.0) {
        v_posLife = vec4(0.0); v_velMaxLife = vec4(0.0); v_props = vec4(0.0);
        return;
    }

    bool isGrounded = mod(flags, 8.0) >= 4.0;
    
    if (!isGrounded) {
        for (int i = 0; i < 8; i++) {
            if (u_entities[i].x == 0.0) continue;
            vec2 dir = pos.xy - u_entities[i];
            float d2 = dot(dir, dir);
            if (d2 < 3600.0 && d2 > 0.1) {
                float dist = sqrt(d2);
                float force = (1.0 - dist / 60.0) * 300.0;
                float m = (abs(type - TYPE_SMOKE) < 0.1) ? 2.0 : 1.0;
                vel.xy += (dir / dist) * force * m * u_dt;
            }
        }
    }

    if (abs(type - TYPE_SMOKE) < 0.1) {
        float driftZ = -1.5 * u_ppm; 
        float t = u_time * 1.5;
        float nx = sin(pos.x * 0.01 + t) * cos(pos.y * 0.01 + t);
        vel.x += (u_wind.x + nx * 1.5 * u_ppm - vel.x * 0.5) * u_dt;
        vel.y += (u_wind.y - vel.y * 0.5) * u_dt;
        vel.z += (driftZ - vel.z * 0.5) * u_dt;
    } else if (abs(type - TYPE_FIRE) < 0.1) {
        float driftZ = -4.0 * u_ppm; 
        float id = float(gl_VertexID);
        float t = u_time * 5.0;
        float wx = sin(id + t) * 2.0 * u_ppm;
        float wy = cos(id * 1.5 + t) * 2.0 * u_ppm;
        vel.x += (u_wind.x * 0.5 + wx - vel.x * 1.0) * u_dt;
        vel.y += (u_wind.y * 0.5 + wy - vel.y * 1.0) * u_dt;
        vel.z += (driftZ - vel.z * 1.0) * u_dt;
    } else {
        if (!isGrounded) {
            float drag = (abs(type - TYPE_MOLTEN) < 0.1) ? 1.0 : 2.0;
            if (abs(type - TYPE_MOLTEN) < 0.1) vel.z += u_gravity * u_dt;
            vel -= vel * drag * u_dt;
            if (abs(type - TYPE_MOLTEN) < 0.1 && pos.z >= 0.0 && vel.z > 0.0) {
                pos.z = 0.0; vel.z = 0.0;
                if (length(vel.xy) < 5.0) { flags += 4.0; isGrounded = true; }
            }
        }
    }

    if (!isGrounded) {
        ivec2 gp = ivec2((pos.xy + vel.xy * u_dt) / u_tileSize);
        if (gp.x >= 0 && gp.x < int(u_mapSize.x) && gp.y >= 0 && gp.y < int(u_mapSize.y)) {
            if (texelFetch(u_worldMap, gp, 0).r > 0.0 && pos.z > -u_tileSize) vel.xy *= -0.5;
        }
        pos += vel * u_dt;
    }

    life -= u_dt;
    if (life <= 0.0 || pos.x < 0.0 || pos.x > u_worldSize.x || pos.y < 0.0 || pos.y > u_worldSize.y) {
        life = 0.0; flags = 0.0;
    }

    v_posLife = vec4(pos, life);
    v_velMaxLife = vec4(vel, maxLife);
    v_props = vec4(type, flags, variation, 0.0);
}
`;

export const PARTICLE_UPDATE_FRAG = `#version 300 es
precision highp float;
void main() {
    // No-op for transform feedback
}
`;
