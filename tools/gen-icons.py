"""Draws the app icon, the launch images and the link-preview banner: the Sunset look (a coral-to-plum gradient)
   with four chunky tiles knocked slightly crooked.

   python tools/gen-icons.py   (needs Pillow and fonttools+brotli; rewrites icon-*.png, apple-touch-icon.png,
   splash/*.png, og-image.png and favicon.svg)
"""
import os, glob, math, random
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCR = tempfile.gettempdir()

# Lilita One: PIL wants a ttf, the repo has a woff2
ttf = os.path.join(SCR, 'lilita.ttf')
if not os.path.exists(ttf):
    f = TTFont(os.path.join(ROOT, 'fonts', 'lilita-one-latin-400-normal.woff2'))
    f.flavor = None
    f.save(ttf)

INK = (20, 18, 27)
SUN_TOP, SUN_BOTTOM = (255, 128, 96), (140, 44, 124)      # the Sunset gradient
CREAM = (255, 244, 224)
TILES = [  # colour, lip, picture
    ((255, 200, 60), (200, 140, 0), 'ring'),
    ((255, 110, 170), (190, 60, 110), 'cross'),
    ((255, 150, 60), (190, 90, 10), 'dice'),
    ((150, 100, 230), (100, 60, 180), 'piece'),
]
TILT = 7     # degrees: tiles 1 and 4 lean one way, 2 and 3 the other


def gradient(w, h, top=SUN_TOP, bottom=SUN_BOTTOM):
    im = Image.new('RGB', (w, h), top)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line((0, y, w, y), fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im.convert('RGBA')


def tile_img(s, color, lip, pic):
    """One chunky game tile (dark outline, a lip underneath, a picture) on its own transparent canvas."""
    s = int(s)
    pad = int(s * 0.2)
    im = Image.new('RGBA', (s + pad * 2, s + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r, ow, lipH = int(s * 0.24), max(2, int(s * 0.075)), int(s * 0.07)
    x, y = pad, pad
    d.rounded_rectangle((x, y + lipH, x + s, y + s + lipH), r, fill=INK)
    d.rounded_rectangle((x + ow, y + ow + lipH, x + s - ow, y + s - ow + lipH), r - ow // 2, fill=lip)
    d.rounded_rectangle((x + ow, y + ow, x + s - ow, y + s - ow), r - ow // 2, fill=color)
    cx, cy, u = x + s / 2, y + s / 2 - s * 0.01, s / 100
    W = (255, 255, 255)
    if pic == 'ring':
        d.ellipse((cx - 27 * u, cy - 27 * u, cx + 27 * u, cy + 27 * u), outline=W, width=int(12 * u))
    elif pic == 'cross':
        w = int(13 * u)
        d.line((cx - 24 * u, cy - 24 * u, cx + 24 * u, cy + 24 * u), fill=W, width=w)
        d.line((cx - 24 * u, cy + 24 * u, cx + 24 * u, cy - 24 * u), fill=W, width=w)
        for sx in (-1, 1):
            for sy in (-1, 1):
                d.ellipse((cx + sx * 24 * u - w / 2, cy + sy * 24 * u - w / 2, cx + sx * 24 * u + w / 2, cy + sy * 24 * u + w / 2), fill=W)
    elif pic == 'dice':
        for px, py in ((-22, -22), (22, -22), (0, 0), (-22, 22), (22, 22)):
            d.ellipse((cx + px * u - 8.5 * u, cy + py * u - 8.5 * u, cx + px * u + 8.5 * u, cy + py * u + 8.5 * u), fill=INK)
    elif pic == 'piece':
        d.ellipse((cx - 28 * u, cy - 28 * u, cx + 28 * u, cy + 28 * u), fill=W)
        d.ellipse((cx - 15 * u, cy - 15 * u, cx + 15 * u, cy + 15 * u), outline=lip, width=int(8 * u))
    return im


def mark(size, scale=0.74, tilt=TILT):
    """The four tilted tiles on a transparent square canvas."""
    S = size * 3
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    box = S * scale
    gap = box * 0.075
    s = (box - gap) / 2
    ox = (S - box) / 2
    oy = (S - box) / 2 - S * 0.012
    for i, (c, l, p) in enumerate(TILES):
        t = tile_img(s, c, l, p)
        if tilt:
            t = t.rotate(tilt if i in (1, 2) else -tilt, resample=Image.BICUBIC)
        pad = int(int(s) * 0.2)
        im.alpha_composite(t, (int(ox + (i % 2) * (s + gap) - pad), int(oy + (i // 2) * (s + gap) - pad)))
    return im.resize((size, size), Image.LANCZOS)


def icon(size, rounded, scale=0.74):
    im = gradient(size, size)
    im.alpha_composite(mark(size, scale))
    if rounded:
        m = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), int(size * 4 * 0.225), fill=255)
        im.putalpha(m.resize((size, size), Image.LANCZOS))
    return im


def save_png(im, name, mode='RGBA'):
    out = os.path.join(ROOT, name)
    (im if mode == 'RGBA' else im.convert('RGB')).save(out, optimize=True)
    print('wrote', name, im.size)


save_png(icon(512, True), 'icon-512.png')
save_png(icon(192, True), 'icon-192.png')
save_png(icon(180, False), 'apple-touch-icon.png', 'RGB')            # iOS rounds the corners itself
save_png(icon(512, False, 0.62), 'icon-maskable-512.png', 'RGB')    # the mark stays inside the maskable safe zone


# ---------- launch images ----------
def glow(im, cx, cy, r, col, alpha):
    g = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse((cx - r, cy - r, cx + r, cy + r), fill=col + (alpha,))
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(r * 0.42)))


def sparkle(d, cx, cy, r, col):
    d.polygon([(cx, cy - r), (cx + r * 0.26, cy - r * 0.26), (cx + r, cy), (cx + r * 0.26, cy + r * 0.26),
               (cx, cy + r), (cx - r * 0.26, cy + r * 0.26), (cx - r, cy), (cx - r * 0.26, cy - r * 0.26)], fill=col)


def splash(w, h):
    """The Sunset gradient edge to edge, a sun glowing behind the tilted tiles, the name and a few sparkles."""
    im = gradient(w, h)
    short = min(w, h)
    size = int(short * 0.80)
    cx, cy = w // 2, int(h * 0.42)
    glow(im, cx, cy, size * 0.6, (255, 214, 110), 150)
    m = mark(size, 0.82)
    # a soft shadow, then the tiles
    im.alpha_composite(m, (cx - size // 2, cy - size // 2))
    d = ImageDraw.Draw(im)
    rnd = random.Random(7)
    for _ in range(14):                                   # sparkles, kept clear of the tiles
        sx, sy = rnd.randint(int(w * 0.08), int(w * 0.92)), rnd.randint(int(h * 0.06), int(h * 0.94))
        if abs(sx - cx) < size * 0.56 and abs(sy - cy) < size * 0.56:
            continue
        sparkle(d, sx, sy, rnd.choice((short * 0.012, short * 0.018, short * 0.026)), (255, 244, 224, 200))
    fs = int(short * 0.105)
    f = ImageFont.truetype(ttf, fs)
    text = 'WA MINI GAMES'
    tw = d.textlength(text, font=f)
    ty = cy + size // 2 + int(short * 0.07)
    d.text(((w - tw) / 2 + short * 0.006, ty + short * 0.008), text, font=f, fill=INK)        # a hard shadow, like the tiles
    d.text(((w - tw) / 2, ty), text, font=f, fill=CREAM)
    f2 = ImageFont.truetype(ttf, int(fs * 0.5))
    sub = 'Play a friend over WhatsApp'
    sw = d.textlength(sub, font=f2)
    d.text(((w - sw) / 2, ty + fs * 1.3), sub, font=f2, fill=(255, 226, 214))
    return im.convert('RGB')


for f in sorted(glob.glob(os.path.join(ROOT, 'splash', '*.png'))):
    wh = os.path.basename(f)[:-4].split('x')
    w, h = int(wh[0]), int(wh[1])
    splash(w, h).save(f, optimize=True)
    print('splash', w, h)

# ---------- the link preview banner (1200x300) ----------
W, H = 1200, 300
ban = gradient(W, H)
glow(ban, 330, 150, 240, (255, 214, 110), 90)
row = Image.new('RGBA', (W * 2, H * 2), (0, 0, 0, 0))
ts = 140 * 2
for i, (c, l, p) in enumerate(TILES):
    t = tile_img(ts, c, l, p).rotate(TILT if i % 2 == 0 else -TILT, resample=Image.BICUBIC)
    pad = int(ts * 0.2)
    row.alpha_composite(t, (40 * 2 + i * (ts + 26) - pad, 75 * 2 - pad))
ban.alpha_composite(row.resize((W, H), Image.LANCZOS))
bd = ImageDraw.Draw(ban)
f = ImageFont.truetype(ttf, 92)
for dx, dy, col in ((5, 5, INK), (0, 0, CREAM)):
    bd.text((730 + dx, 70 + dy), 'WA MINI', font=f, fill=col)
for dx, dy, col in ((5, 5, INK), (0, 0, (255, 200, 60))):
    bd.text((730 + dx, 162 + dy), 'GAMES', font=f, fill=col)
ban.convert('RGB').save(os.path.join(ROOT, 'og-image.png'), optimize=True)
print('og-image')


# ---------- the favicon: the same four tiles, as shapes ----------
def hexc(c):
    return '#%02x%02x%02x' % c


parts = []
tsz, g0 = 25, 4
x0 = (64 - (2 * tsz + g0)) / 2
for i, (c, l, p) in enumerate(TILES):
    x = x0 + (i % 2) * (tsz + g0)
    y = x0 - 1 + (i // 2) * (tsz + g0)
    cx, cy = x + tsz / 2, y + tsz / 2
    ang = (-6 if i in (0, 3) else 6)
    parts.append(f'<g transform="rotate({ang} {cx:.1f} {cy:.1f})">')
    parts.append(f'<rect x="{x:.1f}" y="{y + 1.5:.1f}" width="{tsz}" height="{tsz}" rx="6" fill="#14121b"/>')
    parts.append(f'<rect x="{x + 1.8:.1f}" y="{y + 1.8:.1f}" width="{tsz - 3.6}" height="{tsz - 3.6}" rx="4.6" fill="{hexc(c)}"/>')
    if p == 'ring':
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6" fill="none" stroke="#fff" stroke-width="3"/>')
    elif p == 'cross':
        parts.append(f'<path d="M{cx - 5.5:.1f} {cy - 5.5:.1f}L{cx + 5.5:.1f} {cy + 5.5:.1f}M{cx - 5.5:.1f} {cy + 5.5:.1f}L{cx + 5.5:.1f} {cy - 5.5:.1f}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
    elif p == 'dice':
        for dx, dy in ((-5, -5), (5, -5), (0, 0), (-5, 5), (5, 5)):
            parts.append(f'<circle cx="{cx + dx:.1f}" cy="{cy + dy:.1f}" r="2" fill="#14121b"/>')
    else:
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6.5" fill="#fff"/><circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.4" fill="none" stroke="{hexc(l)}" stroke-width="2"/>')
    parts.append('</g>')
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
       f'<stop offset="0" stop-color="{hexc(SUN_TOP)}"/><stop offset="1" stop-color="{hexc(SUN_BOTTOM)}"/></linearGradient></defs>'
       '<rect width="64" height="64" rx="14" fill="url(#g)"/>' + ''.join(parts) + '</svg>\n')
open(os.path.join(ROOT, 'favicon.svg'), 'w', encoding='utf-8').write(svg)
print('favicon.svg')

# preview sheet
sheet = Image.new('RGB', (1500, 560), (40, 40, 44))
sheet.paste(icon(512, True).convert('RGBA'), (20, 20), icon(512, True))
sp = Image.open(os.path.join(ROOT, 'splash', '1170x2532.png')).resize((236, 512))
sheet.paste(sp, (560, 20))
bn = Image.open(os.path.join(ROOT, 'og-image.png')).convert('RGB')
sheet.paste(bn, (820, 20))
mk = Image.open(os.path.join(ROOT, 'icon-maskable-512.png')).resize((256, 256))
sheet.paste(mk, (820, 330))
sheet.save(os.path.join(SCR, 'icons_preview.png'))
