/* Лапта — правила партии (без DOM: их гоняют сервер, боты и тесты). Две команды: нападение бьёт из «дома», защита
 * стоит в поле. Бьющий — по очереди; мяч ему подаёт свой же игрок. Удар действителен, если мяч первым касанием упал
 * в поле за контрольной линией (или за линией кона между боковыми). После действительного удара игроки нападения,
 * у которых нет права удара (уже били), и те, кто ждёт за линией кона, могут бежать — в одну сторону: из дома в кон или
 * из кона домой. Защита ловит мяч и кидает в бегущего: попал — «осалил», команды меняются местами. Пойманный с лёта мяч —
 * «свеча»: очко защите (во дворе — смена). Перебежка туда и обратно — 2 очка. В доме не осталось игроков с правом удара —
 * смена. Играют до заданного счёта.
 *
 * Партия идёт по решениям, а между ними — по часам розыгрыша: бегущие бегут, полевые бегут к мячу, мяч летит по физике
 * набора дворового спорта (core/dvorsport/body.ts). Кто бежит, кто ловит, в кого кидать — решают игроки (и боты),
 * исход считает комната; случайность (поймал ли, попал ли) — только через rng.int, чтобы показ правил подкручивался rig.
 * Оси: x — поперёк поля, y — от линии дома (0) к линии кона (L), z — вверх. */
import { body, fly, kick, MAT, type Body, type BodyFrame, type BodyMat } from '../../core/dvorsport/body';
import type { Options, Rng } from '../../core/types';

/** Мяч по утоптанной земле пустыря: катится меньше, чем по асфальту. */
export const BALL: BodyMat = { ...MAT.ball, roll: 2.6 };
export const BALL_R = 0.035;
/** Где мяч встречает биту: чуть перед домом, на высоте пояса. */
export const HIT_AT = { x: 0, y: 0.45, z: 1.0 };
/** Скорость бега: нападающий налегке, полевой — к мячу. */
export const VR = 6.2;
export const VF = 5.6;
/** К летящему мячу «под свечу» — медленнее: надо успеть встать и поймать. */
export const VF_AIR = 4.4;
/** Скорость брошенного мяча, м/с. */
export const VT = 19;
/** Реакция полевого на удар, замах броска, подобрать мяч, с. */
export const REACT = 0.35;
export const WIND = 0.3;
export const PICK = 0.25;
/** Ловля: до какой высоты достаёт руками, на сколько дотягивается в воздухе и с земли. */
export const REACH_Z = 2.2;
export const ARM = 0.6;
export const ARM_LOW = 0.4;

export type Style = 'candle' | 'far' | 'low';
export const PITCH: Record<Style, number> = { candle: 1.05, far: 0.6, low: 0.24 };

export interface Cfg {
  /** Игроков в команде. */
  n: number;
  /** Длина поля (дом — кон) и ширина, м. */
  L: number;
  W: number;
  /** Контрольная линия от дома, м. */
  ctrl: number;
  /** Попыток удара у бьющего. */
  tries: 1 | 2;
  /** Свеча: очко защите или смена. */
  candle: 'point' | 'swap';
  /** Из дома бежит только тот, кто сам ударил (ярославская лапта). */
  onlyHitter: boolean;
  /** До скольких очков. */
  target: number;
  /** Предел ударов на партию (страховка): потом — по счёту. */
  maxHits: number;
}

export type PStatus = 'ready' | 'used' | 'kon' | 'run';

export interface Team {
  score: number;
  /** Статус каждого игрока команды. */
  st: PStatus[];
  /** Очередь на удар (номера игроков со статусом ready). */
  queue: number[];
  /** Сдвиг очереди на следующую смену. */
  rot: number;
}

export interface Runner {
  /** Номер игрока в команде нападения. */
  who: number;
  from: 'dom' | 'kon';
  /** Когда побежал (часы розыгрыша). */
  t0: number;
}

export interface Play {
  /** Часы розыгрыша, с от удара. */
  t: number;
  /** Мяч после удара (переигрывается физикой на экране). */
  b0: Body;
  /** Кто бил. */
  batter: number;
  runners: Runner[];
  /** У кого мяч (полевой) — null, пока мяч не подобран. */
  holder: number | null;
  /** Где полевые сейчас (оси игры). */
  fpos: [number, number][];
  /** Ловля уже разыграна. */
  caught: boolean;
  /** Решений в розыгрыше (страховка от бесконечной перекидки). */
  moves: number;
  /** Кто может бежать в этом розыгрыше из дома. */
  mayRun: number[];
}

export type Phase = 'hit' | 'run' | 'catch' | 'throw';

export interface State {
  cfg: Cfg;
  /** Места команд: seats[0] — команда 0. */
  seats: [number, number];
  /** Какая команда в нападении. */
  atk: 0 | 1;
  teams: [Team, Team];
  phase: Phase;
  /** Бьющий и сколько попыток у него осталось. */
  batter: number;
  tries: number;
  play: Play | null;
  /** Ударов за партию. */
  hits: number;
  over: boolean;
  winners: number[];
  /** Только превью карточки: кадр с мячом в полёте. */
  shot?: boolean;
}

export type Action =
  | { type: 'hit'; pow: number; yaw: number; style: Style }
  | { type: 'run'; who: number[] }
  | { type: 'catch'; who: number }
  | { type: 'throw'; at: number }
  | { type: 'pass'; to: number }
  | { type: 'hold' };

export type HitKind = 'ok' | 'short' | 'out' | 'miss';

export type Event =
  | { k: 'hit'; team: number; who: number; b0: Body; kind: HitKind; land: { x: number; y: number } | null; style: Style; left: number }
  | { k: 'run'; team: number; who: number[]; t: number }
  | {
      k: 'catch';
      team: number;
      who: number;
      from: [number, number];
      to: [number, number];
      /** Когда добежал (поймал / подобрал) и когда мяч у него в руках. */
      t1: number;
      t2: number;
      air: boolean;
      ok: boolean;
      b0: Body;
      rs: Runner[];
      t0: number;
    }
  | { k: 'throw'; team: number; who: number; from: [number, number]; to: [number, number]; t0: number; t1: number; runner: number; hit: boolean; rs: Runner[] }
  | { k: 'fetch'; team: number; who: number; from: [number, number]; to: [number, number]; ball: [number, number]; t0: number; t1: number; rs: Runner[] }
  | { k: 'pass'; team: number; who: number; to: number; from: [number, number]; at: [number, number]; t0: number; t1: number; rs: Runner[] }
  | { k: 'hold'; team: number; t0: number; t1: number; rs: Runner[] }
  | { k: 'safe'; team: number; who: number; at: 'dom' | 'kon'; pts: number }
  | { k: 'candle'; team: number; pts: number }
  | { k: 'salit'; team: number; who: number }
  | { k: 'swap'; reason: 'salit' | 'candle' | 'nobat'; atk: number }
  | { k: 'reset' }
  | { k: 'end'; winners: number[] };

export function cfgFrom(o: Options): Cfg {
  const n = clampI(Number(o.n ?? 6), 3, 6);
  const L = Number(o.field ?? 50) || 50;
  const W = Math.round(L * 0.6);
  return {
    n,
    L,
    W,
    ctrl: Number(o.ctrl ?? Math.round(L / 5)) || 10,
    tries: Number(o.tries ?? 2) === 1 ? 1 : 2,
    candle: o.candle === 'swap' ? 'swap' : 'point',
    onlyHitter: o.onlyHitter === true || o.onlyHitter === 'yes',
    target: Number(o.target ?? 21) || 21,
    maxHits: 160,
  };
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 1000) / 1000;

/** Расстановка полевых: доли ширины и длины поля. */
const FORM: Record<number, [number, number][]> = {
  3: [[-0.24, 0.42], [0.24, 0.42], [0, 0.8]],
  4: [[-0.27, 0.38], [0.27, 0.38], [-0.17, 0.76], [0.17, 0.76]],
  5: [[-0.28, 0.36], [0.28, 0.36], [0, 0.56], [-0.22, 0.8], [0.22, 0.8]],
  6: [[-0.3, 0.33], [0.3, 0.33], [0, 0.5], [-0.28, 0.72], [0.28, 0.72], [0, 0.92]],
};
export function formation(c: Cfg): [number, number][] {
  return (FORM[c.n] ?? FORM[6]).map(([fx, fy]) => [r2(fx * c.W), r2(fy * c.L)]);
}

/** Дорожка бегущего (x): у каждого игрока своя, вдоль боковых — подальше от полевых. */
export const lane = (c: Cfg, who: number) => r2((who % 2 ? 1 : -1) * c.W * (0.36 + 0.035 * Math.floor(who / 2)));
/** Откуда и докуда бегут: чуть за линиями. */
export const Y_DOM = -0.4;
export const yKon = (c: Cfg) => c.L + 0.4;
const runLen = (c: Cfg) => yKon(c) - Y_DOM;

/** Где бегущий в момент t; done — уже за линией. */
export function runnerAt(c: Cfg, r: Runner, t: number): { x: number; y: number; done: boolean; tEnd: number } {
  const d = Math.max(0, (t - r.t0) * VR);
  const D = runLen(c);
  const tEnd = r.t0 + D / VR;
  const k = Math.min(1, d / D);
  const y = r.from === 'dom' ? Y_DOM + k * D : yKon(c) - k * D;
  return { x: lane(c, r.who), y, done: d >= D, tEnd };
}

/** Где ждут игроки нападения: в доме — за линией, в кону — за линией кона (оси игры). */
export function homeSpot(c: Cfg, who: number, at: 'dom' | 'kon'): [number, number] {
  // в доме — сбоку от площадки бьющего, у левой боковой, двумя рядами
  return at === 'dom' ? [r2(-3.6 - (who % 3) * 1.25), r2(-1.6 - Math.floor(who / 3) * 1.4)] : [lane(c, who), r2(yKon(c) + 1.2)];
}

/** Скорость мяча при полной силе — подобрана по длине поля: дальний удар в полную силу улетает чуть за кон. */
const vmaxCache = new Map<number, number>();
export function vMax(c: Cfg): number {
  const k = c.L;
  const got = vmaxCache.get(k);
  if (got) return got;
  let lo = 8;
  let hi = 70;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    const r = fly(kick(body(HIT_AT.x, HIT_AT.y, HIT_AT.z, BALL_R), m, 0, PITCH.far), { mat: BALL, maxT: 12, frameDt: 0, stop: (b) => b.z <= BALL_R + 1e-4 });
    if ((r.land?.y ?? r.body.y) < c.L * 1.12) lo = m;
    else hi = m;
  }
  const v = (lo + hi) / 2;
  vmaxCache.set(k, v);
  return v;
}

/** Мяч после удара: сила 0…1, направление (yaw: 0 — вдоль поля, плюс — вправо), стиль — угол вверх. */
export function strike(c: Cfg, pow: number, yaw: number, style: Style): Body {
  const v = vMax(c) * (0.3 + 0.7 * clamp(pow, 0, 1));
  const b = kick(body(HIT_AT.x, HIT_AT.y, HIT_AT.z, BALL_R), v, clamp(yaw, -0.75, 0.75), PITCH[style] ?? PITCH.far);
  return { ...b, vx: r2(b.vx), vy: r2(b.vy), vz: r2(b.vz) };
}

/** Полёт мяча кадрами (общий для комнаты, ботов и экрана). */
const flightCache = new Map<string, { frames: BodyFrame[]; land: { x: number; y: number; t: number } | null; rest: number }>();
export function flight(b0: Body) {
  const key = `${b0.x},${b0.y},${b0.z},${b0.vx},${b0.vy},${b0.vz}`;
  let f = flightCache.get(key);
  if (!f) {
    const r = fly(b0, { mat: BALL, maxT: 12, frameDt: 1 / 60 });
    f = { frames: r.frames, land: r.land, rest: r.t };
    if (flightCache.size > 400) flightCache.clear();
    flightCache.set(key, f);
  }
  return f;
}

/** Каков удар: в поле за контрольной (или за кон между боковыми), недолёт, аут. */
export function judge(c: Cfg, land: { x: number; y: number } | null): HitKind {
  if (!land) return 'out';
  if (land.y < 0 || Math.abs(land.x) > c.W / 2) return 'out';
  if (land.y < c.ctrl) return 'short';
  return 'ok';
}

/** Перехват: когда полевой из точки f успеет к мячу (в воздухе — до высоты рук, на земле — подобрать). */
export function intercept(b0: Body, f: [number, number]): { t: number; x: number; y: number; air: boolean; margin: number } {
  const fl = flight(b0);
  const tLand = fl.land?.t ?? Infinity;
  for (const [t, x, y, z] of fl.frames) {
    if (z > REACH_Z) continue;
    const air = t < tLand;
    const run = Math.max(0, (t - REACT) * (air ? VF_AIR : VF));
    const d = Math.hypot(x - f[0], y - f[1]);
    const arm = air ? ARM : ARM_LOW;
    if (air && z < 0.25) continue;
    if (d <= run + arm) return { t, x, y, air, margin: run + arm - d };
  }
  // мяч остановился раньше, чем добежали: бежим к лежащему
  const last = fl.frames[fl.frames.length - 1];
  const d = Math.hypot(last[1] - f[0], last[2] - f[1]);
  return { t: Math.max(last[0], REACT + Math.max(0, d - ARM_LOW) / VF), x: last[1], y: last[2], air: false, margin: 0 };
}

/** Шанс поймать с лёта по запасу (м). */
export const catchChance = (margin: number) => (margin > 1.2 ? 0.9 : margin > 0.4 ? 0.72 : 0.45);

/** Бросок в бегущего: когда мяч долетит, куда, на каком расстоянии бросок; null — бегущий успеет за линию. */
export function aimAt(c: Cfg, from: [number, number], t: number, r: Runner): { t1: number; at: [number, number]; d: number } | null {
  let ta = t + WIND;
  let p = runnerAt(c, r, ta);
  for (let k = 0; k < 8; k++) {
    p = runnerAt(c, r, ta);
    ta = t + WIND + Math.hypot(p.x - from[0], p.y - from[1]) / VT;
  }
  p = runnerAt(c, r, ta);
  if (p.done) return null;
  return { t1: ta, at: [r2(p.x), r2(p.y)], d: Math.hypot(p.x - from[0], p.y - from[1]) };
}

/** Шанс попасть в бегущего с расстояния d. */
export const hitChance = (d: number) => clamp(0.78 - d / 16, 0.06, 0.72);

export function newTeam(c: Cfg, rot: number): Team {
  const queue = Array.from({ length: c.n }, (_, i) => (i + rot) % c.n);
  return { score: 0, st: Array.from({ length: c.n }, () => 'ready' as PStatus), queue, rot };
}

export function newState(c: Cfg, seats: [number, number]): State {
  const s: State = {
    cfg: c,
    seats,
    atk: 0,
    teams: [newTeam(c, 0), newTeam(c, 0)],
    phase: 'hit',
    batter: 0,
    tries: c.tries,
    play: null,
    hits: 0,
    over: false,
    winners: [],
  };
  s.batter = s.teams[0].queue[0];
  return s;
}

export function setup(o: Options, seats: number[]): State {
  const ss = seats.length >= 2 ? [seats[0], seats[1]] : [seats[0] ?? 0, 1];
  return newState(cfgFrom(o), ss as [number, number]);
}

export const def0 = (s: State) => (1 - s.atk) as 0 | 1;
/** Чьё сейчас решение (место). */
export function toAct(s: State): number[] {
  if (s.over) return [];
  const t = s.phase === 'hit' || s.phase === 'run' ? s.atk : def0(s);
  return [s.seats[t]];
}

/** Кто из нападения может побежать сейчас. */
export function canRun(s: State): number[] {
  const p = s.play;
  if (!p) return [];
  const st = s.teams[s.atk].st;
  const out: number[] = [];
  for (let i = 0; i < s.cfg.n; i++) {
    if (st[i] === 'kon') out.push(i);
    else if (st[i] === 'used' && p.mayRun.includes(i)) out.push(i);
  }
  return out;
}

const clone = (s: State): State => JSON.parse(JSON.stringify(s));

/** Прибежавшие к моменту t: за линию, очки за перебежку домой. */
function arrive(s: State, t: number, ev: Event[]) {
  const p = s.play!;
  const tm = s.teams[s.atk];
  const keep: Runner[] = [];
  for (const r of p.runners) {
    const at = runnerAt(s.cfg, r, t);
    if (!at.done) {
      keep.push(r);
      continue;
    }
    if (r.from === 'dom') {
      tm.st[r.who] = 'kon';
      ev.push({ k: 'safe', team: s.atk, who: r.who, at: 'kon', pts: 0 });
    } else {
      tm.st[r.who] = 'ready';
      tm.queue.push(r.who);
      tm.score += 2;
      ev.push({ k: 'safe', team: s.atk, who: r.who, at: 'dom', pts: 2 });
    }
  }
  p.runners = keep;
}

/** Кто бьёт следующим; нет — смена. */
function nextBatter(s: State, ev: Event[]) {
  const tm = s.teams[s.atk];
  s.play = null;
  while (tm.queue.length && tm.st[tm.queue[0]] !== 'ready') tm.queue.shift();
  if (!tm.queue.length) {
    swap(s, 'nobat', ev);
    return;
  }
  s.batter = tm.queue[0];
  s.tries = s.cfg.tries;
  s.phase = 'hit';
}

function swap(s: State, reason: 'salit' | 'candle' | 'nobat', ev: Event[]) {
  const old = s.teams[s.atk];
  s.atk = (1 - s.atk) as 0 | 1;
  // бывшее нападение — в поле: все со своими местами; новое нападение — все в доме с правом удара
  old.st = old.st.map(() => 'ready');
  const nt = s.teams[s.atk];
  nt.rot = (nt.rot + 1) % s.cfg.n;
  const fresh = newTeam(s.cfg, nt.rot);
  nt.st = fresh.st;
  nt.queue = fresh.queue;
  s.play = null;
  s.batter = nt.queue[0];
  s.tries = s.cfg.tries;
  s.phase = 'hit';
  ev.push({ k: 'swap', reason, atk: s.atk });
}

function checkEnd(s: State, ev: Event[]): boolean {
  const [a, b] = s.teams;
  const won = a.score >= s.cfg.target || b.score >= s.cfg.target || s.hits >= s.cfg.maxHits;
  if (!won) return false;
  s.over = true;
  s.play = null;
  s.winners = a.score === b.score ? [s.seats[0], s.seats[1]] : [s.seats[a.score > b.score ? 0 : 1]];
  ev.push({ k: 'end', winners: s.winners });
  return true;
}

/** Розыгрыш окончен: полевые на места, следующий бьющий. */
function endPlay(s: State, ev: Event[]) {
  ev.push({ k: 'reset' });
  if (checkEnd(s, ev)) return;
  nextBatter(s, ev);
}

/** После решения: бегущие есть — решает защита; нет — нападение (если кому бежать), иначе розыгрыш окончен. */
function afterMove(s: State, ev: Event[]) {
  const p = s.play!;
  if (s.over) return;
  if (p.moves > 14) {
    // страховка: перекидка затянулась — все добегают, розыгрыш окончен
    const t1 = Math.max(p.t, ...p.runners.map((r) => runnerAt(s.cfg, r, 0).tEnd));
    ev.push({ k: 'hold', team: def0(s), t0: p.t, t1, rs: p.runners.slice() });
    p.t = t1;
    arrive(s, t1 + 1e-6, ev);
    if (!checkEnd(s, ev)) endPlay(s, ev);
    return;
  }
  if (p.runners.length) s.phase = 'throw';
  else if (canRun(s).length) s.phase = 'run';
  else endPlay(s, ev);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const c = s.cfg;
  const ev: Event[] = [];
  const roll = (p: number) => rng.int(1000) < Math.round(p * 1000);
  if (s.phase === 'hit') {
    if (a.type !== 'hit' || !Number.isFinite(a.pow) || !Number.isFinite(a.yaw) || !(a.style in PITCH)) return null;
    const pow = clamp(a.pow, 0, 1);
    // перебор силы — бывает промах
    const miss = pow > 0.93 && roll((pow - 0.93) * 7);
    const b0 = strike(c, pow, a.yaw, a.style);
    const fl = flight(b0);
    const kind: HitKind = miss ? 'miss' : judge(c, fl.land);
    s.hits++;
    const tm = s.teams[s.atk];
    if (kind !== 'ok') {
      s.tries--;
      ev.push({ k: 'hit', team: s.atk, who: s.batter, b0, kind, land: miss || !fl.land ? null : { x: r2(fl.land.x), y: r2(fl.land.y) }, style: a.style, left: s.tries });
      if (s.tries <= 0) {
        tm.st[s.batter] = 'used';
        tm.queue = tm.queue.filter((x) => x !== s.batter);
        if (!checkEnd(s, ev)) nextBatter(s, ev);
      } else checkEnd(s, ev);
      return { state: s, events: ev };
    }
    ev.push({ k: 'hit', team: s.atk, who: s.batter, b0, kind, land: { x: r2(fl.land!.x), y: r2(fl.land!.y) }, style: a.style, left: s.tries - 1 });
    tm.st[s.batter] = 'used';
    tm.queue = tm.queue.filter((x) => x !== s.batter);
    const used = tm.st.map((x, i) => (x === 'used' ? i : -1)).filter((i) => i >= 0);
    s.play = {
      t: 0,
      b0,
      batter: s.batter,
      runners: [],
      holder: null,
      fpos: formation(c),
      caught: false,
      moves: 0,
      mayRun: c.onlyHitter ? [s.batter] : used,
    };
    s.phase = canRun(s).length ? 'run' : 'catch';
    return { state: s, events: ev };
  }
  const p = s.play;
  if (!p) return null;
  p.moves++;
  if (s.phase === 'run') {
    if (a.type !== 'run' || !Array.isArray(a.who)) return null;
    const can = canRun(s);
    const who = [...new Set(a.who)];
    if (!who.every((w) => can.includes(w))) return null;
    const tm = s.teams[s.atk];
    const t0 = r2(p.t + (p.caught ? 0.15 : 0.35));
    for (const w of who) {
      p.runners.push({ who: w, from: tm.st[w] === 'kon' ? 'kon' : 'dom', t0 });
      tm.st[w] = 'run';
    }
    if (who.length) ev.push({ k: 'run', team: s.atk, who, t: t0 });
    if (!p.caught) {
      s.phase = 'catch';
      return { state: s, events: ev };
    }
    if (!who.length) {
      // никто не побежал — мяч подающему, розыгрыш окончен
      endPlay(s, ev);
      return { state: s, events: ev };
    }
    s.phase = 'throw';
    return { state: s, events: ev };
  }
  if (s.phase === 'catch') {
    if (a.type !== 'catch' || !Number.isInteger(a.who) || a.who < 0 || a.who >= c.n) return null;
    const f = p.fpos[a.who];
    const ic = intercept(p.b0, f);
    let ok = true;
    let t2 = ic.t + PICK;
    if (ic.air) {
      ok = roll(catchChance(ic.margin));
      if (!ok) t2 = ic.t + 0.8; // выронил — поднимает
    }
    const to: [number, number] = [r2(ic.x), r2(ic.y)];
    ev.push({ k: 'catch', team: def0(s), who: a.who, from: f, to, t1: r2(ic.t), t2: r2(t2), air: ic.air, ok, b0: p.b0, rs: p.runners.slice(), t0: p.t });
    p.fpos[a.who] = to;
    p.holder = a.who;
    p.caught = true;
    if (ic.air && ok) {
      if (c.candle === 'swap') {
        ev.push({ k: 'candle', team: def0(s), pts: 0 });
        ev.push({ k: 'reset' });
        swap(s, 'candle', ev);
        return { state: s, events: ev };
      }
      s.teams[def0(s)].score += 1;
      ev.push({ k: 'candle', team: def0(s), pts: 1 });
      if (checkEnd(s, ev)) return { state: s, events: ev };
    }
    p.t = r2(t2);
    arrive(s, p.t, ev);
    if (checkEnd(s, ev)) return { state: s, events: ev };
    afterMove(s, ev);
    return { state: s, events: ev };
  }
  if (s.phase === 'throw') {
    const h = p.holder;
    if (h == null) return null;
    const from = p.fpos[h];
    if (a.type === 'hold') {
      const t1 = r2(Math.max(p.t, ...p.runners.map((r) => runnerAt(c, r, 0).tEnd)) + 0.01);
      ev.push({ k: 'hold', team: def0(s), t0: p.t, t1, rs: p.runners.slice() });
      p.t = t1;
      arrive(s, t1, ev);
      if (!checkEnd(s, ev)) endPlay(s, ev);
      return { state: s, events: ev };
    }
    if (a.type === 'pass') {
      if (!Number.isInteger(a.to) || a.to < 0 || a.to >= c.n || a.to === h) return null;
      const at = p.fpos[a.to];
      const t1 = r2(p.t + WIND + Math.hypot(at[0] - from[0], at[1] - from[1]) / VT + 0.15);
      ev.push({ k: 'pass', team: def0(s), who: h, to: a.to, from, at, t0: p.t, t1, rs: p.runners.slice() });
      p.holder = a.to;
      p.t = t1;
      arrive(s, t1, ev);
      if (checkEnd(s, ev)) return { state: s, events: ev };
      afterMove(s, ev);
      return { state: s, events: ev };
    }
    if (a.type !== 'throw' || !Number.isInteger(a.at)) return null;
    const r = p.runners.find((x) => x.who === a.at);
    if (!r) return null;
    const aim = aimAt(c, from, p.t, r);
    if (aim && roll(hitChance(aim.d))) {
      ev.push({ k: 'throw', team: def0(s), who: h, from, to: aim.at, t0: p.t, t1: r2(aim.t1), runner: r.who, hit: true, rs: p.runners.slice() });
      ev.push({ k: 'salit', team: s.atk, who: r.who });
      ev.push({ k: 'reset' });
      swap(s, 'salit', ev);
      return { state: s, events: ev };
    }
    // мимо: мяч улетает за бегущего, ближайший полевой бежит за ним
    const tgt = aim ? aim.at : (() => {
      const q = runnerAt(c, r, p.t + 1);
      return [q.x, q.y] as [number, number];
    })();
    const t1 = aim ? aim.t1 : p.t + WIND + Math.hypot(tgt[0] - from[0], tgt[1] - from[1]) / VT;
    const dx = tgt[0] - from[0];
    const dy = tgt[1] - from[1];
    const dl = Math.hypot(dx, dy) || 1;
    const over = 6 + rng.int(60) / 10;
    const ball: [number, number] = [r2(clamp(tgt[0] + (dx / dl) * over, -c.W / 2 - 4, c.W / 2 + 4)), r2(clamp(tgt[1] + (dy / dl) * over, -6, c.L + 6))];
    ev.push({ k: 'throw', team: def0(s), who: h, from, to: tgt, t0: p.t, t1: r2(t1), runner: r.who, hit: false, rs: p.runners.slice() });
    let best = 0;
    let bt = Infinity;
    p.fpos.forEach((fp, i) => {
      const tt = Math.max(t1 + 0.35, p.t + REACT + Math.hypot(ball[0] - fp[0], ball[1] - fp[1]) / VF) + PICK;
      if (tt < bt) (bt = tt), (best = i);
    });
    ev.push({ k: 'fetch', team: def0(s), who: best, from: p.fpos[best], to: ball, ball, t0: r2(t1), t1: r2(bt), rs: p.runners.slice() });
    p.fpos[best] = ball;
    p.holder = best;
    p.t = r2(bt);
    arrive(s, p.t, ev);
    if (checkEnd(s, ev)) return { state: s, events: ev };
    afterMove(s, ev);
    return { state: s, events: ev };
  }
  return null;
}

/** Подпись команды. */
export const TEAM_NAMES = ['Затулинка', 'Затон'];
