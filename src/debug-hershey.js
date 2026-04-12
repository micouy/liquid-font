const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = "#111";
ctx.fillRect(0, 0, canvas.width, canvas.height);

const TEXT = "ABCD";
const SCALE = 3;
const POINT_SPACING = 2.5;
const MARGIN = 40;

const charMap = {
  A: 501, B: 502, C: 503, D: 504, E: 505, F: 506, G: 507, H: 508,
  I: 509, J: 510, K: 511, L: 512, M: 513, N: 514, O: 515, P: 516,
  Q: 517, R: 518, S: 519, T: 520, U: 521, V: 522, W: 523, X: 524,
  Y: 525, Z: 526, a: 601, b: 602, c: 603, d: 604, e: 605, f: 606,
  g: 607, h: 608, i: 609, j: 610, k: 611, l: 612, m: 613, n: 614,
  o: 615, p: 616, q: 617, r: 618, s: 619, t: 620, u: 621, v: 622,
  w: 623, x: 624, y: 625, z: 626, " ": 699, "0": 700, "1": 701,
  "2": 702, "3": 703, "4": 704, "5": 705, "6": 706, "7": 707,
  "8": 708, "9": 709, ".": 710, ",": 711, ":": 712, ";": 713,
  "!": 714, "?": 715, '"': 717, $: 719, "/": 720, "(": 721, ")": 722,
  "|": 723, "-": 724, "+": 725, "=": 726, "'": 731, "#": 733,
  "&": 734, "\\": 804, _: 999, "*": 2219, "[": 2223, "]": 2224,
  "{": 2225, "}": 2226, "<": 2241, ">": 2242, "~": 2246, "%": 2271,
  "@": 2273,
};

function parseGlyph(line) {
  const R = "R".charCodeAt(0);
  const num = parseInt(line.substr(0, 5));
  const left = line[8].charCodeAt(0) - R;
  const right = line[9].charCodeAt(0) - R;
  const numVerts = parseInt(line.substr(5, 3), 10) - 1;
  let currentPath = [];
  const penCommands = [currentPath];
  for (let i = 0; i < numVerts; i++) {
    const x = line[10 + i * 2].charCodeAt(0) - R;
    const y = line[11 + i * 2].charCodeAt(0) - R;
    if (x === -50 && y === 0) {
      currentPath = [];
      penCommands.push(currentPath);
    } else {
      currentPath.push([x, y]);
    }
  }
  return { num, left, right, penCommands };
}

async function loadFont() {
  const resp = await fetch("/rowmans.jhf");
  const text = await resp.text();
  const glyphs = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const g = parseGlyph(trimmed);
    glyphs[g.num] = g;
  }
  return glyphs;
}

function stringToPaths(glyphs, str) {
  const descriptors = str.split("").map((ch) => {
    const num = charMap[ch];
    return glyphs[num] || glyphs[charMap[" "]];
  });

  let totalWidth = 0;
  let minY = Infinity, maxY = -Infinity;
  for (const d of descriptors) {
    totalWidth += d.right - d.left;
    for (const cmd of d.penCommands) {
      for (const [px, py] of cmd) {
        minY = Math.min(minY, -py);
        maxY = Math.max(maxY, -py);
      }
    }
  }

  const minX = -totalWidth / 2;
  const maxX = totalWidth / 2;
  const paths = [];
  let curX = minX;

  for (const d of descriptors) {
    for (const cmd of d.penCommands) {
      paths.push(cmd.map(([px, py]) => [curX - d.left + px, -py]));
    }
    curX += d.right - d.left;
  }

  return { paths, bounds: { minX, maxX, minY, maxY } };
}

function resamplePath(path, spacing) {
  if (path.length < 2) return path.map(([x, y]) => ({ x, y }));
  const points = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i];
    const [x1, y1] = path[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(len / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      points.push({ x: x0 + dx * t, y: y0 + dy * t });
    }
  }
  const last = path[path.length - 1];
  points.push({ x: last[0], y: last[1] });
  return points;
}

function drawPaths(paths, ox, oy, scale, color, label) {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px monospace";
  ctx.fillText(label, ox, oy - 10);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const path of paths) {
    if (path.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(ox + path[0][0] * scale, oy - path[0][1] * scale);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(ox + path[i][0] * scale, oy - path[i][1] * scale);
    }
    ctx.stroke();
  }
}

function drawPoints(points, ox, oy, scale, color, label) {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px monospace";
  ctx.fillText(label + " (" + points.length + " pts)", ox, oy - 10);
  ctx.fillStyle = color;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(ox + p.x * scale, oy - p.y * scale, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function main() {
  const glyphs = await loadFont();

  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px monospace";
  ctx.fillText("Hershey vector font pipeline", MARGIN, 25);

  const { paths, bounds } = stringToPaths(glyphs, TEXT);

  console.log("Hershey:", { bounds, numPaths: paths.length, paths });

  const dispW = (bounds.maxX - bounds.minX) * SCALE;
  const dispH = (bounds.maxY - bounds.minY) * SCALE;
  const colGap = 80;
  const row1 = MARGIN + 50;
  const col1 = MARGIN - bounds.minX * SCALE;
  const col2 = col1 + dispW + colGap;

  drawPaths(paths, col1, row1 + bounds.maxY * SCALE, SCALE, "#0af", "1. Raw vector paths");

  const allPoints = [];
  for (const path of paths) {
    allPoints.push(...resamplePath(path, POINT_SPACING));
  }

  drawPoints(allPoints, col2, row1 + bounds.maxY * SCALE, SCALE, "#0f0", "2. Resampled (spacing=" + POINT_SPACING + ")");

  ctx.fillStyle = "#888";
  ctx.font = "14px monospace";
  const infoY = row1 + dispH + 60;
  ctx.fillText("bounds: minX=" + bounds.minX + " maxX=" + bounds.maxX + " minY=" + bounds.minY + " maxY=" + bounds.maxY, MARGIN, infoY);
  ctx.fillText("paths: " + paths.length + "  points: " + allPoints.length, MARGIN, infoY + 20);

  ctx.fillStyle = "#555";
  ctx.font = "12px monospace";
  ctx.fillText("Hershey Roman Simplex: single-stroke vector font, no bitmap/skeleton needed.", MARGIN, infoY + 50);
  ctx.fillText("Points are sub-pixel, evenly spaced along vector line segments.", MARGIN, infoY + 68);
}

main();
