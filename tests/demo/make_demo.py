# Demo photos for screenshots: eight different child-style drawings, each "photographed" at an angle on a table.
import sys, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
R = np.random.default_rng(5)
PW, PH = 900, 1160

def wob(pts, a=5):
    return [(x + R.normal(0, a), y + R.normal(0, a)) for x, y in pts]
def line(d, pts, col, w=14):
    pts = wob(pts, 3)
    d.line(pts, fill=col, width=w, joint='curve')
    for x, y in pts: d.ellipse([x - w/2, y - w/2, x + w/2, y + w/2], fill=col)
def blob(d, cx, cy, rx, ry, col, n=26):
    pts = [(cx + rx*math.cos(t)*(1+R.normal(0,.05)), cy + ry*math.sin(t)*(1+R.normal(0,.05))) for t in np.linspace(0, 2*math.pi, n, endpoint=False)]
    d.polygon(pts, fill=col)
def ring(d, cx, cy, rx, ry, col, w=14):
    pts = [(cx + rx*math.cos(t), cy + ry*math.sin(t)) for t in np.linspace(0, 2*math.pi, 30)]
    line(d, pts, col, w)
def scribble(d, x0, y0, x1, y1, col, w=16, step=26):
    y = y0; pts = []; k = 0
    while y < y1:
        pts += [(x0 if k % 2 == 0 else x1, y)]; y += step; k += 1
    line(d, pts, col, w)
def sun(d, cx, cy, r):
    blob(d, cx, cy, r, r, (250, 196, 30))
    for t in np.linspace(0, 2*math.pi, 10, endpoint=False):
        line(d, [(cx + math.cos(t)*r*1.25, cy + math.sin(t)*r*1.25), (cx + math.cos(t)*r*1.8, cy + math.sin(t)*r*1.8)], (245, 150, 20), 12)
def grass(d):
    scribble(d, 40, PH-150, PW-40, PH-40, (70, 170, 80), 18, 22)
def stick(d, x, y, h, col):
    ring(d, x, y, h*.16, h*.16, col, 12)
    line(d, [(x, y+h*.16), (x, y+h*.62)], col, 12)
    line(d, [(x-h*.22, y+h*.34), (x+h*.22, y+h*.34)], col, 12)
    line(d, [(x, y+h*.62), (x-h*.18, y+h)], col, 12); line(d, [(x, y+h*.62), (x+h*.18, y+h)], col, 12)

def house(d):
    sun(d, 720, 190, 70); grass(d)
    line(d, [(250,560),(250,1000),(650,1000),(650,560),(250,560)], (200,60,50), 16)
    line(d, [(210,570),(450,330),(690,570)], (60,90,200), 18)
    line(d, [(400,1000),(400,800),(500,800),(500,1000)], (120,70,30), 14)
    line(d, [(300,640),(380,640),(380,720),(300,720),(300,640)], (60,150,200), 12)
def rocket(d):
    for (x,y) in [(150,200),(760,330),(220,880),(700,930),(480,140)]: blob(d, x, y, 16, 16, (250,196,30))
    line(d, [(450,250),(330,520),(330,820),(570,820),(570,520),(450,250)], (60,90,200), 18)
    ring(d, 450, 560, 60, 60, (220,60,60), 14)
    line(d, [(330,740),(230,880),(330,820)], (220,60,60), 16); line(d, [(570,740),(670,880),(570,820)], (220,60,60), 16)
    scribble(d, 380, 840, 520, 1010, (245,150,20), 18, 24)
def flower(d):
    grass(d); line(d, [(450,1000),(440,560)], (50,150,70), 18)
    for t in np.linspace(0, 2*math.pi, 7, endpoint=False): blob(d, 440+math.cos(t)*120, 460+math.sin(t)*120, 74, 74, (235,90,150))
    blob(d, 440, 460, 66, 66, (250,196,30)); blob(d, 560, 780, 80, 36, (70,170,80))
def family(d):
    sun(d, 160, 170, 60); grass(d)
    stick(d, 220, 420, 520, (60,90,200)); stick(d, 450, 470, 470, (200,60,140)); stick(d, 650, 640, 300, (230,120,30)); stick(d, 790, 700, 240, (60,150,90))
def rainbow(d):
    for i, c in enumerate([(220,50,50),(245,150,20),(250,205,40),(70,170,80),(60,110,210),(140,80,190)]):
        r = 380 - i*46
        line(d, [(450+math.cos(t)*r, 760-math.sin(t)*r) for t in np.linspace(0, math.pi, 26)], c, 30)
    blob(d, 110, 790, 110, 60, (170,200,235)); blob(d, 790, 790, 110, 60, (170,200,235))
def fish(d):
    scribble(d, 40, 60, PW-40, PH-60, (150,205,240), 30, 60)
    blob(d, 420, 580, 250, 150, (245,140,30)); d.polygon(wob([(650,580),(820,440),(820,720)],6), fill=(245,140,30))
    blob(d, 320, 540, 34, 34, (255,255,255)); blob(d, 316, 544, 14, 14, (30,30,40))
    for x in (430, 510, 590): line(d, [(x,480),(x-30,580),(x,680)], (200,80,20), 12)
def cat(d):
    ring(d, 450, 640, 220, 200, (90,90,100), 18); line(d, [(280,520),(250,330),(390,460)], (90,90,100), 18); line(d, [(620,520),(650,330),(510,460)], (90,90,100), 18)
    blob(d, 370, 600, 26, 34, (60,160,90)); blob(d, 530, 600, 26, 34, (60,160,90)); blob(d, 450, 680, 22, 16, (235,90,150))
    for s in (-1, 1):
        for dy in (-20, 10, 40): line(d, [(450+s*40, 700), (450+s*230, 690+dy*1.6)], (60,60,70), 8)
    line(d, [(450,700),(410,750)], (60,60,70), 10); line(d, [(450,700),(490,750)], (60,60,70), 10)
def car(d):
    sun(d, 720, 170, 60); line(d, [(40,930),(PW-40,930)], (80,80,90), 20)
    line(d, [(150,800),(150,640),(320,640),(390,480),(610,480),(680,640),(780,640),(780,800),(150,800)], (220,50,50), 18)
    ring(d, 300, 830, 80, 80, (40,40,50), 22); ring(d, 640, 830, 80, 80, (40,40,50), 22)
    line(d, [(410,520),(590,520),(630,630),(370,630),(410,520)], (60,150,210), 12)

DRAW = dict(house=house, rocket=rocket, flower=flower, family=family, rainbow=rainbow, fish=fish, cat=cat, car=car)

def table(W, H, kind):
    yy, xx = np.mgrid[0:H, 0:W]
    if kind == 'wood':
        base = np.array([120, 80, 45], float); g = np.sin(yy/7 + np.sin(xx/90)*3)*12 + np.sin(yy/31)*8
    elif kind == 'grey':
        base = np.array([95, 100, 108], float); g = np.sin(xx/50)*3
    else:
        base = np.array([60, 95, 130], float); g = np.sin((xx+yy)/40)*5
    img = base[None, None, :] + g[..., None] + R.normal(0, 4, (H, W, 1))
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
def coeffs(src, dst):
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]]
    return np.linalg.solve(np.array(A, float), np.array(src, float).reshape(8))

for i, (name, fn) in enumerate(DRAW.items()):
    paper = Image.new('RGB', (PW, PH), (247, 244, 236)); fn(ImageDraw.Draw(paper))
    paper = paper.filter(ImageFilter.GaussianBlur(0.8))
    W, H = 1600, 2000
    bg = table(W, H, ['wood', 'grey', 'blue'][i % 3])
    j = lambda v: v + R.integers(-70, 70)
    quad = [(j(260), j(300)), (j(1340), j(340)), (j(1400), j(1700)), (j(220), j(1660))]
    c = coeffs([(0, 0), (PW, 0), (PW, PH), (0, PH)], quad)
    warped = paper.transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC)
    mask = Image.new('L', (PW, PH), 255).transform((W, H), Image.PERSPECTIVE, tuple(c), Image.BICUBIC)
    sh = mask.filter(ImageFilter.GaussianBlur(14)).point(lambda v: int(v*0.45))
    bg.paste(Image.new('RGB', (W, H), (20, 15, 10)), (10, 14), sh)
    bg.paste(warped, (0, 0), mask)
    yy, xx = np.mgrid[0:H, 0:W]
    light = 0.8 + 0.3*(xx/W)*(1 - yy/H*0.5)
    arr = np.clip(np.asarray(bg, float)*light[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(os.path.join(out, name + '.jpg'), quality=90)
print('ok')
