// 효과음은 파일 없이 WebAudio로 그때그때 만든다 (뿅뿅 플래시 게임 느낌).
let ac = null;
let master = null;
let noiseBuf = null;
// 볼륨 0~1 (기본 0.8). 귀로 듣는 크기에 맞추려고 제곱해서 건다.
// 최대(1)에서도 모든 효과음이 한꺼번에 울릴 때 0.9를 안 넘게 MAX_GAIN을 잡았다 (클리핑 없음).
const VOLUME_KEY = "pkVolume";
const MAX_GAIN = 0.78;
let volume = 0.8;
try {
  const saved = localStorage.getItem(VOLUME_KEY);
  if (saved !== null) volume = Math.max(0, Math.min(1, Number(saved)));
  // 예전 음소거 설정을 이어받는다
  else if (localStorage.getItem("pkMuted") === "1") volume = 0;
} catch (_) {
  // 무시
}
const gainOf = (v) => MAX_GAIN * v * v;

export function unlockAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    // 리미터(컴프레서)는 일부러 안 건다: 짧은 킥 소리를 뭉개 버린다. 대신 모든 효과음이
    // 한꺼번에 울려도 0.6을 안 넘게 크기를 맞춰 둬서 찢어질(클리핑) 일이 없다.
    master.gain.value = gainOf(volume);
    master.connect(ac.destination);
    // 함성용 잡음은 한 번만 만들어 두고 돌려쓴다 (골 순간에 큰 배열을 새로 채우면 폰에서 버벅임)
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 2.5), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  // iOS는 전화·백그라운드 뒤에 "interrupted"로 멈춰 있을 수 있다
  if (ac.state !== "running") ac.resume().catch(() => {});
}

export function getVolume() {
  return volume;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch (_) {
    // 저장 못 해도 이번 판에는 적용된다
  }
  // 확 바꾸면 '틱' 소리가 나서 아주 짧게 줄였다 키운다
  if (master) master.gain.setTargetAtTime(gainOf(volume), ac.currentTime, 0.015);
}

function tone(freq, dur, { type = "sine", gain = 0.3, slide = 0, delay = 0 } = {}) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  // 시작을 4ms 동안 올려서 '톡' 하는 시작 잡음을 없앤다
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.3, freq = 1000, q = 1, delay = 0, attack = 0.01 } = {}) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  // 겹쳐 울릴 때 같은 잡음끼리 더해져 커지지 않게 시작 위치를 흩뜨린다
  const len = Math.min(dur, noiseBuf.duration);
  src.start(t, Math.random() * (noiseBuf.duration - len), len);
}

export const sfx = {
  click: () => tone(660, 0.06, { type: "square", gain: 0.12 }),
  tick: () => tone(1200, 0.05, { type: "square", gain: 0.1 }),
  whistle: () => {
    tone(2300, 0.35, { type: "sine", gain: 0.18 });
    tone(2450, 0.35, { type: "sine", gain: 0.12 });
  },
  lock: () => tone(880, 0.08, { type: "square", gain: 0.12 }),
  kick: () => {
    // 폰 스피커는 100Hz 아래를 못 내서 너무 낮으면 '부욱' 하고 갈라진다 → 조금 높게
    tone(180, 0.15, { type: "sine", gain: 0.5, slide: -90 });
    noise(0.06, { gain: 0.3, freq: 1800 });
  },
  goal: () => {
    noise(2.2, { gain: 0.35, freq: 900, q: 0.5, attack: 0.15 });
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, { type: "square", gain: 0.1, delay: i * 0.09 }));
  },
  save: () => {
    tone(300, 0.1, { type: "square", gain: 0.2 });
    noise(1.4, { gain: 0.22, freq: 700, q: 0.6, attack: 0.1 });
  },
  post: () => {
    tone(1250, 0.6, { type: "triangle", gain: 0.25 });
    tone(1870, 0.5, { type: "triangle", gain: 0.15 });
  },
  groan: () => tone(260, 0.9, { type: "sawtooth", gain: 0.08, slide: -150 }),
  boing: () => tone(500, 0.5, { type: "square", gain: 0.12, slide: -380 }),
  ouch: () => tone(900, 0.25, { type: "square", gain: 0.1, slide: 600 }),
  win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.2, { type: "square", gain: 0.1, delay: i * 0.12 })),
  lose: () => [392, 370, 349, 262].forEach((f, i) => tone(f, 0.3, { type: "sawtooth", gain: 0.07, delay: i * 0.22 })),
};
