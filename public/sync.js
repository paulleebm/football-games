// 포인트·카드 수집 데이터를 계정(users/{uid})에 저장한다.
// 처음엔 익명 로그인, 구글을 연결하면 다른 기기에서도 같은 계정으로 이어진다.
// 게임 페이지들은 localStorage만 바꾸고 rev를 올린다 (points.js의 touch).
// 이 모듈을 불러오는 페이지(메인, 카드)가 서버와 맞춘다: rev가 큰 쪽이 이긴다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, linkWithPopup,
  signInWithCredential, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const KEYS = ["fs-points-v1", "packs-collection-v1", "bjProfit"];
const META = "fs-sync-meta";

const app = initializeApp({
  projectId: "guess-your-player",
  appId: "1:1068776442781:web:433981863e0c3da178bd74",
  storageBucket: "guess-your-player.firebasestorage.app",
  apiKey: "AIzaSyA8SG_LbHeqS9gh0CLFaHUhEI1uG1uYLDY",
  authDomain: "guess-your-player.firebaseapp.com",
  messagingSenderId: "1068776442781",
}, "sync");
const auth = getAuth(app);
const db = getFirestore(app);

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META)) || { uid: null, rev: 0 }; } catch (_) { return { uid: null, rev: 0 }; }
}
function writeMeta(m) {
  try { localStorage.setItem(META, JSON.stringify(m)); } catch (_) {}
}
function localData() {
  const data = {};
  KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v != null) data[k] = v; });
  return data;
}
function applyData(data) {
  KEYS.forEach((k) => {
    try {
      if (data && data[k] != null) localStorage.setItem(k, data[k]);
      else localStorage.removeItem(k);
    } catch (_) {}
  });
}
const emit = () => window.dispatchEvent(new Event("fs-sync"));
// 계정이 바뀐 뒤 서버와 맞출 때까지 기다린다 (실패해도 5초 뒤엔 넘어간다)
const nextSync = () => new Promise((r) => {
  window.addEventListener("fs-sync", r, { once: true });
  setTimeout(r, 5000);
});

let user = null;
let uploadTimer = null;
let uploading = Promise.resolve();

// 로그 페이지에서 보는 계정 요약 (accountStats/{uid}). 내역 전체는 본인만 읽을 수 있어서 따로 둔다.
async function writeStats() {
  if (!user) return;
  let st = {}, bal = 0;
  try {
    const p = JSON.parse(localStorage.getItem("fs-points-v1") || "null") || {};
    bal = p.bal || 0;
    st = p.stats || {};
  } catch (_) {}
  let cards = 0;
  try { cards = Object.keys(JSON.parse(localStorage.getItem("packs-collection-v1") || "{}") || {}).length; } catch (_) {}
  await setDoc(doc(db, "accountStats", user.uid), {
    linked: !user.isAnonymous,
    bal: Math.round(bal),
    earned: Math.round(st.earned || 0),
    spent: Math.round(st.spent || 0),
    packs: st.packs || 0,
    cards,
    lastSeen: serverTimestamp(),
  }).catch((e) => console.warn("stats upload failed", e));
}

// 구글 계정이면 이메일을 따로 둔다 (관리자만 읽을 수 있음): 로그 페이지에서 지급할 계정을 고를 때 쓴다
function writeEmail() {
  if (!user || user.isAnonymous) return;
  const email = user.email || (user.providerData[0] && user.providerData[0].email) || "";
  if (!email) return;
  setDoc(doc(db, "accountEmails", user.uid), { email, name: (user.displayName || "").slice(0, 60) })
    .catch((e) => console.warn("email upload failed", e));
}

// 관리자가 로그 페이지에서 보낸 포인트를 받는다 (한 번만)
async function claimGrants() {
  if (!user || !window.FSPoints) return;
  let snap;
  try {
    snap = await getDocs(query(collection(db, "grants"), where("uid", "==", user.uid), where("claimed", "==", false)));
  } catch (e) {
    console.warn("grant check failed", e);
    return;
  }
  for (const g of snap.docs) {
    try {
      const ok = await runTransaction(db, async (tx) => {
        const cur = await tx.get(g.ref);
        if (!cur.exists() || cur.data().claimed) return false;
        tx.update(g.ref, { claimed: true, claimedAt: serverTimestamp() });
        return true;
      });
      const d = g.data();
      if (ok && d.amount > 0) window.FSPoints.add("admin", d.amount, d.note || "");
    } catch (e) {
      console.warn("grant claim failed", e);
    }
  }
  emit();
}

async function upload() {
  if (!user) return;
  const m = readMeta();
  if (m.uid !== user.uid) return;
  const rev = m.rev;
  uploading = setDoc(doc(db, "users", user.uid), { data: localData(), rev, updatedAt: serverTimestamp() })
    .catch((e) => console.warn("sync upload failed", e));
  await uploading;
  writeStats();
}
function scheduleUpload() {
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(upload, 800);
}

// 이미 쓰던 구글 계정으로 옮겨갈 때: 포인트(내역·블랙잭 순이익 포함)는 잔액이 더 큰 쪽을 남기고,
// 카드는 양쪽을 합친다 (같은 카드는 많은 쪽 장수)
const GOOGLE_BONUS_KEY = "__google";
const GOOGLE_BONUS = 500;
// 구글이 연결된 계정이면 (이미 연결돼 있던 계정 포함) 한 번 보너스
function grantGoogleBonus() {
  if (user && !user.isAnonymous) window.FSPoints?.bonusOnce(GOOGLE_BONUS_KEY, "google", GOOGLE_BONUS, "연결 보너스");
}
const balOf = (data) => {
  try { return JSON.parse(data && data["fs-points-v1"]).bal || 0; } catch (_) { return 0; }
};
function mergeData(mine, theirs) {
  const keep = balOf(mine) > balOf(theirs) ? mine : theirs;
  const out = {};
  ["fs-points-v1", "bjProfit"].forEach((k) => { if (keep[k] != null) out[k] = keep[k]; });
  // 구글 연결 보너스는 계정당 한 번: 어느 쪽이든 받았으면 받은 걸로 남긴다
  if (out["fs-points-v1"] && [mine, theirs].some((d) => { try { return JSON.parse(d["fs-points-v1"]).daily[GOOGLE_BONUS_KEY]; } catch (_) { return false; } })) {
    const p = JSON.parse(out["fs-points-v1"]);
    p.daily = p.daily || {};
    p.daily[GOOGLE_BONUS_KEY] = p.daily[GOOGLE_BONUS_KEY] || "merged";
    out["fs-points-v1"] = JSON.stringify(p);
  }
  let a = {}, b = {};
  try { a = JSON.parse(mine["packs-collection-v1"] || "{}") || {}; } catch (_) {}
  try { b = JSON.parse(theirs["packs-collection-v1"] || "{}") || {}; } catch (_) {}
  const cards = { ...b };
  Object.keys(a).forEach((id) => { cards[id] = Math.max(cards[id] || 0, a[id] || 0); });
  if (Object.keys(cards).length) out["packs-collection-v1"] = JSON.stringify(cards);
  return out;
}
let pendingMerge = null;

async function reconcile(u) {
  const m = readMeta();
  const snap = await getDoc(doc(db, "users", u.uid));
  const server = snap.exists() ? snap.data() : null;
  if (pendingMerge) {
    const mine = pendingMerge;
    pendingMerge = null;
    applyData(server ? mergeData(mine, server.data || {}) : mine);
    writeMeta({ uid: u.uid, rev: (server ? server.rev || 0 : 0) + 1 });
    await upload();
  } else if (!server) {
    // 처음 로그인한 계정: 이 기기 데이터를 그대로 올린다 (다른 계정 데이터면 비우고 시작)
    if (m.uid && m.uid !== u.uid) applyData(null);
    writeMeta({ uid: u.uid, rev: m.uid === u.uid ? m.rev : 0 });
    await upload();
  } else if (m.uid === u.uid && m.rev > (server.rev || 0)) {
    await upload();
  } else if (m.uid !== u.uid || (server.rev || 0) > m.rev) {
    applyData(server.data);
    writeMeta({ uid: u.uid, rev: server.rev || 0 });
  }
  emit();
}

let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    signInAnonymously(auth).catch((e) => { console.warn("anonymous sign-in failed", e); readyResolve(); });
    return;
  }
  user = u;
  try { await reconcile(u); grantGoogleBonus(); writeStats(); writeEmail(); await claimGrants(); } catch (e) { console.warn("sync failed", e); }
  readyResolve();
  emit();
});

window.FSSync = {
  ready,
  touched: scheduleUpload,
  account: () => (!user ? { signedIn: false, linked: false } : !user.isAnonymous
    ? { signedIn: true, linked: true, email: user.email || (user.providerData[0] && user.providerData[0].email) || "", name: user.displayName || "" }
    : { signedIn: true, linked: false }),
  async linkGoogle() {
    if (!user) return false;
    const provider = new GoogleAuthProvider();
    try {
      await linkWithPopup(user, provider);
      user = auth.currentUser;
      grantGoogleBonus();
      writeStats();
      writeEmail();
      emit();
      return true;
    } catch (e) {
      if (e.code === "auth/credential-already-in-use") {
        // 이미 다른 기기에서 쓰던 구글 계정: 그 계정 데이터로 바꾼다
        const cred = GoogleAuthProvider.credentialFromError(e);
        const myBal = balOf(localData());
        if (!cred || !confirm(`이미 사용 중인 구글 계정이에요.
이 기기(${myBal.toLocaleString()}P)와 구글 계정 중 포인트가 더 많은 쪽으로 합쳐지고, 적은 쪽 포인트와 내역은 사라져요.
카드는 양쪽 모두 남아요.`)) return false;
        clearTimeout(uploadTimer);
        await upload();
        pendingMerge = localData();
        const done = nextSync();
        try {
          await signInWithCredential(auth, cred);
        } catch (err) {
          pendingMerge = null;
          console.warn("google sign-in failed", err);
          return false;
        }
        await done;
        return true;
      }
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") console.warn("google link failed", e);
      return false;
    }
  },
  async signOut() {
    clearTimeout(uploadTimer);
    await upload();
    applyData(null);
    writeMeta({ uid: null, rev: 0 });
    user = null;
    const done = nextSync();
    await signOut(auth);
    await done;
  },
};
window.addEventListener("pagehide", () => { if (uploadTimer) { clearTimeout(uploadTimer); upload(); } });
