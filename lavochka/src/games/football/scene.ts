/* 3D-стол настольного футбола «Kopana» (three.js) по фото пользователя: белый жестяной поднос с загнутым бортом и надписью,
 * зелёное поле в рубчик, люверсы, пластмассовые рыжие и белые футболисты на пружинках с шариком-подставкой,
 * вратари на рычагах (ручка ходит в дуге за воротами), белые ворота с сеткой, мяч. Единицы — метры, как в движке. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { woodTexture, WOODS } from '../../core/wood';
import { BALL_R, CORNER, fieldAt, FIG_R, GOAL_D, GOAL_W, keeperX, KEEPER_RANGE, LX, SPOTS, TX, TZ, type FbState } from './engine';
import { ballCanvas, brandCanvas, DASH, dashBumpCanvas, fieldCanvas, netCanvas } from './tex';

/** Высота поля над столом; ширина загнутого борта подноса. */
export const FY = 0.022;
const RIMW = 0.034;
const GOAL_H = 0.034;
/** Пружина и шарик-подставка: высота центра подставки над полем. */
const SPRING_H = 0.006;
const BASE_Y = SPRING_H + FIG_R;

export type Cam = 'side' | 'end' | 'corner';

/** Выемки на глаз глубже, чем в физике (уклон в несколько процентов почти не даёт светотени); всё, что стоит на поле, — по этой же высоте. */
const VIS = 0.45;
const fh = (x: number, z: number): [number] => [fieldAt(x, z)[0] * VIS];

const COLORS = [
  { body: '#d4642c', pale: '#e9a77c' },
  { body: '#f1efe6', pale: '#f7f2dc' },
];

const tex = (cv: HTMLCanvasElement, aniso = 8) => {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};

/** Точки скруглённого прямоугольника, отодвинутого наружу на off (одинаковое число точек при любом off). */
function outline(off: number, per = 10): [number, number][] {
  const hx = TX - CORNER;
  const hz = TZ - CORNER;
  const r = CORNER + off;
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [hx, hz, 0],
    [-hx, hz, Math.PI / 2],
    [-hx, -hz, Math.PI],
    [hx, -hz, (3 * Math.PI) / 2],
  ];
  for (const [cx, cz, a0] of corners)
    for (let i = 0; i <= per; i++) {
      const a = a0 + (i / per) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  return pts;
}

/** Капсула от точки a до b радиусом r. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, len, 4, 8);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Пластмассовый футболист в замахе (удар — по +x), стоит на высоте y0. Вратарь — руки в стороны, ноги врозь. */
function bodyGeo(keeper: boolean, y0: number): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y0 + y, z);
  const hip = 0.019;
  const sh = 0.032;
  const parts: THREE.BufferGeometry[] = [];
  if (keeper) {
    parts.push(limb(V(0, hip, -0.0035), V(0.001, 0.001, -0.007), 0.0026), limb(V(0, hip, 0.0035), V(0.001, 0.001, 0.007), 0.0026));
    parts.push(limb(V(0, sh - 0.002, -0.004), V(0.002, sh + 0.006, -0.016), 0.0021), limb(V(0, sh - 0.002, 0.004), V(0.002, sh + 0.006, 0.016), 0.0021));
  } else {
    // опорная нога прямо, ударная — назад-вверх в замахе; руки — для равновесия
    parts.push(limb(V(0, hip, -0.003), V(0.001, 0.0015, -0.003), 0.0027));
    parts.push(limb(V(0, hip, 0.003), V(-0.008, hip - 0.008, 0.004), 0.0026), limb(V(-0.008, hip - 0.008, 0.004), V(-0.014, hip - 0.002, 0.004), 0.0024));
    parts.push(limb(V(0.001, sh - 0.002, -0.004), V(0.008, sh - 0.007, -0.011), 0.002), limb(V(-0.001, sh - 0.002, 0.004), V(-0.008, sh - 0.009, 0.01), 0.002));
  }
  parts.push(limb(V(0, hip, 0), V(0.001, sh, 0), 0.0047));
  const head = new THREE.SphereGeometry(0.0043, 16, 12);
  head.translate(0.0015, y0 + sh + 0.0065, 0);
  parts.push(head);
  // шорты чуть шире — бёдра
  const shorts = new THREE.CylinderGeometry(0.0052, 0.0056, 0.006, 12);
  shorts.translate(0, y0 + hip, 0);
  parts.push(shorts);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

/** Пружинка — винтовая линия от поля до подставки. */
function springGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const turns = 4;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.0022, t * (SPRING_H + 0.002) - 0.001, Math.sin(a) * 0.0022));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.00045, 5, false);
}

interface FigObj {
  tilt: THREE.Group;
  ring: THREE.Mesh;
}

export class Pitch3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1.6, 0.02, 20);
  private figs: FigObj[] = [];
  private keepers: THREE.Group[] = [];
  private handles: THREE.Group[] = [];
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private lastBall = new THREE.Vector3();
  private disposables: { dispose(): void }[] = [];
  private ro: ResizeObserver;
  private camMode: Cam = 'side';
  private camTeam: 0 | 1 = 0;
  private camGoal = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private ray = new THREE.Raycaster();
  private fieldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FY);

  constructor(private host: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.build();
    this.ball = this.makeBall();
    this.ballShadow = this.makeShadow();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __fb: Pitch3D }).__fb = this;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private build() {
    const sc = this.scene;
    sc.background = new THREE.Color('#2a1f18');
    sc.fog = new THREE.Fog('#2a1f18', 1.8, 4.5);
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = this.keep(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    sc.environmentIntensity = 0.44;
    pm.dispose();

    sc.add(new THREE.HemisphereLight('#fff4e2', '#3a2c22', 0.55));
    const key = new THREE.DirectionalLight('#fff1dc', 1.55);
    key.position.set(-0.6, 0.85, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c2 = key.shadow.camera;
    c2.left = -0.42;
    c2.right = 0.42;
    c2.top = 0.32;
    c2.bottom = -0.32;
    c2.near = 0.5;
    c2.far = 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0012;
    key.shadow.radius = 3;
    sc.add(key);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.5);
    fill.position.set(0.8, 0.9, -0.6);
    sc.add(fill);

    // стол
    const wood = new THREE.TextureLoader().load(woodTexture(WOODS.walnut, 1024, 11, false));
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(3, 3);
    this.keep(wood);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    sc.add(table);

    // поле: жесть с выемками у ног фигурок и загибом к бортам — та же поверхность, по которой катится мяч;
    // углы скруглены прозрачностью текстуры, рубчик — рельефом
    const fg = new THREE.PlaneGeometry(TX * 2, TZ * 2, 300, 180);
    fg.rotateX(-Math.PI / 2);
    const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, FY + fh(p.getX(i), p.getZ(i))[0]);
    fg.computeVertexNormals();
    const bump = this.keep(tex(dashBumpCanvas(), 8));
    bump.colorSpace = THREE.NoColorSpace;
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set((TX * 2) / DASH.x, (TZ * 2) / (DASH.z * 2));
    const field = new THREE.Mesh(
      fg,
      new THREE.MeshPhysicalMaterial({ map: this.keep(tex(fieldCanvas(), 16)), alphaTest: 0.5, bumpMap: bump, bumpScale: 1.1, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.18 })
    );
    field.receiveShadow = true;
    sc.add(field);
    // под полем — днище (чтобы не просвечивал стол)
    const under = new THREE.Mesh(new THREE.BoxGeometry(TX * 2, 0.002, TZ * 2), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }));
    under.position.y = 0.001;
    sc.add(under);

    // поднос: загнутый борт белой эмали — профиль (отступ наружу, высота), протянутый вдоль контура
    const edgeY = FY + fh(TX, 0)[0];
    const prof: [number, number][] = [
      [0, edgeY],
      [0.003, FY + 0.0025],
      [RIMW - 0.006, FY + 0.0095],
      [RIMW - 0.001, FY + 0.012],
      [RIMW + 0.003, FY + 0.0118],
      [RIMW + 0.0055, FY + 0.009],
      [RIMW + 0.006, 0.004],
      [RIMW + 0.004, 0.0008],
    ];
    const rings = prof.map(([off]) => outline(off, 12));
    const n = rings[0].length;
    const pos: number[] = [];
    const idx: number[] = [];
    rings.forEach((ring, j) => ring.forEach(([x, z]) => pos.push(x, prof[j][1], z)));
    for (let j = 0; j < rings.length - 1; j++)
      for (let i = 0; i < n; i++) {
        const a = j * n + i;
        const b = j * n + ((i + 1) % n);
        const c = (j + 1) * n + i;
        const d = (j + 1) * n + ((i + 1) % n);
        idx.push(a, c, b, b, c, d);
      }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const enamel = new THREE.MeshPhysicalMaterial({ color: '#f0eee4', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(rg, enamel);
    rim.castShadow = true;
    rim.receiveShadow = true;
    sc.add(rim);
    // надпись по переднему борту
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.0262), new THREE.MeshStandardMaterial({ map: this.keep(tex(brandCanvas())), roughness: 0.35 }));
    brand.position.set(0, 0.0045 + (FY + 0.009 - 0.0045) / 2, TZ + RIMW + 0.0062);
    sc.add(brand);

    // люверсы: серая пластмассовая шайба, в ней металлическое кольцо
    const washer = new THREE.MeshStandardMaterial({ color: '#8d928e', roughness: 0.55 });
    const washGeo = new THREE.CylinderGeometry(0.0088, 0.009, 0.0012, 28);
    const eyelet = new THREE.MeshStandardMaterial({ color: '#9a9a96', metalness: 0.8, roughness: 0.35 });
    const eyeGeo = new THREE.TorusGeometry(0.0042, 0.0011, 6, 20);
    eyeGeo.rotateX(Math.PI / 2);
    const holeGeo = new THREE.CircleGeometry(0.0033, 16);
    holeGeo.rotateX(-Math.PI / 2);
    const holeMat = new THREE.MeshBasicMaterial({ color: '#0d0d0d' });
    for (const team of [0, 1] as const)
      for (const [x, z] of SPOTS[team]) {
        const y = FY + fh(x, z)[0];
        const w = new THREE.Mesh(washGeo, washer);
        w.position.set(x, y + 0.0006, z);
        w.receiveShadow = true;
        sc.add(w);
        const e = new THREE.Mesh(eyeGeo, eyelet);
        e.position.set(x, y + 0.0013, z);
        e.receiveShadow = true;
        sc.add(e);
        const hm = new THREE.Mesh(holeGeo, holeMat);
        hm.position.set(x, y + 0.0013, z);
        sc.add(hm);
      }

    // футболисты: пружинка, шарик-подставка, фигурка; наклон группы — по отклонению подставки
    const spring = springGeo();
    const steel = new THREE.MeshStandardMaterial({ color: '#b8b8b4', metalness: 0.9, roughness: 0.3 });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0, depthWrite: false });
    const ringGeo = new THREE.RingGeometry(0.016, 0.0195, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const bodyField = bodyGeo(false, BASE_Y + FIG_R * 0.85);
    const baseGeo = new THREE.SphereGeometry(FIG_R, 20, 14);
    baseGeo.translate(0, BASE_Y, 0);
    for (let i = 0; i < 20; i++) {
      const team = (i < 10 ? 0 : 1) as 0 | 1;
      const [x, z] = SPOTS[team][i % 10];
      const plastic = new THREE.MeshPhysicalMaterial({ color: COLORS[team].body, roughness: 0.38, clearcoat: 0.4, sheen: 0.2 });
      const tilt = new THREE.Group();
      tilt.position.set(x, FY + fh(x, z)[0], z);
      const yawG = new THREE.Group();
      // смотрят на чужие ворота, чуть вразнобой
      yawG.rotation.y = (team === 0 ? 0 : Math.PI) + Math.sin(i * 7.3) * 0.5;
      const sp = new THREE.Mesh(spring, steel);
      const base = new THREE.Mesh(baseGeo, plastic);
      const body = new THREE.Mesh(bodyField, plastic);
      for (const m of [sp, base, body]) {
        m.castShadow = true;
        yawG.add(m);
      }
      tilt.add(yawG);
      sc.add(tilt);
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.set(x, FY + fh(x, z)[0] + 0.0007, z);
      sc.add(ring);
      this.figs.push({ tilt, ring });
    }

    // вратари: бледная фигурка на стойке рычага, рычаг уходит в вырез; ручка — в дуге на борту за воротами
    const bodyKeep = bodyGeo(true, 0.004);
    for (const team of [0, 1] as const) {
      const s = team === 0 ? -1 : 1;
      const g = new THREE.Group();
      const mat = new THREE.MeshPhysicalMaterial({ color: COLORS[team].pale, roughness: 0.4, clearcoat: 0.3 });
      const body = new THREE.Mesh(bodyKeep, mat);
      body.castShadow = true;
      body.rotation.y = team === 0 ? 0 : Math.PI;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.004, 0.02), mat);
      foot.position.y = 0.002;
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0012, 0.006), steel);
      lever.position.set(-s * 0.014, -0.003, 0);
      lever.rotation.z = s * 0.25;
      g.add(body, foot, lever);
      g.position.set(keeperX(team), FY + fh(keeperX(team), 0)[0], 0);
      sc.add(g);
      this.keepers.push(g);
      // дуга-прорезь и ручка
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.0485, 0.0515, 32, 1, Math.PI - 0.6, 1.2), new THREE.MeshBasicMaterial({ color: '#111', side: THREE.DoubleSide }));
      arc.rotation.x = -Math.PI / 2;
      if (s < 0) arc.rotation.z = Math.PI;
      arc.position.set(s * (TX + 0.07), FY + 0.0072, 0);
      sc.add(arc);
      const h = new THREE.Group();
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.016, 0.01), new THREE.MeshPhysicalMaterial({ color: '#f4f2ea', roughness: 0.35, clearcoat: 0.4 }));
      knob.position.y = 0.008;
      knob.castShadow = true;
      h.add(knob);
      sc.add(h);
      this.handles.push(h);
    }

    // ворота: белая пластмассовая рамка и сетка
    const white = new THREE.MeshPhysicalMaterial({ color: '#f6f5ef', roughness: 0.35, clearcoat: 0.4 });
    const netMap = this.keep(tex(netCanvas(), 4));
    netMap.wrapS = netMap.wrapT = THREE.RepeatWrapping;
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      const bar = (w: number, hgt: number, d: number, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), white);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
      };
      const t = 0.004;
      for (const zs of [1, -1]) {
        bar(t, GOAL_H, t, 0, GOAL_H / 2, zs * GOAL_W);
        bar(t, GOAL_H * 0.6, t, GOAL_D, (GOAL_H * 0.6) / 2, zs * GOAL_W);
        bar(GOAL_D, t * 0.8, t * 0.8, GOAL_D / 2, GOAL_H - t / 2, zs * GOAL_W);
        bar(GOAL_D, t * 0.7, t * 0.7, GOAL_D / 2, t * 0.35, zs * GOAL_W);
      }
      bar(t, t, GOAL_W * 2 + t, 0, GOAL_H, 0);
      bar(t * 0.8, t * 0.8, GOAL_W * 2, GOAL_D, GOAL_H * 0.6, 0);
      const netMat = (rx: number, ry: number) => {
        const m = netMap.clone();
        m.repeat.set(rx, ry);
        m.needsUpdate = true;
        this.keep(m);
        return new THREE.MeshStandardMaterial({ map: m, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 });
      };
      // задняя сетка — наклонная, от перекладины к низу задней рамки
      const backLen = Math.hypot(GOAL_D, GOAL_H * 0.4);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W * 2, GOAL_H * 0.6), netMat(5, 2));
      back.rotation.y = Math.PI / 2;
      back.position.set(GOAL_D, (GOAL_H * 0.6) / 2, 0);
      g.add(back);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(backLen, GOAL_W * 2), netMat(2, 5));
      top.rotation.x = -Math.PI / 2;
      top.rotation.y = -Math.atan2(GOAL_H * 0.4, GOAL_D);
      top.position.set(GOAL_D / 2, GOAL_H * 0.8, 0);
      g.add(top);
      for (const zs of [1, -1]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_D, GOAL_H * 0.8), netMat(1.5, 2));
        side.position.set(GOAL_D / 2, GOAL_H * 0.4, zs * GOAL_W);
        g.add(side);
      }
      g.position.set(s * LX, FY + fh(s * LX, 0)[0], 0);
      if (s < 0) g.rotation.y = Math.PI;
      sc.add(g);
    }
  }

  private makeBall() {
    const map = this.keep(tex(ballCanvas(), 4));
    const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshPhysicalMaterial({ map, roughness: 0.35, clearcoat: 0.5 }));
    m.castShadow = true;
    this.scene.add(m);
    return m;
  }

  private makeShadow() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BALL_R * 3.4, BALL_R * 3.4), new THREE.MeshBasicMaterial({ map: this.keep(new THREE.CanvasTexture(cv)), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = FY + 0.0006;
    this.scene.add(m);
    return m;
  }

  /** Расставить всё по состоянию; hl — подсвеченные фигурки ([номер 0…19, яркость]). */
  update(st: FbState, hl: [number, number][]) {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 20; i++) {
      const f = st.figs[i];
      const o = this.figs[i];
      // наклон на пружине: подставка смещена на (ox, oz) на высоте BASE_Y
      const d = new THREE.Vector3(f.ox, BASE_Y, f.oz).normalize();
      o.tilt.quaternion.setFromUnitVectors(up, d);
      const h = hl.find((x) => x[0] === i);
      (o.ring.material as THREE.MeshBasicMaterial).opacity = h ? h[1] : 0;
    }
    for (const team of [0, 1] as const) {
      const kz = st.keep[team];
      this.keepers[team].position.z = kz;
      // ручка в дуге: рычаг на оси — ходит в обратную сторону
      const s = team === 0 ? -1 : 1;
      const a = (-kz / KEEPER_RANGE) * 0.5;
      this.handles[team].position.set(s * (TX + 0.07 - Math.cos(a) * 0.05), FY + 0.007, Math.sin(a) * 0.05);
    }
    const b = st.ball;
    const hidden = st.goalT > 0 && st.goalT < 1.3;
    this.ball.visible = !hidden;
    this.ballShadow.visible = !hidden;
    const by = fh(b.x, b.z)[0];
    const nb = new THREE.Vector3(b.x, FY + by + BALL_R, b.z);
    // мяч катится: поворот по пройденному пути
    const dx = nb.x - this.lastBall.x;
    const dz = nb.z - this.lastBall.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6 && dist < 0.05) this.ball.rotateOnWorldAxis(new THREE.Vector3(dz, 0, -dx).normalize(), dist / BALL_R);
    this.lastBall.copy(nb);
    this.ball.position.copy(nb);
    this.ballShadow.position.set(b.x + 0.003, FY + fh(b.x + 0.003, b.z + 0.002)[0] + 0.0008, b.z + 0.002);
  }

  setCamera(mode: Cam, team: 0 | 1) {
    if (mode === this.camMode && team === this.camTeam && this.camInit) return;
    this.camMode = mode;
    this.camTeam = team;
    this.placeCamera();
  }

  private placeCamera() {
    const asp = Math.max(0.5, this.camera.aspect);
    const t = this.camTeam === 0 ? 1 : -1;
    if (this.camMode === 'end') {
      // из-за своих ворот: поле уходит вдаль
      const k = Math.max(1, 1.2 / asp);
      this.camGoal.set(-t * (0.5 + 0.12 * (k - 1)), 0.36 + 0.1 * (k - 1), 0);
      this.camLook.set(t * 0.06, FY, 0);
      this.camera.fov = 46;
    } else if (this.camMode === 'corner') {
      const k = Math.max(1, 1.9 / asp);
      this.camGoal.set(-0.26 * k, 0.42 * k, 0.52 * k);
      this.camLook.set(0.02, FY, 0.01);
      this.camera.fov = 36;
    } else {
      // спереди и сверху — как сидишь за длинной стороной подноса
      const k = Math.max(1, 1.75 / asp);
      this.camGoal.set(0, 0.5 * k, 0.5 * k);
      this.camLook.set(0, FY, 0.02);
      this.camera.fov = 36;
    }
    this.camera.updateProjectionMatrix();
    if (!this.camInit) {
      this.camPos.copy(this.camGoal);
      this.camInit = true;
    }
  }

  private resize() {
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.placeCamera();
  }

  render() {
    this.camPos.lerp(this.camGoal, 0.12);
    this.syncCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /** Камера — в текущее положение (выбор под мышью не должен зависеть от того, рисуются ли кадры). */
  private syncCamera() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
  }

  /** Точка поля под экранной точкой (x, z) или null. */
  pickField(clientX: number, clientY: number): [number, number] | null {
    this.syncCamera();
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.fieldPlane, hit)) return null;
    return [hit.x, hit.z];
  }

  /** Экранное направление вектора поля (dx, dz) в точке (x, z). */
  screenDir(x: number, z: number, dx: number, dz: number): [number, number] {
    this.syncCamera();
    const a = new THREE.Vector3(x, FY, z).project(this.camera);
    const b = new THREE.Vector3(x + dx * 0.02, FY, z + dz * 0.02).project(this.camera);
    return [b.x - a.x, -(b.y - a.y)];
  }

  dispose() {
    this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
