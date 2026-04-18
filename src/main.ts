import { GPUSimulation, SimParams } from "./simulation";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2")!;
if (!gl) throw new Error("WebGL2 not supported");
gl.getExtension("EXT_color_buffer_float");

const timelineCanvas = document.getElementById("timeline") as HTMLCanvasElement;
const tCtx = timelineCanvas.getContext("2d")!;

const dpr = window.devicePixelRatio || 1;
const controls = document.getElementById("controls")!;
let canvasWidth = window.innerWidth;
let canvasHeight =
  window.innerHeight -
  controls.getBoundingClientRect().height -
  (timelineCanvas?.offsetHeight || 80);

canvas.width = canvasWidth * dpr;
canvas.height = canvasHeight * dpr;
canvas.style.width = canvasWidth + "px";
canvas.style.height = canvasHeight + "px";

const bodyRadius = 4;

let stickiness = 8;
let stiffness = 10;
let surfaceTension = 0;
let adhesive = 12;
let smoothingRadius = bodyRadius * 3.5;
let interactionRange = 4;
let maxForce = 0.05;
let overlapForceMax = 0.5;
let frictionAir = 0.003;
let gravity = 0.05;

function bindSlider(
  id: string,
  valId: string,
  setter: (v: number) => void,
  decimals: number = 0,
) {
  const slider = document.getElementById(id) as HTMLInputElement;
  const valSpan = document.getElementById(valId)!;

  const applyValue = () => {
    const v = parseFloat(slider.value);
    setter(v);
    valSpan.textContent = v.toFixed(decimals);
  };

  applyValue();

  slider.addEventListener("input", () => {
    applyValue();
  });
}

bindSlider("stickiness", "stickinessVal", (v) => (stickiness = v), 0);
bindSlider("stiffness", "stiffnessVal", (v) => (stiffness = v), 0);
bindSlider(
  "surfaceTension",
  "surfaceTensionVal",
  (v) => (surfaceTension = v),
  0,
);
bindSlider("adhesive", "adhesiveVal", (v) => (adhesive = v), 0);
bindSlider(
  "interactionRange",
  "interactionRangeVal",
  (v) => (interactionRange = v),
  1,
);
bindSlider("maxForce", "maxForceVal", (v) => (maxForce = v), 3);
bindSlider(
  "overlapForceMax",
  "overlapForceMaxVal",
  (v) => (overlapForceMax = v),
  2,
);
bindSlider("frictionAir", "frictionAirVal", (v) => (frictionAir = v), 3);
bindSlider("gravity", "gravityVal", (v) => (gravity = v), 3);

const params: SimParams = {
  stickiness: stickiness,
  stiffness: stiffness,
  surfaceTension: surfaceTension,
  adhesive: adhesive,
  smoothingRadius: smoothingRadius,
  interactionRange: interactionRange,
  bodyRadius: bodyRadius,
  maxForce: maxForce,
  overlapForceMax: overlapForceMax,
  frictionAir: frictionAir,
  gravity: gravity,
  targetNeighbors: 6,
  substeps: 3,
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
  vec2 uv = vec2((idx + 0.5) / (u_numParticles * 2.0), 0.5);
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
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
const pointProgram = gl.createProgram()!;
gl.attachShader(pointProgram, mkShader(gl.VERTEX_SHADER, pointVS)!);
gl.attachShader(pointProgram, mkShader(gl.FRAGMENT_SHADER, pointFS)!);
gl.linkProgram(pointProgram);
const pointUniforms = {
  u_state: gl.getUniformLocation(pointProgram, "u_state"),
  u_numParticles: gl.getUniformLocation(pointProgram, "u_numParticles"),
  u_pointSize: gl.getUniformLocation(pointProgram, "u_pointSize"),
  u_resolution: gl.getUniformLocation(pointProgram, "u_resolution"),
};
const pointVAO = gl.createVertexArray()!;

const FORCE_HISTORY_LEN = 200;
const forceHistory: {
  total: number;
  attraction: number;
  repulsion: number;
  surfaceTension: number;
  meanNearest: number;
  minNearest: number;
}[] = [];

function resizeTimeline() {
  timelineCanvas.width = timelineCanvas.clientWidth * dpr;
  timelineCanvas.height = timelineCanvas.clientHeight * dpr;
  tCtx.scale(dpr, dpr);
}
resizeTimeline();

function drawTimeline() {
  const w = timelineCanvas.clientWidth;
  const h = timelineCanvas.clientHeight;
  const forcePanelH = Math.floor(h * 0.6);
  const spacingPanelY = forcePanelH + 1;
  const spacingPanelH = h - spacingPanelY;

  tCtx.clearRect(0, 0, w, h);
  tCtx.fillStyle = "#111";
  tCtx.fillRect(0, 0, w, h);
  tCtx.strokeStyle = "#333";
  tCtx.beginPath();
  tCtx.moveTo(0, forcePanelH + 0.5);
  tCtx.lineTo(w, forcePanelH + 0.5);
  tCtx.stroke();

  if (forceHistory.length < 2) return;

  let maxVal = 0.001;
  let maxSpacing = 0.001;
  const targetSpacing = bodyRadius * 2;
  for (const f of forceHistory) {
    maxVal = Math.max(
      maxVal,
      f.total,
      f.attraction,
      f.repulsion,
      f.surfaceTension,
    );
    maxSpacing = Math.max(maxSpacing, f.meanNearest, f.minNearest);
  }
  maxSpacing = Math.max(maxSpacing, targetSpacing);

  const lines: { key: keyof (typeof forceHistory)[0]; color: string }[] = [
    { key: "total", color: "#ffffff" },
    { key: "attraction", color: "#44ff44" },
    { key: "repulsion", color: "#ff4444" },
    { key: "surfaceTension", color: "#44ddff" },
  ];

  for (const line of lines) {
    tCtx.beginPath();
    tCtx.strokeStyle = line.color;
    tCtx.lineWidth = 1.5;
    for (let i = 0; i < forceHistory.length; i++) {
      const x = (i / FORCE_HISTORY_LEN) * w;
      const y =
        forcePanelH -
        (forceHistory[i][line.key] / maxVal) * (forcePanelH - 4) -
        2;
      if (i === 0) tCtx.moveTo(x, y);
      else tCtx.lineTo(x, y);
    }
    tCtx.stroke();
  }

  tCtx.fillStyle = "#888";
  tCtx.font = "10px monospace";
  tCtx.fillText(`${maxVal.toFixed(4)}`, 2, 10);
  tCtx.fillText("force", 2, forcePanelH - 4);

  const spacingLines: { key: "meanNearest" | "minNearest"; color: string }[] = [
    { key: "meanNearest", color: "#ffd166" },
    { key: "minNearest", color: "#ff8c42" },
  ];
  for (const line of spacingLines) {
    tCtx.beginPath();
    tCtx.strokeStyle = line.color;
    tCtx.lineWidth = 1.5;
    for (let i = 0; i < forceHistory.length; i++) {
      const x = (i / FORCE_HISTORY_LEN) * w;
      const y =
        spacingPanelY +
        spacingPanelH -
        (forceHistory[i][line.key] / maxSpacing) * (spacingPanelH - 4) -
        2;
      if (i === 0) tCtx.moveTo(x, y);
      else tCtx.lineTo(x, y);
    }
    tCtx.stroke();
  }
  const targetY =
    spacingPanelY +
    spacingPanelH -
    (targetSpacing / maxSpacing) * (spacingPanelH - 4) -
    2;
  tCtx.beginPath();
  tCtx.strokeStyle = "#7c83fd";
  tCtx.lineWidth = 1;
  tCtx.setLineDash([4, 3]);
  tCtx.moveTo(0, targetY);
  tCtx.lineTo(w, targetY);
  tCtx.stroke();
  tCtx.setLineDash([]);
  tCtx.fillStyle = "#888";
  tCtx.fillText(`${maxSpacing.toFixed(2)} px`, 2, spacingPanelY + 10);
  tCtx.fillText(`2r ${targetSpacing.toFixed(1)} px`, 56, spacingPanelY + 10);
  tCtx.fillText("spacing", 2, h - 4);

  const legend: { label: string; color: string }[] = [
    { label: "total", color: "#ffffff" },
    { label: "attract", color: "#44ff44" },
    { label: "repulsion", color: "#ff4444" },
    { label: "surfTen", color: "#44ddff" },
    { label: "meanNN", color: "#ffd166" },
    { label: "minNN", color: "#ff8c42" },
    { label: "2r", color: "#7c83fd" },
  ];
  let lx = w - 4;
  tCtx.font = "10px monospace";
  for (let li = legend.length - 1; li >= 0; li--) {
    const entry = legend[li];
    const tw = tCtx.measureText(entry.label).width;
    lx -= tw + 2;
    tCtx.fillStyle = entry.color;
    tCtx.fillText(entry.label, lx, 10);
    lx -= 10;
    tCtx.fillStyle = entry.color;
    tCtx.fillRect(lx, 4, 8, 3);
    lx -= 12;
  }
}

let frameCount = 0;

function render() {
  params.stickiness = stickiness;
  params.stiffness = stiffness;
  params.surfaceTension = surfaceTension;
  params.adhesive = adhesive;
  params.smoothingRadius = smoothingRadius;
  params.interactionRange = interactionRange;
  params.maxForce = maxForce;
  params.overlapForceMax = overlapForceMax;
  params.frictionAir = frictionAir;
  params.gravity = gravity;

  sim.step(params);

  if (frameCount % 5 === 0) {
    const forces = sim.readForceAverages();
    const spacing = sim.readSpacingStats();
    const speed = sim.readVelocityStats();
    forceHistory.push({ ...forces, ...spacing });
    if (forceHistory.length > FORCE_HISTORY_LEN) forceHistory.shift();
    drawTimeline();

    if (frameCount % 60 === 0) {
      console.log(
        [
          `params: stickiness=${stickiness.toFixed(2)} stiffness=${stiffness.toFixed(2)} range=${interactionRange.toFixed(2)} maxForce=${maxForce.toFixed(3)} overlapCap=${overlapForceMax.toFixed(2)} surfTen=${surfaceTension.toFixed(2)} frictionAir=${frictionAir.toFixed(3)} gravity=${gravity.toFixed(3)}`,
          `forces: total=${forces.total.toFixed(4)} attraction=${forces.attraction.toFixed(4)} repulsion=${forces.repulsion.toFixed(4)} surfaceTension=${forces.surfaceTension.toFixed(4)}`,
          `spacing: meanNN=${spacing.meanNearest.toFixed(3)} minNN=${spacing.minNearest.toFixed(3)}`,
          `speed: mean=${speed.meanSpeed.toFixed(4)} max=${speed.maxSpeed.toFixed(4)}`,
        ].join("\n"),
      );
    }
  }
  frameCount++;

  const stateTex = sim.getCurrentStateTexture();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.93, 0.93, 0.93, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(pointProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stateTex);
  gl.uniform1i(pointUniforms["u_state"], 0);
  gl.uniform1f(pointUniforms["u_numParticles"], sim.numParticles);
  gl.uniform2f(pointUniforms["u_resolution"], canvasWidth, canvasHeight);
  gl.uniform1f(pointUniforms["u_pointSize"], 4.0 * dpr);

  gl.bindVertexArray(pointVAO);
  gl.drawArrays(gl.POINTS, 0, sim.numParticles);

  requestAnimationFrame(render);
}

render();

window.addEventListener("resize", () => {
  canvasWidth = window.innerWidth;
  canvasHeight =
    window.innerHeight -
    controls.getBoundingClientRect().height -
    (timelineCanvas?.offsetHeight || 80);
  canvas.width = canvasWidth * dpr;
  canvas.height = canvasHeight * dpr;
  canvas.style.width = canvasWidth + "px";
  canvas.style.height = canvasHeight + "px";
  sim.resize(canvasWidth, canvasHeight);
  resizeTimeline();
});
