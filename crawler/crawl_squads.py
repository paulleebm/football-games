"""
90인 풀 각 선수의 "현재/가장 최근 시니어 클럽" 스쿼드 페이지를 긁어서,
풀 밖에도 있는 유명 동료(notableTeammates)를 뽑아낸다.
(crawler/data/raw/{id}.json 이 이미 있어야 함 - crawl.py 먼저 실행)

시장가치 상위 N명만 남겨서 "유명한" 동료로 제한한다.
크롤링 부하를 줄이기 위해 클럽+시즌 조합을 캐시해서 같은 스쿼드를 여러 번 긁지 않는다.
"""
import json
import random
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from players import ALL_PLAYERS

RAW_DIR = Path(__file__).parent / "data" / "raw"
SQUAD_CACHE_DIR = Path(__file__).parent / "data" / "squads"
SQUAD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = Path(__file__).parent / "data" / "notable_teammates.json"

TM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
MIN_MARKET_VALUE_M = 15  # 이 이상 시장가치(백만 유로)를 가진 동료만 "유명한" 것으로 취급
TOP_N_PER_SQUAD = 8
CURRENT_SEASON = 2026  # TM의 saison_id 기준 "2026/27" 시즌 (2026-09 현재 진행 중)


def normalize_name(name):
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", ascii_name.lower())


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
    # 검색 결과 페이지에는 "Clubs" 결과 박스 말고도 사이드바/추천 위젯에
    # /startseite/verein/ 링크가 섞여 있어서, 페이지 전체에서 첫 매치를 집으면
    # 엉뚱한 클럽(예: Chelsea 검색 -> 무관한 하위 리그 클럽)이 잡힌다.
    # "Clubs" 섹션 h2를 찾아 그 박스 안에서만 검색해야 진짜 1순위 결과가 나온다.
    club_h2 = next((h for h in soup.select("h2") if "Clubs" in h.get_text()), None)
    box = club_h2.find_parent("div", class_="box") if club_h2 else None
    a = (box or soup).select_one("a[href*='/startseite/verein/']")
    if not a:
        return None, None
    m = re.search(r"/startseite/verein/(\d+)", a["href"])
    slug = a["href"].split("/")[1] if a["href"].startswith("/") else None
    return (m.group(1) if m else None), slug


def parse_market_value_m(text):
    if not text:
        return 0
    text = text.replace(",", ".")
    m = re.search(r"([\d.]+)\s*m", text)
    if m:
        return float(m.group(1))
    m = re.search(r"([\d.]+)\s*k", text)
    if m:
        return float(m.group(1)) / 1000
    return 0


def scrape_squad(club_id, club_slug, season_year):
    # exclude_name을 여기서 필터링하면 안 된다 - 캐시가 club_id+season 단위라서
    # 같은 클럽 소속인 여러 풀 선수가 각자 다른 exclude_name으로 이 함수를 부르면
    # 캐시를 먼저 채운 선수의 exclude_name만 영구 반영되고 나머지는 자기 자신이
    # 동료 목록에 남는 문제가 생긴다. 전체 스쿼드를 그대로 캐시하고, 제외는
    # 호출부(main)에서 매번 따로 한다.
    cache_path = SQUAD_CACHE_DIR / f"{club_id}_{season_year}.json"
    if cache_path.exists():
        return json.load(open(cache_path, encoding="utf-8"))

    url = f"https://www.transfermarkt.com/{club_slug}/kader/verein/{club_id}/saison_id/{season_year}"
    r = http_get(url)
    if r is None:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    rows = soup.select("table.items > tbody > tr")
    members = []
    for row in rows:
        name_a = row.select_one("td.posrela a")
        if not name_a:
            continue
        name = name_a.get_text(strip=True)
        if not name:
            continue
        mv_a = row.select_one("td.rechts.hauptlink a")
        mv_text = mv_a.get_text(strip=True) if mv_a else None
        mv = parse_market_value_m(mv_text)
        pos_row = row.select_one("td.posrela table tr:nth-of-type(2) td")
        position = pos_row.get_text(strip=True) if pos_row else None
        nat_imgs = row.select("td.zentriert img.flaggenrahmen")
        nat = nat_imgs[0].get("title") if nat_imgs else None
        members.append({"name": name, "marketValueM": mv, "position": position, "nationality": nat})

    members.sort(key=lambda m: m["marketValueM"], reverse=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    return members


def is_reserve_team(name):
    return bool(re.search(
        r"(\sII$|\s[BC]$|\s2$|\bU-?21\b|\bU-?23\b|\bCastilla\b|\bAtl[eè]tic\b|\bReserves?\b)",
        name or "", re.I))


def most_recent_stint(wiki_club_stints):
    best = None
    for stint in wiki_club_stints or []:
        club = re.sub(r"^→\s*", "", stint.get("club") or "")
        club = re.sub(r"\s*\(.*?\)\s*$", "", club).strip()
        if not club or is_reserve_team(club):
            continue
        years = (stint.get("years") or "").replace("–", "-")
        m = re.findall(r"\d{4}", years)
        if not m:
            continue
        start = int(m[0])
        # 인포박스는 연대순으로 정렬돼 있으므로, 시작연도가 같으면(예: 같은 해
        # 두 번 임대) 리스트에서 "나중에" 나오는 쪽이 실제로 더 최근이다.
        if best is None or start >= best[0]:
            best = (start, stint)
    return best[1] if best else None


def main():
    out = {}
    if OUT_PATH.exists():
        out = json.load(open(OUT_PATH, encoding="utf-8"))

    for p in ALL_PLAYERS:
        if p["id"] in out:
            print(f"[skip] {p['id']}")
            continue
        raw_path = RAW_DIR / f"{p['id']}.json"
        if not raw_path.exists():
            print(f"[skip] no raw data for {p['id']}")
            continue
        raw = json.load(open(raw_path, encoding="utf-8"))
        stint = most_recent_stint((raw.get("wiki") or {}).get("clubStints"))
        if not stint or not stint.get("club"):
            print(f"[warn] no club stint for {p['id']}")
            out[p["id"]] = []
            continue

        club_name = re.sub(r"^→\s*", "", stint["club"])
        club_name = re.sub(r"\s*\(.*?\)\s*$", "", club_name).strip()
        club_id, club_slug = resolve_club_id(club_name)
        polite_sleep()
        if not club_id:
            print(f"[warn] club id not found for {club_name} ({p['id']})")
            out[p["id"]] = []
            continue

        # 진행 중인 스틴트("2018–"처럼 끝이 열려 있음)라면 스틴트 "시작연도"가 아니라
        # 현재 시즌(CURRENT_SEASON)의 스쿼드를 긁어야 한다 - 시작연도를 쓰면 오래 전
        # 이적한 선수의 경우 몇 년 전 스쿼드(이미 떠난 동료 포함)를 긁는 버그가 생긴다.
        years_text = (stint.get("years") or "").strip()
        is_ongoing = years_text.endswith("–") or years_text.endswith("-")
        nums = re.findall(r"\d{4}", years_text)
        if is_ongoing or not nums:
            season_year = CURRENT_SEASON
        else:
            season_year = min(int(nums[-1]), CURRENT_SEASON)

        members = scrape_squad(club_id, club_slug, season_year)
        polite_sleep()

        # normalize_name은 비-라틴 문자(한글/조지아 문자 등)를 전부 걸러내므로
        # nameHomeCountry가 그런 경우 빈 문자열이 되는데, 빈 문자열은 파이썬에서
        # 모든 문자열의 부분문자열("" in "x" == True)이라 부분일치 검사에 넣으면
        # 스쿼드 전원이 "본인"으로 걸러지는 사고가 난다 - 정규화 결과가 실제로
        # 있는(길이 3 이상) 것만 후보로 남긴다.
        exclude_names = {
            nn for n in (p["en"], p.get("tm_query"), raw["profile"].get("nameHomeCountry")) if n
            for nn in [normalize_name(n)] if len(nn) >= 3
        }

        def is_self(member_name):
            nm = normalize_name(member_name)
            if not nm:
                return False
            return any(nm == nn or (len(nm) >= 5 and len(nn) >= 5 and (nm in nn or nn in nm))
                       for nn in exclude_names)

        notable = [m for m in members if not is_self(m["name"]) and m["marketValueM"] >= MIN_MARKET_VALUE_M][:TOP_N_PER_SQUAD]
        out[p["id"]] = {"club": club_name, "season": season_year, "teammates": notable}
        print(f"[done] {p['id']}: {len(notable)} notable teammates at {club_name}")

        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
