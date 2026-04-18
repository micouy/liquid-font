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
  gravity: 1,
  bodyRadius: bodyRadius,
  smoothingRadius: 50,
  repulsionDistance: bodyRadius * 2.5,
};

const sim = new GPUSimulation(gl, canvasWidth, canvasHeight);

const mouse = { x: canvasWidth / 2, y: canvasHeight / 2 };
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

const positions = new Float32Array(sim.numParticles * 2 * 4);
const historyLength = 300;
const history: { avgCohesion: number; avgRepulsion: number; avgSurfaceTension: number; avgGravity: number }[] = [];

function drawGraph(label: string, color: string, key: 'avgCohesion' | 'avgRepulsion' | 'avgSurfaceTension' | 'avgGravity', gx: number, gy: number, gw: number, gh: number) {
  const maxVal = Math.max(...history.map(h => h[key]), 0.001);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = gx + i;
    const y = gy + gh - (history[i][key] / maxVal) * gh * 0.9 - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '12px monospace';
  const val = history[history.length - 1][key];
  ctx.fillText(`${label}: ${val.toFixed(6)}`, gx + 4, gy + gh + 14);
}

let frameCount = 0;

function render() {
  sim.step(params, mouse.x, mouse.y);

  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.currentRead === 0 ? sim.fbA : sim.fbB);
  gl.readPixels(0, 0, sim.numParticles * 2, 1, gl.RGBA, gl.FLOAT, positions);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Only update graph every 3 frames
  if (frameCount % 3 === 0) {
    let totalCohesion = 0, totalRepulsion = 0, totalSurfaceTension = 0;
    for (let i = 0; i < sim.numParticles; i++) {
      // forces are at offset numParticles*4 in the texture: pixel index = numParticles + i
      totalCohesion += positions[(sim.numParticles + i) * 4 + 1];
      totalRepulsion += positions[(sim.numParticles + i) * 4 + 2];
      totalSurfaceTension += positions[(sim.numParticles + i) * 4 + 3];
    }
    const n = sim.numParticles;
    history.push({
      avgCohesion: totalCohesion / n,
      avgRepulsion: totalRepulsion / n,
      avgSurfaceTension: totalSurfaceTension / n,
      avgGravity: params.gravity * 0.1,
    });
    if (history.length > historyLength) history.shift();
  }
  frameCount++;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = 'black';
  for (let i = 0; i < sim.numParticles; i++) {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (history.length > 1) {
    const gx = 10, gy = 10, gw = historyLength, gh = canvasHeight * 0.2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(gx, gy, gw, gh);
    drawGraph('cohesion', 'lime', 'avgCohesion', gx, gy, gw, gh * 0.25);
    drawGraph('repulsion', 'red', 'avgRepulsion', gx, gy + gh * 0.25, gw, gh * 0.25);
    drawGraph('surface tension', 'cyan', 'avgSurfaceTension', gx, gy + gh * 0.5, gw, gh * 0.25);
    drawGraph('gravity', 'yellow', 'avgGravity', gx, gy + gh * 0.75, gw, gh * 0.25);
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