import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// 온라인 대전. 서버 없이 Firestore만 쓴다.
// - 매칭: bobbleQueue에 대기 문서를 넣고, 가장 오래 기다린 다른 사람과 트랜잭션으로 짝짓는다.
//   짝을 만든 쪽이 방장(host, 물리 좌표상 home), 상대가 guest(away).
// - 턴: bobbleMatches/{id}/turns/{seq}에 양쪽이 수(화살표 + 아이템)를 올린다. 둘 다 오면 각자
//   같은 수로 화면을 재생하고, 방장이 계산한 다음 상태(result)로 둘 다 맞춘다.
//   (브라우저마다 소수점 계산이 미세하게 달라서 생기는 어긋남을 방장 기준으로 정리)

const STALE_MS = 60000;

// Firestore는 undefined 값을 못 받는다
const clean = (v) => JSON.parse(JSON.stringify(v));

export async function findMatch(db, { clubId, lineup }, { timeoutMs = 20000, onTick } = {}) {
  const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const myRef = doc(db, "bobbleQueue", sid);
  await setDoc(myRef, { ts: serverTimestamp(), joinedAt: Date.now(), clubId, lineup: clean(lineup), state: "wait", match: null, role: null });
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
    const m = (await getDoc(doc(db, "bobbleMatches", d.match))).data();
    const role = d.role;
    const oppRole = role === "host" ? "guest" : "host";
    deleteDoc(myRef).catch(() => {});
    finish({ matchId: d.match, role, opp: { clubId: m.clubs[oppRole], lineup: m.lineups[oppRole] } });
  });

  async function tryPair() {
    if (done) return;
    const snap = await getDocs(query(collection(db, "bobbleQueue"), orderBy("ts"), limit(20)));
    const now = Date.now();
    const other = snap.docs.find((d) => d.id !== sid && d.data().state === "wait" && now - (d.data().joinedAt || 0) < STALE_MS);
    if (!other) return;
    const matchRef = doc(collection(db, "bobbleMatches"));
    try {
      await runTransaction(db, async (tx) => {
        const a = await tx.get(myRef);
        const b = await tx.get(other.ref);
        if (!a.exists() || !b.exists() || a.data().state !== "wait" || b.data().state !== "wait") throw new Error("taken");
        tx.set(matchRef, {
          host: sid, guest: other.id, createdAt: serverTimestamp(), left: null,
          clubs: { host: a.data().clubId, guest: b.data().clubId },
          lineups: { host: a.data().lineup, guest: b.data().lineup },
        });
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
    // 시간 초과: 아직 대기 중일 때만 빠진다 (그 사이 잡혔으면 매칭 결과를 기다림)
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
    this.db = db;
    this.role = role;
    this.matchRef = doc(db, "bobbleMatches", matchId);
    this.unsubs = [];
    this.turnUnsub = null;
  }

  turnRef(seq) {
    return doc(this.matchRef, "turns", String(seq));
  }

  submit(seq, data) {
    return setDoc(this.turnRef(seq), { [this.role]: clean(data) }, { merge: true });
  }

  // 일반 아이템: 내 칸(hostItem / guestItem)에 기록, 상대 화면에서도 바로 적용된다
  useItem(seq, id, item) {
    return setDoc(this.turnRef(seq), { [`${this.role}Items`]: { [id]: clean(item) } }, { merge: true });
  }

  writeResult(seq, result) {
    return setDoc(this.turnRef(seq), { result: clean(result) }, { merge: true });
  }

  watchTurn(seq, cb) {
    if (this.turnUnsub) this.turnUnsub();
    this.turnUnsub = onSnapshot(this.turnRef(seq), (snap) => cb(snap.data() || {}));
  }

  // 공 리셋, VAR처럼 바로 적용되는 아이템은 턴마다 먼저 쓴 한 명만 인정
  async claimInstant(seq, instant) {
    try {
      return await runTransaction(this.db, async (tx) => {
        const ref = this.turnRef(seq);
        const cur = await tx.get(ref);
        if (cur.exists() && cur.data().instant) return false;
        tx.set(ref, { instant: clean({ ...instant, by: this.role }) }, { merge: true });
        return true;
      });
    } catch (_) {
      return false;
    }
  }

  sendEmote(e) {
    return addDoc(collection(this.matchRef, "emotes"), { by: this.role, e, ts: serverTimestamp() });
  }

  watchEmotes(cb) {
    let first = true;
    this.unsubs.push(onSnapshot(query(collection(this.matchRef, "emotes"), orderBy("ts")), (snap) => {
      if (first) {
        first = false;
        return;
      }
      for (const ch of snap.docChanges()) if (ch.type === "added") cb(ch.doc.data());
    }));
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
    if (this.turnUnsub) this.turnUnsub();
    this.turnUnsub = null;
  }
}

// ---------- 친구와 대전: 4자리 방 코드 ----------
// bobbleRooms/{code}에 방장이 대기 문서를 만들고 몇 초마다 alive를 갱신한다.
// 참가자가 트랜잭션으로 경기 문서를 만들며 방을 matched로 바꾼다 (먼저 들어온 한 명만).
const ROOM_BEAT_MS = 4000;
const ROOM_STALE_MS = 15000;
const randomCode = () => String(1000 + Math.floor(Math.random() * 9000));

export async function openRoom(db, { clubId, lineup }) {
  const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const c = randomCode();
    const ref = doc(db, "bobbleRooms", c);
    try {
      await runTransaction(db, async (tx) => {
        const cur = await tx.get(ref);
        if (cur.exists() && cur.data().state === "wait" && Date.now() - (cur.data().alive || 0) < ROOM_STALE_MS) throw new Error("busy");
        tx.set(ref, { host: sid, alive: Date.now(), clubId, lineup: clean(lineup), state: "wait", match: null });
      });
      code = c;
    } catch (_) {
      // 쓰는 중인 번호면 다른 번호로
    }
  }
  if (!code) throw new Error("no free room code");
  const roomRef = doc(db, "bobbleRooms", code);

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
    const m = (await getDoc(doc(db, "bobbleMatches", d.match))).data();
    // 방은 matched로 남겨둔다: 뒤늦게 같은 코드로 들어오면 "이미 시작" 알림 (번호는 새 방이 덮어쓴다)
    finish({ matchId: d.match, role: "host", opp: { clubId: m.clubs.guest, lineup: m.lineups.guest } });
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
export async function joinRoom(db, code, { clubId, lineup }) {
  const sid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const roomRef = doc(db, "bobbleRooms", code);
  const matchRef = doc(collection(db, "bobbleMatches"));
  try {
    const room = await runTransaction(db, async (tx) => {
      const cur = await tx.get(roomRef);
      if (!cur.exists()) throw new Error("none");
      const r = cur.data();
      if (r.state !== "wait") throw new Error("started");
      if (Date.now() - (r.alive || 0) > ROOM_STALE_MS) throw new Error("none");
      tx.set(matchRef, {
        host: r.host, guest: sid, createdAt: serverTimestamp(), left: null,
        clubs: { host: r.clubId, guest: clubId },
        lineups: { host: r.lineup, guest: clean(lineup) },
      });
      tx.update(roomRef, { state: "matched", match: matchRef.id });
      return r;
    });
    return { ok: true, online: { matchId: matchRef.id, role: "guest", opp: { clubId: room.clubId, lineup: room.lineup } } };
  } catch (e) {
    return { ok: false, reason: e.message === "started" ? "started" : "none" };
  }
}
