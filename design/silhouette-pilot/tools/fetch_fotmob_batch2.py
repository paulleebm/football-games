"""Search FotMob for the 11 new silhouette-quiz candidates, verify each match
by birth date (common surnames like Ronaldo/Ramos/Neymar return many
candidates - picking the wrong one silently was exactly what happened with
Son/Marcelo in the first batch), download the pre-cutout PNG, and report.
"""
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "fotmob-sources"
OUT_DIR.mkdir(exist_ok=True)
REPORT_PATH = ROOT / "fotmob-lookup-report-batch2.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}

# id -> (search term, expected YYYY-MM-DD birth date to disambiguate common names)
TARGETS = {
    "cristiano-ronaldo": ("Cristiano Ronaldo", "1985-02-05"),
    "neymar": ("Neymar", "1992-02-05"),
    "pogba": ("Paul Pogba", "1993-03-15"),
    "maradona": ("Diego Maradona", "1960-10-30"),
    "ronaldo-nazario": ("Ronaldo Nazario", "1976-09-18"),
    "beckham": ("David Beckham", "1975-05-02"),
    "cech": ("Petr Cech", "1982-05-20"),
    "drogba": ("Didier Drogba", "1978-03-11"),
    "depay": ("Memphis Depay", "1994-02-13"),
    "de-jong": ("Frenkie de Jong", "1997-05-12"),
    "ramos": ("Sergio Ramos", "1986-03-30"),
}


def search(term):
    r = requests.get("https://apigw.fotmob.com/searchapi/suggest", params={"term": term, "project": "fotmob"}, headers=HEADERS, timeout=20)
    r.raise_for_status()
    data = r.json()
    opts = []
    for block in data.get("squadMemberSuggest") or []:
        opts.extend(block.get("options") or [])
    return opts


def player_detail(fm_id):
    r = requests.get("https://www.fotmob.com/api/data/playerData", params={"id": fm_id}, headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


def main():
    report = {}
    for pid, (name, expected_dob) in TARGETS.items():
        entry = {"query": name, "expectedDob": expected_dob}
        try:
            opts = search(name)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"search failed: {exc}"
            report[pid] = entry
            continue
        entry["candidateCount"] = len(opts)

        chosen = None
        chosen_detail = None
        checked = []
        for o in opts[:8]:
            fm_id = o.get("payload", {}).get("id")
            if not fm_id:
                continue
            try:
                d = player_detail(fm_id)
            except Exception:
                continue
            dob = ((d.get("birthDate") or {}).get("utcTime") or "")[:10]
            team = (d.get("primaryTeam") or {}).get("teamName")
            checked.append({"id": fm_id, "dob": dob, "team": team})
            if dob == expected_dob and chosen is None:
                chosen = fm_id
                chosen_detail = {"dob": dob, "team": team}
            time.sleep(0.4)

        entry["checkedCandidates"] = checked
        if chosen is None:
            entry["error"] = "no candidate matched expected DOB"
            report[pid] = entry
            continue

        entry["fotmobId"] = chosen
        entry["matchedDob"] = chosen_detail["dob"]
        entry["matchedTeam"] = chosen_detail["team"]

        img_url = f"https://images.fotmob.com/image_resources/playerimages/{chosen}.png"
        try:
            img_r = requests.get(img_url, headers=HEADERS, timeout=20)
            img_r.raise_for_status()
            (OUT_DIR / f"{pid}.png").write_bytes(img_r.content)
            entry["imageDownloaded"] = True
            entry["imageBytes"] = len(img_r.content)
        except Exception as exc:  # noqa: BLE001
            entry["imageDownloaded"] = False
            entry["imageError"] = str(exc)

        report[pid] = entry
        time.sleep(1.0)

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
