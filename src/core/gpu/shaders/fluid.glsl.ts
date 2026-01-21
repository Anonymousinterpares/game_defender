export const FLUID_VERT = `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 a_position;
    out vec2 v_uv;
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const FLUID_ADVECT = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform sampler2D u_source;
    uniform float u_dt;
    uniform float u_dissipation;
    uniform vec2 u_texelSize;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        vec2 vel = texture(u_velocity, v_uv).xy;
        vec2 coord = v_uv - u_dt * vel;
        outColor = u_dissipation * max(texture(u_source, coord), 0.0);
    }
`;

export const FLUID_SPLAT = `#version 300 es
    precision highp float;
    uniform sampler2D u_source;
    uniform vec2 u_point;
    uniform float u_radius;
    uniform vec4 u_color; // density, temp, variation, unused
    uniform vec2 u_texelSize;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        vec2 diff = (v_uv - u_point) / u_texelSize;
        float d = dot(diff, diff);
        // Standard Gaussian: exp(-dist^2 / (2 * sigma^2))
        // Here u_radius acts as 2 * sigma^2
        float m = exp(-d / max(u_radius, 1.0));
        vec4 base = texture(u_source, v_uv);
        outColor = base + m * u_color;
    }
`;

export const FLUID_DIVERGENCE = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform vec2 u_texelSize;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).x;
        float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).x;
        float T = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).y;
        float B = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).y;
        
        float div = 0.5 * (R - L + T - B);
        outColor = vec4(div, 0.0, 0.0, 1.0);
    }
`;

export const FLUID_PRESSURE = `#version 300 es
    precision highp float;
    uniform sampler2D u_pressure;
    uniform sampler2D u_divergence;
    uniform vec2 u_texelSize;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).x;
        float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).x;
        float T = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).x;
        float B = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).x;
        float div = texture(u_divergence, v_uv).x;
        
        float p = (L + R + B + T - div) * 0.25;
        outColor = vec4(p, 0.0, 0.0, 1.0);
    }
`;

export const FLUID_GRADIENT_SUBTRACT = `#version 300 es
    precision highp float;
    uniform sampler2D u_pressure;
    uniform sampler2D u_velocity;
    uniform vec2 u_texelSize;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).x;
        float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).x;
        float T = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).x;
        float B = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).x;
        
        vec2 vel = texture(u_velocity, v_uv).xy;
        vel -= 0.5 * vec2(R - L, T - B);
        outColor = vec4(vel, 0.0, 1.0);
    }
`;

export const FLUID_VORTICITY = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform vec2 u_texelSize;
    uniform float u_dt;
    uniform float u_curl;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).y;
        float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).y;
        float T = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).x;
        float B = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).x;
        float vorticity = R - L - T + B;
        outColor = vec4(vorticity, 0.0, 0.0, 1.0);
    }
`;

export const FLUID_APPLY_VORTICITY = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform sampler2D u_vorticity;
    uniform vec2 u_texelSize;
    uniform float u_dt;
    uniform float u_curl;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        float L = texture(u_vorticity, v_uv - vec2(u_texelSize.x, 0.0)).x;
        float R = texture(u_vorticity, v_uv + vec2(u_texelSize.x, 0.0)).x;
        float T = texture(u_vorticity, v_uv + vec2(0.0, u_texelSize.y)).x;
        float B = texture(u_vorticity, v_uv - vec2(0.0, u_texelSize.y)).x;
        vec2 vel = texture(u_velocity, v_uv).xy;
        
        vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 1e-5;
        force *= u_curl * texture(u_vorticity, v_uv).x;
        
        vel += force * u_dt;
        outColor = vec4(vel, 0.0, 1.0);
    }
`;

export const FLUID_FORCES = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform sampler2D u_density; // R=density, G=temp
    uniform vec2 u_wind;
    uniform float u_buoyancy;
    uniform float u_dt;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
        vec2 vel = texture(u_velocity, v_uv).xy;
        vec2 densTemp = texture(u_density, v_uv).xy;
        
        // Buoyancy: Heat makes it rise. 
        // u_buoyancy is pre-scaled to UV/sec in TS
        float buoy = densTemp.y * u_buoyancy; 
        
        // Wind: Now passed in UV/sec directly
        vel += (u_wind + vec2(0.0, buoy)) * u_dt;
        outColor = vec4(vel, 0.0, 1.0);
    }
`;
