/* Шашки — правила (без DOM): русские, международные (10×10), бразильские; поддавки на любой доске; «фук» по-дворовому.
 *
 * Доска n×n, индекс = ряд * n + вертикаль (a1 = 0, ряд 0 — со стороны белых). Играют только тёмные поля: (ряд + вертикаль) чётно.
 * Шашки: 'w' / 'W' — белая простая / дамка, 'b' / 'B' — чёрная. Место 0 — белые (ходят первыми), 1 — чёрные.
 * Взятие «турецким ударом»: побитые шашки снимаются после хода, а до того мешают и второй раз их не бьют.
 */
import type { Options } from '../../core/types';

export type Variant = 'russian' | 'international' | 'brazil';

export interface Cfg {
  variant: Variant;
  /** Поддавки: выигрывает тот, кто первым остался без ходов. */
  giveaway: boolean;
  /** Бить не обязательно, но за пропущенное взятие соперник может «взять за фук» шашку, которая должна была бить. */
  fuk: boolean;
}

export const DEFAULT_CFG: Cfg = { variant: 'russian', giveaway: false, fuk: false };

export function cfgFrom(o: Options): Cfg {
  const v = String(o.variant);
  return {
    variant: v === 'international' || v === 'brazil' ? v : 'russian',
    giveaway: !!o.giveaway,
    fuk: !!o.fuk,
  };
}

interface Rules {
  n: number;
  /** Рядов шашек у каждого в начале. */
  rows: number;
  /** Бить наибольшее число шашек. */
  maxCapture: boolean;
  /** Простая, дошедшая до последнего ряда во время боя, сразу становится дамкой и бьёт дальше как дамка. */
  promoteMid: boolean;
  /** Ничья, если столько полуходов подряд у обоих есть дамки и никто не бил и не ходил простой. */
  kingsLimit: number;
}

export const RULES: Record<Variant, Rules> = {
  russian: { n: 8, rows: 3, maxCapture: false, promoteMid: true, kingsLimit: 30 },
  international: { n: 10, rows: 4, maxCapture: true, promoteMid: false, kingsLimit: 50 },
  brazil: { n: 8, rows: 3, maxCapture: true, promoteMid: false, kingsLimit: 50 },
};

export interface Move {
  from: number;
  /** Поля, на которые встаёт шашка по ходу (последнее — куда пришла). */
  path: number[];
  /** Побитые шашки по порядку. */
  caps: number[];
  /** Шашка стала дамкой. */
  promo: boolean;
}

export interface MoveRec {
  text: string;
  seat: number;
}

export type EndReason = 'nomoves' | 'resign' | 'repetition' | 'kings' | 'endgame' | 'agreed';

export interface State {
  cfg: Cfg;
  n: number;
  board: string[];
  turn: 0 | 1;
  moves: MoveRec[];
  last: { from: number; path: number[]; caps: number[] } | null;
  /** Ключи позиций — для троекратного повторения. */
  keys: string[];
  /** Полуходы без взятий и ходов простыми, пока у обоих есть дамки. */
  kq: number;
  /** Полуходы в окончании «одинокая дамка против трёх и меньше» (международные). */
  eg: number;
  phase: 'play' | 'draw' | 'over';
  offer: number;
  winner: number | null;
  reason: EndReason | null;
  /** Сколько шашек побил каждый. */
  taken: [number, number];
  /** Шашки соперника, которые ходящий может взять за фук (соперник не побил, хотя был обязан). */
  fuk: number[];
}

export type Action =
  | { type: 'move'; path: number[]; from: number }
  | { type: 'fuk'; sq: number }
  | { type: 'resign' }
  | { type: 'offer' }
  | { type: 'accept' }
  | { type: 'decline' };

export type Event =
  | { type: 'start'; variant: Variant; giveaway: boolean }
  | { type: 'move'; seat: number; move: Move; text: string; num: number; missed: boolean }
  | { type: 'fuk'; seat: number; sq: number; name: string }
  | { type: 'offer'; seat: number }
  | { type: 'decline'; seat: number }
  | { type: 'end'; winner: number | null; reason: EndReason };

// ---------------------------------------------------------------- клетки

export const colorOf = (p: string): 0 | 1 => (p === 'w' || p === 'W' ? 0 : 1);
export const isKing = (p: string) => p === 'W' || p === 'B';
const own = (p: string, c: number) => p !== '' && colorOf(p) === c;
const DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Имя поля: в 8×8 — «c3», в 10×10 — номер 1…50 (1 — в левом верхнем углу со стороны чёрных). */
export function sqName(n: number, sq: number): string {
  const r = Math.floor(sq / n);
  const f = sq % n;
  if (n === 8) return 'abcdefgh'[f] + (r + 1);
  return String((n - 1 - r) * (n / 2) + Math.floor(f / 2) + 1);
}

/** Поле по буквенной записи «c3» (и для 10×10: a1…j10) — для тестов и показа правил. */
export function sqOf(n: number, name: string): number {
  return (+name.slice(1) - 1) * n + 'abcdefghij'.indexOf(name[0]);
}

export const dark = (n: number, sq: number) => (Math.floor(sq / n) + (sq % n)) % 2 === 0;

function step(n: number, sq: number, dr: number, df: number): number {
  const r = Math.floor(sq / n) + dr;
  const f = (sq % n) + df;
  return r < 0 || r >= n || f < 0 || f >= n ? -1 : r * n + f;
}

const lastRow = (n: number, c: number, sq: number) => Math.floor(sq / n) === (c === 0 ? n - 1 : 0);

// ---------------------------------------------------------------- расстановка

export function newGame(cfg: Cfg): State {
  const { n, rows } = RULES[cfg.variant];
  const board = Array<string>(n * n).fill('');
  for (let sq = 0; sq < n * n; sq++) {
    if (!dark(n, sq)) continue;
    const r = Math.floor(sq / n);
    if (r < rows) board[sq] = 'w';
    else if (r >= n - rows) board[sq] = 'b';
  }
  return fromBoard(cfg, board, 0);
}

export function fromBoard(cfg: Cfg, board: string[], turn: 0 | 1): State {
  const s: State = {
    cfg,
    n: RULES[cfg.variant].n,
    board,
    turn,
    moves: [],
    last: null,
    keys: [],
    kq: 0,
    eg: 0,
    phase: 'play',
    offer: -1,
    winner: null,
    reason: null,
    taken: [0, 0],
    fuk: [],
  };
  s.keys = [posKey(s)];
  return s;
}

/** Позиция по списку полей: fromList(cfg, { w: ['c3'], W: ['d8'], b: ['f6'] }, 0). */
export function fromList(cfg: Cfg, pcs: Partial<Record<'w' | 'W' | 'b' | 'B', string[]>>, turn: 0 | 1 = 0): State {
  const n = RULES[cfg.variant].n;
  const board = Array<string>(n * n).fill('');
  for (const [p, list] of Object.entries(pcs)) for (const name of list || []) board[sqOf(n, name)] = p;
  return fromBoard(cfg, board, turn);
}

export const posKey = (s: Pick<State, 'board' | 'turn'>) => s.board.map((p) => p || '.').join('') + s.turn;

// ---------------------------------------------------------------- ходы

/** Все серии взятий шашкой с поля from. */
function capturesFrom(b: string[], n: number, from: number, rules: Rules, out: Move[]) {
  const p = b[from];
  const c = colorOf(p);
  // на время хода поле, с которого ушли, свободно
  const work = b.slice();
  work[from] = '';
  const caps: number[] = [];
  const path: number[] = [];

  /** Можно ли продолжить бой с поля sq (без записи ходов). */
  const canCapture = (sq: number, king: boolean): boolean => {
    for (const [dr, df] of DIRS) {
      if (king) {
        let t = step(n, sq, dr, df);
        while (t >= 0 && work[t] === '') t = step(n, t, dr, df);
        if (t < 0 || !own(work[t], 1 - c) || caps.includes(t)) continue;
        const land = step(n, t, dr, df);
        if (land >= 0 && work[land] === '') return true;
      } else {
        const mid = step(n, sq, dr, df);
        if (mid < 0 || !own(work[mid], 1 - c) || caps.includes(mid)) continue;
        const land = step(n, mid, dr, df);
        if (land >= 0 && work[land] === '') return true;
      }
    }
    return false;
  };

  const dfs = (sq: number, king: boolean) => {
    let any = false;
    for (const [dr, df] of DIRS) {
      let victim = -1;
      if (king) {
        let t = step(n, sq, dr, df);
        while (t >= 0 && work[t] === '') t = step(n, t, dr, df);
        if (t >= 0 && own(work[t], 1 - c) && !caps.includes(t)) victim = t;
      } else {
        const mid = step(n, sq, dr, df);
        if (mid >= 0 && own(work[mid], 1 - c) && !caps.includes(mid)) victim = mid;
      }
      if (victim < 0) continue;
      const lands: number[] = [];
      let t = step(n, victim, dr, df);
      while (t >= 0 && work[t] === '') {
        lands.push(t);
        if (!king) break;
        t = step(n, t, dr, df);
      }
      if (!lands.length) continue;
      caps.push(victim);
      // дамка обязана встать туда, откуда бой продолжается (если такое поле есть)
      const next = lands.map((l) => ({ l, k: king || (rules.promoteMid && lastRow(n, c, l)) }));
      const cont = next.filter((x) => canCapture(x.l, x.k));
      for (const x of cont.length ? cont : next) {
        any = true;
        path.push(x.l);
        if (cont.length) dfs(x.l, x.k);
        else out.push({ from, path: path.slice(), caps: caps.slice(), promo: !isKing(p) && (x.k || lastRow(n, c, x.l)) });
        path.pop();
      }
      caps.pop();
    }
    return any;
  };
  dfs(from, isKing(p));
}

function quietFrom(b: string[], n: number, from: number, out: Move[]) {
  const p = b[from];
  const c = colorOf(p);
  if (isKing(p)) {
    for (const [dr, df] of DIRS) {
      let t = step(n, from, dr, df);
      while (t >= 0 && b[t] === '') {
        out.push({ from, path: [t], caps: [], promo: false });
        t = step(n, t, dr, df);
      }
    }
    return;
  }
  const dr = c === 0 ? 1 : -1;
  for (const df of [-1, 1]) {
    const t = step(n, from, dr, df);
    if (t >= 0 && b[t] === '') out.push({ from, path: [t], caps: [], promo: lastRow(n, c, t) });
  }
}

/** Ходы по правилам: бить обязательно (в международных и бразильских — больше всех). */
export function properMoves(s: Pick<State, 'board' | 'turn' | 'cfg' | 'n'>): Move[] {
  const rules = RULES[s.cfg.variant];
  const caps: Move[] = [];
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) capturesFrom(s.board, s.n, sq, rules, caps);
  if (caps.length) {
    if (!rules.maxCapture) return caps;
    const max = Math.max(...caps.map((m) => m.caps.length));
    return caps.filter((m) => m.caps.length === max);
  }
  const out: Move[] = [];
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) quietFrom(s.board, s.n, sq, out);
  return out;
}

/** Все допустимые ходы. С «фуком» можно и не бить — но тогда соперник возьмёт шашку за фук. */
export function legalMoves(s: Pick<State, 'board' | 'turn' | 'cfg' | 'n'>): Move[] {
  const proper = properMoves(s);
  if (!s.cfg.fuk || !proper.length || !proper[0].caps.length) return proper;
  const rules = RULES[s.cfg.variant];
  const out: Move[] = [];
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) capturesFrom(s.board, s.n, sq, rules, out);
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) quietFrom(s.board, s.n, sq, out);
  return out;
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Сделать ход на доске (без проверки правил), счётчики ничьей — тоже. */
export function play(s: State, m: Move): State {
  const b = s.board.slice();
  const p = b[m.from];
  b[m.from] = '';
  for (const c of m.caps) b[c] = '';
  const to = m.path[m.path.length - 1];
  b[to] = m.promo ? p.toUpperCase() : p;
  const turn = (1 - s.turn) as 0 | 1;
  const kings = (c: number) => b.some((x) => own(x, c) && isKing(x));
  const reset = m.caps.length > 0 || !isKing(p);
  const kq = kings(0) && kings(1) && !reset ? s.kq + 1 : 0;
  const n: State = { ...s, board: b, turn, kq, last: { from: m.from, path: m.path, caps: m.caps }, fuk: [] };
  n.eg = endgameLimit(n) && !reset ? s.eg + 1 : 0;
  return n;
}

/** Международные: одинокая дамка против дамки и ещё не больше двух шашек — 16 ходов (против двух — 5), иначе ничья. */
function endgameLimit(s: State): number {
  if (s.cfg.variant !== 'international') return 0;
  const cnt = (c: number) => s.board.filter((x) => own(x, c)).length;
  const kings = (c: number) => s.board.filter((x) => own(x, c) && isKing(x)).length;
  for (const c of [0, 1]) {
    const o = 1 - c;
    if (cnt(c) === 1 && kings(c) === 1 && kings(o) >= 1) {
      if (cnt(o) <= 2) return 10;
      if (cnt(o) <= 3) return 32;
    }
  }
  return 0;
}

export function moveText(n: number, m: Move): string {
  const sep = m.caps.length ? (n === 8 ? ':' : '×') : '-';
  return [m.from, ...m.path].map((x) => sqName(n, x)).join(sep);
}

// ---------------------------------------------------------------- партия

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : s.phase === 'draw' ? [1 - s.offer] : [s.turn]);

function finish(s: State, winner: number | null, reason: EndReason, ev: Event[]) {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

/** Ходящий без ходов (нет шашек или все заперты): проиграл, а в поддавках — выиграл. */
function checkStuck(s: State, ev: Event[]): boolean {
  if (legalMoves(s).length) return false;
  finish(s, s.cfg.giveaway ? s.turn : 1 - s.turn, 'nomoves', ev);
  return true;
}

export function setup(opts: Options): { state: State; events: Event[] } {
  const cfg = cfgFrom(opts);
  return { state: newGame(cfg), events: [{ type: 'start', variant: cfg.variant, giveaway: cfg.giveaway }] };
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  if (s0.phase === 'draw') {
    if (a.type === 'accept') {
      const s = { ...s0 };
      finish(s, null, 'agreed', ev);
      return { state: s, events: ev };
    }
    if (a.type === 'decline') {
      ev.push({ type: 'decline', seat });
      return { state: { ...s0, phase: 'play', offer: -1 }, events: ev };
    }
    return null;
  }
  switch (a.type) {
    case 'resign': {
      const s = { ...s0 };
      finish(s, 1 - seat, 'resign', ev);
      return { state: s, events: ev };
    }
    case 'offer': {
      if (s0.moves.length < 2) return null;
      ev.push({ type: 'offer', seat });
      return { state: { ...s0, phase: 'draw', offer: seat }, events: ev };
    }
    case 'fuk': {
      if (!s0.fuk.includes(a.sq)) return null;
      const b = s0.board.slice();
      b[a.sq] = '';
      const s: State = { ...s0, board: b, fuk: [], taken: [...s0.taken] as [number, number], kq: 0, eg: 0 };
      s.taken[seat]++;
      ev.push({ type: 'fuk', seat, sq: a.sq, name: sqName(s.n, a.sq) });
      s.keys = [...s0.keys, posKey(s)];
      // взяли за фук последнюю шашку
      if (!b.some((x) => own(x, 1 - seat))) finish(s, s.cfg.giveaway ? 1 - seat : seat, 'nomoves', ev);
      else checkStuck(s, ev);
      return { state: s, events: ev };
    }
    case 'move': {
      if (!Array.isArray(a.path)) return null;
      const m = legalMoves(s0).find((x) => x.from === a.from && samePath(x.path, a.path));
      if (!m) return null;
      const proper = s0.cfg.fuk ? properMoves(s0) : [];
      const missed = s0.cfg.fuk && proper.length > 0 && proper[0].caps.length > 0 && !proper.some((x) => x.from === m.from && samePath(x.path, m.path));
      const text = moveText(s0.n, m);
      const s = play(s0, m);
      s.offer = -1;
      s.taken = [...s0.taken] as [number, number];
      s.taken[seat] += m.caps.length;
      s.moves = [...s0.moves, { text, seat }];
      if (missed) {
        // за фук — любая шашка, которая должна была бить (сходившая — на новом месте)
        const to = m.path[m.path.length - 1];
        s.fuk = [...new Set(proper.map((x) => (x.from === m.from ? to : x.from)))];
      }
      ev.push({ type: 'move', seat, move: m, text, num: Math.floor(s0.moves.length / 2) + 1, missed });
      const key = posKey(s);
      s.keys = [...s0.keys, key];
      if (checkStuck(s, ev)) return { state: s, events: ev };
      if (s.keys.filter((k) => k === key).length >= 3) finish(s, null, 'repetition', ev);
      else if (s.kq >= RULES[s.cfg.variant].kingsLimit) finish(s, null, 'kings', ev);
      else if (s.eg && s.eg >= endgameLimit(s)) finish(s, null, 'endgame', ev);
      return { state: s, events: ev };
    }
  }
  return null;
}
