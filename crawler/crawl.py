"""
90(+6 reserve)명 선수 딥 크롤러.

두 소스를 조합한다:
- Transfermarkt: 프로필(신장/주발/포지션/시장가치/현소속), 트로피/개인수상(erfolge)
- Wikipedia infobox(wikitext): 클럽별 caps/goals, 국가대표 레벨별 caps/goals
  (Transfermarkt의 "leistungsdaten" 상세 스탯 페이지는 최신 SPA라 서버사이드
  HTML에 값이 없고 내부 ceapi도 현재 시즌만 반환해 신뢰 불가 - 위키 인포박스가
  더 안정적이고 구조화되어 있어 이걸 1차 소스로 쓴다)

각 선수 원본 결과를 crawler/data/raw/{id}.json 에 저장 (이미 있으면 스킵 - 재실행 가능).
"""
import json
import random
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from players import ALL_PLAYERS

DATA_DIR = Path(__file__).parent / "data" / "raw"
DATA_DIR.mkdir(parents=True, exist_ok=True)

UA = "personal-research-crawler/1.0 (non-commercial football quiz game project; contact bymile@naver.com)"
TM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
WIKI_HEADERS = {"User-Agent": UA}

MIN_DELAY, MAX_DELAY = 1.6, 3.0


def polite_sleep():
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def tm_get(url, params=None, retries=3):
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=TM_HEADERS, timeout=20)
            if r.status_code == 200:
                return r
            print(f"    [warn] {r.status_code} on {url} (attempt {attempt+1})")
        except requests.RequestException as e:
            print(f"    [warn] {e} on {url} (attempt {attempt+1})")
        time.sleep(3 * (attempt + 1))
    return None


def resolve_tm_id(query):
    r = tm_get("https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche", params={"query": query})
    if r is None:
        return None, None
    soup = BeautifulSoup(r.text, "html.parser")
    a = soup.select_one("a[href*='/profil/spieler/']")
    if not a:
        return None, None
    m = re.search(r"/profil/spieler/(\d+)", a["href"])
    slug = a["href"].split("/")[1] if a["href"].startswith("/") else None
    return (m.group(1) if m else None), slug


def parse_info_table(soup):
    tbl = soup.select_one("div.info-table")
    out = {}
    if not tbl:
        return out
    spans = tbl.find_all("span", recursive=False)
    i = 0
    while i < len(spans) - 1:
        label = spans[i]
        value = spans[i + 1]
        if "info-table__content--regular" in label.get("class", []):
            key = label.get_text(" ", strip=True).rstrip(":")
            val = value.get_text(" ", strip=True)
            out[key] = val
            i += 2
        else:
            i += 1
    return out


def scrape_tm_profile(tm_id, slug):
    url = f"https://www.transfermarkt.com/{slug}/profil/spieler/{tm_id}"
    r = tm_get(url)
    if r is None:
        return {}
    soup = BeautifulSoup(r.text, "html.parser")
    info = parse_info_table(soup)

    h1 = soup.select_one("h1.data-header__headline-wrapper")
    shirt_number = None
    if h1:
        m = re.search(r"#(\d+)", h1.get_text())
        if m:
            shirt_number = int(m.group(1))

    mv_el = soup.select_one("a.data-header__market-value-wrapper")
    market_value_text = mv_el.get_text(" ", strip=True) if mv_el else None

    club_el = soup.select_one("span.data-header__club")
    current_club = club_el.get_text(" ", strip=True) if club_el else None

    photo_el = soup.select_one("img.data-header__profile-image")
    photo_url = photo_el.get("src") if photo_el else None

    caps_goals = info.get("Caps/Goals")
    nt_caps = nt_goals = None
    if caps_goals:
        parts = [p.strip() for p in caps_goals.split("/")]
        if len(parts) == 2:
            nt_caps = int(re.sub(r"\D", "", parts[0]) or 0)
            nt_goals = int(re.sub(r"\D", "", parts[1]) or 0)

    return {
        "tmId": tm_id,
        "tmUrl": url,
        "shirtNumber": shirt_number,
        "marketValueText": market_value_text,
        "currentClubTM": current_club,
        "photoUrl": photo_url,
        "infoTable": info,
        "nameHomeCountry": info.get("Name in home country"),
        "dob": info.get("Date of birth/Age"),
        "placeOfBirth": info.get("Place of birth"),
        "heightText": info.get("Height"),
        "citizenship": info.get("Citizenship"),
        "positionText": info.get("Position"),
        "foot": info.get("Foot"),
        "currentInternational": info.get("Current international"),
        "nationalCaps": nt_caps,
        "nationalGoals": nt_goals,
    }


INDIVIDUAL_HONOUR_RE = re.compile(
    r"player of the|footballer of the|golden boot|golden shoe|golden glove|"
    r"best player|golden ball|ballon d|the best|mvp|team of the season|"
    r"young player|save of the|goal of the|top goal scorer|player of the season|"
    r"top scorer|puskas|kopa trophy|bravo award|dream team",
    re.I,
)


def scrape_tm_trophies(tm_id, slug):
    url = f"https://www.transfermarkt.com/{slug}/erfolge/spieler/{tm_id}"
    r = tm_get(url)
    if r is None:
        return {"individual": [], "club": [], "raw": []}
    soup = BeautifulSoup(r.text, "html.parser")
    boxes = soup.select("div.box")
    individual, club, raw = [], [], []
    for b in boxes:
        h2 = b.select_one("h2")
        if not h2:
            continue
        title = h2.get_text(" ", strip=True)
        if title.lower() == "all titles":
            continue
        rows = []
        for tr in b.select("table tr"):
            rows.append(tr.get_text(" | ", strip=True))
        entry = {"title": title, "rows": rows}
        raw.append(entry)
        if INDIVIDUAL_HONOUR_RE.search(title):
            individual.append(entry)
        else:
            club.append(entry)
    return {"individual": individual, "club": club, "raw": raw}


def wiki_get_wikitext(title):
    r = requests.get(
        "https://en.wikipedia.org/w/api.php",
        params={
            "action": "query", "prop": "revisions", "rvprop": "content",
            "rvslots": "main", "titles": title, "format": "json", "redirects": 1,
        },
        headers=WIKI_HEADERS, timeout=20,
    )
    if r.status_code != 200:
        return None
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), None)
    if not page or "revisions" not in page:
        return None
    return page["revisions"][0]["slots"]["main"]["*"]


def parse_wiki_infobox(wikitext):
    idx = wikitext.find("Infobox football biography")
    if idx == -1:
        return {}
    # infobox 블록만 대략 잘라내기 (다음 "\n}}" 까지, 중첩 템플릿 있어도 필드 파싱엔 지장 없음)
    end = wikitext.find("\n}}", idx)
    block = wikitext[idx: end if end != -1 else idx + 6000]
    # HTML comments can span multiple physical lines (e.g. a <ref> source
    # comment after a caps/goals number) - must strip these on the whole
    # block before splitting into lines, otherwise a comment's closing "-->"
    # on a later line never gets matched and leaks into that field's value.
    block = re.sub(r"<!--.*?-->", "", block, flags=re.S)

    def split_top_level(text, sep="|"):
        # 대부분의 인포박스는 줄마다 "| key = value" 하나씩이지만, 일부 선수
        # 문서(누누 멘드스/디마르코/요렌테 등)는 "| years1 = .. | clubs1 = ..
        # | caps1 = .. | goals1 = .." 처럼 여러 필드를 한 줄에 파이프로 이어
        # 쓴다. 단순히 "|"로 자르면 [[a|b]] 같은 위키링크 내부 파이프까지
        # 잘라버리므로, [[ ]]/{{ }} 안에서는 자르지 않는다.
        parts, buf, depth, i, n = [], [], 0, 0, len(text)
        while i < n:
            two = text[i:i + 2]
            if two in ("[[", "{{"):
                depth += 1
                buf.append(two)
                i += 2
                continue
            if two in ("]]", "}}"):
                depth = max(0, depth - 1)
                buf.append(two)
                i += 2
                continue
            ch = text[i]
            if ch == sep and depth == 0:
                parts.append("".join(buf))
                buf = []
            else:
                buf.append(ch)
            i += 1
        parts.append("".join(buf))
        return parts

    fields = {}
    for line in block.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        for segment in split_top_level(line[1:]):
            if "=" not in segment:
                continue
            key, _, val = segment.partition("=")
            key = key.strip()
            if key:
                fields[key] = val.strip()

    def clean(text):
        if text is None:
            return None
        text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", text)  # [[a|b]] -> b
        text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
        text = re.sub(r"<ref[^>]*/>", "", text)
        text = re.sub(r"\{\{[^}]*\}\}", "", text)
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        return text.strip()

    club_stints = []
    i = 1
    while f"years{i}" in fields or f"clubs{i}" in fields:
        club_stints.append({
            "years": clean(fields.get(f"years{i}")),
            "club": clean(fields.get(f"clubs{i}")),
            "caps": clean(fields.get(f"caps{i}")),
            "goals": clean(fields.get(f"goals{i}")),
        })
        i += 1

    youth_stints = []
    i = 1
    while f"youthyears{i}" in fields or f"youthclubs{i}" in fields:
        youth_stints.append({
            "years": clean(fields.get(f"youthyears{i}")),
            "club": clean(fields.get(f"youthclubs{i}")),
        })
        i += 1

    national_stints = []
    i = 1
    while f"nationalyears{i}" in fields or f"nationalteam{i}" in fields:
        national_stints.append({
            "years": clean(fields.get(f"nationalyears{i}")),
            "team": clean(fields.get(f"nationalteam{i}")),
            "caps": clean(fields.get(f"nationalcaps{i}")),
            "goals": clean(fields.get(f"nationalgoals{i}")),
        })
        i += 1

    def parse_birth_date(raw):
        if not raw:
            return None
        m = re.search(r"birth date(?: and age)?\s*\|(?:df=\w+\|)?(\d{4})\|(\d{1,2})\|(\d{1,2})", raw)
        if not m:
            m = re.search(r"birth date(?: and age)?\|(\d{4})\|(\d{1,2})\|(\d{1,2})\|df=\w+", raw)
        if m:
            y, mo, d = m.groups()
            return f"{y}-{int(mo):02d}-{int(d):02d}"
        return clean(raw)

    return {
        "fullName": clean(fields.get("full_name")) or clean(fields.get("name")),
        "birthDate": parse_birth_date(fields.get("birth_date")),
        "birthPlace": clean(fields.get("birth_place")),
        "height": clean(fields.get("height")),
        "position": clean(fields.get("position")),
        "currentClub": clean(fields.get("currentclub")),
        "clubNumber": clean(fields.get("clubnumber")),
        "youthStints": youth_stints,
        "clubStints": club_stints,
        "nationalStints": national_stints,
    }


def crawl_one(player):
    out_path = DATA_DIR / f"{player['id']}.json"
    if out_path.exists():
        print(f"[skip] {player['id']} already crawled")
        return

    print(f"[crawl] {player['id']} ({player['en']})")
    result = {"id": player["id"], "ko": player["ko"], "en": player["en"]}

    tm_id, slug = resolve_tm_id(player.get("tm_query", player["en"]))
    polite_sleep()
    if tm_id:
        result["profile"] = scrape_tm_profile(tm_id, slug)
        polite_sleep()
        result["trophies"] = scrape_tm_trophies(tm_id, slug)
        polite_sleep()
    else:
        print(f"    [warn] TM id not resolved for {player['en']}")
        result["profile"] = {}
        result["trophies"] = {"individual": [], "club": [], "raw": []}

    wikitext = wiki_get_wikitext(player["wiki"])
    polite_sleep()
    if wikitext:
        result["wiki"] = parse_wiki_infobox(wikitext)
        if not result["wiki"]:
            # 페이지는 있지만 인포박스가 없는 경우 - 보통 동명이인 소개(disambiguation)
            # 페이지로 잘못된 제목을 줬다는 뜻. wiki 제목을 고쳐야 한다.
            print(f"    [warn] no infobox parsed for wiki title {player['wiki']!r} "
                  f"(disambiguation page? check players.py)")
    else:
        print(f"    [warn] wiki page not found for {player['wiki']}")
        result["wiki"] = {}

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"    [done] -> {out_path.name}")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--only", type=str, default=None, help="comma separated ids")
    args = ap.parse_args()

    players = ALL_PLAYERS
    if args.only:
        wanted = set(args.only.split(","))
        players = [p for p in players if p["id"] in wanted]
    if args.limit:
        players = players[: args.limit]

    for idx, p in enumerate(players, 1):
        print(f"=== {idx}/{len(players)} ===")
        try:
            crawl_one(p)
        except Exception as e:
            print(f"    [ERROR] {p['id']}: {e}")


if __name__ == "__main__":
    main()
