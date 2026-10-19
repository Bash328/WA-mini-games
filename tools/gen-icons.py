"""Draws the app icon, the launch images and the link-preview banner in the redesigned look.

   python tools/gen-icons.py   (needs Pillow and fonttools+brotli; rewrites icon-*.png, apple-touch-icon.png,
   splash/*.png, og-image.png and favicon.svg)
"""
import os, glob
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

BG = (23, 23, 25)
INK = (20, 18, 27)
TILES = [  # colour, lip, picture
    ((255, 122, 122), (190, 78, 84), 'ring'),
    ((63, 208, 192), (36, 142, 132), 'cross'),
    ((255, 191, 46), (196, 138, 0), 'dice'),
    ((167, 139, 250), (108, 84, 190), 'piece'),
]


def tile(d, x, y, s, color, lip, pic, k):
    """One chunky game tile with a dark outline and a lip underneath. k = pixels per 1/100 of the tile."""
    r = int(s * 0.24)
    ow = max(2, int(s * 0.075))
    lipH = int(s * 0.07)
    d.rounded_rectangle((x, y + lipH, x + s, y + s + lipH), r, fill=INK)                      # the outline + lip block
    d.rounded_rectangle((x + ow, y + ow + lipH, x + s - ow, y + s - ow + lipH), r - ow // 2, fill=lip)
    d.rounded_rectangle((x + ow, y + ow, x + s - ow, y + s - ow), r - ow // 2, fill=color)    # the face
    cx, cy = x + s / 2, y + s / 2
    u = s / 100
    if pic == 'ring':
        d.ellipse((cx - 27 * u, cy - 27 * u, cx + 27 * u, cy + 27 * u), outline=(255, 255, 255), width=int(12 * u))
    elif pic == 'cross':
        w = int(13 * u)
        d.line((cx - 24 * u, cy - 24 * u, cx + 24 * u, cy + 24 * u), fill=(255, 255, 255), width=w)
        d.line((cx - 24 * u, cy + 24 * u, cx + 24 * u, cy - 24 * u), fill=(255, 255, 255), width=w)
        for sx in (-1, 1):
            for sy in (-1, 1):
                d.ellipse((cx + sx * 24 * u - w / 2, cy + sy * 24 * u - w / 2, cx + sx * 24 * u + w / 2, cy + sy * 24 * u + w / 2), fill=(255, 255, 255))
    elif pic == 'dice':
        for px, py in ((-22, -22), (22, -22), (0, 0), (-22, 22), (22, 22)):
            d.ellipse((cx + px * u - 8.5 * u, cy + py * u - 8.5 * u, cx + px * u + 8.5 * u, cy + py * u + 8.5 * u), fill=INK)
    elif pic == 'piece':
        d.ellipse((cx - 28 * u, cy - 28 * u, cx + 28 * u, cy + 28 * u), fill=(255, 255, 255))
        d.ellipse((cx - 15 * u, cy - 15 * u, cx + 15 * u, cy + 15 * u), outline=lip, width=int(8 * u))


def mark(size, scale=0.74):
    """The four-tile mark on a transparent square canvas."""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    box = S * scale
    gap = box * 0.07
    s = (box - gap) / 2
    ox = (S - box) / 2
    oy = (S - box) / 2 - S * 0.012
    for i, (c, l, p) in enumerate(TILES):
        tile(d, ox + (i % 2) * (s + gap), oy + (i // 2) * (s + gap), s, c, l, p, 1)
    return im.resize((size, size), Image.LANCZOS)


def background(size, rounded=False):
    S = size
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # a soft glow behind the mark
    base = Image.new('RGB', (S, S), (30, 32, 52))
    glow = Image.new('L', (S, S), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((S * 0.1, S * 0.05, S * 0.9, S * 0.85), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.18))
    top = Image.new('RGB', (S, S), (58, 66, 118))
    base = Image.composite(top, base, glow)
    im.paste(base.convert('RGBA'), (0, 0))
    if rounded:
        m = Image.new('L', (S * 4, S * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, S * 4 - 1, S * 4 - 1), int(S * 4 * 0.225), fill=255)
        m = m.resize((S, S), Image.LANCZOS)
        im.putalpha(m)
    return im


def icon(size, rounded, scale=0.74):
    bg = background(size, rounded)
    bg.alpha_composite(mark(size, scale))
    return bg


def save_png(im, name, mode='RGBA'):
    out = os.path.join(ROOT, name)
    (im if mode == 'RGBA' else im.convert('RGB')).save(out, optimize=True)
    print('wrote', name, im.size)


save_png(icon(512, True), 'icon-512.png')
save_png(icon(192, True), 'icon-192.png')
save_png(icon(180, False), 'apple-touch-icon.png', 'RGB')            # iOS rounds the corners itself
save_png(icon(512, False, 0.62), 'icon-maskable-512.png', 'RGB')    # the mark stays inside the maskable safe zone

# ---------- launch images ----------
font_path = ttf


def splash(w, h):
    im = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(im)
    side = int(min(w, h) * 0.34)
    ic = icon(side, True).convert('RGBA')
    x, y = (w - side) // 2, int(h * 0.5 - side * 0.72)
    # a soft shadow under the icon
    sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x, y + side * 0.04, x + side, y + side * 1.04), int(side * 0.225), fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(side * 0.05))
    im.paste(sh, (0, 0), sh)
    im.paste(ic, (x, y), ic)
    fs = int(side * 0.2)
    f = ImageFont.truetype(font_path, fs)
    text = 'WA MINI GAMES'
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, y + side + side * 0.14), text, font=f, fill=(255, 255, 255))
    f2 = ImageFont.truetype(font_path, int(fs * 0.55))
    sub = 'Play a friend over WhatsApp'
    sw = d.textlength(sub, font=f2)
    d.text(((w - sw) / 2, y + side + side * 0.14 + fs * 1.35), sub, font=f2, fill=(169, 169, 180))
    return im


for f in sorted(glob.glob(os.path.join(ROOT, 'splash', '*.png'))):
    wh = os.path.basename(f)[:-4].split('x')
    w, h = int(wh[0]), int(wh[1])
    splash(w, h).save(f, optimize=True)
    print('splash', w, h)

# ---------- the link preview banner (1200x300) ----------
W, H = 1200, 300
ban = Image.new('RGB', (W, H), BG)
bd = ImageDraw.Draw(ban)
row = Image.new('RGBA', (W * 2, H * 2), (0, 0, 0, 0))
rd = ImageDraw.Draw(row)
ts = 150 * 2
for i, (c, l, p) in enumerate(TILES):
    tile(rd, 40 * 2 + i * (ts + 24), 60 * 2, ts, c, l, p, 1)
row = row.resize((W, H), Image.LANCZOS)
ban.paste(row, (0, 0), row)
f = ImageFont.truetype(font_path, 92)
bd.text((730, 78), 'WA MINI', font=f, fill=(255, 255, 255))
bd.text((730, 170), 'GAMES', font=f, fill=(255, 191, 46))
ban.save(os.path.join(ROOT, 'og-image.png'), optimize=True)
print('og-image')

# ---------- the favicon: the same four tiles, as shapes ----------
def hexc(c):
    return '#%02x%02x%02x' % c
parts = []
unit = 64
tsz, g0 = 25, 4
x0 = (64 - (2 * tsz + g0)) / 2
for i, (c, l, p) in enumerate(TILES):
    x = x0 + (i % 2) * (tsz + g0)
    y = x0 - 1 + (i // 2) * (tsz + g0)
    parts.append(f'<rect x="{x:.1f}" y="{y + 1.5:.1f}" width="{tsz}" height="{tsz}" rx="6" fill="#14121b"/>')
    parts.append(f'<rect x="{x + 1.8:.1f}" y="{y + 1.8:.1f}" width="{tsz - 3.6}" height="{tsz - 3.6}" rx="4.6" fill="{hexc(c)}"/>')
    cx, cy = x + tsz / 2, y + tsz / 2
    if p == 'ring':
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6" fill="none" stroke="#fff" stroke-width="3"/>')
    elif p == 'cross':
        parts.append(f'<path d="M{cx - 5.5:.1f} {cy - 5.5:.1f}L{cx + 5.5:.1f} {cy + 5.5:.1f}M{cx - 5.5:.1f} {cy + 5.5:.1f}L{cx + 5.5:.1f} {cy - 5.5:.1f}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
    elif p == 'dice':
        for dx, dy in ((-5, -5), (5, -5), (0, 0), (-5, 5), (5, 5)):
            parts.append(f'<circle cx="{cx + dx:.1f}" cy="{cy + dy:.1f}" r="2" fill="#14121b"/>')
    else:
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6.5" fill="#fff"/><circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.4" fill="none" stroke="{hexc(l)}" stroke-width="2"/>')
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#262b4a"/>' + ''.join(parts) + '</svg>\n'
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
