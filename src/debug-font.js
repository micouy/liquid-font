import { loadFont, getGlyphCenterline } from './font-paths.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, canvas.width, canvas.height);

(async () => {
  await loadFont();

  const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const renderSize = 200;
  const displayScale = 0.5;
  const cols = 9;
  const cellW = 140;
  const cellH = 140;
  const startX = 60;
  const startY = 100;
  const pointRadius = (renderSize * displayScale) / 40;

  ctx.fillStyle = '#333';
  ctx.font = '12px monospace';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = startX + col * cellW;
    const oy = startY + row * cellH;

    const { points } = getGlyphCenterline(char, {
      fontSize: renderSize,
      spacing: 1,
      transform: {
        x: ox,
        y: oy,
        scale: displayScale,
        scaleY: displayScale,
      },
    });

    ctx.fillStyle = '#222';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#999';
    ctx.fillText(char, ox, oy - 10);
  }
})();
