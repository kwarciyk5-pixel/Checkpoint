"""Generate the Checkpoint app icons (run: python3 tests/make_icons.py)."""
from PIL import Image, ImageDraw, ImageFilter
import os

BG = (11, 13, 16, 255)
MINT = (77, 240, 176, 255)
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
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw_mark(ImageDraw.Draw(glow), s, (77, 240, 176, 150), width_scale=1.8)
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    img = Image.alpha_composite(img, glow)
    draw_mark(ImageDraw.Draw(img), s, MINT)
    img = img.resize((size, size), Image.LANCZOS).convert("RGB")
    img.save(os.path.join(OUT, name), optimize=True)


make(192, "icon-192.png")
make(512, "icon-512.png")
make(180, "apple-touch-icon.png")

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="#0B0D10"/>
  <g fill="none" stroke="#4DF0B0" stroke-linecap="round" stroke-linejoin="round">
    <g opacity="0.55" filter="url(#glow)" stroke-width="50">
      <circle cx="256" cy="256" r="154"/>
      <path d="M197 259 L241 302 L323 215"/>
    </g>
    <g stroke-width="28">
      <circle cx="256" cy="256" r="154"/>
      <path d="M197 259 L241 302 L323 215"/>
    </g>
  </g>
</svg>
"""
with open(os.path.join(OUT, "icon.svg"), "w") as f:
    f.write(SVG)
print("icons written")
