/* 3D-стол настольного хоккея (three.js): пластмассовый корпус с бортом, поле-текстура, «домики» ворот,
 * плоские жестяные хоккеисты (две стороны, тень по силуэту), штанги с ручками из торцов, ползунки счёта, надпись на корпусе.
 * Камера — «из-за своих ворот» (как сидишь за настоящим) или сбоку. Единицы — метры, как в движке. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { woodTexture, WOODS } from '../../core/wood';
import { CORNER, GD, GL, GOAL, H, isGoalie, PUCK_R, slotAt, SLOTS, W, type HkState } from './engine';
import { brandCanvas, FIG_ASPECT, FIG_AXIS, FIG_H, figureUrl, iceCanvas, sliderCanvas, stripCanvas, TEAM_COL } from './tex';

/** Высота поля над столом, ширина и высота борта над полем. */
const ICE = 0.05;
const RIM = 0.042;
const RIM_H = 0.02;
const ROD_Y = 0.03;
const STRIP_L = 0.26;

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

/** Мировые координаты из координат поля. */
export const wx = (x: number) => x - W / 2;
export const wz = (y: number) => y - H / 2;

interface FigObj {
  g: THREE.Group;
  ring: THREE.Mesh;
  rod: THREE.Mesh;
  knob: THREE.Group;
  plates: THREE.Mesh[];
}

export class Rink3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1.6, 0.02, 20);
  /** Камера «куда приедем»: по ней раскладка клавиш, чтобы она не зависела от переезда камеры. */
  private keyCam = new THREE.PerspectiveCamera(36, 1.6, 0.02, 20);
  private figs: FigObj[] = [];
  private puck: THREE.Mesh;
  private puckShadow: THREE.Mesh;
  private sliders: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  private ro: ResizeObserver;
  private camMode: Cam = 'end';
  private camTeam: 0 | 1 = 0;
  private camGoal = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private ray = new THREE.Raycaster();
  private icePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ICE);

  constructor(private host: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.build();
    this.puck = this.makePuck();
    this.puckShadow = this.makePuckShadow();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __hk: Rink3D }).__hk = this;
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
    sc.environmentIntensity = 0.32;
    pm.dispose();

    const hemi = new THREE.HemisphereLight('#fff4e2', '#3a2c22', 0.55);
    sc.add(hemi);
    const key = new THREE.DirectionalLight('#fff1dc', 1.5);
    key.position.set(-0.5, 1.4, 0.7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc2 = key.shadow.camera;
    sc2.left = -0.55;
    sc2.right = 0.55;
    sc2.top = 0.45;
    sc2.bottom = -0.45;
    sc2.near = 0.5;
    sc2.far = 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.002;
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
    const table = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    sc.add(table);

    const plastic = new THREE.MeshPhysicalMaterial({ color: '#f0eadb', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.5 });
    const dark = new THREE.MeshPhysicalMaterial({ color: '#5f8f8a', roughness: 0.45, clearcoat: 0.3 });
    const OW = W + RIM * 2;
    const OH = H + RIM * 2;
    // корпус: тёмное дно-подставка, светлый короб до поля и борт с вырезом
    const foot = new THREE.Mesh(new THREE.ExtrudeGeometry(rrect(OW - 0.004, OH - 0.004, CORNER + RIM - 0.002), { depth: 0.012, bevelEnabled: false }), dark);
    foot.rotation.x = -Math.PI / 2;
    foot.receiveShadow = true;
    sc.add(foot);
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rrect(OW, OH, CORNER + RIM), { depth: ICE - 0.02, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3 }),
      plastic
    );
    body.rotation.x = -Math.PI / 2;
    body.position.y = 0.012;
    body.castShadow = true;
    body.receiveShadow = true;
    sc.add(body);
    const rimShape = rrect(OW, OH, CORNER + RIM);
    rimShape.holes.push(rrect(W, H, CORNER));
    const rim = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rimShape, { depth: RIM_H, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 4, curveSegments: 24 }),
      plastic
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = ICE - 0.002;
    rim.castShadow = true;
    rim.receiveShadow = true;
    sc.add(rim);

    // поле
    const iceGeo = new THREE.ShapeGeometry(rrect(W, H, CORNER), 24);
    const pos = iceGeo.attributes.position;
    const uv = iceGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, 0.5 + pos.getY(i) / H);
    const iceMap = this.keep(tex(iceCanvas(), 16));
    const ice = new THREE.Mesh(iceGeo, new THREE.MeshPhysicalMaterial({ map: iceMap, roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
    ice.rotation.x = -Math.PI / 2;
    ice.position.y = ICE;
    ice.receiveShadow = true;
    sc.add(ice);

    // надпись на корпусе спереди и сзади
    const brand = this.keep(tex(brandCanvas()));
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.063), new THREE.MeshStandardMaterial({ map: brand, transparent: true, roughness: 0.4 }));
      m.position.set(0, 0.033, side * (OH / 2 + 0.0034));
      if (side < 0) m.rotation.y = Math.PI;
      sc.add(m);
    }

    // планки счёта на борту: синие — ближний борт слева, красные — дальний справа; ползунок с окошком
    const slTex = this.keep(tex(sliderCanvas()));
    for (const team of [0, 1] as const) {
      const side = team === 0 ? -1 : 1;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(STRIP_L, 0.004, 0.024), [
        ...Array(2).fill(new THREE.MeshStandardMaterial({ color: TEAM_COL[team].dark })),
        new THREE.MeshPhysicalMaterial({ map: this.keep(tex(stripCanvas(team))), roughness: 0.4, clearcoat: 0.3 }),
        ...Array(3).fill(new THREE.MeshStandardMaterial({ color: TEAM_COL[team].dark })),
      ]);
      if (side < 0) strip.rotation.y = Math.PI;
      strip.position.set(-side * 0.14, ICE + RIM_H + 0.0045, side * (H / 2 + RIM / 2 + 0.001));
      strip.castShadow = true;
      strip.receiveShadow = true;
      sc.add(strip);
      const slMat = new THREE.MeshPhysicalMaterial({ color: '#f2ecdc', roughness: 0.4, clearcoat: 0.4 });
      const slider = new THREE.Mesh(new THREE.BoxGeometry(STRIP_L / 10 + 0.008, 0.005, 0.03), [
        slMat,
        slMat,
        new THREE.MeshPhysicalMaterial({ map: slTex, transparent: true, alphaTest: 0.5, roughness: 0.4, clearcoat: 0.4 }),
        slMat,
        slMat,
        slMat,
      ]);
      slider.position.copy(strip.position);
      slider.position.y += 0.0025;
      if (side < 0) slider.rotation.y = Math.PI;
      slider.castShadow = true;
      slider.userData = { side, x0: strip.position.x };
      sc.add(slider);
      this.sliders.push(slider);
    }

    // ворота: полукруглый «домик» из белой пластмассы с сеткой внутри
    const goalMat = new THREE.MeshPhysicalMaterial({ color: '#f7f7f3', roughness: 0.32, clearcoat: 0.4, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
    const netMat = new THREE.MeshStandardMaterial({ color: '#dfe3e6', roughness: 0.9, transparent: true, opacity: 0.45, side: THREE.DoubleSide, wireframe: true });
    for (const side of [0, 1]) {
      // четверть цилиндра поперёк поля: от верха над линией ворот назад к торцу; по бокам — четверти круга
      const g = new THREE.Group();
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(GD, GD, GOAL + 0.008, 24, 1, true, Math.PI, Math.PI / 2), goalMat);
      hood.rotation.x = Math.PI / 2;
      hood.castShadow = true;
      const net = new THREE.Mesh(new THREE.CylinderGeometry(GD - 0.0025, GD - 0.0025, GOAL, 10, 5, true, Math.PI, Math.PI / 2), netMat);
      net.rotation.x = Math.PI / 2;
      g.add(hood, net);
      const capGeo = new THREE.CircleGeometry(GD, 16, Math.PI / 2, Math.PI / 2);
      for (const sz of [-1, 1]) {
        const cap = new THREE.Mesh(capGeo, goalMat);
        cap.position.z = (sz * (GOAL + 0.008)) / 2;
        cap.castShadow = true;
        g.add(cap);
      }
      // красная окантовка створа
      const bar = new THREE.Mesh(new THREE.TorusGeometry(GD, 0.0018, 6, 16, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c62a1e', roughness: 0.5 }));
      bar.rotation.z = Math.PI / 2;
      for (const sz of [-1, 1]) {
        const b = bar.clone();
        b.position.z = (sz * (GOAL + 0.008)) / 2;
        g.add(b);
      }
      g.rotation.y = side === 0 ? 0 : Math.PI;
      g.position.set(wx(side === 0 ? GL : W - GL), ICE, 0);
      sc.add(g);
    }

    // хоккеисты, штанги, ручки
    const rodMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.28 });
    const pinMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.6 });
    const standMat = new THREE.MeshPhysicalMaterial({ color: '#f4f2ec', roughness: 0.4 });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.0, depthWrite: false });
    const rodGeo = new THREE.CylinderGeometry(0.0028, 0.0028, 1, 10);
    rodGeo.rotateZ(Math.PI / 2);
    // жестянка: плоскость по рисунку, ось фигурки — в нуле, крюк уходит в +x (направление угла a)
    const figW = FIG_H * FIG_ASPECT;
    const figGeo = new THREE.PlaneGeometry(figW, FIG_H);
    figGeo.translate(figW / 2 - FIG_AXIS * figW, FIG_H / 2, 0);
    const loader = new THREE.TextureLoader();
    const figMap = ([0, 1] as const).map((team) => {
      const t = this.keep(loader.load(figureUrl(team)));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
    for (let i = 0; i < 12; i++) {
      const team = (i < 6 ? 0 : 1) as 0 | 1;
      const plates: THREE.Mesh[] = [];
      const g = new THREE.Group();
      {
        const map = figMap[team];
        const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.42, metalness: 0.06 });
        const m = new THREE.Mesh(figGeo, mat);
        m.castShadow = true;
        m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
        m.position.y = 0.0015;
        g.add(m);
        plates.push(m);
      }
      // подставка-зажим и штырь в прорези
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.007, 0.006), standMat);
      stand.position.y = 0.0035;
      stand.castShadow = true;
      g.add(stand);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.006, 8), pinMat);
      pin.position.y = -0.002;
      g.add(pin);
      g.position.y = ICE;
      this.scene.add(g);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 40), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = ICE + 0.0006;
      this.scene.add(ring);
      // штанга из своего торца и ручка
      const rod = new THREE.Mesh(rodGeo, rodMat);
      rod.castShadow = true;
      this.scene.add(rod);
      const knob = new THREE.Group();
      const kc = TEAM_COL[team].main;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0085, 0.032, 16), new THREE.MeshPhysicalMaterial({ color: kc, roughness: 0.35, clearcoat: 0.5 }));
      grip.rotation.z = Math.PI / 2;
      grip.castShadow = true;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0035, 0.02), new THREE.MeshPhysicalMaterial({ color: kc, roughness: 0.35, clearcoat: 0.5 }));
      fin.castShadow = true;
      knob.add(grip, fin);
      this.scene.add(knob);
      this.figs.push({ g, ring, rod, knob, plates });
    }
  }

  private makePuck() {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(PUCK_R, PUCK_R, 0.0095, 40), new THREE.MeshPhysicalMaterial({ color: '#111', roughness: 0.45, clearcoat: 0.3 }));
    m.castShadow = true;
    this.scene.add(m);
    return m;
  }

  private makePuckShadow() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PUCK_R * 3.4, PUCK_R * 3.4), new THREE.MeshBasicMaterial({ map: this.keep(new THREE.CanvasTexture(cv)), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = ICE + 0.0008;
    this.scene.add(m);
    return m;
  }

  /** Расставить всё по состоянию; active — подсвеченные фигурки ([номер, яркость]). */
  update(st: HkState, active: [number, number][]) {
    for (let i = 0; i < 12; i++) {
      const f = st.figs[i];
      const o = this.figs[i];
      const sl = SLOTS[i];
      const [x, y] = slotAt(sl, f.s);
      o.g.position.x = wx(x);
      o.g.position.z = wz(y);
      o.g.rotation.y = -f.a;
      o.ring.position.x = wx(x);
      o.ring.position.z = wz(y);
      const hl = active.find((a) => a[0] === i);
      (o.ring.material as THREE.MeshBasicMaterial).opacity = hl ? hl[1] : 0;
      // штанга: из своего торца на уровне прорези; ручка дальше от борта, когда фигурка ближе к своим воротам
      const team = i < 6 ? 0 : 1;
      const end = team === 0 ? -1 : 1;
      const wallX = end * (W / 2 + RIM + 0.004);
      const p0 = sl.pts[0];
      const pN = sl.pts[sl.pts.length - 1];
      const travel = Math.abs(pN[0] - p0[0]);
      let laneZ = wz(p0[1]);
      let out = 0.035 + (1 - f.s) * travel;
      if (isGoalie(i)) {
        // штанга вратаря ходит рычагом: выход по центру, ручка — вбок вслед за ним
        laneZ = wz(y) * 0.7;
        out = 0.05;
      }
      const knobX = wallX + end * out;
      o.rod.position.set((wallX + knobX) / 2, ROD_Y, laneZ);
      o.rod.scale.set(Math.abs(knobX - wallX) + 0.01, 1, 1);
      o.knob.position.set(knobX + end * 0.014, ROD_Y, laneZ);
      o.knob.rotation.x = end * f.a;
    }
    const p = st.puck;
    const hidden = st.goalT > 0 && st.goalT < 1.45;
    this.puck.visible = !hidden;
    this.puckShadow.visible = !hidden;
    this.puck.position.set(wx(p.x), ICE + 0.0048, wz(p.y));
    this.puckShadow.position.set(wx(p.x) + 0.004, ICE + 0.0008, wz(p.y) + 0.003);
    // ползунки счёта: цифра = забитые (0…9)
    for (const team of [0, 1] as const) {
      const sl = this.sliders[team];
      const n = Math.min(9, st.score[team]);
      const { side, x0 } = sl.userData as { side: number; x0: number };
      // цифры идут слева направо, если смотреть с того борта, где планка
      sl.position.x = x0 + side * (-STRIP_L / 2 + STRIP_L / 20 + (n * STRIP_L) / 10);
    }
  }

  setCamera(mode: Cam, team: 0 | 1) {
    this.camMode = mode;
    this.camTeam = team;
    this.placeCamera();
  }

  private placeCamera() {
    const asp = Math.max(0.5, this.camera.aspect);
    const t = this.camTeam === 0 ? 1 : -1;
    if (this.camMode === 'end') {
      // из-за своих ворот: поле уходит вдаль; на узком экране — дальше и выше
      const k = Math.max(1, 1.2 / asp);
      this.camGoal.set(-t * (W / 2 + 0.24 * k), 0.4 + 0.1 * (k - 1), 0);
      this.camLook.set(t * 0.05, ICE, 0);
      this.camera.fov = 46;
    } else if (this.camMode === 'corner') {
      // с угла — для зрителя и превью
      const k = Math.max(1, 1.6 / asp);
      this.camGoal.set(-0.36 * k, 0.32 * k, 0.4 * k);
      this.camLook.set(0.01, ICE - 0.01, 0.02);
      this.camera.fov = 36;
    } else {
      const k = Math.max(1, 1.75 / asp);
      this.camGoal.set(0, 0.5 * k, t * (H / 2 + 0.36 * k));
      this.camLook.set(0, ICE, t * 0.035);
      this.camera.fov = 36;
    }
    this.camera.updateProjectionMatrix();
    this.keyCam.copy(this.camera);
    this.keyCam.position.copy(this.camGoal);
    this.keyCam.lookAt(this.camLook);
    this.keyCam.updateMatrixWorld();
    if (!this.camInit) {
      this.camPos.copy(this.camGoal);
      this.camInit = true;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.updateMatrixWorld();
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
    // камера переезжает плавно
    this.camPos.lerp(this.camGoal, 0.12);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  /** Точка поля под экранной точкой (координаты поля) или null. */
  pickIce(clientX: number, clientY: number): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.icePlane, hit)) return null;
    return [hit.x + W / 2, hit.z + H / 2];
  }

  /** Какая фигурка под экранной точкой (по пластинам), −1 — никакая. */
  pickFig(clientX: number, clientY: number): number {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const meshes = this.figs.flatMap((f) => f.plates);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return -1;
    return this.figs.findIndex((f) => f.plates.includes(hit.object as THREE.Mesh));
  }

  /** Экранное направление вектора поля (dx, dy) в точке (x, y): для раскладки клавиш «по экрану». */
  screenDir(x: number, y: number, dx: number, dy: number): [number, number] {
    const a = new THREE.Vector3(wx(x), ICE, wz(y)).project(this.keyCam);
    const b = new THREE.Vector3(wx(x + dx * 0.02), ICE, wz(y + dy * 0.02)).project(this.keyCam);
    // экранные оси: x вправо, y вниз
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
