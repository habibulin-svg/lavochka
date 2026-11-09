/* Дворовый спорт — пацаны бригад: KayKit Adventurers «Ranger» (CC0) в олимпийке бригады (studio/blender/dvor_pacan.py)
 * с готовыми анимациями KayKit Character Animations (CC0). Модели бригад — public/gorodki/pacan/<бригада>.glb без анимаций,
 * клипы — общий anims.glb (по именам костей), один на всех.
 *
 * Клипы anims.glb (длина, с): idle 1,04 · idle2 2,13 · throw 1,33 (из-за правого плеча вперёд) · pickup 1,29 (нагнуться,
 * поднять — годится и на «поймал низом») · hit 0,67 (получил) · hold2h 1,04 (стойка с двуручным) · swing2h 1,08 (замах
 * двумя руками — удар битой лапты/пекаря) · swing1h 1,33 (наотмашь слева направо — удар по чижу) · cheer 1,67 · wave 2,13 ·
 * sit 3,58 (на стуле — лавочка выше: поднять на ~0,12 м) · run 0,79 · walk 1,04 · jump 1,17 · holding 1,00 (держит перед
 * собой — «ловит/поймал» верхом). Отдельного клипа ловли нет: ловля = holding (верхом) или pickup (низом).
 *
 * Модель смотрит в +Z, правая рука — −X; бита/палка — в кости handslot.r (ось Y кости — вдоль биты). */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export const TOON_BASE = `${import.meta.env.BASE_URL}gorodki/pacan/`;
/** Версия моделей: менять при пересборке dvor_pacan.py, чтобы браузер не взял старые из кэша. */
export const TOON_V = 5;
/** Бригады ГОПС (расцветки — studio/blender/liveries.py): первые четыре — игроки, последние две — зеваки. */
export const BRIGADES = ['zatulinka', 'zaton', 'rastochka', 'pervomayka', 'chemskoy', 'leninskiy'] as const;
export type Brigade = (typeof BRIGADES)[number];
/** Рост пацана, м: крупная голова — ростом чуть ниже взрослого. */
export const TOON_H = 1.62;

export type Clip = 'idle' | 'idle2' | 'throw' | 'pickup' | 'hit' | 'hold2h' | 'swing2h' | 'swing1h' | 'cheer' | 'wave' | 'sit' | 'run' | 'walk' | 'jump' | 'holding';

/** Загрузчик пацанов: модели бригад и общий файл клипов — по разу на экран. */
export class ToonLoader {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private cache = new Map<string, Promise<GLTF>>();

  private load(f: string) {
    let p = this.cache.get(f);
    if (!p) {
      p = this.loader.loadAsync(`${TOON_BASE}${f}.glb?v=${TOON_V}`);
      this.cache.set(f, p);
    }
    return p;
  }

  /** Новый пацан бригады (своя копия скелета) с клипами. */
  async make(brigade: string, seed = 0, height = TOON_H): Promise<Toon> {
    const [g, anims] = await Promise.all([this.load(brigade), this.load('anims')]);
    return new Toon(SkeletonUtils.clone(g.scene), anims.animations, seed, height);
  }
}

export class Toon {
  readonly mixer: THREE.AnimationMixer;
  /** Корень для расстановки: модель внутри уже отмасштабирована и стоит ступнями на y = 0. */
  readonly root = new THREE.Group();
  private acts = new Map<string, THREE.AnimationAction>();
  private cur: string | null = null;
  readonly hand: THREE.Object3D | null;
  /** Время самой быстрой точки кисти по клипам взмаха. */
  private rel = new Map<string, number>();
  private scrubbing = false;
  /** Перемещение по точкам (walkTo): куда, с какой скоростью, клип в пути. */
  private path: { x: number; z: number }[] = [];
  private pathSpeed = 0;
  private pathClip: Clip = 'run';
  private pathDone: (() => void) | null = null;
  /** Клип, на который вернуться после пути. */
  rest: Clip = 'idle';

  constructor(
    readonly model: THREE.Object3D,
    clips: THREE.AnimationClip[],
    seed: number,
    height = TOON_H,
  ) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const k = height / Math.max(0.1, box.max.y - box.min.y);
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
    this.root.add(model);
    this.hand = model.getObjectByName('handslotr') ?? model.getObjectByName('handslot.r') ?? null;
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of clips) this.acts.set(c.name, this.mixer.clipAction(c));
    // разный такт у соседей
    this.mixer.setTime((seed * 0.37) % 3);
  }

  has(name: string) {
    return this.acts.has(name);
  }

  private act(name: string) {
    return this.acts.get(name) ?? this.acts.get('idle')!;
  }

  /** Длина клипа, с. */
  duration(name: Clip | string) {
    return this.act(name).getClip().duration;
  }

  /** Плавно перейти на клип (цикл или один раз с остановкой на последнем кадре). speed — темп (бег быстрее/медленнее). */
  play(name: Clip | string, loop = true, fade = 0.25, speed = 1) {
    if (this.scrubbing) {
      this.scrubbing = false;
      this.mixer.stopAllAction();
      this.cur = null;
    }
    const next = this.act(name);
    next.timeScale = speed;
    if (this.cur === name) return;
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

  get clip() {
    return this.cur;
  }

  /** Самая быстрая точка кисти в клипе взмаха — там бита (мяч, палка) и вылетает / бьёт. */
  releaseTime(clip: Clip | string): number {
    const known = this.rel.get(clip);
    if (known != null) return known;
    const a = this.act(clip);
    const dur = a.getClip().duration;
    let rel = dur * 0.5;
    if (this.hand) {
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
          // только первые 80 %: в конце бывает быстрый возврат
          if (v > best && i < n * 0.8) {
            best = v;
            rel = (dur * (i - 0.5)) / n;
          }
        }
        q.copy(p);
      }
      this.mixer.stopAllAction();
      this.cur = null;
    }
    this.rel.set(clip, rel);
    return rel;
  }

  /** Взмах по фазе игры 0…1: до release — к самой быстрой точке клипа, после — доводка. Так выпуск в игре совпадает
   * с самым быстрым местом движения руки. */
  scrub(clip: Clip | string, phase: number, release = 0.62) {
    const tr = this.releaseTime(clip);
    const a = this.act(clip);
    const dur = a.getClip().duration;
    if (!this.scrubbing || this.cur !== clip) {
      this.mixer.stopAllAction();
      a.reset().play();
      a.setEffectiveWeight(1);
      this.scrubbing = true;
      this.cur = clip;
    }
    const t = phase < release ? (phase / release) * tr : tr + ((phase - release) / (1 - release)) * (dur - tr);
    a.time = Math.min(dur - 1e-3, Math.max(0, t));
    this.mixer.update(0);
  }

  /** Бежать (идти) по точкам в осях three (x, z): поворачивается по ходу, по прибытии — клип rest. */
  walkTo(points: { x: number; z: number }[], speed = 4.5, clip: Clip = speed > 2.2 ? 'run' : 'walk'): Promise<void> {
    this.pathDone?.();
    this.path = points.slice();
    this.pathSpeed = speed;
    this.pathClip = clip;
    return new Promise((ok) => (this.pathDone = ok));
  }

  /** Идёт по точкам. */
  get moving() {
    return this.path.length > 0;
  }

  /** Повернуться лицом к точке (оси three). */
  face(x: number, z: number) {
    const p = this.root.position;
    this.root.rotation.y = Math.atan2(x - p.x, z - p.z);
  }

  update(dt: number) {
    if (this.path.length) {
      const p = this.root.position;
      let left = this.pathSpeed * dt;
      while (left > 0 && this.path.length) {
        const g = this.path[0];
        const dx = g.x - p.x;
        const dz = g.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-3) this.root.rotation.y = Math.atan2(dx, dz);
        if (d <= left) {
          p.x = g.x;
          p.z = g.z;
          left -= d;
          this.path.shift();
        } else {
          p.x += (dx / d) * left;
          p.z += (dz / d) * left;
          left = 0;
        }
      }
      // темп клипа — под скорость (бег KayKit рассчитан на ~4,5 м/с, шаг — на ~1,4)
      this.play(this.pathClip, true, 0.2, this.pathClip === 'run' ? this.pathSpeed / 4.5 : this.pathSpeed / 1.4);
      if (!this.path.length) {
        this.play(this.rest, true, 0.25);
        const ok = this.pathDone;
        this.pathDone = null;
        ok?.();
      }
    }
    if (!this.scrubbing) this.mixer.update(dt);
  }

  /** Бита (палка) в кулаке: рукоять в handslot.r, бита вдоль оси Y кости; центр биты — на half − 6 см от кулака.
   * rot > 0 — плавно к положению «на плече»: readyDir — направление из кулака [вперёд, вверх, вправо] в осях тела. */
  placeBat(bat: THREE.Object3D, half = 0.42, rot = 0, readyDir: [number, number, number] = [-0.55, 0.8, 0.25]) {
    if (!this.hand) return;
    this.hand.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.hand.matrixWorld.decompose(pos, q, s);
    if (rot > 0) {
      const mq = this.model.getWorldQuaternion(new THREE.Quaternion());
      const [fw, up, rt] = readyDir;
      const d = new THREE.Vector3(-rt, up, fw).applyQuaternion(mq).normalize(); // модель смотрит в +Z, правая рука — −X
      q.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d), rot);
    }
    bat.quaternion.copy(q);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    bat.position.copy(pos).addScaledVector(dir, half - 0.06);
  }

  /** Где кулак (мяч в руке, точка выпуска) — в мировых координатах three. */
  handPos(out = new THREE.Vector3()) {
    if (!this.hand) return out.copy(this.root.position).setY(1.1);
    this.hand.updateMatrixWorld(true);
    return out.setFromMatrixPosition(this.hand.matrixWorld);
  }
}
