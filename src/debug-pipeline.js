import opentype from "opentype.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = "#111";
ctx.fillRect(0, 0, canvas.width, canvas.height);

const CHAR = "A";
const FONT_SIZE = 100;
const PIXEL_SCALE = 4;
const MARGIN = 40;
const ROW_GAP = 200;

let font = null;

async function loadFont() {
  font = await new Promise((resolve, reject) => {
    opentype.load("/CourierNew.ttf", (err, loadedFont) => {
      if (err) reject(err);
      else resolve(loadedFont);
    });
  });
}

function renderGlyphToBitmap(char, fontSize) {
  const glyph = font.charToGlyph(char);
  const scale = fontSize / font.unitsPerEm;
  const metrics = glyph.getMetrics();
  const width = Math.ceil((metrics.xMax - metrics.xMin) * scale) + 4;
  const height = Math.ceil((metrics.yMax - metrics.yMin) * scale) + 4;

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const cx = c.getContext("2d");

  cx.fillStyle = "white";
  cx.fillRect(0, 0, width, height);

  const path = glyph.getPath(
    -metrics.xMin * scale + 2,
    metrics.yMax * scale + 2,
    fontSize,
  );
  path.fill = "black";
  path.draw(cx);

  const imageData = cx.getImageData(0, 0, width, height);
  const bitmap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    bitmap[i] = imageData.data[i * 4] < 128 ? 1 : 0;
  }

  return { bitmap, width, height, metrics };
}

function skeletonize(bitmap, width, height) {
  const skeleton = new Uint8Array(bitmap);
  let changed = true;

  while (changed) {
    changed = false;

    for (let pass = 0; pass < 2; pass++) {
      const toRemove = [];

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (skeleton[idx] === 0) continue;

          const p2 = skeleton[(y - 1) * width + x];
          const p3 = skeleton[(y - 1) * width + x + 1];
          const p4 = skeleton[y * width + x + 1];
          const p5 = skeleton[(y + 1) * width + x + 1];
          const p6 = skeleton[(y + 1) * width + x];
          const p7 = skeleton[(y + 1) * width + x - 1];
          const p8 = skeleton[y * width + x - 1];
          const p9 = skeleton[(y - 1) * width + x - 1];

          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;

          let A = 0;
          if (p2 === 0 && p3 === 1) A++;
          if (p3 === 0 && p4 === 1) A++;
          if (p4 === 0 && p5 === 1) A++;
          if (p5 === 0 && p6 === 1) A++;
          if (p6 === 0 && p7 === 1) A++;
          if (p7 === 0 && p8 === 1) A++;
          if (p8 === 0 && p9 === 1) A++;
          if (p9 === 0 && p2 === 1) A++;
          if (A !== 1) continue;

          if (pass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }

          toRemove.push(idx);
        }
      }

      if (toRemove.length > 0) changed = true;
      for (const idx of toRemove) {
        skeleton[idx] = 0;
      }
    }
  }

  return skeleton;
}

function renderBitmap(bitmap, width, height, ox, oy, label, scale) {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px monospace";
  ctx.fillText(label, ox, oy - 8);

  ctx.fillStyle = "#222";
  ctx.fillRect(ox, oy, width * scale, height * scale);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[y * width + x] === 1) {
        ctx.fillStyle = "#0af";
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }
}

function renderPoints(points, ox, oy, label, color, scale) {
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px monospace";
  ctx.fillText(label + " (" + points.length + " pts)", ox, oy - 8);

  ctx.fillStyle = color;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(ox + p.x * scale, oy + p.y * scale, scale * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function main() {
  await loadFont();

  const glyph = font.charToGlyph(CHAR);
  const { bitmap, width, height, metrics } = renderGlyphToBitmap(
    CHAR,
    FONT_SIZE,
  );

  const displayW = width * PIXEL_SCALE;
  const displayH = height * PIXEL_SCALE;
  const colGap = 60;

  const col1 = MARGIN;
  const col2 = col1 + displayW + colGap;
  const col3 = col2 + displayW + colGap;
  const row1 = MARGIN + 30;

  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px monospace";
  ctx.fillText(
    "Pipeline debug for '" + CHAR + "' (fontSize=" + FONT_SIZE + ")",
    MARGIN,
    25,
  );

  console.log("Step 1 - Raw Bitmap:", { width, height, metrics });
  renderBitmap(bitmap, width, height, col1, row1, "1. Raw bitmap", PIXEL_SCALE);

  const skeleton = skeletonize(bitmap, width, height);

  console.log("Step 2 - Skeleton:", {
    nonzero: skeleton.filter((x) => x === 1).length,
  });
  renderBitmap(skeleton, width, height, col2, row1, "2. Skeleton", PIXEL_SCALE);

  let points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skeleton[y * width + x] === 1) {
        points.push({ x, y });
      }
    }
  }

  console.log("Step 3 - Points:", { count: points.length });
  renderPoints(points, col3, row1, "3. Raw points", "#0f0", PIXEL_SCALE);

  const { points: tpoints } = getGlyphCenterline(CHAR, {
    fontSize: FONT_SIZE,
    transform: { x: 0, y: 0, scale: 1, scaleY: 1 },
  });

  const row2 = row1 + displayH + ROW_GAP;

  console.log("Step 4 - Transformed:", { count: tpoints.length });
  renderPoints(
    tpoints,
    col1,
    row2,
    "4. Transform (scale=1)",
    "#f55",
    PIXEL_SCALE,
  );

  ctx.fillStyle = "#888";
  ctx.font = "14px monospace";
  const infoY = row2 + displayH + 30;
  ctx.fillText("bitmap size: " + width + " x " + height, MARGIN, infoY);
  ctx.fillText(
    "metrics: xMin=" +
      metrics.xMin +
      " xMax=" +
      metrics.xMax +
      " yMin=" +
      metrics.yMin +
      " yMax=" +
      metrics.yMax,
    MARGIN,
    infoY + 20,
  );
  ctx.fillText("unitsPerEm: " + font.unitsPerEm, MARGIN, infoY + 40);
}

async function getGlyphCenterline(char, options = {}) {
  const { fontSize = 100, spacing = 1, transform = {} } = options;

  const { bitmap, width, height } = renderGlyphToBitmap(char, fontSize);
  const skeleton = skeletonize(bitmap, width, height);

  let points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skeleton[y * width + x] === 1) {
        points.push({ x: x * spacing, y: y * spacing });
      }
    }
  }

  points = applyTransform(points, transform);

  return { points, width, height };
}

function applyTransform(points, transform) {
  const { x = 0, y = 0, rotate = 0, scale = 1, scaleX, scaleY } = transform;
  const sx = scaleX ?? scale;
  const sy = scaleY ?? scale;
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);

  return points.map((p) => {
    const px = p.x * sx;
    const py = p.y * sy;
    return {
      x: px * cos - py * sin + x,
      y: px * sin + py * cos + y,
    };
  });
}

main();
