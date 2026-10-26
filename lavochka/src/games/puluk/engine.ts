/* Пулук (буль) — игра майя-кекчи и мопан: дорожка из полей между двумя «домами», зёрна-кости, воины берут пленных. Без DOM.
 *
 * Реконструкция — по en/ru.wikipedia «Bul (game)» / «Буль (игра, майя)» (Culin 1907, Sapper, Verbeeck 1998); единого текста
 * правил нет, спорное — в docs/STATE.md, «Решения, принятые без пользователя».
 *
 * Дорожка — len полей в ряд (промежутки между палочками). Дом места стороны 0 — перед полем 0, стороны 1 — за полем len − 1;
 * воины идут навстречу. Кости — четыре зерна с меткой на одной стороне: сколько меток вверх — на столько полей, ни одной — 5.
 * Бросок один за ход. Ходят одним воином: вводят нового из дома (встаёт на поле с номером броска, считая от своего дома)
 * или двигают воина на дорожке вместе с его пленными. Через воинов перескакивают; на поле со своим (и с напарником) встать
 * нельзя. Встал на врага — враг в плену, едет под захватчиком; встал на чужую стопку — забрал в плен и её хозяина,
 * а свои пленные из неё освобождаются и уходят домой. Дошёл до конца дорожки (до дома соперника; перебор не нужен) —
 * воин возвращается домой и снова может выйти, пленные под ним убиты. Нет хода — ход пропал.
 * Проигрывает сторона, у которой не осталось свободных воинов (ни дома, ни на дорожке поверх стопки).
 * Вариант «домой с добычей» (Verbeeck): взяв пленного, воин разворачивается и несёт его к своему дому.
 * Командная игра: четверо, места 0 и 2 против 1 и 3, ходят по кругу. */
import type { Options, Rng } from '../../core/types';

export interface Cfg {
  /** Полей на дорожке. */
  len: number;
  /** Воинов у каждого игрока. */
  warriors: number;
  /** Четверо, двое на двое. */
  teams: boolean;
  /** Взявший пленного разворачивается к своему дому. */
  back: boolean;
}

export const LENS = [10, 15, 20];

export function cfgFrom(o: Options): Cfg {
  const len = Number(o.len);
  const w = Number(o.warriors);
  return {
    len: LENS.includes(len) ? len : 10,
    warriors: w >= 3 && w <= 6 ? w : 5,
    teams: o.teams === true,
    back: o.back === true,
  };
}

/** Стопка на поле: сверху воин места seat, под ним пленные (места). */
export interface Stack {
  seat: number;
  /** +1 — к полю len − 1, −1 — к полю 0. */
  dir: 1 | -1;
  pris: number[];
}

export interface State {
  cfg: Cfg;
  /** Игроков: 2 или 4. */
  n: number;
  track: (Stack | null)[];
  /** Воинов дома у каждого места. */
  home: number[];
  /** Убитых воинов каждого места. */
  dead: number[];
  turn: number;
  phase: 'roll' | 'move' | 'over';
  /** Зёрна последнего броска: 1 — меткой вверх. */
  kernels: number[];
  value: number;
  /** Победившая сторона (0 или 1); null — ничья. */
  winner: number | null;
  why: 'all' | 'limit' | null;
  ply: number;
}

/** from: поле или −1 — ввести воина из дома. */
export type Action = { type: 'roll' } | { type: 'move'; from: number };

export interface Move {
  from: number;
  /** Поле, куда встанет; −1 — ушёл с дорожки домой. */
  to: number;
  /** Поля по пути (последнее — to, если он на дорожке). */
  path: number[];
  /** Сколько врагов попадает в плен. */
  took: number;
  /** Свои пленные, которых освободили (места). */
  freed: number[];
  /** Сколько пленных убито при уходе с дорожки. */
  killed: number;
}

export type Event =
  | { type: 'roll'; seat: number; kernels: number[]; value: number; none: boolean }
  | { type: 'move'; seat: number; from: number; to: number; path: number[]; took: number; freed: number[]; killed: number; turned: boolean }
  | { type: 'turn'; seat: number }
  | { type: 'end'; winner: number | null; why: 'all' | 'limit' };

/** Предел партии в полуходах: дальше — побеждает тот, кто убил и держит в плену больше (в настоящей партии не встречается). */
export const MAX_PLY = 4000;

export const side = (seat: number) => seat % 2;
/** Направление воинов стороны к дому соперника. */
export const fwd = (seat: number): 1 | -1 => (side(seat) === 0 ? 1 : -1);
/** Значение броска: число меток, ни одной — 5. */
export const throwValue = (k: number[]) => k.filter((x) => x).length || 5;
/** Вероятности значений 1…5 (четыре зерна, у каждого метка — одна сторона из двух). */
export const P = [0, 4 / 16, 6 / 16, 4 / 16, 1 / 16, 1 / 16];

export function newState(cfg: Cfg, turn = 0): State {
  const n = cfg.teams ? 4 : 2;
  return {
    cfg,
    n,
    track: Array(cfg.len).fill(null),
    home: Array(n).fill(cfg.warriors),
    dead: Array(n).fill(0),
    turn,
    phase: 'roll',
    kernels: [],
    value: 0,
    winner: null,
    why: null,
    ply: 0,
  };
}

/** n — сколько мест занято: командная игра только вчетвером, на двух местах — один на один. */
export function setup(o: Options, rng: Rng, n = 4): State {
  const cfg = cfgFrom(o);
  if (n < 4) cfg.teams = false;
  return newState(cfg, rng.int(cfg.teams ? 4 : 2));
}

export const toAct = (s: State) => (s.phase === 'over' ? [] : [s.turn]);

/** Свободных воинов места: дома и сверху стопок. */
export function free(s: State, seat: number): number {
  let k = s.home[seat];
  for (const st of s.track) if (st && st.seat === seat) k++;
  return k;
}
export const sideFree = (s: State, sd: number) => Array.from({ length: s.n }, (_, i) => i).filter((i) => side(i) === sd).reduce((a, i) => a + free(s, i), 0);
/** Пленных стороны sd, которых держит соперник. */
export function held(s: State, sd: number): number {
  let k = 0;
  for (const st of s.track) if (st) for (const p of st.pris) if (side(p) === sd) k++;
  return k;
}

function moveFor(s: State, seat: number, from: number, v: number): Move | null {
  const len = s.cfg.len;
  const my = side(seat);
  let start: number;
  let dir: 1 | -1;
  let pris: number[] = [];
  if (from < 0) {
    if (s.home[seat] <= 0) return null;
    dir = fwd(seat);
    start = dir === 1 ? -1 : len;
  } else {
    const st = s.track[from];
    if (!st || st.seat !== seat) return null;
    start = from;
    dir = st.dir;
    pris = st.pris;
  }
  const path: number[] = [];
  let c = start;
  for (let i = 0; i < v; i++) {
    c += dir;
    if (c < 0 || c >= len) break;
    path.push(c);
  }
  const off = c < 0 || c >= len;
  if (off) {
    // ушёл с дорожки домой: пленные убиты (в пути он никого не брал)
    if (from < 0) return null; // на дорожке длиной от 10 до этого не доходит
    return { from, to: -1, path, took: 0, freed: [], killed: pris.filter((p) => side(p) !== my).length };
  }
  const t = s.track[c];
  if (t && side(t.seat) === my) return null;
  let took = 0;
  const freed: number[] = [];
  if (t) {
    took = 1;
    for (const p of t.pris) side(p) === my ? freed.push(p) : took++;
  }
  return { from, to: c, path, took, freed, killed: 0 };
}

export function legalMoves(s: State): Move[] {
  if (s.phase !== 'move') return [];
  const out: Move[] = [];
  const seat = s.turn;
  const m0 = moveFor(s, seat, -1, s.value);
  if (m0) out.push(m0);
  s.track.forEach((st, i) => {
    if (!st || st.seat !== seat) return;
    const m = moveFor(s, seat, i, s.value);
    if (m) out.push(m);
  });
  return out;
}

export function legal(s: State): Action[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'roll') return [{ type: 'roll' }];
  return legalMoves(s).map((m) => ({ type: 'move', from: m.from }));
}

function clone(s: State): State {
  return { ...s, track: s.track.map((t) => (t ? { ...t, pris: t.pris.slice() } : null)), home: s.home.slice(), dead: s.dead.slice(), kernels: s.kernels.slice() };
}

/** Сделать ход (без проверки допустимости); возвращает, развернулся ли воин. */
export function doMove(s: State, m: Move): boolean {
  const seat = s.turn;
  let st: Stack;
  if (m.from < 0) {
    s.home[seat]--;
    st = { seat, dir: fwd(seat), pris: [] };
  } else {
    st = s.track[m.from]!;
    s.track[m.from] = null;
  }
  if (m.to < 0) {
    s.home[seat]++;
    for (const p of st.pris) s.dead[p]++;
    return false;
  }
  const t = s.track[m.to];
  let turned = false;
  if (t) {
    st.pris.push(t.seat);
    for (const p of t.pris) {
      if (side(p) === side(seat)) s.home[p]++;
      else st.pris.push(p);
    }
    if (s.cfg.back && st.dir === fwd(seat)) {
      st.dir = (-st.dir) as 1 | -1;
      turned = true;
    }
  }
  s.track[m.to] = st;
  return turned;
}

function finish(s: State, ev: Event[], winner: number | null, why: 'all' | 'limit') {
  s.phase = 'over';
  s.winner = winner;
  s.why = why;
  ev.push({ type: 'end', winner, why });
}

/** Очки стороны на случай предела партии: убитые и пленные соперника. */
export const tally = (s: State, sd: number) => {
  let k = held(s, 1 - sd);
  for (let i = 0; i < s.n; i++) if (side(i) !== sd) k += s.dead[i];
  return k;
};

/** Конец хода: следующий по кругу, у кого есть свободные воины. */
function endTurn(s: State, ev: Event[]) {
  for (const sd of [0, 1]) if (sideFree(s, sd) === 0) return finish(s, ev, 1 - sd, 'all');
  s.phase = 'roll';
  if (s.ply >= MAX_PLY) {
    const a = tally(s, 0);
    const b = tally(s, 1);
    return finish(s, ev, a === b ? null : a > b ? 0 : 1, 'limit');
  }
  let t = s.turn;
  for (let i = 0; i < s.n; i++) {
    t = (t + 1) % s.n;
    if (free(s, t) > 0) break;
  }
  s.turn = t;
  ev.push({ type: 'turn', seat: t });
}

/** Бросок с заданными зёрнами (показ правил подкручивает их через rig). */
export function applyRoll(s0: State, kernels: number[]): { state: State; events: Event[] } {
  const s = clone(s0);
  s.kernels = kernels.slice();
  s.value = throwValue(kernels);
  s.phase = 'move';
  s.ply++;
  const none = legalMoves(s).length === 0;
  const ev: Event[] = [{ type: 'roll', seat: s.turn, kernels: kernels.slice(), value: s.value, none }];
  if (none) endTurn(s, ev);
  return { state: s, events: ev };
}

export function applyMove(s0: State, from: number): { state: State; events: Event[] } | null {
  const m = legalMoves(s0).find((x) => x.from === from);
  if (!m) return null;
  const s = clone(s0);
  const seat = s.turn;
  const turned = doMove(s, m);
  s.ply++;
  const ev: Event[] = [{ type: 'move', seat, from: m.from, to: m.to, path: m.path, took: m.took, freed: m.freed, killed: m.killed, turned }];
  endTurn(s, ev);
  return { state: s, events: ev };
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.phase === 'over' || seat !== s.turn || !a || typeof a !== 'object') return null;
  if (a.type === 'roll') return s.phase === 'roll' ? applyRoll(s, [0, 1, 2, 3].map(() => rng.int(2))) : null;
  if (a.type === 'move' && s.phase === 'move' && Number.isInteger(a.from)) return applyMove(s, a.from);
  return null;
}
