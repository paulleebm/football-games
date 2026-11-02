"""Download alternative originals when the initial source crops off a hairstyle."""
import json
import time
from pathlib import Path
import collect_legends as lib

TARGETS = [
    (("fellaini-alt1", "마루안 펠라이니", "Marouane Fellaini", "", "전체 아프로가 보이는 대체 원본 후보"), "File:Marouane Fellaini 3558.JPG"),
    (("fellaini-alt2", "마루안 펠라이니", "Marouane Fellaini", "", "전체 아프로가 보이는 대체 원본 후보"), "File:Fellaini 2018 2.jpg"),
    (("ronaldinho-alt1", "호나우지뉴", "Ronaldinho", "", "긴 머리 외곽선이 보이는 대체 원본 후보"), "File:Ronaldinho.jpg"),
    (("ronaldinho-alt2", "호나우지뉴", "Ronaldinho", "", "긴 머리 외곽선이 보이는 대체 원본 후보"), "File:Ronaldinho Gaúcho.jpg"),
]

if __name__ == "__main__":
    data = lib.get_json("https://commons.wikimedia.org/w/api.php", {
        "action": "query", "titles": "|".join(title for _, title in TARGETS),
        "prop": "imageinfo", "iiprop": "url|size|extmetadata", "format": "json",
    })
    lib.CACHED = {p["title"]: p for p in data["query"]["pages"].values()}
    records = []
    output = lib.ROOT / "metadata" / "replacements.json"
    for player, title in TARGETS:
        try:
            r = lib.collect(player, title)
            records.append(r)
            output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
            print(r["id"], r["sourceFile"], r["license"], flush=True)
        except Exception as exc:
            print(player[0], type(exc).__name__, str(exc), flush=True)
        time.sleep(2)
