// Isometric pixel scenery, drawn in code (SVG). Written fresh for this
// project. Pure functions that return SVG elements, no server calls,
// so the visual layer can be restyled or animated freely.
//
//   island({ cx, cy, cols, rows, seed, accent })  dark isometric slab with small buildings
//   pixelIsland({ cx, cy, seed })                 green top, brown base, water ring (report)
//   bridge(a, b)                                  curved bridge between two points + packet dot
//   sky({ width })                                sun and pixel clouds

const NS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const k of kids) e.append(k);
  return e;
}

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const diamond = (x, y, w, h) => `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;

function cube(x, y, w, h, z, top, left, right) {
  // x,y is the centre of the top face's base diamond; z is the cube height
  return el("g", {}, [
    el("polygon", { points: `${x - w / 2},${y} ${x},${y + h / 2} ${x},${y + h / 2 - z} ${x - w / 2},${y - z}`, fill: left }),
    el("polygon", { points: `${x + w / 2},${y} ${x},${y + h / 2} ${x},${y + h / 2 - z} ${x + w / 2},${y - z}`, fill: right }),
    el("polygon", { points: diamond(x, y - z, w, h), fill: top }),
  ]);
}

export function island({ cx, cy, cols = 8, rows = 6, seed = 1, accent = "#df3d2a" }) {
  const r = rng(seed);
  const tw = 12, th = 6;
  const g = el("g", { class: "island-body" });
  const shades = ["#221e19", "#2a251f", "#322c24", "#3b342b"];
  const cells = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // ellipse mask so the slab reads as an island, with ragged edges
      const nx = (i - (cols - 1) / 2) / (cols / 2), ny = (j - (rows - 1) / 2) / (rows / 2);
      if (nx * nx + ny * ny > 0.95 + (r() - 0.5) * 0.3) continue;
      cells.push([i, j]);
    }
  }
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const pos = ([i, j]) => [cx + (i - j) * (tw / 2), cy + (i + j) * (th / 2) - ((cols + rows) * th) / 4];
  for (const c of cells) {
    const [x, y] = pos(c);
    g.append(cube(x, y, tw, th, 4 + Math.floor(r() * 3), shades[Math.floor(r() * shades.length)], "#14100c", "#1c1813"));
  }
  const palette = ["#ffe9c4", "#4ade80", accent, "#ffe9c4", "#5cc8ff"];
  const n = Math.max(3, Math.floor(cells.length / 9));
  for (let k = 0; k < n; k++) {
    const c = cells[Math.floor(r() * cells.length)];
    const [x, y] = pos(c);
    const col = k === 0 ? accent : palette[Math.floor(r() * palette.length)];
    g.append(cube(x, y - 6, 5, 2.5, 3 + Math.floor(r() * 5), col, "#9b8f77", "#776d59"));
  }
  return g;
}

export function pixelIsland({ cx, cy, seed = 7 }) {
  const r = rng(seed);
  const tw = 14, th = 7, cols = 9, rows = 7;
  const g = el("g", { class: "pixel-island" });
  const pos = (i, j) => [cx + (i - j) * (tw / 2), cy + (i + j) * (th / 2) - ((cols + rows) * th) / 4];
  const all = [];
  for (let i = -1; i <= cols; i++) for (let j = -1; j <= rows; j++) all.push([i, j]);
  all.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [i, j] of all) {
    const nx = (i - (cols - 1) / 2) / (cols / 2 + 0.6), ny = (j - (rows - 1) / 2) / (rows / 2 + 0.6);
    const d = nx * nx + ny * ny;
    if (d > 1.15) continue;
    const [x, y] = pos(i, j);
    if (d > 0.82) {
      g.append(el("polygon", { points: diamond(x, y + 3, tw, th), fill: r() > 0.5 ? "#5cc8ff" : "#7ed3ff" }));
    } else {
      const grass = ["#4c9a3f", "#56a548", "#448b38"][Math.floor(r() * 3)];
      g.append(cube(x, y, tw, th, 7, grass, "#7a5230", "#5f3f24"));
    }
  }
  for (let k = 0; k < 7; k++) {
    const i = 2 + Math.floor(r() * (cols - 4)), j = 2 + Math.floor(r() * (rows - 4));
    const [x, y] = pos(i, j);
    g.append(cube(x, y - 7, 5, 2.5, 6, "#2f7a2c", "#235c21", "#1c4a1a"));
  }
  const [bx, by] = pos(4, 3);
  g.append(cube(bx, by - 7, 9, 4.5, 9, "#ffffff", "#d8d4c9", "#b7b2a6"), cube(bx, by - 16, 9, 4.5, 3, "#df3d2a", "#b6301f", "#8f2618"));
  return g;
}

export function bridge(a, b, { id = "", delay = 0, dur = 7 } = {}) {
  const mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]) - 46;
  const d = `M ${a[0]} ${a[1]} Q ${mx} ${my} ${b[0]} ${b[1]}`;
  const path = el("path", { d, class: "bridge", "data-link": id });
  const t = 0.5;
  const px = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mx + t * t * b[0];
  const py = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * my + t * t * b[1];
  const packet = el("rect", { class: "packet", x: px - 2, y: py - 2, width: 4, height: 4 });
  // Reduced motion: the dot rests at the bridge midpoint, as before.
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    packet.setAttribute("x", "-2");
    packet.setAttribute("y", "-2");
    packet.setAttribute("opacity", "0");
    // SMIL so the dot follows the drawn curve in every browser; the
    // negative begin spreads packets along the bridges immediately.
    packet.append(
      el("animateMotion", { dur: `${dur}s`, begin: `${delay}s`, repeatCount: "indefinite", path: d, rotate: "0" }),
      el("animate", { attributeName: "opacity", values: "0;1;1;0", keyTimes: "0;0.08;0.88;1", dur: `${dur}s`, begin: `${delay}s`, repeatCount: "indefinite" }),
    );
  }
  return el("g", {}, [path, packet]);
}

export function sky({ width = 800 } = {}) {
  const g = el("g", { class: "sky" });
  const defs = el("defs");
  const grad = el("linearGradient", { id: "sky-grad", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(
    el("stop", { offset: "0%", "stop-color": "#14112e" }),
    el("stop", { offset: "55%", "stop-color": "#2e1c3c" }),
    el("stop", { offset: "100%", "stop-color": "#55262f" }),
  );
  const glow = el("radialGradient", { id: "horizon-glow", cx: "50%", cy: "100%", r: "75%" });
  glow.append(
    el("stop", { offset: "0%", "stop-color": "#ff8a3d", "stop-opacity": "0.4" }),
    el("stop", { offset: "100%", "stop-color": "#ff8a3d", "stop-opacity": "0" }),
  );
  const moon = el("radialGradient", { id: "moon-glow" });
  moon.append(
    el("stop", { offset: "0%", "stop-color": "#ffd9a0", "stop-opacity": "0.5" }),
    el("stop", { offset: "100%", "stop-color": "#ffd9a0", "stop-opacity": "0" }),
  );
  defs.append(grad, glow, moon);
  g.append(defs, el("rect", { x: -10, y: -10, width: width + 20, height: 480, fill: "url(#sky-grad)" }));
  const r = rng(99);
  for (let i = 0; i < 34; i++) {
    g.append(el("circle", {
      class: "star", cx: (r() * width).toFixed(1), cy: (r() * 270).toFixed(1),
      r: (r() * 1.3 + 0.5).toFixed(2), fill: "#f4efe4",
      opacity: (0.35 + r() * 0.6).toFixed(2), style: `--d:${(r() * 3).toFixed(2)}s`,
    }));
  }
  g.append(
    el("circle", { class: "halo", cx: width * 0.78, cy: 84, r: 40, fill: "url(#moon-glow)" }),
    el("circle", { cx: width * 0.78, cy: 84, r: 13, fill: "#ffe9c4" }),
    el("circle", { cx: width * 0.78 - 5, cy: 80, r: 3, fill: "#e8cba0", opacity: 0.7 }),
    el("circle", { cx: width * 0.78 + 4, cy: 88, r: 2, fill: "#e8cba0", opacity: 0.6 }),
  );
  g.append(el("ellipse", { cx: width / 2, cy: 440, rx: width * 0.62, ry: 95, fill: "url(#horizon-glow)" }));
  return g;
}
