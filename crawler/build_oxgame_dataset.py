"""
oxgame_raw/*.json + oxgame_squad_index.json -> public/data/oxgame_players.json

"유사도 맞히기" 게임(게임3)용 최종 선수 데이터셋 빌드. 원본 FotMob 응답에서
필요한 필드만 뽑아 압축된 레코드로 만든다.
"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
RAW_DIR = DATA_DIR / "oxgame_raw"
SQUAD_INDEX_PATH = DATA_DIR / "oxgame_squad_index.json"
OUT_PATH = Path(__file__).parent.parent / "public" / "data" / "oxgame_players.json"

CONTINENT = {
    'ENG': 'EU', 'ESP': 'EU', 'GER': 'EU', 'ITA': 'EU', 'FRA': 'EU', 'NED': 'EU', 'BEL': 'EU', 'POR': 'EU',
    'SCO': 'EU', 'WAL': 'EU', 'AUT': 'EU', 'SUI': 'EU', 'SWE': 'EU', 'DEN': 'EU', 'NOR': 'EU', 'POL': 'EU',
    'CRO': 'EU', 'SRB': 'EU', 'GRE': 'EU', 'TUR': 'EU', 'IRL': 'EU', 'CZE': 'EU', 'BIH': 'EU', 'GEO': 'EU',
    'UKR': 'EU', 'HUN': 'EU', 'SVK': 'EU', 'SVN': 'EU', 'ROU': 'EU', 'BUL': 'EU', 'FIN': 'EU', 'ISL': 'EU',
    'ALB': 'EU', 'MKD': 'EU', 'MNE': 'EU', 'KOS': 'EU', 'LUX': 'EU', 'MDA': 'EU', 'ARM': 'EU', 'CYP': 'EU',
    'BRA': 'SA', 'ARG': 'SA', 'URU': 'SA', 'COL': 'SA', 'ECU': 'SA', 'PAR': 'SA', 'CHI': 'SA', 'PER': 'SA',
    'VEN': 'SA', 'BOL': 'SA',
    'MAR': 'AF', 'SEN': 'AF', 'CIV': 'AF', 'NGA': 'AF', 'ALG': 'AF', 'GHA': 'AF', 'MLI': 'AF', 'CMR': 'AF',
    'TUN': 'AF', 'EGY': 'AF', 'GUI': 'AF', 'ZAM': 'AF', 'COD': 'AF', 'GAB': 'AF', 'BFA': 'AF', 'GAM': 'AF',
    'CGO': 'AF', 'MOZ': 'AF', 'ZIM': 'AF', 'CPV': 'AF',
    'JPN': 'AS', 'KOR': 'AS', 'AUS': 'OC', 'IRN': 'AS', 'QAT': 'AS', 'KSA': 'AS', 'UZB': 'AS', 'CHN': 'AS',
    'USA': 'NA', 'CAN': 'NA', 'MEX': 'NA', 'JAM': 'NA', 'CRC': 'NA', 'PAN': 'NA', 'HAI': 'NA',
}

LEAGUE_COUNTRY = {
    'Premier League': 'ENG', 'LaLiga': 'ESP', 'Bundesliga': 'GER',
    'Serie A': 'ITA', 'Ligue 1': 'FRA',
}

TROPHY_SETS = {
    'tWC': {'World Cup'},
    'tCont': {'EURO', 'Africa Cup of Nations', 'Copa America', 'AFC Asian Cup', 'CONCACAF Gold Cup'},
    'tUCL': {'Champions League'},
    'tUEL': {'Europa League'},
    'tCWC': {'FIFA Club World Cup', 'FIFA Intercontinental Cup'},
    'tDCup': {'FA Cup', 'DFB Pokal', 'Copa del Rey', 'Coppa Italia', 'Coupe de France', 'EFL Cup', 'League Cup'},
}
DOMESTIC_LEAGUE_NAMES = {'Premier League', 'LaLiga', 'Bundesliga', 'Serie A', 'Ligue 1'}

MARKET_VALUE_FLOOR = 30_000_000
JOURNEYMAN_CLUBS = 10


def pos_groups(pos_str):
    tags = set((pos_str or '').split(','))
    groups = []
    if 'GK' in tags: groups.append('GK')
    if 'CB' in tags: groups.append('CB')
    if tags & {'LB', 'RB', 'LWB', 'RWB'}: groups.append('FB')
    if 'CDM' in tags: groups.append('DM')
    if 'CM' in tags: groups.append('CM')
    if 'CAM' in tags: groups.append('AM')
    if tags & {'LW', 'RW', 'LM', 'RM'}: groups.append('WING')
    if 'ST' in tags: groups.append('ST')
    return groups


def main():
    squad = json.load(open(SQUAD_INDEX_PATH, encoding="utf-8"))
    players = []
    missing_raw = 0

    for pid, m in squad.items():
        raw_path = RAW_DIR / f"{pid}.json"
        if not raw_path.exists():
            missing_raw += 1
            continue
        d = json.load(open(raw_path, encoding="utf-8"))

        foot = None
        for info in d.get("playerInformation") or []:
            if info.get("translationKey") == "preferred_foot":
                foot = (info.get("value") or {}).get("key")

        career = ((d.get("careerHistory") or {}).get("careerItems") or {}).get("senior") or {}
        entries = career.get("teamEntries") or []
        club_count = len(entries)

        won_names = set()
        for group in (d.get("trophies") or {}).get("playerTrophies") or []:
            for t in group.get("tournaments") or []:
                if t.get("seasonsWon"):
                    won_names.add(t.get("leagueName"))
        trophies = {key: bool(won_names & names) for key, names in TROPHY_SETS.items()}
        trophies["tDLg"] = bool(won_names & DOMESTIC_LEAGUE_NAMES)

        by = None
        if m.get("dateOfBirth"):
            try:
                by = int(m["dateOfBirth"][:4])
            except ValueError:
                by = None

        nat = m.get("nationalityCode")
        league = m.get("leagueName")

        rec = {
            "id": m.get("id"),
            "n": m.get("name"),
            "p": pos_groups(m.get("position")),
            "f": foot,
            "nat": nat,
            "cont": CONTINENT.get(nat, "ETC"),
            "lg": league,
            "cl": m.get("clubName"),
            "h": m.get("height"),
            "by": by,
            "age": m.get("age"),
            "mv": m.get("transferValue") or 0,
            "cc": club_count,
            "oc": club_count == 1,
            "lb": bool(LEAGUE_COUNTRY.get(league) and nat == LEAGUE_COUNTRY[league]),
            "mp": bool((d.get("positionDescription") or {}).get("nonPrimaryPositions")),
            "fam": bool(m.get("fam")),  # 사우디/MLS/튀르키예 등으로 이적한 유명 선수 큐레이션 플래그
            **trophies,
        }
        players.append(rec)

    # 5대리그 안에서도 인지도 높은 선수는 "유명" 취급 - 게임 시작 시 O/X 예시를
    # 이 인지도 높은 선수 풀(수작업 큐레이션 + 시장가치 상위권)에서 뽑기 위함.
    # 시장가치만으로는 사우디/MLS로 간 노장 스타가 저평가되니, 수작업 fam 플래그와
    # OR 조건으로 합친다 (build_oxgame_dataset.py 재실행해도 fam=True는 유지됨).
    TOP_MV_COUNT = 200
    for p in sorted(players, key=lambda p: p["mv"], reverse=True)[:TOP_MV_COUNT]:
        p["fam"] = True

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(players, f, ensure_ascii=False, separators=(",", ":"))

    print(f"players written: {len(players)} (missing raw: {missing_raw})")
    print(f"output: {OUT_PATH}")


if __name__ == "__main__":
    main()
