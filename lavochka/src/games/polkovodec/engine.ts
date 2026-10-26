/* «Полководец» — движок. Правила — брошюра (с. 3–6), таблица родов войск; разбор и решения —
 * docs/analysis/materials-polkovodec.md. Без DOM.
 *
 * Поле 36×27 клеток, ходят по прямой и по диагонали. Ход игрока — приказы: каждый генерал и маршал отдаёт по одному приказу
 * за ход, приказ двигает одну фигуру в зоне 13×13 вокруг него (или самого командира). Бой — шахматное взятие по таблице:
 * пехота и кавалерия занимают клетку побитой фигуры, артиллерия бьёт до 5 клеток и остаётся на месте. Кубиков нет.
 * Дороги удваивают ход (но после такого марша бить нельзя), горы, лес и болото закрыты для кавалерии и артиллерии, река —
 * для артиллерии, на реке два хода подряд — утонул. Крепость, удержанная два хода, захвачена: 5 складов за клетку.
 * Маршал убит — новый за 15 складов в своей крепости, иначе армия капитулирует. */
import type { Options, Rng } from '../../core/types';
import { COLS, FORTS, ROWS, TERRAIN } from './terrain';

export const N = COLS * ROWS;
export const at = (c: number, r: number) => r * COLS + c;
export const col = (p: number) => p % COLS;
export const row = (p: number) => Math.floor(p / COLS);
export const ter = (p: number) => TERRAIN[row(p)][col(p)];

export type Kind = 'musk' | 'gren' | 'jager' | 'jgren' | 'dragoon' | 'hussar' | 'ulan' | 'cossack' | 'cuir' | 'gun' | 'hart' | 'general' | 'marshal';
export const UNITS: Kind[] = ['musk', 'gren', 'jager', 'jgren', 'dragoon', 'hussar', 'ulan', 'cossack', 'cuir', 'gun', 'hart'];
/** Названия по армиям: русская, французская, австрийская. */
export const NAMES: Record<Kind, [string, string, string]> = {
  musk: ['мушкетёр', 'фузелёр', 'фузелёр'],
  gren: ['гренадер', 'гренадер', 'гренадер'],
  jager: ['егерь', 'вольтижёр', 'егерь'],
  jgren: ['гренадер егерского полка', 'карабинер', 'граничар'],
  dragoon: ['драгун', 'драгун', 'драгун'],
  hussar: ['гусар', 'гусар', 'гусар'],
  ulan: ['улан', 'улан', 'улан'],
  cossack: ['казак', 'конный егерь', 'лёгкий драгун'],
  cuir: ['кирасир', 'кирасир', 'кирасир'],
  gun: ['единорог', 'орудие', 'орудие'],
  hart: ['конная артиллерия', 'конная артиллерия', 'ездящая артиллерия'],
  general: ['генерал', 'генерал', 'генерал'],
  marshal: ['фельдмаршал', 'маршал', 'фельдмаршал'],
};
/** Стоимость в полковых складах (×2, чтобы дивизионный 2,5 был целым): полковой 2, дивизионный 5, корпусной 10, армейский 20. */
export const COST: Record<Kind, number> = { musk: 2, gren: 4, jager: 4, jgren: 5, dragoon: 6, hussar: 6, ulan: 6, cossack: 7, cuir: 8, gun: 20, hart: 30, general: 10, marshal: 30 };

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
type Ray = { d: number[]; n: number };
const rays = (dirs: number[][], n: number): Ray[] => dirs.map((d) => ({ d, n }));
/** Манёвр по таблице: направления и дальность. */
export const MOVE: Record<Kind, Ray[]> = {
  musk: rays([...ORTHO, ...DIAG], 1),
  gren: rays([...ORTHO, ...DIAG], 1),
  jager: rays([...ORTHO, ...DIAG], 1),
  jgren: rays([...ORTHO, ...DIAG], 1),
  dragoon: [...rays(DIAG, 2), ...rays(ORTHO, 1)],
  hussar: rays(DIAG, 3),
  ulan: rays(DIAG, 3),
  cossack: rays(DIAG, 3),
  cuir: rays(ORTHO, 4),
  gun: rays([...ORTHO, ...DIAG], 1),
  hart: [...rays(DIAG, 2), ...rays(ORTHO, 1)],
  general: rays([...ORTHO, ...DIAG], 1),
  marshal: rays([...ORTHO, ...DIAG], 1),
};
/** Поражение по таблице. */
export const HIT: Record<Kind, Ray[]> = {
  musk: rays(DIAG, 1),
  gren: rays([...ORTHO, ...DIAG], 1),
  jager: rays(DIAG, 1),
  jgren: rays([...ORTHO, ...DIAG], 1),
  dragoon: [...rays(DIAG, 2), ...rays(ORTHO, 1)],
  hussar: rays(DIAG, 3),
  ulan: rays(DIAG, 3),
  cossack: rays(DIAG, 3),
  cuir: rays(ORTHO, 4),
  gun: rays([...ORTHO, ...DIAG], 5),
  hart: rays([...ORTHO, ...DIAG], 5),
  general: [],
  marshal: [],
};
export const isArt = (k: Kind) => k === 'gun' || k === 'hart';
export const isCav = (k: Kind) => k === 'dragoon' || k === 'hussar' || k === 'ulan' || k === 'cossack' || k === 'cuir';
/** Лёгкие (егерские и конно-егерские) — ходят и воюют где угодно. */
export const isLight = (k: Kind) => k === 'jager' || k === 'jgren' || k === 'cossack';
export const isCmd = (k: Kind) => k === 'general' || k === 'marshal';

/** Может ли фигура стоять / проходить клетку. */
export function canEnter(k: Kind, p: number): boolean {
  const t = ter(p);
  if (isLight(k) || isCmd(k)) return true;
  if (isCav(k) || isArt(k)) {
    if (t === 'M' || t === 'L' || t === 'S') return false;
    if (isArt(k) && t === 'W') return false;
  }
  return true;
}
/** Может ли фигура вести бой с этой клетки / по этой клетке. */
export function canFight(k: Kind, p: number): boolean {
  const t = ter(p);
  if (isLight(k)) return true;
  return t !== 'M' && t !== 'L';
}
const isRoad = (p: number) => {
  const t = ter(p);
  return t === 'R' || t === 'B' || t === 'F';
};

export interface Piece {
  id: number;
  side: number;
  army: number;
  kind: Kind;
  p: number;
  /** Сколько своих ходов подряд стоит на реке. */
  wet: number;
}

export interface Fort {
  name: string;
  cells: number[];
  owner: number;
  /** Кто держит крепость и сколько ходов подряд (для захвата). */
  holder: number;
  held: number;
}

export interface Cfg {
  /** Размер армии: малая / обычная / большая. */
  size: 'small' | 'normal' | 'big';
  goal: 'rout' | 'forts';
}
export function cfgFrom(o: Options): Cfg {
  return { size: o.size === 'small' || o.size === 'big' ? o.size : 'normal', goal: o.goal === 'forts' ? 'forts' : 'rout' };
}

export interface State {
  cfg: Cfg;
  players: number;
  /** Армия каждого места: 0 — русская, 1 — французская, 2 — австрийская. */
  armies: number[];
  pieces: Piece[];
  forts: Fort[];
  /** Склады (×2) в стратегическом запасе. */
  stock: number[];
  turn: number;
  /** Командиры, уже отдавшие приказ в этот ход. */
  used: number[];
  alive: boolean[];
  over: boolean;
  winner: number | null;
  turns: number;
  last: number[];
  nextId: number;
}

export type Action =
  | { type: 'move'; id: number; to: number }
  | { type: 'hit'; id: number; to: number }
  | { type: 'recruit'; kind: Kind; at: number }
  | { type: 'end' };

export type Event =
  | { type: 'move'; seat: number; id: number; kind: Kind; from: number; to: number; took: Piece | null; by: number }
  | { type: 'hit'; seat: number; id: number; kind: Kind; from: number; to: number; took: Piece; by: number }
  | { type: 'recruit'; seat: number; kind: Kind; at: number }
  | { type: 'drown'; seat: number; kind: Kind; at: number }
  | { type: 'fort'; seat: number; name: string; loot: number }
  | { type: 'marshal'; seat: number; at: number }
  | { type: 'capitulate'; seat: number }
  | { type: 'end'; winner: number | null };

export const MAX_TURNS = 80;
const ZONE = 6;

/** Территория места: столбцы. Вдвоём — левая и правая половины, втроём — три листа. */
export function zoneCols(players: number, seat: number): [number, number] {
  const w = COLS / players;
  return [Math.round(seat * w), Math.round((seat + 1) * w) - 1];
}

const ARMY: Record<Cfg['size'], [Kind, number][]> = {
  small: [['marshal', 1], ['general', 2], ['musk', 4], ['gren', 2], ['jager', 2], ['dragoon', 1], ['hussar', 2], ['cuir', 1], ['gun', 1]],
  normal: [['marshal', 1], ['general', 3], ['musk', 6], ['gren', 2], ['jager', 2], ['jgren', 1], ['dragoon', 2], ['hussar', 2], ['ulan', 1], ['cossack', 1], ['cuir', 1], ['gun', 2], ['hart', 1]],
  big: [['marshal', 1], ['general', 4], ['musk', 8], ['gren', 3], ['jager', 3], ['jgren', 2], ['dragoon', 2], ['hussar', 3], ['ulan', 2], ['cossack', 2], ['cuir', 2], ['gun', 3], ['hart', 1]],
};
const STOCK: Record<Cfg['size'], number> = { small: 40, normal: 60, big: 100 };

export function newState(cfg: Cfg, players: number): State {
  const forts: Fort[] = FORTS.map((f) => {
    const cells = f.cells.map(([c, r]) => at(c, r));
    let owner = -1;
    for (let s = 0; s < players; s++) {
      const [a, b] = zoneCols(players, s);
      if (cells.every((p) => col(p) >= a && col(p) <= b)) owner = s;
    }
    return { name: f.name, cells, owner, holder: owner, held: 0 };
  });
  const s: State = { cfg, players, armies: Array.from({ length: players }, (_, i) => i), pieces: [], forts, stock: Array(players).fill(STOCK[cfg.size]), turn: 0, used: [], alive: Array(players).fill(true), over: false, winner: null, turns: 0, last: [], nextId: 1 };
  for (let side = 0; side < players; side++) deploy(s, side);
  return s;
}

/** Расстановка: строем от своих крепостей к противнику. Пехота впереди, артиллерия и командиры за ней, кавалерия по флангам. */
function deploy(s: State, side: number) {
  const [a, b] = zoneCols(s.players, side);
  const front = side === 0 ? b - 2 : side === s.players - 1 ? a + 2 : Math.round((a + b) / 2);
  const back = side === 0 ? -1 : 1;
  const free = (p: number, k: Kind) => !s.pieces.some((x) => x.p === p) && canEnter(k, p) && ter(p) !== 'W';
  const list: Kind[] = [];
  for (const [k, n] of ARMY[s.cfg.size]) for (let i = 0; i < n; i++) list.push(k);
  const order = (k: Kind) => (UNITS.includes(k) ? (isCav(k) ? 2 : isArt(k) ? 1 : 0) : 3);
  list.sort((x, y) => order(x) - order(y));
  const lines = [0, 1, 2, 3, 4].map((d) => front + back * d);
  const rowsOrder = Array.from({ length: ROWS }, (_, i) => 13 + (i % 2 ? (i + 1) / 2 : -i / 2)).filter((r) => r >= 0 && r < ROWS);
  for (const k of list) {
    const line = order(k) === 0 ? [0, 1] : order(k) === 1 ? [1, 2] : order(k) === 2 ? [2, 3] : [3, 4];
    let placed = false;
    for (const li of line) {
      for (const r of order(k) === 2 ? [...rowsOrder].reverse() : rowsOrder) {
        const p = at(lines[li], r);
        if (free(p, k)) {
          s.pieces.push({ id: s.nextId++, side, army: s.armies[side], kind: k, p, wet: 0 });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
  }
}

export const setup = (opts: Options, players: number) => newState(cfgFrom(opts), players);

export function toAct(s: State): number[] {
  return s.over ? [] : [s.turn];
}

const pieceAt = (s: State, p: number) => s.pieces.find((x) => x.p === p);
const cheb = (a: number, b: number) => Math.max(Math.abs(col(a) - col(b)), Math.abs(row(a) - row(b)));

/** Командир, который может отдать приказ фигуре (ещё не приказывал, фигура в его зоне); сам командир — только себе. */
export function commanderFor(s: State, pc: Piece): Piece | null {
  if (isCmd(pc.kind)) return s.used.includes(pc.id) ? null : pc;
  let best: Piece | null = null;
  for (const c of s.pieces) {
    if (c.side !== pc.side || !isCmd(c.kind) || s.used.includes(c.id)) continue;
    if (cheb(c.p, pc.p) > ZONE) continue;
    // в первую очередь тратим приказ генерала, маршала бережём
    if (!best || (best.kind === 'marshal' && c.kind === 'general') || (best.kind === c.kind && cheb(c.p, pc.p) < cheb(best.p, pc.p))) best = c;
  }
  return best;
}

/** Ходы фигуры: клетка → дорожный марш (без права боя). */
export function moves(s: State, pc: Piece): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const { d, n } of MOVE[pc.kind]) {
    let q = pc.p;
    let road = isRoad(pc.p);
    for (let k = 1; k <= n * 2; k++) {
      const c = col(q) + d[0];
      const r = row(q) + d[1];
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) break;
      q = at(c, r);
      if (!canEnter(pc.kind, q) || pieceAt(s, q)) break;
      road = road && isRoad(q);
      if (k > n && !road) break;
      out.set(q, k > n);
    }
  }
  return out;
}

/** Цели боя: клетки чужих фигур. */
export function hits(s: State, pc: Piece): number[] {
  if (!canFight(pc.kind, pc.p)) return [];
  const out: number[] = [];
  for (const { d, n } of HIT[pc.kind]) {
    let q = pc.p;
    for (let k = 1; k <= n; k++) {
      const c = col(q) + d[0];
      const r = row(q) + d[1];
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) break;
      q = at(c, r);
      const t = pieceAt(s, q);
      if (t) {
        if (t.side !== pc.side && canFight(pc.kind, q) && (isArt(pc.kind) || canEnter(pc.kind, q))) out.push(q);
        break;
      }
      // артиллерия не бьёт через крепость, горы и лес; остальные — пройти путь
      if (isArt(pc.kind) ? 'FML'.includes(ter(q)) : !canEnter(pc.kind, q)) break;
    }
  }
  return out;
}

/** Командир, отдающий приказ на формирование в клетке p (зона 13×13). */
function recruiter(s: State, side: number, p: number): Piece | undefined {
  return s.pieces.find((c) => c.side === side && isCmd(c.kind) && !s.used.includes(c.id) && cheb(c.p, p) <= ZONE);
}

/** Свободные клетки своей крепости для формирования (и ближайшие к ней). */
export function recruitCells(s: State, side: number): number[] {
  const out: number[] = [];
  for (const f of s.forts) {
    if (f.owner !== side || f.holder !== side) continue;
    if (f.cells.some((p) => pieceAt(s, p)?.side !== undefined && pieceAt(s, p)!.side !== side)) continue;
    for (const p of f.cells) if (!pieceAt(s, p) && recruiter(s, side, p)) out.push(p);
  }
  return out;
}

export function legal(s: State, seat: number): Action[] {
  if (s.over || seat !== s.turn) return [];
  const out: Action[] = [{ type: 'end' }];
  for (const pc of s.pieces) {
    if (pc.side !== seat || !commanderFor(s, pc)) continue;
    for (const q of moves(s, pc).keys()) out.push({ type: 'move', id: pc.id, to: q });
    for (const q of hits(s, pc)) out.push({ type: 'hit', id: pc.id, to: q });
  }
  const cells = recruitCells(s, seat);
  if (cells.length) for (const k of [...UNITS, 'general' as Kind]) if (COST[k] <= s.stock[seat]) for (const p of cells) if (canEnter(k, p)) out.push({ type: 'recruit', kind: k, at: p });
  return out;
}

function clone(s: State): State {
  return { ...s, pieces: s.pieces.map((p) => ({ ...p })), forts: s.forts.map((f) => ({ ...f })), stock: [...s.stock], used: [...s.used], alive: [...s.alive], last: [...s.last], armies: [...s.armies] };
}

/** Снять фигуру; убит маршал — новый за 15 складов в своей крепости, иначе капитуляция. */
function remove(s: State, t: Piece, events: Event[]) {
  s.pieces = s.pieces.filter((x) => x.id !== t.id);
  if (t.kind !== 'marshal') return;
  const side = t.side;
  const spot = s.forts.filter((f) => f.owner === side && f.holder === side).flatMap((f) => f.cells).find((p) => !pieceAt(s, p));
  if (s.stock[side] >= COST.marshal && spot != null) {
    s.stock[side] -= COST.marshal;
    s.pieces.push({ id: s.nextId++, side, army: s.armies[side], kind: 'marshal', p: spot, wet: 0 });
    events.push({ type: 'marshal', seat: side, at: spot });
    return;
  }
  s.alive[side] = false;
  s.pieces = s.pieces.filter((x) => x.side !== side);
  events.push({ type: 'capitulate', seat: side });
}

function endTurn(s: State, events: Event[]) {
  const side = s.turn;
  // утопление: своя фигура на реке второй ход подряд
  for (const pc of [...s.pieces]) {
    if (pc.side !== side) continue;
    if (ter(pc.p) === 'W') {
      pc.wet++;
      if (pc.wet >= 2) {
        events.push({ type: 'drown', seat: side, kind: pc.kind, at: pc.p });
        remove(s, pc, events);
      }
    } else pc.wet = 0;
  }
  // крепости: кто стоит внутри один — держит; два хода подряд — захват
  for (const f of s.forts) {
    const sides = new Set(f.cells.map((p) => pieceAt(s, p)?.side).filter((x): x is number => x != null));
    if (sides.size === 1) {
      const h = [...sides][0];
      if (h === f.holder) f.held++;
      else {
        f.holder = h;
        f.held = 1;
      }
      if (f.holder !== f.owner && f.held >= 2) {
        const loot = f.cells.length * 10;
        f.owner = f.holder;
        s.stock[f.owner] += loot;
        events.push({ type: 'fort', seat: f.owner, name: f.name, loot });
      }
    }
  }
  s.used = [];
  const alive = s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) return finish(s, alive[0], events);
  for (let k = 0; k < s.players; k++) {
    s.turn = (s.turn + 1) % s.players;
    if (s.turn === 0) s.turns++;
    if (s.alive[s.turn]) break;
  }
  if (s.turns >= MAX_TURNS) {
    const score = (side: number) =>
      s.cfg.goal === 'forts' ? s.forts.filter((f) => f.owner === side).length * 1000 + worth(s, side) : worth(s, side) + s.stock[side];
    let best = -1;
    let bv = -1;
    for (const side of alive) {
      const v = score(side);
      if (v > bv) {
        bv = v;
        best = side;
      } else if (v === bv) best = -1;
    }
    finish(s, best < 0 ? null : best, events);
  }
}

export const worth = (s: State, side: number) => s.pieces.filter((p) => p.side === side).reduce((a, p) => a + COST[p.kind], 0);

function finish(s: State, winner: number | null, events: Event[]) {
  s.over = true;
  s.winner = winner;
  events.push({ type: 'end', winner });
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.over || seat !== s0.turn) return null;
  void rng;
  const s = clone(s0);
  const events: Event[] = [];
  if (a.type === 'end') {
    endTurn(s, events);
    return { state: s, events };
  }
  if (a.type === 'recruit') {
    if (!Number.isInteger(a.at) || !recruitCells(s0, seat).includes(a.at) || !(UNITS.includes(a.kind) || a.kind === 'general') || COST[a.kind] > s.stock[seat] || !canEnter(a.kind, a.at)) return null;
    const cmd = recruiter(s, seat, a.at);
    s.stock[seat] -= COST[a.kind];
    const np: Piece = { id: s.nextId++, side: seat, army: s.armies[seat], kind: a.kind, p: a.at, wet: 0 };
    s.pieces.push(np);
    // формирование тратит приказ командира; новый генерал приходит сам и приказ не тратит
    if (a.kind !== 'general' && cmd) s.used.push(cmd.id);
    s.used.push(np.id);
    s.last = [a.at];
    events.push({ type: 'recruit', seat, kind: a.kind, at: a.at });
  } else {
    const pc = s.pieces.find((x) => x.id === a.id);
    if (!pc || pc.side !== seat) return null;
    const pc0 = s0.pieces.find((x) => x.id === a.id)!;
    const cmd = commanderFor(s0, pc0);
    if (!cmd) return null;
    const from = pc.p;
    if (a.type === 'move') {
      if (!moves(s0, pc0).has(a.to)) return null;
      pc.p = a.to;
      events.push({ type: 'move', seat, id: pc.id, kind: pc.kind, from, to: a.to, took: null, by: cmd.id });
    } else if (a.type === 'hit') {
      if (!hits(s0, pc0).includes(a.to)) return null;
      const t = pieceAt(s, a.to)!;
      if (!isArt(pc.kind)) pc.p = a.to;
      events.push({ type: 'hit', seat, id: pc.id, kind: pc.kind, from, to: a.to, took: { ...t }, by: cmd.id });
      remove(s, t, events);
    } else return null;
    s.used.push(cmd.id);
    s.last = [from, a.to];
  }
  const alive = s.alive.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) {
    finish(s, alive[0], events);
    return { state: s, events };
  }
  // приказов больше нет — ход переходит сам
  if (legal(s, seat).every((x) => x.type === 'end')) endTurn(s, events);
  return { state: s, events };
}
