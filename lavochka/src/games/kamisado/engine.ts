/* Камисадо (Питер Бёрли, 2008) — правила без DOM.
 * Доска 8×8 из клеток восьми цветов (в каждом ряду и столбце — все восемь). У каждого 8 башен — цветов клеток
 * своего первого ряда. Чёрные (место 0) — снизу (ряд 7), ходят вверх и начинают; золотые (место 1) — сверху.
 * Башня ходит только вперёд — прямо или по косой — на любое число пустых клеток, без прыжков.
 * Первый ход раунда — любой башней; дальше соперник обязан ходить башней цвета клетки, куда встала последняя башня.
 * Нет хода — «ход на месте»: соперник ходит башней цвета клетки, где стоит запертая. Тупик (так ходят по кругу
 * без единого настоящего хода) — проигрывает тот, чей ход к нему привёл.
 * Раунд выигрывает башня, дошедшая до первого ряда соперника. В серии («до 3/7/15 очков») она становится сумо
 * и приносит больше очков: простая — 1, сумо — 3, двойной сумо — 7, тройной — 15. Сумо ходит короче
 * (5, 3, 1 клетка) и может толкнуть стоящие прямо впереди чужие башни на клетку назад (сумо — одну, двойной — до
 * двух, тройной — до трёх; сумо не толкают сумо того же ранга и выше), если за ними пусто. После толчка соперник
 * пропускает ход, а толкнувший ходит снова — башней цвета клетки, которую освободила толкнутая (там теперь сам сумо).
 * Новый раунд: победитель выбирает, расставлять «справа» или «слева»; первым ходит проигравший, любой башней. */
import type { Options } from '../../core/types';

export const N = 8;
export type Look = 'lacquer' | 'paper';

/** Цвета клеток и башен. */
export const COLORS = ['orange', 'blue', 'purple', 'pink', 'yellow', 'red', 'green', 'brown'] as const;
export const COLOR_RU = ['оранжевая', 'синяя', 'фиолетовая', 'розовая', 'жёлтая', 'красная', 'зелёная', 'коричневая'];
/** Именительный падеж для «башня … цвета». */
export const COLOR_GEN = ['оранжевого', 'синего', 'фиолетового', 'розового', 'жёлтого', 'красного', 'зелёного', 'коричневого'];

/** Цвет клетки (x, y): ряд 0 — верхний. */
const ROWS = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [5, 0, 3, 6, 1, 4, 7, 2],
  [6, 3, 0, 5, 2, 7, 4, 1],
  [3, 2, 1, 0, 7, 6, 5, 4],
  [4, 5, 6, 7, 0, 1, 2, 3],
  [1, 4, 7, 2, 5, 0, 3, 6],
  [2, 7, 4, 1, 6, 3, 0, 5],
  [7, 6, 5, 4, 3, 2, 1, 0],
];
export const CELL: number[] = ROWS.flat();

export const at = (x: number, y: number) => y * N + x;
export const X = (p: number) => p % N;
export const Y = (p: number) => (p - (p % N)) / N;

/** Целевые очки серии (1 — один раунд). */
export const TARGETS = [1, 3, 7, 15];
/** Очки за победу башней ранга r (0 — простая, 1 — сумо…). */
export const POINTS = [1, 3, 7, 15];
/** Наибольший ход башни ранга r. */
export const REACH = [7, 5, 3, 1];
export const RANK_RU = ['простая башня', 'сумо', 'двойной сумо', 'тройной сумо', 'четверной сумо'];

export interface Cfg {
  target: number;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const t = Number(o.target);
  return { target: TARGETS.includes(t) ? t : 1, look: o.look === 'paper' ? 'paper' : 'lacquer' };
}

/** Башня: место и цвет; id = seat * 8 + color. */
export const seatOf = (id: number) => (id >= 8 ? 1 : 0);
export const colorOf = (id: number) => id % 8;
export const towerId = (seat: number, color: number) => seat * 8 + color;
/** Направление «вперёд» по y. */
export const fwd = (seat: number) => (seat === 0 ? -1 : 1);
/** Ряд, куда надо дойти. */
export const goalRow = (seat: number) => (seat === 0 ? 0 : N - 1);
export const homeRow = (seat: number) => (seat === 0 ? N - 1 : 0);

export interface State {
  cfg: Cfg;
  /** −1 — пусто, иначе id башни. */
  board: number[];
  /** Ранг сумо каждой башни (0 — простая). */
  rank: number[];
  turn: number;
  /** Цвет обязательной башни (−1 — любая: первый ход раунда). */
  forced: number;
  phase: 'move' | 'fill';
  /** Раунд (с нуля), кто его начинал. */
  round: number;
  first: number;
  score: [number, number];
  ply: number;
  over: boolean;
  winner: number | null;
  last: number[];
}

export type Fill = 'left' | 'right';
export type Action = { type: 'move'; from: number; to: number } | { type: 'fill'; side: Fill };

export type Why = 'goal' | 'deadlock';
export type Event =
  | { type: 'move'; seat: number; from: number; to: number }
  | { type: 'push'; seat: number; from: number; to: number; pushed: { from: number; to: number }[] }
  | { type: 'pass'; seat: number; at: number }
  | { type: 'round'; winner: number; why: Why; tower: number; rank: number; points: number; score: [number, number] }
  | { type: 'fill'; seat: number; side: Fill }
  | { type: 'end'; winner: number; why: Why | 'match' };

/** Начальная расстановка: башни на клетках своих цветов в первых рядах. */
function fresh(): number[] {
  const board = new Array(N * N).fill(-1);
  for (let x = 0; x < N; x++) {
    board[at(x, N - 1)] = towerId(0, CELL[at(x, N - 1)]);
    board[at(x, 0)] = towerId(1, CELL[at(x, 0)]);
  }
  return board;
}

export function newState(cfg: Cfg): State {
  return { cfg, board: fresh(), rank: new Array(16).fill(0), turn: 0, forced: -1, phase: 'move', round: 0, first: 0, score: [0, 0], ply: 0, over: false, winner: null, last: [] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Где стоит башня (−1 — нет). */
export const where = (s: State, id: number) => s.board.indexOf(id);

/** Сколько башен (и какие клетки) толкает башня с клетки p: [] — толчка нет. */
export function pushLine(s: State, p: number): number[] {
  const id = s.board[p];
  const r = s.rank[id];
  if (r < 1) return [];
  const seat = seatOf(id);
  const dy = fwd(seat);
  const x = X(p);
  const line: number[] = [];
  let y = Y(p) + dy;
  while (y >= 0 && y < N) {
    const q = s.board[at(x, y)];
    if (q < 0 || seatOf(q) === seat) break;
    line.push(at(x, y));
    y += dy;
  }
  if (!line.length || line.length > r) return [];
  // сумо толкает только тех, кто слабее
  if (line.some((q) => s.rank[s.board[q]] >= r)) return [];
  // за толкаемыми — пустая клетка на доске
  if (y < 0 || y >= N || s.board[at(x, y)] >= 0) return [];
  return line;
}

/** Ходы башни с клетки p: клетки, куда она может встать (толчок — клетка прямо впереди, занятая чужой). */
export function targets(s: State, p: number): number[] {
  const id = s.board[p];
  const seat = seatOf(id);
  const dy = fwd(seat);
  const reach = REACH[Math.min(3, s.rank[id])];
  const out: number[] = [];
  for (const dx of [0, -1, 1]) {
    let x = X(p);
    let y = Y(p);
    for (let k = 0; k < reach; k++) {
      x += dx;
      y += dy;
      if (x < 0 || x >= N || y < 0 || y >= N || s.board[at(x, y)] >= 0) break;
      out.push(at(x, y));
    }
  }
  if (pushLine(s, p).length) out.push(p + dy * N);
  return out;
}

/** Ходы места, которое ходит. */
export function legal(s: State): Action[] {
  if (s.over) return [];
  if (s.phase === 'fill') return [
    { type: 'fill', side: 'right' },
    { type: 'fill', side: 'left' },
  ];
  const out: Action[] = [];
  for (let c = 0; c < 8; c++) {
    if (s.forced >= 0 && c !== s.forced) continue;
    const p = where(s, towerId(s.turn, c));
    if (p < 0) continue;
    for (const q of targets(s, p)) out.push({ type: 'move', from: p, to: q });
  }
  return out;
}

/** Расставить башни нового раунда: свои — в свой первый ряд, начиная с края side (как его видит хозяин), по порядку
 * от ближних к дому рядов к дальним, в каждом ряду — от того же края. */
export function refill(s: State, side: Fill): number[] {
  const board = new Array(N * N).fill(-1);
  for (const seat of [0, 1]) {
    const home = homeRow(seat);
    // «правая» сторона для чёрных (снизу) — x = 7, для золотых (сверху, смотрят на доску с другой стороны) — x = 0
    const rightX = seat === 0 ? N - 1 : 0;
    const startX = side === 'right' ? rightX : N - 1 - rightX;
    const sx = startX === 0 ? 1 : -1;
    const order: number[] = [];
    for (let k = 0; k < N; k++) {
      const yy = home + fwd(seat) * k;
      for (let i = 0; i < N; i++) {
        const x = startX + sx * i;
        const id = s.board[at(x, yy)];
        if (id >= 0 && seatOf(id) === seat) order.push(id);
      }
    }
    order.forEach((id, i) => (board[at(startX + sx * i, home)] = id));
  }
  return board;
}

/** Настоящий ход без проверки; дальше — пропуски и тупик. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, board: s0.board.slice(), rank: s0.rank.slice(), score: [s0.score[0], s0.score[1]] };
  const events: Event[] = [];
  const seat = s0.turn;
  s.ply++;
  if (a.type === 'fill') {
    s.board = refill(s0, a.side);
    events.push({ type: 'fill', seat, side: a.side });
    s.phase = 'move';
    s.round++;
    s.turn = s.first = 1 - seat; // первым ходит проигравший
    s.forced = -1;
    s.last = [];
    return { state: s, events };
  }
  const id = s.board[a.from];
  const pushed = s.board[a.to] >= 0 ? pushLine(s0, a.from) : [];
  if (pushed.length) {
    const dy = fwd(seat) * N;
    for (let i = pushed.length - 1; i >= 0; i--) s.board[pushed[i] + dy] = s.board[pushed[i]];
    events.push({ type: 'push', seat, from: a.from, to: a.to, pushed: pushed.map((q) => ({ from: q, to: q + dy })) });
  } else events.push({ type: 'move', seat, from: a.from, to: a.to });
  s.board[a.to] = id;
  s.board[a.from] = -1;
  s.last = [a.from, a.to];
  if (Y(a.to) === goalRow(seat)) {
    winRound(s, seat, id, 'goal', events);
    return { state: s, events };
  }
  // после толчка соперник пропускает ход: толкнувший ходит снова
  s.turn = pushed.length ? seat : 1 - seat;
  s.forced = CELL[a.to];
  settle(s, seat, events);
  return { state: s, events };
}

/** Пропуски запертых башен; тупик — проигрывает mover (его ход к нему привёл). */
function settle(s: State, mover: number, events: Event[]) {
  const seen = new Set<number>();
  while (!legal(s).length) {
    const key = s.turn * 8 + s.forced;
    if (seen.has(key)) {
      winRound(s, 1 - mover, -1, 'deadlock', events);
      return;
    }
    seen.add(key);
    const p = where(s, towerId(s.turn, s.forced));
    events.push({ type: 'pass', seat: s.turn, at: p });
    s.forced = CELL[p];
    s.turn = 1 - s.turn;
  }
}

function winRound(s: State, w: number, tower: number, why: Why, events: Event[]) {
  const rank = tower >= 0 ? s.rank[tower] : 0;
  const points = tower >= 0 ? POINTS[Math.min(3, rank)] : 1;
  s.score[w] += points;
  if (tower >= 0) s.rank[tower] = Math.min(4, rank + 1);
  events.push({ type: 'round', winner: w, why, tower, rank, points, score: [s.score[0], s.score[1]] });
  if (s.score[w] >= s.cfg.target) {
    s.over = true;
    s.winner = w;
    events.push({ type: 'end', winner: w, why: s.cfg.target > 1 ? 'match' : why });
    return;
  }
  s.phase = 'fill';
  s.turn = w;
  s.forced = -1;
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  const ok = legal(s).some((m) => (m.type === 'fill' ? a.type === 'fill' && a.side === m.side : a.type === 'move' && a.from === m.from && a.to === m.to));
  return ok ? step(s, a) : null;
}
