const R = "R".charCodeAt(0);

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

let glyphs = null;

export async function loadHershey() {
  if (glyphs) return glyphs;
  const resp = await fetch("/rowmans.jhf");
  const text = await resp.text();
  glyphs = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    try {
      const g = parseGlyph(line);
      if (g.num < 1000 && !glyphs[g.num]) glyphs[g.num] = g;
    } catch (e) {}
  }
  return glyphs;
}

export function getCharPaths(ch) {
  if (!glyphs) throw new Error("Call loadHershey() first");
  const g = glyphs[charMap[ch]] || glyphs[charMap[" "]];
  return { subPaths: g.subPaths, left: g.left, right: g.right };
}

export function getStringPaths(str) {
  if (!glyphs) throw new Error("Call loadHershey() first");
  const chars = str.split("").map((ch) => {
    const g = glyphs[charMap[ch]] || glyphs[charMap[" "]];
    return { subPaths: g.subPaths, left: g.left, right: g.right };
  });

  let totalWidth = 0;
  for (const c of chars) totalWidth += c.right - c.left;

  const allPaths = [];
  let curX = -totalWidth / 2;
  for (const c of chars) {
    for (const sub of c.subPaths) {
      allPaths.push(sub.map(([px, py]) => [curX - c.left + px, py]));
    }
    curX += c.right - c.left;
  }

  return allPaths;
}

export function resamplePaths(paths, spacing) {
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