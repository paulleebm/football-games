"""public/data/big6_players.json의 positionGroup "BACK"(수비수+골키퍼 합친 것)을
"DEF"(수비수)와 "GK"(골키퍼)로 쪼갠다 - 빅6 야찌 기획 변경: 백라인이라는 표현이
어색해서 수비수/골키퍼로 구분하되, 족보(점수판)는 수비수만 만들고 골키퍼는
족보 없이 카드 표시용 구분만 한다.

선수 목록 자체(120명, 팀당 20명)는 바꾸지 않고, 같은 FotMob 팀 스쿼드 API에서
각 선수의 정확한 포지션(positionIdsDesc)을 다시 찾아 GK 여부만 갈라낸다.

Run: python crawler/split_back_position.py
"""
import json
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PLAYERS_JSON = ROOT / "public" / "data" / "big6_players.json"

FM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}

CLUB_FM_IDS = {
    "ARS": 9825, "CHE": 8455, "LIV": 8650, "MCI": 8456, "MUN": 10260, "TOT": 8586,
}


def fetch_squad(fm_team_id):
    r = requests.get("https://www.fotmob.com/api/data/teams", params={"id": fm_team_id},
                      headers=FM_HEADERS, timeout=20)
    r.raise_for_status()
    data = r.json()
    members = []
    for grp in data.get("squad", {}).get("squad", []):
        if grp.get("title") == "coach":
            continue
        members.extend(grp.get("members", []))
    return {m["id"]: m for m in members}


def main():
    players = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    squads_by_team = {}
    for abbr, fm_id in CLUB_FM_IDS.items():
        squads_by_team[abbr] = fetch_squad(fm_id)

    changed = {"GK": 0, "DEF": 0}
    for p in players:
        if p["positionGroup"] != "BACK":
            continue
        member = squads_by_team[p["team"]].get(p["fotmobId"])
        if not member:
            print(f"WARN not found in live squad: {p['name']} ({p['team']}, id={p['fotmobId']})")
            p["positionGroup"] = "DEF"  # 못 찾으면 안전하게 수비수로
            changed["DEF"] += 1
            continue
        primary = (member.get("positionIdsDesc") or "").split(",")[0].strip()
        new_group = "GK" if primary == "GK" else "DEF"
        p["positionGroup"] = new_group
        changed[new_group] += 1

    print("changed:", changed)
    from collections import Counter
    print("final distribution:", Counter(p["positionGroup"] for p in players))

    PLAYERS_JSON.write_text(json.dumps(players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {PLAYERS_JSON}")


if __name__ == "__main__":
    main()
