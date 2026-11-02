import { FIELD, BALL_R, BALL_MU, getBall, cloneWorld, applyMoves, step, isSettled } from "./physics.js";

// 아이템: 경기 중 필드에 보라 상자로 떠오르고, 선수 몸에 닿은 팀이 가져간다.
// 계획 단계에서 한 턴에 여러 개도 쓸 수 있고, 쓰는 순간 바로 적용된다. 모두 골이 더 잘 나는 쪽으로 맞췄다.
// 비치볼·빙판은 누가 또 쓰든 2턴씩 늘어나고, 골대 바꾸기는 또 쓰면 원래대로,
// 운동장 기울이기는 상대가 쓰면 평평하게 돌아가고, VAR은 그 턴에 먼저 쓴 한 명만.
// 한 팀이 같은 아이템을 겹쳐 가질 수는 없다 (pickupType).
//   target "mine" = 내 선수 하나 / "opp" = 상대 선수 하나 / null = 대상 없음

// 아이콘 그림은 icons.js (아이템 이름과 같은 키). iconIsName = 아이콘 글자가 곧 이름(VAR)
export const ITEMS = {
  power: { target: "mine", desc: "파워샷: 슛이 강력해져요" },
  beach: { target: null, desc: "비치볼: 2턴 동안 공이 가벼워져요" },
  swap: { target: null, desc: "골대 바꾸기: 2턴 동안 두 골대가 바뀌어요" },
  reset: { target: null, desc: "찬스볼: 공을 골 넣기 좋은 자리로 옮겨요" },
  ice: { target: null, desc: "빙판: 2턴 동안 경기장이 미끄러워져요" },
  tilt: { target: null, desc: "운동장 기울이기: 운동장을 상대 골대 쪽으로 기울여요" },
  red: { target: "opp", desc: "레드카드: 상대 선수 한 명을 이번 턴 동안 퇴장시켜요" },
  var: { target: null, iconIsName: true, desc: "VAR: 직전 턴으로 되감고 나만 다시 정해요" },
};
export const ITEM_TYPES = Object.keys(ITEMS);
export const MAX_HELD = 3;
const MAX_ON_FIELD = 2;

// 설명 한 줄. 효과가 이미 걸려 있을 때만 또 쓰면 어떻게 되는지 덧붙인다. team = 설명을 보는 쪽
export function itemDesc(type, w, team) {
  const d = ITEMS[type].desc;
  if (!w) return d;
  if (type === "beach" && getBall(w).beach > 0) return `${d} (지금 쓰면 2턴 연장)`;
  if (type === "ice" && w.fx.ice > 0) return `${d} (지금 쓰면 2턴 연장)`;
  if (type === "swap" && w.fx.swap > 0) return "골대 바꾸기: 바뀐 골대를 원래대로 돌려놔요";
  if (type === "tilt" && w.fx.tilt > 0 && w.fx.tiltBy !== team) return "운동장 기울이기: 기울어진 운동장을 평평하게 되돌려요";
  return d;
}

// 한 팀은 같은 아이템을 두 개 갖지 않는다. 이미 가진 걸 먹으면 아직 없는 것 중 하나로 바뀐다.
// 상자 id로 고르니 온라인 양쪽 결과가 같다. 손이 꽉 차 있으면 못 먹는다(null).
//
// 역전 도우미(화면엔 안 보임): 상자 안은 먹는 순간 정해지니, 지고 있는 팀이 먹으면 일정 확률로
// 역전하기 좋은 아이템이 나온다. 질수록, 경기 끝이 가까울수록 확률이 오른다. 이기는 팀은 평소대로.
// edge = { behind: 상대 점수 - 내 점수, late: 막판(후반·골든골)인지 }
const COMEBACK = ["power", "reset", "tilt", "red"];

function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function comebackChance(edge) {
  if (!edge || edge.behind <= 0) return 0;
  return Math.min(0.9, (edge.behind >= 2 ? 0.8 : 0.55) + (edge.late ? 0.15 : 0));
}

export function pickupType(held, type, id, edge) {
  if (held.length >= MAX_HELD) return null;
  const help = COMEBACK.filter((t) => !held.includes(t));
  if (help.length && hashOf(`${id}:luck`) / 2 ** 32 < comebackChance(edge)) return help[hashOf(`${id}:pick`) % help.length];
  if (!held.includes(type)) return type;
  const left = ITEM_TYPES.filter((t) => !held.includes(t));
  return left[hashOf(id) % left.length];
}

// use = { type, team, target }
export function applyLaunchItem(w, use) {
  switch (use.type) {
    case "power": {
      // 이번 턴 동안 이 선수가 공을 차면 불붙은 파워슛이 된다 (physics.js)
      const b = w.bodies.find((x) => x.id === use.target && x.team === use.team && x.kind === "bobble");
      if (!b || b.power) return;
      b.power = 1;
      break;
    }
    case "beach": {
      const ball = getBall(w);
      // 크기는 그대로, 가볍고 덜 멈추고 벽·선수에 맞으면 거의 그대로 튕긴다 (physics.js)
      ball.beach = (ball.beach || 0) + 2;
      ball.m = 0.22;
      ball.mu = 2.6;
      break;
    }
    case "red": {
      // 이번 턴 동안 경기장에서 빠진다. 턴이 끝나면 원래 자리(막혀 있으면 옆)로 돌아온다.
      const i = w.bodies.findIndex((x) => x.id === use.target && x.kind === "bobble" && x.team !== use.team);
      if (i < 0) return;
      const [b] = w.bodies.splice(i, 1);
      b.vx = 0;
      b.vy = 0;
      b.red = 1;
      (w.bench = w.bench || []).push(b);
      break;
    }
    case "swap":
      // 이미 바뀐 상태에서 또 쓰면 원래대로 돌아간다
      w.fx.swap = w.fx.swap > 0 ? 0 : 2;
      break;
    case "ice":
      w.fx.ice = (w.fx.ice || 0) + 2;
      break;
    case "tilt":
      // 상대가 기울여 놓았으면 평평하게, 아니면 이번 턴 동안 내 쪽을 높인다 (공 굴리기는 physics.js)
      if (w.fx.tilt > 0 && w.fx.tiltBy !== use.team) {
        w.fx.tilt = 0;
        delete w.fx.tiltBy;
        delete w.fx.tiltX;
      } else {
        w.fx.tilt = 1;
        w.fx.tiltBy = use.team;
        // 지금 노리는 골대 쪽으로 기운다 (이후 골대 바꾸기와 상관없이 고정)
        w.fx.tiltX = (use.team === "home" ? 1 : -1) * (w.fx.swap > 0 ? -1 : 1);
        w.fx.tiltT = 0;
      }
      delete getBall(w).still;
      break;
    default:
  }
}

// 찬스볼: 내 선수 하나가 골대를 보고 바로 찰 수 있는 자리 중, 실제로 차 봤을 때(상대는 가만히)
// 골이 제일 잘 나는 곳에 공을 놓는다. 난수 없이 같은 월드면 같은 자리라 온라인 양쪽 결과가 같다.
export function resetBall(w, team) {
  const ball = getBall(w);
  const spot = bestBallSpot(w, team) || fallbackSpot(w, team);
  ball.x = spot[0];
  ball.y = spot[1];
  ball.vx = 0;
  ball.vy = 0;
}

function spotFree(w, ball, x, y) {
  const { halfL: L, halfW: W } = FIELD;
  if (Math.abs(x) > L - 1.6 || Math.abs(y) > W - 1.2) return false;
  // 모서리 범퍼 근처는 피한다
  if (Math.abs(x) > L - 4 && Math.abs(y) > W - 4) return false;
  return w.bodies.every((b) => b === ball || Math.hypot(b.x - x, b.y - y) > b.r + ball.r + 0.15);
}

function bestBallSpot(w, team) {
  const ball = getBall(w);
  // 골대가 바뀌어 있으면 지금 노리는 골대 쪽으로
  const dir = (team === "away" ? -1 : 1) * (w.fx.swap > 0 ? -1 : 1);
  const goalX = dir * FIELD.halfL;
  let best = null;
  for (const b of w.bodies) {
    if (b.kind !== "bobble" || b.team !== team) continue;
    for (const aimY of [-3.2, -1.6, 0, 1.6, 3.2]) {
      let ux = goalX - b.x;
      let uy = aimY - b.y;
      const len = Math.hypot(ux, uy);
      ux /= len;
      uy /= len;
      // 골대 반대쪽을 보고 있으면 안 된다
      if (ux * dir < 0.35) continue;
      for (const gap of [0.35, 1.2, 2.4]) {
        const d = b.r + ball.r + gap;
        const x = b.x + ux * d;
        const y = b.y + uy * d;
        if (!spotFree(w, ball, x, y)) continue;
        // 사람 손이 조금 빗나가도 들어가는 자리가 좋은 자리다
        let goals = 0;
        for (const [power, err] of [[1, 0], [0.85, 0.07], [0.85, -0.07], [0.7, 0]]) {
          const sim = cloneWorld(w);
          sim.goal = null;
          const sb = getBall(sim);
          sb.x = x;
          sb.y = y;
          for (const o of sim.bodies) {
            o.vx = 0;
            o.vy = 0;
          }
          const c = Math.cos(err);
          const sn = Math.sin(err);
          applyMoves(sim, { [b.id]: { dx: ux * c - uy * sn, dy: ux * sn + uy * c, power } });
          for (let i = 0; i < 900 && !sim.goal && !isSettled(sim); i++) step(sim, null);
          if (sim.goal === team) goals++;
        }
        // 골이 나는 자리 우선, 같으면 골대에 가까운 자리
        const score = goals * 100 - Math.hypot(goalX - x, y);
        if (!best || score > best.score) best = { score, x, y, goals };
      }
    }
  }
  return best && best.goals > 0 ? [best.x, best.y] : null;
}

// 마땅한 자리가 없으면 예전처럼 공격 진영 한가운데 근처
function fallbackSpot(w, team) {
  const ball = getBall(w);
  const x = (team === "away" ? -1 : 1) * (w.fx.swap > 0 ? -1 : 1) * FIELD.halfL * 0.42;
  const spots = [[x, 0], [x, 3], [x, -3], [x * 0.75, 0], [x * 0.75, 3], [x * 0.75, -3], [0, 0]];
  return spots.find(([sx, sy]) => spotFree(w, ball, sx, sy)) || spots[0];
}

// 턴이 끝날 때마다 효과 남은 턴을 줄이고 끝난 건 원래대로
export function tickEffects(w) {
  for (const b of w.bodies) {
    if (b.power && --b.power <= 0) delete b.power;
    delete b.fire;
    delete b.fireTeam;
    delete b.fireV;
    delete b.fireHit;
    delete b.fly;
    if (b.flatT !== undefined) {
      b.r = b.fullR;
      delete b.flatT;
      delete b.fullR;
      delete b.popped;
    }
  }
  if (w.bench && w.bench.length) {
    const back = w.bench.filter((b) => --b.red <= 0);
    w.bench = w.bench.filter((b) => b.red > 0);
    for (const b of back) {
      delete b.red;
      placeFree(w, b);
      w.bodies.push(b);
    }
  }
  const ball = getBall(w);
  delete ball.still;
  if (ball.beach && --ball.beach <= 0) {
    ball.r = BALL_R;
    ball.m = 0.35;
    ball.mu = BALL_MU;
    delete ball.beach;
  }
  if (w.fx.swap > 0) w.fx.swap--;
  if (w.fx.ice > 0) w.fx.ice--;
  if (w.fx.tilt > 0 && --w.fx.tilt <= 0) {
    delete w.fx.tiltBy;
    delete w.fx.tiltX;
    delete w.fx.tiltT;
  }
}

// 돌아오는 선수: 원래 자리가 막혀 있으면 그 둘레에서 빈 곳을 찾는다
function placeFree(w, b) {
  const free = (x, y) => Math.abs(x) < FIELD.halfL - b.r && Math.abs(y) < FIELD.halfW - b.r
    && w.bodies.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + b.r + 0.1);
  if (free(b.x, b.y)) return;
  for (let ring = 1; ring <= 8; ring++) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = b.x + Math.cos(a) * ring * 0.8;
      const y = b.y + Math.sin(a) * ring * 0.8;
      if (free(x, y)) {
        b.x = x;
        b.y = y;
        return;
      }
    }
  }
}

// 상대 선수가 레드카드로 빠질 수 있나
export function canRed(w, team, id) {
  return w.bodies.some((x) => x.id === id && x.kind === "bobble" && x.team !== team);
}

// 그 팀 선수 중 제일 가까운 선수 몸까지의 거리
function nearestOf(w, team, x, y) {
  let d = Infinity;
  for (const b of w.bodies) if (b.kind === "bobble" && b.team === team) d = Math.min(d, Math.hypot(b.x - x, b.y - y) - b.r);
  return d;
}

// 빈자리에 아이템 하나 띄우기. rand는 0..1 난수 함수 (온라인은 방장 쪽 Math.random)
// 양 팀에 공평하게: 빈자리 후보 중 두 팀의 가장 가까운 선수까지 거리가 제일 비슷한 곳에 놓는다.
export function spawnItem(w, rand = Math.random, maxOnField = MAX_ON_FIELD) {
  if (w.items.length >= maxOnField) return null;
  let best = null;
  for (let k = 0; k < 40; k++) {
    const x = (rand() * 2 - 1) * 11;
    const y = (rand() * 2 - 1) * 8;
    const clear = w.bodies.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + 2.2)
      && w.items.every((it) => Math.hypot(it.x - x, it.y - y) > 4);
    if (!clear) continue;
    const gap = Math.abs(nearestOf(w, "home", x, y) - nearestOf(w, "away", x, y));
    if (!best || gap < best.gap) best = { x, y, gap };
  }
  if (!best) return null;
  // id도 rand로 만들어서 같은 난수를 쓰는 양쪽 화면이 같은 상자를 갖게 한다
  const it = { id: `i${Math.floor(rand() * 2 ** 31).toString(36)}`, type: ITEM_TYPES[Math.floor(rand() * ITEM_TYPES.length)], x: best.x, y: best.y };
  w.items.push(it);
  return it;
}

// 파워슛은 이미 불붙은 선수에겐 못 쓴다
export function canPower(w, team, id) {
  const b = w.bodies.find((x) => x.id === id && x.team === team && x.kind === "bobble");
  return !!b && !b.power;
}

// CPU 아이템 판단. 상황이 맞을 때만 쓰고, 한 턴에 여러 개를 쓸 수도 있다.
export function cpuPickItem(w, team, held, { concededLast, canVar }) {
  if (!held.length) return null;
  const atk = team === "home" ? 1 : -1;
  const ball = getBall(w);
  const ownX = -atk * FIELD.halfL;
  const dOwn = Math.hypot(ball.x - ownX, ball.y);
  const mine = w.bodies.filter((b) => b.kind === "bobble" && b.team === team);
  const has = (t) => held.includes(t);
  const nearField = mine.filter((b) => !b.power).sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
  if (has("var") && concededLast && canVar) return { type: "var" };
  // 공이 우리 골문 가까이 있으면 골대를 바꿔서 오히려 득점 기회로
  if (has("swap") && dOwn < 7 && !(w.fx.swap > 0)) return { type: "swap" };
  // 상대가 바꿔 놓은 골대 앞에 공이 있으면 다시 원래대로
  if (has("swap") && w.fx.swap > 0 && Math.hypot(ball.x + ownX, ball.y) < 7) return { type: "swap" };
  if (has("reset") && dOwn < 20) return { type: "reset" };
  if (has("power") && nearField && Math.hypot(nearField.x - ball.x, nearField.y - ball.y) < 7) return { type: "power", target: nearField.id };
  // 레드카드: 공이 상대 골문 가까이면 키퍼를, 아니면 공에 제일 가까운 상대를 뺀다
  if (has("red")) {
    const theirs = w.bodies.filter((b) => b.kind === "bobble" && b.team !== team);
    const dTheirGoal = Math.hypot(ball.x + ownX, ball.y);
    const gk = theirs.find((b) => b.role === "gk");
    // 골대가 바뀌어 있으면 상대 키퍼는 우리가 노리는 골문 앞에 없다
    if (gk && !(w.fx.swap > 0) && dTheirGoal < 12) return { type: "red", target: gk.id };
    const near = theirs.sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
    if (near && Math.hypot(near.x - ball.x, near.y - ball.y) < 6) return { type: "red", target: near.id };
  }
  // 운동장 기울이기: 상대가 기울여서 공이 우리 골대로 굴러올 판이면, 골대 바꾸기가 있으면 그걸로 역이용하고
  // 없으면 기울이기로 평평하게. 아니면 공이 상대 골문 정면 쪽에 있을 때 가끔 우리가 기울인다.
  if (w.fx.tilt > 0 && w.fx.tiltBy !== team) {
    const myGoalX = -atk * (w.fx.swap > 0 ? -1 : 1);
    if (w.fx.tiltX === myGoalX) {
      if (has("swap")) return { type: "swap" };
      if (has("tilt")) return { type: "tilt" };
    }
  }
  if (has("tilt") && !(w.fx.tilt > 0) && Math.abs(ball.y) < FIELD.goalHalfW + 2 && Math.random() < 0.45) return { type: "tilt" };
  if (has("ice") && Math.random() < 0.35) return { type: "ice" };
  if (has("beach") && Math.random() < 0.3) return { type: "beach" };
  return null;
}
