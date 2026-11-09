/* 3D-площадка городков (three.js). Двор и реквизит собраны в Blender (studio/blender/gorodki_yard.py) из текстур Z-Image
 * (studio/jobs/gorodki/03-tex.yaml): утоптанная площадка с меловой разметкой, отбойник из досок, ряды бетонных гаражей
 * с ржавыми дверями, берёзы и тополя, лавочки; городки и бита — берёза с торцами-кольцами, кольца и изолента на бите.
 * Люди — гопники MakeHuman/MPFB2, CC0 (people3d.ts). Задник — фотопанорама двора на полукруге. Солнце с мягкими тенями.
 * Плюс «лупа» — окошко с городом крупно. Ось игры (x, y — вглубь к городу, z — вверх) → three: (x, z, −y). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BR, G as GRAV, LOFT, RELEASE_Z, RH, RR, speedOf } from './physics';
import { TOON, TOON_CAM } from './pacan3d';
import { Crowd } from './people3d';

export type CamMode = 'aim' | 'flight' | 'city' | 'over';

const W = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);
const BASE = `${import.meta.env.BASE_URL}gorodki/`;

export interface RodPose {
  x: number;
  y: number;
  z: number;
  a: number;
  roll: number;
  stand: boolean;
}

export class Yard3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1.6, 0.05, 250);
  private lupaCam = new THREE.PerspectiveCamera(32, 1.3, 0.05, 50);
  private ro: ResizeObserver;
  private rods: THREE.Object3D[] = [];
  private rodProto: THREE.Object3D | null = null;
  private markProto: THREE.Object3D | null = null;
  private batProto: THREE.Object3D | null = null;
  private flyBat: THREE.Object3D | null = null;
  private lastRods: (RodPose & { mark?: boolean })[] = [];
  private lastBat: RodPose | null = null;
  readonly crowd: Crowd;
  private aimGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  private camPos = new THREE.Vector3(0, 2, 16);
  private camLook = new THREE.Vector3(0, 0, 0);
  private camGoalPos = new THREE.Vector3(0, 2, 16);
  private camGoalLook = new THREE.Vector3(0, 0, 0);
  private camSpeed = 3;
  /** Угол обзора: базовый (по пропорциям экрана) и добавка, к которой плавно идёт камера (у пацанов в прицеле шире). */
  private baseFov = 32;
  private fovAdd = 0;
  private fovAddGoal = 0;
  private disposables: { dispose(): void }[] = [];
  /** Двор и реквизит загружены. */
  readonly loaded: Promise<void>;
  lupa = true;
  lupaWide = false;
  lupaShown = false;
  /** Кто бросает: место и позиция вдоль черты. */
  thrower = { seat: 0, x: 0, line: -13 };
  /** Фаза броска (null — стоит). */
  phase: number | null = null;

  constructor(private host: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.ring);
    const dotGeo = new THREE.CircleGeometry(0.06, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.rotation.x = -Math.PI / 2;
      this.aimDots.push(d);
      this.aimGroup.add(d);
    }
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.crowd = new Crowd(() => this.batProto);
    this.scene.add(this.crowd.group);
    this.light();
    const bd = this.backdrop();
    this.loaded = Promise.all([this.load(), bd]).then(() => {});
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __gk: Yard3D }).__gk = this;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private light() {
    const sc = this.scene;
    sc.background = new THREE.Color('#b8d4ea');
    sc.fog = new THREE.Fog('#e6d6c2', 40, 140);
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = this.keep(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    sc.environmentIntensity = 0.32;
    pm.dispose();
    sc.add(new THREE.HemisphereLight('#ffe4c4', '#5a4630', 0.95));
    // тёплое вечернее солнце низко слева-сзади: длинные мягкие тени
    const sun = new THREE.DirectionalLight('#ffcf94', 3.3);
    sun.position.set(-14, 7.5, 9);
    sun.target.position.set(0, 0, -1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sh = sun.shadow.camera;
    sh.left = -16;
    sh.right = 16;
    sh.top = 20;
    sh.bottom = -22;
    sh.near = 1;
    sh.far = 60;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    sc.add(sun, sun.target);
  }

  /** Фотопанорама двора на полукруге за площадкой. */
  private backdrop(): Promise<void> {
    let ok!: () => void;
    const ready = new Promise<void>((r) => (ok = r));
    // ошибка картинки не держит экран загрузки — двор откроется без задника
    const t = this.keep(new THREE.TextureLoader().load(`${BASE}backdrop.webp`, () => ok(), undefined, () => ok()));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.repeat.set(-2, 1);
    t.offset.set(0.5, 0);
    const bd = new THREE.Mesh(
      new THREE.CylinderGeometry(60, 60, 20, 72, 1, true, -Math.PI * 0.5, Math.PI),
      new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, color: '#f2f2f2' })
    );
    bd.position.set(0, 7.2, 4);
    bd.rotation.y = Math.PI;
    this.scene.add(bd);
    return ready;
  }

  /** Собрать шейдеры и залить текстуры в видеокарту до показа (иначе первые кадры — голубая пустота). */
  async warm(): Promise<void> {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* старый three или потеря контекста — просто покажем как есть */
    }
    this.renderer.render(this.scene, this.camera);
  }

  private async load() {
    const loader = new GLTFLoader();
    const [yard, props] = await Promise.all([loader.loadAsync(`${BASE}yard.glb?v=3`), loader.loadAsync(`${BASE}props.glb?v=3`)]);
    yard.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.name + ' ' + (m.parent?.name ?? '')).toLowerCase();
      const flat = /ground|court|city|prigorod|mark|line|clay/.test(name) && !/cityboard/.test(name);
      m.receiveShadow = true;
      m.castShadow = !flat;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map) mat.map.anisotropy = 8;
      // деревья и кусты: вырезка по альфе с мягким краем (alpha to coverage при сглаживании), обе стороны
      if (/tree|bush|weeds/.test(name)) {
        mat.alphaTest = 0.35;
        mat.alphaToCoverage = true;
        mat.transparent = false;
        mat.side = THREE.DoubleSide;
        m.receiveShadow = false;
      }
      // следы бит и камешки — наклейки на земле
      if (/scuff|pebbles/.test(name)) {
        mat.transparent = true;
        mat.opacity = /scuff/.test(name) ? 0.42 : 0.8;
        mat.alphaTest = 0.02;
        mat.depthWrite = false;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -4;
        m.castShadow = false;
        m.renderOrder = 2;
      }
      if (/clay/.test(name)) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -1;
        m.castShadow = false;
      }
      if (/city|prigorod|mark|line/.test(name) && !/clay|cityboard/.test(name)) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
      }
    });
    this.scene.add(yard.scene);
    const rod = props.scene.getObjectByName('rod');
    const bat = props.scene.getObjectByName('bat');
    if (rod) {
      rod.position.set(0, 0, 0);
      rod.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
      this.rodProto = rod;
      // марка — та же чурка, но покрашена жёлтым
      const mk = rod.clone();
      mk.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const sm = m.material as THREE.MeshStandardMaterial;
        if (/side/.test(sm.name)) {
          const c = sm.clone();
          c.color = new THREE.Color('#ffc060');
          m.material = c;
        }
      });
      this.markProto = mk;
    }
    if (bat) {
      bat.position.set(0, 0, 0);
      bat.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.batProto = bat;
    }
    for (const r of this.rods) this.scene.remove(r);
    this.rods = [];
    this.setRods(this.lastRods);
    this.setBat(this.lastBat);
  }

  /** Люди: по человеку на место. */
  setSeats(seats: number[]) {
    this.crowd.setSeats(seats);
  }

  private newRod(): THREE.Object3D {
    const g = new THREE.Group();
    if (this.rodProto) {
      g.add(this.rodProto.clone());
      g.userData.mark = false;
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, RH * 2, 16), new THREE.MeshStandardMaterial({ color: '#e8d4a8', roughness: 0.7 }));
      m.castShadow = true;
      g.add(m);
    }
    this.scene.add(g);
    return g;
  }

  /** Городки: позы. */
  setRods(rods: (RodPose & { mark?: boolean })[]) {
    this.lastRods = rods;
    while (this.rods.length < rods.length) this.rods.push(this.newRod());
    this.rods.forEach((g, i) => {
      const r = rods[i];
      g.visible = !!r;
      if (!r) return;
      if (this.rodProto && this.markProto && !!g.userData.mark !== !!r.mark) {
        g.clear();
        g.add((r.mark ? this.markProto : this.rodProto).clone());
        g.userData.mark = !!r.mark;
      }
      const m = g.children[0];
      g.position.copy(W(r.x, r.y, r.stand ? r.z + RH : r.z));
      if (r.stand) {
        g.rotation.set(0, 0, 0);
        m.rotation.set(0, 0, 0);
      } else {
        g.rotation.set(0, r.a, 0);
        m.rotation.set(r.roll, 0, Math.PI / 2);
      }
    });
  }

  /** Бита в полёте (null — в руке у бросающего). */
  setBat(p: RodPose | null) {
    this.lastBat = p;
    if (!p) {
      if (this.flyBat) this.flyBat.visible = false;
      return;
    }
    if (!this.flyBat && this.batProto) {
      this.flyBat = this.batProto.clone();
      this.scene.add(this.flyBat);
    }
    const b = this.flyBat;
    if (!b) return;
    b.visible = true;
    b.position.copy(W(p.x, p.y, p.z));
    b.rotation.order = 'YXZ';
    b.rotation.set(0, p.a, Math.PI / 2);
  }

  /** Прицел: точки траектории и кольцо там, где бита коснётся земли. */
  setAim(a: { x: number; ang: number; pow: number; line: number; full: boolean } | null) {
    this.aimGroup.visible = !!a;
    if (!a) return;
    const v = speedOf(a.pow);
    const vh = v * Math.cos(LOFT);
    const vz = v * Math.sin(LOFT);
    const tLand = (vz + Math.sqrt(vz * vz + 2 * GRAV * (RELEASE_Z - BR))) / GRAV;
    const sa = Math.sin(a.ang);
    const ca = Math.cos(a.ang);
    const x0 = a.x + sa * 0.4;
    const y0 = a.line + ca * 0.4;
    const n = this.aimDots.length;
    this.aimDots.forEach((d, i) => {
      const t = (tLand * (i + 1)) / (n + 1);
      d.visible = a.full || i < n * 0.45;
      d.position.copy(W(x0 + sa * vh * t, y0 + ca * vh * t, 0.012));
    });
    this.ring.visible = a.full;
    this.ring.position.copy(W(x0 + sa * vh * tLand, y0 + ca * vh * tLand, 0.01));
  }

  camTo(mode: CamMode, focus?: { x: number; y: number }, speed = 3) {
    const t = this.thrower;
    this.camSpeed = speed;
    this.fovAddGoal = 0;
    if (mode === 'aim' && TOON) {
      // пацан ниже взрослого и с крупной головой: камера дальше и шире — он в полный рост слева внизу,
      // площадка и город — по центру, как раньше (смотрим в ту же точку)
      const c = TOON_CAM;
      this.camGoalPos.copy(W(t.x + c.dx, t.line - c.back, c.h));
      this.camGoalLook.copy(W(t.x * 0.3 + 0.15 + c.lookX, 1.2, c.lookZ));
      this.fovAddGoal = c.fov;
    } else if (mode === 'aim') {
      this.camGoalPos.copy(W(t.x + 0.6, t.line - 3.9, 2.0));
      this.camGoalLook.copy(W(t.x * 0.3 + 0.15, 1.2, 0.2));
    } else if (mode === 'flight' && focus) {
      this.camGoalPos.copy(W(focus.x * 0.4 + 0.9, focus.y - 3.0, 1.9));
      this.camGoalLook.copy(W(focus.x * 0.6, focus.y + 2, 0.3));
    } else if (mode === 'city') {
      this.camGoalPos.copy(W(1.0, -3.3, 2.5));
      this.camGoalLook.copy(W(0, 0.6, 0));
    } else {
      this.camGoalPos.copy(W(4.5, -9, 5));
      this.camGoalLook.copy(W(0, -3, 0));
    }
  }

  /** Кадр для превью: низко над пригородом, бита летит в фигуру. */
  shotCam() {
    this.camGoalPos.copy(W(1.1, -2.1, 0.62));
    this.camGoalLook.copy(W(-0.15, 0.35, 0.12));
    this.snapCam();
  }

  /** Разработка: поставить камеру (координаты three). */
  setCam(pos: [number, number, number], look: [number, number, number]) {
    this.camGoalPos.set(...pos);
    this.camGoalLook.set(...look);
    this.snapCam();
  }

  snapCam() {
    this.camPos.copy(this.camGoalPos);
    this.camLook.copy(this.camGoalLook);
  }

  cheer() {
    this.crowd.cheer(this.thrower.seat);
  }

  render(dt: number) {
    this.crowd.thrower = this.thrower;
    this.crowd.phase = this.phase;
    this.crowd.update(dt);
    const k = 1 - Math.exp(-dt * this.camSpeed);
    this.camPos.lerp(this.camGoalPos, k);
    this.camLook.lerp(this.camGoalLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.fovAdd - this.fovAddGoal) > 0.01) {
      this.fovAdd += (this.fovAddGoal - this.fovAdd) * k;
      this.camera.fov = this.baseFov + this.fovAdd;
      this.camera.updateProjectionMatrix();
    }
    const r = this.renderer;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    this.lupaShown = this.lupa && this.camPos.z > 4;
    if (this.lupaShown) {
      const lw = Math.round(Math.min(w * 0.3, 300));
      const lh = Math.round(lw * 0.72);
      const x = w - lw - 10;
      const y = h - lh - 10;
      this.lupaCam.aspect = lw / lh;
      this.lupaCam.updateProjectionMatrix();
      if (this.lupaWide) {
        this.lupaCam.position.copy(W(0, -1.6, 2.2));
        this.lupaCam.lookAt(W(0, 0.85, 0));
      } else {
        this.lupaCam.position.copy(W(0, -0.75, 0.75));
        this.lupaCam.lookAt(W(0, 0.32, 0));
      }
      const aim = this.aimGroup.visible;
      this.aimGroup.visible = false;
      r.setScissorTest(true);
      r.setScissor(x, y, lw, lh);
      r.setViewport(x, y, lw, lh);
      r.render(this.scene, this.lupaCam);
      r.setScissorTest(false);
      this.aimGroup.visible = aim;
    }
  }

  lupaRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.lupa) return null;
    const w = this.host.clientWidth;
    const lw = Math.round(Math.min(w * 0.3, 300));
    const lh = Math.round(lw * 0.72);
    return { x: w - lw - 10, y: 10, w: lw, h: lh };
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.baseFov = w / h < 1 ? 46 : 32;
    this.camera.fov = this.baseFov + this.fovAdd;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.ro.disconnect();
    this.crowd.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
