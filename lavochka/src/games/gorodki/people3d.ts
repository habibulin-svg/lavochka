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

type BoneName = 'hips' | 'spine' | 'head' | 'upper_armR' | 'forearmR' | 'handR' | 'upper_armL' | 'forearmL' | 'handL' | 'thighL' | 'shinL' | 'thighR' | 'shinR';
const BONES: BoneName[] = ['hips', 'spine', 'head', 'upper_armR', 'forearmR', 'handR', 'upper_armL', 'forearmL', 'handL', 'thighL', 'shinL', 'thighR', 'shinR'];

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

/** Вершины, которые ведёт кость кисти (вес > 0,6): не больше 48, равномерно. */
function handVerts(model: THREE.Object3D, hand: THREE.Bone | undefined): { mesh: THREE.SkinnedMesh; idx: number[] } | null {
  if (!hand) return null;
  let out: { mesh: THREE.SkinnedMesh; idx: number[] } | null = null;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (out || !m.isSkinnedMesh) return;
    const bi = m.skeleton.bones.indexOf(hand);
    if (bi < 0) return;
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    const all: number[] = [];
    for (let v = 0; v < si.count; v++)
      for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === bi && sw.getComponent(v, k) > 0.6) all.push(v);
    if (!all.length) return;
    const step = Math.max(1, Math.floor(all.length / 48));
    out = { mesh: m, idx: all.filter((_, i) => i % step === 0) };
  });
  return out;
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
  /** Ось «поперёк ладони» в осях кости кисти: через неё проходит бита в кулаке. */
  palm: THREE.Vector3;
  /** Вершины правой кисти (меш и номера): их середина — где на самом деле кулак. */
  fist: { mesh: THREE.SkinnedMesh; idx: number[] } | null;
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
      // ладонь висящей руки смотрит в бедро, поперёк ладони — «вперёд» тела (у модели — +z)
      root.updateMatrixWorld(true);
      const palm = new THREE.Vector3(0, 0, 1);
      if (bones.handR) palm.applyQuaternion(bones.handR.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
      // пальцы поджаты: кисть короче — получается кулак
      if (bones.handR) bones.handR.scale.set(1.05, 0.62, 1.05);
      const bat = new THREE.Group();
      this.group.add(root, bat);
      this.people.set(seat, { root, bones, rest, bat, waveT: -1, t: Math.random() * 10, palm, fist: handVerts(model, bones.handR) });
    } catch (e) {
      console.warn('городки: человек не загрузился', e);
    } finally {
      this.pending.delete(seat);
    }
  }

  /** Радость (выбил фигуру): бросающий подпрыгивает с поднятыми руками, зрители на лавочке тоже вскидывают руки. */
  cheer(seat: number) {
    for (const [k, p] of this.people) if (k === seat || this.sitting.has(k)) p.waveT = k === seat ? 0 : -0.25 - Math.random() * 0.3;
  }

  /** Кто сидит на лавочке (места): первые трое ждущих. */
  private sitting = new Set<number>();

  update(dt: number) {
    let bench = 0;
    this.sitting.clear();
    for (const seat of this.seats) {
      const p = this.people.get(seat);
      if (!p) continue;
      const thr = seat === this.thrower.seat;
      let sit = false;
      // где стоит: бросающий — у черты вполоборота, трое ждущих сидят на лавочке, остальные стоят рядом
      if (thr) {
        p.root.position.set(this.thrower.x - 0.4, 0, -(this.thrower.line - 0.3));
        p.root.rotation.y = Math.PI + (this.phase == null ? 0.28 : 0);
      } else {
        const k = bench++;
        if (k < 3) {
          sit = true;
          this.sitting.add(seat);
          // лавочка у x = 5, вдоль площадки, лицом к игре
          p.root.position.set(4.93, 0, -(-9.65 + k * 0.62));
          p.root.rotation.y = -Math.PI / 2;
        } else {
          const spots = [
            [4.3, -7.6],
            [4.4, -11.2],
            [-4.6, -2.4],
          ];
          const [x, y] = spots[(k - 3) % spots.length];
          p.root.position.set(x, 0, -y);
          p.root.rotation.y = Math.atan2(-(0 - x), -(-1 - y)) + Math.PI;
        }
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
      if (sit) this.posSit(p);
      else if (thr) this.posStep(p);
      p.root.updateMatrixWorld(true);
      if (p.waveT !== -1) {
        p.waveT += dt;
        if (p.waveT > 1.6) p.waveT = -1;
      }
      if (p.waveT >= 0 && R) this.posCheer(p, sit);
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
    // бита — продолжение руки, чуть отстаёт от движения кисти по дуге
    const along = fwd.clone().multiplyScalar(-Math.sin(pose.ang)).addScaledVector(right, Math.cos(pose.ang)); // d(dir)/d(угол)
    const batDir = dir.clone().addScaledVector(along, ph < 0.55 ? -0.35 : 0.45).normalize();
    batDir.y -= 0.08;
    batDir.normalize();
    this.hold(p, batDir);
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
    const hand = wpos(b.handR, new THREE.Vector3());
    // конец биты — на земле впереди и чуть сбоку
    const tip = new THREE.Vector3(hand.x, 0.03, hand.z).addScaledVector(fwd, thr ? 0.62 : 0.45).addScaledVector(right, 0.12);
    const dir = tip.sub(hand).normalize();
    this.hold(p, dir);
    // бросающий держит биту двумя руками: левая — ниже по бите
    if (thr && b.upper_armL && b.forearmL && b.handL) {
      const t = p.bat.position.clone().addScaledVector(dir, -0.16);
      ik2(b.upper_armL, b.forearmL, b.handL, t, new THREE.Vector3(0, -0.4, 0).addScaledVector(right, -1));
    }
  }

  /** Сидит на лавочке: бёдра вперёд, голени вниз, руки на коленях, бита прислонена к лавочке. */
  private posSit(p: Person) {
    const b = p.bones;
    const yaw = p.root.rotation.y;
    const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, yaw);
    // таз — на высоте сиденья
    const hip = b.thighL ? wpos(b.thighL, new THREE.Vector3()).y : 0.9;
    p.root.position.y = 0.53 - hip;
    p.root.updateMatrixWorld(true);
    for (const [th, sh, side] of [
      [b.thighL, b.shinL, 1],
      [b.thighR, b.shinR, -1],
    ] as const) {
      if (!th || !sh) continue;
      aim(th, fwd.clone().addScaledVector(new THREE.Vector3(0, 1, 0), -0.08).add(new THREE.Vector3(-1, 0, 0).applyAxisAngle(UP, yaw).multiplyScalar(-side * 0.12)));
      aim(sh, new THREE.Vector3(0, -1, 0).addScaledVector(fwd, 0.25));
    }
    // руки на коленях
    for (const [u, f, h, th] of [
      [b.upper_armR, b.forearmR, b.handR, b.shinR],
      [b.upper_armL, b.forearmL, b.handL, b.shinL],
    ] as const) {
      if (!u || !f || !h || !th) continue;
      const knee = wpos(th, new THREE.Vector3());
      ik2(u, f, h, knee.addScaledVector(fwd, -0.05).add(new THREE.Vector3(0, 0.06, 0)), new THREE.Vector3(0, 0, 0).addScaledVector(fwd, -1).add(new THREE.Vector3(0, -0.3, 0)));
    }
    // бита стоит у лавочки
    p.bat.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 1, 0).addScaledVector(fwd, -0.25).normalize());
    p.bat.position.copy(p.root.position).setY(0.42).addScaledVector(fwd, 0.25).add(new THREE.Vector3(0, 0, 0).addScaledVector(new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, yaw), 0.3));
  }

  /** Бросающий стоит в шаг: левая нога чуть вперёд, правая отставлена. */
  private posStep(p: Person) {
    const b = p.bones;
    if (!b.thighL || !b.thighR) return;
    const yaw = p.root.rotation.y;
    const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, yaw);
    const k = this.phase == null ? 1 : this.phase < 0.55 ? 1 - this.phase * 0.6 : 1.3;
    rotateWorld(b.thighL, _q.setFromAxisAngle(side, -0.2 * k));
    rotateWorld(b.thighR, _q.setFromAxisAngle(side, 0.16 * k));
    if (b.shinR) rotateWorld(b.shinR, _q.setFromAxisAngle(side, -0.1 * k));
  }

  /** Радость: руки вверх, подпрыгнуть (сидя — без прыжка). */
  private posCheer(p: Person, sit = false) {
    const b = p.bones;
    const k = p.waveT / 1.6;
    if (!sit) p.root.position.y = Math.max(0, Math.sin(k * Math.PI * 3)) * 0.18 * (1 - k);
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
    this.hold(p, new THREE.Vector3(0, 1, 0).addScaledVector(right, 0.3).normalize());
  }

  /** Бита в кулаке: кисть поворачиваем так, чтобы ось «поперёк ладони» легла вдоль биты, бита проходит через середину
   * сжатой кисти, из кулака снизу торчит набалдашник рукояти. */
  private hold(p: Person, dir: THREE.Vector3) {
    const hb = p.bones.handR;
    if (!hb) return;
    const cur = p.palm.clone().applyQuaternion(hb.getWorldQuaternion(_q2)).normalize();
    // знак ладони не важен — берём ближний к нужному
    if (cur.dot(dir) < 0) cur.negate();
    rotateWorld(hb, new THREE.Quaternion().setFromUnitVectors(cur, dir));
    let fist: THREE.Vector3;
    if (p.fist) {
      // середина кисти по вершинам меша (со скиннингом) — бита идёт через неё
      const m = p.fist.mesh;
      m.skeleton.update();
      fist = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (const i of p.fist.idx) {
        m.getVertexPosition(i, v);
        fist.add(v.applyMatrix4(m.matrixWorld));
      }
      fist.multiplyScalar(1 / p.fist.idx.length);
    } else {
      const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(hb.getWorldQuaternion(_q2)).normalize();
      fist = wpos(hb, new THREE.Vector3()).addScaledVector(ax, boneLen(p.bones.forearmR, hb) * 0.17);
    }
    const bat = p.bat;
    bat.quaternion.setFromUnitVectors(UP, dir);
    // центр биты — от кулака вдоль биты; рукоять торчит из кулака на 6 см
    bat.position.copy(fist).addScaledVector(dir, 0.42 - 0.06);
  }

  dispose() {
    this.disposed = true;
  }
}
