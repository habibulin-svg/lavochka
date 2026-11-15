/* Таврели — русские шахматы (пресет карточки «Шахматы»). Правила — Федерации таврелей (tavreli.com, раздел II), без DOM.
 *
 * Доска 8×8, индекс = горизонталь * 8 + вертикаль (a1 = 0), как в шахматах. На поле — БАШНЯ: стопка таврелей снизу вверх.
 * Таврели с доски не снимаются: ход на чужую башню берёт её в плен (ходящая встаёт сверху), на свою — просто строит башню.
 * Башней управляет хозяин верхней таврели и ходит по правилам верхней; её можно двинуть целиком или отделить верхнюю часть
 * (n верхних таврелей) — нижняя остаётся и сразу действует по правилам своей новой верхушки (так освобождаются пленные).
 * Волхв (король) в башне всегда наверху: на него ставить нельзя, а сам он может встать на любую башню не под боем.
 * Ратник превращается на последней горизонтали в ту таврель, перед которой стоял (перед волхвом — в хелги), если он наверху;
 * на превращённого поставили таврель — он снова ратник.
 */
import type { Rng } from '../../../core/types';
import type { Cfg, EndReason, MoveRec } from '../engine';

/** V — волхв, K — князь, R — ратоборец, B — лучник, N — всадник, H — хелги, P — ратник. */
export type Kind = 'V' | 'K' | 'R' | 'B' | 'N' | 'H' | 'P';

export interface Tav {
  c: 0 | 1;
  k: Kind;
  /** Ратник: в кого превращается (символ на нижней грани). */
  s?: Kind;
  /** Превращённый ратник (перевернётся обратно, если на него поставят таврель). */
  pr?: 1;
  /** Уже ходил (рокировка, двойной шаг ратника). */
  m?: 1;
}

export type Stack = Tav[];

export interface TMove {
  from: number;
  to: number;
  /** Сколько верхних таврелей идут (1..высота башни). */
  n: number;
  /** Ход на чужую башню — она в плену. */
  capture: boolean;
  /** Рокировка: откуда и куда ратоборец. */
  castle?: { rf: number; rt: number };
  /** Взятие на проходе: с какого поля снимается ратник. */
  ep?: number;
}

export interface TState {
  tav: true;
  cfg: Cfg;
  board: Stack[];
  turn: 0 | 1;
  /** Поле, через которое только что прошёл ратник двойным шагом, и где он встал (для взятия на проходе); -1 — нет. */
  ep: number;
  epAt: number;
  /** Полуходы без взятий и ходов ратником. */
  half: number;
  full: number;
  keys: string[];
  moves: MoveRec[];
  last: { from: number; to: number } | null;
  phase: 'play' | 'draw' | 'over';
  offer: number;
  winner: number | null;
  reason: EndReason | null;
  clock: [number, number];
  turnStart: number;
}

export type TEvent =
  | { type: 'tmove'; seat: number; move: TMove; san: string; check: boolean; num: number; promo: Kind | null }
  | { type: 'offer'; seat: number }
  | { type: 'decline'; seat: number }
  | { type: 'end'; winner: number | null; reason: EndReason };

export type TAction =
  | { type: 'move'; from: number; to: number; n?: number }
  | { type: 'resign' }
  | { type: 'offer' }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'flag' };

/** Ничья без взятий и ходов ратником — после стольких ходов (в правилах федерации нет; по образцу шахматного «75 ходов»). */
export const QUIET_MOVES = 75;

// ---------------------------------------------------------------- клетки

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const sqName = (sq: number) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
export const sq = (name: string) => 'abcdefgh'.indexOf(name[0]) + (Number(name[1]) - 1) * 8;

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function step(s: number, df: number, dr: number): number {
  const f = fileOf(s) + df;
  const r = rankOf(s) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

export const top = (st: Stack | undefined): Tav | undefined => (st && st.length ? st[st.length - 1] : undefined);
/** Чья башня (по верхней таврели), -1 — пусто. */
export const owner = (st: Stack): number => (st.length ? st[st.length - 1].c : -1);
const hasV = (st: Stack) => st.length > 0 && st[st.length - 1].k === 'V';
/** Последняя горизонталь для ратника стороны c. */
const lastRank = (c: number) => (c === 0 ? 7 : 0);

/** Куда бьёт (и ходит, кроме ратника) верхняя таврель вида k стороны c с поля from: лучи и прыжки. */
function rays(k: Kind): { lines: number[][]; jumps: number[][] } {
  switch (k) {
    case 'V':
      return { lines: [], jumps: KING };
    case 'K':
      return { lines: [...ORTHO, ...DIAG], jumps: [] };
    case 'R':
      return { lines: ORTHO, jumps: [] };
    case 'B':
      return { lines: DIAG, jumps: [] };
    case 'N':
      return { lines: [], jumps: KNIGHT };
    case 'H':
      return { lines: [...ORTHO, ...DIAG], jumps: KNIGHT };
    default:
      return { lines: [], jumps: [] };
  }
}
const RAYS = Object.fromEntries((['V', 'K', 'R', 'B', 'N', 'H', 'P'] as Kind[]).map((k) => [k, rays(k)])) as Record<Kind, { lines: number[][]; jumps: number[][] }>;

/** Бьёт ли сторона by поле t (верхушками своих башен). */
export function attacked(board: Stack[], t: number, by: number): boolean {
  // ратники
  const dr = by === 0 ? -1 : 1;
  for (const df of [-1, 1]) {
    const f = step(t, df, dr);
    if (f >= 0) {
      const p = top(board[f]);
      if (p && p.c === by && p.k === 'P') return true;
    }
  }
  for (const [df, d] of KNIGHT) {
    const f = step(t, df, d);
    if (f >= 0) {
      const p = top(board[f]);
      if (p && p.c === by && (p.k === 'N' || p.k === 'H')) return true;
    }
  }
  for (const [df, d] of KING) {
    const f = step(t, df, d);
    if (f >= 0) {
      const p = top(board[f]);
      if (p && p.c === by && p.k === 'V') return true;
    }
  }
  for (const [df, d] of ORTHO) {
    let f = step(t, df, d);
    while (f >= 0) {
      const p = top(board[f]);
      if (p) {
        if (p.c === by && (p.k === 'R' || p.k === 'K' || p.k === 'H')) return true;
        break;
      }
      f = step(f, df, d);
    }
  }
  for (const [df, d] of DIAG) {
    let f = step(t, df, d);
    while (f >= 0) {
      const p = top(board[f]);
      if (p) {
        if (p.c === by && (p.k === 'B' || p.k === 'K' || p.k === 'H')) return true;
        break;
      }
      f = step(f, df, d);
    }
  }
  return false;
}

export function volkhvSq(board: Stack[], c: number): number {
  for (let i = 0; i < 64; i++) {
    const st = board[i];
    // волхв всегда наверху своей башни
    if (st.length && st[st.length - 1].k === 'V' && st[st.length - 1].c === c) return i;
  }
  return -1;
}

export const inCheck = (s: Pick<TState, 'board' | 'turn'>, c: number = s.turn) => {
  const v = volkhvSq(s.board, c);
  return v >= 0 && attacked(s.board, v, 1 - c);
};

// ---------------------------------------------------------------- ходы

/** Можно ли верхушке стороны c встать на поле t: на чужого волхва и на свою башню с волхвом — нельзя. */
function canLand(st: Stack, c: number): boolean {
  return !hasV(st);
}

/** Ходы с поля from (все части башни). */
function movesFrom(s: TState, from: number, out: TMove[]) {
  const st = s.board[from];
  const p = top(st);
  if (!p || p.c !== s.turn) return;
  const c = p.c;
  const targets: { to: number; ep?: number }[] = [];
  if (p.k === 'P') {
    const dr = c === 0 ? 1 : -1;
    const one = step(from, 0, dr);
    if (one >= 0 && owner(s.board[one]) !== 1 - c && canLand(s.board[one], c)) targets.push({ to: one });
    // двойной шаг — пока ратник не ходил и стоит на своей второй горизонтали; через свои таврели можно
    if (one >= 0 && !p.m && rankOf(from) === (c === 0 ? 1 : 6) && owner(s.board[one]) !== 1 - c) {
      const two = step(one, 0, dr);
      if (two >= 0 && owner(s.board[two]) !== 1 - c && canLand(s.board[two], c)) targets.push({ to: two });
    }
    for (const df of [-1, 1]) {
      const t = step(from, df, dr);
      if (t < 0) continue;
      if (owner(s.board[t]) === 1 - c && !hasV(s.board[t])) targets.push({ to: t });
      else if (t === s.ep && !s.board[t].length) targets.push({ to: t, ep: s.epAt });
    }
  } else {
    const r = RAYS[p.k];
    for (const [df, dr] of r.jumps) {
      const t = step(from, df, dr);
      if (t >= 0 && canLand(s.board[t], c)) targets.push({ to: t });
    }
    for (const [df, dr] of r.lines) {
      let t = step(from, df, dr);
      while (t >= 0) {
        if (s.board[t].length) {
          if (canLand(s.board[t], c)) targets.push({ to: t });
          break;
        }
        targets.push({ to: t });
        t = step(t, df, dr);
      }
    }
  }
  const seen = new Set<number>();
  for (const t of targets) {
    if (seen.has(t.to)) continue; // хелги: луч и прыжок могут совпасть
    seen.add(t.to);
    const capture = t.ep != null || owner(s.board[t.to]) === 1 - c;
    for (let n = st.length; n >= 1; n--) out.push({ from, to: t.to, n, capture, ep: t.ep });
  }
  if (p.k === 'V' && !p.m && st.length === 1) castles(s, from, c, out);
}

function castles(s: TState, from: number, c: number, out: TMove[]) {
  const home = c === 0 ? 4 : 60;
  if (from !== home || attacked(s.board, from, 1 - c)) return;
  for (const [rookF, dir] of [[home + 3, 1], [home - 4, -1]] as const) {
    const rs = s.board[rookF];
    const rk = top(rs);
    if (!rk || rk.c !== c || rk.k !== 'R' || rk.m || rs.length !== 1) continue;
    let clear = true;
    for (let f = from + dir; f !== rookF; f += dir) if (s.board[f].length) clear = false;
    if (!clear) continue;
    if (attacked(s.board, from + dir, 1 - c) || attacked(s.board, from + 2 * dir, 1 - c)) continue;
    out.push({ from, to: from + 2 * dir, n: 1, capture: false, castle: { rf: rookF, rt: from + dir } });
  }
}

export function pseudoMoves(s: TState): TMove[] {
  const out: TMove[] = [];
  for (let i = 0; i < 64; i++) if (s.board[i].length) movesFrom(s, i, out);
  return out;
}

/** Ход без проверок: новая доска (меняются только задетые поля). */
export function playBoard(board: Stack[], m: TMove): { board: Stack[]; promo: Kind | null } {
  const b = board.slice();
  const src = b[m.from];
  const part = src.slice(src.length - m.n).map((t) => (t.m ? t : { ...t, m: 1 as const }));
  b[m.from] = src.slice(0, src.length - m.n);
  let under = b[m.to];
  if (m.ep != null) {
    const vs = b[m.ep];
    under = [...under, vs[vs.length - 1]];
    b[m.ep] = vs.slice(0, vs.length - 1);
  }
  // на превращённого ратника поставили таврель — он снова ратник
  if (under.some((t) => t.pr)) under = under.map((t) => (t.pr ? { c: t.c, k: 'P' as Kind, s: t.s, m: 1 as const } : t));
  if (m.castle) {
    const rook = b[m.castle.rf];
    b[m.castle.rf] = [];
    b[m.castle.rt] = rook.map((t) => ({ ...t, m: 1 as const }));
  }
  // волхв в башне всегда наверху: если он внизу ходящей части — поднимаем его
  let moving = part;
  const vi = moving.findIndex((t) => t.k === 'V');
  if (vi >= 0 && vi !== moving.length - 1) moving = [...moving.slice(0, vi), ...moving.slice(vi + 1), moving[vi]];
  b[m.to] = [...under, ...moving];
  let promo: Kind | null = null;
  for (const at of [m.to, m.from]) {
    const st = b[at];
    const p = top(st);
    if (p && p.k === 'P' && rankOf(at) === lastRank(p.c) && p.s) {
      b[at] = [...st.slice(0, -1), { ...p, k: p.s, pr: 1 }];
      if (at === m.to) promo = p.s;
    }
  }
  return { board: b, promo };
}

export function play(s: TState, m: TMove): TState & { promo: Kind | null } {
  const { board, promo } = playBoard(s.board, m);
  const piece = top(s.board[m.from])!;
  const double = piece.k === 'P' && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2;
  return {
    ...s,
    board,
    turn: (1 - s.turn) as 0 | 1,
    ep: double ? (m.from + m.to) / 2 : -1,
    epAt: double ? m.to : -1,
    half: m.capture || piece.k === 'P' ? 0 : s.half + 1,
    full: s.turn === 1 ? s.full + 1 : s.full,
    last: { from: m.from, to: m.to },
    promo,
  };
}

export function legalMoves(s: TState): TMove[] {
  const c = s.turn;
  return pseudoMoves(s).filter((m) => {
    const { board } = playBoard(s.board, m);
    const v = volkhvSq(board, c);
    return v >= 0 && !attacked(board, v, 1 - c);
  });
}

function anyLegal(s: TState): boolean {
  const c = s.turn;
  for (let i = 0; i < 64; i++) {
    if (owner(s.board[i]) !== c) continue;
    const out: TMove[] = [];
    movesFrom(s, i, out);
    for (const m of out) {
      const { board } = playBoard(s.board, m);
      const v = volkhvSq(board, c);
      if (v >= 0 && !attacked(board, v, 1 - c)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- начало партии

const BACK: Kind[] = ['R', 'N', 'B', 'K', 'V', 'B', 'N', 'R'];

export function newBoard(): Stack[] {
  const b: Stack[] = Array.from({ length: 64 }, () => []);
  for (let f = 0; f < 8; f++) {
    const k = BACK[f];
    const s = k === 'V' ? 'H' : k; // ратник перед волхвом — хелги
    b[f] = [{ c: 0, k }];
    b[8 + f] = [{ c: 0, k: 'P', s }];
    b[48 + f] = [{ c: 1, k: 'P', s }];
    b[56 + f] = [{ c: 1, k }];
  }
  return b;
}

export function newTGame(cfg: Cfg, now = 0): TState {
  const s: TState = {
    tav: true,
    cfg,
    board: newBoard(),
    turn: 0,
    ep: -1,
    epAt: -1,
    half: 0,
    full: 1,
    keys: [],
    moves: [],
    last: null,
    phase: 'play',
    offer: -1,
    winner: null,
    reason: null,
    clock: [cfg.clock * 60000, cfg.clock * 60000],
    turnStart: now,
  };
  s.keys = [posKey(s)];
  return s;
}

/** Позиция из списка: { a1: 'R', e8: 'v', d4: 'Pk' } — буквы снизу вверх, заглавная — белые; ратник с символом: 'P:H'. */
export function fromList(list: Record<string, string>, cfg: Cfg, turn: 0 | 1 = 0): TState {
  const s = newTGame(cfg);
  s.board = Array.from({ length: 64 }, () => []);
  for (const [name, code] of Object.entries(list)) {
    const st: Stack = [];
    for (const tok of code.split(' ')) {
      const [k, sym] = tok.split(':');
      const c = (k === k.toUpperCase() ? 0 : 1) as 0 | 1;
      const t: Tav = { c, k: k.toUpperCase() as Kind };
      if (t.k === 'P') t.s = (sym?.toUpperCase() as Kind) || 'K';
      st.push(t);
    }
    s.board[sq(name)] = st;
  }
  s.turn = turn;
  s.keys = [posKey(s)];
  return s;
}

const CODE: Record<Kind, string> = { V: 'v', K: 'k', R: 'r', B: 'b', N: 'n', H: 'h', P: 'p' };
export function posKey(s: TState): string {
  let k = '';
  for (const st of s.board) {
    for (const t of st) k += t.c ? CODE[t.k] : CODE[t.k].toUpperCase();
    k += '/';
  }
  return k + s.turn + s.ep;
}

// ---------------------------------------------------------------- запись

/** Русские буквы таврелей (у ратника — пусто). */
export const RU: Record<Kind, string> = { V: 'Вл', K: 'Кн', R: 'Р', B: 'Л', N: 'В', H: 'Х', P: '' };
export const NAME: Record<Kind, string> = { V: 'волхв', K: 'князь', R: 'ратоборец', B: 'лучник', N: 'всадник', H: 'хелги', P: 'ратник' };

/** Запись хода: Кнd1-d5, Р:a8 (взятие в плен), b2(2)-b4 — из башни отделились две верхние. */
export function san(s: TState, m: TMove, promo: Kind | null): string {
  if (m.castle) return fileOf(m.to) === 6 ? '0-0' : '0-0-0';
  const p = top(s.board[m.from])!;
  const h = s.board[m.from].length;
  let t = RU[p.k] + sqName(m.from);
  if (h > 1 && m.n < h) t += `(${m.n})`;
  t += m.capture ? ':' : '-';
  t += sqName(m.to);
  if (promo) t += '=' + RU[promo];
  return t;
}

// ---------------------------------------------------------------- партия

export function toAct(s: TState): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'draw') return [1 - s.offer];
  return [s.turn];
}

function finish(s: TState, winner: number | null, reason: EndReason, ev: TEvent[]) {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

function spent(s: TState, now: number) {
  const e = now - s.turnStart;
  return e < 0 || e > 30 * 60000 ? 0 : e;
}

/** Найти ход по действию: n не указан — вся башня. */
export function findMove(all: TMove[], s: TState, a: { from: number; to: number; n?: number }): TMove | undefined {
  const n = a.n ?? s.board[a.from]?.length ?? 1;
  return all.find((m) => m.from === a.from && m.to === a.to && m.n === n);
}

export function applyT(s0: TState, seat: number, a: TAction, now: number = Date.now()): { state: TState; events: TEvent[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: TEvent[] = [];
  const timed = s0.cfg.clock > 0;
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
    case 'flag': {
      if (!timed || spent(s0, now) < s0.clock[seat]) return null;
      const s = { ...s0, clock: [...s0.clock] as [number, number] };
      s.clock[seat] = 0;
      finish(s, 1 - seat, 'time', ev);
      return { state: s, events: ev };
    }
    case 'move': {
      if (typeof a.from !== 'number' || typeof a.to !== 'number') return null;
      const all = legalMoves(s0);
      const m = findMove(all, s0, a);
      if (!m) return null;
      const clock = [...s0.clock] as [number, number];
      if (timed) {
        clock[seat] -= spent(s0, now);
        if (clock[seat] <= 0) {
          const s = { ...s0, clock };
          clock[seat] = 0;
          finish(s, 1 - seat, 'time', ev);
          return { state: s, events: ev };
        }
        clock[seat] += s0.cfg.inc * 1000;
      }
      const { promo, ...s } = play(s0, m);
      s.clock = clock;
      s.turnStart = now;
      s.offer = -1;
      const check = inCheck(s);
      const replies = anyLegal(s);
      const name = san(s0, m, promo) + (check && !replies ? '#' : check ? '+' : '');
      s.moves = [...s0.moves, { san: name, from: m.from, to: m.to, seat }];
      const key = posKey(s);
      s.keys = s.half === 0 ? [key] : [...s0.keys, key];
      ev.push({ type: 'tmove', seat, move: m, san: name, check, num: s0.full, promo });
      if (!replies) finish(s, check ? seat : null, check ? 'mate' : 'stalemate', ev);
      else if (s.keys.filter((k) => k === key).length >= 3) finish(s, null, 'repetition', ev);
      else if (s.half >= QUIET_MOVES * 2) finish(s, null, 'quiet', ev);
      return { state: s, events: ev };
    }
    default:
      return null;
  }
}

/** Для тестов и ботов: случайный законный ход. */
export function randomMove(s: TState, rng: Rng): TMove | null {
  const all = legalMoves(s);
  return all.length ? all[rng.int(all.length)] : null;
}
