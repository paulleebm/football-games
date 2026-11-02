"""Collect unmodified Wikimedia portraits and their attribution metadata."""
import hashlib
import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests
from PIL import Image
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
PLAYERS = [
    ("camavinga", "에두아르도 카마빙가", "Eduardo Camavinga", "Eduardo Camavinga", "머리 위와 옆으로 퍼지는 땋은 머리"),
    ("kounde", "쥘 쿤데", "Jules Kounde", "Jules Koundé", "양옆으로 내려오는 땋은 머리와 좁은 얼굴 윤곽"),
    ("xavi_simons", "사비 시몬스", "Xavi Simons", "Xavi Simons", "뒤로 묶은 긴 머리와 귀 주변 윤곽"),
    ("son", "손흥민", "Son Heung-min", "Son Heung-min", "한국 이용자에게 친숙한 가르마 머리와 얼굴 윤곽; 난도 비교용"),
]


def main():
    session = requests.Session()
    session.headers["User-Agent"] = "FootballSilhouettePilot/1.0 (local image attribution research)"
    session.mount("https://", HTTPAdapter(max_retries=Retry(total=4, backoff_factor=2, status_forcelist=[429, 502, 503, 504])))
    response = session.get("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "titles": "|".join(p[3] for p in PLAYERS),
        "prop": "pageimages", "piprop": "original", "format": "json",
    }, timeout=40)
    response.raise_for_status()
    pages = {p["title"]: p for p in response.json()["query"]["pages"].values()}
    records = []
    for pid, ko, en, title, reason in PLAYERS:
        url = pages[title]["original"]["source"].split("?")[0]
        filename = unquote(urlparse(url).path.rsplit("/", 1)[-1])
        meta_response = session.get("https://commons.wikimedia.org/w/api.php", params={
            "action": "query", "titles": "File:" + filename, "prop": "imageinfo",
            "iiprop": "url|extmetadata|size", "format": "json",
        }, timeout=40)
        meta_response.raise_for_status()
        page = next(iter(meta_response.json()["query"]["pages"].values()))
        info = page["imageinfo"][0]
        meta = info.get("extmetadata", {})
        image_response = session.get(url, timeout=60)
        image_response.raise_for_status()
        content = image_response.content
        with Image.open(BytesIO(content)) as im:
            im.verify()
        with Image.open(BytesIO(content)) as im:
            size = list(im.size)
        destination = ROOT / "sources" / (pid + Path(filename).suffix.lower())
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        value = lambda key: meta.get(key, {}).get("value")
        record = {
            "id": pid, "nameKo": ko, "nameEn": en,
            "sourcePageUrl": info["descriptionurl"], "sourceImageUrl": url,
            "sourcePath": destination.relative_to(ROOT).as_posix(),
            "author": value("Artist"), "license": value("LicenseShortName"),
            "licenseUrl": value("LicenseUrl"), "attributionRequired": value("AttributionRequired"),
            "date": value("DateTimeOriginal"), "selectionReason": reason,
            "sourceDimensions": size, "sourceSha256": hashlib.sha256(content).hexdigest(),
            "collectedAt": datetime.now(timezone.utc).isoformat(),
            "sourceMetadata": meta, "reviewStatus": "source-collected-awaiting-visual-review",
        }
        records.append(record)
        print(json.dumps({k: record[k] for k in ["id", "sourcePath", "license", "sourceDimensions"]}, ensure_ascii=False), flush=True)
    metadata_path = ROOT / "metadata" / "extra.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
