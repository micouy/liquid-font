export function parseSvgPathD(d: string, spacing: number): number[][][] {
  const tokens: (string | number)[] = [];
  const re = /([a-zA-Z])|([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else tokens.push(parseFloat(m[2]));
  }

  const subPaths: number[][][] = [];
  let current: number[][] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let i = 0;

  function nextNum(): number | null {
    while (i < tokens.length && typeof tokens[i] === 'string') i++;
    if (i >= tokens.length || typeof tokens[i] !== 'number') return null;
    return tokens[i++] as number;
  }

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok !== 'string') { i++; continue; }
    const cmd = tok;
    i++;
    if (cmd === 'M' || cmd === 'm') {
      if (current.length > 0) subPaths.push(current);
      current = [];
      let nx = nextNum(), ny = nextNum();
      if (nx === null || ny === null) continue;
      if (cmd === 'm') { cx += nx; cy += ny; } else { cx = nx; cy = ny; }
      sx = cx; sy = cy;
      current.push([cx, cy]);
      while (i < tokens.length && typeof tokens[i] === 'number') {
        let lx = nextNum(), ly = nextNum();
        if (lx === null || ly === null) break;
        if (cmd === 'm') { cx += lx; cy += ly; } else { cx = lx; cy = ly; }
        current.push([cx, cy]);
      }
    } else if (cmd === 'L' || cmd === 'l') {
      while (i < tokens.length && typeof tokens[i] === 'number') {
        let lx = nextNum(), ly = nextNum();
        if (lx === null || ly === null) break;
        if (cmd === 'l') { cx += lx; cy += ly; } else { cx = lx; cy = ly; }
        current.push([cx, cy]);
      }
    } else if (cmd === 'H' || cmd === 'h') {
      while (i < tokens.length && typeof tokens[i] === 'number') {
        let hx = nextNum();
        if (hx === null) break;
        if (cmd === 'h') cx += hx; else cx = hx;
        current.push([cx, cy]);
      }
    } else if (cmd === 'V' || cmd === 'v') {
      while (i < tokens.length && typeof tokens[i] === 'number') {
        let vy = nextNum();
        if (vy === null) break;
        if (cmd === 'v') cy += vy; else cy = vy;
        current.push([cx, cy]);
      }
    } else if (cmd === 'C' || cmd === 'c') {
      while (i < tokens.length && typeof tokens[i] === 'number') {
        let x1: number, y1: number, x2: number, y2: number, x3: number, y3: number;
        if (cmd === 'c') {
          x1 = cx + nextNum()!; y1 = cy + nextNum()!;
          x2 = cx + nextNum()!; y2 = cy + nextNum()!;
          x3 = cx + nextNum()!; y3 = cy + nextNum()!;
        } else {
          x1 = nextNum()!; y1 = nextNum()!;
          x2 = nextNum()!; y2 = nextNum()!;
          x3 = nextNum()!; y3 = nextNum()!;
        }
        const steps = Math.max(3, Math.ceil(Math.sqrt((x3 - cx) * (x3 - cx) + (y3 - cy) * (y3 - cy)) / spacing));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          current.push([
            mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
            mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
          ]);
        }
        cx = x3; cy = y3;
      }
    } else if (cmd === 'Z' || cmd === 'z') {
      cx = sx; cy = sy;
      current.push([sx, sy]);
    }
  }
  if (current.length > 0) subPaths.push(current);
  return subPaths;
}

export function resampleSubPaths(subPaths: number[][][], spacing: number): number[][][] {
  const resampled: number[][][] = [];
  for (const sub of subPaths) {
    if (sub.length < 2) { resampled.push(sub.map(p => [...p])); continue; }
    const cumLen = [0];
    for (let i = 1; i < sub.length; i++) {
      const dx = sub[i][0] - sub[i - 1][0];
      const dy = sub[i][1] - sub[i - 1][1];
      cumLen.push(cumLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalLen = cumLen[cumLen.length - 1];
    if (totalLen < 0.001) { resampled.push([[sub[0][0], sub[0][1]]]); continue; }
    const numSamples = Math.max(1, Math.ceil(totalLen / spacing));
    const newSub: number[][] = [];
    let segIdx = 0;
    for (let s = 0; s <= numSamples; s++) {
      const targetLen = (s / numSamples) * totalLen;
      while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetLen) segIdx++;
      const segLen = cumLen[segIdx + 1] - cumLen[segIdx];
      const t = segLen > 0 ? (targetLen - cumLen[segIdx]) / segLen : 0;
      newSub.push([
        sub[segIdx][0] + (sub[segIdx + 1][0] - sub[segIdx][0]) * t,
        sub[segIdx][1] + (sub[segIdx + 1][1] - sub[segIdx][1]) * t,
      ]);
    }
    resampled.push(newSub);
  }
  return resampled;
}

export async function loadSvgGlyph(char: string): Promise<{ subPaths: number[][][]; width: number; height: number } | null> {
  const resp = await fetch(`/character-paths/${char}.svg`);
  const text = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');

  const g = doc.querySelector("g[id='layer1']");
  let tx = 0, ty = 0;
  if (g) {
    const transform = g.getAttribute('transform') || '';
    const m = transform.match(/translate\(([^,]+),([^)]+)\)/);
    if (m) { tx = -parseFloat(m[1]); ty = -parseFloat(m[2]); }
  }

  const allSubPaths: number[][][] = [];
  const pathElements = doc.querySelectorAll('path');
  for (const p of pathElements) {
    const d = p.getAttribute('d');
    if (!d) continue;
    const subs = parseSvgPathD(d, 0.15);
    for (const sub of subs) {
      for (const pt of sub) { pt[0] += tx; pt[1] += ty; }
      allSubPaths.push(sub);
    }
  }

  if (allSubPaths.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const sub of allSubPaths) {
    for (const p of sub) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const sub of allSubPaths) {
    for (const p of sub) { p[0] -= cx; p[1] -= cy; }
  }

  return { subPaths: allSubPaths, width: maxX - minX, height: maxY - minY };
}

export function getUniformPoints(subPaths: number[][][], spacing: number): { x: number; y: number }[] {
  const resampled = resampleSubPaths(subPaths, spacing);
  return resampled.flat().map(p => ({ x: p[0], y: p[1] }));
}