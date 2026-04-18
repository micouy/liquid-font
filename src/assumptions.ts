import {
  computePairForceComponents,
  PAIR_FORCE_GLSL,
  PairForceParams,
} from "./pair-force";

type Control = {
  key: keyof State;
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
};

type State = {
  bodyRadius: number;
  interactionRange: number;
  stickiness: number;
  stiffness: number;
  maxForce: number;
  overlapForceMax: number;
  distance: number;
  dt: number;
};

const state: State = {
  bodyRadius: 4,
  interactionRange: 4,
  stickiness: 8,
  stiffness: 10,
  maxForce: 0.05,
  overlapForceMax: 0.5,
  distance: 8,
  dt: 1,
};

const controls: Control[] = [
  {
    key: "bodyRadius",
    label: "bodyRadius",
    min: 1,
    max: 12,
    step: 0.5,
    decimals: 1,
  },
  {
    key: "interactionRange",
    label: "range",
    min: 2,
    max: 10,
    step: 0.5,
    decimals: 1,
  },
  {
    key: "stickiness",
    label: "stickiness",
    min: 0,
    max: 20,
    step: 1,
    decimals: 0,
  },
  {
    key: "stiffness",
    label: "stiffness",
    min: 0,
    max: 20,
    step: 1,
    decimals: 0,
  },
  {
    key: "maxForce",
    label: "maxForce",
    min: 0,
    max: 0.2,
    step: 0.001,
    decimals: 3,
  },
  {
    key: "overlapForceMax",
    label: "overlapCap",
    min: 0,
    max: 2,
    step: 0.01,
    decimals: 2,
  },
  {
    key: "distance",
    label: "distance",
    min: 0.1,
    max: 40,
    step: 0.1,
    decimals: 1,
  },
  { key: "dt", label: "dt", min: 0.1, max: 2, step: 0.1, decimals: 1 },
];

const controlsRoot = document.getElementById("controls") as HTMLDivElement;
const checksEl = document.getElementById("checks") as HTMLPreElement;
const singleEl = document.getElementById("single") as HTMLPreElement;
const gpuCompareEl = document.getElementById("gpucompare") as HTMLPreElement;
const twoBodyEl = document.getElementById("twobody") as HTMLPreElement;
const samplesEl = document.getElementById("samples") as HTMLTableSectionElement;
const gpuCanvas = document.getElementById("gpu-test") as HTMLCanvasElement;

type GpuHarness = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  vao: WebGLVertexArrayObject;
  framebuffer: WebGLFramebuffer;
  output: Float32Array;
};

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
  }
  return shader;
}

function createGpuHarness(): GpuHarness | null {
  const gl = gpuCanvas.getContext("webgl2");
  if (!gl) return null;
  const ext = gl.getExtension("EXT_color_buffer_float");
  if (!ext) return null;

  const vs = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }`,
  );
  const fs = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    uniform float u_dist;
    uniform float u_bodyRadius;
    uniform float u_interactionRange;
    uniform float u_stickiness;
    uniform float u_stiffness;
    uniform float u_maxForce;
    uniform float u_overlapForceMax;
    out vec4 fragColor;
    ${PAIR_FORCE_GLSL}
    void main() {
      vec2 force = computePairForceComponents(
        u_dist,
        u_bodyRadius,
        u_interactionRange,
        u_stickiness,
        u_stiffness,
        u_maxForce,
        u_overlapForceMax
      );
      fragColor = vec4(force, 0.0, 1.0);
    }`,
  );

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "program link failed");
  }

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);

  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("GPU test framebuffer incomplete");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    gl,
    program,
    uniforms: {
      u_dist: gl.getUniformLocation(program, "u_dist"),
      u_bodyRadius: gl.getUniformLocation(program, "u_bodyRadius"),
      u_interactionRange: gl.getUniformLocation(program, "u_interactionRange"),
      u_stickiness: gl.getUniformLocation(program, "u_stickiness"),
      u_stiffness: gl.getUniformLocation(program, "u_stiffness"),
      u_maxForce: gl.getUniformLocation(program, "u_maxForce"),
      u_overlapForceMax: gl.getUniformLocation(program, "u_overlapForceMax"),
    },
    vao,
    framebuffer,
    output: new Float32Array(4),
  };
}

const gpuHarness = createGpuHarness();

function bindControls() {
  for (const control of controls) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = control.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(state[control.key]);
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = Number(state[control.key]).toFixed(control.decimals);
    input.addEventListener("input", () => {
      state[control.key] = parseFloat(input.value) as never;
      value.textContent = Number(state[control.key]).toFixed(control.decimals);
      render();
    });
    label.append(name, input, value);
    controlsRoot.append(label);
  }
}

function baseParams(dist: number): PairForceParams {
  return {
    dist,
    bodyRadius: state.bodyRadius,
    interactionRange: state.interactionRange,
    stickiness: state.stickiness,
    stiffness: state.stiffness,
    maxForce: state.maxForce,
    overlapForceMax: state.overlapForceMax,
  };
}

function computeGpuPairForceComponents(params: PairForceParams) {
  if (!gpuHarness) return null;
  const { gl, program, uniforms, vao, framebuffer, output } = gpuHarness;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, 1, 1);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform1f(uniforms.u_dist, params.dist);
  gl.uniform1f(uniforms.u_bodyRadius, params.bodyRadius);
  gl.uniform1f(uniforms.u_interactionRange, params.interactionRange);
  gl.uniform1f(uniforms.u_stickiness, params.stickiness);
  gl.uniform1f(uniforms.u_stiffness, params.stiffness);
  gl.uniform1f(uniforms.u_maxForce, params.maxForce);
  gl.uniform1f(uniforms.u_overlapForceMax, params.overlapForceMax);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, output);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { attraction: output[0], repulsion: output[1] };
}

function formatCheck(ok: boolean, text: string) {
  return `${ok ? "ok" : "warn"}: ${text}`;
}

function renderChecks() {
  const rest = state.bodyRadius * 2;
  const maxDist = Math.max(rest, state.interactionRange * state.bodyRadius);
  const atRest = computePairForceComponents(baseParams(rest));
  const pastRange = computePairForceComponents(baseParams(maxDist + 0.1));
  const inside = computePairForceComponents(baseParams(rest * 0.75));
  const mid = computePairForceComponents(baseParams((rest + maxDist) * 0.5));
  const nearOuter = computePairForceComponents(baseParams(maxDist - 0.01));

  const lines = [
    formatCheck(
      atRest.attraction === 0 && atRest.repulsion === 0,
      "force is zero at 2r",
    ),
    formatCheck(
      pastRange.attraction === 0 && pastRange.repulsion === 0,
      "force is zero beyond outer range",
    ),
    formatCheck(
      inside.repulsion > 0 && inside.attraction === 0,
      "inside 2r is repulsion only",
    ),
    formatCheck(
      mid.attraction > 0 && mid.repulsion === 0,
      "mid-range is attraction only",
    ),
    formatCheck(
      nearOuter.attraction >= 0 && nearOuter.repulsion === 0,
      "near outer range has no repulsion",
    ),
  ];

  checksEl.className = lines.every((line) => line.startsWith("ok"))
    ? "ok"
    : "warn";
  checksEl.textContent = lines.join("\n");
}

function renderSingle() {
  const force = computePairForceComponents(baseParams(state.distance));
  singleEl.textContent = [
    `distance=${state.distance.toFixed(2)}`,
    `attraction=${force.attraction.toFixed(6)}`,
    `repulsion=${force.repulsion.toFixed(6)}`,
    `net=${(force.attraction - force.repulsion).toFixed(6)}`,
  ].join("\n");
}

function renderGpuCompare() {
  const params = baseParams(state.distance);
  const cpu = computePairForceComponents(params);
  const gpu = computeGpuPairForceComponents(params);

  if (!gpu) {
    gpuCompareEl.className = "warn";
    gpuCompareEl.textContent = "WebGL2 float readback unavailable";
    return;
  }

  const attrDelta = Math.abs(cpu.attraction - gpu.attraction);
  const repDelta = Math.abs(cpu.repulsion - gpu.repulsion);
  const ok = attrDelta < 1e-6 && repDelta < 1e-6;
  gpuCompareEl.className = ok ? "ok" : "warn";
  gpuCompareEl.textContent = [
    `cpu attraction=${cpu.attraction.toFixed(6)} repulsion=${cpu.repulsion.toFixed(6)}`,
    `gpu attraction=${gpu.attraction.toFixed(6)} repulsion=${gpu.repulsion.toFixed(6)}`,
    `delta attraction=${attrDelta.toExponential(2)} repulsion=${repDelta.toExponential(2)}`,
    ok ? "status: CPU and GLSL match" : "status: CPU and GLSL diverge",
  ].join("\n");
}

function renderTwoBody() {
  const force = computePairForceComponents(baseParams(state.distance));
  const ax = force.attraction - force.repulsion;
  const dt = state.dt;
  const p1 = 0;
  const p2 = state.distance;
  const v1 = ax * dt;
  const v2 = -ax * dt;
  const next1 = p1 + v1 * dt;
  const next2 = p2 + v2 * dt;
  twoBodyEl.textContent = [
    `netForce=${ax.toFixed(6)} (positive means attraction)`,
    `p1: x=${p1.toFixed(3)} v=${v1.toFixed(6)} next=${next1.toFixed(6)}`,
    `p2: x=${p2.toFixed(3)} v=${v2.toFixed(6)} next=${next2.toFixed(6)}`,
    `nextDistance=${(next2 - next1).toFixed(6)}`,
  ].join("\n");
}

function renderSamples() {
  const rest = state.bodyRadius * 2;
  const maxDist = Math.max(rest, state.interactionRange * state.bodyRadius);
  const sampleCount = 16;
  samplesEl.innerHTML = "";

  for (let i = 0; i <= sampleCount; i++) {
    const dist = 0.25 + (maxDist * i) / sampleCount;
    const force = computePairForceComponents(baseParams(dist));
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${dist.toFixed(2)}</td>
      <td>${force.attraction.toFixed(6)}</td>
      <td>${force.repulsion.toFixed(6)}</td>
      <td>${(force.attraction - force.repulsion).toFixed(6)}</td>
    `;
    samplesEl.append(row);
  }
}

function render() {
  renderChecks();
  renderSingle();
  renderGpuCompare();
  renderTwoBody();
  renderSamples();
}

bindControls();
render();
