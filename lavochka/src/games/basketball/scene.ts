/* 3D-стол настольного баскетбола (three.js) по фото советской коробки: синее основание, жёлтое поле на подносе
 * со скошенными краями (ямки-пирамиды, щели лунок, номера), кремовые планки на торцах со столбиком красных клавиш,
 * голубые щиты на стойках, белые кольца-корзинки, прозрачный колпак с кругом на макушке.
 * Единицы — метры, как в движке; гребни поля — на высоте FY. Сидят спереди (+z), как на фото. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { woodTexture, WOODS } from '../../core/wood';
import { BALL_R, BOARD, CELLS, DEPTH, DOME, domeDist, floorAt, HOLE, HOLE_X, L, NET, NUMS, RIM, WD, type BbState } from './engine';
import { BLUE, boardCanvas, capCanvas, fieldCanvas, netCanvas, panelCanvas, RED } from './tex';

/** Верх основания, гребни поля (поле на подносе выше основания). */
const BT = 0.017;
export const FY = BT + 0.016;
const BASE_X = 0.212;
const BASE_Z = 0.118;
/** Поднос под колпаком (жёлтый скос от края поля к основанию). */
const TRAY_X = DOME.x + 0.007;
const TRAY_Z = DOME.z + 0.007;
/** Планки клавиш на торцах: от подноса до края основания. */
const PANEL_X0 = TRAY_X + 0.004;
const PANEL_X1 = BASE_X - 0.007;
const PANEL_W = PANEL_X1 - PANEL_X0;
const KEY_SPAN = 0.19;
const KEY_L = 0.021;

export type Cam = 'end' | 'side' | 'corner';

function rrect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2, false);
  return s;
}

const tex = (cv: HTMLCanvasElement, aniso = 8) => {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
};

/** Цифры клавиш по порядку сзади (−z) вперёд: у красных (слева) 1…0, у синих (справа) 0…1 — как на коробке. */
const ORDER: [number[], number[]] = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
  [0, 9, 8, 7, 6, 5, 4, 3, 2, 1],
];
/** Позиция клавиши k (0…9 — цифры 1…9, 0) вдоль торца: z её середины. */
export const keyZ = (team: 0 | 1, k: number) => {
  const i = ORDER[team].indexOf((k + 1) % 10);
  return -KEY_SPAN / 2 + (KEY_SPAN * (i + 0.5)) / 10;
};
export const keyX = (team: 0 | 1) => (team === 0 ? -1 : 1) * (PANEL_X1 - KEY_L / 2 - 0.004);

export class Court3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1.6, 0.02, 20);
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private arms: THREE.Group[] = [];
  private keys: THREE.Group[][] = [[], []];
  private keyHit: THREE.Mesh[][] = [[], []];
  private letters: THREE.Mesh[][] = [[], []];
  private holeHi: THREE.Mesh;
  private disposables: { dispose(): void }[] = [];
  private ro: ResizeObserver;
  private camMode: Cam = 'side';
  private camTeam: 0 | 1 = 0;
  private camGoal = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private ray = new THREE.Raycaster();
  private fieldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(FY - DEPTH * 0.5));

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
    this.holeHi = this.makeHoleHi();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __bb: Court3D }).__bb = this;
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
    sc.fog = new THREE.Fog('#2a1f18', 1.4, 3.5);
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = this.keep(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    sc.environmentIntensity = 0.45;
    pm.dispose();

    sc.add(new THREE.HemisphereLight('#fff4e2', '#3a2c22', 0.55));
    const key = new THREE.DirectionalLight('#fff1dc', 1.6);
    key.position.set(-0.35, 1.2, 0.55);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c2 = key.shadow.camera;
    c2.left = -0.3;
    c2.right = 0.3;
    c2.top = 0.25;
    c2.bottom = -0.25;
    c2.near = 0.5;
    c2.far = 2.5;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0015;
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

    // основание: синяя пластмасса, ступенька-подошва
    const blueMat = new THREE.MeshPhysicalMaterial({ color: '#2a39a6', roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.4 });
    const sole = new THREE.Mesh(new THREE.ExtrudeGeometry(rrect(BASE_X * 2 + 0.006, BASE_Z * 2 + 0.006, 0.018), { depth: 0.005, bevelEnabled: false }), blueMat);
    sole.rotation.x = -Math.PI / 2;
    sole.receiveShadow = true;
    sole.castShadow = true;
    sc.add(sole);
    const base = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rrect(BASE_X * 2 - 0.004, BASE_Z * 2 - 0.004, 0.016), { depth: BT - 0.009, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 3 }),
      blueMat
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.005;
    base.castShadow = true;
    base.receiveShadow = true;
    sc.add(base);

    // поле: грани ямок (плоская заливка), сверху — текстура со щелями и номерами
    const pos: number[] = [];
    const uv: number[] = [];
    const vert = (x: number, z: number) => {
      pos.push(x, FY + floorAt(x, z)[0], z);
      uv.push((x + L / 2) / L, 1 - (z + WD / 2) / WD);
    };
    for (const c of CELLS) {
      const corners: [number, number][] = [
        [c.x0, c.z0],
        [c.x0, c.z1],
        [c.x1, c.z1],
        [c.x1, c.z0],
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const N = 6;
        for (let j = 0; j < N; j++) {
          const t0 = j / N;
          const t1 = (j + 1) / N;
          vert(c.hx, c.hz);
          vert(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0);
          vert(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
        }
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    fg.computeVertexNormals();
    const yellow = new THREE.MeshPhysicalMaterial({ map: this.keep(tex(fieldCanvas(), 16)), roughness: 0.32, clearcoat: 0.55, clearcoatRoughness: 0.25 });
    const field = new THREE.Mesh(fg, yellow);
    field.receiveShadow = true;
    sc.add(field);

    // поднос: жёлтый скос от края поля вниз к основанию (четыре трапеции)
    {
      const p: number[] = [];
      const ix = L / 2;
      const iz = WD / 2;
      const ox = TRAY_X;
      const oz = TRAY_Z;
      const quad = (a: number[], b: number[], c: number[], d: number[]) => p.push(...a, ...b, ...c, ...a, ...c, ...d);
      const yi = FY;
      const yo = BT + 0.002;
      quad([-ix, yi, iz], [-ox, yo, oz], [ox, yo, oz], [ix, yi, iz]);
      quad([ix, yi, -iz], [ox, yo, -oz], [-ox, yo, -oz], [-ix, yi, -iz]);
      quad([ix, yi, iz], [ox, yo, oz], [ox, yo, -oz], [ix, yi, -iz]);
      quad([-ix, yi, -iz], [-ox, yo, -oz], [-ox, yo, oz], [-ix, yi, iz]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.computeVertexNormals();
      const tray = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#e9c018', roughness: 0.5, clearcoat: 0.15, side: THREE.DoubleSide }));
      tray.receiveShadow = true;
      tray.castShadow = true;
      sc.add(tray);
      // бортик под колпак
      const lipShape = rrect(TRAY_X * 2 + 0.006, TRAY_Z * 2 + 0.006, 0.014);
      lipShape.holes.push(rrect(TRAY_X * 2 - 0.001, TRAY_Z * 2 - 0.001, 0.012));
      const lip = new THREE.Mesh(new THREE.ExtrudeGeometry(lipShape, { depth: 0.004, bevelEnabled: false }), new THREE.MeshPhysicalMaterial({ color: '#e8c01a', roughness: 0.4 }));
      lip.rotation.x = -Math.PI / 2;
      lip.position.y = BT;
      sc.add(lip);
    }

    // катапульты: бордовые рычажки в щелях
    const armMat = new THREE.MeshStandardMaterial({ color: '#8a2414', roughness: 0.5 });
    const armGeo = new THREE.BoxGeometry(HOLE_X * 1.7, 0.0015, HOLE * 1.3);
    for (const c of CELLS) {
      const g = new THREE.Group();
      const arm = new THREE.Mesh(armGeo, armMat);
      g.add(arm);
      g.position.set(c.hx, FY - DEPTH - 0.0035, c.hz);
      sc.add(g);
      this.arms.push(g);
    }

    // планки на торцах: кремовые, снаружи — столбик красных клавиш-«пианино», ближе к полю — цифры
    const cream = new THREE.MeshPhysicalMaterial({ color: '#ece6d3', roughness: 0.45, clearcoat: 0.3 });
    const keyMat = new THREE.MeshPhysicalMaterial({ color: '#c42a20', roughness: 0.35, clearcoat: 0.55, clearcoatRoughness: 0.3 });
    // клавиша сбоку: низкий край к полю, высокий — к сидящему, скошенная верхняя грань
    const prof = new THREE.Shape();
    prof.moveTo(-KEY_L / 2, 0);
    prof.lineTo(KEY_L / 2, 0);
    prof.lineTo(KEY_L / 2, 0.0085);
    prof.lineTo(KEY_L / 2 - 0.003, 0.0095);
    prof.lineTo(-KEY_L / 2, 0.006);
    prof.closePath();
    const keyW = (KEY_SPAN / 10) * 0.74;
    const keyGeo = new THREE.ExtrudeGeometry(prof, { depth: keyW, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 2 });
    keyGeo.translate(0, 0, -keyW / 2);
    const slope = Math.atan2(0.0095 - 0.006, KEY_L - 0.003);
    for (const team of [0, 1] as const) {
      const s = team === 0 ? -1 : 1;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, 0.006, KEY_SPAN + 0.014), cream);
      panel.position.set(s * (PANEL_X0 + PANEL_W / 2), BT + 0.003, 0);
      panel.receiveShadow = true;
      panel.castShadow = true;
      sc.add(panel);
      const digW = PANEL_W - KEY_L - 0.008;
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(digW, KEY_SPAN), new THREE.MeshStandardMaterial({ map: this.keep(tex(panelCanvas(ORDER[team], team === 0 ? RED : BLUE))), roughness: 0.5 }));
      lab.rotation.x = -Math.PI / 2;
      lab.position.set(s * (PANEL_X0 + digW / 2 + 0.002), BT + 0.0062, 0);
      sc.add(lab);
      for (let k = 0; k < 10; k++) {
        const g = new THREE.Group();
        const m = new THREE.Mesh(keyGeo, keyMat);
        m.castShadow = true;
        m.receiveShadow = true;
        if (s < 0) m.rotation.y = Math.PI;
        g.add(m);
        // буква клавиатуры на скосе клавиши
        const let_ = new THREE.Mesh(new THREE.PlaneGeometry(keyW * 0.9, keyW * 0.45), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, visible: false }));
        let_.rotation.order = 'YXZ';
        let_.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        let_.rotation.x = -Math.PI / 2 + slope;
        let_.position.set(-s * 0.002, 0.0084, 0);
        g.add(let_);
        g.position.set(keyX(team), BT + 0.006, keyZ(team, k));
        g.userData = { team, k };
        sc.add(g);
        this.keys[team].push(g);
        this.keyHit[team].push(m);
        this.letters[team].push(let_);
      }
    }

    // щиты на стойках, кольца, корзинки
    const stand = new THREE.MeshPhysicalMaterial({ color: '#4d62cf', roughness: 0.35, clearcoat: 0.5 });
    const boardMap = this.keep(tex(boardCanvas()));
    const boardFace = new THREE.MeshPhysicalMaterial({ map: boardMap, roughness: 0.3, clearcoat: 0.6 });
    const white = new THREE.MeshPhysicalMaterial({ color: '#f6f3ea', roughness: 0.38, clearcoat: 0.35 });
    const netMap = this.keep(tex(netCanvas(), 4));
    netMap.wrapS = THREE.RepeatWrapping;
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      // щит: лицом (±z грани коробки после поворота) к полю
      const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD.z * 2, BOARD.y1 - BOARD.y0, BOARD.t), [stand, stand, stand, stand, boardFace, boardFace]);
      board.rotation.y = Math.PI / 2;
      board.position.set(side * BOARD.x, FY + (BOARD.y0 + BOARD.y1) / 2, 0);
      board.castShadow = true;
      g.add(board);
      // стойка: столб за щитом от подноса и упор-косынка
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.005, BOARD.y1 - 0.004, 0.009), stand);
      post.position.set(side * (BOARD.x + 0.004), FY - 0.006 + (BOARD.y1 - 0.004) / 2, 0);
      post.castShadow = true;
      g.add(post);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.006), stand);
      brace.position.set(side * (BOARD.x - 0.006), FY + 0.018, 0);
      brace.rotation.z = side * 0.45;
      brace.castShadow = true;
      g.add(brace);
      // кольцо, крепление к щиту, корзинка-решётка, нижний обруч
      const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM.r, RIM.tube, 8, 48), white);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(side * RIM.x, FY + RIM.y, 0);
      ring.castShadow = true;
      g.add(ring);
      const bl = BOARD.x - BOARD.t / 2 - RIM.x - RIM.r + 0.002;
      const brk = new THREE.Mesh(new THREE.BoxGeometry(bl, 0.0035, 0.012), white);
      brk.position.set(side * (RIM.x + RIM.r - 0.001 + bl / 2), FY + RIM.y, 0);
      g.add(brk);
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(RIM.r, NET.r, NET.h, 40, 1, true),
        new THREE.MeshStandardMaterial({ map: netMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45 })
      );
      net.position.set(side * RIM.x, FY + RIM.y - NET.h / 2, 0);
      net.castShadow = true;
      net.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: netMap, alphaTest: 0.5 });
      g.add(net);
      const bottom = new THREE.Mesh(new THREE.TorusGeometry(NET.r, 0.0014, 6, 32), white);
      bottom.rotation.x = Math.PI / 2;
      bottom.position.set(side * RIM.x, FY + RIM.y - NET.h, 0);
      g.add(bottom);
      sc.add(g);
    }

    // колпак: лучами из середины поля до поверхности (гладкий максимум плоскостей — скруглённые рёбра); стоит на бортике подноса
    const dg = new THREE.SphereGeometry(1, 96, 36, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = dg.attributes.position;
    const lift = FY - BT;
    for (let i = 0; i < p.count; i++) {
      const d = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      let lo = 0;
      let hi = 0.5;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (domeDist(d.x * m, d.y * m, d.z * m)[0] > 0) hi = m;
        else lo = m;
      }
      const y = d.y * lo;
      // по высоте растягиваем вниз до основания: от гребней поля (y=0) до бортика подноса
      p.setXYZ(i, d.x * lo, FY + y - lift * (1 - y / DOME.h), d.z * lo);
    }
    dg.computeVertexNormals();
    const dome = new THREE.Mesh(
      dg,
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.03,
        metalness: 0,
        transmission: 1,
        thickness: 0.002,
        ior: 1.49,
        transparent: true,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    dome.renderOrder = 10;
    sc.add(dome);
    // круг с точкой на макушке колпака
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
    const top = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.0355, 72), ringMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = FY + DOME.h - 0.0008;
    top.renderOrder = 11;
    sc.add(top);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.003, 20), ringMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.y = top.position.y;
    dot.renderOrder = 11;
    sc.add(dot);
  }

  /** Подписать клавиши буквами клавиатуры (пустой список — без букв). */
  setLetters(team: 0 | 1, letters: string[]) {
    this.letters[team].forEach((m, k) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = letters[k] ? tex(capCanvas(letters[k])) : null;
      mat.visible = !!letters[k];
      mat.needsUpdate = true;
    });
  }

  private makeBall() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshPhysicalMaterial({ color: '#f4f0e4', roughness: 0.3, clearcoat: 0.5 }));
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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BALL_R * 3.2, BALL_R * 3.2), new THREE.MeshBasicMaterial({ map: this.keep(new THREE.CanvasTexture(cv)), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    return m;
  }

  /** Подсветка щели с мячом — рамка. */
  private makeHoleHi() {
    const s = new THREE.Shape();
    const a = HOLE_X + 0.0035;
    const b = HOLE + 0.0035;
    s.moveTo(-a, -b);
    s.lineTo(a, -b);
    s.lineTo(a, b);
    s.lineTo(-a, b);
    const hole = new THREE.Path();
    hole.moveTo(-a + 0.0012, -b + 0.0012);
    hole.lineTo(-a + 0.0012, b - 0.0012);
    hole.lineTo(a - 0.0012, b - 0.0012);
    hole.lineTo(a - 0.0012, -b + 0.0012);
    s.holes.push(hole);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    return m;
  }

  /** Расставить всё по состоянию; pressed[team][k] — нажатые сейчас клавиши; my — команда этого экрана (подсветка). */
  update(st: BbState, pressed: boolean[][], my: number) {
    const b = st.ball;
    this.ball.position.set(b.x, FY + b.y, b.z);
    const [fh] = floorAt(b.x, b.z);
    const up = Math.max(0, b.y - fh);
    this.ballShadow.position.set(b.x + 0.003, FY + fh + 0.0007 + (st.hole >= 0 ? 0.004 : 0), b.z + 0.002);
    this.ballShadow.scale.setScalar(1 + up * 6);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - up * 5);
    // рычаги катапульт: дёргаются в сторону кольца того, кто нажал
    st.flick.forEach((f, i) => {
      const g = this.arms[i];
      const k = f > 0 ? Math.sin((f / 0.18) * Math.PI) : 0;
      g.rotation.z = (st.flickBy[i] === 0 ? 1 : -1) * k * 0.9;
      g.position.y = FY - DEPTH - 0.0035 + 0.004 * k;
    });
    // клавиши: нажатые утоплены (свои — сразу, чужие — пока дёргается рычаг их лунки)
    for (const team of [0, 1] as const)
      this.keys[team].forEach((g, k) => {
        const hole = NUMS[team].indexOf((k + 1) % 10);
        const down = pressed[team]?.[k] || (st.flick[hole] > 0.08 && st.flickBy[hole] === team);
        g.position.y = BT + (down ? 0.0035 : 0.006);
      });
    const hi = this.holeHi.material as THREE.MeshBasicMaterial;
    if (st.hole >= 0 && my >= 0) {
      const c = CELLS[st.hole];
      this.holeHi.position.set(c.hx, FY - DEPTH + 0.003, c.hz);
      hi.color.set(st.lock[my] > 0 ? '#ff6a50' : '#fff3a0');
      hi.opacity = 0.5 + 0.3 * Math.sin(performance.now() / 120);
    } else hi.opacity = 0;
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
      // из-за своих клавиш: поле уходит вдаль
      const k = Math.max(1, 1.25 / asp);
      this.camGoal.set(-t * (0.42 + 0.1 * (k - 1)), 0.3 + 0.08 * (k - 1), 0);
      this.camLook.set(t * 0.02, FY + 0.04, 0);
      this.camera.fov = 42;
    } else if (this.camMode === 'corner') {
      const k = Math.max(1, 1.45 / asp);
      this.camGoal.set(-0.2 * k, 0.33 * k, 0.43 * k);
      this.camLook.set(0.0, FY + 0.03, 0.0);
      this.camera.fov = 34;
    } else {
      // спереди и сверху, как на фото коробки
      const k = Math.max(1, 1.55 / asp);
      this.camGoal.set(0, 0.27 * k, 0.41 * k);
      this.camLook.set(0, FY + 0.035, 0.005);
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
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  private rayAt(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
  }

  /** Что под пальцем: клавиша команды ({key}) или ближайшая лунка ({hole}); null — ничего. */
  pick(clientX: number, clientY: number, team: 0 | 1): { key: number } | { hole: number } | null {
    this.rayAt(clientX, clientY);
    const hit = this.ray.intersectObjects(this.keyHit[team], false)[0];
    if (hit) return { key: this.keyHit[team].indexOf(hit.object as THREE.Mesh) };
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.fieldPlane, p)) return null;
    let best = -1;
    let bd = 0.03;
    CELLS.forEach((c, i) => {
      const d = Math.hypot(p.x - c.hx, p.z - c.hz);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best >= 0 ? { hole: best } : null;
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
