"""Scenes with several drawings in one photo. Writes multi-*.jpg and multi.json (true corners per sheet: tl, tr, br, bl)."""
import sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
rng = np.random.default_rng(23)

def drawing(pw, ph, seed, paper=(246, 243, 236)):
    r = np.random.default_rng(seed)
    im = Image.new('RGB', (pw, ph), paper); d = ImageDraw.Draw(im)
    cols = [(230, 60, 60), (40, 120, 210), (250, 190, 40), (60, 170, 90), (150, 80, 200), (30, 30, 30)]
    for _ in range(12):
        c = cols[r.integers(len(cols))]
        x0, y0 = int(r.integers(40, pw - 200)), int(r.integers(40, ph - 200))
        k = r.integers(3)
        if k == 0: d.ellipse((x0, y0, x0 + int(r.integers(60, 240)), y0 + int(r.integers(60, 240))), outline=c, width=int(r.integers(8, 18)))
        elif k == 1: d.line([(int(x0 + r.integers(-140, 140)), int(y0 + r.integers(-140, 140))) for _ in range(5)], fill=c, width=int(r.integers(8, 16)))
        else: d.rectangle((x0, y0, x0 + int(r.integers(60, 200)), y0 + int(r.integers(60, 200))), outline=c, width=12)
    return im.filter(ImageFilter.GaussianBlur(1.0))

def table(W, H, kind):
    y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
    if kind == 'dark-wood': base = np.array([86, 58, 36.]); g = np.sin(y / 6 + np.sin(x / 80) * 3) * 10 + np.sin(y / 37) * 6
    elif kind == 'grey': base = np.array([104, 108, 114.]); g = np.sin(x / 45 + y / 70) * 4
    else: base = np.array([176, 140, 96.]); g = np.sin(y / 7 + np.sin(x / 100) * 2) * 9
    return base[None, None, :] + g[..., None] + rng.normal(0, 4, (H, W, 1))

def coeffs(src, dst):
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
    return np.linalg.solve(np.array(A, float), np.array(src, float).reshape(8))

def scene(name, kind, quads, W=1600, H=1200):
    img = table(W, H, kind)
    pw, ph = 800, 1100
    for i, quad in enumerate(quads):
        c = coeffs([(0, 0), (pw, 0), (pw, ph), (0, ph)], quad)
        warped = np.asarray(drawing(pw, ph, 100 + i).transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC), float)
        m = Image.new('L', (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC)
        mask = np.asarray(m, float)[..., None] / 255
        sh = np.asarray(m.filter(ImageFilter.GaussianBlur(9)), float)[..., None] / 255
        img = img * (1 - 0.18 * np.roll(np.roll(sh, 6, 0), 4, 1))
        img = img * (1 - mask) + warped * mask
    y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
    img = img * (1.05 - 0.2 * ((x / W) * .6 + (y / H) * .4))[..., None] + rng.normal(0, 3.5, img.shape)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(f'{out}/{name}.jpg', quality=88)
    return name, quads

S = [
    scene('multi-3-dark', 'dark-wood', [
        [(90, 150), (520, 120), (560, 720), (120, 760)],
        [(610, 330), (1030, 360), (1000, 950), (580, 930)],
        [(1100, 110), (1520, 150), (1490, 740), (1070, 700)]]),
    scene('multi-4-grey', 'grey', [
        [(120, 60), (520, 80), (500, 560), (100, 540)],
        [(1010, 70), (1420, 50), (1440, 540), (1030, 560)],
        [(140, 640), (540, 620), (560, 1130), (160, 1150)],
        [(1000, 630), (1410, 650), (1390, 1140), (980, 1120)]]),
    scene('multi-2-light', 'light-wood', [
        [(150, 220), (720, 180), (760, 1010), (190, 1050)],
        [(880, 190), (1450, 230), (1410, 1040), (840, 1000)]]),
]
json.dump({n: q for n, q in S}, open(f'{out}/multi.json', 'w'), indent=1)
print('wrote', len(S))
