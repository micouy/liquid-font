import { PAIR_FORCE_GLSL } from "./pair-force";

export interface SimParams {
  stickiness: number;
  stiffness: number;
  surfaceTension: number;
  liquidNormalWeight: number;
  glyphNormalWeight: number;
  adhesive: number;
  glyphRepulsion: number;
  timeScale: number;
  smoothingRadius: number;
  interactionRange: number;
  bodyRadius: number;
  maxForce: number;
  overlapForceMax: number;
  frictionLiquid: number;
  frictionGlyph: number;
  gravityX: number;
  gravityY: number;
  cursorX: number;
  cursorY: number;
  cursorVelX: number;
  cursorVelY: number;
  cursorActive: number;
  cursorForce: number;
  cursorRadius: number;
  targetNeighbors: number;
  substeps: number;
  debugDataEnabled: number;
}

export interface ForceAverages {
  total: number;
  attraction: number;
  repulsion: number;
  surfaceTension: number;
  adhesion: number;
}

export interface SpacingStats {
  meanNearest: number;
  minNearest: number;
}

export interface VelocityStats {
  meanSpeed: number;
  maxSpeed: number;
}

const MAX_PARTICLES = 4000;
const MAX_GLYPHS = 4096;
const NUM_PARTICLES = 4000; // 8192 is max
const BOUNDARY_JITTER = 0.0002;
const PARTICLE_BUCKET_SIZE = 48;
const PARTICLE_BUCKET_TEXELS = Math.ceil(PARTICLE_BUCKET_SIZE / 4);
const GLYPH_BUCKET_SIZE = 32;
const GLYPH_BUCKET_TEXELS = Math.ceil(GLYPH_BUCKET_SIZE / 4);

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createFloatTexture(
  gl: WebGL2RenderingContext,
  width: number,
  data?: Float32Array,
): WebGLTexture {
  return createFloatTexture2D(gl, width, 1, data);
}

function createFloatTexture2D(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  data?: Float32Array,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (data) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      height,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      height,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    );
  }
  return tex;
}

const VERT_SOURCE = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0, 1);
  }
`;

function buildSimFragment(): string {
  return `
precision highp float;

uniform sampler2D u_state;
uniform sampler2D u_glyphs;
uniform sampler2D u_particleGridMeta;
uniform sampler2D u_particleGridIndices;
uniform sampler2D u_glyphGridMeta;
uniform sampler2D u_glyphGridIndices;
uniform float u_numParticles;
uniform float u_numGlyphs;
uniform float u_stickiness;
uniform float u_stiffness;
uniform float u_surfaceTension;
uniform float u_liquidNormalWeight;
uniform float u_glyphNormalWeight;
uniform float u_adhesive;
uniform float u_glyphRepulsion;
uniform float u_smoothingRadius;
uniform float u_interactionRange;
uniform float u_bodyRadius;
uniform float u_maxForce;
uniform float u_overlapForceMax;
uniform float u_frictionLiquid;
uniform float u_frictionGlyph;
uniform vec2 u_gravity;
uniform vec2 u_cursor;
uniform vec2 u_cursorVelocity;
uniform float u_cursorActive;
uniform float u_cursorForce;
uniform float u_cursorRadius;
uniform vec2 u_canvasSize;
uniform float u_targetNeighbors;
uniform float u_tick;
uniform float u_dt;
uniform float u_gridCols;
uniform float u_gridRows;
uniform float u_gridCellSize;
uniform vec2 u_particleGridMetaTexSize;
uniform vec2 u_particleGridIndexTexSize;
uniform vec2 u_glyphGridMetaTexSize;
uniform vec2 u_glyphGridIndexTexSize;

#define NUM_PARTICLES ${MAX_PARTICLES}
#define NUM_GLYPHS ${MAX_GLYPHS}
#define ADHESION_FORCE_SCALE 0.03
#define SURFACE_TENSION_FORCE_SCALE 0.1
#define PARTICLE_BUCKET_TEXELS ${PARTICLE_BUCKET_TEXELS}
#define GLYPH_BUCKET_TEXELS ${GLYPH_BUCKET_TEXELS}

${PAIR_FORCE_GLSL}

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec4 readLinearTexel(sampler2D tex, vec2 texSize, float index) {
  float x = mod(index, texSize.x);
  float y = floor(index / texSize.x);
  return texture2D(tex, vec2((x + 0.5) / texSize.x, (y + 0.5) / texSize.y));
}

float readCellCount(sampler2D tex, vec2 texSize, float cellIndex) {
  return readLinearTexel(tex, texSize, cellIndex).x;
}

void accumulateParticleNeighbor(
  float candidateIdx,
  float idx,
  vec2 pos,
  float maxDistSq,
  float smoothR,
  float smoothRSq,
  float bodyRadius,
  float interactionRange,
  float stickiness,
  float stiffness,
  float maxForce,
  float overlapForceMax,
  inout float fAttrX,
  inout float fAttrY,
  inout float fRepX,
  inout float fRepY,
  inout int fluidNeighbors,
  inout vec2 fluidNormal,
  inout vec2 liquidVelocitySum,
  inout float liquidVelocityWeight
) {
  if (candidateIdx < 0.0 || candidateIdx == idx) return;

  vec2 oUV = vec2((candidateIdx + 0.5) / (u_numParticles * 2.0), 0.5);
  vec4 other = texture2D(u_state, oUV);
  vec2 diff = other.rg - pos;
  float distSq = dot(diff, diff);
  bool withinForce = distSq < maxDistSq;
  bool withinSmooth = distSq < smoothRSq;
  if (!withinForce && !withinSmooth) return;

  float safeDistSq = max(distSq, 0.0001);
  float dist = sqrt(safeDistSq);
  vec2 dir = diff / dist;

  if (withinForce) {
    vec2 pairForce = computePairForceComponents(
      dist,
      bodyRadius,
      interactionRange,
      stickiness,
      stiffness,
      maxForce,
      overlapForceMax
    );
    fAttrX += dir.x * pairForce.x;
    fAttrY += dir.y * pairForce.x;
    fRepX -= dir.x * pairForce.y;
    fRepY -= dir.y * pairForce.y;
  }

  if (withinSmooth) {
    float proximity = 1.0 - clamp(dist / smoothR, 0.0, 1.0);
    fluidNeighbors++;
    fluidNormal -= dir;
    liquidVelocitySum += other.ba * proximity;
    liquidVelocityWeight += proximity;
  }
}

void accumulateGlyphNeighbor(
  float candidateIdx,
  vec2 pos,
  float smoothR,
  float smoothRSq,
  float bodyRadius,
  float restDist,
  float maxDistSq,
  float surfaceness,
  float stiffness,
  float glyphRepulsion,
  float overlapForceMax,
  float adhesive,
  float maxForce,
  inout float fRepX,
  inout float fRepY,
  inout float fAdhX,
  inout float fAdhY,
  inout int staticNeighbors,
  inout vec2 staticNormal,
  inout float glyphVelocityWeight
) {
  if (candidateIdx < 0.0 || candidateIdx >= u_numGlyphs) return;

  vec2 gUV = vec2((candidateIdx + 0.5) / float(NUM_GLYPHS), 0.5);
  vec4 glyph = texture2D(u_glyphs, gUV);
  vec2 diff = glyph.rg - pos;
  float distSq = dot(diff, diff);
  float glyphRestDist = restDist * 0.8;
  float glyphRestDistSq = glyphRestDist * glyphRestDist;
  bool withinRepulsion = distSq < glyphRestDistSq;
  bool withinSmooth = distSq < smoothRSq && distSq > 0.01;
  bool withinAdhesion =
    surfaceness > 0.0 &&
    distSq > bodyRadius * bodyRadius &&
    distSq < maxDistSq;
  if (!withinRepulsion && !withinSmooth && !withinAdhesion) return;

  float safeDistSq = max(distSq, 0.0001);
  float dist = sqrt(safeDistSq);
  vec2 dir = diff / dist;

  if (withinRepulsion) {
    float overlap = (glyphRestDist - dist) / glyphRestDist;
    float repulsion = min(
      stiffness * glyphRepulsion * 0.04 * overlap,
      overlapForceMax
    );
    fRepX -= dir.x * repulsion;
    fRepY -= dir.y * repulsion;
  }

  if (withinSmooth) {
    float proximity = 1.0 - clamp(dist / smoothR, 0.0, 1.0);
    staticNeighbors++;
    staticNormal -= dir;
    glyphVelocityWeight += proximity;
  }

  if (withinAdhesion) {
    float adh = adhesive * ADHESION_FORCE_SCALE / dist * surfaceness;
    adh = min(adh, maxForce);
    fAdhX += dir.x * adh;
    fAdhY += dir.y * adh;
  }
}

void main() {
  float pxIdx = floor(gl_FragCoord.x);
  bool isForce = false;
  float idx = pxIdx;
  if (idx >= u_numParticles) {
    idx -= u_numParticles;
    isForce = true;
  }
  if (idx >= u_numParticles || idx < 0.0) discard;

  vec2 uv = vec2((idx + 0.5) / (u_numParticles * 2.0), 0.5);
  vec4 state = texture2D(u_state, uv);
  vec2 pos = state.rg;
  vec2 vel = state.ba;

  float fx = 0.0;
  float fy = u_gravity.y * 0.1;

  float fAttrX = 0.0; float fAttrY = 0.0;
  float fRepX = 0.0; float fRepY = 0.0;
  float fStX  = 0.0; float fStY  = 0.0;
  float fAdhX = 0.0; float fAdhY = 0.0;

  float restDist = u_bodyRadius * 2.0;
  float maxDist = max(restDist, u_interactionRange * u_bodyRadius);
  float maxDistSq = maxDist * maxDist;
  float smoothR = u_smoothingRadius;
  float smoothRSq = smoothR * smoothR;

  int fluidNeighbors = 0;
  vec2 fluidNormal = vec2(0.0);
  vec2 staticNormal = vec2(0.0);
  vec2 liquidVelocitySum = vec2(0.0);
  float liquidVelocityWeight = 0.0;
  float glyphVelocityWeight = 0.0;
  vec2 baseCell = floor(pos / max(u_gridCellSize, 1.0));

  for (int oy = -1; oy <= 1; oy++) {
    float cellY = baseCell.y + float(oy);
    if (cellY < 0.0 || cellY >= u_gridRows) continue;
    for (int ox = -1; ox <= 1; ox++) {
      float cellX = baseCell.x + float(ox);
      if (cellX < 0.0 || cellX >= u_gridCols) continue;
      float cellIndex = cellY * u_gridCols + cellX;
      float particleCount = readCellCount(
        u_particleGridMeta,
        u_particleGridMetaTexSize,
        cellIndex
      );
      float cellBase = cellIndex * float(PARTICLE_BUCKET_TEXELS);
      for (int slot = 0; slot < PARTICLE_BUCKET_TEXELS; slot++) {
        float packedStart = float(slot) * 4.0;
        if (packedStart >= particleCount) break;
        vec4 cellEntries = readLinearTexel(
          u_particleGridIndices,
          u_particleGridIndexTexSize,
          cellBase + float(slot)
        );
        if (packedStart < particleCount) {
          accumulateParticleNeighbor(
            cellEntries.x,
            idx,
            pos,
            maxDistSq,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            u_interactionRange,
            u_stickiness,
            u_stiffness,
            u_maxForce,
            u_overlapForceMax,
            fAttrX,
            fAttrY,
            fRepX,
            fRepY,
            fluidNeighbors,
            fluidNormal,
            liquidVelocitySum,
            liquidVelocityWeight
          );
        }
        if (packedStart + 1.0 < particleCount) {
          accumulateParticleNeighbor(
            cellEntries.y,
            idx,
            pos,
            maxDistSq,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            u_interactionRange,
            u_stickiness,
            u_stiffness,
            u_maxForce,
            u_overlapForceMax,
            fAttrX,
            fAttrY,
            fRepX,
            fRepY,
            fluidNeighbors,
            fluidNormal,
            liquidVelocitySum,
            liquidVelocityWeight
          );
        }
        if (packedStart + 2.0 < particleCount) {
          accumulateParticleNeighbor(
            cellEntries.z,
            idx,
            pos,
            maxDistSq,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            u_interactionRange,
            u_stickiness,
            u_stiffness,
            u_maxForce,
            u_overlapForceMax,
            fAttrX,
            fAttrY,
            fRepX,
            fRepY,
            fluidNeighbors,
            fluidNormal,
            liquidVelocitySum,
            liquidVelocityWeight
          );
        }
        if (packedStart + 3.0 < particleCount) {
          accumulateParticleNeighbor(
            cellEntries.w,
            idx,
            pos,
            maxDistSq,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            u_interactionRange,
            u_stickiness,
            u_stiffness,
            u_maxForce,
            u_overlapForceMax,
            fAttrX,
            fAttrY,
            fRepX,
            fRepY,
            fluidNeighbors,
            fluidNormal,
            liquidVelocitySum,
            liquidVelocityWeight
          );
        }
      }
    }
  }

  float surfaceness = max(0.0, 1.0 - float(fluidNeighbors) / u_targetNeighbors);
  int staticNeighbors = 0;

  for (int oy = -1; oy <= 1; oy++) {
    float cellY = baseCell.y + float(oy);
    if (cellY < 0.0 || cellY >= u_gridRows) continue;
    for (int ox = -1; ox <= 1; ox++) {
      float cellX = baseCell.x + float(ox);
      if (cellX < 0.0 || cellX >= u_gridCols) continue;
      float cellIndex = cellY * u_gridCols + cellX;
      float glyphCount = readCellCount(
        u_glyphGridMeta,
        u_glyphGridMetaTexSize,
        cellIndex
      );
      float cellBase = cellIndex * float(GLYPH_BUCKET_TEXELS);
      for (int slot = 0; slot < GLYPH_BUCKET_TEXELS; slot++) {
        float packedStart = float(slot) * 4.0;
        if (packedStart >= glyphCount) break;
        vec4 cellEntries = readLinearTexel(
          u_glyphGridIndices,
          u_glyphGridIndexTexSize,
          cellBase + float(slot)
        );
        if (packedStart < glyphCount) {
          accumulateGlyphNeighbor(
            cellEntries.x,
            pos,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            restDist,
            maxDistSq,
            surfaceness,
            u_stiffness,
            u_glyphRepulsion,
            u_overlapForceMax,
            u_adhesive,
            u_maxForce,
            fRepX,
            fRepY,
            fAdhX,
            fAdhY,
            staticNeighbors,
            staticNormal,
            glyphVelocityWeight
          );
        }
        if (packedStart + 1.0 < glyphCount) {
          accumulateGlyphNeighbor(
            cellEntries.y,
            pos,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            restDist,
            maxDistSq,
            surfaceness,
            u_stiffness,
            u_glyphRepulsion,
            u_overlapForceMax,
            u_adhesive,
            u_maxForce,
            fRepX,
            fRepY,
            fAdhX,
            fAdhY,
            staticNeighbors,
            staticNormal,
            glyphVelocityWeight
          );
        }
        if (packedStart + 2.0 < glyphCount) {
          accumulateGlyphNeighbor(
            cellEntries.z,
            pos,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            restDist,
            maxDistSq,
            surfaceness,
            u_stiffness,
            u_glyphRepulsion,
            u_overlapForceMax,
            u_adhesive,
            u_maxForce,
            fRepX,
            fRepY,
            fAdhX,
            fAdhY,
            staticNeighbors,
            staticNormal,
            glyphVelocityWeight
          );
        }
        if (packedStart + 3.0 < glyphCount) {
          accumulateGlyphNeighbor(
            cellEntries.w,
            pos,
            smoothR,
            smoothRSq,
            u_bodyRadius,
            restDist,
            maxDistSq,
            surfaceness,
            u_stiffness,
            u_glyphRepulsion,
            u_overlapForceMax,
            u_adhesive,
            u_maxForce,
            fRepX,
            fRepY,
            fAdhX,
            fAdhY,
            staticNeighbors,
            staticNormal,
            glyphVelocityWeight
          );
        }
      }
    }
  }

  float weightedNeighborCount =
    u_liquidNormalWeight * float(fluidNeighbors) +
    u_glyphNormalWeight * float(staticNeighbors);
  vec2 blendNormal =
    (u_liquidNormalWeight * fluidNormal + u_glyphNormalWeight * staticNormal) /
    max(weightedNeighborCount, 1.0);
  float normalLen = length(blendNormal);
  float boundaryScore = normalLen;

  if (boundaryScore > 0.01) {
    float stForce = u_surfaceTension * SURFACE_TENSION_FORCE_SCALE * boundaryScore;
    stForce = min(stForce, u_overlapForceMax);
    fStX -= (blendNormal.x / normalLen) * stForce;
    fStY -= (blendNormal.y / normalLen) * stForce;
  }

  fx += fAttrX + fRepX + fStX + fAdhX;
  fy += fAttrY + fRepY + fStY + fAdhY;

  if (liquidVelocityWeight > 0.0) {
    vec2 targetVelocity = liquidVelocitySum / liquidVelocityWeight;
    float liquidBlend = min(u_frictionLiquid * liquidVelocityWeight * u_dt, 1.0);
    vel += (targetVelocity - vel) * liquidBlend;
  }

  if (glyphVelocityWeight > 0.0) {
    float glyphBlend = min(u_frictionGlyph * glyphVelocityWeight * u_dt, 1.0);
    vel *= (1.0 - glyphBlend);
  }

  if (u_cursorActive > 0.001) {
    vec2 cursorDiff = u_cursor - pos;
    float cursorDist = length(cursorDiff);
    if (cursorDist > 0.001) {
      vec2 cursorDir = cursorDiff / cursorDist;
      float cursorFalloff = 1.0 - smoothstep(u_cursorRadius, u_cursorRadius * 4.0, cursorDist);
      float cursorPull = u_cursorActive * u_cursorForce * cursorFalloff * cursorFalloff;
      float radialSpeed = dot(vel, cursorDir);
      float cursorDamping = max(0.0, radialSpeed) * u_cursorActive * cursorFalloff * 0.35;
      fx += cursorDir.x * (cursorPull - cursorDamping);
      fy += cursorDir.y * (cursorPull - cursorDamping);

      float cursorSpeed = length(u_cursorVelocity);
      float carryFalloff = 1.0 - smoothstep(u_cursorRadius, u_cursorRadius * 1.6, cursorDist);
      if (cursorSpeed > 0.05 && carryFalloff > 0.0) {
        vec2 cursorVelDelta = u_cursorVelocity - vel;
        float velocityBlend = u_cursorActive * carryFalloff * carryFalloff * 0.08 * u_dt;
        vel += cursorVelDelta * velocityBlend;

        float particleSpeed = length(vel);
        float maxCarrySpeed = cursorSpeed + 0.2;
        if (particleSpeed > maxCarrySpeed && particleSpeed > 0.001) {
          vel *= maxCarrySpeed / particleSpeed;
        }
      }
    }
  }

  bool nearHorizontalWall = pos.y < u_bodyRadius * 2.0 || pos.y > u_canvasSize.y - u_bodyRadius * 2.0;
  if (nearHorizontalWall) {
    float seed = idx * 17.0 + u_tick * 0.618;
    vec2 jitter = vec2(hash(seed), hash(seed + 13.0)) * 2.0 - 1.0;
    float jitterLen = max(length(jitter), 0.001);
    jitter /= jitterLen;
    fx += jitter.x * ${BOUNDARY_JITTER};
    fy += jitter.y * ${BOUNDARY_JITTER * 0.25};
  }

  if (isForce) {
    float totalF = sqrt(fx * fx + fy * fy);
    float attrF = sqrt(fAttrX * fAttrX + fAttrY * fAttrY);
    float repF = sqrt(fRepX * fRepX + fRepY * fRepY);
    float adhF = sqrt(fAdhX * fAdhX + fAdhY * fAdhY);
    float stF = sqrt(fStX * fStX + fStY * fStY);
    gl_FragColor = vec4(totalF, attrF, repF, stF);
    return;
  }

  vel.x += fx * u_dt;
  vel.y += fy * u_dt;

  vec2 newPos = pos + vel * u_dt;

  float br = u_bodyRadius;
  if (newPos.x < br) { newPos.x = br; vel.x *= -0.3; }
  if (newPos.x > u_canvasSize.x - br) { newPos.x = u_canvasSize.x - br; vel.x *= -0.3; }
  if (newPos.y < br) { newPos.y = br; vel.y *= -0.3; }
  if (newPos.y > u_canvasSize.y - br) { newPos.y = u_canvasSize.y - br; vel.y *= -0.3; }

  gl_FragColor = vec4(newPos, vel);
}
`;
}

function buildSpacingFragment(): string {
  return `
precision highp float;

uniform sampler2D u_state;
uniform float u_numParticles;

#define NUM_PARTICLES ${MAX_PARTICLES}

void main() {
  float idx = floor(gl_FragCoord.x);
  if (idx >= u_numParticles) discard;

  vec2 uv = vec2((idx + 0.5) / (u_numParticles * 2.0), 0.5);
  vec2 pos = texture2D(u_state, uv).rg;
  float nearestSq = 1e20;

  for (int i = 0; i < NUM_PARTICLES; i++) {
    if (float(i) >= u_numParticles) continue;
    if (float(i) == idx) continue;

    vec2 oUV = vec2((float(i) + 0.5) / (u_numParticles * 2.0), 0.5);
    vec2 otherPos = texture2D(u_state, oUV).rg;
    vec2 diff = otherPos - pos;
    float distSq = dot(diff, diff);
    if (distSq < nearestSq) nearestSq = distSq;
  }

  gl_FragColor = vec4(sqrt(nearestSq), 0.0, 0.0, 1.0);
}
`;
}

export class GPUSimulation {
  gl: WebGL2RenderingContext;
  numParticles: number = NUM_PARTICLES;
  numGlyphs: number = 0;
  currentRead: number = 0;

  simProgram: WebGLProgram;
  spacingProgram: WebGLProgram;
  simQuadBuffer: WebGLBuffer;

  fbA: WebGLFramebuffer;
  fbB: WebGLFramebuffer;
  spacingFB: WebGLFramebuffer;
  stateA: WebGLTexture;
  stateB: WebGLTexture;
  spacingTexture: WebGLTexture;

  glyphTexture: WebGLTexture;
  glyphData: Float32Array;
  particleGridMetaTexture: WebGLTexture;
  particleGridIndexTexture: WebGLTexture;
  glyphGridMetaTexture: WebGLTexture;
  glyphGridIndexTexture: WebGLTexture;

  simUniforms: Record<string, WebGLUniformLocation | null>;
  spacingUniforms: Record<string, WebGLUniformLocation | null>;

  canvasWidth: number;
  canvasHeight: number;
  tick: number = 0;

  private forceReadBuffer: Float32Array;
  private spacingReadBuffer: Float32Array;
  private stateReadBuffer: Float32Array;
  private particleGridMetaData: Float32Array = new Float32Array(4);
  private particleGridIndexData: Float32Array = new Float32Array(4);
  private glyphGridMetaData: Float32Array = new Float32Array(4);
  private glyphGridIndexData: Float32Array = new Float32Array(4);
  private particleCellCounts: Uint16Array = new Uint16Array(1);
  private glyphCellCounts: Uint16Array = new Uint16Array(1);
  private gridCols: number = 1;
  private gridRows: number = 1;
  private gridCellSize: number = 1;
  private particleGridMetaWidth: number = 1;
  private particleGridMetaHeight: number = 1;
  private particleGridIndexWidth: number = 1;
  private particleGridIndexHeight: number = 1;
  private glyphGridMetaWidth: number = 1;
  private glyphGridMetaHeight: number = 1;
  private glyphGridIndexWidth: number = 1;
  private glyphGridIndexHeight: number = 1;
  private maxTextureSize: number;
  private glyphGridDirty: boolean = true;
  private particleGridOverflowCount: number = 0;
  private glyphGridOverflowCount: number = 0;

  constructor(
    gl: WebGL2RenderingContext,
    canvasWidth: number,
    canvasHeight: number,
  ) {
    this.gl = gl;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    const ext = gl.getExtension("EXT_color_buffer_float");
    if (!ext) console.warn("EXT_color_buffer_float not supported");
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    const vs = createShader(gl, gl.VERTEX_SHADER, VERT_SOURCE)!;
    const fs = createShader(gl, gl.FRAGMENT_SHADER, buildSimFragment())!;
    const spacingFs = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      buildSpacingFragment(),
    )!;
    this.simProgram = createProgram(gl, vs, fs)!;
    this.spacingProgram = createProgram(gl, vs, spacingFs)!;

    this.simUniforms = {};
    const uniformNames = [
      "u_state",
      "u_glyphs",
      "u_particleGridMeta",
      "u_particleGridIndices",
      "u_glyphGridMeta",
      "u_glyphGridIndices",
      "u_numParticles",
      "u_numGlyphs",
      "u_stickiness",
      "u_stiffness",
      "u_surfaceTension",
      "u_liquidNormalWeight",
      "u_glyphNormalWeight",
      "u_adhesive",
      "u_glyphRepulsion",
      "u_smoothingRadius",
      "u_interactionRange",
      "u_bodyRadius",
      "u_maxForce",
      "u_overlapForceMax",
      "u_frictionLiquid",
      "u_frictionGlyph",
      "u_gravity",
      "u_cursor",
      "u_cursorVelocity",
      "u_cursorActive",
      "u_cursorForce",
      "u_cursorRadius",
      "u_canvasSize",
      "u_targetNeighbors",
      "u_tick",
      "u_dt",
      "u_gridCols",
      "u_gridRows",
      "u_gridCellSize",
      "u_particleGridMetaTexSize",
      "u_particleGridIndexTexSize",
      "u_glyphGridMetaTexSize",
      "u_glyphGridIndexTexSize",
    ];
    for (const name of uniformNames) {
      this.simUniforms[name] = gl.getUniformLocation(this.simProgram, name);
    }

    this.spacingUniforms = {};
    for (const name of ["u_state", "u_numParticles", "u_canvasSize"]) {
      this.spacingUniforms[name] = gl.getUniformLocation(
        this.spacingProgram,
        name,
      );
    }

    this.simQuadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.simQuadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const textureWidth = this.numParticles * 2;
    const initData = new Float32Array(textureWidth * 4);
    for (let i = 0; i < this.numParticles; i++) {
      initData[i * 4] = Math.random() * canvasWidth;
      initData[i * 4 + 1] = Math.random() * canvasHeight;
      initData[i * 4 + 2] = 0;
      initData[i * 4 + 3] = 0;
    }

    this.stateA = createFloatTexture(gl, textureWidth, initData);
    this.stateB = createFloatTexture(gl, textureWidth, initData.slice());
    this.spacingTexture = createFloatTexture(gl, this.numParticles);

    this.fbA = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.stateA,
      0,
    );
    console.log("fbA status:", gl.checkFramebufferStatus(gl.FRAMEBUFFER));

    this.fbB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.stateB,
      0,
    );
    console.log("fbB status:", gl.checkFramebufferStatus(gl.FRAMEBUFFER));

    this.spacingFB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.spacingFB);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.spacingTexture,
      0,
    );
    console.log("spacingFB status:", gl.checkFramebufferStatus(gl.FRAMEBUFFER));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.glyphData = new Float32Array(MAX_GLYPHS * 4);
    this.glyphTexture = createFloatTexture(gl, MAX_GLYPHS, this.glyphData);
    this.particleGridMetaTexture = createFloatTexture(
      gl,
      1,
      new Float32Array(4),
    );
    this.particleGridIndexTexture = createFloatTexture(
      gl,
      1,
      new Float32Array(4),
    );
    this.glyphGridMetaTexture = createFloatTexture(gl, 1, new Float32Array(4));
    this.glyphGridIndexTexture = createFloatTexture(gl, 1, new Float32Array(4));

    this.forceReadBuffer = new Float32Array(this.numParticles * 4);
    this.spacingReadBuffer = new Float32Array(this.numParticles * 4);
    this.stateReadBuffer = new Float32Array(this.numParticles * 4);
  }

  private getTextureSize(totalTexels: number) {
    const width = Math.max(1, Math.min(this.maxTextureSize, totalTexels));
    const height = Math.max(1, Math.ceil(totalTexels / width));
    return { width, height };
  }

  private uploadFloatTexture2D(
    texture: WebGLTexture,
    width: number,
    height: number,
    data: Float32Array,
  ) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      height,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
  }

  private ensureSpatialGrid(cellSize: number) {
    const nextCellSize = Math.max(1, cellSize);
    const nextCols = Math.max(1, Math.ceil(this.canvasWidth / nextCellSize));
    const nextRows = Math.max(1, Math.ceil(this.canvasHeight / nextCellSize));
    const needsResize =
      this.gridCols !== nextCols ||
      this.gridRows !== nextRows ||
      Math.abs(this.gridCellSize - nextCellSize) > 0.001;
    if (!needsResize) return;

    this.gridCellSize = nextCellSize;
    this.gridCols = nextCols;
    this.gridRows = nextRows;
    const cellCount = this.gridCols * this.gridRows;

    this.particleCellCounts = new Uint16Array(cellCount);
    this.glyphCellCounts = new Uint16Array(cellCount);

    const particleMetaSize = this.getTextureSize(cellCount);
    this.particleGridMetaWidth = particleMetaSize.width;
    this.particleGridMetaHeight = particleMetaSize.height;
    this.particleGridMetaData = new Float32Array(
      this.particleGridMetaWidth * this.particleGridMetaHeight * 4,
    );

    const particleIndexSize = this.getTextureSize(
      cellCount * PARTICLE_BUCKET_TEXELS,
    );
    this.particleGridIndexWidth = particleIndexSize.width;
    this.particleGridIndexHeight = particleIndexSize.height;
    this.particleGridIndexData = new Float32Array(
      this.particleGridIndexWidth * this.particleGridIndexHeight * 4,
    );

    const glyphMetaSize = this.getTextureSize(cellCount);
    this.glyphGridMetaWidth = glyphMetaSize.width;
    this.glyphGridMetaHeight = glyphMetaSize.height;
    this.glyphGridMetaData = new Float32Array(
      this.glyphGridMetaWidth * this.glyphGridMetaHeight * 4,
    );

    const glyphIndexSize = this.getTextureSize(cellCount * GLYPH_BUCKET_TEXELS);
    this.glyphGridIndexWidth = glyphIndexSize.width;
    this.glyphGridIndexHeight = glyphIndexSize.height;
    this.glyphGridIndexData = new Float32Array(
      this.glyphGridIndexWidth * this.glyphGridIndexHeight * 4,
    );

    this.uploadFloatTexture2D(
      this.particleGridMetaTexture,
      this.particleGridMetaWidth,
      this.particleGridMetaHeight,
      this.particleGridMetaData,
    );
    this.uploadFloatTexture2D(
      this.particleGridIndexTexture,
      this.particleGridIndexWidth,
      this.particleGridIndexHeight,
      this.particleGridIndexData,
    );
    this.uploadFloatTexture2D(
      this.glyphGridMetaTexture,
      this.glyphGridMetaWidth,
      this.glyphGridMetaHeight,
      this.glyphGridMetaData,
    );
    this.uploadFloatTexture2D(
      this.glyphGridIndexTexture,
      this.glyphGridIndexWidth,
      this.glyphGridIndexHeight,
      this.glyphGridIndexData,
    );
    this.glyphGridDirty = true;
  }

  private getCellIndex(x: number, y: number) {
    const cellX = Math.max(
      0,
      Math.min(this.gridCols - 1, Math.floor(x / this.gridCellSize)),
    );
    const cellY = Math.max(
      0,
      Math.min(this.gridRows - 1, Math.floor(y / this.gridCellSize)),
    );
    return cellY * this.gridCols + cellX;
  }

  private rebuildParticleGrid() {
    const gl = this.gl;
    const readFB = this.currentRead === 0 ? this.fbA : this.fbB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, readFB);
    gl.readPixels(
      0,
      0,
      this.numParticles,
      1,
      gl.RGBA,
      gl.FLOAT,
      this.stateReadBuffer,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.particleCellCounts.fill(0);
    this.particleGridMetaData.fill(0);
    this.particleGridIndexData.fill(-1);
    this.particleGridOverflowCount = 0;

    for (let i = 0; i < this.numParticles; i++) {
      const x = this.stateReadBuffer[i * 4];
      const y = this.stateReadBuffer[i * 4 + 1];
      const cellIndex = this.getCellIndex(x, y);
      const count = this.particleCellCounts[cellIndex];
      if (count < PARTICLE_BUCKET_SIZE) {
        this.particleGridIndexData[
          cellIndex * PARTICLE_BUCKET_TEXELS * 4 + count
        ] = i;
        this.particleCellCounts[cellIndex] = count + 1;
      } else {
        this.particleGridOverflowCount++;
      }
    }

    for (let i = 0; i < this.particleCellCounts.length; i++) {
      this.particleGridMetaData[i * 4] = this.particleCellCounts[i];
    }

    this.uploadFloatTexture2D(
      this.particleGridMetaTexture,
      this.particleGridMetaWidth,
      this.particleGridMetaHeight,
      this.particleGridMetaData,
    );
    this.uploadFloatTexture2D(
      this.particleGridIndexTexture,
      this.particleGridIndexWidth,
      this.particleGridIndexHeight,
      this.particleGridIndexData,
    );
  }

  private rebuildGlyphGrid() {
    this.glyphCellCounts.fill(0);
    this.glyphGridMetaData.fill(0);
    this.glyphGridIndexData.fill(-1);
    this.glyphGridOverflowCount = 0;

    for (let i = 0; i < this.numGlyphs; i++) {
      const x = this.glyphData[i * 4];
      const y = this.glyphData[i * 4 + 1];
      const cellIndex = this.getCellIndex(x, y);
      const count = this.glyphCellCounts[cellIndex];
      if (count < GLYPH_BUCKET_SIZE) {
        this.glyphGridIndexData[cellIndex * GLYPH_BUCKET_TEXELS * 4 + count] =
          i;
        this.glyphCellCounts[cellIndex] = count + 1;
      } else {
        this.glyphGridOverflowCount++;
      }
    }

    for (let i = 0; i < this.glyphCellCounts.length; i++) {
      this.glyphGridMetaData[i * 4] = this.glyphCellCounts[i];
    }

    this.uploadFloatTexture2D(
      this.glyphGridMetaTexture,
      this.glyphGridMetaWidth,
      this.glyphGridMetaHeight,
      this.glyphGridMetaData,
    );
    this.uploadFloatTexture2D(
      this.glyphGridIndexTexture,
      this.glyphGridIndexWidth,
      this.glyphGridIndexHeight,
      this.glyphGridIndexData,
    );
    this.glyphGridDirty = false;
  }

  step(params: SimParams) {
    const gl = this.gl;
    let readFromA = this.currentRead === 0;
    const textureWidth = this.numParticles * 2;
    const outputWidth =
      params.debugDataEnabled > 0.5 ? textureWidth : this.numParticles;
    const dt = params.timeScale / Math.max(params.substeps, 1);
    const cellSize = Math.max(
      params.smoothingRadius,
      params.interactionRange * params.bodyRadius,
    );

    this.ensureSpatialGrid(cellSize);
    if (this.glyphGridDirty) this.rebuildGlyphGrid();

    for (let s = 0; s < params.substeps; s++) {
      this.rebuildParticleGrid();
      this.tick += 1;
      const readTex = readFromA ? this.stateA : this.stateB;
      const writeFB = readFromA ? this.fbB : this.fbA;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB);
      gl.viewport(0, 0, outputWidth, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.simProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.simUniforms["u_state"], 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture);
      gl.uniform1i(this.simUniforms["u_glyphs"], 1);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.particleGridMetaTexture);
      gl.uniform1i(this.simUniforms["u_particleGridMeta"], 2);

      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.particleGridIndexTexture);
      gl.uniform1i(this.simUniforms["u_particleGridIndices"], 3);

      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphGridMetaTexture);
      gl.uniform1i(this.simUniforms["u_glyphGridMeta"], 4);

      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphGridIndexTexture);
      gl.uniform1i(this.simUniforms["u_glyphGridIndices"], 5);

      gl.uniform1f(this.simUniforms["u_numParticles"], this.numParticles);
      gl.uniform1f(this.simUniforms["u_numGlyphs"], this.numGlyphs);
      gl.uniform1f(this.simUniforms["u_stickiness"], params.stickiness);
      gl.uniform1f(this.simUniforms["u_stiffness"], params.stiffness);
      gl.uniform1f(this.simUniforms["u_surfaceTension"], params.surfaceTension);
      gl.uniform1f(
        this.simUniforms["u_liquidNormalWeight"],
        params.liquidNormalWeight,
      );
      gl.uniform1f(
        this.simUniforms["u_glyphNormalWeight"],
        params.glyphNormalWeight,
      );
      gl.uniform1f(this.simUniforms["u_adhesive"], params.adhesive);
      gl.uniform1f(this.simUniforms["u_glyphRepulsion"], params.glyphRepulsion);
      gl.uniform1f(
        this.simUniforms["u_smoothingRadius"],
        params.smoothingRadius,
      );
      gl.uniform1f(
        this.simUniforms["u_interactionRange"],
        params.interactionRange,
      );
      gl.uniform1f(this.simUniforms["u_bodyRadius"], params.bodyRadius);
      gl.uniform1f(this.simUniforms["u_maxForce"], params.maxForce);
      gl.uniform1f(
        this.simUniforms["u_overlapForceMax"],
        params.overlapForceMax,
      );
      gl.uniform1f(this.simUniforms["u_frictionLiquid"], params.frictionLiquid);
      gl.uniform1f(this.simUniforms["u_frictionGlyph"], params.frictionGlyph);
      gl.uniform2f(
        this.simUniforms["u_gravity"],
        params.gravityX,
        params.gravityY,
      );
      gl.uniform2f(
        this.simUniforms["u_cursor"],
        params.cursorX,
        params.cursorY,
      );
      gl.uniform2f(
        this.simUniforms["u_cursorVelocity"],
        params.cursorVelX,
        params.cursorVelY,
      );
      gl.uniform1f(this.simUniforms["u_cursorActive"], params.cursorActive);
      gl.uniform1f(this.simUniforms["u_cursorForce"], params.cursorForce);
      gl.uniform1f(this.simUniforms["u_cursorRadius"], params.cursorRadius);
      gl.uniform2f(
        this.simUniforms["u_canvasSize"],
        this.canvasWidth,
        this.canvasHeight,
      );
      gl.uniform1f(
        this.simUniforms["u_targetNeighbors"],
        params.targetNeighbors,
      );
      gl.uniform1f(this.simUniforms["u_tick"], this.tick);
      gl.uniform1f(this.simUniforms["u_dt"], dt);
      gl.uniform1f(this.simUniforms["u_gridCols"], this.gridCols);
      gl.uniform1f(this.simUniforms["u_gridRows"], this.gridRows);
      gl.uniform1f(this.simUniforms["u_gridCellSize"], this.gridCellSize);
      gl.uniform2f(
        this.simUniforms["u_particleGridMetaTexSize"],
        this.particleGridMetaWidth,
        this.particleGridMetaHeight,
      );
      gl.uniform2f(
        this.simUniforms["u_particleGridIndexTexSize"],
        this.particleGridIndexWidth,
        this.particleGridIndexHeight,
      );
      gl.uniform2f(
        this.simUniforms["u_glyphGridMetaTexSize"],
        this.glyphGridMetaWidth,
        this.glyphGridMetaHeight,
      );
      gl.uniform2f(
        this.simUniforms["u_glyphGridIndexTexSize"],
        this.glyphGridIndexWidth,
        this.glyphGridIndexHeight,
      );

      const posLoc = gl.getAttribLocation(this.simProgram, "a_position");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.simQuadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      readFromA = !readFromA;
    }

    this.currentRead = readFromA ? 0 : 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  readForceAverages(): ForceAverages {
    const gl = this.gl;
    const readFB = this.currentRead === 0 ? this.fbA : this.fbB;

    gl.bindFramebuffer(gl.FRAMEBUFFER, readFB);
    gl.readPixels(
      this.numParticles,
      0,
      this.numParticles,
      1,
      gl.RGBA,
      gl.FLOAT,
      this.forceReadBuffer,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let totalSum = 0,
      cohSum = 0,
      repSum = 0,
      stSum = 0;
    let count = 0;
    for (let i = 0; i < this.numParticles; i++) {
      const total = this.forceReadBuffer[i * 4];
      const coh = this.forceReadBuffer[i * 4 + 1];
      const rep = this.forceReadBuffer[i * 4 + 2];
      const st = this.forceReadBuffer[i * 4 + 3];
      if (total > 0) {
        totalSum += total;
        cohSum += coh;
        repSum += rep;
        stSum += st;
        count++;
      }
    }
    const n = Math.max(count, 1);
    return {
      total: totalSum / n,
      attraction: cohSum / n,
      repulsion: repSum / n,
      surfaceTension: stSum / n,
      adhesion: 0,
    };
  }

  readSpacingStats(): SpacingStats {
    const gl = this.gl;
    const readTex = this.currentRead === 0 ? this.stateA : this.stateB;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.spacingFB);
    gl.viewport(0, 0, this.numParticles, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.spacingProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(this.spacingUniforms["u_state"], 0);
    gl.uniform1f(this.spacingUniforms["u_numParticles"], this.numParticles);
    gl.uniform2f(
      this.spacingUniforms["u_canvasSize"],
      this.canvasWidth,
      this.canvasHeight,
    );

    const posLoc = gl.getAttribLocation(this.spacingProgram, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.simQuadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.readPixels(
      0,
      0,
      this.numParticles,
      1,
      gl.RGBA,
      gl.FLOAT,
      this.spacingReadBuffer,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let nearestSum = 0;
    let globalMin = Infinity;
    let count = 0;
    const maxReasonable = Math.hypot(this.canvasWidth, this.canvasHeight);

    for (let i = 0; i < this.numParticles; i++) {
      const nearest = this.spacingReadBuffer[i * 4];
      if (!Number.isFinite(nearest) || nearest < 0 || nearest > maxReasonable) {
        continue;
      }
      nearestSum += nearest;
      if (nearest < globalMin) globalMin = nearest;
      count++;
    }

    if (count === 0) {
      return {
        meanNearest: 0,
        minNearest: 0,
      };
    }

    return {
      meanNearest: nearestSum / count,
      minNearest: globalMin,
    };
  }

  readVelocityStats(): VelocityStats {
    const gl = this.gl;
    const readFB = this.currentRead === 0 ? this.fbA : this.fbB;

    gl.bindFramebuffer(gl.FRAMEBUFFER, readFB);
    gl.readPixels(
      0,
      0,
      this.numParticles,
      1,
      gl.RGBA,
      gl.FLOAT,
      this.stateReadBuffer,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let speedSum = 0;
    let maxSpeed = 0;

    for (let i = 0; i < this.numParticles; i++) {
      const vx = this.stateReadBuffer[i * 4 + 2];
      const vy = this.stateReadBuffer[i * 4 + 3];
      const speed = Math.hypot(vx, vy);
      speedSum += speed;
      if (speed > maxSpeed) maxSpeed = speed;
    }

    return {
      meanSpeed: speedSum / this.numParticles,
      maxSpeed,
    };
  }

  updateGlyphs(positions: { x: number; y: number }[]) {
    const gl = this.gl;
    this.numGlyphs = Math.min(positions.length, MAX_GLYPHS);
    this.glyphData.fill(0);
    for (let i = 0; i < this.numGlyphs; i++) {
      this.glyphData[i * 4] = positions[i].x;
      this.glyphData[i * 4 + 1] = positions[i].y;
      this.glyphData[i * 4 + 2] = 0;
      this.glyphData[i * 4 + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      MAX_GLYPHS,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      this.glyphData,
    );
    this.glyphGridDirty = true;
  }

  getCurrentStateTexture(): WebGLTexture {
    return this.currentRead === 0 ? this.stateA : this.stateB;
  }

  resize(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.glyphGridDirty = true;
  }

  getGridDiagnostics() {
    return {
      particleOverflowCount: this.particleGridOverflowCount,
      glyphOverflowCount: this.glyphGridOverflowCount,
      gridCols: this.gridCols,
      gridRows: this.gridRows,
      gridCellSize: this.gridCellSize,
    };
  }

  resetParticles(canvasWidth: number, canvasHeight: number) {
    const gl = this.gl;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    const textureWidth = this.numParticles * 2;
    const initData = new Float32Array(textureWidth * 4);
    for (let i = 0; i < this.numParticles; i++) {
      initData[i * 4] = Math.random() * canvasWidth;
      initData[i * 4 + 1] = Math.random() * canvasHeight;
      initData[i * 4 + 2] = 0;
      initData[i * 4 + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stateA);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      textureWidth,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      initData,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.stateB);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      textureWidth,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      initData.slice(),
    );
    this.glyphGridDirty = true;
  }
}
