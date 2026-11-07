/* Brick Game 2026 — движок падающих фигур без DOM, по ощущению — как на старой 8-битной приставке:
 * время в кадрах (60 в секунду), скорость падения по таблице уровней, автоповтор сдвига 16/6 кадров, мягкое падение — ряд за 2 кадра,
 * поворот без «отскоков» от стен, задержка появления фигуры (10–18 кадров) и снятия рядов, очки 40/100/300/1200 × (уровень + 1),
 * следующая фигура одна, случайник с одной перебросной попыткой против повторов. Из современного — по желанию: тень и мгновенный сброс.
 * Для сети: каждая фигура закрепляется «установкой» (номер, вид, поворот, x, y) — комната повторяет её на своей копии поля. */

export const W = 10;
/** Высота поля: 20 видимых рядов + 2 сверху за краем. */
export const H = 22;
export const HIDDEN = 2;

export type Cell = [number, number];
/** Фигуры: I O T S Z J L (1…7), повороты по часовой; клетки относительно оси. 8 — мусорный ряд. */
export const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
const SHAPES: Cell[][][] = [
  // I
  [
    [[-2, 0], [-1, 0], [0, 0], [1, 0]],
    [[0, -2], [0, -1], [0, 0], [0, 1]],
  ],
  // O
  [[[-1, 0], [0, 0], [-1, 1], [0, 1]]],
  // T
  [
    [[-1, 0], [0, 0], [1, 0], [0, 1]],
    [[0, -1], [-1, 0], [0, 0], [0, 1]],
    [[-1, 0], [0, 0], [1, 0], [0, -1]],
    [[0, -1], [0, 0], [1, 0], [0, 1]],
  ],
  // S
  [
    [[0, 0], [1, 0], [-1, 1], [0, 1]],
    [[0, -1], [0, 0], [1, 0], [1, 1]],
  ],
  // Z
  [
    [[-1, 0], [0, 0], [0, 1], [1, 1]],
    [[1, -1], [0, 0], [1, 0], [0, 1]],
  ],
  // J
  [
    [[-1, 0], [0, 0], [1, 0], [1, 1]],
    [[0, -1], [0, 0], [-1, 1], [0, 1]],
    [[-1, -1], [-1, 0], [0, 0], [1, 0]],
    [[0, -1], [1, -1], [0, 0], [0, 1]],
  ],
  // L
  [
    [[-1, 0], [0, 0], [1, 0], [-1, 1]],
    [[-1, -1], [0, -1], [0, 0], [0, 1]],
    [[1, -1], [-1, 0], [0, 0], [1, 0]],
    [[0, -1], [0, 0], [0, 1], [1, 1]],
  ],
];
export const cellsOf = (k: number, r: number): Cell[] => {
  const rots = SHAPES[k - 1];
  return rots[((r % rots.length) + rots.length) % rots.length];
};
export const rotCount = (k: number) => SHAPES[k - 1].length;

/** Кадров на ряд по уровням (с 29-го — ряд за кадр). */
const GRAVITY = [48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1];
export const gravityOf = (level: number) => GRAVITY[Math.min(level, GRAVITY.length - 1)];
const DAS_FIRST = 16;
const DAS_NEXT = 6;
const CLEAR_FRAMES = 18;
export const LINE_PTS = [0, 40, 100, 300, 1200];

export interface Piece {
  k: number;
  r: number;
  x: number;
  y: number;
}

/** Установка фигуры (для сети): номер фигуры по счёту, вид, поворот, ось. */
export type Place = [number, number, number, number, number];

/** Мусор в очереди: сколько рядов, где дыра, с какого момента может войти (секунды комнаты), от кого. */
export interface Garbage {
  n: number;
  hole: number;
  at: number;
  from: number;
}

export interface Tet {
  grid: number[];
  cur: Piece | null;
  next: number;
  /** Случайник: своё зерно и предыдущая фигура. */
  seed: number;
  prev: number;
  /** Сколько фигур выдано (номер текущей). */
  seq: number;
  level: number;
  start: number;
  lines: number;
  score: number;
  frame: number;
  gravT: number;
  das: number;
  dasDir: number;
  softT: number;
  /** Мягкое падение держат с появления фигуры (на старой приставке очки за него — только так). */
  soft: number;
  are: number;
  clearRows: number[];
  clearT: number;
  over: boolean;
  /** Сколько каждой фигуры выпало (как столбик статистики слева). */
  stats: number[];
  tetrises: number;
  /** Подряд закрытий с рядами (для сети) и мусор в очереди. */
  combo: number;
  garbage: Garbage[];
  /** Режим «B»: сколько рядов осталось снять (0 — не B). */
  goal: number;
  won: boolean;
  /** Современное: тень и мгновенный сброс. */
  hard: boolean;
}

export interface TetIn {
  l: boolean;
  r: boolean;
  d: boolean;
  /** Нажатия в этот кадр. */
  cw?: boolean;
  ccw?: boolean;
  drop?: boolean;
}

export type TetEvent =
  | { k: 'move' }
  | { k: 'rotate' }
  | { k: 'lock'; place: Place }
  | { k: 'clear'; n: number; rows: number[] }
  | { k: 'level'; level: number }
  | { k: 'garbage'; n: number }
  | { k: 'over' }
  | { k: 'won' };

/** Случайник старой приставки: 8 граней, повтор или «восьмая» — перебросить один раз среди семи. */
function roll(t: Tet): number {
  const r = () => {
    t.seed = (Math.imul(t.seed, 1103515245) + 12345) >>> 0;
    return t.seed >>> 16;
  };
  let k = (r() % 8) + 1;
  if (k === 8 || k === t.prev) k = (r() % 7) + 1;
  t.prev = k;
  return k;
}

export function newTet(seed: number, start = 0, opts: { goal?: number; height?: number; hard?: boolean } = {}): Tet {
  const t: Tet = {
    grid: new Array(W * H).fill(0),
    cur: null,
    next: 0,
    seed: seed >>> 0 || 1,
    prev: 0,
    seq: 0,
    level: start,
    start,
    lines: 0,
    score: 0,
    frame: 0,
    gravT: 0,
    das: 0,
    dasDir: 0,
    softT: 0,
    soft: 0,
    are: 0,
    clearRows: [],
    clearT: 0,
    over: false,
    stats: [0, 0, 0, 0, 0, 0, 0],
    tetrises: 0,
    combo: 0,
    garbage: [],
    goal: opts.goal ?? 0,
    won: false,
    hard: !!opts.hard,
  };
  // режим B: снизу мусор высотой height*2 рядов, в каждом ряду пусто примерно половина
  const hgt = Math.min(15, (opts.height ?? 0) * 3);
  for (let y = H - hgt; y < H; y++)
    for (let x = 0; x < W; x++) {
      t.seed = (Math.imul(t.seed, 1103515245) + 12345) >>> 0;
      if ((t.seed >>> 16) % 2) t.grid[y * W + x] = 1 + ((t.seed >>> 8) % 7);
    }
  t.next = roll(t);
  spawn(t);
  return t;
}

export const at = (t: Tet, x: number, y: number) => (x < 0 || x >= W || y >= H ? 9 : y < 0 ? 0 : t.grid[y * W + x]);

export function fits(t: Tet, p: Piece): boolean {
  for (const [dx, dy] of cellsOf(p.k, p.r)) if (at(t, p.x + dx, p.y + dy)) return false;
  return true;
}

function spawn(t: Tet) {
  const k = t.next;
  t.next = roll(t);
  t.seq++;
  t.stats[k - 1]++;
  t.cur = { k, r: 0, x: 5, y: HIDDEN };
  t.gravT = 0;
  if (!fits(t, t.cur)) {
    t.over = true;
    t.cur = null;
  }
}

/** Куда упадёт фигура (тень, мгновенный сброс). */
export function dropY(t: Tet, p: Piece): number {
  let y = p.y;
  while (fits(t, { ...p, y: y + 1 })) y++;
  return y;
}

/** Поставить фигуру на поле: ряды, очки, уровень. Общий путь для своего кадра и для комнаты. */
export function lockPiece(t: Tet, p: Piece): number[] {
  for (const [dx, dy] of cellsOf(p.k, p.r)) {
    const y = p.y + dy;
    if (y >= 0) t.grid[y * W + p.x + dx] = p.k;
  }
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    let full = true;
    for (let x = 0; x < W && full; x++) if (!t.grid[y * W + x]) full = false;
    if (full) rows.push(y);
  }
  return rows;
}

/** Убрать ряды (после анимации) и сдвинуть всё вниз. */
export function removeRows(t: Tet, rows: number[]) {
  for (const y of rows) {
    t.grid.splice(y * W, W);
    t.grid.unshift(...new Array(W).fill(0));
  }
}

/** Счёт и уровень за снятые ряды (как на приставке: первый переход — по особому правилу от стартового уровня). */
export function scoreRows(t: Tet, n: number): boolean {
  if (!n) return false;
  t.score += LINE_PTS[n] * (t.level + 1);
  if (n === 4) t.tetrises++;
  t.lines += n;
  const first = Math.min(t.start * 10 + 10, Math.max(100, t.start * 10 - 50));
  const lvl = t.lines < first ? t.start : t.start + 1 + Math.floor((t.lines - first) / 10);
  if (lvl !== t.level) {
    t.level = lvl;
    return true;
  }
  return false;
}

/** Мусор снизу: n рядов с дырой hole. Если поднявшийся стакан задел фигуру — она поднимается вместе. */
export function addGarbage(t: Tet, n: number, hole: number) {
  for (let i = 0; i < n; i++) {
    t.grid.splice(0, W);
    const row = new Array(W).fill(8);
    row[hole] = 0;
    t.grid.push(...row);
  }
}

/** Ход кадра. */
export function stepTet(t: Tet, inp: TetIn, now = 0): TetEvent[] {
  const ev: TetEvent[] = [];
  if (t.over || t.won) return ev;
  t.frame++;
  // анимация снятия рядов
  if (t.clearT > 0) {
    t.clearT--;
    if (t.clearT === 0) {
      removeRows(t, t.clearRows);
      t.clearRows = [];
    }
    return ev;
  }
  if (t.are > 0) {
    t.are--;
    // сдвиг копится и во время паузы (как на приставке)
    dasCharge(t, inp);
    if (t.are === 0) {
      spawn(t);
      if (t.over) ev.push({ k: 'over' });
    }
    return ev;
  }
  const p = t.cur;
  if (!p) return ev;
  // поворот
  if (inp.cw || inp.ccw) {
    const q = { ...p, r: p.r + (inp.cw ? 1 : -1) };
    if (fits(t, q)) {
      p.r = q.r;
      ev.push({ k: 'rotate' });
    }
  }
  // сдвиг с автоповтором
  const dir = inp.l === inp.r ? 0 : inp.l ? -1 : 1;
  if (dir && !inp.d) {
    let move = false;
    if (dir !== t.dasDir) {
      t.dasDir = dir;
      t.das = 0;
      move = true;
    } else {
      t.das++;
      if (t.das >= DAS_FIRST) {
        move = true;
        t.das = DAS_FIRST - DAS_NEXT;
      }
    }
    if (move) {
      const q = { ...p, x: p.x + dir };
      if (fits(t, q)) {
        p.x = q.x;
        ev.push({ k: 'move' });
      } else t.das = DAS_FIRST; // упёрлись — заряд полный, отпустит стену сразу
    }
  } else if (!dir) t.dasDir = 0;
  // мгновенный сброс (по желанию)
  if (t.hard && inp.drop) {
    const y = dropY(t, p);
    t.score += (y - p.y) * 2;
    p.y = y;
    return lock(t, ev, now);
  }
  // падение: мягкое — ряд за 2 кадра
  let fall = false;
  if (inp.d && !dir) {
    t.soft++;
    t.softT++;
    if (t.softT >= 2) {
      t.softT = 0;
      fall = true;
    }
  } else {
    t.soft = 0;
    t.softT = 0;
  }
  t.gravT++;
  if (t.gravT >= gravityOf(t.level)) fall = true;
  if (fall) {
    t.gravT = 0;
    const q = { ...p, y: p.y + 1 };
    if (fits(t, q)) {
      p.y = q.y;
      if (inp.d && t.soft > 0) t.score += 1;
    } else return lock(t, ev, now);
  }
  return ev;
}

function dasCharge(t: Tet, inp: TetIn) {
  const dir = inp.l === inp.r ? 0 : inp.l ? -1 : 1;
  if (!dir) t.dasDir = 0;
  else if (dir !== t.dasDir) {
    t.dasDir = dir;
    t.das = 0;
  } else t.das = Math.min(DAS_FIRST, t.das + 1);
}

function lock(t: Tet, ev: TetEvent[], now: number): TetEvent[] {
  const p = t.cur!;
  const place: Place = [t.seq, p.k, ((p.r % rotCount(p.k)) + rotCount(p.k)) % rotCount(p.k), p.x, p.y];
  const rows = lockPiece(t, p);
  t.cur = null;
  ev.push({ k: 'lock', place });
  // чем ниже легла фигура, тем дольше пауза до следующей (10…18 кадров)
  const low = Math.max(0, H - 1 - p.y);
  t.are = 10 + 2 * Math.min(4, Math.floor((H - low) / 4));
  if (rows.length) {
    t.clearRows = rows;
    t.clearT = CLEAR_FRAMES;
    t.combo++;
    ev.push({ k: 'clear', n: rows.length, rows });
    if (scoreRows(t, rows.length)) ev.push({ k: 'level', level: t.level });
    if (t.goal) {
      t.goal = Math.max(0, t.goal - rows.length);
      if (!t.goal) {
        t.won = true;
        ev.push({ k: 'won' });
      }
    }
  } else {
    t.combo = 0;
    // мусор, чьё время пришло, входит только когда ряды не снимались
    let n = 0;
    t.garbage = t.garbage.filter((g) => {
      if (g.at > now) return true;
      addGarbage(t, g.n, g.hole);
      n += g.n;
      return false;
    });
    if (n) ev.push({ k: 'garbage', n });
  }
  return ev;
}

/** Поставить фигуру по установке из сети: проверить, что это та фигура, она влезает и лежит. Возвращает снятые ряды или null. */
export function applyPlace(t: Tet, pl: Place, now: number): { rows: number[]; garbage: number } | null {
  const [seq, k, r, x, y] = pl;
  if (t.over || !t.cur || seq !== t.seq || k !== t.cur.k) return null;
  const p: Piece = { k, r, x, y };
  if (!fits(t, p) || fits(t, { ...p, y: y + 1 })) return null;
  t.cur = p;
  const ev: TetEvent[] = [];
  lock(t, ev, now);
  // сеть: без анимаций — сразу убрать ряды и выдать следующую
  if (t.clearRows.length) {
    removeRows(t, t.clearRows);
    t.clearRows = [];
    t.clearT = 0;
  }
  t.are = 0;
  spawn(t);
  const g = ev.find((e) => e.k === 'garbage');
  const c = ev.find((e) => e.k === 'clear');
  return { rows: c && c.k === 'clear' ? c.rows : [], garbage: g && g.k === 'garbage' ? g.n : 0 };
}

/** Высота стакана (рядов от дна до верхней занятой клетки). */
export function stackHeight(t: Tet): number {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (t.grid[y * W + x]) return H - y;
  return 0;
}
