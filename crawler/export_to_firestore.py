"""
crawler/data/dataset.json -> Firestore `guessPlayers/{id}` 컬렉션 업로드.
단독 배포 프로젝트(guess-your-player) 전용 서비스 계정 사용.

Usage:
    python export_to_firestore.py --dry-run
    python export_to_firestore.py
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from players import PLAYERS

DATASET_PATH = Path(__file__).parent / "data" / "dataset.json"
DEFAULT_SERVICE_ACCOUNT = Path(__file__).parent / "secrets" / "firestore-uploader.json"
SANITIZE_SCRIPT = Path(__file__).parent / "sanitize_for_client.js"


def sanitize_players(players):
    # profile.nameKo/nameEn/aliases/photoUrl 평문을 그대로 Firestore에 올리면 F12로
    # 로그인 없이 그냥 읽힌다 - sanitize_for_client.js(public/index.html과 동일한
    # 해시/난독화 알고리즘)를 거쳐서 매칭용 해시 + 화면표시용 난독화 값으로 바꾼 뒤
    # 올린다. 자세한 이유는 그 스크립트의 헤더 주석 참고.
    with tempfile.TemporaryDirectory() as tmp:
        in_path = Path(tmp) / "in.json"
        out_path = Path(tmp) / "out.json"
        in_path.write_text(json.dumps(players), encoding="utf-8")
        subprocess.run(
            ["node", str(SANITIZE_SCRIPT), "players", str(in_path), str(out_path)],
            check=True,
        )
        return json.loads(out_path.read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--service-account", default=str(DEFAULT_SERVICE_ACCOUNT))
    args = ap.parse_args()

    pool_ids = {p["id"] for p in PLAYERS}  # 배포 대상 풀만(현재 197명), 예비 명단은 제외
    all_players = json.load(open(DATASET_PATH, encoding="utf-8"))
    players = [p for p in all_players if p["id"] in pool_ids]
    print(f"{len(players)}/{len(all_players)} players (pool only) loaded from {DATASET_PATH}")
    players = sanitize_players(players)

    if args.dry_run:
        for p in players:
            print(f"  {p['id']}: career={len(p['career'])} clubHonours={len(p['clubHonours'])} "
                  f"individualHonours={len(p['individualHonours'])} teammates={len(p['teammateLinks'])}")
        print("dry-run only, nothing uploaded")
        return

    cred = credentials.Certificate(args.service_account)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    batch = db.batch()
    n = 0
    for p in players:
        ref = db.collection("guessPlayers").document(p["id"])
        batch.set(ref, p)
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()
    print(f"uploaded {n} players to guessPlayers/")


if __name__ == "__main__":
    main()
