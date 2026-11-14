/* Дворовый спорт — «импакт» в 3D (лапта, пекарь, чиж): пыль из-под ног и от упавшего мяча, вспышка-кольцо и искры
 * на ударе, след за летящим мячом/чижом/палкой, глухой удар в звуке. Всё — спрайты из одного запаса (без сборки мусора).
 * Подключение: const fx = new Fx(yard.scene); каждый кадр fx.update(dt) (до yard.render); по событиям:
 *   fx.dust(x, y, сила) — облачко пыли на земле;  fx.burst(x, y, z, цвет, сила) — вспышка и искры;
 *   fx.trail(x, y, z, цвет) — звать каждый кадр, пока предмет летит быстро (след тает сам);
 *   fx.steps(id, x, y, скорость, dt) — пыль из-под ног бегущего.  Звук: boom(сила) — глухой удар.
 * Толчок камеры, «стоп-кадр» и рывок угла обзора — у площадки: yard.impact(сила) (yard3d.ts). */
import * as THREE from 'three';
import { audioOut, click, tone } from '../audio';
import { W } from './yard3d';

interface P {
  sp: THREE.Sprite;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  s0: number;
  s1: number;
  a0: number;
  g: number;
}

function dotTexture(soft: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (soft) {
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx {
  private pool: P[] = [];
  private live: P[] = [];
  private soft = dotTexture(true);
  private hard = dotTexture(false);
  private group = new THREE.Group();
  private rings: { m: THREE.Mesh; life: number; max: number; r: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.82, 1, 40);
  private stepT = new Map<string, number>();
  private trailT = 0;
  /** Цвет пыли — под землю площадки. */
  dustColor = new THREE.Color('#cdb48c');

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 5;
    scene.add(this.group);
  }

  private spawn(tex: THREE.Texture, add: boolean): P {
    let p = this.pool.pop();
    if (!p) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      p = { sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a0: 1, g: 0 };
    }
    const m = p.sp.material;
    m.map = tex;
    m.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.fog = !add;
    this.group.add(p.sp);
    this.live.push(p);
    return p;
  }

  /** Облачко пыли на земле (x, y — оси игры): power 0,3 — шаг, 1 — мяч упал, 2 — человек упал/палка врезалась. */
  dust(x: number, y: number, power = 1, dir?: [number, number]) {
    const n = Math.round(3 + power * 5);
    for (let i = 0; i < n && this.live.length < 220; i++) {
      const p = this.spawn(this.soft, false);
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random() * 1.1) * Math.sqrt(power);
      p.sp.position.copy(W(x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, 0.08));
      p.vx = Math.cos(a) * v + (dir ? dir[0] * 0.8 : 0);
      p.vy = Math.sin(a) * v + (dir ? dir[1] * 0.8 : 0);
      p.vz = 0.35 + Math.random() * 0.7 * Math.sqrt(power);
      p.g = -0.6;
      p.s0 = 0.18 + power * 0.1;
      p.s1 = 0.7 + power * 0.55 + Math.random() * 0.3;
      p.a0 = 0.5;
      p.max = p.life = 0.55 + Math.random() * 0.5 + power * 0.12;
      p.sp.material.color.copy(this.dustColor);
    }
  }

  /** Вспышка на ударе: расходящееся кольцо и искры (x, y, z — оси игры). */
  burst(x: number, y: number, z: number, color = '#fff2b0', power = 1) {
    const n = Math.round(6 + power * 8);
    for (let i = 0; i < n && this.live.length < 220; i++) {
      const p = this.spawn(this.hard, true);
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * 1.4;
      const v = (3 + Math.random() * 5) * Math.sqrt(power);
      p.sp.position.copy(W(x, y, z));
      p.vx = Math.cos(a) * Math.cos(e) * v;
      p.vy = Math.sin(a) * Math.cos(e) * v;
      p.vz = Math.sin(e) * v + 1;
      p.g = -9;
      p.s0 = 0.16 + power * 0.06;
      p.s1 = 0.02;
      p.a0 = 1;
      p.max = p.life = 0.25 + Math.random() * 0.25;
      p.sp.material.color.set(color);
    }
    // яркое ядро
    const c = this.spawn(this.hard, true);
    c.sp.position.copy(W(x, y, z));
    c.vx = c.vy = c.vz = c.g = 0;
    c.s0 = 0.3 * power;
    c.s1 = 1.0 * power;
    c.a0 = 0.8;
    c.max = c.life = 0.12;
    c.sp.material.color.set(color);
    this.ring(x, y, z, color, 1.1 * power);
  }

  /** Кольцо-волна на земле или в воздухе. */
  ring(x: number, y: number, z: number, color = '#ffffff', r = 1.5) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.copy(W(x, y, Math.max(0.05, z)));
    if (z < 0.4) m.rotation.x = -Math.PI / 2;
    m.userData.flat = z < 0.4;
    this.group.add(m);
    this.rings.push({ m, life: 0.32, max: 0.32, r });
  }

  /** След за быстро летящим предметом: звать каждый кадр полёта. */
  trail(x: number, y: number, z: number, color = '#ffffff', size = 0.14) {
    if (this.live.length > 200) return;
    const p = this.spawn(this.soft, true);
    p.sp.position.copy(W(x, y, z));
    p.vx = p.vy = p.vz = p.g = 0;
    p.s0 = size;
    p.s1 = size * 0.25;
    p.a0 = 0.55;
    p.max = p.life = 0.28;
    p.sp.material.color.set(color);
  }

  /** Пыль из-под ног бегущего: id — кто, v — скорость, м/с. */
  steps(id: string, x: number, y: number, v: number, dt: number) {
    if (v < 4.5) return;
    const t = (this.stepT.get(id) ?? 0) - dt;
    if (t > 0) {
      this.stepT.set(id, t);
      return;
    }
    this.stepT.set(id, 0.16 + Math.random() * 0.05);
    this.dust(x, y, v > 9 ? 0.45 : 0.22);
  }

  update(dt: number, camera?: THREE.Camera) {
    this.trailT += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.sp);
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const k = 1 - p.life / p.max;
      const pos = p.sp.position;
      // three: (x, z, −y)
      pos.x += p.vx * dt;
      pos.z -= p.vy * dt;
      pos.y = Math.max(0.03, pos.y + p.vz * dt);
      p.vz += p.g * dt;
      const dr = Math.exp(-dt * 2.2);
      p.vx *= dr;
      p.vy *= dr;
      const s = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k));
      p.sp.scale.set(s, s, s);
      p.sp.material.opacity = p.a0 * (1 - k) * (1 - k);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.group.remove(r.m);
        (r.m.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const k = 1 - r.life / r.max;
      const s = 0.2 + r.r * (1 - (1 - k) * (1 - k));
      r.m.scale.set(s, s, s);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (!r.m.userData.flat && camera) r.m.quaternion.copy(camera.quaternion);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const p of [...this.live, ...this.pool]) p.sp.material.dispose();
    for (const r of this.rings) (r.m.material as THREE.Material).dispose();
    this.soft.dispose();
    this.hard.dispose();
    this.ringGeo.dispose();
  }
}

/** Глухой удар (бита по мячу, палка по банке, мяч в человека): v 0…1. */
export function boom(v = 1) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = Math.max(0.2, Math.min(1, v));
  tone(t, { freq: 150, to: 48, dur: 0.16, gain: 0.55 * s, type: 'sine' });
  tone(t, { freq: 90, to: 40, dur: 0.22, gain: 0.3 * s, type: 'triangle' });
  click(t, { freq: 1800, q: 1.2, dur: 0.03, gain: 0.35 * s });
}

/** Шлепок мяча/палки о землю. */
export function thump(v = 0.5) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = Math.max(0.15, Math.min(1, v));
  tone(t, { freq: 110, to: 60, dur: 0.09, gain: 0.3 * s, type: 'sine' });
  click(t, { freq: 500, q: 0.8, dur: 0.05, gain: 0.25 * s });
}

/** Гул «у-у-у!» дворовых зрителей не делаем (голосов нет) — вместо него короткая «фанфара» свистом на большом событии. */
export function whistle() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 1900, to: 2500, dur: 0.12, gain: 0.12, type: 'sine' });
  tone(t + 0.13, { freq: 2500, to: 2100, dur: 0.22, gain: 0.12, type: 'sine' });
}
