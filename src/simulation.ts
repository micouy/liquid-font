export interface SimParams {
  h: number;
  restDensity: number;
  stiffness: number;
  viscosity: number;
  particleMass: number;
  bodyRadius: number;
  frictionAir: number;
  gravity: number;
  substeps: number;
  dt: number;
}

const MAX_PARTICLES = 1000;
const NUM_PARTICLES = 1000;

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

function buildDensityFragment(): string {
  return `
precision highp float;

uniform sampler2D u_state;
uniform float u_numParticles;
uniform float u_h;
uniform float u_mass;
uniform float u_restDensity;
uniform float u_stiffness;

#define NUM_PARTICLES ${MAX_PARTICLES}
#define PI 3.141592653589793

float W_poly6(float r, float h) {
  if (r >= h) return 0.0;
  float h2 = h * h;
  float diff = h2 - r * r;
  float coeff = 4.0 / (PI * pow(h, 8.0));
  return coeff * diff * diff * diff;
}

void main() {
  float idx = floor(gl_FragCoord.x);
  if (idx >= u_numParticles) discard;

  vec2 uv = vec2((idx + 0.5) / u_numParticles, 0.5);
  vec4 state = texture2D(u_state, uv);
  vec2 pos = state.rg;

  float density = 0.0;

  for (int i = 0; i < NUM_PARTICLES; i++) {
    if (float(i) >= u_numParticles) continue;
    vec2 oUV = vec2((float(i) + 0.5) / u_numParticles, 0.5);
    vec4 other = texture2D(u_state, oUV);
    vec2 diff = other.rg - pos;
    float dist = length(diff);
    density += u_mass * W_poly6(dist, u_h);
  }

  density = max(density, 0.001);
  float pressure = u_stiffness * (density - u_restDensity);

  gl_FragColor = vec4(density, pressure, 0.0, 0.0);
}
`;
}

function buildForceFragment(): string {
  return `
precision highp float;

uniform sampler2D u_state;
uniform sampler2D u_density;
uniform float u_numParticles;
uniform float u_h;
uniform float u_mass;
uniform float u_viscosity;
uniform vec2 u_canvasSize;
uniform float u_frictionAir;
uniform float u_gravity;
uniform float u_bodyRadius;
uniform float u_dt;

#define NUM_PARTICLES ${MAX_PARTICLES}
#define PI 3.141592653589793

vec2 gradW_spiky(vec2 r, float dist, float h) {
  if (dist >= h || dist < 0.0001) return vec2(0.0);
  float coeff = 30.0 / (PI * pow(h, 5.0)) * (h - dist) * (h - dist) / dist;
  return coeff * r;
}

float lapW_viscosity(float dist, float h) {
  if (dist >= h) return 0.0;
  return 40.0 / (PI * pow(h, 5.0)) * (h - dist);
}

void main() {
  float idx = floor(gl_FragCoord.x);
  if (idx >= u_numParticles) discard;

  vec2 uv = vec2((idx + 0.5) / u_numParticles, 0.5);
  vec4 state = texture2D(u_state, uv);
  vec2 pos = state.rg;
  vec2 vel = state.ba;

  vec4 densData = texture2D(u_density, uv);
  float density_i = densData.r;
  float pressure_i = densData.g;

  vec2 f_pressure = vec2(0.0);
  vec2 f_viscosity = vec2(0.0);

  for (int i = 0; i < NUM_PARTICLES; i++) {
    if (float(i) == idx) continue;
    if (float(i) >= u_numParticles) continue;

    vec2 oUV = vec2((float(i) + 0.5) / u_numParticles, 0.5);
    vec4 other = texture2D(u_state, oUV);
    vec2 r = other.rg - pos;
    float dist = length(r);

    if (dist >= u_h) continue;
    if (dist < 0.0001) continue;

    vec4 oDensData = texture2D(u_density, oUV);
    float density_j = oDensData.r;
    float pressure_j = oDensData.g;

    vec2 gradW = gradW_spiky(r, dist, u_h);
    f_pressure -= u_mass * (pressure_i + pressure_j) / (2.0 * density_j) * gradW;

    float lapW = lapW_viscosity(dist, u_h);
    f_viscosity += u_viscosity * u_mass * (other.ba - vel) / density_j * lapW;
  }

  vec2 acceleration = (f_pressure + f_viscosity) / density_i;
  acceleration.y += u_gravity;

  vel += acceleration * u_dt;
  vel *= (1.0 - u_frictionAir);

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

export class GPUSimulation {
  gl: WebGL2RenderingContext;
  numParticles: number = NUM_PARTICLES;
  currentRead: number = 0;

  densityProgram: WebGLProgram;
  forceProgram: WebGLProgram;
  densityUniforms: Record<string, WebGLUniformLocation | null>;
  forceUniforms: Record<string, WebGLUniformLocation | null>;

  quadBuffer: WebGLBuffer;

  stateA: WebGLTexture;
  stateB: WebGLTexture;
  fbA: WebGLFramebuffer;
  fbB: WebGLFramebuffer;

  densityTex: WebGLTexture;
  densityFB: WebGLFramebuffer;

  canvasWidth: number;
  canvasHeight: number;

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

    const densityFS = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      buildDensityFragment(),
    )!;
    this.densityProgram = createProgram(gl, vs, densityFS)!;

    const forceFS = createShader(gl, gl.FRAGMENT_SHADER, buildForceFragment())!;
    this.forceProgram = createProgram(gl, vs, forceFS)!;

    this.densityUniforms = {};
    for (const name of [
      "u_state",
      "u_numParticles",
      "u_h",
      "u_mass",
      "u_restDensity",
      "u_stiffness",
    ]) {
      this.densityUniforms[name] = gl.getUniformLocation(
        this.densityProgram,
        name,
      );
    }

    this.forceUniforms = {};
    for (const name of [
      "u_state",
      "u_density",
      "u_numParticles",
      "u_h",
      "u_mass",
      "u_viscosity",
      "u_canvasSize",
      "u_frictionAir",
      "u_gravity",
      "u_bodyRadius",
      "u_dt",
    ]) {
      this.forceUniforms[name] = gl.getUniformLocation(this.forceProgram, name);
    }

    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const initData = new Float32Array(NUM_PARTICLES * 4);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      initData[i * 4] = Math.random() * canvasWidth;
      initData[i * 4 + 1] = Math.random() * canvasHeight;
      initData[i * 4 + 2] = 0;
      initData[i * 4 + 3] = 0;
    }

    this.stateA = createFloatTexture(gl, NUM_PARTICLES, initData);
    this.stateB = createFloatTexture(gl, NUM_PARTICLES);

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

    this.densityTex = createFloatTexture(gl, NUM_PARTICLES);
    this.densityFB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityFB);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.densityTex,
      0,
    );
    console.log("densityFB status:", gl.checkFramebufferStatus(gl.FRAMEBUFFER));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(_params: SimParams, _cursorX: number, _cursorY: number) {
    const gl = this.gl;
    const params = _params;
    let readFromA = this.currentRead === 0;

    for (let s = 0; s < params.substeps; s++) {
      const readTex = readFromA ? this.stateA : this.stateB;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityFB);
      gl.viewport(0, 0, this.numParticles, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.densityProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.densityUniforms["u_state"], 0);
      gl.uniform1f(this.densityUniforms["u_numParticles"], this.numParticles);
      gl.uniform1f(this.densityUniforms["u_h"], params.h);
      gl.uniform1f(this.densityUniforms["u_mass"], params.particleMass);
      gl.uniform1f(this.densityUniforms["u_restDensity"], params.restDensity);
      gl.uniform1f(this.densityUniforms["u_stiffness"], params.stiffness);

      const posLoc1 = gl.getAttribLocation(this.densityProgram, "a_position");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(posLoc1);
      gl.vertexAttribPointer(posLoc1, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      const writeFB = readFromA ? this.fbB : this.fbA;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB);
      gl.viewport(0, 0, this.numParticles, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.forceProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.forceUniforms["u_state"], 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.densityTex);
      gl.uniform1i(this.forceUniforms["u_density"], 1);

      gl.uniform1f(this.forceUniforms["u_numParticles"], this.numParticles);
      gl.uniform1f(this.forceUniforms["u_h"], params.h);
      gl.uniform1f(this.forceUniforms["u_mass"], params.particleMass);
      gl.uniform1f(this.forceUniforms["u_viscosity"], params.viscosity);
      gl.uniform2f(
        this.forceUniforms["u_canvasSize"],
        this.canvasWidth,
        this.canvasHeight,
      );
      gl.uniform1f(this.forceUniforms["u_frictionAir"], params.frictionAir);
      gl.uniform1f(this.forceUniforms["u_gravity"], params.gravity);
      gl.uniform1f(this.forceUniforms["u_bodyRadius"], params.bodyRadius);
      gl.uniform1f(this.forceUniforms["u_dt"], params.dt);

      const posLoc2 = gl.getAttribLocation(this.forceProgram, "a_position");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(posLoc2);
      gl.vertexAttribPointer(posLoc2, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      readFromA = !readFromA;
    }

    this.currentRead = readFromA ? 0 : 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    const initData = new Float32Array(NUM_PARTICLES * 4);
    for (let i = 0; i < NUM_PARTICLES; i++) {
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
      NUM_PARTICLES,
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
      NUM_PARTICLES,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    );
  }
}
