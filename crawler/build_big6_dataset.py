"""BIG6 야찌용 120인 선수 풀 생성 - 전부 FotMob 기준.

crawler/data/oxgame_squads(FotMob teams?id= 캐시)는 몇 달 전 스냅샷이라 그 사이
이적(예: 오마르 마르무시·사비오의 맨시티→토트넘 이적)을 반영 못 해 명단이 어긋나
있었다. 그래서 라이브로 다시 받는다 - 소속팀/포지션 전부 FotMob
`fotmob.com/api/data/teams?id={클럽ID}` 응답(squad.squad[], "coach" 그룹 제외)을
그대로 신뢰한다. 사진도 같은 소스의 id로 받는다
(images.fotmob.com/image_resources/playerimages/{id}.png, 이미 배경 제거된 렌더).

Run:
  python crawler/build_big6_dataset.py          # public/data/big6_players.json 생성
  python crawler/build_big6_dataset.py --photos # 사진까지 내려받기 (오래 걸림)
"""
import json
import sys
import time
from collections import Counter
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "public" / "data" / "big6_players.json"
PHOTOS_DIR = ROOT / "public" / "big6" / "photos"

FM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.fotmob.com/",
}

CLUBS = {
    "ARS": (9825, "Arsenal"),
    "CHE": (8455, "Chelsea"),
    "LIV": (8650, "Liverpool"),
    "MCI": (8456, "Manchester City"),
    "MUN": (10260, "Manchester United"),
    "TOT": (8586, "Tottenham Hotspur"),
}

POS_GROUP = {
    "GK": "BACK", "CB": "BACK", "LB": "BACK", "RB": "BACK", "LWB": "BACK", "RWB": "BACK",
    "CDM": "MID", "CM": "MID", "CAM": "MID", "LM": "MID", "RM": "MID",
    "ST": "FWD", "LW": "FWD", "RW": "FWD",
}

# 팀별 실제 보유 인원(fetch_squad 결과, 팀당 24~30명) 안에서 20명씩 채우는 목표치 -
# 기획서 4장 6/7/7 예시에 최대한 맞추되, 실제 가용 인원 제약으로 일부만 조정.
# 합계는 항상 팀당 20명, 전체 FWD/MID/BACK 각 40명.
TARGET_SPLIT = {
    "ARS": {"FWD": 6, "MID": 6, "BACK": 8},
    "CHE": {"FWD": 7, "MID": 8, "BACK": 5},
    "LIV": {"FWD": 7, "MID": 6, "BACK": 7},
    "MCI": {"FWD": 6, "MID": 6, "BACK": 8},
    "MUN": {"FWD": 7, "MID": 7, "BACK": 6},
    "TOT": {"FWD": 7, "MID": 7, "BACK": 6},
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
    return members


def primary_pos_group(pos_str):
    first = (pos_str or "").split(",")[0].strip()
    return POS_GROUP.get(first)


def select_players():
    selected = []
    for abbr, (fm_id, full_name) in CLUBS.items():
        squad = fetch_squad(fm_id)
        buckets = {"FWD": [], "MID": [], "BACK": []}
        for p in squad:
            grp = primary_pos_group(p.get("positionIdsDesc"))
            if grp is None:
                print(f"SKIP unmapped position {p.get('positionIdsDesc')!r} ({abbr} {p.get('name')})")
                continue
            buckets[grp].append(p)
        print(f"{abbr} available:", {g: len(v) for g, v in buckets.items()})

        for grp, need in TARGET_SPLIT[abbr].items():
            pool = sorted(buckets[grp], key=lambda x: x.get("transferValue") or 0, reverse=True)
            take = pool[:need]
            if len(take) < need:
                print(f"WARN {abbr} {grp} short by {need - len(take)} (only {len(take)} available)")
            for p in take:
                selected.append({
                    "playerId": f"p{p['id']}",
                    "fotmobId": p["id"],
                    "name": p["name"],
                    "team": abbr,
                    "teamFull": full_name,
                    "positionGroup": grp,
                    "profileImage": f"big6/photos/{p['id']}.png",
                })
        time.sleep(0.8)
    return selected


def download_photos(players):
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    for i, p in enumerate(players, 1):
        fid = p["fotmobId"]
        dest = PHOTOS_DIR / f"{fid}.png"
        if dest.exists() and dest.stat().st_size > 0:
            continue
        url = f"https://images.fotmob.com/image_resources/playerimages/{fid}.png"
        try:
            r = requests.get(url, headers=FM_HEADERS, timeout=20)
            r.raise_for_status()
            dest.write_bytes(r.content)
            print(f"[{i}/{len(players)}] photo ok: {p['name']} ({len(r.content)}B)")
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(players)}] photo FAILED: {p['name']}: {exc}")
        time.sleep(0.5)


def main():
    do_photos = "--photos" in sys.argv

    players = select_players()
    print(f"\ntotal selected: {len(players)}")
    print("per team:", Counter(p["team"] for p in players))
    print("per position:", Counter(p["positionGroup"] for p in players))
    assert len(players) == 120, f"expected 120 players, got {len(players)}"

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(players, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT_JSON}")

    if do_photos:
        download_photos(players)


if __name__ == "__main__":
    main()
