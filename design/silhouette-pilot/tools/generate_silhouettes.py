"""Deterministic silhouette generation: rembg background removal + crop/pad to
the PROMPT.txt spec (square 1024, pure black subject on pure white, ~8% top
margin above hair, shoulders touching the bottom edge).

Run with the project's silhouette venv:
  .venv-silhouette/Scripts/python.exe design/silhouette-pilot/tools/generate_silhouettes.py [id ...]

With no arguments, regenerates every player in PLAYERS. Pass one or more ids
to regenerate only those (e.g. `... generate_silhouettes.py ake haaland`).
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
OUT = ROOT / "silhouettes"
OUT.mkdir(exist_ok=True)
REVEAL_OUT = ROOT.parents[1] / "public" / "reveal"
REVEAL_OUT.mkdir(parents=True, exist_ok=True)
REVEAL_MAX_SIDE = 640

CANVAS = 1024
TOP_MARGIN_FRAC = 0.08
SIDE_SAFETY_FRAC = 0.98  # keep a hair of margin so very wide hair never clips

# id -> source file + crop box [left, top, right, bottom] in source pixel
# coordinates (right/bottom exclusive). Boxes trim other people / limbs and
# limit the frame to head + upper shoulders per PROMPT.txt.
PLAYERS = {
    "ake": {"file": "ake.jpg", "crop": [0, 5, 500, 675]},
    "andrea-pirlo": {"file": "andrea-pirlo.jpg", "crop": [240, 150, 620, 540]},
    "camavinga": {"file": "camavinga.jpg", "crop": [160, 80, 2049, 1730]},
    "carles-puyol": {"file": "carles-puyol.jpg", "crop": [0, 0, 830, 950]},
    "carlos-valderrama": {"file": "carlos-valderrama.jpg", "crop": [280, 35, 890, 640]},
    "cucurella": {"file": "cucurella.jpg", "crop": [0, 0, 1388, 1250]},
    "david-luiz": {"file": "david-luiz.jpg", "crop": [0, 5, 648, 555]},
    # marouane-fellaini.jpg: dark upper-right crowd/stand background merged
    # into the afro's connected component; crop trims it off.
    "fellaini": {"file": "marouane-fellaini.jpg", "crop": [0, 10, 820, 550]},
    "grealish": {"file": "grealish.jpg", "crop": [0, 0, 500, 625]},
    "griezmann": {"file": "griezmann.jpg", "crop": [85, 0, 425, 455]},
    "haaland": {"file": "haaland.jpg", "crop": [0, 0, 500, 570]},
    "kounde": {"file": "kounde.jpg", "crop": [0, 35, 1582, 1540]},
    # marcelo.jpg: crop starting at the true source top merged with a
    # background block; a small top margin drops it.
    "marcelo": {"file": "marcelo.jpg", "crop": [0, 25, 1011, 1000]},
    # modric.png: crop trimmed on both sides to drop the framing teammate
    # visible at the original's right edge and background bleed on the left.
    "modric": {"file": "modric.png", "crop": [60, 0, 400, 365], "exclude": [[0, 150, 80, 225]]},
    "ronaldinho": {"file": "ronaldinho-alt1.jpg", "crop": [0, 0, 500, 500]},
    # salah.jpg: exclude zones below drop the bystander's arm at left
    # (behind the ear) and another bystander's raised arm at top right.
    "salah": {"file": "salah.jpg", "crop": [0, 0, 621, 710], "exclude": [[0, 175, 150, 355], [455, 0, 621, 320]]},
    # sane.jpg: exclude zone drops the teammate's hand resting on his left
    # shoulder (bottom-left of the crop).
    "sane": {"file": "sane.jpg", "crop": [0, 50, 500, 650], "exclude": [[0, 380, 125, 600]]},
    "son": {"file": "son.jpg", "crop": [130, 15, 1720, 1935]},
    "xavi_simons": {"file": "xavi_simons.jpg", "crop": [330, 65, 935, 635]},
    "zlatan-ibrahimovic": {"file": "zlatan-ibrahimovic.jpg", "crop": [0, 0, 332, 460]},
}

_session = None


def session():
    global _session
    if _session is None:
        _session = new_session("u2net_human_seg")
    return _session


def largest_component_mask(alpha: np.ndarray) -> np.ndarray:
    binary = (alpha > 20).astype("uint8")
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n <= 1:
        return binary.astype(bool)
    idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == idx


def process(pid: str, info: dict) -> None:
    src_path = SOURCES / info["file"]
    img = Image.open(src_path).convert("RGB")
    l, t, r, b = info["crop"]
    crop = img.crop((l, t, r, b))

    cut = remove(crop, session=session())
    alpha = np.array(cut.split()[-1])
    mask = largest_component_mask(alpha)

    for el, et, er, eb in info.get("exclude", []):
        mask[et:eb, el:er] = False

    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError("empty mask after segmentation")
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x1 - x0 + 1, y1 - y0 + 1

    subject = np.zeros((crop.height, crop.width), dtype="uint8")
    subject[mask] = 255
    subject = subject[y0 : y1 + 1, x0 : x1 + 1]

    avail_h = CANVAS * (1 - TOP_MARGIN_FRAC)
    scale = min(avail_h / h, (CANVAS * SIDE_SAFETY_FRAC) / w)
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))

    subject_img = Image.fromarray(subject).resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("L", (CANVAS, CANVAS), 255)
    paste_x = (CANVAS - new_w) // 2
    paste_y = CANVAS - new_h  # shoulders/bottom of mask touch the bottom edge
    black_layer = Image.new("L", (new_w, new_h), 0)
    canvas.paste(black_layer, (paste_x, paste_y), subject_img)

    canvas.convert("RGB").save(OUT / f"{pid}.png")
    print(f"{pid}: ok ({new_w}x{new_h} subject, source {info['file']})")


def save_reveal(pid: str, info: dict) -> None:
    # Plain color crop (same box as the silhouette, no masking) for the
    # "reveal the real photo" screen in the quiz UI.
    src_path = SOURCES / info["file"]
    img = Image.open(src_path).convert("RGB")
    crop = img.crop(tuple(info["crop"]))
    scale = min(1.0, REVEAL_MAX_SIDE / max(crop.width, crop.height))
    if scale < 1.0:
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
    crop.save(REVEAL_OUT / f"{pid}.jpg", quality=88)


def main() -> None:
    ids = sys.argv[1:] or list(PLAYERS)
    for pid in ids:
        info = PLAYERS.get(pid)
        if info is None:
            print(f"{pid}: unknown id, skipping")
            continue
        try:
            process(pid, info)
            save_reveal(pid, info)
        except Exception as exc:  # noqa: BLE001 - report and continue batch
            print(f"{pid}: ERROR {exc}")


if __name__ == "__main__":
    main()
