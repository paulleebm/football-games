import * as THREE from "three";
import { FIELD, WALLS, BOBBLE_R, BALL_R, ITEM_R, BUMPERS, BUMPER_R, BUMPER_TUBE, tiltDir, flatness, flatInNet } from "./physics.js";

// 물리 좌표 (x, y) -> 3D 월드 (x, 0, y). 위쪽이 +Y.
const GOAL_H = 2.3;
const WALL_H = 0.85;
const FLAT_M = new THREE.Matrix4();
const GK_COLORS = { home: "#22c55e", away: "#f97316" };

// 운동장 기울이기 때 경기장이 기우는 각도 (라디안, 약 6도)
const TILT_ANGLE = 0.1;

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function grassTexture() {
  const { halfL: L, halfW: W, goalHalfW: G } = FIELD;
  const S = 32; // px per unit
  return canvasTexture(2 * L * S, 2 * W * S, (g, w, h) => {
    g.fillStyle = "#3a2a1f";
    g.fillRect(0, 0, w, h);
    g.save();
    // 잔디는 범퍼 곡선 안쪽까지만
    g.beginPath();
    g.moveTo(BUMPER_R * S, 0);
    g.lineTo(w - BUMPER_R * S, 0);
    g.arc(w, 0, BUMPER_R * S, Math.PI, Math.PI / 2, true);
    g.lineTo(w, h - BUMPER_R * S);
    g.arc(w, h, BUMPER_R * S, -Math.PI / 2, -Math.PI, true);
    g.lineTo(BUMPER_R * S, h);
    g.arc(0, h, BUMPER_R * S, 0, -Math.PI / 2, true);
    g.lineTo(0, BUMPER_R * S);
    g.arc(0, 0, BUMPER_R * S, Math.PI / 2, 0, true);
    g.closePath();
    g.clip();
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? "#3fa34d" : "#379645";
      g.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
    }
    // 잔디 결
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 5);
    }
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 0.14 * S;
    const m = 0.7 * S;
    // 바깥 라인: 네 모서리는 범퍼 곡선을 따라 안쪽으로 휜다
    const Rl = (BUMPER_R + 2 * BUMPER_TUBE + 0.5) * S;
    const arcs = [[w, 0, Math.PI, Math.PI / 2], [w, h, Math.PI * 1.5, Math.PI], [0, h, 0, -Math.PI / 2], [0, 0, Math.PI / 2, 0]];
    g.beginPath();
    let first = true;
    for (const [cx, cy, a0, a1] of arcs) {
      for (let i = 0; i <= 24; i++) {
        const a = a0 + ((a1 - a0) * i) / 24;
        const x = Math.min(w - m, Math.max(m, cx + Math.cos(a) * Rl));
        const y = Math.min(h - m, Math.max(m, cy + Math.sin(a) * Rl));
        if (first) g.moveTo(x, y);
        else g.lineTo(x, y);
        first = false;
      }
    }
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(w / 2, m);
    g.lineTo(w / 2, h - m);
    g.stroke();
    g.beginPath();
    g.arc(w / 2, h / 2, 4 * S, 0, Math.PI * 2);
    g.stroke();
    // 센터 점만 (페널티 점은 없다)
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.arc(w / 2, h / 2, 0.28 * S, 0, Math.PI * 2);
    g.fill();
    // 풋살 페널티 에어리어 (반원)
    for (const [x, a0, a1] of [[m, -Math.PI / 2, Math.PI / 2], [w - m, Math.PI / 2, (3 * Math.PI) / 2]]) {
      g.beginPath();
      g.arc(x, h / 2, G * S, a0, a1);
      g.stroke();
    }
    // 골 라인 강조
    g.lineWidth = 0.2 * S;
    for (const x of [0.1 * S, w - 0.1 * S]) {
      g.beginPath();
      g.moveTo(x, h / 2 - G * S);
      g.lineTo(x, h / 2 + G * S);
      g.stroke();
    }
  });
}

function netTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 3;
    const n = 8;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo((i * w) / n, 0);
      g.lineTo((i * w) / n, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, (i * h) / n);
      g.lineTo(w, (i * h) / n);
      g.stroke();
    }
  });
}

function jerseyTexture(kit, number, gkColor) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = gkColor || kit.body;
    g.fillRect(0, 0, w, h);
    if (!gkColor && kit.stripes) {
      g.fillStyle = kit.stripes;
      const n = 8;
      for (let i = 0; i < n; i += 2) g.fillRect((i * w) / n, 0, w / n, h);
    }
    if (!gkColor && kit.band) {
      g.fillStyle = kit.band;
      for (const u of [0.25, 0.75]) g.fillRect(u * w - 14, 0, 28, h);
      g.fillStyle = kit.bandEdge || "#ffffff";
      for (const u of [0.25, 0.75]) {
        g.fillRect(u * w - 18, 0, 4, h);
        g.fillRect(u * w + 14, 0, 4, h);
      }
    }
    if (!gkColor && kit.sleeves) {
      g.fillStyle = kit.sleeves;
      g.fillRect(0, 0, w, 16);
    }
    g.fillStyle = kit.trim;
    g.fillRect(0, h - 14, w, 14);
    g.font = "bold 58px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.fillStyle = gkColor ? "#ffffff" : kit.number || kit.trim;
    for (const u of [0.0, 0.5, 1.0]) {
      g.strokeText(String(number), u * w, h / 2);
      g.fillText(String(number), u * w, h / 2);
    }
  });
}

function ballTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = "#fbfbf7";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#1d1d1f";
    const spots = [[0.1, 0.5], [0.3, 0.2], [0.3, 0.8], [0.5, 0.5], [0.7, 0.2], [0.7, 0.8], [0.9, 0.5], [0.0, 0.05], [0.5, 0.0], [0.5, 1.0]];
    for (const [u, v] of spots) {
      g.beginPath();
      const cx = u * w;
      const cy = v * h;
      const r = 30;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }
  });
}

function softDot() {
  return canvasTexture(64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,255,255,0.6)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });
}

// 머리 모양. 머리(구) 중심은 headFacing 기준 (0, 0.85, 0), 반지름 0.8, 얼굴은 +x 쪽.
// SphereGeometry의 phi는 PI가 +x(얼굴), 0이 -x(뒤통수)다.
const HEAD_Y = 0.85;

function sphere(r, mat, { phi0 = 0, phiLen = Math.PI * 2, th0 = 0, thLen = Math.PI, seg = 24 } = {}) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2), phi0, phiLen, th0, thLen), mat);
}

function addCap(g, mat, r = 0.83, cover = 0.42, tilt = 0.25) {
  const cap = sphere(r, mat, { thLen: Math.PI * cover, seg: 28 });
  cap.position.y = HEAD_Y + 0.03;
  cap.rotation.z = tilt;
  g.add(cap);
  return cap;
}

// 머리 위쪽 표면에 작은 덩어리를 흩뿌려 곱슬/트위스트 질감을 낸다
function addBumps(g, mat, n, r, size, stretch = 1, lift = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.618;
    const t = 0.15 + ((i * 0.37) % 1) * 0.9;
    const th = t * 0.62;
    const b = sphere(size, mat, { seg: 10 });
    b.position.set(-Math.cos(a) * Math.sin(th) * r - 0.08, HEAD_Y + Math.cos(th) * r + lift, Math.sin(a) * Math.sin(th) * r);
    b.scale.y = stretch;
    g.add(b);
  }
}

function buildHair(look) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.9 });
  switch (look.hair) {
    case "bald":
      break;
    case "buzz":
      addCap(g, mat, 0.812, 0.36, 0.3);
      break;
    case "swept": {
      addCap(g, mat);
      const quiff = sphere(0.42, mat, { seg: 16 });
      quiff.position.set(0.22, HEAD_Y + 0.72, 0);
      quiff.scale.set(1.15, 0.55, 1.45);
      quiff.rotation.z = -0.35;
      g.add(quiff);
      break;
    }
    case "curly":
      addCap(g, mat, 0.85, 0.45, 0.2);
      addBumps(g, mat, 16, 0.84, 0.17);
      break;
    case "afro": {
      const top = sphere(0.98, mat, { thLen: Math.PI * 0.46, seg: 28 });
      top.position.set(-0.12, HEAD_Y + 0.28, 0);
      g.add(top);
      const back = sphere(0.88, mat, { phi0: -1.2, phiLen: 2.4, th0: Math.PI * 0.3, thLen: Math.PI * 0.42 });
      back.position.y = HEAD_Y;
      g.add(back);
      addBumps(g, mat, 22, 1.0, 0.2, 1, 0.22);
      break;
    }
    case "bun": {
      addCap(g, mat, 0.835, 0.45, 0.35);
      const bun = sphere(0.27, mat, { seg: 14 });
      bun.position.set(-0.62, HEAD_Y + 0.62, 0);
      g.add(bun);
      break;
    }
    case "long": {
      addCap(g, mat, 0.85, 0.46, 0.2);
      const back = sphere(0.87, mat, { phi0: -1.35, phiLen: 2.7, th0: Math.PI * 0.2, thLen: Math.PI * 0.58 });
      back.position.y = HEAD_Y;
      g.add(back);
      break;
    }
    case "twists":
      addCap(g, mat, 0.82, 0.4, 0.25);
      addBumps(g, mat, 18, 0.82, 0.12, 1.9, 0.06);
      break;
    default:
      addCap(g, mat);
  }
  if (look.beard !== "none") {
    const full = look.beard === "full";
    const bmat = new THREE.MeshStandardMaterial({
      color: look.hairColor, roughness: 0.95, transparent: !full, opacity: full ? 1 : 0.2, depthWrite: full,
    });
    const beard = sphere(full ? 0.83 : 0.806, bmat, { phi0: Math.PI - 1.1, phiLen: 2.2, th0: Math.PI * (full ? 0.6 : 0.64), thLen: Math.PI * (full ? 0.33 : 0.27), seg: 24 });
    beard.position.y = HEAD_Y;
    g.add(beard);
    if (full) {
      const chin = sphere(0.24, bmat, { seg: 12 });
      chin.position.set(0.55, HEAD_Y - 0.62, 0);
      chin.scale.set(1, 0.8, 1.4);
      g.add(chin);
    }
  }
  return g;
}

export function powerColor(p) {
  const c = new THREE.Color();
  if (p < 0.5) c.lerpColors(new THREE.Color("#4ade80"), new THREE.Color("#facc15"), p / 0.5);
  else c.lerpColors(new THREE.Color("#facc15"), new THREE.Color("#ef4444"), (p - 0.5) / 0.5);
  return c;
}

// 선수 인형 하나 (받침 + 몸통 + 큰 머리). 경기 화면과 스쿼드 화면 얼굴 그림에 같이 쓴다.
export function buildBobble(kit, body, gkColor, look) {
  const skin = look.skin;
  const group = new THREE.Group();
  // 받침 원판: 슈팅이 약할수록 각진 모양 (물리도 같은 면 방향으로 공을 꺾는다)
  const sides = body.sides || 0;
  const segs = sides || 40;
  const outer = sides ? body.r * (1 + 0.35 / sides) : body.r;
  const basePivot = new THREE.Group();
  group.add(basePivot);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(outer, outer * 1.04, 0.3, segs),
    new THREE.MeshStandardMaterial({ color: kit.body, roughness: 0.35, metalness: 0.1, flatShading: !!sides }),
  );
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  basePivot.add(base);
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(outer * 0.9, outer * 0.9, 0.05, segs),
    new THREE.MeshStandardMaterial({ color: kit.trim, roughness: 0.4 }),
  );
  plate.position.y = 0.32;
  basePivot.add(plate);
  // CylinderGeometry의 꼭짓점 하나를 물리의 rot(공격/조준 방향)에 맞추는 오프셋
  const baseOffset = Math.PI / 2;
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = 0.3;
  group.add(bodyPivot);
  const facing = new THREE.Group();
  bodyPivot.add(facing);
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.6, 0.95, 24),
    new THREE.MeshStandardMaterial({ map: jerseyTexture(kit, look.num, gkColor), roughness: 0.7 }),
  );
  torso.position.y = 0.48;
  torso.rotation.y = Math.PI / 2;
  torso.castShadow = true;
  facing.add(torso);
  const headPivot = new THREE.Group();
  headPivot.position.y = 1.0;
  bodyPivot.add(headPivot);
  const headFacing = new THREE.Group();
  headPivot.add(headFacing);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 10), new THREE.MeshStandardMaterial({ color: skin }));
  neck.position.y = 0.1;
  headFacing.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 28, 20), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 }));
  head.position.y = 0.85;
  head.castShadow = true;
  headFacing.add(head);
  headFacing.add(buildHair(look));
  const eyeMat = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.2 });
  const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), eyeMat);
    eye.position.set(0.7, 0.9, s * 0.27);
    headFacing.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), shineMat);
    shine.position.set(0.8, 0.95, s * 0.27 + 0.03);
    headFacing.add(shine);
  }
  const blush = new THREE.MeshBasicMaterial({ color: "#ff8a8a", transparent: true, opacity: 0.45 });
  for (const s of look.beard === "full" ? [] : [1, -1]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), blush);
    c.position.set(0.66, 0.7, s * 0.45);
    c.rotation.y = Math.PI / 2 - s * 0.6;
    headFacing.add(c);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(body.r * 1.12, body.r * 1.38, 40),
    new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  group.add(ring);
  return {
    group, bodyPivot, facing, headPivot, headFacing, ring, head, torso, basePivot, baseOffset,
    wob: { x: 0, z: 0, vx: 0, vz: 0 },
    squash: 0, squashV: 0, aimSquash: 0, aimDir: { x: 0, y: 0 },
    yaw: body.team === "home" ? 0 : Math.PI,
    pvx: 0, pvy: 0,
  };
}

// 스쿼드 화면용 얼굴 그림: 같은 3D 인형의 머리를 정면에서 찍어 이미지로 만든다
let portraitKit = null;
const portraitCache = new Map();

export function portraitUrl(kit, look, team = "home") {
  const isGk = look.pos === "GK";
  const key = `${look.id}|${kit.body}|${kit.stripes || ""}|${team}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  if (!portraitKit) {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 160;
    const renderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#ffffff", "#8a7a6a", 1.5));
    const key2 = new THREE.DirectionalLight("#fff4e0", 1.6);
    key2.position.set(6, 6, 3);
    scene.add(key2);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    camera.position.set(6.4, 2.45, 0);
    camera.lookAt(0, 2.25, 0);
    portraitKit = { canvas: c, renderer, scene, camera };
  }
  const { renderer, scene, camera, canvas } = portraitKit;
  const v = buildBobble(kit, { r: BOBBLE_R, team, role: isGk ? "gk" : "a" }, isGk ? GK_COLORS[team] : null, look);
  scene.add(v.group);
  renderer.render(scene, camera);
  const url = canvas.toDataURL("image/png");
  scene.remove(v.group);
  disposeTree(v.group);
  portraitCache.set(key, url);
  return url;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

let itemMats = null;
function itemBoxMaterials() {
  if (itemMats) return itemMats;
  const face = canvasTexture(128, 128, (g, w) => {
    const grd = g.createLinearGradient(0, 0, w, w);
    grd.addColorStop(0, "#a855f7");
    grd.addColorStop(1, "#6d28d9");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
    g.font = "bold 76px 'Jua', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.strokeText("?", w / 2, w / 2 + 4);
    g.fillStyle = "#ffffff";
    g.fillText("?", w / 2, w / 2 + 4);
  });
  const m = new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 });
  itemMats = [m, m, m, m, m, m];
  return itemMats;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    // 경기장(잔디·펜스·골대·선수·공·상자·파티클)을 한 묶음으로 둔다. 운동장 기울이기 때 이 묶음만 기운다.
    this.pitch = new THREE.Group();
    this.scene.add(this.pitch);
    this.tiltAngle = 0;
    this.tiltLastT = 0;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);
    this.camBase = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.camCur = { pos: new THREE.Vector3(0, 40, 30), target: new THREE.Vector3() };
    this.camFocus = null; // {x,y,zoom}
    this.shakeOffset = new THREE.Vector3();
    this.dotTex = softDot();
    this.bobbles = new Map();
    this.arrows = new Map();
    this.portrait = false;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.buildLights();
    this.buildField();
    this.buildBumpers();
    this.buildBall();
    this.pullLine = this.buildPullLine();
    this.resize();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight("#eaf4ff", "#2c4a2f", 1.1));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.1);
    sun.position.set(-14, 34, 18);
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(1536, 1536);
    s.camera.left = -26;
    s.camera.right = 26;
    s.camera.top = 18;
    s.camera.bottom = -18;
    s.camera.near = 5;
    s.camera.far = 80;
    s.bias = -0.0006;
    s.normalBias = 0.03;
    this.scene.add(sun);
  }

  buildField() {
    const { halfL: L, halfW: W, goalHalfW: G, goalDepth: D, postR, postIn } = FIELD;
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(2 * L + 12, 1.2, 2 * W + 9),
      new THREE.MeshStandardMaterial({ color: "#3a2a1f", roughness: 0.8 }),
    );
    table.position.y = -0.62;
    table.receiveShadow = true;
    this.scene.add(table);
    // 경기장 밑판: 평소엔 탁자 속에 묻혀 안 보이고, 운동장이 기울면 들린 쪽 옆면과 그 밑 그림자가 드러난다
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2 * L + 0.8, 1, 2 * W + 0.8),
      new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 0.8 }),
    );
    base.position.y = -0.505;
    base.castShadow = true;
    base.receiveShadow = true;
    this.pitch.add(base);
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * L, 2 * W),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.pitch.add(grass);
    for (const s of [1, -1]) {
      const gf = new THREE.Mesh(
        new THREE.PlaneGeometry(D, 2 * G),
        new THREE.MeshStandardMaterial({ color: "#358f42", roughness: 1 }),
      );
      gf.rotation.x = -Math.PI / 2;
      gf.position.set(s * (L + D / 2), 0.001, 0);
      gf.receiveShadow = true;
      this.pitch.add(gf);
    }
    // 펜스
    const boardMat = new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.6 });
    const capMat = new THREE.MeshStandardMaterial({ color: "#1f3b63", roughness: 0.5 });
    // 화면용 펜스는 모서리까지 곧게 이어 그린다 (모서리 안쪽은 범퍼 블록이 채운다)
    const toCorner = (x, y) => {
      if (Math.abs(Math.abs(y) - FIELD.halfW) < 1e-6 && Math.abs(x) < FIELD.halfL) return [Math.sign(x) * (FIELD.halfL + 0.4), y];
      if (Math.abs(Math.abs(x) - FIELD.halfL) < 1e-6 && Math.abs(Math.abs(y) - (FIELD.halfW - BUMPER_R)) < 1e-6) return [x, Math.sign(y) * FIELD.halfW];
      return [x, y];
    };
    for (const raw of WALLS) {
      if (raw.kind !== "wall") continue;
      const [ax, ay] = toCorner(raw.ax, raw.ay);
      const [bx, by] = toCorner(raw.bx, raw.by);
      const seg = { ax, ay, bx, by };
      const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
      const mx = (seg.ax + seg.bx) / 2;
      const my = (seg.ay + seg.by) / 2;
      let nx = -(seg.by - seg.ay) / len;
      let ny = (seg.bx - seg.ax) / len;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      const t = 0.4;
      const board = new THREE.Mesh(new THREE.BoxGeometry(len + 0.12, WALL_H, t), boardMat);
      board.position.set(mx + nx * t / 2, WALL_H / 2, my + ny * t / 2);
      board.rotation.y = -Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
      board.castShadow = true;
      board.receiveShadow = true;
      this.pitch.add(board);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.12, 0.12, t + 0.06), capMat);
      cap.position.set(board.position.x, WALL_H + 0.06, board.position.z);
      cap.rotation.y = board.rotation.y;
      this.pitch.add(cap);
    }
    // 골대
    this.nets = [];
    const postMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3, metalness: 0.2 });
    const netTex = netTexture();
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    this.posts = [];
    for (const s of [1, -1]) {
      // 골포스트·크로스바는 골라인에서 살짝 안쪽 (physics.js POSTS와 같은 자리)
      const x = s * (L - postIn);
      for (const y of [G, -G]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, GOAL_H, 16), postMat);
        p.position.set(x, GOAL_H / 2, y);
        p.castShadow = true;
        this.pitch.add(p);
        this.posts.push({ mesh: p, x, y, wob: 0, t: 0 });
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, 2 * G + postR * 2, 16), postMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(x, GOAL_H, 0);
      bar.castShadow = true;
      this.pitch.add(bar);
      const mkNet = (w, h, rep) => {
        const t = netTex.clone();
        t.needsUpdate = true;
        t.repeat.set(rep[0], rep[1]);
        return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 });
      };
      const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * G, GOAL_H, 16, 8), mkNet(2 * G, GOAL_H, [2 * G / 0.9, GOAL_H / 0.9]));
      back.rotation.y = Math.PI / 2;
      back.position.set(s * (L + D), GOAL_H / 2, 0);
      this.pitch.add(back);
      // 지붕·옆 그물은 앞으로 당긴 기둥부터 뒤 그물까지
      const ND = D + postIn;
      const top = new THREE.Mesh(new THREE.PlaneGeometry(ND, 2 * G), mkNet(ND, 2 * G, [ND / 0.9, 2 * G / 0.9]));
      top.rotation.x = -Math.PI / 2;
      top.position.set(s * (L - postIn + ND / 2), GOAL_H, 0);
      this.pitch.add(top);
      for (const y of [G, -G]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(ND, GOAL_H), mkNet(ND, GOAL_H, [ND / 0.9, GOAL_H / 0.9]));
        side.position.set(s * (L - postIn + ND / 2), GOAL_H / 2, y);
        this.pitch.add(side);
      }
      const geo = back.geometry;
      this.nets.push({ side: s, mesh: back, base: Float32Array.from(geo.attributes.position.array), hits: [] });
      for (const y of [G, -G]) {
        const bp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, GOAL_H, 8), postMat);
        bp.position.set(s * (L + D), GOAL_H / 2, y);
        this.pitch.add(bp);
      }
    }
  }

  // 모서리 범퍼: 직선 펜스가 만나는 구석을 펜스와 같은 판재 블록으로 채우고(윗면 테두리는 남색),
  // 블록의 둥근 면 앞에 빨간 고무 쿠션을 단다. 테두리가 끊김 없이 한 덩어리로 보인다.
  buildBumpers() {
    const { halfL: L, halfW: W } = FIELD;
    const R = BUMPER_R;
    const quarter = { "1,1": Math.PI, "-1,1": Math.PI / 2, "1,-1": Math.PI * 1.5, "-1,-1": 0 };
    const boardMat = new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.6 });
    const capMat = new THREE.MeshStandardMaterial({ color: "#1f3b63", roughness: 0.5, side: THREE.DoubleSide });
    this.bumpers = BUMPERS.map((p) => {
      const { sx, sy } = p;
      const t0 = quarter[`${sx},${sy}`];
      // 물리 좌표 (x, y) -> Shape 좌표 (x, -y). Shape를 눕히면 Shape의 y가 월드 -z가 된다.
      const a0 = Math.atan2(0, -sx);
      let da = Math.atan2(-sy, 0) - a0;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const pts = [[sx * L, sy * W]];
      for (let i = 0; i <= 32; i++) {
        const a = a0 + (da * i) / 32;
        pts.push([sx * L + Math.cos(a) * R, sy * W + Math.sin(a) * R]);
      }
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - sx * L, -(y - sy * W))));
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.y);
      const block = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: WALL_H, bevelEnabled: false, curveSegments: 32 }), boardMat);
      block.rotation.x = -Math.PI / 2;
      block.castShadow = true;
      block.receiveShadow = true;
      g.add(block);
      // 윗면: 곡선 쪽 테두리만 남색 (직선 펜스 뚜껑과 같은 폭)
      const capRing = new THREE.Mesh(new THREE.RingGeometry(R - 0.46, R + 0.03, 40, 1, 0, Math.PI / 2), capMat);
      capRing.rotation.x = -Math.PI / 2;
      capRing.rotation.z = t0 - Math.PI / 2;
      capRing.position.y = WALL_H + 0.12;
      g.add(capRing);
      const capEdge = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.12, 40, 1, true, t0, Math.PI / 2), capMat);
      capEdge.position.y = WALL_H + 0.06;
      g.add(capEdge);
      // 튕길 것 같은 통통한 고무 쿠션 (펜스 곡선을 따라 누운 4분의 1 도넛) + 노란 줄
      const tube = (radius, thick, color, y, gloss) => {
        const m = new THREE.Mesh(
          new THREE.TorusGeometry(radius, thick, 16, 48, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color, roughness: gloss, metalness: 0.05, emissive: color, emissiveIntensity: 0 }),
        );
        m.rotation.x = -Math.PI / 2;
        // TorusGeometry는 +x에서 반시계로 그린다. 펜스 곡선(Cylinder 각도 t0)과 같은 4분의 1에 맞춘다.
        m.rotation.z = t0 - Math.PI / 2;
        m.position.y = y;
        m.castShadow = true;
        g.add(m);
        return m;
      };
      // 쿠션은 펜스의 경기장 쪽 면(반지름이 큰 쪽)에 붙어서 경기장으로 튀어나온다
      const tubeR = R + BUMPER_TUBE;
      const rubber = tube(tubeR, BUMPER_TUBE, "#ef3b3b", BUMPER_TUBE + 0.04, 0.28);
      const stripe = tube(tubeR + BUMPER_TUBE - 0.05, 0.07, "#ffe066", BUMPER_TUBE + 0.04, 0.35);
      // 쿠션 끝을 둥글게 막는 공
      for (const end of [t0, t0 + Math.PI / 2]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(BUMPER_TUBE, 16, 12), rubber.material);
        const a = Math.PI / 2 - end;
        cap.position.set(Math.cos(a) * tubeR, BUMPER_TUBE + 0.04, Math.sin(a) * tubeR);
        g.add(cap);
      }
      this.pitch.add(g);
      return { group: g, rubber, stripe, x: p.x, y: p.y, t: 1 };
    });
  }

  bumperHit(x, y) {
    const bp = this.bumpers.find((q) => Math.abs(q.x - x) < 0.01 && Math.abs(q.y - y) < 0.01);
    if (bp) bp.t = 0;
  }

  buildBall() {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 20),
      new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45, emissive: "#ffffff", emissiveIntensity: 0 }),
    );
    ball.castShadow = true;
    ball.position.y = BALL_R;
    this.pitch.add(ball);
    this.ball = ball;
  }

  buildPullLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.8 }));
    line.visible = false;
    this.pitch.add(line);
    return line;
  }

  // 팀 키트를 받아 선수 인형 8개를 만든다.
  // lookOf(body) -> 선수 데이터 (생김새, 등번호)
  setTeams(kits, bodies, lookOf, myTeam = "home") {
    for (const v of this.bobbles.values()) {
      this.pitch.remove(v.group);
      disposeTree(v.group);
    }
    for (const a of this.arrows.values()) this.pitch.remove(a.group);
    this.bobbles.clear();
    this.arrows.clear();
    for (const b of bodies) {
      if (b.kind !== "bobble") continue;
      const kit = kits[b.team];
      const gk = b.keeper ? GK_COLORS[b.team] : null;
      const v = buildBobble(kit, b, gk, lookOf(b));
      this.bobbles.set(b.id, v);
      this.pitch.add(v.group);
      // 화살표는 양 팀 모두 만든다 (상대 것은 VAR을 썼을 때만 보인다)
      const a = this.makeArrow();
      this.arrows.set(b.id, a);
      this.pitch.add(a.group);
    }
  }

  makeArrow() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: "#4ade80", transparent: true, opacity: 0.9, depthWrite: false });
    const shaftGeo = new THREE.PlaneGeometry(1, 0.42);
    shaftGeo.translate(0.5, 0, 0);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.rotation.x = -Math.PI / 2;
    group.add(shaft);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.55);
    shape.lineTo(1.0, 0);
    shape.lineTo(0, -0.55);
    shape.closePath();
    const head = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    head.rotation.x = -Math.PI / 2;
    group.add(head);
    const land = new THREE.Mesh(
      new THREE.RingGeometry(BOBBLE_R * 0.85, BOBBLE_R, 32),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45, depthWrite: false }),
    );
    land.rotation.x = -Math.PI / 2;
    group.add(land);
    group.position.y = 0.05;
    group.visible = false;
    return { group, shaft, head, land, mat };
  }

  // style "opp" = VAR로 미리 보는 상대 이동 (빨간 반투명)
  setArrow(id, body, move, style = "mine") {
    const a = this.arrows.get(id);
    if (!a) return;
    if (!move || move.power <= 0) {
      a.group.visible = false;
      return;
    }
    const dist = move.power * body.maxShot;
    const start = body.r * 0.95;
    const headLen = 1.0;
    const shaftLen = Math.max(0.05, dist - start - headLen);
    a.group.visible = true;
    a.group.position.set(body.x, 0.05, body.y);
    a.group.rotation.y = -Math.atan2(move.dy, move.dx);
    a.shaft.position.x = start;
    a.shaft.scale.x = shaftLen;
    a.head.position.x = start + shaftLen;
    a.land.position.x = dist;
    if (style === "opp") {
      a.mat.color.set("#ff5a5a");
      a.mat.opacity = 0.6;
    } else {
      a.mat.color.copy(powerColor(move.power));
      a.mat.opacity = 0.9;
    }
  }

  hideArrows() {
    for (const a of this.arrows.values()) a.group.visible = false;
  }

  setPull(body, px, py) {
    if (!body) {
      this.pullLine.visible = false;
      return;
    }
    const pos = this.pullLine.geometry.attributes.position;
    pos.setXYZ(0, body.x, 0.08, body.y);
    pos.setXYZ(1, px, 0.08, py);
    pos.needsUpdate = true;
    this.pullLine.computeLineDistances();
    this.pullLine.visible = true;
  }

  // 필드 좌표 -> 화면 픽셀 (HUD 요소를 경기장 위에 띄울 때)
  toScreen(x, y) {
    this.pitch.updateMatrixWorld();
    const v = this.pitch.localToWorld(new THREE.Vector3(x, 0, y)).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.pitch.updateMatrixWorld();
    const ground = this.groundPlane.clone().applyMatrix4(this.pitch.matrixWorld);
    if (!this.raycaster.ray.intersectPlane(ground, hit)) return null;
    this.pitch.worldToLocal(hit);
    return { x: hit.x, y: hit.z };
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = h > w * 1.05;
    this.fitCamera();
  }

  // 경기장 전체(골대 포함)가 HUD에 가리지 않고 들어오는 거리를 이분 탐색으로 찾는다.
  fitCamera() {
    const { halfL: L, halfW: W, goalDepth: D } = FIELD;
    const f = this.flip ? -1 : 1;
    const dir = this.portrait ? new THREE.Vector3(-0.62 * f, 1, 0).normalize() : new THREE.Vector3(0, 1, 0.66 * f).normalize();
    const target = this.portrait ? new THREE.Vector3(1.2 * f, 0, 0) : new THREE.Vector3(0, 0, 1.0 * f);
    const pts = [];
    for (const x of [-L - D, L + D]) for (const z of [-W, W]) for (const y of [0, GOAL_H]) pts.push(new THREE.Vector3(x, y, z));
    const cam = this.camera;
    const yTop = 0.78;
    const yBot = -0.86;
    let lo = 10;
    let hi = 200;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, mid);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      let ok = true;
      for (const p of pts) {
        const v = p.clone().project(cam);
        // 세로 화면은 양옆에 여백을 둬서 벽에 붙은 선수도 손가락으로 당길 자리가 있게
        if (Math.abs(v.x) > (this.portrait ? 0.84 : 0.96) || v.y > yTop || v.y < yBot) {
          ok = false;
          break;
        }
      }
      if (ok) hi = mid;
      else lo = mid;
    }
    this.camBase.pos.copy(target).addScaledVector(dir, hi);
    this.camBase.target.copy(target);
    this.camCur.pos.copy(this.camBase.pos);
    this.camCur.target.copy(this.camBase.target);
  }

  // 날아가는 연출 없이 배지를 지금 골대 상태 자리로 바로 옮긴다 (VAR로 되감을 때)
  snapGoalFlags(world) {
    if (!this.goalFlags) return;
    const swapped = world.fx.swap > 0;
    for (const f of Object.values(this.goalFlags)) {
      const want = swapped ? -f.side : f.side;
      f.from = f.to = f.x = want;
      f.t = 1;
    }
  }

  // 골대 주인 표시: 각 골대 위에 그 골대를 지키는 팀의 엠블럼 배지.
  // 골대 바꾸기가 걸리면 두 배지가 포물선을 그리며 서로 자리를 바꾼다.
  setGoalFlags(teams) {
    if (!this.goalFlags) this.goalFlags = {};
    for (const team of ["home", "away"]) {
      const info = teams[team];
      let f = this.goalFlags[team];
      if (!f) {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        sprite.scale.set(2.6, 2.6, 1);
        sprite.renderOrder = 5;
        this.pitch.add(sprite);
        const home = (team === "home" ? -1 : 1) * (FIELD.halfL + FIELD.goalDepth / 2);
        f = { sprite, canvas, tex, key: "", side: home, x: home, from: home, to: home, t: 1 };
        this.goalFlags[team] = f;
      }
      const key = `${info.logo}|${info.color}`;
      if (f.key === key) continue;
      f.key = key;
      const draw = (img) => {
        const g = f.canvas.getContext("2d");
        g.clearRect(0, 0, 128, 128);
        g.beginPath();
        g.arc(64, 64, 58, 0, Math.PI * 2);
        g.fillStyle = "#ffffff";
        g.fill();
        g.lineWidth = 9;
        g.strokeStyle = info.color;
        g.stroke();
        if (img) g.drawImage(img, 26, 26, 76, 76);
        f.tex.needsUpdate = true;
      };
      draw(null);
      const img = new Image();
      img.onload = () => f.key === key && draw(img);
      img.src = info.logo;
    }
  }

  setFlip(on) {
    if (this.flip === on) return;
    this.flip = on;
    this.fitCamera();
  }

  // 필드 위 아이템, 임시 벽, 빙판, 골대 바뀜 표시
  syncField(world, time) {
    const fieldItems = this.fieldItems || (this.fieldItems = new Map());
    const alive = new Set();
    for (const it of world.items) {
      alive.add(it.id);
      let v = fieldItems.get(it.id);
      if (!v) {
        const group = new THREE.Group();
        const box = new THREE.Group();
        const size = ITEM_R * 1.25;
        const cube = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), itemBoxMaterials());
        cube.castShadow = true;
        box.add(cube);
        const ribbonMat = new THREE.MeshStandardMaterial({ color: "#ffe066", roughness: 0.4 });
        for (const [w, d] of [[size * 1.02, size * 0.2], [size * 0.2, size * 1.02]]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(w, size * 1.02, d), ribbonMat);
          box.add(band);
        }
        const bow = new THREE.Mesh(new THREE.TorusGeometry(size * 0.2, size * 0.07, 8, 16), ribbonMat);
        bow.position.y = size * 0.58;
        bow.rotation.y = Math.PI / 4;
        box.add(bow);
        box.position.y = size / 2;
        group.add(box);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(ITEM_R * 0.95, ITEM_R * 1.15, 40),
          new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.55, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        group.add(ring);
        group.position.set(it.x, 0, it.y);
        this.pitch.add(group);
        v = { group, box, ring, size, born: time };
        fieldItems.set(it.id, v);
      }
      // 튀어나오듯 등장한 뒤 바닥에서 천천히 돈다
      const k = Math.min(1, (time - v.born) * 2.5);
      const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 : 1;
      v.box.scale.setScalar(Math.max(0.01, k * pop));
      v.box.rotation.y = time * 0.8 + it.x;
      v.box.position.y = v.size / 2 + Math.abs(Math.sin(time * 2.2 + it.y)) * 0.12;
      v.ring.material.opacity = 0.35 + 0.25 * Math.sin(time * 4);
    }
    for (const [id, v] of fieldItems) {
      if (alive.has(id)) continue;
      this.pitch.remove(v.group);
      // 상자 재질은 모든 상자가 같이 쓰므로 모양만 정리한다
      v.group.traverse((o) => o.geometry && o.geometry.dispose());
      fieldItems.delete(id);
    }
    // 빙판: 경기장 전체에 반짝이는 얼음막
    if (!this.iceSheet) {
      const tex = canvasTexture(256, 256, (g, w) => {
        g.fillStyle = "rgba(210, 240, 255, 0.55)";
        g.fillRect(0, 0, w, w);
        g.strokeStyle = "rgba(255, 255, 255, 0.55)";
        g.lineWidth = 2;
        for (let i = 0; i < 26; i++) {
          const x = Math.random() * w;
          const y = Math.random() * w;
          const l = 10 + Math.random() * 40;
          const a = Math.random() * Math.PI;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          g.stroke();
        }
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(5, 3);
      this.iceSheet = new THREE.Mesh(
        new THREE.PlaneGeometry(FIELD.halfL * 2, FIELD.halfW * 2),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.05, metalness: 0.35, depthWrite: false }),
      );
      this.iceSheet.rotation.x = -Math.PI / 2;
      this.iceSheet.position.y = 0.015;
      this.iceSheet.visible = false;
      this.pitch.add(this.iceSheet);
    }
    const iceOn = world.fx.ice > 0;
    if (iceOn !== this.iceSheet.visible) this.iceSheet.visible = iceOn;
    if (iceOn) this.iceSheet.material.opacity = 0.85 + Math.sin(time * 2) * 0.1;
    // 운동장 기울이기: 경기장 묶음을 너비 축으로 살짝 돌려 높은 쪽이 들리게 하고, 낮은 끝이 탁자에 닿게 올린다.
    // 준비 시간에도 기울어진 모습만 보일 뿐 공은 출발해야 굴러간다.
    const want = -tiltDir(world) * TILT_ANGLE;
    const dt = Math.min(0.1, Math.max(0, time - this.tiltLastT));
    this.tiltLastT = time;
    this.tiltAngle += (want - this.tiltAngle) * Math.min(1, dt * 5);
    if (Math.abs(this.tiltAngle - want) < 1e-4) this.tiltAngle = want;
    this.pitch.rotation.z = this.tiltAngle;
    this.pitch.position.y = Math.abs(Math.sin(this.tiltAngle)) * (FIELD.halfL + FIELD.goalDepth);
    for (const net of this.nets) net.mesh.material.color.set(world.fx.swap > 0 ? "#ffb020" : "#ffffff");
    // 골대 배지: 바뀌어 있으면 반대편 골대 위로 날아간다
    if (this.goalFlags) {
      const swapped = world.fx.swap > 0;
      for (const team of ["home", "away"]) {
        const f = this.goalFlags[team];
        if (!f) continue;
        const want = swapped ? -f.side : f.side;
        if (want !== f.to) {
          f.from = f.x;
          f.to = want;
          f.t = 0;
        }
        if (f.t < 1) f.t = Math.min(1, f.t + 0.016 / 1.1);
        const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
        f.x = f.from + (f.to - f.from) * e;
        const arc = Math.sin(Math.PI * f.t) * 6;
        const bob = Math.sin(time * 2.2 + (team === "home" ? 0 : 1.5)) * 0.15;
        // 날아가는 동안 서로 부딪히지 않게 앞뒤로 살짝 비켜 간다
        const lane = Math.sin(Math.PI * f.t) * (team === "home" ? 3 : -3);
        f.sprite.position.set(f.x, GOAL_H + 2.1 + arc + bob, lane);
        const s = 2.6 * (1 + Math.sin(Math.PI * f.t) * 0.45);
        f.sprite.scale.set(s, s, 1);
      }
    }
  }

  netHit(side, y, z, strength) {
    const net = this.nets.find((n) => n.side === side);
    if (net) net.hits.push({ y, z, s: strength, t: 0 });
  }

  postHit(x, y, strength) {
    let best = null;
    let bd = 1e9;
    for (const p of this.posts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      best.wob = Math.min(0.12, 0.04 + strength * 0.08);
      best.t = 0;
    }
  }

  kickBall(strength) {
    this.ball.material.emissiveIntensity = Math.min(0.9, 0.3 + strength);
  }

  bobbleImpact(id, amt) {
    const v = this.bobbles.get(id);
    if (v) v.squashV += amt * 6;
  }

  // 물리 상태를 화면에 반영하고 머리 흔들림 등 순수 연출을 진행한다.
  sync(world, dt, opts) {
    // 레드카드로 빠진 선수는 안 보인다
    for (const v of this.bobbles.values()) v.group.visible = false;
    // 그물에 깔려 박힌 선수 자리 (그 동안 그물이 불룩하게 밀려 있다)
    const bulges = [];
    this.netBulges = bulges;
    for (const b of world.bodies) {
      if (b.kind === "ball") {
        const m = this.ball;
        const dx = b.x - m.position.x;
        const dz = b.y - m.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4 && dist < 5) {
          const axis = new THREE.Vector3(dz, 0, -dx).normalize();
          const q = new THREE.Quaternion().setFromAxisAngle(axis, dist / b.r);
          m.quaternion.premultiply(q);
        }
        // 비치볼은 굴러가는 만큼 통통 뛴다
        const sp = Math.hypot(b.vx, b.vy);
        this.hopT = (this.hopT || 0) + dist * 1.3;
        const hop = b.beach ? Math.abs(Math.sin(this.hopT)) * Math.min(1.4, sp * 0.09) : 0;
        m.position.set(b.x, b.r + hop, b.y);
        m.scale.setScalar(b.r / BALL_R);
        m.material.color.set(b.fire ? "#ffb020" : b.beach ? "#ffd9a0" : "#ffffff");
        m.material.emissive.set(b.fire ? "#ff5a00" : "#ffffff");
        m.material.emissiveIntensity = b.fire ? 0.9 : Math.max(0, m.material.emissiveIntensity - dt * 4);
        continue;
      }
      const v = this.bobbles.get(b.id);
      if (!v) continue;
      v.group.visible = true;
      v.group.position.set(b.x, 0, b.y);
      // 각진 원판은 뾰족한 쪽이 공격 방향. 조준 중이면 조준 방향을 미리 보여준다.
      if (b.sides) {
        const aim = opts.faceOf && opts.faceOf[b.id];
        const want = aim !== undefined && aim !== null && opts.idleFace ? aim : b.rot;
        let d = want - (v.baseRot ?? b.rot);
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.baseRot = (v.baseRot ?? b.rot) + d * Math.min(1, dt * 14);
        v.basePivot.rotation.y = v.baseOffset - v.baseRot;
      }
      const full = b.fullR || b.r;
      const grow = full / (b.baseR || full);
      v.group.scale.setScalar(v.group.scale.x + (grow - v.group.scale.x) * Math.min(1, dt * 8));
      // 파워슛에 끌려가 벽에 깔린 선수: 벽 법선 방향으로 납작, 벽을 따라 넓게 퍼졌다가 부풀면 통 튕긴다
      const fl = flatness(b);
      if (fl > 0) {
        const phi = Math.atan2(-b.flatNy, b.flatNx);
        const m = v.group.matrix;
        m.makeRotationY(phi);
        m.multiply(FLAT_M.makeScale(1 - fl * 0.55, 1 - fl * 0.2, 1 + fl * 0.6));
        m.multiply(FLAT_M.makeRotationY(-phi));
        m.multiply(FLAT_M.makeScale(v.group.scale.x, v.group.scale.x, v.group.scale.x));
        // 벽·그물 속으로 조금 박혀 들어간 것처럼 법선 반대쪽으로 밀어 그린다 (몸 절반쯤은 벽 밖으로 보이게)
        const inNet = flatInNet(b);
        const embed = fl * (inNet ? 0.7 : 0.25);
        m.setPosition(b.x - b.flatNx * embed, 0, b.y - b.flatNy * embed);
        v.group.matrixAutoUpdate = false;
        v.group.matrixWorldNeedsUpdate = true;
        if (inNet) bulges.push({ side: Math.sign(b.x), y: b.y, s: 1.4 * fl });
        v.flatNet = inNet ? { side: Math.sign(b.x), y: b.y } : null;
      } else if (!v.group.matrixAutoUpdate) {
        v.group.matrixAutoUpdate = true;
        v.squashV -= 7;
        // 빠져나오면서 그물이 출렁
        if (v.flatNet) this.netHit(v.flatNet.side, v.flatNet.y, 1.2, -0.9);
        v.flatNet = null;
      }
      // 속도 변화(가속)를 머리 스프링에 넣어서 출발, 충돌, 정지 때 머리가 흔들흔들
      const dvx = b.vx - v.pvx;
      const dvy = b.vy - v.pvy;
      v.pvx = b.vx;
      v.pvy = b.vy;
      const w = v.wob;
      w.vx -= dvx * 0.22;
      w.vz -= dvy * 0.22;
      const k = 130;
      const c = 5.5;
      w.vx += (-k * w.x - c * w.vx) * dt;
      w.vz += (-k * w.z - c * w.vz) * dt;
      w.x += w.vx * dt;
      w.z += w.vz * dt;
      w.x = Math.max(-0.65, Math.min(0.65, w.x));
      w.z = Math.max(-0.65, Math.min(0.65, w.z));
      let ax = w.x;
      let az = w.z;
      // 조준 중에는 당기는 방향으로 몸이 젖혀진다
      if (v.aimSquash > 0) {
        ax += v.aimDir.x * v.aimSquash * 0.45;
        az += v.aimDir.y * v.aimSquash * 0.45;
      }
      v.headPivot.rotation.set(az, 0, -ax);
      v.bodyPivot.rotation.set(az * 0.25, 0, -ax * 0.25);
      // 찌그러짐 스프링
      v.squashV += (-90 * v.squash - 9 * v.squashV) * dt;
      v.squash += v.squashV * dt;
      const sq = Math.max(-0.35, Math.min(0.35, v.squash + v.aimSquash * 0.22));
      v.bodyPivot.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
      // 바라보는 방향
      const sp = Math.hypot(b.vx, b.vy);
      let want = v.yaw;
      if (sp > 0.6) want = Math.atan2(b.vy, b.vx);
      else if (opts.faceOf && opts.faceOf[b.id]) want = opts.faceOf[b.id];
      else if (opts.idleFace) want = b.team === "home" ? 0 : Math.PI;
      let diff = want - v.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      v.yaw += diff * Math.min(1, dt * 10);
      v.facing.rotation.y = -v.yaw;
      v.headFacing.rotation.y = -v.yaw;
      // 계획 페이즈 링
      const ringState = opts.rings && opts.rings[b.id];
      v.ring.visible = !!ringState;
      if (ringState) {
        const pulse = 0.55 + 0.35 * Math.sin(opts.time * 6);
        v.ring.material.color.set(ringState === "set" ? "#4ade80" : ringState === "active" ? "#facc15" : ringState === "foe" ? "#ef4444" : "#ffffff");
        v.ring.material.opacity = ringState === "idle" || ringState === "foe" ? pulse : 0.85;
      }
    }
    // 범퍼: 맞으면 부풀었다 돌아오고 번쩍
    for (const bp of this.bumpers) {
      if (bp.t >= 1) continue;
      bp.t = Math.min(1, bp.t + dt * 4);
      // 쿠션이 통통 부풀었다 돌아오며 번쩍
      const k = Math.sin(bp.t * Math.PI * 2.5) * (1 - bp.t);
      for (const m of [bp.rubber, bp.stripe]) m.scale.set(1 - k * 0.03, 1 - k * 0.03, 1 + k * 0.35);
      bp.rubber.material.emissiveIntensity = (1 - bp.t) * 0.6;
    }
    // 골포스트 진동
    for (const p of this.posts) {
      if (p.wob <= 0) continue;
      p.t += dt;
      const a = p.wob * Math.exp(-p.t * 7) * Math.sin(p.t * 60);
      p.mesh.rotation.x = a;
      p.mesh.rotation.z = a * 0.6;
      if (p.t > 1) {
        p.wob = 0;
        p.mesh.rotation.set(0, 0, 0);
      }
    }
    // 골망 출렁임
    for (const net of this.nets) {
      const held = (this.netBulges || []).filter((h) => h.side === net.side);
      if (!net.hits.length && !held.length) {
        if (net.held) {
          net.mesh.geometry.attributes.position.array.set(net.base);
          net.mesh.geometry.attributes.position.needsUpdate = true;
          net.held = false;
        }
        continue;
      }
      net.held = held.length > 0;
      const pos = net.mesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        // PlaneGeometry 로컬 (x=폭, y=높이, z=법선) -> 법선 방향으로 밀기
        const lx = net.base[i];
        const ly = net.base[i + 1];
        let off = 0;
        for (const h of net.hits) {
          // 뒷망은 y축으로 90도 돌려 놓아서 로컬 x = -(월드 z), 로컬 z = 월드 +x
          const d = Math.hypot(lx + h.y, ly - (h.z - GOAL_H / 2));
          off += h.s * Math.exp(-d * d * 0.35) * Math.exp(-h.t * 3) * Math.cos(h.t * 14 - d * 2);
        }
        for (const h of held) {
          const d = Math.hypot(lx + h.y, ly - (1.2 - GOAL_H / 2));
          off += h.s * Math.exp(-d * d * 0.12);
        }
        arr[i + 2] = net.base[i + 2] + off * net.side;
      }
      pos.needsUpdate = true;
      for (const h of net.hits) h.t += dt;
      net.hits = net.hits.filter((h) => h.t < 2);
      if (!net.hits.length && !held.length) {
        arr.set(net.base);
        pos.needsUpdate = true;
      }
    }
  }

  setFocus(focus) {
    this.camFocus = focus;
  }

  updateCamera(dt, shake) {
    const basePos = this.camBase.pos.clone();
    const baseTarget = this.camBase.target.clone();
    if (this.camFocus) {
      const f = this.camFocus;
      const ft = new THREE.Vector3(f.x, 0, f.y);
      const pull = f.pull ?? 0.25;
      baseTarget.lerp(ft, pull);
      const off = basePos.clone().sub(this.camBase.target).multiplyScalar(f.zoom ?? 0.9);
      basePos.copy(baseTarget).add(off);
    }
    const k = 1 - Math.exp(-dt * (this.camFocus?.snap ? 9 : 3.2));
    this.camCur.pos.lerp(basePos, k);
    this.camCur.target.lerp(baseTarget, k);
    this.camera.position.copy(this.camCur.pos).add(shake);
    this.camera.lookAt(this.camCur.target.clone().addScaledVector(shake, 0.5));
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
