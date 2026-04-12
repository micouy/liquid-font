import opentype from "opentype.js";

let font = null;

export async function loadFont(url = "/CourierNew.ttf") {
  if (font) return font;
  font = await new Promise((resolve, reject) => {
    opentype.load(url, (err, loadedFont) => {
      if (err) reject(err);
      else resolve(loadedFont);
    });
  });
  return font;
}

function renderGlyphToBitmap(char, fontSize) {
  const glyph = font.charToGlyph(char);
  const scale = fontSize / font.unitsPerEm;
  const metrics = glyph.getMetrics();
  const width = Math.ceil((metrics.xMax - metrics.xMin) * scale) + 4;
  const height = Math.ceil((metrics.yMax - metrics.yMin) * scale) + 4;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);

  const path = glyph.getPath(
    -metrics.xMin * scale + 2,
    metrics.yMax * scale + 2,
    fontSize,
  );
  path.fill = "black";
  path.draw(ctx);

  const imageData = ctx.getImageData(0, 0, width, height);
  const bitmap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    bitmap[i] = imageData.data[i * 4] < 128 ? 1 : 0;
  }

  return { bitmap, width, height };
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

export function getGlyphCenterline(char, options = {}) {
  if (!font) throw new Error("Font not loaded. Call loadFont() first.");

  const { fontSize = 100, spacing = 1, transform = {} } = options;

  const glyph = font.charToGlyph(char);
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

  const metrics = glyph.getMetrics();
  const glyphWidth = metrics.xMax - metrics.xMin || 1;
  const glyphHeight = metrics.yMax - metrics.yMin || 1;

  points = applyTransform(points, transform);

  return { points, glyphWidth, glyphHeight };
}
