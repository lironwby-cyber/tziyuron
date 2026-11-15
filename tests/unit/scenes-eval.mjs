// Evaluate the sheet detector on the realistic scenes. Prints corner error per scene (% of diagonal).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPaper } from '../../js/image.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'scenes');
export function loadScene(name, max = 640) {
  const raw = execFileSync('python3', ['-c', `from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert('RGBA');W=im.size[0];im.thumbnail((${max},${max}));sys.stdout.buffer.write(W.to_bytes(2,'little')+im.size[0].to_bytes(2,'little')+im.size[1].to_bytes(2,'little')+im.tobytes())`, join(dir, name + '.jpg')], { maxBuffer: 1e8 });
  const W = raw.readUInt16LE(0), w = raw.readUInt16LE(2), h = raw.readUInt16LE(4);
  return { img: { width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 6, w * h * 4) }, scale: W / w };
}
export const truth = JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8'));
export function evalScene(name) {
  const { img, scale } = loadScene(name);
  const r = detectPaper(img);
  const diag = Math.hypot(1600, 1200);
  const err = Math.max(...r.corners.map((c, i) => Math.hypot(c.x * scale - truth[name][i][0], c.y * scale - truth[name][i][1]))) / diag * 100;
  return { found: r.found, err };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const n of Object.keys(truth)) {
    const t = performance.now();
    const { found, err } = evalScene(n);
    console.log(n.padEnd(20), found ? 'found' : 'MISS ', err.toFixed(2) + '%', (performance.now() - t).toFixed(0) + 'ms');
  }
}
