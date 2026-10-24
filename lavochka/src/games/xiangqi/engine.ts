/* Сянци (китайские шахматы) — правила, без DOM. Пресеты: сянци, ко-туонг (вьетнамские подписи), ко-уп (закрытые фигуры).
 *
 * Доска — 9 вертикалей × 10 горизонталей точек: p = r * 9 + f, r = 0 — ряд красных (внизу), r = 9 — чёрных.
 * Фигуры — буквы: K генерал, A советник, E слон, H конь, R колесница, C пушка, P солдат; заглавные — красные (место 0), строчные — чёрные (1).
 * Ко-уп: кроме генералов, все фигуры стоят рубашкой вверх, перемешанные по своим местам. Закрытая фигура ходит как фигура
 * своего начального места и после хода открывается; открытые советник и слон ходят по всей доске (без дворца и реки).
 * Закрытых фигур не знает никто — в view они '?' (красная) и '¿' (чёрная). */
import type { Options, Rng } from '../../core/types';

export const FILES = 9;
export const RANKS = 10;
export const N = FILES * RANKS;
export type Mode = 'xiangqi' | 'kotuong' | 'up';
export type Labels = 'hanzi' | 'ru' | 'vi';

export interface Cfg {
  mode: Mode;
  labels: Labels;
}
export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'kotuong' || o.mode === 'up' ? o.mode : 'xiangqi';
  const labels: Labels = o.labels === 'ru' || o.labels === 'vi' ? o.labels : mode === 'kotuong' ? 'vi' : 'hanzi';
  return { mode, labels };
}

export interface Move {
  from: number;
  to: number;
}
export interface MoveRec extends Move {
  seat: number;
  text: string;
}

export type EndReason = 'mate' | 'stalemate' | 'perpetual' | 'repetition' | 'quiet' | 'material' | 'resign';

export interface State {
  cfg: Cfg;
  /** Буква фигуры или ''. Для закрытой фигуры в state — настоящая буква, в view — '?'/'¿'. */
  board: string[];
  /** Закрыта ли фигура (ко-уп). */
  hidden: boolean[];
  turn: 0 | 1;
  moves: MoveRec[];
  keys: string[];
  /** Полуходов без взятий. */
  quiet: number;
  /** Сколько ходов подряд сторона объявляет шах. */
  checks: [number, number];
  /** Взятые фигуры (буквы): captured[0] — взятые красными. */
  captured: [string[], string[]];
  last: Move | null;
  over: boolean;
  winner: number | null;
  reason: EndReason | null;
}
export type View = State;

export type Action = { type: 'move'; from: number; to: number } | { type: 'resign' };
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; piece: string; captured: string; revealed?: string; check: boolean; text: string }
  | { type: 'end'; winner: number | null; reason: EndReason };

// ---------------------------------------------------------------- клетки

export const fileOf = (p: number) => p % FILES;
export const rankOf = (p: number) => Math.floor(p / FILES);
export const at = (f: number, r: number) => (f < 0 || f >= FILES || r < 0 || r >= RANKS ? -1 : r * FILES + f);
export const colorOf = (pc: string): 0 | 1 => (pc === '?' || (pc !== '¿' && pc === pc.toUpperCase()) ? 0 : 1);
const kindOf = (pc: string) => pc.toUpperCase();
const side = (c: number, k: string) => (c === 0 ? k : k.toLowerCase());
export const HIDDEN = ['?', '¿'];

/** Начальная расстановка, нижний (красный) ряд и пушки/солдаты. */
const BACK = 'RHEAKAEHR';
export function startBoard(): string[] {
  const b = new Array(N).fill('');
  for (let f = 0; f < FILES; f++) {
    b[at(f, 0)] = BACK[f];
    b[at(f, 9)] = BACK[f].toLowerCase();
  }
  for (const f of [1, 7]) {
    b[at(f, 2)] = 'C';
    b[at(f, 7)] = 'c';
  }
  for (const f of [0, 2, 4, 6, 8]) {
    b[at(f, 3)] = 'P';
    b[at(f, 6)] = 'p';
  }
  return b;
}
/** Чья роль у начального места (для закрытых фигур ко-уп): буква фигуры, которая стоит там в обычной расстановке. */
const ROLE = startBoard().map((x) => (x ? kindOf(x) : ''));

const inPalace = (p: number, c: number) => {
  const f = fileOf(p);
  const r = rankOf(p);
  return f >= 3 && f <= 5 && (c === 0 ? r <= 2 : r >= 7);
};
const ownHalf = (p: number, c: number) => (c === 0 ? rankOf(p) <= 4 : rankOf(p) >= 5);

const ORTHO = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const DIAG = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Позиция для генератора ходов: доска, закрытые, режим. */
export interface Pos {
  board: string[];
  hidden: boolean[];
  mode: Mode;
  turn: 0 | 1;
}

/** Как ходит фигура на p: буква фигуры (у закрытой — роль её начального места) и «свободна ли» (открытая в ко-уп). */
function moverKind(pos: Pos, p: number): { k: string; free: boolean } {
  if (pos.hidden[p]) return { k: ROLE[p], free: false };
  return { k: kindOf(pos.board[p]), free: pos.mode === 'up' };
}

/** Псевдоходы стороны c (без проверки своего генерала). */
export function pseudo(pos: Pos, c: number, out: Move[] = []): Move[] {
  const b = pos.board;
  const mine = (q: number) => b[q] !== '' && colorOf(b[q]) === c;
  for (let p = 0; p < N; p++) {
    if (!mine(p)) continue;
    const { k, free } = moverKind(pos, p);
    const f = fileOf(p);
    const r = rankOf(p);
    const add = (q: number) => {
      if (q >= 0 && !mine(q)) out.push({ from: p, to: q });
    };
    switch (k) {
      case 'K':
        for (const [df, dr] of ORTHO) {
          const q = at(f + df, r + dr);
          if (q >= 0 && inPalace(q, c)) add(q);
        }
        break;
      case 'A':
        for (const [df, dr] of DIAG) {
          const q = at(f + df, r + dr);
          if (q >= 0 && (free || inPalace(q, c))) add(q);
        }
        break;
      case 'E':
        for (const [df, dr] of DIAG) {
          const eye = at(f + df, r + dr);
          const q = at(f + 2 * df, r + 2 * dr);
          if (q >= 0 && b[eye] === '' && (free || ownHalf(q, c))) add(q);
        }
        break;
      case 'H':
        for (const [df, dr] of ORTHO) {
          const leg = at(f + df, r + dr);
          if (leg < 0 || b[leg] !== '') continue;
          for (const s of [-1, 1]) add(dr === 0 ? at(f + 2 * df, r + s) : at(f + s, r + 2 * dr));
        }
        break;
      case 'R':
      case 'C':
        for (const [df, dr] of ORTHO) {
          let q = at(f + df, r + dr);
          let screen = false;
          while (q >= 0) {
            if (!screen) {
              if (b[q] === '') out.push({ from: p, to: q });
              else {
                if (k === 'R') {
                  add(q);
                  break;
                }
                screen = true;
              }
            } else if (b[q] !== '') {
              add(q);
              break;
            }
            q = at(fileOf(q) + df, rankOf(q) + dr);
          }
        }
        break;
      case 'P': {
        const dir = c === 0 ? 1 : -1;
        add(at(f, r + dir));
        if (!ownHalf(p, c)) {
          add(at(f - 1, r));
          add(at(f + 1, r));
        }
        break;
      }
    }
  }
  return out;
}

export function generalSq(b: string[], c: number): number {
  return b.indexOf(side(c, 'K'));
}

/** Под ударом ли генерал стороны c (в т. ч. «генералы смотрят друг на друга»). */
export function inCheck(pos: Pos, c: number): boolean {
  const g = generalSq(pos.board, c);
  if (g < 0) return true;
  const o = generalSq(pos.board, 1 - c);
  if (o >= 0 && fileOf(o) === fileOf(g)) {
    let clear = true;
    const step = o > g ? FILES : -FILES;
    for (let q = g + step; q !== o; q += step) if (pos.board[q] !== '') clear = false;
    if (clear) return true;
  }
  return pseudo(pos, 1 - c).some((m) => m.to === g);
}

/** Сделать ход (без проверок). Закрытая фигура открывается. */
export function playPos(pos: Pos, m: Move): Pos {
  const board = pos.board.slice();
  const hidden = pos.hidden.slice();
  board[m.to] = board[m.from];
  board[m.from] = '';
  hidden[m.to] = false;
  hidden[m.from] = false;
  return { board, hidden, mode: pos.mode, turn: (1 - pos.turn) as 0 | 1 };
}

export function legalPos(pos: Pos): Move[] {
  const c = pos.turn;
  return pseudo(pos, c).filter((m) => !inCheck(playPos(pos, m), c));
}

const posOf = (s: State): Pos => ({ board: s.board, hidden: s.hidden, mode: s.cfg.mode, turn: s.turn });
export const legal = (s: State) => (s.over ? [] : legalPos(posOf(s)));

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg): State {
  const board = startBoard();
  const s: State = {
    cfg,
    board,
    hidden: new Array(N).fill(false),
    turn: 0,
    moves: [],
    keys: [],
    quiet: 0,
    checks: [0, 0],
    captured: [[], []],
    last: null,
    over: false,
    winner: null,
    reason: null,
  };
  s.keys = [key(s)];
  return s;
}

export function setup(opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts));
  if (s.cfg.mode === 'up') {
    // перемешать фигуры каждой стороны по их местам (кроме генерала) и закрыть
    for (const c of [0, 1]) {
      const spots = s.board.map((x, p) => (x && colorOf(x) === c && kindOf(x) !== 'K' ? p : -1)).filter((p) => p >= 0);
      const pcs = spots.map((p) => s.board[p]);
      for (let i = pcs.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [pcs[i], pcs[j]] = [pcs[j], pcs[i]];
      }
      spots.forEach((p, i) => {
        s.board[p] = pcs[i];
        s.hidden[p] = true;
      });
    }
    s.keys = [key(s)];
  }
  return s;
}

export const key = (s: { board: string[]; hidden: boolean[]; turn: number }) => s.board.map((x, p) => (s.hidden[p] ? '#' : x || '.')).join('') + s.turn;

export const toAct = (s: State) => (s.over ? [] : [s.turn]);

const FILE_RU = 'abcdefghi';
export const ptName = (p: number) => FILE_RU[fileOf(p)] + (rankOf(p) + 1);

function finish(s: State, winner: number | null, reason: EndReason, ev: Event[]) {
  s.over = true;
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

const ATTACK = 'RHCP';

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const ev: Event[] = [];
  if (a.type === 'resign') {
    const s = { ...s0 };
    finish(s, 1 - seat, 'resign', ev);
    return { state: s, events: ev };
  }
  if (a.type !== 'move') return null;
  const pos = posOf(s0);
  const all = legalPos(pos);
  const m = all.find((x) => x.from === a.from && x.to === a.to);
  if (!m) return null;
  const piece = s0.board[m.from];
  const wasHidden = s0.hidden[m.from];
  const captured = s0.board[m.to];
  const n = playPos(pos, m);
  const s: State = {
    ...s0,
    board: n.board,
    hidden: n.hidden,
    turn: n.turn,
    quiet: captured ? 0 : s0.quiet + 1,
    captured: [s0.captured[0].slice(), s0.captured[1].slice()],
    last: { from: m.from, to: m.to },
    checks: [s0.checks[0], s0.checks[1]],
  };
  if (captured) s.captured[seat].push(captured);
  const check = inCheck(n, 1 - seat);
  s.checks[seat] = check ? s0.checks[seat] + 1 : 0;
  const text = `${ptName(m.from)}${captured ? ':' : '-'}${ptName(m.to)}${check ? '+' : ''}`;
  s.moves = [...s0.moves, { from: m.from, to: m.to, seat, text }];
  const k = key(s);
  s.keys = captured ? [k] : [...s0.keys, k];
  ev.push({ type: 'move', seat, from: m.from, to: m.to, piece, captured, revealed: wasHidden ? piece : undefined, check, text });
  const replies = legalPos(n);
  if (!replies.length) finish(s, seat, check ? 'mate' : 'stalemate', ev);
  else if (s.keys.filter((x) => x === k).length >= 3) {
    // повторение: если повторяющий всё время шахует — вечный шах, он проигрывает; иначе ничья
    if (s.checks[seat] >= 3) finish(s, 1 - seat, 'perpetual', ev);
    else finish(s, null, 'repetition', ev);
  } else if (s.quiet >= 120) finish(s, null, 'quiet', ev);
  else if (!s.board.some((x, p) => x && (s.hidden[p] || ATTACK.includes(kindOf(x))))) finish(s, null, 'material', ev);
  return { state: s, events: ev };
}

/** View: закрытые фигуры не знает никто. */
export function makeView(s: State): View {
  if (!s.hidden.some(Boolean)) return s;
  return { ...s, board: s.board.map((x, p) => (s.hidden[p] ? HIDDEN[colorOf(x)] : x)) };
}

/** Какие фигуры стороны c ещё закрыты (по составу: всё, кроме открытых и взятых). */
export function hiddenPool(v: View, c: number): string[] {
  const pool: Record<string, number> = { A: 2, E: 2, H: 2, R: 2, C: 2, P: 5 };
  for (let p = 0; p < N; p++) {
    const x = v.board[p];
    if (x && !v.hidden[p] && colorOf(x) === c && kindOf(x) !== 'K') pool[kindOf(x)]--;
  }
  for (const x of v.captured[1 - c]) if (colorOf(x) === c && !HIDDEN.includes(x)) pool[kindOf(x)]--;
  const out: string[] = [];
  for (const [k, n] of Object.entries(pool)) for (let i = 0; i < n; i++) out.push(side(c, k));
  return out;
}
