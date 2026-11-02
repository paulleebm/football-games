# 유사도 맞히기(게임3) 데이터 설계

## 소스: FotMob (Transfermarkt 아님)

기존 게임1(선수 맞추기)의 딥스크랩 방식(TM 프로필+트로피+이적+국대 4~5페이지/선수)은
1000명 이상 규모에 못 씀 — 요청 수 폭증 + TM 차단 위험. FotMob은 선수 1명당 요청 1번으로
프로필+커리어 전체+트로피(국가대표 포함)가 다 나와서 대량 수집에 적합.

인증/헤더 불필요, 브라우저로 실사용 검증 완료 (2026-09-07).

### 엔드포인트 3종
1. `GET fotmob.com/api/data/leagues?id={leagueId}` → `table[].data.table.all[]`: 리그 소속 전 클럽(id, name)
   - 5대리그 ID: Premier League=47, LaLiga=87, Bundesliga=54, Serie A=55, Ligue 1=53
2. `GET fotmob.com/api/data/teams?id={clubId}` → `squad.squad[]` (그룹별, "coach" 그룹 제외):
   `members[]`: id, name, shirtNumber, ccode/cname(국적), positionIdsDesc, height, age, dateOfBirth, transferValue
3. `GET fotmob.com/api/data/playerData?id={playerId}` →
   - `playerInformation[]`: height, shirt, age, preferred foot, country, market value, contract end
     (파싱은 `translationKey` 기준: height_sentencecase/shirt/age_sentencecase/preferred_foot/country_sentencecase/transfer_value/contract_end)
   - `careerHistory.careerItems.senior.teamEntries[]`: {teamId, team, startDate, endDate, active, appearances, goals, assists}
   - `trophies.playerTrophies[]`: {ccode, teamId, teamName, tournaments:[{leagueId, leagueName, seasonsWon[], seasonsRunnerUp[]}]}
     - 국가대표 항목도 여기 포함됨 (teamName="Argentina" 식). `leagueName === "World Cup"` && `seasonsWon.length>0` 로 월드컵 우승 여부 직접 판별 가능 (에밀리아노 마르티네스로 검증: 2022 Qatar 우승 확인됨)
   - `positionDescription.primaryPosition`, `primaryTeam`, `birthDate`, `contractEnd`

## 수집 파이프라인 (`crawler/oxgame_fetch_pool.py`)
1. 리그 5개 → 클럽 목록 (`crawler/data/oxgame_clubs.json`, ~96개 클럽)
2. 클럽별 스쿼드 (`crawler/data/oxgame_squads/{clubId}.json`) → 전체 합쳐서 중복 제거
   (임대 등으로 여러 스쿼드에 등장 시 시장가치 높은 쪽 채택) → `crawler/data/oxgame_squad_index.json`
3. 고유 선수별 상세 (`crawler/data/oxgame_raw/{playerId}.json`) — 이미 있으면 스킵(재개 가능)

예상 규모: 96클럽 × 평균 ~25명 ≈ 2,300행 → 중복 제거 후 **2,000~2,400명** 예상.
요청 총량 ~2,400회, 예의상 딜레이(1.4~2.4초) 적용 시 **약 1~1.5시간**.

## 수집 가능한 필드/카테고리

| 카테고리 | 데이터 소스 |
|---|---|
| 포지션 (GK/DF/MF/FW, 세부 포지션) | squad.positionIdsDesc / playerData.positionDescription |
| 주발 | playerData.playerInformation (preferred_foot) |
| 국적 / 대륙 | squad.ccode/cname |
| 현재 소속 리그 (5대리그 중) | squad.leagueName |
| 현재 소속 클럽 | primaryTeam |
| **커리어상 특정 리그 소속 경험** (예: EPL+라리가 둘 다 뛰어봄) | careerHistory 팀ID를 오늘 수집한 클럽→리그 맵(대리그 96개)에 매칭. 맵 밖 클럽은 "기타"로 처리 |
| 출생연도/나이 구간 | dateOfBirth |
| 신장 구간 | height |
| 시장가치 구간 | transferValue / market value |
| 등번호 구간 | shirtNumber |
| 계약만료 연도 구간 | contractEnd |
| **월드컵 우승 경험** | trophies.playerTrophies (국가대표 항목, leagueName="World Cup") |
| **대륙컵 우승 경험** (유로/코파아메리카/아프리카네이션스컵 등) | 동일 trophies, leagueName 매칭 |
| **UEFA 챔피언스리그 우승 경험** | trophies (클럽 항목, leagueName="Champions League") |
| **자국리그 우승 경험** | trophies (클럽 항목, leagueName이 소속 시절 리그와 일치 + seasonsWon) |
| 유로파리그 우승 경험 | trophies, leagueName="Europa League" |

FotMob 덕분에 트로피 기반 기준도 전체 풀(2000명+)에 적용 가능해짐 — 기존 TM 기반 계획(게임1의
206명 딥데이터 풀에서만 가능)보다 크게 확장됨.

## 표기 방침
FotMob에서 받은 이름은 전부 영어/원어 원문(예: "Erling Haaland", "Ísak Jóhannesson") —
한국어 표기 없음. 2,000명대 규모라 게임1(`players.py`)처럼 선수별 한글 표기를 수작업으로
매핑하는 건 비현실적 → **화면에는 영어 원문 그대로 노출하기로 확정** (2026-09-08).
검색/제출도 영어 기준으로만 동작.

## 다음 단계 (수집 완료 후) — 완료됨
- `crawler/build_oxgame_dataset.py`로 `public/data/oxgame_players.json` (2,760명) 빌드 완료
- 별도 검색 인덱스 없이 `oxgame_players.json` 자체를 클라이언트에서 필터링 (2,760건은 그냥 다 보내도 가벼움)
