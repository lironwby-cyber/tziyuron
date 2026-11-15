"""Realistic scan scenes for the sheet detector: different tables, light, angles and papers.
Writes <name>.jpg and scenes.json (true corners in image pixels: tl, tr, br, bl)."""
import sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
rng = np.random.default_rng(11)

def drawing(pw, ph, paper=(246, 243, 236), heavy=False, seed=0):
    r = np.random.default_rng(seed)
    im = Image.new('RGB', (pw, ph), paper)
    d = ImageDraw.Draw(im)
    cols = [(230, 60, 60), (40, 120, 210), (250, 190, 40), (60, 170, 90), (150, 80, 200), (30, 30, 30)]
    for _ in range(14 if not heavy else 6):
        c = cols[r.integers(len(cols))]
        x0, y0 = r.integers(40, pw - 200), r.integers(40, ph - 200)
        k = r.integers(3)
        if k == 0: d.ellipse((x0, y0, x0 + r.integers(60, 260), y0 + r.integers(60, 260)), outline=c, width=int(r.integers(8, 20)))
        elif k == 1: d.line([(int(x0 + r.integers(-150, 150)), int(y0 + r.integers(-150, 150))) for _ in range(5)], fill=c, width=int(r.integers(8, 18)))
        else: d.rectangle((x0, y0, x0 + r.integers(60, 200), y0 + r.integers(60, 200)), outline=c, width=12)
    if heavy:  # big painted areas, one touching the edge
        d.rectangle((0, int(ph * .55), pw, ph), fill=(70, 150, 230))
        d.ellipse((int(pw * .2), int(ph * .1), int(pw * .8), int(ph * .5)), fill=(250, 200, 40))
    return im.filter(ImageFilter.GaussianBlur(1.0))

def table(W, H, kind):
    y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
    if kind == 'dark-wood':
        g = np.sin(x / 9.0 + np.sin(y / 60.0) * 3) * .5 + .5
        return np.stack([110 + 30 * g, 75 + 20 * g, 45 + 12 * g], -1)
    if kind == 'light-wood':
        g = np.sin(x / 14.0 + np.sin(y / 90.0) * 2) * .5 + .5
        return np.stack([214 + 18 * g, 186 + 16 * g, 146 + 12 * g], -1)
    if kind == 'white-table':
        n = rng.normal(0, 2, (H, W))
        return np.stack([228 + n, 228 + n, 226 + n], -1)
    if kind == 'grey-granite':
        n = np.asarray(Image.fromarray((rng.random((H // 4, W // 4)) * 255).astype(np.uint8)).resize((W, H)), float)
        return np.stack([120 + n * .25, 122 + n * .25, 125 + n * .25], -1)
    if kind == 'tablecloth':
        c = (((x // 60) + (y // 60)) % 2)
        return np.stack([200 - 60 * c, 70 + 20 * c, 70 + 20 * c], -1)
    if kind == 'carpet':
        n = rng.normal(0, 18, (H, W))
        return np.stack([70 + n, 85 + n, 110 + n], -1)

def coeffs(src, dst):
    A, B = [], []
    for (xs, ys), (xd, yd) in zip(src, dst):
        A.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd]); B.append(xs)
        A.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd]); B.append(ys)
    return np.linalg.solve(np.array(A, float), np.array(B, float))

def scene(name, kind, quad, W=1600, H=1200, paper=(246, 243, 236), heavy=False, light=0.25, shadow=None, blur=0.0, clutter=False, seed=1):
    pw, ph = 1050, 1485
    p = drawing(pw, ph, paper, heavy, seed)
    c = coeffs([(0, 0), (pw, 0), (pw, ph), (0, ph)], quad)
    warped = np.asarray(p.transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC), float)
    mask = np.asarray(Image.new('L', (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC), float)[..., None] / 255
    base = table(W, H, kind)
    # a soft drop shadow of the paper on the table
    sh = np.asarray(Image.fromarray((mask[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)), float)[..., None] / 255
    base = base * (1 - 0.18 * np.roll(np.roll(sh, 6, 0), 4, 1))
    img = base * (1 - mask) + warped * mask
    if clutter:
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
        d.line((60, 1100, 380, 900), fill=(30, 90, 200), width=22)   # a pen
        d.line((1500, 80, 1560, 600), fill=(240, 200, 30), width=26)  # a crayon
        img = np.asarray(im, float)
    y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
    lightmap = 1.05 - light * ((x / W) * .6 + (y / H) * .4)
    img = img * lightmap[..., None]
    if shadow:  # a phone/hand shadow: dark soft blob
        cx, cy, rad, k = shadow
        dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        img = img * (1 - k * np.clip(1 - dist / rad, 0, 1) ** 0.6)[..., None]
    img += rng.normal(0, 3.5, img.shape)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    if blur: im = im.filter(ImageFilter.GaussianBlur(blur))
    im.save(f'{out}/{name}.jpg', quality=88)
    return name, quad

S = [
    scene('dark-wood', 'dark-wood', [(420, 120), (1230, 190), (1180, 1100), (360, 1030)]),
    scene('light-wood', 'light-wood', [(380, 90), (1210, 140), (1250, 1110), (330, 1080)], seed=2),
    scene('white-table', 'white-table', [(450, 110), (1170, 160), (1130, 1120), (400, 1060)], seed=3),
    scene('steep-angle', 'grey-granite', [(560, 260), (1080, 250), (1420, 1150), (180, 1160)], seed=4),
    scene('hand-shadow', 'light-wood', [(400, 100), (1200, 120), (1220, 1110), (380, 1090)], shadow=(1100, 900, 650, .45), seed=5),
    scene('yellow-paper', 'grey-granite', [(430, 140), (1190, 170), (1160, 1090), (400, 1060)], paper=(250, 220, 90), seed=6),
    scene('painted-to-edge', 'carpet', [(440, 120), (1180, 150), (1150, 1100), (410, 1070)], heavy=True, seed=7),
    scene('tablecloth', 'tablecloth', [(420, 130), (1200, 110), (1220, 1100), (400, 1120)], seed=8),
    scene('clutter-blur', 'dark-wood', [(470, 160), (1170, 200), (1140, 1080), (430, 1040)], clutter=True, blur=1.6, seed=9),
    scene('rotated-landscape', 'light-wood', [(220, 380), (1080, 120), (1380, 760), (520, 1050)], seed=10),
]
json.dump({n: q for n, q in S}, open(f'{out}/scenes.json', 'w'), indent=1)
print('wrote', len(S))
