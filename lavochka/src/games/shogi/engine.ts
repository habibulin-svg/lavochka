/* Сёги (японские шахматы) — правила, без DOM. Пресеты: сёги 9×9, мини-сёги 5×5, «животные сёги» (доубуцу) 3×4.
 *
 * Доска W×H: p = r * W + f, r = 0 — ряд первого игрока (чёрные, сэнтэ, место 0, ходят «вверх»), r = H − 1 — ряд белых (готэ, место 1).
 * Фигура — { o: владелец, k: вид, pr: перевёрнута }. Виды: K король, R ладья, B слон, G золото, S серебро, N конь, L копьё, P пешка;
 * в доубуцу — K лев, W жираф (шаг по прямой), F слон (шаг по диагонали), P цыплёнок (перевёрнутый — курица, ходит как золото).
 * Взятая фигура переходит в руку (неперевёрнутой) и ставится на доску вместо хода — «сброс». */
import type { Options } from '../../core/types';

export type Mode = 'shogi' | 'mini' | 'dobutsu';
export interface Cfg {
  mode: Mode;
  /** Подписи фигур: иероглифы или по-русски. */
  labels: 'kanji' | 'ru';
}
export const cfgFrom = (o: Options): Cfg => ({ mode: o.mode === 'mini' || o.mode === 'dobutsu' ? o.mode : 'shogi', labels: o.labels === 'ru' ? 'ru' : 'kanji' });

export interface Piece {
  o: 0 | 1;
  k: string;
  pr: boolean;
}

interface Geo {
  w: number;
  h: number;
  /** Сколько дальних горизонталей — зона превращения. */
  zone: number;
  /** Какие фигуры превращаются. */
  promo: string;
  /** Расстановка снизу вверх (для первого игрока), '.' — пусто. */
  start: string[];
  /** Состав руки — в каком порядке показывать. */
  kinds: string[];
}
export const GEO: Record<Mode, Geo> = {
  shogi: { w: 9, h: 9, zone: 3, promo: 'RBSNLP', start: ['LNSGKGSNL', '.B.....R.', 'PPPPPPPPP'], kinds: ['R', 'B', 'G', 'S', 'N', 'L', 'P'] },
  mini: { w: 5, h: 5, zone: 1, promo: 'RBSP', start: ['KGSBR', 'P....'], kinds: ['R', 'B', 'G', 'S', 'P'] },
  dobutsu: { w: 3, h: 4, zone: 1, promo: 'P', start: ['FKW', '.P.'], kinds: ['W', 'F', 'P'] },
};

export interface Move {
  /** −1 — сброс из руки. */
  from: number;
  to: number;
  drop?: string;
  promo?: boolean;
}

export type EndReason = 'mate' | 'try' | 'perpetual' | 'repetition' | 'moves' | 'resign' | 'impasse' | 'impasseDraw';

export interface State {
  cfg: Cfg;
  board: (Piece | null)[];
  hands: [Record<string, number>, Record<string, number>];
  turn: 0 | 1;
  keys: string[];
  checks: [number, number];
  ply: number;
  last: { from: number; to: number } | null;
  over: boolean;
  winner: number | null;
  reason: EndReason | null;
}
export type View = State;

export type Action = { type: 'move'; from: number; to: number; promo?: boolean } | { type: 'drop'; kind: string; to: number } | { type: 'resign' };
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; kind: string; drop: boolean; promo: boolean; captured: string; check: boolean; text: string }
  | { type: 'end'; winner: number | null; reason: EndReason };

// ---------------------------------------------------------------- ходы фигур

const geo = (s: { cfg: Cfg }) => GEO[s.cfg.mode];
/** Шаги на одно поле (df, dr — «вперёд» для владельца положительно) и дальние направления. */
const GOLD = [
  [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1],
];
const KING = [
  [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1],
];
const ORTHO = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
];
const DIAG = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];
function rules(p: Piece): { step: number[][]; slide: number[][]; jump?: number[][] } {
  if (p.pr) {
    if (p.k === 'R') return { step: DIAG, slide: ORTHO };
    if (p.k === 'B') return { step: ORTHO, slide: DIAG };
    return { step: GOLD, slide: [] };
  }
  switch (p.k) {
    case 'K':
      return { step: KING, slide: [] };
    case 'G':
      return { step: GOLD, slide: [] };
    case 'S':
      return { step: [[0, 1], ...DIAG], slide: [] };
    case 'N':
      return { step: [], slide: [], jump: [[1, 2], [-1, 2]] };
    case 'L':
      return { step: [], slide: [[0, 1]] };
    case 'P':
      return { step: [[0, 1]], slide: [] };
    case 'R':
      return { step: [], slide: ORTHO };
    case 'B':
      return { step: [], slide: DIAG };
    case 'W':
      return { step: ORTHO, slide: [] };
    case 'F':
      return { step: DIAG, slide: [] };
  }
  return { step: [], slide: [] };
}

export interface Pos {
  board: (Piece | null)[];
  hands: [Record<string, number>, Record<string, number>];
  turn: 0 | 1;
  mode: Mode;
}

const G = (pos: Pos) => GEO[pos.mode];
/** Горизонталь от своего края (0 — свой первый ряд). */
const relRank = (pos: Pos, p: number, o: number) => {
  const r = Math.floor(p / G(pos).w);
  return o === 0 ? r : G(pos).h - 1 - r;
};
const inZone = (pos: Pos, p: number, o: number) => relRank(pos, p, o) >= G(pos).h - G(pos).zone;
/** Фигуре на этом поле больше некуда ходить — превращение обязательно / сбрасывать нельзя. */
function dead(pos: Pos, k: string, p: number, o: number): boolean {
  const rr = relRank(pos, p, o);
  // в доубуцу цыплёнок в последнем ряду обязательно становится курицей (а сбрасывать его туда можно)
  if (pos.mode === 'dobutsu') return k === 'P' && rr === G(pos).h - 1;
  const h = G(pos).h;
  if (k === 'P' || k === 'L') return rr === h - 1;
  if (k === 'N') return rr >= h - 2;
  return false;
}

/** Поля, куда фигура на p бьёт/ходит (без учёта шаха). */
function targets(pos: Pos, p: number, out: number[] = []): number[] {
  const pc = pos.board[p]!;
  const { w, h } = G(pos);
  const f = p % w;
  const r = Math.floor(p / w);
  const fw = pc.o === 0 ? 1 : -1;
  const ok = (q: number) => !pos.board[q] || pos.board[q]!.o !== pc.o;
  const at = (df: number, dr: number) => {
    const ff = f + df;
    const rr = r + dr * fw;
    return ff < 0 || ff >= w || rr < 0 || rr >= h ? -1 : rr * w + ff;
  };
  const R = rules(pc);
  for (const [df, dr] of R.step) {
    const q = at(df, dr);
    if (q >= 0 && ok(q)) out.push(q);
  }
  for (const [df, dr] of R.jump ?? []) {
    const q = at(df, dr);
    if (q >= 0 && ok(q)) out.push(q);
  }
  for (const [df, dr] of R.slide) {
    for (let n = 1; ; n++) {
      const q = at(df * n, dr * n);
      if (q < 0) break;
      if (pos.board[q]) {
        if (ok(q)) out.push(q);
        break;
      }
      out.push(q);
    }
  }
  return out;
}

export const kingSq = (pos: Pos, o: number) => pos.board.findIndex((x) => x && x.o === o && x.k === 'K');

export function attacked(pos: Pos, q: number, by: number): boolean {
  for (let p = 0; p < pos.board.length; p++) {
    const x = pos.board[p];
    if (x && x.o === by && targets(pos, p).includes(q)) return true;
  }
  return false;
}
export const inCheck = (pos: Pos, o: number) => {
  const k = kingSq(pos, o);
  return k >= 0 && attacked(pos, k, 1 - o);
};

/** Псевдоходы (без проверки шаха; ограничения сбросов — кроме мата пешкой). */
export function pseudo(pos: Pos, out: Move[] = []): Move[] {
  const c = pos.turn;
  const g = G(pos);
  for (let p = 0; p < pos.board.length; p++) {
    const x = pos.board[p];
    if (!x || x.o !== c) continue;
    for (const q of targets(pos, p)) {
      const can = !x.pr && g.promo.includes(x.k) && (inZone(pos, p, c) || inZone(pos, q, c));
      const must = can && dead(pos, x.k, q, c);
      if (!must) out.push({ from: p, to: q });
      if (can) out.push({ from: p, to: q, promo: true });
    }
  }
  const hand = pos.hands[c];
  for (const k of Object.keys(hand)) {
    if (!hand[k]) continue;
    for (let q = 0; q < pos.board.length; q++) {
      if (pos.board[q] || (pos.mode !== 'dobutsu' && dead(pos, k, q, c))) continue;
      if (k === 'P' && pos.mode !== 'dobutsu') {
        // нифу: на вертикали уже есть своя непревращённая пешка
        const f = q % g.w;
        let two = false;
        for (let r = 0; r < g.h; r++) {
          const y = pos.board[r * g.w + f];
          if (y && y.o === c && y.k === 'P' && !y.pr) two = true;
        }
        if (two) continue;
      }
      out.push({ from: -1, to: q, drop: k });
    }
  }
  return out;
}

export function playPos(pos: Pos, m: Move): Pos {
  const board = pos.board.slice();
  const hands: [Record<string, number>, Record<string, number>] = [{ ...pos.hands[0] }, { ...pos.hands[1] }];
  const c = pos.turn;
  if (m.drop) {
    board[m.to] = { o: c, k: m.drop, pr: false };
    hands[c][m.drop]--;
  } else {
    const x = board[m.from]!;
    const cap = board[m.to];
    if (cap) hands[c][cap.k] = (hands[c][cap.k] ?? 0) + 1;
    board[m.to] = m.promo ? { ...x, pr: true } : x;
    board[m.from] = null;
  }
  return { board, hands, turn: (1 - c) as 0 | 1, mode: pos.mode };
}

/** Есть ли у ходящего хоть один законный ход (без проверки мата пешкой — для неё самой). */
function anyLegal(pos: Pos): boolean {
  const c = pos.turn;
  return pseudo(pos).some((m) => !inCheck(playPos(pos, m), c));
}

export function legalPos(pos: Pos): Move[] {
  const c = pos.turn;
  return pseudo(pos).filter((m) => {
    const n = playPos(pos, m);
    if (inCheck(n, c)) return false;
    // утифудзумэ: нельзя ставить мат сбросом пешки
    if (m.drop === 'P' && pos.mode !== 'dobutsu' && inCheck(n, 1 - c) && !anyLegal(n)) return false;
    return true;
  });
}

const posOf = (s: State): Pos => ({ board: s.board, hands: s.hands, turn: s.turn, mode: s.cfg.mode });
export const legal = (s: State) => (s.over ? [] : legalPos(posOf(s)));

// ---------------------------------------------------------------- партия

const emptyHand = (m: Mode) => Object.fromEntries(GEO[m].kinds.map((k) => [k, 0])) as Record<string, number>;

export function newState(cfg: Cfg): State {
  const g = GEO[cfg.mode];
  const board: (Piece | null)[] = new Array(g.w * g.h).fill(null);
  g.start.forEach((row, r) => {
    for (let f = 0; f < g.w; f++) {
      const k = row[f];
      if (k === '.') continue;
      board[r * g.w + f] = { o: 0, k, pr: false };
      // у второго — зеркально (поворот доски на 180°)
      board[(g.h - 1 - r) * g.w + (g.w - 1 - f)] = { o: 1, k, pr: false };
    }
  });
  const s: State = { cfg, board, hands: [emptyHand(cfg.mode), emptyHand(cfg.mode)], turn: 0, keys: [], checks: [0, 0], ply: 0, last: null, over: false, winner: null, reason: null };
  s.keys = [key(s)];
  return s;
}
export const setup = (opts: Options) => newState(cfgFrom(opts));

export const key = (s: { board: (Piece | null)[]; hands: Record<string, number>[]; turn: number }) =>
  s.board.map((x) => (x ? `${x.o}${x.k}${x.pr ? '+' : ''}` : '.')).join('') + JSON.stringify(s.hands) + s.turn;

export const toAct = (s: State) => (s.over ? [] : [s.turn]);

const KANJI_RU: Record<string, string> = { K: 'Кр', R: 'Л', B: 'С', G: 'З', S: 'Сер', N: 'К', L: 'Коп', P: 'П' };
const ZOO_RU: Record<string, string> = { K: 'Лев ', W: 'Жираф ', F: 'Слон ', P: 'Цыплёнок ' };
export function sqName(s: { cfg: Cfg }, p: number): string {
  const { w } = geo(s);
  // по-японски: вертикали справа налево цифрами, горизонтали сверху вниз — здесь проще: буква-цифра от первого игрока
  return 'abcdefghi'[p % w] + (Math.floor(p / w) + 1);
}

function finish(s: State, winner: number | null, reason: EndReason, ev: Event[]) {
  s.over = true;
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

export const MAX_PLY = 400;

/** Импас (дзисёги): очки за фигуры на доске и в руке — ладья и слон по 5, остальные (кроме короля) по 1. */
export function impassePoints(pos: Pos, o: number): number {
  let n = 0;
  for (const p of pos.board) if (p && p.o === o && p.k !== 'K') n += p.k === 'R' || p.k === 'B' ? 5 : 1;
  for (const [k, c] of Object.entries(pos.hands[o])) n += (k === 'R' || k === 'B' ? 5 : 1) * c;
  return n;
}
/** Сколько очков нужно при импасе (правило 24 очков). */
export const IMPASSE_NEED = 24;

/** Оба короля вошли в лагерь соперника (большие сёги). */
function bothKingsIn(pos: Pos): boolean {
  if (pos.mode !== 'shogi') return false;
  return [0, 1].every((o) => {
    const k = pos.board.findIndex((p) => p?.o === o && p.k === 'K');
    return k >= 0 && inZone(pos, k, o);
  });
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const ev: Event[] = [];
  if (a.type === 'resign') {
    const s = { ...s0 };
    finish(s, 1 - seat, 'resign', ev);
    return { state: s, events: ev };
  }
  const pos = posOf(s0);
  const all = legalPos(pos);
  const m =
    a.type === 'drop'
      ? all.find((x) => x.drop === a.kind && x.to === a.to)
      : all.find((x) => !x.drop && x.from === a.from && x.to === a.to && !!x.promo === !!a.promo) ?? all.find((x) => !x.drop && x.from === a.from && x.to === a.to);
  if (!m) return null;
  const moved = m.drop ? m.drop : s0.board[m.from]!.k;
  const captured = m.drop ? '' : s0.board[m.to]?.k ?? '';
  const n = playPos(pos, m);
  const check = inCheck(n, 1 - seat);
  const text = `${(s0.cfg.mode === 'dobutsu' ? ZOO_RU : KANJI_RU)[moved]}${m.drop ? '*' : `${sqName(s0, m.from)}${captured ? ':' : '-'}`}${sqName(s0, m.to)}${m.promo ? '+' : ''}`;
  const s: State = { ...s0, board: n.board, hands: n.hands, turn: n.turn, ply: s0.ply + 1, last: { from: m.drop ? m.to : m.from, to: m.to }, checks: [s0.checks[0], s0.checks[1]] };
  s.checks[seat] = check ? s0.checks[seat] + 1 : 0;
  const k = key(s);
  s.keys = [...s0.keys, k];
  ev.push({ type: 'move', seat, from: m.from, to: m.to, kind: moved, drop: !!m.drop, promo: !!m.promo, captured, check, text });
  if (!legalPos(n).length) finish(s, seat, 'mate', ev);
  else if (bothKingsIn(n) && !check) {
    // импас: оба короля в лагере соперника, мата не будет — считают очки; меньше 24 — проигрыш, у обоих хватает — ничья
    const pts = [impassePoints(n, 0), impassePoints(n, 1)];
    const ok = pts.map((p) => p >= IMPASSE_NEED);
    if (ok[0] && ok[1]) finish(s, null, 'impasseDraw', ev);
    else finish(s, ok[0] ? 0 : ok[1] ? 1 : pts[0] >= pts[1] ? 0 : 1, 'impasse', ev);
  } else if (s.cfg.mode === 'dobutsu' && moved === 'K' && relRank(n, m.to, seat) === GEO.dobutsu.h - 1 && !attacked(n, m.to, 1 - seat)) finish(s, seat, 'try', ev);
  else if (s.keys.filter((x) => x === k).length >= 4) {
    // сэннитэ: вечный шах — проигрыш шахующего, иначе ничья
    if (s.checks[seat] >= 4) finish(s, 1 - seat, 'perpetual', ev);
    else finish(s, null, 'repetition', ev);
  } else if (s.ply >= MAX_PLY) finish(s, null, 'moves', ev);
  return { state: s, events: ev };
}
