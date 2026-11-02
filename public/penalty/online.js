import {
  collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// 승부차기 온라인 대전. 알까기 축구(football/online.js)와 같은 방식으로 Firestore만 쓴다.
// - 매칭: pkQueue 대기 문서 → 트랜잭션으로 짝짓기. 짝을 만든 쪽이 host(= home).
// - 킥: pkMatches/{id}/kicks/{seq}에 양쪽이 자기 입력(키커 or 키퍼)을 올린다.
//   판정은 정수 입력으로 하는 순수 함수라 둘 다 같은 결과가 나와서 방장 결과를 따로 안 쓴다.

const STALE_MS = 60000;
const newSid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function findMatch(db, { timeoutMs = 20000, onTick } = {}) {
  const sid = newSid();
  const myRef = doc(db, "pkQueue", sid);
  await setDoc(myRef, { ts: serverTimestamp(), joinedAt: Date.now(), state: "wait", match: null, role: null });
  let done = false;
  let resolveFn;
  const result = new Promise((r) => {
    resolveFn = r;
  });
  const finish = (v) => {
    if (done) return;
    done = true;
    clearInterval(pairTimer);
    clearInterval(tickTimer);
    unsub();
    resolveFn(v);
  };

  const unsub = onSnapshot(myRef, async (snap) => {
    const d = snap.data();
    if (!d || d.state !== "matched" || done) return;
    deleteDoc(myRef).catch(() => {});
    finish({ matchId: d.match, role: d.role });
  });

  async function tryPair() {
    if (done) return;
    const snap = await getDocs(query(collection(db, "pkQueue"), orderBy("ts"), limit(20)));
    const now = Date.now();
    const other = snap.docs.find((d) => d.id !== sid && d.data().state === "wait" && now - (d.data().joinedAt || 0) < STALE_MS);
    if (!other) return;
    const matchRef = doc(collection(db, "pkMatches"));
    try {
      await runTransaction(db, async (tx) => {
        const a = await tx.get(myRef);
        const b = await tx.get(other.ref);
        if (!a.exists() || !b.exists() || a.data().state !== "wait" || b.data().state !== "wait") throw new Error("taken");
        tx.set(matchRef, { host: sid, guest: other.id, createdAt: serverTimestamp(), left: null });
        tx.update(myRef, { state: "matched", match: matchRef.id, role: "host" });
        tx.update(other.ref, { state: "matched", match: matchRef.id, role: "guest" });
      });
    } catch (_) {
      // 다른 사람이 먼저 데려갔으면 다음 시도
    }
  }

  const started = Date.now();
  const pairTimer = setInterval(() => tryPair().catch(() => {}), 1500);
  tryPair().catch(() => {});
  const tickTimer = setInterval(async () => {
    const left = Math.max(0, timeoutMs - (Date.now() - started));
    if (onTick) onTick(left);
    if (left > 0 || done) return;
    clearInterval(tickTimer);
    try {
      const stillWaiting = await runTransaction(db, async (tx) => {
        const a = await tx.get(myRef);
        if (a.exists() && a.data().state === "wait") {
          tx.delete(myRef);
          return true;
        }
        return false;
      });
      if (stillWaiting) finish(null);
    } catch (_) {
      finish(null);
    }
  }, 250);

  return {
    result,
    async cancel() {
      if (done) return;
      try {
        await runTransaction(db, async (tx) => {
          const a = await tx.get(myRef);
          if (a.exists() && a.data().state === "wait") tx.delete(myRef);
        });
      } catch (_) {
        // 무시
      }
      finish(null);
    },
  };
}

export class MatchChannel {
  constructor(db, matchId, role) {
    this.role = role;
    this.matchRef = doc(db, "pkMatches", matchId);
    this.unsubs = [];
    this.kickUnsub = null;
  }

  submit(seq, data) {
    return setDoc(doc(this.matchRef, "kicks", String(seq)), { [this.role]: data }, { merge: true });
  }

  watchKick(seq, cb) {
    if (this.kickUnsub) this.kickUnsub();
    this.kickUnsub = onSnapshot(doc(this.matchRef, "kicks", String(seq)), (snap) => cb(snap.data() || {}));
  }

  watchMatch(cb) {
    this.unsubs.push(onSnapshot(this.matchRef, (snap) => cb(snap.data() || {})));
  }

  leave() {
    return updateDoc(this.matchRef, { left: this.role }).catch(() => {});
  }

  close() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.kickUnsub) this.kickUnsub();
    this.kickUnsub = null;
  }
}

// ---------- 친구와 대전: 4자리 방 코드 ----------
const ROOM_BEAT_MS = 4000;
const ROOM_STALE_MS = 15000;
const randomCode = () => String(1000 + Math.floor(Math.random() * 9000));

export async function openRoom(db) {
  const sid = newSid();
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const c = randomCode();
    const ref = doc(db, "pkRooms", c);
    try {
      await runTransaction(db, async (tx) => {
        const cur = await tx.get(ref);
        if (cur.exists() && cur.data().state === "wait" && Date.now() - (cur.data().alive || 0) < ROOM_STALE_MS) throw new Error("busy");
        tx.set(ref, { host: sid, alive: Date.now(), state: "wait", match: null });
      });
      code = c;
    } catch (_) {
      // 쓰는 중인 번호면 다른 번호로
    }
  }
  if (!code) throw new Error("no free room code");
  const roomRef = doc(db, "pkRooms", code);

  let done = false;
  let resolveFn;
  const result = new Promise((r) => {
    resolveFn = r;
  });
  const beat = setInterval(() => updateDoc(roomRef, { alive: Date.now() }).catch(() => {}), ROOM_BEAT_MS);
  const onHide = () => deleteDoc(roomRef).catch(() => {});
  window.addEventListener("pagehide", onHide);
  const finish = (v) => {
    if (done) return;
    done = true;
    clearInterval(beat);
    window.removeEventListener("pagehide", onHide);
    unsub();
    resolveFn(v);
  };
  const unsub = onSnapshot(roomRef, async (snap) => {
    const d = snap.data();
    if (!d || d.state !== "matched" || d.host !== sid || done) return;
    finish({ matchId: d.match, role: "host" });
  });

  return {
    code,
    result,
    async cancel() {
      if (done) return;
      try {
        await runTransaction(db, async (tx) => {
          const a = await tx.get(roomRef);
          if (a.exists() && a.data().state === "wait" && a.data().host === sid) tx.delete(roomRef);
        });
      } catch (_) {
        // 무시
      }
      finish(null);
    },
  };
}

// 결과: { ok: true, online } | { ok: false, reason: "none" | "started" }
export async function joinRoom(db, code) {
  const sid = newSid();
  const roomRef = doc(db, "pkRooms", code);
  const matchRef = doc(collection(db, "pkMatches"));
  try {
    await runTransaction(db, async (tx) => {
      const cur = await tx.get(roomRef);
      if (!cur.exists()) throw new Error("none");
      const r = cur.data();
      if (r.state !== "wait") throw new Error("started");
      if (Date.now() - (r.alive || 0) > ROOM_STALE_MS) throw new Error("none");
      tx.set(matchRef, { host: r.host, guest: sid, createdAt: serverTimestamp(), left: null });
      tx.update(roomRef, { state: "matched", match: matchRef.id });
    });
    return { ok: true, online: { matchId: matchRef.id, role: "guest" } };
  } catch (e) {
    return { ok: false, reason: e.message === "started" ? "started" : "none" };
  }
}
