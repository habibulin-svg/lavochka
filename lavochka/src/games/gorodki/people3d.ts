/* Городки — люди во дворе. По умолчанию — пацаны KayKit с готовыми анимациями (pacan3d.ts, ветки «toon» ниже); ?pacan=0 —
 * прежние гопники бригад — люди MakeHuman (MPFB2, CC0) в олимпийках, спортивных штанах, кепках-восьмиклинках
 * и кроссовках; сборка — studio/blender/gorodki_mpfb.py → public/gorodki/gop/<бригада>.glb, ростом со взрослого.
 * У моделей настоящие глаза и кисти с пальцами, сжатыми в кулак; кость grip.L/R — середина кулака, ось Y — канал кулака.
 * Стоят и дышат (кодом: корпус, голова), бросающий — у черты: замах сбоку и бросок плашмя — правая кисть идёт по дуге вокруг
 * плеча (две кости, IK), корпус закручивается и раскручивается; бита зажата в кулаке. Выбил фигуру — руки вверх и подпрыгнуть.
 * Остальные ждут у лавочки и смотрят на площадку. Оси — как в scene.ts: three (x, высота, −y игры). */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { normalOnly } from '../holdem/pbr';
import { ToonLoader, type Toon } from '../../core/dvorsport/toon';
import { TOON, TOON_CFG } from './pacan3d';

const BASE = `${import.meta.env.BASE_URL}gorodki/gop/`;
/** Рост по умолчанию — для моделей не в метрах (решение пользователя: «нормального размера»). */
const HEIGHT = 1.78;
/** Версия моделей: менять при пересборке, чтобы браузер не взял старые из кэша. */
const MODELS_V = 9;

/** Кто на каком месте: бригады ГОПС (расцветки — studio/blender/liveries.py). */
const LOOKS = ['zatulinka', 'zaton', 'rastochka', 'pervomayka'];
const EXTRA = ['chemskoy', 'leninskiy'];
/** Разработка: ?gklook=<бригада> — кто бросает (проверка моделей). */
const DBG_LOOK = import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('gklook') : null;

type BoneName = 'hips' | 'spine' | 'head' | 'upper_armR' | 'forearmR' | 'handR' | 'upper_armL' | 'forearmL' | 'handL' | 'thighL' | 'shinL' | 'thighR' | 'shinR' | 'gripR' | 'gripL';
const BONES: BoneName[] = ['hips', 'spine', 'head', 'upper_armR', 'forearmR', 'handR', 'upper_armL', 'forearmL', 'handL', 'thighL', 'shinL', 'thighR', 'shinR', 'gripR', 'gripL'];

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
  /** Где сейчас кулак с битой (после hold). */
  gripAt: THREE.Vector3;
  /** Проба ?pacan: стилизованный пацан с готовыми анимациями (pacan3d.ts) — тогда кости и позы выше не нужны. */
  toon?: Toon;
}

type V3 = [number, number, number];
/** Ключевые позы бросающего: фаза, поворот корпуса к полю (рад, 0 — грудью на город, минус — левым боком),
 * правая кисть относительно правого плеча в осях тела [вперёд, вправо, вверх] (м), бита [вперёд, вправо, вверх],
 * левая рука: 0 — на бите, 1 — показывает на город, 2 — опущена в сторону. */
const KEYS: [number, number, V3, V3, number][] = [
  // стойка: боком к полю, бита в обеих руках перед собой концом к земле
  [0, -1.0, [0.28, -0.2, -0.45], [0.55, 0.05, -0.85], 0],
  // замах: рука с битой уходит назад-вниз за правый бок, локоть согнут, левая показывает на город
  [0.3, -1.25, [-0.04, 0.24, -0.3], [-0.5, 0.4, -0.65], 1],
  [0.55, -1.45, [-0.24, 0.17, -0.2], [-0.75, 0.35, -0.5], 1],
  // выброс: корпус раскручивается, рука идёт сбоку на уровне пояса, бита плашмя
  [0.62, -0.45, [0.2, 0.42, -0.14], [-0.15, 0.97, -0.08], 2],
  [0.72, 0.25, [0.45, 0.15, -0.06], [0.6, 0.6, -0.1], 2],
  // доводка: рука уходит поперёк тела, потом возвращается
  [0.86, 0.5, [0.35, -0.28, -0.12], [0.6, -0.3, -0.5], 2],
  [1, -0.7, [0.28, -0.16, -0.42], [0.55, 0.05, -0.85], 0],
];

function keyPose(ph: number) {
  let i = 0;
  while (i < KEYS.length - 2 && ph > KEYS[i + 1][0]) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = smooth(THREE.MathUtils.clamp((ph - a[0]) / (b[0] - a[0]), 0, 1));
  const mix = (x: V3, y: V3): V3 => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  return { yaw: lerp(a[1], b[1], k), hand: mix(a[2], b[2]), bat: mix(a[3], b[3]), left: [a[4], b[4], k] as const };
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

  constructor(private batProto: () => THREE.Object3D | null) {
    if (import.meta.env.DEV) ((globalThis as unknown as { __gkCrowds?: Crowd[] }).__gkCrowds ??= []).push(this);
  }

  private gltf(file: string) {
    let p = this.gltfs.get(file);
    if (!p) {
      p = this.loader.loadAsync(`${BASE}${file}.glb?v=${MODELS_V}`);
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
    const file = seat >= 90 ? EXTRA[seat - 90] : seat === this.thrower.seat && DBG_LOOK ? DBG_LOOK : LOOKS[seat % LOOKS.length];
    try {
      if (TOON) {
        await this.spawnToon(seat, file);
        return;
      }
      const g = await this.gltf(file);
      if (this.disposed) return;
      const model = SkeletonUtils.clone(g.scene);
      const fabric = normalOnly('fabric', [10, 10]);
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
        for (const mt of mats) {
          mt.metalness = 0;
          if (mt.name === 'suit' || mt.name === 'cap') {
            // ткань костюма и кепки — с лёгким переплетением нитей
            mt.normalMap = fabric;
            mt.normalScale.set(0.35, 0.35);
          } else if (/high-poly|short\d/.test(mt.name)) {
            // глаза (роговица) и волосы — вырезом по альфе: без сортировки прозрачного и с тенями
            mt.transparent = false;
            mt.alphaTest = 0.5;
          } else if (mt.transparent) {
            // брови и ресницы — тонкие полупрозрачные пряди
            mt.depthWrite = false;
          }
        }
      });
      // рост: модели MakeHuman уже в метрах, у каждой бригады свой (1,72–1,85); старые слепки — к среднему росту
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;
      const k = h > 1.6 && h < 2 ? 1 : HEIGHT / Math.max(0.1, h);
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
      root.updateMatrixWorld(true);
      const palm = new THREE.Vector3(0, 0, 1);
      if (bones.gripR) {
        // канал кулака: ось Y кости grip.R в осях кисти
        palm.set(0, 1, 0).applyQuaternion(bones.gripR.quaternion).normalize();
      } else if (bones.handR) {
        // старые модели: ладонь висящей руки смотрит в бедро, поперёк ладони — «вперёд» тела (+z); кисть короче — кулак
        palm.applyQuaternion(bones.handR.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
        bones.handR.scale.set(1.05, 0.62, 1.05);
      }
      const bat = new THREE.Group();
      this.group.add(root, bat);
      this.people.set(seat, { root, bones, rest, bat, waveT: -1, t: Math.random() * 10, palm, fist: bones.gripR ? null : handVerts(model, bones.handR), gripAt: new THREE.Vector3() });
    } catch (e) {
      console.warn('городки: человек не загрузился', e);
    } finally {
      this.pending.delete(seat);
    }
  }

  /** Пацан бригады с анимациями KayKit (общий загрузчик набора дворового спорта). */
  private toons = new ToonLoader();
  private async spawnToon(seat: number, file: string) {
    const toon = await this.toons.make(file, seat);
    if (this.disposed) return;
    const root = toon.root;
    const bat = new THREE.Group();
    this.group.add(root, bat);
    this.people.set(seat, { root, bones: {} as Record<BoneName, THREE.Bone>, rest: new Map(), bat, waveT: -1, t: 0, palm: new THREE.Vector3(), fist: null, gripAt: new THREE.Vector3(), toon });
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
        p.root.rotation.y = Math.PI + keyPose(this.phase ?? 0).yaw;
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
      if (p.toon) {
        this.toonUpdate(p, p.toon, thr, sit, dt);
        continue;
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
      else if (thr && R) this.posThrow(p);
      else if (R) this.posHold(p, thr);
      p.bat.visible = !thr || this.phase == null || this.phase < 0.62;
    }
  }

  /** Проба ?pacan: клип по роли; бросок — время клипа по фазе; радость — один раз. */
  private toonUpdate(p: Person, t: Toon, thr: boolean, sit: boolean, dt: number) {
    // почти лицом к городу: бросок из-за плеча идёт вперёд (+ turn — чуть левым плечом вперёд)
    if (thr) p.root.rotation.y = Math.PI - TOON_CFG.turn;
    // клип «сидя на стуле» KayKit рассчитан на сиденье ниже нашей лавочки
    if (sit) p.root.position.y = TOON_CFG.sit;
    if (!p.bat.children.length) {
      const proto = this.batProto();
      if (proto) {
        const b = proto.clone();
        b.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        p.bat.add(b);
      }
    }
    if (p.waveT !== -1) {
      p.waveT += dt;
      if (p.waveT > 1.6) p.waveT = -1;
    }
    if (p.waveT >= 0) t.play('cheer', false, 0.15);
    else if (thr && this.phase != null) t.scrub(TOON_CFG.swing, this.phase, 0.62);
    else t.play(sit ? 'sit' : thr ? TOON_CFG.ready : 'idle');
    t.update(dt);
    p.root.updateMatrixWorld(true);
    // бита на плече (бросающий у черты и стоящие зрители); на замахе (первые 15 % фазы) — плавно в кулак вдоль кости
    const ph = thr && this.phase != null ? this.phase : null;
    t.placeBat(p.bat, 0.42, ph == null ? 1 : Math.max(0, 1 - ph / 0.15), TOON_CFG.readyDir);
    p.bat.visible = !sit && (!thr || this.phase == null || this.phase < 0.62);
  }

  /** Бросающий: правая кисть и бита — по ключевым позам в осях тела, левая — на бите, показывает на город или опущена. */
  private posThrow(p: Person) {
    const b = p.bones;
    const ph = this.phase ?? 0;
    const k = keyPose(ph);
    const yaw = p.root.rotation.y;
    const bf = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, yaw);
    const br = new THREE.Vector3(-1, 0, 0).applyAxisAngle(UP, yaw);
    const body = (v: V3) => new THREE.Vector3().addScaledVector(bf, v[0]).addScaledVector(br, v[1]).addScaledVector(UP, v[2]);
    // наклон вперёд на выбросе
    if (b.spine) rotateWorld(b.spine, _q.setFromAxisAngle(br, ph > 0.55 && ph < 0.95 ? 0.18 : 0.06));
    const sh = wpos(b.upper_armR, new THREE.Vector3());
    const target = sh.clone().add(body(k.hand));
    // локоть — назад и вниз: рука сгибается, а не торчит палкой
    ik2(b.upper_armR, b.forearmR, b.handR, target, body([-0.15, 0.45, -1]));
    const batDir = body(k.bat).normalize();
    this.hold(p, batDir);
    // левая рука: смесь двух соседних положений
    if (b.upper_armL && b.forearmL && b.handL) {
      const shl = wpos(b.upper_armL, new THREE.Vector3());
      const city = new THREE.Vector3(0, 0, -1);
      const spot = (m: number) =>
        m === 0
          ? p.gripAt.clone().addScaledVector(batDir, 0.11)
          : m === 1
            ? shl.clone().addScaledVector(city, 0.42).add(new THREE.Vector3(0, -0.22, 0))
            : shl.clone().addScaledVector(br, -0.14).addScaledVector(bf, 0.08).add(new THREE.Vector3(0, -0.5, 0));
      const [m0, m1, t] = k.left;
      const tl = spot(m0).lerp(spot(m1), t);
      if ((t < 0.5 ? m0 : m1) === 0) this.gripLeft(p, tl, batDir, body([-0.6, -0.4, -0.5]));
      else ik2(b.upper_armL, b.forearmL, b.handL, tl, body([-0.6, -0.4, -0.5]));
    }
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
    if (b.upper_armL && b.forearmL && b.handL) {
      if (thr) {
        // бросающий держит биту двумя руками: левая — ниже по бите
        const t = p.gripAt.clone().addScaledVector(dir, 0.11);
        this.gripLeft(p, t, dir, new THREE.Vector3(0, -0.4, 0).addScaledVector(right, -1));
      } else {
        // левая рука висит вдоль тела
        const shl = wpos(b.upper_armL, new THREE.Vector3());
        const len = boneLen(b.upper_armL, b.forearmL) + boneLen(b.forearmL, b.handL);
        const t = shl.clone().addScaledVector(right, -0.06).addScaledVector(fwd, 0.04);
        t.y -= len * 0.97;
        ik2(b.upper_armL, b.forearmL, b.handL, t, fwd.clone().negate());
      }
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

  /** Бросающий стоит широко, ноги в шаг вдоль линии броска (корпус боком к полю). */
  private posStep(p: Person) {
    const b = p.bones;
    if (!b.thighL || !b.thighR) return;
    const yaw = p.root.rotation.y;
    const bf = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, yaw);
    const ph = this.phase ?? 0;
    const k = ph > 0.55 && ph < 0.95 ? 1.25 : 1;
    rotateWorld(b.thighL, _q.setFromAxisAngle(bf, -0.17 * k));
    rotateWorld(b.thighR, _q.setFromAxisAngle(bf, 0.15 * k));
    if (b.shinL) rotateWorld(b.shinL, _q.setFromAxisAngle(bf, 0.05 * k));
    if (b.shinR) rotateWorld(b.shinR, _q.setFromAxisAngle(bf, -0.05 * k));
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

  /** Левая рука на бите: кулак (кость grip.L) — в точке на бите, канал кулака — вдоль биты. Цель IK — запястье,
   * поэтому пару раз поправляем её на промах кулака. Старые модели без grip.L — просто запястье в точку. */
  private gripLeft(p: Person, at: THREE.Vector3, dir: THREE.Vector3, pole: THREE.Vector3) {
    const b = p.bones;
    if (!b.upper_armL || !b.forearmL || !b.handL) return;
    if (b.gripL) {
      // не дотягивается — кулак ниже по бите, в ближайшую к плечу точку (рука короче, чем у прежних моделей)
      const sh = wpos(b.upper_armL, new THREE.Vector3());
      const reach = boneLen(b.upper_armL, b.forearmL) + boneLen(b.forearmL, b.handL) + boneLen(b.handL, b.gripL) * 0.9;
      if (sh.distanceTo(at) > reach) {
        let best = at.clone();
        let bd = Infinity;
        for (let s = 0.09; s <= 0.45; s += 0.02) {
          const q = p.gripAt.clone().addScaledVector(dir, s);
          const dd = sh.distanceTo(q);
          if (dd < bd) (bd = dd), (best = q);
        }
        at = best;
      }
    }
    const t = at.clone();
    for (let i = 0; i < 3; i++) {
      ik2(b.upper_armL, b.forearmL, b.handL, t, pole);
      if (!b.gripL) return;
      const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(b.gripL.getWorldQuaternion(_q2)).normalize();
      if (cur.dot(dir) < 0) cur.negate();
      rotateWorld(b.handL, new THREE.Quaternion().setFromUnitVectors(cur, dir));
      b.gripL.updateMatrixWorld(true);
      t.add(at.clone().sub(wpos(b.gripL, new THREE.Vector3())));
    }
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
    if (p.bones.gripR) {
      // середина кулака — кость grip.R
      p.bones.gripR.updateMatrixWorld(true);
      fist = wpos(p.bones.gripR, new THREE.Vector3());
    } else if (p.fist) {
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
    p.gripAt.copy(fist);
    const bat = p.bat;
    bat.quaternion.setFromUnitVectors(UP, dir);
    // центр биты — от кулака вдоль биты; рукоять торчит из кулака на 6 см
    bat.position.copy(fist).addScaledVector(dir, 0.42 - 0.06);
  }

  dispose() {
    this.disposed = true;
  }
}
