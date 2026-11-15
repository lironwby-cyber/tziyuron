// Browser side of the scan pipeline: decode, detect the sheet, straighten, clean, encode.
import { detectPapers, detectPaper, warpPerspective, warpSize, cleanPaper, scaleCorners, fitScale, fullFrame } from './image.js';

export const PROCESS_MAX = 2400; // longest side of the saved artwork
export const DETECT_MAX = 640; // longest side used for sheet detection
export const THUMB_MAX = 480;

/** Decode a Blob into an ImageBitmap (or canvas) honouring EXIF orientation. */
export async function decode(blob) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function sizeOf(src) {
  return { width: src.naturalWidth || src.videoWidth || src.width, height: src.naturalHeight || src.videoHeight || src.height };
}

export function drawToCanvas(src, maxSide) {
  const { width, height } = sizeOf(src);
  const f = fitScale(width, height, maxSide);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * f));
  c.height = Math.max(1, Math.round(height * f));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { canvas: c, ctx, scale: f };
}

/** The canvas turned clockwise by 0, 90, 180 or 270 degrees (a new canvas, or the same one for 0). */
export function turnCanvas(canvas, degrees) {
  const rot = ((Math.round(degrees / 90) % 4) + 4) % 4;
  if (!rot) return canvas;
  const c = document.createElement('canvas');
  const swap = rot % 2 === 1;
  c.width = swap ? canvas.height : canvas.width;
  c.height = swap ? canvas.width : canvas.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rot * Math.PI / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

function imageDataToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

/** Detect sheet corners. Returned in the coordinates of the source's natural size. */
export function detect(src) {
  const { ctx, canvas, scale } = drawToCanvas(src, DETECT_MAX);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { corners, found } = detectPaper({ data: id.data, width: id.width, height: id.height });
  return { corners: scaleCorners(corners, 1 / scale), found };
}

/** All sheets in a photo (one entry when there is a single sheet or none). Coordinates as in detect(). */
export function detectAll(src) {
  const { ctx, canvas, scale } = drawToCanvas(src, 1024);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectPapers({ data: id.data, width: id.width, height: id.height })
    .map((r) => ({ corners: scaleCorners(r.corners, 1 / scale), found: r.found }));
}

export function fullCorners(src) {
  const { width, height } = sizeOf(src);
  return fullFrame(width, height);
}

/** Crop + straighten (+ optionally clean) at save quality. Returns a canvas. */
const EDGE_INSET = 0.012;

export function processToCanvas(src, corners, { clean = true, maxSide = PROCESS_MAX } = {}) {
  const { width, height } = sizeOf(src);
  // Sample from the full-resolution photo (capped for memory) so the sheet keeps its detail.
  const { ctx, canvas, scale } = drawToCanvas(src, Math.min(Math.max(width, height), 4096));
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Pull the outline in a hair so the sheet's own edge and its shadow never show in the result.
  const cx = corners.reduce((t, p) => t + p.x, 0) / 4, cy = corners.reduce((t, p) => t + p.y, 0) / 4;
  const inner = corners.map((p) => ({ x: p.x + (cx - p.x) * EDGE_INSET, y: p.y + (cy - p.y) * EDGE_INSET }));
  const c = scaleCorners(inner, scale);
  const size = warpSize(c, maxSide);
  let out = warpPerspective({ data: id.data, width: id.width, height: id.height }, c, size.width, size.height);
  if (clean) out = cleanPaper(out);
  return imageDataToCanvas(out);
}

export async function makeThumb(src, max = THUMB_MAX) {
  const { canvas } = drawToCanvas(src, max);
  return canvasToBlob(canvas, 'image/jpeg', 0.82);
}

export async function encodeJpeg(src, max = PROCESS_MAX, quality = 0.9) {
  const { canvas } = drawToCanvas(src, max);
  return canvasToBlob(canvas, 'image/jpeg', quality);
}

/** First frame (or a frame at `t` seconds) of a video Blob, as a canvas. */
export function videoFrame(blob, t = 0.3) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const url = URL.createObjectURL(blob);
    v.src = url;
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('video decode failed')); };
    const timer = setTimeout(fail, 8000);
    v.addEventListener('error', () => { clearTimeout(timer); fail(); });
    v.addEventListener('loadedmetadata', () => {
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      v.currentTime = Math.min(t, Math.max(0, dur - 0.05));
    });
    v.addEventListener('seeked', () => {
      clearTimeout(timer);
      const c = document.createElement('canvas');
      c.width = v.videoWidth || 320;
      c.height = v.videoHeight || 240;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      URL.revokeObjectURL(url);
      resolve({ canvas: c, duration });
    }, { once: true });
  });
}

/** Duration of an audio/video blob in seconds (0 when unknown). */
export function mediaDuration(blob, kind = 'audio') {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    el.preload = 'metadata';
    el.src = url;
    const finish = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    const timer = setTimeout(() => finish(0), 4000);
    el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(el.duration)) { clearTimeout(timer); finish(el.duration); return; }
      // Chrome reports Infinity for fresh MediaRecorder webm until it seeks to the end.
      el.currentTime = 1e9;
      el.addEventListener('timeupdate', () => { clearTimeout(timer); el.currentTime = 0; finish(el.duration); }, { once: true });
    });
    el.addEventListener('error', () => { clearTimeout(timer); finish(0); });
  });
}
