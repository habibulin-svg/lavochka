/* Холдем — настоящий 3D-стол на three.js (грузится лениво, только в этом виде).
 * Координаты раскладки те же, что у плоской сцены (1000×720, центр 500×320): 100 точек = 1 единица (≈25 см), стол — плоскость y = 0.
 * Стол: сукно с печатью, лакированный деревянный кант, кожаный валик со строчкой, юбка; вокруг — комната 90-х (room3d.ts)
 * и стулья с соперниками (people3d.ts). Карты — пластинки со скруглёнными углами и картинками наших колод; фишки — стопки
 * по номиналам; баттон дилера. Подписи — HTML поверх холста по проекции.
 * Камера: «за столом» (как сидишь на своём месте: соперники напротив, свои карты крупно в углу) или «сверху».
 * Пока кто-то дышит за столом — рисуем ~30 кадров в секунду, пока что-то летит — каждый кадр. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { HDRI, normalOnly, onTextureLoad, pbr } from './pbr';
import type { Card } from '../../cards/deck';
import { cardUrl } from '../../cards/render';
import type { DeckStyle } from '../../core/settings';
import { bolsterProfile, cardGeometry, sweepEllipse } from './geo3d';
import { buildRoom, makeChair, onRoomLoad, FLOOR } from './room3d';
import { buttonTex, CHIP_KINDS, chipSideTex, chipTopTex, feltTexture } from './tex3d';
import { LOADING } from './loading';
import { DEALER, type DealerAct, type People, type Gesture } from './people3d';

export interface Item3D {
  key: string;
  card: Card | null;
  x: number;
  y: number;
  /** Поворот в плоскости стола, градусы. */
  r: number;
  s: number;
}
export interface Chips3D {
  key: string;
  x: number;
  y: number;
  amount: number;
  /** Стопка игрока (его фишки) — столбиками в ряд; иначе ставка/банк — кучкой. */
  bank?: boolean;
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
  /** Табличка игрока: в виде «за столом» висит над его головой, своя — внизу экрана. */
  seat?: number;
}
export interface Seat3D {
  seat: number;
  /** Место игрока на раскладке (точки сцены 1000×720). */
  x: number;
  y: number;
  me: boolean;
  out: boolean;
}
export type CamMode = 'seat' | 'top';
type Pt = { x: number; y: number };

/** Угол обзора камеры (вид сверху и вид «за столом» без видео-людей). */
const FOV = 47;
const CX = 500;
const CY = 320;
const FELT_RX = 4.75;
const FELT_RZ = 2.95;
/** Ширина деревянного канта между сукном и кожей. */
const RACE = 0.32;
const RAIL_W = 0.78;
const RAIL_H = 0.34;
export const RIM_RX = FELT_RX + RACE + RAIL_W;
export const RIM_RZ = FELT_RZ + RACE + RAIL_W;
const CARD_W = 1;
const CARD_H = 1.55;
const CARD_T = 0.014;
const CHIP_R = 0.2;
const CHIP_H = 0.055;

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

function ellipse(rx: number, rz: number, n = 128): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * rz));
  }
  return pts;
}

/** Точка на эллипсе по параметру и нормаль наружу. */
/** Кривизна валика (его середины) в точке a эллипса: 1/(2R), R — радиус кривизны. */
function railCurve(a: number): number {
  const rx = RIM_RX - RAIL_W / 2;
  const rz = RIM_RZ - RAIL_W / 2;
  const R = Math.pow(rx * rx * Math.sin(a) ** 2 + rz * rz * Math.cos(a) ** 2, 1.5) / (rx * rz);
  return 1 / (2 * R);
}

function onEllipse(rx: number, rz: number, a: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const n = new THREE.Vector3(Math.cos(a) * rz, 0, Math.sin(a) * rx).normalize();
  return { p: new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz), n };
}

interface Moving {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  /** Улетает и пропадает. */
  dying?: number;
}

interface SeatPlace {
  seat: number;
  /** Параметр на эллипсе стола. */
  a: number;
  me: boolean;
  out: boolean;
  chair: THREE.Group;
  /** Где сидит (на полу под стулом), куда смотрит. */
  pos: THREE.Vector3;
  face: number;
}

export class Table3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(47, 1.4, 0.1, 80);
  private labels: HTMLElement;
  private hand: HTMLElement;
  private cards = new Map<string, Moving>();
  private chips = new Map<string, Moving & { amount: number; bank: boolean }>();
  private button: Moving;
  private dying: Moving[] = [];
  private tex = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private cardGeo = cardGeometry(CARD_W, CARD_H, CARD_T, 0.07);
  private edgeMat = new THREE.MeshStandardMaterial({ color: '#f3eee2', roughness: 0.7 });
  private chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 48);
  private chipMat = new Map<number, THREE.Material[]>();
  private ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private speed = 1;
  private labelData: Label3D[] = [];
  private disposed = false;
  private mode: CamMode = 'seat';
  private places = new Map<number, SeatPlace>();
  private focus: number | null = null;
  /** Камера плавно едет к цели. */
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camGoal = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private camInit = false;
  private fovGoal = FOV;
  private people: People | null = null;
  private peopleLoading = false;
  /** Люди-видео смотрят только в камеру: себя (со спины) в виде сверху не показываем. */
  private videoPeople = false;
  private handKey = '';
  private loading: HTMLElement;
  private loadStart = 0;
  private loadShown = 0;
  /** Общие карты и банк — полоской внизу (в виде «за столом» середины стола в кадре обычно нет). */
  private board: HTMLElement;
  private boardKey = '';
  /** Вид «за столом» как в Apple poker: в кадре один соперник, камера плавно перелетает к тому, чей ход. */
  private shot: number | null = null;
  /** Крупье в кадре до этого момента (performance.now). */
  private dealerUntil = 0;
  /** Крупье стоит посередине дальнего края (там у игроков оставлено место). */
  private dealerPlace = (() => {
    const e = onEllipse(RIM_RX + 1.25, RIM_RZ + 1.25, -Math.PI / 2);
    return { pos: e.p, face: Math.atan2(-e.n.x, -e.n.z) };
  })();
  /** Абажур: сверху он закрывает стол — в этом виде его нет. */
  private shade: THREE.Object3D | null = null;

  constructor(
    private readonly host: HTMLElement,
    private deck: DeckStyle
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'hd-gl-canvas';
    host.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    this.labels.className = 'hd-gl-labels';
    host.appendChild(this.labels);
    // заставка, пока грузятся люди (ролики) — иначе первые секунды за столом пусто
    // (её ставит вид ещё до загрузки сцены — берём ту же, чтобы не мигала)
    let ld = host.querySelector<HTMLElement>('.hd-loading');
    if (!ld) {
      host.insertAdjacentHTML('beforeend', LOADING);
      ld = host.querySelector<HTMLElement>('.hd-loading')!;
    }
    host.appendChild(ld);
    this.loading = ld;
    this.loadStart = performance.now();
    this.hand = document.createElement('div');
    this.hand.className = 'hd-hand';
    host.appendChild(this.hand);
    this.board = document.createElement('div');
    this.board.className = 'hd-board';
    host.appendChild(this.board);
    this.build();
    this.button = this.makeButton();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loadPeople();
  }

  // ---------------------------------------------------------------- стол

  private build() {
    const sc = this.scene;
    sc.background = new THREE.Color('#1a120c');
    onTextureLoad(() => this.kick());
    onRoomLoad(() => this.kick());
    // отражения на лаке, фишках и картах: сначала простая комната, потом — снимок настоящего интерьера (HDRI)
    const pm = new THREE.PMREMGenerator(this.renderer);
    sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    sc.environmentIntensity = 0.25;
    new RGBELoader().load(HDRI, (hdr) => {
      if (this.disposed) return;
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = pm.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pm.dispose();
      sc.environment = env;
      sc.environmentIntensity = 0.35;
      this.kick();
    });
    sc.add(new THREE.HemisphereLight('#ffe2b8', '#2a1a10', 0.12));
    const room = buildRoom();
    sc.add(room.group);
    this.shade = room.shade;

    // сукно
    const flat = (pts: THREE.Vector2[]) => new THREE.Shape(pts);
    const feltGeo = new THREE.ShapeGeometry(flat(ellipse(FELT_RX + 0.02, FELT_RZ + 0.02)), 64);
    const uv = feltGeo.attributes.uv as THREE.BufferAttribute;
    const pos = feltGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + FELT_RX) / (2 * FELT_RX), (pos.getY(i) + FELT_RZ) / (2 * FELT_RZ));
    const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: feltTexture(), normalMap: normalOnly('fabric', [18, 11]), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97, metalness: 0 }));
    felt.rotation.x = -Math.PI / 2; // верх текстуры — дальний край стола
    felt.receiveShadow = true;
    // стол отбрасывает тень целиком — иначе тени фишек «проходят» сквозь сукно на пол
    felt.castShadow = true;
    sc.add(felt);
    // деревянный лакированный кант
    const race = new THREE.Mesh(
      sweepEllipse(
        FELT_RX,
        FELT_RZ,
        [
          [0, -0.01],
          [0.02, 0.025],
          [RACE * 0.5, 0.04],
          [RACE, 0.03],
        ],
        14
      ),
      new THREE.MeshPhysicalMaterial({ ...pbr('walnut', [16, 0.25]), color: '#c08060', roughness: 0.6, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide })
    );
    race.receiveShadow = true;
    race.castShadow = true;
    sc.add(race);
    // кожаный валик
    const rail = new THREE.Mesh(
      sweepEllipse(FELT_RX, FELT_RZ, bolsterProfile(RACE - 0.01, RAIL_W, RAIL_H, 0.02), 24),
      new THREE.MeshPhysicalMaterial({ ...pbr('leather', [30, 1]), color: '#7a5048', roughness: 0.85, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.25, sheenColor: new THREE.Color('#8a5a40'), side: THREE.DoubleSide })
    );
    rail.castShadow = true;
    rail.receiveShadow = true;
    sc.add(rail);
    // юбка стола
    const skirt = new THREE.Mesh(
      sweepEllipse(
        RIM_RX - 0.02,
        RIM_RZ - 0.02,
        [
          [-0.05, -0.22],
          [0, -0.28],
          [0, -0.8],
          [-0.15, -0.95],
          [-1.2, -0.98],
        ],
        30
      ),
      new THREE.MeshPhysicalMaterial({ ...pbr('walnut', [14, 0.6]), color: '#9a6048', roughness: 0.7, clearcoat: 0.7, clearcoatRoughness: 0.12, side: THREE.DoubleSide })
    );
    skirt.receiveShadow = true;
    skirt.castShadow = true;
    sc.add(skirt);
    // ножки-тумбы
    const legM = new THREE.MeshPhysicalMaterial({ ...pbr('walnut', [2, 1]), color: '#7a4a38', roughness: 0.7, clearcoat: 0.6, clearcoatRoughness: 0.15 });
    for (const x of [-2.6, 2.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, -FLOOR - 1, 24), legM);
      leg.position.set(x, (FLOOR - 1) / 2, 0);
      leg.castShadow = true;
      sc.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.25, 32), legM);
      foot.position.set(x, FLOOR + 0.12, 0);
      foot.receiveShadow = true;
      sc.add(foot);
    }
  }

  private makeButton(): Moving {
    const t = buttonTex();
    const side = new THREE.MeshPhysicalMaterial({ color: '#efe8d4', roughness: 0.35, clearcoat: 0.6 });
    const top = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, clearcoat: 0.6 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 48), [side, top, top]);
    m.castShadow = true;
    m.visible = false;
    this.scene.add(m);
    return { obj: m, pos: m.position.clone(), quat: m.quaternion.clone(), scale: 1 };
  }

  // ---------------------------------------------------------------- люди

  private loadPeople() {
    if (this.peopleLoading) return;
    this.peopleLoading = true;
    // люди-видео (как в Apple poker); не играет видео — 3D-модели
    import('./video3d')
      .then((m) => m.loadVideoPeople())
      .catch((e) => {
        console.warn('холдем: видео-персонажи', e);
        return null;
      })
      .then((p) => p ?? import('./people3d').then((m) => m.loadPeople()))
      .then((p) => {
        if (this.disposed || !p) return;
        this.people = p;
        this.videoPeople = p.kind === 'video';
        // камера «как в Apple poker» — только с видео-людьми: встаём сразу
        this.camInit = false;
        this.aimCamera();
        this.scene.add(p.group);
        this.syncPeople();
        this.kick();
      })
      .catch((e) => console.warn('холдем: персонажи не загрузились', e));
  }

  private syncPeople() {
    if (!this.people) return;
    const list = [...this.places.values()].map((p) => ({ seat: p.seat, pos: p.pos, face: p.face, hidden: p.me && (this.mode === 'seat' || this.videoPeople), out: p.out, curve: railCurve(p.a) }));
    if (this.videoPeople && this.places.size) list.push({ seat: DEALER, ...this.dealerPlace, hidden: false, out: false, curve: railCurve(-Math.PI / 2) });
    this.people.sync(list, this.lookTarget());
  }

  /** Крупье что-то делает — камера на неё на hold секунд. */
  dealer(act: DealerAct, hold = 2.6) {
    if (!this.people?.dealer) return;
    this.people.dealer(act);
    this.dealerUntil = performance.now() + (hold * 1000) / Math.max(0.5, this.speed);
    this.aimCamera();
    this.kick();
  }

  /** Куда смотрят сидящие: на того, чей ход, иначе — на середину стола. */
  private lookTarget(): THREE.Vector3 {
    const p = this.focus != null ? this.places.get(this.focus) : null;
    return p ? p.pos.clone().setY(2.2) : new THREE.Vector3(0, 0, 0);
  }

  // ---------------------------------------------------------------- места

  /** Расставить стулья по местам игроков. */
  setSeats(list: Seat3D[]) {
    const seen = new Set<number>();
    for (const s of list) {
      seen.add(s.seat);
      // параметр на эллипсе раскладки (410×250 вокруг центра)
      const a = Math.atan2((s.y - CY) / 250, (s.x - CX) / 410);
      let p = this.places.get(s.seat);
      if (!p) {
        const chair = makeChair();
        this.scene.add(chair);
        p = { seat: s.seat, a, me: s.me, out: s.out, chair, pos: new THREE.Vector3(), face: 0 };
        this.places.set(s.seat, p);
      }
      p.a = a;
      p.me = s.me;
      p.out = s.out;
      const e = onEllipse(RIM_RX + 1.25, RIM_RZ + 1.25, a);
      p.pos.copy(e.p);
      p.face = Math.atan2(-e.n.x, -e.n.z);
      p.chair.position.copy(e.p).setY(0);
      // спинка стула (+z стула) — от стола
      p.chair.rotation.y = p.face + Math.PI;
      // своего стула в виде «за столом» не видно — камера на нём
      p.chair.visible = !(p.me && this.mode === 'seat');
    }
    for (const [k, p] of [...this.places])
      if (!seen.has(k)) {
        this.scene.remove(p.chair);
        this.places.delete(k);
      }
    this.syncPeople();
    this.aimCamera();
    this.kick();
  }

  setFocus(seat: number | null) {
    if (seat === this.focus) return;
    this.focus = seat;
    // наш ход — крупье приглашает жестом (в кадре — она)
    if (seat != null && this.places.get(seat)?.me && this.mode === 'seat') this.people?.dealer?.('point_front');
    else if (seat != null) this.dealerUntil = 0;
    this.people?.lookAt(this.lookTarget(), seat);
    this.aimCamera();
    this.kick();
  }

  /** Жест игрока (ставка, пас, чек...). */
  gesture(seat: number, kind: Gesture, delay = 0) {
    this.people?.gesture(seat, kind, delay);
    this.kick();
  }

  setMode(m: CamMode) {
    if (m === this.mode) return;
    this.mode = m;
    for (const p of this.places.values()) p.chair.visible = !(p.me && m === 'seat');
    this.syncPeople();
    this.camInit = false;
    this.aimCamera();
    this.drawHand();
    this.kick();
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
    this.handKey = '';
    this.kick();
  }

  private paint(mesh: THREE.Mesh, c: Card | null) {
    mesh.userData.card = c;
    const mk = (t: THREE.Texture) => new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, alphaTest: 0.5 });
    const old = mesh.material as THREE.Material[];
    if (Array.isArray(old)) for (const m of old) if (m !== this.edgeMat) m.dispose();
    mesh.material = [mk(this.texture(c)), mk(this.texture(null)), this.edgeMat];
  }

  private chipMaterial(v: number) {
    let m = this.chipMat.get(v);
    if (!m) {
      const k = CHIP_KINDS.find((x) => x.v === v)!;
      const mat = (t: THREE.Texture) => new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
      const top = mat(chipTopTex(k));
      m = [mat(chipSideTex(k)), top, top];
      this.chipMat.set(v, m);
    }
    return m;
  }

  // ---------------------------------------------------------------- свои карты в углу

  /** Свои карты крупно в правом нижнем углу (вид «за столом»). null — нет карт. */
  setHand(cards: (Card | null)[] | null) {
    const key = cards ? cards.map((c) => (c ? c.s + c.r : 'x')).join(',') + '|' + this.deck : '';
    if (key === this.handKey) return;
    const fresh = !this.handKey || !cards;
    this.handKey = key;
    if (!cards) {
      this.hand.innerHTML = '';
      return;
    }
    const imgs = cards.map((c, i) => `<img class="hd-hcard${fresh ? ' deal' : ''}" style="--i:${i}" src="${cardUrl(c, this.deck)}" alt="" draggable="false">`).join('');
    this.hand.innerHTML = `<div class="hd-hand-in">${imgs}</div>`;
    this.drawHand();
  }

  private drawHand() {
    this.hand.hidden = this.mode !== 'seat';
    this.board.hidden = this.mode !== 'seat' || !this.boardKey;
  }

  /** Общие карты и банк внизу экрана (вид «за столом»). */
  setBoard(cards: Card[], pot: number) {
    const key = cards.length || pot ? cards.map((c) => c.s + c.r).join(',') + '|' + pot + '|' + this.deck : '';
    if (key === this.boardKey) return;
    const had = this.boardKey.split('|')[0].split(',').filter(Boolean).length;
    this.boardKey = key;
    this.board.innerHTML = key
      ? `<div class="hd-board-cards">${cards.map((c, i) => `<img class="hd-bcard${i >= had ? ' deal' : ''}" style="--i:${i - had}" src="${cardUrl(c, this.deck)}" alt="" draggable="false">`).join('')}</div>` +
        (pot ? `<div class="hd-board-pot">банк ${pot}</div>` : '')
      : '';
    this.drawHand();
  }

  // ---------------------------------------------------------------- раскладка

  private cardTarget(it: Item3D): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const e = new THREE.Euler(0, (-it.r * Math.PI) / 180, 0, 'YXZ');
    return { pos: to3(it.x, it.y, 0.02 + CARD_T / 2), quat: new THREE.Quaternion().setFromEuler(e) };
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
        // влетает рубашкой вверх и переворачивается на лету
        mesh.quaternion.copy(enter && it.card ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)) : tg.quat);
        this.scene.add(mesh);
        m = { obj: mesh, pos: tg.pos, quat: tg.quat, scale: it.s };
        mesh.scale.setScalar(it.s * (enter ? 0.85 : 1));
        this.cards.set(it.key, m);
      } else {
        m.pos = tg.pos;
        m.quat = tg.quat;
        m.scale = it.s;
        const now = (m.obj.userData.card as Card | null) ?? null;
        if (JSON.stringify(now) !== JSON.stringify(it.card)) {
          // вскрытие: переворот через ребро
          if (!now && it.card) m.obj.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI * 0.999)));
          this.paint(m.obj as THREE.Mesh, it.card);
        }
      }
    });
    for (const [k, m] of [...this.cards]) {
      if (seen.has(k)) continue;
      this.cards.delete(k);
      if (exit) {
        m.pos = to3(exit.x, exit.y, 0.3);
        m.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI));
        m.dying = 0.5;
        this.dying.push(m);
      } else this.drop(m.obj);
    }
    // фишки
    const cseen = new Set<string>();
    for (const c of chips) {
      cseen.add(c.key);
      let m = this.chips.get(c.key);
      const target = to3(c.x, c.y, 0.02);
      if (!m) {
        const g = new THREE.Group();
        g.position.copy(target);
        this.scene.add(g);
        m = { obj: g, pos: target, quat: new THREE.Quaternion(), scale: 1, amount: -1, bank: !!c.bank };
        this.chips.set(c.key, m);
      }
      m.pos = target;
      if (m.amount !== c.amount) {
        m.amount = c.amount;
        this.stack(m.obj as THREE.Group, c.amount, !!c.bank, c.key);
      }
    }
    for (const [k, m] of [...this.chips]) {
      if (cseen.has(k)) continue;
      this.chips.delete(k);
      // ставки уходят в банк
      m.pos = to3(CX, CY + 125, 0.02);
      m.dying = 0.45;
      this.dying.push(m);
    }
    // баттон
    this.button.obj.visible = !!button;
    if (button) {
      this.button.pos = to3(button.x, button.y, 0.065);
      if (!this.button.obj.userData.placed) {
        this.button.obj.position.copy(this.button.pos);
        this.button.obj.userData.placed = true;
      }
    }
    this.labelData = labels;
    this.drawLabels();
    this.kick();
  }

  /** Фишки по номиналам. Стопка игрока — ровные столбики в ряд; ставка и банк — кучкой из столбиков. */
  private stack(g: THREE.Group, amount: number, bank: boolean, key: string) {
    for (const ch of [...g.children]) g.remove(ch);
    let left = amount;
    const cols: number[][] = [];
    const per = bank ? 10 : 8;
    const maxCols = bank ? 6 : 7;
    for (const k of CHIP_KINDS) {
      let cnt = Math.floor(left / k.v);
      // слишком много мелких — пусть лучше будет меньше фишек
      cnt = Math.min(cnt, per * 2);
      left -= cnt * k.v;
      while (cnt > 0 && cols.length < maxCols) {
        const n = Math.min(per, cnt);
        cols.push(Array(n).fill(k.v));
        cnt -= n;
      }
    }
    if (!cols.length && amount > 0) cols.push([1]);
    // детерминированный разброс по ключу — чтобы стопка не прыгала при каждой перерисовке
    let seed = 0;
    for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    const spots: [number, number][] = bank
      ? cols.map((_, i) => [(i - (cols.length - 1) / 2) * CHIP_R * 2.1, 0])
      : [
          [0, 0],
          [CHIP_R * 2.05, 0],
          [-CHIP_R * 2.05, 0],
          [CHIP_R * 1.02, -CHIP_R * 1.8],
          [-CHIP_R * 1.02, -CHIP_R * 1.8],
          [CHIP_R * 1.02, CHIP_R * 1.8],
          [-CHIP_R * 1.02, CHIP_R * 1.8],
        ];
    cols.forEach((col, ci) => {
      const [ox, oz] = spots[ci % spots.length];
      col.forEach((v, i) => {
        const m = new THREE.Mesh(this.chipGeo, this.chipMaterial(v));
        m.castShadow = true;
        m.receiveShadow = true;
        const j = bank ? 0.006 : 0.02;
        m.position.set(ox + (rnd() - 0.5) * j, CHIP_H / 2 + i * CHIP_H, oz + (rnd() - 0.5) * j);
        m.rotation.y = rnd() * Math.PI * 2;
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

  // ---------------------------------------------------------------- камера

  private aimCamera() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const a = w / h;
    const half = Math.tan((FOV * Math.PI) / 360);
    // абажур закрывает стол сверху и на узком экране (камера там выше)
    if (this.shade) this.shade.visible = this.mode === 'seat' && a > 0.9;
    this.fovGoal = FOV;
    const shot = this.mode === 'seat' ? this.pickShot() : null;
    if (shot) {
      // соперник крупно: камера на уровне глаз, недалеко за серединой стола (так перелёт не задевает сидящих у борта),
      // а крупность — зумом; валик закрывает соперникам пояс
      const fwd = new THREE.Vector3(Math.sin(shot.face), 0, Math.cos(shot.face));
      const base = shot.pos.clone().addScaledVector(fwd, 1.94).setY(0);
      const D = Math.max(5.6, base.length() + 2.4);
      // по высоте — от сукна до макушки с запасом; узкий экран — ещё и по ширине (локти могут чуть выйти за край)
      const H = Math.max(6.4, 4.6 / Math.max(a, 0.1));
      this.fovGoal = THREE.MathUtils.clamp((2 * Math.atan(H / 2 / D) * 180) / Math.PI, 30, 75);
      this.camGoal.look.copy(base).setY(1.45);
      this.camGoal.pos.copy(base).addScaledVector(fwd, D).setY(2.75);
    } else if (this.mode === 'seat') {
      // узкий экран — смотрим круче, чтобы стол был виден целиком хотя бы по глубине
      const narrow = Math.min(1, Math.max(0, (1.5 - a) / 0.9));
      const pitch = THREE.MathUtils.degToRad(25 + 18 * narrow);
      // по ширине должен влезть стол с соперниками (±W), но не дальше разумного
      const W = 7.2;
      const dist = THREE.MathUtils.clamp(W / (half * a), 8.4, 15.5);
      // чуть поворачиваемся к тому, чей ход
      let yaw = 0;
      const f = this.focus != null ? this.places.get(this.focus) : null;
      if (f && !f.me) yaw = THREE.MathUtils.clamp(-f.pos.x * 0.018, -0.12, 0.12);
      const look = new THREE.Vector3(0, 0.6, -1.3 + narrow * 0.9);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this.camGoal.look.copy(look);
      this.camGoal.pos.copy(look).addScaledVector(dir, dist);
    } else {
      const pitch = THREE.MathUtils.degToRad(68);
      const W = 7.6;
      const D = 6.4;
      const dist = Math.max(W / (half * a), D / half) + 2;
      const look = new THREE.Vector3(0, 0, 0.3);
      this.camGoal.look.copy(look);
      this.camGoal.pos.copy(look).add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(dist));
    }
    if (!this.camInit) {
      this.camInit = true;
      this.camera.fov = this.fovGoal;
      this.camera.updateProjectionMatrix();
      this.camPos.copy(this.camGoal.pos);
      this.camLook.copy(this.camGoal.look);
      this.applyCamera();
    }
  }

  /** Кого снимать: того, чей ход; на своём ходу и между раздачами — кого снимали; сначала — того, кто напротив. */
  private pickShot(): { pos: THREE.Vector3; face: number } | null {
    const f = this.focus != null ? this.places.get(this.focus) : null;
    if (this.videoPeople && (performance.now() < this.dealerUntil || f?.me)) return this.dealerPlace;
    if (f && !f.me) this.shot = f.seat;
    let p = this.shot != null ? this.places.get(this.shot) : undefined;
    if (!p || p.me) {
      const me = [...this.places.values()].find((x) => x.me);
      const others = [...this.places.values()].filter((x) => !x.me);
      if (me) others.sort((x, y) => y.pos.distanceToSquared(me.pos) - x.pos.distanceToSquared(me.pos));
      p = others[0];
      this.shot = p?.seat ?? null;
    }
    return p ?? null;
  }

  private applyCamera() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.host.style.setProperty('--hand', `${Math.round(Math.min(h * 0.34, w * 0.2))}px`);
    this.camInit = false;
    this.aimCamera();
    this.drawLabels();
    this.kick();
  }

  // ---------------------------------------------------------------- подписи

  private headPos(seat: number): THREE.Vector3 | null {
    const p = this.places.get(seat);
    if (!p) return null;
    const hp = this.people?.head(seat);
    return hp ? hp.clone().setY(hp.y + 1.25) : p.pos.clone().setY(4.6);
  }

  private drawLabels() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.camera.updateMatrixWorld();
    let s = '';
    for (const l of this.labelData) {
      let v: THREE.Vector3;
      let cls = l.cls;
      if (l.seat != null) {
        const p = this.places.get(l.seat);
        if (this.mode === 'seat' && p?.me) {
          s += `<div class="${cls} hd-me" style="${l.style ?? ''}">${l.html}</div>`;
          continue;
        }
        if (this.mode === 'seat') {
          v = this.headPos(l.seat) ?? to3(l.x, l.y, 0.4);
          cls += ' hd-over';
        } else if (p) {
          const e = onEllipse(RIM_RX - RAIL_W / 2, RIM_RZ - RAIL_W / 2, p.a);
          v = e.p.setY(RAIL_H + 0.1);
        } else v = to3(l.x, l.y, 0.4);
      } else v = to3(l.x, l.y, l.h ?? 0.15);
      const pr = v.project(this.camera);
      if (pr.z > 1) continue;
      // за столом: что не в кадре — не показываем (банк — в полоске внизу)
      if (this.mode === 'seat' && (Math.abs(pr.x) > 1.02 || Math.abs(pr.y) > 1.02 || cls.includes('hd-pot'))) continue;
      const x = THREE.MathUtils.clamp(((pr.x + 1) / 2) * w, 40, w - 40);
      const y = THREE.MathUtils.clamp(((1 - pr.y) / 2) * h, 14, h - 14);
      s += `<div class="${cls}" style="${l.style ? l.style + ';' : ''}left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${l.html}</div>`;
    }
    this.labels.innerHTML = s;
  }

  // ---------------------------------------------------------------- кадр

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
        // по пути карта и фишки чуть подлетают над столом
        const d = o.position.distanceTo(m.pos);
        o.position.lerp(m.pos, k);
        if (d > 0.3) o.position.y = Math.max(o.position.y, m.pos.y + Math.min(0.6, d * 0.18));
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
    // камера
    const kc = 1 - Math.exp(-dt * 3.5);
    if (this.camPos.distanceToSquared(this.camGoal.pos) > 1e-5 || Math.abs(this.camera.fov - this.fovGoal) > 0.02 || this.camLook.distanceToSquared(this.camGoal.look) > 1e-5) {
      this.camPos.lerp(this.camGoal.pos, kc);
      this.camLook.lerp(this.camGoal.look, kc);
      this.camera.fov += (this.fovGoal - this.camera.fov) * kc;
      this.camera.updateProjectionMatrix();
      this.applyCamera();
      moving = true;
    }
    // крупье своё отыграла — камера обратно к игроку
    if (this.dealerUntil && performance.now() >= this.dealerUntil) {
      this.dealerUntil = 0;
      this.aimCamera();
    }
    const alive = this.people?.update(dt, this.camera.position) ?? false;
    const waiting = this.updateLoading();
    // живые люди — 30 кадров в секунду, полёт карт — каждый кадр
    if (moving || t - this.lastDraw > 31) {
      this.lastDraw = t;
      this.renderer.render(this.scene, this.camera);
      this.drawLabels();
    }
    if (moving || alive || waiting) this.kick();
  }

  /** Заставка: полоска — готовность людей; ушла — когда все сидят (или через 25 с, что бы ни случилось). true — ещё ждём. */
  private updateLoading(): boolean {
    if (this.loading.hidden) return false;
    const p = this.people;
    let k = p ? (p.ready?.() ?? 1) : 0;
    if (performance.now() - this.loadStart > 25000) k = 1;
    // полоска не прыгает назад и подползает, пока ждём
    this.loadShown = Math.max(this.loadShown + (k - this.loadShown) * 0.15, Math.min(0.3, (performance.now() - this.loadStart) / 10000));
    (this.loading.querySelector('i') as HTMLElement).style.width = `${Math.round(this.loadShown * 100)}%`;
    if (k >= 1) {
      this.loading.classList.add('done');
      setTimeout(() => (this.loading.hidden = true), 600);
      return false;
    }
    return true;
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.people?.dispose();
    this.renderer.dispose();
    for (const t of this.tex.values()) t.dispose();
    this.host.innerHTML = '';
  }
}
