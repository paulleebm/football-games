# 커리어 힌트 생성에 필요한 클럽 -> 국가/리그 매핑.
# 90인 풀 선수들의 커리어에 실제로 등장할 법한 주요 클럽 위주로 정리.
# 여기 없는 클럽은 국가/리그 없이 클럽명만 힌트에 사용 (동작은 하되 정보량이 줄어듦).

BIG5 = {"Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"}

CLUB_INFO = {
    # England
    "Manchester City": ("England", "Premier League"), "Manchester United": ("England", "Premier League"),
    "Liverpool": ("England", "Premier League"), "Chelsea": ("England", "Premier League"),
    "Arsenal": ("England", "Premier League"), "Tottenham Hotspur": ("England", "Premier League"),
    "Newcastle United": ("England", "Premier League"), "Aston Villa": ("England", "Premier League"),
    "Brighton & Hove Albion": ("England", "Premier League"), "West Ham United": ("England", "Premier League"),
    "Everton": ("England", "Premier League"), "Leicester City": ("England", "Premier League"),
    "Southampton": ("England", "Premier League"), "Brentford": ("England", "Premier League"),
    "Nottingham Forest": ("England", "Premier League"), "Wolverhampton Wanderers": ("England", "Premier League"),
    "Fulham": ("England", "Premier League"), "Crystal Palace": ("England", "Premier League"),
    "Bournemouth": ("England", "Premier League"), "Leeds United": ("England", "Premier League"),
    "Burnley": ("England", "Premier League"), "Sunderland": ("England", "Premier League"),
    "Hamburger SV": ("Germany", "Bundesliga"),

    # Spain
    "Real Madrid": ("Spain", "La Liga"), "Barcelona": ("Spain", "La Liga"),
    "Atletico Madrid": ("Spain", "La Liga"), "Sevilla": ("Spain", "La Liga"),
    "Real Sociedad": ("Spain", "La Liga"), "Villarreal": ("Spain", "La Liga"),
    "Real Betis": ("Spain", "La Liga"), "Athletic Bilbao": ("Spain", "La Liga"),
    "Valencia": ("Spain", "La Liga"), "Girona": ("Spain", "La Liga"), "Celta Vigo": ("Spain", "La Liga"),
    "Deportivo La Coruña": ("Spain", "La Liga 2"),
    "Leganés": ("Spain", "La Liga 2"),

    # Germany
    "Bayern Munich": ("Germany", "Bundesliga"), "Borussia Dortmund": ("Germany", "Bundesliga"),
    "RB Leipzig": ("Germany", "Bundesliga"), "Bayer Leverkusen": ("Germany", "Bundesliga"),
    "Eintracht Frankfurt": ("Germany", "Bundesliga"), "Wolfsburg": ("Germany", "Bundesliga"),
    "Borussia Monchengladbach": ("Germany", "Bundesliga"), "Schalke 04": ("Germany", "Bundesliga"),
    "VfB Stuttgart": ("Germany", "Bundesliga"), "Hoffenheim": ("Germany", "Bundesliga"),
    "Werder Bremen": ("Germany", "Bundesliga"),

    # Italy
    "Juventus": ("Italy", "Serie A"), "Inter Milan": ("Italy", "Serie A"), "AC Milan": ("Italy", "Serie A"),
    "Napoli": ("Italy", "Serie A"), "AS Roma": ("Italy", "Serie A"), "Lazio": ("Italy", "Serie A"),
    "Atalanta": ("Italy", "Serie A"), "Fiorentina": ("Italy", "Serie A"), "Torino": ("Italy", "Serie A"),
    "Parma": ("Italy", "Serie A"), "Como": ("Italy", "Serie A"), "Bologna": ("Italy", "Serie A"),

    # France
    "Paris Saint-Germain": ("France", "Ligue 1"), "AS Monaco": ("France", "Ligue 1"),
    "Olympique Lyonnais": ("France", "Ligue 1"), "Olympique de Marseille": ("France", "Ligue 1"),
    "Lille": ("France", "Ligue 1"), "Rennes": ("France", "Ligue 1"), "Nice": ("France", "Ligue 1"),

    # Portugal / Netherlands
    "Porto": ("Portugal", "Primeira Liga"), "Benfica": ("Portugal", "Primeira Liga"),
    "Sporting CP": ("Portugal", "Primeira Liga"),
    "Ajax": ("Netherlands", "Eredivisie"), "PSV Eindhoven": ("Netherlands", "Eredivisie"),
    "Feyenoord": ("Netherlands", "Eredivisie"),

    # Others (senior stints that show up for this pool)
    "Fenerbahce": ("Turkey", "Super Lig"), "Galatasaray": ("Turkey", "Super Lig"),
    "Trabzonspor": ("Turkey", "Super Lig"), "Beşiktaş": ("Turkey", "Super Lig"),
    "Al-Hilal": ("Saudi Arabia", "Saudi Pro League"), "Al-Nassr": ("Saudi Arabia", "Saudi Pro League"),
    "Al-Ittihad": ("Saudi Arabia", "Saudi Pro League"), "Al-Ahli": ("Saudi Arabia", "Saudi Pro League"),
    "Al-Diriyah": ("Saudi Arabia", "Saudi Pro League"), "Neom": ("Saudi Arabia", "Saudi Pro League"),
    "Al-Shabab": ("Saudi Arabia", "Saudi Pro League"),
    "Inter Miami CF": ("United States", "MLS"), "LAFC": ("United States", "MLS"),
    "Los Angeles FC": ("United States", "MLS"), "Orlando City": ("United States", "MLS"),
    "Chicago Fire": ("United States", "MLS"), "San Jose Earthquakes": ("United States", "MLS"),
    "Union SG": ("Belgium", "Belgian Pro League"), "Club Brugge": ("Belgium", "Belgian Pro League"),
    "Santos": ("Brazil", "Brasileirao"), "Flamengo": ("Brazil", "Brasileirao"),
    "Boca Juniors": ("Argentina", "Primera Division"), "River Plate": ("Argentina", "Primera Division"),
    "FC Red Bull Salzburg": ("Austria", "Austrian Bundesliga"), "Molde": ("Norway", "Eliteserien"),
    "Bryne": ("Norway", "Norwegian First Division"), "Kawasaki Frontale": ("Japan", "J1 League"),
    "FC Seoul": ("South Korea", "K League 1"), "Jeonbuk Hyundai Motors": ("South Korea", "K League 1"),
}

COUNTRY_KO = {
    "England": "잉글랜드", "Spain": "스페인", "Germany": "독일", "Italy": "이탈리아", "France": "프랑스",
    "Portugal": "포르투갈", "Netherlands": "네덜란드", "Turkey": "튀르키예", "Türkiye": "튀르키예",
    "Saudi Arabia": "사우디아라비아",
    "United States": "미국", "Brazil": "브라질", "Argentina": "아르헨티나", "Austria": "오스트리아",
    "Norway": "노르웨이", "Japan": "일본", "South Korea": "대한민국", "Scotland": "스코틀랜드",
    "Belgium": "벨기에", "Croatia": "크로아티아", "Poland": "폴란드", "Egypt": "이집트", "Morocco": "모로코",
    "Senegal": "세네갈", "Nigeria": "나이지리아", "Ghana": "가나", "Cameroon": "카메룬",
    "Georgia": "조지아", "Sweden": "스웨덴", "Denmark": "덴마크", "Uruguay": "우루과이",
    "Colombia": "콜롬비아", "Cote d'Ivoire": "코트디부아르", "Ivory Coast": "코트디부아르",
    "Serbia": "세르비아", "Slovenia": "슬로베니아",
    "Switzerland": "스위스", "Wales": "웨일스", "Canada": "캐나다", "Mexico": "멕시코",
    "Guinea": "기니", "Mali": "말리", "Algeria": "알제리", "Tunisia": "튀니지",
    # 이전엔 CONTINENT/COUNTRY_KO에 없어서 "continent: None"으로 빠졌던 국적들
    "Ecuador": "에콰도르", "Hungary": "헝가리", "Czech Republic": "체코", "Ukraine": "우크라이나",
}

CONTINENT = {
    "England": "유럽", "Spain": "유럽", "Germany": "유럽", "Italy": "유럽", "France": "유럽",
    "Portugal": "유럽", "Netherlands": "유럽", "Turkey": "유럽", "Türkiye": "유럽", "Austria": "유럽", "Norway": "유럽",
    "Scotland": "유럽", "Belgium": "유럽", "Croatia": "유럽", "Poland": "유럽", "Georgia": "유럽",
    "Sweden": "유럽", "Denmark": "유럽", "Serbia": "유럽", "Slovenia": "유럽", "Switzerland": "유럽",
    "Wales": "유럽", "Hungary": "유럽", "Czech Republic": "유럽", "Ukraine": "유럽",
    "Saudi Arabia": "아시아", "Japan": "아시아", "South Korea": "아시아",
    "United States": "북미", "Canada": "북미", "Mexico": "북미",
    "Brazil": "남미", "Argentina": "남미", "Uruguay": "남미", "Colombia": "남미", "Ecuador": "남미",
    "Egypt": "아프리카", "Morocco": "아프리카", "Senegal": "아프리카", "Nigeria": "아프리카",
    "Ghana": "아프리카", "Cameroon": "아프리카", "Cote d'Ivoire": "아프리카", "Ivory Coast": "아프리카",
    "Guinea": "아프리카", "Mali": "아프리카", "Algeria": "아프리카", "Tunisia": "아프리카",
}
