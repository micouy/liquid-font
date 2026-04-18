export const META_VERT = `#version 300 es
in vec2 a_corner;
in float a_index;
uniform sampler2D u_state;
uniform float u_numParticles;
uniform float u_influence;
uniform vec2 u_resolution;
uniform float u_dpr;
out vec2 v_pos;

void main() {
  float stateWidth = u_numParticles * 2.0;
  vec2 uv = vec2((a_index + 0.5) / stateWidth, 0.5);
  vec4 state = texture(u_state, uv);
  vec2 pos = state.rg * u_dpr;
  v_pos = pos;
  vec2 offset = a_corner * u_influence;
  vec2 pixelPos = pos + offset;
  vec2 clipSpace = vec2((pixelPos.x / u_resolution.x) * 2.0 - 1.0,
                        (pixelPos.y / u_resolution.y) * -2.0 + 1.0);
  gl_Position = vec4(clipSpace, 0, 1);
}
`;

export const META_FRAG = `#version 300 es
precision highp float;
in vec2 v_pos;
uniform float u_radius;
uniform float u_power;
uniform vec2 u_resolution;
uniform vec3 u_color;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy;
  vec2 flippedPos = vec2(v_pos.x, u_resolution.y - v_pos.y);
  float dx = uv.x - flippedPos.x;
  float dy = uv.y - flippedPos.y;
  float dist = sqrt(dx * dx + dy * dy);
  float val = u_radius / pow(dist, u_power);
  fragColor = vec4(u_color, val);
}
`;

export const THRESH_VERT = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0, 1);
}
`;

export const THRESH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_accum;
uniform float u_threshold;
uniform vec2 u_resolution;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 liquid = texture(u_accum, uv);
  float liquidAlpha = liquid.a;
  if (liquidAlpha <= u_threshold) discard;
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;