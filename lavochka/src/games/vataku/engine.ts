/* «В атаку!» (Н. Авцын, худ. В. Антипов) — движок. Материалы и решения — docs/analysis/materials-vataku.md. Без DOM.
 *
 * Поле 20×15: столбцы А…Ф (без Й), ряды 1…15; клетка c + 20·r. Красные (место 0) — левая половина (А…К),
 * зелёные (место 1) — правая (Л…Ф). Река (по клетке за ход), броды (как суша), жёлтые клетки резерва (там не бьют и не
 * бьются, вернуться нельзя), рамки целей 2×3: у красных А–Б 7–9, у зелёных У–Ф 7–9.
 * Фигуры: ракета (1–5, перелетает, бьёт и сама снимается), самолёт (1–10, перелетает), танк (1–3), пушка (шаг на 1
 * или выстрел по прямой до 3 клеток, остаётся на месте), пехотинец (1–2). Две тайные мины у каждого — на своей половине.
 * Ходы сериями: 1, 2, 2, потом по 3. Победа — занять все шесть клеток рамки противника, среди них не меньше трёх пехотинцев. */
import type { Options, Rng } from '../../core/types';

export const COLS = 20;
export const ROWS = 15;
export const N = COLS * ROWS;
export const LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФ';
export const at = (c: number, r: number) => r * COLS + c;
export const col = (p: number) => p % COLS;
export const row = (p: number) => Math.floor(p / COLS);
export const cellName = (p: number) => `${LETTERS[col(p)]}-${row(p) + 1}`;

const L = (ch: string) => LETTERS.indexOf(ch);
export const RIVER = new Set([at(L('З'), 0), at(L('З'), 4), at(L('И'), 4), ...[4, 5, 6, 7, 8, 9, 10].flatMap((r) => [at(L('К'), r), at(L('Л'), r)]), at(L('М'), 10), at(L('Н'), 10), at(L('Н'), 14)]);
export const FORD = new Set([at(L('З'), 1), at(L('З'), 2), at(L('З'), 3), at(L('Н'), 11), at(L('Н'), 12), at(L('Н'), 13)]);
export const RESERVE = new Set([0, 1, 2, 3, 16, 17, 18, 19].flatMap((c) => [at(c, 0), at(c, 14)]));
/** Рамка-цель каждой стороны (на её половине) — её занимает противник. */
export const FRAME = [[0, 1].flatMap((c) => [6, 7, 8].map((r) => at(c, r))), [18, 19].flatMap((c) => [6, 7, 8].map((r) => at(c, r)))];

export type Kind = 'rocket' | 'plane' | 'tank' | 'gun' | 'inf';
export const KINDS: Kind[] = ['rocket', 'plane', 'tank', 'gun', 'inf'];
export const COUNT: Record<Kind, number> = { rocket: 3, plane: 2, tank: 4, gun: 4, inf: 8 };
export const RANGE: Record<Kind, number> = { rocket: 5, plane: 10, tank: 3, gun: 1, inf: 2 };
export const NAMES: Record<Kind, string> = { rocket: 'ракета', plane: 'самолёт', tank: 'танк', gun: 'пушка', inf: 'пехотинец' };
export const ACC: Record<Kind, string> = { rocket: 'ракету', plane: 'самолёт', tank: 'танк', gun: 'пушку', inf: 'пехотинца' };
export const MINES = 2;
/** Серии ходов: первая — 1, потом 2, 2, а дальше всё время по 3. */
export const SERIES = [1, 2, 2];
/** Ничья, если примерно столько серий (по 3 хода) подряд никого не побили. */
export const QUIET = 60;

export function half(side: number, p: number): boolean {
  return side === 0 ? col(p) <= 9 : col(p) >= 10;
}

export interface Piece {
  id: number;
  side: number;
  kind: Kind;
  /** Куда смотрит (только для вида): +1 — вправо, −1 — влево. */
  face: number;
}

export interface Cfg {
  /** Самолёты и ракеты перелетают реку как сушу. */
  fly: boolean;
}
export function cfgFrom(o: Options): Cfg {
  return { fly: o.river === 'fly' };
}

export interface State {
  cfg: Cfg;
  cells: (Piece | null)[];
  /** Мины: [сторона] → клетки (в view соперника — пусто). */
  mines: [number[], number[]];
  phase: 'deploy' | 'play' | 'over';
  ready: [boolean, boolean];
  laid: [boolean, boolean];
  side: number;
  /** Номер серии и сколько ходов в ней осталось. */
  series: number;
  left: number;
  winner: number | null;
  why: '' | 'frame' | 'army' | 'quiet';
  quiet: number;
  last: number[];
  lost: [Kind[], Kind[]];
}

export type Action =
  | { type: 'swap'; a: number; b: number }
  | { type: 'mine'; from: number; to: number }
  | { type: 'auto' }
  | { type: 'ready' }
  | { type: 'move'; from: number; to: number }
  | { type: 'shoot'; from: number; to: number };

export type Event =
  | { type: 'swap'; seat: number; a: number; b: number }
  | { type: 'layout'; seat: number }
  | { type: 'ready'; seat: number }
  | { type: 'start' }
  | { type: 'move'; seat: number; from: number; to: number; path: number[]; kind: Kind; took: Piece | null; boom: number }
  | { type: 'shoot'; seat: number; from: number; to: number; took: Piece }
  | { type: 'end'; winner: number | null; why: State['why'] };

/** Клетки, где можно стоять при расстановке: своя половина, не река. */
export function deployCells(side: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < N; p++) if (half(side, p) && !RIVER.has(p)) out.push(p);
  return out;
}

function shuffled<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Расстановка «с умом»: пехота и танки ближе к реке, пушки за ними, ракеты и самолёты сзади (часть — в резерве),
 * мины — на подступах к своей рамке и у бродов. */
export function smartLayout(side: number, rng: Rng): { cells: [number, Kind][]; mines: number[] } {
  const cells = deployCells(side).filter((p) => !RESERVE.has(p) || rng.next() < 0.5);
  // «глубина» клетки: 0 — у реки/середины, 9 — у своего края
  const depth = (p: number) => (side === 0 ? 9 - col(p) : col(p) - 10);
  const pick = (lo: number, hi: number, taken: Set<number>) => {
    const pool = shuffled(cells.filter((p) => !taken.has(p) && depth(p) >= lo && depth(p) <= hi), rng);
    return pool[0] ?? shuffled(cells.filter((p) => !taken.has(p)), rng)[0];
  };
  const taken = new Set<number>();
  const out: [number, Kind][] = [];
  const put = (k: Kind, n: number, lo: number, hi: number) => {
    for (let i = 0; i < n; i++) {
      const p = pick(lo, hi, taken);
      taken.add(p);
      out.push([p, k]);
    }
  };
  put('inf', COUNT.inf, 1, 4);
  put('tank', COUNT.tank, 1, 4);
  put('gun', COUNT.gun, 3, 6);
  put('rocket', COUNT.rocket, 5, 9);
  put('plane', COUNT.plane, 6, 9);
  // мины: у своей рамки (с внутренней стороны) и у брода
  const own = FRAME[side];
  const guard = own.map((p) => p + (side === 0 ? 2 : -2)).filter((p) => !taken.has(p));
  const fords = [...FORD].filter((p) => half(side, p)).flatMap((p) => [p + (side === 0 ? -1 : 1)]).filter((p) => half(side, p) && !RIVER.has(p) && !RESERVE.has(p));
  const mines = shuffled([...guard, ...fords], rng).slice(0, MINES);
  return { cells: out, mines };
}

export function newState(cfg: Cfg): State {
  return {
    cfg,
    cells: Array(N).fill(null),
    mines: [[], []],
    phase: 'deploy',
    ready: [false, false],
    laid: [false, false],
    side: 0,
    series: 0,
    left: SERIES[0],
    winner: null,
    why: '',
    quiet: 0,
    last: [],
    lost: [[], []],
  };
}

function place(s: State, side: number, lay: { cells: [number, Kind][]; mines: number[] }) {
  for (let p = 0; p < N; p++) if (s.cells[p]?.side === side) s.cells[p] = null;
  lay.cells.forEach(([p, kind], i) => (s.cells[p] = { id: side * 100 + i, side, kind, face: side === 0 ? 1 : -1 }));
  s.mines[side] = [...lay.mines];
}

export function setup(opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts));
  place(s, 0, smartLayout(0, rng));
  place(s, 1, smartLayout(1, rng));
  return s;
}

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'deploy') return [0, 1].filter((x) => !s.ready[x]);
  return [s.side];
}

const DIRS = [-COLS, COLS, -1, 1];
function nb(p: number, d: number): number {
  const q = p + d;
  if (q < 0 || q >= N) return -1;
  if ((d === 1 || d === -1) && row(q) !== row(p)) return -1;
  return q;
}

/** Куда может пойти фигура с клетки p: цель → путь (кратчайший). Поиск в ширину по клеткам: наземные — по пустым,
 * перелетающие (ракета, самолёт) — над любыми; река — ход длиной ровно в одну клетку; в резерв не возвращаются. */
export function moves(s: State, p: number): Map<number, number[]> {
  const pc = s.cells[p];
  const out = new Map<number, number[]>();
  if (!pc) return out;
  const R = RANGE[pc.kind];
  const jump = pc.kind === 'rocket' || pc.kind === 'plane';
  const fromReserve = RESERVE.has(p);
  const slow = (q: number) => RIVER.has(q) && !(s.cfg.fly && jump);
  const from = new Map<number, number>([[p, -1]]);
  const pathTo = (q: number) => {
    const path: number[] = [];
    for (let x = q; x !== -1; x = from.get(x)!) path.unshift(x);
    return path;
  };
  const target = (q: number) => {
    const t = s.cells[q];
    if (!t) return true;
    // пушка бьёт только выстрелом
    return pc.kind !== 'gun' && t.side !== pc.side && !fromReserve && !RESERVE.has(q);
  };
  let front = [p];
  for (let step = 1; step <= R && front.length; step++) {
    const next: number[] = [];
    for (const x of front) {
      for (const d of DIRS) {
        const q = nb(x, d);
        if (q < 0 || from.has(q) || RESERVE.has(q)) continue;
        // река: ход, задевающий реку, — ровно на одну клетку
        if ((slow(q) || slow(p)) && step > 1) continue;
        from.set(q, x);
        if (target(q)) out.set(q, pathTo(q));
        const t = s.cells[q];
        if ((!t || jump) && !slow(q)) next.push(q);
      }
    }
    front = next;
  }
  return out;
}

/** Выстрелы пушки: по прямой до 3 клеток, через фигуры (без блокировки). */
export function shots(s: State, p: number): number[] {
  const pc = s.cells[p];
  if (!pc || pc.kind !== 'gun' || RESERVE.has(p)) return [];
  const out: number[] = [];
  for (const d of DIRS) {
    let q = p;
    for (let k = 1; k <= 3; k++) {
      q = nb(q, d);
      if (q < 0) break;
      const t = s.cells[q];
      if (t && t.side !== pc.side && !RESERVE.has(q)) out.push(q);
    }
  }
  return out;
}

export function legal(s: State, seat: number): Action[] {
  if (s.phase !== 'play' || s.side !== seat) return [];
  const out: Action[] = [];
  for (let p = 0; p < N; p++) {
    const pc = s.cells[p];
    if (!pc || pc.side !== seat) continue;
    for (const to of moves(s, p).keys()) out.push({ type: 'move', from: p, to });
    for (const to of shots(s, p)) out.push({ type: 'shoot', from: p, to });
  }
  return out;
}

function clone(s: State): State {
  return {
    ...s,
    cells: s.cells.map((c) => (c ? { ...c } : null)),
    mines: [[...s.mines[0]], [...s.mines[1]]],
    ready: [...s.ready] as [boolean, boolean],
    laid: [...s.laid] as [boolean, boolean],
    lost: [[...s.lost[0]], [...s.lost[1]]],
    last: [...s.last],
  };
}

function finish(s: State, winner: number | null, why: State['why'], events: Event[]) {
  s.phase = 'over';
  s.winner = winner;
  s.why = why;
  events.push({ type: 'end', winner, why });
}

/** Занята ли рамка соперника: все 6 клеток — фигуры side, среди них не меньше трёх пехотинцев. */
export function frameTaken(s: State, side: number): boolean {
  const fr = FRAME[1 - side];
  let inf = 0;
  for (const p of fr) {
    const c = s.cells[p];
    if (!c || c.side !== side) return false;
    if (c.kind === 'inf') inf++;
  }
  return inf >= 3;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object') return null;
  if (s0.phase === 'deploy') {
    if (s0.ready[seat]) return null;
    const s = clone(s0);
    const ok = (p: number) => Number.isInteger(p) && p >= 0 && p < N && half(seat, p) && !RIVER.has(p);
    if (a.type === 'swap') {
      if (!ok(a.a) || !ok(a.b) || a.a === a.b) return null;
      const A = s.cells[a.a];
      const B = s.cells[a.b];
      if ((A && A.side !== seat) || (B && B.side !== seat) || (!A && !B)) return null;
      [s.cells[a.a], s.cells[a.b]] = [B, A];
      return { state: s, events: [{ type: 'swap', seat, a: a.a, b: a.b }] };
    }
    if (a.type === 'mine') {
      const i = s.mines[seat].indexOf(a.from);
      if (i < 0 || !ok(a.to) || RESERVE.has(a.to) || s.mines[seat].includes(a.to)) return null;
      s.mines[seat][i] = a.to;
      return { state: s, events: [{ type: 'layout', seat }] };
    }
    if (a.type === 'auto') {
      place(s, seat, smartLayout(seat, rng));
      s.laid[seat] = true;
      return { state: s, events: [{ type: 'layout', seat }] };
    }
    if (a.type === 'ready') {
      s.ready[seat] = true;
      const events: Event[] = [{ type: 'ready', seat }];
      if (s.ready[0] && s.ready[1]) {
        s.phase = 'play';
        events.push({ type: 'start' });
      }
      return { state: s, events };
    }
    return null;
  }
  if (s0.phase !== 'play' || seat !== s0.side) return null;
  const pc0 = s0.cells[(a as { from: number }).from];
  if (!pc0 || pc0.side !== seat) return null;
  const s = clone(s0);
  const events: Event[] = [];
  let hit = false;
  if (a.type === 'shoot') {
    if (!shots(s0, a.from).includes(a.to)) return null;
    const t = s.cells[a.to]!;
    s.cells[a.to] = null;
    s.lost[t.side].push(t.kind);
    hit = true;
    s.last = [a.from, a.to];
    events.push({ type: 'shoot', seat, from: a.from, to: a.to, took: t });
  } else if (a.type === 'move') {
    const path = moves(s0, a.from).get(a.to);
    if (!path) return null;
    const me = s.cells[a.from]!;
    s.cells[a.from] = null;
    if (col(a.to) !== col(a.from)) me.face = col(a.to) > col(a.from) ? 1 : -1;
    const t = s.cells[a.to];
    let took: Piece | null = null;
    if (t) {
      took = t;
      s.lost[t.side].push(t.kind);
      hit = true;
    }
    // мины соперника: на пути (кроме стартовой) — для наземных, на месте остановки — для всех
    const enemy = 1 - seat;
    const jump = me.kind === 'rocket' || me.kind === 'plane';
    let boom = -1;
    for (const q of path.slice(1)) {
      if (!s.mines[enemy].includes(q)) continue;
      if (jump && q !== a.to) continue;
      boom = q;
      break;
    }
    if (boom >= 0) {
      s.mines[enemy] = s.mines[enemy].filter((x) => x !== boom);
      s.lost[seat].push(me.kind);
      hit = true;
      if (took) s.cells[a.to] = null;
    } else if (me.kind === 'rocket' && took) {
      // ракета бьёт и сама снимается
      s.cells[a.to] = null;
      s.lost[seat].push('rocket');
    } else s.cells[a.to] = me;
    s.last = boom >= 0 ? [a.from, boom] : [a.from, a.to];
    events.push({ type: 'move', seat, from: a.from, to: a.to, path: boom >= 0 ? path.slice(0, path.indexOf(boom) + 1) : path, kind: me.kind, took, boom });
  } else return null;
  // победа: рамка
  if (frameTaken(s, seat)) {
    finish(s, seat, 'frame', events);
    return { state: s, events };
  }
  const alive = (sd: number) => s.cells.some((c) => c && c.side === sd);
  if (!alive(1 - seat)) {
    finish(s, seat, 'army', events);
    return { state: s, events };
  }
  s.quiet = hit ? 0 : s.quiet + 1;
  if (s.quiet >= QUIET * 3) {
    finish(s, null, 'quiet', events);
    return { state: s, events };
  }
  s.left--;
  if (s.left <= 0 || !legal(s, seat).length) nextSeries(s, events);
  void rng;
  return { state: s, events };
}

function nextSeries(s: State, events: Event[]) {
  for (let k = 0; k < 2; k++) {
    s.side = 1 - s.side;
    s.series++;
    s.left = SERIES[s.series] ?? 3;
    if (legal(s, s.side).length) break;
  }
  if (!legal(s, s.side).length) finish(s, null, 'quiet', events);
}

/** Что видит место: чужие мины скрыты; при расстановке — и чужие фигуры (за стенкой). */
export function makeView(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || s.phase === 'over') return s;
  const me = seats[0];
  const v = { ...s, mines: s.mines.map((m, i) => (seats.includes(i) ? m : [])) as [number[], number[]] };
  if (s.phase === 'deploy') v.cells = s.cells.map((c) => (c && !seats.includes(c.side) ? null : c));
  void me;
  return v;
}

export function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if ((ev.type === 'swap' || ev.type === 'layout') && !seats.includes(ev.seat)) return null;
  return ev;
}
