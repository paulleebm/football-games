import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// 월드컵 모드 랭킹. 다른 게임 랭킹처럼 대회 시작 때 세션을 만들고, 기록은 세션을 지우는
// 같은 배치로 쓴다 (firestore.rules의 sessionConsumed가 검증). 기기마다 최고 기록 하나만 남는다.
//
// 순위: 도달 단계 > 넣은 골 > 덜 먹힌 골. 이 셋을 정수 하나(score)로 묶어서 정렬하고,
// score가 같으면 같은 순위로 본다.
//   stage: 1=32강 탈락 … 5=준우승, 6=우승 / gf, ga: 0~999

const GAME = "pkcup";
const BOARD = "allTime";

export const cupScore = ({ stage, gf, ga }) => stage * 1000000 + gf * 1000 + (999 - ga);

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
  const entryRef = () => doc(db, "pkCupLeaderboard", BOARD, "entries", deviceId());

  return {
    deviceId,
    async start() {
      try {
        await setDoc(sessionRef(), { startedAt: serverTimestamp() });
      } catch (e) {
        console.warn("pkcup session failed", e);
      }
    },
    // 결과: { ok: true } | { ok: false, best }
    async submit(nickname, rec) {
      const score = cupScore(rec);
      const prev = await getDoc(entryRef());
      if (prev.exists() && prev.data().score >= score) return { ok: false, best: prev.data() };
      const batch = writeBatch(db);
      batch.delete(sessionRef());
      batch.set(entryRef(), { nickname, stage: rec.stage, gf: rec.gf, ga: rec.ga, score, updatedAt: new Date() });
      await batch.commit();
      return { ok: true };
    },
    async top(n) {
      const snap = await getDocs(query(collection(db, "pkCupLeaderboard", BOARD, "entries"), orderBy("score", "desc"), limit(n)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}

// 같은 score면 같은 순위 (1, 2, 2, 4 …)
export function withRanks(rows) {
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1].score) rank = i + 1;
    return { ...r, rank };
  });
}
