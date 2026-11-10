/* Чиж — правила партии в реальном времени (без DOM: их гоняют сервер, боты и тесты). Дворовая игра: в меловом коне
 * (круг Ø 1 м или квадрат-«город») лежит чиж — палочка 14 см с заточенными концами. Бьющий бьёт битой по концу —
 * чиж подлетает — и вторым ударом, пока он в воздухе, отбивает его в поле («подбил — бей!»: важно попасть в момент).
 * Водящие (все остальные, каждый сам за себя) ловят чижа с лёта — поймал, сам и бьёт. Не поймали — кто первый добежал
 * до чижа, бросает его с места падения обратно в кон; бьющий может отбить бросок битой. Попал в кон — бросивший бьёт.
 * Не попал — бьющий добивает чижа с того места, где он лежит (подбил — ударил), и в конце кона расстояние от кона
 * до чижа меряют битой: сколько бит — столько очков. Три промаха подряд (чиж не улетел за черту) — бьёт следующий.
 * Вариант «Город»: квадрат, очко за каждый удар за черту, без добиваний; чиж упал в город — очки этого выхода сгорают.
 *
 * Шаг симуляции — TICK_MS, физика медленнее жизни во столько, сколько выбрано «Скоростью игры». Ввод места: куда бежать
 * (оси игры: x вбок, y от кона в поле), счётчики разовых действий — новое значение счётчика = нажатие. */
import { applySpeed, cleanSpeed } from '../../core/realtime';
import { BODY, dash, drive, dsSpeed, dtScale, separate, slowmo } from '../../core/dvorsport/sim';
import { body, fly, MAT, sample, type Body, type BodyFrame, type BodyMat } from '../../core/dvorsport/body';
import type { Options, Rng } from '../../core/types';

export const TICK_MS = 1000 / 60;
/** Мерка — длина биты, м. */
export const BAT = 0.6;
export const CH_R = 0.013;
/** Чиж по утоптанной земле: падает и почти сразу встаёт (острые концы втыкаются). */
export const CH_MAT: BodyMat = { ...MAT.chizh, roll: 7, scrub: 0.65 };
/** Бег (водящие и бьющий одинаково) — как в жизни (core/dvorsport/sim.ts), рывок — там же. */
export const VR = BODY.run;
/** Подбив: чиж с земли вверх (ударили по концу). */
export const POP = { vz: 4.0, vy: 0.22, z0: 0.05, spin: 16 };
/** Удар по летящему чижу: на каком расстоянии от бьющего, на какой высоте (лучше всего — best, «пояс»). */
export const SWING = { reach: 0.95, z0: 0.2, z1: 1.35, best: 0.7, span: 0.6 };
/** Ловля: сама — чиж влетел в руки; с кнопкой «Ловить» — дальше; окно кнопки, с. */
export const CATCH = { auto: 0.3, reach: 1.0, z0: 0.15, z1: 2.1, win: 0.45, hand: 1.3 };
/** Отбить бросок водящего: дотягивается битой. */
export const DEFEND = { reach: 1.05, z0: 0.08, z1: 1.7 };
/** Подобрать лежащего чижа; подбить чижа на добивании — с какого расстояния. */
export const GRAB = 0.7;
export const BONUS_REACH = 0.85;
/** Добивание слабее удара из кона. */
export const BONUS_K = 0.7;
/** Ожидания, с: бьющий не подбил, водящие не подобрали, держащий не бросил, бьющий не добил. */
export const WAIT = { tee: 45, field: 22, hold: 15, bonus: 22 };
/** Поле, по которому можно бегать (x, y). */
export const BOUND = { x: 24, y0: -8, y1: 60 };
/** Края пустыря: дальше чиж не улетит (гаражи, забор, кусты) — отскакивает и ложится. */
export const WALLS = { x0: -BOUND.x, x1: BOUND.x, y0: BOUND.y0, y1: BOUND.y1, wall: 0.25 };
/** Где стоит бьющий у кона (слева от чижа, лицом в поле). */
export const BATTER_SPOT: [number, number] = [-0.62, -0.12];
/** Где ждут водящие перед ударом (по номеру среди водящих). */
const FIELD_SPOTS: [number, number][] = [
  [-4, 11],
  [5, 16],
  [-7, 21],
  [2, 25],
  [8, 9],
];

export type Shape = 'circle' | 'square';

export interface Cfg {
  n: number;
  /** Кон: круг (радиус r) или квадрат-город (полсторона r). */
  shape: Shape;
  r: number;
  /** Черта: ближе неё отбитый чиж — промах. */
  line: number;
  /** Попыток подбить и отбить за черту. */
  tries: number;
  /** Добиваний после промаха водящего. */
  bonus: number;
  /** Счёт: мерками биты (расстояние) или по удару (очко за чижа за чертой). */
  score: 'merki' | 'hits';
  /** Чиж попал в город — очки этого выхода сгорают. */
  burn: boolean;
  target: number;
  maxKons: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));
export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function cfgFrom(o: Options, n = 3): Cfg {
  const gorod = o.kon === 'square';
  const score = o.score === 'hits' ? 'hits' : 'merki';
  return {
    n: clampI(n, 2, 6),
    shape: gorod ? 'square' : 'circle',
    r: gorod ? 0.4 : 0.5,
    line: gorod ? 4 : 3,
    tries: clampI(Number(o.tries ?? 3), 1, 5),
    bonus: score === 'hits' ? 0 : clampI(Number(o.bonus ?? 2), 0, 3),
    score,
    burn: o.burn === true || o.burn === 'yes',
    target: score === 'hits' ? clampI(Number(o.targetHits ?? 10), 3, 50) : clampI(Number(o.target ?? 200), 20, 1000),
    maxKons: 160,
  };
}

/** Чиж лежит в коне. */
export const inKon = (c: Cfg, x: number, y: number) => (c.shape === 'circle' ? Math.hypot(x, y) < c.r : Math.abs(x) < c.r && Math.abs(y) < c.r);
/** Мерок от кона до чижа. */
export const merki = (x: number, y: number) => Math.floor(Math.hypot(x, y) / BAT);

// ---------------------------------------------------------------- полёты

const fcache = new Map<string, { frames: BodyFrame[]; land: number; t: number; rest: [number, number, number] }>();
/** Полёт чижа с кадрами (общий для комнаты, ботов и экрана), с кэшем: land — когда коснулся земли, t — когда лёг. */
export function chFlight(b0: Body) {
  const key = `${b0.x},${b0.y},${b0.z},${b0.vx},${b0.vy},${b0.vz},${b0.w}`;
  let f = fcache.get(key);
  if (!f) {
    const r = fly(b0, { mat: CH_MAT, frameDt: 1 / 60, maxT: 8, walls: WALLS });
    f = { frames: r.frames, land: r.land?.t ?? r.t, t: r.t, rest: [r3(r.body.x), r3(r.body.y), r3(r.body.a % (Math.PI * 2))] };
    if (fcache.size > 400) fcache.clear();
    fcache.set(key, f);
  }
  return f;
}

const round = (b: Body): Body => ({ ...b, x: r3(b.x), y: r3(b.y), z: r3(b.z), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz) });

/** Подбив: чиж с земли (x, y) вверх; лёгкий наклон в сторону удара (dir — направление в поле). */
export function popBody(x: number, y: number, dir = 0): Body {
  const b = body(x, y, POP.z0, CH_R);
  return round({ ...b, vx: POP.vy * Math.sin(dir), vy: POP.vy * Math.cos(dir), vz: POP.vz, w: POP.spin });
}

/** Скорость удара в полную силу и точно в «пояс»: чиж улетает метров на 27. */
let vmaxHit = 0;
export function vMaxHit(): number {
  if (vmaxHit) return vmaxHit;
  let lo = 6;
  let hi = 60;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    const r = fly(hitRaw(0, 0, SWING.best, m, 0, SWING.best), { mat: CH_MAT, frameDt: 0 });
    if (r.body.y < 27) lo = m;
    else hi = m;
  }
  return (vmaxHit = (lo + hi) / 2);
}

function hitRaw(x: number, y: number, z: number, v: number, yaw: number, zHit: number): Body {
  // ударил ниже «пояса» — чиж уходит выше, выше — ниже
  const pitch = clamp(0.4 + (SWING.best - zHit) * 0.35, 0.15, 0.7);
  const c = Math.cos(pitch);
  return { ...body(x, y, z, CH_R), vx: v * c * Math.sin(yaw), vy: v * c * Math.cos(yaw), vz: v * Math.sin(pitch), w: 22 };
}

/** Качество удара по высоте чижа: 1 — точно в пояс, 0 — краем окна; null — мимо (низко/высоко). */
export function hitQuality(z: number): number | null {
  if (z < SWING.z0 || z > SWING.z1) return null;
  return clamp(1 - Math.abs(z - SWING.best) / SWING.span, 0, 1);
}

/** Удар по летящему чижу: сила 0…1, куда (yaw от направления «в поле»), где чиж сейчас и куда он шёл (vz > 0 — вверх). */
export function hitBody(x: number, y: number, z: number, vz: number, pow: number, yaw: number, q: number, k = 1): Body {
  // рано (чиж ещё летит вверх) — тянет влево, поздно — вправо
  const err = (1 - q) * 0.32 * (vz > 0 ? -1 : 1);
  const v = vMaxHit() * k * (0.35 + 0.65 * clamp(pow, 0, 1)) * (0.5 + 0.5 * q);
  return round(hitRaw(x, y, z, v, clamp(yaw + err, -1.2, 1.2), z));
}

/** Направление «прочь от кона» из точки (для добиваний): 0 — вдоль поля. */
export const awayYaw = (x: number, y: number) => (Math.hypot(x, y) < 1 ? 0 : Math.atan2(x, y));
/** Направление на кон из точки. */
export const yawToKon = (x: number, y: number) => Math.atan2(-x, -y);

/** Сколько нужно скорости броска (навесом), чтобы чиж лёг ровно в кон с места (x, y). */
const THROW_PITCH = 0.6;
const vcache = new Map<number, number>();
export function vToKon(d: number): number {
  const k = Math.round(d * 10);
  const got = vcache.get(k);
  if (got) return got;
  let lo = 1;
  let hi = 40;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    const r = fly(throwRaw(0, k / 10, m, Math.PI), { mat: CH_MAT, frameDt: 0 });
    if (r.body.y > 0) lo = m;
    else hi = m;
  }
  const v = (lo + hi) / 2;
  vcache.set(k, v);
  return v;
}
/** Из руки — с высоты плеча. */
function throwRaw(x: number, y: number, v: number, yaw: number): Body {
  const c = Math.cos(THROW_PITCH);
  return { ...body(x, y, 1.5, CH_R), vx: v * c * Math.sin(yaw), vy: v * c * Math.cos(yaw), vz: v * Math.sin(THROW_PITCH), w: 12 };
}
/** Бросок водящего с места (x, y) в сторону кона: сила 0…1 (0,5 — ровно в кон), отклонение yaw. Дальше 26 м не докинуть. */
export function throwBody(x: number, y: number, pow: number, yaw: number): Body {
  const d = Math.hypot(x, y);
  const v = Math.min(23, vToKon(d) * (0.55 + 0.9 * clamp(pow, 0, 1)));
  const base = yawToKon(x, y);
  return round(throwRaw(x, y, v, base + clamp(yaw, -0.6, 0.6)));
}

/** Отбил бросок битой: чиж уходит туда, откуда прилетел, вполсилы. */
export function defendBody(x: number, y: number, z: number, vx: number, vy: number): Body {
  const yaw = Math.atan2(-vx, -vy);
  const v = 12;
  const pitch = 0.35;
  const c = Math.cos(pitch);
  return round({ ...body(x, y, Math.max(0.2, z), CH_R), vx: v * c * Math.sin(yaw), vy: v * c * Math.cos(yaw), vz: v * Math.sin(pitch), w: 18 });
}

// ---------------------------------------------------------------- состояние

export interface Man {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dash: number;
  cd: number;
  /** Очки в банке и очки этого выхода (счёт «по удару»: сгорают, если чиж попал в город). */
  score: number;
  run: number;
}

export type ChMode = 'tee' | 'pop' | 'fly' | 'ground' | 'held' | 'back';

export interface Ch {
  mode: ChMode;
  x: number;
  y: number;
  a: number;
  /** В полёте: откуда, когда; кто бросил (back) и чей удар (fly: hit — удар бьющего, def — отбил бросок). */
  b0?: Body;
  t0?: number;
  kind?: 'hit' | 'def';
}

export interface In {
  /** Куда бежать — оси игры (x вбок, y в поле), длина ≤ 1. */
  mx: number;
  my: number;
  /** Подбить (бьющий: сила и куда бить) или бросить в кон (водящий с чижом). */
  th?: { n: number; pow: number; yaw: number };
  /** Удар битой (по подбитому чижу или отбить бросок), «ловить», рывок, «считать» — счётчики. */
  s?: number;
  c?: number;
  d?: number;
  st?: number;
  sp?: number;
  /** Обучение первой партии: «подожди» — пока игрок не сделает шаг, время стоит (только против компьютера). */
  hold?: boolean;
}

export type Phase = 'tee' | 'pop' | 'fly' | 'field' | 'back' | 'bonus' | 'pause';

export type Event =
  | { k: 'pop'; who: number; bonus: boolean }
  | { k: 'hit'; who: number; q: number }
  | { k: 'whiff'; who: number }
  | { k: 'miss'; who: number; left: number; short: boolean }
  | { k: 'land'; x: number; y: number }
  | { k: 'point'; who: number; run: number }
  | { k: 'catch'; who: number; batter: number }
  | { k: 'pick'; who: number }
  | { k: 'throw'; who: number }
  | { k: 'def'; who: number }
  | { k: 'kon'; who: number; burnt: number }
  | { k: 'nokon'; x: number; y: number }
  | { k: 'score'; who: number; pts: number; d: number }
  | { k: 'out'; who: number; next: number }
  | { k: 'batter'; who: number }
  | { k: 'slow'; who: number }
  | { k: 'end'; winners: number[] };

export interface State {
  cfg: Cfg;
  seats: number[];
  t: number;
  speed: number;
  spSeen?: number[];
  phase: Phase;
  /** С каких пор идёт фаза (ожидания). */
  phaseT: number;
  /** Пауза: до когда и что потом (tee — та же попытка заново, kon — новый кон, swap — новый бьющий). */
  until: number;
  next: 'tee' | 'kon' | 'swap' | null;
  swapTo: number;
  men: Man[];
  ch: Ch;
  batter: number;
  /** Порядок: кто бьёт следующим, если бьющий выбыл промахами. */
  order: number[];
  /** Попыток осталось (у кона) и добиваний; номер удара в коне (0 — из кона). */
  tries: number;
  strikes: number;
  strike: number;
  /** Бьющий уже махнул по этому подбитому чижу (отбивал этот бросок). */
  swung: boolean;
  /** Прицел подбитого чижа: сила и направление удара (выбраны при подбиве). */
  aim?: { pow: number; yaw: number };
  /** Чиж в руке у водящего. */
  holder: number;
  /** Кто бросил в кон. */
  thrower: number;
  /** До каких пор «ловит» водящий (кнопка). */
  catchT: number[];
  kons: number;
  seen: { th: number; s: number; c: number; d: number; st: number }[];
  over: boolean;
  winners: number[];
  shot?: boolean;
  demo?: boolean;
  /** Замедление на хорошем ударе и ловле (sim.slowmo). */
  slowUntil?: number;
  slowK?: number;
}

export const idleInput = (): In => ({ mx: 0, my: 0 });

export function cleanInput(raw: unknown): In | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const out: In = { mx: clamp(num(r.mx), -1, 1), my: clamp(num(r.my), -1, 1) };
  const th = r.th as Record<string, unknown> | undefined;
  if (th && typeof th === 'object') out.th = { n: Math.round(num(th.n)), pow: clamp(num(th.pow), 0, 1), yaw: clamp(num(th.yaw), -1, 1) };
  for (const k of ['s', 'c', 'd', 'st'] as const) if (r[k] != null) out[k] = Math.round(num(r[k]));
  const sp = cleanSpeed(r.sp);
  if (sp != null) out.sp = sp;
  if (r.hold === true) out.hold = true;
  return out;
}

export function fieldSpot(k: number): [number, number] {
  return FIELD_SPOTS[k % FIELD_SPOTS.length];
}

export function newGame(o: Options, seats: number[], speed = dsSpeed(o)): State {
  const c = cfgFrom(o, seats.length);
  const n = c.n;
  const s: State = {
    cfg: c,
    seats: seats.slice(0, n),
    t: 0,
    speed,
    phase: 'tee',
    phaseT: 0,
    until: 0,
    next: null,
    swapTo: -1,
    men: Array.from({ length: n }, () => ({ x: 0, y: 0, vx: 0, vy: 0, dash: 0, cd: 0, score: 0, run: 0 })),
    ch: { mode: 'tee', x: 0, y: 0, a: 0 },
    batter: 0,
    order: Array.from({ length: n }, (_, i) => i),
    tries: c.tries,
    strikes: 0,
    strike: 0,
    swung: false,
    holder: -1,
    thrower: -1,
    catchT: Array.from({ length: n }, () => -1),
    kons: 0,
    seen: Array.from({ length: n }, () => ({ th: 0, s: 0, c: 0, d: 0, st: 0 })),
    over: false,
    winners: [],
  };
  regroup(s);
  return s;
}

/** Все по местам: бьющий у кона, водящие в поле, чиж в кон. */
export function regroup(s: State) {
  let k = 0;
  s.men.forEach((m, i) => {
    const [x, y] = i === s.batter ? BATTER_SPOT : fieldSpot(k++);
    m.x = x;
    m.y = y;
    m.vx = m.vy = 0;
  });
  s.ch = { mode: 'tee', x: 0, y: 0, a: 0 };
}

/** Очки игрока с учётом этого выхода. */
export const total = (m: Man) => m.score + m.run;

/** Где чиж сейчас (оси игры, с высотой) — для комнаты, ботов и экрана. */
export function chAt(s: State, t = s.t): [number, number, number, number] {
  const ch = s.ch;
  if (ch.b0 && ch.t0 != null && (ch.mode === 'pop' || ch.mode === 'fly' || ch.mode === 'back')) {
    const f = chFlight(ch.b0);
    const fr = sample(f.frames, t - ch.t0);
    return [fr[1], fr[2], fr[3], fr[4]];
  }
  return [ch.x, ch.y, CH_R, ch.a];
}

/** Где ловить отбитого чижа: точка спуска на высоте груди (кольцо водящим), иначе — где коснётся земли. */
export function catchSpot(b0: Body): [number, number] {
  const f = chFlight(b0);
  let top = 0;
  for (const fr of f.frames) {
    if (fr[0] > f.land) break;
    top = Math.max(top, fr[3]);
    if (top > 1.6 && fr[3] <= 1.3) return [fr[1], fr[2]];
  }
  const fr = sample(f.frames, f.land);
  return [fr[1], fr[2]];
}

/** Чиж летит и ещё не коснулся земли (его можно поймать / отбить). */
export function airborne(s: State, t = s.t): boolean {
  const ch = s.ch;
  if (!ch.b0 || ch.t0 == null) return false;
  return t - ch.t0 < chFlight(ch.b0).land;
}

function checkEnd(s: State, ev: Event[]): boolean {
  const c = s.cfg;
  const won = s.men.map((m, i) => (total(m) >= c.target ? i : -1)).filter((i) => i >= 0);
  if (!won.length && s.kons < c.maxKons) return false;
  s.over = true;
  const best = Math.max(...s.men.map(total));
  s.winners = (won.length ? won : s.men.map((m, i) => (total(m) === best ? i : -1)).filter((i) => i >= 0)).map((i) => s.seats[i]);
  ev.push({ k: 'end', winners: s.winners });
  return true;
}

function pause(s: State, sec: number, next: State['next'], swapTo = -1) {
  s.phase = 'pause';
  s.until = s.t + sec;
  s.next = next;
  s.swapTo = swapTo;
}

function setPhase(s: State, p: Phase) {
  s.phase = p;
  s.phaseT = s.t;
}

/** Бьющий выбыл: очки выхода — в банк (или сгорели), бьёт who. */
function out(s: State, who: number, ev: Event[], burn = false) {
  const b = s.men[s.batter];
  if (!burn) b.score += b.run;
  b.run = 0;
  ev.push({ k: 'out', who: s.batter, next: who });
  pause(s, 1.1, 'swap', who);
}

/** Промах у кона (не попал по чижу или чиж не улетел за черту) или на добивании. */
function missed(s: State, ev: Event[], short: boolean) {
  const [x, y, , a] = chAt(s);
  if (s.strike > 0) {
    // добивание не вышло — чиж лежит, где упал
    s.ch = { mode: 'ground', x: r3(x), y: r3(y), a: r3(a) };
    ev.push({ k: 'miss', who: s.batter, left: s.strikes - 1, short });
    nextStrike(s, ev);
    return;
  }
  s.tries--;
  ev.push({ k: 'miss', who: s.batter, left: s.tries, short });
  s.ch = { mode: 'ground', x: r3(x), y: r3(y), a: r3(a) };
  if (s.tries <= 0) {
    const ord = s.order;
    out(s, ord[(ord.indexOf(s.batter) + 1) % ord.length], ev);
  } else pause(s, 0.6, 'tee');
}

/** После добивания: ещё есть — добивать, нет — мерить. */
function nextStrike(s: State, ev: Event[]) {
  s.strikes--;
  if (s.strikes > 0) setPhase(s, 'bonus');
  else measure(s, ev);
}

/** Водящие не попали в кон: добивания (если есть) или замер. */
function afterThrow(s: State, ev: Event[]) {
  if (s.cfg.bonus > 0 && s.cfg.score === 'merki') {
    s.strikes = s.cfg.bonus + 1;
    nextStrike(s, ev);
  } else measure(s, ev);
}

/** Конец кона: мерки — битой от кона до чижа. */
function measure(s: State, ev: Event[]) {
  const c = s.cfg;
  const m = s.men[s.batter];
  if (c.score === 'merki') {
    const d = Math.hypot(s.ch.x, s.ch.y);
    const pts = merki(s.ch.x, s.ch.y);
    m.score += pts;
    ev.push({ k: 'score', who: s.batter, pts, d: r3(d) });
  }
  s.kons++;
  if (checkEnd(s, ev)) return;
  pause(s, c.score === 'merki' ? 1.7 : 0.8, 'kon');
}

function move(s: State, i: number, inp: In | null | undefined, dt: number, rooted: boolean, minY: number) {
  const m = s.men[i];
  const seen = s.seen[i];
  let dsh = false;
  if (inp?.d != null && inp.d > seen.d) {
    seen.d = inp.d;
    dsh = !rooted;
  }
  if (rooted) {
    m.vx = m.vy = 0;
    m.dash = Math.max(0, m.dash - dt);
    m.cd = Math.max(0, m.cd - dt);
    return;
  }
  if (dsh) dash(m);
  drive(m, { mx: inp?.mx ?? 0, my: inp?.my ?? 0 }, VR, dt);
  m.x = clamp(m.x, -BOUND.x, BOUND.x);
  m.y = clamp(m.y, Math.max(BOUND.y0, minY), BOUND.y1);
}

const pressed = (q: In | null | undefined, k: 's' | 'c' | 'st', seen: State['seen'][number]) => {
  const v = q?.[k];
  if (v == null || v <= seen[k]) return false;
  seen[k] = v;
  return true;
};

/** Шаг симуляции: s меняется на месте. */
export function step(s: State, inputs: (In | null | undefined)[], _rng: Rng): Event[] {
  const ev: Event[] = [];
  if (s.over) return ev;
  const c = s.cfg;
  const n = c.n;
  const inp = (i: number) => inputs[s.seats[i]];
  for (let i = 0; i < n; i++) applySpeed(s, s.seats[i], inp(i)?.sp);
  // обучение: игрок ещё не сделал шаг — время стоит, двигается только он сам
  const frozen = s.seats.some((_, i) => inp(i)?.hold === true);
  const realDt = (TICK_MS / 1000) * s.speed;
  const dt = frozen ? 0 : realDt * dtScale(s);
  s.t += dt;
  const B = s.batter;

  if (s.phase === 'pause') {
    if (s.t < s.until) return ev;
    if (s.next === 'swap') {
      s.batter = s.swapTo;
      s.tries = c.tries;
      ev.push({ k: 'batter', who: s.batter });
      regroup(s);
    } else if (s.next === 'kon') {
      s.tries = c.tries;
      regroup(s);
    } else {
      // та же попытка заново: чиж — в кон, бьющий — к кону (водящие стоят, где стояли)
      s.ch = { mode: 'tee', x: 0, y: 0, a: 0 };
      const b = s.men[s.batter];
      [b.x, b.y] = BATTER_SPOT;
      b.vx = b.vy = 0;
    }
    s.strike = 0;
    s.strikes = 0;
    s.holder = -1;
    s.thrower = -1;
    s.next = null;
    setPhase(s, 'tee');
    for (let i = 0; i < n; i++) {
      // нажатое во время паузы не копим
      const q = inp(i);
      const sn = s.seen[i];
      if (q?.th) sn.th = Math.max(sn.th, q.th.n);
      for (const k of ['s', 'c', 'st'] as const) if (q?.[k] != null) sn[k] = Math.max(sn[k], q[k]!);
    }
    return ev;
  }

  // бег: бьющий у кона стоит (подбивает и бьёт), водящий с чижом стоит (бросает с места падения);
  // пока бьющий у кона, водящие — за чертой
  const atTee = (s.phase === 'tee' || s.phase === 'pop') && s.strike === 0;
  for (let i = 0; i < n; i++) {
    const rooted = (i === B && (atTee || s.phase === 'pop')) || i === s.holder;
    if (frozen && !inp(i)?.hold) continue;
    move(s, i, inp(i), frozen ? realDt : dt, rooted, i !== B && atTee ? c.line + 1 : -Infinity);
  }
  // не стоять друг в друге: бьющий у кона и водящий с чижом не сдвигаются
  separate(s.men, BODY.r, (i) => (i === B && (atTee || s.phase === 'pop')) || i === s.holder);
  // «Ловить» у водящих: окно после нажатия
  for (let i = 0; i < n; i++) if (i !== B && pressed(inp(i), 'c', s.seen[i])) s.catchT[i] = s.t + CATCH.win;
  const bq = inp(B);
  const swing = pressed(bq, 's', s.seen[B]);
  const stop = pressed(bq, 'st', s.seen[B]);

  switch (s.phase) {
    case 'tee':
    case 'bonus': {
      const q = bq;
      const bm = s.men[B];
      const near = s.phase === 'tee' || Math.hypot(bm.x - s.ch.x, bm.y - s.ch.y) < BONUS_REACH;
      if (q?.th && q.th.n > s.seen[B].th) {
        s.seen[B].th = q.th.n;
        if (near) {
          const dir = s.phase === 'tee' ? 0 : awayYaw(s.ch.x, s.ch.y);
          const yaw = dir + clamp(q.th.yaw, -1, 1);
          const b0 = popBody(s.ch.x, s.ch.y, yaw);
          s.ch = { mode: 'pop', x: s.ch.x, y: s.ch.y, a: s.ch.a, b0, t0: s.t };
          s.aim = { pow: q.th.pow, yaw };
          if (s.phase === 'bonus') s.strike++;
          s.swung = false;
          // бьющий встаёт к чижу (на добивании — с той стороны, откуда бьёт)
          if (s.phase === 'bonus') {
            bm.x = r3(s.ch.x - 0.5 * Math.cos(yaw) - 0.3 * Math.sin(yaw));
            bm.y = r3(s.ch.y + 0.5 * Math.sin(yaw) - 0.3 * Math.cos(yaw));
          }
          ev.push({ k: 'pop', who: B, bonus: s.phase === 'bonus' });
          setPhase(s, 'pop');
          break;
        }
      }
      if (s.phase === 'bonus' && stop) {
        ev.push({ k: 'miss', who: B, left: 0, short: false });
        s.strikes = 1;
        nextStrike(s, ev);
        break;
      }
      const wait = s.phase === 'tee' ? WAIT.tee : WAIT.bonus;
      if (s.t - s.phaseT > wait * s.speed) {
        ev.push({ k: 'slow', who: B });
        if (s.phase === 'tee') missed(s, ev, false);
        else {
          s.strikes = 1;
          nextStrike(s, ev);
        }
      }
      break;
    }
    case 'pop': {
      const ch = s.ch;
      const f = chFlight(ch.b0!);
      const tt = s.t - ch.t0!;
      if (swing && !s.swung) {
        s.swung = true;
        const [x, y, z] = chAt(s);
        const bm = s.men[B];
        const fr = sample(f.frames, tt);
        const fr2 = sample(f.frames, tt + 0.01);
        const q = Math.hypot(bm.x - x, bm.y - y) < SWING.reach ? hitQuality(z) : null;
        if (q != null && tt < f.land) {
          const aim = s.aim ?? { pow: 0.8, yaw: 0 };
          // с земли на добивании чиж подлетает ниже и бьётся слабее
          const b0 = hitBody(x, y, z, fr2[3] - fr[3], aim.pow, aim.yaw, q, s.strike > 0 ? BONUS_K : 1);
          s.ch = { mode: 'fly', x, y, a: fr[4], b0, t0: s.t, kind: 'hit' };
          ev.push({ k: 'hit', who: B, q: r3(q) });
          if (q > 0.8) slowmo(s, 0.45, 0.35);
          setPhase(s, 'fly');
          break;
        }
        ev.push({ k: 'whiff', who: B });
      }
      if (tt >= f.t) missed(s, ev, false);
      break;
    }
    case 'fly': {
      const ch = s.ch;
      const f = chFlight(ch.b0!);
      const tt = s.t - ch.t0!;
      if (tt < f.land) {
        const [x, y, z] = chAt(s);
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < n; i++) {
          if (i === B) continue;
          const m = s.men[i];
          // досягаемость — до руки (на высоте плеча): выше головы чиж дальше, чем кажется на земле
          const d = Math.hypot(m.x - x, m.y - y, Math.max(0, z - CATCH.hand));
          const btn = s.catchT[i] >= s.t;
          if (z < CATCH.z0 || z > CATCH.z1) continue;
          if ((d < CATCH.auto && z > 0.6 && z < 1.8) || (btn && d < CATCH.reach)) if (d < bd) (bd = d), (best = i);
        }
        if (best >= 0) {
          ev.push({ k: 'catch', who: best, batter: B });
          slowmo(s, 0.6, 0.3);
          s.ch = { mode: 'held', x: r3(x), y: r3(y), a: 0 };
          s.holder = best;
          s.kons++;
          if (checkEnd(s, ev)) break;
          out(s, best, ev);
          break;
        }
      }
      if (tt >= f.t) {
        const [x, y, a] = f.rest;
        s.ch = { mode: 'ground', x, y, a };
        ev.push({ k: 'land', x, y });
        if (ch.kind === 'def') {
          afterThrow(s, ev);
          break;
        }
        if (s.strike === 0) {
          if (Math.hypot(x, y) < c.line) {
            missed(s, ev, true);
            break;
          }
          if (c.score === 'hits') {
            s.men[B].run++;
            ev.push({ k: 'point', who: B, run: s.men[B].run });
            if (checkEnd(s, ev)) break;
          }
          setPhase(s, 'field');
        } else nextStrike(s, ev);
      }
      break;
    }
    case 'field': {
      if (s.holder < 0) {
        let best = -1;
        let bd = GRAB;
        for (let i = 0; i < n; i++) {
          if (i === B) continue;
          const d = Math.hypot(s.men[i].x - s.ch.x, s.men[i].y - s.ch.y);
          if (d < bd) (bd = d), (best = i);
        }
        if (best >= 0) {
          s.holder = best;
          s.ch.mode = 'held';
          const m = s.men[best];
          // встал над чижом: бросает с места падения
          m.x = s.ch.x;
          m.y = s.ch.y;
          m.vx = m.vy = 0;
          s.phaseT = s.t;
          ev.push({ k: 'pick', who: best });
        } else if (s.t - s.phaseT > WAIT.field * s.speed) {
          ev.push({ k: 'slow', who: -1 });
          afterThrow(s, ev);
        }
        break;
      }
      const h = s.holder;
      const q = inp(h);
      if (q?.th && q.th.n > s.seen[h].th) {
        s.seen[h].th = q.th.n;
        const b0 = throwBody(s.ch.x, s.ch.y, q.th.pow, q.th.yaw);
        s.ch = { mode: 'back', x: s.ch.x, y: s.ch.y, a: 0, b0, t0: s.t };
        s.thrower = h;
        s.holder = -1;
        s.swung = false;
        ev.push({ k: 'throw', who: h });
        setPhase(s, 'back');
      } else if (s.t - s.phaseT > WAIT.hold * s.speed) {
        ev.push({ k: 'slow', who: h });
        s.ch.mode = 'ground';
        s.holder = -1;
        afterThrow(s, ev);
      }
      break;
    }
    case 'back': {
      const ch = s.ch;
      const f = chFlight(ch.b0!);
      const tt = s.t - ch.t0!;
      if (swing && !s.swung) {
        s.swung = true;
        const [x, y, z] = chAt(s);
        const bm = s.men[B];
        if (tt < f.land && Math.hypot(bm.x - x, bm.y - y) < DEFEND.reach && z > DEFEND.z0 && z < DEFEND.z1) {
          const fr = sample(f.frames, tt);
          const fr2 = sample(f.frames, tt + 0.01);
          const b0 = defendBody(x, y, z, (fr2[1] - fr[1]) * 100, (fr2[2] - fr[2]) * 100);
          s.ch = { mode: 'fly', x, y, a: fr[4], b0, t0: s.t, kind: 'def' };
          ev.push({ k: 'def', who: B });
          slowmo(s, 0.4, 0.35);
          setPhase(s, 'fly');
          break;
        }
        ev.push({ k: 'whiff', who: B });
      }
      if (tt >= f.t) {
        const [x, y, a] = f.rest;
        s.ch = { mode: 'ground', x, y, a };
        ev.push({ k: 'land', x, y });
        if (inKon(c, x, y)) {
          const bm = s.men[B];
          const burnt = c.burn ? bm.run : 0;
          ev.push({ k: 'kon', who: s.thrower, burnt });
          s.kons++;
          if (checkEnd(s, ev)) break;
          out(s, s.thrower, ev, c.burn);
        } else {
          ev.push({ k: 'nokon', x, y });
          afterThrow(s, ev);
        }
      }
      break;
    }
  }
  return ev;
}

/** Снимок для рассылки: всё открыто (скрытого в чиже нет). */
export const snapshot = (s: State): State => JSON.parse(JSON.stringify(s));

/** Кто сейчас «в деле»: бьющий у кона / с чижом / ближний к чижу водящий — для переключения за одним экраном. */
export function nearestTo(s: State, idx: number[], x: number, y: number): number {
  let best = idx[0] ?? -1;
  let bd = Infinity;
  for (const i of idx) {
    const d = Math.hypot(s.men[i].x - x, s.men[i].y - y);
    if (d < bd) (bd = d), (best = i);
  }
  return best;
}
