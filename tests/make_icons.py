"""Generate the Checkpoint app icons (run: python3 tests/make_icons.py)."""
from PIL import Image, ImageDraw, ImageFilter
import os

# v2 Part G: Paper. Cream ground, ink ring, the check in the "live" green; no glow.
BG = (244, 239, 230, 255)    # --bg  #F4EFE6
INK = (28, 26, 23, 255)      # --ink #1C1A17
LIVE = (94, 140, 115, 255)   # --live #5E8C73
LINE = (218, 209, 192, 255)  # --line #DAD1C0
OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def draw_mark(draw, s, color, width_scale=1.0):
    c = s / 2
    r = s * 0.30
    w = int(s * 0.055 * width_scale)
    draw.ellipse([c - r, c - r, c + r, c + r], outline=color, width=w)
    pts = [(s * 0.385, s * 0.505), (s * 0.470, s * 0.590), (s * 0.630, s * 0.420)]
    draw.line(pts, fill=color, width=w, joint="curve")
    for p in (pts[0], pts[-1]):
        draw.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=color)


def make(size, name):
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), BG)
    d = ImageDraw.Draw(img)
    c = s / 2
    for r in (0.40, 0.355):  # the outlined rings of the Waiting screen, faint
        d.ellipse([c - s * r, c - s * r, c + s * r, c + s * r], outline=LINE, width=max(1, int(s * 0.008)))
    w = int(s * 0.05)
    rr = s * 0.30
    d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=INK, width=w)
    pts = [(s * 0.385, s * 0.505), (s * 0.470, s * 0.590), (s * 0.630, s * 0.420)]
    d.line(pts, fill=LIVE, width=w, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=LIVE)
    img = img.resize((size, size), Image.LANCZOS).convert("RGB")
    img.save(os.path.join(OUT, name), optimize=True)


make(192, "icon-192.png")
make(512, "icon-512.png")
make(180, "apple-touch-icon.png")

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#F4EFE6"/>
  <g fill="none" stroke="#DAD1C0" stroke-width="4"><circle cx="256" cy="256" r="205"/><circle cx="256" cy="256" r="182"/></g>
  <circle cx="256" cy="256" r="154" fill="none" stroke="#1C1A17" stroke-width="26"/>
  <path d="M197 259 L241 302 L323 215" fill="none" stroke="#5E8C73" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""
with open(os.path.join(OUT, "icon.svg"), "w") as f:
    f.write(SVG)
print("icons written")
