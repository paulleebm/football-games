// 효과음은 파일 없이 WebAudio로 그때그때 만든다 (뿅뿅 플래시 게임 느낌).
let ac = null;
let master = null;
// 볼륨 0~1 (기기에 저장). 0이면 소리 끔
let volume = 0.7;
const MAX_GAIN = 0.7; // 볼륨 1일 때 실제 출력 크기
// 화면 없이 시뮬레이션할 때(로컬 검증) 소리를 잠깐 끈다
let silent = false;
export function setSilent(v) {
  silent = v;
}
try {
  const v = localStorage.getItem("hdVolume");
  if (v != null && !Number.isNaN(Number(v))) volume = Math.max(0, Math.min(1, Number(v)));
} catch (_) {
  // 무시
}

export function unlockAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = volume * MAX_GAIN;
    // 후반엔 헤딩·발사·놓침 소리가 한꺼번에 겹치므로 리미터로 찢어지는 소리를 막는다
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter).connect(ac.destination);
  }
  if (ac.state === "suspended") ac.resume();
}

export function getVolume() {
  return volume;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem("hdVolume", String(volume));
  } catch (_) {
    // 무시
  }
  // 끊김 없이 바로 바뀌게 아주 짧게 따라간다
  if (master) master.gain.setTargetAtTime(volume * MAX_GAIN, ac.currentTime, 0.015);
}

function tone(freq, dur, { type = "sine", gain = 0.3, slide = 0, delay = 0 } = {}) {
  if (!ac || silent) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.3, freq = 1000, q = 1, delay = 0, attack = 0.01 } = {}) {
  if (!ac || silent) return;
  const t = ac.currentTime + delay;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// H1~H4 헤딩음: 도·레·미·솔. 잘 받으면 멜로디가 된다.
const HEAD_NOTES = [523, 587, 659, 784];

export const sfx = {
  click: () => tone(660, 0.06, { type: "square", gain: 0.12 }),
  tick: () => tone(1200, 0.05, { type: "square", gain: 0.1 }),
  beep: () => tone(880, 0.12, { type: "square", gain: 0.12 }),
  whistle: () => {
    tone(2300, 0.35, { type: "sine", gain: 0.18 });
    tone(2450, 0.35, { type: "sine", gain: 0.12 });
  },
  throw: () => noise(0.18, { gain: 0.18, freq: 2400, q: 0.8, attack: 0.04 }),
  head: (k) => {
    tone(160, 0.08, { type: "sine", gain: 0.4, slide: -60 });
    tone(HEAD_NOTES[k] || 523, 0.16, { type: "square", gain: 0.1 });
  },
  deliver: () => {
    tone(1046, 0.08, { type: "square", gain: 0.1 });
    tone(1318, 0.14, { type: "square", gain: 0.1, delay: 0.07 });
    noise(0.6, { gain: 0.16, freq: 900, q: 0.5, attack: 0.08 });
  },
  gold: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.14, { type: "square", gain: 0.09, delay: i * 0.06 })),
  drop: () => {
    tone(500, 0.4, { type: "square", gain: 0.1, slide: -380 });
    tone(260, 0.7, { type: "sawtooth", gain: 0.06, slide: -150, delay: 0.1 });
  },
  stage: () => {
    tone(392, 0.12, { type: "square", gain: 0.1 });
    tone(523, 0.12, { type: "square", gain: 0.1, delay: 0.12 });
    tone(784, 0.25, { type: "square", gain: 0.1, delay: 0.24 });
  },
  win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.2, { type: "square", gain: 0.1, delay: i * 0.12 })),
  lose: () => [392, 370, 349, 262].forEach((f, i) => tone(f, 0.3, { type: "sawtooth", gain: 0.07, delay: i * 0.22 })),
};
