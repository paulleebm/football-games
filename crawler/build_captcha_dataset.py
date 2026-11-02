"""Build the CAPTCHA speedrun player pool from live FotMob team squads.

The output is intentionally a small, recognizable pool: eight high-value players
from each of 17 famous clubs.  The browser creates its five balanced questions
from this normalized static snapshot, so gameplay never depends on FotMob latency.

Run:
  python crawler/build_captcha_dataset.py
  python crawler/build_captcha_dataset.py --skip-photos
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "public" / "data" / "captcha_players.json"
PHOTOS_DIR = ROOT / "public" / "captcha" / "photos"
PLAYERS_PER_CLUB = 20

# 사진 파일명/공개 id를 FotMob 진짜 선수 id로 그대로 쓰면, 화면에 뜨는 <img src>만
# 읽어도 "이 사진 = 이 FotMob 선수"가 바로 드러나서 정답 대조가 너무 쉬워진다
# (실제로 이 취약점 때문에 비정상적인 스피드런 기록이 나왔음). 이 SALT는 빌드
# 스크립트(서버 쪽)에만 있고 클라이언트에 절대 나가지 않으므로, 공개되는 토큰만
# 봐서는 원래 FotMob id를 역산할 수 없다. 안정적인 토큰이라 재실행해도 이미
# 받아둔 사진을 그대로 재사용할 수 있다(파일명이 안 바뀜).
PHOTO_TOKEN_SALT = "gyp-captcha-photo-token-v1"


def photo_token(player_id: str) -> str:
    return hashlib.sha256(f"{player_id}:{PHOTO_TOKEN_SALT}".encode()).hexdigest()[:20]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}

# id, English display name, Korean condition label, league key/name/Korean label
CLUBS = [
    (9825, "Arsenal", "아스날", "premier-league", "Premier League", "프리미어리그"),
    (8455, "Chelsea", "첼시", "premier-league", "Premier League", "프리미어리그"),
    (8650, "Liverpool", "리버풀", "premier-league", "Premier League", "프리미어리그"),
    (8456, "Manchester City", "맨체스터 시티", "premier-league", "Premier League", "프리미어리그"),
    (10260, "Manchester United", "맨체스터 유나이티드", "premier-league", "Premier League", "프리미어리그"),
    (8586, "Tottenham Hotspur", "토트넘 홋스퍼", "premier-league", "Premier League", "프리미어리그"),
    (8633, "Real Madrid", "레알 마드리드", "laliga", "LaLiga", "라리가"),
    (8634, "Barcelona", "바르셀로나", "laliga", "LaLiga", "라리가"),
    (9906, "Atletico Madrid", "아틀레티코 마드리드", "laliga", "LaLiga", "라리가"),
    (9823, "Bayern Munich", "바이에른 뮌헨", "bundesliga", "Bundesliga", "분데스리가"),
    (9789, "Borussia Dortmund", "도르트문트", "bundesliga", "Bundesliga", "분데스리가"),
    (8178, "Bayer Leverkusen", "레버쿠젠", "bundesliga", "Bundesliga", "분데스리가"),
    (8636, "Inter", "인테르", "serie-a", "Serie A", "세리에 A"),
    (8564, "AC Milan", "AC 밀란", "serie-a", "Serie A", "세리에 A"),
    (9885, "Juventus", "유벤투스", "serie-a", "Serie A", "세리에 A"),
    (9875, "Napoli", "나폴리", "serie-a", "Serie A", "세리에 A"),
    (9847, "Paris Saint-Germain", "파리 생제르맹", "ligue-1", "Ligue 1", "리그 1"),
]

POSITION_GROUPS = {
    "GK": ("GK", "골키퍼"),
    "CB": ("DEF", "수비수"),
    "LB": ("DEF", "수비수"),
    "RB": ("DEF", "수비수"),
    "LWB": ("DEF", "수비수"),
    "RWB": ("DEF", "수비수"),
    "CDM": ("MID", "미드필더"),
    "CM": ("MID", "미드필더"),
    "CAM": ("MID", "미드필더"),
    "LM": ("MID", "미드필더"),
    "RM": ("MID", "미드필더"),
    "ST": ("FWD", "공격수"),
    "LW": ("FWD", "공격수"),
    "RW": ("FWD", "공격수"),
}

POSITION_DETAIL_GROUPS = {
    "GK": ("goalkeeper", "골키퍼"),
    "CB": ("centre-back", "센터백"),
    "LB": ("full-back", "풀백"),
    "RB": ("full-back", "풀백"),
    "LWB": ("full-back", "풀백"),
    "RWB": ("full-back", "풀백"),
    "CDM": ("central-midfielder", "중앙 미드필더"),
    "CM": ("central-midfielder", "중앙 미드필더"),
    "CAM": ("central-midfielder", "중앙 미드필더"),
    "LM": ("winger", "윙어"),
    "RM": ("winger", "윙어"),
    "LW": ("winger", "윙어"),
    "RW": ("winger", "윙어"),
    "ST": ("striker", "스트라이커"),
}

CLUB_CITY_GROUPS = {
    9825: ("london", "런던 연고 팀"),
    8455: ("london", "런던 연고 팀"),
    8586: ("london", "런던 연고 팀"),
    8456: ("manchester", "맨체스터 연고 팀"),
    10260: ("manchester", "맨체스터 연고 팀"),
    8633: ("madrid", "마드리드 연고 팀"),
    9906: ("madrid", "마드리드 연고 팀"),
    8636: ("milan", "밀라노 연고 팀"),
    8564: ("milan", "밀라노 연고 팀"),
}

COUNTRY_KO = {
    "ALG": "알제리", "ARG": "아르헨티나", "AUT": "오스트리아", "BEL": "벨기에",
    "BFA": "부르키나파소", "BRA": "브라질",
    "CAN": "캐나다", "CIV": "코트디부아르", "COL": "콜롬비아", "CRO": "크로아티아",
    "CMR": "카메룬", "CZE": "체코", "DEN": "덴마크", "ECU": "에콰도르", "EGY": "이집트",
    "ENG": "잉글랜드", "ESP": "스페인", "FRA": "프랑스", "GEO": "조지아",
    "GER": "독일", "GHA": "가나", "GRE": "그리스", "GUI": "기니", "HUN": "헝가리",
    "ITA": "이탈리아",
    "JPN": "일본", "KOR": "대한민국", "KVX": "코소보", "MAR": "모로코", "MEX": "멕시코",
    "NED": "네덜란드", "NGA": "나이지리아", "NIR": "북아일랜드", "NOR": "노르웨이", "POL": "폴란드",
    "POR": "포르투갈", "RUS": "러시아", "SCO": "스코틀랜드", "SEN": "세네갈", "SRB": "세르비아",
    "SVK": "슬로바키아", "SVN": "슬로베니아", "SUI": "스위스", "SWE": "스웨덴",
    "TUR": "튀르키예", "UKR": "우크라이나", "URU": "우루과이", "USA": "미국",
    "UZB": "우즈베키스탄",
}

COUNTRY_CONTINENTS = {
    **{code: ("africa", "아프리카 국적") for code in ("ALG", "BFA", "CMR", "EGY", "GHA", "GUI", "CIV", "MAR", "NGA", "SEN")},
    **{code: ("europe", "유럽 국적") for code in ("AUT", "BEL", "CRO", "CZE", "DEN", "ENG", "ESP", "FRA", "GEO", "GER", "GRE", "HUN", "ITA", "KVX", "NED", "NIR", "NOR", "POL", "POR", "RUS", "SCO", "SRB", "SVK", "SVN", "SUI", "SWE", "TUR", "UKR")},
    **{code: ("south-america", "남아메리카 국적") for code in ("ARG", "BRA", "COL", "ECU", "URU")},
    **{code: ("north-america", "북중미 국적") for code in ("CAN", "MEX", "USA")},
    **{code: ("asia", "아시아 국적") for code in ("JPN", "KOR", "UZB")},
}


def fetch_squad(session: requests.Session, team_id: int) -> list[dict]:
    response = session.get(
        "https://www.fotmob.com/api/data/teams",
        params={"id": team_id},
        timeout=25,
    )
    response.raise_for_status()
    members: list[dict] = []
    for group in response.json().get("squad", {}).get("squad", []):
        if group.get("title") != "coach":
            members.extend(group.get("members", []))
    return members


def normalize_player(raw: dict, club: tuple) -> dict | None:
    team_id, team, team_ko, league_id, league, league_ko = club
    detailed_position = (raw.get("positionIdsDesc") or "").split(",")[0].strip()
    position = POSITION_GROUPS.get(detailed_position)
    position_detail = POSITION_DETAIL_GROUPS.get(detailed_position)
    player_id = raw.get("id")
    if not player_id or not raw.get("name") or not position or not position_detail:
        return None
    country_code = raw.get("ccode") or ""
    country = raw.get("cname") or country_code
    continent = COUNTRY_CONTINENTS.get(country_code, ("", ""))
    city_group = CLUB_CITY_GROUPS.get(team_id, ("", ""))
    token = photo_token(str(player_id))
    return {
        "id": token,
        "_fotmobId": str(player_id),  # 사진 다운로드에만 쓰고 최종 JSON에는 안 남긴다
        "name": raw["name"],
        "countryCode": country_code,
        "country": country,
        "countryKo": COUNTRY_KO.get(country_code, ""),
        "continentId": continent[0],
        "continentKo": continent[1],
        "teamId": str(team_id),
        "team": team,
        "teamKo": team_ko,
        "leagueId": league_id,
        "league": league,
        "leagueKo": league_ko,
        "positionDetail": detailed_position,
        "positionDetailGroup": position_detail[0],
        "positionDetailKo": position_detail[1],
        "positionGroup": position[0],
        "positionKo": position[1],
        "cityGroup": city_group[0],
        "cityKo": city_group[1],
        "photo": f"captcha/photos/{token}.png",
        "transferValue": raw.get("transferValue") or 0,
    }


def is_valid_png(path: Path) -> bool:
    if not path.exists() or path.stat().st_size <= 1_000:
        return False
    try:
        return path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    except OSError:
        return False


def select_and_download(session: requests.Session, skip_photos: bool) -> list[dict]:
    """Pick PLAYERS_PER_CLUB players per club, skipping any whose photo can't be
    fetched (e.g. FotMob returns 403) and falling back to the next-highest-value
    eligible player instead of failing the whole run."""
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    selected: list[dict] = []
    for index, club in enumerate(CLUBS, 1):
        squad = [normalize_player(player, club) for player in fetch_squad(session, club[0])]
        eligible = [player for player in squad if player]
        eligible.sort(key=lambda player: (player["transferValue"], player["name"]), reverse=True)
        chosen: list[dict] = []
        skipped: list[str] = []
        for player in eligible:
            if len(chosen) >= PLAYERS_PER_CLUB:
                break
            destination = ROOT / "public" / player["photo"]
            if skip_photos or is_valid_png(destination):
                chosen.append(player)
                continue
            try:
                response = session.get(
                    f"https://images.fotmob.com/image_resources/playerimages/{player['_fotmobId']}.png",
                    timeout=25,
                )
                response.raise_for_status()
                if len(response.content) <= 1_000 or not response.content.startswith(b"\x89PNG"):
                    raise ValueError(f"invalid PNG ({len(response.content)} bytes)")
                destination.write_bytes(response.content)
                chosen.append(player)
            except Exception as exc:  # noqa: BLE001
                skipped.append(f"{player['name']} ({player['_fotmobId']}): {exc}")
            time.sleep(0.12)
        if len(chosen) != PLAYERS_PER_CLUB:
            raise RuntimeError(
                f"{club[1]} has only {len(chosen)} players with usable photos "
                f"(skipped: {skipped or 'none'})"
            )
        if skipped:
            print(f"  skipped (no usable photo): {'; '.join(skipped)}")
        selected.extend(chosen)
        print(f"[{index:02}/{len(CLUBS)}] {club[1]}: {', '.join(p['name'] for p in chosen)}")
        time.sleep(0.35)
    return selected


def validate(players: list[dict]) -> None:
    expected = len(CLUBS) * PLAYERS_PER_CLUB
    if len(players) != expected:
        raise RuntimeError(f"expected {expected} players, got {len(players)}")
    ids = [player["id"] for player in players]
    if len(ids) != len(set(ids)):
        raise RuntimeError("duplicate FotMob player ids in selected pool")
    club_counts = Counter(player["team"] for player in players)
    if any(count != PLAYERS_PER_CLUB for count in club_counts.values()):
        raise RuntimeError(f"unbalanced club counts: {club_counts}")
    invalid = [player["photo"] for player in players if not is_valid_png(ROOT / "public" / player["photo"])]
    if invalid:
        raise RuntimeError(f"missing or invalid PNG photos: {len(invalid)}")
    untranslated = [f"{player['name']} ({player['countryCode']})" for player in players if not player["countryKo"] or not player["continentId"]]
    if untranslated:
        raise RuntimeError("unreviewed country translations: " + ", ".join(untranslated))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-photos", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update(HEADERS)
    players = select_and_download(session, args.skip_photos)
    validate(players)
    for player in players:
        player.pop("_fotmobId", None)  # 다운로드 전용 필드 - 클라이언트 JSON에는 안 나감

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "FotMob team squads and player profile images",
        "playersPerClub": PLAYERS_PER_CLUB,
        "players": players,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    staged_json = OUT_JSON.with_suffix(".json.tmp")
    staged_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    staged_json.replace(OUT_JSON)
    print(f"wrote {len(players)} players to {OUT_JSON}")
    print("leagues:", Counter(player["league"] for player in players))
    print("positions:", Counter(player["positionGroup"] for player in players))


if __name__ == "__main__":
    main()
