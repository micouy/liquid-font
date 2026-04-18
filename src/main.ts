import { GPUSimulation, SimParams } from './simulation';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl')!;
if (!gl) throw new Error('WebGL not supported');

const bodyRadius = 4;

const drawCanvas = document.createElement('canvas');
drawCanvas.style.position = 'fixed';
drawCanvas.style.top = '0';
drawCanvas.style.left = '0';
drawCanvas.style.pointerEvents = 'none';
drawCanvas.style.background = '#ddd';
document.body.appendChild(drawCanvas);
const ctx = drawCanvas.getContext('2d')!;

const dpr = window.devicePixelRatio || 1;
let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;
drawCanvas.width = canvasWidth * dpr;
drawCanvas.height = canvasHeight * dpr;
drawCanvas.style.width = canvasWidth + 'px';
drawCanvas.style.height = canvasHeight + 'px';
ctx.scale(dpr, dpr);

const params: SimParams = {
  cohesion: 13,
  repulsion: 10,
  adhesive: 67,
  cursorForce: 25,
  radius: 0.07,
  threshold: 0.1,
  power: 1,
  influence: 60,
  maxForce: 0.00024,
  frictionAir: 0.01,
  forceDistance: 2,
  surfaceTension: 144,
  substeps: 1,
  thickness: 7,
  gravity: 5,
  bodyRadius: bodyRadius,
  smoothingRadius: bodyRadius * 3.5,
  repulsionDistance: bodyRadius * 2.5,
};

const sim = new GPUSimulation(gl, canvasWidth, canvasHeight);

const mouse = { x: canvasWidth / 2, y: canvasHeight / 2 };
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

const positions = new Float32Array(sim.numParticles * 4);

function render() {
  sim.step(params, mouse.x, mouse.y);

  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.currentRead === 0 ? sim.fbA : sim.fbB);
  gl.readPixels(0, 0, sim.numParticles, 1, gl.RGBA, gl.FLOAT, positions);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = 'black';
  for (let i = 0; i < sim.numParticles; i++) {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(render);
}

render();

window.addEventListener('resize', () => {
  canvasWidth = window.innerWidth;
  canvasHeight = window.innerHeight;
  drawCanvas.width = canvasWidth * dpr;
  drawCanvas.height = canvasHeight * dpr;
  drawCanvas.style.width = canvasWidth + 'px';
  drawCanvas.style.height = canvasHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sim.resize(canvasWidth, canvasHeight);
});