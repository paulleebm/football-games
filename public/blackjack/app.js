import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, addDoc, serverTimestamp, collection, query, orderBy, limit, onSnapshot, increment,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

(function () {
  "use strict";

  // ---------------------------------------------------------------- 상수
  const TARGET = 90;           // 21 대신 90
  const DEALER_STAND = 81;     // 딜러는 81 이상이면 멈춘다 (design 문서 참고)
  const MIN_BET = 5;
  const CHIPS = [5, 10, 50, 100];
  const NATURAL_MULT = 1.5;    // 첫 두 장 합이 정확히 90(내추럴)이면 1.5배

  // 베팅은 사이트 공용 포인트로 한다 (시작 지급·파산 리셋 없음).
  // 랭킹은 블랙잭으로 번 누적 순이익(0 미만은 0)이다.
  const PROFIT_KEY = "bjProfit";
  const NICK_KEY = "bjNickname";

  const ALL_PLAYERS = Array.isArray(window.BLACKJACK_PLAYERS) ? window.BLACKJACK_PLAYERS : [];

  // ---------------------------------------------------------------- firebase
  const firebaseApp = initializeApp({
    projectId: "guess-your-player",
    appId: "1:1068776442781:web:433981863e0c3da178bd74",
    storageBucket: "guess-your-player.firebasestorage.app",
    apiKey: "AIzaSyA8SG_LbHeqS9gh0CLFaHUhEI1uG1uYLDY",
    authDomain: "guess-your-player.firebaseapp.com",
    messagingSenderId: "1068776442781",
  });
  const db = getFirestore(firebaseApp);
  const ENTRIES_PATH = ["blackjackLeaderboard", "live", "entries"];

  // ---------------------------------------------------------------- utils
  function deviceId() {
    let id = localStorage.getItem("quizDeviceId");
    if (!id) {
      id = "d-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("quizDeviceId", id);
    }
    return id;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  const points = () => window.FSPoints?.balance() || 0;
  function loadProfit() {
    const n = parseInt(localStorage.getItem(PROFIT_KEY), 10);
    return Number.isFinite(n) ? n : 0;
  }
  function saveProfit(n) {
    localStorage.setItem(PROFIT_KEY, String(n));
    window.FSPoints?.touch();
  }
  try { localStorage.removeItem("bjCoins"); } catch (_) {}
  function loadNickname() {
    return localStorage.getItem(NICK_KEY) || "";
  }
  function saveNickname(name) {
    localStorage.setItem(NICK_KEY, name);
  }

  // ---------------------------------------------------------------- 통계 로그 (사이트 공통 패턴)
  let cachedClientIp = null;
  async function getClientIp() {
    if (cachedClientIp) return cachedClientIp;
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      cachedClientIp = (await res.json()).ip;
    } catch (_) {
      cachedClientIp = "unknown";
    }
    return cachedClientIp;
  }
  function todayKeyKST() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  }
  let loggedThisSession = false;
  async function logPlayOnce() {
    if (loggedThisSession) return;
    loggedThisSession = true;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    try {
      const ip = await getClientIp();
      await Promise.all([
        addDoc(collection(db, "playLogs"), { ts: serverTimestamp(), ip, game: "blackjack" }),
        setDoc(doc(db, "statsCounters", "totals"), { blackjack: increment(1) }, { merge: true }),
        setDoc(doc(db, "statsDaily", todayKeyKST()), { blackjack: increment(1) }, { merge: true }),
      ]);
    } catch (error) {
      console.error("logPlayOnce failed", error);
    }
  }

  // 블랙잭 누적 순이익을 실시간 랭킹에 반영한다 (문서 필드 이름은 규칙 때문에 coins 그대로). 판마다 오르내리므로
  // (기존 게임들의 "최고기록만 갱신" 모델과 달리) 매 판 종료 시 그냥 덮어쓴다.
  // firestore.rules 배포 전에는 permission-denied로 실패하는 게 정상이며,
  // 그래도 게임 자체는 문제없이 계속되도록 실패를 조용히 삼킨다.
  async function syncLeaderboard(profit, nickname) {
    try {
      await setDoc(doc(db, ...ENTRIES_PATH, deviceId()), {
        nickname: (nickname || "익명").slice(0, 20),
        coins: Math.max(0, profit),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn("syncLeaderboard failed (rules 배포 전이면 정상)", error);
    }
  }

  // ---------------------------------------------------------------- 덱 (슈)
  // 완전 균등 추첨 대신 두 겹의 가중치를 준다:
  // 1) 등번호가 "건설형" 구간(대략 20~45)일 때 기본적으로 살짝 더 잘 뽑힌다.
  // 2) 지금 플레이어 패 합이 아직 낮을 때(위험 구간에 한참 못 미칠 때)는 큰
  //    카드 쪽에 추가로 힘을 실어서, 계속 작은 카드만 나와 뻔한 판이 되는 대신
  //    합이 서서히 버스트 위험 구간까지 올라가게 만든다 - 그래야 히트냐 스탠드냐
  //    진짜로 고민하는 순간이 자주 생긴다. 어떤 등번호도 완전히 배제되진 않으니
  //    (가중치가 0이 되지 않음) 밖에서 보기엔 그냥 자연스러운 우연처럼 보인다.
  function drawWeight(shirtNumber, contextTotal) {
    const center = 30;
    const spread = 18;
    const d = (shirtNumber - center) / spread;
    let w = 0.5 + 1.3 * Math.exp(-(d * d) / 2);
    if (contextTotal < 50) w *= 1 + (shirtNumber / 99) * 1.1;
    else if (contextTotal < 65) w *= 1 + (shirtNumber / 99) * 0.5;
    return w;
  }

  function handValue(cards) {
    return cards.reduce((sum, c) => sum + c.shirtNumber, 0);
  }

  let shoe = [];
  function drawCard() {
    if (!shoe.length) shoe = ALL_PLAYERS.slice();
    const contextTotal = round ? handValue(round.player.cards) : 0;
    let totalWeight = 0;
    const weights = shoe.map((c) => {
      const w = drawWeight(c.shirtNumber, contextTotal);
      totalWeight += w;
      return w;
    });
    let r = Math.random() * totalWeight;
    for (let i = 0; i < shoe.length; i += 1) {
      r -= weights[i];
      if (r <= 0) return shoe.splice(i, 1)[0];
    }
    return shoe.pop(); // 부동소수 오차 안전망
  }
  // ---------------------------------------------------------------- 상태
  const app = document.getElementById("app");
  let state = {
    screen: "home", // home | table
    profit: loadProfit(),
    nickname: loadNickname(),
  };
  let round = null; // { bet, player:{cards,els}, dealer:{cards,els,holeEl,holeHidden}, phase }
  let rankUnsub = null;

  // ---------------------------------------------------------------- 카드 DOM
  // 이름이 두 줄로 넘어가면 카드마다 사진 영역 높이가 제각각 달라져서 (이름 줄 수만큼
  // 사진이 눌리므로) 실제 유니폼처럼 성(姓)만 한 줄로 보여준다 - 축구 선수는 보통
  // 등번호 아래에 성만 적혀 있어 더 자연스럽고, 어떤 이름이 와도 카드 레이아웃이
  // 항상 동일해진다. (CSS의 ellipsis도 안전망으로 같이 걸어둔다.)
  function cardDisplayName(name) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : name;
  }
  function cardBackHtml(teamId) {
    return `<div class="pcard-face pcard-back"><div class="pcard-logo-badge"><img src="logos/${teamId}.png" alt="" draggable="false"></div></div>`;
  }
  function cardFrontHtml(card) {
    return `
      <div class="pcard-face pcard-front">
        <div class="pcard-corner"><span class="pcard-num">${card.shirtNumber}</span></div>
        <div class="pcard-photo-wrap"><img src="${escapeHtml(card.photo)}" alt="" draggable="false"></div>
        <div class="pcard-name">${escapeHtml(cardDisplayName(card.name))}</div>
      </div>`;
  }
  function buildCardEl(card) {
    const el = document.createElement("div");
    el.className = "pcard";
    el.innerHTML = `<div class="pcard-inner">${cardBackHtml(card.teamId)}${cardFrontHtml(card)}</div>`;
    return el;
  }
  function flipCard(el) {
    requestAnimationFrame(() => el.classList.add("flipped"));
  }

  // ---------------------------------------------------------------- 화면 뼈대
  function render() {
    if (state.screen === "home") renderHome();
    else renderTableShell();
  }

  function renderHome() {
    cleanupRound();
    const hasNick = !!state.nickname;
    app.innerHTML = `
      <div class="bj-shell bj-shell-home">
        <div class="bj-topbar">
          <a class="bj-back" href="../">← 축구 게임</a>
          <span class="bj-title">⚽ 등번호 블랙잭</span>
          <span></span>
        </div>
        <div class="bj-home">
          <div class="bj-home-emoji">🃏</div>
          <h1>등번호 블랙잭</h1>
          <p>선수들의 등번호로 하는 블랙잭.<br>목표는 21이 아니라 <b style="color:var(--gold)">90</b>!</p>
          <div class="bj-rules-card">
            <b>규칙 요약</b><br>
            · 카드 값 = 실제 등번호(1~99)<br>
            · 90 넘으면 버스트, 딜러는 81 이상이면 스탠드<br>
            · 첫 두 장 합이 정확히 90이면 <b>내추럴 90</b> — 1.5배 지급<br>
            · 히트 / 스탠드만 있는 심플 룰<br>
            · 포인트로 베팅, 최소 ${MIN_BET}P
          </div>
          <div class="bj-nick-row">
            <input id="nickInput" maxlength="20" placeholder="닉네임 (랭킹에 표시돼요)" value="${escapeHtml(state.nickname)}">
          </div>
          <button class="bj-primary-btn" id="startBtn">${hasNick ? "게임 시작" : "닉네임 정하고 시작"}</button>
        </div>
      </div>`;
    document.getElementById("startBtn").addEventListener("click", () => {
      const nick = (document.getElementById("nickInput").value || "").trim().slice(0, 20);
      if (!nick) {
        document.getElementById("nickInput").focus();
        return;
      }
      state.nickname = nick;
      saveNickname(nick);
      state.screen = "table";
      render();
    });
  }

  function renderTableShell() {
    app.innerHTML = `
      <div class="bj-shell">
        <div class="bj-topbar">
          <a class="bj-back" href="../">← 축구 게임</a>
          <span class="bj-title">⚽ 등번호 블랙잭</span>
          <div class="bj-topbar-right">
            <button class="bj-rank-btn" id="rankBtn">🏆 랭킹</button>
            <span class="bj-coin-pill" id="coinPill">${points().toLocaleString()}P</span>
          </div>
        </div>
        <div class="bj-table">
          <div class="bj-zone">
            <span class="bj-zone-label">딜러</span>
            <div class="bj-hand" id="dealerHand"></div>
            <span class="bj-sum-pill" id="dealerSum">0</span>
          </div>
          <div class="bj-deck-area">
            <div class="bj-deck-slot" id="deckSlot"></div>
            <div class="bj-center-msg" id="centerMsg">베팅액을 고르고 딜을 시작하세요</div>
          </div>
          <div class="bj-zone">
            <span class="bj-sum-pill" id="playerSum">0</span>
            <div class="bj-hand" id="playerHand"></div>
            <span class="bj-zone-label">나</span>
          </div>
        </div>
        <div class="bj-controls" id="controlsSlot"></div>
      </div>`;
    document.getElementById("rankBtn").addEventListener("click", openRanking);
    renderDeckArea();
    renderBettingControls();
  }

  // ---------------------------------------------------------------- 가운데 카드 더미(덱)
  // 더미는 "맨 뒤(back) - 중간(mid) - 맨 위(top, 실제 카드)" 3겹으로 구성된다.
  // 필러 2장(back/mid)은 매번 살짝 다른 무작위 각도/위치로 놓여서 매번 똑같은
  // 모양으로 안 돌아오고(손으로 대충 쌓아놓은 느낌), 서로 움직이는 애니메이션은
  // 없다 - 대신 맨 위(top) 카드, 즉 실제로 보이는 다음 카드만 승격될 때마다 매번
  // "방금 막 놓인" 듯한 짧고 일관된 등장 모션을 준다. 이전엔 필러만 슬쩍 움직이고
  // 정작 눈에 띄는 top 카드는 가만히 있어서 어색했는데, 이제는 항상 top 카드
  // 쪽에서 "위에서 가져왔다"는 느낌이 나게 뒤집었다.
  let deckSlots = { back: null, mid: null, top: null }; // back/mid: 장식용 필러 <div>, top: { card, el }

  // depth 0=맨 뒤(더 비뚤고 멀리), 1=중간(살짝만) - 매 호출마다 범위 안에서 무작위.
  function fillerTransform(depth) {
    const spread = depth === 0 ? 4.5 : 2.2;
    const rotBase = depth === 0 ? -5 : 3;
    const dx = spread + (Math.random() * 3 - 1.5);
    const dy = spread + (Math.random() * 3 - 1.5);
    const rot = rotBase + (Math.random() * 5 - 2.5);
    return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
  }

  function buildFillerEl(depth) {
    const el = document.createElement("div");
    el.className = "pcard-filler";
    el.style.transform = fillerTransform(depth);
    return el;
  }

  function renderDeckArea() {
    const slot = document.getElementById("deckSlot");
    if (!slot) return;
    slot.innerHTML = `<div class="bj-deck-stack" id="deckStack"></div>`;
    const stack = document.getElementById("deckStack");
    const back = buildFillerEl(0);
    const mid = buildFillerEl(1);
    stack.append(back, mid);
    deckSlots = { back, mid, top: null };
    promoteDeck(); // mid를 곧바로 진짜 카드(top)로 승격시켜 처음부터 준비된 상태로 시작
  }

  // mid(필러) -> top(실제 카드, 짧은 등장 모션과 함께)으로, back(필러) -> mid(새
  // 무작위 위치)로 한 칸씩 승격시키고, 맨 뒤에 새 필러를 보충한다.
  function promoteDeck() {
    const stack = document.getElementById("deckStack");
    if (!stack) return;

    const midEl = deckSlots.mid;
    const card = drawCard();
    midEl.style.transform = "";
    midEl.style.animation = "none";
    void midEl.offsetWidth; // 리플로우로 애니메이션을 확실히 처음부터 재생시킨다
    midEl.className = "pcard deck-arrive";
    midEl.style.animation = "";
    midEl.innerHTML = `<div class="pcard-inner">${cardBackHtml(card.teamId)}${cardFrontHtml(card)}</div>`;
    deckSlots.top = { card, el: midEl };

    const backEl = deckSlots.back;
    backEl.style.transform = fillerTransform(1);
    deckSlots.mid = backEl;

    const newBack = buildFillerEl(0);
    stack.insertBefore(newBack, stack.firstChild);
    deckSlots.back = newBack;
  }

  // 더미 맨 위 카드를 실제로 targetContainer(손패)로 이동시킨다. FLIP 기법으로
  // "더미 위치 -> 손패 위치"를 자연스럽게 보간하고, 빠지자마자 밑에 깔려있던
  // 카드를 승격시켜 다음 카드를 준비해둔다.
  async function takeFromDeck(targetContainer, { reveal = true } = {}) {
    const taken = deckSlots.top;
    deckSlots.top = null;
    const el = taken.el;

    const fromRect = el.getBoundingClientRect();
    el.style.animation = "none";
    // 딜러존 -> 더미 -> 플레이어존 순으로 DOM에 나란히 놓여있어서, 카드가 더미보다
    // DOM상 앞쪽에 있는 딜러존으로 이동할 때는 기본 쌓임 순서상 더미(및 그 뒤에 남은
    // 필러 카드들)에 가려져 "더미 한가운데서 카드를 빼내는" 것처럼 보였다. 이동하는
    // 동안만 다른 모든 요소보다 위에 그려지도록 z-index를 강제로 올려서, 항상
    // "더미 맨 위에서 들어올려져 이동한다"는 느낌이 나게 한다.
    el.style.zIndex = "20";
    targetContainer.appendChild(el);
    const toRect = el.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    void el.offsetWidth; // 리플로우를 강제해서 위 transform이 애니메이션 없이 즉시 적용되게 한다
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.38s cubic-bezier(.22,.8,.32,1)";
      el.style.transform = "";
    });

    promoteDeck(); // 카드가 빠져나가자마자 밑에 있던 카드를 바로 승격시킨다

    await sleep(380);
    el.style.transition = "";
    el.style.zIndex = "";
    if (reveal) {
      await sleep(60);
      flipCard(el);
      await sleep(300);
    }
    return { card: taken.card, el };
  }

  function els() {
    return {
      dealerHand: document.getElementById("dealerHand"),
      playerHand: document.getElementById("playerHand"),
      dealerSum: document.getElementById("dealerSum"),
      playerSum: document.getElementById("playerSum"),
      centerMsg: document.getElementById("centerMsg"),
      coinPill: document.getElementById("coinPill"),
      controlsSlot: document.getElementById("controlsSlot"),
    };
  }

  function updateCoinPill() {
    const { coinPill } = els();
    if (coinPill) coinPill.textContent = `${points().toLocaleString()}P`;
  }

  // ---------------------------------------------------------------- 베팅
  // 잔액 안에서 칩을 더해 정한다. 최소 / 절반 / 올인 바로가기.
  let pendingBet = 10;
  function renderBettingControls() {
    const bal = points();
    if (bal < MIN_BET) {
      renderBankruptControls();
      return;
    }
    pendingBet = Math.min(Math.max(MIN_BET, pendingBet), bal);
    const { controlsSlot } = els();
    controlsSlot.innerHTML = `
      <div class="bj-bet-row">
        ${CHIPS.map((v) => `<button class="bj-chip c${v}" data-add="${v}">+${v}</button>`).join("")}
      </div>
      <div class="bj-bet-amount-row">
        <button class="bj-bet-reset" id="betMinBtn">최소</button>
        <button class="bj-bet-reset" id="betHalfBtn">½</button>
        <span class="bj-bet-amount"></span>
        <button class="bj-bet-reset" id="betAllBtn">올인</button>
      </div>
      <div class="bj-action-row">
        <button class="bj-action-btn primary" id="dealBtn"></button>
      </div>`;
    function refreshAmount() {
      controlsSlot.querySelector(".bj-bet-amount").textContent = `${pendingBet.toLocaleString()}P`;
      controlsSlot.querySelector("#dealBtn").textContent = `딜! (${pendingBet.toLocaleString()}P 베팅)`;
      controlsSlot.querySelectorAll("[data-add]").forEach((btn) => { btn.disabled = pendingBet >= bal; });
    }
    refreshAmount();
    controlsSlot.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingBet = Math.min(bal, pendingBet + Number(btn.dataset.add));
        refreshAmount();
      });
    });
    document.getElementById("betMinBtn").addEventListener("click", () => { pendingBet = MIN_BET; refreshAmount(); });
    document.getElementById("betHalfBtn").addEventListener("click", () => { pendingBet = Math.max(MIN_BET, Math.floor(bal / 2)); refreshAmount(); });
    document.getElementById("betAllBtn").addEventListener("click", () => { pendingBet = bal; refreshAmount(); });
    document.getElementById("dealBtn").addEventListener("click", () => startRound(pendingBet));
  }

  function renderBankruptControls() {
    const { controlsSlot, centerMsg } = els();
    if (centerMsg) centerMsg.textContent = `포인트가 부족해요 (최소 ${MIN_BET}P)`;
    controlsSlot.innerHTML = `
      <div class="bj-action-row">
        <a class="bj-action-btn primary" href="../">← 축구 게임</a>
      </div>`;
  }

  // ---------------------------------------------------------------- 라운드 진행
  function cleanupRound() {
    round = null;
  }

  async function startRound(bet) {
    if (round || !window.FSPoints?.spend("blackjack", bet, `베팅 ${bet}P`)) {
      renderBettingControls();
      return;
    }
    void logPlayOnce();
    const { dealerHand, playerHand, dealerSum, playerSum, centerMsg, controlsSlot } = els();
    updateCoinPill();

    dealerHand.innerHTML = "";
    playerHand.innerHTML = "";
    dealerSum.textContent = "0";
    dealerSum.classList.remove("bust");
    playerSum.textContent = "0";
    playerSum.classList.remove("bust");
    centerMsg.textContent = "카드를 나눠주는 중…";
    controlsSlot.innerHTML = `<div class="bj-action-row"><button class="bj-action-btn" disabled>딜링 중…</button></div>`;

    round = {
      bet,
      player: { cards: [] },
      dealer: { cards: [], holeEl: null },
    };

    const c1 = await takeFromDeck(playerHand);
    round.player.cards.push(c1.card);
    playerSum.textContent = handValue(round.player.cards);

    const d1 = await takeFromDeck(dealerHand);
    round.dealer.cards.push(d1.card);
    dealerSum.textContent = "?";

    const c2 = await takeFromDeck(playerHand);
    round.player.cards.push(c2.card);
    playerSum.textContent = handValue(round.player.cards);

    const d2 = await takeFromDeck(dealerHand, { reveal: false });
    round.dealer.cards.push(d2.card);
    round.dealer.holeEl = d2.el;

    const playerTotal = handValue(round.player.cards);
    const dealerTotal = handValue(round.dealer.cards);
    const playerNatural = playerTotal === TARGET;
    const dealerNatural = dealerTotal === TARGET;

    if (playerNatural || dealerNatural) {
      flipCard(round.dealer.holeEl);
      await sleep(520);
      dealerSum.textContent = dealerTotal;
      if (playerNatural && dealerNatural) return resolveRound("push-natural");
      if (playerNatural) return resolveRound("player-natural");
      return resolveRound("dealer-natural");
    }

    // 등번호는 최대 99라 첫 두 장만으로도 90을 넘을 수 있다(예: 47+50) - 실제
    // 블랙잭(카드값 1~11)에서는 있을 수 없는 경우라 놓치기 쉽다. 플레이어가
    // 먼저 버스트했으면 딜러 패는 공개하지 않고 바로 패배 처리(히트로 버스트했을
    // 때와 동일 규칙), 플레이어는 안 넘었는데 딜러만 넘었으면 공개하고 승리 처리한다.
    if (playerTotal > TARGET) {
      playerSum.classList.add("bust");
      return resolveRound("player-bust");
    }
    if (dealerTotal > TARGET) {
      flipCard(round.dealer.holeEl);
      await sleep(520);
      dealerSum.textContent = dealerTotal;
      dealerSum.classList.add("bust");
      return resolveRound("dealer-bust");
    }

    showDecisionControls();
  }

  function showDecisionControls() {
    const { centerMsg } = els();
    if (centerMsg) centerMsg.textContent = "히트 또는 스탠드를 선택하세요";
    renderPlayControls();
  }

  function renderPlayControls() {
    const { controlsSlot } = els();
    controlsSlot.innerHTML = `
      <div class="bj-action-row">
        <button class="bj-action-btn" id="hitBtn">히트</button>
        <button class="bj-action-btn primary" id="standBtn">스탠드</button>
      </div>`;
    document.getElementById("hitBtn").addEventListener("click", onHit);
    document.getElementById("standBtn").addEventListener("click", onStand);
  }

  async function onHit() {
    const { playerHand, playerSum, controlsSlot } = els();
    controlsSlot.querySelectorAll("button").forEach((b) => { b.disabled = true; });

    const taken = await takeFromDeck(playerHand);
    round.player.cards.push(taken.card);
    const total = handValue(round.player.cards);
    playerSum.textContent = total;

    if (total > TARGET) {
      playerSum.classList.add("bust");
      await sleep(400);
      return dealerRevealAndResolve("player-bust");
    }
    if (total === TARGET) {
      await sleep(300);
      return onStand();
    }
    showDecisionControls();
  }

  async function onStand() {
    const { controlsSlot } = els();
    controlsSlot.innerHTML = `<div class="bj-action-row"><button class="bj-action-btn" disabled>딜러 차례…</button></div>`;
    return dealerRevealAndResolve(null);
  }

  async function dealerRevealAndResolve(forcedOutcome) {
    const { dealerHand, dealerSum, centerMsg } = els();

    // 플레이어가 버스트하면 그 순간 승부가 이미 정해져서 딜러가 더 받을 필요도,
    // 히든카드를 공개할 필요도 없다 - 공개 없이 바로 결과 처리한다.
    if (forcedOutcome === "player-bust") {
      return resolveRound("player-bust");
    }

    flipCard(round.dealer.holeEl);
    await sleep(520);
    let total = handValue(round.dealer.cards);
    dealerSum.textContent = total;

    centerMsg.textContent = "딜러가 카드를 받는 중…";
    while (total < DEALER_STAND) {
      await sleep(400);
      const taken = await takeFromDeck(dealerHand);
      round.dealer.cards.push(taken.card);
      total = handValue(round.dealer.cards);
      dealerSum.textContent = total;
    }
    if (total > TARGET) {
      dealerSum.classList.add("bust");
      return resolveRound("dealer-bust");
    }
    const playerTotal = handValue(round.player.cards);
    if (playerTotal > total) return resolveRound("player-higher");
    if (playerTotal < total) return resolveRound("dealer-higher");
    return resolveRound("push");
  }

  // ---------------------------------------------------------------- 정산
  function resolveRound(outcome) {
    const { bet } = round;
    let delta = 0; // coins가 이미 bet만큼 차감된 상태 기준, 돌려받는 총액
    let title = ""; let cls = ""; let emoji = ""; let detail = "";

    switch (outcome) {
      case "player-natural":
        delta = Math.round(bet * (1 + NATURAL_MULT));
        title = "내추럴 90!"; cls = "win"; emoji = "🎉";
        detail = `첫 두 장으로 정확히 90! <b>+${Math.round(bet * NATURAL_MULT)}P</b> (1.5배)`;
        break;
      case "dealer-natural":
        delta = 0;
        title = "딜러 내추럴 90"; cls = "lose"; emoji = "😵";
        detail = `딜러가 내추럴 90! <b>-${bet}P</b>`;
        break;
      case "push-natural":
        delta = bet;
        title = "둘 다 내추럴 90"; cls = "push"; emoji = "🤝";
        detail = "무승부, 베팅액을 돌려받아요";
        break;
      case "player-bust":
        delta = 0;
        title = "버스트!"; cls = "lose"; emoji = "💥";
        detail = `90을 넘었어요. <b>-${bet}P</b>`;
        break;
      case "dealer-bust":
        delta = bet * 2;
        title = "딜러 버스트!"; cls = "win"; emoji = "🎉";
        detail = `딜러가 90을 넘었어요! <b>+${bet}P</b>`;
        break;
      case "player-higher":
        delta = bet * 2;
        title = "승리!"; cls = "win"; emoji = "🎉";
        detail = `<b>+${bet}P</b>`;
        break;
      case "dealer-higher":
        delta = 0;
        title = "패배"; cls = "lose"; emoji = "😢";
        detail = `<b>-${bet}P</b>`;
        break;
      case "push":
        delta = bet;
        title = "무승부"; cls = "push"; emoji = "🤝";
        detail = "베팅액을 돌려받아요";
        break;
      default:
        delta = bet;
        title = "무승부"; cls = "push"; emoji = "🤝";
    }

    if (delta > 0) window.FSPoints?.add("blackjack", delta, `${title} · 베팅 ${bet}P`);
    state.profit += delta - bet;
    saveProfit(state.profit);
    updateCoinPill();
    void syncLeaderboard(state.profit, state.nickname);
    round = null;

    const { centerMsg } = els();
    if (centerMsg) centerMsg.textContent = "";
    showResultOverlay({ title, cls, emoji, detail });
  }

  function showResultOverlay({ title, cls, emoji, detail }) {
    const overlay = document.createElement("div");
    overlay.className = "bj-overlay";
    const bankrupt = points() < MIN_BET;
    overlay.innerHTML = `
      <div class="bj-result-card">
        <div class="bj-result-emoji">${emoji}</div>
        <h2 class="${cls}">${title}</h2>
        <div class="bj-result-detail">${detail}<br>현재 포인트: <b>${points().toLocaleString()}P</b></div>
        <div class="bj-result-actions">
          ${bankrupt
            ? `<button class="primary" id="resultHomeBtn">← 축구 게임</button>`
            : `<button class="primary" id="resultNextBtn">다음 판</button>`}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("resultNextBtn")?.addEventListener("click", () => {
      overlay.remove();
      renderTableShell();
    });
    document.getElementById("resultHomeBtn")?.addEventListener("click", () => { location.href = "../"; });
  }

  // ---------------------------------------------------------------- 랭킹(실시간)
  function openRanking() {
    const overlay = document.createElement("div");
    overlay.className = "bj-overlay";
    overlay.innerHTML = `
      <div class="bj-lb-card">
        <h2>🏆 블랙잭 순이익 랭킹</h2>
        <div id="bjLbMe"></div>
        <div id="bjLbBody"><div class="bj-lb-empty">불러오는 중…</div></div>
        <button class="bj-lb-close" id="bjLbCloseBtn">닫기</button>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      if (rankUnsub) { rankUnsub(); rankUnsub = null; }
    };
    document.getElementById("bjLbCloseBtn").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const q = query(collection(db, ...ENTRIES_PATH), orderBy("coins", "desc"), limit(200));
    if (rankUnsub) rankUnsub();
    rankUnsub = onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const ranked = all.filter((e) => (e.coins || 0) > 0);
      renderRankingBody(ranked);
    }, (error) => {
      console.warn("ranking listen failed (rules 배포 전이면 정상)", error);
      const body = document.getElementById("bjLbBody");
      if (body) body.innerHTML = `<div class="bj-lb-empty">랭킹을 불러올 수 없어요.</div>`;
    });
  }

  function renderRankingBody(ranked) {
    const meBox = document.getElementById("bjLbMe");
    const body = document.getElementById("bjLbBody");
    if (!body) return;
    const myId = deviceId();
    const myIndex = ranked.findIndex((e) => e.id === myId);

    if (meBox) {
      meBox.innerHTML = myIndex >= 0
        ? `<div class="bj-lb-me">내 순위: <b>${myIndex + 1}위</b> / ${ranked.length}명 (+${state.profit}P)</div>`
        : `<div class="bj-lb-me">${state.profit > 0 ? "집계 중…" : `순이익 ${state.profit}P`}</div>`;
    }

    if (!ranked.length) {
      body.innerHTML = `<div class="bj-lb-empty">아직 순위가 없어요.</div>`;
      return;
    }
    const top = ranked.slice(0, 20);
    body.innerHTML = `<table class="bj-lb"><tr><th>#</th><th>닉네임</th><th>순이익</th></tr>${
      top.map((r, i) => `<tr class="${r.id === myId ? "me" : ""}"><td>${i + 1}</td><td>${escapeHtml(r.nickname)}</td><td>+${escapeHtml(r.coins)}P</td></tr>`).join("")
    }</table>`;
  }

  render();
})();
