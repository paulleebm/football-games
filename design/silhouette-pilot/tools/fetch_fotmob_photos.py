"""Look up each silhouette-quiz player on FotMob's search API, download their
already-cutout PNG portrait (images.fotmob.com/image_resources/playerimages/
{id}.png - transparent background, pre-matted by FotMob), and write a
lookup report. Run with the project's silhouette venv (has `requests`).
"""
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "fotmob-sources"
OUT_DIR.mkdir(exist_ok=True)
REPORT_PATH = ROOT / "fotmob-lookup-report.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}

# id -> (search term, team hint or None to just take the top match)
TARGETS = {
    "ake": ("Nathan Ake", None),
    "andrea-pirlo": ("Andrea Pirlo", None),
    "camavinga": ("Eduardo Camavinga", "Real Madrid"),
    "carles-puyol": ("Carles Puyol", None),
    "carlos-valderrama": ("Carlos Valderrama", None),
    "cucurella": ("Marc Cucurella", None),
    "david-luiz": ("David Luiz", None),
    "fellaini": ("Marouane Fellaini", None),
    "grealish": ("Jack Grealish", None),
    "griezmann": ("Antoine Griezmann", None),
    "haaland": ("Erling Haaland", None),
    "kounde": ("Jules Kounde", None),
    "marcelo": ("Marcelo Vieira", None),
    "modric": ("Luka Modric", None),
    "ronaldinho": ("Ronaldinho", None),
    "salah": ("Mohamed Salah", None),
    "sane": ("Leroy Sane", None),
    "son": ("Son Heung-min", None),
    "xavi_simons": ("Xavi Simons", None),
    "zlatan-ibrahimovic": ("Zlatan Ibrahimovic", None),
}


def search_player(name, team_hint):
    url = "https://apigw.fotmob.com/searchapi/suggest"
    r = requests.get(url, params={"term": name, "project": "fotmob"}, headers=HEADERS, timeout=20)
    r.raise_for_status()
    data = r.json()
    options_all = []
    for block in data.get("squadMemberSuggest") or []:
        options_all.extend(block.get("options") or [])
    if not options_all:
        return None, options_all
    if team_hint:
        for opt in options_all:
            if team_hint.lower() in (opt.get("payload", {}).get("teamName") or "").lower():
                return opt, options_all
    return options_all[0], options_all


def main():
    report = {}
    for pid, (name, team_hint) in TARGETS.items():
        try:
            chosen, all_opts = search_player(name, team_hint)
        except Exception as exc:  # noqa: BLE001
            report[pid] = {"error": str(exc)}
            continue
        if not chosen:
            report[pid] = {"error": "no search result", "query": name}
            continue
        payload = chosen.get("payload", {})
        fm_id = payload.get("id")
        fm_name = payload.get("name") or chosen.get("title")
        fm_team = payload.get("teamName")
        img_url = f"https://images.fotmob.com/image_resources/playerimages/{fm_id}.png"
        try:
            img_r = requests.get(img_url, headers=HEADERS, timeout=20)
            img_r.raise_for_status()
            dest = OUT_DIR / f"{pid}.png"
            dest.write_bytes(img_r.content)
            img_ok = True
            img_size = len(img_r.content)
        except Exception as exc:  # noqa: BLE001
            img_ok = False
            img_size = 0
        report[pid] = {
            "query": name,
            "fotmobId": fm_id,
            "fotmobName": fm_name,
            "fotmobTeam": fm_team,
            "imageUrl": img_url,
            "imageDownloaded": img_ok,
            "imageBytes": img_size,
            "candidateCount": len(all_opts),
            "allCandidates": [
                {"id": o.get("payload", {}).get("id"), "name": o.get("payload", {}).get("name") or o.get("title"), "team": o.get("payload", {}).get("teamName")}
                for o in all_opts[:6]
            ],
        }
        time.sleep(1.0)

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
