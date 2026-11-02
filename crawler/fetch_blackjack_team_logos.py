"""블랙잭 게임 카드 뒷면용 팀 엠블럼을 fotmob CDN에서 받아온다.
클럽 ID -> 한글 팀명 매핑은 build_connect_dataset.py의 CLUBS를 그대로 재사용한다
(connect_players.json의 team 필드와 정확히 같은 한글 표기를 써야 매칭이 되므로).
"""
import json
import pathlib
import urllib.request

from build_connect_dataset import CLUBS

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "blackjack" / "logos"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0"}


def fetch(club_id: int) -> bytes:
    url = f"https://images.fotmob.com/image_resources/logo/teamlogo/{club_id}.png"
    req = urllib.request.Request(url, headers=HEADERS)
    return urllib.request.urlopen(req, timeout=15).read()


def main():
    mapping = {}
    for club_id, team_ko in CLUBS.items():
        out_path = OUT_DIR / f"{club_id}.png"
        if not out_path.exists():
            data = fetch(club_id)
            out_path.write_bytes(data)
            print(f"[ok] {team_ko} ({club_id}) -> {len(data)} bytes")
        else:
            print(f"[skip] {team_ko} ({club_id}) already exists")
        mapping[team_ko] = club_id

    mapping_path = OUT_DIR.parent / "team-logos.json"
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {mapping_path} ({len(mapping)} teams)")


if __name__ == "__main__":
    main()
