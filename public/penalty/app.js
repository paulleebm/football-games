import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  addDoc, collection, connectFirestoreEmulator, doc, getFirestore, increment, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { Renderer, playScene, idleScene, playLength, arriveTime, KICK_T, PX_PER_M, fromScreen } from "./render.js";
import {
  INPUT_MS, KEEPER_SAV, BALL, other, kickerAt, shootout, gaugeAt, gaugeSweeps, zoneOf, ZONES, clampAim, shotFromAim, clampKeep,
  resolveKick, isGoal, cpuKick, cpuKeep, cpuSavBonus,
} from "./logic.js";
import {
  nationById, homeKit, opponentKit, gkKit, flagUrl, randomSquad, ONLINE_KITS, CUP_BRACKET, ROUNDS, ROUND_LEVEL, STAGE_LABEL,
} from "./nations.js";
import { createRank, withRanks } from "./rank.js";
import { sfx, unlockAudio, getVolume, setVolume } from "./audio.js";
import { findMatch, MatchChannel, openRoom, joinRoom } from "./online.js";

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

// 메인 화면에서 CPU(월드컵) / 온라인 중 하나를 골라서 들어온다
const PAGE_MODE = new URLSearchParams(location.search).get("mode") === "online" ? "online" : "cpu";
const MY_CUP_TEAM = "kor";

const MATCH_WAIT_MS = 20000;
// 내가 입력한 뒤 이만큼 더 지나도 상대가 안 내면 나간 걸로 본다
const AFK_GRACE = 15000;
const INTRO_MS = 1500;
const COIN_MS = 2000;
// 월드컵 포인트: 도달 단계별 기본값 (1=32강 … 6=우승) + 넣은 골
const CUP_POINTS = [0, 10, 25, 45, 70, 100, 150];

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const renderer = new Renderer(canvas);

// ---------- 화면 크기 / 회전 ----------
// 고군분투처럼 세로로 든 폰(터치 화면)에서는 게임 전체를 90도 돌려 가로로 보여준다.
function layout() {
  const rot = matchMedia("(pointer: coarse)").matches && innerHeight > innerWidth;
  const w = rot ? innerHeight : innerWidth;
  const h = rot ? innerWidth : innerHeight;
  const app = $("app");
  app.classList.toggle("rot", rot);
  // 높이가 낮으면(가로로 든 폰) 창 안 여백을 줄인다
  app.classList.toggle("short", h < 520);
  app.style.setProperty("--app-w", `${w}px`);
  app.style.setProperty("--app-h", `${h}px`);
  renderer.rotated = rot;
  renderer.resize();
}
addEventListener("resize", layout);
addEventListener("orientationchange", () => setTimeout(layout, 150));
layout();

let G = null;
// 진행 중인 월드컵: { bracket: [상대 id × 5], round, gf, ga, games: [{ opp, mine, theirs }] }
let CUP = null;
// 막 끝난 대회 (기록 등록용)
let lastCup = null;
let matching = null;
let cachedClientIp = null;

function seededRandom(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function todayKeyKST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

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

// 플레이 통계: 월드컵은 대회 하나에 "penalty" 1회, 온라인은 경기마다 "penalty-online"
async function logPlay(mode) {
  const key = mode === "online" ? "penalty-online" : "penalty";
  if (IS_LOCAL) return;
  try {
    const ip = await getClientIp();
    await Promise.all([
      addDoc(collection(db, "playLogs"), { ts: serverTimestamp(), ip, game: key }),
      setDoc(doc(db, "statsCounters", "totals"), { [key]: increment(1) }, { merge: true }),
      setDoc(doc(db, "statsDaily", todayKeyKST()), { [key]: increment(1) }, { merge: true }),
    ]);
  } catch (error) {
    console.error("logPlay failed", error);
  }
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

const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const flagImg = (id, cls = "flag") => `<img class="${cls}" src="${flagUrl(id)}" alt="">`;

function showOnly(id) {
  for (const s of ["cup", "menu", "matching", "joinRoom", "result", "cupEnd", "confirm"]) $(s).hidden = s !== id;
}

function showHome() {
  showOnly(PAGE_MODE === "online" ? "menu" : "cup");
  if (PAGE_MODE === "online") renderMenu();
  else renderCup();
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

// ---------- 월드컵 (CPU) ----------
function renderBoard(el, rows) {
  const me = rank.deviceId();
  el.innerHTML = rows.length
    ? `<table class="lb"><tr><th>#</th><th>닉네임</th><th>기록</th><th>득</th><th>실</th></tr>${withRanks(rows).map((r) =>
      `<tr class="${r.id === me ? "me" : ""}"><td>${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td><td>${escapeHtml(r.nickname)}</td><td>${STAGE_LABEL[r.stage] || ""}</td><td>${r.gf}</td><td>${r.ga}</td></tr>`).join("")}</table>`
    : '<div class="lb-msg">아직 기록이 없어요. 첫 우승의 주인공이 되어보세요!</div>';
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

// 대진표: 라운드마다 대한민국 vs 고정 상대. 지나간 경기는 점수, 다음 경기는 강조.
function renderCup() {
  const round = CUP ? CUP.round : 0;
  const kor = nationById(MY_CUP_TEAM);
  $("cupBracket").innerHTML = ROUNDS.map((label, i) => {
    const opp = CUP_BRACKET[i];
    const game = CUP && CUP.games[i];
    const state = game ? "done" : i === round ? "now" : "";
    const mid = game ? `<b class="vs">${game.mine} : ${game.theirs}</b>` : '<b class="vs">vs</b>';
    return `<div class="match ${state}"><span class="rd">${label}</span>
      <span class="side">${flagImg(MY_CUP_TEAM)}<span>${kor.name}</span></span>${mid}
      <span class="side opp"><span>${nationById(opp).name}</span>${flagImg(opp)}</span></div>`;
  }).join("");
  // 대회 중(경기 사이)에는 설명 대신 방금 경기 결과를 띄운다
  const last = CUP && CUP.games[CUP.games.length - 1];
  $("cupHowto").hidden = !!last;
  $("cupMsg").hidden = !last;
  if (last) $("cupMsg").textContent = `🎉 ${nationById(last.opp).name}에 ${last.mine}:${last.theirs} 승리! ${ROUNDS[round]} 진출`;
  $("cupStats").hidden = !CUP;
  if (CUP) $("cupStats").textContent = `지금까지 넣은 골 ${CUP.gf} · 먹힌 골 ${CUP.ga}`;
  $("cupStart").textContent = `${ROUNDS[round]} 킥오프!`;
}

function startCupMatch() {
  const round = CUP.round;
  startGame({ mode: "cpu", level: ROUND_LEVEL[round], myTeam: MY_CUP_TEAM, oppTeam: CUP.bracket[round], round });
}

$("cupStart").addEventListener("click", () => {
  unlockAudio();
  sfx.click();
  if (!CUP) {
    CUP = { bracket: CUP_BRACKET, round: 0, gf: 0, ga: 0, games: [] };
    rank.start();
    logPlay("cpu");
  }
  startCupMatch();
});

// 탈락하거나 우승하면 대회가 끝난다. stage: 1=32강 … 5=준우승, 6=우승
function finishCup(stage) {
  const cup = CUP;
  CUP = null;
  cup.stage = stage;
  lastCup = cup;
  const champion = stage === 6;
  window.FSPoints?.earn("penalty", CUP_POINTS[stage] + 3 * cup.gf, `월드컵 ${STAGE_LABEL[stage]}${champion ? "" : " 탈락"} · ${cup.gf}득 ${cup.ga}실`);
  $("cupEndHead").textContent = champion ? "🏆 월드컵 우승" : "대회 종료";
  $("cupEndEmoji").textContent = champion ? "🏆" : stage >= 4 ? "🥲" : "😭";
  $("cupEndTitle").textContent = champion ? "대한민국 우승!!" : stage === 5 ? "준우승!" : `${STAGE_LABEL[stage]} 탈락`;
  $("cupEndStats").innerHTML = `
    <div class="big-stats"><span>넣은 골 <b>${cup.gf}</b></span><span>먹힌 골 <b>${cup.ga}</b></span></div>
    <ul class="games">${cup.games.map((g, i) => `<li><span>${ROUNDS[i]}</span>${flagImg(g.opp)}<span class="g-name">${nationById(g.opp).name}</span><b>${g.mine} : ${g.theirs}</b><i>${g.mine > g.theirs ? "✅" : "❌"}</i></li>`).join("")}</ul>`;
  $("nickInput").value = store.get("pkNickname") || store.get("gogunNickname") || store.get("jellyNickname") || "";
  $("nickMsg").textContent = "닉네임을 입력하고 기록을 등록하세요";
  $("nickGo").disabled = false;
  $("hud").hidden = true;
  showOnly("cupEnd");
  loadBoard($("cupEndBoard"));
  if (champion) sfx.win();
  else sfx.lose();
}

$("nickForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nick = $("nickInput").value.trim().slice(0, 20);
  if (!nick) {
    $("nickMsg").textContent = "닉네임을 입력해 주세요";
    $("nickInput").focus();
    return;
  }
  if (!lastCup) return;
  store.set("pkNickname", nick);
  $("nickGo").disabled = true;
  $("nickMsg").textContent = "등록 중…";
  try {
    const res = await rank.submit(nick, { stage: lastCup.stage, gf: Math.min(999, lastCup.gf), ga: Math.min(999, lastCup.ga) });
    if (res.ok) {
      $("nickMsg").textContent = "랭킹에 등록됐어요!";
      const rows = await rank.top(20);
      renderBoard($("cupEndBoard"), rows);
      const mine = withRanks(rows).find((r) => r.id === rank.deviceId());
      if (mine) window.FSPoints?.rankBonus?.("penalty", mine.rank);
    } else {
      const b = res.best;
      $("nickMsg").textContent = `내 최고 기록(${STAGE_LABEL[b.stage]} · ${b.gf}득 ${b.ga}실)이 더 좋아서 유지돼요`;
    }
  } catch (err) {
    console.error(err);
    $("nickGo").disabled = false;
    $("nickMsg").textContent = "등록에 실패했어요. 잠시 후 다시 시도해 주세요.";
  }
});

$("cupAgain").addEventListener("click", () => {
  sfx.click();
  showHome();
});

// ---------- 온라인 메뉴 ----------
// 온라인은 팀을 고르지 않는다: 내 쪽은 빨강, 상대는 파랑
const sel = { online: "random" };
try {
  Object.assign(sel, JSON.parse(store.get("pkSelOnline") || "{}"));
} catch (_) {
  // 무시
}
const saveSel = () => store.set("pkSelOnline", JSON.stringify({ online: sel.online }));

function renderMenu() {
  for (const b of $("onlineKinds").querySelectorAll("button")) b.classList.toggle("on", b.dataset.online === sel.online);
}

$("onlineKinds").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  unlockAudio();
  sfx.click();
  sel.online = b.dataset.online;
  saveSel();
  renderMenu();
});

$("startBtn").addEventListener("click", () => {
  unlockAudio();
  sfx.click();
  if (sel.online === "random") startRandom();
  else if (sel.online === "host") startHost();
  else showJoin();
});

async function startRandom() {
  showOnly("matching");
  $("roomCode").hidden = true;
  $("matchMsg").textContent = "상대 찾는 중";
  try {
    matching = await findMatch(db, { timeoutMs: MATCH_WAIT_MS, onTick: (left) => ($("matchMsg").textContent = `상대 찾는 중 ${Math.ceil(left / 1000)}`) });
    const found = await matching.result;
    matching = null;
    if (!found) {
      showHome();
      toast("상대가 없어요. 잠시 후 다시 해보세요");
      return;
    }
    startGame({ mode: "online", role: found.role, matchId: found.matchId });
  } catch (err) {
    console.error(err);
    matching = null;
    showHome();
    toast("연결에 실패했어요");
  }
}

async function startHost() {
  showOnly("matching");
  $("matchMsg").textContent = "친구 기다리는 중";
  try {
    matching = await openRoom(db);
    $("roomCode").hidden = false;
    $("roomCode").textContent = matching.code;
    const found = await matching.result;
    matching = null;
    if (!found) {
      showHome();
      return;
    }
    startGame({ mode: "online", role: found.role, matchId: found.matchId });
  } catch (err) {
    console.error(err);
    matching = null;
    showHome();
    toast("방을 못 만들었어요");
  }
}

$("matchCancel").addEventListener("click", async () => {
  sfx.click();
  if (matching) await matching.cancel();
  matching = null;
  showHome();
});

function showJoin() {
  showOnly("joinRoom");
  $("roomInput").value = "";
  $("joinMsg").textContent = "";
  setTimeout(() => $("roomInput").focus(), 50);
}
$("joinCancel").addEventListener("click", () => {
  sfx.click();
  showHome();
});
$("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("roomInput").value.trim();
  if (!/^\d{4}$/.test(code)) {
    $("joinMsg").textContent = "숫자 4자리";
    return;
  }
  $("joinGo").disabled = true;
  const r = await joinRoom(db, code);
  $("joinGo").disabled = false;
  if (!r.ok) {
    $("joinMsg").textContent = r.reason === "started" ? "이미 시작한 방이에요" : "없는 방이에요";
    return;
  }
  startGame({ mode: "online", role: r.online.role, matchId: r.online.matchId });
});

// ---------- 경기 ----------
const LINES = {
  goal: [["골~~~!!", "그물이 운다"], ["꽂혔다!", "키퍼는 구경꾼"], ["GOAL!!", "이게 들어가네"], ["들어갔다!", "해설 목 나감"]],
  save: [["선방!!", "손바닥 장인"], ["막았다!", "오늘 밥값 했다"], ["슈퍼 세이브", "키퍼 연봉 인상"]],
  post: [["땡!!", "골대가 수비함"], ["골대!!", "기둥아 고마워"]],
  bar: [["크로스바!!", "땡그랑~"], ["깡!!", "골대 찌그러짐"]],
  wide: [["빗나감!", "관중석 시력검사"], ["어디 차냐", "옆집 공 됨"]],
  over: [["홈런!!", "공은 우주로"], ["하늘 높이~", "관중 한 명 기절"]],
  fall: [["철퍼덕!", "다리가 꼬였다"], ["으앙 넘어짐", "5초 안에 차야지..."]],
};
const COLORS = {
  goal: ["#fff36b", "#ff9d00"],
  save: ["#9ff3ff", "#2a8cff"],
};

function startGame(cfg) {
  const now = performance.now();
  const me = cfg.mode === "online" ? (cfg.role === "host" ? "home" : "away") : "home";
  const them = other(me);
  const seed = cfg.matchId || `${Date.now()}${Math.random()}`;
  const rnd = seededRandom(seed);
  const first = rnd() < 0.5 ? "home" : "away";
  // 선수는 경기마다 생김새·등번호를 새로 뽑는다 (온라인은 경기 id로 뽑아서 양쪽 화면이 같다)
  const lineups = { home: randomSquad(rnd), away: randomSquad(rnd) };
  const cpu = cfg.mode === "cpu";
  const names = cpu
    ? { [me]: nationById(cfg.myTeam).name, [them]: nationById(cfg.oppTeam).name }
    : { [me]: "우리 팀", [them]: "상대 팀" };
  G = {
    mode: cfg.mode,
    level: cfg.level,
    round: cfg.round,
    me,
    them,
    oppTeam: cfg.oppTeam,
    names,
    lineups,
    kits: cpu
      ? { [me]: homeKit(cfg.myTeam), [them]: opponentKit(cfg.myTeam, cfg.oppTeam) }
      : { [me]: ONLINE_KITS.me, [them]: ONLINE_KITS.opp },
    gkKits: cpu
      ? { [me]: gkKit(cfg.myTeam), [them]: gkKit(cfg.oppTeam) }
      : { [me]: ONLINE_KITS.meGk, [them]: ONLINE_KITS.oppGk },
    first,
    kicks: [],
    history: [],
    phase: "coin",
    coinUntil: now + COIN_MS,
    turn: null,
    popups: [],
    banner: {
      title: cpu ? `월드컵 ${ROUNDS[cfg.round]}!` : "동전 던지기!",
      sub: cpu ? `vs ${names[them]} · ${names[first]} 먼저` : `${first === me ? "우리" : "상대"} 팀이 먼저 차요`,
      t0: now / 1000,
      c1: "#7fd1ff",
      c2: "#1f5fbf",
    },
    flashUntil: 0,
    shakeUntil: 0,
    channel: null,
    rnd: cpu ? Math.random : rnd,
    forfeit: false,
  };
  showOnly(null);
  $("hud").hidden = false;
  document.body.classList.add("playing");
  renderer.shuffleAds();
  sfx.whistle();
  if (cfg.mode === "online") {
    logPlay("online");
    const ch = new MatchChannel(db, cfg.matchId, cfg.role);
    G.channel = ch;
    G.role = cfg.role;
    ch.watchMatch((m) => {
      if (G && G.channel === ch && m.left && m.left !== cfg.role && G.phase !== "end") {
        endGame(me, true);
      }
    });
  }
}

function lookFor(team, player, keeper) {
  return { player, kit: keeper ? G.gkKits[team] : G.kits[team], front: keeper };
}

function startKick(now) {
  const st = shootout(G.kicks, G.first);
  const kickTeam = st.next;
  const keepTeam = other(kickTeam);
  const nth = G.kicks.filter((k) => k.team === kickTeam).length;
  const kicker = kickerAt(G.lineups[kickTeam], nth);
  const keeper = G.lineups[keepTeam].gk;
  const seq = G.kicks.length;
  const mine = kickTeam === G.me;
  G.phase = "kick";
  G.popups = [];
  G.turn = {
    seq,
    kickTeam,
    keepTeam,
    kicker,
    keeper,
    myRole: mine ? "kick" : "keep",
    oppRole: mine ? "keep" : "kick",
    phase: "intro",
    introUntil: now + INTRO_MS,
    inputs: { kick: null, keep: null },
    gaugeSweeps: gaugeSweeps(Math.random),
    gaugeStart: 0,
    drag: null,
    target: null,
    myDone: false,
    kickerLook: lookFor(kickTeam, kicker, false),
    keeperLook: lookFor(keepTeam, keeper, true),
  };
  G.banner = {
    title: st.sudden ? "서든데스!" : `${nth + 1}번 키커`,
    sub: mine ? "내가 찰 차례!" : "막아라!",
    t0: now / 1000,
    c1: mine ? "#7fd1ff" : "#ff8fb8",
    c2: mine ? "#1f5fbf" : "#b0124f",
  };
  if (G.channel) {
    G.channel.watchKick(seq, (data) => {
      const t = G && G.turn;
      if (!t || t.seq !== seq) return;
      const oppKey = G.role === "host" ? "guest" : "host";
      if (data[oppKey] && !t.inputs[t.oppRole]) t.inputs[t.oppRole] = data[oppKey];
    });
  }
}

function submitMine(t, input) {
  if (t.myDone) return;
  t.myDone = true;
  t.inputs[t.myRole] = input;
  if (G.channel) G.channel.submit(t.seq, input).catch((e) => console.error(e));
}

// 드래그 거리(화면) → 골대 기준 미터. 누른 곳이 골대 가운데 1m 높이에 해당한다.
function dragMeters(d) {
  return { x: ((d.x - d.sx) / PX_PER_M.x) * 1.25, y: 1 - ((d.y - d.sy) / PX_PER_M.y) * 1.25, len: Math.hypot(d.x - d.sx, d.y - d.sy) };
}

// 키커 조준점: 커서(손가락)가 있는 곳 그대로. 화살표 끝 = 공 중심이라 공 반지름만큼 내린다.
function aimTarget(d) {
  const [x, y] = fromScreen(d.x, d.y);
  return clampAim(x, y - BALL);
}

// 키퍼 목표: 살짝 건드리기만 하면 가운데에서 버티기 (null)
function dragTarget(d) {
  const m = dragMeters(d);
  return m.len < 12 ? null : clampKeep(m.x, m.y);
}

function currentGauge(t, now) {
  return t.myDone ? t.gauge : t.drag ? gaugeAt(now - t.gaugeStart, t.gaugeSweeps) : 0;
}

// 손을 뗀 순간의 조준점과 게이지로 찬다
function releaseKick(t, now) {
  if (!t.drag || t.myDone) return;
  const g = gaugeAt(now - t.gaugeStart, t.gaugeSweeps);
  const aim = aimTarget(t.drag);
  t.gauge = g;
  t.target = aim;
  t.drag = null;
  t.zonePop = { name: ZONES[zoneOf(g)].name, t0: now };
  submitMine(t, shotFromAim(aim.x, aim.y, g, Math.random));
  sfx.lock();
}

function finishDrag(t) {
  if (t.myDone) return;
  const tg = t.drag ? dragTarget(t.drag) : null;
  t.drag = null;
  t.target = tg;
  submitMine(t, tg ? { x: Math.round(tg.x * 1000), y: Math.round(tg.y * 1000) } : { stay: 1 });
  sfx.lock();
}

function update(now) {
  if (!G) return;
  if (G.phase === "coin" && now >= G.coinUntil) {
    G.banner = null;
    startKick(now);
  }
  if (G.phase !== "kick") return;
  const t = G.turn;
  if (t.phase === "intro" && now >= t.introUntil) {
    t.phase = "input";
    t.inputStart = now;
    G.banner = null;
    sfx.whistle();
    if (G.mode === "cpu") {
      t.cpuAt = now + 900 + G.rnd() * 2800;
      t.cpuInput = t.oppRole === "kick" ? cpuKick(G.level, G.rnd) : cpuKeep(G.level, G.rnd, G.history);
    }
  }
  if (t.phase === "input") {
    const el = now - t.inputStart;
    // 남은 2초는 째깍째깍
    const sec = Math.ceil((INPUT_MS - el) / 1000);
    if (sec <= 2 && sec >= 1 && t.lastTick !== sec && !t.myDone) {
      t.lastTick = sec;
      sfx.tick();
    }
    if (!t.myDone && el >= INPUT_MS) {
      if (t.myRole === "kick") {
        if (t.drag) releaseKick(t, t.inputStart + INPUT_MS);
        else submitMine(t, { fail: 1 });
      } else finishDrag(t);
    }
    if (G.mode === "cpu" && !t.inputs[t.oppRole] && now >= t.cpuAt) t.inputs[t.oppRole] = t.cpuInput;
    if (t.inputs.kick && t.inputs.keep) startPlay(t, now);
    else if (G.mode === "online" && t.myDone && el > INPUT_MS + AFK_GRACE) endGame(G.me, true);
  } else if (t.phase === "play") {
    const tt = (now - t.play.start) / 1000;
    const res = t.play.res;
    const arrive = arriveTime(res);
    const fired = t.play.fired;
    const once = (key, at, fn) => {
      if (!fired[key] && tt >= at) {
        fired[key] = true;
        fn();
      }
    };
    once("kick", KICK_T, () => (res.outcome === "fall" ? sfx.boing() : sfx.kick()));
    once("arrive", res.outcome === "fall" ? KICK_T + 0.35 : arrive, () => onArrive(t, now));
    if (res.outcome === "over") once("ouch", arrive + 0.4, () => sfx.ouch());
    if (tt >= playLength(res)) {
      G.kicks.push({ team: t.kickTeam, goal: isGoal(res) });
      const st = shootout(G.kicks, G.first);
      if (st.winner) endGame(st.winner, false);
      else startKick(now);
    }
  }
}

function startPlay(t, now) {
  t.phase = "play";
  const keeperIsCpu = G.mode === "cpu" && t.keepTeam === G.them;
  const sav = KEEPER_SAV + (keeperIsCpu ? cpuSavBonus(G.level) : 0);
  const res = resolveKick(t.inputs.kick, t.inputs.keep, sav);
  t.play = { res, keep: t.inputs.keep, kickerLook: t.kickerLook, keeperLook: t.keeperLook, start: now, fired: {} };
  if (t.myRole === "kick" && t.inputs.kick.x != null) G.history.push(Math.sign(t.inputs.kick.x));
}

function onArrive(t, now) {
  const out = t.play.res.outcome;
  const lines = LINES[out];
  const [text, sub] = lines[t.seq % lines.length];
  const [c1, c2] = COLORS[out] || ["#ffb3b3", "#e01e1e"];
  G.popups = [{ text, sub, x: 400, y: out === "fall" ? 300 : 200, size: 66, c1, c2, t0: now / 1000 }];
  if (out === "goal") {
    sfx.goal();
    G.flashUntil = now + 160;
    G.shakeUntil = now + 450;
    G.hypeUntil = now + 2200;
  } else if (out === "save") {
    sfx.save();
    G.shakeUntil = now + 250;
    G.hypeUntil = now + 1500;
  } else if (out === "post" || out === "bar") {
    sfx.post();
    sfx.groan();
    G.shakeUntil = now + 300;
  } else {
    sfx.groan();
  }
}

function endGame(winner, forfeit) {
  if (!G || G.phase === "end") return;
  G.phase = "end";
  G.forfeit = forfeit;
  document.body.classList.remove("playing");
  const win = winner === G.me;
  const st = shootout(G.kicks, G.first);
  const mine = st.score[G.me].goals;
  const theirs = st.score[G.them].goals;
  if (G.channel) G.channel.close();

  if (G.mode === "cpu") {
    const cup = CUP;
    cup.gf += mine;
    cup.ga += theirs;
    cup.games.push({ opp: G.oppTeam, mine, theirs });
    const round = cup.round;
    setTimeout(() => {
      if (!win) return finishCup(round + 1);
      if (round === ROUNDS.length - 1) return finishCup(6);
      // 이기면 대진표를 한 번 보여주고, 거기서 다음 경기로 넘어간다
      cup.round++;
      sfx.win();
      G = null;
      $("hud").hidden = true;
      showHome();
    }, 1400);
    return;
  }

  window.FSPoints?.earn("penalty", (win ? 50 : 10) + 5 * mine, `온라인 ${win ? "승리" : "패배"} ${mine}:${theirs}`);
  setTimeout(() => {
    win ? sfx.win() : sfx.lose();
    $("resultHead").textContent = "경기 종료";
    $("resultEmoji").textContent = win ? "🏆" : "😭";
    $("resultTitle").textContent = win ? "승리!" : "패배...";
    $("resultScore").textContent = `${mine} : ${theirs}`;
    $("resultSub").textContent = forfeit ? (win ? "🏳️ 상대가 나갔어요" : "🏳️ 기권") : win ? "강철 멘탈 인정" : "다음엔 꾹 더 길게...";
    $("hud").hidden = true;
    showOnly("result");
  }, forfeit ? 300 : 1400);
}

// 경기 중 나가기: 사이트 홈으로. 온라인은 상대에게 기권승을 알리고 나간다.
// 월드컵은 진행 중이던 대회가 그대로 사라진다 (기록·포인트 없음).
async function leaveGame() {
  if (G && G.channel) {
    await Promise.race([G.channel.leave(), new Promise((r) => setTimeout(r, 800))]);
    G.channel.close();
  }
  G = null;
  location.href = "../";
}

$("againBtn").addEventListener("click", () => {
  sfx.click();
  G = null;
  showHome();
  $("startBtn").click();
});
$("menuBtn").addEventListener("click", () => {
  sfx.click();
  G = null;
  showHome();
});
$("exitBtn").addEventListener("click", () => {
  sfx.click();
  $("confirmSub").textContent = G && G.mode === "cpu" ? "홈으로 가요. 이번 대회 기록은 남지 않아요" : G && G.mode === "online" ? "홈으로 가요. 상대에게 기권승이 돌아가요" : "";
  $("confirm").hidden = false;
});
$("confirmStay").addEventListener("click", () => {
  sfx.click();
  $("confirm").hidden = true;
});
$("confirmLeave").addEventListener("click", () => {
  sfx.click();
  $("confirm").hidden = true;
  leaveGame();
});
window.addEventListener("pagehide", () => {
  if (G && G.channel && G.phase !== "end") G.channel.leave();
});

// ---------- 소리 크기 ----------
// 경기 화면과 메뉴마다 같은 조절기가 있다. 마우스는 올리면 펼쳐지고, 터치는 첫 탭에 펼친다.
// 펼친 상태에서 아이콘을 누르면 음소거 / 해제.
let volumeBeforeMute = 0.8;
let lastPointer = "mouse";
function syncVolume() {
  const v = getVolume();
  const icon = v === 0 ? "🔇" : v < 0.34 ? "🔈" : v < 0.67 ? "🔉" : "🔊";
  for (const b of document.querySelectorAll(".sound-icon")) {
    b.textContent = icon;
    b.setAttribute("aria-label", v === 0 ? "음소거 해제" : "음소거");
  }
  for (const r of document.querySelectorAll(".sound-range")) r.value = String(Math.round(v * 100));
}
for (const box of document.querySelectorAll(".sound")) {
  const btn = box.querySelector(".sound-icon");
  btn.addEventListener("pointerdown", (e) => {
    lastPointer = e.pointerType;
  });
  btn.addEventListener("click", () => {
    unlockAudio();
    if (lastPointer !== "mouse" && !box.classList.contains("open")) {
      box.classList.add("open");
      return;
    }
    const v = getVolume();
    if (v > 0) {
      volumeBeforeMute = v;
      setVolume(0);
    } else setVolume(volumeBeforeMute || 0.8);
    syncVolume();
  });
  const range = box.querySelector(".sound-range");
  range.addEventListener("input", () => {
    unlockAudio();
    setVolume(Number(range.value) / 100);
    syncVolume();
  });
  // 손을 떼면 바뀐 크기로 한 번 들려준다
  range.addEventListener("change", () => sfx.kick());
}
// 바깥을 누르면 펼친 조절기를 접는다
document.addEventListener("pointerdown", (e) => {
  for (const box of document.querySelectorAll(".sound.open")) if (!box.contains(e.target)) box.classList.remove("open");
});
syncVolume();

// ---------- 입력 ----------
function myInputTurn() {
  const t = G && G.phase === "kick" ? G.turn : null;
  return t && t.phase === "input" && !t.myDone ? t : null;
}

// 폰에서는 캔버스 바깥 빈 곳도 누를 수 있게 문서 전체에서 받는다 (버튼·창 위는 제외)
document.addEventListener("pointerdown", (e) => {
  unlockAudio();
  const t = myInputTurn();
  if (!t || e.target.closest("button, a, input, .overlay, .sound")) return;
  e.preventDefault();
  // 키커·키퍼 모두 드래그. 키커는 누르는 순간 슛 게이지가 움직이기 시작한다.
  const [x, y] = renderer.toLogical(e.clientX, e.clientY);
  t.drag = { sx: x, sy: y, x, y };
  if (t.myRole === "kick") {
    t.gaugeStart = performance.now();
    t.target = aimTarget(t.drag);
  }
});
document.addEventListener("pointermove", (e) => {
  const t = myInputTurn();
  if (!t || !t.drag) return;
  const [x, y] = renderer.toLogical(e.clientX, e.clientY);
  t.drag.x = x;
  t.drag.y = y;
  t.target = t.myRole === "kick" ? aimTarget(t.drag) : dragTarget(t.drag);
});
const onUp = () => {
  const t = myInputTurn();
  if (!t) return;
  if (t.myRole === "kick") releaseKick(t, performance.now());
  else if (t.drag) finishDrag(t);
};
document.addEventListener("pointerup", onUp);
document.addEventListener("pointercancel", onUp);

// ---------- 화면 ----------
function hudOf() {
  const st = shootout(G.kicks, G.first);
  const marks = (team) => {
    const m = G.kicks.filter((k) => k.team === team).map((k) => k.goal);
    while (m.length < 5) m.push(null);
    return m;
  };
  const side = (team) => ({ name: G.names[team], kit: G.kits[team], goals: st.score[team].goals, marks: marks(team) });
  const h = { left: side(G.me), right: side(G.them), sudden: st.sudden };
  if (G.mode === "cpu") {
    h.left.tag = "(나)";
    h.right.tag = "CPU";
    h.round = ROUNDS[G.round];
  }
  return h;
}

// 메뉴 뒤 배경: 대한민국 키커 vs 아르헨티나 키퍼 (생김새는 랜덤)
const MENU_SQUAD = randomSquad();
const MENU_KICKER = { player: MENU_SQUAD.order[0], kit: homeKit(MY_CUP_TEAM), front: false };
const MENU_KEEPER = { player: MENU_SQUAD.gk, kit: gkKit("arg"), front: true };

function view(now) {
  const v = { now, popups: [], banner: null };
  if (!G) {
    v.scene = idleScene(MENU_KICKER, MENU_KEEPER, now / 1000, false);
    return v;
  }
  v.hud = hudOf();
  v.popups = G.popups;
  v.banner = G.banner;
  v.flash = now < G.flashUntil ? 1 : 0;
  v.shake = now < G.shakeUntil ? (G.shakeUntil - now) / 450 : 0;
  v.crowdHype = now < (G.hypeUntil || 0);
  const t = G.turn;
  if (!t) {
    const f = G.first;
    v.scene = idleScene(lookFor(f, G.lineups[f].order[0], false), lookFor(other(f), G.lineups[other(f)].gk, true), now / 1000, false);
    return v;
  }
  if (t.phase === "play") {
    const tt = Math.min((now - t.play.start) / 1000, playLength(t.play.res));
    v.scene = playScene(t.play, tt);
    return v;
  }
  v.scene = idleScene(t.kickerLook, t.keeperLook, now / 1000, !!t.drag);
  if (t.phase === "input") {
    const left = Math.max(0, INPUT_MS - (now - t.inputStart));
    const oppReady = !!t.inputs[t.oppRole];
    if (t.myRole === "kick") {
      v.ui = { role: "kick", target: t.target, aiming: !!t.drag, gauge: currentGauge(t, now), done: t.myDone, zonePop: t.zonePop };
    } else {
      v.ui = { role: "keep", target: t.target, dragging: !!t.drag, done: t.myDone, keeperLook: t.keeperLook };
    }
    // 내가 먼저 끝냈으면 상대를 기다리는 동안에도 남은 시간을 보여준다
    v.ui.timeLeft = t.myDone && oppReady ? null : left;
    v.ui.oppReady = oppReady && !t.myDone;
    v.ui.waiting = t.myDone && !oppReady;
  }
  return v;
}

function frame(now) {
  update(now);
  renderer.draw(view(now));
  requestAnimationFrame(frame);
}

// 로컬 디버그용: 콘솔에서 __pk()로 현재 경기 상태를 본다
if (IS_LOCAL) window.__pk = () => ({ G, CUP });

showHome();
requestAnimationFrame(frame);
// 탭이 뒤로 가면 rAF가 멈추므로 판정·타이머는 따로 돌린다 (온라인 상대가 안 멈추게)
setInterval(() => update(performance.now()), 100);
