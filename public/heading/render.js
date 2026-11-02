import { GROUND_Y, CART, BALL_R, LAUNCH_X } from "./logic.js";
import { pickAds, loadAdFont } from "../ads.js";

// 승부차기 대작전과 같은 옛날 플래시 게임 느낌의 2D 캔버스.
// 사람 그리기·공·외곽선 글자 같은 도구는 승부차기 render.js에서 그대로 가져왔다.
// 논리 해상도 800x600을 화면 크기에 맞춰 늘린다.

export const W = 800;
export const H = 600;
const OUT = "#111";
const FONT = "'Jua', 'Malgun Gothic', sans-serif";


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

  // 등번호 / 이름 (뒤에서 볼 때만)
  if (!look.front) {
    const c = mix(mix(pose.sl, pose.sr, 0.5), mix(wl, wr, 0.5), 0.5);
    const ang = Math.atan2(up[0], -up[1]);
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.rotate(ang);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.font = `20px ${FONT}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUT;
    ctx.strokeText(player.name, 0, -38);
    ctx.fillStyle = kit.number;
    ctx.fillText(player.name, 0, -38);
    ctx.font = `64px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeText(String(player.num), 0, 8);
    ctx.fillText(String(player.num), 0, 8);
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

// ---------- 헤딩 연습 ----------
const PLAYER_SCALE = 0.53;
const PLAYER_SPEED_REF = 900;
const COACH_SCALE = 0.55;
// 던지는 손이 정확히 발사점(LAUNCH_X, CONTACT_Y)에 오도록 맞춘 감독 위치
const COACH_ROOT = [LAUNCH_X + 60 * COACH_SCALE, GROUND_Y];

function nodPose(pose, dy) {
  return { ...pose, h: [pose.h[0], pose.h[1] + dy], n: [pose.n[0], pose.n[1] + dy * 0.5] };
}

// 선수 (정면)
const PL = {
  idle: [K.idle1, K.idle2],
  run: [K.run1, K.run2, K.run3],
  nod: nodPose(K.idle1, 14),
  cheer: [K.cheer1, K.cheer2],
  sad: [K.sad1, K.sad2],
};

// 감독 (의자에 앉아서 정면)
const CO = {
  sit: P([[0, -300], [0, -272], [-48, -258], [48, -258], [-70, -196], [66, -192], [-44, -150], [40, -150], [-30, -140], [30, -140], [-62, -112], [62, -112], [-64, -6], [64, -6]]),
  wind: P([[4, -302], [2, -273], [-48, -258], [48, -258], [-92, -300], [66, -192], [-72, -382], [40, -150], [-30, -140], [30, -140], [-62, -112], [62, -112], [-64, -6], [64, -6]]),
  throw: P([[-6, -298], [-4, -271], [-50, -256], [46, -258], [-86, -300], [66, -192], [-60, -364], [40, -150], [-30, -140], [30, -140], [-62, -112], [62, -112], [-64, -6], [64, -6]]),
  oops: P([[0, -294], [0, -268], [-48, -254], [48, -254], [-72, -292], [72, -292], [-22, -320], [22, -320], [-30, -140], [30, -140], [-62, -112], [62, -112], [-64, -6], [64, -6]]),
};

const PLAYER_LOOK = {
  player: { skin: "#f3cfae", hair: "long", hairColor: "#1b1b1b", beard: null },
  kit: { shirt: "#ff4f8b", sleeves: "#ff4f8b", shorts: "#6f84b5", socks: "#ffffff" },
  front: true,
};
const COACH_LOOK = {
  player: { skin: "#f0bfa0", hair: "buzz", hairColor: "#a39383", beard: "stubble" },
  kit: { shirt: "#2f64d6", shorts: "#3a4f86", socks: "#ffffff" },
  front: true,
};

// 전광판 문구는 승부차기와 같이 쓰는 ../ads.js에서 판마다 몇 개를 뽑아서 건다 (Renderer.newAds)

function buildBackground(variant, ads) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const rnd = (() => {
    let s = 4321 + variant * 777;
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
      if (rnd() < 0.07) {
        ctx.fillRect(jx - 7, y - 9, 2.5, 9);
        ctx.fillRect(jx + 5, y - 9, 2.5, 9);
      }
    }
  }
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
    const t = ads[i % ads.length];
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.strokeText(t, ax, 200);
    ctx.fillStyle = "#fff";
    ctx.fillText(t, ax, 200);
    ax += ctx.measureText(t).width + 40;
    i++;
  }
  ctx.restore();

  // 잔디: 옆에서 본 사이드라인이라 세로 줄무늬
  ctx.fillStyle = "#1e9a3c";
  ctx.fillRect(0, 222, W, H - 222);
  for (let x = 0; x < W; x += 100) {
    ctx.fillStyle = "#26ad47";
    ctx.fillRect(x, 222, 50, H - 222);
  }
  const sh = ctx.createLinearGradient(0, 222, 0, 330);
  sh.addColorStop(0, "rgba(0,0,0,.28)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 222, W, 110);
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 578, W, 5);
  return c;
}

function drawCart(ctx, count, shake) {
  const dx = shake ? Math.sin(shake * 40) * 4 : 0;
  ctx.save();
  ctx.translate(dx, 0);
  // 안에 쌓인 공 (위로 살짝 보인다)
  for (let i = 0; i < Math.min(count, 5); i++) drawBall(ctx, CART.x0 + 22 + i * 19, CART.top - 4 - (i % 2) * 6, 11, i);
  ctx.beginPath();
  ctx.moveTo(CART.x0 - 8, CART.top);
  ctx.lineTo(CART.x1 + 8, CART.top);
  ctx.lineTo(CART.x1, CART.top + 46);
  ctx.quadraticCurveTo(CART.x1, CART.top + 52, CART.x1 - 8, CART.top + 52);
  ctx.lineTo(CART.x0 + 8, CART.top + 52);
  ctx.quadraticCurveTo(CART.x0, CART.top + 52, CART.x0, CART.top + 46);
  ctx.closePath();
  ctx.fillStyle = "#e9e9e9";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.fillRect(CART.x0 + 6, CART.top + 6, CART.x1 - CART.x0 - 12, 8);
  for (const wx of [CART.x0 + 22, CART.x1 - 22]) {
    circle(ctx, wx, GROUND_Y - 14, 16, "#e07a00", 3);
    circle(ctx, wx, GROUND_Y - 14, 8, "#14205a", 2);
  }
  ctx.restore();
}

function drawChair(ctx) {
  // 감독 의자 (사람 좌표계, 감독 뒤에 먼저 그린다)
  ctx.lineWidth = 3 / COACH_SCALE;
  poly(ctx, [[-70, -320], [70, -320], [64, -150], [-64, -150]], "#4a4f5c", 3 / COACH_SCALE);
  line(ctx, [[0, -130], [0, -40]], 14, "#2b2f38", 3 / COACH_SCALE);
  line(ctx, [[-70, -30], [70, -30]], 12, "#2b2f38", 3 / COACH_SCALE);
  circle(ctx, -70, -18, 10, "#111", 0);
  circle(ctx, 70, -18, 10, "#111", 0);
  poly(ctx, [[-80, -160], [80, -160], [74, -126], [-74, -126]], "#5b616f", 3 / COACH_SCALE);
}

function goldTint(ctx, x, y, r, now) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#ffcc33";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const f = Math.floor(now * 6) % 2;
  outlinedText(ctx, "✦", x + r * 0.9, y - r * 0.9 - f * 2, 14, "#fff6a8", OUT, 3);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.newAds();
    this.resize();
    // 전광판 글자를 전부 받아 둔 뒤 다시 그린다 (캔버스 글자는 웹 글꼴 다운로드를 일으키지 않음)
    loadAdFont(`italic 30px ${FONT}`).then(() => this.buildBgs());
  }

  // 전광판 문구를 새로 뽑는다 (관중 애니메이션 두 장은 같은 문구)
  newAds() {
    this.ads = pickAds(8);
    this.buildBgs();
  }

  buildBgs() {
    this.bgs = [buildBackground(0, this.ads), buildBackground(1, this.ads)];
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 화면이 90도 돌아가 있어도 돌리기 전 크기로 잰다
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.scale = this.canvas.width / W;
  }

  draw(v) {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const now = v.now / 1000;
    const crowdFrame = Math.floor(now * (v.crowdHype ? 8 : 3)) % 2;
    let sx = 0;
    let sy = 0;
    if (v.shake > 0) {
      const f = Math.floor(now * 20);
      sx = (hash(f) - 0.5) * 12 * v.shake;
      sy = (hash(f + 99) - 0.5) * 8 * v.shake;
    }
    ctx.save();
    ctx.translate(sx, sy);
    ctx.drawImage(this.bgs[crowdFrame], -8, -8, W + 16, H + 16);
    drawCart(ctx, v.cartCount || 0, v.cartShake || 0);
    this.drawCoach(ctx, v.coach || { pose: "sit" }, now);
    this.drawPlayer(ctx, v.player, now);
    for (const b of v.balls || []) this.drawGameBall(ctx, b, now);
    ctx.restore();

    this.drawHud(ctx, v, now);
    for (const p of v.texts || []) this.drawFloat(ctx, p, now);
    if (v.banner) this.drawBanner(ctx, v.banner, now);
  }

  drawPlayer(ctx, p, now) {
    if (!p) return;
    const speed = Math.abs(p.vx);
    let pose;
    if (p.mood === "cheer") pose = PL.cheer[Math.floor(now * 10) % 2];
    else if (p.mood === "sad") pose = PL.sad[Math.min(1, Math.floor(p.moodT * 6))];
    else if (p.nod) pose = PL.nod;
    else if (speed > 150) pose = PL.run[Math.floor(now * 14) % 3];
    else pose = PL.idle[Math.floor(now * 3) % 2];
    // 속도에 비례해 부드럽게 기운다 (방향이 바뀌어도 툭 꺾이지 않게)
    if (!p.nod && !p.mood) pose = rotatePose(pose, clamp01(speed / PLAYER_SPEED_REF) * Math.sign(p.vx) * 0.14, 0, 0);
    ctx.save();
    ctx.translate(p.x, GROUND_Y);
    ctx.scale(PLAYER_SCALE, PLAYER_SCALE);
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 70, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    const look = { ...PLAYER_LOOK, face: p.face, lookX: p.lookX || 0 };
    drawPerson(ctx, boil(pose, Math.floor(now * 8), 1.5), look, 3 / PLAYER_SCALE);
    ctx.restore();
  }

  drawCoach(ctx, c, now) {
    const pose = boil(CO[c.pose] || CO.sit, Math.floor(now * 6) + 900, 4);
    ctx.save();
    ctx.translate(COACH_ROOT[0], COACH_ROOT[1]);
    ctx.scale(COACH_SCALE, COACH_SCALE);
    drawChair(ctx);
    drawPerson(ctx, pose, { ...COACH_LOOK, face: c.face, lookX: -0.8 }, 3 / COACH_SCALE);
    ctx.restore();
    if (c.holding) {
      const [hx, hy] = pose.hl;
      drawBall(ctx, COACH_ROOT[0] + hx * COACH_SCALE, COACH_ROOT[1] + hy * COACH_SCALE, BALL_R, 0);
      if (c.gold) goldTint(ctx, COACH_ROOT[0] + hx * COACH_SCALE, COACH_ROOT[1] + hy * COACH_SCALE, BALL_R, now);
    }
  }

  drawGameBall(ctx, b, now) {
    ctx.save();
    if (b.fade != null) ctx.globalAlpha = b.fade;
    drawBall(ctx, b.x, b.y, BALL_R, b.spin);
    if (b.gold) goldTint(ctx, b.x, b.y, BALL_R, now);
    ctx.restore();
    if (!b.flying) return;
    if (b.conflict) {
      // 둘 다 못 받는 순간: 공 자체를 빨갛게 깜빡인다
      ctx.lineWidth = 4;
      ctx.strokeStyle = Math.floor(now * 8) % 2 ? "#ff3b3b" : "#ff9b9b";
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.conflict) outlinedText(ctx, "!", b.x, b.y - BALL_R - 16, 24, "#ff6b6b", OUT, 4);
  }

  drawHud(ctx, v, now) {
    const h = v.hud;
    if (!h) return;
    // 배달 개수 (이 게임의 점수)
    glossBox(ctx, 320, 6, 160, 38, "#ffd23f", "#e08a00", 8);
    drawBall(ctx, 346, 25, 12, 0);
    outlinedText(ctx, `${h.delivered}개`, 412, 26, 26, "#fff", "#5a3000", 5);
    if (h.misses > 0) outlinedText(ctx, `놓침 ${h.misses}`, 400, 60, 15, "#ffb3b3", OUT, 3);
    // 남은 시간: 빨간 공 모양
    const secs = Math.ceil(h.timeLeft);
    const hurry = secs <= 10;
    const g = ctx.createRadialGradient(706, 22, 4, 712, 30, 28);
    g.addColorStop(0, "#ff7a6b");
    g.addColorStop(1, "#c4231a");
    circle(ctx, 712, 30, 25 + (hurry && Math.floor(now * 4) % 2 ? 2 : 0), g, 3);
    outlinedText(ctx, String(secs), 712, 31, 24, hurry ? "#ffe14d" : "#7fffe0", OUT, 4);
  }

  drawFloat(ctx, p, now) {
    const t = now - p.t0;
    if (t < 0 || t > 0.9) return;
    ctx.save();
    ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.3 : 1;
    const k = t < 0.07 ? 0.6 : t < 0.14 ? 1.2 : 1;
    ctx.translate(p.x, p.y - t * 40);
    ctx.scale(k, k);
    outlinedText(ctx, p.text, 0, 0, p.size || 22, p.color || "#fff", OUT, 5);
    ctx.restore();
  }

  drawBanner(ctx, b, now) {
    const t = now - b.t0;
    const x = t < 0.08 ? 900 : t < 0.16 ? 360 : 400;
    ctx.save();
    ctx.translate(x, 250);
    ctx.rotate(-0.04);
    if (b.big) {
      const k = t % 1 < 0.08 ? 1.3 : 1;
      ctx.scale(k, k);
      outlinedText(ctx, b.title, 0, 0, 110, b.c1 || "#ffe14d", OUT, 14);
    } else {
      glossBox(ctx, -230, -46, 460, 92, b.c1 || "#ffd23f", b.c2 || "#e07a00", 12);
      outlinedText(ctx, b.title, 0, -12, 34, "#fff", OUT, 7);
      if (b.sub) outlinedText(ctx, b.sub, 0, 26, 19, "#fff", OUT, 4);
    }
    ctx.restore();
  }
}

