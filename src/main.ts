import { GPUSimulation, SimParams } from './simulation';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2')!;
if (!gl) throw new Error('WebGL2 not supported');
gl.getExtension('EXT_color_buffer_float');

const dpr = window.devicePixelRatio || 1;
const controls = document.getElementById('controls')!;
let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight - controls.getBoundingClientRect().height;

canvas.width = canvasWidth * dpr;
canvas.height = canvasHeight * dpr;
canvas.style.width = canvasWidth + 'px';
canvas.style.height = canvasHeight + 'px';

let h = 25;
let restDensity = 1;
let stiffness = 500;
let viscosity = 50;
let surfaceTension = 8;
let particleMass = 175;
let gravity = 0.5;
let dt = 0.5;

function bindSlider(id: string, valId: string, setter: (v: number) => void, decimals: number = 0) {
  const slider = document.getElementById(id) as HTMLInputElement;
  const valSpan = document.getElementById(valId)!;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    setter(v);
    valSpan.textContent = v.toFixed(decimals);
  });
}

bindSlider('h', 'hVal', v => h = v, 0);
bindSlider('restDensity', 'restDensityVal', v => restDensity = v, 2);
bindSlider('stiffness', 'stiffnessVal', v => stiffness = v, 0);
bindSlider('viscosity', 'viscosityVal', v => viscosity = v, 1);
bindSlider('surfaceTension', 'surfaceTensionVal', v => surfaceTension = v, 1);
bindSlider('particleMass', 'particleMassVal', v => particleMass = v, 1);
bindSlider('gravity', 'gravityVal', v => gravity = v, 2);
bindSlider('dt', 'dtVal', v => dt = v, 3);

const params: SimParams = {
  h: h,
  restDensity: restDensity,
  stiffness: stiffness,
  viscosity: viscosity,
  surfaceTension: surfaceTension,
  particleMass: particleMass,
  bodyRadius: 4,
  frictionAir: 0.01,
  gravity: gravity,
  substeps: 4,
  dt: dt,
};

const sim = new GPUSimulation(gl, canvasWidth, canvasHeight);

const pointVS = `#version 300 es
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
  gl_Position = vec4((pos.x / u_resolution.x) * 2.0 - 1.0,
                      (pos.y / u_resolution.y) * -2.0 + 1.0, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}
`;
const pointFS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  if (dot(coord, coord) > 0.25) discard;
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

function mkShader(type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
  return s;
}
const pointProgram = gl.createProgram()!;
gl.attachShader(pointProgram, mkShader(gl.VERTEX_SHADER, pointVS)!);
gl.attachShader(pointProgram, mkShader(gl.FRAGMENT_SHADER, pointFS)!);
gl.linkProgram(pointProgram);
const pointUniforms = {
  u_state: gl.getUniformLocation(pointProgram, 'u_state'),
  u_numParticles: gl.getUniformLocation(pointProgram, 'u_numParticles'),
  u_pointSize: gl.getUniformLocation(pointProgram, 'u_pointSize'),
  u_resolution: gl.getUniformLocation(pointProgram, 'u_resolution'),
};
const pointVAO = gl.createVertexArray()!;

function render() {
  params.h = h;
  params.restDensity = restDensity;
  params.stiffness = stiffness;
  params.viscosity = viscosity;
  params.surfaceTension = surfaceTension;
  params.particleMass = particleMass;
  params.gravity = gravity;
  params.dt = dt;

  sim.step(params, 0, 0);

  const stateTex = sim.getCurrentStateTexture();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.93, 0.93, 0.93, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(pointProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stateTex);
  gl.uniform1i(pointUniforms['u_state'], 0);
  gl.uniform1f(pointUniforms['u_numParticles'], sim.numParticles);
  gl.uniform2f(pointUniforms['u_resolution'], canvasWidth, canvasHeight);
  gl.uniform1f(pointUniforms['u_pointSize'], 4.0 * dpr);

  gl.bindVertexArray(pointVAO);
  gl.drawArrays(gl.POINTS, 0, sim.numParticles);

  requestAnimationFrame(render);
}

render();

window.addEventListener('resize', () => {
  canvasWidth = window.innerWidth;
  canvasHeight = window.innerHeight - controls.getBoundingClientRect().height;
  canvas.width = canvasWidth * dpr;
  canvas.height = canvasHeight * dpr;
  canvas.style.width = canvasWidth + 'px';
  canvas.style.height = canvasHeight + 'px';
  sim.resize(canvasWidth, canvasHeight);
});