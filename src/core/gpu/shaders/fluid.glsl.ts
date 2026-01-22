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
        
        // Boundary Masking: Vacuum out smoke near world edges
        float mask = 1.0;
        float border = 0.01;
        if (coord.x < border || coord.x > (1.0 - border) || coord.y < border || coord.y > (1.0 - border)) {
            mask = 0.0;
        }

        vec4 source = texture(u_source, coord);
        float density = max(source.r, 0.0);
        
        // Non-linear Decay: 
        // Dense smoke (peaks) decays faster than low-density haze.
        // We use a density-dependent dissipation factor.
        float peakFactor = density * 0.012; // Controls how much faster peaks drop
        float densityDissipation = u_dissipation - peakFactor;
        float newDensity = density * clamp(densityDissipation, 0.9, 1.0);
        
        // Phase 4: Temperature cools down faster than density dissipates
        float tempDecay = 0.985;
        
        // For other channels (velocity/temp/variation), use standard dissipation
        outColor = vec4(newDensity, source.g * tempDecay, source.ba) * u_dissipation * mask;
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

        // Gaussian splat with DENSITY CAPPING
        float scale = 1.0; 
        float m = exp(-d / max(u_radius, 1.0));
        vec4 base = texture(u_source, v_uv);

        // Cap additive density to prevent excessive accumulation
        // R=density, B=variation
        // Phase 1: Reduced cap from 5.0 to 2.0 for realistic transparency
        float newDensity = base.r + m * u_color.r;
        float cappedDensity = min(newDensity, 2.0);

    outColor = vec4(cappedDensity, base.g + m * u_color.g, base.b + m * u_color.b, 1.0);
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
    uniform float u_time;
    in vec2 v_uv;
    out vec4 outColor;

    float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
        vec2 vel = texture(u_velocity, v_uv).xy;
        vec2 densTemp = texture(u_density, v_uv).xy;

        // Buoyancy: Heat makes it rise. 
        float buoy = densTemp.y * u_buoyancy;

        // Micro-Turbulence: Subtle jitter
        // We only apply noise if there is smoke (density > 0.01)
        float n = noise(v_uv * 10.0 + u_time * 0.5) - 0.5;
        float n2 = noise(v_uv * 11.0 - u_time * 0.4) - 0.5;
        vec2 turbulence = vec2(n, n2) * 0.05 * densTemp.x; // Scale by density

    // Wind + Buoyancy + Turbulence
    vel += (u_wind + vec2(0.0, buoy) + turbulence) * u_dt;
    outColor = vec4(vel, 0.0, 1.0);
}
`;
