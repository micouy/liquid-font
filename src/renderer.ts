import { GPUSimulation, SimParams } from './simulation';

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
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

function createProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
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

const CIRCLE_VS = `#version 300 es
precision highp float;
uniform sampler2D u_state;
uniform float u_numParticles;
uniform float u_pointSize;
uniform vec2 u_resolution;
void main() {
  float idx = float(gl_VertexID);
  vec2 uv = vec2((idx + 0.5) / u_numParticles, 0.5);
  vec4 state = texture(u_state, uv);
  vec2 pos = state.rg;
  vec2 ndc = vec2((pos.x / u_resolution.x) * 2.0 - 1.0,
                    (pos.y / u_resolution.y) * -2.0 + 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}
`;

const CIRCLE_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export class Renderer {
  gl: WebGL2RenderingContext;
  canvasWidth: number;
  canvasHeight: number;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;

  constructor(gl: WebGL2RenderingContext, canvasWidth: number, canvasHeight: number) {
    this.gl = gl;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.program = createProgram(gl,
      createShader(gl, gl.VERTEX_SHADER, CIRCLE_VS)!,
      createShader(gl, gl.FRAGMENT_SHADER, CIRCLE_FS)!
    )!;

    this.uniforms = {};
    for (const name of ['u_state', 'u_numParticles', 'u_pointSize', 'u_resolution']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
  }

  render(sim: GPUSimulation, params: SimParams) {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasWidth * dpr, this.canvasHeight * dpr);
    gl.clearColor(0.93, 0.93, 0.93, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    const stateTex = sim.getCurrentStateTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.uniform1i(this.uniforms['u_state'], 0);
    gl.uniform1f(this.uniforms['u_numParticles'], sim.numParticles);
    gl.uniform1f(this.uniforms['u_pointSize'], 8.0);
    gl.uniform2f(this.uniforms['u_resolution'], this.canvasWidth, this.canvasHeight);

    gl.drawArrays(gl.POINTS, 0, sim.numParticles);
  }

  resize(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }
}