"""Build the Connect puzzle snapshot from a small, explicit FotMob club list.

The browser never calls FotMob. This script refreshes only the selected squads,
normalizes the five game fields, constructs 100 verified exact-cover puzzles, and
downloads only the player portraits that those puzzles use.

Run:
    python crawler/build_connect_dataset.py
    python crawler/build_connect_dataset.py --cached-squads
    python crawler/build_connect_dataset.py --cached-squads --refresh-positions
    python crawler/build_connect_dataset.py --skip-photos
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import itertools
import json
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "crawler" / "data"
RAW_DIR = DATA_DIR / "oxgame_raw"
SQUAD_DIR = DATA_DIR / "connect_squads"
POSITION_DATA_DIR = DATA_DIR / "connect_positions"
PLAYER_SNAPSHOT = DATA_DIR / "connect_players.json"
REPORT_PATH = DATA_DIR / "connect_puzzle_report.json"
PUZZLES_PATH = ROOT / "public" / "connect" / "puzzles.js"
HINTS_PATH = ROOT / "public" / "connect" / "hints.js"
PHOTOS_DIR = ROOT / "public" / "captcha" / "photos"

SQUAD_DIR.mkdir(parents=True, exist_ok=True)
POSITION_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fotmob.com/",
}

# EPL 20 clubs in the current FotMob league table, plus the requested six clubs.
CLUBS = {
    8455: "첼시",
    8456: "맨체스터 시티",
    8463: "리즈 유나이티드",
    8472: "선덜랜드",
    8586: "토트넘 홋스퍼",
    8650: "리버풀",
    8667: "헐 시티",
    8668: "에버턴",
    8669: "코번트리 시티",
    8678: "본머스",
    9825: "아스날",
    9826: "크리스털 팰리스",
    9879: "풀럼",
    9902: "입스위치 타운",
    9937: "브렌트퍼드",
    10203: "노팅엄 포레스트",
    10204: "브라이턴",
    10252: "애스턴 빌라",
    10260: "맨체스터 유나이티드",
    10261: "뉴캐슬 유나이티드",
    8633: "레알 마드리드",
    8634: "바르셀로나",
    9906: "아틀레티코 마드리드",
    9823: "바이에른 뮌헨",
    9847: "파리 생제르맹",
    8636: "인테르",
}

COUNTRY_KO = {
    "ALB": "알바니아", "ALG": "알제리", "ANG": "앙골라", "ARG": "아르헨티나",
    "AUS": "호주", "AUT": "오스트리아", "BEL": "벨기에", "BFA": "부르키나파소",
    "BIH": "보스니아 헤르체고비나", "BRA": "브라질", "CAN": "캐나다", "CHI": "칠레",
    "CIV": "코트디부아르", "CMR": "카메룬", "COD": "콩고민주공화국", "COL": "콜롬비아",
    "CRC": "코스타리카", "CRO": "크로아티아", "CZE": "체코", "DEN": "덴마크",
    "ECU": "에콰도르", "EGY": "이집트", "ENG": "잉글랜드", "ESP": "스페인",
    "FIN": "핀란드", "FRA": "프랑스", "GAB": "가봉", "GEO": "조지아",
    "GER": "독일", "GHA": "가나", "GRE": "그리스", "GUI": "기니",
    "HUN": "헝가리", "IRL": "아일랜드", "ISL": "아이슬란드", "ISR": "이스라엘",
    "ITA": "이탈리아", "JAM": "자메이카", "JPN": "일본", "KOR": "대한민국",
    "KVX": "코소보", "MAR": "모로코", "MEX": "멕시코", "MLI": "말리",
    "MNE": "몬테네그로", "NED": "네덜란드", "NGA": "나이지리아", "NIR": "북아일랜드",
    "NOR": "노르웨이", "NZL": "뉴질랜드", "PAR": "파라과이", "POL": "폴란드",
    "POR": "포르투갈", "ROU": "루마니아", "RSA": "남아프리카공화국", "SCO": "스코틀랜드",
    "SEN": "세네갈", "SRB": "세르비아", "SVK": "슬로바키아", "SVN": "슬로베니아",
    "SUI": "스위스", "SWE": "스웨덴", "TUN": "튀니지", "TUR": "튀르키예",
    "UKR": "우크라이나", "URU": "우루과이", "USA": "미국", "UZB": "우즈베키스탄",
    "WAL": "웨일스", "ZAM": "잠비아", "ZIM": "짐바브웨",
}

FIELDS = ("team", "birthYear", "position", "nationality", "shirtNumber")
FIELD_NAMES = {
    "team": "소속팀",
    "birthYear": "출생 연도",
    "position": "포지션",
    "nationality": "국적",
    "shirtNumber": "등번호",
}
PHOTO_TOKEN_SALT = "gyp-captcha-photo-token-v1"
RANDOM_SEED = 20260925
PLAYERS_PER_CLUB = 16
SECONDARY_POSITION_MIN_APPEARANCES = 8
SECONDARY_POSITION_MIN_SHARE = 0.25
MAX_COMPLETE_SOLUTIONS = 10
POSITION_SHORT_ALIASES = {"AM": "CAM", "DM": "CDM"}
PUZZLE_COUNT = 100

# Every entry describes the category used by each of the four intended groups.
# The sequence deliberately alternates structures instead of repeating one
# four-category recipe with different players.
BASE_PUZZLE_PATTERNS = [
    ("team",) * 4,
    ("shirtNumber",) * 4,
    ("position",) * 4,
    ("nationality",) * 4,
    ("birthYear",) * 4,
    ("team", "team", "position", "position"),
    ("shirtNumber", "shirtNumber", "nationality", "nationality"),
    ("birthYear", "birthYear", "team", "team"),
    ("position", "position", "shirtNumber", "shirtNumber"),
    ("nationality", "nationality", "birthYear", "birthYear"),
    ("team", "team", "team", "shirtNumber"),
    ("position", "position", "position", "nationality"),
    ("shirtNumber", "shirtNumber", "shirtNumber", "birthYear"),
    ("nationality", "nationality", "nationality", "team"),
    ("birthYear", "birthYear", "birthYear", "position"),
    ("team", "team", "position", "shirtNumber"),
    ("shirtNumber", "shirtNumber", "birthYear", "nationality"),
    ("position", "position", "team", "nationality"),
    ("nationality", "nationality", "shirtNumber", "birthYear"),
    ("birthYear", "birthYear", "position", "team"),
    ("team", "position", "nationality", "shirtNumber"),
    ("birthYear", "team", "position", "nationality"),
    ("shirtNumber", "birthYear", "team", "position"),
    ("nationality", "shirtNumber", "birthYear", "team"),
    ("position", "nationality", "shirtNumber", "birthYear"),
]
PUZZLE_PATTERNS = BASE_PUZZLE_PATTERNS * 4

FAMOUS_TEAM_BONUS = {
    "레알 마드리드": 440,
    "바르셀로나": 420,
    "바이에른 뮌헨": 400,
    "파리 생제르맹": 390,
    "맨체스터 시티": 380,
    "리버풀": 370,
    "아스날": 360,
    "첼시": 330,
    "맨체스터 유나이티드": 330,
    "인테르": 310,
    "토트넘 홋스퍼": 300,
    "아틀레티코 마드리드": 290,
}


def photo_token(player_id: int) -> str:
    return hashlib.sha256(f"{player_id}:{PHOTO_TOKEN_SALT}".encode()).hexdigest()[:20]


def api_get(session: requests.Session, path: str, params: dict) -> dict:
    url = f"https://www.fotmob.com{path}"
    for attempt in range(4):
        response = session.get(url, params=params, timeout=30)
        if response.status_code == 200:
            return response.json()
        if response.status_code == 429:
            time.sleep(10 * (attempt + 1))
        else:
            time.sleep(2 * (attempt + 1))
    response.raise_for_status()
    raise RuntimeError(f"FotMob request failed: {url}")


def current_minutes(player_id: int, club_id: int) -> int:
    path = RAW_DIR / f"{player_id}.json"
    if not path.exists():
        return 0
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    primary_team = raw.get("primaryTeam") or {}
    if int(primary_team.get("teamId") or 0) != club_id:
        return 0
    league = raw.get("mainLeague") or {}
    for stat in league.get("stats") or []:
        if stat.get("localizedTitleId") == "minutes_played" or stat.get("title") == "Minutes played":
            return int(stat.get("value") or 0)
    return 0


def position_label(entry: dict) -> str:
    raw = entry.get("strPosShort")
    label = raw.get("label") if isinstance(raw, dict) else raw
    return POSITION_SHORT_ALIASES.get(label, label or "")


def eligible_positions(player_id: int, fallback: str) -> list[str]:
    path = POSITION_DATA_DIR / f"{player_id}.json"
    legacy_path = RAW_DIR / f"{player_id}.json"
    source_path = path if path.exists() else legacy_path
    if not source_path.exists():
        return [fallback]
    try:
        raw = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [fallback]

    usage = []
    for entry in (raw.get("positionDescription") or {}).get("positions") or []:
        label = position_label(entry)
        if label:
            usage.append({
                "label": label,
                "appearances": int(entry.get("occurences") or 0),
                "isMain": entry.get("isMainPosition") is True,
            })
    main_candidates = sorted(
        (entry for entry in usage if entry["isMain"]),
        key=lambda entry: entry["appearances"],
        reverse=True,
    )
    if not main_candidates:
        return [fallback]

    main = main_candidates[0]
    positions = [main["label"]]
    secondary_candidates = sorted(
        (entry for entry in usage if entry["label"] != main["label"]),
        key=lambda entry: entry["appearances"],
        reverse=True,
    )
    if secondary_candidates:
        secondary = secondary_candidates[0]
        enough_appearances = secondary["appearances"] >= SECONDARY_POSITION_MIN_APPEARANCES
        enough_share = secondary["appearances"] >= main["appearances"] * SECONDARY_POSITION_MIN_SHARE
        if enough_appearances and enough_share:
            positions.append(secondary["label"])
    return positions


def refresh_position_cache(players: list[dict], refresh: bool) -> None:
    targets = [
        player for player in players
        if refresh or not (POSITION_DATA_DIR / f"{player['fotmobId']}.json").exists()
    ]
    if not targets:
        return

    def fetch(player: dict) -> str:
        session = requests.Session()
        session.headers.update(HEADERS)
        data = api_get(session, "/api/data/playerData", {"id": player["fotmobId"]})
        path = POSITION_DATA_DIR / f"{player['fotmobId']}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return player["name"]

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(fetch, player) for player in targets]
        for future in concurrent.futures.as_completed(futures):
            future.result()
            completed += 1
            if completed % 25 == 0 or completed == len(targets):
                print(f"position {completed:03}/{len(targets)}")


def normalize_member(member: dict, club_id: int, team_ko: str) -> dict | None:
    player_id = member.get("id")
    name = member.get("name")
    birth_date = member.get("dateOfBirth") or ""
    shirt = member.get("shirtNumber")
    position_code = (member.get("positionIdsDesc") or "").split(",")[0].strip()
    position = position_code
    country_code = member.get("ccode") or ""
    nationality = COUNTRY_KO.get(country_code) or member.get("cname")
    if not player_id or not name or len(birth_date) < 4 or not position or not nationality:
        return None
    if not isinstance(shirt, int) or shirt <= 0:
        return None
    minutes = current_minutes(int(player_id), club_id)
    transfer_value = int(member.get("transferValue") or 0)
    # Transfer value is the freshest cross-league proxy for player prominence.
    # Cached minutes are useful only as a small tie-breaker because seasons and
    # promoted teams can otherwise make lesser-known players dominate the set.
    starter_score = min(transfer_value / 100_000, 1_800) + min(minutes * 0.08, 300)
    token = photo_token(int(player_id))
    return {
        "id": token,
        "fotmobId": int(player_id),
        "name": name,
        "team": team_ko,
        "birthYear": int(birth_date[:4]),
        "position": position,
        "positions": [position],
        "positionCode": position,
        "nationality": nationality,
        "nationalityCode": country_code,
        "shirtNumber": shirt,
        "minutes": minutes,
        "transferValue": transfer_value,
        "starterScore": round(starter_score, 3),
        "photo": f"../captcha/photos/{token}.png",
    }


def fetch_player_pool(session: requests.Session, cached_squads: bool = False, refresh_positions: bool = False) -> list[dict]:
    pool = []
    for index, (club_id, team_ko) in enumerate(CLUBS.items(), 1):
        squad_path = SQUAD_DIR / f"{club_id}.json"
        if cached_squads and squad_path.exists():
            data = json.loads(squad_path.read_text(encoding="utf-8"))
        else:
            data = api_get(session, "/api/data/teams", {"id": club_id})
            squad_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        members = []
        for group in (data.get("squad") or {}).get("squad") or []:
            if group.get("title") == "coach":
                continue
            members.extend(group.get("members") or [])
        normalized = [normalize_member(member, club_id, team_ko) for member in members]
        eligible = [player for player in normalized if player]
        eligible.sort(key=lambda player: (player["starterScore"], player["transferValue"]), reverse=True)
        selected = eligible[:PLAYERS_PER_CLUB]
        if len(selected) < PLAYERS_PER_CLUB:
            raise RuntimeError(f"{team_ko}: only {len(selected)} eligible players")
        pool.extend(selected)
        print(f"[{index:02}/{len(CLUBS)}] {team_ko}: {len(selected)}명")
        if not cached_squads:
            time.sleep(0.4)
    refresh_position_cache(pool, refresh_positions)
    for player in pool:
        player["positions"] = eligible_positions(player["fotmobId"], player["position"])
        player["position"] = player["positions"][0]
        player["positionCode"] = player["position"]
    PLAYER_SNAPSHOT.write_text(json.dumps(pool, ensure_ascii=False, indent=2), encoding="utf-8")
    return pool


def connections(players: list[dict]) -> list[tuple[str, object]]:
    if len(players) != 4:
        return []
    result = []
    for field in FIELDS:
        if field == "position":
            shared = set(players[0].get("positions") or [players[0]["position"]])
            for player in players[1:]:
                shared &= set(player.get("positions") or [player["position"]])
            for value in players[0].get("positions") or [players[0]["position"]]:
                if value in shared:
                    result.append((field, value))
            continue
        value = players[0][field]
        if all(player[field] == value for player in players[1:]):
            result.append((field, value))
    return result


def analyze_puzzle(players: list[dict], limit: int = 40) -> dict:
    valid = []
    for indexes in itertools.combinations(range(16), 4):
        matched = connections([players[index] for index in indexes])
        if matched:
            mask = sum(1 << index for index in indexes)
            valid.append({"indexes": indexes, "mask": mask, "connections": matched})

    by_player = defaultdict(list)
    for group_index, group in enumerate(valid):
        for player_index in group["indexes"]:
            by_player[player_index].append(group_index)

    full_mask = (1 << 16) - 1
    solutions = []

    def walk(used_mask: int, chosen: list[int]) -> None:
        if len(solutions) >= limit:
            return
        if used_mask == full_mask:
            if len(chosen) == 4:
                solutions.append(tuple(sorted(chosen)))
            return
        if len(chosen) >= 4:
            return
        first_open = next(index for index in range(16) if not used_mask & (1 << index))
        for group_index in by_player[first_open]:
            mask = valid[group_index]["mask"]
            if used_mask & mask:
                continue
            walk(used_mask | mask, chosen + [group_index])

    walk(0, [])
    unique_solutions = sorted(set(solutions))
    used_in_solutions = {group for solution in unique_solutions for group in solution}
    return {
        "valid": valid,
        "solutions": unique_solutions,
        "traps": [index for index in range(len(valid)) if index not in used_in_solutions],
        "truncated": len(solutions) >= limit,
    }


def build_buckets(pool: list[dict]) -> dict[str, dict[object, list[dict]]]:
    buckets = {field: defaultdict(list) for field in FIELDS}
    for player in pool:
        for field in FIELDS:
            values = player["positions"] if field == "position" else [player[field]]
            for value in values:
                buckets[field][value].append(player)
    minimums = {"team": 8, "birthYear": 6, "position": 8, "nationality": 6, "shirtNumber": 6}
    return {
        field: {value: players for value, players in values.items() if len(players) >= minimums[field]}
        for field, values in buckets.items()
    }


def player_priority(player: dict, appearances: Counter, rng: random.Random) -> float:
    return (
        player["starterScore"]
        + FAMOUS_TEAM_BONUS.get(player["team"], 0)
        - appearances[player["id"]] * 145
        + rng.random() * 45
    )


def value_priority(field: str, value: object, players: list[dict], value_usage: Counter) -> float:
    star_power = sum(
        sorted(
            (player["starterScore"] + FAMOUS_TEAM_BONUS.get(player["team"], 0) for player in players),
            reverse=True,
        )[:4]
    )
    return star_power - value_usage[(field, value)] * 230


def generate_puzzles(pool: list[dict]) -> tuple[list[dict], list[dict]]:
    rng = random.Random(RANDOM_SEED)
    buckets = build_buckets(pool)
    appearances = Counter()
    value_usage = Counter()
    puzzle_sets = set()
    puzzles = []
    reports = []
    for puzzle_number in range(1, PUZZLE_COUNT + 1):
        pattern = PUZZLE_PATTERNS[puzzle_number - 1]
        pattern_kind = len(set(pattern))
        require_trap = puzzle_number % 5 != 0
        found = None
        for _attempt in range(30_000):
            fields = list(pattern)
            if puzzle_number > len(BASE_PUZZLE_PATTERNS):
                rng.shuffle(fields)
            chosen = []
            designed = []
            used_ids = set()
            used_field_values = set()
            failed = False
            for field in fields:
                values = list(buckets[field])
                rng.shuffle(values)
                values.sort(
                    key=lambda value: value_priority(field, value, buckets[field][value], value_usage),
                    reverse=True,
                )
                picked = None
                for value in values:
                    if (field, value) in used_field_values:
                        continue
                    candidates = [player for player in buckets[field][value] if player["id"] not in used_ids]
                    if len(candidates) < 4:
                        continue
                    candidates.sort(key=lambda player: player_priority(player, appearances, rng), reverse=True)
                    shortlist = candidates[: min(8, len(candidates))]
                    sample = shortlist[:4]
                    picked = (value, sample)
                    break
                if not picked:
                    failed = True
                    break
                value, sample = picked
                chosen.extend(sample)
                used_ids.update(player["id"] for player in sample)
                used_field_values.add((field, value))
                designed.append({"field": field, "value": value, "players": [player["name"] for player in sample]})
            if failed or len(chosen) != 16:
                continue
            signature = tuple(sorted(player["id"] for player in chosen))
            if signature in puzzle_sets:
                continue
            rng.shuffle(chosen)
            analysis = analyze_puzzle(chosen)
            solution_count = len(analysis["solutions"])
            if not solution_count:
                continue
            if analysis["truncated"] or solution_count > MAX_COMPLETE_SOLUTIONS:
                continue
            if require_trap and not analysis["traps"]:
                continue
            found = (chosen, designed, analysis, signature)
            break
        if not found:
            raise RuntimeError(f"문제 {puzzle_number} 생성 실패")

        chosen, designed, analysis, signature = found
        puzzle_sets.add(signature)
        for player in chosen:
            appearances[player["id"]] += 1
        for group in designed:
            value_usage[(group["field"], group["value"])] += 1
        public_players = [
            {key: player[key] for key in ("id", "name", "team", "birthYear", "position", "positions", "nationality", "shirtNumber", "photo")}
            for player in chosen
        ]
        puzzles.append({"id": puzzle_number, "players": public_players})
        reports.append({
            "id": puzzle_number,
            "validGroupCount": len(analysis["valid"]),
            "solutionCount": f"{len(analysis['solutions'])}+" if analysis["truncated"] else len(analysis["solutions"]),
            "trapGroupCount": len(analysis["traps"]),
            "pattern": list(pattern),
            "patternType": f"{pattern_kind}-category",
            "designedGroups": designed,
        })
        print(
            f"puzzle {puzzle_number:02}: valid={len(analysis['valid'])} "
            f"solutions={len(analysis['solutions'])} traps={len(analysis['traps'])}"
        )
    return puzzles, reports


def is_valid_png(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 1_000 and path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def download_photos(session: requests.Session, puzzles: list[dict], pool: list[dict]) -> None:
    by_id = {player["id"]: player for player in pool}
    selected_ids = sorted({player["id"] for puzzle in puzzles for player in puzzle["players"]})
    for index, token in enumerate(selected_ids, 1):
        player = by_id[token]
        path = PHOTOS_DIR / f"{token}.png"
        if is_valid_png(path):
            continue
        response = session.get(
            f"https://images.fotmob.com/image_resources/playerimages/{player['fotmobId']}.png",
            timeout=30,
        )
        response.raise_for_status()
        if len(response.content) <= 1_000 or not response.content.startswith(b"\x89PNG"):
            raise RuntimeError(f"invalid portrait for {player['name']} ({player['fotmobId']})")
        path.write_bytes(response.content)
        print(f"photo {index:03}/{len(selected_ids)}: {player['name']}")
        time.sleep(0.12)


def write_puzzles(puzzles: list[dict]) -> None:
    payload = json.dumps(puzzles, ensure_ascii=False, separators=(",", ":"))
    source = (
        "// Generated by crawler/build_connect_dataset.py from a scoped FotMob snapshot.\n"
        "(function (root) {\n"
        "  \"use strict\";\n"
        f"  root.CONNECT_PUZZLES = {payload};\n"
        "})(globalThis);\n"
    )
    PUZZLES_PATH.write_text(source, encoding="utf-8")


def build_hints(designed_groups: list[dict]) -> list[str]:
    category_labels = {
        "team": "소속팀",
        "birthYear": "출생 연도",
        "position": "포지션",
        "nationality": "국적",
        "shirtNumber": "등번호",
    }
    category_counts = Counter(group["field"] for group in designed_groups)
    ordered_fields = dict.fromkeys(group["field"] for group in designed_groups)
    first_hint = " · ".join(
        f"{category_labels[field]} {category_counts[field]}그룹" for field in ordered_fields
    ) + "으로 풀 수 있습니다."

    first_group = designed_groups[0]
    field = first_group["field"]
    value = first_group["value"]
    details = {
        "team": f"{value} 소속",
        "birthYear": f"{value}년생",
        "position": f"{value} 포지션",
        "nationality": f"{value} 국적",
        "shirtNumber": f"등번호 {value}번",
    }
    return [first_hint, f"한 그룹의 공통점은 {details[field]}입니다."]


def write_hints(reports: list[dict]) -> None:
    hints = {report["id"]: build_hints(report["designedGroups"]) for report in reports}
    payload = json.dumps(hints, ensure_ascii=False, separators=(",", ":"))
    source = (
        "// Generated by crawler/build_connect_dataset.py from the designed solution groups.\n"
        "(function (root) {\n"
        "  \"use strict\";\n"
        f"  root.CONNECT_HINTS = {payload};\n"
        "})(globalThis);\n"
    )
    HINTS_PATH.write_text(source, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-photos", action="store_true")
    parser.add_argument("--cached-squads", action="store_true")
    parser.add_argument("--refresh-positions", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update(HEADERS)
    pool = fetch_player_pool(
        session,
        cached_squads=args.cached_squads,
        refresh_positions=args.refresh_positions,
    )
    puzzles, reports = generate_puzzles(pool)
    if not args.skip_photos:
        download_photos(session, puzzles, pool)
    write_puzzles(puzzles)
    write_hints(reports)
    REPORT_PATH.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    used = {player["id"] for puzzle in puzzles for player in puzzle["players"]}
    print(f"done: {len(pool)}명 후보, {len(used)}명 사용, {len(puzzles)}문제")


if __name__ == "__main__":
    main()
