"""
검색 후보 목록(선수 이름 자동완성용) 생성.
같은 팀메이트 게임 프로젝트가 이미 크롤링해둔 tm.sqlite3에서
"2020년 이후 유럽 5대리그 1부에서 뛴 적 있는 모든 선수"의 영문 이름만 뽑는다.

한글 이름은 90인 풀 밖의 수천 명에 대해 알아낼 방법이 없으므로,
검색 후보 목록 자체를 영문 이름으로 통일한다 (사용자 요청).
"""
import json
import sqlite3
from pathlib import Path

SIBLING_DB = (
    Path(__file__).parent.parent.parent / "축구 데이터 퀴즈" / "crawler" / "data" / "tm.sqlite3"
)
DATASET_PATH = Path(__file__).parent / "data" / "dataset.json"
OUT_PATH = Path(__file__).parent.parent / "public" / "data" / "search_pool.json"

BIG5_CODES = {"GB1", "ES1", "IT1", "L1", "FR1"}
MIN_SEASON_YEAR = 2020  # 이 시즌 이후 5대리그 1부 출전 이력이 있는 선수만


def main():
    conn = sqlite3.connect(str(SIBLING_DB))
    placeholders = ",".join("?" * len(BIG5_CODES))
    ids = [r[0] for r in conn.execute(
        f"""SELECT DISTINCT m.player_id
            FROM memberships m
            JOIN club_competition_seasons ccs
              ON ccs.club_id = m.club_id AND ccs.season_year = m.season_year
            WHERE ccs.competition_code IN ({placeholders}) AND m.season_year >= ?""",
        list(BIG5_CODES) + [MIN_SEASON_YEAR],
    ).fetchall()]

    id_placeholders = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT name FROM players WHERE player_id IN ({id_placeholders})", ids).fetchall()
    names = {r[0].strip() for r in rows if r[0] and r[0].strip()}
    print(f"{len(names)} names from sibling project's Big5 (2020+) crawl")

    # 90인 풀 자체는 무조건 검색 가능해야 하니 명시적으로 합집합.
    dataset = json.load(open(DATASET_PATH, encoding="utf-8"))
    for p in dataset:
        if p["profile"].get("nameEn"):
            names.add(p["profile"]["nameEn"].strip())

    result = sorted(names)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"wrote {len(result)} names -> {OUT_PATH}")


if __name__ == "__main__":
    main()
