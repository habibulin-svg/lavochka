/* «Морская игра» — вариант с броненосцами, минами и береговой артиллерией (описание из docx), на поле советской
 * «Морской игры» (фото 1001.jpg: крестообразное море, белые кружки на скрещениях, стоянки по краям). Материалы и решения —
 * docs/analysis/materials-morskaya.md. Без DOM.
 *
 * Поле 11×10 узлов, углы — суша. Зелёные (место 0) у левого берега, красные (место 1) у правого. Корабль ходит на узел
 * вперёд по носу или поворачивается на 90° (разворот — два хода). Бой — выйти на узел корабля противника: в корму нельзя
 * никому, в борт — всем, в нос — только старший младшего. Старшинство: броненосец, крейсер, канонерка, миноносец, тральщик;
 * подлодка старше броненосца и крейсера, младше остальных. Береговые пушки («взрыв») и мины — бросок кубика при заходе. */
import type { Options, Rng } from '../../core/types';

export const COLS = 11;
export const ROWS = 10;
export const N = COLS * ROWS;
export const at = (c: number, r: number) => r * COLS + c;
export const col = (p: number) => p % COLS;
export const row = (p: number) => Math.floor(p / COLS);
/** Суша — углы поля. */
export const LAND = new Set([at(0, 0), at(10, 0), at(0, 9), at(10, 9)]);
export const sea = (p: number) => p >= 0 && p < N && !LAND.has(p);

export type Kind = 'bb' | 'cr' | 'gb' | 'dd' | 'ms' | 'ss';
/** Номер на поле, как в описании: 1 — броненосец … 6 — подлодка. */
export const NUM: Record<Kind, number> = { bb: 1, cr: 2, gb: 3, dd: 4, ms: 5, ss: 6 };
export const NAMES: Record<Kind, string> = { bb: 'броненосец', cr: 'крейсер', gb: 'канонерка', dd: 'миноносец', ms: 'тральщик', ss: 'подлодка' };
export const ACC: Record<Kind, string> = { bb: 'броненосец', cr: 'крейсер', gb: 'канонерку', dd: 'миноносец', ms: 'тральщик', ss: 'подлодку' };
const RANK: Record<Kind, number> = { bb: 6, cr: 5, gb: 4, dd: 3, ms: 2, ss: 0 };

/** Старше ли a, чем b: 1 — старше, 0 — равны, −1 — младше. */
export function senior(a: Kind, b: Kind): number {
  if (a === b) return 0;
  if (a === 'ss') return b === 'bb' || b === 'cr' ? 1 : -1;
  if (b === 'ss') return a === 'bb' || a === 'cr' ? -1 : 1;
  return Math.sign(RANK[a] - RANK[b]);
}

/** Направления: 0 — север, 1 — восток, 2 — юг, 3 — запад. */
const DV = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export function ahead(p: number, d: number): number {
  const c = col(p) + DV[d][0];
  const r = row(p) + DV[d][1];
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  const q = at(c, r);
  return sea(q) ? q : -1;
}

/** Куда пришёлся удар: dir — курс нападающего, vic — курс цели. */
export function hitAt(dir: number, vic: number): 'nose' | 'side' | 'stern' {
  if (vic === dir) return 'stern';
  if (vic === (dir + 2) % 4) return 'nose';
  return 'side';
}
export function canHit(a: Kind, dir: number, b: Kind, vic: number): boolean {
  const w = hitAt(dir, vic);
  if (w === 'stern') return false;
  if (w === 'side') return true;
  return senior(a, b) > 0;
}

/** Расстановка зелёных (место 0) — «у своих берегов», по цифрам описания; красные — поворот на 180°. */
const START: [number, number, Kind][] = [
  [0, 1, 'ms'],
  [0, 2, 'dd'],
  [0, 3, 'dd'],
  [0, 4, 'cr'],
  [0, 5, 'cr'],
  [0, 6, 'dd'],
  [0, 7, 'dd'],
  [0, 8, 'ss'],
  [1, 3, 'gb'],
  [1, 4, 'bb'],
  [1, 5, 'gb'],
  [2, 4, 'gb'],
];
/** Береговые пушки («взрыв»): в бухтах у своего берега. */
export const GUNS: [number[], number[]] = [[at(1, 0), at(2, 0), at(1, 9), at(2, 9)], []];
GUNS[1] = GUNS[0].map((p) => at(10 - col(p), 9 - row(p)));
export const START_CELLS: [Map<number, Kind>, Map<number, Kind>] = [new Map(START.map(([c, r, k]) => [at(c, r), k])), new Map(START.map(([c, r, k]) => [at(10 - c, 9 - r), k]))];

export const MINES = 3;
export const QUIET = 200;

export interface Ship {
  id: number;
  side: number;
  kind: Kind;
  p: number;
  dir: number;
}

export interface Cfg {
  /** Вероятность «взрыва» на кубике: 1, 2 или 3 грани из шести. */
  faces: number;
}
export function cfgFrom(o: Options): Cfg {
  const f = Number(o.faces);
  return { faces: f === 1 || f === 3 ? f : 2 };
}

export interface State {
  cfg: Cfg;
  ships: Ship[];
  mines: number[];
  /** Мины в запасе у каждого. */
  stock: [number, number];
  turn: number;
  /** Тральщик уже ставил/снимал мину в этот ход. */
  mined: boolean;
  over: boolean;
  winner: number | null;
  why: '' | 'fleet' | 'quiet';
  quiet: number;
  last: number[];
  /** Потоплено у каждого. */
  lost: [Kind[], Kind[]];
}

export type Action = { type: 'fwd'; id: number } | { type: 'turn'; id: number; d: 'l' | 'r' } | { type: 'mine'; id: number };

export type Event =
  | { type: 'fwd'; seat: number; id: number; from: number; to: number; took: Ship | null; rolls: { what: 'mine' | 'gun'; boom: boolean }[]; sunk: boolean }
  | { type: 'turn'; seat: number; id: number; d: 'l' | 'r' }
  | { type: 'mine'; seat: number; id: number; at: number; put: boolean }
  | { type: 'end'; winner: number | null; why: State['why'] };

export function newState(cfg: Cfg): State {
  const ships: Ship[] = [];
  for (const side of [0, 1]) for (const [p, kind] of START_CELLS[side]) ships.push({ id: ships.length, side, kind, p, dir: side === 0 ? 1 : 3 });
  return { cfg, ships, mines: [], stock: [MINES, MINES], turn: 0, mined: false, over: false, winner: null, why: '', quiet: 0, last: [], lost: [[], []] };
}

export const setup = (opts: Options) => newState(cfgFrom(opts));

export function toAct(s: State): number[] {
  return s.over ? [] : [s.turn];
}

/** Броски при заходе на узел q кораблём sh (пушки противника, мины). */
export function rollsAt(s: State, sh: Ship, q: number): ('mine' | 'gun')[] {
  if (sh.kind === 'ss') return [];
  const out: ('mine' | 'gun')[] = [];
  if (s.mines.includes(q) && sh.kind !== 'ms') out.push('mine');
  if (GUNS[1 - sh.side].includes(q)) out.push('gun');
  return out;
}

export function legal(s: State, seat: number): Action[] {
  if (s.over || s.turn !== seat) return [];
  const out: Action[] = [];
  for (const sh of s.ships) {
    if (sh.side !== seat) continue;
    const q = ahead(sh.p, sh.dir);
    if (q >= 0) {
      const t = s.ships.find((x) => x.p === q);
      if (!t || (t.side !== seat && canHit(sh.kind, sh.dir, t.kind, t.dir))) out.push({ type: 'fwd', id: sh.id });
    }
    out.push({ type: 'turn', id: sh.id, d: 'l' }, { type: 'turn', id: sh.id, d: 'r' });
    if (sh.kind === 'ms' && !s.mined && (s.mines.includes(sh.p) || s.stock[seat] > 0)) out.push({ type: 'mine', id: sh.id });
  }
  return out;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || typeof a !== 'object') return null;
  if (!legal(s0, seat).some((x) => x.type === a.type && x.id === a.id && (x.type !== 'turn' || (a.type === 'turn' && x.d === a.d)))) return null;
  const s: State = { ...s0, ships: s0.ships.map((x) => ({ ...x })), mines: [...s0.mines], stock: [...s0.stock] as [number, number], lost: [[...s0.lost[0]], [...s0.lost[1]]] };
  const sh = s.ships.find((x) => x.id === a.id)!;
  const events: Event[] = [];
  if (a.type === 'mine') {
    const put = !s.mines.includes(sh.p);
    if (put) {
      s.mines.push(sh.p);
      s.stock[seat]--;
    } else {
      s.mines = s.mines.filter((m) => m !== sh.p);
      s.stock[seat]++;
    }
    s.mined = true;
    events.push({ type: 'mine', seat, id: sh.id, at: sh.p, put });
    return { state: s, events };
  }
  let hit = false;
  if (a.type === 'turn') {
    sh.dir = (sh.dir + (a.d === 'r' ? 1 : 3)) % 4;
    s.last = [sh.p];
    events.push({ type: 'turn', seat, id: sh.id, d: a.d });
  } else {
    const from = sh.p;
    const q = ahead(sh.p, sh.dir);
    const t = s.ships.find((x) => x.p === q) ?? null;
    if (t) {
      s.ships = s.ships.filter((x) => x.id !== t.id);
      s.lost[t.side].push(t.kind);
      hit = true;
    }
    sh.p = q;
    // кубик: «взрыв» — первые faces граней из шести
    const rolls = rollsAt(s, sh, q).map((what) => ({ what, boom: rng.int(6) < s.cfg.faces }));
    const sunk = rolls.some((r) => r.boom);
    if (sunk) {
      s.ships = s.ships.filter((x) => x.id !== sh.id);
      s.lost[seat].push(sh.kind);
      hit = true;
    }
    s.last = [from, q];
    events.push({ type: 'fwd', seat, id: sh.id, from, to: q, took: t ? { ...t } : null, rolls, sunk });
  }
  s.quiet = hit ? 0 : s.quiet + 1;
  for (const side of [0, 1])
    if (!s.ships.some((x) => x.side === side)) {
      s.over = true;
      s.winner = 1 - side;
      s.why = 'fleet';
      events.push({ type: 'end', winner: 1 - side, why: 'fleet' });
      return { state: s, events };
    }
  // пока никто никого не потопил, флотам надо сойтись — предел вдвое больше
  if (s.quiet >= (s.lost[0].length + s.lost[1].length ? QUIET : QUIET * 2)) {
    // по очкам: у кого больше кораблей, при равенстве — у кого флот сильнее
    const n = (sd: number) => s.ships.filter((x) => x.side === sd).length;
    const w = (sd: number) => s.ships.filter((x) => x.side === sd).reduce((a, x) => a + 7 - NUM[x.kind], 0);
    const winner = n(0) !== n(1) ? (n(0) > n(1) ? 0 : 1) : w(0) !== w(1) ? (w(0) > w(1) ? 0 : 1) : null;
    s.over = true;
    s.winner = winner;
    s.why = 'quiet';
    events.push({ type: 'end', winner, why: 'quiet' });
    return { state: s, events };
  }
  s.turn = 1 - seat;
  s.mined = false;
  return { state: s, events };
}
