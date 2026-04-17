const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = "#111";
ctx.fillRect(0, 0, canvas.width, canvas.height);

const SCALE = 35;
const COLS = 9;
const CELL_W = 220;
const CELL_H = 180;
const MARGIN = 40;

function parseSvgPathD(d, spacing) {
  const tokens = [];
  const re = /([a-zA-Z])|([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else tokens.push(parseFloat(m[2]));
  }

  const subPaths = [];
  let current = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let i = 0;

  function nextNum() {
    while (i < tokens.length && typeof tokens[i] === "string") i++;
    if (i >= tokens.length || typeof tokens[i] !== "number") return null;
    return tokens[i++];
  }

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok !== "string") { i++; continue; }
    const cmd = tok;
    const isRel = cmd === cmd.toLowerCase();
    i++;
    if (cmd === "M" || cmd === "m") {
      if (current.length > 0) subPaths.push(current);
      current = [];
      let nx = nextNum(), ny = nextNum();
      if (cmd === "m") { cx += nx; cy += ny; } else { cx = nx; cy = ny; }
      sx = cx; sy = cy;
      current.push({ x: cx, y: cy });
      while (i < tokens.length && typeof tokens[i] === "number") {
        let lx = nextNum(), ly = nextNum();
        if (lx === null || ly === null) break;
        if (cmd === "m") { cx += lx; cy += ly; } else { cx = lx; cy = ly; }
        current.push({ x: cx, y: cy });
      }
    } else if (cmd === "L" || cmd === "l") {
      while (i < tokens.length && typeof tokens[i] === "number") {
        let lx = nextNum(), ly = nextNum();
        if (lx === null || ly === null) break;
        if (cmd === "l") { cx += lx; cy += ly; } else { cx = lx; cy = ly; }
        current.push({ x: cx, y: cy });
      }
    } else if (cmd === "H" || cmd === "h") {
      while (i < tokens.length && typeof tokens[i] === "number") {
        let hx = nextNum();
        if (hx === null) break;
        if (cmd === "h") cx += hx; else cx = hx;
        current.push({ x: cx, y: cy });
      }
    } else if (cmd === "V" || cmd === "v") {
      while (i < tokens.length && typeof tokens[i] === "number") {
        let vy = nextNum();
        if (vy === null) break;
        if (cmd === "v") cy += vy; else cy = vy;
        current.push({ x: cx, y: cy });
      }
    } else if (cmd === "C" || cmd === "c") {
      while (i < tokens.length && typeof tokens[i] === "number") {
        let x1, y1, x2, y2, x3, y3;
        if (cmd === "c") {
          x1 = cx + nextNum(); y1 = cy + nextNum();
          x2 = cx + nextNum(); y2 = cy + nextNum();
          x3 = cx + nextNum(); y3 = cy + nextNum();
        } else {
          x1 = nextNum(); y1 = nextNum();
          x2 = nextNum(); y2 = nextNum();
          x3 = nextNum(); y3 = nextNum();
        }
        if (x3 === null || y3 === null) break;
        const steps = Math.max(3, Math.ceil(Math.sqrt((x3-cx)*(x3-cx)+(y3-cy)*(y3-cy)) / spacing));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          current.push({
            x: mt*mt*mt*cx + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3,
            y: mt*mt*mt*cy + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3,
          });
        }
        cx = x3; cy = y3;
      }
    } else if (cmd === "Z" || cmd === "z") {
      cx = sx; cy = sy;
      current.push({ x: sx, y: sy });
    }
  }
  if (current.length > 0) subPaths.push(current);
  return subPaths;
}

function resampleSubPaths(subPaths, spacing) {
  const resampled = [];
  for (const sub of subPaths) {
    if (sub.length < 2) { resampled.push([...sub]); continue; }

    // Compute cumulative arc lengths
    const cumLen = [0];
    for (let i = 1; i < sub.length; i++) {
      const dx = sub[i].x - sub[i-1].x;
      const dy = sub[i].y - sub[i-1].y;
      cumLen.push(cumLen[i-1] + Math.sqrt(dx*dx + dy*dy));
    }
    const totalLen = cumLen[cumLen.length - 1];
    if (totalLen < 0.001) { resampled.push([sub[0]]); continue; }

    const numSamples = Math.max(1, Math.ceil(totalLen / spacing));
    const newSub = [];
    let segIdx = 0;
    for (let s = 0; s <= numSamples; s++) {
      const targetLen = (s / numSamples) * totalLen;
      while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetLen) segIdx++;
      const segLen = cumLen[segIdx + 1] - cumLen[segIdx];
      const t = segLen > 0 ? (targetLen - cumLen[segIdx]) / segLen : 0;
      newSub.push({
        x: sub[segIdx].x + (sub[segIdx + 1].x - sub[segIdx].x) * t,
        y: sub[segIdx].y + (sub[segIdx + 1].y - sub[segIdx].y) * t,
      });
    }
    resampled.push(newSub);
  }
  return resampled;
}

async function loadChar(ch) {
  const resp = await fetch(`/character-paths/${ch}.svg`);
  const text = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");

  const g = doc.querySelector("g[id='layer1']");
  let tx = 0, ty = 0;
  if (g) {
    const transform = g.getAttribute("transform") || "";
    const m = transform.match(/translate\(([^,]+),([^)]+)\)/);
    if (m) { tx = -parseFloat(m[1]); ty = -parseFloat(m[2]); }
  }

  const allSubPaths = [];
  const pathElements = doc.querySelectorAll("path");
  for (const p of pathElements) {
    const d = p.getAttribute("d");
    if (!d) continue;
    const subs = parseSvgPathD(d, 0.15);
    for (const sub of subs) {
      for (const pt of sub) { pt.x += tx; pt.y += ty; }
      allSubPaths.push(sub);
    }
  }

  if (allSubPaths.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const flat = allSubPaths.flat();
  for (const p of flat) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of flat) { p.x -= cx; p.y -= cy; }

  return { subPaths: allSubPaths, points: flat, width: maxX - minX, height: maxY - minY };
}

async function main() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px monospace";
  ctx.fillText("SVG traced serif alphabet", MARGIN, 25);

  for (let idx = 0; idx < chars.length; idx++) {
    const ch = chars[idx];
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cellX = MARGIN + col * CELL_W;
    const cellY = MARGIN + 60 + row * CELL_H;

    const data = await loadChar(ch);
    if (!data) continue;

    const resampled = resampleSubPaths(data.subPaths, 0.15);
    const densePts = resampled.flat();

    const charW = (data.width + 0.5) * SCALE;
    const charH = (data.height + 0.5) * SCALE;

    ctx.fillStyle = "#555";
    ctx.font = "12px monospace";
    ctx.fillText(ch + " (" + densePts.length + ")", cellX, cellY);

    ctx.strokeStyle = "#0af";
    ctx.lineWidth = 1;
    for (const sub of data.subPaths) {
      if (sub.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(cellX + sub[0].x * SCALE, cellY + 30 + sub[0].y * SCALE);
      for (let i = 1; i < sub.length; i++) {
        ctx.lineTo(cellX + sub[i].x * SCALE, cellY + 30 + sub[i].y * SCALE);
      }
      ctx.stroke();
    }

    ctx.fillStyle = "#f33";
    for (const p of densePts) {
      ctx.beginPath();
      ctx.arc(cellX + p.x * SCALE, cellY + 30 + p.y * SCALE, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

main();