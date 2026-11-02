"""Crawl FotMob for extra hint-candidate fields (shirt number, market value,
contract end) for every player currently in the "guessPlayers" quiz pool
(crawler/data/quiz_players_minimal.json, 202 players).

Step 1: match each player against oxgame_players.json (2760 players already
FotMob-sourced) by exact name to reuse a known FotMob id for free.
Step 2: for anyone left unmatched, search FotMob live and disambiguate with
the currentClub hint (falls back to the top search result if no club match).
Step 3: fetch playerData for every resolved id and pull out shirt / market
value / contract end.

Output: crawler/data/quiz_players_extra_hints.json - NOT wired into the game
yet, just collected for review (per the "다른 모드로 만들 것" plan).
"""
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}


def norm(s):
    return (s or "").lower().replace(" ", "").replace("-", "").replace("'", "")


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


def resolve_fotmob_id(name, current_club, by_name_lookup):
    hit = by_name_lookup.get(norm(name))
    if hit:
        return hit, "matched-existing-pool"
    try:
        opts = search(name)
    except Exception as exc:  # noqa: BLE001
        return None, f"search-error:{exc}"
    if not opts:
        return None, "no-search-result"
    if current_club:
        for o in opts:
            team = (o.get("payload", {}) or {}).get("teamName") or ""
            if norm(current_club) in norm(team) or norm(team) in norm(current_club):
                return o.get("payload", {}).get("id"), "matched-by-club"
    return opts[0].get("payload", {}).get("id"), "top-result-fallback"


def extract_info(detail):
    info = {i.get("title"): i.get("value") for i in (detail.get("playerInformation") or [])}
    shirt = (info.get("Shirt") or {}).get("numberValue")
    market_value = (info.get("Market value") or {}).get("numberValue")
    contract_end = (info.get("Contract end") or {}).get("dateValue")
    return shirt, market_value, contract_end


def main():
    players = json.load(open(ROOT / "data/quiz_players_minimal.json", encoding="utf-8"))
    ox_pool = json.load(open(ROOT.parent / "public/data/oxgame_players.json", encoding="utf-8"))
    by_name_lookup = {norm(p["n"]): p["id"] for p in ox_pool}

    out_path = ROOT / "data/quiz_players_extra_hints.json"
    results = {}
    if out_path.exists():
        results = json.load(open(out_path, encoding="utf-8"))

    for i, p in enumerate(players):
        pid = p["id"]
        if pid in results and results[pid].get("shirt") is not None:
            continue  # already done in a previous run
        fm_id, method = resolve_fotmob_id(p["nameEn"], p.get("currentClub"), by_name_lookup)
        entry = {"nameEn": p["nameEn"], "currentClub": p.get("currentClub"), "fotmobId": fm_id, "matchMethod": method}
        if fm_id:
            try:
                detail = player_detail(fm_id)
                shirt, market_value, contract_end = extract_info(detail)
                entry["shirt"] = shirt
                entry["marketValueEUR"] = market_value
                entry["contractEnd"] = contract_end
                entry["fotmobTeam"] = (detail.get("primaryTeam") or {}).get("teamName")
            except Exception as exc:  # noqa: BLE001
                entry["error"] = str(exc)
        results[pid] = entry
        print(f"[{i+1}/{len(players)}] {pid}: {method} id={fm_id} shirt={entry.get('shirt')} mv={entry.get('marketValueEUR')}")

        if (i + 1) % 20 == 0:
            json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        time.sleep(0.5 if method == "matched-existing-pool" else 1.0)

    json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nwrote {out_path} ({len(results)} players)")


if __name__ == "__main__":
    main()
