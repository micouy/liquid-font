import { getUniformPoints, loadSvgGlyph } from "./glyphs";
import { GPUSimulation, SimParams } from "./simulation";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2")!;
if (!gl) throw new Error("WebGL2 not supported");
gl.getExtension("EXT_color_buffer_float");

const timelineCanvas = document.getElementById("timeline") as HTMLCanvasElement;
const tCtx = timelineCanvas.getContext("2d")!;
const controls = document.getElementById("controls")!;
const debugToggle = document.getElementById("debugToggle") as HTMLButtonElement;
const fullscreenToggle = document.getElementById(
  "fullscreenToggle",
) as HTMLButtonElement;
const motionToggle = document.getElementById(
  "motionToggle",
) as HTMLButtonElement;

const dpr = window.devicePixelRatio || 1;
let canvasWidth = window.innerWidth;
let canvasHeight = 0;
let simReady = false;

const bodyRadius = 4;

let stickiness = 0;
let stiffness = 50;
let surfaceTension = 20;
let liquidNormalWeight = 1;
let glyphNormalWeight = 3.7;
let adhesive = 0;
let glyphRepulsion = 0.5;
let timeScale = 2;
let smoothingRadius = bodyRadius * 3.5;
let interactionRange = 2.5;
let maxForce = 0.05;
let overlapForceMax = 1;
let frictionLiquid = 0.02;
let frictionGlyph = 0.03;
let gravityStrength = 0.2;
let cursorForce = 2.5;
let niceRender = true;
let showDebugPanel = false;
let substeps = 2;
let nicePointSize = 18;
let niceGlyphPointSize = 10;
let niceBodyLow = 0.18;
let niceBodyHigh = 0.34;
let niceEdgeLow = 0.08;
let niceEdgeHigh = 0.24;
let niceMinDensity = 0.9;
const cursorRadius = 10;
const fpsVal = document.getElementById("fpsVal")!;
let gravityDirX = 0;
let gravityDirY = 1;
let tiltGravityEnabled = false;
let tiltSupportKnown = false;

function updateFullscreenLabel() {
  fullscreenToggle.textContent = document.fullscreenElement
    ? "Exit Fullscreen"
    : "Fullscreen";
}

function updateMotionToggleLabel(status?: string) {
  if (status) {
    motionToggle.textContent = status;
    return;
  }
  if (!tiltSupportKnown) {
    motionToggle.textContent = "Tilt: N/A";
    motionToggle.disabled = true;
    return;
  }
  motionToggle.disabled = false;
  motionToggle.textContent = tiltGravityEnabled ? "Tilt: On" : "Tilt: Off";
}

function syncMotionGravityControl() {
  const input = document.getElementById("motionGravity") as HTMLInputElement;
  const val = document.getElementById("motionGravityVal")!;
  input.checked = tiltGravityEnabled;
  input.disabled = !tiltSupportKnown;
  val.textContent = tiltSupportKnown
    ? tiltGravityEnabled
      ? "on"
      : "off"
    : "n/a";
}

function normalizeGravityDirection(x: number, y: number) {
  const len = Math.hypot(x, y);
  if (len < 0.001) return;
  gravityDirX = x / len;
  gravityDirY = y / len;
}

function mapAccelerationToScreen(ax: number, ay: number) {
  const angle = window.screen.orientation?.angle ?? 0;
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { x: -ay, y: -ax };
    case 180:
      return { x: -ax, y: ay };
    case 270:
      return { x: ay, y: ax };
    default:
      return { x: ax, y: -ay };
  }
}

function handleDeviceMotion(event: DeviceMotionEvent) {
  if (!tiltGravityEnabled) return;
  const accel = event.accelerationIncludingGravity;
  if (!accel) return;
  const ax = accel.x ?? 0;
  const ay = accel.y ?? 0;
  const mapped = mapAccelerationToScreen(ax, ay);
  normalizeGravityDirection(mapped.x, mapped.y);
}

async function enableTiltGravity() {
  const motionEventCtor = window.DeviceMotionEvent as
    | (typeof DeviceMotionEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      })
    | undefined;

  if (!motionEventCtor) {
    updateMotionToggleLabel("Tilt: N/A");
    syncMotionGravityControl();
    return;
  }

  tiltSupportKnown = true;
  if (typeof motionEventCtor.requestPermission === "function") {
    const permission = await motionEventCtor.requestPermission();
    if (permission !== "granted") {
      updateMotionToggleLabel("Tilt: Denied");
      syncMotionGravityControl();
      return;
    }
  }

  window.addEventListener("devicemotion", handleDeviceMotion);
  tiltGravityEnabled = true;
  updateMotionToggleLabel();
  syncMotionGravityControl();
}

function disableTiltGravity() {
  tiltGravityEnabled = false;
  gravityDirX = 0;
  gravityDirY = 1;
  window.removeEventListener("devicemotion", handleDeviceMotion);
  updateMotionToggleLabel();
  syncMotionGravityControl();
}

async function toggleTiltGravity() {
  if (tiltGravityEnabled) {
    disableTiltGravity();
    return;
  }

  try {
    await enableTiltGravity();
  } catch (error) {
    console.error(error);
    updateMotionToggleLabel("Tilt: Error");
    syncMotionGravityControl();
  }
}

function detectTiltSupport() {
  tiltSupportKnown = typeof window.DeviceMotionEvent !== "undefined";
  updateMotionToggleLabel();
  syncMotionGravityControl();
}

function updateCanvasLayout() {
  controls.classList.toggle("hidden", !showDebugPanel);
  timelineCanvas.classList.toggle("hidden", !showDebugPanel);
  debugToggle.textContent = showDebugPanel ? "Debug: On" : "Debug: Off";
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  canvasWidth = viewportWidth;
  canvasHeight = viewportHeight;
  canvasHeight = Math.max(canvasHeight, 1);
  canvas.width = canvasWidth * dpr;
  canvas.height = canvasHeight * dpr;
  canvas.style.width = canvasWidth + "px";
  canvas.style.height = canvasHeight + "px";
}

updateCanvasLayout();
detectTiltSupport();
updateFullscreenLabel();

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

function bindToggle(
  id: string,
  valId: string,
  setter: (checked: boolean) => void,
  labels: { on: string; off: string },
) {
  const input = document.getElementById(id) as HTMLInputElement;
  const valSpan = document.getElementById(valId)!;

  const applyValue = () => {
    setter(input.checked);
    valSpan.textContent = input.checked ? labels.on : labels.off;
  };

  applyValue();
  input.addEventListener("input", applyValue);
}

debugToggle.addEventListener("click", () => {
  showDebugPanel = !showDebugPanel;
  updateCanvasLayout();
  if (!simReady) return;
  sim.resize(canvasWidth, canvasHeight);
  resizeDensityBuffer();
  updateWordGlyphs();
  if (showDebugPanel) resizeTimeline();
});

fullscreenToggle.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    console.error(error);
  }
});

motionToggle.addEventListener("click", () => {
  void toggleTiltGravity();
});

const motionGravityInput = document.getElementById(
  "motionGravity",
) as HTMLInputElement;
motionGravityInput.addEventListener("input", () => {
  if (motionGravityInput.checked === tiltGravityEnabled) return;
  void toggleTiltGravity();
});

document.addEventListener("fullscreenchange", updateFullscreenLabel);

bindToggle("niceRender", "niceRenderVal", (v) => (niceRender = v), {
  on: "nice",
  off: "debug",
});

bindSlider("nicePointSize", "nicePointSizeVal", (v) => (nicePointSize = v), 0);
bindSlider(
  "niceGlyphPointSize",
  "niceGlyphPointSizeVal",
  (v) => (niceGlyphPointSize = v),
  0,
);
bindSlider("niceBodyLow", "niceBodyLowVal", (v) => (niceBodyLow = v), 2);
bindSlider("niceBodyHigh", "niceBodyHighVal", (v) => (niceBodyHigh = v), 2);
bindSlider("niceEdgeLow", "niceEdgeLowVal", (v) => (niceEdgeLow = v), 2);
bindSlider("niceEdgeHigh", "niceEdgeHighVal", (v) => (niceEdgeHigh = v), 2);
bindSlider(
  "niceMinDensity",
  "niceMinDensityVal",
  (v) => (niceMinDensity = v),
  2,
);

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
bindSlider("timeScale", "timeScaleVal", (v) => (timeScale = v), 2);
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
bindSlider(
  "frictionLiquid",
  "frictionLiquidVal",
  (v) => (frictionLiquid = v),
  2,
);
bindSlider("frictionGlyph", "frictionGlyphVal", (v) => (frictionGlyph = v), 2);
bindSlider("gravity", "gravityVal", (v) => (gravityStrength = v), 3);
bindSlider("substeps", "substepsVal", (v) => (substeps = v), 0);

const params: SimParams = {
  stickiness: stickiness,
  stiffness: stiffness,
  surfaceTension: surfaceTension,
  liquidNormalWeight: liquidNormalWeight,
  glyphNormalWeight: glyphNormalWeight,
  adhesive: adhesive,
  glyphRepulsion: glyphRepulsion,
  timeScale: timeScale,
  smoothingRadius: smoothingRadius,
  interactionRange: interactionRange,
  bodyRadius: bodyRadius,
  maxForce: maxForce,
  overlapForceMax: overlapForceMax,
  frictionLiquid: frictionLiquid,
  frictionGlyph: frictionGlyph,
  gravityX: 0,
  gravityY: gravityStrength,
  cursorX: pointerX,
  cursorY: pointerY,
  cursorVelX: pointerVelX,
  cursorVelY: pointerVelY,
  cursorActive: pointerActive,
  cursorForce: cursorForce,
  cursorRadius: cursorRadius,
  targetNeighbors: 6,
  substeps: substeps,
  frameDtScale: 1,
  debugDataEnabled: 0,
};

const sim = new GPUSimulation(gl, canvasWidth, canvasHeight);
simReady = true;

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

const densityPointVS = `#version 300 es
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
  gl_Position = vec4(
    (pos.x / u_resolution.x) * 2.0 - 1.0,
    (pos.y / u_resolution.y) * -2.0 + 1.0,
    0.0,
    1.0
  );
  gl_PointSize = u_pointSize;
}
`;

const densityPointFS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float density = smoothstep(0.5, 0.0, dist);
  density *= density;
  fragColor = vec4(density, density, density, 1.0);
}
`;

const compositeVS = `#version 300 es
precision highp float;
const vec2 POSITIONS[6] = vec2[6](
  vec2(-1.0, -1.0),
  vec2(1.0, -1.0),
  vec2(-1.0, 1.0),
  vec2(-1.0, 1.0),
  vec2(1.0, -1.0),
  vec2(1.0, 1.0)
);
out vec2 v_uv;
void main() {
  vec2 pos = POSITIONS[gl_VertexID];
  v_uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const blurFS = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_texelSize;
uniform vec2 u_direction;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 offset = u_texelSize * u_direction;
  float density = texture(u_source, v_uv).r * 0.227027;
  density += texture(u_source, v_uv + offset * 1.384615).r * 0.316216;
  density += texture(u_source, v_uv - offset * 1.384615).r * 0.316216;
  density += texture(u_source, v_uv + offset * 3.230769).r * 0.070270;
  density += texture(u_source, v_uv - offset * 3.230769).r * 0.070270;
  fragColor = vec4(density, density, density, 1.0);
}
`;

const compositeFS = `#version 300 es
precision highp float;
uniform sampler2D u_density;
uniform vec4 u_thresholds;
uniform float u_minVisibleDensity;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  float density = texture(u_density, v_uv).r;
  if (density < u_minVisibleDensity) {
    fragColor = vec4(0.93, 0.93, 0.93, 1.0);
    return;
  }
  float edgeLow = min(u_thresholds.x, u_thresholds.y);
  float edgeHigh = max(u_thresholds.x, u_thresholds.y + 0.001);
  float bodyLow = min(u_thresholds.z, u_thresholds.w);
  float bodyHigh = max(u_thresholds.z, u_thresholds.w + 0.001);
  float body = smoothstep(bodyLow, bodyHigh, density);
  float edge = smoothstep(edgeLow, edgeHigh, density) - body;
  vec3 bg = vec3(0.93);
  vec3 edgeColor = vec3(0.38, 0.56, 0.86);
  vec3 liquidColor = vec3(0.10, 0.13, 0.18);
  vec3 color = mix(bg, edgeColor, edge * 0.85);
  color = mix(color, liquidColor, body);
  fragColor = vec4(color, 1.0);
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

const densityPointProgram = gl.createProgram()!;
gl.attachShader(
  densityPointProgram,
  mkShader(gl.VERTEX_SHADER, densityPointVS)!,
);
gl.attachShader(
  densityPointProgram,
  mkShader(gl.FRAGMENT_SHADER, densityPointFS)!,
);
gl.linkProgram(densityPointProgram);
const densityPointUniforms = {
  u_state: gl.getUniformLocation(densityPointProgram, "u_state"),
  u_numParticles: gl.getUniformLocation(densityPointProgram, "u_numParticles"),
  u_pointSize: gl.getUniformLocation(densityPointProgram, "u_pointSize"),
  u_resolution: gl.getUniformLocation(densityPointProgram, "u_resolution"),
};
const densityPointVAO = gl.createVertexArray()!;

const glyphDensityProgram = gl.createProgram()!;
gl.attachShader(glyphDensityProgram, mkShader(gl.VERTEX_SHADER, glyphPointVS)!);
gl.attachShader(
  glyphDensityProgram,
  mkShader(gl.FRAGMENT_SHADER, densityPointFS)!,
);
gl.linkProgram(glyphDensityProgram);
const glyphDensityUniforms = {
  u_glyphPoints: gl.getUniformLocation(glyphDensityProgram, "u_glyphPoints"),
  u_numGlyphPoints: gl.getUniformLocation(
    glyphDensityProgram,
    "u_numGlyphPoints",
  ),
  u_resolution: gl.getUniformLocation(glyphDensityProgram, "u_resolution"),
  u_pointSize: gl.getUniformLocation(glyphDensityProgram, "u_pointSize"),
};
const glyphDensityVAO = gl.createVertexArray()!;

const blurProgram = gl.createProgram()!;
gl.attachShader(blurProgram, mkShader(gl.VERTEX_SHADER, compositeVS)!);
gl.attachShader(blurProgram, mkShader(gl.FRAGMENT_SHADER, blurFS)!);
gl.linkProgram(blurProgram);
const blurUniforms = {
  u_source: gl.getUniformLocation(blurProgram, "u_source"),
  u_texelSize: gl.getUniformLocation(blurProgram, "u_texelSize"),
  u_direction: gl.getUniformLocation(blurProgram, "u_direction"),
};
const blurVAO = gl.createVertexArray()!;

const compositeProgram = gl.createProgram()!;
gl.attachShader(compositeProgram, mkShader(gl.VERTEX_SHADER, compositeVS)!);
gl.attachShader(compositeProgram, mkShader(gl.FRAGMENT_SHADER, compositeFS)!);
gl.linkProgram(compositeProgram);
const compositeUniforms = {
  u_density: gl.getUniformLocation(compositeProgram, "u_density"),
  u_thresholds: gl.getUniformLocation(compositeProgram, "u_thresholds"),
  u_minVisibleDensity: gl.getUniformLocation(
    compositeProgram,
    "u_minVisibleDensity",
  ),
};
const compositeVAO = gl.createVertexArray()!;

function createScreenTexture(width: number, height: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    Math.max(1, width),
    Math.max(1, height),
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  return tex;
}

let densityTexture = createScreenTexture(canvas.width, canvas.height);
let blurTexture = createScreenTexture(canvas.width, canvas.height);
const densityFramebuffer = gl.createFramebuffer()!;
const blurFramebuffer = gl.createFramebuffer()!;

function resizeDensityBuffer() {
  densityTexture = createScreenTexture(canvas.width, canvas.height);
  blurTexture = createScreenTexture(canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, densityFramebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    densityTexture,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    blurTexture,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

resizeDensityBuffer();

function renderDebug(stateTex: WebGLTexture) {
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
}

function renderNice(stateTex: WebGLTexture) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, densityFramebuffer);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  gl.useProgram(densityPointProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stateTex);
  gl.uniform1i(densityPointUniforms["u_state"], 0);
  gl.uniform1f(densityPointUniforms["u_numParticles"], sim.numParticles);
  gl.uniform2f(densityPointUniforms["u_resolution"], canvasWidth, canvasHeight);
  gl.uniform1f(densityPointUniforms["u_pointSize"], nicePointSize * dpr);
  gl.bindVertexArray(densityPointVAO);
  gl.drawArrays(gl.POINTS, 0, sim.numParticles);

  if (currentGlyphPointCount > 0) {
    gl.useProgram(glyphDensityProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glyphPointTexture);
    gl.uniform1i(glyphDensityUniforms["u_glyphPoints"], 1);
    gl.uniform1f(
      glyphDensityUniforms["u_numGlyphPoints"],
      currentGlyphPointCount,
    );
    gl.uniform2f(
      glyphDensityUniforms["u_resolution"],
      canvasWidth,
      canvasHeight,
    );
    gl.uniform1f(glyphDensityUniforms["u_pointSize"], niceGlyphPointSize * dpr);
    gl.bindVertexArray(glyphDensityVAO);
    gl.drawArrays(gl.POINTS, 0, currentGlyphPointCount);
  }

  gl.disable(gl.BLEND);

  gl.useProgram(blurProgram);
  gl.bindVertexArray(blurVAO);
  gl.uniform2f(
    blurUniforms["u_texelSize"],
    1 / canvas.width,
    1 / canvas.height,
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, densityTexture);
  gl.uniform1i(blurUniforms["u_source"], 0);
  gl.uniform2f(blurUniforms["u_direction"], 1.0, 0.0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindFramebuffer(gl.FRAMEBUFFER, densityFramebuffer);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, blurTexture);
  gl.uniform1i(blurUniforms["u_source"], 0);
  gl.uniform2f(blurUniforms["u_direction"], 0.0, 1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.93, 0.93, 0.93, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(compositeProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, densityTexture);
  gl.uniform1i(compositeUniforms["u_density"], 0);
  gl.uniform4f(
    compositeUniforms["u_thresholds"],
    niceEdgeLow,
    niceEdgeHigh,
    niceBodyLow,
    niceBodyHigh,
  );
  gl.uniform1f(compositeUniforms["u_minVisibleDensity"], niceMinDensity);
  gl.bindVertexArray(compositeVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

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
  tCtx.setTransform(1, 0, 0, 1, 0, 0);
  tCtx.scale(dpr, dpr);
}
if (showDebugPanel) resizeTimeline();

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
let lastFrameTime = performance.now();
let smoothedFrameDtScale = 1;

function render() {
  const now = performance.now();
  const frameDt = Math.max(now - lastFrameTime, 0.0001);
  fpsVal.textContent = (1000 / frameDt).toFixed(0);
  const targetFrameMs = 1000 / 60;
  const rawFrameDtScale = Math.min(Math.max(frameDt / targetFrameMs, 0.5), 2.5);
  smoothedFrameDtScale += (rawFrameDtScale - smoothedFrameDtScale) * 0.15;
  lastFrameTime = now;

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
  params.timeScale = timeScale;
  params.smoothingRadius = smoothingRadius;
  params.interactionRange = interactionRange;
  params.maxForce = maxForce;
  params.overlapForceMax = overlapForceMax;
  params.frictionLiquid = frictionLiquid;
  params.frictionGlyph = frictionGlyph;
  params.gravityX = gravityDirX * gravityStrength;
  params.gravityY = gravityDirY * gravityStrength;
  params.cursorX = pointerX;
  params.cursorY = pointerY;
  params.cursorVelX = pointerVelX;
  params.cursorVelY = pointerVelY;
  params.cursorActive = pointerActive;
  params.cursorForce = cursorForce;
  params.substeps = substeps;
  params.frameDtScale = smoothedFrameDtScale;
  params.debugDataEnabled = showDebugPanel || !niceRender ? 1 : 0;

  sim.step(params);

  if (showDebugPanel && frameCount % 5 === 0) {
    const forces = sim.readForceAverages();
    const spacing = sim.readSpacingStats();
    const speed = sim.readVelocityStats();
    forceHistory.push({ ...forces, ...spacing });
    if (forceHistory.length > FORCE_HISTORY_LEN) forceHistory.shift();
    drawTimeline();

    if (frameCount % 60 === 0) {
      const grid = sim.getGridDiagnostics();
      console.log(
        [
          `params: stickiness=${stickiness.toFixed(2)} stiffness=${stiffness.toFixed(2)} range=${interactionRange.toFixed(2)} maxForce=${maxForce.toFixed(3)} overlapCap=${overlapForceMax.toFixed(2)} surfTen=${surfaceTension.toFixed(2)} frictionLL=${frictionLiquid.toFixed(2)} frictionLG=${frictionGlyph.toFixed(2)} gravity=(${params.gravityX.toFixed(3)}, ${params.gravityY.toFixed(3)}) strength=${gravityStrength.toFixed(3)}`,
          `forces: total=${forces.total.toFixed(4)} attraction=${forces.attraction.toFixed(4)} repulsion=${forces.repulsion.toFixed(4)} surfaceTension=${forces.surfaceTension.toFixed(4)}`,
          `spacing: meanNN=${spacing.meanNearest.toFixed(3)} minNN=${spacing.minNearest.toFixed(3)}`,
          `speed: mean=${speed.meanSpeed.toFixed(4)} max=${speed.maxSpeed.toFixed(4)}`,
          `grid: size=${grid.gridCellSize.toFixed(2)} cols=${grid.gridCols} rows=${grid.gridRows} particleOverflow=${grid.particleOverflowCount} glyphOverflow=${grid.glyphOverflowCount}`,
        ].join("\n"),
      );
    }
  }
  frameCount++;

  const stateTex = sim.getCurrentStateTexture();
  if (niceRender) renderNice(stateTex);
  else renderDebug(stateTex);

  requestAnimationFrame(render);
}

render();

window.addEventListener("resize", () => {
  updateCanvasLayout();
  pointerTargetX = Math.min(pointerTargetX, canvasWidth);
  pointerTargetY = Math.min(pointerTargetY, canvasHeight);
  pointerX = Math.min(pointerX, canvasWidth);
  pointerY = Math.min(pointerY, canvasHeight);
  sim.resize(canvasWidth, canvasHeight);
  resizeDensityBuffer();
  updateWordGlyphs();
  if (showDebugPanel) resizeTimeline();
});
