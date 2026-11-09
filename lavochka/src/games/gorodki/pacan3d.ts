/* Городки — проба «дворового спорта»: стилизованный пацан (KayKit Adventurers «Ranger», CC0, перекрашен в олимпийку
 * бригады — studio/blender/dvor_pacan.py) с готовыми анимациями KayKit (CC0) вместо поз кодом.
 * По умолчанию (решение 2026-11-09: «этот вариант значительно лучше»); ?pacan=0 — назад к людям MakeHuman (запоминается).
 * Модели бригад — public/gorodki/pacan/<бригада>.glb без анимаций, клипы — общий anims.glb (по именам костей). Клипы: idle, hold2h, throw, cheer, sit, wave …
 * Бросок — клип «throw» (из-за правого плеча вперёд: по замеру кисть в самой быстрой точке идёт вперёд, +Z модели),
 * поэтому бросающий стоит почти лицом к городу. Время клипа идёт за фазой броска игры: выпуск биты (фаза RELEASE)
 * совмещён с самой быстрой точкой (ищется по клипу). Горизонтальный взмах «swing1h» не годится — он наотмашь, слева
 * направо. Бита — в кости handslot.r (ось Y кости — вдоль биты). */
import * as THREE from 'three';

/** Пацаны — по умолчанию; ?pacan=0 — прежние люди (запоминается в браузере: адрес партии меняется на ?igra), ?pacan — обратно. */
export const TOON = ((): boolean => {
  if (typeof location === 'undefined') return true;
  const v = new URLSearchParams(location.search).get('pacan');
  try {
    if (v != null) localStorage.setItem('gk-pacan', v === '0' ? '0' : '1');
    return localStorage.getItem('gk-pacan') !== '0';
  } catch {
    return v !== '0';
  }
})();
export const TOON_BASE = `${import.meta.env.BASE_URL}gorodki/pacan/`;
export const TOON_V = 5;
/** Рост пацана, м: крупная голова — ростом чуть ниже взрослого. */
const TOON_H = 1.62;
/** Фаза броска, на которой бита улетает (как в people3d: бита в руке до 0.62). */
const RELEASE = 0.62;
/** Клип броска и стойка с битой у черты (разработка: __toon({ swing, ready, turn, sit })). */
export const TOON_CFG = { swing: 'throw', ready: 'holding', turn: 0.3, sit: 0.12, readyDir: [-0.55, 0.8, 0.25] as [number, number, number] };
if (import.meta.env.DEV) (globalThis as unknown as { __toon: (c: Partial<typeof TOON_CFG>) => void }).__toon = (c) => Object.assign(TOON_CFG, c);

/** Камера прицела для пацанов (scene.ts camTo('aim')): сдвиг вправо, назад от черты, высота, добавка к углу обзора (°). */
export const TOON_CAM = { dx: 1.25, back: 5.8, h: 1.85, fov: 5, lookX: 0, lookZ: 0.2 };
if (import.meta.env.DEV) (globalThis as unknown as { __toonCam: (c: Partial<typeof TOON_CAM>) => void }).__toonCam = (c) => Object.assign(TOON_CAM, c);

export type ToonRole = 'throw' | 'sit' | 'stand';

export class Toon {
  readonly mixer: THREE.AnimationMixer;
  private acts = new Map<string, THREE.AnimationAction>();
  private cur: string | null = null;
  readonly hand: THREE.Object3D | null;
  /** Время самой быстрой точки взмаха в клипе SWING. */
  private rel = -1;
  private relFor = '';
  private scrubbing = false;

  constructor(
    readonly model: THREE.Object3D,
    clips: THREE.AnimationClip[],
    seed: number,
  ) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const k = TOON_H / Math.max(0.1, box.max.y - box.min.y);
    model.scale.setScalar(k);
    model.position.y = -box.min.y * k;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) mt.metalness = 0;
    });
    this.hand = model.getObjectByName('handslotr') ?? model.getObjectByName('handslot.r') ?? null;
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of clips) this.acts.set(c.name, this.mixer.clipAction(c));
    // разный такт у соседей
    this.mixer.setTime((seed * 0.37) % 3);
  }

  private act(name: string) {
    return this.acts.get(name) ?? this.acts.get('idle')!;
  }

  /** Плавно перейти на клип (цикл или один раз с остановкой на последнем кадре). */
  play(name: string, loop = true, fade = 0.25) {
    if (this.scrubbing) {
      this.scrubbing = false;
      this.mixer.stopAllAction();
      this.cur = null;
    }
    if (this.cur === name) return;
    const next = this.act(name);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    const prev = this.cur ? this.act(this.cur) : null;
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.cur = name;
  }

  /** Самая быстрая точка кисти в клипе взмаха — там бита и вылетает. */
  private releaseTime(): number {
    if (this.rel >= 0 && this.relFor === TOON_CFG.swing) return this.rel;
    this.relFor = TOON_CFG.swing;
    const a = this.act(TOON_CFG.swing);
    const dur = a.getClip().duration;
    this.rel = dur * 0.5;
    if (!this.hand) return this.rel;
    this.mixer.stopAllAction();
    a.reset().play();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let best = 0;
    const n = 48;
    for (let i = 0; i <= n; i++) {
      a.time = (dur * i) / n;
      this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      p.setFromMatrixPosition(this.hand.matrixWorld);
      if (i > 0) {
        const v = p.distanceTo(q);
        // только первая половина-две трети: в конце бывает быстрый возврат
        if (v > best && i < n * 0.8) {
          best = v;
          this.rel = (dur * (i - 0.5)) / n;
        }
      }
      q.copy(p);
    }
    this.mixer.stopAllAction();
    this.cur = null;
    return this.rel;
  }

  /** Бросок: время клипа взмаха — по фазе броска игры. */
  scrubThrow(phase: number) {
    const tr = this.releaseTime();
    const a = this.act(TOON_CFG.swing);
    const dur = a.getClip().duration;
    if (!this.scrubbing) {
      this.mixer.stopAllAction();
      a.reset().play();
      a.setEffectiveWeight(1);
      this.scrubbing = true;
      this.cur = TOON_CFG.swing;
    }
    const t = phase < RELEASE ? (phase / RELEASE) * tr : tr + ((phase - RELEASE) / (1 - RELEASE)) * (dur - tr);
    a.time = Math.min(dur - 1e-3, Math.max(0, t));
    this.mixer.update(0);
  }

  update(dt: number) {
    if (!this.scrubbing) this.mixer.update(dt);
  }

  /** Бита в кулаке: рукоять в handslot.r, бита вдоль оси Y кости; центр биты — на half − 6 см от кулака. */
  placeBat(bat: THREE.Object3D, half = 0.42, rot = 0) {
    if (!this.hand) return;
    this.hand.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.hand.matrixWorld.decompose(pos, q, s);
    // в стойке бита на правом плече: из кулака назад-вверх (readyDir — [вперёд, вверх, вправо] в осях тела);
    // к броску плавно возвращается в кулак вдоль кости
    if (rot > 0) {
      const mq = this.model.getWorldQuaternion(new THREE.Quaternion());
      const [fw, up, rt] = TOON_CFG.readyDir;
      const d = new THREE.Vector3(-rt, up, fw).applyQuaternion(mq).normalize(); // модель смотрит в +Z, правая рука — −X
      q.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d), rot);
    }
    bat.quaternion.copy(q);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    bat.position.copy(pos).addScaledVector(dir, half - 0.06);
  }
}
