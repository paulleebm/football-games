// 고를 수 있는 클럽: 빅6 + 바르셀로나, 레알 마드리드, PSG (영문 이름 abc 순). 로고는 블랙잭 게임 것을 같이 쓴다.
// body = 상의, stripes/band = 무늬, trim = 번호/밑단. 받침 원판은 상의 색을 따라간다.
// 원정 유니폼은 온라인에서 상대와 색이 겹칠 때만 쓴다 (각자 자기 팀은 항상 홈 유니폼으로 보인다).

export const CLUBS = [
  { id: "ars", name: "아스날", logo: 9825, home: { body: "#EF0107", trim: "#ffffff", sleeves: "#ffffff" }, away: { body: "#F5C400", trim: "#063672", number: "#063672" } },
  { id: "bar", name: "바르셀로나", logo: 8634, home: { body: "#A50044", stripes: "#004D98", trim: "#EDBB00", number: "#EDBB00" }, away: { body: "#EDBB00", trim: "#A50044", number: "#A50044" } },
  { id: "che", name: "첼시", logo: 8455, home: { body: "#034694", trim: "#ffffff" }, away: { body: "#FFD100", trim: "#034694", number: "#034694" } },
  { id: "liv", name: "리버풀", logo: 8650, home: { body: "#C8102E", trim: "#F6EB61" }, away: { body: "#f2f2f2", trim: "#00B2A9", number: "#00B2A9" } },
  { id: "mci", name: "맨시티", logo: 8456, home: { body: "#6CABDD", trim: "#ffffff" }, away: { body: "#1C2C5B", trim: "#6CABDD" } },
  { id: "mun", name: "맨유", logo: 10260, home: { body: "#DA291C", trim: "#ffffff" }, away: { body: "#f4f4f4", trim: "#DA291C", number: "#DA291C" } },
  { id: "psg", name: "PSG", logo: 9847, home: { body: "#004170", band: "#DA291C", bandEdge: "#ffffff", trim: "#ffffff" }, away: { body: "#f5f5f5", trim: "#004170", number: "#004170" } },
  { id: "rma", name: "레알 마드리드", logo: 8633, home: { body: "#f9f9f9", trim: "#FEBE10", number: "#c9a227" }, away: { body: "#3D195B", trim: "#FEBE10" } },
  { id: "tot", name: "토트넘", logo: 8586, home: { body: "#f7f7f7", trim: "#132257", number: "#132257" }, away: { body: "#132257", trim: "#ffffff" } },
];

const NEUTRAL = { body: "#2b2b2b", trim: "#ffd166" };

export function clubById(id) {
  return CLUBS.find((c) => c.id === id);
}

export function logoUrl(club) {
  return `../blackjack/logos/${club.logo}.png`;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 화면에서 눈에 띄는 대표색 (줄무늬면 두 색의 평균)
function mainColor(kit) {
  const a = rgb(kit.body);
  if (!kit.stripes) return a;
  const b = rgb(kit.stripes);
  return a.map((v, i) => (v + b[i]) / 2);
}

function clash(a, b) {
  const p = mainColor(a);
  const q = mainColor(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 120;
}

// CPU 상대: 내 유니폼과 색이 겹치지 않는 팀 중 랜덤
export function pickCpuClub(myId) {
  const my = clubById(myId);
  const pool = CLUBS.filter((c) => c.id !== myId && !clash(my.home, c.home));
  return pool[Math.floor(Math.random() * pool.length)];
}

// 내 화면에서 상대 팀이 입을 유니폼: 내 홈 유니폼과 겹치면 원정, 그것도 겹치면 검정
export function opponentKit(myId, oppId) {
  const my = clubById(myId).home;
  const opp = clubById(oppId);
  if (!clash(my, opp.home)) return opp.home;
  if (!clash(my, opp.away)) return opp.away;
  return NEUTRAL;
}
