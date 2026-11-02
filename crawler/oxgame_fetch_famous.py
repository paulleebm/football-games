"""
5대리그 밖(사우디 프로리그/MLS/튀르키예 쉬페르리그 등)으로 이적한 유명 선수들을
큐레이션 리스트로 추가 수집. 5대리그 스쿼드만 긁은 기존 파이프라인
(oxgame_fetch_pool.py)에는 이 선수들이 아예 없었음 - 인지도는 5대리그 하위권
벤치멤버보다 훨씬 높은데 빠져있던 문제를 보정.

각 이름을 FotMob 검색 API로 찾고, 후보가 여러 명이면 team_hint로 골라낸 뒤
상세 정보를 저장. 기존 oxgame_raw/{id}.json, oxgame_squad_index.json 포맷에
그대로 맞춰서 추가하므로, 이후 build_oxgame_dataset.py를 다시 돌리면 자동으로
최종 데이터셋에 합쳐진다.
"""
import json
import random
import sys
import time
from pathlib import Path

import requests

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(__file__).parent / "data"
RAW_DIR = DATA_DIR / "oxgame_raw"
SQUAD_INDEX_PATH = DATA_DIR / "oxgame_squad_index.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fotmob.com/",
}
MIN_DELAY, MAX_DELAY = 1.4, 2.4

# (검색어, 팀 힌트 - 검색 결과가 여러 명일 때 이름에 이 문자열이 포함된 팀을 우선 채택)
CANDIDATES = [
    ("Cristiano Ronaldo", "Al-Nassr"),
    ("Karim Benzema", "Al-Ittihad"),
    ("N'Golo Kante", "Al-Ittihad"),
    ("Riyad Mahrez", "Al-Ahli"),
    ("Sadio Mane", "Al-Nassr"),
    ("Roberto Firmino", "Al-Ahli"),
    ("Kalidou Koulibaly", "Al-Hilal"),
    ("Ruben Neves", "Al-Hilal"),
    ("Marcelo Brozovic", "Al-Nassr"),
    ("Aleksandar Mitrovic", "Al-Hilal"),
    ("Neymar", None),
    ("Yannick Carrasco", "Al-Shabab"),
    ("Fabinho", "Al-Ittihad"),
    ("Malcom", "Al-Hilal"),
    ("Lionel Messi", "Inter Miami"),
    ("Luis Suarez", "Inter Miami"),
    ("Sergio Busquets", "Inter Miami"),
    ("Jordi Alba", "Inter Miami"),
    ("Xherdan Shaqiri", None),
    ("Hugo Lloris", "LAFC"),
    ("Dries Mertens", None),
    ("Edin Dzeko", "Fenerbahce"),
    ("Mauro Icardi", "Galatasaray"),
    ("Victor Osimhen", "Galatasaray"),
    ("Hakim Ziyech", None),
    ("Wilfried Zaha", None),
    ("Gonzalo Higuain", None),
    ("Aymeric Laporte", "Al-Nassr"),
    ("Jhon Duran", "Al-Nassr"),
    ("Sergej Milinkovic-Savic", "Al-Hilal"),
    ("Franck Kessie", "Al-Ahli"),
    ("Ivan Toney", "Al-Ahli"),
    ("Renan Lodi", "Al-Hilal"),
]


def _norm(s):
    return (s or "").lower().replace(" ", "").replace("-", "")


_LEAGUE_MAP_RAW = {
    "Al-Nassr": ("Saudi Pro League", "KSA"), "Al-Ittihad": ("Saudi Pro League", "KSA"),
    "Al-Ahli": ("Saudi Pro League", "KSA"), "Al-Hilal": ("Saudi Pro League", "KSA"),
    "Al-Shabab": ("Saudi Pro League", "KSA"), "Al-Ettifaq": ("Saudi Pro League", "KSA"),
    "Al-Taawoun": ("Saudi Pro League", "KSA"), "Damac": ("Saudi Pro League", "KSA"),
    "Inter Miami": ("MLS", "USA"), "LAFC": ("MLS", "USA"), "Los Angeles FC": ("MLS", "USA"),
    "LA Galaxy": ("MLS", "USA"),
    "Fenerbahce": ("Super Lig", "TUR"), "Fenerbahçe": ("Super Lig", "TUR"),
    "Galatasaray": ("Super Lig", "TUR"), "Besiktas": ("Super Lig", "TUR"),
    "Trabzonspor": ("Super Lig", "TUR"),
    "Al-Sadd": ("Qatar Stars League", "QAT"), "Al-Rayyan": ("Qatar Stars League", "QAT"),
    "Santos": ("Brasileirao", "BRA"), "Boca Juniors": ("Liga Profesional", "ARG"),
    "Basel": ("Swiss Super League", "SUI"), "Wydad Casablanca": ("Botola Pro", "MAR"),
}
LEAGUE_MAP = {_norm(k): v for k, v in _LEAGUE_MAP_RAW.items()}


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
                    pass
            elif r.status_code == 429:
                time.sleep(15 * (attempt + 1))
                continue
        except requests.RequestException:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def search_get(params, retries=4):
    url = "https://apigw.fotmob.com/searchapi/suggest"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    pass
        except requests.RequestException:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def search_player(name, team_hint):
    data = search_get({"term": name, "project": "fotmob"})
    if not data:
        return None
    for block in data.get("squadMemberSuggest") or []:
        options = block.get("options") or []
        if not options:
            continue
        if team_hint:
            for opt in options:
                if team_hint.lower() in (opt.get("payload", {}).get("teamName") or "").lower():
                    return opt
        # 힌트 없거나 매칭 안 되면, 검색 스코어(=인지도) 1등을 채택
        return options[0]
    return None


def build_squad_entry(player_data, league_name, league_country):
    pid = player_data.get("id")
    info = {i.get("translationKey"): i for i in player_data.get("playerInformation") or []}
    height = (info.get("height_sentencecase") or {}).get("value", {}).get("numberValue")
    shirt = (info.get("shirt") or {}).get("value", {}).get("numberValue")
    age = (info.get("age_sentencecase") or {}).get("value", {}).get("numberValue")
    mv = (info.get("transfer_value") or {}).get("value", {}).get("numberValue") or 0
    country_val = (info.get("country_sentencecase") or {}).get("value", {})
    nat_code = country_val.get("countryCode")
    nat_name = country_val.get("fallback")

    dob = None
    bd = player_data.get("birthDate") or {}
    if bd.get("utcTime"):
        dob = bd["utcTime"][:10]

    positions = (player_data.get("positionDescription") or {}).get("positions") or []
    pos_tags = []
    for p in positions:
        short = (p.get("strPosShort") or {}).get("label")
        if short:
            pos_tags.append(short)
    position_str = ",".join(pos_tags) if pos_tags else None

    team = player_data.get("primaryTeam") or {}

    return {
        "id": pid,
        "name": player_data.get("name"),
        "shirtNumber": shirt,
        "nationalityCode": nat_code,
        "nationalityName": nat_name,
        "position": position_str,
        "height": height,
        "age": age,
        "dateOfBirth": dob,
        "transferValue": mv,
        "clubId": team.get("teamId"),
        "clubName": team.get("teamName"),
        "leagueId": None,
        "leagueName": league_name,
        "fam": True,
    }


def main():
    squad = json.load(open(SQUAD_INDEX_PATH, encoding="utf-8"))
    added, skipped = 0, 0

    for name, team_hint in CANDIDATES:
        found = search_player(name, team_hint)
        polite_sleep()
        if not found:
            print(f"[skip] not found: {name}")
            skipped += 1
            continue
        pid = str(found["payload"]["id"])
        if pid in squad:
            print(f"[skip] already have id {pid} ({name})")
            continue

        raw_path = RAW_DIR / f"{pid}.json"
        if raw_path.exists():
            player_data = json.load(open(raw_path, encoding="utf-8"))
        else:
            player_data = api_get("/api/data/playerData", {"id": pid})
            polite_sleep()
            if not player_data:
                print(f"[warn] failed detail fetch: {name} ({pid})")
                skipped += 1
                continue
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(player_data, f, ensure_ascii=False, indent=2)

        team_name = (player_data.get("primaryTeam") or {}).get("teamName") or ""
        league_info = None
        for club_key, info in LEAGUE_MAP.items():
            if club_key.lower() in team_name.lower():
                league_info = info
                break
        if not league_info:
            print(f"[warn] unknown league for club '{team_name}' ({name}) - skipping league assignment")
            league_info = (team_name or "Unknown", None)

        entry = build_squad_entry(player_data, league_info[0], league_info[1])
        squad[pid] = entry
        print(f"[ok] {entry['name']} -> {entry['clubName']} ({entry['leagueName']})")
        added += 1

    with open(SQUAD_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(squad, f, ensure_ascii=False, indent=2)

    print(f"\nadded={added} skipped={skipped} total_in_index={len(squad)}")


if __name__ == "__main__":
    main()
