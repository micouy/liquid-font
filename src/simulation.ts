import { PAIR_FORCE_GLSL } from "./pair-force";

export interface SimParams {
  stickiness: number;
  stiffness: number;
  surfaceTension: number;
  adhesive: number;
  smoothingRadius: number;
  interactionRange: number;
  bodyRadius: number;
  maxForce: number;
  overlapForceMax: number;
  frictionAir: number;
  gravity: number;
  targetNeighbors: number;
  substeps: number;
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

const MAX_PARTICLES = 1000;
const MAX_GLYPHS = 4096;
const NUM_PARTICLES = 1000;
const BOUNDARY_JITTER = 0.0002;

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
      1,
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
      1,
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
uniform float u_numParticles;
uniform float u_numGlyphs;
uniform float u_stickiness;
uniform float u_stiffness;
uniform float u_surfaceTension;
uniform float u_adhesive;
uniform float u_smoothingRadius;
uniform float u_interactionRange;
uniform float u_bodyRadius;
uniform float u_maxForce;
uniform float u_overlapForceMax;
uniform float u_frictionAir;
uniform float u_gravity;
uniform vec2 u_canvasSize;
uniform float u_targetNeighbors;
uniform float u_tick;

#define NUM_PARTICLES ${MAX_PARTICLES}
#define NUM_GLYPHS ${MAX_GLYPHS}
#define SECONDARY_FORCE_SCALE 0.01

${PAIR_FORCE_GLSL}

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
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
  float fy = u_gravity * 0.1;

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

  for (int i = 0; i < NUM_PARTICLES; i++) {
    if (float(i) >= u_numParticles) continue;
    if (float(i) == idx) continue;

    vec2 oUV = vec2((float(i) + 0.5) / (u_numParticles * 2.0), 0.5);
    vec4 other = texture2D(u_state, oUV);
    vec2 diff = other.rg - pos;
    float distSq = diff.x * diff.x + diff.y * diff.y;

    if (distSq < maxDistSq) {
      float safeDistSq = max(distSq, 0.0001);
      float dist = sqrt(safeDistSq);
      float nx = diff.x / dist;
      float ny = diff.y / dist;

      vec2 pairForce = computePairForceComponents(
        dist,
        u_bodyRadius,
        u_interactionRange,
        u_stickiness,
        u_stiffness,
        u_maxForce,
        u_overlapForceMax
      );
      fAttrX += nx * pairForce.x;
      fAttrY += ny * pairForce.x;
      fRepX -= nx * pairForce.y;
      fRepY -= ny * pairForce.y;
    }

    if (distSq < smoothRSq) {
      fluidNeighbors++;
      float invDist = 1.0 / sqrt(distSq);
      fluidNormal.x -= diff.x * invDist;
      fluidNormal.y -= diff.y * invDist;
    }
  }

  float surfaceness = max(0.0, 1.0 - float(fluidNeighbors) / u_targetNeighbors);
  int staticNeighbors = 0;

  for (int j = 0; j < NUM_GLYPHS; j++) {
    if (float(j) >= u_numGlyphs) continue;

    vec2 gUV = vec2((float(j) + 0.5) / float(NUM_GLYPHS), 0.5);
    vec4 glyph = texture2D(u_glyphs, gUV);
    vec2 diff = glyph.rg - pos;
    float distSq = diff.x * diff.x + diff.y * diff.y;

    if (distSq < smoothRSq && distSq > 0.01) {
      staticNeighbors++;
      float invDist = 1.0 / sqrt(distSq);
      staticNormal.x -= diff.x * invDist;
      staticNormal.y -= diff.y * invDist;
    }

    if (surfaceness > 0.0 && distSq > u_bodyRadius * u_bodyRadius && distSq < maxDistSq) {
      float dist = sqrt(distSq);
      float nx = diff.x / dist;
      float ny = diff.y / dist;
      float adh = u_adhesive * SECONDARY_FORCE_SCALE / dist * surfaceness;
      adh = min(adh, u_maxForce);
      fAdhX += nx * adh;
      fAdhY += ny * adh;
    }
  }

  int totalNeighbors = fluidNeighbors + staticNeighbors;
  float deficit = max(0.0, u_targetNeighbors - float(totalNeighbors));

  if (deficit > 0.0) {
    float totalWeight = u_stickiness + u_adhesive;
    if (totalWeight < 0.001) totalWeight = 1.0;
    vec2 blendNormal = (u_stickiness * fluidNormal + u_adhesive * staticNormal) / totalWeight;
    float normalLen = length(blendNormal);
    if (normalLen > 0.001) {
      float stForce = u_surfaceTension * SECONDARY_FORCE_SCALE * deficit;
      stForce = min(stForce, u_maxForce * 5.0);
      fStX -= (blendNormal.x / normalLen) * stForce;
      fStY -= (blendNormal.y / normalLen) * stForce;
    }
  }

  fx += fAttrX + fRepX + fStX + fAdhX;
  fy += fAttrY + fRepY + fStY + fAdhY;

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

  vel.x += fx;
  vel.y += fy;
  vel.x *= (1.0 - u_frictionAir);
  vel.y *= (1.0 - u_frictionAir);

  vec2 newPos = pos + vel;

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

  simUniforms: Record<string, WebGLUniformLocation | null>;
  spacingUniforms: Record<string, WebGLUniformLocation | null>;

  canvasWidth: number;
  canvasHeight: number;
  tick: number = 0;

  private forceReadBuffer: Float32Array;
  private spacingReadBuffer: Float32Array;
  private stateReadBuffer: Float32Array;

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
      "u_numParticles",
      "u_numGlyphs",
      "u_stickiness",
      "u_stiffness",
      "u_surfaceTension",
      "u_adhesive",
      "u_smoothingRadius",
      "u_interactionRange",
      "u_bodyRadius",
      "u_maxForce",
      "u_overlapForceMax",
      "u_frictionAir",
      "u_gravity",
      "u_canvasSize",
      "u_targetNeighbors",
      "u_tick",
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

    this.forceReadBuffer = new Float32Array(this.numParticles * 4);
    this.spacingReadBuffer = new Float32Array(this.numParticles * 4);
    this.stateReadBuffer = new Float32Array(this.numParticles * 4);
  }

  step(params: SimParams) {
    const gl = this.gl;
    let readFromA = this.currentRead === 0;
    const textureWidth = this.numParticles * 2;

    for (let s = 0; s < params.substeps; s++) {
      this.tick += 1;
      const readTex = readFromA ? this.stateA : this.stateB;
      const writeFB = readFromA ? this.fbB : this.fbA;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB);
      gl.viewport(0, 0, textureWidth, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.simProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.simUniforms["u_state"], 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture);
      gl.uniform1i(this.simUniforms["u_glyphs"], 1);

      gl.uniform1f(this.simUniforms["u_numParticles"], this.numParticles);
      gl.uniform1f(this.simUniforms["u_numGlyphs"], this.numGlyphs);
      gl.uniform1f(this.simUniforms["u_stickiness"], params.stickiness);
      gl.uniform1f(this.simUniforms["u_stiffness"], params.stiffness);
      gl.uniform1f(this.simUniforms["u_surfaceTension"], params.surfaceTension);
      gl.uniform1f(this.simUniforms["u_adhesive"], params.adhesive);
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
      gl.uniform1f(this.simUniforms["u_frictionAir"], params.frictionAir);
      gl.uniform1f(this.simUniforms["u_gravity"], params.gravity);
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
  }

  getCurrentStateTexture(): WebGLTexture {
    return this.currentRead === 0 ? this.stateA : this.stateB;
  }

  resize(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
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
  }
}
