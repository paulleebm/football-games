"""
선수 위키피디아 문서의 "Honours" 절을 크롤링/파싱한다.

Transfermarkt의 erfolge(업적) 페이지 대신 이 소스를 쓰는 이유: Transfermarkt는
개인 수상 쪽이 부실하고(야신 트로피, 올해의 팀 등이 잘 안 잡힘) 항목명도
번역하기 애매한 게 많다. 위키피디아 Honours 절은 클럽별/개인 항목이
'''굵은 제목'''으로 이미 명확히 나뉘어 있고, 대회명도 표준 명칭 위키링크라
훨씬 정확하고 완전하다.

wikitext 포맷 (MediaWiki 마크업, 렌더링된 HTML이 아니라 원문 그대로):

    == Honours ==
    '''Manchester City'''
    *[[Premier League]]: [[2022-23 Premier League|2022-23]], [[2023-24 Premier League|2023-24]]<ref>...</ref>
    *[[FA Cup]]: [[2022-23 FA Cup|2022-23]]; runner-up: [[2020-21 FA Cup|2020-21]]<ref>...</ref>

    '''Individual'''
    *[[UEFA Men's Player of the Year Award|UEFA Men's Player of the Year]]: 2022-23<ref>...</ref>

'''제목'''마다 그룹이 바뀌고("Individual"이면 개인 수상, 그 외엔 소속팀명), 각
줄(*)은 "[[대회 위키링크|표시문구]]: 시즌, 시즌, ...<ref>각주</ref>" 형태다.
같은 줄에 "; runner-up: 시즌"으로 준우승 시즌이 덧붙기도 하는데, 그건 우승
횟수에 넣지 않는다(우승 안 한 대회 자체도 통째로 버린다).
"""
import re

import requests

WIKI_HEADERS = {
    "User-Agent": "personal-research-crawler/1.0 (non-commercial football quiz game project; contact bymile@naver.com)"
}

# 반드시 "Honours"/"Honors"(+ "and awards" 등)로 시작하는 레벨2(==) 제목만 인정한다 -
# 문서 뒷부분에 "=== Eponyms and honours ===" 같은 레벨3 부제목이 따로 있어서(호날두 등)
# "honours"를 단순 포함(substring)으로 찾으면 그 엉뚱한 절을 잘못 집어올 수 있다.
# 미국 선수 문서는 "Honors"(미국식 철자)를 쓰고 그 안에 철자 관련 HTML 주석이
# 붙기도 한다(예: 매케니 - "==Honors <!--Do not change to Honours...--> =="), 그래서
# "Honou?rs" 뒤에 <!--...--> 주석이 와도 매칭되게 .*?로 열어둔다.
HONOURS_HEADING_RE = re.compile(r"^==([ \t]*Honou?rs\b.*?)==\s*$", re.I | re.M)
# 클럽/개인 그룹을 나누는 방식이 문서마다 다르다 - '''굵은 글씨'''(가장 흔함),
# ===레벨3(+) 소제목=== 두 가지가 주로 쓰이고, 굵은 제목 뒤에 바로 <ref>출처</ref>가
# 붙는 문서도 있어서(호날두 등) 줄 끝까지 공백만 있어야 한다고 요구하면 그런 줄을
# 놓친다 - 뒤에 뭐가 더 있어도 매칭한다.
PRIMARY_GROUP_RE = re.compile(
    r"^\s*(?:'''(.+?)'''[^\n]*|===+\s*(.+?)\s*=+[^\n]*)$", re.M
)
# ;정의목록 용어(예: ";Sparta Prague")도 그룹 구분에 쓰이는데, 두 가지 다른 용도로
# 쓰인다: (1) 페치크처럼 굵은 제목 없이 이것 자체가 유일한 최상위 구분자인 경우,
# (2) 모드리치처럼 '''Individual''' 밑에 ";Major awards"/";Croatian player awards"
# 식으로 한 단계 더 세분화하는 하위 제목으로 쓰이는 경우. (2)를 (1)처럼 최상위
# 그룹으로 잘못 쪼개면 "Individual" 그룹 자체가 텅 비어버리고 세부 제목들이 국가/
# 클럽명인 것처럼 최상위에 섞여버린다. 그래서 이건 최상위 분할에는 안 쓰고, PRIMARY_GROUP_RE로
# 아예 하나도 못 찾았을 때만(=문서 전체가 ;로만 구분된 경우) 대체로 사용한다.
SEMICOLON_GROUP_RE = re.compile(r"^\s*;\s*([^\n]+)$", re.M)
BULLET_RE = re.compile(r"^\*+\s*(.+)$", re.M)
# "우승"이 아닌 결과 - 준우승, 후보 2위/3위(글자 표기 "third place"든 숫자 표기
# "3rd place"든), 그리고 단순 "후보 지명(nominee)"까지 전부 우승 횟수에서 빼야 한다 -
# 안 그러면 "발롱도르 후보"였을 뿐인데 발롱도르를 "수상"한 것처럼 힌트에 나온다.
NON_WIN_PREFIX_RE = re.compile(
    r"(?i)^(?:runner-?up|(?:2nd|3rd|4th|second|third|fourth)[\s-]place|nominee[ds]?|nominated)\b\s*:?\s*"
)


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


def _strip_refs(text):
    # <ref>...</ref>, <ref .../>, <!--comment--> 만 제거한다(위키링크는 그대로 둔다) -
    # _parse_bullet이 맨 앞 링크를 target/display로 따로 뽑아써야 하기 때문에, 그
    # 전에 링크까지 뭉개버리면 안 된다.
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return text


def _clean_inline(text):
    # <ref>...</ref>, <ref .../>, <!--comment--> 제거 후 [[링크|표시]] -> 표시 (또는
    # [[링크]] -> 링크). 상 이름이 개정되면서 "[[A]]/[[B]]/[[C]]"처럼 링크 여러 개가
    # 슬래시로 이어지는 경우가 있어서(예: 메시의 "발롱도르/FIFA 발롱도르/올해의 선수"),
    # 맨 앞 링크 하나만 다루는 _wikilink_target_and_display로는 나머지가 대괄호 채로
    # 텍스트에 남는다 - 그래서 여기서 전체 텍스트의 링크를 한 번에 다 풀어준다.
    text = _strip_refs(text)
    text = re.sub(r"<[^>]+>", "", text)  # 잔여 태그(파일 캡션 등)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", text)
    text = text.replace("''", "")  # 이탤릭/볼드 위키 마크업(''..'', '''..''')
    return text.strip()


def _wikilink_target_and_display(link_text):
    # "[[UEFA Men's Player of the Year Award|UEFA Men's Player of the Year]]" -> (target, display)
    # "[[Premier League]]" -> (target, target)
    m = re.match(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", link_text)
    if not m:
        return None, None
    target = m.group(1).split("#")[0].strip()
    display = (m.group(2) or m.group(1)).strip()
    return target, display


def _extract_seasons(segment):
    # "[[2022-23 Premier League|2022-23]], [[2023-24 Premier League|2023-24]]" -> ["2022-23", "2023-24"]
    # 링크가 아니라 그냥 "2019" 같은 맨 텍스트로 적힌 시즌도 있다(개인상 쪽에 흔함).
    seasons = []
    pos = 0
    for m in re.finditer(r"\[\[([^\]]+)\]\]", segment):
        plain = segment[pos:m.start()]
        seasons += [s.strip(" ,;") for s in plain.split(",") if s.strip(" ,;")]
        _, display = _wikilink_target_and_display(m.group(0))
        if display:
            seasons.append(display.split("|")[-1].strip())
        pos = m.end()
    tail = segment[pos:]
    seasons += [s.strip(" ,;") for s in tail.split(",") if s.strip(" ,;")]
    return [s for s in seasons if s]


def _parse_bullet(line):
    """
    한 줄(예: "[[Premier League]]: [[2022-23 Premier League|2022-23]]; runner-up: [[2020-21 FA Cup|2020-21]]")
    -> {"target": "Premier League", "display": "Premier League", "wonSeasons": [...], "runnerUpSeasons": [...]}
    첫 위키링크를 "무슨 대회/상인지"로 보고, 그 뒤 ":" 이후를 시즌 목록으로 본다.
    ";"로 이어지는 뒤쪽 구간에 "runner-up"이 있으면 그 시즌들은 준우승으로 분리한다.

    링크 바로 뒤에 실제 콜론이 나오기 전까지 평범한 텍스트가 더 붙는 경우가 흔하다
    (예: "[[Copa América]] Golden Glove: 2019", "[[Austrian Football Bundesliga|Austrian
    Bundesliga]] Player of the Season: 2019-20") - 이 텍스트는 표시 이름의 일부이므로
    display에 이어붙인다. 단순히 rest.lstrip(": ")만 하면 이 텍스트가 시즌 목록에
    섞여 들어가 버린다.
    """
    line = _strip_refs(line).strip()
    m = re.match(r"\[\[[^\]]+\]\]", line)
    if not m:
        return None
    target, display = _wikilink_target_and_display(m.group(0))
    if not target:
        return None
    rest = line[m.end():]

    colon_idx = rest.find(":")
    if colon_idx == -1:
        return None
    prefix = _clean_inline(rest[:colon_idx])
    entirely_runner_up = False
    prefix_wo_ru = NON_WIN_PREFIX_RE.sub("", prefix)
    if prefix_wo_ru != prefix:
        entirely_runner_up = True
    # 상 이름이 개정되면서 "[[구 이름]]/[[신 이름]]/[[또 다른 이름]]: 시즌..."처럼
    # 링크 여러 개를 슬래시로 이어 붙인 경우 - 전부 같은 상의 다른 시절 명칭일 뿐이라
    # 첫 번째(대개 가장 널리 알려진) 이름만 남기고 나머지는 버린다. 다 붙이면
    # "FIFA World Player of the Year /FIFA Ballon d'Or/The Best FIFA Men's Player"처럼
    # 힌트로 쓰기엔 너무 길고 지저분해진다.
    if prefix_wo_ru.startswith("/"):
        prefix_wo_ru = ""
    if prefix_wo_ru:
        display = f"{display} {prefix_wo_ru}".strip()
    rest = rest[colon_idx + 1:].strip()

    won_seasons, runner_up_seasons = [], []
    for clause in rest.split(";"):
        clause = clause.strip()
        if not clause:
            continue
        is_ru = bool(NON_WIN_PREFIX_RE.match(clause))
        clause_seasons = _extract_seasons(NON_WIN_PREFIX_RE.sub("", clause).lstrip(": "))
        if is_ru or entirely_runner_up:
            runner_up_seasons += clause_seasons
        else:
            won_seasons += clause_seasons
    if entirely_runner_up:
        runner_up_seasons += won_seasons
        won_seasons = []

    return {
        "target": target, "display": display,
        "wonSeasons": won_seasons, "runnerUpSeasons": runner_up_seasons,
    }


def parse_wiki_honours(wikitext):
    """
    -> [{"group": "Manchester City", "entries": [{"target","display","wonSeasons","runnerUpSeasons"}, ...]}, ...]
    "Individual"(대소문자 무관, "Individual honours"/"Individual awards" 등도 포함) 그룹은
    이후 분류 단계(build_dataset.py)에서 개인 수상으로 취급된다.
    """
    hm = HONOURS_HEADING_RE.search(wikitext)
    if not hm:
        return []
    start = hm.end()
    next_heading = re.search(r"^==[^=].*?==\s*$", wikitext[start:], re.M)
    section = wikitext[start: start + next_heading.start() if next_heading else len(wikitext)]

    heading_matches = list(PRIMARY_GROUP_RE.finditer(section))
    if not heading_matches:
        # 굵은 제목/소제목이 아예 없고 ;로만 그룹을 나눈 문서(예: 파트리크 셰이크) - 이때만
        # ;를 최상위 구분자로 쓴다. 굵은 제목이 하나라도 있으면 ;는 그 밑의 세부 항목일
        # 뿐이라(예: 모드리치의 '''Individual''' 아래 ";Major awards") 건드리지 않는다.
        heading_matches = list(SEMICOLON_GROUP_RE.finditer(section))

    groups = []
    for i, gm in enumerate(heading_matches):
        groups_found = [g for g in gm.groups() if g]
        group_name = _clean_inline(groups_found[0]) if groups_found else ""
        if not group_name:
            continue
        block_start = gm.end()
        block_end = heading_matches[i + 1].start() if i + 1 < len(heading_matches) else len(section)
        block = section[block_start:block_end]
        entries = []
        for bm in BULLET_RE.finditer(block):
            parsed = _parse_bullet(bm.group(1))
            if parsed and (parsed["wonSeasons"] or parsed["runnerUpSeasons"]):
                entries.append(parsed)
        if entries:
            groups.append({"group": group_name, "entries": entries})
    return groups


def fetch_and_parse_honours(wiki_title):
    wikitext = wiki_get_wikitext(wiki_title)
    if not wikitext:
        return None
    return parse_wiki_honours(wikitext)
