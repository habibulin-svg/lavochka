/* Городки — люди во дворе: гопники вселенной (модели ГОПС: TripoSG → Blender, риг gopnik_rig, бригады в своих
 * спортивных костюмах; выгрузка — studio/blender/gorodki_gopniks.py → public/gorodki/gop/<бригада>.glb), ростом со взрослого.
 * Стоят и дышат (кодом: корпус, голова), бросающий — у черты: замах сбоку и бросок плашмя — правая кисть идёт по дуге вокруг
 * плеча (две кости, IK), корпус закручивается и раскручивается; бита зажата в кулаке. Выбил фигуру — руки вверх и подпрыгнуть.
 * Остальные ждут у лавочки и смотрят на площадку. Оси — как в scene.ts: three (x, высота, −y игры). */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = `${import.meta.env.BASE_URL}gorodki/gop/`;
/** Рост — как у взрослого (решение пользователя: «нормального размера»). */
const HEIGHT = 1.78;

/** Кто на каком месте: бригады ГОПС (расцветки — studio/blender/liveries.py). */
const LOOKS = ['zatulinka', 'zaton', 'rastochka', 'pervomayka'];
const EXTRA = ['chemskoy', 'leninskiy'];

type BoneName = 'hips' | 'spine' | 'head' | 'upper_armR' | 'forearmR' | 'handR' | 'upper_armL' | 'forearmL' | 'handL';
const BONES: BoneName[] = ['hips', 'spine', 'head', 'upper_armR', 'forearmR', 'handR', 'upper_armL', 'forearmL', 'handL'];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const wpos = (o: THREE.Object3D, out = new THREE.Vector3()) => out.setFromMatrixPosition(o.matrixWorld);

function aim(bone: THREE.Object3D, dir: THREE.Vector3) {
  const world = bone.getWorldQuaternion(_q2);
  const cur = _b.set(0, 1, 0).applyQuaternion(world);
  const delta = _q.setFromUnitVectors(cur, _c.copy(dir).normalize());
  world.premultiply(delta);
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQ.multiply(world));
  bone.updateMatrixWorld(true);
}

function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  world.premultiply(q);
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQ.multiply(world));
  bone.updateMatrixWorld(true);
}

function boneLen(bone: THREE.Object3D, end: THREE.Object3D): number {
  let len = bone.userData.len as number | undefined;
  if (!len) {
    len = wpos(bone, _a).distanceTo(wpos(end, _b));
    bone.userData.len = len;
  }
  return len;
}

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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEG = Math.PI / 180;

interface Person {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  rest: Map<THREE.Bone, THREE.Quaternion>;
  bat: THREE.Object3D;
  /** Радость (выбил фигуру): время с начала, −1 — нет. */
  waveT: number;
  /** Сдвиг фазы дыхания. */
  t: number;
}

/** Поза броска по фазе: угол кисти вокруг плеча (от «вперёд» по часовой — вправо), высота, закрутка корпуса, наклон, бита. */
function throwPose(p: number) {
  // ключи: фаза → [угол кисти, высота кисти, закрутка корпуса, наклон, угол биты относительно руки]
  const K: [number, number, number, number, number][] = [
    [0, 25, 0.95, 0, 6],
    [0.3, 95, 1.12, -32, -4],
    [0.55, 150, 1.14, -62, -10],
    [0.62, 60, 1.1, 0, 8],
    [0.7, -25, 1.08, 38, 14],
    [0.85, -70, 1.02, 55, 10],
    [1, 10, 0.95, 10, 4],
  ];
  let i = 0;
  while (i < K.length - 2 && p > K[i + 1][0]) i++;
  const [p0, a0, h0, t0, l0] = K[i];
  const [p1, a1, h1, t1, l1] = K[i + 1];
  const k = smooth(THREE.MathUtils.clamp((p - p0) / (p1 - p0), 0, 1));
  return { ang: lerp(a0, a1, k) * DEG, h: lerp(h0, h1, k), twist: lerp(t0, t1, k) * DEG, lean: lerp(l0, l1, k) * DEG };
}

export class Crowd {
  readonly group = new THREE.Group();
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private gltfs = new Map<string, Promise<GLTF>>();
  private people = new Map<number, Person>();
  private pending = new Set<number>();
  private seats: number[] = [];
  private disposed = false;
  /** Кто бросает и откуда (x, y игры). */
  thrower = { seat: 0, x: 0, line: -13 };
  /** Фаза броска 0…1 (null — стоит с битой). */
  phase: number | null = null;

  constructor(private batProto: () => THREE.Object3D | null) {}

  private gltf(file: string) {
    let p = this.gltfs.get(file);
    if (!p) {
      p = this.loader.loadAsync(`${BASE}${file}.glb`);
      this.gltfs.set(file, p);
    }
    return p;
  }

  /** Места за столом (люди — по местам; плюс пара зевак). */
  setSeats(seats: number[]) {
    const want = [...seats, 90, 91];
    if (want.join() === this.seats.join()) return;
    this.seats = want;
    for (const [k, p] of [...this.people])
      if (!want.includes(k)) {
        this.group.remove(p.root);
        this.people.delete(k);
      }
    for (const s of want) if (!this.people.has(s) && !this.pending.has(s)) void this.spawn(s);
  }

  ready() {
    return this.seats.every((s) => this.people.has(s));
  }

  private async spawn(seat: number) {
    this.pending.add(seat);
    const file = seat >= 90 ? EXTRA[seat - 90] : LOOKS[seat % LOOKS.length];
    try {
      const g = await this.gltf(file);
      if (this.disposed) return;
      const model = SkeletonUtils.clone(g.scene);
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
        for (const mt of mats) {
          mt.roughness = 0.85;
          mt.metalness = 0;
        }
      });
      // масштаб по росту: как взрослый
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const k = HEIGHT / Math.max(0.1, box.max.y - box.min.y);
      model.scale.setScalar(k);
      model.position.y = -box.min.y * k;
      const root = new THREE.Group();
      root.add(model);
      const bones = {} as Record<BoneName, THREE.Bone>;
      model.traverse((o) => {
        const n = o.name.replace(/\./g, '') as BoneName;
        if (BONES.includes(n) && (o as THREE.Bone).isBone) bones[n] = o as THREE.Bone;
      });
      const rest = new Map<THREE.Bone, THREE.Quaternion>();
      for (const n of BONES) if (bones[n]) rest.set(bones[n], bones[n].quaternion.clone());
      const bat = new THREE.Group();
      this.group.add(root, bat);
      this.people.set(seat, { root, bones, rest, bat, waveT: -1, t: Math.random() * 10 });
    } catch (e) {
      console.warn('городки: человек не загрузился', e);
    } finally {
      this.pending.delete(seat);
    }
  }

  /** Радость (выбил фигуру): руки вверх, подпрыгнуть. */
  cheer(seat: number) {
    const p = this.people.get(seat);
    if (p) p.waveT = 0;
  }

  update(dt: number) {
    let bench = 0;
    for (const seat of this.seats) {
      const p = this.people.get(seat);
      if (!p) continue;
      const thr = seat === this.thrower.seat;
      // где стоит
      if (thr) {
        p.root.position.set(this.thrower.x - 0.4, 0, -(this.thrower.line - 0.3));
        p.root.rotation.y = Math.PI;
      } else {
        const k = bench++;
        const spots = [
          [4.6, -8.2],
          [4.7, -9.1],
          [4.5, -10.0],
          [4.8, -10.9],
          [-4.6, -2.4],
          [-4.7, -3.5],
        ];
        const [x, y] = spots[k % spots.length];
        p.root.position.set(x, 0, -y);
        // смотрит на площадку (на город, чуть вперёд)
        p.root.rotation.y = Math.atan2(-(0 - x), -(-1 - y)) + Math.PI;
      }
      for (const [bone, q] of p.rest) bone.quaternion.copy(q);
      p.t += dt;
      this.breathe(p);
      p.root.updateMatrixWorld(true);
      const b = p.bones;
      const R = b.upper_armR && b.handR;
      if (!p.bat.children.length) {
        const proto = this.batProto();
        if (proto) {
          const b = proto.clone();
          b.traverse((o) => ((o as THREE.Mesh).castShadow = true));
          p.bat.add(b);
        }
      }
      if (p.waveT >= 0) {
        p.waveT += dt;
        if (p.waveT > 1.6) p.waveT = -1;
      }
      if (p.waveT >= 0 && R) this.posCheer(p);
      else if (thr && R && this.phase != null) this.posThrow(p);
      else if (R) this.posHold(p, thr);
      p.bat.visible = !thr || this.phase == null || this.phase < 0.62;
    }
  }

  /** Кисть на дуге вокруг правого плеча, корпус закручен. */
  private posThrow(p: Person) {
    const b = p.bones;
    const ph = this.phase ?? 0;
    const pose = throwPose(this.phase == null ? 0 : ph);
    const yaw = p.root.rotation.y;
    // закрутка корпуса вокруг вертикали и наклон вперёд
    if (b.hips) rotateWorld(b.hips, _q.setFromAxisAngle(UP, pose.twist * 0.25));
    if (b.spine) rotateWorld(b.spine, _q.setFromAxisAngle(UP, pose.twist * 0.5));
    if (b.spine) {
      const side = _a.set(1, 0, 0).applyAxisAngle(UP, yaw).normalize();
      rotateWorld(b.spine, _q.setFromAxisAngle(side, -pose.lean * 0.5));
    }
    const sh = wpos(b.upper_armR, new THREE.Vector3());
    // «вперёд» персонажа в мире: −z при yaw = π
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, yaw);
    const right = new THREE.Vector3(-1, 0, 0).applyAxisAngle(UP, yaw);
    // руки у гопника короткие: дуга — на длину руки, высота — от плеча
    const reach = (boneLen(b.upper_armR, b.forearmR) + boneLen(b.forearmR, b.handR)) * 0.96;
    const dir = fwd.clone().multiplyScalar(Math.cos(pose.ang)).addScaledVector(right, Math.sin(pose.ang));
    const target = sh.clone().addScaledVector(dir, reach);
    target.y = sh.y + (pose.h - 1.12) * 0.8;
    ik2(b.upper_armR, b.forearmR, b.handR, target, new THREE.Vector3(0, -1, 0).addScaledVector(fwd, -0.3));
    // левая рука — для равновесия
    if (b.upper_armL && b.handL) {
      const shl = wpos(b.upper_armL, new THREE.Vector3());
      const left = right.clone().negate();
      const tl = shl.clone().addScaledVector(left, 0.28).addScaledVector(fwd, 0.18 + Math.sin(pose.ang) * 0.12);
      tl.y = shl.y - 0.22;
      ik2(b.upper_armL, b.forearmL, b.handL, tl, new THREE.Vector3(0, -1, 0));
    }
    // бита: рукоять в кисти, тело — вбок от дуги (плашмя, по касательной назад)
    const hand = this.grip(b.handR);
    // бита — продолжение руки, чуть отстаёт от движения кисти по дуге
    const along = fwd.clone().multiplyScalar(-Math.sin(pose.ang)).addScaledVector(right, Math.cos(pose.ang)); // d(dir)/d(угол)
    const batDir = dir.clone().addScaledVector(along, ph < 0.55 ? -0.35 : 0.45).normalize();
    batDir.y -= 0.08;
    batDir.normalize();
    this.placeBat(p.bat, hand, batDir);
  }

  /** Дыхание и лёгкое покачивание. */
  private breathe(p: Person) {
    const b = p.bones;
    const t = p.t;
    if (b.spine) rotateWorld(b.spine, _q.setFromAxisAngle(_a.set(1, 0, 0).applyAxisAngle(UP, p.root.rotation.y), Math.sin(t * 1.9) * 0.025 + 0.04));
    if (b.head) rotateWorld(b.head, _q.setFromAxisAngle(UP, Math.sin(t * 0.7) * 0.12));
    p.root.position.y = 0;
  }

  /** Стоит: рука с битой чуть вперёд, бита концом к земле у ноги; левая — в кармане (вдоль тела). */
  private posHold(p: Person, thr: boolean) {
    const b = p.bones;
    const yaw = p.root.rotation.y;
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, yaw);
    const right = new THREE.Vector3(-1, 0, 0).applyAxisAngle(UP, yaw);
    const sh = wpos(b.upper_armR, new THREE.Vector3());
    const reach = (boneLen(b.upper_armR, b.forearmR) + boneLen(b.forearmR, b.handR)) * 0.9;
    const target = sh.clone().addScaledVector(fwd, reach * 0.35).addScaledVector(right, reach * 0.25);
    target.y = sh.y - reach * 0.85;
    ik2(b.upper_armR, b.forearmR, b.handR, target, new THREE.Vector3(0, 0, 0).addScaledVector(fwd, -1).addScaledVector(right, 0.5));
    const hand = this.grip(b.handR);
    // конец биты — на земле чуть впереди и сбоку
    const tip = new THREE.Vector3(hand.x, 0.03, hand.z).addScaledVector(fwd, thr ? 0.55 : 0.35).addScaledVector(right, 0.25);
    const dir = tip.sub(hand).normalize();
    this.placeBat(p.bat, hand, dir);
  }

  /** Радость: руки вверх, подпрыгнуть. */
  private posCheer(p: Person) {
    const b = p.bones;
    const k = p.waveT / 1.6;
    p.root.position.y = Math.max(0, Math.sin(k * Math.PI * 3)) * 0.18 * (1 - k);
    const yaw = p.root.rotation.y;
    const right = new THREE.Vector3(-1, 0, 0).applyAxisAngle(UP, yaw);
    for (const [u, f, h, s] of [
      [b.upper_armR, b.forearmR, b.handR, 1],
      [b.upper_armL, b.forearmL, b.handL, -1],
    ] as const) {
      if (!u || !h) continue;
      const sh = wpos(u, new THREE.Vector3());
      const len = boneLen(u, f) + boneLen(f, h);
      const t = sh.clone().addScaledVector(right, s * len * 0.35);
      t.y = sh.y + len * 0.9;
      ik2(u, f, h, t, right.clone().multiplyScalar(s));
    }
    const hand = this.grip(b.handR);
    this.placeBat(p.bat, hand, new THREE.Vector3(0, 1, 0).addScaledVector(right, 0.3).normalize());
  }

  /** Где кулак: середина кости кисти (от запястья к пальцам). */
  private grip(hand: THREE.Bone) {
    const w = wpos(hand, new THREE.Vector3());
    const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(_q2));
    let len = hand.userData.glen as number | undefined;
    if (!len) {
      // длина кисти ≈ треть предплечья
      len = boneLen(hand.parent!, hand) * 0.45;
      hand.userData.glen = len;
    }
    return w.addScaledVector(ax, len * 0.6);
  }

  /** Бита: ось модели — y (как у цилиндра), рукоять (−y) — в кулаке: из кулака торчит набалдашник. */
  private placeBat(bat: THREE.Object3D, hand: THREE.Vector3, dir: THREE.Vector3) {
    bat.quaternion.setFromUnitVectors(UP, dir);
    bat.position.copy(hand).addScaledVector(dir, 0.42 - 0.08);
  }

  dispose() {
    this.disposed = true;
  }
}
