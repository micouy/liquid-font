export interface SimParams {
  cohesion: number;
  repulsion: number;
  smoothingRadius: number;
  repulsionDistance: number;
  bodyRadius: number;
  frictionAir: number;
  gravity: number;
  surfaceTension: number;
  substeps: number;
  cohesionCoeff: number;
  repulsionCoeff: number;
}

const MAX_PARTICLES = 3000;
const MAX_GLYPHS = 8192;
const NUM_PARTICLES = 3000;

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
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

function createProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
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

function createFloatTexture(gl: WebGL2RenderingContext, width: number, data?: Float32Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (data) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, null);
  }
  return tex;
}

export class GPUSimulation {
  gl: WebGL2RenderingContext;
  numParticles: number;
  numGlyphs: number = 0;
  currentRead: number = 0;

  simProgram: WebGLProgram;
  simQuadBuffer: WebGLBuffer;

  fbA: WebGLFramebuffer;
  fbB: WebGLFramebuffer;
  stateA: WebGLTexture;
  stateB: WebGLTexture;

  glyphTexture: WebGLTexture;
  glyphData: Float32Array;

  simUniforms: Record<string, WebGLUniformLocation | null>;

  canvasWidth: number;
  canvasHeight: number;

  constructor(gl: WebGL2RenderingContext, canvasWidth: number, canvasHeight: number) {
    this.gl = gl;
    this.numParticles = NUM_PARTICLES;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) console.warn('EXT_color_buffer_float not supported');

    const vsSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0, 1);
      }
    `;

    const fsSource = this.buildSimFragment();

    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource)!;
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource)!;
    this.simProgram = createProgram(gl, vs, fs)!;

    this.simUniforms = {};
    const uniformNames = [
      'u_state', 'u_canvasSize', 'u_numParticles',
      'u_frictionAir', 'u_gravity', 'u_bodyRadius',
      'u_smoothingRadius', 'u_surfaceTension', 'u_targetNeighbors',
      'u_cohesion', 'u_repulsion', 'u_repulsionDistance',
      'u_cohesionCoeff', 'u_repulsionCoeff'
];
    for (const name of uniformNames) {
      this.simUniforms[name] = gl.getUniformLocation(this.simProgram, name);
    }

    this.simQuadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.simQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    const initData = new Float32Array(this.numParticles * 2 * 4);
    for (let i = 0; i < this.numParticles; i++) {
      initData[i * 4] = Math.random() * canvasWidth;
      initData[i * 4 + 1] = Math.random() * canvasHeight;
      initData[i * 4 + 2] = 0;
      initData[i * 4 + 3] = 0;
    }

    this.stateA = createFloatTexture(gl, this.numParticles * 2, initData);
    this.stateB = createFloatTexture(gl, this.numParticles * 2, initData.slice());

    this.fbA = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.stateA, 0);
    console.log('fbA status:', gl.checkFramebufferStatus(gl.FRAMEBUFFER));

    this.fbB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.stateB, 0);
    console.log('fbB status:', gl.checkFramebufferStatus(gl.FRAMEBUFFER));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.glyphData = new Float32Array(MAX_GLYPHS * 4);
    this.glyphTexture = createFloatTexture(gl, MAX_GLYPHS, this.glyphData);
  }

buildSimFragment(): string {
    return `
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_canvasSize;
uniform float u_numParticles;
uniform float u_frictionAir;
uniform float u_gravity;
uniform float u_bodyRadius;
uniform float u_smoothingRadius;
uniform float u_surfaceTension;
uniform float u_targetNeighbors;
uniform float u_cohesion;
uniform float u_repulsion;
uniform float u_repulsionDistance;
uniform float u_cohesionCoeff;
uniform float u_repulsionCoeff;

#define NUM_PARTICLES ${MAX_PARTICLES}

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
  float px = state.r;
  float py = state.g;
  float vx = state.b;
  float vy = state.a;

  float fx = 0.0;
  float fy = u_gravity * 0.1;

  float smoothR = u_smoothingRadius;
  float smoothR2 = smoothR * smoothR;
  float repDist = u_repulsionDistance;
  int neighborCount = 0;
  float normX = 0.0;
  float normY = 0.0;

  float cohesionMag = 0.0;
  float repulsionMag = 0.0;
  float surfaceTensionMag = 0.0;

  for (int i = 0; i < NUM_PARTICLES; i++) {
    if (float(i) >= u_numParticles) continue;
    if (float(i) == idx) continue;

    vec2 oUV = vec2((float(i) + 0.5) / (u_numParticles * 2.0), 0.5);
    vec4 other = texture2D(u_state, oUV);
    float dx = other.r - px;
    float dy = other.g - py;
    float distSq = dx * dx + dy * dy;

    if (distSq > smoothR2 || distSq < 0.01) continue;

    neighborCount++;
    float invDist = 1.0 / sqrt(distSq);
    normX -= dx * invDist;
    normY -= dy * invDist;

    float dist = 1.0 / invDist;
    float nx = dx * invDist;
    float ny = dy * invDist;

    if (dist < repDist) {
      float rep = u_repulsion * u_repulsionCoeff / (dist * dist);
      repulsionMag += rep;
      fx -= nx * rep;
      fy -= ny * rep;
    } else {
      float coh = u_cohesion * u_cohesionCoeff / dist;
      cohesionMag += coh;
      fx += nx * coh;
      fy += ny * coh;
    }
  }

  float deficit = max(0.0, u_targetNeighbors - float(neighborCount));
  float normalLen = length(vec2(normX, normY));
  if (deficit > 0.0 && normalLen > 0.001) {
    float force = u_surfaceTension * 0.0 * deficit;
    surfaceTensionMag = force;
    fx -= (normX / normalLen) * force;
    fy -= (normY / normalLen) * force;
  }

  if (isForce) {
    float totalForce = sqrt(fx * fx + fy * fy);
    gl_FragColor = vec4(totalForce, cohesionMag, repulsionMag, surfaceTensionMag);
    return;
  }

  vx += fx;
  vy += fy;
  vx *= (1.0 - u_frictionAir);
  vy *= (1.0 - u_frictionAir);

  float newX = px + vx;
  float newY = py + vy;

  float br = u_bodyRadius;
  if (newX < br) { newX = br; vx *= -0.3; }
  if (newX > u_canvasSize.x - br) { newX = u_canvasSize.x - br; vx *= -0.3; }
  if (newY < br) { newY = br; vy *= -0.3; }
  if (newY > u_canvasSize.y - br) { newY = u_canvasSize.y - br; vy *= -0.3; }

  gl_FragColor = vec4(newX, newY, vx, vy);
}
`;
  }

  step(params: SimParams, cursorX: number, cursorY: number) {
    const gl = this.gl;
    let readFromA = this.currentRead === 0;

    for (let s = 0; s < params.substeps; s++) {
      const readTex = readFromA ? this.stateA : this.stateB;
      const writeFB = readFromA ? this.fbB : this.fbA;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB);
gl.viewport(0, 0, this.numParticles * 2, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.simProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.simUniforms['u_state'], 0);

      gl.uniform2f(this.simUniforms['u_canvasSize'], this.canvasWidth, this.canvasHeight);
      gl.uniform1f(this.simUniforms['u_numParticles'], this.numParticles);
      gl.uniform1f(this.simUniforms['u_frictionAir'], params.frictionAir);
      gl.uniform1f(this.simUniforms['u_gravity'], params.gravity);
      gl.uniform1f(this.simUniforms['u_bodyRadius'], params.bodyRadius);
      gl.uniform1f(this.simUniforms['u_smoothingRadius'], params.smoothingRadius);
      gl.uniform1f(this.simUniforms['u_surfaceTension'], params.surfaceTension);
      gl.uniform1f(this.simUniforms['u_targetNeighbors'], 20.0);
      gl.uniform1f(this.simUniforms['u_cohesion'], params.cohesion);
      gl.uniform1f(this.simUniforms['u_repulsion'], params.repulsion);
      gl.uniform1f(this.simUniforms['u_repulsionDistance'], params.repulsionDistance);
      gl.uniform1f(this.simUniforms['u_cohesionCoeff'], params.cohesionCoeff);
      gl.uniform1f(this.simUniforms['u_repulsionCoeff'], params.repulsionCoeff);

      const posLoc = gl.getAttribLocation(this.simProgram, 'a_position');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.simQuadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
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
    const initData = new Float32Array(this.numParticles * 2 * 4);
    for (let i = 0; i < this.numParticles; i++) {
      initData[i * 4] = Math.random() * canvasWidth;
      initData[i * 4 + 1] = Math.random() * canvasHeight;
      initData[i * 4 + 2] = 0;
      initData[i * 4 + 3] = 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.stateA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.numParticles * 2, 1, 0, gl.RGBA, gl.FLOAT, initData);
    gl.bindTexture(gl.TEXTURE_2D, this.stateB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.numParticles * 2, 1, 0, gl.RGBA, gl.FLOAT, null);
  }
}