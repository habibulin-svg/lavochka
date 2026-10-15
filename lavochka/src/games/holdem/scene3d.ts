/* Холдем — настоящий 3D-стол на three.js (грузится лениво, только в этом виде).
 * Координаты раскладки те же, что у плоской сцены (1000×720, центр 500×320): 100 точек = 1 единица (≈25 см), стол — плоскость y = 0.
 * Стол: сукно с печатью, лакированный деревянный кант, кожаный валик со строчкой, юбка; вокруг — комната 90-х (room3d.ts)
 * и стулья с соперниками (people3d.ts). Карты — пластинки со скруглёнными углами и картинками наших колод; фишки — стопки
 * по номиналам; баттон дилера. Подписи — HTML поверх холста по проекции.
 * Камера «за столом» как в Apple poker: в кадре один человек (тот, чей ход, или кого «снимает» вид, пока проигрывает события —
 * shoot), перед ним на сукне — общие карты, банк, его карты, фишки и ставка; свои карты — крупно в углу экрана.
 * Пока кто-то дышит за столом — рисуем ~30 кадров в секунду, пока что-то летит — каждый кадр. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { HDRI, normalOnly, onTextureLoad, pbr } from './pbr';
import type { Card } from '../../cards/deck';
import { cardUrl, deckImage, deckProgress, preloadDeck } from '../../cards/render';
import type { DeckStyle } from '../../core/settings';
import { bolsterProfile, cardGeometry, sweepEllipse } from './geo3d';
import { buildRoom, makeChair, onRoomLoad, FLOOR } from './room3d';
import { buttonTex, cardStandIn, CHIP_KINDS, chipSideTex, chipTopTex, feltTexture } from './tex3d';
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
  /** Общая карта: в виде «за столом» с видео-людьми ложится перед тем, кого снимают. */
  board?: boolean;
  /** Чья карта и какая по счёту — в кадре «как в Apple» карты снимаемого лежат перед ним. */
  seat?: number;
  i?: number;
}
export interface Chips3D {
  key: string;
  x: number;
  y: number;
  amount: number;
  /** Стопка игрока (его фишки) — столбиками в ряд; иначе ставка/банк — кучкой. */
  bank?: boolean;
  /** Чьи (stk:/bet:/win: — у снимаемого лежат перед ним). */
  seat?: number;
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
  /** Подпись к фишкам (ключ кучки): стоит над ними и видна, когда видны они. */
  chip?: string;
}
export interface Seat3D {
  seat: number;
  /** Место игрока на раскладке (точки сцены 1000×720). */
  x: number;
  y: number;
  me: boolean;
  out: boolean;
}
type Pt = { x: number; y: number };

/** Угол обзора камеры (вид сверху и вид «за столом» без видео-людей). */
const FOV = 47;
/** Вид «как в Apple»: общие карты — на столько впереди снимаемого (от его линии стола), камера — на столько от него. */
const STAGE_BOARD = 3.5;
const STAGE_CAM = 12.5;
/** Общие карты в этом виде: карта ≈ 19 см (втрое больше настоящей) — читается издалека, но не заслоняет стол. */
const STAGE_CARD = 0.78;
/** Карты соперника — меньше общих (как настоящие у его рук). */
const STAGE_HOLE = 0.62;
/** Ближе к камере (по полу) — подписи прячем. */
const STAGE_HIDE = 3.6;
/** Вещи на сукне в кадре «как в Apple»: f — от линии стола снимаемого вперёд (к камере), r — вправо (как видит камера). */
const SLOT = {
  hole: { f: 1.25, r: -1.55 },
  stack: { f: 1.0, r: 2.15 },
  bet: { f: 2.2, r: 1.0 },
  button: { f: 1.05, r: -2.75 },
  pot: { f: 5.3, r: 0.2 },
  /** Моя ставка — внизу кадра слева (справа — мои карты). */
  mine: { f: 6.1, r: -2.0 },
};

const CX = 500;
const CY = 320;
/** Стол крупнее раскладки (карты и фишки — прежнего размера): просторнее, как у Apple. */
const K = 1.5;
const FELT_RX = 4.75 * K;
const FELT_RZ = 2.95 * K;
/** Ширина деревянного канта между сукном и кожей. */
const RACE = 0.32;
const RAIL_W = 0.78;
const RAIL_H = 0.34;
export const RIM_RX = FELT_RX + RACE + RAIL_W;
export const RIM_RZ = FELT_RZ + RACE + RAIL_W;
const CARD_W = 1;
const CARD_H = 1.55;
const CARD_T = 0.014;
/** Смещение мип-уровня текстуры карт (меньше нуля — чётче): индекс мелкой карты на сукне не расплывается. */
const CARD_LOD_BIAS = -0.6;
const CHIP_R = 0.2;
const CHIP_H = 0.055;

const to3 = (x: number, y: number, h = 0) => new THREE.Vector3(((x - CX) / 100) * K, h, ((y - CY) / 100) * K);

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

/** Изгиб кадра видео-человека по валику: [слева, справа] (как видит камера) — z = c·x², чтобы кисти лежали на валике.
 * Порознь: место стоит не на оси стола — с одной стороны валик загибается к камере сильнее, и симметричный изгиб
 * прятал под валик пальцы на той стороне. Кадр — от стула на TO_RAIL вперёд, по его линии и ведём эллипс. */
function railCurve(pos: THREE.Vector3, face: number): [number, number] {
  const rx = RIM_RX - 0.69;
  const rz = RIM_RZ - 0.69;
  const fx = Math.sin(face);
  const fz = Math.cos(face);
  // насколько вперёд (к середине стола) от точки сбоку на x до валика
  const ahead = (x: number) => {
    const qx = pos.x + fx * 1.94 + fz * x;
    const qz = pos.z + fz * 1.94 - fx * x;
    const A = (fx / rx) ** 2 + (fz / rz) ** 2;
    const B = 2 * ((qx * fx) / rx ** 2 + (qz * fz) / rz ** 2);
    const C = (qx / rx) ** 2 + (qz / rz) ** 2 - 1;
    const d = Math.sqrt(Math.max(0, B * B - 4 * A * C));
    const t1 = (-B - d) / (2 * A);
    const t2 = (-B + d) / (2 * A);
    return Math.abs(t1) < Math.abs(t2) ? t1 : t2;
  };
  // по месту кистей
  const X = 1.5;
  const t0 = ahead(0);
  return [Math.max(0, (ahead(-X) - t0) / (X * X)), Math.max(0, (ahead(X) - t0) / (X * X))];
}

/** Точка на эллипсе по параметру и нормаль наружу. */

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
  /** Чьё (в кадре «как в Apple» видно только снимаемого — и мою ставку). */
  seat?: number;
  key?: string;
  /** Долетело (фишки ставки — кучка перед игроком растёт). */
  land?: () => void;
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
  private cardGeo = cardGeometry(CARD_W, CARD_H, CARD_T, 0.07);
  /** Карты — в прозрачном проходе после видео-людей: полупрозрачная кайма ролика не ложится на них поверх. */
  private edgeMat = new THREE.MeshStandardMaterial({ color: '#f3eee2', roughness: 0.7, transparent: true });
  private chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 48);
  private chipMat = new Map<number, THREE.Material[]>();
  private ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private speed = 1;
  private labelData: Label3D[] = [];
  private disposed = false;
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
  /** Вид «как в Apple poker»: кого снимаем (основание кадра у борта и направление к камере) — общие карты и банк
   * кладём перед ним, как будто он напротив нас. null — обычная раскладка. */
  private stage: { seat: number; base: THREE.Vector3; fwd: THREE.Vector3 } | null = null;
  private lastItems: Item3D[] = [];
  /** Сукно с разметкой (рамка для общих карт, надписи) и без — для вида «как в Apple», где карты кладутся перед соперником. */
  private feltMarked = feltTexture();
  private feltPlain = feltTexture(true);
  private feltMat!: THREE.MeshStandardMaterial;
  /** Кого снимает вид, пока проигрывает события (DEALER — крупье); null — того, чей ход. */
  private cue: number | null = null;
  private lastSet: { items: Item3D[]; chips: Chips3D[]; button: (Pt & { seat: number }) | null; labels: Label3D[] } | null = null;
  /** Крупье стоит посередине дальнего края (там у игроков оставлено место). */
  private dealerPlace = (() => {
    const e = onEllipse(RIM_RX + 1.25, RIM_RZ + 1.25, -Math.PI / 2);
    return { seat: DEALER, pos: e.p, face: Math.atan2(-e.n.x, -e.n.z) };
  })();
  /** Абажур: сверху он закрывает стол — в этом виде его нет. */
  private shade: THREE.Object3D | null = null;

  /** Смена кадра — наплывом: снимок прошлого кадра поверх холста тает (камера не летит через комнату и абажур). */
  private fade: HTMLCanvasElement;
  /** «Пропустить» — без наплывов и пауз. */
  private fast = false;
  private readyCalled = false;

  constructor(
    private readonly host: HTMLElement,
    private deck: DeckStyle,
    /** Заставка ушла — стол готов (боты могут ходить). */
    private readonly onReady?: () => void
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
    this.fade = document.createElement('canvas');
    this.fade.className = 'hd-fade';
    host.appendChild(this.fade);
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
    if (import.meta.env.DEV) (window as unknown as { __hd: Table3D }).__hd = this;
  }

  setFast(on: boolean) {
    this.fast = on;
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
    // заполняющий свет — как отражённый от стен и потолка: тени мягче, лица и углы не чёрные
    // (снизу — отсвет тёплого паркета и сукна: потолок не бурый, а тёплый белый в полутени)
    sc.add(new THREE.HemisphereLight('#ffe2b8', '#8a6a52', 0.24));
    const room = buildRoom();
    sc.add(room.group);
    this.shade = room.shade;

    // сукно
    const flat = (pts: THREE.Vector2[]) => new THREE.Shape(pts);
    const feltGeo = new THREE.ShapeGeometry(flat(ellipse(FELT_RX + 0.02, FELT_RZ + 0.02)), 64);
    const uv = feltGeo.attributes.uv as THREE.BufferAttribute;
    const pos = feltGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + FELT_RX) / (2 * FELT_RX), (pos.getY(i) + FELT_RZ) / (2 * FELT_RZ));
    this.feltMat = new THREE.MeshStandardMaterial({ map: this.feltMarked, normalMap: normalOnly('fabric', [18, 11]), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97, metalness: 0 });
    const felt = new THREE.Mesh(feltGeo, this.feltMat);
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
    for (const x of [-2.6 * K, 2.6 * K]) {
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
    const list = [...this.places.values()].map((p) => ({ seat: p.seat, pos: p.pos, face: p.face, hidden: p.me, out: p.out, curve: railCurve(p.pos, p.face) }));
    if (this.videoPeople && this.places.size) list.push({ ...this.dealerPlace, hidden: false, out: false, curve: railCurve(this.dealerPlace.pos, this.dealerPlace.face) });
    this.people.sync(list, this.lookTarget());
  }

  /** Действие крупье (в кадре она — если её снимают: shoot(DEALER)). */
  dealer(act: DealerAct) {
    this.people?.dealer?.(act);
    this.kick();
  }

  /** Люди-видео: вид ведёт камеру сам (shoot) и ждёт, пока доиграют реакции. */
  get director(): boolean {
    return this.videoPeople;
  }

  /** Снимать этого (DEALER — крупье, своё место — тоже крупье); null — того, чей ход. Смена — наплывом. */
  shoot(seat: number | null) {
    if (seat === this.cue) return;
    this.cue = seat;
    // вернулись к ходу — а ходим мы: крупье приглашает
    if (seat == null && this.focus != null && this.places.get(this.focus)?.me) this.people?.dealer?.('point_front');
    this.aimCamera();
    this.kick();
  }

  /** Скорость реакций людей-видео. */
  setRate(r: number) {
    this.people?.setRate?.(r);
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
      p.chair.visible = !p.me;
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
    if (seat != null && this.places.get(seat)?.me && this.cue == null) this.people?.dealer?.('point_front');
    this.people?.lookAt(this.lookTarget(), seat);
    this.aimCamera();
    this.kick();
  }

  /** Жест игрока (ставка, пас, чек...). */
  gesture(seat: number, kind: Gesture, delay = 0) {
    this.people?.gesture(seat, kind, delay);
    this.kick();
  }

  // ---------------------------------------------------------------- текстуры

  private texture(c: Card | null): THREE.Texture {
    const url = cardUrl(c, this.deck);
    let t = this.tex.get(url);
    if (!t) {
      // картинка из preloadDeck; пока она в пути — нарисованный заместитель (пустая текстура = прозрачная карта)
      const img = deckImage(url) ?? Object.assign(new Image(), { src: url });
      const ready = img.complete && img.naturalWidth > 0;
      const tex = (t = new THREE.Texture(ready ? img : cardStandIn(c)));
      t.needsUpdate = true;
      if (!ready)
        img.addEventListener(
          'load',
          () => {
            if (this.disposed) return;
            // заново на видеокарту: под заместителя память уже выделена
            tex.dispose();
            tex.image = img;
            tex.needsUpdate = true;
            this.kick();
          },
          { once: true }
        );
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
    // бумага с лёгким лаком; без тонового сжатия — красные масти не уходят в оранжевый, а белое под лампой не выгорает
    const mk = (t: THREE.Texture) => {
      const m = new THREE.MeshPhysicalMaterial({ map: t, color: '#b9b3a9', roughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.5, envMapIntensity: 0.5, alphaTest: 0.5, transparent: true, toneMapped: false });
      // карты на сукне видны вскользь и мелко: мип-уровень на полступени чётче — индекс читается, а не расплывается
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', `texture2D( map, vMapUv, ${CARD_LOD_BIAS.toFixed(2)} )`));
      };
      m.customProgramCacheKey = () => 'card-lod';
      return m;
    };
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
    // картинка ещё в пути (медленная сеть) — на её месте чистая карта, а не пустота
    for (const im of [...this.hand.querySelectorAll('img'), ...this.board.querySelectorAll('img')]) {
      if (im.complete) continue;
      im.classList.add('hd-wait');
      im.addEventListener('load', () => im.classList.remove('hd-wait'), { once: true });
    }
    this.hand.hidden = false;
    this.board.hidden = !this.boardKey;
    // общие карты лежат на столе в кадре — в полоске только банк
    this.board.classList.toggle('hd-board-pot-only', !!this.stage);
  }

  /** Общие карты и банк внизу экрана (вид «за столом»). */
  setBoard(cards: Card[], pot: number, note = '') {
    const key = cards.length || pot ? cards.map((c) => c.s + c.r).join(',') + '|' + pot + '|' + this.deck + '|' + note : '';
    if (key === this.boardKey) return;
    const had = this.boardKey.split('|')[0].split(',').filter(Boolean).length;
    this.boardKey = key;
    this.board.innerHTML = key
      ? `<div class="hd-board-cards">${cards.map((c, i) => `<img class="hd-bcard${i >= had ? ' deal' : ''}" style="--i:${i - had}" src="${cardUrl(c, this.deck)}" alt="" draggable="false">`).join('')}</div>` +
        `<div class="hd-board-pot">${pot ? `банк ${pot}` : ''}${pot && note ? ' · ' : ''}${note ? `<small>${note}</small>` : ''}</div>`
      : '';
    this.drawHand();
  }

  // ---------------------------------------------------------------- раскладка

  private cardTarget(it: Item3D): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const e = new THREE.Euler(0, (-it.r * Math.PI) / 180, 0, 'YXZ');
    return { pos: to3(it.x, it.y, 0.02 + CARD_T / 2), quat: new THREE.Quaternion().setFromEuler(e) };
  }

  /** Разложить карты, фишки, баттон и подписи. enter — откуда влетают новые карты, exit — куда улетают исчезнувшие. */
  set(items: Item3D[], chips: Chips3D[], button: (Pt & { seat: number }) | null, labels: Label3D[], speed: number, enter: Pt | null = null, exit: Pt | null = null) {
    this.speed = speed;
    this.lastSet = { items, chips, button, labels };
    this.place(enter, exit, false);
  }

  /** Разложить по последнему set(); snap — сразу на места (сменился кадр: вещи не летят через стол). */
  private place(enter: Pt | null, exit: Pt | null, snap: boolean) {
    const ls = this.lastSet;
    if (!ls) return;
    const { items, button, labels } = ls;
    const chips = this.withPot(ls.chips);
    const st = this.stage;
    const seen = new Set<string>();
    const wasBoard = this.boardKeys;
    this.lastItems = items;
    items.forEach((it, i) => {
      seen.add(it.key);
      const tg = this.target(it);
      let m = this.cards.get(it.key);
      if (!m) {
        const mesh = new THREE.Mesh(this.cardGeo, []);
        mesh.renderOrder = 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.paint(mesh, it.card);
        // в кадре «как в Apple» карты влетают из рук крупье — там, где у снимаемого начинается сукно
        const from = !enter ? tg.pos.clone().add(new THREE.Vector3(0, 0.4, 0)) : st ? st.base.clone().addScaledVector(st.fwd, 0.8).setY(0.7 + i * 0.01) : to3(enter.x, enter.y, 0.6 + i * 0.01);
        mesh.position.copy(from);
        // влетает рубашкой вверх и переворачивается на лету
        mesh.quaternion.copy(enter && it.card ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)) : tg.quat);
        this.scene.add(mesh);
        m = { obj: mesh, pos: tg.pos, quat: tg.quat, scale: tg.scale ?? it.s, seat: it.seat, key: it.key };
        // сразу своего размера (в кадре «как в Apple» карты мельче) — не сдувается на лету
        mesh.scale.setScalar((tg.scale ?? it.s) * (enter ? 0.85 : 1));
        this.cards.set(it.key, m);
      } else {
        m.pos = tg.pos;
        m.quat = tg.quat;
        m.scale = tg.scale ?? it.s;
        m.seat = it.seat;
        const now = (m.obj.userData.card as Card | null) ?? null;
        if (JSON.stringify(now) !== JSON.stringify(it.card)) {
          // вскрытие: переворот через ребро
          if (!now && it.card) m.obj.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI * 0.999)));
          this.paint(m.obj as THREE.Mesh, it.card);
        }
      }
      if (snap) this.jump(m);
    });
    for (const [k, m] of [...this.cards]) {
      if (seen.has(k)) continue;
      this.cards.delete(k);
      if (exit) {
        // в кадре: крупье собирает карты к себе, игрок сбрасывает — вперёд, к середине стола
        if (st && wasBoard.has(k)) m.seat = st.seat;
        m.pos = !st || m.seat !== st.seat ? to3(exit.x, exit.y, 0.3) : st.base.clone().addScaledVector(st.fwd, st.seat === DEALER ? 0.5 : 3.2).setY(0.3);
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
      const target = this.chipTarget(c);
      if (!m) {
        const g = new THREE.Group();
        // ставка вылетает из стопки игрока (моя — из-под камеры), выигрыш — из банка
        g.position.copy((!snap && this.chipSource(c)) || target);
        this.scene.add(g);
        m = { obj: g, pos: target, quat: new THREE.Quaternion(), scale: 1, amount: -1, bank: !!c.bank, seat: c.seat, key: c.key };
        this.chips.set(c.key, m);
      }
      m.pos = target;
      m.seat = c.seat;
      if (m.amount !== c.amount) {
        const src = !snap && !this.fast && m.amount > 0 && c.amount > m.amount && c.key.startsWith('bet:') ? this.chipSource(c) : null;
        if (src) {
          // добавка к ставке летит из стопки, кучка вырастет, когда долетит
          const fly = new THREE.Group();
          this.stack(fly, c.amount - m.amount, false, `${c.key}+${c.amount}`);
          fly.position.copy(src);
          this.scene.add(fly);
          const pile = m;
          const amount = c.amount;
          this.dying.push({ obj: fly, pos: target, quat: new THREE.Quaternion(), scale: 1, dying: 0.55, seat: c.seat, key: c.key, land: () => pile.amount === amount && this.stack(pile.obj as THREE.Group, amount, pile.bank, c.key) });
        } else this.stack(m.obj as THREE.Group, c.amount, !!c.bank, c.key);
        m.amount = c.amount;
      }
      if (snap) this.jump(m);
    }
    for (const [k, m] of [...this.chips]) {
      if (cseen.has(k)) continue;
      this.chips.delete(k);
      if (k === 'pot' || k.startsWith('stk:')) {
        this.drop(m.obj);
        continue;
      }
      // ставки уходят в банк, выигрыш — в стопку игрока
      const stk = k.startsWith('win:') ? this.chips.get(`stk:${m.seat}`) : null;
      m.pos = stk ? stk.pos.clone() : this.chipTarget({ key: 'pot', x: CX, y: CY + 125, amount: 0 });
      m.dying = 0.45;
      this.dying.push(m);
    }
    if (snap)
      for (const m of [...this.dying]) {
        this.dying.splice(this.dying.indexOf(m), 1);
        this.drop(m.obj);
        m.land?.();
      }
    // баттон
    this.button.obj.visible = !!button;
    this.button.obj.userData.on = !!button;
    this.button.seat = button?.seat;
    if (button) {
      this.button.pos = st && button.seat === st.seat ? this.slot('button', 0.065) : to3(button.x, button.y, 0.065);
      if (!this.button.obj.userData.placed || snap) {
        this.button.obj.position.copy(this.button.pos);
        this.button.obj.userData.placed = true;
      }
    }
    this.labelData = labels;
    this.drawLabels();
    this.kick();
  }

  private jump(m: Moving) {
    m.obj.position.copy(m.pos);
    m.obj.quaternion.copy(m.quat);
    m.obj.scale.setScalar(m.scale);
  }

  /** В кадре «как в Apple» в банке — и ставки тех, кого не видно (их кучек перед ними в кадре нет). */
  private withPot(chips: Chips3D[]): Chips3D[] {
    const st = this.stage;
    if (!st) return chips;
    const hiddenBet = (c: Chips3D) => c.key.startsWith('bet:') && c.seat !== st.seat && !this.places.get(c.seat!)?.me;
    const extra = chips.reduce((a, c) => a + (hiddenBet(c) ? c.amount : 0), 0);
    if (!extra) return chips;
    const pot = chips.find((c) => c.key === 'pot');
    const rest = chips.filter((c) => c !== pot);
    return [...rest, { key: 'pot', x: CX, y: CY + 125, amount: (pot?.amount ?? 0) + extra }];
  }

  /** Откуда вылетают новые фишки: ставка — из стопки игрока (моя — из-под камеры), выигрыш — из банка. */
  private chipSource(c: Chips3D): THREE.Vector3 | null {
    if (c.seat == null) return null;
    const st = this.stage;
    if (c.key.startsWith('bet:')) {
      if (st && this.places.get(c.seat)?.me) return this.slot('mine', 1.2).addScaledVector(st.fwd, 3);
      return this.chips.get(`stk:${c.seat}`)?.obj.position.clone() ?? null;
    }
    if (c.key.startsWith('win:')) return this.chips.get('pot')?.obj.position.clone() ?? null;
    return null;
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
    if (this.shade) this.shade.visible = a > 0.9;
    this.fovGoal = FOV;
    const shot = this.pickShot();
    const was = this.stage;
    // другой человек в кадре — наплыв: снимок нынешнего кадра, камера сразу на новом месте и чуть наезжает
    const cut = this.camInit && !!shot && !!was && was.seat !== shot.seat;
    if (cut && !this.fast) this.snapshot();
    this.stage = null;
    if (shot) {
      // как в Apple poker: соперник в верхней трети, под ним сукно с банком и общими картами (они кладутся перед ним),
      // камера — там, где сидели бы мы напротив него
      const fwd = new THREE.Vector3(Math.sin(shot.face), 0, Math.cos(shot.face));
      const base = shot.pos.clone().addScaledVector(fwd, 1.94).setY(0);
      this.stage = { seat: shot.seat, base, fwd };
      const D = STAGE_CAM;
      // выше — карты на сукне видны не так вскользь
      const hCam = 7.0;
      // по вертикали: от макушки соперника до сукна чуть ближе общих карт
      const aHead = Math.atan2(hCam - 4.3, D);
      // снизу — запас под свои карты в углу экрана
      const aLow = Math.atan2(hCam, D - STAGE_BOARD - 2.6);
      const pitch = (aHead + aLow) / 2;
      let vfov = (aLow - aHead) * 1.08;
      // узкий экран: по ширине должны влезть соперник (локти могут чуть выйти за край) и все пять общих карт
      const hfov = 2 * Math.atan(Math.max(5.0 / 2 / D, (2.4 * CARD_W * STAGE_CARD + 0.25) / (D - STAGE_BOARD)));
      vfov = Math.max(vfov, 2 * Math.atan(Math.tan(hfov / 2) / Math.max(a, 0.1)));
      this.fovGoal = THREE.MathUtils.clamp((vfov * 180) / Math.PI, 30, 80);
      this.camGoal.pos.copy(base).addScaledVector(fwd, D).setY(hCam);
      this.camGoal.look.copy(this.camGoal.pos).addScaledVector(fwd, -Math.cos(pitch) * 6).add(new THREE.Vector3(0, -Math.sin(pitch) * 6, 0));
    } else {
      // узкий экран — смотрим круче, чтобы стол был виден целиком хотя бы по глубине
      const narrow = Math.min(1, Math.max(0, (1.5 - a) / 0.9));
      const pitch = THREE.MathUtils.degToRad(25 + 18 * narrow);
      // по ширине должен влезть стол с соперниками (±W), но не дальше разумного
      const W = 7.2 * K;
      const dist = THREE.MathUtils.clamp(W / (half * a), 8.4, 15.5);
      // чуть поворачиваемся к тому, чей ход
      let yaw = 0;
      const f = this.focus != null ? this.places.get(this.focus) : null;
      if (f && !f.me) yaw = THREE.MathUtils.clamp(-f.pos.x * 0.018, -0.12, 0.12);
      const look = new THREE.Vector3(0, 0.6, -1.3 + narrow * 0.9);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this.camGoal.look.copy(look);
      this.camGoal.pos.copy(look).addScaledVector(dir, dist);
    }
    if (!!was !== !!this.stage || (was && this.stage && !was.base.equals(this.stage.base))) this.restage();
    // «как в Apple»: в кадре только тот, кого снимаем
    this.people?.only?.(this.stage && this.videoPeople ? this.stage.seat : null);
    const plain = !!this.stage;
    if ((this.feltMat.map === this.feltPlain) !== plain) {
      this.feltMat.map = plain ? this.feltPlain : this.feltMarked;
      this.feltMat.needsUpdate = true;
    }
    // и пустых чужих стульев в кадре нет
    for (const p of this.places.values()) p.chair.visible = !p.me && (!this.stage || p.seat === this.stage.seat);
    if (!this.camInit || cut) {
      this.camInit = true;
      this.camera.fov = this.fovGoal;
      this.camera.updateProjectionMatrix();
      this.camPos.copy(this.camGoal.pos);
      this.camLook.copy(this.camGoal.look);
      // наезд: начинаем чуть дальше и выше — за секунду камера мягко подъезжает
      if (cut && this.stage && !this.fast) this.camPos.addScaledVector(this.stage.fwd, 0.9).add(new THREE.Vector3(0, 0.25, 0));
      this.applyCamera();
    }
  }

  /** Снимок нынешнего кадра поверх холста — и тает. */
  private snapshot() {
    const c = this.renderer.domElement;
    if (!c.width || !c.height) return;
    // рисуем кадр заново и сразу копируем (буфер WebGL после показа очищается)
    this.render();
    this.fade.width = c.width;
    this.fade.height = c.height;
    const g = this.fade.getContext('2d');
    if (!g) return;
    g.drawImage(c, 0, 0);
    this.fade.style.transition = 'none';
    this.fade.style.opacity = '1';
    void this.fade.offsetWidth;
    this.fade.style.transition = `opacity ${Math.round(650 / Math.max(0.5, this.speed))}ms ease-in-out`;
    this.fade.style.opacity = '0';
  }

  /** Кого снимать: того, чей ход; на своём ходу и между раздачами — кого снимали; сначала — того, кто напротив. */
  private pickShot(): { seat: number; pos: THREE.Vector3; face: number } | null {
    const f = this.focus != null ? this.places.get(this.focus) : null;
    if (this.videoPeople) {
      // вид проигрывает события — снимаем, кого он просит (себя не видно — тогда крупье)
      const c = this.cue != null ? this.places.get(this.cue) : null;
      if (this.cue === DEALER || c?.me || (this.cue == null && f?.me)) return this.dealerPlace;
      if (c) {
        this.shot = c.seat;
        return c;
      }
    }
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

  private right(st: { fwd: THREE.Vector3 }): THREE.Vector3 {
    // вправо — как видит камера (она смотрит против fwd)
    return new THREE.Vector3(st.fwd.z, 0, -st.fwd.x);
  }

  /** Точка на сукне перед снимаемым (SLOT), на высоте h, не ближе margin к краю сукна
   * (по умолчанию — разлёт столбиков стопки, 0,6, и ещё запас до валика). */
  private slot(name: keyof typeof SLOT, h = 0.02, margin = 0.95): THREE.Vector3 {
    const st = this.stage!;
    const p = st.base.clone().addScaledVector(st.fwd, SLOT[name].f).addScaledVector(this.right(st), SLOT[name].r).setY(h);
    // на закруглении стола место сбоку от соперника заезжает на валик (стол «съедает» карты и фишки) — сдвигаем к середине
    const rx = FELT_RX - margin;
    const rz = FELT_RZ - margin;
    for (let k = 0; k < 60 && (p.x / rx) ** 2 + (p.z / rz) ** 2 > 1; k++) p.addScaledVector(st.fwd, 0.06);
    return p;
  }

  /** Куда лечь карте: общие — перед тем, кого снимаем (в виде «как в Apple»), его карты — перед ним, остальные — по раскладке. */
  private target(it: Item3D): { pos: THREE.Vector3; quat: THREE.Quaternion; scale?: number } {
    const st = this.stage;
    if (!st) return this.cardTarget(it);
    // читается с камеры: «верх» карты — от камеры
    const yaw = Math.atan2(st.fwd.x, st.fwd.z);
    if (it.board) {
      const i = this.lastItems.filter((x) => x.board).indexOf(it);
      const s = it.s * STAGE_CARD;
      const pos = st.base.clone().addScaledVector(st.fwd, STAGE_BOARD).addScaledVector(this.right(st), (i - 2) * CARD_W * s * 1.07).setY(0.02 + CARD_T / 2);
      return { pos, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')), scale: s };
    }
    if (it.seat === st.seat) {
      // две карты веером перед руками
      const i = it.i ?? 0;
      const s = it.s * STAGE_CARD * STAGE_HOLE;
      // запас от края сукна — пол-веера из двух карт
      const pos = this.slot('hole', 0.02 + CARD_T / 2 + i * 0.006, (CARD_W + CARD_H) * s * 0.5 + 0.35).addScaledVector(this.right(st), (i - 0.5) * CARD_W * s * 1.02);
      return { pos, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw - (i - 0.5) * 0.12, 0, 'YXZ')), scale: s };
    }
    return this.cardTarget(it);
  }

  private chipTarget(c: Chips3D): THREE.Vector3 {
    const st = this.stage;
    if (st) {
      if (c.key === 'pot') return this.slot('pot');
      if (c.seat === st.seat) return this.slot(c.key.startsWith('stk:') ? 'stack' : 'bet');
      if (c.seat != null && this.places.get(c.seat)?.me && !c.key.startsWith('stk:')) return this.slot('mine');
    }
    return to3(c.x, c.y, 0.02);
  }

  /** В кадре «как в Apple» на сукне — только общие карты, банк, вещи снимаемого и моя ставка. */
  private inShot(m: Moving): boolean {
    const st = this.stage;
    if (!st || m.key === 'pot' || (m.key && this.boardKeys.has(m.key))) return true;
    if (m.seat == null) return false;
    if (m.seat === st.seat) return true;
    return !!this.places.get(m.seat)?.me && !!m.key && !m.key.startsWith('stk:') && !m.key.startsWith('b:');
  }

  private get boardKeys(): Set<string> {
    return new Set(this.lastItems.filter((x) => x.board).map((x) => x.key));
  }

  /** Чьё место ближе всего к точке на столе (крупье — тоже место). */
  private owner(p: THREE.Vector3): number | null {
    let best: number | null = null;
    let bd = Infinity;
    for (const pl of [...this.places.values(), this.dealerPlace]) {
      const d = (pl.pos.x - p.x) ** 2 + (pl.pos.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = pl.seat;
      }
    }
    return best;
  }

  /** Сменился кадр — вещи на сукне сразу на новые места (не летят через стол, пока камера на новом месте). */
  private restage() {
    this.place(null, null, true);
    this.drawHand();
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
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
    this.host.style.setProperty('--hand', `${Math.round(Math.min(h * 0.24, w * 0.15))}px`);
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
        // своя табличка — внизу экрана, чужие — над головой
        if (this.places.get(l.seat)?.me) {
          s += `<div class="${cls} hd-me" style="${l.style ?? ''}">${l.html}</div>`;
          continue;
        }
        v = this.headPos(l.seat) ?? to3(l.x, l.y, 0.4);
        cls += ' hd-over';
        // «как в Apple»: табличка — только у того, кого снимаем
        if (this.stage && l.seat !== this.stage.seat) continue;
      } else if (l.chip) {
        // подпись к фишкам — над ними, пока их видно
        const m = this.chips.get(l.chip);
        if (!m || !m.obj.visible) continue;
        v = m.obj.position.clone().setY(l.h ?? 0.6);
      } else {
        v = to3(l.x, l.y, l.h ?? 0.15);
        if (this.stage && (Math.hypot(v.x - this.camPos.x, v.z - this.camPos.z) < STAGE_HIDE || this.owner(v) !== this.stage.seat)) continue;
      }
      const pr = v.project(this.camera);
      if (pr.z > 1) continue;
      // что не в кадре — не показываем (банк — в полоске внизу)
      if (Math.abs(pr.x) > 1.02 || Math.abs(pr.y) > 1.02 || cls.includes('hd-pot')) continue;
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
    // «как в Apple»: на сукне только вещи снимаемого, общие карты, банк и моя ставка
    for (const m of this.cards.values()) m.obj.visible = this.inShot(m);
    for (const m of this.chips.values()) m.obj.visible = this.inShot(m);
    this.button.obj.visible = !!this.button.obj.userData.on && (!this.stage || this.button.seat === this.stage.seat);
    for (const m of this.cards.values()) step(m);
    for (const m of this.chips.values()) step(m);
    step(this.button);
    for (const m of [...this.dying]) {
      // сброшенные карты и ставки, ушедшие в банк, — в кадре «как в Apple» только у того, кого снимаем
      m.obj.visible = this.inShot(m);
      step(m);
      m.dying! -= dt * this.speed;
      moving = true;
      if (m.dying! <= 0) {
        this.dying.splice(this.dying.indexOf(m), 1);
        this.drop(m.obj);
        m.land?.();
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
    const alive = this.people?.update(dt, this.camera.position) ?? false;
    const waiting = this.updateLoading();
    // живые люди — 30 кадров в секунду, полёт карт — каждый кадр
    if (moving || t - this.lastDraw > 31) {
      this.lastDraw = t;
      this.render();
      this.drawLabels();
    }
    if (moving || alive || waiting) this.kick();
  }

  /** Заставка: полоска — готовность людей; ушла — когда все сидят (или через 25 с, что бы ни случилось). true — ещё ждём. */
  private updateLoading(): boolean {
    if (this.loading.hidden) return false;
    const p = this.people;
    // и колода: на медленной сети карты иначе приходят посреди раздачи
    preloadDeck(this.deck);
    let k = Math.min(p ? (p.ready?.() ?? 1) : 0, deckProgress(this.deck));
    if (performance.now() - this.loadStart > 25000) k = 1;
    // полоска не прыгает назад и подползает, пока ждём
    this.loadShown = Math.max(this.loadShown + (k - this.loadShown) * 0.15, Math.min(0.3, (performance.now() - this.loadStart) / 10000));
    (this.loading.querySelector('i') as HTMLElement).style.width = `${Math.round(this.loadShown * 100)}%`;
    if (k >= 1) {
      if (!this.readyCalled) {
        this.readyCalled = true;
        this.onReady?.();
      }
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
