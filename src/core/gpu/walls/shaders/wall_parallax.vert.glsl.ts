export const WALL_PARALLAX_VERT = `#version 300 es
layout(location = 0) in vec3 a_position;   // x, y, z (z is negative for up)
layout(location = 1) in vec2 a_uv;         // Tile UV (0-1)
layout(location = 2) in float a_mat;       // Material type
layout(location = 3) in vec2 a_faceNormal; // nx, ny (facing normal)

uniform mat4 u_viewProj;
uniform vec2 u_cameraCenter;
uniform float u_perspectiveStrength;
uniform vec2 u_worldPixels;
uniform float u_time;

out vec2 v_worldPos;
out float v_time;
out vec2 v_uv;
out float v_mat;
out vec2 v_faceNormal;
out float v_z;

void main() {
    v_worldPos = a_position.xy;
    v_uv = a_uv;
    v_mat = a_mat;
    v_faceNormal = a_faceNormal;
    v_z = a_position.z;
    v_time = u_time;

    vec2 worldPos = a_position.xy;
    float h = -a_position.z; // Height above ground
    
    // CPU logic: dx = x - cameraCenterX;
    vec2 delta = worldPos - u_cameraCenter;
    
    // CPU logic: x + dx * h * STRENGTH;
    vec2 offset = delta * h * u_perspectiveStrength;
    
    vec2 projectedPos = worldPos + offset;
    
    // CPU logic: y + z + dy * h * STRENGTH;
    // Note: in our engine Y is down, and z is negative for UP.
    // So y + z actually means moving "up" the screen.
    float projectedY = projectedPos.y + a_position.z;

    // Depth Sorting logic: Foreground (High Y) -> Lower NDC Z (-1 to 1)
    // Background (Low Y) -> Higher NDC Z
    // Our u_viewProj matrix has m[10] = -1, so gl_Position.z = -1 * input_z.
    // To get gl_Position.z in [-1, 1], we map Y to [-1, 1].
    float normalizedY = (a_position.y / u_worldPixels.y) * 2.0 - 1.0;

    gl_Position = u_viewProj * vec4(projectedPos.x, projectedY, normalizedY, 1.0);
}
`;
