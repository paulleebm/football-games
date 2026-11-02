// 클럽별 선수단 (2026-27 시즌, 2026년 10월 기준). 골키퍼 1명 + 필드 5~6명.
// 경기에는 4명이 나간다 (골키퍼 자리 + 필드 3자리, 어느 자리에 누구를 세워도 된다). start = 기본 필드 선발 (formation 슬롯 a, b, c 순서).
//
// 생김새: 피부톤, 머리 모양/색, 수염, 등번호로만 흉내낸다 (경기 화면에 이름은 띄우지 않는다).
//   hair: short | buzz | bald | swept(앞머리 올림) | curly | afro | bun(묶은 머리) | long | twists
//   beard: none | stubble(수염 자국) | full
// 능력치: 1~10. 밸런스보다 선수 특징이 드러나는 쪽으로 과장했다.
// 골키퍼는 받침이 커서 스피드·몸싸움을 낮게 두고, 슈팅은 평균 이상(6~)으로 둔다.
//   spd 스피드(미끄러지는 거리) / sht 슈팅(공을 칠 때 추가 힘) / phy 몸싸움(무게)
//   sav 선방(골키퍼만, 받침 원판 크기)

import { FORMATIONS } from "./physics.js";

const SKIN = {
  pale: "#f6d5bd",
  light: "#ecc39f",
  tan: "#d6a47a",
  olive: "#b98058",
  brown: "#8a5636",
  dark: "#5b3823",
};

const HAIR = {
  black: "#151110",
  dark: "#2e1f16",
  brown: "#5a3a22",
  light: "#8c6439",
  blond: "#dcbc72",
};

// [id, 이름, 등번호, 포지션, 피부, 머리, 머리색, 수염, 스피드, 슈팅, 몸싸움, 선방, 한 줄 특징, (받침 모양 각 수)]
// 받침 모양은 보통 슈팅으로 정해지고, 특별히 정한 선수만 마지막 칸에 적는다.
function squad(rows, start) {
  const players = rows.map(([id, name, num, pos, skin, hair, hairColor, beard, spd, sht, phy, sav, tag, sides]) => ({
    id, name, num, pos, tag,
    skin: SKIN[skin], hair, hairColor: HAIR[hairColor], beard,
    stats: { ...(pos === "GK" ? { sav, spd, sht, phy } : { spd, sht, phy }), ...(sides != null ? { sides } : {}) },
  }));
  return { players, start };
}

export const SQUADS = {
  mci: squad([
    ["donnarumma", "돈나룸마", 1, "GK", "light", "short", "dark", "stubble", 2, 6, 6, 9, "2m 거인 수문장"],
    ["gvardiol", "그바르디올", 24, "DF", "pale", "buzz", "light", "none", 6, 4, 9, 0, "공격하는 센터백"],
    ["enzo", "엔소", 17, "MF", "tan", "short", "dark", "stubble", 5, 8, 5, 0, "중거리 대포"],
    ["foden", "포든", 47, "MF", "pale", "buzz", "brown", "none", 7, 8, 3, 0, "왼발 마법사"],
    ["cherki", "셰르키", 10, "MF", "olive", "curly", "black", "none", 6, 9, 2, 0, "양발 테크니션"],
    ["doku", "도쿠", 11, "FW", "dark", "buzz", "black", "none", 10, 5, 4, 0, "드리블 폭주기관차"],
    ["haaland", "홀란", 9, "FW", "pale", "bun", "blond", "none", 6, 10, 9, 0, "괴물 스트라이커"],
  ], ["gvardiol", "foden", "haaland"]),
  mun: squad([
    ["lammens", "라먼스", 1, "GK", "pale", "short", "light", "none", 4, 6, 3, 7, "신예 넘버원"],
    ["lisandro", "리산드로", 6, "DF", "tan", "bun", "dark", "stubble", 5, 3, 9, 0, "작은 도살자"],
    ["mainoo", "마이누", 37, "MF", "brown", "buzz", "black", "none", 6, 5, 7, 0, "탈압박 장인"],
    ["bruno", "브루노", 8, "MF", "tan", "short", "black", "stubble", 6, 9, 5, 0, "캡틴 킬패스"],
    ["cunha", "쿠냐", 10, "FW", "tan", "curly", "black", "stubble", 7, 8, 6, 0, "저돌적인 10번"],
    ["mbeumo", "음뵈모", 19, "FW", "dark", "buzz", "black", "full", 8, 9, 4, 0, "왼발 피니셔"],
    ["sesko", "셰슈코", 30, "FW", "pale", "short", "dark", "none", 8, 7, 9, 0, "195cm 스프린터"],
  ], ["lisandro", "bruno", "mbeumo"]),
  liv: squad([
    ["alisson", "알리송", 1, "GK", "light", "short", "dark", "full", 3, 6, 4, 10, "통곡의 벽"],
    ["vandijk", "반 다이크", 4, "DF", "brown", "buzz", "black", "full", 5, 4, 10, 0, "철벽 캡틴"],
    ["szoboszlai", "소보슬라이", 8, "MF", "pale", "swept", "blond", "none", 7, 9, 6, 0, "무회전 대포"],
    ["wirtz", "비르츠", 7, "MF", "pale", "swept", "brown", "none", 6, 8, 3, 0, "천재 플레이메이커"],
    ["barcola", "바르콜라", 29, "FW", "brown", "curly", "black", "none", 10, 6, 3, 0, "측면 총알"],
    ["isak", "이삭", 9, "FW", "brown", "twists", "black", "none", 8, 9, 5, 0, "우아한 골잡이"],
    ["ekitike", "에키티케", 22, "FW", "brown", "buzz", "black", "none", 9, 7, 5, 0, "뒷공간 침투"],
  ], ["vandijk", "wirtz", "isak"]),
  che: squad([
    ["emiliano", "에밀리아노", 1, "GK", "tan", "short", "dark", "full", 3, 6, 5, 9, "승부차기 장인"],
    ["james", "리스 제임스", 24, "DF", "brown", "buzz", "black", "stubble", 6, 8, 8, 0, "캐논 크로스"],
    ["caicedo", "카이세도", 25, "MF", "brown", "buzz", "black", "stubble", 7, 3, 9, 0, "중원 청소기"],
    ["palmer", "파머", 10, "MF", "pale", "swept", "light", "none", 5, 10, 3, 0, "콜드 피니셔"],
    ["rogers", "모건 로저스", 17, "MF", "brown", "buzz", "black", "none", 8, 7, 8, 0, "파워 드리블러"],
    ["estevao", "이스테방", 41, "FW", "olive", "curly", "black", "none", 9, 8, 2, 0, "브라질 신성"],
    ["joaopedro", "주앙 페드루", 9, "FW", "tan", "curly", "black", "none", 7, 9, 5, 0, "곡예 슈터"],
  ], ["caicedo", "palmer", "joaopedro"]),
  ars: squad([
    ["raya", "라야", 1, "GK", "light", "short", "black", "full", 4, 9, 2, 10, "현역 최고 수문장"],
    ["saliba", "살리바", 2, "DF", "dark", "buzz", "black", "none", 8, 4, 9, 0, "빠른 벽"],
    ["rice", "라이스", 41, "MF", "pale", "short", "brown", "none", 7, 8, 8, 0, "세트피스 대포"],
    ["odegaard", "외데고르", 8, "MF", "pale", "swept", "dark", "none", 6, 9, 3, 0, "주장 지휘자"],
    ["eze", "에제", 10, "MF", "brown", "twists", "black", "none", 7, 9, 3, 0, "감아차기 마법"],
    ["saka", "사카", 7, "FW", "dark", "buzz", "black", "none", 9, 8, 4, 0, "스타보이"],
    ["gyokeres", "요케레스", 14, "FW", "pale", "long", "light", "stubble", 7, 9, 10, 0, "불도저", 3],
  ], ["saliba", "rice", "saka"]),
  tot: squad([
    ["kinsky", "킨스키", 31, "GK", "pale", "short", "brown", "none", 5, 6, 2, 7, "젊은 장신 키퍼"],
    ["vandeven", "반 더 벤", 37, "DF", "pale", "short", "blond", "none", 10, 3, 8, 0, "리그 최고 속도 수비수"],
    ["robertson", "로버트슨", 3, "DF", "pale", "short", "brown", "stubble", 7, 5, 6, 0, "투혼의 풀백"],
    ["porro", "포로", 23, "DF", "light", "short", "dark", "stubble", 7, 8, 5, 0, "공격형 윙백"],
    ["tonali", "토날리", 16, "MF", "pale", "long", "dark", "full", 6, 7, 8, 0, "투쟁심 미드필더"],
    ["kudus", "쿠두스", 20, "FW", "dark", "buzz", "black", "stubble", 8, 7, 7, 0, "춤추는 드리블"],
    ["solanke", "솔란케", 19, "FW", "brown", "buzz", "black", "stubble", 6, 8, 8, 0, "등지는 스트라이커"],
  ], ["vandeven", "tonali", "solanke"]),
  bar: squad([
    ["joangarcia", "주안 가르시아", 1, "GK", "pale", "short", "dark", "none", 5, 6, 2, 9, "반사신경 괴물"],
    ["cubarsi", "쿠바르시", 5, "DF", "pale", "short", "dark", "none", 6, 4, 8, 0, "10대 철벽"],
    ["rodri", "로드리", 16, "MF", "light", "short", "dark", "stubble", 4, 7, 9, 0, "중원 사령관"],
    ["pedri", "페드리", 8, "MF", "light", "swept", "black", "none", 7, 7, 3, 0, "볼 마술사"],
    ["raphinha", "하피냐", 11, "FW", "tan", "long", "black", "stubble", 8, 9, 4, 0, "왼발 캐넌"],
    ["yamal", "야말", 10, "FW", "olive", "curly", "black", "none", 9, 9, 2, 0, "축구 천재"],
    ["gordon", "고든", 17, "FW", "pale", "short", "brown", "none", 9, 6, 5, 0, "직선 질주"],
  ], ["rodri", "raphinha", "yamal"]),
  rma: squad([
    ["courtois", "쿠르투아", 1, "GK", "pale", "short", "dark", "stubble", 2, 6, 5, 10, "2m 장벽"],
    ["trent", "트렌트", 12, "DF", "olive", "buzz", "black", "none", 6, 9, 4, 0, "택배 크로스"],
    ["valverde", "발베르데", 8, "MF", "light", "short", "dark", "stubble", 9, 8, 8, 0, "지치지 않는 엔진"],
    ["bellingham", "벨링엄", 5, "MF", "olive", "buzz", "black", "none", 6, 9, 7, 0, "결정적 한 방"],
    ["vinicius", "비니시우스", 7, "FW", "brown", "twists", "black", "none", 10, 7, 3, 0, "번개 드리블"],
    ["mbappe", "음바페", 10, "FW", "brown", "bald", "black", "none", 10, 10, 5, 0, "총알 피니셔"],
    ["diomande", "디오망데", 25, "FW", "dark", "curly", "black", "none", 9, 6, 5, 0, "신성 윙어"],
  ], ["valverde", "vinicius", "mbappe"]),
  psg: squad([
    ["chevalier", "슈발리에", 30, "GK", "pale", "short", "brown", "none", 4, 6, 2, 8, "발밑 좋은 키퍼"],
    ["marquinhos", "마르퀴뇨스", 5, "DF", "light", "short", "dark", "full", 6, 4, 8, 0, "노련한 캡틴"],
    ["hakimi", "하키미", 2, "DF", "tan", "curly", "black", "stubble", 10, 7, 6, 0, "총알 풀백"],
    ["vitinha", "비티냐", 17, "MF", "light", "short", "dark", "none", 7, 7, 3, 0, "작은 사령탑"],
    ["kvara", "크바라", 7, "FW", "pale", "long", "brown", "none", 8, 8, 5, 0, "크바라도나"],
    ["dembele", "뎀벨레", 10, "FW", "dark", "buzz", "black", "stubble", 9, 9, 3, 0, "양발 발롱도르"],
    ["doue", "두에", 14, "FW", "brown", "buzz", "black", "none", 8, 7, 6, 0, "결승전 사나이"],
  ], ["marquinhos", "kvara", "dembele"]),
};

export function playerById(clubId, pid) {
  return SQUADS[clubId].players.find((p) => p.id === pid);
}

export function goalkeepers(clubId) {
  return SQUADS[clubId].players.filter((p) => p.pos === "GK");
}

export function defaultLineup(clubId) {
  const sq = SQUADS[clubId];
  const [a, b, c] = sq.start;
  return { formation: "attack", gk: goalkeepers(clubId)[0].id, a, b, c };
}

// 저장된 라인업이 선수단 변경 등으로 깨졌으면 기본값으로 되돌린다
export function validLineup(clubId, lu) {
  const sq = SQUADS[clubId];
  if (!lu) return defaultLineup(clubId);
  // 골키퍼 자리에도 필드 선수를 세울 수 있고, 골키퍼를 필드에 두거나 아예 빼도 된다
  const ids = [lu.gk, lu.a, lu.b, lu.c];
  // 없어진 포메이션이면 선수는 그대로 두고 포메이션만 기본값으로
  if (!FORMATIONS[lu.formation]) lu = { ...lu, formation: "attack" };
  const ok = ids.every((id) => sq.players.some((p) => p.id === id)) && new Set(ids).size === 4;
  return ok ? lu : defaultLineup(clubId);
}

export const STAT_LABELS = { sav: "선방", spd: "스피드", sht: "슈팅", phy: "몸싸움" };
