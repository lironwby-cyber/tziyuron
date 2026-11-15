"""Build a realistic test photo: a child's drawing on paper, shot at an angle on a wooden table,
with uneven light and sensor noise. Writes scene.jpg (+ scene.y4m for the fake camera)."""
import sys, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
W, H = 1600, 1200
rng = np.random.default_rng(7)

# Wooden table
y = np.arange(H)[:, None]; x = np.arange(W)[None, :]
grain = (np.sin(x / 9.0 + np.sin(y / 60.0) * 3) * 0.5 + 0.5)
table = np.stack([110 + 30 * grain, 75 + 20 * grain, 45 + 12 * grain], -1)

# The drawing on an A4-ish sheet
pw, ph = 1050, 1485
paper = Image.new('RGB', (pw, ph), (246, 243, 236))
d = ImageDraw.Draw(paper)
d.ellipse((650, 120, 900, 370), fill=(250, 196, 40))                       # sun
d.polygon([(200, 1250), (520, 520), (840, 1250)], outline=(40, 120, 200), width=22)  # rocket body
d.ellipse((440, 760, 600, 920), outline=(220, 50, 50), width=18)           # window
for i in range(6):
    d.line((120 + i * 150, 1350, 190 + i * 150, 1420), fill=(60, 170, 80), width=16)  # grass
d.line((100, 300, 400, 200), fill=(230, 100, 160), width=12)
paper = paper.filter(ImageFilter.GaussianBlur(1.2))

# Perspective: place the sheet as a tilted quad
quad = [(420, 120), (1230, 190), (1180, 1100), (360, 1030)]  # tl, tr, br, bl in photo
def coeffs(src, dst):
    A = []; B = []
    for (xs, ys), (xd, yd) in zip(src, dst):
        A.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd]); B.append(xs)
        A.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd]); B.append(ys)
    return np.linalg.solve(np.array(A, float), np.array(B, float))
src = [(0, 0), (pw, 0), (pw, ph), (0, ph)]
c = coeffs(src, quad)
warped = paper.transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC)
mask = Image.new('L', (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC)
m = np.asarray(mask, float)[..., None] / 255
img = table * (1 - m) + np.asarray(warped, float) * m

# Uneven light (a lamp from the top-left) and a soft shadow at the bottom right
light = 1.05 - 0.28 * ((x / W) * 0.6 + (y / H) * 0.4)
img = img * light[..., None]
img += rng.normal(0, 3.5, img.shape)
img = np.clip(img, 0, 255).astype(np.uint8)
Image.fromarray(img).save(out + '/scene.jpg', quality=90)
print('quad', quad)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-i', out + '/scene.jpg', '-t', '2', '-vf', 'scale=1280:960,format=yuv420p', '-r', '10', out + '/scene.y4m'], check=True)
