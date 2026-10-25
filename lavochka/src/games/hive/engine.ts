/* Улей — правила (без DOM). Поля нет: фишки-шестиугольники кладут друг к другу, получается «улей».
 *
 * У каждого: пчела-матка, 2 жука, 3 кузнечика, 2 паука, 3 муравья (+ по желанию комар, божья коровка, мокрица).
 * Ход — одно из двух:
 *   поставить фишку из запаса: рядом со своими и не касаясь чужих (первые две фишки партии — просто рядом);
 *   передвинуть свою фишку — только когда своя пчела уже в улье.
 * Пчелу ставят не позже четвёртого своего хода (турнирное правило: и не первым ходом).
 * Улей всегда один: ход, после которого он распадается (даже на миг, пока фишка в пути), запрещён.
 * По полу фишки ползут: протиснуться между двумя соседями нельзя («узкие ворота»), и всё время надо касаться улья.
 *   пчела — на одну клетку; паук — ровно на три, не возвращаясь; муравей — сколько угодно;
 *   кузнечик — прыжок по прямой через одну или несколько фишек на первую пустую;
 *   жук — на одну клетку, в том числе на улей (на фишку сверху); фишка под жуком не ходит, а стопка — цвета жука;
 *   божья коровка — две клетки по верху улья и одна вниз;
 *   комар — ходит как любой из соседей (кроме комара), а наверху улья — как жук;
 *   мокрица — на одну клетку или переносит соседнюю фишку (свою или чужую, не в стопке) через себя на пустую клетку рядом.
 *   Фишку, которой только что ходил соперник, мокрица не трогает; перенесённая фишка следующий ход стоит.
 * Нет ни одного хода — пропуск. Победа — пчела соперника окружена со всех шести сторон; обе сразу — ничья.
 */
import type { Options } from '../../core/types';

export type Bug = 'Q' | 'B' | 'G' | 'S' | 'A' | 'M' | 'L' | 'P';
export const BUGS: Bug[] = ['Q', 'B', 'G', 'S', 'A', 'M', 'L', 'P'];
export const BUG_RU: Record<Bug, string> = { Q: 'пчела', B: 'жук', G: 'кузнечик', S: 'паук', A: 'муравей', M: 'комар', L: 'божья коровка', P: 'мокрица' };
/** Винительный падеж: «поставил пчелу». */
export const BUG_ACC: Record<Bug, string> = { Q: 'пчелу', B: 'жука', G: 'кузнечика', S: 'паука', A: 'муравья', M: 'комара', L: 'божью коровку', P: 'мокрицу' };

export interface Piece {
  o: number;
  b: Bug;
}

export interface Cfg {
  M: boolean;
  L: boolean;
  P: boolean;
  /** Турнирное правило: пчелу нельзя ставить первым ходом. */
  tourney: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { M: !!o.mosquito, L: !!o.ladybug, P: !!o.pillbug, tourney: !!o.tourney };
}

export function startHand(cfg: Cfg): Record<Bug, number> {
  return { Q: 1, B: 2, G: 3, S: 2, A: 3, M: cfg.M ? 1 : 0, L: cfg.L ? 1 : 0, P: cfg.P ? 1 : 0 };
}

export interface State {
  cfg: Cfg;
  /** Клетка «q,r» (осевые координаты) → стопка снизу вверх. Пустых клеток в словаре нет. */
  cells: Record<string, Piece[]>;
  hand: [Record<Bug, number>, Record<Bug, number>];
  /** Сколько фишек поставил каждый. */
  placed: [number, number];
  turn: number;
  ply: number;
  /** Последний ход: куда пришла фишка; thrown — её перенесла мокрица (тогда она стоит ход). */
  last: { from: string | null; to: string; thrown: boolean; seat: number } | null;
  passes: number;
  over: boolean;
  winner: number | null;
  /** Окружённые пчёлы (для подсветки в конце). */
  trapped: string[];
}

export type View = State;
export type Action =
  | { type: 'place'; bug: Bug; at: string }
  | { type: 'move'; from: string; to: string }
  | { type: 'throw'; by: string; from: string; to: string }
  | { type: 'pass' };
export type Event =
  | { type: 'place'; seat: number; bug: Bug; at: string }
  | { type: 'move'; seat: number; bug: Bug; from: string; to: string; climb: boolean }
  | { type: 'throw'; seat: number; by: Bug; bug: Bug; owner: number; from: string; to: string }
  | { type: 'pass'; seat: number }
  | { type: 'end'; winner: number | null; trapped: string[] };

/** Шесть соседей по кругу (осевые координаты, «острый верх»). */
export const DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export const key = (q: number, r: number) => `${q},${r}`;
export function parse(k: string): [number, number] {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}
export function around(k: string): string[] {
  const [q, r] = parse(k);
  return DIRS.map(([dq, dr]) => key(q + dq, r + dr));
}
const step1 = (k: string, d: number) => {
  const [q, r] = parse(k);
  return key(q + DIRS[d][0], r + DIRS[d][1]);
};

/** Ограничение на длину партии: дальше — ничья. */
export const MAX_PLY = 400;

export function newState(cfg: Cfg): State {
  return {
    cfg,
    cells: {},
    hand: [startHand(cfg), startHand(cfg)],
    placed: [0, 0],
    turn: 0,
    ply: 0,
    last: null,
    passes: 0,
    over: false,
    winner: null,
    trapped: [],
  };
}

export const setup = (opts: Options): State => newState(cfgFrom(opts));
export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
export const top = (s: State, k: string): Piece | undefined => {
  const st = s.cells[k];
  return st ? st[st.length - 1] : undefined;
};
const height = (cells: Record<string, Piece[]>, k: string) => cells[k]?.length ?? 0;

export function queenAt(s: State, seat: number): string | null {
  for (const k in s.cells) if (s.cells[k].some((p) => p.b === 'Q' && p.o === seat)) return k;
  return null;
}

/** Сколько соседей у пчелы занято. */
export function queenPressure(s: State, seat: number): number {
  const q = queenAt(s, seat);
  return q ? around(q).filter((n) => s.cells[n]).length : 0;
}

// ---------------------------------------------------------------- один улей

/** Клетки, без верхней фишки которых улей распадётся (точки сочленения; стопки выше 1 — не в счёт). */
export function pinned(s: State): Set<string> {
  const keys = Object.keys(s.cells);
  const out = new Set<string>();
  if (keys.length < 3) return out;
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  let t = 0;
  const dfs = (u: string, parent: string | null) => {
    disc.set(u, t);
    low.set(u, t);
    t++;
    let kids = 0;
    for (const v of around(u)) {
      if (!s.cells[v]) continue;
      if (!disc.has(v)) {
        kids++;
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent != null && low.get(v)! >= disc.get(u)!) out.add(u);
      } else if (v !== parent) low.set(u, Math.min(low.get(u)!, disc.get(v)!));
    }
    if (parent == null && kids > 1) out.add(u);
  };
  dfs(keys[0], null);
  for (const k of out) if (s.cells[k].length > 1) out.delete(k);
  return out;
}

// ---------------------------------------------------------------- шаги

/** Общие соседи двух соседних клеток (слева и справа от шага). */
function sides(a: string, b: string): [string, string] {
  const [aq, ar] = parse(a);
  const [bq, br] = parse(b);
  const d = DIRS.findIndex(([dq, dr]) => aq + dq === bq && ar + dr === br);
  return [step1(a, (d + 5) % 6), step1(a, (d + 1) % 6)];
}

/** Шаг по полу из a в соседнюю пустую b (фишка уже снята с a): не через узкие ворота и не отрываясь от улья. */
function slideOk(cells: Record<string, Piece[]>, a: string, b: string): boolean {
  if (cells[b]) return false;
  const [c1, c2] = sides(a, b);
  const h1 = !!cells[c1];
  const h2 = !!cells[c2];
  return h1 !== h2;
}

/** Шаг на высоте (жук, коровка): ha — высота, на которой фишка была (после снятия), hb — куда придёт (высота стопки b).
 * Ворота: нельзя протиснуться между двумя стопками, которые выше и откуда, и куда. На полу — ещё и касаться улья. */
function climbOk(cells: Record<string, Piece[]>, a: string, b: string): boolean {
  const ha = height(cells, a);
  const hb = height(cells, b);
  const [c1, c2] = sides(a, b);
  const h1 = height(cells, c1);
  const h2 = height(cells, c2);
  if (Math.min(h1, h2) > Math.max(ha, hb)) return false;
  if (ha === 0 && hb === 0) return h1 > 0 || h2 > 0;
  return true;
}

/** Снять верхнюю фишку с клетки (копия словаря, стопки не меняются). */
function lifted(cells: Record<string, Piece[]>, k: string): Record<string, Piece[]> {
  const c = { ...cells };
  const st = c[k];
  if (st.length > 1) c[k] = st.slice(0, -1);
  else delete c[k];
  return c;
}

function slides1(cells: Record<string, Piece[]>, from: string): string[] {
  return around(from).filter((b) => slideOk(cells, from, b));
}

function antDest(cells: Record<string, Piece[]>, from: string): string[] {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const a = q.pop()!;
    for (const b of slides1(cells, a)) if (!seen.has(b)) seen.add(b), q.push(b);
  }
  seen.delete(from);
  return [...seen];
}

function spiderDest(cells: Record<string, Piece[]>, from: string): string[] {
  const out = new Set<string>();
  const walk = (a: string, path: string[], n: number) => {
    if (n === 3) return void out.add(a);
    for (const b of slides1(cells, a)) if (!path.includes(b)) walk(b, [...path, b], n + 1);
  };
  walk(from, [from], 0);
  return [...out];
}

function hopperDest(cells: Record<string, Piece[]>, from: string): string[] {
  const out: string[] = [];
  for (let d = 0; d < 6; d++) {
    let k = step1(from, d);
    if (!cells[k]) continue;
    while (cells[k]) k = step1(k, d);
    out.push(k);
  }
  return out;
}

function beetleDest(cells: Record<string, Piece[]>, from: string): string[] {
  return around(from).filter((b) => climbOk(cells, from, b));
}

function ladybugDest(cells: Record<string, Piece[]>, from: string): string[] {
  const out = new Set<string>();
  for (const a of around(from)) {
    if (!cells[a] || !climbOk(cells, from, a)) continue;
    for (const b of around(a)) {
      if (b === from || !cells[b] || !climbOk(cells, a, b)) continue;
      for (const c of around(b)) if (c !== from && !cells[c] && climbOk(cells, b, c)) out.add(c);
    }
  }
  return [...out];
}

/** Куда может пойти фишка вида bug (уже снятая с from). */
function destFor(cells: Record<string, Piece[]>, from: string, bug: Bug, onTop: boolean): string[] {
  switch (bug) {
    case 'Q':
    case 'P':
      return slides1(cells, from);
    case 'A':
      return antDest(cells, from);
    case 'S':
      return spiderDest(cells, from);
    case 'G':
      return hopperDest(cells, from);
    case 'B':
      return beetleDest(cells, from);
    case 'L':
      return ladybugDest(cells, from);
    case 'M': {
      if (onTop) return beetleDest(cells, from);
      const out = new Set<string>();
      const kinds = new Set<Bug>();
      for (const n of around(from)) {
        const st = cells[n];
        if (st) kinds.add(st[st.length - 1].b);
      }
      kinds.delete('M');
      for (const b of kinds) for (const d of destFor(cells, from, b, false)) out.add(d);
      return [...out];
    }
  }
}

// ---------------------------------------------------------------- ходы

export const opening = (s: State) => s.ply < 2;

/** Где можно поставить фишку. */
export function placeCells(s: State): string[] {
  if (s.ply === 0) return [key(0, 0)];
  if (s.ply === 1) return around(Object.keys(s.cells)[0]);
  const out = new Set<string>();
  const me = s.turn;
  for (const k in s.cells) {
    if (top(s, k)!.o !== me) continue;
    for (const n of around(k)) {
      if (s.cells[n] || out.has(n)) continue;
      if (around(n).every((m) => !s.cells[m] || top(s, m)!.o === me)) out.add(n);
    }
  }
  return [...out];
}

/** Какие фишки можно ставить. */
export function placeBugs(s: State): Bug[] {
  const me = s.turn;
  const hand = s.hand[me];
  const bugs = BUGS.filter((b) => hand[b] > 0);
  if (hand.Q > 0 && s.placed[me] === 3) return ['Q'];
  if (s.cfg.tourney && s.placed[me] === 0) return bugs.filter((b) => b !== 'Q');
  return bugs;
}

/** Фишка на from стоит ход (её перенесла мокрица). */
const frozen = (s: State, k: string) => !!s.last && s.last.thrown && s.last.to === k;

export function legal(s: State): Action[] {
  if (s.over) return [];
  const me = s.turn;
  const out: Action[] = [];
  const pc = placeCells(s);
  for (const bug of placeBugs(s)) for (const at of pc) out.push({ type: 'place', bug, at });
  if (s.hand[me].Q === 0) {
    const pin = pinned(s);
    for (const from in s.cells) {
      const st = s.cells[from];
      const p = st[st.length - 1];
      if (p.o !== me || frozen(s, from)) continue;
      if (!pin.has(from)) {
        const cells = lifted(s.cells, from);
        for (const to of destFor(cells, from, p.b, st.length > 1)) out.push({ type: 'move', from, to });
      }
      // перенос мокрицей (и комаром рядом с мокрицей, если сам на полу)
      const power = st.length === 1 && (p.b === 'P' || (p.b === 'M' && around(from).some((n) => top(s, n)?.b === 'P')));
      if (power) for (const a of throws(s, from, pin)) out.push(a);
    }
  }
  if (!out.length) out.push({ type: 'pass' });
  // один и тот же ход могли дать разные способности комара — убираем повторы
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = JSON.stringify(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function throws(s: State, by: string, pin: Set<string>): Action[] {
  const out: Action[] = [];
  const free = around(by).filter((n) => !s.cells[n]);
  for (const from of around(by)) {
    const st = s.cells[from];
    if (!st || st.length > 1 || pin.has(from)) continue;
    if (s.last && s.last.to === from) continue; // только что ходил соперник (или перенесён)
    // наверх мокрицы: ворота по высоте
    const cells = lifted(s.cells, from);
    if (!climbOk(cells, from, by)) continue;
    for (const to of free) {
      if (to === from) continue;
      // вниз с мокрицы (фишка временно на ней: высота 1 над клеткой мокрицы)
      const [c1, c2] = sides(by, to);
      if (Math.min(height(cells, c1), height(cells, c2)) > 1) continue;
      out.push({ type: 'throw', by, from, to });
    }
  }
  return out;
}

// ---------------------------------------------------------------- ход

function finish(s: State, events: Event[]) {
  const t: string[] = [];
  const lost: number[] = [];
  for (const seat of [0, 1]) {
    const q = queenAt(s, seat);
    if (q && around(q).every((n) => s.cells[n])) t.push(q), lost.push(seat);
  }
  if (lost.length || s.ply >= MAX_PLY || s.passes >= 2) {
    s.over = true;
    s.winner = lost.length === 1 ? 1 - lost[0] : null;
    s.trapped = t;
    events.push({ type: 'end', winner: s.winner, trapped: t });
  }
}

export function step(s0: State, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || !legal(s0).some((m) => sameAction(m, a))) return null;
  return apply(s0, a);
}

/** Сделать ход без проверки (ход взят из legal — для ботов). */
export function apply(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, cells: { ...s0.cells }, hand: [{ ...s0.hand[0] }, { ...s0.hand[1] }], placed: [...s0.placed] as [number, number], trapped: [] };
  const me = s.turn;
  const events: Event[] = [];
  if (a.type === 'place') {
    s.hand[me][a.bug]--;
    s.placed[me]++;
    s.cells[a.at] = [{ o: me, b: a.bug }];
    s.last = { from: null, to: a.at, thrown: false, seat: me };
    s.passes = 0;
    events.push({ type: 'place', seat: me, bug: a.bug, at: a.at });
  } else if (a.type === 'move') {
    const p = top(s, a.from)!;
    s.cells = lifted(s.cells, a.from);
    const climb = !!s.cells[a.to] || s0.cells[a.from].length > 1;
    s.cells[a.to] = [...(s.cells[a.to] ?? []), p];
    s.last = { from: a.from, to: a.to, thrown: false, seat: me };
    s.passes = 0;
    events.push({ type: 'move', seat: me, bug: p.b, from: a.from, to: a.to, climb });
  } else if (a.type === 'throw') {
    const p = top(s, a.from)!;
    const by = top(s, a.by)!;
    s.cells = lifted(s.cells, a.from);
    s.cells[a.to] = [p];
    s.last = { from: a.from, to: a.to, thrown: true, seat: me };
    s.passes = 0;
    events.push({ type: 'throw', seat: me, by: by.b, bug: p.b, owner: p.o, from: a.from, to: a.to });
  } else {
    s.passes++;
    s.last = s0.last && { ...s0.last, thrown: false };
    events.push({ type: 'pass', seat: me });
  }
  s.ply++;
  s.turn = 1 - me;
  finish(s, events);
  return { state: s, events };
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'place' && b.type === 'place') return a.bug === b.bug && a.at === b.at;
  if (a.type === 'move' && b.type === 'move') return a.from === b.from && a.to === b.to;
  if (a.type === 'throw' && b.type === 'throw') return a.by === b.by && a.from === b.from && a.to === b.to;
  return true;
}
