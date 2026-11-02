"""Search FotMob for the 70 new silhouette-quiz candidates (30 -> 100 total),
download each pre-cutout PNG, and write a lookup report for visual
spot-checking. Team hints disambiguate common surnames; entries with None
just take FotMob's top-ranked search result.
"""
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "fotmob-sources"
OUT_DIR.mkdir(exist_ok=True)
REPORT_PATH = ROOT / "fotmob-lookup-report-batch3.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}

# id -> (search term, team hint or None)
TARGETS = {
    "messi": ("Lionel Messi", "Miami"),
    "mbappe": ("Kylian Mbappe", "Real Madrid"),
    "iniesta": ("Andres Iniesta", None),
    "xavi": ("Xavi Hernandez", None),
    "kaka": ("Kaka", None),
    "roberto-carlos": ("Roberto Carlos", None),
    "henry": ("Thierry Henry", None),
    "van-persie": ("Robin van Persie", None),
    "robben": ("Arjen Robben", None),
    "sneijder": ("Wesley Sneijder", None),
    "gerrard": ("Steven Gerrard", None),
    "scholes": ("Paul Scholes", None),
    "giggs": ("Ryan Giggs", None),
    "vidic": ("Nemanja Vidic", None),
    "terry": ("John Terry", "Chelsea"),
    "rio-ferdinand": ("Rio Ferdinand", "Manchester United"),
    "lampard": ("Frank Lampard", "Chelsea"),
    "rooney": ("Wayne Rooney", None),
    "aguero": ("Sergio Aguero", "Manchester City"),
    "suarez": ("Luis Suarez", "Inter Miami"),
    "forlan": ("Diego Forlan", None),
    "yaya-toure": ("Yaya Toure", None),
    "essien": ("Michael Essien", None),
    "etoo": ("Samuel Eto'o", None),
    "weah": ("George Weah", None),
    "okocha": ("Jay-Jay Okocha", None),
    "kanu": ("Nwankwo Kanu", None),
    "nakata": ("Hidetoshi Nakata", None),
    "honda": ("Keisuke Honda", None),
    "park-ji-sung": ("Park Ji-sung", "Manchester United"),
    "kim-min-jae": ("Kim Min-jae", "Bayern"),
    "lewandowski": ("Robert Lewandowski", "Barcelona"),
    "muller": ("Thomas Muller", "Bayern"),
    "neuer": ("Manuel Neuer", "Bayern"),
    "gotze": ("Mario Gotze", None),
    "ozil": ("Mesut Ozil", None),
    "kroos": ("Toni Kroos", "Real Madrid"),
    "schweinsteiger": ("Bastian Schweinsteiger", None),
    "kp-boateng": ("Kevin-Prince Boateng", None),
    "di-maria": ("Angel Di Maria", None),
    "enzo-fernandez": ("Enzo Fernandez", "Chelsea"),
    "emi-martinez": ("Emiliano Martinez", "Aston Villa"),
    "mac-allister": ("Alexis Mac Allister", "Liverpool"),
    "de-paul": ("Rodrigo De Paul", "Atletico"),
    "cuti-romero": ("Cristian Romero", "Tottenham"),
    "dembele": ("Ousmane Dembele", "Paris"),
    "konate": ("Ibrahima Konate", "Liverpool"),
    "tchouameni": ("Aurelien Tchouameni", "Real Madrid"),
    "vinicius": ("Vinicius Junior", "Real Madrid"),
    "rodrygo": ("Rodrygo", "Real Madrid"),
    "valverde": ("Federico Valverde", "Real Madrid"),
    "courtois": ("Thibaut Courtois", "Real Madrid"),
    "donnarumma": ("Gianluigi Donnarumma", None),
    "verratti": ("Marco Verratti", None),
    "chiesa": ("Federico Chiesa", None),
    "osimhen": ("Victor Osimhen", None),
    "kvaratskhelia": ("Khvicha Kvaratskhelia", None),
    "van-dijk": ("Virgil van Dijk", "Liverpool"),
    "de-bruyne": ("Kevin De Bruyne", "Manchester City"),
    "bruno-fernandes": ("Bruno Fernandes", "Manchester United"),
    "rashford": ("Marcus Rashford", None),
    "sterling": ("Raheem Sterling", None),
    "kane": ("Harry Kane", "Bayern"),
    "saka": ("Bukayo Saka", "Arsenal"),
    "bellingham": ("Jude Bellingham", "Real Madrid"),
    "foden": ("Phil Foden", "Manchester City"),
    "alisson": ("Alisson Becker", "Liverpool"),
    "rodri": ("Rodri", "Manchester City"),
    "coutinho": ("Philippe Coutinho", None),
    "aubameyang": ("Pierre-Emerick Aubameyang", None),
}


def search(term):
    r = requests.get("https://apigw.fotmob.com/searchapi/suggest", params={"term": term, "project": "fotmob"}, headers=HEADERS, timeout=20)
    r.raise_for_status()
    data = r.json()
    opts = []
    for block in data.get("squadMemberSuggest") or []:
        opts.extend(block.get("options") or [])
    return opts


def choose(opts, team_hint):
    if not opts:
        return None
    if team_hint:
        for o in opts:
            team = (o.get("payload", {}) or {}).get("teamName") or ""
            if team_hint.lower() in team.lower():
                return o
    return opts[0]


def main():
    report = {}
    for pid, (name, hint) in TARGETS.items():
        entry = {"query": name, "hint": hint}
        try:
            opts = search(name)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"search failed: {exc}"
            report[pid] = entry
            continue
        entry["candidateCount"] = len(opts)
        entry["candidates"] = [
            {"id": o.get("payload", {}).get("id"), "team": o.get("payload", {}).get("teamName")}
            for o in opts[:5]
        ]
        chosen = choose(opts, hint)
        if not chosen:
            entry["error"] = "no search result"
            report[pid] = entry
            continue
        fm_id = chosen.get("payload", {}).get("id")
        entry["fotmobId"] = fm_id
        entry["chosenTeam"] = chosen.get("payload", {}).get("teamName")

        img_url = f"https://images.fotmob.com/image_resources/playerimages/{fm_id}.png"
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
        time.sleep(0.8)

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    ok = sum(1 for v in report.values() if v.get("imageDownloaded"))
    print(f"wrote {REPORT_PATH} ({ok}/{len(TARGETS)} downloaded)")


if __name__ == "__main__":
    main()
