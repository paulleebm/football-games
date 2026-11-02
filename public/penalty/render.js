import { GOAL_W2, GOAL_H, BALL, ZONES } from "./logic.js";
import { pickAds, loadAdFont } from "../ads.js";

// 옛날 플래시 게임 느낌의 2D 캔버스. 사람·공 모두 그림 몇 장을 끊어서 돌리는 스톱모션이라
// 시간은 늘 FPS 단위로 잘라서 쓰고, 선은 프레임마다 살짝 떨리게(boil) 그린다.
// 논리 해상도 800x600을 화면 크기에 맞춰 늘린다.

export const W = 800;
export const H = 600;
const OUT = "#111";
const FONT = "'Jua', 'Malgun Gothic', sans-serif";

// 골대 평면(미터) → 화면
const GX = 400;
const LINE_Y = 300;
const PX = 72.4;
const PY = 91;
export const toScreen = (x, y) => [GX + x * PX, LINE_Y - y * PY];
export const fromScreen = (sx, sy) => [(sx - GX) / PX, (LINE_Y - sy) / PY];
export const PX_PER_M = { x: PX, y: PY };
export const SPOT = [368, 470];
export const KEEPER_ROOT = [GX, LINE_Y];
const KEEPER_SCALE = 0.45;
export const KEEPER_CHEST = [GX, LINE_Y - 235 * KEEPER_SCALE];

// 애니메이션 타이밍 (초). app.js도 효과음 때문에 같은 값을 쓴다.
export const KICK_T = 0.9;
export const flightTime = (res) => (res.outcome === "fall" ? 0.4 : 0.42 + (1 - res.s) * 0.5);
export const arriveTime = (res) => KICK_T + flightTime(res);
export const playLength = (res) => arriveTime(res) + 2.3;

const step = (t, fps) => Math.floor(t * fps) / fps;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (u) => Math.max(0, Math.min(1, u));

// 같은 입력이면 같은 값 (프레임별 선 떨림용)
function hash(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- 포즈 ----------
// 발 사이(루트) 기준 좌표, 위가 -y. 키 약 380.
const J = ["h", "n", "sl", "sr", "el", "er", "hl", "hr", "pl", "pr", "kl", "kr", "fl", "fr"];
function P(arr) {
  const o = {};
  J.forEach((k, i) => (o[k] = arr[i]));
  return o;
}

// 키커 (등 쪽에서 본 모습)
const K = {
  idle1: P([[0, -345], [0, -315], [-50, -298], [50, -298], [-64, -228], [64, -228], [-60, -165], [62, -165], [-27, -178], [27, -178], [-32, -92], [34, -92], [-38, -6], [40, -6]]),
  idle2: P([[3, -342], [2, -312], [-49, -296], [51, -296], [-66, -226], [62, -226], [-64, -164], [58, -162], [-27, -177], [27, -177], [-33, -92], [33, -92], [-38, -6], [40, -6]]),
  run1: P([[6, -340], [5, -312], [-44, -296], [54, -292], [-70, -240], [70, -220], [-52, -190], [84, -170], [-24, -176], [30, -174], [-28, -112], [44, -86], [-24, -62], [48, -4]]),
  run2: P([[-4, -342], [-3, -313], [-54, -294], [46, -296], [-72, -220], [66, -240], [-86, -172], [50, -190], [-28, -175], [26, -176], [-36, -88], [36, -112], [-42, -4], [30, -58]]),
  run3: P([[8, -338], [6, -310], [-42, -294], [56, -290], [-68, -236], [74, -224], [-48, -186], [88, -176], [-22, -175], [32, -173], [-26, -108], [46, -88], [-20, -58], [50, -6]]),
  kick: P([[-14, -340], [-12, -312], [-62, -290], [40, -300], [-112, -262], [80, -250], [-140, -226], [104, -222], [-28, -176], [26, -180], [-38, -90], [58, -140], [-42, -4], [88, -152]]),
  cheer1: P([[0, -345], [0, -315], [-50, -300], [50, -300], [-80, -368], [80, -368], [-94, -438], [94, -438], [-27, -178], [27, -178], [-32, -92], [34, -92], [-38, -6], [40, -6]]),
  cheer2: P([[0, -365], [0, -335], [-50, -320], [50, -320], [-92, -380], [70, -390], [-118, -440], [76, -462], [-27, -198], [27, -198], [-44, -124], [44, -124], [-30, -60], [30, -60]]),
  sad1: P([[0, -336], [0, -308], [-50, -292], [50, -292], [-80, -336], [80, -336], [-24, -368], [24, -368], [-27, -176], [27, -176], [-32, -92], [34, -92], [-38, -6], [40, -6]]),
  sad2: P([[0, -282], [0, -254], [-50, -238], [50, -238], [-80, -280], [80, -280], [-24, -312], [24, -312], [-27, -122], [27, -122], [-36, -40], [36, -40], [-44, 18], [44, 18]]),
  slip: P([[-20, -330], [-18, -300], [-66, -282], [30, -290], [-110, -320], [80, -320], [-122, -372], [96, -370], [-24, -170], [28, -172], [-30, -90], [60, -212], [-34, -10], [82, -282]]),
};

// 골키퍼 (정면)
const GK = {
  ready1: P([[0, -318], [0, -290], [-52, -272], [52, -272], [-92, -230], [92, -230], [-110, -180], [108, -180], [-30, -160], [30, -160], [-58, -86], [58, -86], [-56, 0], [56, 0]]),
  ready2: P([[10, -314], [8, -287], [-44, -270], [60, -270], [-84, -226], [100, -228], [-100, -190], [118, -172], [-22, -158], [38, -158], [-50, -84], [66, -84], [-56, 0], [56, 0]]),
  stretch: P([[0, -350], [0, -322], [-36, -310], [36, -310], [-34, -390], [34, -390], [-26, -462], [26, -462], [-22, -170], [22, -170], [-26, -88], [30, -92], [-28, 0], [40, -10]]),
  catch: P([[0, -320], [0, -292], [-50, -276], [50, -276], [-62, -228], [62, -228], [-16, -246], [16, -246], [-30, -160], [30, -160], [-50, -86], [50, -86], [-50, 0], [50, 0]]),
  oops: P([[0, -326], [0, -298], [-50, -282], [50, -282], [-82, -326], [82, -326], [-26, -360], [26, -360], [-28, -168], [28, -168], [-34, -88], [34, -88], [-40, 0], [40, 0]]),
  cheer1: P([[0, -345], [0, -315], [-50, -300], [50, -300], [-84, -366], [84, -366], [-98, -436], [98, -436], [-27, -178], [27, -178], [-40, -92], [40, -92], [-48, 0], [48, 0]]),
  cheer2: P([[0, -370], [0, -340], [-50, -325], [50, -325], [-90, -400], [90, -380], [-100, -470], [120, -440], [-27, -203], [27, -203], [-50, -130], [50, -130], [-36, -60], [36, -60]]),
};

function rotatePose(pose, ang, cx = 0, cy = 0) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const o = {};
  for (const k of J) {
    const [x, y] = pose[k];
    const dx = x - cx;
    const dy = y - cy;
    o[k] = [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  return o;
}

function shiftPose(pose, dx, dy) {
  const o = {};
  for (const k of J) o[k] = [pose[k][0] + dx, pose[k][1] + dy];
  return o;
}

function boil(pose, seed, amt) {
  const o = {};
  J.forEach((k, i) => {
    o[k] = [pose[k][0] + (hash(seed * 31 + i * 7) - 0.5) * amt, pose[k][1] + (hash(seed * 17 + i * 13) - 0.5) * amt];
  });
  return o;
}

// ---------- 그리기 도구 ----------
function poly(ctx, pts, fill, lw = 3) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

function line(ctx, pts, w, color, ow) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (ow) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = w + ow * 2;
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function circle(ctx, x, y, r, fill, lw = 3) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUT;
    ctx.stroke();
  }
}

const mix = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 170;
}

// 사람 한 명. look: { player, kit: {shirt, stripes, band, sleeves, shorts, socks, number, gloves}, front, face }
function drawPerson(ctx, pose, look, ow) {
  const { player, kit } = look;
  const skin = player.skin;
  const legW = 28;
  const armW = 22;
  const spineMid = mix(pose.pl, pose.pr, 0.5);
  const up = [pose.n[0] - spineMid[0], pose.n[1] - spineMid[1]];
  const upLen = Math.hypot(up[0], up[1]) || 1;
  const side = [pose.pr[0] - pose.pl[0], pose.pr[1] - pose.pl[1]];

  // 다리
  for (const s of ["l", "r"]) {
    const hip = pose["p" + s];
    const knee = pose["k" + s];
    const foot = pose["f" + s];
    line(ctx, [hip, knee, foot], legW, skin, ow);
    line(ctx, [mix(knee, foot, 0.32), foot], legW + 2, kit.socks, ow);
    line(ctx, [hip, mix(hip, knee, 0.48)], legW + 12, kit.shorts, ow);
    // 축구화
    const dir = [foot[0] - knee[0], foot[1] - knee[1]];
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    const tip = [foot[0] + (dir[0] / dl) * 10 + (s === "l" ? -8 : 8), foot[1] + (dir[1] / dl) * 10 + 4];
    line(ctx, [foot, tip], 26, "#151515", ow);
    line(ctx, [mix(foot, tip, 0.2), mix(foot, tip, 0.9)], 3, "#fff", 0);
  }
  // 반바지 허리
  const wl = [pose.pl[0] - side[0] * 0.35, pose.pl[1] - side[1] * 0.35];
  const wr = [pose.pr[0] + side[0] * 0.35, pose.pr[1] + side[1] * 0.35];
  const lowL = [wl[0] - (up[0] / upLen) * 28, wl[1] - (up[1] / upLen) * 28];
  const lowR = [wr[0] - (up[0] / upLen) * 28, wr[1] - (up[1] / upLen) * 28];
  poly(ctx, [[wl[0] + (up[0] / upLen) * 10, wl[1] + (up[1] / upLen) * 10], [wr[0] + (up[0] / upLen) * 10, wr[1] + (up[1] / upLen) * 10], lowR, lowL], kit.shorts, ow);

  // 몸통
  const torso = [pose.sl, pose.sr, wr, wl];
  poly(ctx, torso, kit.shirt, ow);
  if (kit.stripes || kit.checks) {
    ctx.save();
    ctx.beginPath();
    torso.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    if (kit.checks) {
      // 크로아티아 체크무늬: 몸통 방향을 따라 칸을 깐다
      const ang = Math.atan2(up[0], -up[1]);
      const c = mix(mix(pose.sl, pose.sr, 0.5), mix(wl, wr, 0.5), 0.5);
      ctx.translate(c[0], c[1]);
      ctx.rotate(ang);
      ctx.fillStyle = kit.checks;
      const sq = 22;
      for (let i = -6; i < 6; i++) for (let j = -8; j < 8; j++) if ((i + j) % 2 === 0) ctx.fillRect(i * sq, j * sq, sq, sq);
    } else {
      for (let i = 0; i < 4; i++) {
        const a = mix(pose.sl, pose.sr, 0.12 + i * 0.25);
        const b = mix(wl, wr, 0.12 + i * 0.25);
        line(ctx, [a, b], 16, kit.stripes, 0);
      }
    }
    ctx.restore();
    ctx.lineWidth = ow;
    ctx.strokeStyle = OUT;
    ctx.beginPath();
    torso.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }

  // 등번호 (뒤에서 볼 때만)
  if (!look.front) {
    const c = mix(mix(pose.sl, pose.sr, 0.5), mix(wl, wr, 0.5), 0.5);
    const ang = Math.atan2(up[0], -up[1]);
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.rotate(ang);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.font = `70px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUT;
    ctx.fillStyle = kit.number;
    ctx.strokeText(String(player.num), 0, -6);
    ctx.fillText(String(player.num), 0, -6);
    ctx.restore();
  }

  // 팔
  for (const s of ["l", "r"]) {
    const sh = pose["s" + s];
    const el = pose["e" + s];
    const hd = pose["h" + s];
    line(ctx, [sh, el, hd], armW, skin, ow);
    line(ctx, [sh, mix(sh, el, 0.6)], armW + 8, kit.sleeves || kit.shirt, ow);
    if (kit.gloves) circle(ctx, hd[0], hd[1], 21, kit.gloves, ow);
    else circle(ctx, hd[0], hd[1], 13, skin, ow);
  }

  // 머리
  drawHead(ctx, pose.h, look, ow, Math.atan2(up[0], -up[1]));
}

function drawHead(ctx, [x, y], look, ow, ang) {
  const p = look.player;
  const r = 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // 목
  line(ctx, [[0, 10], [0, 36]], 24, p.skin, ow);
  // 귀
  circle(ctx, -r + 2, 4, 9, p.skin, ow);
  circle(ctx, r - 2, 4, 9, p.skin, ow);
  circle(ctx, 0, 0, r, p.skin, ow);
  const hc = p.hairColor;
  const hair = p.hair;
  if (look.front) {
    // 앞모습: 머리 윗부분 + 병맛 얼굴
    if (hair !== "bald") {
      ctx.beginPath();
      const top = hair === "buzz" ? 0.45 : 0.62;
      ctx.ellipse(0, -r * (1 - top) - 2, r * 1.02, r * top + 2, 0, Math.PI, 0);
      ctx.fillStyle = hc;
      ctx.fill();
      ctx.lineWidth = ow;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      if (hair === "afro" || hair === "curly") for (let i = 0; i < 7; i++) circle(ctx, -r + i * (r / 3), -r * 0.7 - (i % 2) * 6, 11, hc, ow * 0.7);
    }
    const f = look.face || "normal";
    // 눈
    const ey = -2;
    const big = f === "scared" ? 11 : 9;
    circle(ctx, -12, ey, big, "#fff", ow * 0.7);
    circle(ctx, 12, ey, big, "#fff", ow * 0.7);
    const lx = look.lookX || 0;
    circle(ctx, -12 + lx * 4, ey + 1, 4, OUT, 0);
    circle(ctx, 12 + lx * 4, ey + 1, 4, OUT, 0);
    // 일자 눈썹
    line(ctx, [[-24, ey - 14], [24, ey - 14]], 6, hc === "#dcbc72" ? "#8c6439" : hc, 0);
    // 수염
    if (p.beard === "full") {
      ctx.beginPath();
      ctx.arc(0, 4, r - 2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.fillStyle = hc;
      ctx.fill();
    } else if (p.beard === "stubble") {
      ctx.fillStyle = "rgba(0,0,0,.25)";
      for (let i = 0; i < 9; i++) ctx.fillRect(-14 + i * 3.5, 16 + (i % 2) * 4, 2, 2);
    }
    // 입
    if (f === "scared") circle(ctx, 0, 18, 7, "#5a0d0d", ow * 0.6);
    else if (f === "happy") {
      ctx.beginPath();
      ctx.arc(0, 12, 12, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.fillStyle = "#5a0d0d";
      ctx.fill();
      ctx.lineWidth = ow * 0.6;
      ctx.stroke();
    } else if (f === "sad") line(ctx, [[-10, 20], [0, 15], [10, 20]], 3, OUT, 0);
    else line(ctx, [[-9, 17], [9, 17]], 3, OUT, 0);
  } else {
    // 뒷모습: 머리카락이 거의 다 덮는다
    if (hair === "bald") {
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.beginPath();
      ctx.ellipse(-10, -16, 8, 5, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const cover = hair === "buzz" ? 0.62 : 0.86;
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI * (0.5 + cover), Math.PI * (2.5 - cover), false);
      ctx.closePath();
      ctx.fillStyle = hc;
      ctx.fill();
      ctx.lineWidth = ow;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      if (hair === "afro" || hair === "curly") {
        const n = hair === "afro" ? 10 : 7;
        const rr = hair === "afro" ? r + 10 : r + 2;
        for (let i = 0; i < n; i++) {
          const a = Math.PI * (1.05 + (i / (n - 1)) * 0.9);
          circle(ctx, Math.cos(a) * rr * 0.85, Math.sin(a) * rr * 0.85, hair === "afro" ? 14 : 10, hc, ow * 0.7);
        }
      }
      if (hair === "bun") circle(ctx, 0, -r - 6, 12, hc, ow);
      if (hair === "long") {
        ctx.beginPath();
        ctx.moveTo(-r + 1, -4);
        ctx.quadraticCurveTo(-r - 4, 30, -r + 10, 44);
        ctx.lineTo(r - 10, 44);
        ctx.quadraticCurveTo(r + 4, 30, r - 1, -4);
        ctx.closePath();
        ctx.fillStyle = hc;
        ctx.fill();
        ctx.lineWidth = ow;
        ctx.strokeStyle = OUT;
        ctx.stroke();
      }
      if (hair === "twists") for (let i = -2; i <= 2; i++) line(ctx, [[i * 11, 10], [i * 12, 38]], 6, hc, ow * 0.6);
    }
  }
  ctx.restore();
}

// 축구공: 흰 공 + 검은 오각형. spin으로 무늬만 돌린다.
function drawBall(ctx, x, y, r, spin) {
  ctx.save();
  ctx.translate(x, y);
  circle(ctx, 0, 0, r, "#fff", Math.max(1.5, r * 0.12));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.rotate(spin);
  ctx.fillStyle = "#111";
  const pent = (cx, cy, s) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      ctx[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * s, cy + Math.sin(a) * s);
    }
    ctx.closePath();
    ctx.fill();
  };
  pent(0, 0, r * 0.36);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5 + Math.PI / 5;
    pent(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3);
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.25, r * 0.15, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

// 플래시 느낌 반짝이 버튼/상자
function glossBox(ctx, x, y, w, h, top, bottom, r = 8) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 2, w - 6, h * 0.45, [r - 2, r - 2, 2, 2]);
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.fill();
}

function outlinedText(ctx, text, x, y, size, fill, stroke = OUT, lw) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = lw ?? Math.max(3, size * 0.16);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function shirtIcon(ctx, x, y, s, kit) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const pts = [[-10, -9], [-4, -11], [0, -8], [4, -11], [10, -9], [14, -3], [9, 0], [8, 11], [-8, 11], [-9, 0], [-14, -3]];
  poly(ctx, pts, kit.shirt, 1.6);
  if (kit.stripes) {
    ctx.fillStyle = kit.stripes;
    ctx.fillRect(-5, -8, 3, 18);
    ctx.fillRect(2, -8, 3, 18);
  }
  if (kit.checks) {
    ctx.fillStyle = kit.checks;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) ctx.fillRect(-8 + i * 4, -8 + j * 4, 4, 4);
  }
  ctx.restore();
}

// ---------- 무대 배경 ----------
// 광고판 문구는 헤딩 연습과 같이 쓰는 ../ads.js에서 경기마다 몇 개를 뽑아서 건다 (Renderer.shuffleAds)
function buildBackground(variant, ADS) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const rnd = (() => {
    let s = 1234 + variant * 777;
    return () => hash(s++);
  })();

  // 관중석
  const sky = ctx.createLinearGradient(0, 0, 0, 175);
  sky.addColorStop(0, "#111827");
  sky.addColorStop(1, "#3b3f4a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 180);
  const shirts = ["#e63946", "#f1faee", "#457b9d", "#ffb703", "#2a9d8f", "#9b5de5", "#222", "#ff7aa8"];
  const skins = ["#f6d5bd", "#ecc39f", "#d6a47a", "#8a5636"];
  for (let row = 0; row < 9; row++) {
    const y = 48 + row * 15;
    for (let x = -10 + (row % 2) * 7; x < W + 10; x += 14) {
      if (rnd() < 0.08) continue;
      const jx = x + (rnd() - 0.5) * 4;
      ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      ctx.fillRect(jx - 6, y + 4, 12, 9);
      ctx.fillStyle = skins[Math.floor(rnd() * skins.length)];
      ctx.beginPath();
      ctx.arc(jx, y + (rnd() < 0.15 ? -3 : 0), 4.5, 0, Math.PI * 2);
      ctx.fill();
      // 손 든 관중
      if (rnd() < 0.07) {
        ctx.fillRect(jx - 7, y - 9, 2.5, 9);
        ctx.fillRect(jx + 5, y - 9, 2.5, 9);
      }
    }
  }
  // 조명 번짐
  for (const lx of [60, 740]) {
    const g = ctx.createRadialGradient(lx, 30, 4, lx, 30, 120);
    g.addColorStop(0, "rgba(255,255,220,.9)");
    g.addColorStop(1, "rgba(255,255,220,0)");
    ctx.fillStyle = g;
    ctx.fillRect(lx - 120, 0, 240, 160);
  }

  // 광고판
  const ad = ctx.createLinearGradient(0, 175, 0, 222);
  ad.addColorStop(0, "#a4161a");
  ad.addColorStop(0.5, "#c1121f");
  ad.addColorStop(1, "#7a0c10");
  ctx.fillStyle = ad;
  ctx.fillRect(0, 175, W, 47);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 173, W, 3);
  ctx.save();
  ctx.font = `italic 30px ${FONT}`;
  ctx.textBaseline = "middle";
  let ax = -20 - variant * 6;
  let i = 0;
  while (ax < W) {
    const t = ADS[i % ADS.length];
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.strokeText(t, ax, 200);
    ctx.fillStyle = "#fff";
    ctx.fillText(t, ax, 200);
    ax += ctx.measureText(t).width + 40;
    i++;
  }
  ctx.restore();

  // 잔디: 소실점에서 퍼지는 줄무늬
  ctx.fillStyle = "#1e9a3c";
  ctx.fillRect(0, 222, W, H - 222);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 222, W, H - 222);
  ctx.clip();
  const vp = [400, -260];
  for (let k = -12; k <= 12; k += 2) {
    ctx.beginPath();
    ctx.moveTo(vp[0], vp[1]);
    ctx.lineTo(400 + k * 95, H + 40);
    ctx.lineTo(400 + (k + 1) * 95, H + 40);
    ctx.closePath();
    ctx.fillStyle = "#26ad47";
    ctx.fill();
  }
  const sh = ctx.createLinearGradient(0, 222, 0, 330);
  sh.addColorStop(0, "rgba(0,0,0,.28)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 222, W, 110);
  ctx.restore();

  // 라인
  ctx.strokeStyle = "#f4f4f4";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, LINE_Y);
  ctx.lineTo(W, LINE_Y);
  ctx.moveTo(170, LINE_Y);
  ctx.lineTo(118, 350);
  ctx.lineTo(682, 350);
  ctx.lineTo(630, LINE_Y);
  ctx.moveTo(22, LINE_Y);
  ctx.lineTo(-90, 480);
  ctx.moveTo(778, LINE_Y);
  ctx.lineTo(890, 480);
  ctx.stroke();
  // 페널티 스폿
  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.ellipse(SPOT[0], SPOT[1] + 28, 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

// 골대 그물: shake(0~1)이면 공 맞은 자리 근처가 흔들린다
function drawGoal(ctx, shake, hit) {
  const [L] = toScreen(-GOAL_W2, 0);
  const [R] = toScreen(GOAL_W2, 0);
  const [, T] = toScreen(0, GOAL_H);
  const back = { l: L + 30, r: R - 30, t: T - 22, b: LINE_Y - 34 };
  const wob = (x, y) => {
    if (!shake || !hit) return [x, y];
    const d = Math.hypot(x - hit[0], y - hit[1]);
    const k = Math.max(0, 1 - d / 120) * shake;
    return [x + Math.sin(y * 0.3) * 6 * k, y - 10 * k];
  };
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let x = back.l; x <= back.r + 0.1; x += 15) {
    for (let y = back.t; y < back.b; y += 6) {
      const a = wob(x, y);
      const b = wob(x, Math.min(back.b, y + 6));
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
  }
  for (let y = back.t; y <= back.b + 0.1; y += 15) {
    for (let x = back.l; x < back.r; x += 6) {
      const a = wob(x, y);
      const b = wob(Math.min(back.r, x + 6), y);
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
  }
  // 옆그물 / 지붕그물
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    ctx.moveTo(lerp(L, back.l, u), lerp(T, back.t, u));
    ctx.lineTo(lerp(L, back.l, u), lerp(LINE_Y, back.b, u));
    ctx.moveTo(lerp(R, back.r, u), lerp(T, back.t, u));
    ctx.lineTo(lerp(R, back.r, u), lerp(LINE_Y, back.b, u));
  }
  for (let y = 0; y <= 1; y += 1 / 12) {
    ctx.moveTo(L, lerp(T, LINE_Y, y));
    ctx.lineTo(back.l, lerp(back.t, back.b, y));
    ctx.moveTo(R, lerp(T, LINE_Y, y));
    ctx.lineTo(back.r, lerp(back.t, back.b, y));
  }
  for (let x = 0; x <= 1; x += 1 / 30) {
    ctx.moveTo(lerp(L, R, x), T);
    ctx.lineTo(lerp(back.l, back.r, x), back.t);
  }
  ctx.stroke();
  // 뒤 틀
  ctx.strokeStyle = "#d9d9d9";
  ctx.lineWidth = 3;
  ctx.strokeRect(back.l, back.t, back.r - back.l, back.b - back.t);
  ctx.restore();

  // 골대 (흰 기둥 + 회색 그림자 + 검은 테두리)
  const post = (pts) => {
    line(ctx, pts, 13, "#f7f7f7", 3);
    ctx.save();
    ctx.translate(3, 0);
    line(ctx, pts, 4, "#b8b8b8", 0);
    ctx.restore();
  };
  post([[L, LINE_Y], [L, T], [R, T], [R, LINE_Y]]);
}

// ---------- 렌더러 ----------
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.shuffleAds();
    this.rotated = false;
    // 창 크기가 바뀌면 app.js layout()이 resize()를 부른다
    this.resize();
    // 광고판 글자를 전부 받아 둔 뒤 다시 그린다 (캔버스 글자는 웹 글꼴 다운로드를 일으키지 않음)
    loadAdFont(`italic 30px ${FONT}`).then(() => this.buildBgs());
  }

  // 광고판 문구를 새로 뽑는다 (경기 시작마다)
  shuffleAds() {
    this.ads = pickAds(8);
    this.buildBgs();
  }

  buildBgs() {
    this.bgs = [buildBackground(0, this.ads), buildBackground(1, this.ads)];
  }

  // 화면을 90도 돌려 보여줄 때는 rotated = true (app.js layout()이 정한다).
  // 크기는 돌리기 전 레이아웃 크기(clientWidth)로 잡는다 (getBoundingClientRect는 돌린 뒤라 가로세로가 바뀜)
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.scale = this.canvas.width / W;
  }

  // 화면(터치) 좌표 → 논리 좌표. 시계 방향 90도로 돌렸으면 화면 아래쪽이 게임의 오른쪽,
  // 화면 왼쪽이 게임의 아래쪽이다.
  toLogical(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    if (this.rotated) return [((clientY - r.top) / r.height) * W, ((r.right - clientX) / r.width) * H];
    return [((clientX - r.left) / r.width) * W, ((clientY - r.top) / r.height) * H];
  }

  draw(v) {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const now = v.now / 1000;
    const crowdFrame = Math.floor(now * (v.crowdHype ? 8 : 3)) % 2;

    // 화면 흔들림
    let sx = 0;
    let sy = 0;
    if (v.shake > 0) {
      const f = Math.floor(now * 20);
      sx = (hash(f) - 0.5) * 14 * v.shake;
      sy = (hash(f + 99) - 0.5) * 10 * v.shake;
    }
    ctx.save();
    ctx.translate(sx, sy);
    ctx.drawImage(this.bgs[crowdFrame], -8, -8, W + 16, H + 16);

    const scene = v.scene;
    if (scene) this.drawScene(ctx, v, scene, now);
    ctx.restore();

    if (v.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${v.flash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
    this.drawHud(ctx, v);
    if (v.ui) this.drawInputUi(ctx, v, now);
    for (const p of v.popups || []) this.drawPopup(ctx, p, now);
    if (v.banner) this.drawBanner(ctx, v.banner, now);
  }

  drawScene(ctx, v, sc, now) {
    // 아웃된 공이 관중석에 꽂힌 경우는 그물보다 먼저(뒤에) 그린다
    const ball = sc.ball;
    const behind = ball && ball.behind;
    if (behind) this.ballWithShadow(ctx, ball);
    if (sc.ouch) {
      const f = Math.floor(now * 6) % 2;
      outlinedText(ctx, "아야!", sc.ouch[0] + 30, sc.ouch[1] - 26 - f * 4, 26, "#ffe14d");
      for (let i = 0; i < 3; i++) {
        const a = now * 4 + i * 2.1;
        outlinedText(ctx, "★", sc.ouch[0] + Math.cos(a) * 22, sc.ouch[1] - 10 + Math.sin(a) * 8, 14, "#ffe14d", OUT, 3);
      }
    }
    drawGoal(ctx, sc.netShake || 0, sc.netHit);
    if (ball && ball.inNet) this.ballWithShadow(ctx, ball);

    // 골키퍼
    const gk = sc.keeper;
    ctx.save();
    ctx.translate(gk.root[0], gk.root[1]);
    ctx.scale(KEEPER_SCALE, KEEPER_SCALE);
    // 그림자
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.ellipse(gk.shadowDx || 0, gk.shadowDy || 4, 90, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPerson(ctx, boil(gk.pose, gk.frame, 4), gk.look, 3 / KEEPER_SCALE);
    ctx.restore();
    if (gk.sweat) outlinedText(ctx, "💦", gk.root[0] + 50, gk.root[1] - 170, 22, "#fff", OUT, 0);

    if (ball && !behind && !ball.inNet && !ball.front) this.ballWithShadow(ctx, ball);

    // 키커 (앞쪽, 크게)
    const kk = sc.kicker;
    ctx.save();
    ctx.translate(kk.root[0], kk.root[1]);
    ctx.scale(0.9, 0.9);
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(kk.shadowDx || 0, 0, 80, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPerson(ctx, boil(kk.pose, kk.frame + 500, 5), kk.look, 3.4);
    ctx.restore();
    if (kk.stars) {
      for (let i = 0; i < 4; i++) {
        const a = now * 5 + i * 1.6;
        outlinedText(ctx, "★", kk.stars[0] + Math.cos(a) * 40, kk.stars[1] + Math.sin(a) * 12, 20, "#ffe14d", OUT, 3);
      }
    }
    if (ball && ball.front) this.ballWithShadow(ctx, ball);
  }

  ballWithShadow(ctx, b) {
    if (b.shadow) {
      ctx.fillStyle = "rgba(0,0,0,.3)";
      ctx.beginPath();
      ctx.ellipse(b.shadow[0], b.shadow[1], b.r * 1.1, b.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawBall(ctx, b.x, b.y, b.r, b.spin || 0);
  }

  drawHud(ctx, v) {
    const h = v.hud;
    if (!h) return;
    // 위: 팀 이름 막대
    const g = ctx.createLinearGradient(0, 0, 0, 36);
    g.addColorStop(0, "#3d6aa8");
    g.addColorStop(1, "#14305a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 36);
    ctx.fillStyle = "#0b1a33";
    ctx.fillRect(0, 36, W, 3);
    shirtIcon(ctx, 70, 18, 1.25, h.left.kit);
    shirtIcon(ctx, 730, 18, 1.25, h.right.kit);
    ctx.font = `20px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(h.left.name + (h.left.tag ? ` ${h.left.tag}` : ""), 96, 19);
    ctx.textAlign = "right";
    ctx.fillText((h.right.tag ? `${h.right.tag} ` : "") + h.right.name, 704, 19);
    glossBox(ctx, 352, 4, 96, 28, "#ffd23f", "#e08a00", 6);
    outlinedText(ctx, `${h.left.goals} : ${h.right.goals}`, 400, 18, 22, "#fff", "#5a3000", 4);

    // 아래: 킥 기록
    const b = ctx.createLinearGradient(0, H - 40, 0, H);
    b.addColorStop(0, "#3d6aa8");
    b.addColorStop(1, "#14305a");
    ctx.fillStyle = b;
    ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = "#0b1a33";
    ctx.fillRect(0, H - 42, W, 3);
    const row = (marks, x0, dir) => {
      const shown = marks.slice(-7);
      shown.forEach((m, i) => {
        const x = x0 + dir * i * 32;
        const y = H - 20;
        if (m === null) circle(ctx, x, y, 12, "rgba(255,255,255,.15)", 2);
        else if (m) {
          drawBall(ctx, x, y, 12, 0);
          ctx.strokeStyle = "#3ddc84";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          circle(ctx, x, y, 12, "#2a2a2a", 2);
          outlinedText(ctx, "✕", x, y + 1, 18, "#ff4d4d", OUT, 3);
        }
      });
    };
    row(h.left.marks, 24, 1);
    row(h.right.marks, W - 24, -1);
    if (h.sudden) {
      glossBox(ctx, 330, H - 36, 140, 30, "#ff5d5d", "#a10d0d", 8);
      outlinedText(ctx, "서든데스!", 400, H - 21, 18, "#fff", "#4a0000", 4);
    } else if (h.round) {
      glossBox(ctx, 330, H - 36, 140, 30, "#ffd23f", "#e07a00", 8);
      outlinedText(ctx, `🏆 ${h.round}`, 400, H - 21, 18, "#fff", "#5a3000", 4);
    }
    if (h.caption) {
      ctx.font = `17px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,.55)";
      const tw = ctx.measureText(h.caption).width + 26;
      ctx.beginPath();
      ctx.roundRect(400 - tw / 2, 44, tw, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(h.caption, 400, 58);
    }
  }

  drawInputUi(ctx, v, now) {
    const ui = v.ui;
    // 남은 시간
    if (ui.timeLeft != null) {
      const secs = Math.ceil(ui.timeLeft / 1000);
      const frac = clamp01(ui.timeLeft / 5000);
      glossBox(ctx, 300, 76, 200, 16, "#2b2b2b", "#111", 8);
      ctx.fillStyle = frac < 0.4 ? "#ff4d4d" : "#ffd23f";
      ctx.beginPath();
      ctx.roundRect(303, 79, 194 * frac, 10, 5);
      ctx.fill();
      const pulse = secs <= 2 && Math.floor(now * 6) % 2 ? 4 : 0;
      outlinedText(ctx, String(secs), 520, 84, 26 + pulse, secs <= 2 ? "#ff4d4d" : "#fff");
    }
    if (ui.oppReady) {
      glossBox(ctx, 640, 70, 150, 28, "#3ddc84", "#14833f", 14);
      outlinedText(ctx, "상대 준비 완료!", 715, 84, 16, "#fff", "#0b3d1c", 3);
    }

    if (ui.role === "kick") {
      // 조준 화살표: 공에서 조준점까지. 골대 안이면 흰색, 밖이면 빨간색, 차고 나면 노란색
      if (ui.target) {
        const [sx, sy] = SPOT;
        const [tx, ty] = toScreen(ui.target.x, ui.target.y + BALL);
        const inside = Math.abs(ui.target.x) < GOAL_W2 - BALL && ui.target.y < GOAL_H - BALL;
        const color = ui.done ? "#ffd23f" : inside ? "#ffffff" : "#ff4d4d";
        const ang = Math.atan2(ty - sy, tx - sx);
        const end = [tx - Math.cos(ang) * 10, ty - Math.sin(ang) * 10];
        line(ctx, [[sx, sy - 10], end], 9, color, 3);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(ang);
        poly(ctx, [[16, 0], [-12, -15], [-12, 15]], color, 3);
        ctx.restore();
      }

      // 슛 게이지 (오른쪽). 아래부터 약 / 좋아 / 강슛 / 홈런
      const gx = 742;
      const top = 120;
      const hgt = 330;
      // 구간 이름까지 어두운 판 위에 (광고판 위에서도 읽히게)
      glossBox(ctx, gx - 58, top - 8, 95, hgt + 16, "#2b2b2b", "#111", 10);
      const colors = ["#4ea8de", "#3ddc84", "#ff9f1c", "#ff4d4d"];
      let from = 0;
      ZONES.forEach((z, i) => {
        const to = Math.min(1, z.until);
        ctx.fillStyle = colors[i];
        ctx.fillRect(gx, top + hgt * (1 - to), 26, hgt * (to - from));
        outlinedText(ctx, z.name, gx - 27, top + hgt * (1 - (from + to) / 2), 17, colors[i], OUT, 3);
        from = to;
      });
      // 게이지 눈금: 끊기지 않고 매 프레임 부드럽게 (타이밍이 화면과 정확히 맞아야 해서)
      const gy = top + hgt * (1 - ui.gauge);
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(gx, top, 26, gy - top);
      line(ctx, [[gx - 8, gy], [gx + 34, gy]], 5, ui.done ? "#ffd23f" : "#fff", 2);
      if (ui.zonePop) {
        const t = now - ui.zonePop.t0 / 1000;
        if (t < 0.9) outlinedText(ctx, `${ui.zonePop.name}!`, gx - 100, gy - 6 - Math.min(t, 0.2) * 60, 28, "#fff", OUT, 5);
      }

      if (!ui.done && !ui.aiming) {
        const f = Math.floor(now * 3) % 2;
        glossBox(ctx, 250, 505, 300, 44, "#3a7bd5", "#0f3a7a", 10);
        outlinedText(ctx, "끌어서 조준 · 떼면 슛", 400, 527, 20, "#fff", OUT, 4);
        outlinedText(ctx, "👆", 560 + f * 6, 520, 30, "#fff", OUT, 0);
      }
    } else if (ui.role === "keep") {
      const [cx, cy] = KEEPER_CHEST;
      if (ui.target) {
        this.drawGhostKeeper(ctx, ui.target, ui.keeperLook);
      } else if (ui.done) {
        outlinedText(ctx, "버티기!", cx, cy - 110, 22, "#ffd23f");
      }
      if (!ui.done && !ui.dragging) {
        const f = Math.floor(now * 3) % 2;
        glossBox(ctx, 250, 505, 300, 44, "#ff4fa3", "#9d1460", 10);
        outlinedText(ctx, "드래그해서 다이빙 방향 · 거리", 400, 527, 19, "#fff", OUT, 4);
        outlinedText(ctx, "👆", 560 + f * 6, 520, 30, "#fff", OUT, 0);
      }
    }
    if (ui.done && ui.waiting) {
      glossBox(ctx, 290, 100, 220, 30, "#333", "#111", 15);
      const dots = ".".repeat(1 + (Math.floor(now * 3) % 3));
      outlinedText(ctx, `상대 기다리는 중${dots}`, 400, 115, 16, "#fff", OUT, 3);
    }
  }

  // 드래그 중인 다이빙의 예상 모습: 실제로 날아가는 그림을 반투명하게.
  // 겹친 부분이 진해지지 않게 따로 그린 뒤 한 번에 투명도를 준다.
  drawGhostKeeper(ctx, target, look) {
    if (!this.ghost) this.ghost = document.createElement("canvas");
    const g = this.ghost;
    if (g.width !== this.canvas.width || g.height !== this.canvas.height) {
      g.width = this.canvas.width;
      g.height = this.canvas.height;
    }
    const gc = g.getContext("2d");
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.clearRect(0, 0, g.width, g.height);
    gc.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const { ang, root } = diveGeom(target.x, target.y);
    gc.translate(root[0], root[1]);
    gc.scale(KEEPER_SCALE, KEEPER_SCALE);
    drawPerson(gc, rotatePose(GK.stretch, ang, 0, 0), { ...look, face: "scared", lookX: Math.sign(target.x) }, 3 / KEEPER_SCALE);
    // 하얗게 바래서 유령처럼 (잔디·형광 유니폼 위에서도 보이게)
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.globalCompositeOperation = "source-atop";
    gc.fillStyle = "rgba(255,255,255,.5)";
    gc.fillRect(0, 0, g.width, g.height);
    gc.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.drawImage(g, 0, 0, W, H);
    ctx.restore();
  }

  drawPopup(ctx, p, now) {
    const t = now - p.t0;
    if (t < 0) return;
    // 스톱모션 팝: 3단계 크기
    const k = t < 0.07 ? 0.55 : t < 0.14 ? 1.25 : t < 0.21 ? 0.95 : 1;
    const wob = Math.floor(t * 8) % 2 ? 0.04 : -0.04;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot || -0.06) + wob);
    ctx.scale(k, k);
    ctx.font = `${p.size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = p.size * 0.28;
    ctx.strokeStyle = OUT;
    ctx.strokeText(p.text, 0, 0);
    const g = ctx.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
    g.addColorStop(0, p.c1);
    g.addColorStop(1, p.c2);
    ctx.lineWidth = p.size * 0.12;
    ctx.strokeStyle = "#fff";
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = g;
    ctx.fillText(p.text, 0, 0);
    if (p.sub) {
      ctx.font = `${Math.round(p.size * 0.36)}px ${FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = OUT;
      ctx.strokeText(p.sub, 0, p.size * 0.72);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.sub, 0, p.size * 0.72);
    }
    ctx.restore();
  }

  drawBanner(ctx, b, now) {
    const t = now - b.t0;
    const x = t < 0.08 ? 900 : t < 0.16 ? 360 : 400;
    ctx.save();
    ctx.translate(x, 250);
    ctx.rotate(-0.04);
    glossBox(ctx, -230, -46, 460, 92, b.c1 || "#ffd23f", b.c2 || "#e07a00", 12);
    outlinedText(ctx, b.title, 0, -12, 34, "#fff", OUT, 7);
    if (b.sub) outlinedText(ctx, b.sub, 0, 26, 19, "#fff", OUT, 4);
    ctx.restore();
  }
}

// ---------- 장면 계산 ----------
// 키퍼가 (tx, ty)미터로 손을 뻗을 때 몸 기울기와 발 위치. 다이빙 재생과 드래그 미리보기가 같이 쓴다.
function diveGeom(tx, ty) {
  const [hx, hy] = toScreen(tx, ty);
  const ang = Math.atan2(tx, Math.max(ty, 0.25));
  const reach = 462 * KEEPER_SCALE;
  const root = [hx - Math.sin(ang) * reach, Math.min(LINE_Y, hy + Math.cos(ang) * reach)];
  return { ang, hx, reach, root };
}
// 한 번의 킥 재생: t초에서 키커·키퍼·공이 어디서 어떤 그림인지.
// play: { res, keep, kickerLook, keeperLook, stayKeeper }
export function playScene(play, t) {
  const res = play.res;
  const arrive = arriveTime(res);
  const flight = flightTime(res);
  const out = res.outcome;
  const st = step(t, 8); // 사람은 초당 8장
  const sc = { kicker: {}, keeper: {}, ball: null };

  // --- 키커 ---
  const kStart = [205, 612];
  const kPlant = [292, 572];
  let kpose;
  let kroot;
  let kframe = Math.floor(t * 8);
  if (st < KICK_T) {
    const n = Math.floor(st / 0.3);
    kpose = [K.run1, K.run2, K.run3][n % 3];
    const u = Math.min(1, (n + 1) / 3);
    kroot = mix(kStart, kPlant, u);
  } else if (out === "fall") {
    const ft = st - KICK_T;
    if (ft < 0.15) {
      kpose = rotatePose(K.slip, 0.45, 0, -170);
      kroot = [kPlant[0], kPlant[1] - 30];
    } else if (ft < 0.35) {
      kpose = rotatePose(K.slip, 1.15, 0, -170);
      kroot = [kPlant[0] + 10, kPlant[1] - 70];
    } else {
      // 철퍼덕: 오른쪽으로 길게 엎어진다
      kpose = shiftPose(rotatePose(K.idle1, 1.5, 0, 0), 0, -20);
      kroot = [kPlant[0] - 130, 548];
      sc.kicker.stars = [kroot[0] + 340, kroot[1] - 60];
      sc.kicker.shadowDx = 170;
    }
  } else if (st < arrive + 0.35) {
    kpose = K.kick;
    kroot = kPlant;
  } else {
    const n = Math.floor((st - arrive) / 0.25);
    if (out === "goal") {
      kpose = n % 2 ? K.cheer2 : K.cheer1;
      kroot = [kPlant[0], kPlant[1] + (n % 2 ? -18 : 0)];
    } else {
      kpose = st - arrive < 1.2 ? K.sad1 : K.sad2;
      kroot = kPlant;
      kframe = Math.floor(t * 4);
    }
  }
  sc.kicker = { ...sc.kicker, pose: kpose, root: kroot, frame: kframe, look: play.kickerLook };

  // --- 키퍼 ---
  const keep = play.keep;
  const stay = !keep || keep.stay;
  const kr = KEEPER_ROOT;
  const diveStart = KICK_T - 0.08;
  const gkLook = { ...play.keeperLook, face: "normal", lookX: 0 };
  let gpose = GK.ready1;
  let groot = kr;
  let gframe = Math.floor(t * 8);
  const saved = out === "save";
  if (st < diveStart) {
    gpose = Math.floor(st * 4) % 2 ? GK.ready2 : GK.ready1;
    gframe = Math.floor(t * 4);
  } else if (stay) {
    if (st < arrive) gpose = GK.ready1;
    else if (saved) {
      gpose = st < arrive + 0.8 ? GK.catch : Math.floor((st - arrive) / 0.25) % 2 ? GK.cheer2 : GK.cheer1;
      gkLook.face = "happy";
    } else {
      gpose = GK.oops;
      gkLook.face = out === "goal" ? "sad" : "scared";
      sc.keeper.sweat = out !== "goal";
    }
    gkLook.lookX = Math.sign(res.bx) * 0.8;
  } else {
    const tx = keep.x / 1000;
    const ty = keep.y / 1000;
    const { ang, hx, reach, root: [rx, ry] } = diveGeom(tx, ty);
    gkLook.face = "scared";
    gkLook.lookX = Math.sign(tx);
    const upright = Math.abs(ang) < 0.35;
    if (st < diveStart + 0.12) {
      gpose = rotatePose(GK.ready1, ang * 0.3, 0, -160);
      groot = mix(kr, [rx, ry], 0.15);
    } else if (st < arrive + 0.12) {
      gpose = rotatePose(GK.stretch, ang, 0, 0);
      groot = [rx, ry];
      sc.keeper.shadowDx = (kr[0] - rx) / KEEPER_SCALE + Math.sin(ang) * 120;
      sc.keeper.shadowDy = (kr[1] - ry) / KEEPER_SCALE + 4;
    } else if (upright) {
      gpose = saved && st > arrive + 0.6 ? (Math.floor((st - arrive) / 0.25) % 2 ? GK.cheer2 : GK.cheer1) : GK.oops;
      groot = [lerp(kr[0], hx, 0.6), kr[1]];
      gkLook.face = saved ? "happy" : "sad";
    } else {
      const side = Math.sign(tx) || 1;
      if (saved && st > arrive + 0.9) {
        gpose = Math.floor((st - arrive) / 0.25) % 2 ? GK.cheer2 : GK.cheer1;
        groot = [hx - side * 40, kr[1]];
        gkLook.face = "happy";
      } else {
        gpose = rotatePose(GK.stretch, side * 1.48, 0, 0);
        groot = [hx - side * reach * 0.92, LINE_Y - 4];
        sc.keeper.shadowDx = side * 220;
        gkLook.face = saved ? "happy" : "sad";
      }
    }
  }
  sc.keeper = { ...sc.keeper, pose: gpose, root: groot, frame: gframe, look: gkLook };

  // --- 공 --- (초당 15장)
  const bt = step(t, 15);
  const r0 = 30;
  const [gx, gy] = toScreen(res.bx, res.by + BALL);
  const spin = Math.floor(bt * 15) * 0.9;
  const startY = SPOT[1];
  if (out === "fall") {
    const u = clamp01((bt - KICK_T - 0.1) / 0.8);
    sc.ball = { x: SPOT[0] + u * 26, y: startY - u * 14, r: r0 - u * 2, shadow: [SPOT[0] + u * 26, startY + 24 - u * 14], spin: u * 2, front: false };
  } else if (bt < KICK_T) {
    sc.ball = { x: SPOT[0], y: startY, r: r0, shadow: [SPOT[0], startY + 24], spin: 0 };
  } else if (bt < arrive) {
    const u = clamp01((bt - KICK_T) / flight);
    const arc = Math.sin(Math.PI * u) * (res.by > 0.3 ? 26 + res.by * 10 : 4);
    const x = lerp(SPOT[0], gx, u);
    const y = lerp(startY, gy, u) - arc;
    const r = r0 / (1 + 1.3 * u);
    const shY = lerp(startY + 24, LINE_Y + 2, u);
    sc.ball = { x, y, r, shadow: [x, shY], spin };
  } else {
    const a = bt - arrive;
    const rEnd = r0 / 2.3;
    if (out === "goal") {
      const u = clamp01(a / 0.12);
      const d = clamp01((a - 0.12) / 0.35);
      const x = lerp(gx, lerp(gx, GX, 0.12), u);
      const y = lerp(gy, gy - 22, u) + d * Math.max(0, LINE_Y - 34 - 8 - (gy - 22));
      sc.ball = { x, y, r: rEnd * 0.9, spin, inNet: true };
      sc.netShake = Math.max(0, 1 - a / 0.6);
      sc.netHit = [gx, gy - 20];
    } else if (out === "save") {
      const side = stay ? 0 : Math.sign(keep.x) || 1;
      if (stay) {
        const [cx, cy] = KEEPER_CHEST;
        sc.ball = { x: cx, y: cy - 2, r: rEnd, spin: 0, front: true };
        if (a > 0.8) sc.ball = { x: cx + 26, y: cy - 150, r: rEnd, spin, front: true };
      } else {
        const u = clamp01(a / 0.45);
        const x = gx + side * 150 * u;
        const y = gy - 40 * Math.sin(Math.PI * u) + u * 40;
        sc.ball = { x, y, r: rEnd * (1 + u * 0.4), spin, shadow: [x, LINE_Y + 6 + u * 30] };
      }
    } else if (out === "post" || out === "bar") {
      const u = clamp01(a / 0.5);
      const side = Math.sign(res.bx) || 1;
      const x = out === "post" ? gx + side * 120 * u : gx + side * 40 * u;
      const y = out === "post" ? gy + u * 90 - Math.sin(Math.PI * u) * 40 : gy - 120 * u;
      sc.ball = { x, y, r: rEnd * (1 + (out === "post" ? u * 0.8 : 0)), spin, behind: out === "bar" && u > 0.4, shadow: out === "post" ? [x, LINE_Y + u * 90] : null };
    } else {
      // wide / over: 계속 날아가서 관중석에 꽂힌다
      const u = clamp01(a / 0.4);
      const dirx = gx - SPOT[0];
      const x = Math.max(20, Math.min(780, gx + dirx * 0.1 * u));
      const tyEnd = out === "over" ? 110 : Math.max(180, gy - 40);
      const y = lerp(gy, tyEnd, u);
      sc.ball = { x, y, r: rEnd * (1 - u * 0.25), spin, behind: true };
      if (out === "over" && a > 0.4) sc.ouch = [x, y];
    }
  }
  return sc;
}

// 입력 중(차기 전) 장면: 키커는 숨 고르기, 키퍼는 좌우로 흔들
export function idleScene(kickerLook, keeperLook, t, kicking) {
  const f = Math.floor(t * 3);
  return {
    kicker: { pose: f % 2 ? K.idle2 : K.idle1, root: [205 + (kicking ? 8 : 0), 612], frame: f, look: kickerLook },
    keeper: { pose: Math.floor(t * 4) % 2 ? GK.ready2 : GK.ready1, root: KEEPER_ROOT, frame: Math.floor(t * 4), look: { ...keeperLook, face: "normal" } },
    ball: { x: SPOT[0], y: SPOT[1], r: 30, shadow: [SPOT[0], SPOT[1] + 24], spin: 0 },
  };
}

export { isLight, shade };
