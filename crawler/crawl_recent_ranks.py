"""
"최근 3시즌 순위" 힌트용. 기존 crawl_league_rank.py는 "지난 시즌" 소속 클럽 하나의
가장 최근 순위 한 줄만 가져왔지만, 최근 3시즌(23/24, 24/25, 25/26)은 그사이 이적한
선수가 많아서(200인 풀 중 70%가 최근 3시즌 안에 이적) 그냥 "현재 클럽"의 최근 3줄을
가져오면 실제로 그 시즌에 몸담지도 않았던 클럽의 순위가 섞여 들어간다.

그래서 시즌마다 career 이력(startYear/endYear)으로 그 시즌에 실제로 있었던 클럽을
먼저 역산한 뒤, 그 클럽의 "그 시즌" 순위를 클럽별 전체 순위 이력 테이블에서 찾는다.
클럽 전체 이력은 클럽당 한 번만 크롤링해서 재사용한다(같은 클럽 소속 선수 여럿이면
캐시 히트).
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
OUT_PATH = Path(__file__).parent / "data" / "recent_season_ranks.json"
CLUB_RANK_CACHE_DIR = Path(__file__).parent / "data" / "rank_cache_full"
CLUB_RANK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
CLUB_ID_CACHE_PATH = Path(__file__).parent / "data" / "club_id_cache.json"

# 최근 3개 "완료된" 시즌의 시작 연도. 오늘(2026-09) 기준 25/26 시즌까지 끝났으므로
# 23/24, 24/25, 25/26 3개 시즌. 매 시즌 새로 크롤링할 때 이 리스트만 갱신하면 된다.
RECENT_SEASON_START_YEARS = [2023, 2024, 2025]
MIN_GAMES_FOR_COMPLETE_SEASON = 15

TM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


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


def season_label(y):
    return f"{y % 100:02d}/{(y + 1) % 100:02d}"


def stint_covers_year(stint, y):
    s, e = stint.get("startYear"), stint.get("endYear")
    if s is None:
        return False
    if e is None or e == s:
        return y == s
    return s <= y < e  # "2021-2023" -> 21/22, 22/23 시즌 (2023년 자체는 다음 소속팀)


def club_for_season(career, y):
    matches = [c for c in career if stint_covers_year(c, y)]
    if not matches:
        return None
    # 시즌 중 이적처럼 겹치는 스틴트가 있으면 끝 연도가 더 큰(=더 나중까지 있던) 쪽 우선
    matches.sort(key=lambda c: (c.get("endYear") or 9999))
    return matches[-1]["club"]


def load_json(path, default):
    if path.exists():
        return json.load(open(path, encoding="utf-8"))
    return default


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


def fetch_club_full_ranks(club_id, club_slug):
    cache_path = CLUB_RANK_CACHE_DIR / f"{club_id}.json"
    if cache_path.exists():
        return json.load(open(cache_path, encoding="utf-8"))

    url = f"https://www.transfermarkt.com/{club_slug}/platzierungen/verein/{club_id}"
    r = http_get(url)
    by_season = {}
    if r is not None:
        soup = BeautifulSoup(r.text, "html.parser")
        tables = soup.select("table")
        if len(tables) >= 2:
            rows = tables[1].select("tr")[1:]
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
                by_season[season] = {"season": season, "league": league, "rank": int(rank), "points": points}

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(by_season, f, ensure_ascii=False, indent=2)
    return by_season


def main():
    dataset = json.load(open(DATASET_PATH, encoding="utf-8"))
    by_id = {p["id"]: p for p in dataset}

    out = load_json(OUT_PATH, {})
    club_id_cache = load_json(CLUB_ID_CACHE_PATH, {})

    def save_club_id_cache():
        json.dump(club_id_cache, open(CLUB_ID_CACHE_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    todo = [p for p in PLAYERS if p["id"] not in out]
    if limit:
        todo = todo[:limit]

    for i, p in enumerate(todo):
        player = by_id.get(p["id"])
        if not player:
            print(f"[warn] {p['id']} not in dataset")
            out[p["id"]] = []
            continue
        career = [c for c in player.get("career", []) if c.get("startYear")]
        entries = []
        for y in RECENT_SEASON_START_YEARS:
            club = club_for_season(career, y)
            if not club:
                entries.append(None)
                continue
            if club not in club_id_cache:
                cid, slug = resolve_club_id(club)
                polite_sleep()
                if not cid and " & " in club:
                    # "Brighton & Hove Albion"처럼 정식 명칭에 "&"가 들어간 클럽은 TM
                    # 검색이 "Nothing found"를 반환한다 - "&" 앞부분(TM이 실제로 쓰는
                    # 축약명, 예: "Brighton")으로 재시도.
                    cid, slug = resolve_club_id(club.split(" & ")[0].strip())
                    polite_sleep()
                club_id_cache[club] = {"id": cid, "slug": slug}
                save_club_id_cache()
            cid_info = club_id_cache[club]
            if not cid_info.get("id"):
                entries.append(None)
                continue
            season_ranks = fetch_club_full_ranks(cid_info["id"], cid_info["slug"])
            if not (CLUB_RANK_CACHE_DIR / f"{cid_info['id']}.json").exists():
                pass  # fetch_club_full_ranks already wrote the cache file itself
            entries.append(season_ranks.get(season_label(y)))
            polite_sleep()
        out[p["id"]] = entries
        print(f"[{i+1}/{len(todo)}] {p['id']} -> {entries}")
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"wrote {OUT_PATH} ({len(out)} players)")


if __name__ == "__main__":
    main()
