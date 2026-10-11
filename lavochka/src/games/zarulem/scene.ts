/* «За рулём» — 3D-игрушка (three.js) по фото: бирюзовый пластмассовый корпус со скошенной панелью, на нём крутится диск
 * с трассой под кремовым бортиком и Y-образной эстакадой на опорах; на панели — большой тёмно-синий руль с тремя спицами,
 * шкала спидометра «0…110 КМ/ЧАС» с красной полосой, три лампы аварий, рычаг передач Н-1-2-3 с кремовым шариком,
 * ключ зажигания на розовом шнурке и наклейка «ЗА РУЛЁМ». Машинки — пластмассовые клинья с кабиной, по цвету места.
 * Единицы — метры; на диске координаты движка (доли радиуса) умножаются на DR. Сидят спереди (+z). */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { woodTexture, WOODS } from '../../core/wood';
import { SEATS } from './def';
import { CAR_L, CAR_W, GEARS, STEER, track, type TrackId, type ZrState } from './engine';
import { diskCanvas, gearCanvas, labelCanvas, signCanvas, speedoCanvas } from './tex';

/** Радиус диска; центр диска; верх корпуса. */
export const DR = 0.155;
const TOPY = 0.095;
const DX = 0.035;
const DY = TOPY + 0.03;
const DZ = -0.05;
/** Высота низа эстакады над диском, ширина рукава. */
const ARM_Y = 0.022;
const ARM_W = 0.15 * DR;
/** Где на экране стоит своя машинка: у левого края диска (как на фото), чуть ближе к зрителю — не за ступицей. */
export const SCREEN_A = Math.PI - 0.3;
/** Скошенная передняя панель: от низа (z = FZ) вверх-назад до верха корпуса. */
const FZ = 0.17;
const FACE_TILT = Math.atan2(0.055, TOPY);
const GEAR_Y = (g: number) => 0.078 - g * 0.0128;

export type Cam = 'drive' | 'top';

const tex = (cv: HTMLCanvasElement, aniso = 8) => {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};

interface CarMesh {
  g: THREE.Group;
  seat: number;
}

export class Toy3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1.6, 0.02, 20);
  private disk = new THREE.Group();
  private cars = new Map<number, CarMesh>();
  private wheel = new THREE.Group();
  private knob = new THREE.Group();
  private key = new THREE.Group();
  private needle: THREE.Mesh;
  private lamps: THREE.MeshStandardMaterial[] = [];
  private gearHit: THREE.Mesh;
  private ro: ResizeObserver;
  private disposables: { dispose(): void }[] = [];
  private camMode: Cam = 'drive';
  private camGoal = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private ray = new THREE.Raycaster();
  private face = new THREE.Group();

  constructor(
    private host: HTMLElement,
    private trackId: TrackId
  ) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.needle = new THREE.Mesh();
    this.gearHit = new THREE.Mesh();
    this.build();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __zr: Toy3D }).__zr = this;
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
    sc.fog = new THREE.Fog('#2a1f18', 1.6, 4);
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = this.keep(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    sc.environmentIntensity = 0.45;
    pm.dispose();
    sc.add(new THREE.HemisphereLight('#fff4e2', '#3a2c22', 0.6));
    const key = new THREE.DirectionalLight('#fff1dc', 1.7);
    key.position.set(-0.4, 1.3, 0.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c2 = key.shadow.camera;
    c2.left = -0.32;
    c2.right = 0.32;
    c2.top = 0.3;
    c2.bottom = -0.3;
    c2.near = 0.5;
    c2.far = 2.6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0012;
    key.shadow.radius = 3;
    sc.add(key);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.5);
    fill.position.set(0.7, 0.8, -0.6);
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

    // корпус: профиль сбоку (скошенная панель спереди), вытянут по ширине
    const body = new THREE.MeshPhysicalMaterial({ color: '#1f8fa2', roughness: 0.36, clearcoat: 0.4, clearcoatRoughness: 0.45 });
    const prof = new THREE.Shape();
    prof.moveTo(-FZ, 0);
    prof.lineTo(-(FZ - 0.055), TOPY);
    prof.lineTo(0.1, TOPY);
    prof.lineTo(0.1, 0);
    prof.closePath();
    const box = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: 0.418, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 4 }), body);
    box.rotation.y = Math.PI / 2;
    box.position.set(-0.209, 0.006, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    sc.add(box);
    // ось диска и тёмная щель под ним
    const dark = new THREE.MeshStandardMaterial({ color: '#13343c', roughness: 0.8 });
    const well = new THREE.Mesh(new THREE.CylinderGeometry(DR * 0.92, DR * 0.92, 0.004, 64), dark);
    well.position.set(DX, TOPY + 0.0085, DZ);
    sc.add(well);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, DY - TOPY, 24), dark);
    axle.position.set(DX, (DY + TOPY) / 2 + 0.003, DZ);
    sc.add(axle);

    this.buildDisk();
    this.buildFace(body);
  }

  private buildDisk() {
    const d = this.disk;
    d.position.set(DX, DY, DZ);
    this.scene.add(d);
    const t = track(this.trackId);
    const cream = new THREE.MeshPhysicalMaterial({ color: '#ece0bc', roughness: 0.45, clearcoat: 0.2 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(DR, DR * 0.985, 0.008, 96), cream);
    base.position.y = -0.0042;
    base.castShadow = true;
    d.add(base);
    const top = new THREE.Mesh(new THREE.CircleGeometry(DR, 128), new THREE.MeshStandardMaterial({ map: this.keep(tex(diskCanvas(this.trackId), 16)), roughness: 0.78 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.0002;
    top.receiveShadow = true;
    d.add(top);
    // бортик по краю
    const rim = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          [0.955, 0],
          [0.958, 0.008],
          [0.975, 0.011],
          [1.0, 0.009],
          [1.004, -0.008],
        ].map(([r, y]) => new THREE.Vector2(r * DR, y)),
        128
      ),
      cream
    );
    rim.castShadow = true;
    rim.receiveShadow = true;
    d.add(rim);
    // эстакада: ступица посередине, три рукава-жёлоба до бортика, опоры на траве
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * DR, 0.19 * DR, ARM_Y + 0.006, 48), cream);
    hub.position.y = (ARM_Y + 0.006) / 2;
    hub.castShadow = true;
    d.add(hub);
    const len = DR * 0.86;
    for (const b of t.arms) {
      const arm = new THREE.Group();
      arm.rotation.y = -b;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0055, ARM_W), cream);
      deck.position.set(DR * 0.14 + len / 2, ARM_Y + 0.00275, 0);
      for (const side of [-1, 1]) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0065, 0.004), cream);
        lip.position.set(DR * 0.14 + len / 2, ARM_Y + 0.0085, side * (ARM_W / 2 - 0.002));
        lip.castShadow = true;
        arm.add(lip);
      }
      const end = new THREE.Mesh(new THREE.BoxGeometry(0.045 * DR, ARM_Y, ARM_W * 1.1), cream);
      end.position.set(DR * 0.975, ARM_Y / 2, 0);
      deck.castShadow = true;
      end.castShadow = true;
      arm.add(deck, end);
      d.add(arm);
    }
    for (const p of t.pillars) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.075 * DR, ARM_Y, ARM_W * 0.9), cream);
      m.position.set(Math.cos(p.a) * p.r * DR, ARM_Y / 2, Math.sin(p.a) * p.r * DR);
      m.rotation.y = -p.a;
      m.castShadow = true;
      d.add(m);
    }
    // знаки на белых подставках, лицом к едущим машинкам
    const white = new THREE.MeshStandardMaterial({ color: '#f4f2ea', roughness: 0.5 });
    const signTex = new Map<string, THREE.Texture>();
    for (const s of t.signs) {
      let st = signTex.get(s.kind);
      if (!st) signTex.set(s.kind, (st = this.keep(tex(signCanvas(s.kind), 4))));
      const g = new THREE.Group();
      g.position.set(Math.cos(s.a) * s.r * DR, 0, Math.sin(s.a) * s.r * DR);
      g.rotation.y = Math.PI - s.a;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.0025, 0.004), white);
      foot.position.y = 0.00125;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.013, 8), white);
      pole.position.y = 0.0065;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.0095, 0.0095), new THREE.MeshStandardMaterial({ map: st, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5 }));
      plate.position.set(0, 0.0145, 0.0008);
      for (const m of [foot, pole, plate]) m.castShadow = true;
      g.add(foot, pole, plate);
      d.add(g);
    }
    // заборчики: белые столбики и две перекладины по дуге
    for (const f of t.fences) {
      const pts = (y: number) => {
        const out: THREE.Vector3[] = [];
        for (let i = 0; i <= 16; i++) {
          const a = f.a - f.span + (i / 16) * 2 * f.span;
          out.push(new THREE.Vector3(Math.cos(a) * f.r * DR, y, Math.sin(a) * f.r * DR));
        }
        return out;
      };
      for (const y of [0.0038, 0.0062]) {
        const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(y)), 48, 0.0008, 6), white);
        rail.castShadow = true;
        d.add(rail);
      }
      for (let i = 0; i <= 5; i++) {
        const a = f.a - f.span + (i / 5) * 2 * f.span;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.0075, 0.0016), white);
        post.position.set(Math.cos(a) * f.r * DR, 0.00375, Math.sin(a) * f.r * DR);
        post.castShadow = true;
        d.add(post);
      }
    }
  }

  /** Машинка: клин с кабиной, вперёд — по +x. */
  private makeCar(seat: number): CarMesh {
    const L = CAR_L * DR;
    const W = CAR_W * DR;
    const g = new THREE.Group();
    const col = new THREE.MeshPhysicalMaterial({ color: SEATS[seat]?.color ?? '#d4281c', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#1c2c58', roughness: 0.1, metalness: 0.2, clearcoat: 1 });
    const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.7 });
    const bs = new THREE.Shape();
    const P: [number, number][] = [
      [-0.5, 0.0016],
      [0.5, 0.0016],
      [0.5, 0.0033],
      [0.42, 0.0045],
      [0.1, 0.0056],
      [-0.4, 0.006],
      [-0.5, 0.0052],
    ];
    P.forEach(([x, y], i) => (i ? bs.lineTo(x * L, y) : bs.moveTo(x * L, y)));
    bs.closePath();
    const bev = 0.0007;
    const bodyG = new THREE.ExtrudeGeometry(bs, { depth: W - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3 });
    bodyG.translate(0, 0, -(W - 2 * bev) / 2);
    const body = new THREE.Mesh(bodyG, col);
    const cs = new THREE.Shape();
    const C: [number, number][] = [
      [-0.3, 0.0054],
      [0.12, 0.0054],
      [-0.02, 0.0088],
      [-0.25, 0.009],
    ];
    C.forEach(([x, y], i) => (i ? cs.lineTo(x * L, y) : cs.moveTo(x * L, y)));
    cs.closePath();
    const cabG = new THREE.ExtrudeGeometry(cs, { depth: W * 0.78, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelSegments: 2 });
    cabG.translate(0, 0, -W * 0.39);
    const cab = new THREE.Mesh(cabG, glass);
    g.add(body, cab);
    const wg = new THREE.CylinderGeometry(0.0021, 0.0021, 0.0018, 16);
    wg.rotateX(Math.PI / 2);
    for (const x of [-0.3, 0.3])
      for (const z of [-1, 1]) {
        const w = new THREE.Mesh(wg, black);
        w.position.set(x * L, 0.0021, z * (W / 2 - 0.0004));
        g.add(w);
      }
    const lampM = new THREE.MeshStandardMaterial({ color: '#fff4c0', emissive: '#806a20', roughness: 0.3 });
    for (const z of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.0006, 0.0009, 0.0026), lampM);
      lamp.position.set(0.5 * L + 0.0006, 0.0029, z * W * 0.3);
      g.add(lamp);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.disk.add(g);
    return { g, seat };
  }

  /** Передняя панель: руль, спидометр, лампы, рычаг передач, ключ со шнурком, наклейка. */
  private buildFace(bodyMat: THREE.Material) {
    const f = this.face;
    f.position.set(0, 0.006, FZ + 0.006);
    f.rotation.x = -FACE_TILT;
    this.scene.add(f);
    const navy = new THREE.MeshPhysicalMaterial({ color: '#1a2238', roughness: 0.35, clearcoat: 0.5 });
    const grey = new THREE.MeshStandardMaterial({ color: '#8a9096', roughness: 0.45, metalness: 0.2 });
    const white = new THREE.MeshStandardMaterial({ color: '#f2f0e6', roughness: 0.45 });
    const creamM = new THREE.MeshPhysicalMaterial({ color: '#efe6c8', roughness: 0.25, clearcoat: 0.6 });
    // окошко приборов: серебристая рамка, шкала, красная полоса скорости
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.0235), new THREE.MeshStandardMaterial({ map: this.keep(tex(speedoCanvas())), roughness: 0.4 }));
    sp.position.set(-0.105, 0.03, 0.0008);
    f.add(sp);
    this.needle = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.0018), new THREE.MeshBasicMaterial({ color: '#e0261a' }));
    this.needle.position.set(-0.105 - 0.0495, 0.03 - 0.0043, 0.0012);
    this.needle.scale.x = 0.0001;
    f.add(this.needle);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.MeshStandardMaterial({ color: '#4a1410', emissive: '#000000', roughness: 0.3 });
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.002), m);
      lamp.position.set(-0.148 + i * 0.043, 0.0465, 0.001);
      f.add(lamp);
      this.lamps.push(m);
    }
    // руль: стойка, обод, три спицы (влево, вправо, вниз), серая ступица
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.034, 16), navy);
    col.rotation.x = Math.PI / 2;
    col.position.set(-0.105, 0.058, 0.017);
    f.add(col);
    this.wheel.position.set(-0.105, 0.058, 0.035);
    this.wheel.rotation.x = 0.22;
    f.add(this.wheel);
    const spin = new THREE.Group();
    spin.name = 'spin';
    this.wheel.add(spin);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.0062, 16, 72), navy);
    spin.add(ring);
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, a === -Math.PI / 2 ? 0.014 : 0.02, 0.006), navy);
      spoke.position.set(Math.cos(a) * 0.035, Math.sin(a) * 0.035, -0.002);
      spoke.rotation.z = a;
      spin.add(spoke);
    }
    const hubM = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.008, 32), grey);
    hubM.rotation.x = Math.PI / 2;
    hubM.position.z = 0.002;
    spin.add(hubM);
    spin.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    // рычаг передач: табличка Н-1-2-3, прорезь, шарик
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.048), new THREE.MeshStandardMaterial({ map: this.keep(tex(gearCanvas())), roughness: 0.5 }));
    plate.position.set(0.048, GEAR_Y(1.5), 0.0008);
    f.add(plate);
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.0035, 0.046), new THREE.MeshBasicMaterial({ color: '#0a1a1e' }));
    slot.position.set(0.064, GEAR_Y(1.5), 0.0009);
    f.add(slot);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0016, 0.022, 10), new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.4 }));
    stick.rotation.x = Math.PI / 2;
    stick.position.z = 0.011;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 24, 16), creamM);
    ball.position.z = 0.024;
    ball.scale.set(1, 0.85, 1);
    stick.castShadow = ball.castShadow = true;
    this.knob.add(stick, ball);
    this.knob.position.set(0.064, GEAR_Y(1), 0);
    f.add(this.knob);
    this.gearHit = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.066), new THREE.MeshBasicMaterial({ visible: false }));
    this.gearHit.position.set(0.06, GEAR_Y(1.5), 0.01);
    f.add(this.gearHit);
    // ключ зажигания: белый замок, ключ поворачивается
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.016, 0.004), white);
    lock.position.set(0.0, 0.022, 0.002);
    f.add(lock);
    this.key.position.set(0, 0.022, 0.006);
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.0035), white);
    kb.position.y = -0.002;
    const kr = new THREE.Mesh(new THREE.TorusGeometry(0.0045, 0.0014, 8, 20), white);
    kr.position.y = -0.009;
    this.key.add(kb, kr);
    f.add(this.key);
    // наклейка
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.0234), new THREE.MeshStandardMaterial({ map: this.keep(tex(labelCanvas())), roughness: 0.35 }));
    lab.position.set(0.15, 0.07, 0.0008);
    f.add(lab);
    // розовый шнурок от ключа на стол
    f.updateMatrixWorld(true);
    const k0 = f.localToWorld(new THREE.Vector3(0.001, 0.012, 0.007));
    const curve = new THREE.CatmullRomCurve3([
      k0,
      new THREE.Vector3(k0.x + 0.004, k0.y - 0.02, k0.z + 0.012),
      new THREE.Vector3(k0.x - 0.01, 0.0015, k0.z + 0.05),
      new THREE.Vector3(k0.x + 0.03, 0.0015, k0.z + 0.085),
      new THREE.Vector3(k0.x + 0.09, 0.0015, k0.z + 0.07),
      new THREE.Vector3(k0.x + 0.12, 0.0015, k0.z + 0.03),
    ]);
    const cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.0011, 6), new THREE.MeshStandardMaterial({ color: '#c47a92', roughness: 0.8 }));
    cord.castShadow = true;
    this.scene.add(cord);
    void bodyMat;
  }

  /** Поставить всё по снимку: диск повёрнут так, что машинка focus стоит на SCREEN_A; руль, рычаг, приборы — по ней. */
  update(st: ZrState, focus: number, ui: { steer: number; gear: number; blink: boolean }) {
    const fc = st.cars.find((c) => c.seat === focus) ?? null;
    if (fc) this.disk.rotation.y = fc.a - SCREEN_A;
    for (const c of st.cars) {
      let m = this.cars.get(c.seat);
      if (!m) this.cars.set(c.seat, (m = this.makeCar(c.seat)));
      m.g.visible = !c.out && !(c.stun > 0 && ui.blink);
      const R = c.r * DR;
      m.g.position.set(Math.cos(c.a) * R, 0, Math.sin(c.a) * R);
      // нос — по ходу диска, чуть в сторону, куда тянет руль
      const vr = -c.steer * STEER;
      const vt = Math.max(0.12, c.w * c.r);
      const yaw = c.stun > 0 ? 0 : Math.max(-0.5, Math.min(0.5, Math.atan2(vr, vt)));
      const tx = -Math.sin(c.a);
      const tz = Math.cos(c.a);
      const nx = Math.cos(c.a);
      const nz = Math.sin(c.a);
      const dx = tx * Math.cos(yaw) + nx * Math.sin(yaw);
      const dz = tz * Math.cos(yaw) + nz * Math.sin(yaw);
      m.g.rotation.y = Math.atan2(-dz, dx);
    }
    for (const [seat, m] of this.cars)
      if (!st.cars.some((c) => c.seat === seat)) {
        this.disk.remove(m.g);
        this.cars.delete(seat);
      }
    // приборы
    const spin = this.wheel.getObjectByName('spin');
    if (spin) spin.rotation.z += (-ui.steer * 1.4 - spin.rotation.z) * 0.25;
    this.knob.position.y += (GEAR_Y(ui.gear) - this.knob.position.y) * 0.35;
    const v = fc ? Math.max(0, fc.w) / GEARS[3] : 0;
    this.needle.scale.x = Math.max(0.0001, Math.min(1, v * 0.82) * 0.099);
    this.needle.position.x = -0.105 - 0.0495 + this.needle.scale.x / 2;
    this.key.rotation.z = st.t >= 0 && !st.over ? -Math.PI / 2 : 0;
    this.lamps.forEach((m, i) => {
      const on = !!fc && fc.crashes > i;
      m.color.set(on ? '#ff5a3a' : '#4a1410');
      m.emissive.set(on ? '#c02010' : '#000000');
    });
  }

  setCamera(mode: Cam) {
    if (mode === this.camMode && this.camInit) return;
    this.camMode = mode;
    this.placeCamera();
  }

  private placeCamera() {
    const asp = Math.max(0.45, this.camera.aspect);
    if (this.camMode === 'top') {
      const k = Math.max(1, 1.3 / asp);
      this.camGoal.set(DX, 0.62 * k, DZ + 0.2 * k);
      this.camLook.set(DX, DY, DZ + 0.01);
    } else {
      // из-за руля: спереди и сверху, как на фото
      const k = Math.max(1, 1.45 / asp);
      this.camGoal.set(-0.005, 0.36 * k, 0.56 * k);
      this.camLook.set(0.022, 0.1, -0.045);
    }
    this.camera.fov = this.camMode === 'top' ? 34 : 27;
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
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  /** Нажатие по рычагу передач: какая передача под пальцем (по высоте), или null. */
  pickGear(clientX: number, clientY: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = this.ray.intersectObject(this.gearHit, false)[0];
    if (!hit) return null;
    const p = this.face.worldToLocal(hit.point.clone());
    let best = 0;
    for (let g = 1; g <= 3; g++) if (Math.abs(GEAR_Y(g) - p.y) < Math.abs(GEAR_Y(best) - p.y)) best = g;
    return best;
  }

  dispose() {
    this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const all = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of all) {
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

