// 2D 원 충돌 물리. 화면(three.js)과 완전히 분리돼 있어서 CPU AI가 월드를 복제해
// 같은 코드로 "이렇게 차면 어떻게 될까"를 미리 돌려볼 수 있다. 좌표는 x = 경기장
// 길이 방향(홈이 -x 골대를 지키고 +x로 공격), y = 폭 방향.

// 골대 폭 = 페널티 아크 지름 (아크 반지름 = goalHalfW, 골포스트가 아크 양 끝에 딱 맞는다)
// postIn = 골포스트를 골라인에서 경기장 안쪽으로 당긴 거리 (골대 맞고 튕기는 장면이 나오게)
export const FIELD = { halfL: 18, halfW: 11, goalHalfW: 6, goalDepth: 2.6, postR: 0.32, postIn: 0.35 };
export const BOBBLE_R = 1.1;
export const BALL_R = 0.6;
// 모서리 펜스 곡선의 반지름 (모서리 점이 중심, 원 안쪽이 경기장 밖 구석)
export const BUMPER_R = 2.4;
// 범퍼 쿠션 굵기(반지름): 펜스 곡선의 경기장 쪽 면에 둥근 고무 쿠션이 붙어 있고,
// 실제로 튕기는 면은 쿠션 앞면 = 모서리에서 BUMPER_R + 2 * BUMPER_TUBE
export const BUMPER_TUBE = 0.38;
export const DT = 1 / 120;
export const BOBBLE_MU = 9;
export const BALL_MU = 5.8;
// 최대로 당겼을 때 아무것도 안 부딪히면 미끄러지는 거리
export const MAX_SHOT = 13;

const MAX_SPEED = 30;
const E_WALL_BOBBLE = 0.5;
const E_WALL_BALL = 0.78;
const E_BOBBLE = 0.72;
const E_BALL = 0.9;
// 알이 공에 닿을 때 순수 탄성충돌 위에 얹는 "찼다" 보정
const KICK_BONUS = 0.3;
const REST_SPEED = 0.03;
// 파워슛: 불붙은 공은 골이 들어가거나 그물에 박힐 때까지 속도가 안 줄고(마찰 없음, 벽에 튕겨도 그대로) 계속 날아다닌다.
// 턴 시간 제한(app.js EXEC_LIMIT)이 끝나면 그 자리에서 멈춘다.
// 돌진하듯 맞은 선수(우리 편도)를 앞에 붙여 끌고 가다가, 선수가 벽·그물에 처박히면 납작하게 깔린다.
// 골대 그물에 깔리면 공이 같이 밀려 들어가 박히고(골), FLAT_STEPS 뒤 다시 부풀면서 공을 튕겨 낸다.
// 다른 벽에 깔리면 선수만 벽에 박혀 있고 공은 벽에 맞은 것처럼 계속 튕겨 다닌다.
const FIRE_MU = 1.6;
const FIRE_SPEED = 52;
// 불붙은 공·끌려가는 선수만 일반 속도 상한(MAX_SPEED)을 넘는다. 한 스텝 이동(0.5)이 공 반지름보다 작아서 벽을 뚫지 않는다.
const FIRE_MAX = 60;
const FIRE_OUT = 5;
const FLAT_R = 0.3;
const FLAT_STEPS = 60;
const INFLATE_STEPS = 30;
const POP_SPEED = 9;
// 깔린 선수는 벽을 따라 원래 지름의 이만큼 넓게 퍼진다 (부풀면서 다시 동그랗게)
const FLAT_SPREAD = 1.25;
// 비치볼: 벽과 선수에 맞으면 거의 그대로 튕긴다
const E_BEACH_WALL = 0.98;
const E_BEACH = 1.0;
// 운동장 기울이기: 출발 후 TILT_STEPS(3초) 동안만 공이 내리막으로 빨라진다 (마찰을 이기고 남는 힘 = TILT_PULL,
// 빙판·비치볼이어도 같다). 그 뒤엔 공 마찰이 TILT_AFTER_MU배로 세져서 평소보다 조금 빨리 멈춘다.
const TILT_PULL = 2;
const TILT_STEPS = 360;
const TILT_AFTER_MU = 1.3;
// 기울어진 동안 공이 이보다 느린 채로 TILT_STILL 스텝(0.5초) 넘게 있으면 (벽·선수에 막혀 비비는 중) 멈춘 걸로 본다.
// 막 굴러가기 시작한 공은 0.2초면 이 속도를 넘으니 멈춤으로 안 친다.
const TILT_REST = 0.3;
const TILT_STILL = 60;

// 운동장 기울이기로 공이 굴러가는 x 방향 (+1/-1, 평평하면 0). 기울인 순간 그 팀이 노리던 골대 쪽으로
// 정해지고, 그 뒤에 골대를 바꿔도 운동장은 그대로라 당한 쪽이 골대 바꾸기로 역이용할 수 있다.
export function tiltDir(w) {
  return w.fx.tilt > 0 ? w.fx.tiltX || 0 : 0;
}

// 지금 공이 내리막으로 밀리는 중인가 (기울고 3초 안)
function tiltPulling(w) {
  return tiltDir(w) !== 0 && (w.fx.tiltT || 0) < TILT_STEPS;
}

// 경기장 테두리: 직선 펜스는 모서리 범퍼가 시작되는 곳에서 끝난다 (모서리 = 범퍼)
function buildWalls() {
  const { halfL: L, halfW: W, goalHalfW: G, goalDepth: D } = FIELD;
  const R = BUMPER_R;
  const segs = [];
  const add = (ax, ay, bx, by, kind = "wall") => segs.push({ ax, ay, bx, by, kind });
  add(-L + R, W, L - R, W);
  add(-L + R, -W, L - R, -W);
  for (const s of [1, -1]) {
    const x = s * L;
    add(x, W - R, x, G);
    add(x, -G, x, -W + R);
    add(x, G, x + s * D, G, "net");
    add(x + s * D, G, x + s * D, -G, "net");
    add(x + s * D, -G, x, -G, "net");
  }
  return segs;
}

export const WALLS = buildWalls();
// 코너 범퍼: 중심이 경기장 모서리, 경기장 안쪽 4분의 1이 펜스의 둥근 모서리 역할을 한다.
// 구석에 공이나 선수가 끼지 않게 닿으면 밀어낸다.
const BUMPER_KICK = 8;
export const BUMPERS = [1, -1].flatMap((sx) => [1, -1].map((sy) => ({
  x: sx * FIELD.halfL, y: sy * FIELD.halfW, sx, sy,
})));

export const POSTS = [
  { x: FIELD.halfL - FIELD.postIn, y: FIELD.goalHalfW }, { x: FIELD.halfL - FIELD.postIn, y: -FIELD.goalHalfW },
  { x: -FIELD.halfL + FIELD.postIn, y: FIELD.goalHalfW }, { x: -FIELD.halfL + FIELD.postIn, y: -FIELD.goalHalfW },
];

// 능력치(1~10)를 물리 수치 배율로. 5~6 근처가 기본값(1.0)이다.
// 선방은 키퍼 원판 반지름 자체, 몸싸움은 무게(잘 안 밀리고 잘 밀어낸다)
const STAT_RANGE = { spd: [0.75, 1.3], sht: [0.3, 2.0], phy: [0.6, 2.1], sav: [0.93, 2.02] };
// 골키퍼: 덜 미끄러지고 킥은 세다
const GK_SPEED = 0.85;
const GK_KICK = 1.35;

// 받침 원판 모양: 슈팅이 약할수록 각진다 (3 = 삼각형 ... 8 = 팔각형, 0 = 원)
export function sidesForShooting(sht) {
  if (sht <= 2) return 3;
  if (sht <= 4) return 4;
  if (sht <= 6) return 5;
  if (sht === 7) return 6;
  if (sht === 8) return 8;
  return 0;
}

function statScale(key, v) {
  const [lo, hi] = STAT_RANGE[key];
  return lo + ((hi - lo) * (Math.max(1, Math.min(10, v)) - 1)) / 9;
}

// stats가 없으면 평균 선수. 선방은 골키퍼 받침 원판 반지름 자체다.
// 원판 크기는 몸싸움에 따라 조금씩 다르다. rot = 각진 원판이 향한 방향 (공격 방향으로 시작)
// role은 선 자리(gk, a, b, c)이고, 키퍼 특성은 자리가 아니라 선수(선방 스탯이 있는 골키퍼)를 따라간다.
export function makeBobble(id, team, role, x, y, stats = {}, pid = null) {
  const st = { spd: 5.5, sht: 5.5, phy: 5.5, ...stats };
  const gk = st.sav != null;
  return {
    id, kind: "bobble", team, role, pid, keeper: gk, x, y, vx: 0, vy: 0, mu: BOBBLE_MU,
    r: gk ? statScale("sav", st.sav) : BOBBLE_R + (st.phy - 5.5) * 0.05,
    m: statScale("phy", st.phy),
    maxShot: MAX_SHOT * statScale("spd", st.spd) * (gk ? GK_SPEED : 1),
    kick: KICK_BONUS * statScale("sht", st.sht) * (gk ? GK_KICK : 1),
    sides: st.sides ?? sidesForShooting(Math.round(st.sht)),
    rot: team === "home" ? 0 : Math.PI,
  };
}

// 각진 원판은 공이 닿은 방향을 가장 가까운 면의 방향으로 꺾는다 → 빗맞으면 엉뚱하게 나감.
// 꼭짓점 하나가 rot(공격/조준 방향)을 향하므로 면 방향은 rot + 반 칸씩 어긋나 있다.
function facetNormal(bob, nx, ny) {
  const n = bob.sides;
  if (!n) return [nx, ny];
  const step = (Math.PI * 2) / n;
  const off = bob.rot + step / 2;
  const a = Math.atan2(ny, nx) - off;
  const snapped = Math.round(a / step) * step + off;
  // 면 방향 70% + 실제 방향 30%: 완전히 꺾이면 너무 운에 맡기게 돼서 섞는다
  const fx = Math.cos(snapped) * 0.7 + nx * 0.3;
  const fy = Math.sin(snapped) * 0.7 + ny * 0.3;
  const l = Math.hypot(fx, fy) || 1;
  return [fx / l, fy / l];
}

export function makeBall(x = 0, y = 0) {
  return { id: "ball", kind: "ball", team: null, role: null, x, y, vx: 0, vy: 0, r: BALL_R, m: 0.35, mu: BALL_MU };
}

// items = 필드에 떠 있는 아이템, fx = 아이템으로 걸린 효과 (items.js가 넣고 뺀다)
//   swap: 골대 바뀜 남은 턴 / ice: 경기장 전체 빙판 남은 턴
export function emptyFx() {
  return { swap: 0, ice: 0 };
}

export function createWorld(bodies, items = []) {
  return { t: 0, bodies, bench: [], goal: null, lastTouch: null, lastToucher: null, items, fx: emptyFx(), picked: [], spawnedTurn: 0 };
}

export function cloneWorld(w) {
  return {
    t: w.t, goal: w.goal, lastTouch: w.lastTouch, lastToucher: w.lastToucher, spawnedTurn: w.spawnedTurn || 0,
    bodies: w.bodies.map((b) => ({ ...b })),
    // 레드카드로 잠깐 경기장 밖에 나가 있는 선수
    bench: (w.bench || []).map((b) => ({ ...b })),
    items: w.items.map((it) => ({ ...it })),
    fx: { ...w.fx },
    picked: [],
  };
}

export const ITEM_R = 1.3;

export function getBall(w) {
  return w.bodies.find((b) => b.kind === "ball");
}

// 당긴 정도(0..1)를 출발 속도로. 등감속 운동이라 거리 = v^2 / 2mu.
export function launchSpeed(power, mu = BOBBLE_MU, maxShot = MAX_SHOT) {
  return Math.sqrt(2 * mu * Math.max(0, power) * maxShot);
}

export function applyMoves(w, moves) {
  for (const b of w.bodies) {
    const mv = moves[b.id];
    if (!mv || mv.power <= 0) continue;
    const sp = launchSpeed(mv.power, b.mu, b.maxShot);
    b.vx = mv.dx * sp;
    b.vy = mv.dy * sp;
    b.rot = Math.atan2(mv.dy, mv.dx);
  }
}

export function isSettled(w) {
  // 깔린 선수가 다시 부풀 때까지는 턴을 끝내지 않는다
  if (w.bodies.some((b) => b.flatT !== undefined)) return false;
  // 공이 밀리는 동안은 서 있어도 곧 굴러가니, 막혀서 오래 못 움직일 때만 멈춘 걸로 본다.
  // 그 공에 계속 떠밀리는 선수는 아주 조금씩 움직이니 거의 안 움직이면 멈춘 걸로.
  if (!tiltPulling(w)) return w.bodies.every((b) => b.vx === 0 && b.vy === 0);
  return w.bodies.every((b) => (b.kind === "ball" ? b.still > TILT_STILL : Math.hypot(b.vx, b.vy) <= REST_SPEED));
}

function collideSegment(b, s, events) {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len2 = ex * ex + ey * ey;
  let t = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = s.ax + ex * t;
  const qy = s.ay + ey * t;
  collideWithPoint(b, qx, qy, 0, s.kind, events);
}

function collideWithPoint(b, qx, qy, extraR, kind, events) {
  const dx = b.x - qx;
  const dy = b.y - qy;
  const d2 = dx * dx + dy * dy;
  const rr = b.r + extraR;
  if (d2 >= rr * rr || d2 < 1e-12) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  b.x = qx + nx * rr;
  b.y = qy + ny * rr;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  // 공에 휩쓸려 날아가던 선수는 벽에 부딪히면 거기 납작하게 깔린다
  if (b.fly && b.kind === "bobble") {
    splat(b, qx, qy, extraR, nx, ny, events);
    return;
  }
  const e = b.kind === "ball" ? (b.beach ? E_BEACH_WALL : E_WALL_BALL) : E_WALL_BOBBLE;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  if (events && -vn > 0.8) events.push({ type: kind, x: qx, y: qy, body: b.id, kind: b.kind, speed: -vn });
}

// 벽 쪽 접점 (qx, qy)에서 법선 (nx, ny) 방향으로 얇게 깔린다. 원래 반지름은 fullR에 둔다.
function splat(b, qx, qy, extraR, nx, ny, events) {
  b.fly = 0;
  b.fullR = b.r;
  b.r = FLAT_R;
  b.x = qx + nx * (extraR + FLAT_R);
  b.y = qy + ny * (extraR + FLAT_R);
  b.vx = 0;
  b.vy = 0;
  b.flatT = 0;
  b.flatNx = nx;
  b.flatNy = ny;
  if (events) events.push({ type: "splat", x: b.x, y: b.y, a: b.id, nx, ny });
}

function resplat(f, events) {
  const lift = f.r - FLAT_R;
  f.x -= f.flatNx * lift;
  f.y -= f.flatNy * lift;
  f.r = FLAT_R;
  f.flatT = 0;
  delete f.popped;
  if (events) events.push({ type: "splat", x: f.x, y: f.y, a: f.id, nx: f.flatNx, ny: f.flatNy, again: true });
}

// 화면용: 얼마나 납작한가 (1 = 완전히 깔림, 부풀면서 0으로)
export function flatness(b) {
  if (b.flatT === undefined) return 0;
  return 1 - Math.min(1, Math.max(0, (b.flatT - FLAT_STEPS) / INFLATE_STEPS));
}

// 깔린 선수 = 벽을 따라 납작하게 퍼진 캡슐(가운데 선분 + 두께 r). 꿈쩍 안 하고 닿은 쪽만 밀어낸다.
// 골대 그물에 깔렸으면 공은 같이 박혀 멈췄다가 부풀 때 튕겨 나오고, 다른 벽이면 공은 벽처럼 튕긴다.
export function flatInNet(f) {
  return Math.abs(f.x) > FIELD.halfL && Math.abs(f.y) < FIELD.goalHalfW;
}

function flatHalf(f) {
  const k = Math.min(1, Math.max(0, (f.flatT - FLAT_STEPS) / INFLATE_STEPS));
  return f.fullR * FLAT_SPREAD * (1 - k);
}

function collideFlat(f, o, events) {
  const h = flatHalf(f);
  const tx = -f.flatNy;
  const ty = f.flatNx;
  const t = Math.max(-h, Math.min(h, (o.x - f.x) * tx + (o.y - f.y) * ty));
  const qx = f.x + tx * t;
  const qy = f.y + ty * t;
  const dx = o.x - qx;
  const dy = o.y - qy;
  // 그물에 깔려 있는 동안 공은 깔린 선수 몸에 반쯤 파묻힌다
  const net = flatInNet(f);
  const sink = o.kind === "ball" && net && f.flatT < FLAT_STEPS ? 0.4 : 1;
  const rr = f.r + o.r * sink;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 < 1e-12) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  o.x = qx + nx * rr;
  o.y = qy + ny * rr;
  const vn = o.vx * nx + o.vy * ny;
  // 깔려 있거나 부풀고 있는 중에 불붙은 공에 또 맞으면 처음부터 다시 납작 (깔림 연장)
  // (막 깔린 직후 0.1초 안에 뒤따라 닿은 공은 같은 충돌이라 연장으로 안 친다)
  if (o.kind === "ball" && o.fire && vn < 0 && f.flatT > 12) resplat(f, events);
  if (o.kind === "ball" && !net) {
    if (vn < 0) {
      const e = o.beach ? E_BEACH_WALL : E_WALL_BALL;
      o.vx -= (1 + e) * vn * nx;
      o.vy -= (1 + e) * vn * ny;
      if (events && -vn > 0.8) events.push({ type: "wall", x: qx, y: qy, body: o.id, kind: o.kind, speed: -vn });
    }
    return;
  }
  if (o.kind === "ball") {
    o.fire = 0;
    if (f.flatT < FLAT_STEPS) {
      o.vx = 0;
      o.vy = 0;
    } else if (vn < POP_SPEED) {
      o.vx += (POP_SPEED - vn) * nx;
      o.vy += (POP_SPEED - vn) * ny;
      if (events && !f.popped) events.push({ type: "pop", x: o.x, y: o.y, a: f.id });
      f.popped = 1;
    }
    return;
  }
  // 같이 끌려오던 선수는 먼저 깔린 선수 위에 겹쳐서 깔린다
  if (o.fly && vn < 0) {
    splat(o, qx, qy, f.r, nx, ny, events);
    return;
  }
  if (vn < 0) {
    o.vx -= (1 + E_BOBBLE) * vn * nx;
    o.vy -= (1 + E_BOBBLE) * vn * ny;
  }
}

function collidePair(a, b, w, events) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  const hasBall = a.kind === "ball" || b.kind === "ball";
  const aFlat = a.flatT !== undefined;
  const bFlat = b.flatT !== undefined;
  if (aFlat && bFlat) return;
  if (aFlat || bFlat) {
    collideFlat(aFlat ? a : b, aFlat ? b : a, events);
    return;
  }
  if (d2 >= rr * rr || d2 < 1e-12) return;
  const d = Math.sqrt(d2);
  let nx = dx / d;
  let ny = dy / d;
  // 불붙은 공은 끌고 가는 선수한테 밀리거나 꺾이지 않고 앞으로 밀어붙이기만 한다
  if (hasBall) {
    const ball = a.kind === "ball" ? a : b;
    const bob = ball === a ? b : a;
    if (ball.fire && bob.fly && (ball.fireHit || []).includes(bob.id)) {
      const s = bob === b ? 1 : -1;
      bob.x += s * nx * (rr - d);
      bob.y += s * ny * (rr - d);
      bob.vx = ball.vx;
      bob.vy = ball.vy;
      return;
    }
  }
  const ima = 1 / a.m;
  const imb = 1 / b.m;
  const overlap = rr - d;
  a.x -= (dx / d) * overlap * (ima / (ima + imb));
  a.y -= (dy / d) * overlap * (ima / (ima + imb));
  b.x += (dx / d) * overlap * (imb / (ima + imb));
  b.y += (dy / d) * overlap * (imb / (ima + imb));
  if (hasBall) {
    // 불붙은 공에 맞은 선수는 편 가리지 않고 공에 붙어 같이 날아간다 (step에서 공 속도를 따라감)
    const ball = a.kind === "ball" ? a : b;
    const bob = ball === a ? b : a;
    if (ball.fire && !(ball.fireHit || []).includes(bob.id)) {
      bob.vx = ball.vx;
      bob.vy = ball.vy;
      bob.fly = 1;
      ball.fireHit = [...(ball.fireHit || []), bob.id];
      if (events) events.push({ type: "burn", x: bob.x, y: bob.y, a: bob.id, team: bob.team });
      return;
    }
  }
  if (hasBall) {
    // 법선은 항상 a -> b 방향. 선수 쪽 면 방향으로 꺾는다.
    const bob = a.kind === "ball" ? b : a;
    const sgn = bob === a ? 1 : -1;
    const [fx, fy] = facetNormal(bob, nx * sgn, ny * sgn);
    nx = fx * sgn;
    ny = fy * sgn;
  }
  const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vrel >= 0) return;
  const e = hasBall ? ((a.beach || b.beach) ? E_BEACH : E_BALL) : E_BOBBLE;
  const j = (-(1 + e) * vrel) / (ima + imb);
  a.vx -= j * ima * nx;
  a.vy -= j * ima * ny;
  b.vx += j * imb * nx;
  b.vy += j * imb * ny;
  if (hasBall) {
    const bob = a.kind === "ball" ? b : a;
    const ball = a.kind === "ball" ? a : b;
    // 알 -> 공 방향 법선
    const kx = ball === b ? nx : -nx;
    const ky = ball === b ? ny : -ny;
    const push = bob.vx * kx + bob.vy * ky;
    if (push > 0) {
      const bs = Math.hypot(bob.vx, bob.vy) || 1;
      let dirx = kx * 0.6 + (bob.vx / bs) * 0.4;
      let diry = ky * 0.6 + (bob.vy / bs) * 0.4;
      const dl = Math.hypot(dirx, diry) || 1;
      dirx /= dl;
      diry /= dl;
      ball.vx += dirx * bob.kick * push;
      ball.vy += diry * bob.kick * push;
      // 파워슛: 불붙은 선수가 차면 공이 아주 빨라지고 불이 붙는다
      if (bob.power) {
        const s = Math.hypot(ball.vx, ball.vy) || 1;
        const want = Math.min(FIRE_MAX, Math.max(FIRE_SPEED, s * 1.7));
        ball.vx *= want / s;
        ball.vy *= want / s;
        ball.fire = 1;
        ball.fireV = want;
        ball.fireTeam = bob.team;
        ball.fireHit = [bob.id];
        if (events) events.push({ type: "blaze", x: ball.x, y: ball.y, a: bob.id, team: bob.team });
      }
    }
    w.lastTouch = bob.team;
    w.lastToucher = bob.id;
    if (events && j > 0.3) events.push({ type: "kick", x: a.x + nx * a.r, y: a.y + ny * a.r, a: bob.id, b: "ball", team: bob.team, impulse: j });
  } else {
    if (events && j > 0.4) events.push({ type: "bump", x: a.x + nx * a.r, y: a.y + ny * a.r, a: a.id, b: b.id, impulse: j, nx, ny });
  }
}

function collideBumper(b, p, events) {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const rr = b.r + BUMPER_R + 2 * BUMPER_TUBE;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 < 1e-12) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  b.x = p.x + nx * rr;
  b.y = p.y + ny * rr;
  if (b.fly && b.kind === "bobble") {
    splat(b, p.x, p.y, BUMPER_R + 2 * BUMPER_TUBE, nx, ny, events);
    return;
  }
  const vn = b.vx * nx + b.vy * ny;
  // 들어온 속도는 반사하고, 바깥 방향 속도가 최소 BUMPER_KICK이 되게 밀어낸다
  const out = Math.max(-vn, 0) + BUMPER_KICK * (b.kind === "ball" ? 1 : 0.75);
  b.vx += (out - vn) * nx;
  b.vy += (out - vn) * ny;
  if (events) events.push({ type: "bumper", x: p.x, y: p.y, body: b.id, kind: b.kind, speed: out });
}



export function step(w, events) {
  const bodies = w.bodies;
  const { halfL: L, goalHalfW: G } = FIELD;
  const tilt = tiltDir(w);
  const pulling = tiltPulling(w);
  if (tilt !== 0) w.fx.tiltT = (w.fx.tiltT || 0) + 1;
  const ball = getBall(w);
  for (const b of bodies) {
    if (b.flatT === undefined) continue;
    // 깔렸다가 FLAT_STEPS 뒤에 INFLATE_STEPS 동안 원래 크기로 부푼다 (벽이 밀어내서 저절로 벽에서 떨어진다)
    b.flatT++;
    const k = Math.min(1, Math.max(0, (b.flatT - FLAT_STEPS) / INFLATE_STEPS));
    b.r = FLAT_R + (b.fullR - FLAT_R) * k;
    if (k >= 1) {
      b.r = b.fullR;
      delete b.flatT;
      delete b.fullR;
      delete b.popped;
      // 다시 통통해진 선수는 불붙은 공에 또 맞으면 또 끌려가 깔린다
      if (ball.fireHit) ball.fireHit = ball.fireHit.filter((id) => id !== b.id);
    }
  }
  for (const b of bodies) {
    // 불붙은 공에 끌려가는 선수는 공 속도를 그대로 따라간다. 공이 벽에 튕겨 방향이 꺾이면 놓아준다.
    if (b.fly && ball.fire && b.kind === "bobble") {
      if (b.vx * ball.vx + b.vy * ball.vy > 0) {
        b.vx = ball.vx;
        b.vy = ball.vy;
      } else {
        b.fly = 0;
      }
    }
    // 불붙은 공은 속도를 출발 때 그대로 되돌린다 (벽·선수에 맞아 줄어든 만큼도)
    if (b.fire && b.fireV) {
      const s = Math.hypot(b.vx, b.vy);
      if (s > 1e-6) {
        b.vx *= b.fireV / s;
        b.vy *= b.fireV / s;
      }
    }
    const base = b.fire ? 0 : b.fly ? FIRE_MU : b.mu;
    const iced = w.fx.ice > 0 ? base * 0.3 : base;
    const mu = tilt !== 0 && !pulling && b.kind === "ball" ? iced * TILT_AFTER_MU : iced;
    // 운동장 기울이기: 공은 멈춰 있어도 내리막으로 밀린다. 마찰만큼 더 밀어서 남는 힘이 늘 TILT_PULL.
    const rolling = pulling && b.kind === "ball";
    if (rolling) b.vx += tilt * (mu + TILT_PULL) * DT;
    if (b.vx === 0 && b.vy === 0) continue;
    let sp = Math.hypot(b.vx, b.vy);
    const cap = b.fire || b.fly ? FIRE_MAX : MAX_SPEED;
    if (sp > cap) {
      b.vx *= cap / sp;
      b.vy *= cap / sp;
      sp = cap;
    }
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    const ns = sp - mu * DT;
    if (b.fire && ns < FIRE_OUT) b.fire = 0;
    if (b.fly && ns < 1.5) b.fly = 0;
    // 굴러가기 시작하는 아주 느린 공을 멈춤으로 끊어 버리면 영영 출발을 못 한다
    if (ns <= (rolling ? 0 : REST_SPEED)) {
      b.vx = 0;
      b.vy = 0;
    } else {
      b.vx *= ns / sp;
      b.vy *= ns / sp;
    }
    if (rolling) b.still = Math.max(ns, 0) < TILT_REST ? (b.still || 0) + 1 : 0;
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) collidePair(bodies[i], bodies[j], w, events);
  }
  for (const b of bodies) {
    for (const s of WALLS) collideSegment(b, s, events);
    for (const p of POSTS) collideWithPoint(b, p.x, p.y, FIELD.postR, "post", events);
    for (const p of BUMPERS) collideBumper(b, p, events);
  }
  // 아이템은 선수 몸에 닿아야 먹는다 (공은 안 됨)
  if (w.items.length) {
    for (const b of bodies) {
      if (b.kind !== "bobble") continue;
      for (let i = w.items.length - 1; i >= 0; i--) {
        const it = w.items[i];
        if (Math.hypot(b.x - it.x, b.y - it.y) < b.r + ITEM_R) {
          w.items.splice(i, 1);
          w.picked.push({ id: it.id, type: it.type, team: b.team });
          if (events) events.push({ type: "pickup", id: it.id, item: it.type, team: b.team, x: it.x, y: it.y, body: b.id });
        }
      }
    }
  }
  if (!w.goal && Math.abs(ball.y) < G) {
    let side = null;
    if (ball.x > L + ball.r) side = "home";
    else if (ball.x < -L - ball.r) side = "away";
    if (side) {
      w.goal = w.fx.swap > 0 ? (side === "home" ? "away" : "home") : side;
      // 그물이 공을 받아 준다 (불붙은 공이 그물에 튕겨 경기장을 가로질러 돌아오지 않게)
      ball.fire = 0;
      ball.vx *= 0.35;
      ball.vy *= 0.35;
      if (events) events.push({ type: "goal", team: w.goal, x: ball.x, y: ball.y, ownGoal: !!w.lastTouch && w.lastTouch !== w.goal, scorer: w.lastToucher });
    }
  }
  w.t += DT;
}

// 시작 포지션. 좌표는 [자기 골대 쪽으로 떨어진 거리, 폭 방향(+가 공격 방향 기준 오른쪽)].
// 선공은 따로 없고, 매 킥오프마다 양 팀 모두 고른 포메이션 자리에서 시작한다.
export const FORMATIONS = {
  attack: {
    name: "공격형", desc: "수비 1 · 공격 2",
    slots: { a: { label: "수비", pos: [10, 0] }, b: { label: "왼쪽 공격", pos: [5.5, -5.5] }, c: { label: "오른쪽 공격", pos: [5.5, 5.5] } },
  },
  defend: {
    name: "수비형", desc: "수비 2 · 공격 1",
    slots: { a: { label: "왼쪽 수비", pos: [11, -4.5] }, b: { label: "오른쪽 수비", pos: [11, 4.5] }, c: { label: "공격", pos: [5.5, 0] } },
  },
  diagonal: {
    name: "사선", desc: "대각선 한 줄",
    slots: { a: { label: "뒤", pos: [11.5, -4.5] }, b: { label: "가운데", pos: [8.5, 0] }, c: { label: "앞", pos: [5.5, 4.5] } },
  },
};
export const GK_SPOT = [15.5, 0];

// teams[team] = { formation, members: { gk, a, b, c } } (member = { id, stats })
export function kickoffBodies(teams) {
  const bodies = [];
  for (const team of ["home", "away"]) {
    const s = team === "home" ? -1 : 1;
    const flip = team === "home" ? 1 : -1;
    const { formation, members } = teams[team];
    const slots = FORMATIONS[formation].slots;
    const gk = members.gk;
    bodies.push(makeBobble(`${team}-gk`, team, "gk", s * GK_SPOT[0], GK_SPOT[1], gk.stats, gk.id));
    for (const key of ["a", "b", "c"]) {
      const [x, y] = slots[key].pos;
      const p = members[key];
      bodies.push(makeBobble(`${team}-${key}`, team, key, s * x, flip * y, p.stats, p.id));
    }
  }
  bodies.push(makeBall(0, 0));
  return bodies;
}
