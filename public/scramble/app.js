// 이름 뒤죽박죽 - 화면/입력. 순수 로직은 logic.js (window.ScrambleLogic).
// 들어오면 바로 문제가 나온다: 아직 못 푼 선수 중 무작위 한 명. 풀거나 스킵하면 다음 선수, 끝없이.
// 시간 제한·힌트 없음. 푼 선수만 기록해서 다시 나오지 않게 한다.
const L = window.ScrambleLogic;
const app = document.getElementById("app");

const SOLVED_KEY = "scrambleSolvedV1";
const SOLVE_POINTS = 5;

// 출제 풀은 이 게임 전용 고정 목록(players.json). 카드팩 레어 이상에서 유명도 기준으로 골라 둔 것이라
// 카드팩 데이터가 바뀌어도 따라가지 않는다. 사진만 카드팩·CAPTCHA 이미지 경로를 그대로 쓴다.
let PLAYERS = [];  // { id, name, sub(정답 공개 때 이름 아래 한 줄), photo(public 기준 경로), cutout(전신 누끼 사진) }
let cur = null;   // 지금 문제: { player, words, tiles, slots, stack, status }

// ---------------------------------------------------------------- 공용

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function readSolved() {
  try {
    const arr = JSON.parse(localStorage.getItem(SOLVED_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function writeSolved(set) {
  try { localStorage.setItem(SOLVED_KEY, JSON.stringify([...set])); } catch {}
}
// 데이터가 갱신돼 사라진 선수 id는 세지 않는다
function solvedCount() {
  const solved = readSolved();
  return PLAYERS.filter(p => solved.has(p.id)).length;
}

async function init() {
  try {
    const res = await fetch("players.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`선수 데이터 요청 실패 (${res.status})`);
    PLAYERS = (await res.json()).players;
    nextQuestion();
  } catch (e) {
    app.innerHTML = `<div class="sc-shell"><p class="sc-loading">불러오지 못했어요: ${escapeHtml(e.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------- 문제

// 못 푼 선수 중 무작위. 스킵한 선수가 바로 다시 나오지 않게 방금 문제는 빼고 고른다(그것 하나만 남았으면 그대로).
function nextQuestion() {
  const solved = readSolved();
  const left = PLAYERS.filter(p => !solved.has(p.id));
  if (!left.length) { renderAllDone(); return; }
  const pool = left.length > 1 && cur ? left.filter(p => p.id !== cur.player.id) : left;
  const player = pool[Math.floor(Math.random() * pool.length)];
  const b = L.makeBoard(player.name);
  // 칸에는 띄어쓰기·하이픈을 표시하지 않는다 - 이름 전체를 한 단어처럼 이어서 채운다
  const answer = b.words.join("");
  cur = {
    player,
    tiles: b.tiles,
    words: [answer],
    slots: [Array(answer.length).fill(null)],          // slots[0][i] = 타일 id 또는 null
    stack: [],                                          // 놓은 순서 (Backspace용)
    status: "play",                                     // play | wrong | solved
  };
  renderGame();
}

function usedTileIds() {
  return new Set(cur.slots.flat().filter(id => id !== null));
}
function tileById(id) {
  return cur.tiles.find(t => t.id === id);
}
function playing() {
  return cur && cur.status !== "solved";
}

function placeTile(tileId) {
  if (!playing() || usedTileIds().has(tileId)) return;
  // 타일은 이름 전체에서 섞여 있으므로 앞 단어부터 차례로 빈칸을 채운다
  const w = cur.slots.findIndex(row => row.includes(null));
  if (w < 0) return;
  cur.slots[w][cur.slots[w].indexOf(null)] = tileId;
  cur.stack.push(tileId);
  cur.status = "play";
  afterChange();
}

function removeAt(w, i) {
  if (!playing() || cur.slots[w][i] === null) return;
  const id = cur.slots[w][i];
  cur.slots[w][i] = null;
  cur.stack = cur.stack.filter(x => x !== id);
  cur.status = "play";
  renderGame();
}

function backspace() {
  const id = cur?.stack.at(-1);
  if (id === undefined) return;
  for (let w = 0; w < cur.slots.length; w++) {
    const i = cur.slots[w].indexOf(id);
    if (i >= 0) { removeAt(w, i); return; }
  }
}

function clearAll() {
  if (!playing()) return;
  cur.slots = cur.slots.map(row => row.map(() => null));
  cur.stack = [];
  cur.status = "play";
  renderGame();
}

function reshuffle() {
  if (!playing()) return;
  cur.tiles = L.shuffleArr(cur.tiles);
  renderGame();
}

// 키보드: 아직 안 쓴 그 글자 타일을 다음 빈칸에 넣는다.
function typeLetter(ch) {
  if (!playing()) return;
  const used = usedTileIds();
  const t = cur.tiles.find(t => t.ch === ch && !used.has(t.id));
  if (t) placeTile(t.id);
}

function afterChange() {
  if (!cur.slots.every(row => row.every(id => id !== null))) { renderGame(); return; }
  const guess = cur.slots.map(row => row.map(id => tileById(id).ch).join("")).join("");
  if (guess !== cur.words.join("")) {
    cur.status = "wrong";
    renderGame();
    return;
  }
  cur.status = "solved";
  const solved = readSolved();
  if (!solved.has(cur.player.id)) {
    solved.add(cur.player.id);
    writeSolved(solved);
    window.FSPoints?.earn("scramble", SOLVE_POINTS, cur.player.name);
  }
  renderGame();
}

// ---------------------------------------------------------------- 화면

// 칸 줄 수와 한 줄 칸 수. 한 줄에 12칸까지(폰 기준), 넘으면 두 줄로 반씩 나눈다.
const ROW_MAX_CELLS = 12;
function slotRows(len) {
  const rows = len <= ROW_MAX_CELLS ? 1 : 2;
  return { rows, per: Math.ceil(len / rows) };
}

function topBar() {
  return `
    <header class="sc-top">
      <a class="site-back" href="../">← 축구 게임</a>
      <h1 class="sc-title">이름 뒤죽박죽</h1>
      <div class="sc-count" aria-label="해결한 문제 ${solvedCount()}개, 전체 ${PLAYERS.length}개"><b>${solvedCount()}</b><span>/${PLAYERS.length}</span></div>
    </header>`;
}

function renderGame() {
  const solved = cur.status === "solved";
  const used = usedTileIds();

  const { rows, per } = slotRows(cur.slots[0].length);
  const cells = cur.slots[0].map((id, i) =>
    `<button class="slot ${id !== null ? "filled" : ""}" data-w="0" data-i="${i}" ${solved ? "disabled" : ""}>${id === null ? "" : tileById(id).ch}</button>`);
  const slotsHtml = Array.from({ length: rows }, (_, r) =>
    `<span class="slot-row">${cells.slice(r * per, (r + 1) * per).join("")}</span>`).join("");

  const trayHtml = cur.tiles.map(t =>
    used.has(t.id)
      ? `<span class="tile ghost"></span>`
      : `<button class="tile" data-tile="${t.id}">${t.ch}</button>`
  ).join("");

  app.innerHTML = `
    <section class="sc-shell sc-play" style="--n:${Math.max(6.5, per * 1.07).toFixed(2)}">
      ${topBar()}
      <div class="stage">
        <div class="board ${cur.status}">${slotsHtml}</div>
        ${solved
          ? `<div class="reveal">
               <img class="${cur.player.cutout ? "cutout" : ""}" src="../${escapeHtml(cur.player.photo)}" alt="">
               <div><b>${escapeHtml(cur.player.name)}</b><span>${escapeHtml(cur.player.sub)}</span></div>
             </div>
             <button class="sc-primary" id="nextBtn">다음 문제 →</button>`
          : `<p class="sc-msg ${cur.status}">${cur.status === "wrong" ? "아니에요! 칸을 눌러 글자를 빼보세요" : "알파벳을 눌러 이름을 완성하세요"}</p>
             <div class="tray">${trayHtml}</div>
             <div class="tools">
               <button class="tool" id="shuffleBtn">🔀 섞기</button>
               <button class="tool" id="clearBtn" ${cur.stack.length ? "" : "disabled"}>↺ 비우기</button>
               <button class="tool skip" id="skipBtn">스킵 ⏭</button>
             </div>`}
      </div>
    </section>`;

  app.querySelectorAll("[data-tile]").forEach(t => t.onclick = () => placeTile(+t.dataset.tile));
  app.querySelectorAll(".slot").forEach(s => s.onclick = () => removeAt(+s.dataset.w, +s.dataset.i));
  document.getElementById("shuffleBtn")?.addEventListener("click", reshuffle);
  document.getElementById("clearBtn")?.addEventListener("click", clearAll);
  document.getElementById("skipBtn")?.addEventListener("click", nextQuestion);
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) { nextBtn.onclick = nextQuestion; nextBtn.focus(); }
}

function renderAllDone() {
  cur = null;
  app.innerHTML = `
    <section class="sc-shell">
      ${topBar()}
      <div class="stage all-done">
        <div class="success-icon">✓</div>
        <h2>${PLAYERS.length}명을 모두 맞혔어요!</h2>
        <p>새 선수가 추가되면 다시 도전할 수 있어요.</p>
        <button class="tool" id="resetBtn">처음부터 다시 풀기</button>
      </div>
    </section>`;
  document.getElementById("resetBtn").onclick = () => {
    if (!confirm("푼 기록을 지우고 처음부터 다시 풀까요?")) return;
    writeSolved(new Set());
    nextQuestion();
  };
}

document.addEventListener("keydown", e => {
  if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
  if (cur.status === "solved") {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nextQuestion(); }
    return;
  }
  if (e.key === "Backspace") { e.preventDefault(); backspace(); }
  else if (e.key === "Escape") clearAll();
  // e.key 대신 물리 키(e.code)를 본다 - 한글 입력 상태면 e.key가 "ㅁ"이나 "Process"로 와서 글자가 안 들어간다
  else if (/^Key[A-Z]$/.test(e.code)) typeLetter(e.code.slice(3));
});

init();
