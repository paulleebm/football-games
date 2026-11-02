// 사이트 공용 포인트. 각 게임은 earn()만 부르고 화면에는 아무것도 띄우지 않는다.
// 잔액과 내역은 메인 페이지에서만 보여준다.
(function () {
  const KEY = "fs-points-v1";
  const MAX_LOG = 500;
  const DAILY_BONUS = 25;
  const GAME_MULT = 1.5; // 게임 보상 배수 (각 게임이 넘기는 기본값에 곱한다)
  const FREE_PACKS = 3; // 하루 무료 카드팩
  const GAMES = {
    attendance: "출석",
    google: "구글 계정 연결",
    bobble: "알까기 축구",
    penalty: "승부차기",
    jelly: "발롱도르 만들기",
    gogun: "고군분투",
    connect: "커넥트",
    big6: "빅6 야찌",
    classic: "선수 맞히기 · 클래식",
    challenge: "선수 맞히기 · 챌린지",
    silhouette: "실루엣 맞히기",
    "records-player": "기록 맞히기 · 개인",
    "records-team": "기록 맞히기 · 팀",
    captcha: "선수 CAPTCHA",
    blackjack: "등번호 블랙잭",
    scramble: "이름 뒤죽박죽",
    card: "카드팩",
    admin: "관리자 지급",
  };
  // 하루 한 번 보너스는 종목 이름이 열쇠라, 아무 이름이나 받으면 이름만 바꿔 계속 받을 수 있다.
  // 실제로 earn()/rankBonus()를 부르는 종목만 받는다.
  const PLAY_GAMES = ["classic", "challenge", "silhouette", "records-player", "records-team", "big6", "captcha", "connect", "bobble", "penalty", "jelly", "gogun", "scramble"];
  const RANK_GAMES = ["classic", "challenge", "silhouette", "big6", "captcha", "jelly", "gogun", "penalty"];

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && typeof s.bal === "number" && Array.isArray(s.log)) return { bal: s.bal, log: s.log, daily: s.daily || {}, stats: stats(s) };
    } catch (_) {}
    return { bal: 0, log: [], daily: {}, stats: { earned: 0, spent: 0, packs: 0 } };
  }
  // 누적 획득/사용 포인트, 카드팩 개봉 수 (예전 데이터는 남은 내역으로 처음 한 번 채운다)
  function stats(s) {
    const st = s.stats || {};
    if (st.earned == null) {
      st.earned = s.log.reduce((t, e) => t + (e.a > 0 ? e.a : 0), 0);
      st.spent = s.log.reduce((t, e) => t + (e.a < 0 ? -e.a : 0), 0);
    }
    st.packs = st.packs || 0;
    return st;
  }
  function save(s) {
    if (s.log.length > MAX_LOG) s.log = s.log.slice(-MAX_LOG);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
    touch();
  }
  // 계정에 올릴 데이터가 바뀌었다고 표시 (sync.js가 rev를 보고 서버와 맞춘다)
  function touch() {
    try {
      const m = JSON.parse(localStorage.getItem("fs-sync-meta") || "null") || { uid: null, rev: 0 };
      m.rev = (m.rev || 0) + 1;
      localStorage.setItem("fs-sync-meta", JSON.stringify(m));
    } catch (_) {}
    window.FSSync?.touched();
  }
  // 한국 시간 기준 날짜 (하루 첫 플레이 보너스용)
  function today() {
    return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  }
  function push(s, g, d, a) {
    s.bal += a;
    if (a > 0) s.stats.earned += a;
    else s.stats.spent -= a;
    s.log.push({ t: Date.now(), g, d, a, b: s.bal });
  }

  // 게임 한 판이 끝났을 때. amount가 0이어도 오늘 첫 판이면 보너스는 들어간다.
  function earn(game, amount, detail) {
    if (!PLAY_GAMES.includes(game)) return;
    const s = load();
    amount = Math.max(0, Math.round((amount || 0) * GAME_MULT));
    if (amount > 0) push(s, game, detail || "", amount);
    const day = today();
    if (s.daily[game] !== day) {
      s.daily[game] = day;
      push(s, game, "오늘 첫 플레이 보너스", DAILY_BONUS);
    }
    save(s);
  }
  // 출석: 한국 시간 하루 한 번. 연속 출석일수록 30 → 90까지 10씩 오른다 (7일째부터 90)
  function checkIn() {
    const s = load();
    const day = today();
    const c = s.daily.__checkin || { day: "", streak: 0 };
    if (c.day === day) return 0;
    const yesterday = new Date(Date.parse(day) - 864e5).toISOString().slice(0, 10);
    const streak = c.day === yesterday ? c.streak + 1 : 1;
    const amount = 30 + 10 * Math.min(streak - 1, 6);
    s.daily.__checkin = { day, streak };
    push(s, "attendance", streak > 1 ? `${streak}일 연속` : "", amount);
    save(s);
    return amount;
  }
  // 리더보드 TOP 10 진입 보너스. 기록을 새로 올렸을 때만 부르고, 게임마다 하루 한 번.
  function rankBonus(game, rank) {
    if (!RANK_GAMES.includes(game)) return 0;
    const s = load(), day = today(), key = "__rank_" + game;
    if (!(rank >= 1 && rank <= 10) || s.daily[key] === day) return 0;
    const amount = rank === 1 ? 150 : rank <= 3 ? 100 : 50;
    s.daily[key] = day;
    push(s, game, `랭킹 ${rank}위`, amount);
    save(s);
    return amount;
  }
  // 계정당 한 번만 주는 보너스 (key는 daily에 기록)
  function bonusOnce(key, game, amount, detail) {
    const s = load();
    if (s.daily[key]) return 0;
    s.daily[key] = today();
    push(s, game, detail || "", amount);
    save(s);
    return amount;
  }
  // 하루 무료 카드팩 (한국 시간 기준)
  function freePacksLeft() {
    const s = load();
    return s.daily.__freeDay === today() ? Math.max(0, FREE_PACKS - (s.daily.__freeUsed || 0)) : FREE_PACKS;
  }
  function useFreePack() {
    const s = load(), day = today();
    if (s.daily.__freeDay !== day) { s.daily.__freeDay = day; s.daily.__freeUsed = 0; }
    if (s.daily.__freeUsed >= FREE_PACKS) return false;
    s.daily.__freeUsed++;
    save(s);
    return true;
  }
  function countPacks(n) {
    const s = load();
    s.stats.packs += n;
    save(s);
  }
  // 계정에 따라다니는 표시 (포인트와 함께 저장·동기화된다)
  function getFlag(key) {
    return !!load().daily[key];
  }
  function setFlag(key) {
    const s = load();
    if (s.daily[key]) return;
    s.daily[key] = today();
    save(s);
  }
  // 베팅 정산처럼 보너스 없이 그대로 더할 때
  function add(game, amount, detail) {
    const s = load();
    amount = Math.round(amount);
    if (!(amount > 0)) return;
    push(s, game, detail || "", amount);
    save(s);
  }
  function spend(game, amount, detail) {
    const s = load();
    amount = Math.round(amount);
    if (!(amount > 0) || s.bal < amount) return false;
    push(s, game, detail || "", -amount);
    save(s);
    return true;
  }

  window.FSPoints = {
    earn,
    checkIn,
    rankBonus,
    bonusOnce,
    getFlag,
    setFlag,
    freePacksLeft,
    useFreePack,
    countPacks,
    stats: () => load().stats,
    add,
    spend,
    touch,
    balance: () => load().bal,
    history: () => load().log.slice().reverse(),
    gameName: (g) => GAMES[g] || g,
  };
})();
