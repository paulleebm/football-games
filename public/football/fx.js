import * as THREE from "three";

// 타격감 연출: 히트스톱, 슬로우모션, 화면 흔들림, 파티클(충격파 링, 불꽃, 먼지, 꽃가루).
// 물리 시간은 timeScale()을 곱해서 진행하므로 여기서 멈추면 물리도 같이 멈춘다.

const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class FX {
  constructor(stage) {
    this.stage = stage;
    // 파티클도 경기장 묶음에 붙여서 운동장이 기울면 같이 기운다
    this.scene = stage.pitch;
    this.stopLeft = 0;
    this.stopCooldown = 0;
    this.slow = 1;
    this.slowTarget = 1;
    this.trauma = 0;
    this.time = 0;
    this.shake = new THREE.Vector3();
    this.sprites = [];
    this.rings = [];
    this.confetti = [];
    for (let i = 0; i < 160; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: stage.dotTex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.scene.add(s);
      this.sprites.push({ obj: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 0, g: 0, size: 1 });
    }
    const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.rings.push({ obj: m, life: 0, max: 0.4, size: 3 });
    }
    const cGeo = new THREE.PlaneGeometry(0.28, 0.42);
    for (let i = 0; i < 180; i++) {
      const m = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({ color: "#ffffff", side: THREE.DoubleSide, roughness: 0.5 }));
      m.visible = false;
      this.scene.add(m);
      this.confetti.push({ obj: m, life: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0 });
    }
  }

  hitstop(ms) {
    if (REDUCED || this.stopCooldown > 0) return false;
    this.stopLeft = Math.max(this.stopLeft, ms / 1000);
    this.stopCooldown = 0.16;
    return true;
  }

  addTrauma(a) {
    if (REDUCED) return;
    this.trauma = Math.min(1, this.trauma + a);
  }

  setSlow(target) {
    this.slowTarget = REDUCED ? 1 : target;
  }

  resetTime() {
    this.stopLeft = 0;
    this.slow = 1;
    this.slowTarget = 1;
  }

  timeScale() {
    return this.stopLeft > 0 ? 0 : this.slow;
  }

  spawnSprite(x, y, z, color, opts) {
    const p = this.sprites.find((s) => s.life <= 0);
    if (!p) return;
    p.obj.visible = true;
    p.obj.position.set(x, y, z);
    p.obj.material.color.set(color);
    p.obj.material.opacity = 1;
    p.life = p.max = opts.life ?? 0.5;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.vz = opts.vz ?? 0;
    p.g = opts.g ?? 0;
    p.size = opts.size ?? 0.5;
    p.grow = opts.grow ?? 0;
    p.obj.scale.setScalar(p.size);
  }

  ring(x, y, color, size = 3, life = 0.35) {
    const r = this.rings.find((q) => q.life <= 0);
    if (!r) return;
    r.obj.visible = true;
    r.obj.position.set(x, 0.06, y);
    r.obj.material.color.set(color);
    r.life = r.max = life;
    r.size = size;
  }

  // 충격 지점에서 사방으로 튀는 불꽃
  sparks(x, y, colors, n, speed = 9, height = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawnSprite(x, height, y, colors[i % colors.length], {
        vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 2 + Math.random() * 5, g: -18,
        life: 0.25 + Math.random() * 0.25, size: 0.28 + Math.random() * 0.25,
      });
    }
  }

  dust(x, y, n = 6, size = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawnSprite(x + Math.cos(a) * 0.6, 0.2, y + Math.sin(a) * 0.6, "#e7ddc8", {
        vx: Math.cos(a) * 1.6, vz: Math.sin(a) * 1.6, vy: 0.6, life: 0.5 + Math.random() * 0.3, size, grow: 1.6,
      });
    }
  }

  // 불길: 둥근 자리(spread) 안에서 위로 솟는 주황·노랑·빨강 불티
  flames(x, y, n = 3, spread = 1) {
    const colors = ["#ff7a1a", "#ffb020", "#ffe066", "#ff3b1a"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.spawnSprite(x + Math.cos(a) * r, 0.4 + Math.random() * 0.6, y + Math.sin(a) * r, colors[i % colors.length], {
        vx: Math.cos(a) * 0.6, vz: Math.sin(a) * 0.6, vy: 2.5 + Math.random() * 2.5,
        life: 0.3 + Math.random() * 0.25, size: 0.45 + Math.random() * 0.35, grow: -1.2,
      });
    }
  }

  trail(x, y, color = "#ffffff") {
    this.spawnSprite(x, 0.6, y, color, { life: 0.28, size: 0.75, grow: -1.8 });
  }

  confettiBurst(x, y, colors) {
    let k = 0;
    for (const c of this.confetti) {
      if (k > 150) break;
      c.obj.visible = true;
      c.obj.material.color.set(colors[k % colors.length]);
      c.obj.position.set(x + (Math.random() - 0.5) * 2, 1 + Math.random(), y + (Math.random() - 0.5) * 6);
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 9;
      c.vx = Math.cos(a) * s * 0.7 - Math.sign(x) * 3;
      c.vz = Math.sin(a) * s;
      c.vy = 8 + Math.random() * 10;
      c.sx = (Math.random() - 0.5) * 14;
      c.sy = (Math.random() - 0.5) * 14;
      c.life = 2.4 + Math.random() * 1.2;
      k++;
    }
  }

  update(dt) {
    this.time += dt;
    if (this.stopLeft > 0) this.stopLeft -= dt;
    if (this.stopCooldown > 0) this.stopCooldown -= dt;
    this.slow += (this.slowTarget - this.slow) * Math.min(1, dt * 8);
    // 화면 흔들림: trauma^2에 비례, 저주파 노이즈 느낌으로 sin 합성
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const t2 = this.trauma * this.trauma;
    const T = this.time * 38;
    this.shake.set(
      t2 * 1.1 * (Math.sin(T * 1.1) + Math.sin(T * 2.3) * 0.5),
      t2 * 0.8 * Math.sin(T * 1.7 + 1.3),
      t2 * 1.1 * (Math.sin(T * 0.9 + 2.1) + Math.sin(T * 2.9) * 0.5),
    );
    for (const p of this.sprites) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.obj.visible = false;
        continue;
      }
      p.vy += p.g * dt;
      p.obj.position.x += p.vx * dt;
      p.obj.position.y = Math.max(0.05, p.obj.position.y + p.vy * dt);
      p.obj.position.z += p.vz * dt;
      p.size = Math.max(0.02, p.size + p.grow * dt);
      p.obj.scale.setScalar(p.size);
      p.obj.material.opacity = Math.min(1, (p.life / p.max) * 1.5);
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.obj.visible = false;
        continue;
      }
      const k = 1 - r.life / r.max;
      r.obj.scale.setScalar(0.4 + k * r.size);
      r.obj.material.opacity = (1 - k) * 0.9;
    }
    for (const c of this.confetti) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0 || c.obj.position.y < 0.02) {
        if (c.life <= 0) c.obj.visible = false;
        c.vx *= 0.8;
        c.vz *= 0.8;
      }
      c.vy -= 14 * dt;
      c.vx *= 1 - dt * 0.9;
      c.vz *= 1 - dt * 0.9;
      c.vy = Math.max(c.vy, -3.2);
      c.obj.position.x += c.vx * dt;
      c.obj.position.y = Math.max(0.02, c.obj.position.y + c.vy * dt);
      c.obj.position.z += c.vz * dt;
      c.obj.rotation.x += c.sx * dt;
      c.obj.rotation.y += c.sy * dt;
    }
  }
}
