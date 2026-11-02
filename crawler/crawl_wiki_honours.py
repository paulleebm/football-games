"""
players.py 전체 선수의 위키피디아 "Honours" 절을 크롤링해서
crawler/data/wiki_honours.json 에 저장한다 (id -> [{group, entries}, ...]).

분류(club vs individual, 화이트리스트 필터링)는 여기서 하지 않는다 - 원본
그대로 저장해두고 build_dataset.py에서 분류하게 해서, 화이트리스트를
다듬을 때마다 매번 다시 크롤링할 필요 없이 build만 다시 돌리면 된다.

Usage:
    python crawl_wiki_honours.py            # 아직 없는 선수만
    python crawl_wiki_honours.py --force     # 전부 다시
    python crawl_wiki_honours.py --only messi,ronaldo
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from players import ALL_PLAYERS
from wiki_honours import fetch_and_parse_honours

OUT_PATH = Path(__file__).parent / "data" / "wiki_honours.json"
MIN_DELAY, MAX_DELAY = 0.8, 1.6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", type=str, default=None)
    args = ap.parse_args()

    store = {}
    if OUT_PATH.exists():
        store = json.load(open(OUT_PATH, encoding="utf-8"))

    players = ALL_PLAYERS
    if args.only:
        wanted = set(args.only.split(","))
        players = [p for p in players if p["id"] in wanted]

    for idx, p in enumerate(players, 1):
        if not args.force and p["id"] in store:
            continue
        print(f"[{idx}/{len(players)}] {p['id']} ({p['en']})")
        try:
            groups = fetch_and_parse_honours(p["wiki"])
            if groups is None:
                print(f"    [warn] wiki page not found for {p['wiki']!r}")
                groups = []
            elif not groups:
                print(f"    [warn] no Honours section parsed for {p['wiki']!r}")
            store[p["id"]] = groups
        except Exception as e:
            print(f"    [ERROR] {p['id']}: {e}")
            continue
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)
        time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

    print(f"done: {len(store)} players -> {OUT_PATH}")


if __name__ == "__main__":
    main()
