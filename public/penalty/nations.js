// 월드컵 국가대표: 이름·유니폼·국기만 있다. 선수 구분은 없고, 경기마다 생김새와 등번호를
// 랜덤으로 뽑은 선수들이 그 나라 유니폼을 입고 나온다 (randomSquad).

const k = (body, shorts, socks, number, extra = {}) => ({ body, shorts, socks, number, ...extra });
const team = (id, name, kit) => ({ id, name, kit });

export const NATIONS = [
  team("kor", "대한민국", { home: k("#d6202a", "#111111", "#d6202a", "#ffffff"), away: k("#f4f4f4", "#111111", "#f4f4f4", "#d6202a"), gk: "#39d353" }),
  team("ksa", "사우디아라비아", { home: k("#0b7a3e", "#ffffff", "#0b7a3e", "#ffffff"), away: k("#f4f4f4", "#0b7a3e", "#f4f4f4", "#0b7a3e"), gk: "#ff8a00" }),
  team("gha", "가나", { home: k("#f4f4f4", "#111111", "#f4f4f4", "#111111"), away: k("#c8102e", "#ffd100", "#0b7a3e", "#ffffff"), gk: "#b26bff" }),
  team("aus", "호주", { home: k("#ffcd00", "#00843d", "#ffcd00", "#00843d"), away: k("#00843d", "#ffcd00", "#00843d", "#ffcd00"), gk: "#ff4fa3" }),
  team("can", "캐나다", { home: k("#d52b1e", "#d52b1e", "#d52b1e", "#ffffff"), away: k("#f4f4f4", "#f4f4f4", "#f4f4f4", "#d52b1e"), gk: "#39d3c4" }),
  team("usa", "미국", { home: k("#f4f4f4", "#1b2a5c", "#f4f4f4", "#1b2a5c"), away: k("#1b2a5c", "#1b2a5c", "#1b2a5c", "#ffffff"), gk: "#ff8a00" }),
  team("mex", "멕시코", { home: k("#006847", "#f4f4f4", "#c8102e", "#ffffff"), away: k("#f4f4f4", "#006847", "#f4f4f4", "#006847"), gk: "#ff4fa3" }),
  team("jpn", "일본", { home: k("#1d3b8f", "#f4f4f4", "#1d3b8f", "#ffffff"), away: k("#f4f4f4", "#1d3b8f", "#f4f4f4", "#1d3b8f"), gk: "#c0ff3e" }),
  team("mar", "모로코", { home: k("#c1272d", "#006233", "#c1272d", "#ffffff"), away: k("#f4f4f4", "#c1272d", "#f4f4f4", "#c1272d"), gk: "#ffd23f" }),
  team("cro", "크로아티아", { home: k("#ffffff", "#ffffff", "#1d3b8f", "#1d3b8f", { checks: "#d52b1e" }), away: k("#1d3b8f", "#1d3b8f", "#1d3b8f", "#ffffff"), gk: "#39d353" }),
  team("uru", "우루과이", { home: k("#5cbfeb", "#111111", "#111111", "#111111"), away: k("#f4f4f4", "#111111", "#f4f4f4", "#5cbfeb"), gk: "#ff8a00" }),
  team("sui", "스위스", { home: k("#d52b1e", "#f4f4f4", "#d52b1e", "#ffffff"), away: k("#f4f4f4", "#d52b1e", "#f4f4f4", "#d52b1e"), gk: "#ffd23f" }),
  team("ned", "네덜란드", { home: k("#ff7f00", "#ff7f00", "#ff7f00", "#111111"), away: k("#1d3b8f", "#1d3b8f", "#1d3b8f", "#ff7f00"), gk: "#39d3c4" }),
  team("por", "포르투갈", { home: k("#c8102e", "#006233", "#c8102e", "#ffd100"), away: k("#f4f4f4", "#f4f4f4", "#f4f4f4", "#c8102e"), gk: "#ffd23f" }),
  team("ger", "독일", { home: k("#f4f4f4", "#111111", "#f4f4f4", "#111111"), away: k("#2b1d3c", "#2b1d3c", "#2b1d3c", "#ff4fa3"), gk: "#39d353" }),
  team("bel", "벨기에", { home: k("#c8102e", "#c8102e", "#c8102e", "#ffd100"), away: k("#f4f4f4", "#f4f4f4", "#f4f4f4", "#c8102e"), gk: "#ff8a00" }),
  team("eng", "잉글랜드", { home: k("#f4f4f4", "#1b2a5c", "#f4f4f4", "#1b2a5c"), away: k("#c8102e", "#c8102e", "#c8102e", "#ffffff"), gk: "#ffd23f" }),
  team("esp", "스페인", { home: k("#c60b1e", "#1b2a5c", "#1b2a5c", "#ffd100"), away: k("#f4f4f4", "#f4f4f4", "#f4f4f4", "#c60b1e"), gk: "#39d353" }),
  team("bra", "브라질", { home: k("#ffdc02", "#1d4fbf", "#f4f4f4", "#0b7a3e"), away: k("#1d4fbf", "#f4f4f4", "#1d4fbf", "#ffffff"), gk: "#ff4fa3" }),
  team("arg", "아르헨티나", { home: k("#ffffff", "#111111", "#ffffff", "#111111", { stripes: "#75aadb" }), away: k("#1b2a5c", "#1b2a5c", "#1b2a5c", "#75aadb"), gk: "#c0ff3e" }),
  team("fra", "프랑스", { home: k("#1e3a8a", "#f4f4f4", "#c8102e", "#ffffff"), away: k("#f4f4f4", "#1e3a8a", "#f4f4f4", "#1e3a8a"), gk: "#ffd23f" }),
];

// 온라인은 팀 없이 내 쪽 빨강, 상대 쪽 파랑으로 고정 (각자 자기 화면에서 자기가 빨강)
export const ONLINE_KITS = {
  me: { shirt: "#d6202a", shorts: "#111111", socks: "#d6202a", number: "#ffffff" },
  opp: { shirt: "#1e4fbf", shorts: "#f4f4f4", socks: "#1e4fbf", number: "#ffffff" },
  meGk: { shirt: "#39d353", shorts: "#1b1b1b", socks: "#39d353", number: "#111", gloves: "#f4f4f4" },
  oppGk: { shirt: "#ffd23f", shorts: "#1b1b1b", socks: "#ffd23f", number: "#111", gloves: "#f4f4f4" },
};

// ---------- 랜덤 선수 ----------
const SKINS = ["#f6d5bd", "#ecc39f", "#d6a47a", "#b98058", "#8a5636", "#5b3823"];
const HAIRS = ["short", "short", "buzz", "bald", "swept", "curly", "afro", "bun", "long", "twists"];
const HAIR_COLORS = ["#151110", "#2e1f16", "#5a3a22", "#8c6439", "#dcbc72"];
const BEARDS = ["none", "none", "none", "stubble", "full"];
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

function randomPlayer(rnd, num) {
  return { num, skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS), hairColor: pick(rnd, HAIR_COLORS), beard: pick(rnd, BEARDS) };
}

// 키커 6명 + 골키퍼. 등번호는 1~99에서 겹치지 않게. 서든데스에서는 6명 → 골키퍼 → 다시 1번 순서.
export function randomSquad(rnd = Math.random) {
  const nums = new Set();
  const num = () => {
    let n;
    do n = 1 + Math.floor(rnd() * 99);
    while (nums.has(n));
    nums.add(n);
    return n;
  };
  const order = Array.from({ length: 6 }, () => randomPlayer(rnd, num()));
  const gk = randomPlayer(rnd, num());
  return { gk, order: [...order, gk] };
}

export const nationById = (id) => NATIONS.find((n) => n.id === id);

export const ROUNDS = ["32강", "16강", "8강", "4강", "결승"];
// 라운드별 CPU 난이도
export const ROUND_LEVEL = ["easy", "normal", "normal", "hard", "hard"];
// 도달 단계 (랭킹용): 1=32강 탈락 … 5=준우승, 6=우승
export const STAGE_LABEL = ["", "32강", "16강", "8강", "4강", "준우승", "우승"];

// 월드컵 대진표 (고정): 32강부터 결승까지 한국이 만나는 상대
export const CUP_BRACKET = ["gha", "jpn", "por", "bra", "arg"];

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mainColor(kit) {
  const a = rgb(kit.body);
  const extra = kit.stripes || kit.checks;
  if (!extra) return a;
  const b = rgb(extra);
  return a.map((v, i) => (v + b[i]) / 2);
}

const clash = (a, b) => {
  const p = mainColor(a);
  const q = mainColor(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 120;
};

// 렌더러가 쓰는 유니폼 모양
function asKit(n) {
  return { shirt: n.body, stripes: n.stripes, checks: n.checks, shorts: n.shorts, socks: n.socks, number: n.number };
}

export function homeKit(id) {
  return asKit(nationById(id).kit.home);
}

// 내 화면에서 상대가 입을 유니폼: 내 홈과 겹치면 원정
export function opponentKit(myId, oppId) {
  const my = nationById(myId).kit.home;
  const opp = nationById(oppId).kit;
  return asKit(clash(my, opp.home) ? opp.away : opp.home);
}

export function gkKit(id) {
  const c = nationById(id).kit.gk;
  return { shirt: c, shorts: "#1b1b1b", socks: c, number: "#111", gloves: "#f4f4f4" };
}

// ---------- 국기 (단순화한 SVG) ----------
const H3 = (a, b, c) => `<rect width="30" height="20" fill="${a}"/><rect y="6.67" width="30" height="6.67" fill="${b}"/><rect y="13.33" width="30" height="6.67" fill="${c}"/>`;
const V3 = (a, b, c) => `<rect width="30" height="20" fill="${a}"/><rect x="10" width="10" height="20" fill="${b}"/><rect x="20" width="10" height="20" fill="${c}"/>`;
const star = (cx, cy, r, fill) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
};
const FLAGS = {
  kor: `<rect width="30" height="20" fill="#fff"/><path d="M11 10a4 4 0 0 1 8 0z" fill="#cd2e3a"/><path d="M11 10a4 4 0 0 0 8 0z" fill="#0047a0"/><circle cx="13" cy="10" r="2" fill="#cd2e3a"/><circle cx="17" cy="10" r="2" fill="#0047a0"/><g stroke="#000" stroke-width="1"><path d="M4 4l3 3M4.8 3.2l3 3M3.2 4.8l3 3"/><path d="M23 13l3 3M23.8 12.2l3 3M22.2 13.8l3 3"/><path d="M23 7l3-3M22.2 6.2l3-3M23.8 7.8l3-3"/><path d="M4 16l3-3M3.2 15.2l3-3M4.8 16.8l3-3"/></g>`,
  ksa: `<rect width="30" height="20" fill="#0b7a3e"/><rect x="7" y="7" width="16" height="2.5" rx="1" fill="#fff"/><rect x="8" y="12.5" width="14" height="1.2" fill="#fff"/>`,
  gha: H3("#ce1126", "#fcd116", "#006b3f") + star(15, 10, 3, "#000"),
  aus: `<rect width="30" height="20" fill="#012169"/><rect width="13" height="10" fill="#012169"/><path d="M0 0l13 10M13 0L0 10" stroke="#fff" stroke-width="2"/><path d="M6.5 0v10M0 5h13" stroke="#fff" stroke-width="3"/><path d="M6.5 0v10M0 5h13" stroke="#c8102e" stroke-width="1.6"/>${star(7, 15, 2, "#fff")}${star(23, 5, 1.3, "#fff")}${star(20, 10, 1.3, "#fff")}${star(26, 9, 1.3, "#fff")}${star(23, 16, 1.3, "#fff")}`,
  can: `<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#d52b1e"/><rect x="22.5" width="7.5" height="20" fill="#d52b1e"/><path d="M15 4l1.2 2.4 1.6-.6-.6 3.6 2-1.4.6 1.4 1.4-.4-1 2.4.8.6-3.4 1.2.2 2h-1.6l.2-2-3.4-1.2.8-.6-1-2.4 1.4.4.6-1.4 2 1.4-.6-3.6 1.6.6z" fill="#d52b1e"/>`,
  usa: `<rect width="30" height="20" fill="#fff"/>${[0, 2, 4, 6, 8, 10, 12].map((i) => `<rect y="${(i * 20) / 13}" width="30" height="${20 / 13}" fill="#b22234"/>`).join("")}<rect width="13" height="10.8" fill="#3c3b6e"/><g fill="#fff">${[2, 5, 8, 11].flatMap((x) => [2, 5, 8].map((y) => `<circle cx="${x}" cy="${y}" r=".6"/>`)).join("")}</g>`,
  mex: V3("#006847", "#fff", "#ce1126") + `<circle cx="15" cy="10" r="2.4" fill="#8b5a2b"/>`,
  jpn: `<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>`,
  mar: `<rect width="30" height="20" fill="#c1272d"/><polygon points="15,4.5 16.8,10.6 12.1,7.1 17.9,7.1 13.2,10.6" fill="none" stroke="#006233" stroke-width="1"/>`,
  cro: H3("#ff0000", "#fff", "#171796") + `<g>${[0, 1, 2, 3, 4].flatMap((x) => [0, 1, 2].map((y) => `<rect x="${11 + x * 1.6}" y="${5 + y * 1.6}" width="1.6" height="1.6" fill="${(x + y) % 2 ? "#fff" : "#ff0000"}"/>`)).join("")}</g>`,
  uru: `<rect width="30" height="20" fill="#fff"/>${[1, 3, 5, 7].map((i) => `<rect y="${i * 2.22}" width="30" height="2.22" fill="#0038a8"/>`).join("")}<rect width="11" height="11" fill="#fff"/><circle cx="5.5" cy="5.5" r="3" fill="#fcd116"/>`,
  sui: `<rect width="30" height="20" fill="#d52b1e"/><rect x="13" y="4" width="4" height="12" fill="#fff"/><rect x="9" y="8" width="12" height="4" fill="#fff"/>`,
  ned: H3("#ae1c28", "#fff", "#21468b"),
  por: `<rect width="30" height="20" fill="#da291c"/><rect width="12" height="20" fill="#046a38"/><circle cx="12" cy="10" r="3.6" fill="#ffd100"/><circle cx="12" cy="10" r="2" fill="#da291c"/>`,
  ger: H3("#000", "#dd0000", "#ffce00"),
  bel: V3("#000", "#fdda24", "#ef3340"),
  eng: `<rect width="30" height="20" fill="#fff"/><rect x="13" width="4" height="20" fill="#ce1124"/><rect y="8" width="30" height="4" fill="#ce1124"/>`,
  esp: `<rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/>`,
  bra: `<rect width="30" height="20" fill="#009c3b"/><polygon points="15,2.5 27,10 15,17.5 3,10" fill="#ffdf00"/><circle cx="15" cy="10" r="4.2" fill="#002776"/>`,
  arg: H3("#74acdf", "#fff", "#74acdf") + `<circle cx="15" cy="10" r="1.8" fill="#f6b40e"/>`,
  fra: V3("#002395", "#fff", "#ed2939"),
};

export function flagSvg(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">${FLAGS[id] || ""}<rect width="30" height="20" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".8"/></svg>`;
}

export function flagUrl(id) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(flagSvg(id))}`;
}
