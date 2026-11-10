/* Лапта — игра реального времени (без DOM: её крутит комната — сервер, хост P2P или браузер). Каждая сторона управляет
 * одним своим пацаном (переключается на любого из команды), остальных ведёт ИИ-напарник (ai.ts). Нападение бьёт из «дома»:
 * удар засчитан, если мяч первым касанием упал в поле за контрольной линией. Пока мяч в игре, бившие и ждущие за коном
 * могут выбежать в поле — сами решают, когда, и бегут куда хотят (рывок — уклониться). Перебежал из дома за кон — ждёшь там,
 * вернулся домой — 2 очка и снова право удара. Защита ловит мяч (с лёта — по кнопке вовремя, с земли — подобрать), кидает
 * в бегущего: попал — «осалил», команды меняются. Пойманный с лёта мяч от удара — «свеча»: очко защите (во дворе — смена).
 * В доме не осталось никого с правом удара — смена. До счёта (и по времени, если задано).
 * Мяч в свободном полёте — по кадрам flight(b0) от момента t0 (детерминированно и дёшево); люди — точки со скоростью.
 * Оси: x — поперёк поля, y — от линии дома (0) к линии кона (L), z — вверх. */
import { kick, sample, type Body } from '../../core/dvorsport/body';
import { applySpeed, cleanSpeed } from '../../core/realtime';
import { BODY, dash, drive, dsSpeed, dtScale, separate, slowmo } from '../../core/dvorsport/sim';
import type { Options, Rng } from '../../core/types';
import { aiAttack, aiDefense, aiHit, aiThrow, type Want } from './ai';
import { BALL_R, WALLS, cfgFrom, flight, formation, HIT_AT, homeSpot, judge, strike, VF, VR, VT, yKon, type Cfg, type HitKind, type PStatus, type Style } from './field';

export * from './field';

export const TICK_MS = 1000 / 60;
/** Рывок: во сколько раз быстрее, сколько длится и перезарядка, с. */
export const DASH = { k: BODY.dashK, t: BODY.dashT, cd: BODY.dashCd };
/** Ловля с лёта: окно после нажатия, с; дотянуться руками (м) и до какой высоты. */
export const CATCH_WIN = 0.45;
export const ARM_AIR = 0.75;
export const ARM_GROUND = 0.55;
export const REACH = 2.3;
/** Осалить: мяч ближе этого к бегущему и не выше. */
export const HIT_R = 0.45;
export const HIT_Z = 1.9;
/** Где стоит бьющий и подающий. */
export const BAT_SPOT: [number, number] = [HIT_AT.x - 0.75, HIT_AT.y - 0.55];
export const SERVE_SPOT: [number, number] = [1.1, 1.6];

export interface Man {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Нападение: статус; защита — 'ready' (не важен). */
  st: PStatus;
  /** Откуда выбежал (для бегущего). */
  from?: 'dom' | 'kon';
  /** Рывок: сколько ещё длится и перезарядка. */
  dash: number;
  cd: number;
}

export interface BallS {
  /** serve — у подающего; free — летит/катится по flight(b0) с момента t0; held — у полевого holder. */
  mode: 'serve' | 'free' | 'held';
  b0: Body | null;
  t0: number;
  holder: number;
  /** Мяч от удара ещё не касался земли (свеча). */
  air: boolean;
  /** Брошен защитой (может осалить) и кем. */
  thrown: boolean;
  by: number;
  /** Где был на прошлом шаге (для проверки касаний отрезком). */
  px: number;
  py: number;
  pz: number;
}

export interface In {
  /** Направление бега в осях игры, длина ≤ 1. */
  mx: number;
  my: number;
  /** Кем управлять: номер в команде; −1 — само (бьющий / бегущий / ближний к мячу). */
  k: number;
  /** Бот или «за меня — компьютер»: уровень 0…2; −1 — человек. */
  ai: number;
  /** Одноразовые действия — по номеру (комната повторяет последний ввод, пока не придёт новый). */
  hit?: { n: number; pow: number; yaw: number; style: Style };
  c?: number;
  th?: { n: number; tx: number; ty: number };
  d?: number;
  sp?: number;
  /** Обучение просит подождать: движок стоит (только если соперник — компьютер). */
  hold?: boolean;
}

export type Event =
  | { k: 'hit'; team: number; who: number; kind: HitKind; b0: Body; t: number; left: number }
  | { k: 'catch'; team: number; who: number; air: boolean }
  | { k: 'throw'; team: number; who: number; pass: boolean }
  | { k: 'run'; team: number; who: number }
  | { k: 'dash'; team: number; who: number }
  | { k: 'safe'; team: number; who: number; at: 'dom' | 'kon'; pts: number }
  | { k: 'candle'; team: number; pts: number }
  | { k: 'salit'; team: number; who: number }
  | { k: 'swap'; reason: 'salit' | 'candle' | 'nobat'; atk: number }
  | { k: 'dead' }
  | { k: 'end'; winners: number[] };

export interface State {
  cfg: Cfg;
  seats: [number, number];
  atk: 0 | 1;
  score: [number, number];
  /** Часы партии (игровые), с; скорость физики. */
  t: number;
  speed: number;
  spSeen?: number[];
  phase: 'serve' | 'live' | 'pause';
  /** До какого времени пауза и что после неё: подача того же бьющего или следующего. */
  until: number;
  next: 'serve' | 'batter';
  /** Когда началась подача / розыгрыш. */
  since: number;
  men: [Man[], Man[]];
  /** Очередь на удар (номера в команде нападения). */
  queue: number[];
  rot: [number, number];
  batter: number;
  tries: number;
  ball: BallS;
  /** Кем управляет каждая сторона и выбирает ли сама. */
  ctrl: [number, number];
  auto: [boolean, boolean];
  /** Последние номера одноразовых действий по сторонам. */
  seen: { hit: number; c: number; th: number; d: number }[];
  /** Окно ловли с лёта по сторонам (до какого времени). */
  catchT: [number, number];
  /** Кто может выбежать из дома в этом розыгрыше. */
  mayRun: number[];
  /** Тихо (никто не бежит, мяч у защиты) с какого времени (−1 — не тихо). */
  quietT: number;
  /** ИИ: кто бежит за мячом и с какого времени решено; кто из нападения решил бежать; когда взял мяч. */
  chase: number;
  chaseT: number;
  go: number[];
  holdT: number;
  /** Ловля с лёта уже разыграна этим полевым (ИИ) — для этого полёта. */
  tried: number[];
  hits: number;
  over: boolean;
  winners: number[];
  /** Только превью карточки. */
  shot?: boolean;
  /** Позиция показа правил (только там apply «перематывает» партию). */
  demo?: boolean;
  /** Замедление на ударе и ловле (core/dvorsport/sim.ts). */
  slowUntil?: number;
  slowK?: number;
  /** Мяч лёг и лежит с этого времени (для вбрасывания). */
  restT?: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const man = (x: number, y: number, st: PStatus = 'ready'): Man => ({ x, y, vx: 0, vy: 0, st, dash: 0, cd: 0 });
const ballServe = (t: number): BallS => ({ mode: 'serve', b0: null, t0: t, holder: -1, air: false, thrown: false, by: -1, px: 0, py: 0, pz: 0 });

export function newGame(o: Options, seats: [number, number], speed = dsSpeed(o)): State {
  const c = cfgFrom(o);
  const s: State = {
    cfg: c,
    seats,
    atk: 0,
    score: [0, 0],
    t: 0,
    speed,
    phase: 'pause',
    until: 1.0,
    next: 'serve',
    since: 0,
    men: [Array.from({ length: c.n }, (_, i) => man(...homeSpot(c, i, 'dom'))), formation(c).map(([x, y]) => man(x, y))],
    queue: Array.from({ length: c.n }, (_, i) => i),
    rot: [0, 0],
    batter: 0,
    tries: c.tries,
    ball: ballServe(0),
    ctrl: [0, 0],
    auto: [true, true],
    seen: [
      { hit: 0, c: 0, th: 0, d: 0 },
      { hit: 0, c: 0, th: 0, d: 0 },
    ],
    catchT: [-1, -1],
    mayRun: [],
    quietT: -1,
    chase: -1,
    chaseT: -1,
    go: [],
    holdT: 0,
    tried: [],
    hits: 0,
    over: false,
    winners: [],
  };
  s.men[0][0].x = BAT_SPOT[0];
  s.men[0][0].y = BAT_SPOT[1];
  return s;
}

export const defT = (s: State) => (1 - s.atk) as 0 | 1;

export const idleInput = (): In => ({ mx: 0, my: 0, k: -1, ai: 1 });

export function cleanInput(raw: unknown): In | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const out: In = { mx: clamp(num(r.mx), -1, 1), my: clamp(num(r.my), -1, 1), k: Math.round(clamp(num(r.k, -1), -1, 5)), ai: Math.round(clamp(num(r.ai, -1), -1, 2)) };
  const h = r.hit as Record<string, unknown> | undefined;
  if (h && typeof h === 'object') {
    const st = h.style;
    if (st === 'candle' || st === 'far' || st === 'low') out.hit = { n: Math.round(num(h.n)), pow: clamp(num(h.pow), 0, 1), yaw: clamp(num(h.yaw), -0.75, 0.75), style: st };
  }
  if (r.c != null) out.c = Math.round(num(r.c));
  if (r.d != null) out.d = Math.round(num(r.d));
  const th = r.th as Record<string, unknown> | undefined;
  if (th && typeof th === 'object') out.th = { n: Math.round(num(th.n)), tx: clamp(num(th.tx), -80, 80), ty: clamp(num(th.ty), -20, 120) };
  const sp = cleanSpeed(r.sp);
  if (sp != null) out.sp = sp;
  if (r.hold === true) out.hold = true;
  return out;
}

/** Кто подаёт: первый в очереди после бьющего (или кто угодно из дома). */
export function server(s: State): number {
  for (const i of s.queue) if (i !== s.batter) return i;
  return s.men[s.atk].findIndex((m, i) => i !== s.batter && (m.st === 'ready' || m.st === 'used'));
}

/** Может ли игрок нападения сейчас выбежать в поле. */
export function mayLeave(s: State, i: number): boolean {
  if (s.phase !== 'live') return false;
  const m = s.men[s.atk][i];
  if (m.st === 'kon') return true;
  return m.st === 'used' && s.mayRun.includes(i);
}

/** Где мяч сейчас (оси игры). */
export function ballPos(s: State): [number, number, number] {
  const b = s.ball;
  if (b.mode === 'free' && b.b0) {
    const f = sample(flight(b.b0).frames, s.t - b.t0);
    return [f[1], f[2], f[3]];
  }
  if (b.mode === 'held') {
    const m = s.men[defT(s)][b.holder];
    return [m.x + 0.25, m.y, 1.1];
  }
  const sv = server(s);
  const m = sv >= 0 ? s.men[s.atk][sv] : null;
  return m ? [m.x - 0.2, m.y, 1.15] : [SERVE_SPOT[0], SERVE_SPOT[1], 1.15];
}

/** Мяч лежит (докатился). */
export const ballRests = (s: State) => s.ball.mode === 'free' && !!s.ball.b0 && s.t - s.ball.t0 >= flight(s.ball.b0).rest;

/** Расстояние от точки до отрезка (в плане). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
}

/** Бросок из точки from (высота руки) в точку (tx, ty) — пологий, долетает на высоте пояса; e — ошибка руки, рад. */
export function throwBody(from: [number, number], tx: number, ty: number, e = 0): Body {
  const d = Math.max(0.5, Math.hypot(tx - from[0], ty - from[1]));
  const v = VT;
  const z0 = 1.7;
  const pitch = clamp(Math.atan2(1.0 - z0 + (9.81 * d * d) / (2 * v * v), d), -0.2, 0.6);
  const yaw = Math.atan2(tx - from[0], ty - from[1]) + e;
  const b = kick({ x: from[0], y: from[1], z: z0, vx: 0, vy: 0, vz: 0, r: BALL_R, a: 0, w: 0 }, v, yaw, pitch);
  return { ...b, x: r3(b.x), y: r3(b.y), vx: r3(b.vx), vy: r3(b.vy), vz: r3(b.vz) };
}

/** Упреждение: куда кинуть, чтобы встретить бегущего (по его скорости). */
export function lead(from: [number, number], m: Man): [number, number] {
  let t = 0.15;
  for (let k = 0; k < 6; k++) t = 0.15 + Math.hypot(m.x + m.vx * t - from[0], m.y + m.vy * t - from[1]) / VT;
  return [m.x + m.vx * t, m.y + m.vy * t];
}

function pause(s: State, sec: number, next: 'serve' | 'batter') {
  s.phase = 'pause';
  s.until = s.t + sec;
  s.next = next;
}

function resetBall(s: State) {
  s.ball = ballServe(s.t);
  s.go = [];
  s.chase = -1;
  s.tried = [];
}

/** Кто бьёт следующим; нет — смена. */
function nextBatter(s: State, ev: Event[]) {
  const st = s.men[s.atk];
  s.queue = s.queue.filter((i) => st[i].st === 'ready');
  if (!s.queue.length) {
    swap(s, 'nobat', ev);
    return;
  }
  s.batter = s.queue[0];
  s.tries = s.cfg.tries;
  resetBall(s);
  pause(s, 0.45, 'serve');
}

function swap(s: State, reason: 'salit' | 'candle' | 'nobat', ev: Event[]) {
  const c = s.cfg;
  for (const m of s.men[s.atk]) (m.st = 'ready'), (m.from = undefined), (m.dash = 0);
  s.atk = (1 - s.atk) as 0 | 1;
  s.rot[s.atk] = (s.rot[s.atk] + 1) % c.n;
  for (const m of s.men[s.atk]) (m.st = 'ready'), (m.from = undefined), (m.dash = 0);
  s.queue = Array.from({ length: c.n }, (_, i) => (i + s.rot[s.atk]) % c.n);
  s.batter = s.queue[0];
  s.tries = c.tries;
  s.auto = [true, true];
  resetBall(s);
  ev.push({ k: 'swap', reason, atk: s.atk });
  pause(s, 1.2, 'serve');
}

function checkEnd(s: State, ev: Event[]): boolean {
  if (s.over) return true;
  const c = s.cfg;
  const [a, b] = s.score;
  const done = a >= c.target || b >= c.target || s.hits >= c.maxHits || (c.minutes > 0 && s.t >= c.minutes * 60);
  if (!done) return false;
  s.over = true;
  s.winners = a === b ? [s.seats[0], s.seats[1]] : [s.seats[a > b ? 0 : 1]];
  ev.push({ k: 'end', winners: s.winners });
  return true;
}

/** Розыгрыш окончен: бегущих нет, мяч у защиты. */
function dead(s: State, ev: Event[]) {
  ev.push({ k: 'dead' });
  if (checkEnd(s, ev)) return;
  nextBatter(s, ev);
}

/** Удар. */
function doHit(s: State, pow: number, yaw: number, style: Style, ev: Event[]) {
  const b0 = strike(s.cfg, pow, yaw, style);
  const kind: HitKind = judge(s.cfg, flight(b0).land);
  s.hits++;
  const atk = s.men[s.atk];
  const who = s.batter;
  s.ball = { mode: 'free', b0, t0: s.t, holder: -1, air: kind === 'ok', thrown: false, by: -1, px: b0.x, py: b0.y, pz: b0.z };
  s.tried = [];
  s.chase = -1;
  if (kind !== 'ok') {
    s.tries--;
    ev.push({ k: 'hit', team: s.atk, who, kind, b0, t: s.t, left: s.tries });
    if (s.tries <= 0) {
      atk[who].st = 'used';
      s.queue = s.queue.filter((i) => i !== who);
      pause(s, 1.1, 'batter');
    } else pause(s, 1.1, 'serve');
    return;
  }
  ev.push({ k: 'hit', team: s.atk, who, kind, b0, t: s.t, left: s.tries - 1 });
  atk[who].st = 'used';
  s.queue = s.queue.filter((i) => i !== who);
  s.mayRun = s.cfg.onlyHitter ? [who] : atk.map((m, i) => (m.st === 'used' ? i : -1)).filter((i) => i >= 0);
  s.phase = 'live';
  s.since = s.t;
  s.quietT = -1;
  s.restT = undefined;
  s.go = [];
  slowmo(s, 0.45, 0.35);
}

function tryDash(m: Man, team: number, who: number, ev: Event[]) {
  if (dash(m)) ev.push({ k: 'dash', team, who });
}

/** Подача: бьющий на площадке. */
function startServe(s: State) {
  s.phase = 'serve';
  s.since = s.t;
  resetBall(s);
  s.auto = [true, true];
}

/** Все — по местам: бьющий, подающий, ждущие, полевые. */
function walkHome(s: State, dt: number) {
  const c = s.cfg;
  const A = s.atk;
  const sv = server(s);
  const go = (m: Man, x: number, y: number, v: number) => {
    const dx = x - m.x;
    const dy = y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.03) {
      m.vx = m.vy = 0;
      return;
    }
    const sp = Math.min(v, d / dt);
    m.vx = (dx / d) * sp;
    m.vy = (dy / d) * sp;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
  };
  s.men[A].forEach((m, i) => {
    const [x, y] = i === s.batter ? BAT_SPOT : i === sv ? SERVE_SPOT : homeSpot(c, i, m.st === 'kon' ? 'kon' : 'dom');
    go(m, x, y, 14);
  });
  formation(c).forEach(([x, y], i) => go(s.men[defT(s)][i], x, y, 14));
}

/** Кем управляет сторона, если выбирает сама: нападение — бьющий / бегущий / готовый бежать; защита — ближний к мячу. */
export function autoCtrl(s: State, t: number): number {
  const men = s.men[t];
  const cur = s.ctrl[t];
  if (t === s.atk) {
    if (s.phase !== 'live') return s.batter;
    if (men[cur] && (men[cur].st === 'run' || mayLeave(s, cur))) return cur;
    const r = men.findIndex((m) => m.st === 'run');
    if (r >= 0) return r;
    const k = men.findIndex((_, i) => mayLeave(s, i));
    return k >= 0 ? k : cur;
  }
  if (s.ball.mode === 'held') return s.ball.holder;
  const [bx, by] = s.ball.mode === 'free' && s.ball.b0 ? chasePoint(s) : ballPos(s);
  let best = 0;
  let bd = Infinity;
  men.forEach((m, i) => {
    const d = Math.hypot(m.x - bx, m.y - by);
    if (d < bd) (bd = d), (best = i);
  });
  if (men[cur] && Math.hypot(men[cur].x - bx, men[cur].y - by) < bd + 2.5) return cur;
  return best;
}

/** Куда бежать за летящим мячом: где он окажется низко (≤ 2 м) не раньше, чем сейчас, — первая такая точка. */
export function chasePoint(s: State): [number, number] {
  const b = s.ball;
  if (!b.b0) return [0, 0];
  const fl = flight(b.b0);
  const tt = s.t - b.t0;
  for (const f of fl.frames) if (f[0] >= tt && f[3] <= 2.0) return [f[1], f[2]];
  const last = fl.frames[fl.frames.length - 1];
  return [last[1], last[2]];
}

/** Шаг симуляции. */
export function step(s: State, inputs: (In | null | undefined)[], rng: Rng): Event[] {
  const ev: Event[] = [];
  if (s.over) return ev;
  // сохранение прежней пошаговой лапты (до реального времени) — доиграть нельзя
  if (!Array.isArray(s.men)) {
    s.over = true;
    s.winners = [];
    return ev;
  }
  const c = s.cfg;
  const ins = [0, 1].map((t) => inputs[s.seats[t]] ?? idleInput());
  for (let t = 0; t < 2; t++) applySpeed(s, s.seats[t], ins[t].sp);
  // обучение: человек просит подождать, соперник — компьютер, — партия стоит, двигается только его пацан
  const frozen = [0, 1].some((t) => ins[t].ai < 0 && ins[t].hold && ins[1 - t].ai >= 0);
  const realDt = (TICK_MS / 1000) * s.speed * dtScale(s);
  const dt = frozen ? 0 : realDt;
  s.t = r3(s.t + dt);
  const own = (t: number, i: number) => ins[t].ai < 0 && s.ctrl[t] === i;
  const A = s.atk;
  const D = defT(s);

  // свой пацан и одноразовые действия людей
  const acts = [0, 1].map(() => ({ catch: false, dash: false, th: null as In['th'] | null, hit: null as In['hit'] | null }));
  for (let t = 0; t < 2; t++) {
    const inp = ins[t];
    const seen = s.seen[t];
    if (inp.ai < 0) {
      if (inp.k >= 0 && inp.k < c.n) (s.ctrl[t] = inp.k), (s.auto[t] = false);
      else s.auto[t] = true;
      // удар — только в свою подачу (раньше времени не «съедаем» нажатие)
      if (inp.hit && inp.hit.n !== seen.hit && s.phase === 'serve' && t === s.atk) (seen.hit = inp.hit.n), (acts[t].hit = inp.hit);
      if (inp.c != null && inp.c !== seen.c) (seen.c = inp.c), (acts[t].catch = true);
      if (inp.d != null && inp.d !== seen.d) (seen.d = inp.d), (acts[t].dash = true);
      if (inp.th && inp.th.n !== seen.th && s.ball.mode === 'held' && t !== s.atk) (seen.th = inp.th.n), (acts[t].th = inp.th);
    } else s.auto[t] = true;
    if (s.auto[t]) s.ctrl[t] = autoCtrl(s, t);
  }

  if (s.phase === 'pause') {
    walkHome(s, dt);
    separate([...s.men[0], ...s.men[1]]);
    if (s.t >= s.until) {
      if (s.next === 'batter') nextBatter(s, ev);
      else startServe(s);
    }
    return ev;
  }

  if (s.phase === 'serve') {
    walkHome(s, dt);
    separate([...s.men[0], ...s.men[1]], undefined, (i) => i === s.batter && s.atk === 0 || i === s.cfg.n + s.batter && s.atk === 1);
    const inp = ins[A];
    let hit = acts[A].hit;
    // бот бьёт не сразу — подающий подбросил, бьющий приладился
    if (inp.ai >= 0) hit = s.t - s.since > 0.6 ? aiHit(s, inp.ai, rng) : null;
    if (hit) doHit(s, hit.pow, hit.yaw, hit.style, ev);
    return ev;
  }

  // ---- розыгрыш: ИИ ведёт всех, люди — своего
  const lvA = ins[A].ai >= 0 ? ins[A].ai : 2;
  const lvD = ins[D].ai >= 0 ? ins[D].ai : 2;
  const wants: Want[][] = [aiAttack(s, lvA, rng), aiDefense(s)];
  if (A === 1) wants.reverse();
  for (const t of [A, D]) {
    const inp = ins[t];
    if (inp.ai >= 0) continue;
    wants[t][s.ctrl[t]] = { mx: inp.mx, my: inp.my, dash: acts[t].dash };
  }
  const atk = s.men[A];
  const def = s.men[D];
  atk.forEach((m, i) => {
    const w = wants[A][i] ?? { mx: 0, my: 0 };
    const can = m.st === 'run' || mayLeave(s, i);
    if (w.dash && can) tryDash(m, A, i, ev);
    drive(m, w, VR, frozen && own(A, i) ? realDt : dt);
    m.x = clamp(m.x, WALLS.x0 + 0.5, WALLS.x1 - 0.5);
    if (!can) {
      // кому нельзя — за своей линией
      if (m.st === 'kon') m.y = Math.max(m.y, c.L + 0.3);
      else m.y = Math.min(m.y, -0.3);
      return;
    }
    if (m.st !== 'run') {
      const out = m.st === 'kon' ? m.y < c.L : m.y > 0;
      if (out) {
        m.from = m.st === 'kon' ? 'kon' : 'dom';
        m.st = 'run';
        ev.push({ k: 'run', team: A, who: i });
      } else if (m.st === 'kon') m.y = Math.min(m.y, yKon(c) + 4);
      else m.y = Math.max(m.y, -6);
      return;
    }
    m.y = clamp(m.y, WALLS.y0 + 0.5, WALLS.y1 - 0.5);
    if (m.from === 'dom' && m.y >= c.L) {
      m.st = 'kon';
      m.from = undefined;
      ev.push({ k: 'safe', team: A, who: i, at: 'kon', pts: 0 });
    } else if (m.from === 'kon' && m.y <= 0) {
      m.st = 'ready';
      m.from = undefined;
      s.queue.push(i);
      s.score[A] += 2;
      ev.push({ k: 'safe', team: A, who: i, at: 'dom', pts: 2 });
    } else if (m.from === 'dom' && m.y <= -0.1) {
      // передумал и вернулся
      m.st = 'used';
      m.from = undefined;
    } else if (m.from === 'kon' && m.y >= c.L + 0.1) {
      m.st = 'kon';
      m.from = undefined;
    }
  });
  if (checkEnd(s, ev)) return ev;
  def.forEach((m, i) => {
    const w = wants[D][i] ?? { mx: 0, my: 0 };
    if (w.dash) tryDash(m, D, i, ev);
    drive(m, w, VF, frozen && own(D, i) ? realDt : dt);
    m.x = clamp(m.x, WALLS.x0 + 0.5, WALLS.x1 - 0.5);
    m.y = clamp(m.y, WALLS.y0 + 0.5, WALLS.y1 - 0.5);
  });
  separate([...atk, ...def]);
  if (acts[D].catch) s.catchT[D] = s.t + CATCH_WIN;

  const b = s.ball;
  if (b.mode === 'free' && b.b0) {
    const fl = flight(b.b0);
    const tt = s.t - b.t0;
    const [x, y, z] = ballPos(s);
    if (b.air && fl.land && tt >= fl.land.t) b.air = false;
    // брошенный защитой — в бегущего
    if (b.thrown) {
      for (let i = 0; i < atk.length; i++) {
        const m = atk[i];
        if (m.st !== 'run') continue;
        if (Math.min(z, b.pz) <= HIT_Z && segDist(m.x, m.y, b.px, b.py, x, y) < HIT_R) {
          ev.push({ k: 'salit', team: A, who: i });
          slowmo(s, 0.6, 0.3);
          swap(s, 'salit', ev);
          return ev;
        }
      }
    }
    // поймать с лёта (человек — в окно кнопки, ИИ — с шансом) или подобрать с земли
    let got = -1;
    let gotAir = false;
    for (let i = 0; i < def.length && got < 0; i++) {
      if (b.thrown && i === b.by && tt < 0.4) continue;
      const m = def[i];
      const d = segDist(m.x, m.y, b.px, b.py, x, y);
      if (z <= 0.35) {
        if (d < ARM_GROUND) got = i;
        continue;
      }
      if (z > REACH || d >= ARM_AIR) continue;
      const human = ins[D].ai < 0 && i === s.ctrl[D];
      if (human) {
        if (s.t <= s.catchT[D]) (got = i), (gotAir = true);
      } else if (!s.tried.includes(i)) {
        s.tried.push(i);
        // пас своему ловят почти всегда, удар с лёта — по уровню
        const p = b.thrown ? 0.95 : ([0.5, 0.72, 0.88][lvD] ?? 0.72);
        if (rng.int(1000) < p * 1000) (got = i), (gotAir = true);
      }
    }
    b.px = x;
    b.py = y;
    b.pz = z;
    // вбрасывание: мяч лежит, а подобрать никто не успел (далеко, за людьми) — его подаёт ближайшему полевому
    if (got < 0 && ballRests(s)) {
      if (s.restT == null) s.restT = s.t;
      else if (s.t - s.restT > 2.5) {
        let bd = Infinity;
        def.forEach((m, i) => {
          const d = Math.hypot(m.x - x, m.y - y);
          if (d < bd) (bd = d), (got = i);
        });
      }
    } else s.restT = undefined;
    if (got >= 0) {
      const candle = gotAir && b.air && !b.thrown;
      s.ball = { mode: 'held', b0: null, t0: s.t, holder: got, air: false, thrown: false, by: -1, px: x, py: y, pz: z };
      s.holdT = s.t;
      s.catchT[D] = -1;
      s.chase = -1;
      ev.push({ k: 'catch', team: D, who: got, air: gotAir });
      if (gotAir && !b.thrown) slowmo(s, 0.5, 0.3);
      if (candle) {
        if (c.candle === 'swap') {
          ev.push({ k: 'candle', team: D, pts: 0 });
          swap(s, 'candle', ev);
          return ev;
        }
        s.score[D] += 1;
        ev.push({ k: 'candle', team: D, pts: 1 });
        if (checkEnd(s, ev)) return ev;
      }
    }
  } else if (b.mode === 'held') {
    const h = b.holder;
    const m = def[h];
    const human = ins[D].ai < 0 && h === s.ctrl[D];
    let th: { tx: number; ty: number; human: boolean } | null = null;
    if (human && acts[D].th) th = { tx: acts[D].th.tx, ty: acts[D].th.ty, human: true };
    else if (!human || s.t - s.holdT > 8) {
      const a = aiThrow(s, lvD);
      if (a) th = { ...a, human: false };
    }
    if (th) {
      let tx = th.tx;
      let ty = th.ty;
      // в бегущего рядом с точкой — с упреждением
      for (const r of atk) if (r.st === 'run' && Math.hypot(r.x - tx, r.y - ty) < 2.5) [tx, ty] = lead([m.x, m.y], r);
      let pass = false;
      for (let i = 0; i < def.length; i++) if (i !== h && Math.hypot(def[i].x - tx, def[i].y - ty) < 1.5) pass = true;
      const d = Math.hypot(tx - m.x, ty - m.y);
      const sig = (th.human ? 0.01 : ([0.05, 0.03, 0.018][lvD] ?? 0.03)) + d * 0.0012;
      const e = ((rng.int(2001) - 1000) / 1000) * sig;
      const b0 = throwBody([m.x, m.y], tx, ty, e);
      s.ball = { mode: 'free', b0, t0: s.t, holder: -1, air: false, thrown: true, by: h, px: b0.x, py: b0.y, pz: b0.z };
      s.tried = [];
      ev.push({ k: 'throw', team: D, who: h, pass });
    }
  }

  // конец розыгрыша: бегущих нет, мяч у защиты (или лежит) — секунда тишины
  const running = atk.some((m) => m.st === 'run');
  const calm = !running && (s.ball.mode === 'held' || ballRests(s));
  if (calm) {
    if (s.quietT < 0) s.quietT = s.t;
    if (s.t - s.quietT > 0.5) dead(s, ev);
  } else s.quietT = -1;
  // страховка: розыгрыш затянулся
  if (s.phase === 'live' && s.t - s.since > 45) {
    for (const m of atk) if (m.st === 'run') (m.st = m.from === 'kon' ? 'kon' : 'used'), (m.from = undefined);
    dead(s, ev);
  }
  return ev;
}

/** Снимок для сети: числа округлены. */
export function snapshot(s: State): State {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    ...s,
    men: s.men.map((t) => t.map((m) => ({ ...m, x: r(m.x), y: r(m.y), vx: r(m.vx), vy: r(m.vy), dash: r(m.dash), cd: r(m.cd) }))) as [Man[], Man[]],
    ball: { ...s.ball, px: r(s.ball.px), py: r(s.ball.py), pz: r(s.ball.pz) },
  };
}

export { VF, VR };
