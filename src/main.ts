import { getUniformPoints, loadSvgGlyph } from "./glyphs";
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

let stickiness = 0;
let stiffness = 20;
let surfaceTension = 20;
let liquidNormalWeight = 1;
let glyphNormalWeight = 2;
let adhesive = 12;
let glyphRepulsion = 2;
let smoothingRadius = bodyRadius * 3.5;
let interactionRange = 2.5;
let maxForce = 0.05;
let overlapForceMax = 1;
let frictionAir = 0.005;
let gravity = 0.2;
let cursorForce = 0.75;
const cursorRadius = 10;

let pointerDown = false;
let pointerTargetX = canvasWidth * 0.5;
let pointerTargetY = canvasHeight * 0.5;
let pointerX = pointerTargetX;
let pointerY = pointerTargetY;
let prevPointerX = pointerX;
let prevPointerY = pointerY;
let pointerVelX = 0;
let pointerVelY = 0;
let pointerActive = 0;

function updatePointerFromEvent(event: PointerEvent | MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  pointerTargetX = ((event.clientX - rect.left) / rect.width) * canvasWidth;
  pointerTargetY = ((event.clientY - rect.top) / rect.height) * canvasHeight;
}

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  updatePointerFromEvent(event);
});

window.addEventListener("pointermove", (event) => {
  updatePointerFromEvent(event);
});

window.addEventListener("pointerup", () => {
  pointerDown = false;
});

window.addEventListener("pointercancel", () => {
  pointerDown = false;
});

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
bindSlider(
  "liquidNormalWeight",
  "liquidNormalWeightVal",
  (v) => (liquidNormalWeight = v),
  1,
);
bindSlider(
  "glyphNormalWeight",
  "glyphNormalWeightVal",
  (v) => (glyphNormalWeight = v),
  1,
);
bindSlider("adhesive", "adhesiveVal", (v) => (adhesive = v), 0);
bindSlider(
  "glyphRepulsion",
  "glyphRepulsionVal",
  (v) => (glyphRepulsion = v),
  1,
);
bindSlider("cursorForce", "cursorForceVal", (v) => (cursorForce = v), 2);
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
  liquidNormalWeight: liquidNormalWeight,
  glyphNormalWeight: glyphNormalWeight,
  adhesive: adhesive,
  glyphRepulsion: glyphRepulsion,
  smoothingRadius: smoothingRadius,
  interactionRange: interactionRange,
  bodyRadius: bodyRadius,
  maxForce: maxForce,
  overlapForceMax: overlapForceMax,
  frictionAir: frictionAir,
  gravity: gravity,
  cursorX: pointerX,
  cursorY: pointerY,
  cursorVelX: pointerVelX,
  cursorVelY: pointerVelY,
  cursorActive: pointerActive,
  cursorForce: cursorForce,
  cursorRadius: cursorRadius,
  targetNeighbors: 6,
  substeps: 3,
};

const sim = new GPUSimulation(gl, canvasWidth, canvasHeight);

const glyphWord = "SILLY";
const glyphHeightPx = 200;
const glyphPointSpacingPx = 1.0;
const glyphLetterGapPx = 14;

type LoadedGlyph = Awaited<ReturnType<typeof loadSvgGlyph>>;

let loadedWordGlyphs: LoadedGlyph[] | null = null;
let currentGlyphPoints: { x: number; y: number }[] = [];
let currentGlyphPointData = new Float32Array();
let currentGlyphPointCount = 0;

function createGlyphPointTexture(data?: Float32Array, width: number = 1) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    width,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    data ?? new Float32Array(width * 4),
  );
  return tex;
}

const glyphPointTexture = createGlyphPointTexture();

async function ensureWordGlyphs() {
  if (loadedWordGlyphs) return loadedWordGlyphs;
  loadedWordGlyphs = await Promise.all(
    glyphWord.split("").map((char) => loadSvgGlyph(char)),
  );
  return loadedWordGlyphs;
}

async function updateWordGlyphs() {
  const glyphs = await ensureWordGlyphs();
  const layouts = glyphs
    .map((glyph) => {
      if (!glyph || glyph.height <= 0) return null;
      const scale = glyphHeightPx / glyph.height;
      return {
        glyph,
        scale,
        width: glyph.width * scale,
        height: glyph.height * scale,
      };
    })
    .filter((layout): layout is NonNullable<typeof layout> => layout !== null);

  const totalWidth = layouts.reduce(
    (sum, layout, index) =>
      sum + layout.width + (index < layouts.length - 1 ? glyphLetterGapPx : 0),
    0,
  );
  let cursorX = (canvasWidth - totalWidth) * 0.5;
  const baselineY = canvasHeight * 0.5;
  const points: { x: number; y: number }[] = [];

  for (const layout of layouts) {
    const sourcePoints = getUniformPoints(
      layout.glyph.subPaths,
      glyphPointSpacingPx / layout.scale,
    );
    for (const point of sourcePoints) {
      points.push({
        x: cursorX + layout.width * 0.5 + point.x * layout.scale,
        y: baselineY + point.y * layout.scale,
      });
    }
    cursorX += layout.width + glyphLetterGapPx;
  }

  currentGlyphPoints = points;
  currentGlyphPointCount = points.length;
  currentGlyphPointData = new Float32Array(Math.max(points.length, 1) * 4);
  for (let i = 0; i < points.length; i++) {
    currentGlyphPointData[i * 4] = points[i].x;
    currentGlyphPointData[i * 4 + 1] = points[i].y;
  }
  gl.bindTexture(gl.TEXTURE_2D, glyphPointTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    Math.max(points.length, 1),
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    currentGlyphPointData,
  );
  console.log(`Loaded ${points.length} glyph points for ${glyphWord}`);
  sim.updateGlyphs(points);
}

void updateWordGlyphs();

const pointVS = `#version 300 es
precision highp float;
uniform sampler2D u_state;
uniform float u_numParticles;
uniform float u_pointSize;
uniform vec2 u_resolution;
out vec3 v_color;
void main() {
  float idx = float(gl_VertexID);
  vec2 uv = vec2((idx + 0.5) / (u_numParticles * 2.0), 0.5);
  vec4 state = texture(u_state, uv);
  vec2 forceUV = vec2((idx + u_numParticles + 0.5) / (u_numParticles * 2.0), 0.5);
  vec4 force = texture(u_state, forceUV);
  vec2 pos = state.rg;
  float totalForce = force.r;
  float attractionForce = force.g;
  float repulsionForce = force.b;
  float surfaceForce = force.a;
  float intensity = clamp(totalForce * 8.0, 0.25, 1.0);
  if (repulsionForce >= attractionForce && repulsionForce >= surfaceForce) {
    v_color = vec3(1.0, 0.2, 0.2) * intensity;
  } else if (surfaceForce >= attractionForce) {
    v_color = vec3(0.2, 0.7, 1.0) * intensity;
  } else {
    v_color = vec3(0.2, 1.0, 0.35) * intensity;
  }
  gl_Position = vec4((pos.x / u_resolution.x) * 2.0 - 1.0,
                      (pos.y / u_resolution.y) * -2.0 + 1.0, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}
`;
const pointFS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 fragColor;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  if (dot(coord, coord) > 0.25) discard;
  fragColor = vec4(v_color, 1.0);
}
`;

const glyphPointVS = `#version 300 es
precision highp float;
uniform sampler2D u_glyphPoints;
uniform float u_numGlyphPoints;
uniform vec2 u_resolution;
uniform float u_pointSize;
void main() {
  float idx = float(gl_VertexID);
  vec2 uv = vec2((idx + 0.5) / u_numGlyphPoints, 0.5);
  vec4 glyph = texture(u_glyphPoints, uv);
  vec2 a_position = glyph.rg;
  gl_Position = vec4(
    (a_position.x / u_resolution.x) * 2.0 - 1.0,
    (a_position.y / u_resolution.y) * -2.0 + 1.0,
    0.0,
    1.0
  );
  gl_PointSize = u_pointSize;
}
`;

const glyphPointFS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  if (dot(coord, coord) > 0.25) discard;
  fragColor = vec4(1.0, 0.0, 0.65, 1.0);
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

const glyphPointProgram = gl.createProgram()!;
gl.attachShader(glyphPointProgram, mkShader(gl.VERTEX_SHADER, glyphPointVS)!);
gl.attachShader(glyphPointProgram, mkShader(gl.FRAGMENT_SHADER, glyphPointFS)!);
gl.linkProgram(glyphPointProgram);
const glyphPointUniforms = {
  u_glyphPoints: gl.getUniformLocation(glyphPointProgram, "u_glyphPoints"),
  u_numGlyphPoints: gl.getUniformLocation(
    glyphPointProgram,
    "u_numGlyphPoints",
  ),
  u_resolution: gl.getUniformLocation(glyphPointProgram, "u_resolution"),
  u_pointSize: gl.getUniformLocation(glyphPointProgram, "u_pointSize"),
};
const glyphPointVAO = gl.createVertexArray()!;

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
  prevPointerX = pointerX;
  prevPointerY = pointerY;
  pointerX += (pointerTargetX - pointerX) * 0.22;
  pointerY += (pointerTargetY - pointerY) * 0.22;
  pointerVelX = pointerX - prevPointerX;
  pointerVelY = pointerY - prevPointerY;
  pointerActive += ((pointerDown ? 1 : 0) - pointerActive) * 0.18;

  params.stickiness = stickiness;
  params.stiffness = stiffness;
  params.surfaceTension = surfaceTension;
  params.liquidNormalWeight = liquidNormalWeight;
  params.glyphNormalWeight = glyphNormalWeight;
  params.adhesive = adhesive;
  params.glyphRepulsion = glyphRepulsion;
  params.smoothingRadius = smoothingRadius;
  params.interactionRange = interactionRange;
  params.maxForce = maxForce;
  params.overlapForceMax = overlapForceMax;
  params.frictionAir = frictionAir;
  params.gravity = gravity;
  params.cursorX = pointerX;
  params.cursorY = pointerY;
  params.cursorVelX = pointerVelX;
  params.cursorVelY = pointerVelY;
  params.cursorActive = pointerActive;
  params.cursorForce = cursorForce;

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

  if (currentGlyphPoints.length > 0) {
    gl.useProgram(glyphPointProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glyphPointTexture);
    gl.uniform1i(glyphPointUniforms["u_glyphPoints"], 1);
    gl.uniform1f(
      glyphPointUniforms["u_numGlyphPoints"],
      currentGlyphPointCount,
    );
    gl.uniform2f(glyphPointUniforms["u_resolution"], canvasWidth, canvasHeight);
    gl.uniform1f(glyphPointUniforms["u_pointSize"], 4.0 * dpr);
    gl.bindVertexArray(glyphPointVAO);
    gl.drawArrays(gl.POINTS, 0, currentGlyphPointCount);
  }

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
  pointerTargetX = Math.min(pointerTargetX, canvasWidth);
  pointerTargetY = Math.min(pointerTargetY, canvasHeight);
  pointerX = Math.min(pointerX, canvasWidth);
  pointerY = Math.min(pointerY, canvasHeight);
  sim.resize(canvasWidth, canvasHeight);
  updateWordGlyphs();
  resizeTimeline();
});
