import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  addDoc, collection, doc, getFirestore, increment, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

(function () {
  "use strict";

  const firebaseApp = initializeApp({
    projectId: "guess-your-player",
    appId: "1:1068776442781:web:433981863e0c3da178bd74",
    storageBucket: "guess-your-player.firebasestorage.app",
    apiKey: "AIzaSyA8SG_LbHeqS9gh0CLFaHUhEI1uG1uYLDY",
    authDomain: "guess-your-player.firebaseapp.com",
    messagingSenderId: "1068776442781",
  });
  const db = getFirestore(firebaseApp);
  const app = document.getElementById("app");
  const puzzles = Array.isArray(globalThis.CONNECT_PUZZLES) ? globalThis.CONNECT_PUZZLES : [];
  const puzzleHints = globalThis.CONNECT_HINTS || {};
  const { getConnections } = globalThis.ConnectLogic;
  const RECORD_KEY = "connectPuzzleRecordsV3";
  let game = null;
  let toastId = null;
  let pointerDrag = null;
  let cachedClientIp = null;

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

  async function logConnectPlay() {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    try {
      const ip = await getClientIp();
      await Promise.all([
        addDoc(collection(db, "playLogs"), { ts: serverTimestamp(), ip, game: "connect" }),
        setDoc(doc(db, "statsCounters", "totals"), { connect: increment(1) }, { merge: true }),
        setDoc(doc(db, "statsDaily", todayKeyKST()), { connect: increment(1) }, { merge: true }),
      ]);
    } catch (error) {
      console.error("logConnectPlay failed", error);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function readRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECORD_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function isCompleted(record) {
    return record === true || record?.completed === true || Number.isFinite(record?.bestMs);
  }

  function writeCompletion(puzzleId) {
    const records = readRecords();
    records[puzzleId] = { completed: true, completedAt: Date.now() };
    localStorage.setItem(RECORD_KEY, JSON.stringify(records));
  }

  function renderList() {
    cleanupPointerDrag();
    game = null;
    const records = readRecords();
    app.innerHTML = `
      <section class="list-shell">
        <a class="site-back" href="../">← 축구 게임</a>
        <header class="list-hero">
          <p class="eyebrow">FOOTBALL PUZZLE</p>
          <h1>커넥트</h1>
          <p class="intro">16명의 선수를 네 개의 그룹으로 나누세요</p>
          <p class="category-guide"><strong>공통점</strong><span>소속팀 · 출생 연도 · 포지션 · 국적 · 등번호</span></p>
        </header>
        <h2 class="puzzle-list-title">문제 목록</h2>
        <div class="puzzle-grid" aria-label="문제 목록">
          ${puzzles.map((puzzle) => {
            const completed = isCompleted(records[puzzle.id]);
            return `
              <button class="puzzle-button ${completed ? "completed" : ""}" data-puzzle-id="${puzzle.id}" aria-label="문제 ${puzzle.id}${completed ? ", 완료" : ""}">
                <span class="puzzle-number">${puzzle.id}</span>
              </button>`;
          }).join("")}
        </div>
      </section>`;

    app.querySelectorAll("[data-puzzle-id]").forEach((button) => {
      button.addEventListener("click", () => startPuzzle(Number(button.dataset.puzzleId)));
    });
    history.replaceState({ screen: "list" }, "", location.pathname);
  }

  function startPuzzle(puzzleId) {
    const puzzle = puzzles.find((item) => item.id === puzzleId);
    if (!puzzle) return;
    cleanupPointerDrag();
    game = {
      puzzle,
      pool: puzzle.players.map((player) => player.id),
      zones: [[], [], [], []],
      complete: false,
      hintLevel: 0,
      hintOpen: false,
    };
    renderGame();
    history.pushState({ screen: "puzzle", puzzleId }, "", `#${puzzleId}`);
    void logConnectPlay();
  }

  function playerById(id) {
    return game?.puzzle.players.find((player) => player.id === id);
  }

  function cardHtml(player, location) {
    return `
      <div class="player-card" data-player-id="${escapeHtml(player.id)}" data-location="${location}" aria-label="${escapeHtml(player.name)} 드래그">
        <img src="${escapeHtml(player.photo)}" alt="" draggable="false">
        <span class="player-name">${escapeHtml(player.name)}</span>
      </div>`;
  }

  function zoneHtml(index) {
    const ids = game.zones[index];
    const players = ids.map(playerById);
    const connections = getConnections(players);
    const stateClass = ids.length === 4 ? (connections.length ? "valid" : "invalid") : "";
    const status = connections.length
      ? `<div class="connection-tags">${connections.map((item) => `<span class="connection-tag">${escapeHtml(item.label)}</span>`).join("")}</div>`
      : ids.length === 4
        ? '<span class="no-connection">공통점 없음</span>'
        : "";
    return `
      <section class="zone zone-${index} ${stateClass}" data-zone-index="${index}" data-drop-target="zone" aria-label="그룹 ${index + 1}, ${ids.length}명">
        <div class="zone-head">
          <div class="zone-label"><span class="zone-dot">${index + 1}</span><span>${ids.length} / 4</span></div>
          ${status}
        </div>
        <div class="zone-cards">
          ${players.length ? players.map((player) => cardHtml(player, `zone-${index}`)).join("") : '<div class="zone-empty">선수를 이곳에<br>배치하세요</div>'}
        </div>
      </section>`;
  }

  function hintOverlayHtml() {
    if (!game.hintOpen) return "";
    const hints = puzzleHints[game.puzzle.id] || [];
    const revealedHints = hints.slice(0, game.hintLevel);
    return `
      <div class="hint-overlay" id="hintOverlay">
        <section class="hint-card" role="dialog" aria-modal="true" aria-labelledby="hintTitle">
          <div class="hint-card-head">
            <div>
              <span class="hint-kicker">문제 ${game.puzzle.id}</span>
              <h2 id="hintTitle">힌트 ${game.hintLevel} / 2</h2>
            </div>
            <button class="hint-close" id="hintClose" aria-label="힌트 닫기">×</button>
          </div>
          <div class="hint-steps">
            ${revealedHints.map((hint, index) => `
              <div class="hint-step">
                <span class="hint-step-number">${index + 1}</span>
                <p>${escapeHtml(hint)}</p>
              </div>`).join("")}
          </div>
          <button class="hint-next" id="hintNext">${game.hintLevel < 2 ? "2단계 힌트 보기" : "확인"}</button>
        </section>
      </div>`;
  }

  function renderGame() {
    const visiblePoolRows = Math.ceil(game.pool.length / 4);
    const poolRows = Math.max(1, visiblePoolRows);
    const poolHeightPx = 38 + visiblePoolRows * 78;
    const poolHeightVw = 18 + visiblePoolRows * 17;
    const hasPlacedPlayers = game.zones.some((ids) => ids.length > 0);
    app.innerHTML = `
      <section class="game-shell">
        <header class="game-topbar">
          <button class="back-button" id="listButton">← 문제 목록</button>
          <h1 class="puzzle-title">문제 ${game.puzzle.id}</h1>
          <div class="game-actions">
            <button class="reset-button" id="resetButton" aria-label="배치 초기화" ${hasPlacedPlayers ? "" : "disabled"}><span aria-hidden="true">↻</span><span class="reset-label">배치 초기화</span></button>
            <button class="hint-button ${game.hintLevel ? "used" : ""}" id="hintButton">💡 ${game.hintLevel ? `${game.hintLevel}/2` : "힌트"}</button>
          </div>
        </header>
        <p class="game-guide">드래그해서 그룹을 완성하세요</p>
        <div class="game-board" id="gameBoard">
          ${zoneHtml(0)}
          ${zoneHtml(1)}
          <section class="player-pool" id="playerPool" data-drop-target="pool" aria-label="대기 선수 ${game.pool.length}명" style="--pool-rows:${poolRows};--pool-mobile-height-px:${poolHeightPx}px;--pool-mobile-height-vw:${poolHeightVw}vw">
            <div class="pool-head"><strong>대기 선수</strong><span class="pool-count">${game.pool.length}명</span></div>
            <div class="pool-grid">
              ${game.pool.length ? game.pool.map((id) => cardHtml(playerById(id), "pool")).join("") : '<div class="pool-empty">모든 선수를 배치했습니다</div>'}
            </div>
          </section>
          ${zoneHtml(2)}
          ${zoneHtml(3)}
        </div>
        ${hintOverlayHtml()}
        <div class="toast" id="toast" role="status"></div>
      </section>`;
    bindGameEvents();
  }

  function bindGameEvents() {
    document.getElementById("listButton").addEventListener("click", renderList);
    document.getElementById("resetButton").addEventListener("click", resetPlacement);
    document.getElementById("hintButton").addEventListener("click", openHint);
    document.getElementById("hintClose")?.addEventListener("click", closeHint);
    document.getElementById("hintNext")?.addEventListener("click", advanceHint);
    document.getElementById("hintOverlay")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeHint();
    });
    document.querySelectorAll(".player-card").forEach((card) => {
      card.addEventListener("pointerdown", beginPointerDrag);
      card.addEventListener("pointermove", movePointerDrag);
      card.addEventListener("pointerup", endPointerDrag);
      card.addEventListener("pointercancel", cancelPointerDrag);
      card.addEventListener("lostpointercapture", cancelPointerDrag);
    });
  }

  function resetPlacement() {
    cleanupPointerDrag();
    game.pool = game.puzzle.players.map((player) => player.id);
    game.zones = [[], [], [], []];
    game.complete = false;
    renderGame();
    showToast("배치를 초기화했습니다.");
  }

  function openHint() {
    if (!puzzleHints[game.puzzle.id]?.length) {
      showToast("이 문제의 힌트를 불러오지 못했습니다.");
      return;
    }
    game.hintLevel = Math.max(1, game.hintLevel);
    game.hintOpen = true;
    renderGame();
  }

  function closeHint() {
    game.hintOpen = false;
    renderGame();
  }

  function advanceHint() {
    if (game.hintLevel < 2) {
      game.hintLevel += 1;
      renderGame();
      return;
    }
    closeHint();
  }

  function beginPointerDrag(event) {
    if (event.button !== 0 || pointerDrag) return;
    const card = event.currentTarget;
    pointerDrag = {
      pointerId: event.pointerId,
      playerId: card.dataset.playerId,
      card,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      ghost: null,
    };
    card.setPointerCapture?.(event.pointerId);
  }

  function movePointerDrag(event) {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
    if (!pointerDrag.active && distance < 7) return;
    event.preventDefault();
    if (!pointerDrag.active) activatePointerDrag();
    pointerDrag.ghost.style.left = `${event.clientX}px`;
    pointerDrag.ghost.style.top = `${event.clientY}px`;
    updateDropTarget(event.clientX, event.clientY);
  }

  function activatePointerDrag() {
    const rect = pointerDrag.card.getBoundingClientRect();
    const ghost = pointerDrag.card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    pointerDrag.active = true;
    pointerDrag.ghost = ghost;
    pointerDrag.card.classList.add("dragging");
    document.body.classList.add("is-dragging");
  }

  function updateDropTarget(clientX, clientY) {
    document.querySelectorAll(".drop-ready").forEach((element) => element.classList.remove("drop-ready"));
    const target = document.elementFromPoint(clientX, clientY)?.closest("[data-drop-target]");
    target?.classList.add("drop-ready");
  }

  function endPointerDrag(event) {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const drag = pointerDrag;
    const target = drag.active ? document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drop-target]") : null;
    cleanupPointerDrag();
    if (!drag.active || !target) return;
    if (target.dataset.dropTarget === "pool") returnToPool(drag.playerId);
    else movePlayerToZone(drag.playerId, Number(target.dataset.zoneIndex));
  }

  function cancelPointerDrag(event) {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    cleanupPointerDrag();
  }

  function cleanupPointerDrag() {
    if (pointerDrag?.ghost) pointerDrag.ghost.remove();
    pointerDrag?.card?.classList.remove("dragging");
    pointerDrag = null;
    document.body.classList.remove("is-dragging");
    document.querySelectorAll(".drop-ready").forEach((element) => element.classList.remove("drop-ready"));
  }

  function locatePlayer(id) {
    const poolIndex = game.pool.indexOf(id);
    if (poolIndex >= 0) return { type: "pool", index: poolIndex };
    for (let zoneIndex = 0; zoneIndex < game.zones.length; zoneIndex += 1) {
      const index = game.zones[zoneIndex].indexOf(id);
      if (index >= 0) return { type: "zone", zoneIndex, index };
    }
    return null;
  }

  function removeFromCurrentLocation(id) {
    const location = locatePlayer(id);
    if (!location) return;
    if (location.type === "pool") game.pool.splice(location.index, 1);
    else game.zones[location.zoneIndex].splice(location.index, 1);
  }

  function movePlayerToZone(id, zoneIndex) {
    if (!id || !playerById(id) || !Number.isInteger(zoneIndex)) return;
    const current = locatePlayer(id);
    if (current?.type === "zone" && current.zoneIndex === zoneIndex) return;
    if (game.zones[zoneIndex].length >= 4) {
      showToast("이 그룹에는 이미 4명이 있습니다.");
      return;
    }
    removeFromCurrentLocation(id);
    game.zones[zoneIndex].push(id);
    renderGame();
    checkComplete();
  }

  function returnToPool(id) {
    if (!id || !playerById(id)) return;
    const location = locatePlayer(id);
    if (!location || location.type === "pool") return;
    removeFromCurrentLocation(id);
    game.pool.push(id);
    renderGame();
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    window.clearTimeout(toastId);
    toast.textContent = message;
    toast.classList.add("show");
    toastId = window.setTimeout(() => toast.classList.remove("show"), 1300);
  }

  function checkComplete() {
    const solved = game.pool.length === 0 && game.zones.every((ids) => ids.length === 4 && getConnections(ids.map(playerById)).length > 0);
    if (!solved || game.complete) return;
    game.complete = true;
    const firstClear = !isCompleted(readRecords()[game.puzzle.id]);
    const bonus = game.hintLevel === 0 ? 20 : game.hintLevel === 1 ? 10 : 0;
    window.FSPoints?.earn("connect", firstClear ? 40 + bonus : 0,
      `문제 ${game.puzzle.id} ${firstClear ? "완료" : "다시 풀기"}${game.hintLevel ? ` · 힌트 ${game.hintLevel}` : " · 노힌트"}`);
    writeCompletion(game.puzzle.id);
    window.setTimeout(showSuccess, 260);
  }

  function showSuccess() {
    const nextPuzzle = puzzles.find((puzzle) => puzzle.id === game.puzzle.id + 1) || puzzles[0];
    const overlay = document.createElement("div");
    overlay.className = "success-overlay";
    overlay.innerHTML = `
      <div class="success-card" role="dialog" aria-modal="true" aria-labelledby="successTitle">
        <div class="success-icon">✓</div>
        <h2 id="successTitle">문제 ${game.puzzle.id} 완료!</h2>
        <p class="success-copy">네 그룹을 모두 연결했습니다</p>
        <div class="success-actions">
          <button id="successHome">처음으로</button>
          <button class="primary" id="successNext">다음 문제</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("successHome").addEventListener("click", () => {
      overlay.remove();
      renderList();
    });
    document.getElementById("successNext").addEventListener("click", () => {
      overlay.remove();
      startPuzzle(nextPuzzle.id);
    });
  }

  window.addEventListener("popstate", () => renderList());
  const initialPuzzleId = Number(location.hash.replace("#", ""));
  if (puzzles.some((puzzle) => puzzle.id === initialPuzzleId)) startPuzzle(initialPuzzleId);
  else renderList();
})();
