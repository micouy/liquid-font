import Matter from 'matter-js';

const { Engine, Render, Runner, Bodies, Composite, Body, Events, Constraint } = Matter;

const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
gl.viewport(0, 0, canvas.width, canvas.height);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

const NUM_BODIES = 300;
const bodyRadius = 4;

const engine = Engine.create();
engine.world.gravity.y = 3;
const world = engine.world;

const vertexShaderSource = `
  attribute vec2 a_corner;
  attribute vec2 a_pos;
  uniform vec2 u_resolution;
  uniform float u_influence;
  varying vec2 v_pos;
  
  void main() {
    v_pos = a_pos;
    vec2 offset = a_corner * u_influence;
    vec2 pixelPos = a_pos + offset;
    vec2 clipSpace = vec2((pixelPos.x / u_resolution.x) * 2.0 - 1.0,
                          (pixelPos.y / u_resolution.y) * -2.0 + 1.0);
    gl_Position = vec4(clipSpace, 0, 1);
  }
`;

const fragmentShaderSource = `
  precision highp float;
  varying vec2 v_pos;
  uniform float u_radius;
  uniform float u_power;
  uniform vec2 u_resolution;
  uniform vec3 u_color;
  
  void main() {
    vec2 uv = gl_FragCoord.xy;
    vec2 flippedPos = vec2(v_pos.x, u_resolution.y - v_pos.y);
    float dx = uv.x - flippedPos.x;
    float dy = uv.y - flippedPos.y;
    float dist = sqrt(dx * dx + dy * dy);
    float val = u_radius / pow(dist, u_power);
    gl_FragColor = vec4(u_color, val);
  }
`;

const thresholdVertexShader = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0, 1);
  }
`;

const thresholdFragmentShader = `
  precision highp float;
  uniform sampler2D u_accum;
  uniform float u_threshold;
  uniform vec2 u_resolution;
  
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec4 tex = texture2D(u_accum, uv);
    float val = tex.a;
    if (val > u_threshold) {
      gl_FragColor = vec4(tex.rgb, 1.0);
    } else {
      discard;
    }
  }
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = createProgram(gl, vertexShader, fragmentShader);

const threshVertShader = createShader(gl, gl.VERTEX_SHADER, thresholdVertexShader);
const threshFragShader = createShader(gl, gl.FRAGMENT_SHADER, thresholdFragmentShader);
const threshProgram = createProgram(gl, threshVertShader, threshFragShader);

const cornerLocation = gl.getAttribLocation(program, 'a_corner');
const posLocation = gl.getAttribLocation(program, 'a_pos');
const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
const influenceLocation = gl.getUniformLocation(program, 'u_influence');
const radiusLocation = gl.getUniformLocation(program, 'u_radius');
const powerLocation = gl.getUniformLocation(program, 'u_power');
const colorLocation = gl.getUniformLocation(program, 'u_color');

const threshPosLocation = gl.getAttribLocation(threshProgram, 'a_position');
const threshAccumLocation = gl.getUniformLocation(threshProgram, 'u_accum');
const threshThreshLocation = gl.getUniformLocation(threshProgram, 'u_threshold');
const threshResLocation = gl.getUniformLocation(threshProgram, 'u_resolution');

const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1, 1, -1, -1, 1,
  -1, 1, 1, -1, 1, 1
]), gl.STATIC_DRAW);

const vertexBuffer = gl.createBuffer();
const vertices = new Float32Array(NUM_BODIES * 6 * 4);
const corners = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];

function createLShape() {
  const lBodies = [];
  const particleSpacing = bodyRadius * 2.2;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  const stemHeight = 20;
  const baseWidth = 10;
  const serifSize = 3;
  
  const stemX = centerX - (baseWidth / 2) * particleSpacing;
  
  for (let i = 0; i < stemHeight; i++) {
    const body = Bodies.circle(
      stemX,
      centerY - (i - stemHeight / 2) * particleSpacing,
      bodyRadius,
      { isStatic: true }
    );
    lBodies.push(body);
  }
  
  for (let i = 0; i < baseWidth; i++) {
    const body = Bodies.circle(
      stemX + (i + 1) * particleSpacing,
      centerY + (stemHeight / 2) * particleSpacing,
      bodyRadius,
      { isStatic: true }
    );
    lBodies.push(body);
  }
  
  for (let i = 1; i <= serifSize; i++) {
    const body = Bodies.circle(stemX - i * particleSpacing, centerY - (stemHeight / 2 + 1) * particleSpacing, bodyRadius, { isStatic: true });
    lBodies.push(body);
    const body2 = Bodies.circle(stemX + i * particleSpacing, centerY - (stemHeight / 2 + 1) * particleSpacing, bodyRadius, { isStatic: true });
    lBodies.push(body2);
  }
  
  for (let i = 1; i <= serifSize; i++) {
    const body = Bodies.circle(stemX - i * particleSpacing, centerY + (stemHeight / 2 + 1) * particleSpacing, bodyRadius, { isStatic: true });
    lBodies.push(body);
    const body2 = Bodies.circle(stemX + i * particleSpacing, centerY + (stemHeight / 2 + 1) * particleSpacing, bodyRadius, { isStatic: true });
    lBodies.push(body2);
  }
  
  for (let i = 1; i <= serifSize; i++) {
    const body = Bodies.circle(stemX + (baseWidth + i) * particleSpacing, centerY + (stemHeight / 2 + 1) * particleSpacing, bodyRadius, { isStatic: true });
    lBodies.push(body);
    const body2 = Bodies.circle(stemX + (baseWidth + i) * particleSpacing, centerY + (stemHeight / 2 - 1) * particleSpacing, bodyRadius, { isStatic: true });
    lBodies.push(body2);
  }
  
  Composite.add(world, lBodies);
  return lBodies;
}

const framebuffer = gl.createFramebuffer();
const accumTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, accumTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

const lVertexBuffer = gl.createBuffer();

const bodies = [];

for (let i = 0; i < NUM_BODIES; i++) {
  const body = Bodies.circle(
    Math.random() * canvas.width,
    Math.random() * canvas.height * 0.5,
    bodyRadius,
    {
      restitution: 0.3,
      friction: 0.1,
      frictionAir: 0.01,
      density: 0.001
    }
  );
  bodies.push(body);
  Composite.add(world, body);
}

const lBodies = createLShape();

const cohesionDistance = bodyRadius * 6;
const repulsionDistance = bodyRadius * 2.5;

const params = {
  cohesion: 3,
  repulsion: 10,
  adhesive: 5,
  cursorForce: 12,
  radius: 1.1,
  threshold: 0.1,
  power: 2,
  influence: 50
};

document.getElementById('cohesion').addEventListener('input', (e) => {
  params.cohesion = parseFloat(e.target.value);
  document.getElementById('cohesionVal').textContent = params.cohesion;
});
document.getElementById('repulsion').addEventListener('input', (e) => {
  params.repulsion = parseFloat(e.target.value);
  document.getElementById('repulsionVal').textContent = params.repulsion;
});
document.getElementById('adhesive').addEventListener('input', (e) => {
  params.adhesive = parseFloat(e.target.value);
  document.getElementById('adhesiveVal').textContent = params.adhesive;
});
document.getElementById('cursorForce').addEventListener('input', (e) => {
  params.cursorForce = parseFloat(e.target.value);
  document.getElementById('cursorVal').textContent = params.cursorForce;
});
document.getElementById('radius').addEventListener('input', (e) => {
  params.radius = parseFloat(e.target.value);
  document.getElementById('radiusVal').textContent = params.radius;
});
document.getElementById('threshold').addEventListener('input', (e) => {
  params.threshold = parseFloat(e.target.value);
  document.getElementById('thresholdVal').textContent = params.threshold;
});
document.getElementById('power').addEventListener('input', (e) => {
  params.power = parseFloat(e.target.value);
  document.getElementById('powerVal').textContent = params.power;
});
document.getElementById('influence').addEventListener('input', (e) => {
  params.influence = parseFloat(e.target.value);
  document.getElementById('influenceVal').textContent = params.influence;
});

const walls = [
  Bodies.rectangle(canvas.width / 2, canvas.height + 50, canvas.width, 100, { isStatic: true }),
  Bodies.rectangle(-50, canvas.height / 2, 100, canvas.height, { isStatic: true }),
  Bodies.rectangle(canvas.width + 50, canvas.height / 2, 100, canvas.height, { isStatic: true })
];
Composite.add(world, walls);

const mouse = { x: 0, y: 0 };
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

function updateVertices() {
  let idx = 0;
  for (let i = 0; i < bodies.length; i++) {
    const pos = bodies[i].position;
    for (let j = 0; j < 6; j++) {
      vertices[idx++] = corners[j * 2];
      vertices[idx++] = corners[j * 2 + 1];
      vertices[idx++] = pos.x;
      vertices[idx++] = pos.y;
    }
  }
}

function updateLVertices() {
  const lVerts = new Float32Array(lBodies.length * 6 * 4);
  let idx = 0;
  for (let i = 0; i < lBodies.length; i++) {
    const pos = lBodies[i].position;
    for (let j = 0; j < 6; j++) {
      lVerts[idx++] = corners[j * 2];
      lVerts[idx++] = corners[j * 2 + 1];
      lVerts[idx++] = pos.x;
      lVerts[idx++] = pos.y;
    }
  }
  return lVerts;
}

function render() {
  Engine.update(engine, 1000 / 60);

  for (const body of bodies) {
    const dx = mouse.x - body.position.x;
    const dy = mouse.y - body.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 100) {
      const force = 0.00000001 * params.cursorForce * (100 - dist);
      Body.applyForce(body, body.position, { x: dx * force, y: dy * force });
    }
  }

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].position.x - bodies[i].position.x;
      const dy = bodies[j].position.y - bodies[i].position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < cohesionDistance && dist > 0.1) {
        const nx = dx / dist;
        const ny = dy / dist;
        
        if (dist < repulsionDistance) {
          const repulsion = params.repulsion * 0.0001 / (dist * dist);
          Body.applyForce(bodies[i], bodies[i].position, { x: -nx * repulsion, y: -ny * repulsion });
          Body.applyForce(bodies[j], bodies[j].position, { x: nx * repulsion, y: ny * repulsion });
        } else {
          const cohesion = params.cohesion * 0.00001 / dist;
          Body.applyForce(bodies[i], bodies[i].position, { x: nx * cohesion, y: ny * cohesion });
          Body.applyForce(bodies[j], bodies[j].position, { x: -nx * cohesion, y: -ny * cohesion });
        }
      }
    }
    
    for (let j = 0; j < lBodies.length; j++) {
      const dx = lBodies[j].position.x - bodies[i].position.x;
      const dy = lBodies[j].position.y - bodies[i].position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > bodyRadius && dist < cohesionDistance) {
        const nx = dx / dist;
        const ny = dy / dist;
        const adhesive = params.adhesive * 0.00001 / dist;
        Body.applyForce(bodies[i], bodies[i].position, { x: nx * adhesive, y: ny * adhesive });
      }
    }
  }

  updateVertices();
  const lVerts = updateLVertices();

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTexture, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.enableVertexAttribArray(cornerLocation);
  gl.enableVertexAttribArray(posLocation);
  
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(influenceLocation, params.influence);
  gl.uniform1f(radiusLocation, params.radius);
  gl.uniform1f(powerLocation, params.power);
  
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 16, 8);
  
  gl.uniform3f(colorLocation, 0, 0, 0);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.drawArrays(gl.TRIANGLES, 0, NUM_BODIES * 6);
  
  gl.bindBuffer(gl.ARRAY_BUFFER, lVertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, lVerts, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 16, 8);
  
  gl.uniform3f(colorLocation, 1, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, lBodies.length * 6);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1.0, 1.0, 1.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(threshProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(threshPosLocation);
  gl.vertexAttribPointer(threshPosLocation, 2, gl.FLOAT, false, 0, 0);
  
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, accumTexture);
  gl.uniform1i(threshAccumLocation, 0);
  gl.uniform1f(threshThreshLocation, params.threshold);
  gl.uniform2f(threshResLocation, canvas.width, canvas.height);
  
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindTexture(gl.TEXTURE_2D, accumTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
});

render();