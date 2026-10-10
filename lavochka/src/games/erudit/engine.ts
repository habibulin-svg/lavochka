/* Эрудит — движок без DOM.
 * Поле 15×15 с премиальными клетками, мешок фишек с буквами и очками, у каждого на руке по 7 (в «Эрудите» — по 7 или 8, см. SETS).
 * Ход: выложить фишки в один ряд (строку или столбец) без пропусков, примыкая к уже стоящим (первый ход — через центр).
 * Все образовавшиеся слова — существительные из словаря. Очки: буквы × премия буквы, × премии слова; новые фишки берут премию.
 * Выложил все фишки руки — бонус. Можно поменять фишки (если в мешке достаточно) или пропустить.
 * Конец: мешок пуст и кто-то выложил все фишки, или подряд много ходов без очков. Остатки на руках вычитаются. */
import type { Options, Rng } from '../../core/types';
import { clone } from '../../core/util';
import { ALPHABET, hasWord, norm } from '../../words/dict';

export const N = 15;
export const CENTER = 7 * N + 7;
export const JOKER = '*';

/** Набор фишек: буква → [сколько, очки]. */
export interface TileSet {
  title: string;
  tiles: Record<string, [number, number]>;
  rack: number;
  bonus: number;
}

export const SETS: Record<string, TileSet> = {
  // «Эрудит»: 131 фишка, из них 3 звёздочки
  erudit: {
    title: 'Эрудит',
    rack: 7,
    bonus: 15,
    tiles: {
      а: [10, 1], б: [3, 3], в: [5, 2], г: [3, 3], д: [5, 2], е: [9, 1], ж: [2, 5], з: [2, 5], и: [8, 1], й: [4, 2], к: [6, 2],
      л: [4, 2], м: [5, 2], н: [8, 1], о: [10, 1], п: [6, 2], р: [6, 2], с: [6, 2], т: [5, 2], у: [3, 3], ф: [1, 10], х: [2, 5],
      ц: [1, 10], ч: [2, 5], ш: [1, 10], щ: [1, 10], ъ: [1, 10], ы: [2, 5], ь: [2, 5], э: [1, 10], ю: [1, 10], я: [3, 3], '*': [3, 0],
    },
  },
  // русский «Скрэббл»: 104 фишки, 2 пустые (Ё в нашем словаре — Е, её фишка добавлена к Е)
  scrabble: {
    title: 'Скрэббл',
    rack: 7,
    bonus: 50,
    tiles: {
      а: [8, 1], б: [2, 3], в: [4, 1], г: [2, 3], д: [4, 2], е: [9, 1], ж: [1, 5], з: [2, 5], и: [5, 1], й: [1, 4], к: [4, 2],
      л: [4, 2], м: [3, 2], н: [5, 1], о: [10, 1], п: [4, 2], р: [5, 1], с: [5, 1], т: [5, 1], у: [4, 2], ф: [1, 10], х: [1, 5],
      ц: [1, 5], ч: [1, 5], ш: [1, 8], щ: [1, 10], ъ: [1, 10], ы: [2, 4], ь: [2, 3], э: [1, 8], ю: [1, 8], я: [2, 3], '*': [2, 0],
    },
  },
};

export type Prem = '' | 'L2' | 'L3' | 'W2' | 'W3';

/** Премиальные клетки — классическая раскладка 15×15 (симметрична по обеим осям и диагоналям). */
export const PREMIUM: Prem[] = (() => {
  const p: Prem[] = Array(N * N).fill('');
  const put = (t: Prem, cells: [number, number][]) => {
    for (const [r, c] of cells)
      for (const [rr, cc] of [[r, c], [c, r], [N - 1 - r, c], [r, N - 1 - c], [N - 1 - r, N - 1 - c], [c, N - 1 - r], [N - 1 - c, r], [N - 1 - c, N - 1 - r]])
        p[rr * N + cc] = t;
  };
  put('W3', [[0, 0], [0, 7]]);
  put('W2', [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]]);
  put('L3', [[1, 5], [5, 5]]);
  put('L2', [[0, 3], [2, 6], [3, 7], [6, 6]]);
  return p;
})();

/** В «Эрудите» центр — белая клетка без множителя, в «Скрэббле» — слово ×2. */
export const premiumOf = (cfg: { set: string }, c: number): Prem => (c === CENTER && cfg.set === 'erudit' ? '' : PREMIUM[c]);

export interface Cfg {
  set: 'erudit' | 'scrabble';
  /** Ход звёздочкой: можно забрать звёздочку с поля, положив вместо неё ту букву, которую она изображает. */
  swapJoker: boolean;
  /** До скольких очков (0 — до конца мешка). */
  target: number;
}

export function cfgFrom(o: Options): Cfg {
  return {
    set: o.set === 'scrabble' ? 'scrabble' : 'erudit',
    swapJoker: o.swapJoker !== false,
    target: [0, 200, 300, 500].includes(Number(o.target)) ? Number(o.target) : 0,
  };
}

export interface Tile {
  /** Буква на поле (для звёздочки — какую она изображает). */
  ch: string;
  joker?: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  board: (Tile | null)[];
  bag: string[];
  racks: string[][];
  scores: number[];
  cur: number;
  /** Ходов подряд без очков. */
  idle: number;
  over: boolean;
  /** Кто закончил фишки (получил остатки соперников). */
  out: number | null;
  last: { cells: number[]; words: string[]; points: number } | null;
  resigned: boolean[];
  moves: number;
}

/** Фишка из руки на клетку: letter — буква руки ('*' для звёздочки), as — какую букву изображает звёздочка. */
export interface Place {
  cell: number;
  letter: string;
  as?: string;
}

export type Action =
  | { type: 'play'; tiles: Place[]; /** забрать звёздочку с поля: клетка со звёздочкой (её место займёт буква из руки — она в tiles) */ take?: number }
  | { type: 'swap'; letters: string[] }
  | { type: 'pass' }
  | { type: 'resign' };

export type Event =
  | { type: 'play'; seat: number; tiles: Place[]; words: string[]; points: number; bonus: boolean; take?: number }
  | { type: 'swap'; seat: number; count: number; letters?: string[] }
  | { type: 'pass'; seat: number }
  | { type: 'resign'; seat: number }
  | { type: 'draw'; seat: number; count: number; letters?: string[] }
  | { type: 'end'; seat: number | null; rest: number[] };

export const tileSet = (cfg: Cfg) => SETS[cfg.set];
export const valueOf = (cfg: Cfg, letter: string) => tileSet(cfg).tiles[letter]?.[1] ?? 0;

function fillBag(cfg: Cfg, rng: Rng): string[] {
  const bag: string[] = [];
  for (const [ch, [n]] of Object.entries(tileSet(cfg).tiles)) for (let i = 0; i < n; i++) bag.push(ch);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function newGame(seats: number[], cfg: Cfg, rng: Rng): State {
  const bag = fillBag(cfg, rng);
  const R = tileSet(cfg).rack;
  return {
    cfg: { ...cfg },
    seats: seats.slice(),
    board: Array(N * N).fill(null),
    bag,
    racks: seats.map(() => bag.splice(0, R)),
    scores: seats.map(() => 0),
    cur: rng.int(seats.length),
    idle: 0,
    over: false,
    out: null,
    last: null,
    resigned: seats.map(() => false),
    moves: 0,
  };
}

export const toAct = (s: State) => (s.over ? [] : [s.seats[s.cur]]);

const rc = (c: number) => [Math.floor(c / N), c % N] as const;

export interface Scored {
  words: { word: string; cells: number[] }[];
  points: number;
  bonus: boolean;
}

/** Слово через клетку c по направлению d (1 — по строке, N — по столбцу) на доске b. */
function wordAt(b: (Tile | null)[], c: number, d: number): number[] {
  const row = Math.floor(c / N);
  const ok = (x: number) => x >= 0 && x < N * N && (d !== 1 || Math.floor(x / N) === row) && !!b[x];
  let a = c;
  while (ok(a - d)) a -= d;
  const cells: number[] = [];
  for (let x = a; ok(x); x += d) cells.push(x);
  return cells;
}

export type Verdict = { ok: true; score: Scored } | { ok: false; why: string };

/** Проверить выкладку и посчитать очки. rack — рука игрока (для проверки, что такие фишки есть). */
export function evaluate(s: State, tiles: Place[], rack: string[], take?: number): Verdict {
  if (!Array.isArray(tiles) || !tiles.length) return { ok: false, why: 'Выложите хотя бы одну фишку.' };
  const left = rack.slice();
  const b = s.board.slice();
  // звёздочка с поля: на её место ставится настоящая буква, звёздочка уходит в руку
  if (take != null) {
    if (!s.cfg.swapJoker) return { ok: false, why: 'Звёздочку забирать нельзя.' };
    const t = b[take];
    if (!t?.joker) return { ok: false, why: 'Там нет звёздочки.' };
    const i = left.indexOf(t.ch);
    if (i < 0) return { ok: false, why: `Чтобы забрать звёздочку, нужна буква «${t.ch.toUpperCase()}».` };
    left.splice(i, 1);
    left.push(JOKER);
    b[take] = { ch: t.ch };
  }
  const cells = new Set<number>();
  for (const p of tiles) {
    if (!(p.cell >= 0 && p.cell < N * N) || b[p.cell] || cells.has(p.cell)) return { ok: false, why: 'Фишку можно положить только на свободную клетку.' };
    const i = left.indexOf(p.letter);
    if (i < 0) return { ok: false, why: 'Такой фишки нет на руке.' };
    left.splice(i, 1);
    let ch = p.letter;
    if (p.letter === JOKER) {
      ch = norm(p.as ?? '');
      if (ch.length !== 1 || !ALPHABET.includes(ch)) return { ok: false, why: 'Скажите, какую букву изображает звёздочка.' };
    }
    b[p.cell] = p.letter === JOKER ? { ch, joker: true } : { ch };
    cells.add(p.cell);
  }
  const list = [...cells].sort((a, b) => a - b);
  const rows = new Set(list.map((c) => rc(c)[0]));
  const cols = new Set(list.map((c) => rc(c)[1]));
  if (rows.size > 1 && cols.size > 1) return { ok: false, why: 'Фишки — в одну строку или в один столбец.' };
  const dir = list.length === 1 ? (wordAt(b, list[0], 1).length > 1 ? 1 : N) : rows.size === 1 ? 1 : N;
  const main = wordAt(b, list[0], dir);
  if (!list.every((c) => main.includes(c))) return { ok: false, why: 'Без пропусков: между фишками не должно быть пустых клеток.' };
  const empty = s.board.every((x) => !x);
  if (empty) {
    if (!cells.has(CENTER)) return { ok: false, why: 'Первое слово — через центральную клетку.' };
    if (main.length < 2) return { ok: false, why: 'Слово — хотя бы из двух букв.' };
  } else {
    const touches = main.some((c) => s.board[c]) || list.some((c) => wordAt(b, c, dir === 1 ? N : 1).length > 1);
    if (!touches) return { ok: false, why: 'Новое слово должно примыкать к уже выложенным.' };
  }
  if (take != null && !tiles.some((p) => p.letter === JOKER)) return { ok: false, why: 'Забранную звёздочку надо выложить этим же ходом.' };
  const words: { word: string; cells: number[] }[] = [];
  if (main.length > 1) words.push({ word: main.map((c) => b[c]!.ch).join(''), cells: main });
  for (const c of list) {
    const cross = wordAt(b, c, dir === 1 ? N : 1);
    if (cross.length > 1) words.push({ word: cross.map((x) => b[x]!.ch).join(''), cells: cross });
  }
  if (!words.length) return { ok: false, why: 'Слово — хотя бы из двух букв.' };
  for (const w of words) if (!hasWord(w.word)) return { ok: false, why: `«${w.word}» нет в словаре.` };
  let points = 0;
  for (const w of words) {
    let sum = 0;
    let mul = 1;
    for (const c of w.cells) {
      const t = b[c]!;
      let v = t.joker ? 0 : valueOf(s.cfg, t.ch);
      if (cells.has(c)) {
        const p = premiumOf(s.cfg, c);
        if (p === 'L2') v *= 2;
        else if (p === 'L3') v *= 3;
        else if (p === 'W2') mul *= 2;
        else if (p === 'W3') mul *= 3;
      }
      sum += v;
    }
    points += sum * mul;
  }
  const bonus = tiles.length === tileSet(s.cfg).rack;
  if (bonus) points += tileSet(s.cfg).bonus;
  return { ok: true, score: { words, points, bonus } };
}

const restValue = (s: State, i: number) => s.racks[i].reduce((a, ch) => a + valueOf(s.cfg, ch), 0);
const live = (s: State) => s.seats.map((_, i) => i).filter((i) => !s.resigned[i]);

function nextTurn(s: State) {
  for (let k = 1; k <= s.seats.length; k++) {
    const i = (s.cur + k) % s.seats.length;
    if (!s.resigned[i]) {
      s.cur = i;
      return;
    }
  }
}

function finish(s: State, events: Event[], outIdx: number | null) {
  s.over = true;
  s.out = outIdx;
  const rest = s.seats.map((_, i) => (s.resigned[i] ? 0 : restValue(s, i)));
  for (const i of live(s)) {
    s.scores[i] -= rest[i];
    if (outIdx != null && i !== outIdx) s.scores[outIdx] += rest[i];
  }
  events.push({ type: 'end', seat: outIdx == null ? null : s.seats[outIdx], rest });
}

function draw(s: State, i: number, events: Event[]) {
  const need = tileSet(s.cfg).rack - s.racks[i].length;
  const got = s.bag.splice(0, Math.max(0, need));
  s.racks[i].push(...got);
  if (got.length) events.push({ type: 'draw', seat: s.seats[i], count: got.length, letters: got });
}

/** Сколько ходов подряд без очков кончают партию: два круга. */
const idleLimit = (s: State) => 2 * live(s).length;

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || s0.seats[s0.cur] !== seat || !a) return null;
  const s = clone(s0);
  const i = s.cur;
  const events: Event[] = [];
  if (a.type === 'play') {
    const v = evaluate(s, a.tiles, s.racks[i], a.take);
    if (!v.ok) return null;
    if (a.take != null) {
      const t = s.board[a.take]!;
      s.racks[i].splice(s.racks[i].indexOf(t.ch), 1);
      s.racks[i].push(JOKER);
      s.board[a.take] = { ch: t.ch };
    }
    for (const p of a.tiles) {
      s.racks[i].splice(s.racks[i].indexOf(p.letter), 1);
      s.board[p.cell] = p.letter === JOKER ? { ch: norm(p.as!), joker: true } : { ch: p.letter };
    }
    s.scores[i] += v.score.points;
    s.idle = 0;
    s.moves++;
    s.last = { cells: a.tiles.map((p) => p.cell), words: v.score.words.map((w) => w.word), points: v.score.points };
    events.push({ type: 'play', seat, tiles: a.tiles.map((p) => ({ ...p })), words: v.score.words.map((w) => w.word), points: v.score.points, bonus: v.score.bonus, take: a.take });
    draw(s, i, events);
    if (s.cfg.target && s.scores[i] >= s.cfg.target) finish(s, events, null);
    else if (!s.racks[i].length) finish(s, events, i);
    else nextTurn(s);
  } else if (a.type === 'swap') {
    const left = s.racks[i].slice();
    if (!Array.isArray(a.letters) || !a.letters.length || s.bag.length < tileSet(s.cfg).rack) return null;
    for (const ch of a.letters) {
      const k = left.indexOf(ch);
      if (k < 0) return null;
      left.splice(k, 1);
    }
    s.racks[i] = left;
    const got = s.bag.splice(0, a.letters.length);
    s.racks[i].push(...got);
    s.bag.push(...a.letters);
    for (let k = s.bag.length - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      [s.bag[k], s.bag[j]] = [s.bag[j], s.bag[k]];
    }
    s.idle++;
    events.push({ type: 'swap', seat, count: a.letters.length, letters: got });
    if (s.idle >= idleLimit(s)) finish(s, events, null);
    else nextTurn(s);
  } else if (a.type === 'pass') {
    s.idle++;
    events.push({ type: 'pass', seat });
    if (s.idle >= idleLimit(s)) finish(s, events, null);
    else nextTurn(s);
  } else if (a.type === 'resign') {
    s.resigned[i] = true;
    events.push({ type: 'resign', seat });
    if (live(s).length <= 1) finish(s, events, null);
    else nextTurn(s);
  } else return null;
  return { state: s, events };
}

/** Победители — больше всех очков среди не сдавшихся. */
export function winners(s: State): number[] {
  const idx = live(s);
  const best = Math.max(...idx.map((i) => s.scores[i]));
  return idx.filter((i) => s.scores[i] === best).map((i) => s.seats[i]);
}

// ---------------------------------------------------------------- скрытая информация

export interface View extends State {
  counts: number[];
  bagCount: number;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (i: number) => seats === 'all' || seats.includes(s.seats[i]);
  const prev = s as Partial<View>;
  return {
    ...s,
    board: s.board.map((t) => (t ? { ...t } : null)),
    racks: s.racks.map((r, i) => (see(i) || s.over ? r.slice() : [])),
    counts: s.racks.map((r, i) => prev.counts?.[i] ?? r.length),
    bag: [],
    bagCount: prev.bagCount ?? s.bag.length,
  };
}

export function redact(ev: Event, seats: number[] | 'all'): Event {
  if ((ev.type === 'draw' || ev.type === 'swap') && seats !== 'all' && !seats.includes(ev.seat)) {
    const { letters: _l, ...rest } = ev;
    return rest as Event;
  }
  return ev;
}
