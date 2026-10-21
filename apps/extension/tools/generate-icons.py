"""Render the authored Resource Gauge icon at browser toolbar/store dimensions."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icon"
OUT.mkdir(parents=True, exist_ok=True)

def quadratic(a, b, c, steps=32):
    return [((1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0],
             (1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1])
            for t in [i/steps for i in range(steps+1)]]

for size in (16, 32, 48, 128):
    scale = size * 4 / 128
    image = Image.new("RGBA", (size * 4, size * 4))
    draw = ImageDraw.Draw(image)
    box = tuple(v * scale for v in (17, 17, 111, 111))
    color = "#3D7542"
    for start, end in ((110, 250), (290, 430)):
        draw.arc(box, start, end, fill=color, width=max(1, round(12 * scale)))
    leaf = quadratic((48, 82), (45, 47), (91, 34)) + quadratic((91, 34), (90, 77), (48, 82))
    draw.polygon([(x * scale, y * scale) for x, y in leaf], fill=color)
    draw.line([(50 * scale, 80 * scale), (76 * scale, 51 * scale)], fill="#E1EEDB", width=max(1, round(3 * scale)))
    image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"{size}.png")
