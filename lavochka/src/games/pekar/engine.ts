/* Пекарь — правила партии (без DOM: их гоняют сервер, боты и тесты). Дворовая игра: в меловом кружке стоит консервная
 * банка, у неё — водящий, «пекарь». Остальные по очереди кидают в банку палки-биты с черты своего звания: у рядового —
 * дальняя черта, чем выше звание, тем ближе к банке. Палка остаётся лежать, где упала. Сбил банку — звание выше;
 * пекарь бежит ставить банку на место, а все, чьи палки лежат в поле, могут сбегать за ними и вернуться за черту.
 * Поставив банку, пекарь может осалить того, кто ещё в поле: осаленный становится пекарем. Если промахнулись все
 * и бросать больше нечем — за палками идут все сразу, а банка стоит: пекарь салит сразу. Кто сбил банку маршалом
 * (или набрал нужное число сбитых банок без званий) — выиграл. Пекаря на первый кон выбирают пинком палки:
 * у кого улетела ближе всех — тот и печёт, остальные бросают по дальности пинка.
 *
 * Партия идёт по решениям, а между ними — по часам розыгрыша (бег за палками, пекарь с банкой, погоня), палки и
 * банка летят по физике набора дворового спорта (core/dvorsport/body.ts). Случайность (увернулся ли) — только rng.int,
 * чтобы показ правил подкручивался rig. Оси: x — вбок, y — от черты рядового (0) к банке (dist), z — вверх. */
import { body, DT, kick, MAT, step, type Body, type BodyFrame, type BodyMat } from '../../core/dvorsport/body';
import type { Options, Rng } from '../../core/types';

/** Палка по утоптанной земле: скользит и подпрыгивает мало. */
export const STICK: BodyMat = { ...MAT.stick, roll: 4.2, bounce: 0.18 };
export const STICK_R = 0.025;
/** Банка: радиус и высота, м. */
export const CAN_R = 0.05;
export const CAN_H = 0.12;
/** Бег: игрок за палкой, пекарь, пекарь с банкой в руках. */
export const VR = 5.4;
export const VP = 5.8;
export const VP_CAN = 5.0;
/** Реакция, подобрать палку, подобрать банку, поставить банку, с. */
export const REACT = 0.35;
export const PICK = 0.35;
export const PICK_CAN = 0.3;
export const SET_CAN = 0.45;
/** На сколько пекарь дотягивается палкой, м. */
export const REACH = 1.0;

export type Style = 'flat' | 'lob';
/** Угол броска: низом «пропеллером» (палка крутится плашмя, сметает широко) и навесом (кувырком, падает у банки). */
export const PITCH: Record<Style, number> = { flat: 0.1, lob: 0.5 };
/** Насколько палка дотягивается до банки вокруг своего центра: плашмя — почти на половину длины. */
export const SWEEP: Record<Style, number> = { flat: 0.26, lob: 0.14 };
export const SPIN: Record<Style, number> = { flat: 15, lob: 11 };

/** Звания — по дворовым правилам (igry-na-ulice.ru, galen.by): от рядового до маршала. */
export const RANKS_FULL = ['Рядовой', 'Ефрейтор', 'Сержант', 'Лейтенант', 'Капитан', 'Майор', 'Полковник', 'Генерал', 'Маршал'];
export const RANKS_SHORT = ['Рядовой', 'Сержант', 'Лейтенант', 'Капитан', 'Генерал'];

export interface Cfg {
  /** Игроков (вместе с пекарем). */
  n: number;
  /** От черты рядового до банки, м. */
  dist: number;
  /** Звания (одно — «без званий»: все бросают с одной черты, считают сбитые банки). */
  ranks: string[];
  /** На сколько метров ближе черта следующего звания. */
  step: number;
  /** Без званий: до скольких сбитых банок. */
  target: number;
  /** Стал пекарем — звание вниз на ступень. */
  demote: boolean;
  /** Страховка: бросков за партию. */
  maxThrows: number;
}

export type StickAt = 'hand' | 'field' | 'pekar';

export interface Pl {
  rank: number;
  /** Сбитых банок. */
  knocks: number;
  stick: StickAt;
  /** Где лежит палка (оси игры) и как повёрнута. */
  sx: number;
  sy: number;
  sa: number;
}

export interface Runner {
  who: number;
  /** Откуда побежал, где палка, куда вернётся (за свою черту). */
  from: [number, number];
  stick: [number, number];
  home: [number, number];
  /** Когда побежал. */
  t0: number;
  /** Черта, за которой он в безопасности (y). */
  line: number;
}

export interface Scramble {
  /** Часы розыгрыша, с. */
  t: number;
  /** Банка сбита (пекарь сначала ставит её) или все промахнулись (банка стоит). */
  knocked: boolean;
  runners: Runner[];
  /** Кто ещё решает, бежать ли. */
  asked: number[];
  /** Где пекарь сейчас. */
  pk: [number, number];
  /** Банка поставлена: с какого времени пекарь салит. */
  fixT: number | null;
}

export type Phase = 'kick' | 'throw' | 'run' | 'fix' | 'chase';

export interface State {
  cfg: Cfg;
  /** Место каждого игрока. */
  seats: number[];
  phase: Phase;
  pl: Pl[];
  /** Пинок на жеребьёвке: как далеко улетела палка (null — ещё не пинал). */
  kicks: (number | null)[];
  /** Порядок бросков (по дальности пинка). */
  order: number[];
  pekar: number;
  /** Кто ещё бросает в этом коне (у кого палка в руке). */
  queue: number[];
  can: { x: number; y: number; up: boolean; a: number };
  sc: Scramble | null;
  throws: number;
  over: boolean;
  winners: number[];
  /** Только превью карточки. */
  shot?: boolean;
}

export type Action =
  | { type: 'kick'; pow: number }
  | { type: 'throw'; pow: number; yaw: number; style: Style }
  | { type: 'run'; go: boolean }
  | { type: 'fix' }
  | { type: 'chase'; who: number | null };

export type Event =
  | { k: 'kick'; who: number; b0: Body; rest: [number, number, number]; d: number; slip: boolean }
  | { k: 'draw'; pekar: number; order: number[] }
  | { k: 'throw'; who: number; b0: Body; style: Style; hit: boolean; tHit: number; stick: [number, number, number]; can: { from: [number, number]; to: [number, number]; a: number } | null }
  | { k: 'rank'; who: number; rank: number; knocks: number }
  | { k: 'run'; who: number; go: boolean }
  | { k: 'fix'; who: number; from: [number, number]; can: [number, number]; to: [number, number]; tPick: number; t1: number; rs: Runner[] }
  | { k: 'collect'; rs: Runner[] }
  | { k: 'chase'; who: number; target: number | null; from: [number, number]; to: [number, number]; t0: number; t1: number; tag: boolean; rs: Runner[] }
  | { k: 'back'; t0: number; t1: number; rs: Runner[] }
  | { k: 'pekar'; who: number; old: number; rank: number }
  | { k: 'end'; winners: number[] };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function cfgFrom(o: Options, n = 4): Cfg {
  const dist = Number(o.dist ?? 14) || 14;
  const ranks = o.ranks === 'none' ? ['Игрок'] : o.ranks === 'short' ? RANKS_SHORT : RANKS_FULL;
  // черта маршала (или генерала) — не ближе 5 м к банке
  const step = ranks.length > 1 ? r3(Math.min(1, (dist - 5) / (ranks.length - 1))) : 0;
  return {
    n: clampI(n, 2, 6),
    dist,
    ranks,
    step,
    target: clampI(Number(o.target ?? 5), 1, 20),
    demote: o.demote === true || o.demote === 'yes',
    maxThrows: 400,
  };
}

/** Черта звания (y). */
export const lineY = (c: Cfg, rank: number) => r3(clamp(rank, 0, c.ranks.length - 1) * c.step);
/** Где стоит банка (кружок кона). */
export const canHome = (c: Cfg): [number, number] => [0, c.dist];
/** Где стоит пекарь: сбоку за банкой. */
export const pekarSpot = (c: Cfg): [number, number] => [1.3, r3(c.dist + 1.1)];
/** Где бросает: на черте посередине. */
export const throwSpot = (c: Cfg, rank: number): [number, number] => [0, lineY(c, rank)];
/** Где ждёт игрок за своей чертой: по обе стороны от бросающего. */
export function waitSpot(c: Cfg, who: number, rank: number): [number, number] {
  const side = who % 2 ? 1 : -1;
  return [r3(side * (2.4 + 1.0 * Math.floor(who / 2))), r3(lineY(c, rank) - 0.7)];
}

/** Откуда вылетает палка (из руки над плечом). */
export const RELEASE = { x: 0.25, dy: 0.3, z: 1.45 };

// ---------------------------------------------------------------- полёт палки

export interface StickFlight {
  frames: BodyFrame[];
  /** Сбила банку: когда и где. */
  hit: { t: number; x: number; y: number; v: number; vx: number; vy: number } | null;
  /** Где легла (x, y, угол). */
  rest: [number, number, number];
  t: number;
}

/** Скорость палки в полную силу — подобрана по расстоянию: плашмя в полную силу улетает на 1,7 дистанции. */
const vmaxCache = new Map<string, number>();
export function vMax(c: Cfg, style: Style): number {
  const key = `${c.dist}|${style}`;
  const got = vmaxCache.get(key);
  if (got) return got;
  let lo = 4;
  let hi = 60;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const r = flyStick(kick(body(RELEASE.x, RELEASE.dy, RELEASE.z, STICK_R), m, 0, PITCH[style]), style, null);
    if (r.rest[1] < c.dist * 1.7) lo = m;
    else hi = m;
  }
  const v = (lo + hi) / 2;
  vmaxCache.set(key, v);
  return v;
}

/** Палка после броска: сила 0…1, направление (yaw: 0 — прямо на банку, плюс — вправо), стиль, с черты звания. */
export function throwBody(c: Cfg, rank: number, pow: number, yaw: number, style: Style): Body {
  const v = vMax(c, style) * (0.3 + 0.7 * clamp(pow, 0, 1));
  const [x, y] = throwSpot(c, rank);
  const b = kick(body(x + RELEASE.x, y + RELEASE.dy, RELEASE.z, STICK_R), v, clamp(yaw, -0.6, 0.6), PITCH[style] ?? PITCH.flat, SPIN[style]);
  return { ...b, x: r3(b.x), y: r3(b.y), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz) };
}

/** Полёт палки до остановки; can — где стоит банка (null — не проверять попадание). */
export function flyStick(b0: Body, style: Style, can: [number, number] | null, frameDt = 1 / 60, quick = false): StickFlight {
  const b = { ...b0 };
  // прикидка ботов: шаг крупнее, конец — как только попал или палка ушла за банку
  const dt = quick ? DT * 4 : DT;
  const frames: BodyFrame[] = frameDt > 0 ? [[0, b.x, b.y, b.z, b.a]] : [];
  let t = 0;
  let next = frameDt;
  let hit: StickFlight['hit'] = null;
  const reach = CAN_R + SWEEP[style];
  const n = Math.ceil(8 / dt);
  for (let i = 1; i <= n; i++) {
    t = i * dt;
    step(b, dt, STICK);
    if (frameDt > 0 && t >= next - 1e-9) {
      frames.push([t, b.x, b.y, b.z, b.a]);
      next += frameDt;
    }
    if (can && !hit && b.z - b.r < CAN_H + 0.03 && Math.hypot(b.x - can[0], b.y - can[1]) < reach) {
      hit = { t, x: b.x, y: b.y, v: Math.hypot(b.vx, b.vy), vx: b.vx, vy: b.vy };
      // банка гасит палку: та отскакивает и ложится рядом
      b.vx *= 0.25;
      b.vy *= 0.25;
      b.vz = Math.min(b.vz, 0);
    }
    if (b.z <= b.r + 1e-4 && b.vz === 0 && b.vx === 0 && b.vy === 0) break;
    if (quick && (hit || (can && b.y > can[1] + 0.6))) break;
  }
  if (frameDt > 0 && frames[frames.length - 1][0] < t) frames.push([t, b.x, b.y, b.z, b.a]);
  return { frames, hit, rest: [r3(b.x), r3(b.y), r3(b.a % (Math.PI * 2))], t };
}

const fcache = new Map<string, StickFlight>();
/** Полёт с кадрами (общий для комнаты, ботов и экрана), с кэшем. */
export function stickFlight(b0: Body, style: Style, can: [number, number] | null): StickFlight {
  const key = `${b0.x},${b0.y},${b0.z},${b0.vx},${b0.vy},${b0.vz},${style},${can?.join(',') ?? '-'}`;
  let f = fcache.get(key);
  if (!f) {
    f = flyStick(b0, style, can);
    if (fcache.size > 600) fcache.clear();
    fcache.set(key, f);
  }
  return f;
}

/** Куда отлетит сбитая банка: вдоль палки, тем дальше, чем сильнее удар. */
export function canFlight(hit: NonNullable<StickFlight['hit']>, can: [number, number]): { to: [number, number]; a: number } {
  const v = Math.max(0.1, hit.v);
  const dx = hit.vx / v;
  const dy = hit.vy / v;
  // попал краем — банка уходит вбок
  const off = (can[0] - hit.x) * dy - (can[1] - hit.y) * dx;
  const d = clamp(0.6 + v * 0.22, 0.8, 5);
  const ox = dx + dy * off * 2.5;
  const oy = dy - dx * off * 2.5;
  const ol = Math.hypot(ox, oy) || 1;
  return { to: [r3(can[0] + (ox / ol) * d), r3(can[1] + (oy / ol) * d)], a: r3(Math.atan2(ox, oy)) };
}

/** Пинок палки на жеребьёвке: с черты носком вперёд. */
export function kickBody(pow: number, who: number, slip = false): Body {
  const b = kick(body(0.15, 0.1, 0.12, STICK_R), 5 + 8 * clamp(pow, 0, 1), 0.04 * ((who % 3) - 1) + (slip ? 0.55 : 0), slip ? 0.3 : 0.55, 9);
  return { ...b, vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz) };
}

// ---------------------------------------------------------------- бег

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Время каждого куска пути бегущего: до палки, подобрать, обратно. */
export function runTimes(r: Runner) {
  const t1 = r.t0 + dist2(r.from, r.stick) / VR;
  const t2 = t1 + PICK;
  const t3 = t2 + dist2(r.stick, r.home) / VR;
  return { t1, t2, t3 };
}

/** Где бегущий в момент t; field — в поле (за своей чертой его можно осалить); stick — палка уже в руках. */
export function runnerAt(r: Runner, t: number): { x: number; y: number; field: boolean; stick: boolean; done: boolean; phase: 'wait' | 'out' | 'pick' | 'back' | 'home' } {
  const { t1, t2, t3 } = runTimes(r);
  let x: number;
  let y: number;
  let phase: 'wait' | 'out' | 'pick' | 'back' | 'home';
  if (t <= r.t0) [x, y, phase] = [r.from[0], r.from[1], 'wait'];
  else if (t < t1) {
    const k = (t - r.t0) / (t1 - r.t0 || 1);
    [x, y, phase] = [lerp(r.from[0], r.stick[0], k), lerp(r.from[1], r.stick[1], k), 'out'];
  } else if (t < t2) [x, y, phase] = [r.stick[0], r.stick[1], 'pick'];
  else if (t < t3) {
    const k = (t - t2) / (t3 - t2 || 1);
    [x, y, phase] = [lerp(r.stick[0], r.home[0], k), lerp(r.stick[1], r.home[1], k), 'back'];
  } else [x, y, phase] = [r.home[0], r.home[1], 'home'];
  return { x, y, field: y > r.line + 0.05, stick: t >= t2, done: t >= t3, phase };
}

/** Когда бегущий вернулся за свою черту (дальше не осалить). */
export function safeAt(r: Runner): number {
  const { t2, t3 } = runTimes(r);
  if (r.stick[1] <= r.line) return r.t0;
  // на обратном пути пересекает черту
  const k = (r.stick[1] - r.line) / Math.max(1e-6, r.stick[1] - r.home[1]);
  return t2 + (t3 - t2) * clamp(k, 0, 1);
}

/** Погоня: пекарь из точки p с момента tc за бегущим r. Успевает ли, где догонит, с каким запасом (м). */
export function chaseOf(p: [number, number], tc: number, r: Runner): { ok: boolean; t: number; at: [number, number]; margin: number } {
  const tEnd = safeAt(r);
  let best: { ok: boolean; t: number; at: [number, number]; margin: number } = { ok: false, t: tEnd, at: [0, 0], margin: -99 };
  let first: { t: number; at: [number, number] } | null = null;
  for (let t = Math.max(tc, r.t0); t <= tEnd; t += 0.02) {
    const q = runnerAt(r, t);
    if (!q.field) continue;
    const can = Math.max(0, (t - tc - 0.1) * VP) + REACH;
    const m = can - Math.hypot(q.x - p[0], q.y - p[1]);
    if (m >= 0 && !first) first = { t, at: [r3(q.x), r3(q.y)] };
    if (m > best.margin) best = { ok: m >= 0, t, at: [r3(q.x), r3(q.y)], margin: m };
  }
  if (first) return { ok: true, t: r3(first.t), at: first.at, margin: r3(best.margin) };
  return { ...best, ok: false };
}

/** Шанс осалить по запасу: впритык — можно и увернуться. */
export const tagChance = (margin: number) => (margin < 0 ? 0 : clamp(0.45 + margin * 0.18, 0.45, 0.92));

// ---------------------------------------------------------------- партия

export function newState(c: Cfg, seats: number[]): State {
  const n = c.n;
  const s: State = {
    cfg: c,
    seats: seats.slice(0, n),
    phase: 'kick',
    pl: Array.from({ length: n }, () => ({ rank: 0, knocks: 0, stick: 'hand' as StickAt, sx: 0, sy: 0, sa: 0 })),
    kicks: Array.from({ length: n }, () => null),
    order: [],
    pekar: -1,
    queue: [],
    can: { x: 0, y: c.dist, up: true, a: 0 },
    sc: null,
    throws: 0,
    over: false,
    winners: [],
  };
  return s;
}

export function setup(o: Options, seats: number[]): State {
  const ss = seats.length >= 2 ? seats.slice() : [seats[0] ?? 0, 1];
  return newState(cfgFrom(o, ss.length), ss);
}

/** Кто пинает следующим на жеребьёвке. */
const nextKicker = (s: State) => s.kicks.findIndex((k) => k == null);

/** Кто решает сейчас (номер игрока). */
export function actor(s: State): number {
  if (s.over) return -1;
  if (s.phase === 'kick') return nextKicker(s);
  if (s.phase === 'throw') return s.queue[0] ?? -1;
  if (s.phase === 'run') return s.sc?.asked[0] ?? -1;
  return s.pekar;
}

export function toAct(s: State): number[] {
  const a = actor(s);
  return a >= 0 ? [s.seats[a]] : [];
}

const clone = (s: State): State => JSON.parse(JSON.stringify(s));

/** Новый кон: бросают все, у кого палка в руке, по порядку; бросать некому — за палками идут все. */
function newCon(s: State, ev: Event[]) {
  s.sc = null;
  s.queue = s.order.filter((i) => i !== s.pekar && s.pl[i].stick === 'hand');
  if (s.queue.length) s.phase = 'throw';
  else if (s.pl.some((p, i) => i !== s.pekar && p.stick === 'field')) collect(s, ev);
  else s.phase = 'throw';
}

/** Бегущий за своей палкой. */
function runner(s: State, who: number, from: [number, number], t0: number): Runner {
  const c = s.cfg;
  const p = s.pl[who];
  return { who, from, stick: [p.sx, p.sy], home: waitSpot(c, who, p.rank), t0: r3(t0), line: lineY(c, p.rank) };
}

/** Все промахнулись: идут за палками все сразу, банка стоит — пекарь салит сразу. */
function collect(s: State, ev: Event[]) {
  const rs: Runner[] = [];
  for (let i = 0; i < s.cfg.n; i++) if (i !== s.pekar && s.pl[i].stick === 'field') rs.push(runner(s, i, waitSpot(s.cfg, i, s.pl[i].rank), REACT));
  s.sc = { t: 0, knocked: false, runners: rs, asked: [], pk: pekarSpot(s.cfg), fixT: 0 };
  ev.push({ k: 'collect', rs: rs.slice() });
  s.phase = 'chase';
  // все палки за чертами — салить некого
  if (!rs.some((r) => safeAt(r) > REACT + 0.2)) finish(s, 0, null, ev);
}

function checkEnd(s: State, ev: Event[]): boolean {
  const c = s.cfg;
  const top = c.ranks.length;
  const won = s.pl.map((p, i) => (top > 1 ? p.rank >= top : p.knocks >= c.target) ? i : -1).filter((i) => i >= 0);
  if (!won.length && s.throws < c.maxThrows) return false;
  s.over = true;
  if (won.length) s.winners = won.map((i) => s.seats[i]);
  else {
    // страховка: по званию (без званий — по сбитым банкам)
    const sc = (p: Pl) => p.rank * 100 + p.knocks;
    const best = Math.max(...s.pl.map(sc));
    s.winners = s.pl.map((p, i) => (sc(p) === best ? s.seats[i] : -1)).filter((x) => x >= 0);
  }
  s.sc = null;
  ev.push({ k: 'end', winners: s.winners });
  return true;
}

/** Розыгрыш кончился: все добегают за черту, осаленный — пекарь. */
function finish(s: State, t0: number, tagged: number | null, ev: Event[]) {
  const sc = s.sc!;
  const rs = sc.runners;
  const t1 = r3(Math.max(t0, ...rs.map((r) => runTimes(r).t3)));
  if (rs.length) ev.push({ k: 'back', t0, t1, rs: rs.slice() });
  for (const r of rs) s.pl[r.who].stick = 'hand';
  if (tagged != null) {
    const old = s.pekar;
    s.pl[old].stick = 'hand';
    s.pekar = tagged;
    s.pl[tagged].stick = 'pekar';
    if (s.cfg.demote && s.pl[tagged].rank > 0) s.pl[tagged].rank--;
    ev.push({ k: 'pekar', who: tagged, old, rank: s.pl[tagged].rank });
  }
  s.can = { x: 0, y: s.cfg.dist, up: true, a: 0 };
  newCon(s, ev);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const c = s.cfg;
  const ev: Event[] = [];
  const me = actor(s);
  const roll = (p: number) => rng.int(1000) < Math.round(p * 1000);

  if (s.phase === 'kick') {
    if (a.type !== 'kick' || !Number.isFinite(a.pow)) return null;
    // пнул что есть силы — палка может сорваться с носка и улететь вбок недалеко
    const pow = clamp(a.pow, 0, 1);
    const slip = pow > 0.82 && roll((pow - 0.82) * 3);
    const b0 = kickBody(slip ? pow * 0.35 : pow, me, slip);
    const f = stickFlight(b0, 'lob', null);
    s.kicks[me] = f.rest[1];
    const p = s.pl[me];
    [p.sx, p.sy, p.sa] = f.rest;
    ev.push({ k: 'kick', who: me, b0, rest: f.rest, d: f.rest[1], slip });
    if (nextKicker(s) < 0) {
      // ближе всех — пекарь; остальные бросают по дальности пинка
      const idx = s.kicks.map((_, i) => i).sort((x, y) => (s.kicks[y]! - s.kicks[x]!) || x - y);
      s.pekar = idx[idx.length - 1];
      // порядок — все, кроме пекаря бросают по нему (бывший пекарь встаёт на своё место в очереди)
      s.order = idx;
      for (const pl of s.pl) pl.stick = 'hand';
      s.pl[s.pekar].stick = 'pekar';
      ev.push({ k: 'draw', pekar: s.pekar, order: s.order.filter((i) => i !== s.pekar) });
      newCon(s, ev);
    }
    return { state: s, events: ev };
  }

  if (s.phase === 'throw') {
    if (a.type !== 'throw' || !Number.isFinite(a.pow) || !Number.isFinite(a.yaw) || !(a.style in PITCH)) return null;
    const p = s.pl[me];
    const b0 = throwBody(c, p.rank, a.pow, a.yaw, a.style);
    const home = canHome(c);
    const f = stickFlight(b0, a.style, home);
    s.throws++;
    s.queue.shift();
    p.stick = 'field';
    [p.sx, p.sy, p.sa] = f.rest;
    if (!f.hit) {
      ev.push({ k: 'throw', who: me, b0, style: a.style, hit: false, tHit: 0, stick: f.rest, can: null });
      if (checkEnd(s, ev)) return { state: s, events: ev };
      if (!s.queue.length) collect(s, ev);
      return { state: s, events: ev };
    }
    const cf = canFlight(f.hit, home);
    ev.push({ k: 'throw', who: me, b0, style: a.style, hit: true, tHit: r3(f.hit.t), stick: f.rest, can: { from: home, to: cf.to, a: cf.a } });
    s.can = { x: cf.to[0], y: cf.to[1], up: false, a: cf.a };
    p.knocks++;
    if (c.ranks.length > 1) p.rank++;
    ev.push({ k: 'rank', who: me, rank: p.rank, knocks: p.knocks });
    if (checkEnd(s, ev)) return { state: s, events: ev };
    // кто может сбегать за палкой: у кого она в поле (и сам сбивший)
    const asked = s.order.filter((i) => i !== s.pekar && s.pl[i].stick === 'field');
    s.sc = { t: 0, knocked: true, runners: [], asked, pk: pekarSpot(c), fixT: null };
    s.phase = asked.length ? 'run' : 'fix';
    return { state: s, events: ev };
  }

  const sc = s.sc;
  if (!sc) return null;

  if (s.phase === 'run') {
    if (a.type !== 'run' || typeof a.go !== 'boolean') return null;
    sc.asked.shift();
    ev.push({ k: 'run', who: me, go: a.go });
    if (a.go) {
      const p = s.pl[me];
      // бежит от своего места за чертой (бросавший к нему уже отошёл)
      sc.runners.push(runner(s, me, waitSpot(c, me, p.rank), REACT));
    }
    if (!sc.asked.length) s.phase = 'fix';
    return { state: s, events: ev };
  }

  if (s.phase === 'fix') {
    if (a.type !== 'fix') return null;
    const from = sc.pk;
    const can: [number, number] = [s.can.x, s.can.y];
    const home = canHome(c);
    const tPick = REACT + dist2(from, can) / VP;
    const to: [number, number] = [home[0] + 0.35, home[1] + 0.25];
    const t1 = r3(tPick + PICK_CAN + dist2(can, to) / VP_CAN + SET_CAN);
    ev.push({ k: 'fix', who: me, from, can, to, tPick: r3(tPick), t1, rs: sc.runners.slice() });
    s.can = { x: home[0], y: home[1], up: true, a: 0 };
    sc.pk = to;
    sc.t = t1;
    sc.fixT = t1;
    // в поле никого (или уже не догнать никого) — розыгрыш кончился
    if (!sc.runners.some((r) => safeAt(r) > t1)) {
      finish(s, t1, null, ev);
      return { state: s, events: ev };
    }
    s.phase = 'chase';
    return { state: s, events: ev };
  }

  if (s.phase === 'chase') {
    if (a.type !== 'chase') return null;
    const t0 = sc.t;
    if (a.who == null) {
      finish(s, t0, null, ev);
      return { state: s, events: ev };
    }
    const r = sc.runners.find((x) => x.who === a.who);
    if (!r) return null;
    const ch = chaseOf(sc.pk, t0, r);
    let tag = false;
    let to: [number, number];
    let t1: number;
    if (ch.ok) {
      tag = roll(tagChance(ch.margin));
      to = ch.at;
      t1 = ch.t;
    } else {
      // не догнал: добежал до черты за ним
      const q = runnerAt(r, safeAt(r));
      to = [r3(q.x), r3(q.y + 0.6)];
      t1 = r3(Math.max(t0 + 0.3, safeAt(r)));
    }
    ev.push({ k: 'chase', who: me, target: r.who, from: sc.pk, to, t0, t1: r3(t1), tag, rs: sc.runners.slice() });
    sc.pk = to;
    finish(s, r3(t1), tag ? r.who : null, ev);
    return { state: s, events: ev };
  }
  return null;
}

/** Бирка игрока: звание или счёт. */
export const rankName = (c: Cfg, p: Pl) => (c.ranks.length > 1 ? c.ranks[Math.min(p.rank, c.ranks.length - 1)] : `сбил ${p.knocks}`);
