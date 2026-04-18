import { META_VERTEX, META_FRAGMENT, THRESH_VERTEX, THRESH_FRAGMENT } from './shaders';
import { GPUSimulation, SimParams } from './simulation';

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

function createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource)!;
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource)!;
  const program = gl.createProgram()!;
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

export class Renderer {
  gl: WebGLRenderingContext;
  dpr: number;
  canvasWidth: number;
  canvasHeight: number;

  metaProgram: WebGLProgram;
  threshProgram: WebGLProgram;

  quadBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  corners: Float32Array;

  accumTexture: WebGLTexture;
  framebuffer: WebGLFramebuffer;

  metaAttribs: { corner: number; index: number };
  metaUniforms: Record<string, WebGLUniformLocation | null>;
  threshAttribs: { position: number };
  threshUniforms: Record<string, WebGLUniformLocation | null>;

  instExt: any;

  constructor(gl: WebGLRenderingContext, canvasWidth: number, canvasHeight: number) {
    this.gl = gl;
    this.dpr = window.devicePixelRatio || 1;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.instExt = gl.getExtension('ANGLE_instanced_arrays') as any;

    this.metaProgram = createProgram(gl, META_VERTEX, META_FRAGMENT)!;
    this.threshProgram = createProgram(gl, THRESH_VERTEX, THRESH_FRAGMENT)!;

    this.corners = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]);

    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.corners, gl.STATIC_DRAW);

    const indices = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) indices[i] = i;
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.metaAttribs = {
      corner: gl.getAttribLocation(this.metaProgram, 'a_corner'),
      index: gl.getAttribLocation(this.metaProgram, 'a_index'),
    };
    this.threshAttribs = {
      position: gl.getAttribLocation(this.threshProgram, 'a_position'),
    };

    this.metaUniforms = {};
    const metaUniformNames = [
      'u_state', 'u_numParticles', 'u_influence', 'u_resolution', 'u_dpr',
      'u_radius', 'u_power', 'u_color'
    ];
    for (const name of metaUniformNames) {
      this.metaUniforms[name] = gl.getUniformLocation(this.metaProgram, name);
    }

    this.threshUniforms = {};
    const threshUniformNames = ['u_accum', 'u_threshold', 'u_resolution'];
    for (const name of threshUniformNames) {
      this.threshUniforms[name] = gl.getUniformLocation(this.threshProgram, name);
    }

    this.framebuffer = gl.createFramebuffer()!;
    this.accumTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvasWidth * this.dpr, canvasHeight * this.dpr, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.accumTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(sim: GPUSimulation, params: SimParams) {
    const gl = this.gl;
    const w = this.canvasWidth * this.dpr;
    const h = this.canvasHeight * this.dpr;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.metaProgram);

    gl.activeTexture(gl.TEXTURE0);
    const stateTex = sim.getCurrentStateTexture();
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.uniform1i(this.metaUniforms['u_state'], 0);

    gl.uniform1f(this.metaUniforms['u_numParticles'], sim.numParticles);
    gl.uniform1f(this.metaUniforms['u_influence'], params.influence * this.dpr);
    gl.uniform2f(this.metaUniforms['u_resolution'], w, h);
    gl.uniform1f(this.metaUniforms['u_dpr'], this.dpr);
    gl.uniform1f(this.metaUniforms['u_radius'], params.radius * this.dpr);
    gl.uniform1f(this.metaUniforms['u_power'], params.power);
    gl.uniform3f(this.metaUniforms['u_color'], 0, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.metaAttribs.corner);
    gl.vertexAttribPointer(this.metaAttribs.corner, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.enableVertexAttribArray(this.metaAttribs.index);
    gl.vertexAttribPointer(this.metaAttribs.index, 1, gl.FLOAT, false, 0, 0);

    if (this.instExt) {
      this.instExt.vertexAttribDivisorANGLE(this.metaAttribs.corner, 0);
      this.instExt.vertexAttribDivisorANGLE(this.metaAttribs.index, 1);
    }

    gl.blendFunc(gl.ONE, gl.ONE);

    if (this.instExt) {
      this.instExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, sim.numParticles);
    } else {
      for (let i = 0; i < sim.numParticles; i++) {
        gl.uniform1f(this.metaUniforms['u_particleIndex'], i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.threshProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.threshAttribs.position);
    gl.vertexAttribPointer(this.threshAttribs.position, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.uniform1i(this.threshUniforms['u_accum'], 0);
    gl.uniform1f(this.threshUniforms['u_threshold'], params.threshold);
    gl.uniform2f(this.threshUniforms['u_resolution'], w, h);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  resize(canvasWidth: number, canvasHeight: number) {
    const gl = this.gl;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    gl.bindTexture(gl.TEXTURE_2D, this.accumTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvasWidth * this.dpr, canvasHeight * this.dpr, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
}