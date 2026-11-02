// 효과음은 전부 WebAudio로 실시간 합성한다 (음원 파일 0개). 세기 i는 0..1이고
// 볼륨, 피치, 길이에 반영된다. 같은 소리가 한꺼번에 몰리면 뭉개지니 종류별로 개수를 제한한다.

const VOLUME_KEY = "bobbleVolume";
let ctx = null;
let master = null;
let noiseBuf = null;
let brownBuf = null;
let aimStep = -1;
let volume = 0.8;
const recent = {};

try {
  const saved = localStorage.getItem(VOLUME_KEY);
  if (saved !== null) volume = Math.max(0, Math.min(1, Number(saved)));
} catch (_) {
  volume = 0.8;
}

export function getVolume() {
  return volume;
}

// 0..1. 귀로 듣는 크기에 맞추려고 제곱해서 건다.
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch (_) {
    // 저장 못 해도 이번 세션에는 적용된다
  }
  if (master) master.gain.setTargetAtTime(volume * volume * 1.1, ctx.currentTime, 0.02);
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master = ctx.createGain();
  master.gain.value = volume * volume * 1.1;
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  brownBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const bd = brownBuf.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < bd.length; i++) {
    lastOut = (lastOut + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    bd[i] = lastOut * 3.5;
  }
}

function ready() {
  return !!ctx && ctx.state === "running";
}

function allow(type, max = 3, win = 0.06) {
  const now = ctx.currentTime;
  const arr = (recent[type] || []).filter((t) => now - t < win);
  if (arr.length >= max) return false;
  arr.push(now);
  recent[type] = arr;
  return true;
}

const jit = (amt = 0.05) => 1 + (Math.random() * 2 - 1) * amt;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function envGain(t0, attack, peak, decay, dest = master) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(dest);
  return g;
}

function tone({ type = "sine", f0, f1 = f0, dur, peak, attack = 0.002, t0 = ctx.currentTime, dest = master, glide = dur }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + glide);
  const g = envGain(t0, attack, peak, dur, dest);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + attack + dur + 0.05);
  return o;
}

function noise({ dur, peak, type = "bandpass", f0, f1 = f0, q = 1, attack = 0.002, t0 = ctx.currentTime, dest = master }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = envGain(t0, attack, peak, dur, dest);
  src.connect(f);
  f.connect(g);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + attack + dur + 0.05);
}

export const sfx = {
  // 공 차는 "퍽": 내려가는 저음 + 짧은 클릭 + 중음 타격
  kick(i) {
    if (!ready() || !allow("kick", 2)) return;
    i = clamp01(i);
    const j = jit();
    tone({ f0: 170 * j, f1: 46, dur: 0.12 + i * 0.06, peak: 0.35 + i * 0.6, glide: 0.09 });
    tone({ type: "triangle", f0: 360 * j, f1: 170, dur: 0.05, peak: 0.12 + i * 0.25 });
    noise({ dur: 0.02, peak: 0.15 + i * 0.35, type: "highpass", f0: 2600, q: 0.7 });
  },
  // 알끼리 "딱": 단단한 플라스틱
  bump(i) {
    if (!ready() || !allow("bump", 3)) return;
    i = clamp01(i);
    const j = jit(0.08);
    tone({ type: "triangle", f0: 980 * j, f1: 640 * j, dur: 0.05, peak: 0.12 + i * 0.4 });
    tone({ type: "square", f0: 2100 * j, f1: 1500, dur: 0.018, peak: 0.03 + i * 0.07 });
    noise({ dur: 0.03, peak: 0.08 + i * 0.25, f0: 3300 * j, q: 3 });
    tone({ f0: 210 * j, f1: 120, dur: 0.06, peak: 0.08 + i * 0.2 });
  },
  // 펜스 "텅"
  wall(i) {
    if (!ready() || !allow("wall", 3)) return;
    i = clamp01(i);
    const j = jit();
    tone({ f0: 125 * j, f1: 70, dur: 0.14, peak: 0.12 + i * 0.4 });
    noise({ dur: 0.08, peak: 0.06 + i * 0.2, type: "lowpass", f0: 700, q: 0.8 });
    tone({ type: "square", f0: 190 * j, f1: 160, dur: 0.05, peak: 0.02 + i * 0.05 });
  },
  // 골포스트 "땡~": 비배음 부분음들
  post(i) {
    if (!ready() || !allow("post", 1, 0.12)) return;
    i = clamp01(i);
    const j = jit(0.02);
    const parts = [[523, 0.9, 1], [1347, 0.6, 0.6], [2093, 0.42, 0.42], [2960, 0.26, 0.3]];
    for (const [f, d, a] of parts) tone({ f0: f * j, dur: d * (0.6 + i * 0.5), peak: (0.08 + i * 0.25) * a, attack: 0.001 });
    noise({ dur: 0.03, peak: 0.2 * i + 0.05, type: "highpass", f0: 4000 });
  },
  // 골망 "촤악"
  net(i) {
    if (!ready() || !allow("net", 1, 0.25)) return;
    i = clamp01(i);
    noise({ dur: 0.45, peak: 0.15 + i * 0.4, f0: 900, f1: 2800, q: 0.9, attack: 0.01 });
    tone({ f0: 90, f1: 60, dur: 0.15, peak: 0.1 + i * 0.2 });
  },
  launch(n = 1) {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise({ dur: 0.28, peak: 0.12 + Math.min(1, n / 6) * 0.15, f0: 420, f1: 2400, q: 1.4, attack: 0.03, t0: t });
    tone({ type: "triangle", f0: 240, f1: 520, dur: 0.12, peak: 0.06, t0: t });
  },
  whistle(n = 1) {
    if (!ready()) return;
    let t = ctx.currentTime + 0.02;
    for (let k = 0; k < n; k++) {
      const long = k === n - 1 && n > 1;
      const dur = long ? 0.7 : 0.32;
      const o = ctx.createOscillator();
      o.frequency.value = 2850;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 26;
      const lg = ctx.createGain();
      lg.gain.value = 160;
      lfo.connect(lg);
      lg.connect(o.frequency);
      const g = envGain(t, 0.015, 0.16, dur);
      o.connect(g);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.1);
      lfo.stop(t + dur + 0.1);
      noise({ dur, peak: 0.04, f0: 3000, q: 2, t0: t, attack: 0.015 });
      t += dur + 0.12;
    }
  },
  click() {
    if (!ready()) return;
    tone({ f0: 900, f1: 620, dur: 0.035, peak: 0.12 });
  },
  pop() {
    if (!ready()) return;
    tone({ f0: 420, f1: 980, dur: 0.06, peak: 0.16 });
  },
  cancel() {
    if (!ready()) return;
    tone({ type: "triangle", f0: 520, f1: 260, dur: 0.08, peak: 0.1 });
  },
  // 조준: 계속 울리는 톤 대신 세기 10단계마다 작은 "딸깍". 끝까지 당기면 낮은 "톡".
  aimStart() {
    aimStep = -1;
  },
  aimUpdate(p) {
    if (!ready()) return;
    const stepNo = p <= 0 ? -1 : Math.min(10, Math.floor(p * 10));
    if (stepNo === aimStep) return;
    const up = stepNo > aimStep;
    aimStep = stepNo;
    if (stepNo < 0 || !up) return;
    if (stepNo === 10) {
      tone({ type: "triangle", f0: 330, f1: 260, dur: 0.06, peak: 0.12 });
      return;
    }
    tone({ type: "sine", f0: 1100 + stepNo * 70, dur: 0.018, peak: 0.035 + stepNo * 0.004 });
  },
  aimEnd() {
    aimStep = -1;
  },
  // 골대 바꾸기: 양쪽에서 휙 엇갈리는 소리 + 띠링
  swap() {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise({ dur: 0.5, peak: 0.22, f0: 300, f1: 2600, q: 1.2, attack: 0.05, t0: t });
    noise({ dur: 0.5, peak: 0.18, f0: 2600, f1: 300, q: 1.2, attack: 0.05, t0: t + 0.08 });
    for (const [f, dt] of [[784, 0.35], [988, 0.45], [1319, 0.55]]) tone({ type: "triangle", f0: f, dur: 0.35, peak: 0.12, t0: t + dt });
  },
  // 코너 범퍼 "뿅"
  bumper(i) {
    if (!ready() || !allow("bumper", 2)) return;
    i = clamp01(i);
    const j = jit(0.04);
    tone({ type: "triangle", f0: 240 * j, f1: 720 * j, dur: 0.16, peak: 0.12 + i * 0.25, glide: 0.08 });
    tone({ f0: 120, f1: 70, dur: 0.1, peak: 0.1 + i * 0.2 });
    noise({ dur: 0.03, peak: 0.08 + i * 0.15, type: "highpass", f0: 2500 });
  },
  goal() {
    if (!ready()) return;
    const t = ctx.currentTime;
    // 에어혼 빠-바-빠아암
    const notes = [[0, 0.16], [0.22, 0.16], [0.44, 0.8]];
    for (const [dt, dur] of notes) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2400;
      lp.connect(master);
      for (const f of [370, 373.5, 555]) tone({ type: "sawtooth", f0: f, dur, peak: 0.07, attack: 0.02, t0: t + dt, dest: lp });
    }
    // 환호
    this.crowd(0.75, 2.8);
  },
  // 자책골: 뿌우우~ 트롬본
  ownGoal() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1300;
    lp.connect(master);
    const seq = [[294, 0.0, 0.32], [277, 0.36, 0.32], [262, 0.72, 0.32], [233, 1.08, 1.0]];
    for (const [f, dt, dur] of seq) {
      const o = tone({ type: "sawtooth", f0: f, f1: dt > 1 ? f * 0.94 : f, dur, peak: 0.13, attack: 0.03, t0: t + dt, dest: lp });
      if (dt > 1) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 6;
        const lg = ctx.createGain();
        lg.gain.value = 7;
        lfo.connect(lg);
        lg.connect(o.frequency);
        lfo.start(t + dt);
        lfo.stop(t + dt + dur + 0.1);
      }
    }
  },
  // 관중 반응 "우와~": 한 번 울리고 사라지는 소리. 계속 깔리는 배경음은 두지 않는다.
  // 브라운 노이즈를 사람 목소리 대역 두 군데로 걸러내고, 여러 사람이 섞인 느낌이 나게
  // 서로 다른 빠르기의 떨림을 겹친다.
  crowd(level = 0.2, dur = 1.2) {
    if (!ready() || !allow("crowd", 1, 0.5)) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = brownBuf;
    const out = envGain(t, Math.min(0.35, dur * 0.25), level, dur);
    const trem = ctx.createGain();
    trem.gain.value = 0.8;
    trem.connect(out);
    for (const [f, q] of [[480, 1.3], [1150, 1.8]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(f * 0.9, t);
      bp.frequency.linearRampToValueAtTime(f * 1.08, t + dur * 0.4);
      bp.Q.value = q;
      src.connect(bp);
      bp.connect(trem);
    }
    for (const rate of [5.3, 7.1, 8.7]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate * jit(0.1);
      const lg = ctx.createGain();
      lg.gain.value = 0.07;
      lfo.connect(lg);
      lg.connect(trem.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.6);
    }
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.6);
  },
};
