# 데이터 스키마 & 힌트 템플릿 설계

## Firestore 레이아웃 (신규 컬렉션, 기존 `players`/`teamSeasons`와 충돌 없음)

```
guessPlayers/{playerId}
  profile: {
    nameKo, nameEn, aliases: string[],   // 정답 매칭용 (오타/별칭 포함)
    photoUrl, dob, birthYear,
    nationality, nationalityKo,
    position,               // GK/DF/MF/FW
    foot,                   // left/right/both
    heightCm
  }
  career: [                              // 시니어 클럽 이력만, 연도순
    { teamId, teamName, country, league, tier, seasonStart, seasonEnd,
      type: 'senior'|'loan', appearances, goals, assists }
  ]
  clubHonours: [
    { teamId, competition, count, seasons: string[] }  // 예: {클럽, "리그", 3, [...]}
  ]
  individualHonours: [
    { title, season, note? }             // 득점왕, 올해의 선수, 발롱도르 순위 등
  ]
  nationalTeam: {
    country, debutYear, caps, goals, assists,
    captain: boolean, captainSince?,
    tournaments: [{ name, year, result }]  // 월드컵/대륙컵 출전 이력
  }
  careerStats: {
    clubAppearances, clubGoals, clubAssists,
    bestSeason: { season, league, goals, assists }
  }
  teammateLinks: [                        // 90인 풀 내부, 교차 검증된 richer 데이터
    { playerId, sharedTeamId, sharedTeamName, seasons: string[] }
  ]
  notableTeammates: [                     // 90인 풀 밖이라도 유명한 동료 (클럽 스쿼드 페이지에서 파생)
    { name, teamId, teamName, season, position, nationality, marketValueEUR? }
  ]
  raw: { ... }                            // 크롤러가 긁은 원본 스크랩 필드 전부 보존 (아래 "최대 수집" 원칙 참고)
  meta: { crawledAt, sourceUrl }
```

```
guessDailyPuzzle/{YYYY-MM-DD}
  playerId   // guessPlayers 문서 참조, KST 자정 기준 고정 시드로 선정, 최근 N일 중복 방지

guessLeaderboard/{mode}/entries/{deviceId}
  nickname, hintsUsed, updatedAt   // 기존 leaderboard 규칙과 동일한 "자기 최고 기록 갱신 시에만 쓰기" 룰 적용
```

## 힌트 카테고리 → 데이터 필드 매핑 (4단계 점진 공개)

| 카테고리 | 1단계 (넓음) | 2단계 | 3단계 | 4단계 (구체적) |
|---|---|---|---|---|
| 프로필 | 출생 연대 (예: 1990년대생) | 대륙 (유럽/남미/아시아 등) | 포지션 + 주발 | 신장 구간 |
| 커리어 | 자국리그 데뷔 여부 | 뛴 리그 개수(5대리그 중 N개) | 리그명 조합(예: 독일→잉글랜드) | 특정 클럽 체류 시즌 수 |
| 클럽 | 소속 리그 티어/연고 도시 특징 | UCL 우승 클럽 소속 여부 | 소속 리그 수(2곳 이상 등) | 구체적 클럽명 |
| 동료 | (동일 풀 내) 포지션군 동료 존재 여부 | 동료 국적 힌트 | 동료 이름 1명 공개 | 동료 이름 추가 공개 |
| 국가대표 | 대회 출전 여부(월드컵/대륙컵) | A매치 캡스 구간(50+/100+) | 주장 경험 여부 | 정확한 국적 |
| 업적 | 우승 경험 유무(팀 단위) | 리그 우승 구간(1회/다회) | 개인 수상 유무 | 구체적 수상명 |
| 기록 | 통산 출전 구간(200+/300+) | 통산 골 구간 | 한 시즌 20골 이상 여부 | 구체적 골/도움 수치 구간 |

- 카테고리별 1단계 정보량은 최대한 비슷하게 (프로필만 찍는 플레이 방지).
- 동일 카테고리를 다시 클릭하면 다음 단계로 진행. 각 클릭 = 힌트 1개로 동일 계산.
- 템플릿은 클라이언트에서 구조화 데이터로부터 문장을 조합 (선수별 수작업 문장 없음).

## 크롤러가 새로 수집해야 하는 것 (기존 tm_crawler에는 없음)
- 개인 수상/트로피 (Transfermarkt "Trophies" 섹션)
- 국가대표 A매치 caps/goals, 주장 여부, 메이저 대회 출전 이력 (National team 섹션)
- 커리어 통산 스탯 (goals/assists/appearances, 시즌별 "Performance" 테이블)
- 신장/주발 (프로필 상단 정보)
- 90인 풀 내부 동료 관계는 career 배열 교차 매칭으로 파생 (별도 크롤링 불필요)
- **90인 풀 밖의 유명 동료**: 각 선수가 거친 모든 클럽·시즌의 스쿼드 페이지를 함께 크롤링해서, 시장가치 상위권 등 "유명한" 동료를 `notableTeammates`로 저장. 예: 90인 풀에 없는 벤제마·라모스·네이마르(포함이면 제외)라도 "이 선수는 벤제마와 레알 마드리드에서 함께 뛰었다" 같은 힌트를 만들 수 있게 함.

## 최대 수집 원칙
힌트 카테고리/단계 기준이 나중에 바뀔 수 있으므로, 스키마에 정의된 필드로 가공하기 전에 **크롤러가 확보 가능한 원본 정보는 전부 저장**한다 (`raw` 필드).
구체적으로 페이지당 다음을 전부 긁어서 보존:
- 프로필 전체 (성명 전체/발음, 생년월일, 출생지, 국적 복수 여부, 신장, 주발, 등번호, 에이전트, 현재 시장가치 및 시장가치 변동 이력)
- 이적 이력 전체 (이적료, 이적 방식(완전/임대), 계약 기간)
- 시즌별 전 대회 스탯 (리그/컵/유럽대항전/국가대표 각각 출전·선발·교체·골·도움·경고·퇴장·평균 출전시간)
- 부상 이력 (있다면), 주장 완장 이력(클럽/대표팀)
- 트로피/수상 전체 목록 (팀 단위 + 개인 단위, 연도 포함)
- 국가대표 데뷔전 정보, 메이저 대회(월드컵/대륙컵)별 출전·골 세부 기록
이렇게 하면 힌트 단계 기준이 바뀌어도 재크롤링 없이 `raw` → 새 파생 필드 재가공만으로 대응 가능.
