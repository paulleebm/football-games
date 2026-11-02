// 승부차기 규칙과 판정. 화면·네트워크와 무관한 순수 함수만 둔다.
// 온라인에서는 양쪽이 같은 입력으로 같은 결과를 내야 해서 입력은 정수로 주고받고,
// 판정은 사칙연산과 sqrt만 쓴다 (브라우저마다 결과가 달라질 수 있는 삼각함수는 안 씀).
//
// 좌표 (미터): 골대 정면에서 본 평면. x = 가운데 0, 오른쪽 +. y = 땅 0, 위 +.
// 골대 안쪽 폭 7.32m, 높이 2.44m. 공 반지름 0.11m.

export const GOAL_W2 = 3.66;
export const GOAL_H = 2.44;
export const BALL = 0.11;
export const KEEP_MAX = 3.6; // 키퍼가 가운데(0, 1m)에서 몸을 날릴 수 있는 최대 거리
export const INPUT_MS = 5000;

export const other = (t) => (t === "home" ? "away" : "home");

// 선수 구분이 없어서 키커 실력·키퍼 선방은 모두 같다 (CPU 키퍼만 난이도에 따라 가감)
export const KEEPER_SAV = 8;

// 서든데스로 넘어가면 남은 선수 → 골키퍼 → 다시 1번부터 (모두 한 번씩 찬 뒤에야 반복)
export function kickerAt(lineup, n) {
  return lineup.order[n % lineup.order.length];
}

// kicks: [{ team, goal }] 찬 순서대로. first: 먼저 찬 팀.
export function shootout(kicks, first) {
  const second = other(first);
  const score = { home: { taken: 0, goals: 0 }, away: { taken: 0, goals: 0 } };
  for (const k of kicks) {
    score[k.team].taken++;
    if (k.goal) score[k.team].goals++;
  }
  const a = score[first];
  const b = score[second];
  let winner = null;
  if (a.taken <= 5 && b.taken <= 5) {
    // 정규 5번: 남은 킥을 다 넣어도 못 따라가면 끝
    if (a.goals > b.goals + (5 - b.taken)) winner = first;
    else if (b.goals > a.goals + (5 - a.taken)) winner = second;
  } else if (a.taken === b.taken && a.goals !== b.goals) {
    // 서든데스: 같은 수만큼 찼을 때 갈리면 끝
    winner = a.goals > b.goals ? first : second;
  }
  return { score, winner, next: kicks.length % 2 === 0 ? first : second, sudden: a.taken >= 5 && b.taken >= 5 };
}

// ---------- 킥 ----------
// 키커는 드래그로 조준점을 옮기고, 그동안 오른쪽 슛 게이지가 빠르게 오르내린다.
// 손을 떼는 순간의 조준점 = 방향, 게이지 = 세기.
//   약(0~35%): 느리고 정확 / 좋아(~75%): 보통 / 강슛(~90%): 빠르지만 많이 샘 / 홈런(90%~): 무조건 하늘로
export const ZONES = [
  { name: "약", until: 0.35 },
  { name: "좋아", until: 0.75 },
  { name: "강슛", until: 0.9 },
  { name: "홈런", until: 1.01 },
];
export const SKY = 0.9;
export const zoneOf = (g) => ZONES.findIndex((z) => g < z.until);

// 게이지: 0 → 1 → 0 … 오르내림. 박자를 외우지 못하게
//  - 한 번 오르거나 내려올 때마다 걸리는 시간이 ±35% 달라지고 (gaugeSweeps)
//  - 오르내리는 도중에도 빨라졌다 느려졌다 한다 (구간마다 다른 출렁임 a, b)
//  - 위쪽(강슛·홈런)에서는 빨라져서 아래(약·좋아)보다 휙 지나간다
export function gaugeSweeps(rnd) {
  const base = 390 + rnd() * 120;
  return Array.from({ length: 40 }, () => {
    // |a| + |b| < 1 이어야 거꾸로 가지 않는다
    const a = (rnd() * 2 - 1) * 0.55;
    const b = (rnd() * 2 - 1) * 0.3;
    return { ms: base * (0.65 + rnd() * 0.7), a, b };
  });
}

const accel = (v) => 0.55 * v + 0.45 * v * v;

// 0→1로 가는 진행도를 출렁이게: 양 끝은 그대로 두고 중간 속도만 바뀐다
const wobble = (u, a, b) => u + (a * Math.sin(2 * Math.PI * u)) / (2 * Math.PI) + (b * Math.sin(4 * Math.PI * u)) / (4 * Math.PI);

export function gaugeAt(ms, sweeps) {
  let t = ms;
  let i = 0;
  while (t >= sweeps[i % sweeps.length].ms) {
    t -= sweeps[i % sweeps.length].ms;
    i++;
  }
  const s = sweeps[i % sweeps.length];
  const u = wobble(t / s.ms, s.a, s.b);
  return accel(i % 2 === 0 ? u : 1 - u);
}

// 드래그 조준점 (미터): 골대 밖으로도 보낼 수 있지만 너무 멀리는 못 간다
export function clampAim(x, y) {
  return { x: Math.max(-5.5, Math.min(5.5, x)), y: Math.max(0, Math.min(3.2, y)) };
}

const gauss = (rnd) => (rnd() + rnd() + rnd() - 1.5) * 1.15;

// 조준점 + 게이지 → 실제로 날아가는 곳과 속도. 빗나감은 여기서 한 번만 굴리고
// 결과를 정수로 보내서 온라인 양쪽 화면이 같다.
export function shotFromAim(tx, ty, g, rnd) {
  const k = Math.min(g, SKY) / SKY;
  const s = 0.35 + 0.65 * k;
  let x;
  let y;
  if (g >= SKY) {
    // 홈런: 크로스바 위로
    x = tx + gauss(rnd) * 0.6;
    y = GOAL_H + 0.6 + rnd() * 0.6;
  } else {
    // 셀수록 급하게 빗나감이 커진다 (강슛을 구석에 차면 골대 밖으로 꽤 샌다)
    const sd = 0.05 + 0.8 * k * k * k;
    x = tx + gauss(rnd) * sd;
    y = Math.max(0, ty + gauss(rnd) * sd);
  }
  return { x: Math.round(x * 1000), y: Math.round(y * 1000), s: Math.round(s * 1000) };
}

// 키퍼 드래그 목표 (미터)를 손이 닿을 수 있는 범위로 자른다
export function clampKeep(x, y) {
  let dx = x;
  let dy = y - 1;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > KEEP_MAX) {
    dx = (dx / d) * KEEP_MAX;
    dy = (dy / d) * KEEP_MAX;
  }
  return { x: dx, y: Math.min(2.6, Math.max(0.15, dy + 1)) };
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len = vx * vx + vy * vy;
  let t = len ? ((px - ax) * vx + (py - ay) * vy) / len : 0;
  t = Math.min(1, Math.max(0, t));
  const qx = ax + vx * t - px;
  const qy = ay + vy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

// 키퍼 손이 닿는 반경 (미터)
const REACH = 1.08;

function saved(bx, by, s, keep, sav) {
  const bonus = (sav - 7) * 0.03;
  // 가만히 서 있으면 가운데로 오는 공만 막는다
  if (!keep || keep.stay) return Math.abs(bx) < 1.15 + bonus && by < 2.1;
  const tx = keep.x / 1000;
  const ty = keep.y / 1000;
  // 손끝 주변 + 날아간 몸통. 느린 공일수록 손이 더 멀리 닿는다.
  const r = REACH + bonus + (1 - s) * 0.7;
  const dx = bx - tx;
  const dy = by - ty;
  if (Math.sqrt(dx * dx + dy * dy) < r) return true;
  return segDist(bx, by, tx * 0.25, 0.7, tx, ty) < 0.45;
}

// kick: { x: mm, y: mm, s: 0..1000 } (shotFromAim 결과) | { fail: 1 }
// keep: { x: mm, y: mm } | { stay: 1 }
// 결과 outcome: goal | save | post | bar | wide | over | fall
export function resolveKick(kick, keep, sav = KEEPER_SAV) {
  if (!kick || kick.fail) return { outcome: "fall", bx: 0, by: 0, s: 0.3 };
  const bx = kick.x / 1000;
  const by = kick.y / 1000;
  const s = kick.s / 1000;
  const ax = Math.abs(bx);
  const res = (outcome) => ({ outcome, bx, by, s });
  if (by > GOAL_H + BALL) return res("over");
  if (ax > GOAL_W2 + BALL) return res("wide");
  if (ax >= GOAL_W2 - BALL) return res("post");
  if (by >= GOAL_H - BALL) return res("bar");
  if (saved(bx, by, s, keep, sav)) return res("save");
  return res("goal");
}

export const isGoal = (r) => r.outcome === "goal";

// ---------- CPU ----------
// aim: 조준 흔들림(미터), g0·gs: 노리는 게이지와 그 오차
const LEVELS = {
  easy: { aim: 0.6, g0: 0.55, gs: 0.2, fall: 0.04, stay: 0.28, read: 0, sav: -2 },
  normal: { aim: 0.35, g0: 0.6, gs: 0.12, fall: 0.015, stay: 0.16, read: 0.25, sav: 0 },
  hard: { aim: 0.2, g0: 0.66, gs: 0.07, fall: 0, stay: 0.1, read: 0.45, sav: 2 },
};

export function cpuSavBonus(level) {
  return LEVELS[level].sav;
}

export function cpuKick(level, rnd) {
  const L = LEVELS[level];
  if (rnd() < L.fall) return { fail: 1 };
  // 구석을 더 자주 노린다 (가로: 가운데 / 반 / 구석)
  const aims = [-2.9, -1.9, 0, 1.9, 2.9];
  const weights = [3, 2, 1, 2, 3];
  let pick = rnd() * 11;
  let aim = aims[0];
  for (let i = 0; i < aims.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      aim = aims[i];
      break;
    }
  }
  const t = clampAim(aim + gauss(rnd) * L.aim, 0.3 + rnd() * 1.6 + gauss(rnd) * L.aim * 0.5);
  const g = Math.max(0, Math.min(1, L.g0 + (rnd() - 0.5) * 0.2 + gauss(rnd) * L.gs));
  return shotFromAim(t.x, t.y, g, rnd);
}

// history: 사람이 지금까지 찬 방향(부호) 목록. 어려움일수록 자주 가는 쪽을 읽는다.
export function cpuKeep(level, rnd, history) {
  const L = LEVELS[level];
  if (rnd() < L.stay) return { stay: 1 };
  let side = rnd() < 0.5 ? -1 : 1;
  if (history.length >= 2 && rnd() < L.read) {
    const sum = history.reduce((a, b) => a + b, 0);
    if (sum !== 0) side = Math.sign(sum);
  }
  const t = clampKeep(side * (1.5 + rnd() * 1.9), 0.25 + rnd() * 1.9);
  return { x: Math.round(t.x * 1000), y: Math.round(t.y * 1000) };
}
