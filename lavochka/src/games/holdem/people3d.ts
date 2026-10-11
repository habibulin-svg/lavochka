/* Холдем 3D — люди за столом: модели Quaternius (Ultimate Modular Men/Women, CC0) из public/models/holdem.
 * Сидячей анимации у моделей нет — сажаем сами: дыхание и мелкие движения корпуса берём из «Idle», а ноги и руки ставим
 * двухзвенной IK: бедро вперёд, голень вниз, стопы на полу; кисти лежат на борту стола. Жесты (ставка, чек, пас, ва-банк,
 * выигрыш, «думает» — рука у подбородка) — это движение целей для кистей; голова поворачивается к тому, чей ход.
 * Каждое место — свой персонаж (одежда в духе 90-х: олимпийка, малиновый пиджак, кожанка). */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { normalOnly } from './pbr';

export type Gesture = 'bet' | 'call' | 'raise' | 'check' | 'fold' | 'allin' | 'win' | 'lose' | 'think' | 'look';

/** Место крупье в списке людей (не игрок). */
export const DEALER = 99;
export type DealerAct = 'idle' | 'hello' | 'deal' | 'flop' | 'card' | 'point_front' | 'point_left' | 'point_right' | 'push_front' | 'push_left' | 'push_right' | 'collect' | 'gather' | 'allin';

export interface PersonPlace {
  seat: number;
  /** Где стоит стул (y не важен). */
  pos: THREE.Vector3;
  /** Поворот вокруг Y: лицом к столу. */
  face: number;
  hidden: boolean;
  out: boolean;
  /** Кривизна бортика перед местом: 1/(2R) — на сколько края кадра ближе к середине стола (для видео-людей). */
  curve?: number;
}

export interface People {
  kind: 'video' | '3d';
  group: THREE.Group;
  sync(list: PersonPlace[], look: THREE.Vector3): void;
  lookAt(target: THREE.Vector3, focus: number | null): void;
  /** Реакция; delay — через сколько секунд (карты ещё летят). */
  gesture(seat: number, kind: Gesture, delay?: number): void;
  /** Насколько готовы (0..1): у всех, кого видно, уже играет ролик. Нет метода — готовы сразу. */
  ready?(): number;
  /** Показывать только этого (вид «как в Apple»); null — всех. */
  only?(seat: number | null): void;
  /** Действие крупье (есть только у людей-видео). */
  dealer?(act: DealerAct): void;
  /** Скорость реакций (есть только у людей-видео). */
  setRate?(r: number): void;
  head(seat: number): THREE.Vector3 | null;
  /** Шаг анимации; true — кто-то сидит за столом и шевелится. */
  update(dt: number, cam?: THREE.Vector3): boolean;
  dispose(): void;
}

const BASE = `${import.meta.env.BASE_URL}models/holdem/`;
/** Высота стоящего человека в единицах сцены (1 ед. ≈ 25 см). */
const HEIGHT = 7.0;
/** Пол, сиденье стула, верх борта — в координатах стола (стол — y = 0). */
const FLOOR = -3;
const SEAT_Y = FLOOR + 2.15;
const RAIL_Y = 0.36;
/** От центра стула до внешнего края борта. */
const TO_RAIL = 1.25;

interface Look {
  file: string;
  /** Перекрасить материалы по имени. */
  colors?: Record<string, string>;
}

/** Кто на каком месте (по порядку SEATS: Вовка, Ленка, Серёга, Танька, Димон, Колян, Светка, Жека, Михалыч). */
const LOOKS: Look[] = [
  { file: 'm_casual_hoodie', colors: { Purple: '#1d2f6e', LightBlue: '#e8e8e8' } },
  { file: 'f_casual', colors: { Orange: '#8a2a5a' } },
  { file: 'm_punk' },
  { file: 'f_formal' },
  { file: 'm_casual_2' },
  { file: 'm_suit', colors: { Suit: '#8a1238', Tie: '#1a1a1a' } },
  { file: 'f_punk' },
  { file: 'm_worker' },
  { file: 'm_farmer' },
];

type BoneName = 'Hips' | 'Abdomen' | 'Chest' | 'Neck' | 'Head' | 'UpperArmL' | 'LowerArmL' | 'WristL' | 'UpperArmR' | 'LowerArmR' | 'WristR' | 'UpperLegL' | 'LowerLegL' | 'FootL' | 'UpperLegR' | 'LowerLegR' | 'FootR' | 'Root';
const BONES: BoneName[] = ['Hips', 'Abdomen', 'Chest', 'Neck', 'Head', 'UpperArmL', 'LowerArmL', 'WristL', 'UpperArmR', 'LowerArmR', 'WristR', 'UpperLegL', 'LowerLegL', 'FootL', 'UpperLegR', 'LowerLegR', 'FootR', 'Root'];

interface Person {
  seat: number;
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  bones: Record<BoneName, THREE.Bone>;
  place: PersonPlace;
  /** Масштаб модели. */
  k: number;
  /** Высота бедра над корнем модели в позе покоя (до масштаба). */
  hip0: number;
  yaw: number;
  pitch: number;
  gesture: { kind: Gesture; t: number; dur: number } | null;
  /** «Думает» — рука у подбородка, плавно (0..1). */
  think: number;
  /** Сдвиг фазы — чтобы все не дышали в такт. */
  phase: number;
  /** Исходные повороты костей: перед каждым кадром — к ним (иначе повороты, которых нет в анимации, копятся). */
  rest: Map<THREE.Bone, THREE.Quaternion>;
}

// временные векторы
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function wpos(o: THREE.Object3D, out = new THREE.Vector3()) {
  return out.setFromMatrixPosition(o.matrixWorld);
}

/** Повернуть кость так, чтобы она (её ось +Y — от сустава к следующему) смотрела по dir (в мире). */
function aim(bone: THREE.Object3D, dir: THREE.Vector3) {
  const world = bone.getWorldQuaternion(_q2);
  const cur = _b.set(0, 1, 0).applyQuaternion(world);
  const delta = _q.setFromUnitVectors(cur, _c.copy(dir).normalize());
  world.premultiply(delta);
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQ.multiply(world));
  bone.updateMatrixWorld(true);
}

/** Повернуть кость в мире на q (поверх текущей позы). */
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  world.premultiply(q);
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQ.multiply(world));
  bone.updateMatrixWorld(true);
}

/** Длина кости: от неё до end (запоминается с первой позы). */
function boneLen(bone: THREE.Object3D, end: THREE.Object3D): number {
  let len = bone.userData.len as number | undefined;
  if (!len) {
    len = wpos(bone, _a).distanceTo(wpos(end, _b));
    bone.userData.len = len;
  }
  return len;
}

/**
 * Две кости upper → lower → end (локоть/колено между ними): конец попадает в target, сгиб — в сторону pole.
 * end — сустав на конце второй кости (кисть; для ноги — кость стопы, она висит на корне).
 */
function ik2(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  const la = boneLen(upper, lower);
  const lb = boneLen(lower, end);
  const s = wpos(upper, new THREE.Vector3());
  const to = target.clone().sub(s);
  const d = THREE.MathUtils.clamp(to.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  const u = to.normalize();
  const x = (la * la - lb * lb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, la * la - x * x));
  const pl = pole.clone().sub(u.clone().multiplyScalar(u.dot(pole))).normalize();
  const elbow = s.clone().addScaledVector(u, x).addScaledVector(pl, h);
  aim(upper, elbow.clone().sub(s));
  const tip = s.clone().addScaledVector(u, d);
  aim(lower, tip.sub(wpos(lower, new THREE.Vector3())));
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** 0 → 1 → 0 за время t ∈ [0, 1], с задержкой наверху. */
const bell = (t: number, hold = 0.3) => {
  const a = (1 - hold) / 2;
  return t < a ? smooth(t / a) : t > 1 - a ? smooth((1 - t) / a) : 1;
};

class PeopleImpl implements People {
  kind = '3d' as const;
  group = new THREE.Group();
  private list = new Map<number, Person>();
  private loading = new Map<number, Promise<void>>();
  private gltfs = new Map<string, Promise<GLTF>>();
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private look = new THREE.Vector3();
  private focus: number | null = null;
  private places: PersonPlace[] = [];
  private time = 0;
  private disposed = false;

  private gltf(file: string): Promise<GLTF> {
    let p = this.gltfs.get(file);
    if (!p) {
      p = this.loader.loadAsync(`${BASE}${file}.glb`);
      this.gltfs.set(file, p);
    }
    return p;
  }

  sync(list: PersonPlace[], look: THREE.Vector3) {
    this.places = list;
    this.look.copy(look);
    const seen = new Set<number>();
    for (const pl of list) {
      seen.add(pl.seat);
      const p = this.list.get(pl.seat);
      if (p) {
        p.place = pl;
        this.placeRoot(p);
      } else if (!this.loading.has(pl.seat)) this.loading.set(pl.seat, this.spawn(pl.seat));
    }
    for (const [k, p] of [...this.list])
      if (!seen.has(k)) {
        this.group.remove(p.root);
        this.list.delete(k);
      }
  }

  private async spawn(seat: number) {
    const look = LOOKS[seat % LOOKS.length];
    try {
      const g = await this.gltf(look.file);
      if (this.disposed) return;
      const model = SkeletonUtils.clone(g.scene);
      const fabric = normalOnly('fabric', [6, 6]);
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const src = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
        const mats = src.map((sm) => {
          const name = sm.name;
          const skin = /skin/i.test(name);
          const hair = /hair|eyebrow/i.test(name);
          const eye = /eye/i.test(name) && !/brow/i.test(name);
          const mat = new THREE.MeshPhysicalMaterial({
            color: look.colors?.[name] ?? sm.color,
            roughness: skin ? 0.55 : hair ? 0.6 : eye ? 0.15 : 0.92,
            metalness: 0,
            sheen: skin ? 0.35 : hair || eye ? 0 : 0.6,
            sheenColor: new THREE.Color(skin ? '#ffb090' : '#ffffff'),
            sheenRoughness: 0.6,
            clearcoat: eye ? 1 : 0,
          });
          // ткань одежды — с переплетением нитей
          if (!skin && !hair && !eye && m.geometry.attributes.uv) {
            mat.normalMap = fabric;
            mat.normalScale.set(0.5, 0.5);
          }
          return mat;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
      });
      const bones = {} as Record<BoneName, THREE.Bone>;
      model.traverse((o) => {
        const n = o.name.replace(/[.:]/g, '') as BoneName;
        if (BONES.includes(n) && (o as THREE.Bone).isBone) bones[n] = o as THREE.Bone;
      });
      if (BONES.some((b) => !bones[b])) throw new Error(`${look.file}: нет костей ${BONES.filter((b) => !bones[b]).join(',')}`);
      // масштаб по росту
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const k = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
      model.scale.multiplyScalar(k);
      model.position.y = -box.min.y * k;
      const root = new THREE.Group();
      root.add(model);
      root.updateMatrixWorld(true);
      const mixer = new THREE.AnimationMixer(model);
      const idle = g.animations.find((a) => a.name === 'Idle') ?? g.animations[0];
      if (idle) {
        const act = mixer.clipAction(idle);
        act.play();
        act.time = Math.random() * idle.duration;
        act.timeScale = 0.8 + Math.random() * 0.3;
      }
      mixer.update(0);
      root.updateMatrixWorld(true);
      const hip0 = wpos(bones.Hips).y - root.position.y;
      const p: Person = {
        seat,
        root,
        model,
        mixer,
        bones,
        place: this.places.find((x) => x.seat === seat)!,
        k,
        hip0,
        yaw: 0,
        pitch: 0,
        gesture: null,
        think: 0,
        phase: Math.random() * 10,
        rest: new Map(),
      };
      for (const n of BONES) p.rest.set(bones[n], bones[n].quaternion.clone());
      if (!p.place) return;
      this.group.add(root);
      this.list.set(seat, p);
      this.placeRoot(p);
    } catch (e) {
      console.warn('холдем: персонаж', look.file, e);
    } finally {
      this.loading.delete(seat);
    }
  }

  private placeRoot(p: Person) {
    const pl = p.place;
    p.root.visible = !pl.hidden;
    p.root.rotation.y = pl.face;
    // бедро — над сиденьем; корпус чуть ближе к столу, чем центр стула
    const fwd = new THREE.Vector3(Math.sin(pl.face), 0, Math.cos(pl.face));
    p.root.position.set(pl.pos.x, SEAT_Y + 0.3 - p.hip0, pl.pos.z).addScaledVector(fwd, 0.15);
    p.root.updateMatrixWorld(true);
  }

  lookAt(target: THREE.Vector3, focus: number | null) {
    this.look.copy(target);
    this.focus = focus;
  }

  gesture(seat: number, kind: Gesture) {
    const p = this.list.get(seat);
    if (!p || kind === 'look') return;
    if (kind === 'call' || kind === 'raise') kind = 'bet';
    const dur = kind === 'win' ? 1.8 : kind === 'allin' ? 1.4 : kind === 'check' ? 0.8 : 1.0;
    p.gesture = { kind, t: 0, dur };
  }

  head(seat: number): THREE.Vector3 | null {
    const p = this.list.get(seat);
    return p && p.root.visible ? wpos(p.bones.Head) : null;
  }

  update(dt: number): boolean {
    this.time += dt;
    let any = false;
    for (const p of this.list.values()) {
      if (!p.root.visible) continue;
      any = true;
      for (const [bone, q] of p.rest) bone.quaternion.copy(q);
      p.mixer.update(dt);
      p.root.updateMatrixWorld(true);
      if (p.gesture) {
        p.gesture.t += dt / p.gesture.dur;
        if (p.gesture.t >= 1) p.gesture = null;
      }
      const thinking = this.focus === p.seat && !p.gesture && !p.place.out;
      p.think += ((thinking ? 1 : 0) - p.think) * Math.min(1, dt * 2.5);
      this.pose(p, dt);
    }
    return any;
  }

  /** Посадить: ноги, наклон корпуса, руки на борт, голова к цели. */
  private pose(p: Person, dt: number) {
    const b = p.bones;
    const root = p.root;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    // левая рука человека: он смотрит по fwd, его левая сторона — UP × fwd
    const left = new THREE.Vector3().crossVectors(UP, fwd);
    const at = (x: number, y: number, z: number) => root.position.clone().setY(0).addScaledVector(left, x).addScaledVector(fwd, z).setY(y);
    const out = p.place.out;

    // корпус: чуть вперёд к столу, выбывший — откинулся назад
    const lean = out ? -0.12 : 0.16 + Math.sin(this.time * 0.7 + p.phase) * 0.02;
    rotateWorld(b.Abdomen, new THREE.Quaternion().setFromAxisAngle(left, lean));

    // ноги: колено вперёд, стопа на полу
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      const foot = at(0, 0, 0)
        .addScaledVector(left, sx * 0.55)
        .addScaledVector(fwd, 1.1)
        .setY(FLOOR + 0.35);
      ik2(b[`UpperLeg${side}`], b[`LowerLeg${side}`], b[`Foot${side}`], foot, fwd.clone().add(new THREE.Vector3(0, 0.6, 0)));
      // стопа идёт за голенью: ставим кость стопы в конец голени, носком вперёд
      const ankle = this.legEnd(b[`LowerLeg${side}`], b[`Foot${side}`]);
      const f = b[`Foot${side}`];
      f.position.copy(f.parent!.worldToLocal(ankle));
      f.updateMatrixWorld(true);
    }

    // руки: кисти на борту, жесты двигают цели
    const g = p.gesture;
    const t = g ? g.t : 0;
    const restL = at(0.62, RAIL_Y + 0.12, TO_RAIL + 0.15);
    const restR = at(-0.62, RAIL_Y + 0.12, TO_RAIL + 0.15);
    if (out) {
      // выбыл: руки на коленях
      restL.copy(at(0.45, SEAT_Y + 0.75, 0.9));
      restR.copy(at(-0.45, SEAT_Y + 0.75, 0.9));
    }
    let tl = restL.clone();
    let tr = restR.clone();
    if (g) {
      const w = bell(t);
      if (g.kind === 'bet') tr.lerp(at(-0.35, 0.18, TO_RAIL + 1.5), w);
      else if (g.kind === 'allin') {
        tr.lerp(at(-0.4, 0.2, TO_RAIL + 1.9), w);
        tl.lerp(at(0.4, 0.2, TO_RAIL + 1.9), w);
      } else if (g.kind === 'check') {
        const tap = Math.abs(Math.sin(t * Math.PI * 2));
        tr.lerp(at(-0.4, 0.12 + tap * 0.35, TO_RAIL + 0.7), bell(t, 0.7));
      } else if (g.kind === 'fold') {
        const k = t < 0.5 ? smooth(t / 0.5) : 1 - smooth((t - 0.5) / 0.5);
        tr.lerp(at(-0.2, 0.25, TO_RAIL + 1.1), k);
      } else if (g.kind === 'win') {
        // руки вперёд и сгрести банк к себе
        const reach = at(0, 0.2, TO_RAIL + 2.2);
        const k1 = t < 0.35 ? smooth(t / 0.35) : 1;
        const k2 = t > 0.35 ? smooth((t - 0.35) / 0.65) : 0;
        tr = restR.clone().lerp(reach.clone().addScaledVector(left, -0.6), k1).lerp(restR, k2);
        tl = restL.clone().lerp(reach.clone().addScaledVector(left, 0.6), k1).lerp(restL, k2);
      }
    }
    if (p.think > 0.01) {
      // рука у подбородка
      const chin = wpos(b.Head).addScaledVector(fwd, 0.45).add(new THREE.Vector3(0, -0.55, 0)).addScaledVector(left, -0.1);
      tr.lerp(chin, smooth(p.think));
    }
    const elbowOut = (sx: number) => left.clone().multiplyScalar(sx * 0.8).add(new THREE.Vector3(0, -1, 0)).addScaledVector(fwd, -0.3);
    ik2(b.UpperArmL, b.LowerArmL, b.WristL, tl, elbowOut(1));
    ik2(b.UpperArmR, b.LowerArmR, b.WristR, tr, elbowOut(-1));

    // голова: к цели (тот, чей ход, или середина стола), плавно и в пределах
    const head = wpos(b.Head);
    const want = (this.focus === p.seat ? at(0, 0, TO_RAIL + 2.5) : this.look).clone().sub(head);
    const local = want.clone().applyQuaternion(root.quaternion.clone().invert());
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.0, 1.0);
    const pitch = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.6, 0.25);
    const k = Math.min(1, dt * 3);
    p.yaw += (yaw - p.yaw) * k;
    p.pitch += (pitch - p.pitch) * k;
    const qy = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw * 0.5);
    const qp = new THREE.Quaternion().setFromAxisAngle(left, -p.pitch * 0.5);
    rotateWorld(b.Neck, qy.clone().multiply(qp));
    rotateWorld(b.Head, qy.multiply(qp));
  }

  /** Конец голени: вдоль её оси на её длину. */
  private legEnd(lower: THREE.Bone, foot: THREE.Bone): THREE.Vector3 {
    const len = boneLen(lower, foot);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion()));
    return wpos(lower).addScaledVector(dir, len);
  }

  dispose() {
    this.disposed = true;
    for (const p of this.list.values()) p.mixer.stopAllAction();
    this.list.clear();
  }
}

export async function loadPeople(): Promise<People | null> {
  return new PeopleImpl();
}
