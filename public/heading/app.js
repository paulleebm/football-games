import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  addDoc, collection, connectFirestoreEmulator, doc, getFirestore, increment, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { Renderer } from "./render.js";
import {
  GAME_TIME, COUNTDOWN, STATIONS, CONTACT_Y, GROUND_Y, GRAVITY, HOP_VX, HOP_VY, HOP_T, HEAD_TOL, LATE_GRACE, BALL_R,
  PLAYER_SPEED, PLAYER_MIN, PLAYER_MAX, CART, LAUNCH_WARN,
  GAP_MIN, launchGap, conflictChance, settleLaunch, hopPos, arrivalsOf, conflictPairs,
} from "./logic.js";
import { createRank, withRanks } from "./rank.js";
import { sfx, unlockAudio, getVolume, setVolume, setSilent } from "./audio.js";

const firebaseApp = initializeApp({
  projectId: "guess-your-player",
  appId: "1:1068776442781:web:433981863e0c3da178bd74",
  storageBucket: "guess-your-player.firebasestorage.app",
  apiKey: "AIzaSyA8SG_LbHeqS9gh0CLFaHUhEI1uG1uYLDY",
  authDomain: "guess-your-player.firebaseapp.com",
  messagingSenderId: "1068776442781",
});
const db = getFirestore(firebaseApp);
const IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
// 로컬 테스트용: ?emu 를 붙이면 Firestore 에뮬레이터에 붙는다
if (IS_LOCAL && new URLSearchParams(location.search).has("emu")) connectFirestoreEmulator(db, "127.0.0.1", 8080);
const rank = createRank(db);

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const renderer = new Renderer(canvas);

// ---------- 화면 크기 / 회전 ----------
// 터치 폰을 세로로 들면 게임 전체를 90도 돌려 가로로 보여준다 (고군분투와 같은 방식).
// L: 돌리기 전 기준의 화면 크기와 게임판(4:3) 위치
const L = { rot: false, W: 0, H: 0, x: 0, y: 0, w: 0, h: 0 };
function layout() {
  const coarse = matchMedia("(pointer: coarse)").matches;
  L.rot = coarse && innerHeight > innerWidth;
  L.W = L.rot ? innerHeight : innerWidth;
  L.H = L.rot ? innerWidth : innerHeight;
  L.w = Math.min(L.W, (L.H * 4) / 3);
  L.h = (L.w * 3) / 4;
  L.x = (L.W - L.w) / 2;
  L.y = (L.H - L.h) / 2;
  const wrap = $("wrap");
  wrap.classList.toggle("rot", L.rot);
  wrap.style.width = `${L.W}px`;
  wrap.style.height = `${L.H}px`;
  const st = document.querySelector(".stage-wrap");
  Object.assign(st.style, { left: `${L.x}px`, top: `${L.y}px`, width: `${L.w}px`, height: `${L.h}px` });
  renderer.resize();
}
addEventListener("resize", layout);
addEventListener("orientationchange", () => setTimeout(layout, 150));
layout();

// 화면(client) 좌표 → 게임 논리 좌표(800x600). 돌아가 있으면 회전을 되돌린다
function toLogical(cx, cy) {
  const x = L.rot ? cy : cx;
  const y = L.rot ? L.H - cx : cy;
  return [((x - L.x) / L.w) * 800, ((y - L.y) / L.h) * 600];
}

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (_) {
      // 무시
    }
  },
};

let cachedClientIp = null;
async function getClientIp() {
  if (cachedClientIp) return cachedClientIp;
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    cachedClientIp = (await response.json()).ip;
  } catch (_) {
    cachedClientIp = "unknown";
  }
  return cachedClientIp;
}

function todayKeyKST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

// 플레이 통계: 판마다 "heading" 1회
async function logPlay() {
  if (IS_LOCAL) return;
  try {
    const ip = await getClientIp();
    await Promise.all([
      addDoc(collection(db, "playLogs"), { ts: serverTimestamp(), ip, game: "heading" }),
      setDoc(doc(db, "statsCounters", "totals"), { heading: increment(1) }, { merge: true }),
      setDoc(doc(db, "statsDaily", todayKeyKST()), { heading: increment(1) }, { merge: true }),
    ]);
  } catch (error) {
    console.error("logPlay failed", error);
  }
}

const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;

// 선수가 마우스를 따라가는 빠르기 (클수록 바짝 붙는다)
const FOLLOW_RATE = 22;
// 늦은 헤딩을 기다리는 동안 공이 머리 높이 아래로 처지는 최대 거리(px)
const LATE_SAG = 12;

let G = null;
let lastGame = null;
let mouseX = 430;

function showOnly(id) {
  for (const s of ["menu", "pause", "result"]) $(s).hidden = s !== id;
}

// ---------- 랭킹 ----------
function renderBoard(el, rows) {
  const me = rank.deviceId();
  el.innerHTML = rows.length
    ? `<table class="lb"><tr><th>#</th><th>닉네임</th><th>배달</th></tr>${withRanks(rows).map((r) =>
      `<tr class="${r.id === me ? "me" : ""}"><td>${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td><td>${escapeHtml(r.nickname)}</td><td>${r.delivered}개</td></tr>`).join("")}</table>`
    : '<div class="lb-msg">아직 기록이 없어요. 첫 기록의 주인공이 되어보세요!</div>';
}

async function loadBoard(el) {
  el.innerHTML = '<div class="lb-msg">랭킹 불러오는 중…</div>';
  try {
    renderBoard(el, await rank.top(20));
  } catch (e) {
    console.error(e);
    el.innerHTML = '<div class="lb-msg">랭킹을 불러오지 못했어요.</div>';
  }
}

function renderMenu() {
  loadBoard($("menuBoard"));
  $("menuBest").textContent = "";
  rank.mine().then((m) => {
    $("menuBest").textContent = m ? `내 최고 기록: 배달 ${m.delivered}개` : "";
  }).catch(() => {});
}

function showHome() {
  G = null;
  document.body.classList.remove("playing");
  $("hud").hidden = true;
  showOnly("menu");
  renderMenu();
}

$("nickForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nick = $("nickInput").value.trim().slice(0, 20);
  if (!nick) {
    $("nickMsg").textContent = "닉네임을 입력해 주세요";
    $("nickInput").focus();
    return;
  }
  if (!lastGame || lastGame.submitted) return;
  store.set("hdNickname", nick);
  $("nickGo").disabled = true;
  $("nickMsg").textContent = "등록 중…";
  try {
    const res = await rank.submit(nick, Math.min(999, lastGame.delivered));
    lastGame.submitted = true;
    $("nickMsg").textContent = res.ok ? "랭킹에 등록됐어요!" : `내 최고 기록(배달 ${res.best.delivered}개)이 더 좋아서 유지돼요`;
    renderBoard($("resultBoard"), await rank.top(20));
  } catch (err) {
    console.error(err);
    $("nickGo").disabled = false;
    $("nickMsg").textContent = "등록에 실패했어요. 잠시 후 다시 시도해 주세요.";
  }
});

// ---------- 경기 ----------
function startGame() {
  G = {
    t: -COUNTDOWN,
    phase: "count",
    paused: false,
    balls: [],
    nextId: 0,
    nextLaunch: 0.5,
    lastLaunch: null,
    px: clamp(mouseX, PLAYER_MIN, PLAYER_MAX),
    pxPrev: 430,
    tPrev: -COUNTDOWN,
    vx: 0,
    delivered: 0,
    heads: 0,
    misses: 0,
    cartCount: 0,
    cartShakeT: -9,
    texts: [],
    banner: null,
    nodUntil: -9,
    happyUntil: -9,
    coachMood: null,
    coachMoodUntil: -9,
    shakeUntil: -9,
    hypeUntil: -9,
    lastSec: null,
  };
  G.pxPrev = G.px;
  renderer.newAds();
  showOnly(null);
  $("hud").hidden = false;
  document.body.classList.add("playing");
  rank.start();
  logPlay();
}

const realNow = () => performance.now() / 1000;

function popText(text, x, y, color, size) {
  G.texts.push({ text, x, y, color, size, t0: realNow() });
  if (G.texts.length > 24) G.texts.shift();
}

function banner(title, sub, c1, c2, big) {
  G.banner = { title, sub, c1, c2, big, t0: realNow(), until: realNow() + (big ? 0.8 : 1.3) };
}

// 아직 헤딩을 기다리는 도착들 (모두 성공한다고 칠 때)
function futureEvents() {
  const out = [];
  for (const b of G.balls) if (b.state === "fly" && b.hits < STATIONS.length) out.push(...arrivalsOf(b.id, b.t0, b.hits));
  return out;
}

// 다음 공: 박자 없이 랜덤 간격, 시간이 갈수록 촘촘하게. 초반엔 전부 받을 수 있게 도착을 엇갈리고,
// 후반엔 일정 확률로 둘 중 하나를 포기해야 하는 순간을 일부러 만든다.
function planNext() {
  const t = G.lastLaunch + launchGap(G.lastLaunch, Math.random);
  const want = Math.random() < conflictChance(t) ? 1 : 0;
  const minT = Math.max(G.lastLaunch + GAP_MIN, G.t + LAUNCH_WARN);
  G.nextLaunch = settleLaunch(futureEvents(), t, want, minT);
}

function launch() {
  G.balls.push({ id: G.nextId++, t0: G.nextLaunch, hits: 0, state: "fly" });
  G.lastLaunch = G.nextLaunch;
  sfx.throw();
  planNext();
}

function playerXAt(t, dt) {
  const u = dt > 0 ? clamp((t - G.tPrev) / dt, 0, 1) : 1;
  return lerp(G.pxPrev, G.px, u);
}

function judge(b, ta, dt) {
  const k = b.hits;
  const sx = STATIONS[k];
  // 내려온 순간(그 프레임 안에서 보간한 위치) 또는 그 뒤 LATE_GRACE초 안에 판정 폭에 들어오면 성공
  const onTime = G.tPrev < ta ? playerXAt(ta, dt) : G.px;
  if (Math.abs(onTime - sx) <= HEAD_TOL || Math.abs(G.px - sx) <= HEAD_TOL) {
    // 늦게 받았으면 그만큼 공의 시간표를 미뤄서, 다음 포물선이 머리에서 바로 시작하게 한다
    if (Math.abs(onTime - sx) > HEAD_TOL) b.t0 += G.t - ta;
    b.hits++;
    G.heads++;
    G.nodUntil = G.t + 0.15;
    G.happyUntil = G.t + 0.35;
    sfx.head(k);
    return;
  }
  if (G.t - ta < LATE_GRACE) return; // 아직 늦은 헤딩을 기다린다
  // 놓침: 머리 높이에서 그대로 떨어진다. 게임은 끝나지 않는다.
  // 선수는 따로 실망 모션을 하지 않는다 (모션을 취하면 헤딩을 못 하는 것처럼 보인다)
  b.state = "drop";
  b.x = sx;
  b.y = CONTACT_Y - BALL_R + LATE_SAG;
  b.vx = HOP_VX;
  b.vy = HOP_VY + GRAVITY * HOP_T;
  b.bounces = 0;
  G.misses++;
  G.coachMood = "oops";
  G.coachMoodUntil = G.t + 0.9;
  G.shakeUntil = G.t + 0.25;
  sfx.drop();
  popText("놓침!", sx, CONTACT_Y + 40, "#ff6b6b", 24);
}

function deliver(b) {
  b.state = "done";
  G.delivered++;
  G.cartCount++;
  if (G.cartCount % 5 === 0) G.cartShakeT = G.t;
  G.hypeUntil = G.t + 1.2;
  G.coachMood = "happy";
  G.coachMoodUntil = G.t + 0.8;
  sfx.deliver();
  popText("배달!", (CART.x0 + CART.x1) / 2, CART.top - 40, "#9ff3ff", 26);
}

function updateConflicts() {
  for (const b of G.balls) b.conflict = false;
  const byId = new Map(G.balls.map((b) => [b.id, b]));
  for (const [a, c] of conflictPairs(futureEvents())) {
    const ba = byId.get(a.id);
    const bc = byId.get(c.id);
    // 두 공 모두 바로 다음 도착일 때만 화면에 띄운다 (최대 1초 전 예고)
    if (ba.hits !== a.k || bc.hits !== c.k) continue;
    ba.conflict = true;
    bc.conflict = true;
  }
}

function step(dt) {
  if (!G || G.paused || G.phase === "end") return;
  G.tPrev = G.t;
  G.t += dt;

  // 선수: 목표까지 남은 거리의 일정 비율씩 다가가서(지수 감속) 멈출 때도 부드럽고, 최대 속도는 넘지 않는다
  if (IS_LOCAL && window.__hdAuto) mouseX = autoTarget();
  const target = clamp(mouseX, PLAYER_MIN, PLAYER_MAX);
  const maxd = PLAYER_SPEED * dt;
  const d = clamp((target - G.px) * (1 - Math.exp(-FOLLOW_RATE * dt)), -maxd, maxd);
  G.pxPrev = G.px;
  G.px += d;
  const vx = dt > 0 ? d / dt : 0;
  G.vx += (vx - G.vx) * (1 - Math.exp(-12 * dt));

  if (G.phase === "count") {
    const sec = Math.ceil(-G.t);
    if (sec !== G.lastSec && sec > 0) {
      G.lastSec = sec;
      banner(String(sec), null, "#ffe14d", null, true);
      sfx.beep();
    }
    if (G.t >= 0) {
      G.phase = "play";
      G.lastSec = null;
      banner("시작!", null, "#7fffe0", null, true);
      sfx.whistle();
    }
    return;
  }

  if (G.t >= G.nextLaunch && G.t < GAME_TIME) launch();

  updateConflicts();

  for (const b of G.balls) {
    if (b.state === "fly") {
      if (b.hits < STATIONS.length) {
        const ta = b.t0 + (b.hits + 1) * HOP_T;
        if (G.t >= ta) judge(b, ta, dt);
      } else {
        const [, y] = hopPos(STATIONS.length, G.t - b.t0 - STATIONS.length * HOP_T);
        if (y >= CART.top) deliver(b);
      }
    } else if (b.state === "drop") {
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y >= GROUND_Y - BALL_R && b.vy > 0) {
        b.y = GROUND_Y - BALL_R;
        b.vy = -b.vy * 0.42;
        b.vx *= 0.6;
        if (++b.bounces >= 3) {
          b.state = "gone";
          b.goneT = G.t;
        }
      }
    }
  }
  G.balls = G.balls.filter((b) => b.state !== "done" && !(b.state === "gone" && G.t - b.goneT > 0.4));

  // 마지막 10초 째깍
  const left = GAME_TIME - G.t;
  const sec = Math.ceil(left);
  if (sec <= 10 && sec >= 1 && sec !== G.lastSec) {
    G.lastSec = sec;
    sfx.tick();
  }
  if (left <= 0) endGame();
}

function endGame() {
  if (!G || G.phase === "end") return;
  G.phase = "end";
  G.balls = G.balls.filter((b) => b.state !== "fly");
  document.body.classList.remove("playing");
  banner("시간 종료!", null, "#ffd23f", "#e07a00");
  const best = Number(store.get("hdBestDelivered") || 0);
  const isNew = G.delivered > best;
  if (isNew) store.set("hdBestDelivered", String(G.delivered));
  const g = G;
  lastGame = { delivered: g.delivered, submitted: false };
  setTimeout(() => {
    if (G !== g) return;
    isNew ? sfx.win() : sfx.lose();
    $("resultTitle").textContent = isNew ? "신기록!" : "경기 종료";
    $("resultScore").textContent = `🧺 ${g.delivered}개`;
    $("resultSub").textContent = isNew ? "내 최고 기록 경신!" : best ? `내 최고 ${best}개` : "";
    $("nickInput").value = store.get("hdNickname") || store.get("pkNickname") || store.get("gogunNickname") || store.get("jellyNickname") || "";
    $("nickMsg").textContent = "";
    $("nickGo").disabled = false;
    $("hud").hidden = true;
    showOnly("result");
    loadBoard($("resultBoard"));
  }, 1400);
}

function pauseGame() {
  if (!G || G.phase === "end" || G.paused || (IS_LOCAL && window.__hdAuto)) return;
  G.paused = true;
  $("pause").hidden = false;
}

function resumeGame() {
  if (!G) return;
  G.paused = false;
  $("pause").hidden = true;
  lastFrame = performance.now();
}

$("startBtn").addEventListener("click", () => {
  unlockAudio();
  sfx.click();
  startGame();
});
$("againBtn").addEventListener("click", () => {
  sfx.click();
  startGame();
});
$("exitBtn").addEventListener("click", () => {
  sfx.click();
  pauseGame();
});
$("resumeBtn").addEventListener("click", () => {
  sfx.click();
  resumeGame();
});

// ---------- 볼륨: 소리 버튼을 누르면 슬라이더가 뜬다 ----------
const volIcon = (v) => (v === 0 ? "🔇" : v < 0.34 ? "🔈" : v < 0.67 ? "🔉" : "🔊");
function syncVolume() {
  const v = getVolume();
  for (const b of document.querySelectorAll("#muteBtn, #muteBtnMenu")) b.textContent = volIcon(v);
  $("volIcon").textContent = volIcon(v);
  $("volRange").value = String(Math.round(v * 100));
  $("volVal").textContent = String(Math.round(v * 100));
}
for (const b of document.querySelectorAll("#muteBtn, #muteBtnMenu")) {
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    unlockAudio();
    $("volPop").hidden = !$("volPop").hidden;
  });
}
$("volRange").addEventListener("input", () => {
  unlockAudio();
  setVolume(Number($("volRange").value) / 100);
  syncVolume();
});
// 손을 떼면 지금 크기로 한 번 들려준다
$("volRange").addEventListener("change", () => sfx.head(2));
// 바깥을 누르면 닫는다
document.addEventListener("pointerdown", (e) => {
  if (!$("volPop").hidden && !e.target.closest("#volPop, #muteBtn, #muteBtnMenu")) $("volPop").hidden = true;
});
syncVolume();

// ---------- 입력: 마우스 X만 쓴다 ----------
function track(e) {
  mouseX = toLogical(e.clientX, e.clientY)[0];
}
document.addEventListener("pointermove", track);
document.addEventListener("pointerdown", (e) => {
  unlockAudio();
  if (G && G.phase !== "end" && !e.target.closest("button, a, .overlay, form, .vol-pop")) {
    e.preventDefault();
    track(e);
  }
});
// 탭을 아예 벗어나면 멈춘다 (마우스가 화면 밖으로 나가는 것만으로는 멈추지 않음)
document.addEventListener("visibilitychange", () => document.hidden && pauseGame());
window.addEventListener("keydown", (e) => {
  if (e.code !== "Escape" || !G) return;
  G.paused ? resumeGame() : pauseGame();
});

// ---------- 화면 ----------
function ballView(b) {
  if (b.state === "fly") {
    const e = G.t - b.t0;
    const seg = Math.min(Math.floor(Math.max(0, e) / HOP_T), b.hits);
    const u = e - seg * HOP_T;
    let [x, y] = hopPos(seg, u);
    // 늦은 헤딩을 기다리는 동안엔 머리 높이 근처에 머문다 (안 그러면 받는 순간 공이 튀어 보인다)
    if (seg === b.hits && b.hits < STATIONS.length && u > HOP_T) [x, y] = [STATIONS[seg], Math.min(y, CONTACT_Y + LATE_SAG)];
    // 궤적은 공 아랫면(머리에 닿는 점) 기준이라 중심은 반지름만큼 위
    return { x, y: y - BALL_R, spin: e * 9, flying: true, conflict: b.conflict };
  }
  const fade = b.state === "gone" ? Math.max(0, 1 - (G.t - b.goneT) / 0.4) : null;
  return { x: b.x, y: b.y, spin: b.x * 0.1, fade };
}

function view(now) {
  const v = { now, texts: [], balls: [] };
  if (!G) {
    v.player = { x: 430, vx: 0, face: "normal" };
    v.coach = { pose: "sit" };
    return v;
  }
  const t = G.t;
  const next = G.balls.filter((b) => b.state === "fly" && b.hits < STATIONS.length);
  const anyConflict = next.some((b) => b.conflict);
  const soonest = next.reduce((m, b) => (!m || b.t0 + b.hits < m.t0 + m.hits ? b : m), null);
  v.player = {
    x: G.px,
    vx: G.vx,
    nod: t < G.nodUntil,
    face: t < G.happyUntil ? "happy" : anyConflict ? "scared" : "normal",
    lookX: soonest ? clamp((STATIONS[soonest.hits] - G.px) / 120, -1, 1) : 0,
  };
  let coach = { pose: "sit", face: "normal" };
  if (t >= G.nextLaunch - LAUNCH_WARN && t < G.nextLaunch) coach = { pose: "wind", face: "normal", holding: true };
  else if (G.lastLaunch != null && t - G.lastLaunch < 0.25) coach = { pose: "throw", face: "happy" };
  if (t < G.coachMoodUntil) {
    if (G.coachMood === "oops" && coach.pose === "sit") coach = { pose: "oops", face: "sad" };
    else if (G.coachMood === "happy") coach.face = "happy";
  }
  v.coach = coach;
  v.balls = G.balls.map(ballView);
  v.cartCount = G.cartCount;
  v.cartShake = t - G.cartShakeT < 0.5 ? 0.5 - (t - G.cartShakeT) : 0;
  v.shake = t < G.shakeUntil ? (G.shakeUntil - t) / 0.25 : 0;
  v.crowdHype = t < G.hypeUntil;
  v.hud = {
    delivered: G.delivered,
    misses: G.misses,
    timeLeft: clamp(GAME_TIME - Math.max(0, t), 0, GAME_TIME),
  };
  v.texts = G.texts;
  if (G.banner && now / 1000 < G.banner.until) v.banner = G.banner;
  return v;
}

// 로컬 검증용 자동 플레이: 가장 먼저 내려올 공의 지점으로 간다
function autoTarget() {
  let best = null;
  for (const b of G.balls) {
    if (b.state !== "fly" || b.hits >= STATIONS.length) continue;
    const ta = b.t0 + (b.hits + 1) * HOP_T;
    if (ta >= G.t && (!best || ta < best.ta)) best = { ta, x: STATIONS[b.hits] };
  }
  return best ? best.x : mouseX;
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  // 로컬 검증용 배속: 콘솔에서 __hdSpeed = 4
  const speed = IS_LOCAL ? window.__hdSpeed || 1 : 1;
  setSilent(speed > 1);
  for (let i = 0; i < speed; i++) step(dt);
  renderer.draw(view(now));
  requestAnimationFrame(frame);
}

if (IS_LOCAL) {
  window.__hd = () => G;
  // 화면 없이 시뮬레이션할 때: __hdStep(초) 만큼 1/60초씩 진행
  window.__hdStep = (sec) => {
    setSilent(true);
    try {
      for (let i = 0; i < sec * 60; i++) step(1 / 60);
    } finally {
      setSilent(false);
    }
  };
}

showHome();
requestAnimationFrame(frame);
