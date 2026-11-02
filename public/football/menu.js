import { CLUBS, clubById, logoUrl } from "./clubs.js";
import { SQUADS, STAT_LABELS, playerById, validLineup } from "./players.js";
import { FORMATIONS, GK_SPOT, FIELD, sidesForShooting } from "./physics.js";
import { portraitUrl } from "./render.js";
import { sfx, unlockAudio } from "./audio.js";

// 시작 화면: 엠블럼 한 줄 → 포메이션 → 경기장 위 내 선수 얼굴 → 선수 카드 → 모드.
// 설명 문구 없이 그림과 숫자만 둔다. 고른 내용은 클럽별로 저장된다.

const PREF_KEY = "bobblePrefsV2";
const STAT_ORDER = ["sav", "spd", "sht", "phy"];
const STAT_ICON = { sav: "🧤", spd: "⚡", sht: "💥", phy: "💪" };
const FIELD_KEYS = ["a", "b", "c"];
const SLOT_KEYS = ["gk", ...FIELD_KEYS];

const $ = (id) => document.getElementById(id);

let prefs = { my: "ars", level: "normal", mode: "cpu", online: "random", lineups: {} };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") };
} catch (_) {
  // 저장된 설정이 없거나 읽을 수 없으면 기본값
}
if (!clubById(prefs.my)) prefs.my = "ars";
let activeSlot = "a";

function save() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch (_) {
    // 저장 실패는 무시
  }
}

export function getSelection() {
  return { clubId: prefs.my, lineup: lineup(), level: prefs.level, mode: prefs.mode, online: prefs.online };
}

function lineup() {
  return validLineup(prefs.my, prefs.lineups[prefs.my]);
}

function setLineup(lu) {
  prefs.lineups[prefs.my] = lu;
  save();
}

function renderClubs() {
  $("myClubs").innerHTML = CLUBS.map((c) => `<button type="button" class="emblem ${c.id === prefs.my ? "on" : ""}" data-id="${c.id}" aria-label="${c.name}">
    <img src="${logoUrl(c)}" alt=""></button>`).join("");
}

// 포메이션 버튼: 글자 대신 점 배치 그림 (위가 상대 골대 쪽)
function formationIcon(f) {
  const pts = [GK_SPOT, ...FIELD_KEYS.map((k) => f.slots[k].pos)];
  const dots = pts.map(([x, y]) => `<circle cx="${(24 + y * 1.5).toFixed(1)}" cy="${(3 + x * 1.6).toFixed(1)}" r="3.2"/>`).join("");
  return `<svg viewBox="0 0 48 32" aria-hidden="true">${dots}</svg>`;
}

function renderFormations(lu) {
  $("formations").innerHTML = Object.entries(FORMATIONS).map(([id, f]) => `<button type="button" class="${id === lu.formation ? "on" : ""}" data-f="${id}" aria-label="${f.name}">
    ${formationIcon(f)}</button>`).join("");
}

function face(kit, p, cls = "") {
  return `<span class="face ${cls}" style="border-color:${kit.body}"><img src="${portraitUrl(kit, p)}" alt=""><i style="background:${kit.body}; color:${kit.number || kit.trim}">${p.num}</i></span>`;
}

// 경기장 전체. 내 팀은 왼쪽 진영(오른쪽으로 공격), 경기 화면 가로 모드와 같은 방향.
function renderPitch(lu) {
  const kit = clubById(prefs.my).home;
  const W = (FIELD.halfL + FIELD.goalDepth) * 2;
  const H = FIELD.halfW * 2 + 2;
  const at = ([x, y]) => `left:${((-x + W / 2) / W) * 100}%; top:${((y + H / 2) / H) * 100}%`;
  const tokens = SLOT_KEYS.map((key) => {
    const p = playerById(prefs.my, lu[key]);
    const pos = key === "gk" ? GK_SPOT : FORMATIONS[lu.formation].slots[key].pos;
    return `<button type="button" class="token ${key === activeSlot ? "sel" : ""}" data-slot="${key}" style="${at(pos)}">${face(kit, p)}</button>`;
  }).join("");
  $("pitch").innerHTML = `<div class="pitch-field"><i class="half"></i><i class="circle"></i><i class="arc l"></i><i class="arc r"></i><i class="goal l"></i><i class="goal r"></i></div>${tokens}`;
}

// 경기 때 받침 원판 모양 (슈팅이 약할수록 각짐)
function shapeIcon(p, color) {
  const n = p.stats.sides ?? sidesForShooting(p.stats.sht);
  if (!n) return `<svg class="shape" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/></svg>`;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    return `${(10 + Math.cos(a) * 9).toFixed(1)},${(10.8 + Math.sin(a) * 9).toFixed(1)}`;
  }).join(" ");
  return `<svg class="shape" viewBox="0 0 20 20" aria-hidden="true"><polygon points="${pts}" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

function renderRoster(lu) {
  const kit = clubById(prefs.my).home;
  const picked = new Set(SLOT_KEYS.map((k) => lu[k]));
  $("roster").innerHTML = SQUADS[prefs.my].players.map((p) => {
    const stats = STAT_ORDER.filter((k) => p.stats[k] != null).map((k) => `<div class="stat stat-${k}" title="${STAT_LABELS[k]}">
      <span>${STAT_ICON[k]}</span><div class="bar"><i style="width:${p.stats[k] * 10}%"></i></div><b>${p.stats[k]}</b></div>`).join("");
    return `<button type="button" class="pcard ${picked.has(p.id) ? "picked" : ""}" data-pid="${p.id}">
      <div class="pcard-head">${face(kit, p, "small")}<b>${p.name}</b>${shapeIcon(p, kit.body)}</div>
      <div class="stats">${stats}</div></button>`;
  }).join("");
}

function renderModes() {
  for (const b of $("modes").querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === prefs.mode);
  for (const b of $("levels").querySelectorAll("button")) b.classList.toggle("on", b.dataset.level === prefs.level);
  for (const b of $("onlineKinds").querySelectorAll("button")) b.classList.toggle("on", b.dataset.online === prefs.online);
  $("levels").hidden = prefs.mode !== "cpu";
  $("onlineKinds").hidden = prefs.mode !== "online";
}

export function renderMenu() {
  const lu = lineup();
  renderClubs();
  renderFormations(lu);
  renderPitch(lu);
  renderRoster(lu);
  renderModes();
}

function click() {
  unlockAudio();
  sfx.click();
}

export function initMenu({ onStart, onChange }) {
  const changed = () => {
    renderMenu();
    if (onChange) onChange();
  };

  $("myClubs").addEventListener("click", (e) => {
    const btn = e.target.closest(".emblem");
    if (!btn) return;
    click();
    prefs.my = btn.dataset.id;
    activeSlot = "a";
    save();
    changed();
  });

  $("formations").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    click();
    setLineup({ ...lineup(), formation: btn.dataset.f });
    changed();
  });

  $("pitch").addEventListener("click", (e) => {
    const btn = e.target.closest(".token");
    if (!btn) return;
    click();
    activeSlot = btn.dataset.slot;
    renderMenu();
  });

  $("roster").addEventListener("click", (e) => {
    const card = e.target.closest(".pcard");
    if (!card) return;
    const p = playerById(prefs.my, card.dataset.pid);
    click();
    const lu = { ...lineup() };
    // 이미 뛰고 있는 선수면 서로 자리를 맞바꾼다 (골키퍼 자리 포함, 누구든 어느 자리든)
    const from = SLOT_KEYS.find((k) => lu[k] === p.id);
    if (from) lu[from] = lu[activeSlot];
    lu[activeSlot] = p.id;
    setLineup(lu);
    activeSlot = SLOT_KEYS[(SLOT_KEYS.indexOf(activeSlot) + 1) % SLOT_KEYS.length];
    changed();
  });

  $("modes").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    click();
    prefs.mode = btn.dataset.mode;
    save();
    renderModes();
  });

  $("levels").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    click();
    prefs.level = btn.dataset.level;
    save();
    renderModes();
  });

  $("onlineKinds").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    click();
    prefs.online = btn.dataset.online;
    save();
    renderModes();
  });

  $("startBtn").addEventListener("click", () => {
    click();
    onStart(getSelection());
  });

  renderMenu();
}
