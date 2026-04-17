const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = "#111";
ctx.fillRect(0, 0, canvas.width, canvas.height);

const SCALE = 6;
const POINT_SPACING = 0.8;
const MARGIN = 40;

const R = "R".charCodeAt(0);

const CHAR_NUMBERS = {
  a: 2101, b: 2102, c: 2103, d: 2104, e: 2105, f: 2106, g: 2107, h: 2108,
  i: 2109, j: 2110, k: 2111, l: 2112, m: 2113, n: 2114, o: 2115, p: 2116,
  q: 2117, r: 2118, s: 2119, t: 2120, u: 2121, v: 2122, w: 2123, x: 2124,
  y: 2125, z: 2126,
};

function parseGlyph(line) {
  const num = parseInt(line.substring(0, 5).trim());
  const left = line.charCodeAt(8) - R;
  const right = line.charCodeAt(9) - R;
  const numPairs = parseInt(line.substring(5, 8).trim()) - 1;

  const subPaths = [];
  let current = [];
  for (let i = 0; i < numPairs; i++) {
    const x = line.charCodeAt(10 + i * 2) - R;
    const y = line.charCodeAt(11 + i * 2) - R;
    if (x === -50 && y === 0) {
      if (current.length > 0) subPaths.push(current);
      current = [];
    } else {
      current.push([x, y]);
    }
  }
  if (current.length > 0) subPaths.push(current);
  return { num, left, right, subPaths };
}

async function loadFont() {
  const resp = await fetch("/hershey");
  const text = await resp.text();
  const lines = text.split("\n");

  // Join continuation lines (some glyphs span multiple lines)
  const joinedLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    // A new glyph line starts with optional spaces then a number
    const startsNewGlyph = /^\s*\d+\s+\d+/.test(line);
    if (startsNewGlyph || joinedLines.length === 0) {
      joinedLines.push(line);
    } else {
      joinedLines[joinedLines.length - 1] += line;
    }
  }

  const glyphs = {};
  for (const line of joinedLines) {
    try {
      const g = parseGlyph(line);
      if (!glyphs[g.num]) glyphs[g.num] = g;
    } catch (e) {}
  }
  return glyphs;
}

function getCharPaths(glyphs, ch) {
  const num = CHAR_NUMBERS[ch];
  if (!num) return null;
  const g = glyphs[num];
  if (!g) return null;
  const allPaths = [];
  for (const sub of g.subPaths) {
    if (sub.length > 0) allPaths.push(sub);
  }
  return { subPaths: allPaths, left: g.left, right: g.right };
}

function resamplePaths(paths, spacing) {
  const points = [];
  for (const path of paths) {
    if (path.length < 2) {
      points.push({ x: path[0][0], y: path[0][1] });
      continue;
    }
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, y0] = path[i];
      const [x1, y1] = path[i + 1];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.max(1, Math.ceil(len / spacing));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        points.push({ x: x0 + dx * t, y: y0 + dy * t });
      }
    }
    const last = path[path.length - 1];
    points.push({ x: last[0], y: last[1] });
  }
  return points;
}

function drawPaths(subPaths, ox, oy, scale, color, label) {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px monospace";
  ctx.fillText(label, ox, oy - 5);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const path of subPaths) {
    if (path.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(ox + path[0][0] * scale, oy + path[0][1] * scale);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(ox + path[i][0] * scale, oy + path[i][1] * scale);
    }
    ctx.stroke();
  }
}

function drawPoints(points, ox, oy, scale, color) {
  ctx.fillStyle = color;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(ox + p.x * scale, oy + p.y * scale, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function main() {
  const glyphs = await loadFont();
  console.log("Loaded", Object.keys(glyphs).length, "glyphs");

  const text = "abcdefghijklmnopqrstuvwxyz";
  const cols = 9;
  const cellW = 200;
  const cellH = 140;

  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px monospace";
  ctx.fillText("Hershey Roman Complex (serif lowercase) - vector paths", MARGIN, 25);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = MARGIN + col * cellW;
    const oy = MARGIN + 60 + row * cellH;

    const result = getCharPaths(glyphs, ch);
    if (!result) continue;

    const pts = resamplePaths(result.subPaths, POINT_SPACING);

    ctx.fillStyle = "#555";
    ctx.font = "11px monospace";
    ctx.fillText(ch + " (" + pts.length + ")", ox, oy - 5);

    drawPaths(result.subPaths, ox, oy, SCALE, "#0af", "");
    drawPoints(pts, ox + 70, oy, SCALE / 1.5, "#0f0");
  }
}

let glyphsCache = null;

async function render() {
  if (!glyphsCache) {
    glyphsCache = await loadFont();
    console.log("Loaded", Object.keys(glyphsCache).length, "glyphs");
  }

  const text = "abcdefghijklmnopqrstuvwxyz";
  const cols = 9;
  const cellW = 200;
  const cellH = 140;

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px monospace";
  ctx.fillText("Hershey Roman Complex (serif lowercase) - vector paths", MARGIN, 25);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = MARGIN + col * cellW;
    const oy = MARGIN + 60 + row * cellH;

    const result = getCharPaths(glyphsCache, ch);
    if (!result) continue;

    const pts = resamplePaths(result.subPaths, POINT_SPACING);

    ctx.fillStyle = "#555";
    ctx.font = "11px monospace";
    ctx.fillText(ch + " (" + pts.length + ")", ox, oy - 5);

    drawPaths(result.subPaths, ox, oy, SCALE, "#0af", "");
    drawPoints(pts, ox + 70, oy, SCALE / 1.5, "#0f0");
  }
}

render();

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  render();
});