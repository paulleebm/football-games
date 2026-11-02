import { FIELD, BALL_R, cloneWorld, applyMoves, step, isSettled, getBall } from "./physics.js";

// CPU 플래너. 물리를 그대로 복제해서 후보 수를 끝까지 시뮬레이션해 보고 점수가 좋은
// 조합을 남기는 언덕 오르기 방식이다. 상대(사람)의 이번 수는 모르니까 "가만히 있음"과
// "공에 제일 가까운 선수가 우리 골대로 찬다" 두 경우를 섞어서 평가한다.
// work(ms)를 매 프레임 조금씩 불러서 화면이 끊기지 않게 한다.

const LEVELS = {
  easy: { iters: 60, aimErr: 10, powErr: 0.16, explore: 0.5 },
  normal: { iters: 220, aimErr: 4.5, powErr: 0.08, explore: 0.3 },
  hard: { iters: 500, aimErr: 1.6, powErr: 0.035, explore: 0.2 },
};
const SIM_LIMIT = Math.round(6 / (1 / 120));

const rand = (a, b) => a + Math.random() * (b - a);

function moveTo(b, tx, ty, extra = 0) {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return null;
  return { dx: dx / d, dy: dy / d, power: Math.max(0.04, Math.min(1, (d + extra) / b.maxShot)) };
}

// 공을 (tx, ty) 쪽으로 보내려면 공 뒤쪽 접점을 향해 달려야 한다
function shotMove(b, ball, tx, ty, extra) {
  const ux = tx - ball.x;
  const uy = ty - ball.y;
  const ul = Math.hypot(ux, uy) || 1;
  const cx = ball.x - (ux / ul) * (b.r + BALL_R) * 0.92;
  const cy = ball.y - (uy / ul) * (b.r + BALL_R) * 0.92;
  return moveTo(b, cx, cy, extra);
}

function simulate(world, moves) {
  const w = cloneWorld(world);
  applyMoves(w, moves);
  for (let i = 0; i < SIM_LIMIT; i++) {
    step(w, null);
    if (w.goal || isSettled(w)) break;
  }
  return w;
}

export function createPlanner(world, team, level = "normal") {
  const cfg = LEVELS[level] || LEVELS.normal;
  const other = team === "home" ? "away" : "home";
  // 공격 방향. 골대 바꾸기가 걸려 있으면 반대쪽 골대를 노린다.
  const atk = (team === "home" ? 1 : -1) * (world.fx.swap > 0 ? -1 : 1);
  const { halfL: L, halfW: W, goalHalfW: G } = FIELD;
  const goalX = atk * L;
  const ownX = -atk * L;
  const ball = getBall(world);
  const mine = world.bodies.filter((b) => b.kind === "bobble" && b.team === team);
  const theirs = world.bodies.filter((b) => b.kind === "bobble" && b.team === other);
  const dist = (a, x, y) => Math.hypot(a.x - x, a.y - y);

  // 상대가 할 법한 수: 공에 제일 가까운 선수가 우리 골대 가운데로 슛
  const threat = {};
  const nearOpp = [...theirs].sort((a, b) => dist(a, ball.x, ball.y) - dist(b, ball.x, ball.y))[0];
  if (nearOpp) {
    const mv = shotMove(nearOpp, ball, ownX, 0, 6);
    if (mv) threat[nearOpp.id] = mv;
  }

  function candidates(b) {
    const list = [null];
    for (let k = 0; k < 4; k++) {
      const ty = rand(-G * 0.8, G * 0.8);
      const mv = shotMove(b, ball, goalX + atk * 1.5, ty, rand(3, 10));
      if (mv) list.push(mv);
    }
    for (const sy of [-1, 1]) {
      const mv = shotMove(b, ball, atk * L * 0.3, sy * W, rand(3, 8));
      if (mv) list.push(mv);
    }
    for (const f of b.role === "gk" ? [0.08, 0.16] : [0.25, 0.5]) {
      const px = ownX + (ball.x - ownX) * f;
      const py = ball.y * f * (b.role === "gk" ? 0.6 : 1);
      const mv = moveTo(b, px, py);
      if (mv) list.push(mv);
    }
    if (nearOpp) {
      const mv = moveTo(b, nearOpp.x, nearOpp.y, 4);
      if (mv) list.push(mv);
    }
    for (const it of world.items) {
      const mv = moveTo(b, it.x, it.y, 1.5);
      if (mv) list.push(mv);
    }
    for (let k = 0; k < 2; k++) {
      const a = rand(0, Math.PI * 2);
      list.push({ dx: Math.cos(a), dy: Math.sin(a), power: rand(0.2, 1) });
    }
    return list;
  }

  function score(w) {
    if (w.goal === team) return 1000 - w.t * 10;
    if (w.goal === other) return -1500;
    // 아이템 상자를 먼저 먹는 것도 이득 (상대가 먹으면 손해)
    let itemBonus = 0;
    for (const p of w.picked) itemBonus += p.team === team ? 45 : -35;
    const bl = getBall(w);
    let s = bl.x * atk * 9;
    const dOwn = Math.hypot(bl.x - ownX, bl.y);
    if (dOwn < 11) s -= (11 - dOwn) * 28;
    const dGoal = Math.hypot(bl.x - goalX, bl.y);
    if (dGoal < 9) s += (9 - dGoal) * 12;
    let myMin = 1e9;
    let thMin = 1e9;
    for (const b of w.bodies) {
      if (b.kind !== "bobble") continue;
      const d = Math.hypot(b.x - bl.x, b.y - bl.y);
      if (b.team === team) {
        myMin = Math.min(myMin, d);
        if (b.role === "gk") {
          const gx = ownX + atk * 1.8;
          s -= Math.hypot(b.x - gx, b.y - bl.y * 0.25) * 9;
        }
        // 공보다 우리 골대 쪽에 있는 선수는 수비에 도움이 된다
        if ((b.x - bl.x) * atk < 0) s += 6;
      } else {
        thMin = Math.min(thMin, d);
      }
    }
    s += Math.max(-10, Math.min(10, thMin - myMin)) * 4;
    return s + itemBonus;
  }

  function evaluate(plan) {
    const a = score(simulate(world, plan));
    const b = score(simulate(world, { ...plan, ...threat }));
    return a * 0.55 + b * 0.45;
  }

  // 역할 기반 초기 수: 골키퍼는 골문, 공에 제일 가까운 선수는 슛, 나머지는 받쳐준다
  const plan = {};
  const byBall = [...mine].sort((a, b) => dist(a, ball.x, ball.y) - dist(b, ball.x, ball.y));
  const striker = byBall.find((b) => b.role !== "gk") || byBall[0];
  for (const b of mine) {
    let mv = null;
    if (b === striker) mv = shotMove(b, ball, goalX + atk * 1.5, rand(-1.5, 1.5), 6);
    else if (b.role === "gk") mv = moveTo(b, ownX + atk * 1.8, ball.y * 0.12);
    else if (b.role === "a") mv = moveTo(b, ownX + (ball.x - ownX) * 0.4, ball.y * 0.4);
    plan[b.id] = mv;
  }
  const cand = new Map(mine.map((b) => [b.id, candidates(b)]));
  let best = evaluate(plan);
  let iter = 0;

  function iterate() {
    // 공 근처 선수를 더 자주 손본다
    const weights = mine.map((b) => 1 / (1 + dist(b, ball.x, ball.y) * 0.15));
    let r = Math.random() * weights.reduce((x, y) => x + y, 0);
    let pick = mine[0];
    for (let i = 0; i < mine.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = mine[i];
        break;
      }
    }
    const cur = plan[pick.id];
    let next;
    if (cur && Math.random() > cfg.explore) {
      const a = Math.atan2(cur.dy, cur.dx) + rand(-0.14, 0.14);
      next = { dx: Math.cos(a), dy: Math.sin(a), power: Math.max(0.04, Math.min(1, cur.power + rand(-0.12, 0.12))) };
    } else {
      const list = cand.get(pick.id);
      next = list[Math.floor(Math.random() * list.length)];
    }
    const trial = { ...plan, [pick.id]: next };
    const s = evaluate(trial);
    if (s > best) {
      best = s;
      plan[pick.id] = next;
    }
    iter++;
  }

  return {
    get done() {
      return iter >= cfg.iters;
    },
    work(ms) {
      const end = performance.now() + ms;
      while (iter < cfg.iters && performance.now() < end) iterate();
    },
    // 실행 오차를 섞어서 최종 수를 낸다 (난이도별로 조준이 흔들림)
    result() {
      const out = {};
      for (const [id, mv] of Object.entries(plan)) {
        if (!mv) continue;
        const a = Math.atan2(mv.dy, mv.dx) + (rand(-1, 1) * cfg.aimErr * Math.PI) / 180;
        out[id] = { dx: Math.cos(a), dy: Math.sin(a), power: Math.max(0.03, Math.min(1, mv.power * (1 + rand(-1, 1) * cfg.powErr))) };
      }
      return out;
    },
  };
}
