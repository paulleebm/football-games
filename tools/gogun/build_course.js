// 고군분투 코스 생성기. 실행: node tools/gogun/build_course.js
// 고정 시드로 4단계 고정 코스와, 그 뒤 무한 구간에 쓸 "구간 묶음(pool)"을 만들어 public/gogun/course.js에 써 둔다.
// 게임은 고정 4단계까지는 이 코스를 그대로 달리고, 그 뒤로는 sim.js의 extendWorld가 묶음에서 구간을 골라
// 끝없이 이어 붙인다 (이 순서도 고정 시드라 누구나 같은 코스를 달린다).
//
// 구간 묶음은 속도대(11~14)별로 나눠 만들고, 구간마다 그 속도대의 가장 느린/빠른 속도 양쪽에서,
// 앞 지붕 끝에 늦게 내려선 경우와 빠르게 내려선 경우 모두 깰 수 있는지 확인한다. 속도대 5개는
// 자식 프로세스로 동시에 만든다. 마지막에 게임과 똑같이 이어 붙인 무한 구간을 처음부터 다시 풀어 본다.
//
// 구간 하나를 붙일 때마다 실제 물리(sim.js)로 풀어서
//  1) 깰 수 있는 입력이 있는지, 그 입력의 타이밍 여유(앞뒤로 몇 프레임 틀려도 되는지)가 단계 기준 이상인지 확인하고
//  2) 그 입력의 궤적을 따라 안내 동전(은화/금화)을 놓고
//  3) 함정 은화는 "죽는 궤적" 위에 놓은 뒤, 무작위 입력 수천 개로 먹고 살아남을 방법이 없는 것만 남긴다.
// 구간별 정답 입력을 이어 붙인 것이 기준 플레이(ref)다. 마지막에 처음부터 끝까지 다시 돌려서
// 완주하는지, 금화를 전부 먹는지, 함정 은화는 하나도 안 먹는지 확인한다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const S = require("../../public/gogun/sim.js");
const { C } = S;

const SEED = +process.env.SEED || 33;
const OUT = process.env.OUT; // 시험용: 다른 파일에 쓰기
const BAND = process.env.POOL_BAND; // 자식 프로세스: 이 속도대의 구간 묶음만 만든다
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(BAND == null ? SEED : SEED * 1000 + 7919 * (+BAND + 1));
const U = (a, b) => a + (b - a) * rng();
const pick = (mix) => {
  let r = rng() * Object.values(mix).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(mix)) if ((r -= v) <= 0) return k;
  return Object.keys(mix)[0];
};
const r2 = (v) => Math.round(v * 100) / 100;
const T_AIR = (2 * C.JUMP) / C.G;

// len: 단계 길이(단위), w: 지붕 길이(초 단위 달리기 시간), gap: 맨점프 틈 비율(점프 거리 대비),
// win: 타이밍 여유 기준(±프레임, 120Hz), gold: 안내 동전이 금화일 확률, guide: 안내 동전을 놓을 확률,
// ground: 지붕 위 달리기 동전 확률, trap: 함정 동전 줄을 놓을 확률, goldTrap: 함정 줄이 금화일 확률,
// fake: 탑 구간에 가짜 탑(잡으면 거의 못 사는 탑)을 하나 넣을 확률
// 초반이 지루하다는 피드백으로 원래 1·2단계(맨 점프만 있던 쉬운 단계)는 뺐다. 원래 3단계부터 시작한다
const STAGES = [
  { len: 250, w: [0.55, 1.2], gap: [0.5, 0.8], mix: { gap: 0.4, t1: 0.35, t2: 0.25 }, win: 8, gold: 0.3, guide: 0.8, ground: 0.4, trap: 0.5, goldTrap: 0.3, fake: 0 },
  { len: 310, w: [0.5, 1.1], gap: [0.5, 0.82], mix: { gap: 0.25, t1: 0.2, t2: 0.25, t3: 0.3 }, win: 7, gold: 0.45, guide: 0.7, ground: 0.3, trap: 0.7, goldTrap: 0.4, fake: 0.15 },
  { len: 380, w: [0.45, 1.0], gap: [0.55, 0.85], mix: { gap: 0.15, steps: 0.2, t2: 0.15, t3: 0.2, chain: 0.3 }, win: 6, gold: 0.7, guide: 0.6, ground: 0.2, trap: 0.9, goldTrap: 0.5, fake: 0.25 },
  { len: 450, w: [0.45, 0.9], gap: [0.55, 0.85], mix: { gap: 0.1, steps: 0.15, t3: 0.25, chain: 0.5 }, win: 5, gold: 0.85, guide: 0.6, ground: 0.1, trap: 1.0, goldTrap: 0.6, fake: 0.3 },
];
// 무한 구간 설정: 속도대 [최저, 최고] (마지막은 최고 속도 고정), 속도대마다 구간 수, 구간 끝 지붕 길이(초)
const ENDLESS = { w: [0.45, 0.9], gap: [0.55, 0.85], mix: { gap: 0.12, steps: 0.15, t2: 0.15, t3: 0.25, chain: 0.33 }, win: 5, gold: 0.85, guide: 0.6, ground: 0.1, trap: 0.8, goldTrap: 0.6, fake: 0.3 };
const BANDS = [[11.0, 11.75], [11.75, 12.5], [12.5, 13.25], [13.25, 14.0], [14.0, 14.0]];
const POOL_N = +process.env.POOL_N || 24;
const EXIT_T = 0.9; // 도착 지붕을 좁게: 와이어를 언제 놓느냐가 중요해지게

let w = { roofs: [], towers: [], coins: [], stages: [], mul: 1 }; // 지금 만드는 세계 (구간 묶음을 만들 때는 잠깐 바꿔 쓴다)
const trapSet = new Set(); // 함정 은화 (검증용, 데이터에는 표시 안 함)
const ref = []; // 기준 플레이: [누름, 뗌] 전역 프레임 쌍
const checkpoints = []; // 구간마다 착지 [전역 프레임, x] (전체 재생이 구간 풀이와 같은지 확인)
const stats = STAGES.map(() => ({ chunks: {}, wins: [], traps: 0, silver: 0, gold: 0, retries: 0 }));

function addRoof(x0, width, top, s) {
  const r = { x0: r2(x0), x1: r2(x0 + width), top: r2(top), s };
  w.roofs.push(r);
  return w.roofs.length - 1;
}
function addTower(x, top) {
  // 탑은 x 순서로 정렬돼 있어야 한다 (findTower의 이진 탐색)
  const t = { x: r2(x), top: r2(top) };
  let i = w.towers.length;
  while (i > 0 && w.towers[i - 1].x > t.x) i--;
  w.towers.splice(i, 0, t);
  return t;
}
// 진짜 탑: 틈(x0~x1) 위에 간격 sp로 꼭 필요한 만큼만. 풀리지 않으면 sp를 줄여 다시 놓는다
function placeTowers(x0, x1, top, sp) {
  let x = x0 + sp * U(0.45, 0.6);
  do { addTower(x, top + U(5.2, 7.5)); x += sp * U(0.9, 1.1); } while (x < x1 - sp * 0.3);
}
function addCoin(x, y, g, trap) {
  // 동전은 x 순서로 정렬돼 있어야 한다 (pickCoins의 이진 탐색). t: 함정 동전
  const c = { x: r2(x), y: r2(y), g: g ? 1 : 0, t: trap ? 1 : 0 };
  let i = w.coins.length;
  while (i > 0 && w.coins[i - 1].x > c.x) i--;
  w.coins.splice(i, 0, c);
  return c;
}

const cloneP = (p) => ({ ...p, hang: p.hang ? { ...p.hang } : null });

// pairs: [[누름, 뗌], ...] (시작 상태 기준 상대 프레임). 착지하거나 죽거나 maxF가 되면 멈춘다.
function simulate(start, pairs, opts = {}) {
  const p = cloneP(start);
  p.held = false;
  const maxF = opts.maxF || 900;
  const trail = opts.trail ? [] : null;
  const watch = opts.watch; // [{x,y}] 이 점들에 닿았는지
  const hit = watch ? new Uint8Array(watch.length) : null;
  let pi = 0, whiff = false;
  const used = []; // 와이어를 건 탑 (객체)
  const R2 = C.COIN_R * C.COIN_R;
  for (let f = 0; f < maxF; f++) {
    while (pi < pairs.length && pairs[pi][1] <= f) pi++;
    const held = pi < pairs.length && pairs[pi][0] <= f;
    const ev = S.step(p, w, held);
    if (ev.includes("whiff")) whiff = true;
    if (ev.includes("wire")) used.push(w.towers[p.hang.tower]);
    if (trail) trail.push([p.x, p.y + C.BODY, p.st]);
    if (watch) {
      const cx = p.x, cy = p.y + C.BODY;
      for (let j = 0; j < watch.length; j++) if (!hit[j] && (watch[j].x - cx) ** 2 + (watch[j].y - cy) ** 2 <= R2) hit[j] = 1;
    }
    if (ev.includes("land")) return { ok: true, roof: p.roof, x: p.x, f, p, trail, hit, whiff, used };
    if (p.st === "dead") return { ok: false, f, p, trail, hit, used };
  }
  return { ok: false, f: maxF, p, trail, hit, used };
}

// 지금 지붕에서 무작위 입력 하나 (점프 + 와이어 nW번)
function sampleInput(start, nW, minF) {
  const r = w.roofs[start.roof], v = S.speedOf(w, r);
  const xA = start.x + v * C.DT * minF, xB = r.x1 + C.HW + v * 0.05;
  const fj = Math.max(minF, Math.round((U(xA, Math.max(xA, xB)) - start.x) / v / C.DT));
  const pairs = [[fj, fj + 4]];
  let t = fj + 4;
  for (let i = 0; i < nW; i++) {
    const p = i === 0 ? fj + Math.round(U(8, 100)) : t + Math.round(U(2, 50));
    const h = Math.round(U(12, 190));
    pairs.push([Math.max(p, t + 1), Math.max(p, t + 1) + h]);
    t = pairs[pairs.length - 1][1];
  }
  return pairs;
}

const success = (res, target, margin) => res.ok && res.roof >= target && res.x <= w.roofs[res.roof].x1 - margin;

// 토글 하나씩 ±k 프레임 밀어도 성공하는 최대 k (점프 버튼 떼기는 상관없어서 뺀다)
function windowOf(start, pairs, target, margin, maxK) {
  let minK = maxK;
  const slots = [];
  pairs.forEach((pr, i) => { slots.push([i, 0]); if (i > 0) slots.push([i, 1]); });
  for (const [i, j] of slots) {
    let k = 0;
    while (k < minK) {
      const kk = k + 1;
      let ok = true;
      for (const sgn of [1, -1]) {
        const q = pairs.map((x) => x.slice());
        q[i][j] += sgn * kk;
        if (i === 0 && j === 0) q[0][1] += sgn * kk; // 점프 누름과 뗌은 같이 민다
        let valid = q[0][0] >= 0;
        for (let a = 0; a < q.length && valid; a++) {
          if (q[a][1] <= q[a][0]) valid = false;
          if (a > 0 && q[a][0] <= q[a - 1][1]) valid = false;
        }
        if (!valid || !success(simulate(start, q), target, margin)) { ok = false; break; }
      }
      if (!ok) break;
      k = kk;
    }
    minK = Math.min(minK, k);
    if (minK === 0) break;
  }
  return minK;
}

const WIRES = { gap: [0, 0], t1: [1, 1], t2: [1, 2], t3: [1, 3], chain: [2, 4] };

// 시작 상태에서 target 지붕에 내리는 입력 중 타이밍 여유가 가장 큰 것
function solve(start, target, type, margin, needWin, avoidTowers = null) {
  const [w0, w1] = WIRES[type];
  const N = type === "gap" ? 600 : type === "chain" ? 26000 : 9000;
  const cands = [];
  // 앞에서 놓은 함정 은화를 먹는 입력은 정답으로 안 쓴다
  const traps = w.coins.filter((c) => c.t && c.x > start.x - 3 && c.x < start.x + 80);
  for (let n = 0; n < N; n++) {
    const nW = w0 + Math.floor(rng() * (w1 - w0 + 1));
    const pairs = sampleInput(start, nW, 16);
    const res = simulate(start, pairs);
    // 헛손질이 섞인 입력은 안 쓴다: 나중에 붙는 탑이 사거리에 들어오면 결과가 바뀐다
    if (success(res, target, margin) && !res.whiff && !(avoidTowers && res.used.some((t) => avoidTowers.includes(t))) && !(traps.length && simulate(start, pairs, { watch: traps }).hit.some((h) => h))) cands.push({ pairs, res });
  }
  if (!cands.length) return null;
  // 착지 위치가 지붕 앞쪽 1/3쯤인 것부터 여유를 잰다
  const tr = w.roofs[target];
  const ideal = tr.x0 + Math.min(2, (tr.x1 - tr.x0) / 3);
  cands.sort((a, b) => Math.abs(a.res.x - ideal) - Math.abs(b.res.x - ideal));
  let best = null;
  const step = Math.max(1, Math.floor(cands.length / 40));
  for (let i = 0; i < cands.length; i += step) {
    const c = cands[i];
    c.win = windowOf(start, c.pairs, target, margin, 16);
    if (!best || c.win > best.win) best = c;
    if (best.win >= 16) break;
  }
  return best && best.win >= needWin ? best : best ? { ...best, weak: true } : null;
}

// 가짜 탑: 무작위 입력 중 이 탑을 잡은 입력이 충분히 많고(눈에 띄고 손이 가는 자리), 그중 거의 다 못 산다
function fakeIsFatal(start, target, type, margin, tower) {
  const [w0, w1] = WIRES[type];
  let grabbed = 0, lived = 0;
  for (let n = 0; n < 2500; n++) {
    const nW = Math.max(1, w0) + Math.floor(rng() * (w1 - Math.max(1, w0) + 1));
    const res = simulate(start, sampleInput(start, nW, 16));
    if (!res.used.includes(tower)) continue;
    grabbed++;
    if (success(res, target, margin)) lived++;
  }
  return grabbed >= 40 && lived / grabbed <= 0.08;
}
// 가짜 탑을 하나 끼워 넣어 본다. 정답(가짜 탑을 안 잡는 입력)이 여전히 기준을 넘으면 그 정답을, 아니면 null
function tryFake(start, target, type, margin, needWin, x0, x1, top) {
  for (let a = 0; a < 4; a++) {
    const t = addTower(U(x0 + (x1 - x0) * 0.1, x1), top + U(4.0, 7.5));
    if (fakeIsFatal(start, target, type, margin, t)) {
      const sol = solve(start, target, type, margin, needWin, [t]);
      if (sol && !sol.weak) return { sol, tower: t };
    }
    w.towers.splice(w.towers.indexOf(t), 1);
  }
  return null;
}

// 궤적을 따라 일정 간격으로 점 찍기 (from~to 구간, 공중 부분만)
function along(trail, from, to, gap) {
  const pts = [];
  let acc = gap * 0.8, last = null;
  for (let i = from; i < to; i++) {
    const [x, y, st] = trail[i];
    if (st === "run") { last = null; continue; }
    if (last) acc += Math.hypot(x - last[0], y - last[1]);
    last = [x, y];
    if (acc >= gap) { pts.push({ x, y }); acc = 0; }
  }
  return pts;
}

// 함정 은화: 이 지붕에서 나올 수 있는 궤적을 수천 개 돌린다. "죽는 궤적" 위에 은화를 늘어놓되,
// 살아남는 궤적은 그 줄에서 많아야 한 개밖에 못 먹는 줄만 쓴다. 그래서 동전 줄을 따라 뛰면 떨어지고,
// 정답 타이밍을 아는 사람은 동전을 무시하고 지나간다.
const CELL = 0.4;
const cellKey = (x, y) => Math.floor(x / CELL) * 100000 + Math.floor(y / CELL);
function placeTrap(start, k, refPairs) {
  const r = w.roofs[k];
  const starts = [start, { ...start, x: Math.min(start.x, r.x0 + 0.3) }];
  const cells = new Map(); // 칸 -> 그 칸을 지나간 생존 궤적 번호들
  const dying = [];
  let nSafe = 0;
  const addSafe = (trail) => {
    const id = nSafe++;
    for (const [x, y] of trail) {
      const key = cellKey(x, y);
      let a = cells.get(key);
      if (!a) cells.set(key, (a = []));
      if (a[a.length - 1] !== id) a.push(id);
    }
  };
  addSafe(simulate(start, refPairs, { trail: true }).trail); // 0번: 이번 구간 정답
  addSafe(lastRefTrail); // 1번: 이 지붕에 내려온 앞 구간 정답
  for (const st of starts) {
    for (let n = 0; n < 4000; n++) {
      const rr = simulate(st, sampleInput(st, Math.floor(rng() * 3), 0), { trail: true });
      if (rr.ok) addSafe(rr.trail);
      else if (dying.length < 600) dying.push(rr.trail);
      else if (rng() < 0.08) dying[Math.floor(rng() * 600)] = rr.trail;
    }
  }
  const R = C.COIN_R + CELL * 0.75, reach = Math.ceil(R / CELL);
  const whoHits = (q) => {
    const ids = new Set();
    const cx = Math.floor(q.x / CELL), cy = Math.floor(q.y / CELL);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        const dx = (cx + a + 0.5) * CELL - q.x, dy = (cy + b + 0.5) * CELL - q.y;
        if (dx * dx + dy * dy > R * R) continue;
        const l = cells.get((cx + a) * 100000 + cy + b);
        if (l) for (const id of l) ids.add(id);
      }
    }
    return ids;
  };
  // 연속한 동전 줄 중 살아남는 궤적이 먹을 수 있는 개수가 cap 이하인 가장 긴 구간
  // (3개짜리 줄은 1개까지, 4개 이상은 절반까지. 정답 궤적은 하나도 못 먹게)
  const bestRun = (pts) => {
    let best = null;
    for (const [cap, minLen] of [[1, 3], [2, 4], [3, 6]]) {
      for (let i0 = 0; i0 < pts.length; i0++) {
        const cnt = new Map();
        let i1 = i0;
        for (; i1 < pts.length && i1 - i0 < 7; i1++) {
          if (pts[i1].bad) break;
          let over = false;
          for (const id of pts[i1].ids) if ((cnt.get(id) || 0) + 1 > cap) { over = true; break; }
          if (over) break;
          for (const id of pts[i1].ids) cnt.set(id, (cnt.get(id) || 0) + 1);
        }
        if (i1 - i0 >= minLen && (!best || i1 - i0 > best.run.length)) best = { run: pts.slice(i0, i1), cap };
      }
    }
    return best;
  };
  const lines = [];
  for (const tr of dying) {
    const pts = along(tr, 0, tr.length, 1.25);
    for (const q of pts) {
      // 다른 지붕 위는 안 되고(다음 구간과 엉킨다), 이 지붕 위라도 달리기만 해도 닿는 높이는 안 된다
      const runReach = w.roofs.some((o, oi) => q.x > o.x0 - 0.6 && q.x < o.x1 + 0.6 && (oi !== k || q.y < o.top + C.BODY + C.COIN_R + 0.3));
      // 바로 다음 지붕 앞까지만 (그 뒤는 아직 안 만든 구간이다)
      q.bad = runReach || q.x > w.roofs[k + 1].x0 - 0.3 || q.y <= r.top + 0.6 || w.coins.some((c) => Math.hypot(c.x - q.x, c.y - q.y) < 1.3);
      q.ids = q.bad ? null : whoHits(q);
      if (q.ids && (q.ids.has(0) || q.ids.has(1))) q.bad = true; // 정답 궤적이 지나가는 자리
    }
    const b = bestRun(pts);
    if (b) lines.push({ ...b, score: Math.min(b.run.length, 6) - b.cap * 0.5 - 0.15 * Math.abs(b.run[0].x - (r.x1 - 1)) });
  }
  lines.sort((a, b) => b.score - a.score);
  // 새 표본으로 다시 확인 (위에서 못 본 생존 궤적이 있을 수 있다)
  for (const { run, cap } of lines.slice(0, 3)) {
    let ok = true;
    for (const st of starts) {
      for (let n = 0; n < 2500 && ok; n++) {
        const rr = simulate(st, sampleInput(st, Math.floor(rng() * 3), 0), { watch: run });
        if (rr.ok && rr.hit.reduce((a, b) => a + b, 0) > cap) ok = false;
      }
    }
    if (ok) return { coins: run.map(({ x, y }) => ({ x, y })), cap };
  }
  return null;
}

// 함정 줄이 이 시작 상태들에서도 안전한지 (살아남는 궤적이 cap개보다 많이 못 먹는지)
function trapSafe(starts, trap) {
  for (const st of starts) {
    for (let n = 0; n < 2500; n++) {
      const rr = simulate(st, sampleInput(st, Math.floor(rng() * 3), 0), { watch: trap.coins });
      if (rr.ok && rr.hit.reduce((a, b) => a + b, 0) > trap.cap) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ 코스 만들기
let state = null;
let F = -1; // 지금 상태가 만들어진 전역 프레임
let lastRefTrail = []; // 앞 구간 정답 궤적 (함정 은화가 피해야 한다)

function startState(k, px) {
  const r = w.roofs[k];
  return { x: px, y: r.top, vx: S.speedOf(w, r), vy: 0, st: "run", roof: k, wires: 1, coyote: 0, jumped: false, held: false, hang: null, flipReady: false };
}

// 정답 궤적을 따라 동전 놓기: 지붕 위 달리기 동전(착지 지점 ~ 점프 지점) + 공중 안내 동전
function decorate(start, sol, cfg, guide, avoid = []) {
  const free = (x, y) => !avoid.some((q) => Math.hypot(q.x - x, q.y - y) < 1.3);
  const tr = simulate(start, sol.pairs, { trail: true });
  const takeoff = tr.trail.findIndex((q) => q[2] !== "run");
  if (rng() < cfg.ground && takeoff > 0) {
    const r = w.roofs[start.roof];
    const xa = start.x + 1.2, xb = tr.trail[takeoff][0] - 1.0;
    for (let cx = xa; cx <= xb; cx += 1.25) if (free(cx, r.top + C.BODY)) addCoin(cx, r.top + C.BODY, false);
  }
  if (guide) {
    for (const q of along(tr.trail, Math.max(0, takeoff), tr.f - 6, 1.25)) {
      const gold = rng() < cfg.gold;
      if (free(q.x, q.y)) addCoin(q.x, q.y, gold);
    }
  }
  return tr;
}

function commit(sol, si, guide, avoid = []) {
  const st = stats[si];
  const tr = decorate(state, sol, STAGES[si], guide, avoid);
  lastRefTrail = tr.trail;
  // 착지 뒤에도 누르고 있었다면 착지 프레임에 뗀 걸로 줄인다
  const pairs = sol.pairs.filter((q) => q[0] <= tr.f).map((q) => [q[0], Math.min(q[1], tr.f + 1)]);
  for (const q of pairs) ref.push([F + 1 + q[0], F + 1 + q[1]]);
  F = F + 1 + tr.f;
  checkpoints.push([F, tr.p.x]);
  state = cloneP(tr.p);
  state.held = false;
  st.wins.push(sol.win);
}

// 다음 지붕 + 틈 + 탑을 붙이고 푼다. 실패하면 틈을 줄여 다시.
function addChunk(si, type) {
  const cfg = STAGES[si];
  const v = S.runSpeed(w, w.roofs[w.roofs.length - 1].x1);
  const D = v * T_AIR;
  const cur = w.roofs[state.roof];
  const steps = type === "steps";
  const parts = steps ? 3 : 1;
  for (let part = 0; part < parts; part++) {
    const kind = steps ? "gap" : type;
    let shrink = 1, sp = D * 1.5; // sp: 진짜 탑 간격. 넓게 시작해서 못 풀 때만 좁힌다
    for (let tries = 0; ; tries++) {
      const base = w.roofs[w.roofs.length - 1];
      const roofsLen = w.roofs.length, towersLen = w.towers.length;
      let g;
      if (kind === "gap") g = steps ? D * U(0.3, 0.45) : D * U(cfg.gap[0], cfg.gap[1]);
      else if (kind === "t1") g = D * U(1.3, 1.85);
      else if (kind === "t2") g = D * U(1.8, 2.4);
      else if (kind === "t3") g = D * U(2.2, 2.9);
      else g = D * U(3.0, 3.9);
      g *= shrink;
      const gx = base.x1 + g;
      const ntop = Math.max(-1.5, Math.min(1.5, base.top + U(-0.8, 0.45)));
      // 지붕은 좁게 (도착이 어려워지게). 다만 너무 짧으면 내리자마자 다음 틈을 못 넘는다
      const width = steps && part < 2 ? D * U(0.95, 1.15) : Math.max(D * 0.65, v * U(cfg.w[0], cfg.w[1]));
      const k = addRoof(gx, width, ntop, si);
      const ttop = Math.max(base.top, ntop);
      if (kind === "t1") addTower(base.x1 + g * U(0.35, 0.55), ttop + U(5.2, 7.5));
      else if (kind !== "gap") placeTowers(base.x1, gx, ttop, sp);
      const margin = Math.max(0.6, v * 0.35); // 착지 뒤 다음 점프까지 달릴 자리
      let sol = solve(state, k, kind, margin, cfg.win);
      if (sol && !sol.weak && kind !== "gap" && rng() < cfg.fake) {
        const fake = tryFake(state, k, kind, margin, cfg.win, base.x1, gx, ttop);
        if (fake) { sol = fake.sol; stats[si].fakes = (stats[si].fakes || 0) + 1; }
      }
      if (sol && !sol.weak) {
        // 함정 은화를 먼저 놓고 (구간 시작 지붕 기준, 정답 궤적은 피해서), 안내 동전은 그 자리를 피해 놓는다
        const trap = rng() < cfg.trap ? placeTrap(state, state.roof, sol.pairs) : null;
        if (trap) {
          const gold = rng() < cfg.goldTrap;
          for (const q of trap.coins) trapSet.add(addCoin(q.x, q.y, gold, true));
          stats[si].traps++;
        }
        commit(sol, si, rng() < cfg.guide, trap ? trap.coins : []);
        stats[si].chunks[type] = (stats[si].chunks[type] || 0) + (part === 0 ? 1 : 0);
        break;
      }
      if (tries > 12) {
        const cr = w.roofs[state.roof], nr = w.roofs[k];
        console.log(`  구간 생성 실패 중 ${type}/${kind} part${part} st=${state.st} x=${state.x.toFixed(2)} roof=[${cr.x0},${cr.x1},${cr.top}] next=[${nr.x0},${nr.x1},${nr.top}] sol=${sol ? "win " + sol.win : "없음"}`);
      }
      w.roofs.length = roofsLen;
      w.towers.length = towersLen;
      stats[si].retries++;
      if (kind === "gap") shrink *= 0.93;
      else { sp *= 0.88; shrink *= 0.98; }
      if (tries > 14) throw new Error(`stage ${si + 1} ${kind}: 풀 수 있는 구간을 못 만들었다`);
    }
  }
}

// ------------------------------------------------------------------ 무한 구간 묶음
// 구간 하나 = 앞 지붕(끝이 x=0, 높이 0)에서 시작해 장애물 하나(3칸 점프는 지붕 3개)를 지나 끝 지붕에 내리는 것.
// 끝 지붕 길이는 EXIT_T초로 정해 두고, 그게 다음 구간의 앞 지붕이 된다.
function poolChunk(v0, v1) {
  const vm = (v0 + v1) / 2, EW = r2(v1 * EXIT_T);
  const type = pick(ENDLESS.mix);
  const kinds = type === "steps" ? ["gap", "gap", "gap"] : [type];
  for (let tries = 0; tries < 10; tries++) {
    w = { roofs: [], towers: [], coins: [], stages: [0], mul: 1, vfix: vm };
    addRoof(-EW, EW, 0, 0);
    const D = vm * T_AIR, shrink = (kinds[0] === "gap" ? 0.93 : 0.98) ** tries, sp = D * 1.5 * 0.88 ** tries;
    kinds.forEach((kind, part) => {
      const base = w.roofs[w.roofs.length - 1];
      let g;
      if (kind === "gap") g = type === "steps" ? D * U(0.3, 0.45) : D * U(ENDLESS.gap[0], ENDLESS.gap[1]);
      else if (kind === "t2") g = D * U(1.8, 2.4);
      else if (kind === "t3") g = D * U(2.2, 2.9);
      else g = D * U(3.0, 3.9);
      g *= shrink;
      const ntop = Math.max(-1.0, Math.min(1.0, base.top + U(-0.8, 0.45)));
      const width = part < kinds.length - 1 ? D * U(0.95, 1.15) : EW;
      addRoof(base.x1 + g, width, ntop, 0);
      if (kind !== "gap") placeTowers(base.x1, base.x1 + g, Math.max(base.top, ntop), sp);
    });
    // 늦게 내려선 경우(달리기 속도)와 빠르게 내려선 경우(1.6배) 둘 다, 가장 느린/빠른 속도 양쪽에서 풀려야 한다
    const entries = (v) => {
      const st = startState(0, -Math.max(0.6, v * 0.35));
      return [st, { ...st, vx: v * 1.6 }];
    };
    // 모든 속도·진입 상태에서 풀리면 가운데 속도의 정답들을, 아니면 null (avoid: 정답이 잡으면 안 되는 탑)
    const validate = (avoid) => {
      let mid = null;
      for (const v of v0 === v1 ? [vm] : [v0, v1, vm]) {
        w.vfix = v;
        const margin = Math.max(0.6, v * 0.35);
        for (const st0 of v === vm && v0 !== v1 ? entries(v).slice(0, 1) : entries(v)) {
          let st = st0;
          const sols = [];
          for (let k = 1; k < w.roofs.length; k++) {
            const sol = solve(st, k, kinds[k - 1], margin, ENDLESS.win, avoid);
            if (!sol || sol.weak) return null;
            sols.push({ start: st, sol });
            st = cloneP(sol.res.p);
            st.held = false;
          }
          if (v === vm && !mid) mid = sols;
        }
      }
      return mid;
    };
    let mid = validate(null);
    if (!mid) continue;
    // 가짜 탑: 가운데 속도에서 잡으면 거의 못 살고, 안 잡는 정답은 모든 속도에서 여전히 풀려야 남긴다
    let fakeKept = 0;
    if (kinds[0] !== "gap" && rng() < ENDLESS.fake) {
      const nr = w.roofs[1];
      for (let a = 0; a < 3; a++) {
        const t = addTower(U(nr.x0 * 0.1, nr.x0), Math.max(0, nr.top) + U(4.0, 7.5));
        w.vfix = vm;
        const m2 = fakeIsFatal(entries(vm)[0], 1, kinds[0], Math.max(0.6, vm * 0.35), t) ? validate([t]) : null;
        if (m2) { mid = m2; fakeKept = 1; break; }
        w.towers.splice(w.towers.indexOf(t), 1);
      }
    }
    // 동전은 가운데 속도의 정답으로 놓는다. 함정은 양 끝 속도에서도 안전해야 남긴다
    w.vfix = vm;
    lastRefTrail = [];
    let trap = rng() < ENDLESS.trap ? placeTrap(mid[0].start, 0, mid[0].sol.pairs) : null;
    if (trap && v0 !== v1) {
      for (const v of [v0, v1]) {
        w.vfix = v;
        const e = entries(v);
        if (!trapSafe([e[0], e[1], { ...e[0], x: -EW + 0.3 }], trap)) { trap = null; break; }
      }
      w.vfix = vm;
    }
    if (trap) {
      const gold = rng() < ENDLESS.goldTrap;
      for (const q of trap.coins) addCoin(q.x, q.y, gold, true);
    }
    const guide = rng() < ENDLESS.guide;
    for (const { start, sol } of mid) decorate(start, sol, ENDLESS, guide, trap ? trap.coins : []);
    const last = w.roofs[w.roofs.length - 1];
    return {
      kind: type,
      dtop: last.top,
      roofs: w.roofs.slice(1).map((r) => [r.x0, r.x1, r.top]),
      towers: w.towers.map((t) => [t.x, t.top]),
      coins: w.coins.map((c) => (c.t ? [c.x, c.y, c.g, 1] : [c.x, c.y, c.g])),
      win: Math.min(...mid.map((m) => m.sol.win)),
      traps: trap ? 1 : 0,
      fake: fakeKept,
    };
  }
  return null;
}

if (BAND != null) {
  const [v0, v1] = BANDS[+BAND];
  const chunks = [];
  let fails = 0;
  while (chunks.length < POOL_N && fails < POOL_N * 3) {
    const c = poolChunk(v0, v1);
    if (c) chunks.push(c);
    else fails++;
  }
  fs.writeFileSync(process.env.POOL_OUT, JSON.stringify({ v0, v1, chunks, fails }));
  process.exit(0);
}

// 구간 묶음은 자식 프로세스로 동시에 만들어 둔다 (고정 코스를 만드는 동안)
const poolJobs = BANDS.map((_, i) => {
  const file = path.join(os.tmpdir(), `gogun_pool_${process.pid}_${i}.json`);
  const child = spawn(process.execPath, [__filename], { env: { ...process.env, POOL_BAND: String(i), POOL_OUT: file }, stdio: "inherit" });
  return new Promise((res, rej) => child.on("exit", (code) => (code === 0 ? res(JSON.parse(fs.readFileSync(file, "utf8"))) : rej(new Error(`속도대 ${i} 구간 묶음 실패`)))));
});

// 1단계 첫 지붕
let k0 = addRoof(0, 16, 0, 0);
state = startState(k0, 2);
for (let si = 0; si < STAGES.length; si++) {
  const v = S.runSpeed(w, w.roofs[w.roofs.length - 1].x1);
  if (si > 0) {
    // 단계 시작 지붕: 넉넉하게 길고 쉬운 틈 하나 뒤에 둔다
    const base = w.roofs[w.roofs.length - 1];
    const D = v * T_AIR;
    for (let tries = 0; ; tries++) {
      const k = addRoof(base.x1 + D * 0.45, v * 2.6, base.top, si);
      const sol = solve(state, k, "gap", 0.6, STAGES[si - 1].win);
      if (sol && !sol.weak) { commit(sol, si - 1, true); break; }
      w.roofs.length--;
      if (tries > 5) throw new Error("stage start failed");
    }
  }
  const x0 = w.roofs[w.roofs.length - 1].x0;
  w.stages.push(si === 0 ? 0 : x0);
  while (w.roofs[w.roofs.length - 1].x1 - x0 < STAGES[si].len) addChunk(si, pick(STAGES[si].mix));
  process.stdout.write(`stage ${si + 1} done\n`);
}
// 고정 코스 끝: 무한 구간의 첫 구간이 올라설 끝 지붕 (구간 묶음과 같은 길이)
{
  const base = w.roofs[w.roofs.length - 1];
  const v = S.runSpeed(w, base.x1), D = v * T_AIR;
  const k = addRoof(base.x1 + D * 0.45, BANDS[0][1] * EXIT_T, base.top, STAGES.length - 1);
  const sol = solve(state, k, "gap", Math.max(0.6, v * 0.35), STAGES[STAGES.length - 1].win);
  commit(sol, STAGES.length - 1, true);
}

// ------------------------------------------------------------------ 검증: 기준 플레이를 처음부터 끝까지
const world = S.makeWorld(exportData());
function exportData() {
  return {
    roofs: w.roofs.map((r) => [r.x0, r.x1, r.top, r.s]),
    towers: w.towers.map((t) => [t.x, t.top]),
    coins: w.coins.map((c) => (c.t ? [c.x, c.y, c.g, 1] : [c.x, c.y, c.g])),
    stages: w.stages.map(r2),
  };
}
const lastFixed = world.roofs.length - 1;
let endState = null; // 고정 코스 끝 지붕에 내려선 상태 (무한 구간 검사의 출발점)
{
  const p = S.spawn(world);
  let pi = 0, f = 0, ci = 0, drift = false;
  for (; f < 120 * 600; f++) {
    while (pi < ref.length && ref[pi][1] <= f) pi++;
    const held = pi < ref.length && ref[pi][0] <= f;
    const ev = S.step(p, world, held);
    S.pickCoins(p, world, []);
    if (ci < checkpoints.length && checkpoints[ci][0] === f) {
      if (Math.abs(checkpoints[ci][1] - p.x) > 1e-9 && !drift) { drift = true; console.log(`구간 ${ci}에서 어긋남: x ${checkpoints[ci][1]} / ${p.x}`); }
      ci++;
    }
    if (p.st === "dead") break;
    if (ev.includes("land") && p.roof === lastFixed) { endState = { ...p, hang: null, held: false }; break; }
  }
  const golds = world.coins.filter((c) => c.g && !c.t);
  const gotGold = golds.filter((c) => c.got).length;
  const trapsHit = world.coins.filter((c) => c.t && c.got).length;
  let score = 0;
  world.coins.forEach((c) => { if (c.got) score += S.coinValue(c.g, S.stageAt(world, c.x)); });
  console.log(`\n기준 플레이: ${p.st === "dead" ? "죽음 x=" + p.x.toFixed(1) : "고정 코스 끝까지"}  ${(f / 120).toFixed(1)}초`);
  console.log(`금화 ${gotGold}/${golds.length}  함정 동전 먹음 ${trapsHit}/${trapSet.size}  동전 점수 ${score}`);
  if (p.st === "dead" || drift || gotGold !== golds.length || trapsHit) process.exitCode = 1;
}
for (let si = 0; si < STAGES.length; si++) {
  const st = stats[si];
  const x0 = w.stages[si], x1 = si + 1 < w.stages.length ? w.stages[si + 1] : w.roofs[w.roofs.length - 1].x1;
  const cs = w.coins.filter((c) => c.x >= x0 && c.x < x1);
  const nt = w.towers.filter((t) => t.x >= x0 && t.x < x1).length;
  const avg = st.wins.reduce((a, b) => a + b, 0) / st.wins.length;
  console.log(
    `${si + 1}단계 길이 ${(x1 - x0).toFixed(0)} (${((x1 - x0) / S.runSpeed(w, (x0 + x1) / 2)).toFixed(0)}초)  구간 ${JSON.stringify(st.chunks)}  ` +
    `여유 평균 ±${avg.toFixed(1)}f 최소 ±${Math.min(...st.wins)}f  재시도 ${st.retries}  ` +
    `은화 ${cs.filter((c) => !c.g && !c.t).length} 금화 ${cs.filter((c) => c.g && !c.t).length} 함정 은화 ${cs.filter((c) => c.t && !c.g).length} 함정 금화 ${cs.filter((c) => c.t && c.g).length} (${st.traps}곳)  탑 ${nt}개 (가짜 ${st.fakes || 0})`,
  );
}

// ------------------------------------------------------------------ 구간 묶음 합치기 + 무한 구간 검사
Promise.all(poolJobs).then((bands) => {
  console.log("");
  bands.forEach((b) => {
    const wins = b.chunks.map((c) => c.win);
    const kinds = {};
    b.chunks.forEach((c) => (kinds[c.kind] = (kinds[c.kind] || 0) + 1));
    console.log(`속도대 ${b.v0}~${b.v1}: 구간 ${b.chunks.length}개 (실패 ${b.fails})  ${JSON.stringify(kinds)}  여유 최소 ±${Math.min(...wins)}f  함정 ${b.chunks.filter((c) => c.traps).length}곳  ` +
      `탑 ${b.chunks.reduce((a, c) => a + c.towers.length, 0)}개 (가짜 ${b.chunks.filter((c) => c.fake).length})`);
  });
  const pool = { seed: SEED, bands: bands.map((b) => ({ v0: b.v0, v1: b.v1, chunks: b.chunks.map(({ win, traps, fake, ...c }) => c) })) };
  const out = { ...exportData(), pool, ref: ref.flat() };

  // 게임과 똑같이 이어 붙인 무한 구간을 고정 코스 끝 상태에서부터 지붕 하나씩 풀어 본다 (구간끼리 이어지는 곳 확인)
  const TEST_LEN = +process.env.TEST_LEN || 3000;
  w = S.makeWorld(out);
  S.extendWorld(w, w.roofs[lastFixed].x1 + TEST_LEN);
  let st = endState, fails = 0, worst = 99, n = 0;
  for (let k = lastFixed + 1; k < w.roofs.length && st; k++) {
    const r = w.roofs[k];
    const v = S.runSpeed(w, w.roofs[k - 1].x1);
    const sol = solve(st, k, r.kind === "steps" ? "gap" : r.kind, Math.max(0.6, v * 0.35), 1);
    n++;
    if (!sol) {
      fails++;
      const pr = w.roofs[k - 1];
      console.log(`  무한 구간 지붕 ${k} (x=${r.x0.toFixed(0)}, ${r.kind}, 속도 ${v.toFixed(2)})을 못 풀었다: ` +
        `앞 지붕 [${pr.x0}, ${pr.x1}] 높이 ${pr.top} 위 x=${st.x.toFixed(2)} vx=${st.vx.toFixed(2)} st=${st.st} / 다음 [${r.x0}, ${r.x1}] 높이 ${r.top}`);
      break;
    }
    worst = Math.min(worst, sol.win);
    st = cloneP(sol.res.p);
    st.held = false;
    k = Math.max(k, st.roof); // 정답이 지붕을 건너뛰어 더 멀리 내렸으면 그 지붕부터 이어 간다
  }
  console.log(`무한 구간 검사: ${TEST_LEN} 거리 동안 지붕 ${n}개, 실패 ${fails}, 여유 최소 ±${worst}f, 단계 ${w.stages.length}개까지`);
  if (fails) process.exitCode = 1;

  const file = OUT ? path.resolve(OUT) : path.join(__dirname, "../../public/gogun/course.js");
  fs.writeFileSync(file, `// tools/gogun/build_course.js가 만든 코스 데이터 (손으로 고치지 말 것, 시드 ${SEED})\nwindow.GOGUN_COURSE = ${JSON.stringify(out)};\n`);
  console.log(`\n${path.relative(process.cwd(), file)} 저장 (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
