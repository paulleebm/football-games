// 헤딩 연습 규칙. 화면과 무관한 순수 함수와 상수만 둔다.
// 좌표는 800x600 논리 해상도, y는 아래가 +.
//
// 모든 공은 같은 고정 궤적을 탄다: 감독 손(LAUNCH_X) → H1 → H2 → H3 → H4 → 수레.
// 한 구간은 왼쪽 120px, 0.85초짜리 같은 포물선이고, 플레이어는 도착 순간
// 그 지점에 머리를 대느냐 마느냐만 고른다.

export const GAME_TIME = 60;
export const COUNTDOWN = 3;

export const STATIONS = [610, 490, 370, 250];
export const LAUNCH_X = 730;
export const CONTACT_Y = 340; // 판정 높이 = 머리 윗면
export const GROUND_Y = 540;
// 한 구간 비행 시간만 정하면 나머지가 따라온다: 가로 120px, 최고점은 판정 높이 위 180px로 고정
export const HOP_T = 0.85;
export const HOP_DX = 120;
export const HOP_APEX = 180;
export const GRAVITY = (8 * HOP_APEX) / (HOP_T * HOP_T);
export const HOP_VX = -HOP_DX / HOP_T;
export const HOP_VY = -(GRAVITY * HOP_T) / 2;
// 머리 판정 폭: 지점 중심에서 ±55px (선수 어깨 넓이쯤). 이웃 지점이 120px 떨어져 있어서
// 둘 사이 한가운데에 서도 양쪽을 동시에 받을 수는 없다.
export const HEAD_TOL = 55;
// 공이 내려온 뒤 이만큼(초) 늦게 머리를 갖다 대도 헤딩으로 쳐준다
export const LATE_GRACE = 0.1;
export const BALL_R = 20;

export const PLAYER_SPEED = 1200;
export const PLAYER_MIN = 200;
export const PLAYER_MAX = 660;
export const CART = { x0: 60, x1: 180, top: 470 };

export const MOVE_MARGIN = 0.05;
export const LAUNCH_WARN = 0.4;

// 발사 간격: 박자 없이 랜덤. 평균 간격이 1.6초 → 0.45초로, 뒤로 갈수록 가파르게 줄어든다.
// 공 하나가 수레까지 4초 넘게 날아가므로 첫 공 뒤로는 늘 2개 이상이 떠 있고,
// 마지막 10초(50~60초)는 공이 쏟아지는 난장판이 된다.
export const GAP_START = 1.6;
export const GAP_END = 0.45;
export const GAP_CURVE = 1.6; // 클수록 초반은 느긋하고 막판에 몰아친다
export const GAP_JITTER = 0.25; // 평균의 ±25%
export const GAP_MIN = 0.4; // 감독 던지기 예고 모션(0.4초)보다 짧아지지 않게

export function launchGap(t, rnd) {
  const u = Math.max(0, Math.min(1, t / GAME_TIME)) ** GAP_CURVE;
  const mean = GAP_START + (GAP_END - GAP_START) * u;
  return Math.max(GAP_MIN, mean * (1 - GAP_JITTER + rnd() * 2 * GAP_JITTER));
}

// 강제 선택(둘 다 못 받는 순간)을 일부러 만들 확률 (발사 한 번당).
// CONFLICT_FROM초까지는 0 - 공이 여러 개라도 전부 받을 수 있게 도착 박자를 엇갈려 준다.
// 그 뒤로 공이 많아지면서 끝날 때 CONFLICT_MAX까지 오른다.
export const CONFLICT_FROM = 25;
export const CONFLICT_MAX = 0.6;

export function conflictChance(t) {
  if (t < CONFLICT_FROM) return 0;
  return CONFLICT_MAX * Math.min(1, (t - CONFLICT_FROM) / (GAME_TIME - CONFLICT_FROM)) ** 1.3;
}

// 공이 hits번 헤딩된 상태에서 t초(발사 기준)에 어디 있는지. 구간 s = 0(던지기) … 4(마지막 헤딩 뒤).
export function hopPos(seg, u) {
  const x0 = seg === 0 ? LAUNCH_X : STATIONS[seg - 1];
  return [x0 + HOP_VX * u, CONTACT_Y + HOP_VY * u + 0.5 * GRAVITY * u * u];
}

// 발사 시각 L인 공이 H1~H4에 내려오는 순간들 (모두 헤딩한다고 칠 때)
export function arrivalsOf(id, launchT, fromHit = 0) {
  const out = [];
  for (let k = fromHit; k < STATIONS.length; k++) out.push({ id, k, t: launchT + (k + 1) * HOP_T, x: STATIONS[k] });
  return out;
}

// a 다음에 b를 받을 수 있나 - 두 가지 기준.
// reachable: 판정 폭과 늦은 헤딩 유예까지 다 쓰면 받을 수는 있나 (못 받으면 진짜 "강제 선택").
export function reachable(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - 2 * HEAD_TOL);
  return dx === 0 || dx / PLAYER_SPEED <= Math.abs(b.t - a.t) + LATE_GRACE + 1e-9;
}
// comfortable: 사람이 보통처럼 지점 한가운데를 노려도 여유 있게 받나 (초반 공 배치 기준).
export function comfortable(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - HEAD_TOL);
  return dx === 0 || dx / PLAYER_SPEED + MOVE_MARGIN <= Math.abs(b.t - a.t) + 1e-9;
}

// 시간순으로 붙은 도착끼리 ok 기준을 못 넘는 쌍. 기본은 진짜 못 받는 쌍 = 강제 선택
export function conflictPairs(events, ok = reachable) {
  const ev = [...events].sort((a, b) => a.t - b.t || a.x - b.x);
  const pairs = [];
  for (let i = 0; i + 1 < ev.length; i++) if (!ok(ev[i], ev[i + 1])) pairs.push([ev[i], ev[i + 1]]);
  return pairs;
}

export function addedConflicts(events, launchT, ok = reachable) {
  return conflictPairs([...events, ...arrivalsOf(-1, launchT)], ok).length - conflictPairs(events, ok).length;
}

// 랜덤으로 뽑은 발사 시각 t 근처(±0.6초, 0.05초 단위, 가까운 순)에서 강제 선택이 정확히 want개인
// 시각을 찾는다. want=0이면 모든 공을 받을 수 있게 도착 박자를 엇갈리고, want=1이면 둘 중 하나를
// 포기해야 하는 순간을 만든다. 크게 미루지 않아야 공이 계속 촘촘하게 나온다.
// 못 찾으면 want=0은 충돌이 가장 적은 시각, want=1은 그냥 t. minT보다 이르게는 안 던진다.
export function settleLaunch(events, t, want, minT = -Infinity) {
  let best = null;
  for (let i = 0; i <= 24; i++) {
    const d = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.05;
    const c = t + d;
    if (c < minT) continue;
    // want=0: 한가운데를 노려도 여유 있게 받게 / want=1: 진짜로 못 받는 쌍을 하나 만든다
    const n = want === 0 ? addedConflicts(events, c, comfortable) : addedConflicts(events, c);
    if (n === want) return c;
    if (!best || n < best.n) best = { t: c, n };
  }
  return want === 0 && best ? best.t : Math.max(t, minT);
}
