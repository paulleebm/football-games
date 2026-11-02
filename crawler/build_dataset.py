"""
crawler/data/raw/*.json (원본 스크랩) -> crawler/data/dataset.json (Firestore 업로드용 최종 구조).
design/data_schema.md 의 guessPlayers/{playerId} 스키마를 만든다.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from players import ALL_PLAYERS
from club_info import CLUB_INFO, COUNTRY_KO, CONTINENT, BIG5

RAW_DIR = Path(__file__).parent / "data" / "raw"
WIKI_HONOURS_PATH = Path(__file__).parent / "data" / "wiki_honours.json"
NOTABLE_TEAMMATES_PATH = Path(__file__).parent / "data" / "notable_teammates.json"
LEAGUE_RANK_PATH = Path(__file__).parent / "data" / "league_rank.json"
RECENT_RANKS_PATH = Path(__file__).parent / "data" / "recent_season_ranks.json"
EXTRA_HINTS_PATH = Path(__file__).parent / "data" / "quiz_players_extra_hints.json"
OUT_PATH = Path(__file__).parent / "data" / "dataset.json"
CURRENT_YEAR = 2026

CLUB_ALIASES = {
    "Spurs": "Tottenham Hotspur", "Tottenham": "Tottenham Hotspur",
    "Man City": "Manchester City", "Man United": "Manchester United", "Man Utd": "Manchester United",
    "Barca": "Barcelona", "FC Barcelona": "Barcelona",
    "PSG": "Paris Saint-Germain", "Paris SG": "Paris Saint-Germain",
    "Bayern": "Bayern Munich", "FC Bayern Munich": "Bayern Munich",
    "Dortmund": "Borussia Dortmund", "BVB": "Borussia Dortmund",
    "Leverkusen": "Bayer Leverkusen", "Bayer 04 Leverkusen": "Bayer Leverkusen",
    "Atletico": "Atletico Madrid", "Atletico de Madrid": "Atletico Madrid", "Atlético Madrid": "Atletico Madrid",
    "Real Betis Balompie": "Real Betis", "Betis": "Real Betis", "Athletic Club": "Athletic Bilbao",
    "Deportivo A Coruña": "Deportivo La Coruña",
    "Inter": "Inter Milan", "Internazionale": "Inter Milan", "AC Inter": "Inter Milan",
    "Milan": "AC Milan", "Roma": "AS Roma",
    "Marseille": "Olympique de Marseille", "Lyon": "Olympique Lyonnais",
    "Monaco": "AS Monaco", "PSV": "PSV Eindhoven",
    "Real Sociedad de Futbol": "Real Sociedad", "Villarreal CF": "Villarreal",
    "Newcastle": "Newcastle United", "Brighton": "Brighton & Hove Albion",
    "West Ham": "West Ham United", "Wolves": "Wolverhampton Wanderers",
    "Leeds": "Leeds United", "Leicester": "Leicester City",
    "Fenerbahçe": "Fenerbahce", "Galatasaray SK": "Galatasaray",
    "Al Hilal": "Al-Hilal", "Al Nassr": "Al-Nassr", "Al Ittihad": "Al-Ittihad", "Al Ahli": "Al-Ahli",
    "Inter Miami": "Inter Miami CF",
    "RB Salzburg": "FC Red Bull Salzburg", "Red Bull Salzburg": "FC Red Bull Salzburg",
    "Sporting Lisbon": "Sporting CP", "FC Porto": "Porto", "SL Benfica": "Benfica",
    "Borussia Monchengladbach": "Borussia Monchengladbach", "Gladbach": "Borussia Monchengladbach",
}


def norm_club(name):
    if not name:
        return name
    # 위키 인포박스는 임대 이적을 "→ Club (loan)"으로 표기한다 - 화살표/괄호 둘 다 제거해야
    # 같은 구단의 다른 표기(임대 vs 완전 이적)가 서로 다른 클럽으로 취급되지 않는다.
    name = re.sub(r"^→\s*", "", name)
    name = re.sub(r"\s*\(.*?\)\s*$", "", name).strip()
    return CLUB_ALIASES.get(name, name)


def is_reserve_team(name):
    # "Real Madrid Castilla", "Barcelona Atletic", "OO B" 처럼 나라마다 리저브팀
    # 명명법이 달라서 "II"/"2"만으로는 못 잡는 경우가 많다 (예: 로드리고가
    # "Real Madrid" 다음에 "Real Madrid Castilla"가 위키텍스트에 나중에 나와서
    # current club으로 잘못 뽑히던 버그).
    return bool(re.search(
        r"(\sII$|\s[BC]$|\s2$|\bU-?21\b|\bU-?23\b|\bCastilla\b|\bAtl[eè]tic\b|\bReserves?\b)",
        name or "", re.I))


def parse_years(years_str):
    if not years_str:
        return None, None
    years_str = years_str.replace("–", "-").replace("—", "-")
    nums = re.findall(r"\d{4}", years_str)
    if not nums:
        return None, None
    start = int(nums[0])
    if years_str.strip().endswith("-") or len(nums) == 1 and "-" in years_str:
        end = CURRENT_YEAR
    elif len(nums) >= 2:
        end = int(nums[1])
    else:
        end = start
    return start, end


def parse_height_cm(text):
    if not text:
        return None
    m = re.search(r"(\d)[.,](\d\d)", text)
    if m:
        return int(m.group(1)) * 100 + int(m.group(2))
    return None


def parse_birth_year(profile_dob, wiki_birth_date):
    if wiki_birth_date:
        m = re.match(r"(\d{4})-", wiki_birth_date)
        if m:
            return int(m.group(1))
    if profile_dob:
        m = re.search(r"\d{2}/\d{2}/(\d{4})", profile_dob)
        if m:
            return int(m.group(1))
    return None


def parse_foot(foot_raw):
    return {"left": "왼발", "right": "오른발", "both": "양발"}.get((foot_raw or "").lower())


# 위키피디아 Honours 절 개인상 중 "전 세계적으로 통용되는" 메이저 상만 인정한다.
# 선수 한 명의 위키 개인상 목록은 자국 매체상/이달의 선수/소속팀 자체 시상까지
# 다 합치면 수십 개가 나오는데(홀란드 46개, 네이마르 42개), 그런 걸 다 힌트로
# 쓰면 오히려 한국 사용자가 못 알아보는 상 천지가 되어 힌트 가치가 떨어진다.
# 위키링크의 "표시 문구"와 "링크 대상 문서 제목"을 둘 다 대상으로 검사한다 -
# FIFA World Cup의 골든볼/골든부트/드림팀처럼 서로 다른 상이 같은 허브 문서
# ("FIFA World Cup awards")의 다른 절로 링크되어 target만으로는 구분 안 되는
# 경우가 있어서, display 쪽 문구도 같이 봐야 정확히 걸러진다.
MAJOR_INDIVIDUAL_AWARD_RE = re.compile(
    r"ballon d'or|super ballon d'or|kopa trophy|yashin trophy|gerd m(?:u|ü)ller trophy|"
    r"soc?rates award|golden boy\b|"
    r"fifa world player of the year|the best fifa (?:men's player|goalkeeper|women's player)|"
    r"the best fifa special award|"
    r"fifa puska?s award|puska?s award|"
    r"uefa men's player of the year|uefa women's player of the year|"
    r"uefa club footballer of the year|uefa young player of the year|"
    r"european golden shoe|european golden boot|"
    r"fifa world cup golden ball|fifa world cup golden boot|fifa world cup golden glove|"
    r"fifa world cup (?:bronze|silver) (?:ball|boot|shoe)|fifa world cup young player|"
    r"fifa world cup dream team|fifa world cup best young player|fifa world cup fantasy team|"
    r"uefa european championship (?:golden boot|player of the tournament)|"
    r"uefa euro (?:golden boot|player of the tournament)|"
    r"copa am[eé]rica (?:golden ball|golden boot|best player|team of the tournament)|"
    r"africa cup of nations player of the tournament|afcon player of the tournament|"
    r"fifa fifpro (?:men's )?world ?11|fifpro (?:men's )?world ?11|"
    r"uefa team of the year|"
    r"pfa players' player of the year|pfa player of the year|pfa young player of the year|"
    r"pfa team of the year|"
    r"football writers' association footballer of the year|fwa footballer of the year|"
    r"(?:premier league|la ?liga|bundesliga|serie a|ligue 1) player of the season|"
    r"(?:premier league|la ?liga|bundesliga|serie a|ligue 1) young player of the season|"
    r"(?:premier league|la ?liga|bundesliga|serie a|ligue 1) golden boot|"
    r"(?:premier league|la ?liga|bundesliga|serie a|ligue 1) golden glove|"
    r"iffhs world's best (?:player|goalkeeper)|iffhs men's world team|iffhs world team\b",
    re.I,
)

# 축구 트로피/수상이 아닌 절(명예시민권, 훈장 등)이 위키 Honours 절 맨 끝에 개인상과
# 나란히 부제목으로 섞여 나오는 경우가 있다(모드리치의 "State honours and orders").
# 그룹 이름 자체가 이런 패턴이면 club/individual 어느 쪽으로도 넣지 않고 통째로 버린다.
NON_FOOTBALL_GROUP_RE = re.compile(r"state honours|honorary|order of|citizenship|decoration", re.I)

# 위와 별개로, 국가대표/개인 항목 밑에 축구와 무관한 훈장·서훈이 그룹 구분 없이
# 낱개 항목으로 섞여 나오기도 한다(기사 작위, 훈장 등 - 국가 영웅급 선수 문서에 흔함).
# 항목 하나하나를 봐서 이런 패턴이면 club이든 individual이든 통째로 버린다.
# "x15px"/"50px" 앞머리는 훈장 아이콘 파일 링크가 부분적으로만 걸러진 잔재다.
NON_FOOTBALL_ENTRY_RE = re.compile(
    r"knight of|order of|member of the order|legion of honou?r|"
    r"freedom of the city|bene merito|silbernes lorbeerblatt|"
    r"all-time.*(?:leader|top scorer|goalscorer)",
    re.I,
)


def classify_wiki_honours(groups):
    """
    crawl_wiki_honours.py가 저장한 [{"group","entries":[{"target","display","wonSeasons",...}]}]
    원본을 club_honours/individual_honours ({label,count,rows} 리스트)로 변환한다.
    같은 대회를 여러 클럽에서 우승한 경우(예: 두 클럽에서 챔피언스리그 우승) label별로
    합쳐서 힌트에 같은 이름이 중복으로 뜨지 않게 한다.
    """
    club_by_label, individual_by_label = {}, {}
    for g in groups or []:
        group_name = g["group"]
        if NON_FOOTBALL_GROUP_RE.search(group_name):
            continue
        is_individual = group_name.strip().lower().startswith("individual")
        for e in g["entries"]:
            if not e["wonSeasons"] or "[[" in e["display"] or "]]" in e["display"]:
                # 위키텍스트 자체가 손상된 극소수 케이스(예: 링크 두 개가 붙어서 콜론이
                # 엉뚱한 위치에서 잘리는 경우) - 안전하게 통째로 버린다.
                continue
            if NON_FOOTBALL_ENTRY_RE.search(e["display"]):
                continue
            if is_individual:
                haystack = f"{e['target']} | {e['display']}"
                if not MAJOR_INDIVIDUAL_AWARD_RE.search(haystack):
                    continue
                bucket, label = individual_by_label, e["display"]
                rows_suffix = ""
            else:
                bucket, label = club_by_label, e["display"]
                rows_suffix = f" | {norm_club(group_name)}"
            entry = bucket.setdefault(label, {"label": label, "count": 0, "rows": []})
            entry["count"] += len(e["wonSeasons"])
            entry["rows"] += [f"{season}{rows_suffix}" for season in e["wonSeasons"]]
    return list(club_by_label.values()), list(individual_by_label.values())


NATIONAL_YOUTH_RE = re.compile(r"U-?\d{2}", re.I)


def build_national_team(wiki_national, profile):
    senior = None
    for stint in reversed(wiki_national or []):
        team = stint.get("team") or ""
        if NATIONAL_YOUTH_RE.search(team):
            continue
        senior = stint
        break
    if senior:
        caps = int(re.sub(r"\D", "", senior.get("caps") or "") or 0) or None
        goals_raw = senior.get("goals") or ""
        goals = int(re.sub(r"\D", "", goals_raw) or 0) if re.search(r"\d", goals_raw) else None
        country = senior.get("team")
    else:
        caps = profile.get("nationalCaps")
        goals = profile.get("nationalGoals")
        country = profile.get("currentInternational")
    return {"country": country, "caps": caps, "goals": goals}


def build_player(raw, wiki_honours_groups=None):
    profile = raw.get("profile") or {}
    wiki = raw.get("wiki") or {}

    birth_year = parse_birth_year(profile.get("dob"), wiki.get("birthDate"))

    youth_clubs = []
    for stint in wiki.get("youthStints", []):
        club_raw = (stint.get("club") or "").strip()
        if not club_raw:
            continue
        club = norm_club(club_raw)
        if club not in youth_clubs:
            youth_clubs.append(club)

    career = []
    for stint in wiki.get("clubStints", []):
        club_raw = (stint.get("club") or "").strip()
        if not club_raw or is_reserve_team(club_raw):
            continue
        club = norm_club(club_raw)
        start, end = parse_years(stint.get("years"))
        country, league = CLUB_INFO.get(club, (None, None))
        caps = int(re.sub(r"\D", "", stint.get("caps") or "") or 0) if stint.get("caps") else None
        goals = int(re.sub(r"\D", "", stint.get("goals") or "") or 0) if stint.get("goals") else None
        career.append({
            "club": club, "yearsText": stint.get("years"), "startYear": start, "endYear": end,
            "country": country, "league": league, "leagueKo": league,
            "caps": caps, "goals": goals,
        })

    # 위키 인포박스는 대체로 연대순이지만 가끔 순서가 어긋난다(로드리고처럼 리저브팀
    # 스틴트가 1군 이적 다음 줄에 나오는 식) - career의 마지막 원소가 항상
    # "현재 소속"이 되도록 다시 정렬한다. endYear가 없는(진행 중인) 스틴트는
    # startYear와 무관하게 항상 맨 뒤로 보내야 한다 - 그렇지 않으면 콜윌처럼
    # "친정팀 소속(진행중) + 이후 임대 두 번(완료)" 케이스에서 startYear가 더
    # 이른 친정팀이 가장 최근에 끝난 임대보다 앞으로 와버려, 이미 복귀한 친정팀이
    # 아니라 과거 임대지가 "현재 소속"으로 잘못 판정된다.
    career.sort(key=lambda c: (
        1 if c["endYear"] is None else 0,
        c["endYear"] or 0,
        c["startYear"] or 0,
    ))

    club_honours, individual_honours = classify_wiki_honours(wiki_honours_groups)
    national_team = build_national_team(wiki.get("nationalStints"), profile)

    # profile.citizenship는 TM이 복수국적을 공백으로 이어붙여서 내려줄 때가 있다
    # ("Argentina Spain" 처럼) - 실제로 국가대표로 뛰는 나라(nationalTeam.country)가
    # 있으면 그걸 우선한다. 둘 다 없을 때만 citizenship 첫 단어로 최후 폴백.
    raw_citizenship = profile.get("citizenship") or (wiki.get("birthPlace") or "").split(",")[-1].strip()
    nationality = national_team.get("country") or (raw_citizenship.split(" ")[0] if raw_citizenship else None)

    height_cm = parse_height_cm(profile.get("heightText")) or parse_height_cm(wiki.get("height"))
    position = profile.get("positionText") or wiki.get("position")

    current_club_tm = profile.get("currentClubTM") or wiki.get("currentClub")
    # career의 마지막 원소가 항상 "현재 소속"이라고 가정하지만, 위키 인포박스가
    # 갱신되기 전이면(예: 임대가 이미 끝나고 원 소속팀에 복귀했는데 인포박스는
    # 아직 임대팀을 마지막 스틴트로 들고 있는 경우 - 보니파스 사례) career[-1]이
    # 실제로는 지난 소속팀일 수 있다. 더 자주 갱신되는 TM의 "현재 소속팀"과
    # 매칭되는 career 항목이 있으면 그걸 우선해서 "현재 소속리그"를 뽑는다.
    current_league = None
    if current_club_tm:
        tmc = current_club_tm.strip().lower()
        if tmc not in ("without club", "retired", ""):
            matches = [c for c in career if tmc in c["club"].lower() or c["club"].lower() in tmc]
            target = matches[-1] if matches else (career[-1] if career else None)
            current_league = target["league"] if target else None
    if current_league is None and career:
        current_league = career[-1]["league"]

    aliases = {raw["en"], raw["ko"]}
    if wiki.get("fullName"):
        aliases.add(wiki["fullName"])
    if profile.get("nameHomeCountry"):
        aliases.add(profile["nameHomeCountry"])

    return {
        "id": raw["id"],
        "profile": {
            "nameKo": raw["ko"], "nameEn": raw["en"],
            "aliases": sorted(a for a in aliases if a),
            "photoUrl": profile.get("photoUrl"),
            "birthYear": birth_year,
            "position": position,
            "foot": parse_foot(profile.get("foot")),
            "heightCm": height_cm,
            "nationality": nationality,
            "nationalityKo": COUNTRY_KO.get(nationality, nationality),
            "continent": CONTINENT.get(nationality),
            "currentClub": current_club_tm,
            "currentLeague": current_league,
            "birthCity": profile.get("placeOfBirth") or (wiki.get("birthPlace") or "").split(",")[0].strip() or None,
        },
        "career": career,
        "youthClubs": youth_clubs,
        "clubHonours": club_honours,
        "individualHonours": individual_honours,
        "nationalTeam": national_team,
        "meta": {"tmUrl": profile.get("tmUrl")},
    }


def compute_teammate_links(players):
    # club(정규화) + 재직 연도 범위가 겹치면 동료로 판정
    links = {p["id"]: [] for p in players}
    for i, a in enumerate(players):
        for b in players[i + 1:]:
            shared = []
            for ca in a["career"]:
                if ca["startYear"] is None:
                    continue
                for cb in b["career"]:
                    if cb["startYear"] is None or ca["club"] != cb["club"]:
                        continue
                    if ca["startYear"] <= cb["endYear"] and cb["startYear"] <= ca["endYear"]:
                        shared.append(ca["club"])
            if shared:
                clubs = sorted(set(shared))
                links[a["id"]].append({"playerId": b["id"], "clubs": clubs})
                links[b["id"]].append({"playerId": a["id"], "clubs": clubs})
    return links


def load_notable_teammates():
    if not NOTABLE_TEAMMATES_PATH.exists():
        return {}
    data = json.load(open(NOTABLE_TEAMMATES_PATH, encoding="utf-8"))
    out = {}
    for pid, entry in data.items():
        if not entry or not entry.get("teammates"):
            out[pid] = []
            continue
        out[pid] = [
            {"name": t["name"], "club": entry["club"], "nationality": t.get("nationality")}
            for t in entry["teammates"]
        ]
    return out


def main():
    wiki_honours = {}
    if WIKI_HONOURS_PATH.exists():
        wiki_honours = json.load(open(WIKI_HONOURS_PATH, encoding="utf-8"))

    raws = []
    for p in ALL_PLAYERS:
        path = RAW_DIR / f"{p['id']}.json"
        if not path.exists():
            print(f"[skip] no raw data for {p['id']}")
            continue
        raw = json.load(open(path, encoding="utf-8"))
        raw["_wikiHonoursGroups"] = wiki_honours.get(p["id"], [])
        raws.append(raw)

    players = [build_player(r, r.pop("_wikiHonoursGroups")) for r in raws]
    links = compute_teammate_links(players)
    notable = load_notable_teammates()
    league_rank = {}
    if LEAGUE_RANK_PATH.exists():
        league_rank = json.load(open(LEAGUE_RANK_PATH, encoding="utf-8"))
    recent_ranks = {}
    if RECENT_RANKS_PATH.exists():
        recent_ranks = json.load(open(RECENT_RANKS_PATH, encoding="utf-8"))
    extra_hints = {}
    if EXTRA_HINTS_PATH.exists():
        extra_hints = json.load(open(EXTRA_HINTS_PATH, encoding="utf-8"))
    for p in players:
        p["teammateLinks"] = links[p["id"]]
        p["notableTeammates"] = notable.get(p["id"], [])
        p["lastSeasonRank"] = league_rank.get(p["id"])
        # crawl_recent_ranks.py: 시즌마다(23/24,24/25,25/26) 실제로 몸담았던 클럽
        # 기준으로 역산한 순위 - 이적한 시즌은 이적 전/후 클럽이 다를 수 있어서
        # lastSeasonRank(현재 클럽 하나)와 달리 시즌별로 다른 클럽 순위가 섞일 수 있다.
        # 오래되어(=커리어가 짧아) 못 찾은 시즌은 그냥 건너뛴다(리스트가 3보다 짧아짐).
        p["recentSeasonRanks"] = [e for e in (recent_ranks.get(p["id"]) or []) if e]
        # fetch_extra_hint_fields.py로 FotMob에서 따로 크롤링해둔 등번호/시장가치/계약만료.
        # build_player()의 profile은 위키/TM 소스만 쓰므로 여기서 profile에 합쳐줘야
        # index.html의 챌린지 모드(pr.shirt 등)가 실제로 값을 읽을 수 있다.
        extra = extra_hints.get(p["id"]) or {}
        p["profile"]["shirt"] = extra.get("shirt")
        p["profile"]["marketValueEUR"] = extra.get("marketValueEUR")
        p["profile"]["contractEnd"] = extra.get("contractEnd")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(players, f, ensure_ascii=False, indent=2)
    print(f"built {len(players)} players -> {OUT_PATH}")


if __name__ == "__main__":
    main()
