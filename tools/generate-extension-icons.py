"""Draw the browser icons in apps/extension/public/icon.

These are the manifest icons, so the browser shows them in the toolbar, on the
extensions page, in install prompts and in store listings. A soft white disc
keeps the dark green gauge readable on dark browser surfaces, and the disc fills
the whole icon like neighbouring extension icons do. The in-product logo stays
transparent: it is drawn from resource-gauge.svg, not from these files.

Requires Pillow. Run: python tools/generate-extension-icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps/extension/public/icon"

DISC = (0xF3, 0xF5, 0xF1, 255)
GREEN = (0x3D, 0x75, 0x42, 255)
VEIN = (0xE1, 0xEE, 0xDB, 255)
SUPERSAMPLE = 16
CENTER = 64.0

# All lengths are in resource-gauge.svg's 128-unit space. The SVG's 12-unit
# ring and slim leaf read as mostly white at 16 px, so the icon uses a heavier
# ring and a fuller leaf. The ring stops 7 units short of the disc edge to keep
# a thin white rim that separates it from the toolbar.
RING_OUTER = 57.0
RING_STROKE = 18.0
LEAF_FULLNESS = 1.35

# Each gauge arc in resource-gauge.svg has radius 47 and chord ends at
# (48 or 80, 20) and (48 or 80, 108). Keeping that sweep keeps the brand's
# top and bottom gaps.
ARC_SWEEP = math.degrees(math.atan2(44, math.sqrt(47**2 - 44**2)))

LEAF_BASE = (48.0, 82.0)
LEAF_TIP = (91.0, 34.0)
LEAF_CONTROLS = ((45.0, 47.0), (90.0, 77.0))
VEIN_ENDS = ((50.0, 80.0), (76.0, 51.0))

# Size: (gap between leaf tips and ring, vein width or None). At 16 px the
# wider gap keeps the leaf from merging into the ring, and the vein is dropped
# because it only blurs into a paler leaf.
SIZES = {
    16: (6.0, None),
    24: (4.0, 3.5),
    32: (4.0, 3.5),
    48: (4.0, 3.5),
    128: (4.0, 3.5),
}


def quadratic(p0, control, p1, steps=96):
    return [
        (
            (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * control[0] + t**2 * p1[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * control[1] + t**2 * p1[1],
        )
        for t in (i / steps for i in range(steps + 1))
    ]


def leaf_placement(length_scale: float):
    """Centre the leaf in the ring and scale it along and across its axis.

    The SVG leaf sits up and to the right with its tip almost on the ring.
    Centring it lets it grow without touching the heavier ring.
    """
    mid = ((LEAF_BASE[0] + LEAF_TIP[0]) / 2, (LEAF_BASE[1] + LEAF_TIP[1]) / 2)
    angle = math.atan2(LEAF_TIP[1] - LEAF_BASE[1], LEAF_TIP[0] - LEAF_BASE[0])
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    def place(point):
        dx, dy = point[0] - mid[0], point[1] - mid[1]
        along = (dx * cos_a + dy * sin_a) * length_scale
        across = (-dx * sin_a + dy * cos_a) * length_scale * LEAF_FULLNESS
        return (
            CENTER + along * cos_a - across * sin_a,
            CENTER + along * sin_a + across * cos_a,
        )

    return place


def render(size: int, leaf_gap: float, vein_width: float | None) -> Image.Image:
    pixels = size * SUPERSAMPLE
    unit = pixels / 128.0
    image = Image.new("RGBA", (pixels, pixels), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.ellipse((0, 0, pixels - 1, pixels - 1), fill=DISC)

    ring = RING_OUTER * unit
    box = (CENTER * unit - ring, CENTER * unit - ring, CENTER * unit + ring, CENTER * unit + ring)
    for start, end in ((180 - ARC_SWEEP, 180 + ARC_SWEEP), (-ARC_SWEEP, ARC_SWEEP)):
        draw.arc(box, start, end, fill=GREEN, width=round(RING_STROKE * unit))

    half_length = math.dist(LEAF_BASE, LEAF_TIP) / 2
    length_scale = (RING_OUTER - RING_STROKE - leaf_gap) / half_length
    place = leaf_placement(length_scale)
    outline = quadratic(LEAF_BASE, LEAF_CONTROLS[0], LEAF_TIP)
    outline += quadratic(LEAF_TIP, LEAF_CONTROLS[1], LEAF_BASE)[1:]
    draw.polygon([(x * unit, y * unit) for x, y in map(place, outline)], fill=GREEN)
    if vein_width:
        draw.line(
            [(x * unit, y * unit) for x, y in map(place, VEIN_ENDS)],
            fill=VEIN,
            width=round(vein_width * length_scale * unit),
        )

    # Box-reduce in premultiplied alpha so the disc edge does not pick up a
    # dark fringe from transparent black pixels.
    return image.convert("RGBa").reduce(SUPERSAMPLE).convert("RGBA")


def main() -> None:
    for size, (leaf_gap, vein_width) in SIZES.items():
        render(size, leaf_gap, vein_width).save(OUTPUT / f"{size}.png", optimize=True)


if __name__ == "__main__":
    main()
