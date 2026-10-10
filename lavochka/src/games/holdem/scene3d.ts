/* Холдем — настоящий 3D-стол на three.js (грузится лениво, только в этом виде).
 * Координаты те же, что у плоской сцены (1000×720, центр 500×320): 100 точек = 1 единица, стол лежит в плоскости XZ.
 * Стол, карты и фишки — геометрия three.js: овальное сукно, кожаный борт, деревянная юбка, паркет; карты — тонкие пластинки
 * с картинками наших колод; фишки — стопки по номиналам. Подписи (имена, ставки, банк) — HTML поверх холста по проекции.
 * Перерисовка — только пока что-то движется. */
import * as THREE from 'three';
import type { Card } from '../../cards/deck';
import { cardUrl } from '../../cards/render';
import type { DeckStyle } from '../../core/settings';

export interface Item3D {
  key: string;
  card: Card | null;
  x: number;
  y: number;
  /** Поворот в плоскости стола, градусы. */
  r: number;
  s: number;
  /** Своя карта: приподнять и наклонить к зрителю. */
  lift?: boolean;
}
export interface Chips3D {
  key: string;
  x: number;
  y: number;
  amount: number;
}
export interface Label3D {
  html: string;
  x: number;
  y: number;
  cls: string;
  /** Высота над столом (единицы). */
  h?: number;
  /** Свои CSS-переменные (цвет игрока). */
  style?: string;
}
type Pt = { x: number; y: number };

const CX = 500;
const CY = 320;
const FELT_RX = 4.75;
const FELT_RZ = 2.95;
const RIM_RX = 5.2;
const RIM_RZ = 3.4;
const CARD_W = 1;
const CARD_H = 1.55;
const CARD_T = 0.012;
const CHIP_R = 0.15;
const CHIP_H = 0.045;

const to3 = (x: number, y: number, h = 0) => new THREE.Vector3((x - CX) / 100, h, (y - CY) / 100);

/** Есть ли WebGL на этом устройстве. */
export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function ellipse(rx: number, rz: number, n = 96): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * rz));
  }
  return pts;
}

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

/** Шум поверх заливки — ворс сукна, фактура кожи и дерева. */
function noise(g: CanvasRenderingContext2D, w: number, h: number, amount: number, n = 9000) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * amount})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
}

const feltTex = () =>
  canvasTex(1024, 640, (g) => {
    const gr = g.createRadialGradient(512, 280, 40, 512, 320, 620);
    gr.addColorStop(0, '#2f8650');
    gr.addColorStop(0.6, '#1f6238');
    gr.addColorStop(1, '#154a29');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1024, 640);
    noise(g, 1024, 640, 0.08, 40000);
    // линия для общих карт
    g.strokeStyle = 'rgba(255,230,160,0.22)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(512 - 250, 320 - 120, 500, 150, 60);
    g.stroke();
    g.fillStyle = 'rgba(255,230,160,0.13)';
    g.font = 'italic 34px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('Вечером на лавочке', 512, 470);
  });

const leatherTex = () =>
  canvasTex(512, 512, (g) => {
    g.fillStyle = '#3a1a10';
    g.fillRect(0, 0, 512, 512);
    noise(g, 512, 512, 0.12, 20000);
  });

const woodTex = (base: string, line: string, rep = 1) =>
  canvasTex(
    512,
    512,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = line;
        g.globalAlpha = 0.15 + Math.random() * 0.25;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath();
        const y = Math.random() * 512;
        g.moveTo(0, y);
        for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 6);
        g.stroke();
      }
      g.globalAlpha = 1;
      noise(g, 512, 512, 0.06, 8000);
    },
    rep
  );

const parquetTex = () =>
  canvasTex(
    512,
    512,
    (g) => {
      const tones = ['#5a3a22', '#4e321c', '#634127', '#553620'];
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 4; c++) {
          const horiz = (r + c) % 2 === 0;
          g.fillStyle = tones[(r * 3 + c) % tones.length];
          g.fillRect(c * 128, r * 64, 128, 64);
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          g.strokeRect(c * 128 + 0.5, r * 64 + 0.5, 127, 63);
          g.strokeStyle = 'rgba(255,220,170,0.06)';
          for (let k = 0; k < 6; k++) {
            g.beginPath();
            if (horiz) {
              g.moveTo(c * 128, r * 64 + 8 + k * 9);
              g.lineTo(c * 128 + 128, r * 64 + 10 + k * 9);
            } else {
              g.moveTo(c * 128 + 10 + k * 20, r * 64);
              g.lineTo(c * 128 + 12 + k * 20, r * 64 + 64);
            }
            g.stroke();
          }
        }
      noise(g, 512, 512, 0.05, 6000);
    },
    6
  );

/** Номиналы фишек: цвет и кант. */
const CHIP_KINDS = [
  { v: 500, color: '#6a2a9a', edge: '#f3e6ff' },
  { v: 100, color: '#1b1b1b', edge: '#f1f1f1' },
  { v: 25, color: '#2a8a3e', edge: '#f4fff0' },
  { v: 5, color: '#c0281e', edge: '#fff2ee' },
];

function chipMats(kind: (typeof CHIP_KINDS)[number]): THREE.Material[] {
  const side = canvasTex(256, 32, (g) => {
    g.fillStyle = kind.color;
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = kind.edge;
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 6, 0, 14, 32);
  });
  const top = canvasTex(128, 128, (g) => {
    g.fillStyle = kind.color;
    g.beginPath();
    g.arc(64, 64, 64, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = kind.edge;
    g.lineWidth = 10;
    g.setLineDash([16, 12]);
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(64, 64, 34, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = kind.edge;
    g.font = 'bold 30px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(kind.v), 64, 66);
  });
  const m = (t: THREE.Texture) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.05 });
  return [m(side), m(top), m(top)];
}

interface Moving {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  /** Улетает и пропадает. */
  dying?: number;
}

export class Table3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 100);
  private labels: HTMLElement;
  private cards = new Map<string, Moving>();
  private chips = new Map<string, Moving & { amount: number }>();
  private button: Moving;
  private dying: Moving[] = [];
  private tex = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private cardGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
  private edgeMat = new THREE.MeshStandardMaterial({ color: '#efe8d8', roughness: 0.8 });
  private chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 40);
  private chipMat = new Map<number, THREE.Material[]>();
  private ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private speed = 1;
  private labelData: Label3D[] = [];
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private deck: DeckStyle
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'hd-gl-canvas';
    host.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    this.labels.className = 'hd-gl-labels';
    host.appendChild(this.labels);
    this.build();
    this.button = this.makeButton();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  // ---------------------------------------------------------------- стол

  private build() {
    const sc = this.scene;
    sc.background = new THREE.Color('#120c08');
    sc.fog = new THREE.Fog('#120c08', 14, 30);
    sc.add(new THREE.HemisphereLight('#ffe9c8', '#2a1a10', 0.55));
    // лампа над столом
    const lamp = new THREE.SpotLight('#ffe2b0', 60, 20, 0.85, 0.55, 1.6);
    lamp.position.set(0, 7.5, 0.6);
    lamp.target.position.set(0, 0, 0.3);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.radius = 4;
    sc.add(lamp, lamp.target);
    const fill = new THREE.DirectionalLight('#9fb4ff', 0.25);
    fill.position.set(-6, 5, 8);
    sc.add(fill);

    const flat = (pts: THREE.Vector2[], holes: THREE.Vector2[][] = []) => {
      const shape = new THREE.Shape(pts);
      for (const h of holes) shape.holes.push(new THREE.Path(h));
      return shape;
    };
    // сукно
    const feltGeo = new THREE.ShapeGeometry(flat(ellipse(FELT_RX, FELT_RZ)), 64);
    // UV под текстуру сукна: от -RX..RX, -RZ..RZ
    const uv = feltGeo.attributes.uv as THREE.BufferAttribute;
    const pos = feltGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + FELT_RX) / (2 * FELT_RX), (pos.getY(i) + FELT_RZ) / (2 * FELT_RZ));
    const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: feltTex(), roughness: 0.95 }));
    felt.rotation.x = -Math.PI / 2; // верх текстуры — дальний край стола
    felt.receiveShadow = true;
    sc.add(felt);
    // кожаный борт
    const rimGeo = new THREE.ExtrudeGeometry(flat(ellipse(RIM_RX, RIM_RZ), [ellipse(FELT_RX, FELT_RZ).reverse()]), {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.12,
      bevelSegments: 6,
      curveSegments: 96,
    });
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ map: leatherTex(), roughness: 0.55, color: '#8a4a30' }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.06;
    rim.castShadow = true;
    rim.receiveShadow = true;
    sc.add(rim);
    // деревянная юбка
    const skirtGeo = new THREE.ExtrudeGeometry(flat(ellipse(RIM_RX + 0.05, RIM_RZ + 0.05)), { depth: 0.55, bevelEnabled: false, curveSegments: 96 });
    const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ map: woodTex('#5a2e14', '#2a1206'), roughness: 0.5 }));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.62;
    skirt.receiveShadow = true;
    sc.add(skirt);
    // ножка и пол
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 2.2, 32), new THREE.MeshStandardMaterial({ map: woodTex('#3e1e0c', '#1a0a04'), roughness: 0.6 }));
    leg.position.y = -1.7;
    sc.add(leg);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: parquetTex(), roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.8;
    floor.receiveShadow = true;
    sc.add(floor);
  }

  private makeButton(): Moving {
    const t = canvasTex(128, 128, (g) => {
      g.fillStyle = '#f8f4e8';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#2a1a0a';
      g.font = 'bold 72px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('D', 64, 70);
    });
    const side = new THREE.MeshStandardMaterial({ color: '#e8e0cc', roughness: 0.5 });
    const top = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 40), [side, top, top]);
    m.castShadow = true;
    m.visible = false;
    this.scene.add(m);
    return { obj: m, pos: m.position.clone(), quat: m.quaternion.clone(), scale: 1 };
  }

  // ---------------------------------------------------------------- текстуры

  private texture(c: Card | null): THREE.Texture {
    const url = cardUrl(c, this.deck);
    let t = this.tex.get(url);
    if (!t) {
      t = this.loader.load(url, () => this.kick());
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.tex.set(url, t);
    }
    return t;
  }

  setDeck(deck: DeckStyle) {
    if (deck === this.deck) return;
    this.deck = deck;
    for (const [, m] of this.cards) this.paint(m.obj as THREE.Mesh, (m.obj.userData.card as Card | null) ?? null);
    this.kick();
  }

  private paint(mesh: THREE.Mesh, c: Card | null) {
    mesh.userData.card = c;
    const face = new THREE.MeshStandardMaterial({ map: this.texture(c), roughness: 0.55 });
    const back = new THREE.MeshStandardMaterial({ map: this.texture(null), roughness: 0.55 });
    const old = mesh.material as THREE.Material[];
    if (Array.isArray(old)) for (const m of old) if (m !== this.edgeMat) m.dispose();
    // грани коробки: +x, −x, +y (лицо), −y (рубашка), +z, −z
    mesh.material = [this.edgeMat, this.edgeMat, face, back, this.edgeMat, this.edgeMat];
  }

  private chipMaterial(v: number) {
    let m = this.chipMat.get(v);
    if (!m) {
      m = chipMats(CHIP_KINDS.find((k) => k.v === v)!);
      this.chipMat.set(v, m);
    }
    return m;
  }

  // ---------------------------------------------------------------- раскладка

  private cardTarget(it: Item3D): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const e = new THREE.Euler(0, (-it.r * Math.PI) / 180, 0, 'YXZ');
    let h = 0.02 + CARD_T / 2;
    if (it.lift) {
      // своя карта: приподнята и наклонена к зрителю
      e.x = 0.95;
      h = 0.55;
    }
    return { pos: to3(it.x, it.y, h), quat: new THREE.Quaternion().setFromEuler(e) };
  }

  /** Разложить карты, фишки, баттон и подписи. enter — откуда влетают новые карты, exit — куда улетают исчезнувшие. */
  set(items: Item3D[], chips: Chips3D[], button: Pt | null, labels: Label3D[], speed: number, enter: Pt | null = null, exit: Pt | null = null) {
    this.speed = speed;
    const seen = new Set<string>();
    items.forEach((it, i) => {
      seen.add(it.key);
      const tg = this.cardTarget(it);
      let m = this.cards.get(it.key);
      if (!m) {
        const mesh = new THREE.Mesh(this.cardGeo, []);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.paint(mesh, it.card);
        const from = enter ? to3(enter.x, enter.y, 0.6 + i * 0.01) : tg.pos.clone().add(new THREE.Vector3(0, 0.4, 0));
        mesh.position.copy(from);
        mesh.quaternion.copy(enter ? new THREE.Quaternion() : tg.quat);
        this.scene.add(mesh);
        m = { obj: mesh, pos: tg.pos, quat: tg.quat, scale: it.s };
        mesh.scale.setScalar(it.s * (enter ? 0.8 : 1));
        this.cards.set(it.key, m);
      } else {
        m.pos = tg.pos;
        m.quat = tg.quat;
        m.scale = it.s;
        const now = (m.obj.userData.card as Card | null) ?? null;
        if (JSON.stringify(now) !== JSON.stringify(it.card)) this.paint(m.obj as THREE.Mesh, it.card);
      }
    });
    for (const [k, m] of [...this.cards]) {
      if (seen.has(k)) continue;
      this.cards.delete(k);
      if (exit) {
        m.pos = to3(exit.x, exit.y, 0.3);
        m.dying = 0.5;
        this.dying.push(m);
      } else this.drop(m.obj);
    }
    // фишки
    const cseen = new Set<string>();
    for (const c of chips) {
      cseen.add(c.key);
      let m = this.chips.get(c.key);
      const target = to3(c.x, c.y, 0);
      if (!m) {
        const g = new THREE.Group();
        g.position.copy(target);
        this.scene.add(g);
        m = { obj: g, pos: target, quat: new THREE.Quaternion(), scale: 1, amount: -1 };
        this.chips.set(c.key, m);
      }
      m.pos = target;
      if (m.amount !== c.amount) {
        m.amount = c.amount;
        this.stack(m.obj as THREE.Group, c.amount);
      }
    }
    for (const [k, m] of [...this.chips]) {
      if (cseen.has(k)) continue;
      this.chips.delete(k);
      // ставки уходят в банк
      m.pos = to3(CX, CY + 70, 0);
      m.dying = 0.45;
      this.dying.push(m);
    }
    // баттон
    this.button.obj.visible = !!button;
    if (button) {
      this.button.pos = to3(button.x, button.y, 0.035);
      if (!this.button.obj.userData.placed) {
        this.button.obj.position.copy(this.button.pos);
        this.button.obj.userData.placed = true;
      }
    }
    this.labelData = labels;
    this.drawLabels();
    this.kick();
  }

  /** Стопка фишек по номиналам (не больше 12 штук). */
  private stack(g: THREE.Group, amount: number) {
    for (const ch of [...g.children]) g.remove(ch);
    let left = amount;
    let n = 0;
    const cols: THREE.Mesh[][] = [];
    for (const k of CHIP_KINDS) {
      const cnt = Math.min(5, Math.floor(left / k.v));
      left -= cnt * k.v;
      if (!cnt) continue;
      const col: THREE.Mesh[] = [];
      for (let i = 0; i < cnt && n < 12; i++, n++) {
        const m = new THREE.Mesh(this.chipGeo, this.chipMaterial(k.v));
        m.castShadow = true;
        m.receiveShadow = true;
        col.push(m);
      }
      cols.push(col);
    }
    if (!cols.length) cols.push([new THREE.Mesh(this.chipGeo, this.chipMaterial(5))]);
    cols.forEach((col, ci) => {
      const ox = (ci - (cols.length - 1) / 2) * CHIP_R * 2.15;
      col.forEach((m, i) => {
        m.position.set(ox + (Math.random() - 0.5) * 0.015, CHIP_H / 2 + i * CHIP_H, (Math.random() - 0.5) * 0.015);
        m.rotation.y = Math.random() * Math.PI;
        g.add(m);
      });
    });
  }

  private drop(o: THREE.Object3D) {
    this.scene.remove(o);
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m !== this.edgeMat && !this.isShared(m)) m.dispose();
    }
  }

  private isShared(m: THREE.Material) {
    for (const arr of this.chipMat.values()) if (arr.includes(m)) return true;
    return false;
  }

  // ---------------------------------------------------------------- кадр

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const a = w / h;
    this.camera.aspect = a;
    // стол целиком (с табличками за бортом): камера отъезжает, пока ширина не влезет в горизонтальный угол обзора
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    const dist = Math.max(10.6, 5.9 / (half * a) + 1.5);
    // на узком экране смотрим круче сверху — стол выше и меньше пустоты над и под ним
    const steep = Math.min(1, Math.max(0, (1.4 - a) / 0.6));
    this.camera.position.set(0, 7.4 + 5 * steep, 7.6 - 2.5 * steep).normalize().multiplyScalar(dist);
    this.camera.lookAt(0, -0.3, 0.55);
    this.camera.updateProjectionMatrix();
    this.drawLabels();
    this.kick();
  }

  private drawLabels() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.camera.updateMatrixWorld();
    let s = '';
    for (const l of this.labelData) {
      const p = to3(l.x, l.y, l.h ?? 0.15).project(this.camera);
      const x = ((p.x + 1) / 2) * w;
      const y = ((1 - p.y) / 2) * h;
      s += `<div class="${l.cls}" style="${l.style ? l.style + ';' : ''}left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${l.html}</div>`;
    }
    this.labels.innerHTML = s;
  }

  private kick() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number) {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const k = 1 - Math.exp(-dt * 11 * this.speed);
    let moving = false;
    const step = (m: Moving) => {
      const o = m.obj;
      if (o.position.distanceToSquared(m.pos) > 1e-6 || o.quaternion.angleTo(m.quat) > 1e-3 || Math.abs(o.scale.x - m.scale) > 1e-3) {
        // по пути карта чуть подлетает над столом
        const d = o.position.distanceTo(m.pos);
        o.position.lerp(m.pos, k);
        if (d > 0.3) o.position.y = Math.max(o.position.y, m.pos.y + Math.min(0.5, d * 0.15));
        o.quaternion.slerp(m.quat, k);
        o.scale.setScalar(o.scale.x + (m.scale - o.scale.x) * k);
        moving = true;
      }
    };
    for (const m of this.cards.values()) step(m);
    for (const m of this.chips.values()) step(m);
    step(this.button);
    for (const m of [...this.dying]) {
      step(m);
      m.dying! -= dt * this.speed;
      moving = true;
      if (m.dying! <= 0) {
        this.dying.splice(this.dying.indexOf(m), 1);
        this.drop(m.obj);
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (moving) this.kick();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
    for (const t of this.tex.values()) t.dispose();
    this.host.innerHTML = '';
  }
}
