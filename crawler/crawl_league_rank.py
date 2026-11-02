"""
각 선수의 "현재 소속 클럽"이 지난 시즌(가장 최근 완료된 시즌) 리그에서 몇 위로
마쳤는지 긁어온다. Transfermarkt 클럽의 "platzierungen"(순위 이력) 페이지 사용.

클럽 단위로 캐싱하므로 같은 클럽 소속 선수가 여럿이어도 한 번만 긁는다.
"""
import json
import random
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from players import PLAYERS

DATASET_PATH = Path(__file__).parent / "data" / "dataset.json"
OUT_PATH = Path(__file__).parent / "data" / "league_rank.json"
CACHE_DIR = Path(__file__).parent / "data" / "rank_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

TM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
MIN_GAMES_FOR_COMPLETE_SEASON = 15  # 이보다 적게 치렀으면 "진행중 시즌"으로 보고 건너뜀


def polite_sleep():
    time.sleep(random.uniform(1.6, 2.8))


def http_get(url, retries=3):
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=TM_HEADERS, timeout=20)
            if r.status_code == 200:
                return r
        except requests.RequestException:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def resolve_club_id(club_name):
    r = http_get(f"https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query={requests.utils.quote(club_name)}")
    if r is None:
        return None, None
    soup = BeautifulSoup(r.text, "html.parser")
    club_h2 = next((h for h in soup.select("h2") if "Clubs" in h.get_text()), None)
    box = club_h2.find_parent("div", class_="box") if club_h2 else None
    a = (box or soup).select_one("a[href*='/startseite/verein/']")
    if not a:
        return None, None
    m = re.search(r"/startseite/verein/(\d+)", a["href"])
    slug = a["href"].split("/")[1] if a["href"].startswith("/") else None
    return (m.group(1) if m else None), slug


def fetch_last_completed_season_rank(club_id, club_slug):
    cache_path = CACHE_DIR / f"{club_id}.json"
    if cache_path.exists():
        return json.load(open(cache_path, encoding="utf-8"))

    url = f"https://www.transfermarkt.com/{club_slug}/platzierungen/verein/{club_id}"
    r = http_get(url)
    result = None
    if r is not None:
        soup = BeautifulSoup(r.text, "html.parser")
        tables = soup.select("table")
        if len(tables) >= 2:
            rows = tables[1].select("tr")[1:]  # 첫 행은 헤더
            for row in rows:
                cells = [c.get_text(strip=True) for c in row.find_all(["th", "td"])]
                if len(cells) < 11:
                    continue
                season, _, league, level, w, d, l, goals, diff, points, rank = cells[:11]
                try:
                    games = int(w) + int(d) + int(l)
                except ValueError:
                    continue
                if games < MIN_GAMES_FOR_COMPLETE_SEASON:
                    continue
                if not rank.strip().isdigit():
                    continue
                result = {"season": season, "league": league, "rank": int(rank), "points": points}
                break

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return result


def main():
    dataset = json.load(open(DATASET_PATH, encoding="utf-8"))
    by_id = {p["id"]: p for p in dataset}

    out = {}
    if OUT_PATH.exists():
        out = json.load(open(OUT_PATH, encoding="utf-8"))

    club_name_to_result = {}

    for p in PLAYERS:
        if p["id"] in out:
            print(f"[skip] {p['id']}")
            continue
        player = by_id.get(p["id"])
        if not player:
            print(f"[warn] {p['id']} not in dataset")
            continue
        tm_current = (player["profile"].get("currentClub") or "").strip()
        if tm_current.lower() in ("without club", "retired", ""):
            print(f"    [warn] no current club for {p['id']} (TM says {tm_current!r} - free agent/retired? check players.py)")
            out[p["id"]] = None
            continue

        career = [c for c in player["career"] if c["startYear"]]
        if not career:
            out[p["id"]] = None
            continue

        # 위키 커리어 목록이 최신이 아닐 수 있다(임대가 이미 끝나고 원 소속팀으로
        # 복귀했는데 위키 인포박스는 아직 임대팀을 마지막 스틴트로 들고 있는 경우
        # 등) - 더 자주 갱신되는 TM의 "현재 소속팀" 필드와 매칭되는 커리어 항목이
        # 있으면 그걸 우선 사용하고, 매칭이 안 될 때만 커리어 목록 자체로 폴백한다.
        tmc = tm_current.lower()
        tm_matches = [c for c in career if tmc in c["club"].lower() or c["club"].lower() in tmc]

        if tm_matches:
            target_club = tm_matches[-1]["club"]
        else:
            # "지난 시즌"(25/26)에 실제로 몸담았던 팀 기준이어야 한다 - 올여름
            # (2026년) 이적한 선수라면 현재 클럽이 아니라 "이적 전 클럽"이 25/26
            # 시즌 소속팀이다. (표준 여름 이적시장 가정 - 겨울 이적처럼 시즌 중
            # 이동한 경우는 못 잡아낸다)
            current = career[-1]
            if current["startYear"] >= 2026 and len(career) >= 2:
                target_club = career[-2]["club"]
            else:
                target_club = current["club"]
        current_club = target_club

        if current_club in club_name_to_result:
            out[p["id"]] = club_name_to_result[current_club]
            print(f"[cache-hit] {p['id']} -> {current_club}")
            continue

        club_id, club_slug = resolve_club_id(current_club)
        polite_sleep()
        if not club_id and tm_current and tm_current != current_club:
            # 정식 명칭("Brighton & Hove Albion")은 TM 검색에서 안 잡히는데
            # TM이 쓰는 축약명("Brighton")은 잡히는 클럽들이 있다 - 폴백 시도.
            club_id, club_slug = resolve_club_id(tm_current)
            polite_sleep()
        if not club_id:
            print(f"[warn] club id not found for {current_club} ({p['id']})")
            club_name_to_result[current_club] = None
            out[p["id"]] = None
            continue

        rank_info = fetch_last_completed_season_rank(club_id, club_slug)
        polite_sleep()
        club_name_to_result[current_club] = rank_info
        out[p["id"]] = rank_info
        print(f"[done] {p['id']} ({current_club}) -> {rank_info}")

        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
