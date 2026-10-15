/* Футбол на бумаге — движок без DOM. Три игры на тетрадном листе:
 * «Футбол (русский)» — ход ломаной из трёх отрезков, линии нельзя касаться и пересекать, бортов касаться нельзя;
 *   нет хода — пропуск и штрафной сопернику (10 отрезков по прямой, можно через линии); гол — мяч за линией ворот.
 * «Футбол с отскоками» (Piłkarzyki, Paper soccer) — ход по одному отрезку, по линиям и борту нельзя;
 *   пришёл в узел, где уже есть линия или борт, — отскок, ходишь ещё; нет хода — проигрыш.
 * «Хоккей» — то же по одному отрезку, линии можно пересекать, но не совпадать; гол — ход кончился в узле ворот.
 * Узлы: n = (y + 1)·(W + 1) + x, y от −1 до H + 1 (строки −1 и H + 1 — «за воротами», только в футболе).
 * Синие (место 0) атакуют верхние ворота, красные (место 1) — нижние. */
import type { Options } from '../../core/types';

export type Mode = 'ru' | 'bounce' | 'hockey';

export interface Geo {
  mode: Mode;
  /** Ширина поля в клетках (короткая сторона, на ней ворота). */
  W: number;
  /** Длина поля в клетках. */
  H: number;
  /** Ворота — узлы x от g0 до g1 на коротких сторонах. */
  g0: number;
  g1: number;
}

export interface State extends Geo {
  /** До скольких голов. */
  goals: number;
  ball: number;
  center: number;
  /** Проведённые отрезки по четыре числа: узел, узел, чей, вид (0 — ход, 1 — штрафной). */
  lines: number[];
  turn: number;
  /** Русский: ход — штрафной удар (соперник остался без хода). */
  penalty: boolean;
  score: [number, number];
  /** Кто разыгрывал мяч с центра на этом листе. */
  kickoff: number;
  sheet: number;
  /** Сколько действий сделано — страховка от бесконечной партии. */
  moves: number;
  phase: 'play' | 'over';
  winners: number[] | null;
  endText: string;
}

export type Action = { type: 'move'; path: number[] } | { type: 'kick'; dir: number };

export type Event =
  | { type: 'move'; seat: number; from: number; path: number[]; bounce: boolean }
  | { type: 'kick'; seat: number; from: number; path: number[]; dir: number }
  | { type: 'stuck'; seat: number; penalty: boolean }
  | { type: 'goal'; seat: number; own: boolean; score: [number, number] }
  | { type: 'reset'; seat: number; fresh: boolean; why: 'goal' | 'draw' }
  | { type: 'end'; winners: number[]; score: [number, number]; text: string };

/** Восемь направлений: вверх, вверх-вправо, вправо … по часовой. */
export const DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const DIR_NAMES = ['вверх', 'вверх-вправо', 'вправо', 'вниз-вправо', 'вниз', 'вниз-влево', 'влево', 'вверх-влево'];

const MOVE_CAP = 3000;
/** Порядок длин штрафного: 10, потом 9 и 11, 8 и 12 … */
const KICK_LENGTHS = (() => {
  const out = [10];
  for (let d = 1; d <= 30; d++) {
    if (10 - d >= 1) out.push(10 - d);
    out.push(10 + d);
  }
  return out;
})();

export function geometry(opts: Options): Geo {
  const mode: Mode = opts.mode === 'bounce' || opts.mode === 'hockey' ? opts.mode : 'ru';
  if (mode === 'ru') {
    const big = opts.size === '20x30';
    const W = big ? 20 : 14;
    const H = big ? 30 : 22;
    const g = big ? 6 : 4;
    return { mode, W, H, g0: (W - g) / 2, g1: (W + g) / 2 };
  }
  // отскоки и хоккей: 8×10, ворота в две клетки (у хоккея — четверть короткой стороны)
  return { mode, W: 8, H: 10, g0: 3, g1: 5 };
}

// ---------------------------------------------------------------- поле

/** Поле с проведёнными отрезками: быстрые проверки ходов, правится на месте (для ботов). */
export class Board {
  readonly cols: number;
  readonly rows: number;
  readonly edges = new Set<number>();
  readonly deg: Uint8Array;
  constructor(readonly g: Geo, lines: number[] = []) {
    this.cols = g.W + 1;
    this.rows = g.H + 3;
    this.deg = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < lines.length; i += 4) this.add(lines[i], lines[i + 1]);
  }
  at(x: number, y: number) {
    return (y + 1) * this.cols + x;
  }
  x(n: number) {
    return n % this.cols;
  }
  y(n: number) {
    return Math.floor(n / this.cols) - 1;
  }
  key(a: number, b: number) {
    return a < b ? a * 4096 + b : b * 4096 + a;
  }
  has(a: number, b: number) {
    return this.edges.has(this.key(a, b));
  }
  add(a: number, b: number) {
    this.edges.add(this.key(a, b));
    this.deg[a]++;
    this.deg[b]++;
  }
  remove(a: number, b: number) {
    this.edges.delete(this.key(a, b));
    this.deg[a]--;
    this.deg[b]--;
  }
  mouth(x: number) {
    return x >= this.g.g0 && x <= this.g.g1;
  }
  inside(x: number, y: number) {
    if (x < 0 || x > this.g.W) return false;
    if (y >= 0 && y <= this.g.H) return true;
    return (y === -1 || y === this.g.H + 1) && this.g.mode !== 'hockey' && this.mouth(x);
  }
  /** Кто забивает, если мяч пришёл в узел n: 0 — синие (верхние ворота), 1 — красные, −1 — не гол. */
  goalSide(n: number): number {
    const x = this.x(n);
    const y = this.y(n);
    if (this.g.mode === 'hockey') {
      if (!this.mouth(x)) return -1;
      return y === 0 ? 0 : y === this.g.H ? 1 : -1;
    }
    return y === -1 ? 0 : y === this.g.H + 1 ? 1 : -1;
  }
  /** Узел на борту (штанги — тоже борт; узлы линии ворот между штангами в футболе — обычные). */
  border(n: number) {
    const x = this.x(n);
    const y = this.y(n);
    if (y < 0 || y > this.g.H) return false;
    if (x === 0 || x === this.g.W) return true;
    if (y !== 0 && y !== this.g.H) return false;
    return this.g.mode === 'hockey' || x <= this.g.g0 || x >= this.g.g1;
  }
  /** Отрезок a–b идёт по борту. */
  alongBorder(a: number, b: number) {
    const ax = this.x(a);
    const ay = this.y(a);
    const bx = this.x(b);
    const by = this.y(b);
    if (ax === bx && (ax === 0 || ax === this.g.W)) return true;
    if (ay === by && (ay === 0 || ay === this.g.H)) return this.g.mode === 'hockey' || !(this.mouth(ax) && this.mouth(bx));
    return false;
  }
  /** Сосед a в направлении d или −1. */
  next(a: number, d: number): number {
    const x = this.x(a) + DIRS[d][0];
    const y = this.y(a) + DIRS[d][1];
    return this.inside(x, y) ? this.at(x, y) : -1;
  }
  /** Отрезок a→b можно провести: внутри поля, не по борту, не по проведённой линии; за ворота — только из створа. */
  open(a: number, b: number) {
    if (b < 0 || this.alongBorder(a, b) || this.has(a, b)) return false;
    const by = this.y(b);
    if ((by === -1 || by === this.g.H + 1) && !this.mouth(this.x(a))) return false;
    return true;
  }
  /** Диагональ a–b пересекает другую диагональ той же клетки. */
  crossed(a: number, b: number) {
    const ax = this.x(a);
    const ay = this.y(a);
    const bx = this.x(b);
    const by = this.y(b);
    if (ax === bx || ay === by) return false;
    return this.has(this.at(ax, by), this.at(bx, ay));
  }
}

export const boardOf = (s: State) => new Board(s, s.lines);

/** Расстояние (в ходах-отрезках) от узла до ворот, которые атакует seat. */
export function distTo(b: Board, n: number, seat: number): number {
  const x = b.x(n);
  const y = b.y(n);
  const hockey = b.g.mode === 'hockey';
  const dy = seat === 0 ? y - (hockey ? 0 : -1) : (hockey ? b.g.H : b.g.H + 1) - y;
  const dx = Math.max(0, b.g.g0 - x, x - b.g.g1);
  return Math.max(dy, dx);
}

// ---------------------------------------------------------------- русский: ходы и штрафной

/** Можно ли русским ходом прийти из a в q (без учёта уже начатой ломаной — её отрезки на поле). */
function ruStep(b: Board, a: number, q: number, start: number): boolean {
  if (q < 0 || q === start || !b.open(a, q)) return false;
  if (b.goalSide(q) < 0 && (b.border(q) || b.deg[q] > 0)) return false;
  return !b.crossed(a, q);
}

/** Все русские ходы из узла start: ломаные из трёх отрезков (или короче, если кончились голом). */
export function ruPaths(b: Board, start: number, limit = Infinity): number[][] {
  const out: number[][] = [];
  const path: number[] = [];
  const walk = (a: number) => {
    for (let d = 0; d < 8 && out.length < limit; d++) {
      const q = b.next(a, d);
      if (!ruStep(b, a, q, start)) continue;
      path.push(q);
      if (b.goalSide(q) >= 0 || path.length === 3) out.push(path.slice());
      else {
        b.add(a, q);
        walk(q);
        b.remove(a, q);
      }
      path.pop();
    }
  };
  walk(start);
  return out;
}

/** Есть ли хоть один русский ход. */
export const ruCanMove = (b: Board, start: number) => ruPaths(b, start, 1).length > 0;

/** Из a можно доделать ход ещё need отрезками (или раньше забить). Отрезки начатой ломаной уже на поле. */
function canFinish(b: Board, a: number, start: number, need: number): boolean {
  if (need === 0) return true;
  for (let d = 0; d < 8; d++) {
    const q = b.next(a, d);
    if (!ruStep(b, a, q, start)) continue;
    if (b.goalSide(q) >= 0) return true;
    b.add(a, q);
    const ok = canFinish(b, q, start, need - 1);
    b.remove(a, q);
    if (ok) return true;
  }
  return false;
}

/** Узлы, которыми можно продолжить начатую ломаную path из start так, чтобы ход удалось закончить. */
export function ruNext(b: Board, start: number, path: number[]): number[] {
  const nodes = [start, ...path];
  for (let i = 1; i < nodes.length; i++) b.add(nodes[i - 1], nodes[i]);
  const a = nodes[nodes.length - 1];
  const out: number[] = [];
  for (let d = 0; d < 8; d++) {
    const q = b.next(a, d);
    if (!ruStep(b, a, q, start)) continue;
    if (b.goalSide(q) < 0) {
      b.add(a, q);
      const ok = canFinish(b, q, start, 2 - path.length);
      b.remove(a, q);
      if (!ok) continue;
    }
    out.push(q);
  }
  for (let i = 1; i < nodes.length; i++) b.remove(nodes[i - 1], nodes[i]);
  return out;
}

/** Штрафной удар из start в направлении d: путь (узлы после start) или null. Длина 10, иначе 9/11, 8/12 …
 * Через линии и занятые узлы — можно, по линии и по борту — нельзя; закончиться — в свободном узле или за воротами. */
export function kickPath(b: Board, start: number, d: number): number[] | null {
  const ray: number[] = [];
  const ok: boolean[] = [false];
  let goalAt = 0;
  let a = start;
  for (let k = 1; k <= 40; k++) {
    const q = b.next(a, d);
    if (!b.open(a, q)) break;
    if (b.goalSide(q) >= 0) {
      ray.push(q);
      goalAt = k;
      break;
    }
    if (b.border(q)) break;
    ray.push(q);
    ok.push(b.deg[q] === 0);
    a = q;
  }
  for (const l of KICK_LENGTHS) {
    if (goalAt && l >= goalAt) return ray.slice(0, goalAt);
    if (l < ok.length && ok[l]) return ray.slice(0, l);
  }
  return null;
}

/** Все возможные штрафные: направление → путь. */
export function kicks(b: Board, start: number): { dir: number; path: number[] }[] {
  const out: { dir: number; path: number[] }[] = [];
  for (let d = 0; d < 8; d++) {
    const p = kickPath(b, start, d);
    if (p) out.push({ dir: d, path: p });
  }
  return out;
}

// ---------------------------------------------------------------- отскоки и хоккей: один отрезок

/** Допустимые шаги из узла мяча (отскоки и хоккей). */
export function steps(b: Board, a: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 8; d++) {
    const q = b.next(a, d);
    if (b.open(a, q)) out.push(q);
  }
  return out;
}

/** Мяч, пришедший в q, отскакивает (там уже есть линия или борт). Считать до проведения отрезка. */
export const bounces = (b: Board, q: number) => b.goalSide(q) < 0 && (b.deg[q] > 0 || b.border(q));

// ---------------------------------------------------------------- партия

export function setup(opts: Options): State {
  const g = geometry(opts);
  const goals = g.mode === 'bounce' ? 1 : Math.max(1, Number(opts.goals) || 1);
  const center = (g.H / 2 + 1) * (g.W + 1) + g.W / 2;
  return {
    ...g,
    goals,
    ball: center,
    center,
    lines: [],
    turn: 0,
    penalty: false,
    score: [0, 0],
    kickoff: 0,
    sheet: 1,
    moves: 0,
    phase: 'play',
    winners: null,
    endText: '',
  };
}

export const clone = (s: State): State => ({ ...s, lines: s.lines.slice(), score: [s.score[0], s.score[1]], winners: s.winners && s.winners.slice() });

export function toAct(s: State): number[] {
  return s.phase === 'play' ? [s.turn] : [];
}

function finish(s: State, ev: Event[], winners: number[], text: string) {
  s.phase = 'over';
  s.winners = winners;
  s.endText = text;
  ev.push({ type: 'end', winners, score: [s.score[0], s.score[1]], text });
}

const SIDE = ['синих', 'красных'];

/** Гол: счёт, конец партии или розыгрыш с центра (русский — на новом листе, хоккей — на том же). */
function goal(s: State, ev: Event[], scorer: number, mover: number) {
  s.score[scorer]++;
  ev.push({ type: 'goal', seat: scorer, own: scorer !== mover, score: [s.score[0], s.score[1]] });
  if (s.score[scorer] >= s.goals) {
    const text = s.goals === 1 ? (scorer !== mover ? `автогол — победа ${SIDE[scorer]}` : `гол — победа ${SIDE[scorer]}`) : `счёт ${s.score[0]} : ${s.score[1]}`;
    return finish(s, ev, [scorer], text);
  }
  restart(s, ev, 1 - scorer, 'goal');
}

/** С центра: разыгрывает seat. Русский — новый лист. */
function restart(s: State, ev: Event[], seat: number, why: 'goal' | 'draw') {
  const fresh = s.mode === 'ru';
  if (fresh) {
    s.lines = [];
    s.sheet++;
  }
  s.ball = s.center;
  s.turn = seat;
  s.kickoff = seat;
  s.penalty = false;
  ev.push({ type: 'reset', seat, fresh, why });
  afterTurn(s, ev, -1);
}

/** Ход перешёл к s.turn: проверить, есть ли у него ход. mover — кто ходил (−1 — розыгрыш с центра). */
function afterTurn(s: State, ev: Event[], mover: number) {
  if (s.phase !== 'play') return;
  const b = boardOf(s);
  const p = s.turn;
  if (s.mode === 'ru') {
    if (s.penalty || ruCanMove(b, s.ball)) return;
    // нет хода: пропуск, штрафной сопернику
    ev.push({ type: 'stuck', seat: p, penalty: true });
    if (!kicks(b, s.ball).length) {
      // и штрафной пробить некуда — ничья на этом листе
      if (s.goals === 1) return finish(s, ev, [0, 1], 'ни хода, ни штрафного — ничья');
      return restart(s, ev, s.kickoff === 0 ? 1 : 0, 'draw');
    }
    s.turn = 1 - p;
    s.penalty = true;
    return;
  }
  if (steps(b, s.ball).length) return;
  ev.push({ type: 'stuck', seat: p, penalty: false });
  finish(s, ev, [1 - p], mover === p ? `${SIDE[p]} загнали мяч в тупик` : `${SIDE[p]} остались без хода`);
}

function capCheck(s: State, ev: Event[]) {
  if (s.phase !== 'play' || ++s.moves < MOVE_CAP) return;
  const [a, b] = s.score;
  finish(s, ev, a === b ? [0, 1] : a > b ? [0] : [1], `время вышло, счёт ${a} : ${b}`);
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const b = boardOf(s);
  const ev: Event[] = [];
  const from = s.ball;
  if (a.type === 'kick') {
    if (s.mode !== 'ru' || !s.penalty || !(a.dir >= 0 && a.dir < 8)) return null;
    const path = kickPath(b, from, a.dir);
    if (!path) return null;
    let p = from;
    for (const q of path) {
      s.lines.push(p, q, seat, 1);
      p = q;
    }
    s.ball = p;
    s.penalty = false;
    ev.push({ type: 'kick', seat, from, path, dir: a.dir });
    const side = b.goalSide(p);
    if (side >= 0) goal(s, ev, side, seat);
    else {
      s.turn = 1 - seat;
      afterTurn(s, ev, seat);
    }
    capCheck(s, ev);
    return { state: s, events: ev };
  }
  if (a.type !== 'move' || !Array.isArray(a.path) || s.penalty) return null;
  if (s.mode === 'ru') {
    if (!ruPaths(b, from).some((p) => same(p, a.path))) return null;
    let p = from;
    for (const q of a.path) {
      s.lines.push(p, q, seat, 0);
      p = q;
    }
    s.ball = p;
    ev.push({ type: 'move', seat, from, path: a.path.slice(), bounce: false });
    const side = b.goalSide(p);
    if (side >= 0) goal(s, ev, side, seat);
    else {
      s.turn = 1 - seat;
      afterTurn(s, ev, seat);
    }
    capCheck(s, ev);
    return { state: s, events: ev };
  }
  // отскоки и хоккей: один отрезок
  if (a.path.length !== 1) return null;
  const q = a.path[0];
  if (!steps(b, from).includes(q)) return null;
  const bounce = bounces(b, q);
  s.lines.push(from, q, seat, 0);
  s.ball = q;
  ev.push({ type: 'move', seat, from, path: [q], bounce });
  const side = b.goalSide(q);
  if (side >= 0) goal(s, ev, side, seat);
  else {
    if (!bounce) s.turn = 1 - seat;
    afterTurn(s, ev, seat);
  }
  capCheck(s, ev);
  return { state: s, events: ev };
}
