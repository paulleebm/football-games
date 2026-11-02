import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// 헤딩 연습 랭킹: 한 판(60초)에 배달한 공 개수. 다른 게임 랭킹처럼 판 시작 때 세션을 만들고,
// 기록은 세션을 지우는 같은 배치로 쓴다 (firestore.rules의 sessionConsumed가 검증).
// 기기마다 최고 기록 하나만 남는다.

const GAME = "heading";
const BOARD = "allTime";

function deviceId() {
  let id = null;
  try {
    id = localStorage.getItem("quizDeviceId");
    if (!id) {
      id = "d-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("quizDeviceId", id);
    }
  } catch (_) {
    id = "d-anon";
  }
  return id;
}

export function createRank(db) {
  const sessionRef = () => doc(db, "playSessions", `${GAME}_${deviceId()}`);
  const entryRef = () => doc(db, "headingLeaderboard", BOARD, "entries", deviceId());

  return {
    deviceId,
    async start() {
      try {
        await setDoc(sessionRef(), { startedAt: serverTimestamp() });
      } catch (e) {
        console.warn("heading session failed", e);
      }
    },
    async mine() {
      const snap = await getDoc(entryRef());
      return snap.exists() ? snap.data() : null;
    },
    // 결과: { ok: true } | { ok: false, best }
    async submit(nickname, delivered) {
      const prev = await getDoc(entryRef());
      if (prev.exists() && prev.data().delivered >= delivered) return { ok: false, best: prev.data() };
      const batch = writeBatch(db);
      batch.delete(sessionRef());
      batch.set(entryRef(), { nickname, delivered, updatedAt: new Date() });
      await batch.commit();
      return { ok: true };
    },
    async top(n) {
      const snap = await getDocs(query(collection(db, "headingLeaderboard", BOARD, "entries"), orderBy("delivered", "desc"), limit(n)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}

// 같은 개수면 같은 순위 (1, 2, 2, 4 …)
export function withRanks(rows) {
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.delivered !== rows[i - 1].delivered) rank = i + 1;
    return { ...r, rank };
  });
}
