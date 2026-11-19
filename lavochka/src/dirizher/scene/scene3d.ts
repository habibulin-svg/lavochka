/* Симулятор дирижёра — 3D-сцена: зал, оркестр, дирижёр со спины.
 * Музыкант = тело (public/dirizher/m/<вид>.glb, MakeHuman в концертном чёрном, dirizher_people.py) + действия и инструмент
 * (public/dirizher/a/<инструмент>_<пол>.glb, dirizher_anims.py: скелет, сетки инструментов на костях, rest/play).
 * Играет или отдыхает — по нотам его инструмента; цикл play (2 доли) — под текущий темп. Промах вступления — играет вяло.
 * Мебель (стулья, пюпитры, подиум) — public/dirizher/m/props.glb. Оси three: оркестр перед дирижёром — к −Z,
 * музыканты смотрят на +Z (на подиум в начале координат), камера — сзади-сверху за дирижёром. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Chart, Mark } from '../core/chart';
import type { Grade, Performance } from '../core/perform';
import { barsOf, laneOf, notesOf, PPQ, type InstrId, type ScoreJson } from '../core/score';
import type { Stage } from './stage';

const BASE = `${import.meta.env.BASE_URL}dirizher/`;
const V = 3; // версия моделей (кэш)

/** Какой файл движений у инструмента. */
const ANIM_OF: Partial<Record<InstrId, string>> = {
  vn1: 'violin', vn2: 'violin', va: 'viola', vc: 'cello', cb: 'contrabass', harp: 'cello',
  picc: 'piccolo', fl: 'flute', ob: 'oboe', eh: 'oboe', cl: 'clarinet', bcl: 'clarinet', bn: 'bassoon', cbn: 'bassoon',
  hn: 'horn', tp: 'trumpet', tb: 'trombone', tu: 'tuba', timp: 'timpani',
};
const BODIES = { m: ['m1', 'm2', 'm3', 'm4', 'm5'], f: ['f1', 'f2', 'f3', 'f4', 'f5'] };
/** Кто сидит на месте: примерно поровну мужчин и женщин, вразнобой, но одинаково от раза к разу. */
const sexOf = (i: number): 'm' | 'f' => (((i * 2654435761) >>> 0) % 100 < 46 ? 'f' : 'm');

/** Рассадка: [угол от оси (рад, минус — слева), радиус, высота подиума] для каждого места. */
interface Seat {
  instr: InstrId;
  pos: THREE.Vector3;
  /** Пюпитр — на двоих (у первого из пары). */
  stand: boolean;
  tall: boolean;
}

function arcSeats(instr: InstrId, n: number, a0: number, a1: number, r0: number, rows: number, rowGap: number, y: number, out: Seat[], tall = false): void {
  const perRow = Math.ceil(n / rows);
  let k = 0;
  for (let row = 0; row < rows && k < n; row++) {
    const r = r0 + row * rowGap;
    const m = Math.min(perRow, n - k);
    for (let i = 0; i < m; i++, k++) {
      const a = m === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * (i + 0.5)) / m;
      out.push({ instr, pos: new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r), stand: i % 2 === 0, tall });
    }
  }
}

const D = Math.PI / 180;

/** Рассадка оркестра под состав пьесы. small — телефон: меньше людей. */
export function seating(counts: Partial<Record<InstrId, number>>, small: boolean): Seat[] {
  const out: Seat[] = [];
  const k = small ? 0.5 : 1;
  const n = (i: InstrId, full: number) => (counts[i] ? Math.max(1, Math.round(full * k)) : 0);
  arcSeats('vn1', n('vn1', 8), -84 * D, -42 * D, 2.3, 2, 1.0, 0, out);
  arcSeats('vn2', n('vn2', 6), -40 * D, -8 * D, 2.3, 2, 1.0, 0, out);
  arcSeats('va', n('va', 5), 8 * D, 40 * D, 2.3, 2, 1.0, 0, out);
  arcSeats('vc', n('vc', 4), 42 * D, 84 * D, 2.3, 2, 1.0, 0, out);
  arcSeats('cb', n('cb', 3), 50 * D, 76 * D, 4.6, 1, 0, 0.2, out, true);
  const ww = (i: InstrId, a: number, r: number) => {
    const c = Math.min(counts[i] ?? 0, 2);
    for (let j = 0; j < c; j++) out.push({ instr: i, pos: new THREE.Vector3(Math.sin(a + j * 6 * D) * r, 0.25, -Math.cos(a + j * 6 * D) * r), stand: j === 0, tall: false });
  };
  ww('fl', -16 * D, 4.4);
  ww('picc', -26 * D, 4.4);
  ww('ob', 4 * D, 4.4);
  ww('eh', 16 * D, 4.4);
  ww('cl', -16 * D, 5.3);
  ww('bcl', -26 * D, 5.3);
  ww('bn', 4 * D, 5.3);
  ww('cbn', 16 * D, 5.3);
  const br = (i: InstrId, a: number, r: number, y: number, max: number) => {
    const c = Math.min(counts[i] ?? 0, max);
    for (let j = 0; j < c; j++) out.push({ instr: i, pos: new THREE.Vector3(Math.sin(a + j * 5 * D) * r, y, -Math.cos(a + j * 5 * D) * r), stand: j % 2 === 0, tall: false });
  };
  br('hn', -42 * D, 6.0, 0.5, small ? 2 : 4);
  br('tp', -8 * D, 6.2, 0.5, 2);
  br('tb', 14 * D, 6.2, 0.5, 3);
  br('tu', 32 * D, 6.2, 0.5, 1);
  if (counts.timp) out.push({ instr: 'timp', pos: new THREE.Vector3(-0.2, 0.75, -7.2), stand: false, tall: true });
  return out;
}

interface Musician {
  seat: Seat;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  rest: THREE.AnimationAction;
  play: THREE.AnimationAction;
  /** Вес «играет» 0..1 (плавно). */
  w: number;
  lane: number;
  phase: number;
}

export class Scene3D implements Stage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private cache = new Map<string, Promise<GLTF>>();
  private people: Musician[] = [];
  private chart: Chart | null = null;
  /** Звучит ли инструмент на тике: по нотам (интервалы, отсортированы). */
  private sounding = new Map<InstrId, [number, number][]>();
  private glow: THREE.Mesh[] = [];
  private glowT: number[] = [];
  private conductor: Maestro | null = null;
  private ro: ResizeObserver;
  private disposed = false;
  private small: boolean;
  ready: Promise<void>;

  constructor(
    private host: HTMLElement,
    private score: ScoreJson,
    opts: { small?: boolean; hall?: string } = {}
  ) {
    this.small = opts.small ?? (Math.min(innerWidth, innerHeight) < 600 || navigator.hardwareConcurrency <= 4);
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.small, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.small ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.scene.background = new THREE.Color('#120c0a');
    this.scene.fog = new THREE.Fog('#120c0a', 18, 40);
    this.light();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.ready = this.build(opts.hall);
  }

  private load(url: string): Promise<GLTF> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.loader.loadAsync(`${BASE}${url}?v=${V}`);
      this.cache.set(url, p);
    }
    return p;
  }

  private light(): void {
    const sc = this.scene;
    sc.add(new THREE.HemisphereLight('#ffe8c8', '#3a2418', 0.55));
    const key = new THREE.SpotLight('#fff0d8', 260, 30, 0.55, 0.6, 1.4);
    key.position.set(0, 12, 6);
    key.target.position.set(0, 0, -3.5);
    sc.add(key, key.target);
    const back = new THREE.DirectionalLight('#ffd9a0', 0.8);
    back.position.set(-4, 8, -10);
    sc.add(back);
  }

  private stageFloor(): void {
    // запасная сцена, пока нет модели зала: паркет-полукруг и ступени-подиумы
    const wood = new THREE.MeshStandardMaterial({ color: '#6a3f22', roughness: 0.55, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9.5, 64, Math.PI, Math.PI), wood);
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 0.8;
    this.scene.add(floor);
    for (const [r0, r1, h] of [[3.9, 5.7, 0.25], [5.7, 6.9, 0.5], [6.9, 8.2, 0.75]] as const) {
      const g = new THREE.RingGeometry(r0, r1, 64, 1, Math.PI * 0.15, Math.PI * 0.7);
      const m = new THREE.Mesh(g, wood);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.PI;
      m.position.y = h;
      this.scene.add(m);
    }
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 8, 48, 1, true, Math.PI * 0.5, Math.PI), new THREE.MeshStandardMaterial({ color: '#4a2c1c', roughness: 0.8, side: THREE.BackSide }));
    wall.position.y = 4;
    wall.position.z = 0.8;
    this.scene.add(wall);
  }

  private async build(hall?: string): Promise<void> {
    // зал
    let hallOk = false;
    if (hall) {
      try {
        const g = await this.load(`h/${hall}.glb`);
        this.scene.add(g.scene);
        hallOk = true;
      } catch {
        /* нет модели — запасная сцена */
      }
    }
    if (!hallOk) this.stageFloor();
    // состав
    const counts: Partial<Record<InstrId, number>> = {};
    for (const p of this.score.parts) counts[p.instr] = (counts[p.instr] ?? 0) + 1;
    for (const p of this.score.parts) {
      const iv: [number, number][] = this.sounding.get(p.instr) ?? [];
      for (const n of notesOf(p)) iv.push([n.tick, n.tick + n.dur]);
      this.sounding.set(p.instr, iv);
    }
    for (const iv of this.sounding.values()) {
      iv.sort((a, b) => a[0] - b[0]);
      // склеить паузы короче половины доли: смычок не дёргается на каждой ноте
      const merged: [number, number][] = [];
      for (const x of iv) {
        const last = merged[merged.length - 1];
        if (last && x[0] - last[1] < PPQ * 1.5) last[1] = Math.max(last[1], x[1]);
        else merged.push([x[0], x[1]]);
      }
      iv.length = 0;
      iv.push(...merged);
    }
    const seats = seating(counts, this.small);
    const props = await this.load('m/props.glb').catch(() => null);
    const prop = (name: string) => props?.scene.getObjectByName(name) ?? null;
    const chair = prop('chair');
    const stool = prop('stool');
    const stand = prop('stand');
    const podium = prop('podium');
    if (podium) {
      const p = podium.clone();
      p.position.set(0, 0, 0);
      this.scene.add(p);
    }
    let vi = 0;
    const jobs = seats.map(async (s, i) => {
      const anim = ANIM_OF[s.instr];
      if (!anim) return;
      const sex = sexOf(i);
      const bodyId = BODIES[sex][(vi++ * 3 + i) % BODIES[sex].length];
      const [body, act] = await Promise.all([this.load(`m/${bodyId}.glb`), this.load(`a/${anim}_${sex}.glb`)]);
      if (this.disposed) return;
      const root = SkeletonUtils.clone(body.scene);
      root.position.copy(s.pos);
      root.lookAt(new THREE.Vector3(0, s.pos.y, 0.6));
      // инструменты: сетки, висящие на костях в файле движений → на те же кости тела
      // (в файле: кость → пустышка инструмента → сетки; берём пустышку целиком)
      const attach: THREE.Object3D[] = [];
      act.scene.traverse((o) => {
        if ((o as THREE.Bone).isBone || !o.parent || !(o.parent as THREE.Bone).isBone) return;
        if (!o.getObjectByProperty('isMesh', true)) return;
        attach.push(o);
      });
      for (const o of attach) {
        const bone = root.getObjectByName(o.parent!.name);
        if (bone) bone.add(o.clone());
      }
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.frustumCulled = false;
        }
      });
      const mixer = new THREE.AnimationMixer(root);
      const clip = (n: string) => act.animations.find((a) => a.name === n) ?? act.animations[0];
      const rest = mixer.clipAction(clip('rest'));
      const play = mixer.clipAction(clip('play'));
      rest.play();
      play.play();
      play.setEffectiveWeight(0);
      rest.setEffectiveWeight(1);
      play.time = Math.random() * 0.4;
      this.scene.add(root);
      // стул и пюпитр
      const seatObj = s.tall ? stool : chair;
      if (seatObj && s.instr !== 'timp') {
        const c = seatObj.clone();
        c.position.copy(s.pos);
        c.rotation.copy(root.rotation);
        this.scene.add(c);
      }
      if (stand && s.stand) {
        const st = stand.clone();
        const toC = new THREE.Vector3(-s.pos.x, 0, 0.6 - s.pos.z).normalize();
        st.position.copy(s.pos).addScaledVector(toC, 0.75);
        st.position.y = s.pos.y;
        st.lookAt(s.pos.x, s.pos.y, s.pos.z);
        st.rotateY(Math.PI);
        this.scene.add(st);
      }
      this.people.push({ seat: s, root, mixer, rest, play, w: 0, lane: -1, phase: 0 });
    });
    // дирижёр: тело + движения (a/conductor_m.glb: ready, beat2/3/4, l_cue/l_up/l_hush, hold, bow) и палочка
    const maestro = Promise.all([this.load('m/maestro.glb'), this.load('a/conductor_m.glb')]).then(([g, a]) => {
      if (this.disposed) return;
      const root = SkeletonUtils.clone(g.scene);
      root.rotation.y = Math.PI;
      this.scene.add(root);
      const keep: THREE.Object3D[] = [];
      a.scene.traverse((o) => {
        if (!(o as THREE.Bone).isBone && o.parent && (o.parent as THREE.Bone).isBone && o.getObjectByProperty('isMesh', true)) keep.push(o);
      });
      for (const o of keep) root.getObjectByName(o.parent!.name)?.add(o.clone());
      root.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.frustumCulled = false) : null));
      this.conductor = new Maestro(root, a.animations);
    });
    await Promise.allSettled([...jobs, maestro]);
    if (this.chart) this.bindLanes();
  }

  bind(_perf: Performance, chart: Chart): void {
    this.chart = chart;
    this.bars = barsOf(this.score);
    this.glow.forEach((g) => g.removeFromParent());
    this.glow = [];
    this.glowT = [];
    this.bindLanes();
  }

  private bindLanes(): void {
    const c = this.chart;
    if (!c) return;
    for (const p of this.people) p.lane = laneOf(c.lanes, p.seat.instr);
    // подсветка групп: пятно на полу под строкой
    if (!this.glow.length)
      c.lanes.forEach((l, li) => {
        const ps = this.people.filter((p) => p.lane === li);
        if (!ps.length) return;
        const ctr = new THREE.Vector3();
        ps.forEach((p) => ctr.add(p.seat.pos));
        ctr.divideScalar(ps.length);
        const rad = Math.max(0.9, Math.max(...ps.map((p) => p.seat.pos.distanceTo(ctr))) + 0.7);
        const m = new THREE.Mesh(
          new THREE.CircleGeometry(rad, 48),
          new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(ctr.x, ctr.y + 0.02, ctr.z);
        this.scene.add(m);
        this.glow[li] = m;
        this.glowT[li] = 0;
      });
  }

  private isSounding(instr: InstrId, tick: number): boolean {
    const iv = this.sounding.get(instr);
    if (!iv) return false;
    let lo = 0;
    let hi = iv.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (iv[m][1] < tick) lo = m + 1;
      else if (iv[m][0] > tick) hi = m - 1;
      else return true;
    }
    return false;
  }

  update(dt: number, perf: Performance): void {
    const bpm = perf.tm.bpm(perf.tick) * perf.opts.speed * perf.live;
    const frozen = perf.frozen;
    // какие вступления сыграны вяло
    const timid = new Set<number>();
    if (this.chart)
      for (const m of this.chart.marks) {
        if (m.tick > perf.tick) break;
        if (m.kind === 'cue' && m.lane >= 0) {
          const q = perf.quality.get(m.id);
          if (q === 0) timid.add(m.lane);
          else timid.delete(m.lane);
        }
      }
    for (const p of this.people) {
      const want = this.isSounding(p.seat.instr, perf.tick + PPQ * 0.25) ? (timid.has(p.lane) ? 0.55 : 1) : 0;
      p.w += (want - p.w) * Math.min(1, dt * (want > p.w ? 6 : 3));
      p.play.setEffectiveWeight(p.w);
      p.rest.setEffectiveWeight(1 - p.w);
      p.play.timeScale = frozen ? 0.05 : bpm / 60;
      p.mixer.update(dt);
    }
    if (this.conductor) {
      const bars = this.bars;
      let bi = 0;
      while (bi + 1 < bars.length && bars[bi + 1].tick <= perf.tick) bi++;
      const b = bars[bi];
      const phase = b ? (perf.tick - b.tick) / (b.num * b.beat) : 0;
      this.conductor.update(dt, b?.num ?? 4, phase, frozen, this.turnTo);
    }
    // пятна групп: скоро вступление — разгорается
    if (this.chart)
      this.glow.forEach((g, li) => {
        if (!g) return;
        let soon = 0;
        for (const m of this.chart!.marks) {
          if (m.lane !== li || perf.quality.has(m.id)) continue;
          const s = perf.secTo(m.tick);
          if (s > 2) break;
          if (s > -0.2) soon = Math.max(soon, 1 - Math.max(0, s) / 2);
        }
        this.glowT[li] = Math.max(0, this.glowT[li] - dt * 2);
        (g.material as THREE.MeshBasicMaterial).opacity = 0.12 * soon + 0.35 * this.glowT[li];
      });
    this.renderer.render(this.scene, this.camera);
  }

  judge(m: Mark, g: Grade): void {
    if (m.lane >= 0 && g !== 'miss') this.glowT[m.lane] = 1;
  }
  fermata(on: boolean): void {
    this.conductor?.gesture(on ? 'hold' : 'none');
  }
  dynamics(level: number): void {
    this.conductor?.gesture(level > 1 ? 'up' : 'hush');
  }
  /** Показ группе: дирижёр поворачивается к ней и выбрасывает левую руку. */
  point(lane: number): void {
    const ps = this.people.filter((p) => p.lane === lane);
    if (ps.length) {
      const x = ps.reduce((a, p) => a + p.seat.pos.x, 0) / ps.length;
      const z = ps.reduce((a, p) => a + p.seat.pos.z, 0) / ps.length;
      this.turnTo = Math.atan2(x, -z) * 0.6;
    }
    this.conductor?.gesture('cue');
  }
  private turnTo = 0;
  private bars: { tick: number; num: number; beat: number }[] = [];

  resize(): void {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const aspect = r.width / r.height;
    this.camera.aspect = aspect;
    // сзади-сверху: голова дирижёра — ниже первого ряда оркестра, руки с палочкой — на фоне сцены; вверху кадра — зал.
    // Узкий экран (телефон стоя) — шире угол и круче сверху: весь полукруг, меньше стены
    if (aspect < 1.15) this.game = { pos: new THREE.Vector3(0, 6.3, 4.4), at: new THREE.Vector3(0, 0.2, -3.6), fov: 66 };
    else {
      const k = aspect < 1.4 ? 1.2 : 1;
      this.game = { pos: new THREE.Vector3(0, 5.0 * k, 4.2 * k), at: new THREE.Vector3(0, 1.2, -4.6), fov: 48 };
    }
    if (!this.cam) this.setPose(this.game);
  }

  private game: Pose = { pos: new THREE.Vector3(0, 5, 4.2), at: new THREE.Vector3(0, 1.2, -4.6), fov: 48 };
  /** Пролёт камеры (вступление, поклон): позы по очереди. */
  private cam: { path: Pose[]; times: number[]; t: number; done: () => void } | null = null;
  private loopRaf = 0;
  private lastT = 0;
  /** Сцена рисует себя сама (до начала игры и после конца); во время игры — update() из цикла концерта. */
  private idleLoop = true;

  private setPose(p: Pose): void {
    this.camera.position.copy(p.pos);
    this.camera.lookAt(p.at);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Камера по пути из поз (с плавностью); пока летит — сцена рисуется своим циклом. */
  private fly(path: Pose[], times: number[]): Promise<void> {
    return new Promise((resolve) => {
      this.cam = { path, times, t: 0, done: resolve };
      this.lastT = performance.now();
      const loop = (now: number) => {
        if (this.disposed || !this.cam) return;
        const dt = Math.min(0.1, (now - this.lastT) / 1000);
        this.lastT = now;
        this.stepCam(dt);
        if (this.idleLoop) {
          for (const p of this.people) p.mixer.update(dt);
          this.conductor?.idle(dt);
          this.renderer.render(this.scene, this.camera);
        }
        if (this.cam) this.loopRaf = requestAnimationFrame(loop);
      };
      this.loopRaf = requestAnimationFrame(loop);
    });
  }

  private stepCam(dt: number): void {
    const c = this.cam;
    if (!c) return;
    c.t += dt;
    let i = 0;
    let t0 = 0;
    while (i < c.times.length && c.t > t0 + c.times[i]) {
      t0 += c.times[i];
      i++;
    }
    if (i >= c.times.length) {
      this.setPose(c.path[c.path.length - 1]);
      const done = c.done;
      this.cam = null;
      done();
      return;
    }
    const u = (c.t - t0) / c.times[i];
    const e = u * u * (3 - 2 * u);
    const a = c.path[i];
    const b = c.path[i + 1];
    this.setPose({ pos: a.pos.clone().lerp(b.pos, e), at: a.at.clone().lerp(b.at, e), fov: a.fov + (b.fov - a.fov) * e });
  }

  /** Вступление: зал со сцены (ярусы, люстра, публика) → пролёт над оркестром → за спину дирижёра. */
  async intro(): Promise<void> {
    await this.ready;
    this.idleLoop = true;
    const hall = { pos: new THREE.Vector3(0, 4.5, -7.5), at: new THREE.Vector3(0, 4.5, 14), fov: 60 };
    const hall2 = { pos: new THREE.Vector3(0, 6.5, -6), at: new THREE.Vector3(0, 3, 8), fov: 58 };
    const over = { pos: new THREE.Vector3(0, 8, -1), at: new THREE.Vector3(0, 0.5, -4), fov: 55 };
    this.setPose(hall);
    await this.fly([hall, hall2, over, this.game], [1.6, 1.3, 1.3]);
  }

  /** Пропустить облёт (нажали клавишу). */
  skip(): void {
    if (this.cam) this.cam.t = 1e9;
  }

  /** Поклон: дирижёр поворачивается к публике и кланяется, камера — из зала. */
  async outro(): Promise<void> {
    this.idleLoop = true;
    for (const p of this.people) {
      p.play.setEffectiveWeight(0);
      p.rest.setEffectiveWeight(1);
    }
    this.conductor?.bow();
    const front = { pos: new THREE.Vector3(0, 3.0, 8.5), at: new THREE.Vector3(0, 1.8, -2.5), fov: 50 };
    await this.fly([{ pos: this.camera.position.clone(), at: this.game.at.clone(), fov: this.camera.fov }, front, front], [1.4, 2.6]);
  }

  /** Игра началась: рисует цикл концерта. */
  playing(): void {
    this.idleLoop = false;
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.loopRaf);
    this.conductor = null;
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}


interface Pose {
  pos: THREE.Vector3;
  at: THREE.Vector3;
  fov: number;
}

type Gesture = 'none' | 'cue' | 'up' | 'hush' | 'hold';
const LEFT_ARM = /^(clavicle_l|upperarm_l|lowerarm_l|hand_l|thumb_\d+_l|index_\d+_l|middle_\d+_l|ring_\d+_l|pinky_\d+_l)\./;

/** Дирижёр: правая рука ведёт схему такта (2/3/4) в фазе с тактом, левая показывает жесты поверх. */
class Maestro {
  private mixer: THREE.AnimationMixer;
  private beats: Record<number, THREE.AnimationAction> = {};
  private leftRest: THREE.AnimationAction | null = null;
  private left: Partial<Record<Gesture, THREE.AnimationAction>> = {};
  private hold: THREE.AnimationAction | null = null;
  private g: Gesture = 'none';
  private gT = 0;
  private gw = 0;
  private hw = 0;
  private yaw = 0;
  private cur = 4;

  constructor(
    private root: THREE.Object3D,
    clips: THREE.AnimationClip[]
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    const byName = (n: string) => clips.find((c) => c.name === n);
    const split = (c: THREE.AnimationClip, leftArm: boolean) => {
      const x = c.clone();
      x.tracks = x.tracks.filter((t) => LEFT_ARM.test(t.name) === leftArm);
      return x;
    };
    for (const n of [2, 3, 4]) {
      const c = byName(`beat${n}`);
      if (!c) continue;
      const a = this.mixer.clipAction(split(c, false));
      a.play();
      a.setEffectiveWeight(n === 4 ? 1 : 0);
      this.beats[n] = a;
    }
    const beat4 = byName('beat4');
    if (beat4) {
      this.leftRest = this.mixer.clipAction(split(beat4, true));
      this.leftRest.play();
    }
    for (const gname of ['cue', 'up', 'hush'] as Gesture[]) {
      const c = byName(`l_${gname}`);
      if (!c) continue;
      const a = this.mixer.clipAction(split(c, true));
      a.play();
      a.setEffectiveWeight(0);
      this.left[gname] = a;
    }
    const bw = byName('bow');
    if (bw) this.bowAct = this.mixer.clipAction(bw);
    const h = byName('hold');
    if (h) {
      this.hold = this.mixer.clipAction(h);
      this.hold.play();
      this.hold.setEffectiveWeight(0);
    }
  }

  private bowAct: THREE.AnimationAction | null = null;
  private bowing = false;

  /** До начала: палочка поднята, такт не идёт. */
  idle(dt: number): void {
    if (this.bowing) {
      this.root.rotation.y += (0 - this.root.rotation.y) * Math.min(1, dt * 3);
      this.mixer.update(dt);
      return;
    }
    this.update(dt, this.cur, 0, false, 0);
  }

  bow(): void {
    this.bowing = true;
    this.mixer.stopAllAction();
    if (this.bowAct) {
      this.bowAct.reset();
      this.bowAct.setLoop(THREE.LoopOnce, 1);
      this.bowAct.clampWhenFinished = true;
      this.bowAct.setEffectiveWeight(1);
      this.bowAct.play();
    }
  }

  gesture(g: Gesture): void {
    if (g === 'hold' || (g === 'none' && this.g === 'hold')) {
      this.g = g;
      return;
    }
    this.g = g;
    this.gT = g === 'cue' ? 0.7 : 1.4;
  }

  update(dt: number, num: number, phase: number, frozen: boolean, turn: number): void {
    if (this.bowing) return this.idle(dt);
    const n = num === 6 || num === 2 ? 2 : num === 3 || num === 9 ? 3 : 4;
    this.cur = n;
    for (const [k, a] of Object.entries(this.beats)) {
      const on = Number(k) === this.cur;
      a.setEffectiveWeight(on ? 1 - this.hw : 0);
      a.time = phase * a.getClip().duration;
    }
    // жест левой: всплывает и гаснет
    if (this.g !== 'hold') this.gT -= dt;
    const want = this.g !== 'none' && this.g !== 'hold' && this.gT > 0 ? 1 : 0;
    this.gw += (want - this.gw) * Math.min(1, dt * (want ? 10 : 4));
    for (const [k, a] of Object.entries(this.left)) a!.setEffectiveWeight(k === this.g ? this.gw : 0);
    this.leftRest?.setEffectiveWeight(1 - this.gw);
    if (this.leftRest) this.leftRest.time = phase * this.leftRest.getClip().duration;
    this.hw += ((this.g === 'hold' || frozen ? 1 : 0) - this.hw) * Math.min(1, dt * 8);
    this.hold?.setEffectiveWeight(this.hw);
    // поворот к группе и обратно
    this.yaw += ((this.gT > 0 ? turn : 0) - this.yaw) * Math.min(1, dt * 4);
    this.root.rotation.y = Math.PI + this.yaw;
    this.mixer.update(dt);
  }
}
