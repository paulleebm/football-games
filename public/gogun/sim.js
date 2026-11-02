// 고군분투 물리. 게임 화면(index.html)과 코스 생성 도구(tools/gogun/build_course.js)가 같이 쓴다.
// 좌표는 y가 위쪽. 지붕 윗면이 대략 y=0 근처, 단위 1은 선수 키의 절반쯤.
// 120Hz 고정 스텝이라 같은 입력이면 같은 결과가 나온다 (코스 검증과 데모 재생이 이걸 믿는다).
(function (root) {
  const C = {
    DT: 1 / 120,
    G: 30,
    JUMP: 11,
    RANGE: 10, // 와이어 사거리 (손에서 탑 꼭대기까지)
    GRAB_BELOW: 4, // 탑 꼭대기가 손보다 이만큼 낮아도 와이어가 걸린다 (줄이 느슨하게 걸렸다가 떨어지며 팽팽해진다)
    SLACK_L: 3.5, // 느슨하게 걸린 와이어의 최소 길이
    FLIP_T: 0.45, // 이만큼 매달려 있다가 놓으면 공중제비를 돌고 와이어를 한 번 더 쓸 수 있다
    COYOTE: 0.07, // 지붕 끝을 막 지나쳤을 때도 점프를 받아 주는 시간
    HW: 0.3, // 몸 반폭
    HAND: 1.2, // 발에서 손까지 (와이어가 걸리는 점)
    BODY: 0.9, // 동전 판정 중심 높이
    COIN_R: 0.7,
    DEATH_Y: -9,
    // 달리기 속도는 단계로 끊지 않고 거리에 따라 계속 빨라진다 (시작 7 → 고정 4단계 끝 무렵 11 → 무한 구간에서 14까지)
    V0: 7, // 원래 3단계가 시작하던 속도
    ACC: 0.0028,
    VMAX: 14,
    ENDLESS_STAGE: 450, // 고정 4단계 뒤 무한 구간의 한 단계 길이
    WIRE_BOOST: 1.3, // 와이어를 타는 동안 최소 속도 (달리기 속도의 배수): 와이어는 항상 달리기보다 빠르다
    FLIP_TH: 1.35, // 와이어를 잡은 채 이 각도(라디안, 약 77도)까지 올라가면 와이어가 풀리며 뒤로 공중제비를 돈다
    RELEASE_MIN: 1.1, // 와이어를 놓은 직후 앞으로 가는 속도 최소값 (달리기 속도의 배수)
    SPEED_EASE: 0.45, // 빠르게 착지하면 이 시간(초)에 걸쳐 달리기 속도로 돌아온다
  };

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // course.js의 배열 데이터를 물리에서 쓰는 모양으로 바꾼다.
  // 4단계까지는 고정 코스, 그 뒤는 extendWorld가 구간 묶음(pool)에서 이어 붙인다 (고정 시드라 매번 같은 순서).
  function makeWorld(data, speedMul) {
    const w = {
      roofs: data.roofs.map(([x0, x1, top, s]) => ({ x0, x1, top, s })),
      towers: data.towers.map(([x, top]) => ({ x, top })),
      coins: data.coins.map(([x, y, g, t]) => ({ x, y, g, t: t || 0, got: 0 })), // t: 함정 동전 (금화 보너스 계산에서 뺀다)
      stages: data.stages.slice(),
      mul: speedMul || 1,
      pool: data.pool || null,
    };
    if (w.pool) {
      const last = w.roofs[w.roofs.length - 1];
      w.gen = { rng: mulberry32(w.pool.seed), stage: last.s, nextStage: last.x1 };
    }
    return w;
  }

  function runSpeed(w, x) {
    if (w.vfix) return w.vfix * w.mul; // 코스 생성기가 구간 묶음을 정해진 속도로 검증할 때
    return Math.min(C.VMAX, C.V0 + C.ACC * Math.max(0, x)) * w.mul;
  }

  // 동전은 x 순서를 지켜서 넣는다 (pickCoins의 이진 탐색)
  function insertCoin(w, c) {
    const i = lastAtOrBefore(w.coins, "x", c.x) + 1;
    w.coins.splice(i, 0, c);
  }

  // 무한 구간: 마지막 지붕이 untilX에 닿을 때까지 구간 묶음에서 하나씩 골라 이어 붙인다.
  // 묶음은 속도대별로 나뉘어 있고, 각 구간은 "앞 지붕 끝(x=0, 높이 0)" 기준 상대 좌표다.
  function extendWorld(w, untilX) {
    if (!w.pool) return;
    const g = w.gen;
    while (w.roofs[w.roofs.length - 1].x1 < untilX) {
      const last = w.roofs[w.roofs.length - 1];
      const v = runSpeed(w, last.x1) / w.mul;
      const bands = w.pool.bands;
      let band = bands[bands.length - 1];
      for (const b of bands) if (v < b.v1) { band = b; break; }
      // 지붕 높이가 -1.5 ~ 1.5를 벗어나지 않는 구간만 고른다
      let chunk = null;
      for (let n = 0; n < 12 && !chunk; n++) {
        const c = band.chunks[Math.floor(g.rng() * band.chunks.length)];
        if (Math.abs(last.top + c.dtop) <= 1.5) chunk = c;
      }
      if (!chunk) chunk = band.chunks.reduce((a, c) => (Math.abs(last.top + c.dtop) < Math.abs(last.top + a.dtop) ? c : a));
      // 단계 길이만큼 지났으면 새 단계 시작
      if (last.x1 >= g.nextStage) {
        g.stage++;
        g.nextStage = last.x1 + C.ENDLESS_STAGE;
        w.stages.push(+(last.x1 + chunk.roofs[0][0]).toFixed(2));
      }
      const ox = last.x1, oy = last.top;
      for (const [x0, x1, top] of chunk.roofs) w.roofs.push({ x0: ox + x0, x1: ox + x1, top: oy + top, s: g.stage, kind: chunk.kind });
      for (const [x, top] of chunk.towers) w.towers.push({ x: ox + x, top: oy + top });
      for (const [x, y, gg, t] of chunk.coins) insertCoin(w, { x: ox + x, y: oy + y, g: gg, t: t || 0, got: 0 });
    }
  }
  // 지붕 시작점에서의 달리기 속도 (코스 생성기가 틈 크기를 잡을 때 쓴다)
  function speedOf(w, r) {
    return runSpeed(w, r.x0);
  }

  function spawn(w) {
    const r = w.roofs[0];
    return {
      x: r.x0 + 2, y: r.top, vx: speedOf(w, r), vy: 0,
      st: "run", roof: 0, wires: 1, coyote: 0, jumped: false, held: false,
      hang: null, flipReady: false, seek: false,
    };
  }

  // x 이하에서 시작하는 마지막 지붕 / 탑 (둘 다 x 순서로 정렬돼 있다)
  function lastAtOrBefore(arr, key, x) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (arr[m][key] <= x) { ans = m; lo = m + 1; } else hi = m - 1;
    }
    return ans;
  }

  // 앞쪽(살짝 뒤까지) 사거리 안의 탑 중 가장 가까운 것
  function findTower(w, hx, hy) {
    const ts = w.towers;
    let i = lastAtOrBefore(ts, "x", hx - 0.5) + 1;
    for (; i < ts.length; i++) {
      const t = ts[i];
      if (t.x > hx + C.RANGE) break;
      // 탑 꼭대기가 손보다 낮아도(GRAB_BELOW까지) 걸린다: 와이어를 놓고 높이 떴을 때 바로 앞 탑을 놓치지 않게
      if (t.top > hy - C.GRAB_BELOW && Math.hypot(t.x - hx, t.top - hy) <= C.RANGE) return i;
    }
    return -1;
  }

  function jump(p) {
    p.st = "air";
    p.vy = C.JUMP;
    p.jumped = true;
    p.wires = 1;
    p.coyote = 0;
    p.seek = false;
  }

  function land(p, k, r) {
    p.st = "run";
    p.y = r.top;
    p.vy = 0;
    p.roof = k;
    p.wires = 1;
    p.hang = null;
    p.jumped = false;
    p.flipReady = false;
    p.seek = false;
  }

  function roofInside(w, p) {
    const i = lastAtOrBefore(w.roofs, "x0", p.x);
    if (i < 0) return -1;
    const r = w.roofs[i];
    return p.x <= r.x1 && p.y < r.top ? i : -1;
  }

  function collide(p, w, px, py, ev) {
    const i = lastAtOrBefore(w.roofs, "x0", p.x + C.HW);
    for (let k = i; k >= Math.max(0, i - 1); k--) {
      const r = w.roofs[k];
      if (p.x + C.HW < r.x0 || p.x - C.HW > r.x1) continue;
      if (p.vy <= 0 && py >= r.top - 1e-6 && p.y <= r.top) {
        land(p, k, r);
        p.vx = Math.max(runSpeed(w, p.x), p.vx);
        ev.push("land");
        return;
      }
      if (p.y < r.top) {
        // 옆벽에 부딪힘: 그대로 미끄러져 떨어진다
        if (px + C.HW <= r.x0 + 1e-6) p.x = r.x0 - C.HW;
        else if (px - C.HW >= r.x1 - 1e-6) p.x = r.x1 + C.HW;
        else continue;
        p.vx = 0;
        p.wires = 0;
        if (p.st === "hang") { p.st = "air"; p.hang = null; }
        ev.push("wall");
        return;
      }
    }
  }

  // 손이 닿는 탑이 있으면 와이어를 건다
  function grab(p, w, ev) {
    const hx = p.x, hy = p.y + C.HAND;
    const ti = findTower(w, hx, hy);
    if (ti < 0) return false;
    const t = w.towers[ti];
    const dx = hx - t.x, dy = hy - t.top;
    const L = Math.hypot(dx, dy);
    const th = Math.atan2(dx, -dy);
    p.wires--;
    p.seek = false;
    p.st = "hang";
    p.flipReady = false;
    ev.push("wire");
    if (dy > 0) {
      // 탑이 손보다 낮으면 줄이 느슨하게 걸린다: 그대로 날아가다가 탑보다 내려가 줄이 팽팽해지면 흔들기 시작
      p.hang = { ax: t.x, ay: t.top, L: Math.max(L, C.SLACK_L), th: 0, om: 0, t: 0, tower: ti, slack: true };
      return true;
    }
    // 와이어를 거는 순간 속도를 잃지 않는다: 지금 빠르기 그대로(최소 WIRE_BOOST) 앞으로 휘두른다
    const v = Math.max(Math.hypot(p.vx, p.vy), runSpeed(w, p.x) * C.WIRE_BOOST);
    p.hang = { ax: t.x, ay: t.top, L, th, om: v / L, t: 0, tower: ti };
    return true;
  }

  // 한 스텝. held는 지금 버튼을 누르고 있는지. 일어난 일을 배열로 돌려준다.
  function step(p, w, held) {
    const ev = [];
    const press = held && !p.held, release = !held && p.held;
    p.held = held;
    const dt = C.DT;
    if (p.st === "dead") return ev;

    if (p.st === "run") {
      const r = w.roofs[p.roof];
      const v = runSpeed(w, p.x);
      p.vx = p.vx > v ? v + (p.vx - v) * Math.exp(-dt / C.SPEED_EASE) : v;
      p.x += p.vx * dt;
      if (press) { jump(p); ev.push("jump"); }
      else if (p.x - C.HW > r.x1) {
        p.st = "air"; p.vy = 0; p.wires = 1; p.coyote = C.COYOTE; p.jumped = false;
      }
      return ev;
    }

    if (p.st === "hang") {
      const h = p.hang;
      if (release) {
        p.st = "air";
        p.hang = null;
        p.vx = Math.max(p.vx, runSpeed(w, p.x) * C.RELEASE_MIN);
        if (h.t >= C.FLIP_T) { p.wires = 1; ev.push("flip"); }
        ev.push("release");
        // 지붕 속을 지나가다 놓았으면 그 지붕 위에 내려선다
        const k = roofInside(w, p);
        if (k >= 0) {
          land(p, k, w.roofs[k]);
          p.vx = Math.max(runSpeed(w, p.x), p.vx);
          ev.push("land");
          return ev;
        }
      } else if (h.slack) {
        // 느슨한 줄: 그냥 날아간다 (지붕에 내려서면 줄은 풀린다)
        h.t += dt;
        if (!p.flipReady && h.t >= C.FLIP_T) { p.flipReady = true; ev.push("ready"); }
        const px = p.x, py = p.y;
        p.vy -= C.G * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        collide(p, w, px, py, ev);
        if (p.st === "hang") {
          const dx = p.x - h.ax, dy = p.y + C.HAND - h.ay, d = Math.hypot(dx, dy);
          if (d > C.RANGE * 1.2) { p.st = "air"; p.hang = null; } // 너무 멀어지면 줄이 빠진다
          else if (dy < 0 && d >= h.L) {
            // 탑보다 내려가 줄이 팽팽해졌다: 지금 위치에서 앞으로 흔들기 시작
            h.slack = false;
            h.L = d;
            h.th = Math.atan2(dx, -dy);
            const vt = p.vx * Math.cos(h.th) + p.vy * Math.sin(h.th);
            h.om = Math.max(vt, runSpeed(w, p.x) * C.WIRE_BOOST) / h.L;
            ev.push("taut");
          }
        }
        if (p.y < C.DEATH_Y) { p.st = "dead"; ev.push("dead"); }
        return ev;
      } else {
        h.om -= (C.G / h.L) * Math.sin(h.th) * dt;
        const vmin = runSpeed(w, p.x) * C.WIRE_BOOST;
        if (h.om > 0 && h.om * h.L < vmin) h.om = vmin / h.L;
        h.th += h.om * dt;
        h.t += dt;
        if (!p.flipReady && h.t >= C.FLIP_T) { p.flipReady = true; ev.push("ready"); }
        const px = p.x, py = p.y;
        p.x = h.ax + h.L * Math.sin(h.th);
        p.y = h.ay - h.L * Math.cos(h.th) - C.HAND;
        p.vx = h.L * h.om * Math.cos(h.th);
        p.vy = h.L * h.om * Math.sin(h.th);
        // 끝까지 잡고 있으면 꼭대기에서 와이어가 풀리고 뒤로 한 바퀴 돈다. 다시 던지려면 뗐다가 눌러야 한다
        if (h.th >= C.FLIP_TH) {
          p.st = "air";
          p.hang = null;
          p.wires = 1;
          p.vx = Math.max(p.vx, runSpeed(w, p.x) * C.RELEASE_MIN);
          ev.push("flip", "release");
        }
        // 매달린 동안은 지붕을 무시하고 지나간다 (닿아도 와이어가 풀리지 않는다)
        return ev;
      }
    }

    // 공중
    if (!held) p.seek = false;
    if (press) {
      if (p.coyote > 0 && !p.jumped) { jump(p); ev.push("jump"); }
      else if (p.wires > 0) {
        if (grab(p, w, ev)) return ev;
        // 헛방은 와이어를 쓰지 않는다. 누른 채로 있으면 탑이 닿는 순간 건다
        p.seek = true;
        ev.push("whiff");
      }
    } else if (p.seek && p.wires > 0 && grab(p, w, ev)) return ev;
    p.coyote -= dt;
    const px = p.x, py = p.y;
    p.vy -= C.G * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    collide(p, w, px, py, ev);
    if (p.y < C.DEATH_Y) { p.st = "dead"; ev.push("dead"); }
    return ev;
  }

  // 동전 줍기. 주운 동전은 c.got = 1로 표시하고, 새로 주운 동전들을 돌려준다.
  function pickCoins(p, w, out) {
    const cx = p.x, cy = p.y + C.BODY, R = C.COIN_R;
    const cs = w.coins;
    let i = lastAtOrBefore(cs, "x", cx - R) + 1;
    for (; i < cs.length && cs[i].x <= cx + R; i++) {
      const c = cs[i];
      if (c.got) continue;
      if ((c.x - cx) ** 2 + (c.y - cy) ** 2 <= R * R) { c.got = 1; out.push(c); }
    }
    return out;
  }

  function stageAt(w, x) {
    let s = 0;
    while (s + 1 < w.stages.length && x >= w.stages[s + 1]) s++;
    return s;
  }

  // 금화 점수: 원작 공식 55 - 5×단계 (1단계 50점 ~ 4단계 35점). 무한 구간에서는 20점 아래로 내려가지 않는다
  const coinValue = (g, s) => (g ? Math.max(20, 55 - 5 * (s + 1)) : 5);

  const api = { C, makeWorld, extendWorld, spawn, step, pickCoins, findTower, stageAt, coinValue, speedOf, runSpeed, mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GogunSim = api;
})(typeof window !== "undefined" ? window : globalThis);
