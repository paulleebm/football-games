"""Build card-pack-only extra players missing from captcha_players.json.

captcha_players.json keeps only the top-20 transfer values per club of 17 big
clubs, so two groups never reach the card pack:
  1. famous veterans at those clubs whose market value dropped (FAMOUS below)
  2. highly rated players elsewhere: every men's player with EA FC OVR >= MIN_OVR
     (rare tier and up) at any club, placed at his current FotMob club
They go to public/card/extra_players.json, which only the card pack reads, so
CAPTCHA/connect and other games stay unchanged.

Each entry has the same shape as captcha_players.json players, plus:
  ovr        EA SPORTS FC overall rating (drop-api.ea.com, same source as ratings.json)
  ovrSource  "ea" when matched in EA data, "manual" otherwise (see ovrNote)
  group      "veteran" (FAMOUS) or "ea-top" (EA OVR >= MIN_OVR)
  colors     [main, accent, dark] card colors, only for clubs outside the 17 big clubs
Club crests outside the 17 clubs are saved to public/card/crests/<teamId>.webp.

Run:
  python crawler/build_card_extra_players.py
"""

from __future__ import annotations

import io
import json
import sys
import time
import unicodedata
from datetime import datetime, timezone

import requests
from PIL import Image

from build_captcha_dataset import (
    CLUBS, COUNTRY_CONTINENTS, COUNTRY_KO, HEADERS, OUT_JSON, ROOT,
    fetch_squad, is_valid_png, normalize_player, photo_token,
)

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = ROOT / "public" / "card" / "extra_players.json"
CRESTS = ROOT / "public" / "card" / "crests"
COACHES = ROOT / "public" / "card" / "coaches.json"
ICONS = ROOT / "public" / "card" / "icons.json"
ID_CACHE = ROOT / "crawler" / "cache" / "card_ea_fotmob_ids.json"
EA_URL = "https://drop-api.ea.com/rating/ea-sports-fc"
MIN_OVR = 81  # 카드팩 레어 등급 하한 (index.html tierOf)

# 팀 이름 -> 넣을 선수 FotMob 표기 이름. 축구 팬이 이름만 들어도 아는 베테랑만 고른다
# (유망주·무명 백업 제외). 2026-11-01 FotMob 스쿼드 기준.
FAMOUS = {
    "Arsenal": ["David Raya", "Kepa Arrizabalaga"],
    "Chelsea": ["Danny Welbeck", "Jordan Henderson"],
    "Liverpool": ["Virgil van Dijk", "Konstantinos Tsimikas", "Wataru Endo"],
    "Manchester United": ["Luke Shaw", "Harry Maguire"],
    "Tottenham Hotspur": ["Rodrigo Bentancur", "Andrew Robertson", "Ben Davies"],
    "Real Madrid": ["Thibaut Courtois", "Antonio Rüdiger", "Ferland Mendy", "Andriy Lunin"],
    "Barcelona": ["João Cancelo", "Wojciech Szczęsny", "Dominik Livaković"],
    "Bayern Munich": ["Manuel Neuer"],
    "Borussia Dortmund": ["Emre Can"],
    "Bayer Leverkusen": ["Lucas Vázquez", "Jonas Hofmann"],
    "Inter": ["Henrikh Mkhitaryan", "Piotr Zieliński"],
    "AC Milan": ["Luka Modrić", "Ruben Loftus-Cheek"],
    "Juventus": ["Arkadiusz Milik"],
    "Napoli": ["Matteo Politano", "Leonardo Spinazzola"],
    "Paris Saint-Germain": ["Lucas Digne"],
}

# captcha 데이터셋 번역표에 없는 국적
EXTRA_COUNTRY_KO = {
    "ARM": "아르메니아", "WAL": "웨일스", "KSA": "사우디아라비아", "COD": "콩고민주공화국",
    "NZL": "뉴질랜드", "VEN": "베네수엘라", "FIN": "핀란드", "GAB": "가봉", "BIH": "보스니아 헤르체고비나",
}
EXTRA_CONTINENTS = {
    **{code: ("europe", "유럽 국적") for code in ("ARM", "WAL", "FIN", "BIH")},
    **{code: ("africa", "아프리카 국적") for code in ("COD", "GAB")},
    "KSA": ("asia", "아시아 국적"),
    "NZL": ("oceania", "오세아니아 국적"),
    "VEN": ("south-america", "남아메리카 국적"),
}

# FotMob과 EA 표기가 다른 선수
EA_NAME = {"Konstantinos Tsimikas": "Kostas Tsimikas"}

# EA -> FotMob 선수 매칭 수동 지정 (이름 검색으로 안 잡히는 선수): {EA id: FotMob id}
EA_FOTMOB: dict[str, str] = {
    "238794": "846033",  # Vini Jr. = Vinícius Júnior (이미 captcha 풀에 있음)
}

# EA OVR이 높아도 넣지 않는 선수: {FotMob id: 사유}
EA_SKIP: dict[str, str] = {
    "447084": "Niklas Süle - FotMob 소속이 아마추어 팀(SV Tiefenbach), 엠블럼도 없음",
}

# 빅클럽 밖 구단 한글 이름 {FotMob 팀 id: 이름}
TEAM_KO: dict[int, str] = {
    # 잉글랜드
    10252: "애스턴 빌라", 10261: "뉴캐슬", 10203: "노팅엄 포레스트", 8668: "에버턴",
    8472: "선덜랜드", 9902: "입스위치", 8654: "웨스트햄", 10204: "브라이턴", 9879: "풀럼",
    9826: "크리스탈 팰리스", 8678: "본머스",
    # 스페인
    8315: "아틀레틱 클루브", 8305: "헤타페", 10205: "비야레알", 8603: "레알 베티스",
    8560: "레알 소시에다드", 9910: "셀타 비고", 9783: "데포르티보", 8661: "마요르카",
    8371: "오사수나", 8302: "세비야", 10267: "발렌시아", 8370: "라요 바예카노", 7854: "레가네스",
    # 이탈리아
    8686: "AS 로마", 8535: "피오렌티나", 8543: "라치오", 8524: "아탈란타", 9857: "볼로냐",
    10171: "코모", 8600: "우디네세", 7943: "사수올로", 9804: "토리노", 9888: "레체",
    # 독일
    178475: "RB 라이프치히", 8226: "호펜하임", 10269: "슈투트가르트", 9810: "프랑크푸르트",
    8358: "프라이부르크", 9905: "마인츠", 9788: "묀헨글라트바흐", 10189: "샬케 04",
    # 프랑스
    9748: "리옹", 9829: "모나코", 8592: "마르세유", 6379: "파리 FC",
    # 포르투갈·네덜란드·벨기에·그리스·튀르키예
    9773: "FC 포르투", 9772: "벤피카", 9768: "스포르팅 CP", 10264: "브라가",
    8593: "아약스", 8640: "PSV", 8342: "클뤼프 브뤼허",
    10200: "파나티나이코스", 8638: "올림피아코스", 8619: "PAOK",
    8637: "갈라타사라이", 8695: "페네르바흐체", 10188: "베식타시", 9752: "트라브존스포르",
    # 사우디·카타르·UAE
    2529: "알힐랄", 101918: "알나스르", 2530: "알아흘리", 8577: "알이티하드",
    101919: "알카디시야", 101916: "알샤바브", 101895: "알사드", 101898: "알라이얀",
    101904: "알샤말", 102101: "알자지라",
    # 미주
    6397: "시카고 파이어", 267810: "올랜도 시티", 867280: "LAFC", 960720: "인터 마이애미",
    6001: "콜럼버스 크루", 10076: "리버 플레이트",
}

# FotMob 리그 이름 -> (id, 한글)
LEAGUE_KO: dict[str, tuple[str, str]] = {
    "Premier League": ("premier-league", "프리미어리그"),
    "Championship": ("championship", "챔피언십"),
    "LaLiga": ("laliga", "라리가"),
    "LaLiga2": ("laliga2", "라리가 2"),
    "Serie A": ("serie-a", "세리에 A"),
    "Bundesliga": ("bundesliga", "분데스리가"),
    "Ligue 1": ("ligue-1", "리그 1"),
    "Liga Portugal": ("liga-portugal", "리가 포르투갈"),
    "Eredivisie": ("eredivisie", "에레디비시"),
    "Belgian Pro League": ("belgian-pro-league", "벨기에 프로리그"),
    "Super League": ("greek-super-league", "그리스 수페르리가"),
    "Super Lig": ("super-lig", "쉬페르 리그"),
    "Saudi Pro League": ("saudi-pro-league", "사우디 프로리그"),
    "Qatar Stars League": ("qatar-stars-league", "카타르 스타스리그"),
    "Pro League": ("uae-pro-league", "UAE 프로리그"),
    "Major League Soccer": ("mls", "MLS"),
    "Liga Profesional": ("liga-profesional", "아르헨티나 프리메라"),
}

# FotMob 포지션 키 -> 카드 포지션 코드 (스쿼드에 positionIdsDesc가 없을 때)
POS_KEY = {
    "keeper": "GK", "centerback": "CB", "leftback": "LB", "rightback": "RB",
    "leftwingback": "LWB", "rightwingback": "RWB", "defensivemidfielder": "CDM",
    "centermidfielder": "CM", "centerattackingmidfielder": "CAM", "leftmidfielder": "LM",
    "rightmidfielder": "RM", "leftwinger": "LW", "rightwinger": "RW", "striker": "ST",
}

# EA 데이터에 없는 선수만 손으로 정한다: {이름: (OVR, 사유)}
MANUAL_OVR: dict[str, tuple[int, str]] = {
    "Lucas Vázquez": (78, "EA FC 데이터(drop-api)에 없음 - 2025년 레알→레버쿠젠 이적 뒤 미등재. "
                          "레알 시절 EA OVR 80~82였으나 35세 로테이션 자원이라 78(일반)로 판단"),
}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.replace("ł", "l").replace("Ł", "L").replace("ø", "o"))
    return "".join(c for c in s if not unicodedata.combining(c)).lower().replace("-", " ")


def name_key(s: str) -> frozenset[str]:
    # 이름 순서가 달라도 같은 선수로 본다 (아이콘 "Son Heung-min" = EA "Heung-Min Son")
    return frozenset(fold(s).replace(".", " ").split())


def ea_lookup(session: requests.Session, name: str, team: str) -> dict | None:
    name = EA_NAME.get(name, name)
    last = name.split(" ", 1)[-1]
    response = session.get(EA_URL, params={"locale": "en", "limit": 50, "search": fold(last).split()[0]}, timeout=25)
    response.raise_for_status()
    want = fold(name)
    best = None
    for item in response.json().get("items", []):
        full = fold(f"{item.get('firstName') or ''} {item.get('lastName') or ''}")
        common = fold(item.get("commonName") or "")
        names_match = want in (full, common) or (fold(last) in full and want.split()[0] in full)
        if not names_match:
            continue
        # 같은 이름이 여럿이면 소속팀이 맞는 쪽
        same_team = fold(team.split()[0]) in fold((item.get("team") or {}).get("label") or "")
        if best is None or same_team:
            best = item
            if same_team:
                break
    return best


def ea_birthdate(item: dict) -> str:
    month, day, year = item["birthdate"].split()[0].split("/")
    return f"{int(year):04}-{int(month):02}-{int(day):02}"


def ea_name(item: dict) -> str:
    return item.get("commonName") or f"{item.get('firstName') or ''} {item.get('lastName') or ''}".strip()


def fetch_ea_top(session: requests.Session) -> list[dict]:
    """EA 남자 선수 중 OVR MIN_OVR 이상 (rank 순으로 넘기다 기준 밑으로 내려가면 멈춘다)."""
    items: list[dict] = []
    offset = 0
    while True:
        response = session.get(EA_URL, params={"locale": "en", "limit": 100, "offset": offset}, timeout=30)
        response.raise_for_status()
        page = response.json().get("items", [])
        items += page
        if not page or page[-1]["overallRating"] < MIN_OVR:
            break
        offset += 100
        time.sleep(0.3)
    return [i for i in items if i["overallRating"] >= MIN_OVR and (i.get("gender") or {}).get("id") == 0]


def player_data(session: requests.Session, fotmob_id: str) -> dict:
    response = session.get("https://www.fotmob.com/api/data/playerData", params={"id": fotmob_id}, timeout=25)
    response.raise_for_status()
    time.sleep(0.2)
    return response.json()


def find_fotmob_id(session: requests.Session, item: dict) -> str | None:
    """이름으로 FotMob을 검색해 생년월일이 EA와 같은 선수를 찾는다."""
    birth = ea_birthdate(item)
    terms = [item.get("commonName"), f"{item['firstName']} {item['lastName']}", item["lastName"]]
    for term in dict.fromkeys(t for t in terms if t):
        response = session.get("https://www.fotmob.com/api/data/search/suggest", params={"term": term, "lang": "en"}, timeout=25)
        response.raise_for_status()
        time.sleep(0.2)
        suggestions = [x for group in response.json() for x in group.get("suggestions", []) if x.get("type") == "player"]
        for suggestion in suggestions[:6]:
            data = player_data(session, suggestion["id"])
            if ((data.get("birthDate") or {}).get("utcTime") or "")[:10] == birth:
                return str(suggestion["id"])
    return None


def hex_dark(color: str, factor: float = 0.35) -> str:
    r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    return "#{:02x}{:02x}{:02x}".format(*(int(c * factor) for c in (r, g, b)))


def color_distance(a: str, b: str) -> float:
    return sum((int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) ** 2 for i in (1, 3, 5)) ** 0.5


def club_colors(team_id: int, team_colors: dict, coach_colors: dict) -> list[str]:
    # 감독 카드에 이미 있는 구단이면 그 색(엠블럼에서 뽑은 색)을 그대로 쓴다
    if team_id in coach_colors:
        return coach_colors[team_id]
    main = (team_colors.get("color") or "#3b82f6").lower()
    accent = (team_colors.get("colorAlternate") or "").lower()
    # 보조색이 주색과 비슷하면(같은 계열 진하기만 다른 경우) 흰색으로 대비를 준다
    if not accent or color_distance(accent, main) < 120:
        accent = "#ffffff"
    return [main, accent, hex_dark(main)]


def save_crest(session: requests.Session, team_id: int) -> None:
    destination = CRESTS / f"{team_id}.webp"
    if destination.exists():
        return
    response = session.get(f"https://images.fotmob.com/image_resources/logo/teamlogo/{team_id}.png", timeout=25)
    response.raise_for_status()
    image = Image.open(io.BytesIO(response.content)).convert("RGBA")
    image.thumbnail((128, 128), Image.LANCZOS)
    canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    canvas.paste(image, ((128 - image.width) // 2, (128 - image.height) // 2))
    canvas.save(destination, "WEBP", quality=90)


def finish_player(session: requests.Session, player: dict) -> None:
    """국적 번역 보충, 시장가치 하한, 사진 다운로드 (captcha 사진 규칙 그대로)."""
    code = player["countryCode"]
    player["countryKo"] = player["countryKo"] or EXTRA_COUNTRY_KO.get(code, "")
    if not player["continentId"]:
        player["continentId"], player["continentKo"] = EXTRA_CONTINENTS.get(code, COUNTRY_CONTINENTS.get(code, ("", "")))
    # 시장가치 0이면 카드팩이 걸러내므로 최소값을 둔다
    player["transferValue"] = player["transferValue"] or 1
    destination = ROOT / "public" / player["photo"]
    if not is_valid_png(destination):
        response = session.get(
            f"https://images.fotmob.com/image_resources/playerimages/{player['_fotmobId']}.png", timeout=25)
        response.raise_for_status()
        if len(response.content) <= 1_000 or not response.content.startswith(b"\x89PNG"):
            raise RuntimeError(f"{player['name']}: invalid photo ({len(response.content)} bytes)")
        destination.write_bytes(response.content)
    player.pop("_fotmobId", None)


def add_veterans(session: requests.Session, pool_ids: set[str]) -> list[dict]:
    clubs = {club[1]: club for club in CLUBS}
    players: list[dict] = []
    unrated: list[str] = []
    for team, names in FAMOUS.items():
        club = clubs[team]
        squad = {raw["name"]: raw for raw in fetch_squad(session, club[0])}
        for name in names:
            raw = squad.get(name)
            if not raw:
                print(f"  !! {name} not in {team} squad anymore - skipped")
                continue
            player = normalize_player(raw, club)
            if not player or player["id"] in pool_ids:
                print(f"  !! {name}: unusable or already in captcha pool - skipped")
                continue
            ea = ea_lookup(session, name, team)
            if ea:
                player["ovr"] = ea["overallRating"]
                player["ovrSource"] = "ea"
                player["eaTeam"] = (ea.get("team") or {}).get("label", "")
            elif name in MANUAL_OVR:
                player["ovr"], note = MANUAL_OVR[name]
                player["ovrSource"] = "manual"
                player["ovrNote"] = note
            else:
                unrated.append(name)
                continue
            player["group"] = "veteran"
            finish_player(session, player)
            players.append(player)
            pool_ids.add(player["id"])
            print(f"  {team}: {name} OVR {player['ovr']} ({player['ovrSource']}, EA team {player.get('eaTeam', '-')})")
            time.sleep(0.25)
        time.sleep(0.35)
    if unrated:
        raise RuntimeError("no EA rating and no MANUAL_OVR entry: " + ", ".join(unrated))
    return players


def fetch_team(session: requests.Session, team_id: int) -> tuple[dict, list[dict]]:
    response = session.get("https://www.fotmob.com/api/data/teams", params={"id": team_id}, timeout=25)
    response.raise_for_status()
    team_json = response.json() or {}  # 일부 하부 리그 팀은 null을 준다
    members = [m for g in (team_json.get("squad") or {}).get("squad") or [] if g.get("title") != "coach" for m in g.get("members", [])]
    time.sleep(0.3)
    return team_json.get("details") or {}, members


def raw_from_player_data(data: dict) -> dict:
    """스쿼드 목록에 없는 선수(임대 등)는 선수 정보로 스쿼드 항목 모양을 채운다."""
    position = POS_KEY.get((((data.get("positionDescription") or {}).get("primaryPosition")) or {}).get("key", ""), "")
    info = {i.get("translationKey"): i for i in data.get("playerInformation") or []}
    country = info.get("country_sentencecase") or {}
    return {
        "id": data.get("id"), "name": data.get("name"), "positionIdsDesc": position,
        "ccode": country.get("countryCode", ""), "cname": (country.get("value") or {}).get("fallback", ""),
        "transferValue": ((info.get("transfer_value") or {}).get("value") or {}).get("numberValue") or 0,
    }


def add_ea_top(session: requests.Session, pool_ids: set[str], pool_names: set[frozenset[str]]) -> list[dict]:
    id_cache: dict[str, str] = json.loads(ID_CACHE.read_text(encoding="utf-8")) if ID_CACHE.exists() else {}
    id_cache.update(EA_FOTMOB)
    big_clubs = {club[0]: club for club in CLUBS}
    coach_colors = {c["teamId"]: c["colors"] for c in json.loads(COACHES.read_text(encoding="utf-8"))["coaches"] if c.get("colors")}
    squads: dict[int, tuple[dict, list[dict]]] = {}
    players: list[dict] = []
    problems: list[str] = []
    for item in fetch_ea_top(session):
        name = ea_name(item)
        if {name_key(name), name_key(f"{item['firstName']} {item['lastName']}")} & pool_names:
            continue  # 이미 카드에 있는 선수 (이름이 같으면 검색 생략)
        ea_id = str(item["id"])
        fotmob_id = id_cache.get(ea_id) or find_fotmob_id(session, item)
        if not fotmob_id:
            problems.append(f"{name} (EA {ea_id}): FotMob match not found - add to EA_FOTMOB")
            continue
        id_cache[ea_id] = fotmob_id
        if photo_token(fotmob_id) in pool_ids:
            continue
        if fotmob_id in EA_SKIP:
            print(f"  -- {name}: {EA_SKIP[fotmob_id]}")
            continue
        data = player_data(session, fotmob_id)
        team = data.get("primaryTeam") or {}
        team_id = team.get("teamId")
        if not team_id:
            print(f"  -- {name}: no current club on FotMob - skipped")
            continue
        if team_id not in squads:
            squads[team_id] = fetch_team(session, team_id)
        details, members = squads[team_id]
        raw = next((m for m in members if str(m.get("id")) == fotmob_id), None) or raw_from_player_data(data)
        if team_id in big_clubs:
            club = big_clubs[team_id]
        else:
            league_name = details.get("primaryLeagueName") or ""
            league_id, league_ko = LEAGUE_KO.get(league_name, ("", ""))
            club = (team_id, details.get("name") or team.get("teamName"), TEAM_KO.get(team_id, ""), league_id, league_name, league_ko)
            if not club[2] or not league_ko:
                problems.append(f"{name}: translate team {team_id}: {club[1]!r} / league {league_name!r}")
        player = normalize_player(raw, club)
        if not player:
            problems.append(f"{name}: unusable FotMob position {raw.get('positionIdsDesc')!r}")
            continue
        player["ovr"] = item["overallRating"]
        player["ovrSource"] = "ea"
        player["eaTeam"] = (item.get("team") or {}).get("label", "")
        player["group"] = "ea-top"
        if team_id not in big_clubs:
            player["colors"] = club_colors(team_id, team.get("teamColors") or {}, coach_colors)
            save_crest(session, team_id)
        finish_player(session, player)
        players.append(player)
        pool_ids.add(player["id"])
        print(f"  {player['team']}: {player['name']} OVR {player['ovr']} (EA: {name}, {player['eaTeam']})")
    ID_CACHE.write_text(json.dumps(dict(sorted(id_cache.items())), indent=1) + "\n", encoding="utf-8")
    if problems:
        raise RuntimeError("fix before writing:\n  " + "\n  ".join(problems))
    return players


def main() -> None:
    session = requests.Session()
    session.headers.update(HEADERS)
    captcha = json.loads(OUT_JSON.read_text(encoding="utf-8"))["players"]
    icons = json.loads(ICONS.read_text(encoding="utf-8"))["players"]
    pool_ids = {p["id"] for p in captcha}
    players = add_veterans(session, pool_ids)
    # 아이콘은 FotMob id가 없어서 이름으로만 겹침을 거른다
    pool_names = {name_key(p["name"]) for p in captcha + icons + players}
    players += add_ea_top(session, pool_ids, pool_names)

    missing = [f"{p['name']} ({p['countryCode']})" for p in players if not p["countryKo"] or not p["continentId"]]
    if missing:
        raise RuntimeError("unreviewed country translations: " + ", ".join(missing))
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "FotMob team squads and player images; OVR from EA SPORTS FC official ratings (drop-api.ea.com)",
        "note": "Card-pack-only players missing from data/captcha_players.json: veterans at the 17 clubs "
                f"and every EA OVR {MIN_OVR}+ player at his current club",
        "players": players,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(players)} players to {OUT}")


if __name__ == "__main__":
    main()
