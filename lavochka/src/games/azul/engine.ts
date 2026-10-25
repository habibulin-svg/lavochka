/* Плиточник — правила (без DOM), по образцу Azul. Пацаны помогают Михалычу класть кафель в ванной.
 *
 * Плиток 100: пять видов по 20 (в мешке). На стройрынке ящики («фабрики»): вдвоём 5, втроём 7, вчетвером 9; в каждый — по 4 плитки.
 * Раунд:
 *   1) закупка — по очереди: взять из одного ящика все плитки одного вида (остальные — на прилавок) или с прилавка все плитки
 *      одного вида (первый, кто берёт с прилавка, забирает и мастерок — он ходит первым в следующем раунде, но мастерок — в «бой»).
 *      Взятое кладут в одну строку ведра (строка k вмещает k плиток, в ней — один вид, и этого вида ещё нет в той же строке стены);
 *      лишнее — в «бой» (7 мест: −1 −1 −2 −2 −2 −3 −3, дальше — в коробку без штрафа). Можно сразу всё — в «бой».
 *   2) когда ящики и прилавок пусты — кладка: из каждой заполненной строки одна плитка идёт на стену, остальные — в коробку.
 *      Очки за плитку: сколько плиток в её ряду и в её столбце подряд (если сосед только в одну сторону — по ней; одна — 1).
 *      Штрафы «боя» вычитаются (ниже нуля не бывает).
 * Конец — после раунда, в котором у кого-то сложился полный ряд стены. Бонусы: ряд +2, столбец +7, все пять плиток вида +10.
 * Цветная стена: место каждой плитки в ряду задано (вид v в ряду r — столбец (v + r) mod 5).
 * Серая стена: столбец выбираешь сам, но в столбце каждого вида — не больше одной плитки; некуда — плитки строки в «бой».
 */
import type { Options, Rng } from '../../core/types';

export const KINDS = 5;
export const KIND_RU = ['белый', 'голубой', 'расписной', 'метлахская', 'чёрный'];
export const FLOOR = [-1, -1, -2, -2, -2, -3, -3];
/** Мастерок (жетон первого хода) в «бое». */
export const TROWEL = -1;

export interface Cfg {
  grey: boolean;
}
export const cfgFrom = (o: Options): Cfg => ({ grey: o.wall === 'grey' });

export interface Board {
  /** Строки ведра: вид и сколько (вид -1 — пусто). */
  lines: { k: number; n: number }[];
  /** Стена 5×5: вид или -1. */
  wall: number[][];
  /** «Бой»: плитки и мастерок (TROWEL). */
  floor: number[];
  score: number;
}

export interface State {
  cfg: Cfg;
  players: number;
  /** Мешок и коробка: сколько плиток каждого вида. */
  bag: number[];
  box: number[];
  factories: number[][];
  center: number[];
  /** Мастерок ещё на прилавке. */
  trowel: boolean;
  boards: Board[];
  turn: number;
  /** Кто начнёт следующий раунд (взял мастерок). */
  next: number;
  phase: 'take' | 'wall';
  /** Серая стена: чья кладка и какая строка. */
  tiling: { seat: number; row: number } | null;
  round: number;
  last: { seat: number; src: number; kind: number; row: number; n: number } | null;
  over: boolean;
  winners: number[];
}

export type View = State;
export type Action = { type: 'take'; src: number; kind: number; row: number } | { type: 'wall'; col: number };
export type Event =
  | { type: 'take'; seat: number; src: number; kind: number; n: number; row: number; trowel: boolean; rest: number }
  | { type: 'fill' }
  | { type: 'tile'; seat: number; row: number; col: number; kind: number; pts: number }
  | { type: 'floor'; seat: number; pts: number }
  | { type: 'end'; scores: number[]; bonus: number[] };

/** Столбец вида на цветной стене. */
export const colOf = (kind: number, row: number) => (kind + row) % KINDS;
export const kindAt = (row: number, col: number) => (col - row + KINDS) % KINDS;

export const factoriesFor = (players: number) => (players <= 2 ? 5 : players === 3 ? 7 : 9);

function newBoard(): Board {
  return {
    lines: Array.from({ length: 5 }, () => ({ k: -1, n: 0 })),
    wall: Array.from({ length: 5 }, () => new Array(5).fill(-1)),
    floor: [],
    score: 0,
  };
}

function draw(s: State, rng: Rng): number {
  let total = s.bag.reduce((a, b) => a + b, 0);
  if (!total) {
    s.bag = s.box;
    s.box = new Array(KINDS).fill(0);
    total = s.bag.reduce((a, b) => a + b, 0);
    if (!total) return -1;
  }
  let x = rng.int(total);
  for (let k = 0; k < KINDS; k++) {
    if (x < s.bag[k]) {
      s.bag[k]--;
      return k;
    }
    x -= s.bag[k];
  }
  return -1;
}

/** Разложить плитки по ящикам на новый раунд. */
function fill(s: State, rng: Rng) {
  s.factories = [];
  for (let f = 0; f < factoriesFor(s.players); f++) {
    const t: number[] = [];
    for (let i = 0; i < 4; i++) {
      const k = draw(s, rng);
      if (k >= 0) t.push(k);
    }
    s.factories.push(t.sort());
  }
  s.center = [];
  s.trowel = true;
  s.phase = 'take';
  s.turn = s.next;
  s.round++;
}

export function setup(opts: Options, players: number, rng: Rng): State {
  const s: State = {
    cfg: cfgFrom(opts),
    players,
    bag: new Array(KINDS).fill(20),
    box: new Array(KINDS).fill(0),
    factories: [],
    center: [],
    trowel: true,
    boards: Array.from({ length: players }, newBoard),
    turn: 0,
    next: 0,
    phase: 'take',
    tiling: null,
    round: 0,
    last: null,
    over: false,
    winners: [],
  };
  fill(s, rng);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : s.phase === 'wall' ? [s.tiling!.seat] : [s.turn]);

/** Можно ли класть вид kind в строку row этого игрока. */
export function lineOk(b: Board, kind: number, row: number, grey: boolean): boolean {
  const L = b.lines[row];
  if (L.n >= row + 1) return false;
  if (L.k !== -1 && L.k !== kind) return false;
  if (grey) return b.wall[row].every((x) => x !== kind) && wallCols(b, row, kind).length > 0;
  return b.wall[row][colOf(kind, row)] === -1;
}

/** Серая стена: свободные столбцы ряда, где в столбце ещё нет этого вида. */
export function wallCols(b: Board, row: number, kind: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < 5; c++) if (b.wall[row][c] === -1 && b.wall.every((r) => r[c] !== kind)) out.push(c);
  return out;
}

const kindsIn = (t: number[]) => [...new Set(t)].sort();

export function legal(s: State): Action[] {
  if (s.over) return [];
  if (s.phase === 'wall') {
    const { seat, row } = s.tiling!;
    const b = s.boards[seat];
    const cols = wallCols(b, row, b.lines[row].k);
    return cols.map((col) => ({ type: 'wall', col }));
  }
  const b = s.boards[s.turn];
  const out: Action[] = [];
  const srcs: [number, number[]][] = s.factories.map((t, i) => [i, t] as [number, number[]]);
  srcs.push([-1, s.center]);
  for (const [src, tiles] of srcs)
    for (const kind of kindsIn(tiles)) {
      for (let row = 0; row < 5; row++) if (lineOk(b, kind, row, s.cfg.grey)) out.push({ type: 'take', src, kind, row });
      out.push({ type: 'take', src, kind, row: 5 }); // всё в «бой»
    }
  return out;
}

function toFloor(s: State, seat: number, tiles: number[]) {
  const b = s.boards[seat];
  for (const t of tiles) {
    if (b.floor.length < 7) b.floor.push(t);
    else if (t !== TROWEL) s.box[t]++;
  }
}

/** Очки за плитку на (r, c): цепочки по ряду и столбцу. */
export function tilePoints(wall: number[][], r: number, c: number): number {
  let h = 1;
  for (let x = c - 1; x >= 0 && wall[r][x] >= 0; x--) h++;
  for (let x = c + 1; x < 5 && wall[r][x] >= 0; x++) h++;
  let v = 1;
  for (let y = r - 1; y >= 0 && wall[y][c] >= 0; y--) v++;
  for (let y = r + 1; y < 5 && wall[y][c] >= 0; y++) v++;
  if (h > 1 && v > 1) return h + v;
  return Math.max(h, v);
}

function setTile(s: State, seat: number, row: number, col: number, events: Event[]) {
  const b = s.boards[seat];
  const L = b.lines[row];
  b.wall[row][col] = L.k;
  const pts = tilePoints(b.wall, row, col);
  b.score += pts;
  s.box[L.k] += L.n - 1;
  events.push({ type: 'tile', seat, row, col, kind: L.k, pts });
  b.lines[row] = { k: -1, n: 0 };
}

function floorScore(s: State, seat: number, events: Event[]) {
  const b = s.boards[seat];
  let pen = 0;
  b.floor.forEach((t, i) => {
    pen += FLOOR[i];
    if (t !== TROWEL) s.box[t]++;
  });
  if (b.floor.length) events.push({ type: 'floor', seat, pts: pen });
  b.score = Math.max(0, b.score + pen);
  b.floor = [];
}

/** Следующая заполненная строка для серой кладки (с места seat, строка от row). */
function nextTiling(s: State, seat: number, row: number): { seat: number; row: number } | null {
  for (let p = seat; p < s.players; p++) {
    const b = s.boards[p];
    for (let r = p === seat ? row : 0; r < 5; r++) if (b.lines[r].n === r + 1) return { seat: p, row: r };
  }
  return null;
}

/** Кладка на стену (цветная — сразу у всех; серая — пока строка не потребует выбора). from — с какого места и строки искать дальше. */
function tileWalls(s: State, rng: Rng, events: Event[], from: { seat: number; row: number }) {
  if (!s.cfg.grey) {
    for (let p = 0; p < s.players; p++) {
      const b = s.boards[p];
      for (let r = 0; r < 5; r++) if (b.lines[r].n === r + 1) setTile(s, p, r, colOf(b.lines[r].k, r), events);
    }
  } else {
    let t = nextTiling(s, from.seat, from.row);
    while (t) {
      const b = s.boards[t.seat];
      const cols = wallCols(b, t.row, b.lines[t.row].k);
      if (cols.length > 1) {
        s.phase = 'wall';
        s.tiling = t;
        return;
      }
      if (cols.length === 1) setTile(s, t.seat, t.row, cols[0], events);
      else {
        // некуда положить — вся строка в «бой»
        const L = b.lines[t.row];
        toFloor(s, t.seat, new Array(L.n).fill(L.k));
        b.lines[t.row] = { k: -1, n: 0 };
      }
      t = nextTiling(s, t.seat, t.row + 1);
    }
  }
  s.tiling = null;
  for (let p = 0; p < s.players; p++) floorScore(s, p, events);
  // конец партии — у кого-то полный ряд
  if (s.boards.some((b) => b.wall.some((r) => r.every((x) => x >= 0)))) return finish(s, events);
  fill(s, rng);
  events.push({ type: 'fill' });
}

export function bonus(b: Board): number {
  let v = 0;
  for (let r = 0; r < 5; r++) if (b.wall[r].every((x) => x >= 0)) v += 2;
  for (let c = 0; c < 5; c++) if (b.wall.every((r) => r[c] >= 0)) v += 7;
  for (let k = 0; k < KINDS; k++) if (b.wall.flat().filter((x) => x === k).length === 5) v += 10;
  return v;
}
export const fullRows = (b: Board) => b.wall.filter((r) => r.every((x) => x >= 0)).length;

function finish(s: State, events: Event[]) {
  const bon = s.boards.map((b) => bonus(b));
  s.boards.forEach((b, i) => (b.score += bon[i]));
  s.over = true;
  const best = Math.max(...s.boards.map((b) => b.score));
  let w = s.boards.map((b, i) => (b.score === best ? i : -1)).filter((i) => i >= 0);
  if (w.length > 1) {
    const rows = Math.max(...w.map((i) => fullRows(s.boards[i])));
    w = w.filter((i) => fullRows(s.boards[i]) === rows);
  }
  s.winners = w;
  events.push({ type: 'end', scores: s.boards.map((b) => b.score), bonus: bon });
}

function clone(s: State): State {
  return {
    ...s,
    bag: [...s.bag],
    box: [...s.box],
    factories: s.factories.map((f) => [...f]),
    center: [...s.center],
    boards: s.boards.map((b) => ({ lines: b.lines.map((l) => ({ ...l })), wall: b.wall.map((r) => [...r]), floor: [...b.floor], score: b.score })),
  };
}

export function apply(s0: State, a: Action, rng: Rng): { state: State; events: Event[] } {
  const s = clone(s0);
  const events: Event[] = [];
  if (a.type === 'wall') {
    const t = s.tiling!;
    setTile(s, t.seat, t.row, a.col, events);
    s.phase = 'take';
    tileWalls(s, rng, events, { seat: t.seat, row: t.row + 1 });
    return { state: s, events };
  }
  const seat = s.turn;
  const b = s.boards[seat];
  let taken: number[];
  let trowel = false;
  let rest = 0;
  if (a.src === -1) {
    taken = s.center.filter((t) => t === a.kind);
    s.center = s.center.filter((t) => t !== a.kind);
    if (s.trowel) {
      s.trowel = false;
      trowel = true;
      s.next = seat;
      toFloor(s, seat, [TROWEL]);
    }
  } else {
    const f = s.factories[a.src];
    taken = f.filter((t) => t === a.kind);
    const others = f.filter((t) => t !== a.kind);
    rest = others.length;
    s.center.push(...others);
    s.center.sort();
    s.factories[a.src] = [];
  }
  if (a.row < 5) {
    const L = b.lines[a.row];
    const room = a.row + 1 - L.n;
    const put = Math.min(room, taken.length);
    b.lines[a.row] = { k: a.kind, n: L.n + put };
    toFloor(s, seat, taken.slice(put));
  } else toFloor(s, seat, taken);
  s.last = { seat, src: a.src, kind: a.kind, row: a.row, n: taken.length };
  events.push({ type: 'take', seat, src: a.src, kind: a.kind, n: taken.length, row: a.row, trowel, rest });
  if (s.factories.every((f) => !f.length) && !s.center.length) {
    s.phase = 'wall';
    tileWalls(s, rng, events, { seat: 0, row: 0 });
    if (s.phase === 'wall') return { state: s, events };
  } else s.turn = (seat + 1) % s.players;
  return { state: s, events };
}

export function step(s: State, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.over) return null;
  if (!legal(s).some((m) => JSON.stringify(m) === JSON.stringify(a))) return null;
  return apply(s, a, rng);
}
