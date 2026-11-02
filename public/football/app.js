import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  addDoc, collection, connectFirestoreEmulator, doc, getFirestore, increment, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { Stage, portraitUrl } from "./render.js";
import { FX } from "./fx.js";
import { sfx, unlockAudio, getVolume, setVolume } from "./audio.js";
import { createPlanner } from "./ai.js";
import { clubById, logoUrl, opponentKit, pickCpuClub } from "./clubs.js";
import { SQUADS, playerById, validLineup } from "./players.js";
import { initMenu, renderMenu, getSelection } from "./menu.js";
import { ITEMS, MAX_HELD, applyLaunchItem, resetBall, tickEffects, spawnItem, cpuPickItem, canPower, canRed, itemDesc, pickupType } from "./items.js";
import { iconEl, iconSvg, iconInner } from "./icons.js";
import { findMatch, MatchChannel, openRoom, joinRoom } from "./online.js";
import {
  FIELD, DT, BOBBLE_R, BALL_R, FORMATIONS, createWorld, cloneWorld, kickoffBodies, applyMoves, step, isSettled, getBall,
} from "./physics.js";

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
// 로컬 테스트용: ?give=power 처럼 주면 내 턴마다 그 아이템으로 칸을 꽉 채워 준다 (쉼표로 여러 개)
const TEST_GIVE = IS_LOCAL ? (new URLSearchParams(location.search).get("give") || "").split(",").filter((t) => ITEMS[t]) : [];

// 몇 골이 나든 12턴을 다 하고, 그때 비겨 있으면 골든골
const MAX_TURNS = 12;
const EXEC_LIMIT = 7;
const ONLINE_TURN = 15;
const MATCH_WAIT_MS = 20000;
// 내가 수를 낸 뒤 이만큼 지나도 상대가 안 내면 나간 걸로 본다
const AFK_GRACE = 25;
const EMOTES = ["👏", "😂", "😱", "😜", "🥱"];
const TAUNTS = ["😜", "🥱"];

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stage = new Stage(canvas);
const fx = new FX(stage);
const other = (team) => (team === "home" ? "away" : "home");

let game = null;
let drag = null;
let idleWorld = null;
let matching = null;
let cachedClientIp = null;

// 온라인 첫 아이템 상자는 양쪽 화면에서 같은 자리에 떠야 해서 경기 id로 만든 난수를 쓴다
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

// 라인업(선수 id) -> 물리가 쓰는 { formation, members: { gk, a, b, c } }
function teamOf(clubId, lu) {
  const members = {};
  for (const key of ["gk", "a", "b", "c"]) members[key] = playerById(clubId, lu[key]);
  return { formation: lu.formation, members };
}

// CPU 라인업: 필드 선수 3명을 랜덤으로 뽑고, 몸싸움이 센 선수를 뒤에, 슈팅이 센 선수를 앞에 세운다
function cpuLineup(clubId) {
  const players = SQUADS[clubId].players;
  const field = players.filter((p) => p.pos !== "GK").sort(() => Math.random() - 0.5).slice(0, 3);
  field.sort((p, q) => (q.stats.phy - q.stats.sht) - (p.stats.phy - p.stats.sht));
  const formations = Object.keys(FORMATIONS);
  return {
    formation: formations[Math.floor(Math.random() * formations.length)],
    gk: players.find((p) => p.pos === "GK").id,
    a: field[0].id, b: field[1].id, c: field[2].id,
  };
}

function lookResolver(clubs) {
  return (body) => playerById(clubs[body.team], body.pid);
}

// 메뉴 뒤에 깔리는 경기장: 지금 고른 내 팀 + 아무 상대
function refreshIdle() {
  const sel = getSelection();
  const opp = pickCpuClub(sel.clubId);
  idleWorld = createWorld(kickoffBodies({ home: teamOf(sel.clubId, sel.lineup), away: teamOf(opp.id, cpuLineup(opp.id)) }));
  stage.setFlip(false);
  stage.setTeams({ home: clubById(sel.clubId).home, away: opp.home }, idleWorld.bodies, lookResolver({ home: sel.clubId, away: opp.id }));
  stage.setGoalFlags({
    home: { logo: logoUrl(clubById(sel.clubId)), color: clubById(sel.clubId).home.body },
    away: { logo: logoUrl(opp), color: opp.home.body },
  });
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

// CPU전 결과 기록 (온라인은 턴마다 이미 bobbleMatches에 남는다). 점수·턴·난이도·클럽만 남기고 개인 정보는 없다.
// 로컬에서는 ?emu로 에뮬레이터에 붙었을 때만 남긴다.
function logCpuResult(g) {
  if (IS_LOCAL && !new URLSearchParams(location.search).has("emu")) return;
  addDoc(collection(db, "bobbleCpuResults"), {
    ts: serverTimestamp(), level: g.level, myClub: g.clubs[g.me], cpuClub: g.clubs[g.them],
    my: g.score[g.me], cpu: g.score[g.them], turns: g.turns, golden: !!g.golden,
  }).catch((error) => console.error("logCpuResult failed", error));
}

// 플레이 통계: CPU전은 "bobble", 온라인은 "bobble-online"으로 따로 센다 (온라인은 두 사람이 각자 1판씩)
async function logBobblePlay(mode) {
  const key = mode === "online" ? "bobble-online" : "bobble";
  if (IS_LOCAL) return;
  try {
    const ip = await getClientIp();
    await Promise.all([
      addDoc(collection(db, "playLogs"), { ts: serverTimestamp(), ip, game: key }),
      setDoc(doc(db, "statsCounters", "totals"), { [key]: increment(1) }, { merge: true }),
      setDoc(doc(db, "statsDaily", todayKeyKST()), { [key]: increment(1) }, { merge: true }),
    ]);
  } catch (error) {
    console.error("logBobblePlay failed", error);
  }
}

// ---------- 메뉴 / 매칭 ----------
initMenu({
  onStart: (sel) => begin(sel),
  onChange: () => refreshIdle(),
});

function begin(sel) {
  if (sel.mode !== "online") startMatch({ sel, mode: "cpu" });
  else if (sel.online === "host") startRoom(sel);
  else if (sel.online === "join") openJoin(sel);
  else startMatchmaking(sel);
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// 방 열기: 4자리 코드를 띄우고 친구가 들어올 때까지 기다린다 (시간 제한 없음, ✕로 취소)
async function startRoom(sel) {
  $("menu").hidden = true;
  $("result").hidden = true;
  $("matching").hidden = false;
  $("roomCode").textContent = "····";
  $("roomCode").hidden = false;
  let res = null;
  let handle = null;
  try {
    handle = await openRoom(db, { clubId: sel.clubId, lineup: sel.lineup });
    matching = handle;
    $("roomCode").textContent = handle.code;
    res = await handle.result;
  } catch (error) {
    console.error("open room failed", error);
  }
  matching = null;
  $("matching").hidden = true;
  $("roomCode").hidden = true;
  if (res) startMatch({ sel, mode: "online", online: res });
  else showMenu();
}

// 방 참가: 4자리를 다 치면 바로 들어간다
let joinSel = null;
let joining = false;
function openJoin(sel) {
  joinSel = sel;
  $("menu").hidden = true;
  $("result").hidden = true;
  $("joinMsg").textContent = "";
  $("roomInput").value = "";
  $("joinGo").disabled = false;
  $("joinRoom").hidden = false;
  setTimeout(() => $("roomInput").focus(), 50);
}
function closeJoin() {
  $("joinRoom").hidden = true;
  joinSel = null;
}
async function submitJoin() {
  const code = $("roomInput").value;
  if (!/^\d{4}$/.test(code) || joining || !joinSel) return;
  joining = true;
  $("joinGo").disabled = true;
  $("joinMsg").textContent = "";
  const sel = joinSel;
  const r = await joinRoom(db, code, { clubId: sel.clubId, lineup: sel.lineup });
  joining = false;
  $("joinGo").disabled = false;
  if (r.ok) {
    closeJoin();
    startMatch({ sel, mode: "online", online: r.online });
  } else if (r.reason === "started") {
    closeJoin();
    showMenu();
    toast("이미 게임이 시작된 방이에요");
  } else {
    $("joinMsg").textContent = "없는 방이에요";
    $("roomInput").select();
  }
}
$("roomInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
  $("joinMsg").textContent = "";
  if (e.target.value.length === 4) submitJoin();
});
$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitJoin();
});
$("joinCancel").addEventListener("click", () => {
  sfx.click();
  closeJoin();
  showMenu();
});

async function startMatchmaking(sel) {
  $("menu").hidden = true;
  $("result").hidden = true;
  $("matching").hidden = false;
  let res = null;
  let handle = null;
  try {
    handle = await findMatch(db, { clubId: sel.clubId, lineup: sel.lineup }, { timeoutMs: MATCH_WAIT_MS });
    matching = handle;
    res = await handle.result;
  } catch (error) {
    console.error("matchmaking failed", error);
  }
  const cancelled = handle && handle.cancelled;
  matching = null;
  $("matching").hidden = true;
  if (cancelled) {
    showMenu();
    return;
  }
  // 20초 안에 못 잡히면 CPU와 붙는다
  if (res) startMatch({ sel, mode: "online", online: res });
  else startMatch({ sel, mode: "cpu" });
}

$("matchCancel").addEventListener("click", async () => {
  sfx.click();
  if (!matching) return;
  matching.cancelled = true;
  await matching.cancel();
});

$("againBtn").addEventListener("click", () => {
  unlockAudio();
  sfx.click();
  const g = game;
  closeGame();
  if (g.mode === "online") begin(g.sel);
  else startMatch({ sel: g.sel, mode: "cpu", fixedOpp: g.clubs[g.them], fixedCpuLineup: g.oppLineup });
});

$("menuBtn").addEventListener("click", () => {
  sfx.click();
  showMenu();
});

// 나가기: 브라우저 confirm 대신 게임 안 확인창 (일부 환경에서 confirm이 막혀 있다)
$("exitBtn").addEventListener("click", () => {
  sfx.click();
  if (!game || game.phase === "end") {
    showMenu();
    return;
  }
  $("confirm").hidden = false;
});
$("confirmStay").addEventListener("click", () => {
  sfx.click();
  $("confirm").hidden = true;
});
$("confirmLeave").addEventListener("click", () => {
  sfx.click();
  $("confirm").hidden = true;
  showMenu();
});

// 소리: 마우스를 올리면 막대가 펼쳐지고, 아이콘을 누르면 음소거/해제.
// 터치 화면은 첫 탭에 펼치고, 펼친 상태에서 아이콘을 누르면 음소거.
let volumeBeforeMute = 0.8;
let lastPointer = "mouse";
function syncVolumeBtn() {
  const v = getVolume();
  $("muteBtn").textContent = v === 0 ? "🔇" : v < 0.34 ? "🔈" : v < 0.67 ? "🔉" : "🔊";
  $("muteBtn").setAttribute("aria-label", v === 0 ? "음소거 해제" : "음소거");
  $("volumeRange").value = String(Math.round(v * 100));
}
$("muteBtn").addEventListener("pointerdown", (e) => {
  lastPointer = e.pointerType;
});
$("muteBtn").addEventListener("click", () => {
  unlockAudio();
  const box = $("sound");
  if (lastPointer !== "mouse" && !box.classList.contains("open")) {
    box.classList.add("open");
    return;
  }
  const v = getVolume();
  if (v > 0) {
    volumeBeforeMute = v;
    setVolume(0);
  } else {
    setVolume(volumeBeforeMute || 0.8);
  }
  syncVolumeBtn();
});
$("volumeRange").addEventListener("input", (e) => {
  unlockAudio();
  setVolume(Number(e.target.value) / 100);
  syncVolumeBtn();
});
$("volumeRange").addEventListener("change", () => sfx.kick(0.6));
syncVolumeBtn();

$("readyBtn").addEventListener("click", () => {
  if (!game || game.phase !== "plan" || game.readyPressed) return;
  sfx.click();
  endDrag(false);
  game.readyPressed = true;
  setTargeting(null);
  $("readyBtn").disabled = true;
  $("readyBtn").textContent = "⏳";
  renderItems();
  if (game.mode === "online") submitMine();
});

window.addEventListener("beforeunload", () => {
  if (game && game.channel && game.phase !== "end") game.channel.leave();
});

function closeGame() {
  if (game && game.channel) {
    if (game.phase !== "end") game.channel.leave();
    game.channel.close();
  }
  sfx.aimEnd();
  game = null;
  drag = null;
}

function showMenu() {
  closeGame();
  fx.resetTime();
  stage.setFocus(null);
  stage.hideArrows();
  stage.setPull(null);
  refreshIdle();
  $("hud").hidden = true;
  $("result").hidden = true;
  $("matching").hidden = true;
  $("roomCode").hidden = true;
  $("joinRoom").hidden = true;
  $("confirm").hidden = true;
  $("sound").classList.remove("open");
  $("menu").hidden = false;
  renderMenu();
}

// ---------- 경기 시작 ----------
function startMatch({ sel, mode, online = null, fixedOpp = null, fixedCpuLineup = null }) {
  const me = online && online.role === "guest" ? "away" : "home";
  const them = other(me);
  const my = clubById(sel.clubId);
  const oppId = online ? online.opp.clubId : fixedOpp || pickCpuClub(my.id).id;
  const oppLineup = online ? validLineup(oppId, online.opp.lineup) : fixedCpuLineup || cpuLineup(oppId);
  const clubs = { [me]: my.id, [them]: oppId };
  game = {
    mode, sel, me, them, clubs, oppLineup, level: sel.level,
    // 각자 자기 팀은 홈 유니폼, 상대만 색이 겹치면 다른 유니폼
    kits: { [me]: my.home, [them]: opponentKit(my.id, oppId) },
    teams: { [me]: teamOf(my.id, sel.lineup), [them]: teamOf(oppId, oppLineup) },
    lookOf: lookResolver(clubs),
    score: { home: 0, away: 0 }, turns: 0, golden: false, ended: false, forfeit: false,
    held: { home: [], away: [] }, prev: null, lastGoal: null,
    phase: "intro", phaseT: 0, world: null, acc: 0, seq: 0,
    moves: {}, varUsed: false, seenItems: new Set(), lock: null, faceOf: {},
    planner: null, readyPressed: false, planDeadline: 0, epoch: 0, instantApplied: false,
    turnData: {}, submittedAt: 0, targeting: null, execT: 0, settleT: 0, syncSince: 0,
    channel: null, role: online ? online.role : null,
  };
  stage.setFlip(me === "away");
  $("menu").hidden = true;
  $("result").hidden = true;
  $("hud").hidden = false;
  $("myLogo").src = logoUrl(my);
  $("oppLogo").src = logoUrl(clubById(oppId));
  renderScore();
  $("timer").hidden = mode !== "online";
  $("emotePanel").hidden = true;
  if (online) {
    const ch = new MatchChannel(db, online.matchId, online.role);
    game.channel = ch;
    ch.watchEmotes((d) => {
      if (game && game.channel === ch && d.by !== game.role) showBubble(game.them, d.e);
    });
    ch.watchMatch((d) => {
      if (game && game.channel === ch && d.left && d.left !== game.role && game.phase !== "end") opponentLeft();
    });
  }
  stage.setGoalFlags({
    [me]: { logo: logoUrl(my), color: game.kits[me].body },
    [them]: { logo: logoUrl(clubById(oppId)), color: game.kits[them].body },
  });
  kickoff([]);
  spawnItem(game.world, online ? seededRandom(online.matchId) : Math.random);
  logBobblePlay(mode);
}

function kickoff(items) {
  game.world = createWorld(kickoffBodies(game.teams), items);
  stage.setTeams(game.kits, everyone(game.world), game.lookOf, game.me);
  enterIntro();
}

function enterIntro() {
  game.phase = "intro";
  game.introUntil = performance.now() + 1300;
  game.acc = 0;
  fx.resetTime();
  stage.setFocus(null);
  setReady(false);
  renderTurn();
  renderItems();
  banner(game.golden ? "골든골!" : "킥오프", true);
  sfx.whistle(1);
}

function setReady(on) {
  const btn = $("readyBtn");
  btn.hidden = !on;
  btn.disabled = false;
  btn.textContent = "준비 완료 ▶";
}

function renderTurn() {
  $("turnLabel").textContent = game.golden ? "⚡" : `${Math.min(game.turns + 1, MAX_TURNS)}/${MAX_TURNS}`;
}

function scoreEl(team) {
  return team === game.me ? $("scoreMe") : $("scoreOpp");
}

function renderScore() {
  scoreEl(game.me).textContent = String(game.score[game.me]);
  scoreEl(game.them).textContent = String(game.score[game.them]);
}

function banner(text, small = false, imgUrl = null) {
  const b = $("banner");
  b.replaceChildren(text);
  if (imgUrl) {
    const img = document.createElement("img");
    img.className = "scorer";
    img.src = imgUrl;
    img.alt = "";
    b.appendChild(img);
  }
  b.classList.toggle("small", small);
  b.classList.remove("show");
  void b.offsetWidth;
  b.classList.add("show");
}

// 점수판 아래에 잠깐 뜨는 말풍선 (이모지, 아이템 공개)
function showBubble(team, text) {
  const el = team === game.me ? $("bubbleMe") : $("bubbleOpp");
  el.replaceChildren(text);
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

// ---------- 계획 단계 ----------
function startPlan() {
  const g = game;
  g.phase = "plan";
  g.readyPressed = false;
  g.moves = {};
  g.faceOf = {};
  g.varUsed = false;
  g.seenItems = new Set();
  if (TEST_GIVE.length) {
    for (const t of TEST_GIVE) if (g.held[g.me].length < MAX_HELD && !g.held[g.me].includes(t)) g.held[g.me].push(t);
  }
  if (g.prevSwap > 0 && !(g.world.fx.swap > 0)) swapBurst(false);
  g.prevSwap = g.world.fx.swap;
  g.lock = null;
  // VAR용: 아이템을 쓰기 전 이번 턴 시작 상태와, 이번 턴에 쓴 아이템 순서
  g.planStart = cloneWorld(g.world);
  g.turnItems = [];
  setTargeting(null);
  hideTip();
  g.planDeadline = performance.now() + ONLINE_TURN * 1000;
  g.epoch = 0;
  g.instantApplied = false;
  g.turnData = {};
  g.submittedAt = 0;
  stage.hideArrows();
  setReady(true);
  renderTurn();
  renderItems();
  if (g.mode === "cpu") {
    cpuUseItem();
    makePlanner();
  } else {
    g.channel.watchTurn(g.seq, onTurnData);
  }
}

// CPU는 계획 시작 때 아이템을 정하고 바로 쓴다 (사람과 똑같이 곧바로 보인다). 한 턴에 여러 개도 쓴다.
function cpuUseItem() {
  const g = game;
  const used = new Set();
  for (let k = 0; k < MAX_HELD; k++) {
    const left = g.held[g.them].filter((t) => !used.has(t));
    const pick = cpuPickItem(g.world, g.them, left, { concededLast: g.lastGoal === g.me, canVar: !!g.prev && !g.varUsed });
    if (!pick) return;
    used.add(pick.type);
    removeHeld(g.them, pick.type);
    applyItem(pick.type, g.them, pick.target);
    if (pick.type === "var") return;
  }
}

function makePlanner() {
  const g = game;
  g.planner = g.lock && g.lock.team === g.them ? null : createPlanner(g.world, g.them, g.level);
}

function removeHeld(team, type) {
  const i = game.held[team].indexOf(type);
  if (i >= 0) game.held[team].splice(i, 1);
}

// 아이템은 쓰는 순간 바로 적용된다. 공 리셋과 VAR은 판이 바뀌므로 양 팀 모두 다시 계획한다.
function applyItem(type, by, target) {
  const g = game;
  if (type === "var") {
    g.varUsed = true;
    g.varBy = by;
  } else {
    g.turnItems.push({ type, team: by, target });
  }
  showBubble(by, iconEl(type));
  if (type === "reset" || type === "var") {
    applyReplan(type, by);
  } else {
    const sentOff = type === "red" && g.world.bodies.find((b) => b.id === target);
    applyLaunchItem(g.world, { type, team: by, target });
    if (sentOff && !g.world.bodies.includes(sentOff)) {
      // 퇴장: 그 자리에 빨간 파동, 정해 둔 이동도 취소
      fx.ring(sentOff.x, sentOff.y, "#ef4444", 4, 0.6);
      sfx.whistle(1);
      delete g.moves[target];
      stage.setArrow(target, sentOff, null);
      if (drag && drag.id === target) endDrag(false);
    }
    if (type === "power") {
      const b = g.world.bodies.find((x) => x.id === target);
      stage.bobbleImpact(target, 0.6);
      if (b) {
        fx.ring(b.x, b.y, "#ff7a1a", 3.5, 0.5);
        fx.flames(b.x, b.y, 14, 1.4);
      }
    }
    if (type === "ice") fx.ring(0, 0, "#bfe9ff", 22, 0.7);
    if (type === "swap") swapBurst(g.world.fx.swap > 0);
    else sfx.pop();
    if (g.mode === "cpu") makePlanner();
  }
  renderItems();
}

// 골대 바꾸기 연출: 두 골대에서 충격파, 화면 번쩍, 배지가 서로 날아가 자리를 바꾼다
function swapBurst(on) {
  const L = FIELD.halfL;
  for (const s of [1, -1]) {
    fx.ring(s * L, 0, "#ffb020", 9, 0.7);
    fx.sparks(s * L, 0, ["#ffb020", "#ffffff", "#ffe066"], 18, 9, 2.2);
  }
  fx.addTrauma(0.35);
  const f = $("flash");
  f.classList.remove("go");
  void f.offsetWidth;
  f.classList.add("go");
  const text = document.createDocumentFragment();
  text.append(iconEl("swap"), on ? " 골대 체인지!" : " 원래 골대로");
  banner(text, true);
  sfx.swap();
}

function applyReplan(type, by) {
  const g = game;
  if (type === "reset") {
    resetBall(g.world, by);
    fx.ring(0, 0, "#ffe066", 4);
    sfx.pop();
  } else {
    doVar(by);
  }
  banner(iconEl(type), true);
  g.planDeadline = performance.now() + ONLINE_TURN * 1000;
  g.epoch++;
  if (type === "var") g.varEpoch = g.epoch;
  g.readyPressed = false;
  g.submittedAt = 0;
  g.moves = {};
  g.faceOf = {};
  endDrag(false);
  stage.hideArrows();
  const lockedMe = g.lock && g.lock.team === g.me;
  setReady(!lockedMe);
  if (lockedMe) {
    // VAR을 당한 쪽: 지난 턴 수 그대로, 손댈 수 없음
    g.moves = { ...g.lock.moves };
    for (const [id, mv] of Object.entries(g.moves)) {
      const b = g.world.bodies.find((x) => x.id === id);
      if (b) stage.setArrow(id, b, mv);
    }
    g.readyPressed = true;
    setTargeting(null);
    if (g.mode === "online") submitMine();
  } else if (g.lock && g.lock.team === g.them) {
    // VAR을 쓴 쪽: 상대가 이번에 똑같이 움직일 거리를 전부 보여준다
    for (const [id, mv] of Object.entries(g.lock.moves)) {
      const b = g.world.bodies.find((x) => x.id === id);
      if (b) stage.setArrow(id, b, mv, "opp");
    }
  }
  if (g.mode === "cpu") makePlanner();
}

// 되감은 판에 아이템 하나를 다시 건다 (연출 없이 효과만)
function replayItem(w, use) {
  if (use.type === "reset") resetBall(w, use.team);
  else applyLaunchItem(w, use);
}

// VAR: 직전 턴 계획 시작 상태로 되감는다.
// 당한 쪽이 그동안 한 건 하나도 안 없어진다: 지난 턴·이번 턴에 쓴 아이템은 쓴 채로 효과까지 다시 걸리고,
// 지난 턴 수 그대로 다시 나간다. 쓴 사람은 아무것도 안 한 상태로 돌아간다: 그동안 쓴 아이템은
// 안 쓴 걸로 손에 돌아오고(같은 게 이미 있거나 손이 꽉 차면 못 돌려받음), 수는 새로 정한다.
function doVar(by) {
  const g = game;
  const p = g.prev;
  if (!p) return;
  const victim = other(by);
  // 필드의 아이템 상자와 먹은 아이템은 되감지 않는다 (먹은 상자가 다시 생기지 않게)
  const items = g.world.items;
  const spawnedTurn = g.world.spawnedTurn;
  const w = cloneWorld(p.start);
  w.items = items;
  w.spawnedTurn = spawnedTurn;
  for (const u of p.items) if (u.team === victim) replayItem(w, u);
  // 다음 턴에 또 VAR이 나오면 여기가 "이번 턴 시작"이 된다
  g.planStart = cloneWorld(w);
  const theirsNow = g.turnItems.filter((u) => u.team === victim);
  for (const u of theirsNow) replayItem(w, u);
  for (const u of [...p.items, ...g.turnItems]) {
    if (u.team === by && g.held[by].length < MAX_HELD && !g.held[by].includes(u.type)) g.held[by].push(u.type);
  }
  g.turnItems = theirsNow;
  g.world = w;
  // 골대가 그때 상태로 돌아가도 바꾸기 연출은 없이 바로. 다음 턴 "원래 골대로" 연출도 되감은 상태 기준.
  g.prevSwap = g.world.fx.swap;
  stage.snapGoalFlags(g.world);
  g.score = { ...p.score };
  g.turns = p.turns;
  g.golden = p.golden;
  g.lock = { team: victim, moves: p.moves[victim] || {} };
  stage.setTeams(g.kits, everyone(g.world), g.lookOf, g.me);
  renderScore();
  renderTurn();
}

function canUseItems() {
  const g = game;
  return !!g && g.phase === "plan" && !g.readyPressed && !(g.lock && g.lock.team === g.me);
}

// 아이템 칸 누르기: 설명 한 줄 + 바로 사용. 대상이 필요한 아이템은 커서가 바뀌고 찍으면 적용.
function useItem(index) {
  const g = game;
  const type = g && g.held[g.me][index];
  if (!type) return;
  sfx.click();
  showTip(type);
  if (g.targeting && g.targeting.index === index) {
    setTargeting(null);
    return;
  }
  if (!canUseItems() || (type === "var" && (!g.prev || g.varUsed))) {
    setTargeting(null);
    return;
  }
  if (ITEMS[type].target) {
    setTargeting({ type, index });
    return;
  }
  setTargeting(null);
  activateItem(type, null);
}

function activateItem(type, target) {
  const g = game;
  if (g.mode === "cpu") {
    removeHeld(g.me, type);
    applyItem(type, g.me, target);
    return;
  }
  if (type === "var") {
    // VAR은 그 턴에 먼저 기록한 한 명만 인정
    g.channel.claimInstant(g.seq, { type });
  } else {
    // 나머지는 몇 개든 기록하고 바로 적용. 키는 시간순이라 상대도 같은 순서로 적용한다.
    const id = `${Date.now().toString(36)}${g.role[0]}${itemCounter++}`;
    g.seenItems.add(id);
    g.channel.useItem(g.seq, id, { type, target, ep: g.epoch });
    removeHeld(g.me, type);
    applyItem(type, g.me, target);
  }
}

let itemCounter = 0;

function setTargeting(t) {
  if (!game) return;
  game.targeting = t;
  canvas.style.cursor = t ? `url("${cursorFor(t.type)}") 20 20, crosshair` : "";
  renderItems();
}

// 대상 찍을 때 커서: 아이템 아이콘이 손끝에 붙어 다닌다
const cursorCache = {};
function cursorFor(type) {
  if (!cursorCache[type]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" stroke-linecap="round" stroke-linejoin="round"><circle cx="20" cy="20" r="17" fill="rgba(255,224,102,0.9)" stroke="white" stroke-width="3"/><g transform="translate(7 7) scale(.5417)">${iconInner(type)}</g></svg>`;
    cursorCache[type] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  return cursorCache[type];
}

let tipTimer = 0;
// keep = 마우스를 올려둔 동안은 계속 보이게
function showTip(type, keep = false) {
  const tip = $("itemTip");
  const [name, ...rest] = itemDesc(type, game && game.world, game && game.me).split(": ");
  tip.replaceChildren();
  const b = document.createElement("b");
  // 글자 아이콘(VAR)은 그 자체가 이름이라 이름을 또 쓰지 않는다
  b.append(iconEl(type), ITEMS[type].iconIsName ? "" : ` ${name}`);
  tip.append(b, rest.join(": "));
  tip.hidden = false;
  clearTimeout(tipTimer);
  if (!keep) tipTimer = setTimeout(hideTip, 2600);
}

function hideTip() {
  clearTimeout(tipTimer);
  $("itemTip").hidden = true;
}

function renderItems() {
  if (!game) return;
  const g = game;
  const usable = canUseItems();
  const slots = [];
  for (let i = 0; i < MAX_HELD; i++) {
    const t = g.held[g.me][i];
    if (!t) {
      slots.push(`<span class="item-empty"></span>`);
      continue;
    }
    const armed = g.targeting && g.targeting.index === i;
    const off = !usable || (t === "var" && (!g.prev || g.varUsed));
    slots.push(`<button type="button" class="item ${armed ? "armed" : ""}" data-i="${i}" ${off ? "aria-disabled=\"true\" data-off=\"1\"" : ""} aria-label="${itemDesc(t, g.world, g.me)}">${iconSvg(t)}</button>`);
  }
  $("items").innerHTML = slots.join("");
  $("oppItems").innerHTML = g.held[g.them].map(() => `<span class="item-dot">${iconSvg("box")}</span>`).join("");
}

$("items").addEventListener("click", (e) => {
  const btn = e.target.closest(".item");
  if (btn && !ignoreItemClick) useItem(Number(btn.dataset.i));
});
// 마우스: 올리면 설명, 내리면 닫힘 (누르면 바로 사용)
$("items").addEventListener("pointerover", (e) => {
  const btn = e.target.closest(".item");
  if (!btn || e.pointerType !== "mouse" || !game) return;
  const type = game.held[game.me][Number(btn.dataset.i)];
  if (type) showTip(type, true);
});
$("items").addEventListener("pointerout", (e) => {
  const btn = e.target.closest(".item");
  if (btn && e.pointerType === "mouse" && !btn.contains(e.relatedTarget)) hideTip();
});

// ---------- 출발 ----------
function launch(moves) {
  const g = game;
  endDrag(false);
  // VAR용: 아이템 쓰기 전 이번 턴 시작 상태, 쓴 아이템 순서, 양 팀 수를 남긴다
  g.prev = {
    start: g.planStart, items: [...g.turnItems], score: { ...g.score }, turns: g.turns, golden: g.golden, moves,
  };
  const all = { ...moves.home, ...moves.away };
  applyMoves(g.world, all);
  const n = Object.keys(all).length;
  if (n) sfx.launch(n);
  for (const b of g.world.bodies) {
    if (all[b.id]) {
      fx.dust(b.x, b.y, 5, 0.8);
      stage.bobbleImpact(b.id, -0.25);
    }
  }
  stage.hideArrows();
  setReady(false);
  setTargeting(null);
  hideTip();
  if (g.mode === "online" && g.role === "host") precomputeResult();
  g.phase = "exec";
  g.execT = 0;
  g.settleT = 0;
  g.acc = 0;
  renderItems();
}

function cpuLaunch() {
  const g = game;
  const locked = g.lock && g.lock.team === g.them;
  launch({ [g.me]: g.moves, [g.them]: locked ? g.lock.moves : g.planner.result() });
}

// ---------- 온라인 턴 동기화 ----------
function applyRemoteItems(d) {
  const g = game;
  const list = [];
  for (const role of ["host", "guest"]) {
    for (const [id, it] of Object.entries(d[`${role}Items`] || {})) list.push({ id, it, team: role === "host" ? "home" : "away" });
  }
  list.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const { id, it, team } of list) {
    if (g.seenItems.has(id) || g.phase !== "plan") continue;
    // 아직 못 본 VAR 뒤에 쓴 것은 VAR을 적용한 다음에
    if ((it.ep || 0) > g.epoch) continue;
    g.seenItems.add(id);
    // VAR 전에 쓴 것: VAR을 쓴 쪽 것은 안 쓴 걸로 손에 돌아갔고(그대로 둔다),
    // 당한 쪽 것은 쓴 그대로 되감은 판에 적용한다
    if (g.varUsed && (it.ep || 0) < g.varEpoch && team === g.varBy) continue;
    removeHeld(team, it.type);
    applyItem(it.type, team, it.target);
  }
}

function submitMine() {
  const g = game;
  if (g.submittedAt) return;
  g.submittedAt = performance.now();
  g.channel.submit(g.seq, { epoch: g.epoch, moves: g.moves });
}

function onTurnData(d) {
  const g = game;
  if (!g || g.mode !== "online") return;
  g.turnData = d;
  if (g.phase === "plan") {
    // 상대가 쓴 아이템 (내 건 쓸 때 이미 적용했다). VAR 전에 쓴 것 → VAR → VAR 뒤에 쓴 것 순서.
    applyRemoteItems(d);
    if (d.instant && !g.instantApplied) {
      g.instantApplied = true;
      const by = d.instant.by === "host" ? "home" : "away";
      removeHeld(by, d.instant.type);
      applyItem(d.instant.type, by, null);
      applyRemoteItems(d);
    }
  }
  const h = d.host;
  const gu = d.guest;
  if (g.phase === "plan" && h && gu && h.epoch === g.epoch && gu.epoch === g.epoch) {
    launch({ home: h.moves || {}, away: gu.moves || {} });
  }
  if (g.phase === "sync" && d.result) applyResult(d.result);
}

// 방장이 만든 다음 상태를 그대로 받는다
function applyResult(r) {
  const g = game;
  g.world = { ...r.world, picked: [] };
  g.score = r.score;
  g.turns = r.turns;
  g.golden = r.golden;
  g.held = { home: r.held.home || [], away: r.held.away || [] };
  g.ended = r.ended;
  g.lastGoal = r.lastGoal;
  stage.setTeams(g.kits, everyone(g.world), g.lookOf, g.me);
  renderScore();
  proceed(r.kickoff, r.goldenNow);
}

function opponentLeft() {
  game.forfeit = true;
  game.score[game.me] = Math.max(game.score[game.me], game.score[game.them] + 1);
  renderScore();
  endMatch();
}

// ---------- 턴 마무리 ----------
function finishTurn() {
  const g = game;
  fx.resetTime();
  stage.setFocus(null);
  for (const b of g.world.bodies) {
    b.vx = 0;
    b.vy = 0;
  }
  if (g.mode === "online") {
    g.phase = "sync";
    g.syncSince = performance.now();
    if (g.turnData.result) applyResult(g.turnData.result);
    return;
  }
  const { kickoffNow, goldenNow } = advanceState(g, g.teams);
  proceed(kickoffNow, goldenNow);
}

// 역전 도우미(items.js pickupType)에 넘길 형편. 이번 턴 출발 때 점수 기준이라
// 온라인 방장의 미리 계산과 양쪽 화면이 같은 값을 쓴다.
function edgeOf(team) {
  const p = game.prev || game;
  return { behind: p.score[other(team)] - p.score[team], late: p.golden || p.turns >= MAX_TURNS - 4 };
}

// 턴 결과로 다음 상태 만들기. s = { world, score, turns, golden, held, ... }
// CPU전은 경기 상태 자체를, 온라인 방장은 미리 돌려본 복사본을 넣는다.
function advanceState(s, teams) {
  s.turns++;
  const goal = s.world.goal;
  s.lastGoal = goal;
  tickEffects(s.world);
  const { home, away } = s.score;
  s.ended = s.turns >= MAX_TURNS && home !== away;
  let goldenNow = false;
  if (!s.ended && s.turns >= MAX_TURNS && home === away && !s.golden) {
    s.golden = true;
    goldenNow = true;
  }
  let kickoffNow = false;
  if (goal && !s.ended) {
    const spawnedTurn = s.world.spawnedTurn;
    s.world = createWorld(kickoffBodies(teams), s.world.items);
    s.world.spawnedTurn = spawnedTurn;
    kickoffNow = true;
  }
  // 짝수 턴마다 상자 하나, 골든골에서는 턴마다 2개. VAR로 같은 턴을 다시 해도 한 번만.
  if (!s.ended && (s.golden || s.turns % 2 === 0) && s.turns > (s.world.spawnedTurn || 0)) {
    if (s.golden) {
      spawnItem(s.world, Math.random, 4);
      spawnItem(s.world, Math.random, 4);
    } else {
      spawnItem(s.world);
    }
    s.world.spawnedTurn = s.turns;
  }
  return { kickoffNow, goldenNow };
}

// 온라인 방장: 출발하자마자 이번 턴 끝까지 미리 계산해서 결과를 올린다.
// 방장 화면이 백그라운드여도 경기가 멈추지 않게 하기 위해서다.
function precomputeResult() {
  const g = game;
  const w = cloneWorld(g.world);
  const limit = Math.round(EXEC_LIMIT / DT);
  for (let i = 0; i < limit && !w.goal && !isSettled(w); i++) step(w, null);
  const s = {
    world: w, score: { ...g.score }, turns: g.turns, golden: g.golden,
    held: { home: [...g.held.home], away: [...g.held.away] },
  };
  if (w.goal) s.score[w.goal]++;
  for (const p of w.picked) {
    const got = pickupType(s.held[p.team], p.type, p.id, edgeOf(p.team));
    if (got) s.held[p.team].push(got);
  }
  for (const b of w.bodies) {
    b.vx = 0;
    b.vy = 0;
  }
  const { kickoffNow, goldenNow } = advanceState(s, g.teams);
  g.channel.writeResult(g.seq, {
    world: cloneWorld(s.world), score: s.score, turns: s.turns, golden: s.golden, held: s.held,
    ended: s.ended, lastGoal: s.lastGoal, kickoff: kickoffNow, goldenNow,
  });
}

function proceed(kickoffNow, goldenNow) {
  const g = game;
  g.seq++;
  if (g.ended) {
    endMatch();
    return;
  }
  if (kickoffNow) {
    stage.setTeams(g.kits, everyone(g.world), g.lookOf, g.me);
    enterIntro();
    return;
  }
  if (goldenNow) {
    banner("골든골!", true);
    sfx.whistle(2);
  }
  startPlan();
}

function onGoal(ev) {
  const g = game;
  const team = g.world.goal;
  g.score[team]++;
  g.phase = "goal";
  g.phaseT = 3.4;
  const el = scoreEl(team);
  el.textContent = String(g.score[team]);
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  const kit = g.kits[team];
  const gx = Math.sign(ev.x) * FIELD.halfL;
  fx.hitstop(140);
  fx.addTrauma(0.75);
  fx.setSlow(0.4);
  fx.confettiBurst(gx, ev.y, [kit.body, kit.trim, kit.stripes || kit.band || kit.body, "#ffffff", "#ffe066"]);
  stage.setFocus({ x: gx, y: ev.y, zoom: 0.62, pull: 0.55, snap: true });
  const f = $("flash");
  f.classList.remove("go");
  void f.offsetWidth;
  f.classList.add("go");
  if (ev.ownGoal) {
    banner("자책골...");
    sfx.ownGoal();
  } else {
    // 넣은 선수 얼굴을 같이 띄운다
    const scorer = ev.scorer && g.world.bodies.find((b) => b.id === ev.scorer);
    const look = scorer && g.lookOf(scorer);
    banner("GOAL!", false, look ? portraitUrl(g.kits[team], look, team) : null);
    sfx.goal();
  }
  if (canVibrate()) navigator.vibrate(team === g.me ? [60, 40, 120] : 80);
  // CPU도 가끔 반응한다
  if (g.mode === "cpu") {
    const e = team === g.them ? (Math.random() < 0.6 ? TAUNTS[Math.floor(Math.random() * TAUNTS.length)] : "😂") : Math.random() < 0.45 ? "😱" : null;
    if (e) setTimeout(() => game === g && showBubble(g.them, e), 900);
  }
}

function endMatch() {
  const g = game;
  g.phase = "end";
  setReady(false);
  fx.resetTime();
  stage.setFocus(null);
  sfx.whistle(3);
  const mine = g.score[g.me];
  const theirs = g.score[g.them];
  const win = mine > theirs;
  $("resultEmoji").textContent = win ? "🏆" : "😵";
  $("resultTitle").textContent = win ? "승리!" : "패배...";
  $("resultScore").textContent = `${mine} : ${theirs}`;
  $("resHomeLogo").src = logoUrl(clubById(g.clubs[g.me]));
  $("resAwayLogo").src = logoUrl(clubById(g.clubs[g.them]));
  const streak = updateStreak(g.mode, win);
  $("resultSub").textContent = [g.forfeit ? "🏳️" : "", streak >= 2 ? `🔥 ${streak}연승` : ""].filter(Boolean).join("  ");
  window.FSPoints?.earn("bobble", (win ? (g.mode === "online" ? 50 : 40) : 10) + 5 * mine,
    `${g.mode === "online" ? "온라인 " : ""}${win ? "승리" : "패배"} ${mine}:${theirs}`);
  if (g.channel) g.channel.close();
  if (g.mode === "cpu") logCpuResult(g);
  setTimeout(() => {
    if (game === g && g.phase === "end") {
      $("result").hidden = false;
      if (win) fx.confettiBurst(0, 0, [g.kits[g.me].body, g.kits[g.me].trim, "#ffe066", "#ffffff"]);
    }
  }, 1100);
}

// 진동은 사용자가 한 번이라도 화면을 누른 뒤에만 (안 그러면 브라우저가 막고 경고를 남긴다)
function canVibrate() {
  return !!navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive);
}

// 모드별 연승 (기기에 저장)
function updateStreak(mode, win) {
  const key = `bobbleStreak_${mode}`;
  let n = 0;
  try {
    n = Number(localStorage.getItem(key)) || 0;
    n = win ? n + 1 : 0;
    localStorage.setItem(key, String(n));
  } catch (_) {
    n = win ? 1 : 0;
  }
  return n;
}

// ---------- 이모지 ----------
$("emoteBtn").addEventListener("click", () => {
  sfx.click();
  $("emotePanel").hidden = !$("emotePanel").hidden;
});
$("emotePanel").innerHTML = EMOTES.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("");
$("emotePanel").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || !game) return;
  const g = game;
  $("emotePanel").hidden = true;
  showBubble(g.me, btn.dataset.e);
  sfx.pop();
  if (g.channel) g.channel.sendEmote(btn.dataset.e);
  else if (Math.random() < 0.35) setTimeout(() => game === g && showBubble(g.them, EMOTES[Math.floor(Math.random() * EMOTES.length)]), 1200);
});

// ---------- 물리 이벤트 -> 소리/연출 ----------
function teamColor(id) {
  const b = game.world.bodies.find((x) => x.id === id);
  return b && b.team ? game.kits[b.team].body : "#ffffff";
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === "kick") {
      const i = Math.min(1, e.impulse / 7);
      sfx.kick(i);
      stage.kickBall(i);
      stage.bobbleImpact(e.a, 0.3 * i);
      fx.ring(e.x, e.y, "#ffffff", 2 + 3 * i);
      fx.sparks(e.x, e.y, ["#ffffff", "#ffe08a"], 3 + Math.round(8 * i));
      fx.addTrauma(0.1 + 0.28 * i);
      if (i > 0.3) fx.hitstop(35 + 55 * i);
      if (i > 0.7) sfx.crowd(0.12, 0.8);
    } else if (e.type === "blaze") {
      // 파워슛: 불꽃 폭발
      sfx.kick(1);
      sfx.crowd(0.3, 1.2);
      stage.kickBall(1);
      fx.ring(e.x, e.y, "#ff7a1a", 6, 0.5);
      fx.flames(e.x, e.y, 22, 2.2);
      fx.addTrauma(0.55);
      fx.hitstop(120);
    } else if (e.type === "burn") {
      // 불붙은 공에 휩쓸린 선수
      sfx.bump(1);
      stage.bobbleImpact(e.a, 0.9);
      fx.ring(e.x, e.y, "#ff3b1a", 4, 0.4);
      fx.flames(e.x, e.y, 14, 1.6);
      fx.addTrauma(0.4);
      fx.hitstop(70);
    } else if (e.type === "splat") {
      // 파워슛에 끌려간 선수가 벽·그물에 납작하게 깔림
      sfx.bump(1);
      sfx.crowd(0.3, 1.1);
      fx.ring(e.x, e.y, "#ff7a1a", 6, 0.5);
      fx.sparks(e.x, e.y, ["#ffe066", "#ff7a1a", "#ffffff"], 16, 10, 1.5);
      fx.dust(e.x, e.y, 12, 1.6);
      // 깔린 채로 또 맞은 건 연출을 가볍게 (벽 사이로 계속 튕길 때 너무 자주 멈추지 않게)
      fx.addTrauma(e.again ? 0.45 : 0.85);
      fx.hitstop(e.again ? 60 : 170);
      stage.bobbleImpact(e.a, 1.2);
    } else if (e.type === "pop") {
      // 다시 부풀면서 공을 튕겨 냄
      sfx.kick(0.6);
      stage.kickBall(0.6);
      fx.ring(e.x, e.y, "#ffffff", 2.5, 0.3);
    } else if (e.type === "bump") {
      const i = Math.min(1, e.impulse / 10);
      sfx.bump(i);
      stage.bobbleImpact(e.a, 0.45 * i);
      stage.bobbleImpact(e.b, 0.45 * i);
      fx.ring(e.x, e.y, "#ffe08a", 1.5 + 2 * i, 0.3);
      fx.sparks(e.x, e.y, [teamColor(e.a), teamColor(e.b), "#ffffff"], 3 + Math.round(6 * i), 7, 1.2);
      fx.addTrauma(0.06 + 0.2 * i);
      if (i > 0.35) fx.hitstop(25 + 45 * i);
    } else if (e.type === "wall") {
      const i = Math.min(1, e.speed / (e.kind === "ball" ? 22 : 15));
      sfx.wall(i);
      if (i > 0.2) fx.dust(e.x, e.y, 3, 0.6);
      fx.addTrauma(0.05 * i);
    } else if (e.type === "post") {
      const i = Math.min(1, e.speed / 18);
      sfx.post(i);
      stage.postHit(e.x, e.y, i);
      fx.sparks(e.x, e.y, ["#fff6c2", "#ffffff"], 4 + Math.round(6 * i), 8, 1.4);
      fx.addTrauma(0.12 + 0.3 * i);
      if (i > 0.3) fx.hitstop(50 + 40 * i);
      if (e.kind === "ball") sfx.crowd(0.35, 1.3);
    } else if (e.type === "net") {
      if (e.kind !== "ball") continue;
      const i = Math.min(1, e.speed / 18);
      sfx.net(i);
      stage.netHit(Math.sign(e.x), e.y, BALL_R, 0.25 + 0.6 * i);
    } else if (e.type === "bumper") {
      const i = Math.min(1, e.speed / 20);
      sfx.bumper(i);
      stage.bumperHit(e.x, e.y);
      fx.ring(e.x, e.y, "#ff6b6b", 3, 0.3);
      fx.sparks(e.x, e.y, ["#ffe066", "#ff6b6b", "#ffffff"], 6, 7, 0.9);
      fx.addTrauma(0.12);
      if (e.kind === "ball") fx.hitstop(40);
    } else if (e.type === "pickup") {
      // 이미 가진 아이템이면 안 가진 것으로 바뀌고, 지고 있으면 역전용이 나올 수 있다
      const got = pickupType(game.held[e.team], e.item, e.id, edgeOf(e.team));
      if (got) game.held[e.team].push(got);
      const shown = got || e.item;
      fx.sparks(e.x, e.y, ["#ffe066", "#ffffff"], 10, 6, 1.4);
      fx.ring(e.x, e.y, "#ffe066", 3);
      sfx.pop();
      showBubble(e.team, iconEl(e.team === game.me ? shown : "box"));
      if (e.team === game.me) showTip(shown);
      renderItems();
    } else if (e.type === "goal" && game.phase === "exec") {
      onGoal(e);
    }
  }
}

// 공이 골문 쪽으로 빠르게 가면 슬로우모션 + 관중 웅성
function updateDrama() {
  const ball = getBall(game.world);
  const sp = Math.hypot(ball.vx, ball.vy);
  let slow = 1;
  for (const s of [1, -1]) {
    const toLine = s * FIELD.halfL - ball.x;
    const heading = ball.vx * s;
    if (Math.abs(toLine) < 5 && toLine * s > -0.2 && heading > 5 && Math.abs(ball.y) < FIELD.goalHalfW + 1.5) {
      const tHit = toLine / ball.vx;
      const yAt = ball.y + ball.vy * tHit;
      if (Math.abs(yAt) < FIELD.goalHalfW + 0.6) slow = 0.35;
    }
  }
  fx.setSlow(slow);
  if (slow < 1 && !game.dramaOn) {
    game.dramaOn = true;
    sfx.crowd(0.25, 1.4);
  } else if (slow === 1) {
    game.dramaOn = false;
  }
  if (ball.fire) fx.flames(ball.x, ball.y, 2, 0.8);
  else if (sp > 8) fx.trail(ball.x, ball.y, sp > 16 ? "#ffe08a" : "#ffffff");
  stage.setFocus({ x: ball.x, y: ball.y, zoom: slow < 1 ? 0.8 : 0.92, pull: slow < 1 ? 0.45 : 0.2 });
}

function runPhysics(dt) {
  const g = game;
  g.acc += dt * fx.timeScale();
  const events = [];
  while (g.acc >= DT) {
    step(g.world, events);
    g.acc -= DT;
    if (events.length) {
      handleEvents(events);
      events.length = 0;
      // 히트스톱이 걸리면 그 자리에서 바로 멈춘다
      if (fx.timeScale() === 0) {
        g.acc = 0;
        break;
      }
    }
  }
}

function updateGame(dt) {
  const g = game;
  if (g.phase === "intro") {
    if (performance.now() > g.introUntil) startPlan();
  } else if (g.phase === "plan") {
    if (g.mode === "cpu") {
      // CPU전은 시간 제한 없음. CPU가 아직 고민 중이면 계산 몫을 늘려서 끝나는 대로 출발.
      if (g.planner) g.planner.work(g.readyPressed ? 14 : 5);
      if (g.readyPressed && (!g.planner || g.planner.done)) cpuLaunch();
    } else {
      const left = Math.max(0, (g.planDeadline - performance.now()) / 1000);
      const fill = $("timerFill");
      fill.style.transform = `scaleX(${left / ONLINE_TURN})`;
      fill.classList.toggle("low", left < 4);
      const sec = Math.ceil(left);
      if (sec !== g.lastSec && sec <= 3 && sec > 0 && !g.readyPressed) sfx.click();
      g.lastSec = sec;
    }
  } else if (g.phase === "exec") {
    runPhysics(dt);
    if (g.phase !== "exec") return;
    g.execT += dt * fx.timeScale();
    updateDrama();
    if (isSettled(g.world)) g.settleT += dt;
    else g.settleT = 0;
    if (g.settleT > 0.35 || g.execT > EXEC_LIMIT) finishTurn();
  } else if (g.phase === "goal") {
    runPhysics(dt);
    g.phaseT -= dt;
    if (g.phaseT < 2.6) fx.setSlow(1);
    if (g.phaseT <= 0) finishTurn();
  } else if (g.phase === "end") {
    runPhysics(dt);
  }
}

// 온라인 시간 처리는 화면 갱신과 따로 돈다 (탭이 백그라운드여도 0.5초마다는 돈다)
function onlineTick() {
  const g = game;
  if (!g || g.mode !== "online" || g.phase === "end") return;
  const now = performance.now();
  if (g.phase === "intro" && now > g.introUntil) startPlan();
  // 탭이 가려져 있거나 화면이 멈춰 있으면(브라우저가 그리기를 쉬면) 연출을 건너뛰고
  // 방장 결과로 바로 넘어간다. 안 그러면 상대가 기다리다 기권승 처리된다.
  const stalled = document.hidden || now - lastFrameAt > 800;
  if (stalled && (g.phase === "exec" || g.phase === "goal") && g.turnData.result) finishTurn();
  if (g.phase === "plan" && !g.readyPressed && now > g.planDeadline) {
    endDrag(false);
    g.readyPressed = true;
    setTargeting(null);
    $("readyBtn").disabled = true;
    $("readyBtn").textContent = "⏳";
    renderItems();
    submitMine();
  }
  // 내가 낸 뒤, 또는 결과를 기다리는 동안 너무 오래 조용하면 상대가 나간 것으로 본다
  if (g.phase === "plan" && g.submittedAt && now - g.submittedAt > AFK_GRACE * 1000) opponentLeft();
  if (g.phase === "sync" && now - g.syncSince > AFK_GRACE * 1000) opponentLeft();
}
setInterval(onlineTick, 500);

// CPU 수 계산도 화면 갱신과 따로 조금씩 돌린다 (화면이 느리게 그려지는 기기에서도 기다림이 짧게)
setInterval(() => {
  const g = game;
  if (!g || g.mode !== "cpu") return;
  if (g.phase === "intro" && performance.now() > g.introUntil) startPlan();
  else if (g.phase === "plan" && g.readyPressed && g.planner && !g.planner.done) g.planner.work(25);
}, 60);

// ---------- 조준 입력 ----------
function bodyById(id) {
  return game.world.bodies.find((b) => b.id === id);
}

function pickBobble(p, team = game.me) {
  let best = null;
  let bd = Infinity;
  for (const b of game.world.bodies) {
    if (b.kind !== "bobble" || b.team !== team) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < b.r + BOBBLE_R * 0.6 && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

// 당기는 세기는 화면 픽셀 거리로 잰다. 터치는 화면 밖으로 손가락을 뺄 수 없으니
// 짧게(짧은 변의 약 13%) 당겨도 끝까지 장전되게 해서, 벽에 붙은 선수도 최대로 쏠 수 있다.
// 마우스는 창 밖으로 나가도 계속 따라오므로 조금 더 길게(약 24%) 잡아 세밀하게 조절한다.
function pullForFullPower(pointerType) {
  const side = Math.min(innerWidth, innerHeight);
  return pointerType === "mouse" ? Math.max(80, Math.min(170, side * 0.24)) : Math.max(46, Math.min(110, side * 0.135));
}

function updateDrag(p, clientX, clientY) {
  const b = bodyById(drag.id);
  const ax = b.x - p.x;
  const ay = b.y - p.y;
  const len = Math.hypot(ax, ay);
  const [sx, sy] = stage.toScreen(b.x, b.y);
  const px = Math.hypot(clientX - sx, clientY - sy);
  const v = stage.bobbles.get(b.id);
  if (px < 12 || len < 0.05) {
    drag.move = null;
    stage.setArrow(b.id, b, null);
    v.aimSquash = 0;
    sfx.aimUpdate(0);
  } else {
    const power = Math.min(1, (px - 6) / pullForFullPower(drag.pointerType));
    drag.move = { dx: ax / len, dy: ay / len, power };
    stage.setArrow(b.id, b, drag.move);
    v.aimSquash = power;
    v.aimDir = { x: -ax / len, y: -ay / len };
    game.faceOf[b.id] = Math.atan2(ay, ax);
    sfx.aimUpdate(power);
    if (power >= 1 && !drag.maxed) {
      drag.maxed = true;
      if (canVibrate()) navigator.vibrate(15);
    } else if (power < 1) {
      drag.maxed = false;
    }
  }
  stage.setPull(b, p.x, p.y);
}

function endDrag(commit = true) {
  if (!drag) return;
  const b = bodyById(drag.id);
  const v = stage.bobbles.get(drag.id);
  if (v) {
    v.squashV -= v.aimSquash * 4;
    v.aimSquash = 0;
  }
  if (commit && drag.move) {
    game.moves[drag.id] = drag.move;
    sfx.pop();
    markHintDone();
  } else if (commit && !drag.moved && game.moves[drag.id]) {
    delete game.moves[drag.id];
    delete game.faceOf[drag.id];
    sfx.cancel();
  } else if (commit && drag.moved && !drag.move) {
    delete game.moves[drag.id];
    delete game.faceOf[drag.id];
  } else if (!commit && drag.move) {
    game.moves[drag.id] = drag.move;
  }
  if (b) stage.setArrow(drag.id, b, game.moves[drag.id]);
  stage.setPull(null);
  sfx.aimEnd();
  drag = null;
}

// 파워슛은 내 선수를, 레드카드는 상대 선수를 찍는다. 찍는 순간 바로 적용.
// 화면에 그릴 선수 전체 (레드카드로 잠깐 빠진 선수 포함)
function everyone(w) {
  return [...w.bodies, ...(w.bench || [])];
}

function pickTarget(p) {
  const g = game;
  const { type } = g.targeting;
  // 레드카드는 상대 선수를, 나머지는 내 선수를 찍는다
  const b = pickBobble(p, ITEMS[type].target === "opp" ? g.them : g.me);
  if (!b) return;
  // 이미 불붙은 선수에겐 못 쓴다
  if (type === "power" && !canPower(g.world, g.me, b.id)) return;
  if (type === "red" && !canRed(g.world, g.me, b.id)) return;
  setTargeting(null);
  activateItem(type, b.id);
}

function insideField(p) {
  return Math.abs(p.x) < FIELD.halfL && Math.abs(p.y) < FIELD.halfW;
}

// 아이템 끌어서 놓기: 대상이 필요한 아이템(파워슛·레드카드)은 칸에서 끌어다 선수 위에 놓으면 바로 적용.
// 끌지 않고 누르기만 하면 기존처럼 커서가 바뀌고 경기장을 찍어서 쓴다.
let itemDrag = null;
let ignoreItemClick = false;
$("items").addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".item");
  if (!btn || !game) return;
  const index = Number(btn.dataset.i);
  const type = game.held[game.me][index];
  if (!type || !ITEMS[type].target || !canUseItems()) return;
  itemDrag = { type, index, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
});
window.addEventListener("pointermove", (e) => {
  if (!itemDrag || e.pointerId !== itemDrag.pointerId) return;
  if (!itemDrag.moved && Math.hypot(e.clientX - itemDrag.sx, e.clientY - itemDrag.sy) > 8) {
    itemDrag.moved = true;
    setTargeting({ type: itemDrag.type, index: itemDrag.index });
    showTip(itemDrag.type, true);
    const ghost = $("itemGhost");
    ghost.innerHTML = iconSvg(itemDrag.type);
    ghost.hidden = false;
  }
  if (!itemDrag.moved) return;
  const ghost = $("itemGhost");
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
});
for (const type of ["pointerup", "pointercancel"]) {
  window.addEventListener(type, (e) => {
    if (!itemDrag || e.pointerId !== itemDrag.pointerId) return;
    const d = itemDrag;
    itemDrag = null;
    $("itemGhost").hidden = true;
    if (!d.moved) return;
    ignoreItemClick = true;
    setTimeout(() => {
      ignoreItemClick = false;
    }, 0);
    hideTip();
    const p = type === "pointerup" && document.elementFromPoint(e.clientX, e.clientY) === canvas ? stage.pick(e.clientX, e.clientY) : null;
    if (p && insideField(p) && game && game.targeting) pickTarget(p);
    else setTargeting(null);
  });
}

canvas.addEventListener("pointerdown", (e) => {
  unlockAudio();
  $("emotePanel").hidden = true;
  $("sound").classList.remove("open");
  if (!game || game.phase !== "plan" || drag || game.readyPressed) return;
  const p = stage.pick(e.clientX, e.clientY);
  if (!p) return;
  if (game.targeting) {
    pickTarget(p);
    return;
  }
  const b = pickBobble(p);
  if (!b) return;
  drag = { id: b.id, pointerId: e.pointerId, pointerType: e.pointerType, move: null, moved: false, sx: e.clientX, sy: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  sfx.aimStart();
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
  if (!drag.moved) return;
  const p = stage.pick(e.clientX, e.clientY);
  if (p) updateDrag(p, e.clientX, e.clientY);
});

for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(type === "pointerup");
  });
}

window.addEventListener("resize", () => stage.resize());

// ---------- 메인 루프 ----------
function ringStates() {
  if (!game || game.phase !== "plan") return null;
  const r = {};
  const locked = game.lock && game.lock.team === game.me;
  const red = game.targeting && game.targeting.type === "red";
  for (const b of game.world.bodies) {
    if (b.kind !== "bobble") continue;
    if (b.team !== game.me) {
      if (red) r[b.id] = "foe";
      continue;
    }
    if (red) continue;
    if (game.targeting && game.targeting.type === "power" && !b.power) r[b.id] = "active";
    else if (!locked && !game.readyPressed) r[b.id] = drag && drag.id === b.id ? "active" : game.moves[b.id] ? "set" : "idle";
  }
  return r;
}

// 처음 하는 사람에게만: 공 앞 선수 위에서 손가락이 뒤로 당기는 시늉을 반복
const HINT_KEY = "bobbleDragHintDone";
let hintDone = false;
try {
  hintDone = localStorage.getItem(HINT_KEY) === "1";
} catch (_) {
  hintDone = false;
}

function markHintDone() {
  if (hintDone) return;
  hintDone = true;
  $("dragHint").hidden = true;
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch (_) {
    // 다음에 다시 보여도 괜찮다
  }
}

function updateDragHint() {
  const el = $("dragHint");
  const g = game;
  const show = !hintDone && g && g.phase === "plan" && !drag && !g.readyPressed && !Object.keys(g.moves).length;
  el.hidden = !show;
  if (!show) return;
  const ball = getBall(g.world);
  const mine = g.world.bodies.filter((b) => b.kind === "bobble" && b.team === g.me);
  const b = mine.sort((p, q) => Math.hypot(p.x - ball.x, p.y - ball.y) - Math.hypot(q.x - ball.x, q.y - ball.y))[0];
  const back = g.me === "home" ? -1 : 1;
  const [x0, y0] = stage.toScreen(b.x, b.y);
  const [x1, y1] = stage.toScreen(b.x + back * 4, b.y);
  el.style.left = `${x0}px`;
  el.style.top = `${y0}px`;
  el.style.setProperty("--dx", `${x1 - x0}px`);
  el.style.setProperty("--dy", `${y1 - y0}px`);
}

// 지금 걸려 있는 효과와 남은 턴: 골대2 빙판1
let effectsSig = "";
function renderEffects() {
  const fxs = game && game.world.fx;
  const chips = [];
  if (fxs && fxs.swap > 0) chips.push(["swap", fxs.swap]);
  if (fxs && fxs.ice > 0) chips.push(["ice", fxs.ice]);
  if (fxs && fxs.tilt > 0) chips.push(["tilt", fxs.tilt]);
  const benched = game ? (game.world.bench || []).length : 0;
  if (benched) chips.push(["red", benched]);
  const sig = chips.map((c) => c.join("")).join("|");
  if (sig === effectsSig) return;
  effectsSig = sig;
  $("effects").innerHTML = chips.map(([type, n]) => `<span class="fx-chip ${type}">${iconSvg(type)}<b>${n}</b></span>`).join("");
}

let last = performance.now();
let lastFrameAt = performance.now();
// 파워슛을 쓴 선수는 이번 턴 내내 몸에서 불길이 오른다. 휩쓸려 날아가는 선수도.
let burnAcc = 0;
function burnFx(dt) {
  burnAcc += dt;
  if (burnAcc < 0.05) return;
  burnAcc = 0;
  for (const b of game.world.bodies) {
    if (b.power || b.fly) fx.flames(b.x, b.y, 2, b.r * 0.9);
  }
}

function frame(now) {
  lastFrameAt = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fx.update(dt);
  if (game) updateGame(dt);
  if (game) burnFx(dt);
  const world = game ? game.world : idleWorld;
  const scaled = dt * (game ? fx.timeScale() : 1);
  stage.sync(world, scaled, { rings: ringStates(), time: now / 1000, faceOf: game ? game.faceOf : null, idleFace: !game || game.phase !== "exec" });
  stage.syncField(world, now / 1000);
  stage.updateCamera(dt, fx.shake);
  updateDragHint();
  renderEffects();
  stage.render();
  requestAnimationFrame(frame);
}

if (IS_LOCAL) {
  window.__bobble = {
    stage, fx, get game() { return game; }, get idleWorld() { return idleWorld; },
    give(team, ...types) {
      game.held[team].push(...types);
      renderItems();
    },
    // 테스트용: 진행 중인 턴을 끝까지 바로 돌리고 마무리
    skipTurn() {
      while (game.phase === "exec" && !isSettled(game.world) && !game.world.goal) step(game.world, null);
      finishTurn();
    },
    // 테스트용: 자리를 직접 잡아 놓고 이 수로 바로 출발
    launch(moves) {
      launch(moves);
    },
  };
}

refreshIdle();
requestAnimationFrame(frame);
