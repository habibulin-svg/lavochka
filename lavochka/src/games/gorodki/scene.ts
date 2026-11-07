/* 3D-площадка городков (three.js): двор за гаражами — утоптанная площадка с меловой разметкой (город, марка, пригород,
 * штрафная линия, полукон, кон), деревянный отбойник за городом, ряд гаражей сбоку, лавочка, деревья и рисованный задник.
 * Бита и городки — берёзовые чурки; человечки бросают и ждут на лавочке. Плюс «лупа» — окошко с городом крупно.
 * Ось игры (x, y — вглубь к городу, z — вверх) → three: (x, z, −y). */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BH, BR, LOFT, RELEASE_Z, RH, RR, speedOf, G as GRAV } from './physics';
import { Person, STYLES } from './people';

export type CamMode = 'aim' | 'flight' | 'city' | 'over';

const W = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Трава вокруг площадки. */
function grassTex(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = rand(3);
  g.fillStyle = '#6aa63a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const l = 30 + r() * 28;
    g.strokeStyle = `hsl(${80 + r() * 30}, ${45 + r() * 20}%, ${l}%)`;
    g.lineWidth = 1 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 6);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${150 + r() * 40},${120 + r() * 30},70,0.25)`;
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Площадка: утоптанная земля, город светлее, меловая разметка. 8 × 22 м, от y = −16 до y = 6. */
const COURT = { x0: -4, x1: 4, y0: -16, y1: 6 };
const PPM = 64;
function courtTex(): THREE.CanvasTexture {
  const w = (COURT.x1 - COURT.x0) * PPM;
  const h = (COURT.y1 - COURT.y0) * PPM;
  const [c, g] = canvas(w, h);
  const r = rand(11);
  const X = (x: number) => (x - COURT.x0) * PPM;
  const Y = (y: number) => (COURT.y1 - y) * PPM;
  // земля с краями в траву
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#a88a5e');
  grd.addColorStop(0.5, '#b89a6a');
  grd.addColorStop(1, '#a88a5e');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) {
    const v = 120 + r() * 70;
    g.fillStyle = `rgba(${v},${v * 0.82},${v * 0.58},${0.25 + r() * 0.35})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5);
  }
  // камешки
  for (let i = 0; i < 700; i++) {
    const v = 150 + r() * 80;
    g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.88})`;
    g.beginPath();
    g.ellipse(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // протоптанная дорожка от кона к городу
  g.fillStyle = 'rgba(90,70,45,0.18)';
  g.beginPath();
  g.ellipse(X(0), Y(-7), 1.2 * PPM, 7 * PPM, 0, 0, Math.PI * 2);
  g.fill();
  // город — глиняная площадка посветлее
  g.fillStyle = '#c9ad7c';
  g.fillRect(X(-1.15), Y(2.15), 2.3 * PPM, 2.3 * PPM);
  for (let i = 0; i < 4000; i++) {
    const v = 175 + r() * 50;
    g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.62},0.35)`;
    g.fillRect(X(-1.15) + r() * 2.3 * PPM, Y(2.15) + r() * 2.3 * PPM, 1 + r() * 2, 1 + r() * 2);
  }
  // мел
  const chalk = (pts: [number, number][], width = 0.05, close = false) => {
    g.strokeStyle = 'rgba(250,250,240,0.92)';
    g.lineWidth = width * PPM;
    g.lineCap = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    if (close) g.closePath();
    g.stroke();
  };
  chalk(
    [
      [-1, 0],
      [1, 0],
      [1, 2],
      [-1, 2],
    ],
    0.05,
    true
  );
  // пригород: «усы» и штрафная линия
  chalk([
    [-1, 0],
    [-2, -1],
    [2, -1],
    [1, 0],
  ]);
  // отметки 20 и 40 см
  for (const y of [-0.8, -0.6]) {
    chalk([[-0.15, y], [0.15, y]], 0.025);
  }
  // марка
  chalk([[-0.07, 0.93], [0.07, 1.07]], 0.03);
  chalk([[-0.07, 1.07], [0.07, 0.93]], 0.03);
  // полукон и кон (рисуются оба, длина 3 м)
  for (const y of [-6.5, -13, -5, -10, -4, -8]) {
    const main = y === -6.5 || y === -13;
    chalk([[-1.6, y], [1.6, y]], main ? 0.06 : 0.03);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Дерево (берёза): кора — белая с чёрными мазками, торец — кольца. */
function birchTex(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  const r = rand(5);
  g.fillStyle = '#e9d3a6';
  g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(${150 + r() * 40},${110 + r() * 30},60,${0.15 + r() * 0.25})`;
    g.lineWidth = 0.6 + r() * 1.4;
    const y = r() * 64;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + (r() - 0.5) * 6, 170, y + (r() - 0.5) * 6, 256, y + (r() - 0.5) * 4);
    g.stroke();
  }
  for (let i = 0; i < 10; i++) {
    g.fillStyle = 'rgba(110,70,30,0.35)';
    g.beginPath();
    g.ellipse(r() * 256, r() * 64, 2 + r() * 4, 1 + r() * 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function endTex(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#f0dcae';
  g.fillRect(0, 0, 64, 64);
  for (let k = 3; k < 32; k += 3.2) {
    g.strokeStyle = `rgba(160,110,50,${0.25 + (k % 2) * 0.1})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(32 + Math.sin(k) * 1.2, 32, k, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Гаражная дверь: профлист, ржавчина, замок. */
function garageTex(color: string, seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rand(seed);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 12) {
    const gr = g.createLinearGradient(x, 0, x + 12, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.12)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 12, 256);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(126, 0, 4, 256);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(${120 + r() * 50},${50 + r() * 30},20,${0.2 + r() * 0.4})`;
    g.beginPath();
    g.ellipse(r() * 256, 180 + r() * 76, 4 + r() * 20, 3 + r() * 12, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#2a2a2a';
  g.fillRect(134, 120, 10, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plankTex(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  const r = rand(9);
  for (let i = 0; i < 4; i++) {
    const v = 120 + r() * 30;
    g.fillStyle = `rgb(${v},${v * 0.72},${v * 0.45})`;
    g.fillRect(0, i * 32, 512, 32);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(60,35,15,${0.1 + r() * 0.2})`;
      g.beginPath();
      const y = i * 32 + r() * 32;
      g.moveTo(0, y);
      g.lineTo(512, y + (r() - 0.5) * 6);
      g.stroke();
    }
    g.fillStyle = 'rgba(30,18,8,0.6)';
    g.fillRect(0, i * 32 + 30, 512, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  readonly camera = new THREE.PerspectiveCamera(30, 1.6, 0.05, 200);
  private lupaCam = new THREE.PerspectiveCamera(32, 1.3, 0.05, 50);
  private ro: ResizeObserver;
  private rods: THREE.Group[] = [];
  private rodGeo: THREE.CylinderGeometry;
  private rodMats: THREE.Material[];
  private markMats: THREE.Material[];
  readonly bat: THREE.Group;
  private people: Person[] = [];
  private aimGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  private backdrop: THREE.Mesh;
  private texCache = new Map<string, THREE.Texture>();
  private camPos = new THREE.Vector3(0, 2, 16);
  private camLook = new THREE.Vector3(0, 0, 0);
  private camGoalPos = new THREE.Vector3(0, 2, 16);
  private camGoalLook = new THREE.Vector3(0, 0, 0);
  private camSpeed = 3;
  /** Показывать лупу (окошко с городом). */
  lupa = true;
  /** Лупа на весь город («Письмо», «Тир», разлетевшиеся городки). */
  lupaWide = false;
  /** Лупа нарисована в этом кадре (её прячем, когда камера уже у города). */
  lupaShown = false;
  /** Кто бросает: место и позиция вдоль черты. */
  thrower = { seat: 0, x: 0, line: -13 };
  /** Фаза броска (null — стоит). */
  phase: number | null = null;
  private cheerT = -1;
  private seats: number[] = [0];
  private disposables: { dispose(): void }[] = [];

  constructor(private host: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);

    const birch = this.keep(birchTex());
    const ends = this.keep(endTex());
    this.rodGeo = this.keep(new THREE.CylinderGeometry(RR, RR, RH * 2, 18, 1));
    this.rodMats = [
      new THREE.MeshStandardMaterial({ map: birch, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ map: ends, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ map: ends, roughness: 0.8 }),
    ];
    this.markMats = [new THREE.MeshStandardMaterial({ map: birch, color: '#ffd27a', roughness: 0.7 }), this.rodMats[1], this.rodMats[2]];
    this.bat = this.makeBat(birch, ends);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 40), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.95, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.ring);
    const dotGeo = new THREE.CircleGeometry(0.075, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ff6a2a', transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      this.aimDots.push(d);
      this.aimGroup.add(d);
    }
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.backdrop = this.build();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private makeBat(birch: THREE.Texture, ends: THREE.Texture): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(BR, BR * 0.92, BH * 2, 20),
      [new THREE.MeshStandardMaterial({ map: birch, color: '#e2b878', roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: ends }), new THREE.MeshStandardMaterial({ map: ends })]
    );
    body.castShadow = true;
    g.add(body);
    // обмотка-ручка и железные кольца на концах
    const tape = new THREE.Mesh(new THREE.CylinderGeometry(BR * 1.06, BR * 1.06, 0.2, 16), new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.9 }));
    tape.position.y = -BH + 0.14;
    g.add(tape);
    for (const y of [BH - 0.025, -BH + 0.025]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(BR * 1.08, BR * 1.08, 0.03, 16), new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.35 }));
      ring.position.y = y;
      g.add(ring);
    }
    return g;
  }

  private tex(url: string): THREE.Texture {
    let t = this.texCache.get(url);
    if (!t) {
      t = new THREE.TextureLoader().load(url);
      t.colorSpace = THREE.SRGBColorSpace;
      this.texCache.set(url, t);
      this.keep(t);
    }
    return t;
  }

  private build(): THREE.Mesh {
    const sc = this.scene;
    sc.background = new THREE.Color('#9fd4f5');
    sc.fog = new THREE.Fog('#bfe2f5', 45, 120);
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = this.keep(pm.fromScene(new RoomEnvironment(), 0.04).texture);
    sc.environmentIntensity = 0.35;
    pm.dispose();
    sc.add(new THREE.HemisphereLight('#e8f4ff', '#6a7a3a', 1.1));
    const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    sun.position.set(-6, 14, 8);
    sun.target.position.set(0, 0, -1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sh = sun.shadow.camera;
    sh.left = -6;
    sh.right = 6;
    sh.top = 9;
    sh.bottom = -18;
    sh.near = 1;
    sh.far = 40;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sc.add(sun, sun.target);

    // трава
    const grass = grassTex();
    grass.repeat.set(30, 30);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: this.keep(grass), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    ground.receiveShadow = true;
    sc.add(ground);
    // площадка
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT.x1 - COURT.x0, COURT.y1 - COURT.y0),
      new THREE.MeshStandardMaterial({ map: this.keep(courtTex()), roughness: 0.95 })
    );
    court.rotation.x = -Math.PI / 2;
    court.position.copy(W((COURT.x0 + COURT.x1) / 2, (COURT.y0 + COURT.y1) / 2, 0));
    court.receiveShadow = true;
    sc.add(court);

    // отбойник за городом и низкие борта
    const planks = this.keep(plankTex());
    const wallMat = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(7, 0.9, 0.12), wallMat);
    back.position.copy(W(0, 5.2, 0.45));
    back.castShadow = back.receiveShadow = true;
    sc.add(back);
    for (const x of [-3.5, 3.5]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 6), wallMat);
      side.position.copy(W(x, 2.4, 0.25));
      side.castShadow = side.receiveShadow = true;
      sc.add(side);
    }
    const postMat = new THREE.MeshStandardMaterial({ color: '#5a3a1e', roughness: 0.9 });
    for (const x of [-3.4, -1.2, 1.2, 3.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), postMat);
      post.position.copy(W(x, 5.3, 0.55));
      post.castShadow = true;
      sc.add(post);
    }

    // гаражи слева
    const colors = ['#4a8a5a', '#a8402e', '#3a6aa8', '#6a9a8a', '#b8602e', '#4a7a4a', '#8a8a92'];
    const roofMat = new THREE.MeshStandardMaterial({ color: '#5a5a5e', roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 7; i++) {
      const y = 9 - i * 3.3;
      const doorTex = this.keep(garageTex(colors[i], 20 + i));
      const wall = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.75, metalness: 0.15 });
      const door = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.2 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.5, 3.2), [door, wall, wall, wall, wall, wall]);
      box.position.copy(W(-10.5, y, 1.25));
      box.castShadow = box.receiveShadow = true;
      sc.add(box);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.12, 3.3), roofMat);
      roof.position.copy(W(-10.5, y, 2.56));
      roof.rotation.z = 0.05;
      roof.castShadow = true;
      sc.add(roof);
    }
    // гаражи справа подальше
    for (let i = 0; i < 5; i++) {
      const y = 4 - i * 3.3;
      const doorTex = this.keep(garageTex(colors[(i + 3) % colors.length], 40 + i));
      const wall = new THREE.MeshStandardMaterial({ color: colors[(i + 3) % colors.length], roughness: 0.75, metalness: 0.15 });
      const door = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.2 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.5, 3.2), [wall, door, wall, wall, wall, wall]);
      box.position.copy(W(11, y, 1.25));
      box.castShadow = box.receiveShadow = true;
      sc.add(box);
    }
    // деревья
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#efeae0', roughness: 0.8 });
    const leafMats = ['#5aa83a', '#4a9a32', '#6ab84a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
    const tr = rand(77);
    const tree = (x: number, y: number, s: number) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 3 * s, 8), trunkMat);
      trunk.position.y = 1.5 * s;
      trunk.castShadow = true;
      g.add(trunk);
      for (let k = 0; k < 4; k++) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry((0.9 + tr() * 0.6) * s, 1), leafMats[k % 3]);
        crown.position.set((tr() - 0.5) * 1.2 * s, (3 + tr() * 1.4) * s, (tr() - 0.5) * 1.2 * s);
        crown.castShadow = true;
        g.add(crown);
      }
      g.position.copy(W(x, y, 0));
      sc.add(g);
    };
    for (const [x, y, s] of [
      [6.5, 9, 1.1],
      [7.5, -2, 1.3],
      [6, -9, 1],
      [-6, 13, 1.2],
      [5.5, 15, 0.9],
      [-4.5, -16, 1.1],
      [9, 13, 1.2],
    ]) tree(x, y, s);
    // лавочка справа у середины
    const benchMat = new THREE.MeshStandardMaterial({ color: '#b8742e', roughness: 0.8 });
    const legMat = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.4 });
    const bench = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.13), benchMat);
      slat.position.set(0, 0.45, k * 0.15 - 0.15);
      slat.castShadow = true;
      bench.add(slat);
    }
    for (const x of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.4), legMat);
      leg.position.set(x, 0.22, 0);
      bench.add(leg);
    }
    bench.position.copy(W(4.8, -8.5, 0));
    bench.rotation.y = -Math.PI / 2;
    sc.add(bench);
    // старая покрышка и ящик
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 10, 20), new THREE.MeshStandardMaterial({ color: '#1e1e20', roughness: 0.9 }));
    tire.rotation.x = Math.PI / 2;
    tire.position.copy(W(-5, 3, 0.12));
    tire.castShadow = true;
    sc.add(tire);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9 }));
    crate.position.copy(W(3.2, -12.5, 0.2));
    crate.rotation.y = 0.4;
    crate.castShadow = true;
    sc.add(crate);
    // запасные биты у кона
    for (let k = 0; k < 2; k++) {
      const b = this.bat.clone();
      b.rotation.set(0, 0, Math.PI / 2);
      b.rotation.y = 0.3 + k * 0.15;
      b.position.copy(W(-2.2 + k * 0.12, -13.6 - k * 0.2, BR));
      sc.add(b);
    }
    // задник — полукругом за отбойником
    const bd = new THREE.Mesh(
      new THREE.CylinderGeometry(40, 40, 13, 64, 1, true, -Math.PI * 0.45, Math.PI * 0.9),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, color: '#ffffff' })
    );
    bd.position.set(0, 4.6, 8);
    bd.rotation.y = Math.PI;
    sc.add(bd);
    return bd;
  }

  /** Задник: 'garazhi' или 'dvor'. */
  setPlace(id: string) {
    const m = this.backdrop.material as THREE.MeshBasicMaterial;
    const t = this.tex(`/gorodki/${id === 'dvor' ? 'dvor' : 'garazhi'}.webp`);
    if (m.map !== t) {
      t.wrapS = THREE.MirroredRepeatWrapping;
      t.repeat.set(-3, 1);
      t.offset.set(0.5, 0);
      m.map = t;
      m.needsUpdate = true;
    }
  }

  /** Люди: по человечку на место. */
  setSeats(seats: number[]) {
    if (seats.join() === this.seats.join() && this.people.length) return;
    for (const p of this.people) this.scene.remove(p.root);
    this.seats = seats;
    this.people = seats.map((s) => {
      const p = new Person(STYLES[s % STYLES.length], this.bat.clone());
      this.scene.add(p.root);
      return p;
    });
  }

  /** Городки: позы. */
  setRods(rods: (RodPose & { mark?: boolean })[]) {
    while (this.rods.length < rods.length) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(this.rodGeo, this.rodMats);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      this.scene.add(g);
      this.rods.push(g);
    }
    this.rods.forEach((g, i) => {
      const r = rods[i];
      g.visible = !!r;
      if (!r) return;
      const m = g.children[0] as THREE.Mesh;
      m.material = r.mark ? this.markMats : this.rodMats;
      g.position.copy(W(r.x, r.y, r.stand ? r.z + RH : r.z));
      if (r.stand) {
        g.rotation.set(0, 0, 0);
        m.rotation.set(0, 0, 0);
      } else {
        // ось цилиндра — y; положить вдоль угла a, покатить вокруг своей оси
        g.rotation.set(0, r.a, 0);
        m.rotation.set(r.roll, 0, Math.PI / 2);
      }
    });
  }

  /** Бита в полёте (null — в руке у бросающего). */
  setBat(p: RodPose | null) {
    if (!p) {
      this.bat.visible = false;
      return;
    }
    if (!this.bat.parent) this.scene.add(this.bat);
    this.bat.visible = true;
    this.bat.position.copy(W(p.x, p.y, p.z));
    this.bat.rotation.set(0, p.a, 0);
    this.bat.children.forEach(() => {});
    this.bat.rotation.order = 'YXZ';
    this.bat.rotation.set(0, p.a, Math.PI / 2);
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
      const show = a.full || i < n * 0.45;
      d.visible = show;
      d.position.copy(W(x0 + sa * vh * t, y0 + ca * vh * t, 0.02));
      d.rotation.x = -Math.PI / 2;
    });
    this.ring.visible = a.full;
    this.ring.position.copy(W(x0 + sa * vh * tLand, y0 + ca * vh * tLand, 0.015));
  }

  /** Камера: куда смотреть (плавно). */
  camTo(mode: CamMode, focus?: { x: number; y: number }, speed = 3) {
    const t = this.thrower;
    this.camSpeed = speed;
    if (mode === 'aim') {
      this.camGoalPos.copy(W(t.x + 0.85, t.line - 4.3, 1.95));
      this.camGoalLook.copy(W(t.x * 0.35, 0.8, 0.35));
    } else if (mode === 'flight' && focus) {
      this.camGoalPos.copy(W(focus.x * 0.4 + 0.4, focus.y - 3.4, 1.5));
      this.camGoalLook.copy(W(focus.x * 0.6, focus.y + 2, 0.3));
    } else if (mode === 'city') {
      this.camGoalPos.copy(W(0.9, -3.4, 2.7));
      this.camGoalLook.copy(W(0, 0.55, 0));
    } else {
      this.camGoalPos.copy(W(4.5, -9, 5));
      this.camGoalLook.copy(W(0, -3, 0));
    }
  }

  /** Кадр для превью: камера сбоку над пригородом. */
  shotCam() {
    this.camGoalPos.copy(W(1.1, -2.1, 0.62));
    this.camGoalLook.copy(W(-0.15, 0.35, 0.12));
    this.snapCam();
  }

  snapCam() {
    this.camPos.copy(this.camGoalPos);
    this.camLook.copy(this.camGoalLook);
  }

  cheer() {
    this.cheerT = 0;
  }

  /** Расставить людей: бросающий — у черты, остальные — у лавочки. */
  private placePeople() {
    let k = 0;
    this.people.forEach((p, i) => {
      const seat = this.seats[i];
      if (seat === this.thrower.seat) {
        p.root.position.copy(W(this.thrower.x - 0.3, this.thrower.line - 0.35, 0));
        p.root.rotation.y = Math.PI; // лицом к городу
        p.handBat.visible = this.phase == null || this.phase < 0.62;
      } else {
        p.root.position.copy(W(4.2, -9.6 + k * 0.85, 0));
        p.root.rotation.y = Math.PI * 0.62;
        p.handBat.visible = true;
        k++;
      }
    });
  }

  render(dt: number) {
    this.placePeople();
    this.people.forEach((p, i) => {
      const thr = this.seats[i] === this.thrower.seat;
      p.pose(thr ? this.phase : null, dt);
      if (thr && this.cheerT >= 0) p.cheer(Math.min(1, this.cheerT / 1.2));
      else p.root.position.y = 0;
    });
    if (this.cheerT >= 0) {
      this.cheerT += dt;
      if (this.cheerT > 1.2) this.cheerT = -1;
    }
    const k = 1 - Math.exp(-dt * this.camSpeed);
    this.camPos.lerp(this.camGoalPos, k);
    this.camLook.lerp(this.camGoalLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const r = this.renderer;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    // лупа: город крупно, в углу
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
      r.setScissor(x - 3, y - 3, lw + 6, lh + 6);
      r.setViewport(x - 3, y - 3, lw + 6, lh + 6);
      r.setClearColor('#fff8e0', 1);
      r.clear();
      r.setScissor(x, y, lw, lh);
      r.setViewport(x, y, lw, lh);
      r.render(this.scene, this.lupaCam);
      r.setScissorTest(false);
      this.aimGroup.visible = aim;
    }
  }

  /** Прямоугольник лупы в пикселях элемента (для подписи в DOM). */
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
    this.camera.fov = w / h < 1 ? 46 : 32;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const all = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of all) x.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
