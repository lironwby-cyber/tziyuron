// Image processing on plain RGBA buffers: {data: Uint8ClampedArray, width, height}.
// Pure functions so they run both in the browser and in Node tests.

export function makeImage(width, height, data) {
  return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
}

function luminance(d, i) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Otsu threshold over a luminance histogram. */
export function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

// ---------------------------------------------------------------------------------------------
// Sheet detection, like a document scanner.
// Candidates come from two independent methods and the best-supported quadrilateral wins:
//  1. edges: colour gradients -> Hough lines -> pairs of near-parallel lines -> quadrilaterals;
//  2. regions: the largest bright region (helps when an edge is faint).
// Each candidate is scored by how much of its four sides lies on a real edge running along the
// side. The winner is refined to sub-pixel lines on the full-size detection image.
// ---------------------------------------------------------------------------------------------

const EDGE_MAX = 360; // working size of the edge map

/** Area-average downsample into three float channels. */
function channels(img, max) {
  const { width: W, height: H, data } = img;
  const f = Math.min(1, max / Math.max(W, H));
  const w = Math.max(8, Math.round(W * f)), h = Math.max(8, Math.round(H * f));
  const r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h);
  const sx = W / w, sy = H / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let R = 0, G = 0, B = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < H; yy++) {
        for (let xx = x0; xx < x1 && xx < W; xx++) {
          const i = (yy * W + xx) * 4;
          R += data[i]; G += data[i + 1]; B += data[i + 2]; n++;
        }
      }
      const k = y * w + x;
      r[k] = R / n; g[k] = G / n; b[k] = B / n;
    }
  }
  return { w, h, r, g, b, scale: W / w };
}

function boxBlur(a, w, h) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      t[k] = (a[k - (x > 0 ? 1 : 0)] + a[k] + a[k + (x < w - 1 ? 1 : 0)]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      o[k] = (t[k - (y > 0 ? w : 0)] + t[k] + t[k + (y < h - 1 ? w : 0)]) / 3;
    }
  }
  return o;
}

/** Colour gradient: per pixel the strongest of the R, G, B Sobel responses. */
function edgeMap(ch) {
  const { w, h } = ch;
  const planes = [ch.r, ch.g, ch.b].map((p) => boxBlur(boxBlur(p, w, h), w, h));
  const mag = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      let best = 0, bx = 0, by = 0;
      for (const a of planes) {
        const dx = (a[k - w + 1] + 2 * a[k + 1] + a[k + w + 1]) - (a[k - w - 1] + 2 * a[k - 1] + a[k + w - 1]);
        const dy = (a[k + w - 1] + 2 * a[k + w] + a[k + w + 1]) - (a[k - w - 1] + 2 * a[k - w] + a[k - w + 1]);
        const m = dx * dx + dy * dy;
        if (m > best) { best = m; bx = dx; by = dy; }
      }
      mag[k] = Math.sqrt(best); gx[k] = bx; gy[k] = by;
    }
  }
  return { w, h, mag, gx, gy };
}

/** Thin edges (non-maximum suppression) and pick a threshold from the edge strengths. */
function thinEdges(E) {
  const { w, h, mag, gx, gy } = E;
  const keep = new Uint8Array(w * h);
  const vals = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const k = y * w + x, m = mag[k];
      if (m < 24) continue;
      const a = Math.atan2(gy[k], gx[k]);
      const ox = Math.round(Math.cos(a)), oy = Math.round(Math.sin(a));
      if (m >= mag[k + oy * w + ox] && m > mag[k - oy * w - ox]) { keep[k] = 1; vals.push(m); }
    }
  }
  vals.sort((a, b) => a - b);
  // Paper on a pale table gives a faint edge, ink gives strong ones: keep the threshold low and capped.
  const t = Math.max(28, Math.min(60, vals.length ? vals[Math.floor(vals.length * 0.4)] * 0.5 : 28));
  return { keep, t };
}

function houghLines(E, keep, t, maxLines = 28) {
  const { w, h, mag, gx, gy } = E;
  const D = Math.ceil(Math.hypot(w, h));
  const NT = 180, NR = 2 * D + 1;
  const acc = new Float32Array(NT * NR);
  const cos = new Float32Array(NT), sin = new Float32Array(NT);
  for (let i = 0; i < NT; i++) { cos[i] = Math.cos((i * Math.PI) / NT); sin[i] = Math.sin((i * Math.PI) / NT); }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!keep[k] || mag[k] < t * 0.5) continue; // faint paper edges must vote too
      let th = Math.round((Math.atan2(gy[k], gx[k]) * NT) / Math.PI);
      for (let d = -4; d <= 4; d++) {
        let ti = th + d, flip = 1;
        while (ti < 0) { ti += NT; flip = -flip; }
        while (ti >= NT) { ti -= NT; flip = -flip; }
        const rho = x * cos[ti] + y * sin[ti];
        acc[ti * NR + Math.round(rho) + D] += 1;
      }
    }
  }
  // Peaks with suppression of their neighbourhood.
  const peaks = [];
  const minVotes = Math.min(w, h) * 0.12;
  for (let ti = 0; ti < NT; ti++) {
    for (let ri = 1; ri < NR - 1; ri++) {
      const v = acc[ti * NR + ri];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -3; dt <= 3 && isMax; dt++) {
        const tj = (ti + dt + NT) % NT;
        for (let dr = -4; dr <= 4; dr++) {
          if (!dt && !dr) continue;
          const rj = ri + dr;
          if (rj < 0 || rj >= NR) continue;
          const u = acc[tj * NR + rj];
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ theta: (ti * Math.PI) / NT, rho: ri - D, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  // Drop near-duplicates (also across the 0/180 wrap).
  const lines = [];
  for (const p of peaks) {
    if (lines.some((q) => sameLine(p, q))) continue;
    lines.push(p);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

function sameLine(a, b) {
  let dt = Math.abs(a.theta - b.theta), rb = b.rho;
  if (dt > Math.PI / 2) { dt = Math.PI - dt; rb = -rb; }
  return dt < (5 * Math.PI) / 180 && Math.abs(a.rho - rb) < 8;
}

function intersect(a, b) {
  const c1 = Math.cos(a.theta), s1 = Math.sin(a.theta), c2 = Math.cos(b.theta), s2 = Math.sin(b.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * s2 - b.rho * s1) / det, y: (c1 * b.rho - c2 * a.rho) / det };
}

function lineAngleDiff(a, b) {
  let d = Math.abs(a.theta - b.theta);
  return d > Math.PI / 2 ? Math.PI - d : d;
}

/** Order four points clockwise on screen, starting at the corner whose top edge is most level. */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const q = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let best = 0, bestA = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)); // 0 = pointing right, level
    if (ang < bestA) { bestA = ang; best = i; }
  }
  return [0, 1, 2, 3].map((i) => q[(best + i) % 4]);
}

function convexOk(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const sg = Math.sign(cr);
    if (!sg) return false;
    if (!sign) sign = sg; else if (sg !== sign) return false;
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const cosA = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
    if (Math.abs(cosA) > 0.87) return false; // interior angle outside 30..150 degrees
  }
  return true;
}

/** Fraction of each side that runs along a real edge (gradient across the side). */
function sideSupport(E, t, a, b) {
  const { w, h, mag, gx, gy } = E;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(8, Math.round(len));
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  let hits = 0, total = 0;
  for (let i = 1; i < n; i++) {
    const px = a.x + ((b.x - a.x) * i) / n, py = a.y + ((b.y - a.y) * i) / n;
    let ok = false, inside = false;
    for (let o = -2; o <= 2 && !ok; o++) {
      const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      inside = true;
      const k = y * w + x, m = mag[k];
      if (m < t * 0.7) continue;
      const align = Math.abs(gx[k] * nx + gy[k] * ny) / (m || 1);
      if (align > 0.8) ok = true;
    }
    if (!inside) continue; // parts outside the frame do not count either way
    total++;
    if (ok) hits++;
  }
  return total < n * 0.5 ? 0 : hits / total;
}

/**
 * A sheet's margin is one colour along most of a side (paper), while a pattern (tiles, a checked
 * tablecloth) alternates. Returns, per side, the share of points just inside it that match the
 * side's typical colour.
 */
function marginConsistency(ch, q) {
  const { w, h, r, g, b } = ch;
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
  const res = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i], c = q[(i + 1) % 4];
    const cols = [];
    for (let k = 1; k < 24; k++) {
      const t = k / 24;
      let x = a.x + (c.x - a.x) * t, y = a.y + (c.y - a.y) * t;
      const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1;
      const off = Math.min(w, h) * 0.025;
      x = Math.round(x + (dx / d) * off); y = Math.round(y + (dy / d) * off);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x;
      cols.push([r[j], g[j], b[j]]);
    }
    if (cols.length < 8) { res.push(1); continue; }
    const med = [0, 1, 2].map((c2) => cols.map((v) => v[c2]).sort((u, v) => u - v)[cols.length >> 1]);
    const near = cols.filter((v) => Math.hypot(v[0] - med[0], v[1] - med[1], v[2] - med[2]) < 30).length;
    res.push(near / cols.length);
  }
  return res;
}

function scoreQuad(E, t, q) {
  const s = [0, 1, 2, 3].map((i) => sideSupport(E, t, q[i], q[(i + 1) % 4]));
  const min = Math.min(...s), avg = (s[0] + s[1] + s[2] + s[3]) / 4;
  if (min < 0.3) return 0;
  const areaFrac = quadArea(q) / (E.w * E.h);
  return ((avg + min) / 2) * (0.75 + 0.25 * Math.sqrt(areaFrac));
}

function quadOk(q, w, h) {
  const mx = w * 0.08, my = h * 0.08;
  if (q.some((p) => !p || p.x < -mx || p.y < -my || p.x > w + mx || p.y > h + my)) return false;
  const a = quadArea(q);
  return a >= w * h * 0.12 && a <= w * h * 0.995 && convexOk(q);
}

function edgeCandidates(E, lines) {
  const out = [];
  const pairs = [];
  const minSep = Math.min(E.w, E.h) * 0.2;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (lineAngleDiff(lines[i], lines[j]) > (40 * Math.PI) / 180) continue;
      // separation measured at the image centre
      const cx = E.w / 2, cy = E.h / 2;
      const d1 = cx * Math.cos(lines[i].theta) + cy * Math.sin(lines[i].theta) - lines[i].rho;
      const d2 = cx * Math.cos(lines[j].theta) + cy * Math.sin(lines[j].theta) - lines[j].rho;
      const sameSide = lineAngleDiff(lines[i], lines[j]) === Math.abs(lines[i].theta - lines[j].theta);
      const sep = sameSide ? Math.abs(d1 - d2) : Math.abs(d1 + d2);
      if (sep < minSep) continue;
      pairs.push([lines[i], lines[j]]);
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, a2] = pairs[i], [b1, b2] = pairs[j];
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      if (lineAngleDiff(a1, b1) < (40 * Math.PI) / 180) continue;
      const pts = [intersect(a1, b1), intersect(b1, a2), intersect(a2, b2), intersect(b2, a1)];
      if (pts.some((p) => !p)) continue;
      const q = orderCorners(pts);
      if (quadOk(q, E.w, E.h)) out.push(q);
    }
  }
  return out;
}

/** The largest bright region, as up to two quadrilateral guesses. */
function regionCandidates(ch) {
  const { w, h, r, g, b } = ch;
  const gray = new Uint8Array(w * h);
  for (let k = 0; k < gray.length; k++) gray[k] = Math.min(255, 0.299 * r[k] + 0.587 * g[k] + 0.114 * b[k]) | 0;
  const t = otsuThreshold(gray);
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  let bestLabel = 0, bestSize = 0, next = 1;
  for (let s0 = 0; s0 < gray.length; s0++) {
    if (gray[s0] <= t || label[s0]) continue;
    let top = 0, size = 0;
    stack[top++] = s0; label[s0] = next;
    while (top) {
      const p = stack[--top]; size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && gray[p - 1] > t && !label[p - 1]) { label[p - 1] = next; stack[top++] = p - 1; }
      if (x < w - 1 && gray[p + 1] > t && !label[p + 1]) { label[p + 1] = next; stack[top++] = p + 1; }
      if (y > 0 && gray[p - w] > t && !label[p - w]) { label[p - w] = next; stack[top++] = p - w; }
      if (y < h - 1 && gray[p + w] > t && !label[p + w]) { label[p + w] = next; stack[top++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
    next++;
  }
  if (bestSize < w * h * 0.1) return [];
  const ext = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]].map(() => ({ v: -Infinity, p: null }));
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % w, y = (p - x) / w;
    for (let d = 0; d < 8; d++) {
      const v = dirs[d][0] * x + dirs[d][1] * y;
      if (v > ext[d].v) { ext[d].v = v; ext[d].p = { x, y }; }
    }
  }
  const diag = orderCorners([ext[0].p, ext[1].p, ext[3].p, ext[2].p]);
  const axis = orderCorners([ext[4].p, ext[6].p, ext[5].p, ext[7].p]);
  return [diag, axis].filter((q) => quadOk(q, w, h));
}

/** Snap each side to the strongest edge near it on the full detection image, then re-intersect. */
function refineQuad(img, q) {
  const { width: W, height: H, data } = img;
  const px = (x, y, c) => {
    x = Math.min(Math.max(x, 0), W - 1.001); y = Math.min(Math.max(y, 0), H - 1.001);
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const i = (y0 * W + x0) * 4 + c;
    return (data[i] * (1 - fx) + data[i + 4] * fx) * (1 - fy) + (data[i + W * 4] * (1 - fx) + data[i + W * 4 + 4] * fx) * fy;
  };
  const R = Math.max(3, Math.round(Math.max(W, H) / 120));
  const fitted = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const pts = [];
    const n = Math.round(len / 3);
    for (let i = 2; i < n - 1; i++) {
      const t = i / n;
      const cx = a.x + (b.x - a.x) * t, cy = a.y + (b.y - a.y) * t;
      if (cx < 2 || cy < 2 || cx > W - 3 || cy > H - 3) continue;
      let best = 0, bestO = 0;
      for (let o = -R; o <= R; o += 0.5) {
        let d = 0;
        for (let c = 0; c < 3; c++) {
          const v = Math.abs(px(cx + nx * (o + 1), cy + ny * (o + 1), c) - px(cx + nx * (o - 1), cy + ny * (o - 1), c));
          if (v > d) d = v;
        }
        if (d > best) { best = d; bestO = o; }
      }
      if (best > 12) pts.push({ x: cx + nx * bestO, y: cy + ny * bestO });
    }
    if (pts.length < 6) return q;
    // Total least squares line, after dropping the worst quarter of points.
    let line = fitLine(pts);
    const res = pts.map((p) => Math.abs((p.x - line.x) * line.nx + (p.y - line.y) * line.ny)).sort((u, v) => u - v);
    const cut = res[Math.floor(res.length * 0.75)];
    line = fitLine(pts.filter((p) => Math.abs((p.x - line.x) * line.nx + (p.y - line.y) * line.ny) <= cut));
    fitted.push({ theta: Math.atan2(line.ny, line.nx), rho: line.x * line.nx + line.y * line.ny });
  }
  const out = [0, 1, 2, 3].map((i) => intersect(fitted[(i + 3) % 4], fitted[i]));
  if (out.some((p) => !p)) return q;
  // Refinement must not move a corner far: otherwise keep the coarse result.
  const tol = Math.max(W, H) * 0.04;
  if (out.some((p, i) => Math.hypot(p.x - q[i].x, p.y - q[i].y) > tol)) return q;
  return out.map((p) => ({ x: Math.min(Math.max(p.x, 0), W - 1), y: Math.min(Math.max(p.y, 0), H - 1) }));
}

function fitLine(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction of the line
  return { x: mx, y: my, nx: -Math.sin(ang), ny: Math.cos(ang) };
}

/**
 * Find the sheet of paper. Returns {corners: [tl, tr, br, bl], found, score} in image coordinates.
 */
export function detectPaper(img) {
  const { width: w, height: h } = img;
  const ch = channels(img, EDGE_MAX);
  const E = edgeMap(ch);
  const { keep, t } = thinEdges(E);
  const lines = houghLines(E, keep, t);
  const cands = [...edgeCandidates(E, lines), ...regionCandidates(ch)];
  let best = null, bestScore = 0;
  for (const q of cands) {
    let s = scoreQuad(E, t, q);
    if (s > bestScore) {
      // Paper has plain margins on at least two sides; a tiled or checked pattern does not.
      const m = marginConsistency(ch, q).sort((u, v) => v - u);
      if (m[1] < 0.7) s = 0;
    }
    if (s > bestScore) { bestScore = s; best = q; }
  }
  if (!best || bestScore < 0.5) return { corners: fullFrame(w, h), found: false, score: bestScore };
  const coarse = best.map((p) => ({ x: p.x * ch.scale, y: p.y * ch.scale }));
  const corners = orderCorners(refineQuad(img, coarse));
  return { corners, found: true, score: bestScore };
}

/** Copy a rectangle out of an RGBA image. */
function cropImage(img, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * Several sheets in one photo. Bright regions that stand apart are each searched on their own;
 * when fewer than two sheets are found this way the result is the same as detectPaper.
 * Returns [{corners, found, score}], in reading order (top row first, right to left).
 */
export function detectPapers(img, maxSheets = 6) {
  const single = () => [detectPaper(img)];
  const ch = channels(img, 220);
  const { w, h, r, g, b } = ch;
  const gray = new Uint8Array(w * h);
  for (let k = 0; k < gray.length; k++) gray[k] = Math.min(255, 0.299 * r[k] + 0.587 * g[k] + 0.114 * b[k]) | 0;
  const t = otsuThreshold(gray);
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  const boxes = [];
  let next = 1;
  for (let s0 = 0; s0 < gray.length; s0++) {
    if (gray[s0] <= t || label[s0]) continue;
    let top = 0, size = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = s0; label[s0] = next;
    while (top) {
      const p = stack[--top]; size++;
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && gray[p - 1] > t && !label[p - 1]) { label[p - 1] = next; stack[top++] = p - 1; }
      if (x < w - 1 && gray[p + 1] > t && !label[p + 1]) { label[p + 1] = next; stack[top++] = p + 1; }
      if (y > 0 && gray[p - w] > t && !label[p - w]) { label[p - w] = next; stack[top++] = p - w; }
      if (y < h - 1 && gray[p + w] > t && !label[p + w]) { label[p + w] = next; stack[top++] = p + w; }
    }
    const id = next++;
    const boxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
    // A sheet is a solid block: big enough, not the whole frame, and filling most of its box.
    if (size >= w * h * 0.04 && size <= w * h * 0.6 && size >= boxArea * 0.55) boxes.push({ x0, y0, x1, y1, size, id });
  }
  if (boxes.length < 2) return single();
  boxes.sort((u, v) => v.size - u.size);
  // Colour of the table, used to hide neighbouring sheets while one sheet is searched.
  let tr = 0, tg = 0, tb = 0, tn = 0;
  for (let k = 0; k < gray.length; k++) if (gray[k] <= t) { tr += r[k]; tg += g[k]; tb += b[k]; tn++; }
  const tableRgb = tn ? [tr / tn, tg / tn, tb / tn] : [90, 90, 90];
  const sheetIds = new Set(boxes.map((bx) => bx.id));
  const found = [];
  for (const bx of boxes.slice(0, maxSheets)) {
    const mx = (bx.x1 - bx.x0 + 1) * 0.1, my = (bx.y1 - bx.y0 + 1) * 0.1;
    const X0 = Math.max(0, Math.floor((bx.x0 - mx) * ch.scale)), Y0 = Math.max(0, Math.floor((bx.y0 - my) * ch.scale));
    const X1 = Math.min(img.width, Math.ceil((bx.x1 + 1 + mx) * ch.scale)), Y1 = Math.min(img.height, Math.ceil((bx.y1 + 1 + my) * ch.scale));
    if (X1 - X0 < 40 || Y1 - Y0 < 40) continue;
    const crop = cropImage(img, X0, Y0, X1 - X0, Y1 - Y0);
    for (let y = 0; y < crop.height; y++) {
      const ly = Math.min(h - 1, Math.floor((Y0 + y) / ch.scale)) * w;
      for (let x = 0; x < crop.width; x++) {
        const l = label[ly + Math.min(w - 1, Math.floor((X0 + x) / ch.scale))];
        if (l && l !== bx.id && sheetIds.has(l)) {
          const i = (y * crop.width + x) * 4;
          crop.data[i] = tableRgb[0]; crop.data[i + 1] = tableRgb[1]; crop.data[i + 2] = tableRgb[2];
        }
      }
    }
    const res = detectPaper(crop);
    if (!res.found) continue;
    found.push({ corners: res.corners.map((p) => ({ x: p.x + X0, y: p.y + Y0 })), found: true, score: res.score });
  }
  if (found.length < 2) return single();
  const centre = (q) => ({ x: q.corners.reduce((s, p) => s + p.x, 0) / 4, y: q.corners.reduce((s, p) => s + p.y, 0) / 4 });
  const rowH = img.height * 0.25;
  return found.sort((u, v) => {
    const a = centre(u), c = centre(v);
    return Math.abs(a.y - c.y) > rowH ? a.y - c.y : c.x - a.x;
  });
}

export function fullFrame(w, h) {
  return [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
}

export function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Scale corner points by a factor (from preview size to full size). */
export function scaleCorners(corners, f) {
  return corners.map((c) => ({ x: c.x * f, y: c.y * f }));
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error('singular');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography H (3x3, row-major, h33 = 1) that maps each src point to its dst point. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/** Output size of the straightened sheet, from the average edge lengths. */
export function warpSize(c, maxSide = 2400) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2;
  let h = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
  const f = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * f));
  h = Math.max(1, Math.round(h * f));
  return { width: w, height: h };
}

/** Perspective-correct the quad `corners` of `img` into a width x height rectangle. */
export function warpPerspective(img, corners, width, height) {
  const dst = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }];
  const H = homography(dst, corners); // output -> source
  const out = makeImage(width, height);
  const { data: s, width: sw, height: sh } = img;
  const o = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      let sx = (H[0] * x + H[1] * y + H[2]) / w;
      let sy = (H[3] * x + H[4] * y + H[5]) / w;
      sx = Math.min(Math.max(sx, 0), sw - 1);
      sy = Math.min(Math.max(sy, 0), sh - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const oi = (y * width + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = s[i00 + k] * (1 - fx) + s[i10 + k] * fx;
        const bot = s[i01 + k] * (1 - fx) + s[i11 + k] * fx;
        o[oi + k] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}

/**
 * Clean the paper: even out shadows and uneven light, then turn the paper itself pure white
 * so only the child's marks remain. Colours of the drawing are kept.
 *
 * The paper brightness is estimated per cell from pixels that look like paper (low saturation),
 * so large coloured or dark areas of the drawing are not mistaken for paper.
 */
export function cleanPaper(img, { low = 0.78, high = 0.9 } = {}) {
  const { width: w, height: h, data } = img;
  const cell = Math.max(8, Math.round(Math.min(w, h) / 24));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const bg = new Float32Array(gw * gh);
  const valid = new Uint8Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let n = 0, total = 0;
      const x0 = gx * cell, y0 = gy * cell;
      const x1 = Math.min(x0 + cell, w), y1 = Math.min(y0 + cell, h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          total++;
          const mx = Math.max(data[i], data[i + 1], data[i + 2]);
          const mn = Math.min(data[i], data[i + 1], data[i + 2]);
          if (mx - mn > 40) continue; // coloured ink, not paper
          hist[luminance(data, i) | 0]++;
          n++;
        }
      }
      if (n < total * 0.15) continue;
      let acc = 0, v = 255;
      const target = n * 0.9;
      for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= target) { v = t; break; } }
      bg[gy * gw + gx] = v;
      valid[gy * gw + gx] = 1;
    }
  }
  // Cells that are mostly dark ink are not paper either.
  const known = [];
  for (let k = 0; k < bg.length; k++) if (valid[k]) known.push(bg[k]);
  known.sort((a, b) => a - b);
  const median = known.length ? known[known.length >> 1] : 230;
  for (let k = 0; k < bg.length; k++) if (valid[k] && bg[k] < median * 0.6) valid[k] = 0;
  // Fill unknown cells from their known neighbours, growing outwards.
  let missing = valid.reduce((s, v) => s + (v ? 0 : 1), 0);
  if (missing === bg.length) { bg.fill(median); valid.fill(1); missing = 0; }
  while (missing > 0) {
    const next = valid.slice();
    let filled = 0;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const k = gy * gw + gx;
        if (valid[k]) continue;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = gy + dy, xx = gx + dx;
            if (yy < 0 || xx < 0 || yy >= gh || xx >= gw || !valid[yy * gw + xx]) continue;
            sum += bg[yy * gw + xx]; cnt++;
          }
        }
        if (cnt) { bg[k] = sum / cnt; next[k] = 1; filled++; }
      }
    }
    valid.set(next);
    missing -= filled;
    if (!filled) break;
  }
  // Light 3x3 smoothing so cell borders do not show.
  const smooth = new Float32Array(bg.length);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy, xx = gx + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          sum += bg[yy * gw + xx]; cnt++;
        }
      }
      smooth[gy * gw + gx] = Math.max(40, sum / cnt);
    }
  }
  const out = makeImage(w, h);
  const o = out.data;
  const lo = low * 255, hi = high * 255, span = hi - lo;
  for (let y = 0; y < h; y++) {
    const gyf = Math.min(Math.max((y + 0.5) / cell - 0.5, 0), gh - 1);
    const gy0 = Math.floor(gyf), gy1 = Math.min(gy0 + 1, gh - 1), fy = gyf - gy0;
    for (let x = 0; x < w; x++) {
      const gxf = Math.min(Math.max((x + 0.5) / cell - 0.5, 0), gw - 1);
      const gx0 = Math.floor(gxf), gx1 = Math.min(gx0 + 1, gw - 1), fx = gxf - gx0;
      const b = (smooth[gy0 * gw + gx0] * (1 - fx) + smooth[gy0 * gw + gx1] * fx) * (1 - fy)
        + (smooth[gy1 * gw + gx0] * (1 - fx) + smooth[gy1 * gw + gx1] * fx) * fy;
      const i = (y * w + x) * 4;
      // Even out the light: paper brightness becomes 255 everywhere.
      const scale = 255 / b;
      const r = Math.min(255, data[i] * scale), g = Math.min(255, data[i + 1] * scale), bl = Math.min(255, data[i + 2] * scale);
      // Pixels whose darkest channel is near white are paper: blend them to pure white.
      // Ink (any colour) has at least one darker channel, so it is left as is.
      const mn = Math.min(r, g, bl);
      let p = (mn - lo) / span;
      p = p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p);
      o[i] = r + (255 - r) * p; o[i + 1] = g + (255 - g) * p; o[i + 2] = bl + (255 - bl) * p; o[i + 3] = 255;
    }
  }
  return out;
}

/** Scale factor so the longest side fits `max`. */
export function fitScale(w, h, max) {
  return Math.min(1, max / Math.max(w, h));
}
