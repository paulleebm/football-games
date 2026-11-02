"""Build silhouette + reveal images from FotMob's pre-cutout player renders
(design/silhouette-pilot/fotmob-sources/*.png, transparent background already
applied by FotMob). Output goes to a staging area (silhouettes-v2/,
reveal-v2/) for visual review before anything replaces the live public/ set.

Carlos Valderrama isn't on FotMob (retired before their coverage depth), so
he still goes through the old Wikimedia source + rembg path for now.

Run with the project's silhouette venv:
  .venv-silhouette/Scripts/python.exe design/silhouette-pilot/tools/build_from_fotmob.py [id ...]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FOTMOB_SRC = ROOT / "fotmob-sources"
SIL_OUT = ROOT / "silhouettes-v2"
REVEAL_OUT = ROOT / "reveal-v2"
SIL_OUT.mkdir(exist_ok=True)
REVEAL_OUT.mkdir(exist_ok=True)

CANVAS = 1024
TOP_MARGIN_FRAC = 0.08
SIDE_SAFETY_FRAC = 0.98
ALPHA_THRESHOLD = 25

FOTMOB_IDS = [
    "ake", "andrea-pirlo", "camavinga", "carles-puyol", "cucurella",
    "david-luiz", "fellaini", "grealish", "griezmann", "haaland", "kounde",
    "marcelo", "modric", "ronaldinho", "salah", "sane", "son", "xavi_simons",
    "zlatan-ibrahimovic",
]


def bbox_from_mask(mask: np.ndarray):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return xs.min(), xs.max(), ys.min(), ys.max()


def place_on_canvas(alpha_img: Image.Image, color_or_black: Image.Image, canvas_bg) -> Image.Image:
    """alpha_img: L-mode alpha (already cropped to bbox). color_or_black: RGB
    or L image of the same size to paste using alpha_img as the mask."""
    w, h = alpha_img.size
    avail_h = CANVAS * (1 - TOP_MARGIN_FRAC)
    scale = min(avail_h / h, (CANVAS * SIDE_SAFETY_FRAC) / w)
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    alpha_r = alpha_img.resize((new_w, new_h), Image.LANCZOS)
    layer_r = color_or_black.resize((new_w, new_h), Image.LANCZOS)
    canvas = canvas_bg.copy()
    paste_x = (CANVAS - new_w) // 2
    paste_y = CANVAS - new_h
    canvas.paste(layer_r, (paste_x, paste_y), alpha_r)
    return canvas


def process(pid: str) -> None:
    src = FOTMOB_SRC / f"{pid}.png"
    im = Image.open(src).convert("RGBA")
    alpha = np.array(im.split()[-1])
    mask = alpha > ALPHA_THRESHOLD
    bbox = bbox_from_mask(mask)
    if bbox is None:
        raise RuntimeError("empty mask")
    x0, x1, y0, y1 = bbox

    alpha_crop = Image.fromarray(alpha).crop((x0, y0, x1 + 1, y1 + 1))
    rgb_crop = im.convert("RGB").crop((x0, y0, x1 + 1, y1 + 1))
    black_crop = Image.new("RGB", rgb_crop.size, (0, 0, 0))

    sil_canvas_bg = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))
    reveal_canvas_bg = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))

    sil = place_on_canvas(alpha_crop, black_crop, sil_canvas_bg)
    reveal = place_on_canvas(alpha_crop, rgb_crop, reveal_canvas_bg)

    sil.save(SIL_OUT / f"{pid}.png")
    reveal.save(REVEAL_OUT / f"{pid}.jpg", quality=90)
    print(f"{pid}: ok (source {im.size})")


def main() -> None:
    ids = sys.argv[1:] or FOTMOB_IDS
    for pid in ids:
        try:
            process(pid)
        except Exception as exc:  # noqa: BLE001
            print(f"{pid}: ERROR {exc}")


if __name__ == "__main__":
    main()
