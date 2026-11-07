/* Пинбол — логика и физика без DOM (её гоняют тесты). Стол в плане: x — вправо (0…600), y — вниз (0 — верх, 1100 — низ),
 * единица ≈ полмиллиметра. Шар катится под наклоном (сила тяжести вдоль стола), отскакивает от бортов, грибков, рогаток;
 * флипперы — вращающиеся «капсулы»: шар получает скорость их поверхности в точке удара. Всё — мелкими подшагами,
 * чтобы быстрый шар не пролетал сквозь борт (приём из «Ten Minute Physics», без сторонних библиотек).
 *
 * Элементы стола: грибки, рогатки, дорожки-буквы сверху (все — множитель бонуса), сбиваемые мишени (все — джекпот в лунке),
 * мишени-стойки (все — горит «отбойник» в левом ауте: спасает упавший туда шар), лунка (третья — мультибол),
 * рампа-горка (шар въезжает с разгона, слабый скатывается назад; съезжает к флипперу), вертушка-спиннер (очки за обороты),
 * у столов свои фигуры: вращающийся круг (карусель, пластинка — закручивает шар), магнит-ловушка (зеркальный шар, чёрная дыра —
 * тянет, ловит, выплёвывает), орбита. У каждого стола — цепочка заданий; пройдены все — суперджекпот. Три шара. */
export const TW = 600;
export const TH = 1100;
export const BALL_R = 11;
const G = 1500;
const SUB = 10;
const VMAX = 3200;
const E_WALL = 0.42;
const E_FLIP = 0.18;

export type Vec = [number, number];

export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Рогатка: сила толчка от лица. */
  kick?: number;
  /** Односторонняя дверца: n — сторона, где она «закрыта» (шар с другой стороны проходит). */
  n?: Vec;
  /** Номер рогатки (для огня). */
  sling?: number;
}

export interface FlipperDef {
  x: number;
  y: number;
  len: number;
  /** Угол покоя и поднятый угол (рад, экранные: 0 — вправо, плюс — вниз). */
  rest: number;
  up: number;
  side: 'L' | 'R';
}

/** Рампа-горка: карман-въезд (mouth, направление dir), дальше шар едет по ломаной path над полем;
 * первые climb единиц — подъём (тормозит, без разгона скатывается назад), в конце — выпуск со скоростью exit. */
export interface RampDef {
  name: string;
  mouth: Vec;
  dir: Vec;
  path: number[];
  climb: number;
  exit: Vec;
}

/** Вращающийся круг (карусель, пластинка): внутри шар закручивает вбок. spin — ускорение (знак — направление). */
export interface DiscDef {
  name: string;
  x: number;
  y: number;
  r: number;
  spin: number;
}

/** Магнит-ловушка: тянет шар к центру, ловит, держит и выплёвывает вниз. */
export interface MagnetDef {
  name: string;
  x: number;
  y: number;
  r: number;
  pull: number;
}

export type MissionEv = 'ramp' | 'spin' | 'stands' | 'disc' | 'magnet' | 'saucer' | 'orbit' | 'bumper' | 'targets' | 'lanes';
export interface MissionDef {
  label: string;
  ev: MissionEv;
  n: number;
}

export interface TableDef {
  id: string;
  title: string;
  /** Буквы дорожек сверху. */
  word: string;
  walls: number[][];
  /** Круглые столбики [x, y, r]. */
  posts: [number, number, number][];
  bumpers: [number, number][];
  /** Сбиваемые мишени [ax, ay, bx, by]. */
  targets: [number, number, number, number][];
  /** Мишени-стойки (не падают, загораются) [ax, ay, bx, by]. */
  standups: [number, number, number, number][];
  /** Подпись стоек на вставках (по букве на стойку). */
  standWord: string;
  /** Вертушки: ось [ax, ay, bx, by] поперёк прохода. */
  spinners: [number, number, number, number][];
  ramps: RampDef[];
  disc?: DiscDef;
  magnet?: MagnetDef;
  saucer: { x: number; y: number; out: Vec };
  /** Орбита: датчик [x, y] — шар прошёл по ней (в любую сторону). Лунка: out — скорость, с которой выплёвывает. */
  orbit?: Vec;
  flippers: FlipperDef[];
  /** Дорожки сверху: центры датчиков. */
  lanes: Vec[];
  missions: MissionDef[];
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Держит лунка или магнит (с); rel — где и с какой скоростью выпустить. */
  held: number;
  rel?: [number, number, number, number];
  /** На рампе: номер, пройденный путь, скорость вдоль. */
  ramp?: number;
  rs?: number;
  rv?: number;
  /** Задержка после выпуска (лунка и магнит не ловят сразу снова). */
  cool?: number;
  lane?: number;
  orb?: number;
  still?: number;
  disc?: boolean;
}

export interface FlipperState {
  a: number;
  w: number;
}

export interface PbState {
  table: string;
  balls: Ball[];
  flips: FlipperState[];
  score: number;
  /** Номер шара (1…3 + призовые) и сколько осталось в запасе. */
  ball: number;
  left: number;
  bonus: number;
  mult: number;
  lanes: boolean[];
  targets: boolean[];
  /** Горящие стойки. */
  stands: boolean[];
  /** Вертушки: угол и скорость вращения. */
  spins: FlipperState[];
  /** Отбойник в левом ауте горит. */
  kick: boolean;
  jackpot: boolean;
  saucerCount: number;
  orbits: number;
  ramps: number;
  /** Когда был последний въезд на рампу (для комбо). */
  rampT: number;
  /** Задание: номер, сколько набрано, сколько кругов заданий пройдено. */
  mission: number;
  mprog: number;
  mlevel: number;
  /** Шар в стартовом жёлобе ждёт пуска; сила натяжения 0…1. */
  plunger: number;
  inLane: boolean;
  /** Сколько ещё спасает шар (с); удар-мастерство: какая дорожка мигает при пуске. */
  save: number;
  /** Спасение ещё не тратилось на этом шаре. */
  saveArmed: boolean;
  skill: number;
  /** Подталкивания: счётчик предупреждений, когда последнее; TILT — шар пропал. */
  nudges: number;
  nudgeT: number;
  tilt: boolean;
  /** Огни: время вспышки грибков, рогаток, стоек, магнита. */
  bumpLit: number[];
  slingLit: number[];
  standLit: number[];
  extra: boolean;
  t: number;
  /** Пауза между шарами (подсчёт бонуса). */
  wait: number;
  over: boolean;
  /** Сообщение на табло и сколько ему гореть. */
  msg: string;
  msgT: number;
}

export interface PbInput {
  l: boolean;
  r: boolean;
  /** Тянут пружину. */
  pull: boolean;
  /** Подтолкнуть стол (импульс, однократно). */
  nudge?: boolean;
}

export type PbEvent =
  | { k: 'bumper'; i: number }
  | { k: 'sling'; i: number }
  | { k: 'wall'; st: number }
  | { k: 'flip'; side: 'L' | 'R'; up: boolean }
  | { k: 'flipHit'; st: number }
  | { k: 'target'; i: number; all: boolean }
  | { k: 'stand'; i: number; all: boolean }
  | { k: 'spin'; i: number }
  | { k: 'ramp'; i: number; combo: boolean }
  | { k: 'rampIn'; i: number }
  | { k: 'rampBack'; i: number }
  | { k: 'disc' }
  | { k: 'magnet'; out: boolean }
  | { k: 'kickback' }
  | { k: 'mission'; label: string; all: boolean }
  | { k: 'lane'; i: number; all: boolean }
  | { k: 'saucer'; jackpot: boolean; multiball: boolean }
  | { k: 'orbit' }
  | { k: 'launch'; st: number }
  | { k: 'skill' }
  | { k: 'drain'; saved: boolean }
  | { k: 'bonus'; total: number }
  | { k: 'tilt' }
  | { k: 'warn' }
  | { k: 'extra' }
  | { k: 'over'; score: number };

// ---------------------------------------------------------------- каркас стола (общий)

/** Дуга ломаной: центр, радиус, углы (рад), число отрезков. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/** Отражение по центру поля (x → 568 − x): правая сторона повторяет левую. */
export const MX = 568;
export const mirror = (pts: number[]) => pts.map((v, i) => (i % 2 ? v : MX - v));

const SHELL: number[][] = [
  // наружный борт: слева вверх, дугой поверх, справа вниз (правый край — наружная стенка жёлоба)
  [20, 1140, 20, 280, ...arc(300, 280, 280, Math.PI, Math.PI * 2, 32).slice(2, -2), 580, 280, 580, 1140],
  // внутренняя стенка стартового жёлоба
  [548, 1140, 548, 340],
  // упор пружины
  [548, 1052, 580, 1052],
  // направляющие к флипперам (слева и зеркально справа)
  [62, 820, 62, 920, 201, 974],
  mirror([62, 820, 62, 920, 201, 974]),
  // рогатки: боковая и нижняя стенки (лицо — отдельно, с толчком)
  [108, 800, 108, 900, 168, 935],
  mirror([108, 800, 108, 900, 168, 935]),
];
/** Рогатки: треугольники (для отрисовки) и лица с толчком. */
export const SLING_TRI: number[][] = [
  [108, 800, 108, 900, 168, 935],
  mirror([108, 800, 108, 900, 168, 935]),
];
const SLINGS: [number, number, number, number][] = [
  [108, 800, 168, 935],
  [MX - 108, 800, MX - 168, 935],
];
const FLIPPERS: FlipperDef[] = [
  { x: 195, y: 985, len: 76, rest: 0.52, up: -0.42, side: 'L' },
  { x: MX - 195, y: 985, len: 76, rest: Math.PI - 0.52, up: Math.PI + 0.42, side: 'R' },
];
/** Дорожки сверху: перегородки и датчики. */
const LANE_X = [175, 235, 295, 355, 415];
const laneWalls = LANE_X.map((x) => [x, 128, x, 178]);
const laneSensors: Vec[] = LANE_X.slice(0, -1).map((x) => [x + 30, 160]);
const lanePosts: [number, number, number][] = LANE_X.map((x) => [x, 128, 5]);
/** Столбики у входа в «аут»: шар, катящийся по борту, отскакивает внутрь (но может и проскочить). */
const OUT_POSTS: [number, number, number][] = [
  [30, 780, 6],
  [MX - 30, 780, 6],
];
/** Отбойник: датчик в левом ауте. */
export const KICKBACK: Vec = [41, 950];
/** Выходы рамп — над левой и правой дорожкой к флипперу. */
const EXIT_L: number[] = [85, 790];
const EXIT_R: number[] = [MX - 85, 790];
const COMMON_POSTS: [number, number, number][] = [...lanePosts, ...OUT_POSTS, [548, 340, 4]];

const norm = (x: number, y: number): Vec => {
  const l = Math.hypot(x, y);
  return [x / l, y / l];
};

// ---------------------------------------------------------------- столы

export const TABLES: TableDef[] = [
  {
    id: 'park',
    title: 'Луна-парк',
    word: 'ПАРК',
    walls: [...SHELL, ...laneWalls, [20, 470, 34, 470], [20, 600, 34, 600]],
    posts: [...COMMON_POSTS],
    bumpers: [
      [225, 290],
      [365, 290],
      [295, 375],
    ],
    targets: [
      [36, 472, 36, 512],
      [36, 515, 36, 555],
      [36, 558, 36, 598],
    ],
    standups: [
      [222, 482, 250, 468],
      [270, 462, 300, 462],
      [320, 468, 348, 482],
    ],
    standWord: 'ТИР',
    spinners: [[356, 540, 404, 540]],
    ramps: [
      {
        name: 'ГОРКИ',
        mouth: [170, 610],
        dir: norm(-0.2, -1),
        path: [160, 520, 142, 430, 124, 350, 122, 282, 145, 228, 195, 203, 284, 196, 380, 201, 440, 224, 494, 274, 520, 352, 524, 460, 521, 560, 514, 660, 500, 735, ...EXIT_R],
        climb: 150,
        exit: [0, 320],
      },
    ],
    disc: { name: 'КАРУСЕЛЬ', x: 284, y: 650, r: 44, spin: 2000 },
    saucer: { x: 470, y: 480, out: [-430, 160] },
    flippers: FLIPPERS,
    lanes: laneSensors,
    missions: [
      { label: 'ГОРКИ ×2', ev: 'ramp', n: 2 },
      { label: 'КАРУСЕЛЬ ×5', ev: 'disc', n: 5 },
      { label: 'ТИР', ev: 'stands', n: 1 },
      { label: 'ВЕРТУШКА 30', ev: 'spin', n: 30 },
      { label: 'КАССА ×2', ev: 'saucer', n: 2 },
    ],
  },
  {
    id: 'disco',
    title: 'Дискотека',
    word: 'ДИСК',
    walls: [...SHELL, ...laneWalls],
    posts: [...COMMON_POSTS, [110, 380, 10], [450, 392, 10]],
    bumpers: [
      [210, 280],
      [380, 280],
      [295, 330],
      [295, 230],
    ],
    targets: [
      [226, 580, 262, 570],
      [264, 569, 300, 559],
      [302, 558, 338, 548],
    ],
    standups: [
      [535, 620, 535, 656],
      [535, 662, 535, 698],
      [535, 704, 535, 740],
    ],
    standWord: 'DJ!',
    spinners: [[128, 440, 176, 440]],
    ramps: [
      {
        name: 'ТАНЦПОЛ',
        mouth: [430, 610],
        dir: norm(0.2, -1),
        path: [442, 520, 470, 430, 500, 350, 500, 278, 472, 222, 420, 196, 284, 190, 180, 200, 120, 240, 80, 300, 52, 380, 46, 480, 48, 580, 55, 680, 70, 750, ...EXIT_L],
        climb: 150,
        exit: [0, 320],
      },
    ],
    disc: { name: 'ПЛАСТИНКА', x: 430, y: 705, r: 38, spin: -2200 },
    magnet: { name: 'ДИСКОШАР', x: 284, y: 445, r: 78, pull: 2400 },
    saucer: { x: 95, y: 520, out: [430, 160] },
    flippers: FLIPPERS,
    lanes: laneSensors,
    missions: [
      { label: 'ТАНЦПОЛ ×2', ev: 'ramp', n: 2 },
      { label: 'ДИСКОШАР ×2', ev: 'magnet', n: 2 },
      { label: 'DJ!', ev: 'stands', n: 1 },
      { label: 'ПЛАСТИНКА ×4', ev: 'disc', n: 4 },
      { label: 'ГРИБКИ 25', ev: 'bumper', n: 25 },
    ],
  },
  {
    id: 'kosmos',
    title: 'Космос',
    word: 'ПУСК',
    // орбита слева: внутренняя стенка и отвод внизу — шар с орбиты уходит на дорожку к флипперу, а не в аут
    walls: [...SHELL, ...laneWalls, [78, 700, 78, 340], [20, 690, 75, 795], [530, 470, 548, 470], [530, 600, 548, 600]],
    posts: [...COMMON_POSTS, [78, 700, 7], [78, 340, 6]],
    bumpers: [
      [235, 300],
      [370, 310],
      [300, 395],
    ],
    targets: [
      [532, 472, 532, 512],
      [532, 515, 532, 555],
      [532, 558, 532, 598],
    ],
    standups: [
      [90, 424, 90, 458],
      [90, 464, 90, 498],
      [90, 504, 90, 538],
    ],
    standWord: 'МИР',
    spinners: [[22, 460, 76, 460]],
    ramps: [
      {
        name: 'РАКЕТА',
        mouth: [158, 625],
        dir: norm(-0.12, -1),
        path: [148, 535, 134, 450, 126, 370, 132, 290, 160, 230, 240, 200, 330, 196, 420, 206, 480, 240, 514, 300, 522, 380, 508, 450, 505, 540, 505, 630, 498, 720, ...EXIT_R],
        climb: 150,
        exit: [0, 320],
      },
    ],
    magnet: { name: 'ЧЁРНАЯ ДЫРА', x: 360, y: 655, r: 84, pull: 2600 },
    saucer: { x: 210, y: 540, out: [260, 260] },
    orbit: [49, 560],
    flippers: FLIPPERS,
    lanes: laneSensors,
    missions: [
      { label: 'ОРБИТА ×3', ev: 'orbit', n: 3 },
      { label: 'РАКЕТА ×2', ev: 'ramp', n: 2 },
      { label: 'ЧЁРНАЯ ДЫРА', ev: 'magnet', n: 1 },
      { label: 'СПУТНИК 20', ev: 'spin', n: 20 },
      { label: 'МИР', ev: 'stands', n: 1 },
    ],
  },
];

export const tableOf = (id: string) => TABLES.find((t) => t.id === id) ?? TABLES[0];

// ---------------------------------------------------------------- рампы: путь и карман-въезд

const RAMP_HW = 26;
const RAMP_LIP = 22;
const RAMP_FRONT = 40;

/** Ломаная рампы целиком (от кармана до выхода) и накопленные длины. */
export function rampPath(r: RampDef): { pts: number[]; acc: number[] } {
  const pts = [...r.mouth, ...r.path];
  const acc = [0];
  for (let i = 2; i < pts.length; i += 2) acc.push(acc[acc.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return { pts, acc };
}
const rampCache = new Map<RampDef, { pts: number[]; acc: number[] }>();
const rp = (r: RampDef) => {
  let v = rampCache.get(r);
  if (!v) rampCache.set(r, (v = rampPath(r)));
  return v;
};

/** Точка и направление рампы на расстоянии s от кармана. */
export function rampAt(r: RampDef, s: number): [number, number, number, number] {
  const { pts, acc } = rp(r);
  let i = 1;
  while (i < acc.length - 1 && acc[i] < s) i++;
  const k = acc[i] > acc[i - 1] ? Math.max(0, Math.min(1, (s - acc[i - 1]) / (acc[i] - acc[i - 1]))) : 0;
  const ax = pts[(i - 1) * 2];
  const ay = pts[(i - 1) * 2 + 1];
  const bx = pts[i * 2];
  const by = pts[i * 2 + 1];
  const [dx, dy] = norm(bx - ax || 1e-9, by - ay);
  return [ax + (bx - ax) * k, ay + (by - ay) * k, dx, dy];
}
export const rampLen = (r: RampDef) => {
  const a = rp(r).acc;
  return a[a.length - 1];
};

/** Стенки кармана-въезда: две боковые и задняя губа (шар без разгона в неё упирается и скатывается). */
export function rampMouthWalls(r: RampDef): number[][] {
  const [mx, my] = r.mouth;
  const [dx, dy] = r.dir;
  const px = -dy;
  const py = dx;
  const side = (sg: number) => [mx + px * RAMP_HW * sg - dx * RAMP_FRONT, my + py * RAMP_HW * sg - dy * RAMP_FRONT, mx + px * RAMP_HW * sg + dx * RAMP_LIP, my + py * RAMP_HW * sg + dy * RAMP_LIP];
  const l = side(-1);
  const rr = side(1);
  return [
    [l[0], l[1], l[2], l[3], rr[2], rr[3], rr[0], rr[1]],
  ];
}

/** Все отрезки стола (стены, рогатки, карманы рамп, стойки, дверца жёлоба), без сбиваемых мишеней. */
export function wallsOf(t: TableDef): Wall[] {
  const out: Wall[] = [];
  const lines = [...t.walls, ...t.ramps.flatMap(rampMouthWalls)];
  for (const pl of lines) for (let i = 0; i + 3 < pl.length; i += 2) out.push({ ax: pl[i], ay: pl[i + 1], bx: pl[i + 2], by: pl[i + 3] });
  SLINGS.forEach(([ax, ay, bx, by], i) => out.push({ ax, ay, bx, by, kick: 650, sling: i }));
  // дверца жёлоба: шар снизу проходит, сверху — скатывается на поле
  const d: Vec = [32, -30];
  const l = Math.hypot(d[0], d[1]);
  out.push({ ax: 548, ay: 340, bx: 580, by: 308, n: [d[1] / l, -d[0] / l] });
  return out;
}

const cache = new Map<string, Wall[]>();
const wallsCached = (t: TableDef) => {
  let w = cache.get(t.id);
  if (!w) cache.set(t.id, (w = wallsOf(t)));
  return w;
};

// ---------------------------------------------------------------- партия

export function newGame(table: string): PbState {
  const t = tableOf(table);
  const st: PbState = {
    table: t.id,
    balls: [],
    flips: t.flippers.map((f) => ({ a: f.rest, w: 0 })),
    score: 0,
    ball: 0,
    left: 3,
    bonus: 0,
    mult: 1,
    lanes: t.lanes.map(() => false),
    targets: t.targets.map(() => true),
    stands: t.standups.map(() => false),
    spins: t.spinners.map(() => ({ a: 0, w: 0 })),
    kick: true,
    jackpot: false,
    saucerCount: 0,
    orbits: 0,
    ramps: 0,
    rampT: -99,
    mission: 0,
    mprog: 0,
    mlevel: 0,
    plunger: 0,
    inLane: false,
    save: 0,
    saveArmed: true,
    skill: 0,
    nudges: 0,
    nudgeT: 0,
    tilt: false,
    bumpLit: t.bumpers.map(() => 0),
    slingLit: [0, 0],
    standLit: t.standups.map(() => 0),
    extra: false,
    t: 0,
    wait: 0,
    over: false,
    msg: '',
    msgT: 0,
  };
  nextBall(st);
  return st;
}

/** Сохранение подходит этой версии логики (старые — без стоек и заданий — не берём). */
export const validSave = (s: unknown): s is PbState =>
  !!s && typeof s === 'object' && Array.isArray((s as PbState).balls) && Array.isArray((s as PbState).stands) && Array.isArray((s as PbState).spins) && typeof (s as PbState).mission === 'number';

function say(st: PbState, msg: string, t = 2) {
  st.msg = msg;
  st.msgT = t;
}

function nextBall(st: PbState) {
  st.ball++;
  st.left--;
  st.bonus = 0;
  st.tilt = false;
  st.nudges = 0;
  st.balls = [laneBall()];
  st.inLane = true;
  st.plunger = 0;
  st.save = 0;
  st.saveArmed = true;
  st.skill = (st.ball * 7 + st.score) % 4;
  say(st, `ШАР ${st.ball}`);
}

const laneBall = (): Ball => ({ x: 564, y: 1052 - BALL_R - 0.5, vx: 0, vy: 0, held: 0 });

function add(st: PbState, pts: number, bonus = 0) {
  if (st.tilt) return;
  st.score += pts;
  st.bonus += bonus;
}

/** Задание стола: событие засчитывается, если оно — цель текущего задания. */
function progress(st: PbState, t: TableDef, kind: MissionEv, ev: PbEvent[], n = 1) {
  if (st.tilt || !t.missions.length) return;
  const m = t.missions[st.mission % t.missions.length];
  if (m.ev !== kind) return;
  st.mprog += n;
  if (st.mprog < m.n) return;
  st.mprog = 0;
  st.mission++;
  const all = st.mission >= t.missions.length;
  add(st, 15000 * (st.mlevel + 1), 1500);
  say(st, `${m.label} — ЕСТЬ!`, 2.5);
  if (all) {
    st.mission = 0;
    st.mlevel++;
    add(st, 100000 * st.mlevel, 5000);
    say(st, 'СУПЕРДЖЕКПОТ!', 3);
  }
  ev.push({ k: 'mission', label: m.label, all });
}

/** Текущее задание для табло: подпись и сколько набрано. */
export function missionOf(st: PbState): { label: string; prog: number; n: number } | null {
  const t = tableOf(st.table);
  if (!t.missions.length) return null;
  const m = t.missions[st.mission % t.missions.length];
  return { label: m.label, prog: st.mprog, n: m.n };
}

// ---------------------------------------------------------------- геометрия

function closest(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + dx * t, ay + dy * t, t];
}

/** Пересекаются ли отрезки p0→p1 и a→b (для вертушки и проверки в тестах). */
export function crosses(p0x: number, p0y: number, p1x: number, p1y: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d1x = p1x - p0x;
  const d1y = p1y - p0y;
  const d2x = bx - ax;
  const d2y = by - ay;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const u = ((ax - p0x) * d2y - (ay - p0y) * d2x) / den;
  const v = ((ax - p0x) * d1y - (ay - p0y) * d1x) / den;
  return u > 0 && u <= 1 && v >= 0 && v <= 1;
}

/** Отскок шара по нормали n с упругостью e и трением вдоль; vs — скорость поверхности. Возвращает силу удара. */
function bounce(b: Ball, nx: number, ny: number, e: number, vsx = 0, vsy = 0): number {
  const rvx = b.vx - vsx;
  const rvy = b.vy - vsy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  // чем слабее удар, тем меньше упругость: шар не дребезжит, лёжа на флиппере
  const ee = -vn < 60 ? 0 : e;
  b.vx -= (1 + ee) * vn * nx;
  b.vy -= (1 + ee) * vn * ny;
  return -vn;
}

/** Столкновение с отрезком (радиус отрезка — rr): вытолкнуть шар, вернуть нормаль или null. */
function hitSeg(b: Ball, ax: number, ay: number, bx: number, by: number, rr = 0): Vec | null {
  const [cx, cy] = closest(b.x, b.y, ax, ay, bx, by);
  let dx = b.x - cx;
  let dy = b.y - cy;
  const d = Math.hypot(dx, dy);
  const R = BALL_R + rr;
  if (d >= R || d < 1e-9) return null;
  dx /= d;
  dy /= d;
  b.x = cx + dx * R;
  b.y = cy + dy * R;
  return [dx, dy];
}

export function flipperTip(f: FlipperDef, a: number): Vec {
  return [f.x + Math.cos(a) * f.len, f.y + Math.sin(a) * f.len];
}
const FLIP_R0 = 12;
const FLIP_R1 = 7;

/** Детерминированный «случай» по времени партии (выплёвывание магнита). */
const wobble = (t: number) => Math.sin(t * 7.31 + Math.sin(t * 2.17) * 3);

// ---------------------------------------------------------------- шаг

const FLIP_W = 26;

/** Шаг партии на dt секунд (обычно 1/60), внутри — подшаги.
 * trace — для тестов: после каждого подшага свободного шара (откуда пришёл, где стал). */
export function step(st: PbState, inp: PbInput, dt: number, trace?: (b: Ball, px: number, py: number) => void): PbEvent[] {
  const ev: PbEvent[] = [];
  if (st.over) return ev;
  const t = tableOf(st.table);
  st.t += dt;
  if (st.msgT > 0) st.msgT -= dt;
  st.bumpLit = st.bumpLit.map((v) => Math.max(0, v - dt));
  st.slingLit = st.slingLit.map((v) => Math.max(0, v - dt));
  st.standLit = st.standLit.map((v) => Math.max(0, v - dt));
  st.nudgeT = Math.max(0, st.nudgeT - dt);
  if (st.nudgeT <= 0) st.nudges = 0;

  // вертушки крутятся по инерции: очки за каждые пол-оборота
  st.spins.forEach((sp, i) => {
    if (sp.w === 0) return;
    const before = Math.floor(sp.a / Math.PI);
    sp.a += sp.w * dt;
    sp.w *= Math.exp(-dt * 1.4);
    const turns = Math.abs(Math.floor(sp.a / Math.PI) - before);
    for (let k = 0; k < turns; k++) {
      add(st, 100, 10);
      ev.push({ k: 'spin', i });
      progress(st, t, 'spin', ev);
    }
    if (Math.abs(sp.w) < 1.5) {
      // доворачивается плашмя
      const rest = Math.round(sp.a / Math.PI) * Math.PI;
      sp.a += (rest - sp.a) * Math.min(1, dt * 6);
      if (Math.abs(rest - sp.a) < 0.01) [sp.a, sp.w] = [rest, 0];
    }
  });

  // подсчёт бонуса между шарами
  if (st.wait > 0) {
    st.wait -= dt;
    if (st.wait <= 0) {
      if (st.left <= 0) {
        st.over = true;
        say(st, 'КОНЕЦ ИГРЫ', 99);
        ev.push({ k: 'over', score: st.score });
      } else nextBall(st);
    }
    return ev;
  }

  // флипперы: при TILT не работают
  t.flippers.forEach((f, i) => {
    const fs = st.flips[i];
    const want = !st.tilt && (f.side === 'L' ? inp.l : inp.r);
    const target = want ? f.up : f.rest;
    const d = target - fs.a;
    const sgn = Math.sign(d);
    const w = FLIP_W * (want ? 1 : 0.7);
    fs.w = Math.abs(d) < 1e-6 ? 0 : sgn * w;
    if (want && Math.abs(fs.a - f.rest) < 0.02 && Math.abs(d) > 0.1) ev.push({ k: 'flip', side: f.side, up: true });
  });
  // пружина
  if (st.inLane) {
    if (inp.pull) st.plunger = Math.min(1, st.plunger + dt * 1.1);
    else if (st.plunger > 0) {
      const b = st.balls.find((x) => x.x > 548 && x.y > 1000);
      if (b) {
        const p = st.plunger;
        b.vy = -(1050 + 1700 * p);
        ev.push({ k: 'launch', st: p });
        if (st.saveArmed) st.save = Math.max(st.save, 8);
      }
      st.plunger = 0;
    }
  }

  // подтолкнуть
  if (inp.nudge && !st.tilt) {
    st.nudges++;
    st.nudgeT = 3;
    for (const b of st.balls) {
      if (b.ramp != null || b.held > 0) continue;
      b.vx += (b.x < 284 ? 1 : -1) * 90;
      b.vy -= 160;
    }
    if (st.nudges >= 3) {
      st.tilt = true;
      st.jackpot = false;
      say(st, 'TILT', 3);
      ev.push({ k: 'tilt' });
    } else if (st.nudges === 2) {
      say(st, 'ОСТОРОЖНО', 1.5);
      ev.push({ k: 'warn' });
    }
  }

  // шары на рампах едут по своей дорожке
  for (const b of st.balls) {
    if (b.ramp == null) continue;
    const R = t.ramps[b.ramp];
    const L = rampLen(R);
    let rs = b.rs ?? 0;
    let rv = b.rv ?? 0;
    if (rs < R.climb) rv -= 2700 * dt;
    else rv = Math.min(1500, Math.max(rv, 480) + 500 * dt);
    rs += rv * dt;
    if (rs <= 0) {
      // не хватило разгона — скатывается обратно из кармана
      b.x = R.mouth[0] - R.dir[0] * 4;
      b.y = R.mouth[1] - R.dir[1] * 4;
      b.vx = R.dir[0] * Math.min(-120, rv);
      b.vy = R.dir[1] * Math.min(-120, rv);
      b.ramp = undefined;
      b.cool = 0.4;
      ev.push({ k: 'rampBack', i: t.ramps.indexOf(R) });
    } else if (rs >= L) {
      const [ex, ey] = rampAt(R, L);
      b.x = ex;
      b.y = ey;
      b.vx = R.exit[0];
      b.vy = R.exit[1];
      b.ramp = undefined;
      b.cool = 0.4;
      const i = t.ramps.indexOf(R);
      const combo = st.t - st.rampT < 6;
      st.rampT = st.t;
      st.ramps++;
      add(st, combo ? 10000 : 3000, 300);
      say(st, combo ? 'КОМБО!' : R.name, 1.5);
      ev.push({ k: 'ramp', i, combo });
      progress(st, t, 'ramp', ev);
    } else {
      const [x, y] = rampAt(R, rs);
      b.x = x;
      b.y = y;
      b.rs = rs;
      b.rv = rv;
    }
  }

  const h = dt / SUB;
  const walls = wallsCached(t);
  let wallHit = 0;
  let flipHit = 0;
  for (let k = 0; k < SUB; k++) {
    // флипперы поворачиваются
    t.flippers.forEach((f, i) => {
      const fs = st.flips[i];
      const lo = Math.min(f.rest, f.up);
      const hi = Math.max(f.rest, f.up);
      fs.a += fs.w * h;
      if (fs.a <= lo) [fs.a, fs.w] = [lo, fs.w < 0 ? 0 : fs.w];
      if (fs.a >= hi) [fs.a, fs.w] = [hi, fs.w > 0 ? 0 : fs.w];
    });
    for (const b of st.balls) {
      if (b.held > 0 || b.ramp != null) continue;
      const px = b.x;
      const py = b.y;
      b.vy += G * h;
      // круг закручивает, магнит тянет
      if (t.disc) {
        const D = t.disc;
        const dx = b.x - D.x;
        const dy = b.y - D.y;
        const d = Math.hypot(dx, dy);
        if (d < D.r && d > 1e-6) {
          b.vx += (-dy / d) * D.spin * h;
          b.vy += (dx / d) * D.spin * h;
        }
      }
      if (t.magnet && !b.cool) {
        const M = t.magnet;
        const dx = M.x - b.x;
        const dy = M.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < M.r && d > 1e-6) {
          const a = M.pull * (1 - d / M.r) + 300;
          b.vx += (dx / d) * a * h;
          b.vy += (dy / d) * a * h;
        }
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      // стены, рогатки, карманы рамп, дверца
      for (const w of walls) {
        const [cx, cy] = closest(b.x, b.y, w.ax, w.ay, w.bx, w.by);
        let dx = b.x - cx;
        let dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= BALL_R || d < 1e-9) continue;
        if (w.n && dx * w.n[0] + dy * w.n[1] < 0) continue;
        dx /= d;
        dy /= d;
        b.x = cx + dx * BALL_R;
        b.y = cy + dy * BALL_R;
        const s = bounce(b, dx, dy, E_WALL);
        if (w.kick != null && s > 40 && w.sling != null) {
          // рогатка бьёт только лицом (наружу от треугольника)
          b.vx += dx * w.kick;
          b.vy += dy * w.kick;
          st.slingLit[w.sling] = 0.15;
          add(st, 10, 10);
          ev.push({ k: 'sling', i: w.sling });
        } else wallHit = Math.max(wallHit, s);
      }
      // мишени-стойки: упругие, загораются
      t.standups.forEach(([ax, ay, bx, by], i) => {
        const n = hitSeg(b, ax, ay, bx, by, 3);
        if (!n) return;
        const s = bounce(b, n[0], n[1], 0.55);
        if (s < 80) return;
        if (st.standLit[i] > 0.1) return;
        st.standLit[i] = 0.25;
        const first = !st.stands[i];
        st.stands[i] = true;
        add(st, first ? 500 : 100, first ? 50 : 10);
        const all = st.stands.every(Boolean);
        if (all) {
          st.stands = st.stands.map(() => false);
          st.kick = true;
          add(st, 7500, 500);
          say(st, 'ОТБОЙНИК ГОРИТ');
          progress(st, t, 'stands', ev);
        }
        ev.push({ k: 'stand', i, all });
      });
      // сбиваемые мишени
      t.targets.forEach((tg, i) => {
        if (!st.targets[i]) return;
        const n = hitSeg(b, tg[0], tg[1], tg[2], tg[3], 3);
        if (!n) return;
        bounce(b, n[0], n[1], 0.3);
        st.targets[i] = false;
        add(st, 250, 50);
        const all = st.targets.every((x) => !x);
        if (all) {
          add(st, 5000, 500);
          st.jackpot = true;
          say(st, 'ДЖЕКПОТ ГОРИТ');
          st.targets = st.targets.map(() => true);
          progress(st, t, 'targets', ev);
        }
        ev.push({ k: 'target', i, all });
      });
      // столбики
      for (const [qx, qy, pr] of t.posts) {
        let dx = b.x - qx;
        let dy = b.y - qy;
        const d = Math.hypot(dx, dy);
        const R = BALL_R + pr;
        if (d >= R || d < 1e-9) continue;
        dx /= d;
        dy /= d;
        b.x = qx + dx * R;
        b.y = qy + dy * R;
        wallHit = Math.max(wallHit, bounce(b, dx, dy, 0.5));
      }
      // грибки: толкают шар от себя
      t.bumpers.forEach(([qx, qy], i) => {
        let dx = b.x - qx;
        let dy = b.y - qy;
        const d = Math.hypot(dx, dy);
        const R = BALL_R + 26;
        if (d >= R || d < 1e-9) return;
        dx /= d;
        dy /= d;
        b.x = qx + dx * R;
        b.y = qy + dy * R;
        bounce(b, dx, dy, 0.2);
        const vn = b.vx * dx + b.vy * dy;
        const kick = 850;
        if (vn < kick) {
          b.vx += dx * (kick - vn);
          b.vy += dy * (kick - vn);
        }
        if (st.bumpLit[i] < 0.08) {
          st.bumpLit[i] = 0.18;
          add(st, 100, 20);
          ev.push({ k: 'bumper', i });
          progress(st, t, 'bumper', ev);
        }
      });
      // флипперы: капсула от оси к концу, радиус сужается
      t.flippers.forEach((f, i) => {
        const fs = st.flips[i];
        const [tx, ty] = flipperTip(f, fs.a);
        const [cx, cy, u] = closest(b.x, b.y, f.x, f.y, tx, ty);
        const fr = FLIP_R0 + (FLIP_R1 - FLIP_R0) * u;
        let dx = b.x - cx;
        let dy = b.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= BALL_R + fr || d < 1e-9) return;
        dx /= d;
        dy /= d;
        b.x = cx + dx * (BALL_R + fr);
        b.y = cy + dy * (BALL_R + fr);
        // скорость поверхности флиппера в точке касания: ω × r
        const rx = cx + dx * fr - f.x;
        const ry = cy + dy * fr - f.y;
        const vsx = -fs.w * ry;
        const vsy = fs.w * rx;
        flipHit = Math.max(flipHit, bounce(b, dx, dy, E_FLIP, vsx, vsy));
      });
      // вертушки: шар проходит сквозь и раскручивает их
      t.spinners.forEach(([ax, ay, bx, by], i) => {
        if (!crosses(px, py, b.x, b.y, ax, ay, bx, by)) return;
        const [nx, ny] = norm(-(by - ay), bx - ax);
        const vn = b.vx * nx + b.vy * ny;
        const sp = st.spins[i];
        sp.w = Math.sign(vn || 1) * Math.min(70, Math.abs(sp.w) + Math.abs(vn) / 22);
        b.vx *= 0.94;
        b.vy *= 0.94;
      });
      const v = Math.hypot(b.vx, b.vy);
      if (v > VMAX) {
        b.vx *= VMAX / v;
        b.vy *= VMAX / v;
      }
      trace?.(b, px, py);
    }
  }
  if (wallHit > 250) ev.push({ k: 'wall', st: Math.round(wallHit) });
  if (flipHit > 150) ev.push({ k: 'flipHit', st: Math.round(flipHit) });

  // датчики: дорожки, лунка, магнит, рампы, орбита, отбойник, жёлоб, сток
  if (st.save > 0 && !st.inLane) st.save -= dt;
  for (const b of st.balls) {
    if (b.held > 0) {
      b.held -= dt;
      if (b.held <= 0 && b.rel) {
        [b.x, b.y, b.vx, b.vy] = b.rel;
        b.rel = undefined;
        b.cool = 0.8;
        if (t.magnet && Math.hypot(b.x - t.magnet.x, b.y - t.magnet.y) < 30) ev.push({ k: 'magnet', out: true });
      }
      continue;
    }
    if (b.ramp != null) continue;
    if (b.cool) b.cool = Math.max(0, b.cool - dt);
    if (b.orb) b.orb = Math.max(0, b.orb - dt);
    t.lanes.forEach(([lx, ly], i) => {
      if (Math.abs(b.x - lx) < 18 && Math.abs(b.y - ly) < 14 && b.lane !== i) {
        b.lane = i;
        const skill = st.save > 6 && i === st.skill && st.balls.length === 1;
        if (skill) {
          add(st, 5000);
          say(st, 'МАСТЕРСКИЙ ПУСК');
          ev.push({ k: 'skill' });
        }
        if (!st.lanes[i]) {
          st.lanes[i] = true;
          add(st, 500, 100);
        } else add(st, 100, 20);
        const all = st.lanes.every(Boolean);
        if (all) {
          st.lanes = st.lanes.map(() => false);
          if (st.mult < 5) st.mult++;
          say(st, `БОНУС ×${st.mult}`);
          if (st.mult === 5 && !st.extra) {
            st.extra = true;
            st.left++;
            say(st, 'ПРИЗОВОЙ ШАР');
            ev.push({ k: 'extra' });
          }
          progress(st, t, 'lanes', ev);
        }
        ev.push({ k: 'lane', i, all });
      }
    });
    if (b.y > 230) b.lane = -1;
    // круг: очко за каждый заезд
    if (t.disc) {
      const inside = Math.hypot(b.x - t.disc.x, b.y - t.disc.y) < t.disc.r - 4;
      if (inside && !b.disc) {
        add(st, 250, 25);
        ev.push({ k: 'disc' });
        progress(st, t, 'disc', ev);
      }
      b.disc = inside;
    }
    // рампа: карман ловит шар, летящий внутрь
    if (!b.cool)
      t.ramps.forEach((R, i) => {
        if (b.ramp != null) return;
        const dx = b.x - R.mouth[0];
        const dy = b.y - R.mouth[1];
        const vin = b.vx * R.dir[0] + b.vy * R.dir[1];
        if (dx * dx + dy * dy < 20 * 20 && vin > 150) {
          b.ramp = i;
          b.rs = 0;
          b.rv = Math.min(1700, vin);
          b.vx = 0;
          b.vy = 0;
          ev.push({ k: 'rampIn', i });
        }
      });
    if (b.ramp != null) continue;
    // магнит: поймал — держит и выплёвывает вниз
    if (t.magnet && !b.cool) {
      const M = t.magnet;
      if (Math.hypot(b.x - M.x, b.y - M.y) < 14) {
        const a = Math.PI / 2 + wobble(st.t) * 1.05;
        b.held = 1.4;
        b.x = M.x;
        b.y = M.y;
        b.vx = 0;
        b.vy = 0;
        b.rel = [M.x + Math.cos(a) * 20, M.y + Math.sin(a) * 20, Math.cos(a) * 700, Math.sin(a) * 700];
        add(st, 3000, 300);
        say(st, M.name, 1.4);
        ev.push({ k: 'magnet', out: false });
        progress(st, t, 'magnet', ev);
        continue;
      }
    }
    // лунка: ловит, держит и выплёвывает
    const sx = b.x - t.saucer.x;
    const sy = b.y - t.saucer.y;
    if (!b.cool && sx * sx + sy * sy < 13 * 13) {
      b.held = 1.1;
      b.vx = 0;
      b.vy = 0;
      b.x = t.saucer.x;
      b.y = t.saucer.y;
      b.rel = [t.saucer.x + Math.sign(t.saucer.out[0]) * 4, t.saucer.y, t.saucer.out[0], t.saucer.out[1]];
      st.saucerCount++;
      const jackpot = st.jackpot;
      if (jackpot) {
        st.jackpot = false;
        add(st, 25000, 1000);
        say(st, 'ДЖЕКПОТ!');
      } else add(st, 1000, 200);
      const multiball = st.saucerCount % 3 === 0 && st.balls.length === 1 && !st.tilt;
      if (multiball) {
        say(st, 'МУЛЬТИБОЛ!');
        st.balls.push(laneBall());
        st.balls[st.balls.length - 1].vy = -2400;
        st.save = Math.max(st.save, 10);
      }
      ev.push({ k: 'saucer', jackpot, multiball });
      progress(st, t, 'saucer', ev);
    }
    if (t.orbit) {
      if (!b.orb && Math.abs(b.x - t.orbit[0]) < 26 && Math.abs(b.y - t.orbit[1]) < 20 && Math.abs(b.vy) > 300) {
        b.orb = 1;
        st.orbits++;
        add(st, 2000 * Math.min(4, st.orbits), 300);
        say(st, `ОРБИТА ${st.orbits}`, 1.5);
        ev.push({ k: 'orbit' });
        progress(st, t, 'orbit', ev);
      }
    }
    // отбойник в левом ауте: горит — выбивает шар обратно вверх
    if (st.kick && !st.tilt && Math.abs(b.x - KICKBACK[0]) < 20 && Math.abs(b.y - KICKBACK[1]) < 22 && b.vy > 0) {
      st.kick = false;
      b.x = KICKBACK[0];
      b.vx = 30;
      b.vy = -1750;
      add(st, 1000);
      say(st, 'ОТБОЙНИК', 1.2);
      ev.push({ k: 'kickback' });
    }
  }
  st.inLane = st.balls.some((b) => b.x > 548 && b.y > 980 && Math.abs(b.vy) < 30);

  // «поиск шара», как у настоящих автоматов: шар замер не в жёлобе и не на поднятом флиппере — стол его толкает
  for (const b of st.balls) {
    const onFlip = (inp.l || inp.r) && b.y > 900;
    if (b.held > 0 || b.ramp != null || b.x > 548 || onFlip || Math.hypot(b.vx, b.vy) > 40) b.still = 0;
    else b.still = (b.still ?? 0) + dt;
    if ((b.still ?? 0) > 4) {
      b.still = 0;
      b.vx = b.x < 284 ? 380 : -380;
      b.vy = -520;
      ev.push({ k: 'wall', st: 400 });
    }
  }

  // сток
  const drained = st.balls.filter((b) => b.y > TH + 40);
  if (drained.length) {
    st.balls = st.balls.filter((b) => b.y <= TH + 40);
    for (let i = 0; i < drained.length; i++) {
      if (!st.balls.length && st.save > 0 && !st.tilt) {
        // спасение шара: обратно в жёлоб
        st.balls.push(laneBall());
        say(st, 'ШАР СПАСЁН');
        st.save = 0;
        st.saveArmed = false;
        ev.push({ k: 'drain', saved: true });
      } else if (!st.balls.length) {
        const total = st.tilt ? 0 : st.bonus * st.mult;
        st.score += total;
        st.lanes = st.lanes.map(() => false);
        st.mult = 1;
        st.jackpot = false;
        st.wait = 2.2;
        say(st, st.tilt ? 'TILT' : `БОНУС ${total}`, 2.2);
        ev.push({ k: 'drain', saved: false });
        ev.push({ k: 'bonus', total });
      }
    }
  }
  return ev;
}

/** Смена горящих дорожек флиппером (как на настоящих столах): сдвиг по кругу. */
export function laneShift(st: PbState, dir: -1 | 1) {
  if (st.tilt || st.over) return;
  const n = st.lanes.length;
  st.lanes = st.lanes.map((_, i) => st.lanes[(i - dir + n) % n]);
}
