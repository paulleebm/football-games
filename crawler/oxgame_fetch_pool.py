"""
유사도 맞히기(게임3)용 대규모 선수 풀 수집기. 소스: FotMob (Transfermarkt 대비 선수당 요청 수가
1/2~1/3로 적어서 대량 수집에 유리 - 프로필+커리어+트로피가 API 한 방에 다 나옴).

3단계:
  1) 5대리그 리그 테이블 API -> 클럽 목록/ID
  2) 클럽별 스쿼드 API -> 선수 기본 필드(이름/국적/신장/나이/생년월일/포지션/등번호/시장가치)
  3) 고유 선수별 상세 API -> 커리어 전체 이력, 트로피(클럽+국가대표, 월드컵/유로/코파아메리카/UCL 포함)

각 선수 원본 응답을 crawler/data/oxgame_raw/{playerId}.json 에 그대로 저장 (이미 있으면 스킵 -
재실행 가능, 중단 후 재개 가능). 클럽/스쿼드 중간 결과도 캐시해서 같은 클럽을 다시 안 긁는다.
"""
import json
import random
import sys
import time
from pathlib import Path

import requests

# Windows 콘솔 기본 코드페이지(cp949)로는 클럽/선수 이름에 흔한 é/í 등을 못 찍어서
# print()가 죽는 경우가 있음 - stdout/stderr을 UTF-8로 강제하고 안 되는 글자는 대체.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(__file__).parent / "data"
CLUBS_PATH = DATA_DIR / "oxgame_clubs.json"
SQUAD_DIR = DATA_DIR / "oxgame_squads"
RAW_DIR = DATA_DIR / "oxgame_raw"
LOG_PATH = DATA_DIR / "oxgame_fetch_log.txt"

for d in (SQUAD_DIR, RAW_DIR):
    d.mkdir(parents=True, exist_ok=True)

LEAGUES = {
    47: "Premier League",
    87: "LaLiga",
    54: "Bundesliga",
    55: "Serie A",
    53: "Ligue 1",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fotmob.com/",
}

MIN_DELAY, MAX_DELAY = 1.4, 2.4


def log(msg):
    print(msg)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def polite_sleep():
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def api_get(path, params=None, retries=4):
    url = f"https://www.fotmob.com{path}"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    log(f"    [warn] non-JSON 200 on {url} (attempt {attempt+1})")
            elif r.status_code == 429:
                wait = 15 * (attempt + 1)
                log(f"    [warn] 429 rate-limited on {url}, sleeping {wait}s")
                time.sleep(wait)
                continue
            else:
                log(f"    [warn] {r.status_code} on {url} (attempt {attempt+1})")
        except requests.RequestException as e:
            log(f"    [warn] {e} on {url} (attempt {attempt+1})")
        time.sleep(3 * (attempt + 1))
    return None


def fetch_clubs():
    if CLUBS_PATH.exists():
        return json.load(open(CLUBS_PATH, encoding="utf-8"))

    clubs = {}  # teamId(str) -> {name, leagueId, leagueName}
    for league_id, league_name in LEAGUES.items():
        data = api_get("/api/data/leagues", {"id": league_id})
        polite_sleep()
        if not data:
            log(f"[error] failed to fetch league {league_id} {league_name}")
            continue
        try:
            groups = data["table"]
        except (KeyError, TypeError):
            log(f"[error] unexpected league payload shape for {league_id}")
            continue
        count = 0
        for group in groups:
            rows = (group.get("data") or {}).get("table", {}).get("all", [])
            for row in rows:
                clubs[str(row["id"])] = {
                    "name": row["name"],
                    "leagueId": league_id,
                    "leagueName": league_name,
                }
                count += 1
        log(f"[ok] {league_name}: {count} clubs")

    with open(CLUBS_PATH, "w", encoding="utf-8") as f:
        json.dump(clubs, f, ensure_ascii=False, indent=2)
    return clubs


def fetch_squad(club_id, club_info):
    cache_path = SQUAD_DIR / f"{club_id}.json"
    if cache_path.exists():
        return json.load(open(cache_path, encoding="utf-8"))

    data = api_get("/api/data/teams", {"id": club_id})
    polite_sleep()
    if not data:
        log(f"  [warn] failed squad fetch for club {club_id} ({club_info['name']})")
        return []

    members = []
    for group in (data.get("squad") or {}).get("squad", []):
        if group.get("title") == "coach":
            continue
        for m in group.get("members", []):
            if m.get("excludeFromRanking") and not m.get("dateOfBirth"):
                # 코치/스태프 등 선수가 아닌 항목 방어적으로 스킵
                continue
            members.append({
                "id": m.get("id"),
                "name": m.get("name"),
                "shirtNumber": m.get("shirtNumber"),
                "nationalityCode": m.get("ccode"),
                "nationalityName": m.get("cname"),
                "position": m.get("positionIdsDesc"),
                "height": m.get("height"),
                "age": m.get("age"),
                "dateOfBirth": m.get("dateOfBirth"),
                "transferValue": m.get("transferValue"),
                "clubId": club_id,
                "clubName": club_info["name"],
                "leagueId": club_info["leagueId"],
                "leagueName": club_info["leagueName"],
            })

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    return members


def fetch_player_detail(player_id):
    out_path = RAW_DIR / f"{player_id}.json"
    if out_path.exists():
        return "skip"
    data = api_get("/api/data/playerData", {"id": player_id})
    polite_sleep()
    if not data:
        log(f"  [warn] failed player detail fetch for {player_id}")
        return "fail"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return "ok"


def main():
    log(f"=== run start {time.strftime('%Y-%m-%d %H:%M:%S')} ===")

    clubs = fetch_clubs()
    log(f"[step1] total clubs: {len(clubs)}")

    all_members = []
    for i, (club_id, club_info) in enumerate(clubs.items(), 1):
        members = fetch_squad(club_id, club_info)
        all_members.extend(members)
        log(f"[step2] ({i}/{len(clubs)}) {club_info['name']}: {len(members)} players")

    unique = {}
    for m in all_members:
        pid = m["id"]
        if pid is None:
            continue
        # 임대 등으로 여러 클럽 스쿼드에 중복 등장하면 시장가치가 더 높은(주로 원소속) 쪽을 채택
        if pid not in unique or (m.get("transferValue") or 0) > (unique[pid].get("transferValue") or 0):
            unique[pid] = m

    index_path = DATA_DIR / "oxgame_squad_index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False, indent=2)
    log(f"[step2] unique players: {len(unique)}")

    ok = fail = skip = 0
    ids = list(unique.keys())
    for i, pid in enumerate(ids, 1):
        result = fetch_player_detail(pid)
        if result == "ok":
            ok += 1
        elif result == "skip":
            skip += 1
        else:
            fail += 1
        if i % 25 == 0 or i == len(ids):
            log(f"[step3] {i}/{len(ids)} players (ok={ok} skip={skip} fail={fail})")

    log(f"=== run done: ok={ok} skip={skip} fail={fail} total_unique={len(unique)} ===")


if __name__ == "__main__":
    main()
