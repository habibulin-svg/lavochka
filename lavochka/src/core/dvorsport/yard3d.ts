/* Дворовый спорт — 3D-площадка двора (three.js): рендерер с мягкими тенями, вечернее солнце, окружение, фотопанорама
 * двора на полукруге, двор и реквизит из Blender (studio/blender/gorodki_yard.py → public/gorodki/yard.glb, props.glb),
 * плавная камера по таблице ракурсов, пик по земле, ResizeObserver, dispose. Игра наследует DvorYard и добавляет своё
 * (городки — рюхи, биту, лупу; лапта — мяч, базы). Оси игры: x — вбок, y — вглубь поля, z — вверх → three: (x, z, −y). */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Общие ассеты двора — в папке городок (первая игра на наборе): двор, реквизит, задник, пацаны, музыка. */
export const DVOR_BASE = `${import.meta.env.BASE_URL}gorodki/`;

/** Точка игры → three. */
export const W = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);
/** Точка three → игра. */
export const fromW = (v: THREE.Vector3) => ({ x: v.x, y: -v.z, z: v.y });

/** Ракурс: где камера и куда смотрит (оси игры), добавка к углу обзора (°), скорость подлёта. */
export interface Shot {
  pos: [number, number, number];
  look: [number, number, number];
  fov?: number;
  speed?: number;
}

export interface YardOpts {
  /** Двор: false — без двора (своё поле), по умолчанию yard.glb городков. */
  yard?: string | false;
  /** Реквизит (биты, городки, мячи): false — нет. */
  props?: string | false;
  /** Задник: false — без панорамы. */
  backdrop?: string | false;
  /** Где освещать тенями: прямоугольник в осях three вокруг солнца (left, right, top, bottom). */
  shadow?: [number, number, number, number];
  /** Середина площадки (оси игры x, y): туда смотрит солнце и вокруг неё стоит задник. По умолчанию (0, 1) — двор городков. */
  center?: [number, number];
  /** Радиус полукруга задника, м (по умолчанию 60; большое поле лапты — 85). */
  backdropR?: number;
}

export class DvorYard<Cam extends string = string> {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1.6, 0.05, 250);
  readonly loaded: Promise<void>;
  /** Реквизит props.glb (после loaded): прототипы по имени — props.getObjectByName('bat'). */
  props: THREE.Object3D | null = null;
  protected ro: ResizeObserver;
  protected camPos = new THREE.Vector3(0, 2, 16);
  protected camLook = new THREE.Vector3(0, 0, 0);
  protected camGoalPos = new THREE.Vector3(0, 2, 16);
  protected camGoalLook = new THREE.Vector3(0, 0, 0);
  protected camSpeed = 3;
  /** Угол обзора: базовый (по пропорциям экрана: узкий экран — шире) и добавка, к которой плавно идёт камера. */
  protected baseFov = 32;
  protected fovAdd = 0;
  protected fovAddGoal = 0;
  /** Таблица ракурсов игры: camTo(имя, …) берёт ракурс отсюда. */
  shots: Partial<Record<Cam, (...a: never[]) => Shot>> = {};
  private disposables: { dispose(): void }[] = [];
  private ray = new THREE.Raycaster();

  constructor(
    protected host: HTMLElement,
    o: YardOpts = {},
  ) {
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
    const [cx, cy] = o.center ?? [0, 1];
    this.light(o.shadow ?? [-16, 16, 20, -22], cx, cy - 1);
    const bd = o.backdrop === false ? Promise.resolve() : this.backdrop(o.backdrop ?? `${DVOR_BASE}backdrop.webp`, cx, cy - 1, o.backdropR ?? 60);
    this.loaded = Promise.all([this.load(o.yard === false ? null : (o.yard ?? `${DVOR_BASE}yard.glb?v=3`), o.props === false ? null : (o.props ?? `${DVOR_BASE}props.glb?v=3`)), bd]).then(() => {});
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  protected keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** Свет; dx, dy — сдвиг солнца и его цели от двора городков (оси игры). */
  private light([l, r, t, b]: [number, number, number, number], dx = 0, dy = 0) {
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
    sun.position.set(-14 + dx, 7.5, 9 - dy);
    sun.target.position.set(dx, 0, -1 - dy);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sh = sun.shadow.camera;
    sh.left = l;
    sh.right = r;
    sh.top = t;
    sh.bottom = b;
    sh.near = 1;
    sh.far = 60;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    sc.add(sun, sun.target);
  }

  /** Фотопанорама двора на полукруге за площадкой. */
  private backdrop(url: string, dx = 0, dy = 0, R = 60): Promise<void> {
    let ok!: () => void;
    const ready = new Promise<void>((r) => (ok = r));
    // ошибка картинки не держит экран загрузки — двор откроется без задника
    const t = this.keep(new THREE.TextureLoader().load(url, () => ok(), undefined, () => ok()));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.repeat.set(-2, 1);
    t.offset.set(0.5, 0);
    const bd = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, (20 * R) / 60, 72, 1, true, -Math.PI * 0.5, Math.PI),
      new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, color: '#f2f2f2' }),
    );
    bd.position.set(dx, (7.2 * R) / 60, 4 - dy);
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

  private async load(yardUrl: string | null, propsUrl: string | null) {
    const loader = new GLTFLoader();
    const [yard, props] = await Promise.all([yardUrl ? loader.loadAsync(yardUrl) : null, propsUrl ? loader.loadAsync(propsUrl) : null]);
    if (yard) {
      dressYard(yard);
      this.scene.add(yard.scene);
    }
    this.props = props?.scene ?? null;
    this.onLoaded();
  }

  /** Двор и реквизит загружены: игра достаёт прототипы из this.props. */
  protected onLoaded() {}

  private shakeA = 0;
  private shakeT = 0;
  /** Толчок камеры: сила в метрах (0,05 — удар битой, 0,12 — осалили). */
  shake(amount = 0.06) {
    this.shakeA = Math.max(this.shakeA, amount);
  }

  /** Камера к ракурсу из таблицы shots. */
  camTo(mode: Cam, ...a: unknown[]) {
    const f = this.shots[mode] as ((...a: unknown[]) => Shot) | undefined;
    if (f) this.shot(f(...a));
  }

  /** Камера к ракурсу (плавно). */
  shot(s: Shot) {
    this.camGoalPos.copy(W(...s.pos));
    this.camGoalLook.copy(W(...s.look));
    this.fovAddGoal = s.fov ?? 0;
    if (s.speed != null) this.camSpeed = s.speed;
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

  /** Где на земле (z = h) точка экрана (clientX/Y): координаты игры или null (над горизонтом). */
  pickGround(clientX: number, clientY: number, h = 0): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), new THREE.Vector3());
    return hit ? { x: hit.x, y: -hit.z } : null;
  }

  /** Точка игры → экран (px от левого верхнего угла холста) — для надписей над людьми. */
  toScreen(x: number, y: number, z = 0): { x: number; y: number; vis: boolean } {
    const v = W(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.host.clientWidth, y: ((1 - v.y) / 2) * this.host.clientHeight, vis: v.z < 1 };
  }

  /** Перед кадром: люди, мячи (игра переопределяет). */
  protected update(_dt: number) {}

  /** После основного кадра: окошки поверх (лупа городков). */
  protected overlay(_w: number, _h: number) {}

  /** Плавная камера к цели. */
  protected stepCam(dt: number) {
    const k = 1 - Math.exp(-dt * this.camSpeed);
    this.camPos.lerp(this.camGoalPos, k);
    this.camLook.lerp(this.camGoalLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // толчок камеры (удар, ловля, осалили): затухающая дрожь
    if (this.shakeA > 0.002) {
      this.shakeT += dt;
      const a = this.shakeA;
      this.camera.position.x += Math.sin(this.shakeT * 53) * a;
      this.camera.position.y += Math.sin(this.shakeT * 71 + 1) * a * 0.7;
      this.shakeA *= Math.exp(-dt * 7);
    }
    if (Math.abs(this.fovAdd - this.fovAddGoal) > 0.01) {
      this.fovAdd += (this.fovAddGoal - this.fovAdd) * k;
      this.camera.fov = this.baseFov + this.fovAdd;
      this.camera.updateProjectionMatrix();
    }
  }

  render(dt: number) {
    this.update(dt);
    this.stepCam(dt);
    const r = this.renderer;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    this.overlay(w, h);
  }

  protected resize() {
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
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** Двор из Blender: тени, вырезка листвы по альфе, наклейки на земле, меловая разметка поверх земли. */
function dressYard(yard: GLTF) {
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
}
