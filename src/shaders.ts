export const SIM_VERTEX = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0, 1);
}
`;

export const SIM_FRAGMENT = `
precision highp float;

uniform sampler2D u_state;
uniform sampler2D u_glyphs;
uniform vec2 u_canvasSize;
uniform float u_numParticles;
uniform float u_numGlyphs;
uniform float u_dt;
uniform float u_bodyRadius;
uniform float u_cohesion;
uniform float u_repulsion;
uniform float u_adhesive;
uniform float u_surfaceTension;
uniform float u_maxForce;
uniform float u_smoothingRadius;
uniform float u_repulsionDistance;
uniform float u_forceDistance;
uniform float u_frictionAir;
uniform float u_gravity;
uniform float u_cursorX;
uniform float u_cursorY;
uniform float u_cursorActive;

#define NUM_PARTICLES 2048
#define NUM_GLYPHS 8192
#define TARGET_NEIGHBORS 6

void main() {
  float idx = floor(gl_FragCoord.x);
  if (idx >= u_numParticles) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec2 selfUV = vec2((idx + 0.5) / u_numParticles, 0.5);
  vec4 self = texture2D(u_state, selfUV);
  float px = self.r;
  float py = self.g;
  float vx = self.b;
  float vy = self.a;

  if (px == 0.0 && py == 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  float fx = 0.0;
  float fy = u_gravity;

  if (u_cursorActive > 0.5) {
    float cdx = u_cursorX - px;
    float cdy = u_cursorY - py;
    float cdist = sqrt(cdx * cdx + cdy * cdy);
    if (cdist < 100.0 && cdist > 0.01) {
      float cf = 0.00000001 * u_cursorForce * (100.0 - cdist);
      cf = min(cf, u_maxForce);
      fx += cdx * cf;
      fy += cdy * cf;
    }
  }

  float maxDist = u_forceDistance * u_bodyRadius;
  float maxDistSq = maxDist * maxDist;
  float repDist = u_repulsionDistance;
  float repDistSq = repDist * repDist;
  float smoothDist = u_smoothingRadius;
  float smoothDistSq = smoothDist * smoothDist;

  int neighborCount = 0;
  float fluidNormX = 0.0;
  float fluidNormY = 0.0;
  float staticNormX = 0.0;
  float staticNormY = 0.0;

  for (int i = 0; i < NUM_PARTICLES; i++) {
    if (float(i) >= u_numParticles) continue;
    if (float(i) == idx) continue;

    vec2 oUV = vec2((float(i) + 0.5) / u_numParticles, 0.5);
    vec4 other = texture2D(u_state, oUV);
    float ox = other.r;
    float oy = other.g;
    float dx = ox - px;
    float dy = oy - py;
    float distSq = dx * dx + dy * dy;

    if (distSq > smoothDistSq || distSq < 0.01) continue;

    if (distSq < maxDistSq) {
      float dist = sqrt(distSq);
      float nx = dx / dist;
      float ny = dy / dist;

      if (dist < repDist) {
        float repulsion = u_repulsion * 0.0001 / (dist * dist);
        repulsion = min(repulsion, u_maxForce);
        fx -= nx * repulsion;
        fy -= ny * repulsion;
      } else {
        float cohesion = u_cohesion * 0.0001 / dist;
        cohesion = min(cohesion, u_maxForce);
        fx += nx * cohesion;
        fy += ny * cohesion;
      }
    }

    neighborCount++;
    float invDist = 1.0 / sqrt(distSq);
    fluidNormX -= dx * invDist;
    fluidNormY -= dy * invDist;
  }

  for (int j = 0; j < NUM_GLYPHS; j++) {
    if (float(j) >= u_numGlyphs) continue;

    vec2 gUV = vec2((float(j) + 0.5) / u_numGlyphs, 0.5);
    vec4 glyph = texture2D(u_glyphs, gUV);
    float gx = glyph.r;
    float gy = glyph.g;
    float dx = gx - px;
    float dy = gy - py;
    float distSq = dx * dx + dy * dy;

    if (distSq < smoothDistSq && distSq > 0.01) {
      neighborCount++;
      float invDist = 1.0 / sqrt(distSq);
      staticNormX -= dx * invDist;
      staticNormY -= dy * invDist;
    }
  }

  float deficit = float(TARGET_NEIGHBORS) - float(neighborCount);
  if (deficit > 0.0) {
    float cohesionWeight = u_cohesion;
    float adhesionWeight = u_adhesive;
    float totalWeight = cohesionWeight + adhesionWeight;
    if (totalWeight < 0.001) totalWeight = 1.0;

    float nx = (cohesionWeight * fluidNormX + adhesionWeight * staticNormX) / totalWeight;
    float ny = (cohesionWeight * fluidNormY + adhesionWeight * staticNormY) / totalWeight;
    float normalLen = sqrt(nx * nx + ny * ny);
    if (normalLen > 0.001) {
      float sf = u_surfaceTension * 0.0001 * deficit;
      sf = min(sf, u_maxForce * 5.0);
      fx -= (nx / normalLen) * sf;
      fy -= (ny / normalLen) * sf;
    }
  }

  float surfaceness = max(0.0, 1.0 - float(neighborCount) / float(TARGET_NEIGHBORS));
  if (surfaceness > 0.0) {
    for (int j = 0; j < NUM_GLYPHS; j++) {
      if (float(j) >= u_numGlyphs) continue;

      vec2 gUV = vec2((float(j) + 0.5) / u_numGlyphs, 0.5);
      vec4 glyph = texture2D(u_glyphs, gUV);
      float gx = glyph.r;
      float gy = glyph.g;
      float dx = gx - px;
      float dy = gy - py;
      float dist = sqrt(dx * dx + dy * dy);

      if (dist > u_bodyRadius && dist < maxDist) {
        float nxx = dx / dist;
        float nyy = dy / dist;
        float adhesive = u_adhesive * 0.0001 / dist * surfaceness;
        adhesive = min(adhesive, u_maxForce);
        fx += nxx * adhesive;
        fy += nyy * adhesive;
      }
    }
  }

  vx += fx * u_dt;
  vy += fy * u_dt;
  vx *= (1.0 - u_frictionAir);
  vy *= (1.0 - u_frictionAir);

  float newX = px + vx * u_dt;
  float newY = py + vy * u_dt;

  if (newX < u_bodyRadius) { newX = u_bodyRadius; vx *= -0.3; }
  if (newX > u_canvasSize.x - u_bodyRadius) { newX = u_canvasSize.x - u_bodyRadius; vx *= -0.3; }
  if (newY < u_bodyRadius) { newY = u_bodyRadius; vy *= -0.3; }
  if (newY > u_canvasSize.y - u_bodyRadius) { newY = u_canvasSize.y - u_bodyRadius; vy *= -0.3; }

  gl_FragColor = vec4(newX, newY, vx, vy);
}
`;

export const META_VERTEX = `
attribute vec2 a_corner;
attribute float a_index;
uniform sampler2D u_state;
uniform float u_numParticles;
uniform float u_influence;
uniform vec2 u_resolution;
uniform float u_dpr;
varying vec2 v_pos;

void main() {
  vec2 uv = vec2((a_index + 0.5) / u_numParticles, 0.5);
  vec4 state = texture2D(u_state, uv);
  vec2 pos = state.rg * u_dpr;
  v_pos = pos;
  vec2 pixelPos = pos + a_corner * u_influence;
  vec2 clipSpace = vec2((pixelPos.x / u_resolution.x) * 2.0 - 1.0,
                        (pixelPos.y / u_resolution.y) * -2.0 + 1.0);
  gl_Position = vec4(clipSpace, 0, 1);
}
`;

export const META_FRAGMENT = `
precision highp float;
varying vec2 v_pos;
uniform float u_radius;
uniform float u_power;
uniform vec2 u_resolution;
uniform vec3 u_color;

void main() {
  vec2 uv = gl_FragCoord.xy;
  vec2 flippedPos = vec2(v_pos.x, u_resolution.y - v_pos.y);
  float dx = uv.x - flippedPos.x;
  float dy = uv.y - flippedPos.y;
  float dist = sqrt(dx * dx + dy * dy);
  float val = u_radius / pow(dist, u_power);
  gl_FragColor = vec4(u_color, val);
}
`;

export const THRESH_VERTEX = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0, 1);
}
`;

export const THRESH_FRAGMENT = `
precision highp float;
uniform sampler2D u_accum;
uniform float u_threshold;
uniform vec2 u_resolution;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 liquid = texture2D(u_accum, uv);
  float liquidAlpha = liquid.a;

  if (liquidAlpha <= u_threshold) {
    discard;
  }

  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;