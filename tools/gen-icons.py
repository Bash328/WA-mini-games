"""Draws the app icon, the launch images and the link-preview banner: the flat cream look (four flat tiles on cream).

   python tools/gen-icons.py   (needs Pillow and fonttools+brotli; rewrites icon-*.png, apple-touch-icon.png,
   splash/*.png, og-image.png and favicon.svg)
"""
import os, glob
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

import tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCR = tempfile.gettempdir()

# Lilita One: PIL wants a ttf, the repo has a woff2
ttf = os.path.join(SCR, 'lilita.ttf')
if not os.path.exists(ttf):
    f = TTFont(os.path.join(ROOT, 'assets', 'fonts', 'lilita-one-latin-400-normal.woff2'))
    f.flavor = None
    f.save(ttf)

CREAM = (243, 238, 230)
INK = (42, 34, 48)
MUTED = (122, 112, 128)
TILES = [  # colour, picture
    ((244, 183, 64), 'ring'),
    ((229, 88, 122), 'cross'),
    ((224, 133, 65), 'dice'),
    ((139, 111, 214), 'target'),
]


def tile(d, x, y, s, color, pic):
    """One flat tile (no outline, no lip) with a cream picture. All sizes are fractions of the tile size s."""
    d.rounded_rectangle((x, y, x + s, y + s), int(s * 0.25), fill=color)
    cx, cy = x + s / 2, y + s / 2
    u = s / 100
    if pic == 'ring':
        d.ellipse((cx - 33 * u, cy - 33 * u, cx + 33 * u, cy + 33 * u), fill=CREAM)
        d.ellipse((cx - 21 * u, cy - 21 * u, cx + 21 * u, cy + 21 * u), fill=color)
    elif pic == 'cross':
        w = int(12.5 * u)
        for sy in (1, -1):
            d.line((cx - 25 * u, cy - sy * 25 * u, cx + 25 * u, cy + sy * 25 * u), fill=CREAM, width=w)
        for sx in (-1, 1):
            for sy in (-1, 1):
                d.ellipse((cx + sx * 25 * u - w / 2, cy + sy * 25 * u - w / 2, cx + sx * 25 * u + w / 2, cy + sy * 25 * u + w / 2), fill=CREAM)
    elif pic == 'dice':
        for px, py in ((-23, -23), (23, -23), (0, 0), (-23, 23), (23, 23)):
            d.ellipse((cx + px * u - 11.5 * u, cy + py * u - 11.5 * u, cx + px * u + 11.5 * u, cy + py * u + 11.5 * u), fill=CREAM)
    elif pic == 'target':
        d.ellipse((cx - 33 * u, cy - 33 * u, cx + 33 * u, cy + 33 * u), fill=CREAM)
        d.ellipse((cx - 21 * u, cy - 21 * u, cx + 21 * u, cy + 21 * u), fill=color)
        d.ellipse((cx - 7.5 * u, cy - 7.5 * u, cx + 7.5 * u, cy + 7.5 * u), fill=CREAM)


def mark(size, scale=0.78):
    """The four flat tiles on a transparent square canvas."""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    box = S * scale
    gap = box * 0.107
    s = (box - gap) / 2
    ox = oy = (S - box) / 2
    for i, (c, p) in enumerate(TILES):
        tile(d, ox + (i % 2) * (s + gap), oy + (i // 2) * (s + gap), s, c, p)
    return im.resize((size, size), Image.LANCZOS)


def icon(size, rounded, scale=0.78):
    im = Image.new('RGBA', (size, size), CREAM + (255,))
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
def splash(w, h):
    """Flat cream, the four tiles, the name in ink and a quiet line under it."""
    im = Image.new('RGBA', (w, h), CREAM + (255,))
    short = min(w, h)
    size = int(short * 0.62)
    cx, cy = w // 2, int(h * 0.43)
    im.alpha_composite(mark(size, 0.9), (cx - size // 2, cy - size // 2))
    d = ImageDraw.Draw(im)
    fs = int(short * 0.09)
    f = ImageFont.truetype(ttf, fs)
    text = 'WA MINI GAMES'
    tw = d.textlength(text, font=f)
    ty = cy + size // 2 + int(short * 0.06)
    d.text(((w - tw) / 2, ty), text, font=f, fill=INK)
    f2 = ImageFont.truetype(ttf, int(fs * 0.5))
    sub = 'Play a friend over WhatsApp'
    sw = d.textlength(sub, font=f2)
    d.text(((w - sw) / 2, ty + fs * 1.3), sub, font=f2, fill=MUTED)
    return im.convert('RGB')


for f in sorted(glob.glob(os.path.join(ROOT, 'splash', '*.png'))):
    wh = os.path.basename(f)[:-4].split('x')
    w, h = int(wh[0]), int(wh[1])
    splash(w, h).save(f, optimize=True)
    print('splash', w, h)

# ---------- the link preview banner (1200x300) ----------
W, H = 1200, 300
ban = Image.new('RGBA', (W, H), CREAM + (255,))
row = Image.new('RGBA', (W * 4, H * 4), (0, 0, 0, 0))
rd = ImageDraw.Draw(row)
ts = 150 * 4
for i, (c, p) in enumerate(TILES):
    tile(rd, 60 * 4 + i * (ts + 30 * 4), 75 * 4, ts, c, p)
ban.alpha_composite(row.resize((W, H), Image.LANCZOS))
bd = ImageDraw.Draw(ban)
f = ImageFont.truetype(ttf, 92)
bd.text((790, 66), 'WA MINI', font=f, fill=INK)
bd.text((790, 158), 'GAMES', font=f, fill=TILES[2][0])
ban.convert('RGB').save(os.path.join(ROOT, 'og-image.png'), optimize=True)
print('og-image')


# ---------- the favicon: the same four tiles, as shapes ----------
def hexc(c):
    return '#%02x%02x%02x' % c


cream, parts = hexc(CREAM), []
tsz, g0 = 22.4, 6.8
x0 = (64 - (2 * tsz + g0)) / 2
for i, (c, p) in enumerate(TILES):
    x = x0 + (i % 2) * (tsz + g0)
    y = x0 + (i // 2) * (tsz + g0)
    cx, cy, u = x + tsz / 2, y + tsz / 2, tsz / 100
    parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{tsz}" height="{tsz}" rx="{tsz * 0.25:.1f}" fill="{hexc(c)}"/>')
    if p == 'ring':
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{27 * u:.1f}" fill="none" stroke="{cream}" stroke-width="{12 * u:.1f}"/>')
    elif p == 'cross':
        parts.append(f'<path d="M{cx - 25 * u:.1f} {cy - 25 * u:.1f}L{cx + 25 * u:.1f} {cy + 25 * u:.1f}M{cx - 25 * u:.1f} {cy + 25 * u:.1f}L{cx + 25 * u:.1f} {cy - 25 * u:.1f}" stroke="{cream}" stroke-width="{12.5 * u:.1f}" stroke-linecap="round"/>')
    elif p == 'dice':
        for dx, dy in ((-23, -23), (23, -23), (0, 0), (-23, 23), (23, 23)):
            parts.append(f'<circle cx="{cx + dx * u:.1f}" cy="{cy + dy * u:.1f}" r="{11.5 * u:.1f}" fill="{cream}"/>')
    else:
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{27 * u:.1f}" fill="none" stroke="{cream}" stroke-width="{12 * u:.1f}"/><circle cx="{cx:.1f}" cy="{cy:.1f}" r="{7.5 * u:.1f}" fill="{cream}"/>')
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="' + cream + '"/>' + ''.join(parts) + '</svg>\n')
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
