/* «Цена риска» (Супер игра, 90-е) — охотники ледникового периода в сдвигающемся лабиринте 7×7. Материалы и решения —
 * docs/analysis/materials-cenariska.md. Без DOM.
 *
 * Поле 7×7: 16 неподвижных тайлов (ряды и столбцы 0, 2, 4, 6; в углах — стоянки), 33 подвижных и 13 в запасе. Ход:
 * 1) сдвиг — тайл из запаса (вслепую) с любым поворотом вдвигается в ряд/столбец 1, 3, 5 с любого края, выпавший уходит
 * в запас (нельзя, если на выпадающей клетке стоит фишка); 2) манёвр — по открытым проходам на любое число клеток;
 * 3) действие на клетке остановки. Добыча проходима только с копьём, хищник — только с факелом (факел гаснет), охотник —
 * только по стрелке, камень непроходим. Победа — по туше на каждой из четырёх стоянок и вернуться на родную. */
import type { Options, Rng } from '../../core/types';

export const SIZE = 7;
export const N = SIZE * SIZE;
export const at = (r: number, c: number) => r * SIZE + c;
export const rowOf = (p: number) => Math.floor(p / SIZE);
export const colOf = (p: number) => p % SIZE;

export type Kind = 'I' | 'L' | 'T' | 'bison' | 'deer' | 'rhino' | 'mammoth' | 'hunter' | 'tiger' | 'lion' | 'rock' | 'rock2';
export type Prey = 'bison' | 'deer' | 'rhino' | 'mammoth';
export const PREY: Prey[] = ['mammoth', 'rhino', 'deer', 'bison'];
export const NAMES: Record<Prey, string> = { bison: 'бизон', deer: 'олень', rhino: 'носорог', mammoth: 'мамонт' };
export const ACC: Record<Prey, string> = { bison: 'бизона', deer: 'оленя', rhino: 'носорога', mammoth: 'мамонта' };

/** Открытые стороны при повороте 0: С=1, В=2, Ю=4, З=8. Картинки-тройники (звери, камни) нарисованы со стеной внизу. */
const BASE: Record<Kind, number> = { I: 10, L: 6, T: 14, bison: 10, deer: 10, rhino: 10, mammoth: 10, hunter: 10, tiger: 11, lion: 11, rock: 11, rock2: 11 };
const rot1 = (m: number) => ((m << 1) | (m >> 3)) & 15;
export function mask(k: Kind, rot: number): number {
  let m = BASE[k];
  for (let i = 0; i < rot; i++) m = rot1(m);
  return m;
}
export const isPrey = (k: Kind): k is Prey => k === 'bison' || k === 'deer' || k === 'rhino' || k === 'mammoth';
export const isBeast = (k: Kind) => k === 'tiger' || k === 'lion';
export const isRock = (k: Kind) => k === 'rock' || k === 'rock2';
/** Стрелка охотника: при повороте 0 — на восток (1); направления 0 — С, 1 — В, 2 — Ю, 3 — З. */
export const hunterDir = (rot: number) => (1 + rot) % 4;

export interface Tile {
  k: Kind;
  rot: number;
}

/** Неподвижные тайлы (по доске): стоянки — уголки в углах, остальные — тройники. */
const FIXED: [number, number, Tile][] = [
  [0, 0, { k: 'L', rot: 0 }],
  [0, 2, { k: 'T', rot: 0 }],
  [0, 4, { k: 'T', rot: 0 }],
  [0, 6, { k: 'L', rot: 1 }],
  [2, 0, { k: 'T', rot: 3 }],
  [2, 2, { k: 'T', rot: 3 }],
  [2, 4, { k: 'T', rot: 0 }],
  [2, 6, { k: 'T', rot: 1 }],
  [4, 0, { k: 'T', rot: 3 }],
  [4, 2, { k: 'T', rot: 2 }],
  [4, 4, { k: 'T', rot: 1 }],
  [4, 6, { k: 'T', rot: 1 }],
  [6, 0, { k: 'L', rot: 3 }],
  [6, 2, { k: 'T', rot: 2 }],
  [6, 4, { k: 'T', rot: 2 }],
  [6, 6, { k: 'L', rot: 2 }],
];
/** Цвета стоянок на доске: жёлтая, бирюзовая, зелёная, оранжевая. */
export const COLORS = ['#f2c21a', '#1fa3a8', '#4a9a2a', '#f05a22'];
/** Стоянки: место 0 — левый верхний угол, дальше по часовой. */
export const CAMPS = [at(0, 0), at(0, 6), at(6, 6), at(6, 0)];
export const isFixed = (p: number) => rowOf(p) % 2 === 0 && colOf(p) % 2 === 0;

/** Подвижные тайлы по фото коробки (+ мамонт): 12 прямых, 15 углов, 7 тройников, 4 добычи, 4 охотника, 2 хищника, 2 камня. */
export function deck(): Kind[] {
  const out: Kind[] = [];
  const add = (k: Kind, n: number) => {
    for (let i = 0; i < n; i++) out.push(k);
  };
  add('I', 12);
  add('L', 15);
  add('T', 7);
  for (const p of PREY) add(p, 1);
  add('hunter', 4);
  add('tiger', 1);
  add('lion', 1);
  add('rock', 1);
  add('rock2', 1);
  return out;
}

/** Сдвиги: 12 стрелок. Ряды 1, 3, 5 — слева (вправо) и справа (влево); столбцы — сверху и снизу. */
export interface Slot {
  line: 'row' | 'col';
  i: number;
  /** +1 — с начала (слева/сверху), −1 — с конца. */
  from: number;
}
export const SLOTS: Slot[] = [1, 3, 5].flatMap((i) => [
  { line: 'row', i, from: 1 },
  { line: 'row', i, from: -1 },
  { line: 'col', i, from: 1 },
  { line: 'col', i, from: -1 },
]) as Slot[];
export function lineCells(sl: Slot): number[] {
  const cells = Array.from({ length: SIZE }, (_, k) => (sl.line === 'row' ? at(sl.i, k) : at(k, sl.i)));
  return sl.from === 1 ? cells : cells.reverse();
}

export interface Player {
  seat: number;
  p: number;
  spear: boolean;
  torch: boolean;
  /** Туши в руках. */
  carry: Prey[];
  /** Убитые звери (туша в руках или уже на стоянке) — второго такого не взять. */
  killed: Prey[];
  /** Где лежат туши игрока: стоянка → зверь. */
  laid: Record<number, Prey>;
}

export interface Cfg {
  /** Быстрая игра: туш не носят — достаточно побывать на всех стоянках; копьё тратится при проходе через зверя. */
  quick: boolean;
}
export function cfgFrom(o: Options): Cfg {
  return { quick: o.mode === 'quick' };
}

export interface State {
  cfg: Cfg;
  board: Tile[];
  stock: Kind[];
  /** Тайл, вытянутый из запаса на этот ход. */
  hand: Kind | null;
  players: Player[];
  turn: number;
  phase: 'shift' | 'move' | 'act' | 'over';
  /** Последний сдвиг (стрелка) — для подсветки.*/
  lastSlot: number;
  winner: number | null;
  turns: number;
  /** Добыча на клетке остановки, которую можно убить. */
  prey: Prey | null;
  last: number[];
  /** Быстрая игра: на каких стоянках побывал игрок. */
  visited: number[][];
}

export type Action = { type: 'shift'; slot: number; rot: number } | { type: 'move'; to: number } | { type: 'kill' } | { type: 'spare' };

export type Event =
  | { type: 'draw'; seat: number; tile: Kind }
  | { type: 'shift'; seat: number; slot: number; rot: number; out: Kind }
  | { type: 'move'; seat: number; path: number[]; torchLost: boolean; spear: boolean; torch: boolean; laid: Prey | null; spent: boolean }
  | { type: 'kill'; seat: number; prey: Prey }
  | { type: 'end'; winner: number };

/** Ничейный предел — столько ходов на всех. */
export const MAX_TURNS = 600;

function shuffle<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Места игроков по стоянкам: вдвоём — напротив друг друга. */
export function campOf(n: number, seat: number): number {
  const order = n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
  return CAMPS[order[seat]];
}

export function newState(cfg: Cfg, n: number, rng: Rng): State {
  const tiles = shuffle(deck(), rng);
  const board: Tile[] = Array(N);
  for (const [r, c, t] of FIXED) board[at(r, c)] = t;
  for (let p = 0; p < N; p++) if (!board[p]) board[p] = { k: tiles.pop()!, rot: rng.int(4) };
  const players: Player[] = Array.from({ length: n }, (_, seat) => ({ seat, p: campOf(n, seat), spear: false, torch: true, carry: [], killed: [], laid: {} }));
  const s: State = { cfg, board, stock: tiles, hand: null, players, turn: 0, phase: 'shift', lastSlot: -1, winner: null, turns: 0, prey: null, last: [], visited: players.map(() => []) };
  draw(s, rng, []);
  return s;
}

function draw(s: State, rng: Rng, events: Event[]) {
  const i = rng.int(s.stock.length);
  s.hand = s.stock[i];
  s.stock = s.stock.filter((_, k) => k !== i);
  events.push({ type: 'draw', seat: s.turn, tile: s.hand });
}

export const setup = (opts: Options, n: number, rng: Rng) => newState(cfgFrom(opts), n, rng);

export function toAct(s: State): number[] {
  return s.phase === 'over' ? [] : [s.turn];
}

/** Обратная стрелка к slot. */
export function opposite(slot: number): number {
  const a = SLOTS[slot];
  return SLOTS.findIndex((b) => b.line === a.line && b.i === a.i && b.from === -a.from);
}

export function slotOk(s: State, slot: number): boolean {
  const cells = lineCells(SLOTS[slot]);
  const outCell = cells[cells.length - 1];
  return !s.players.some((pl) => pl.p === outCell);
}

/** Сдвиг: тайл входит с начала линии, выпавший уходит в запас; фишки едут вместе с тайлами. */
export function shifted(s: State, slot: number, tile: Tile): { board: Tile[]; out: Kind; moves: Map<number, number> } {
  const cells = lineCells(SLOTS[slot]);
  const board = [...s.board];
  const out = board[cells[cells.length - 1]].k;
  for (let k = cells.length - 1; k > 0; k--) board[cells[k]] = board[cells[k - 1]];
  board[cells[0]] = tile;
  const moves = new Map<number, number>();
  for (let k = 0; k < cells.length - 1; k++) moves.set(cells[k], cells[k + 1]);
  return { board, out, moves };
}

const DIRV = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];
const BIT = [1, 2, 4, 8];
export function neighbor(p: number, d: number): number {
  const r = rowOf(p) + DIRV[d][0];
  const c = colOf(p) + DIRV[d][1];
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1;
  return at(r, c);
}

/** Куда может дойти игрок: поиск в ширину по (клетка, факел). */
export function reach(board: Tile[], pl: Player, cfg: Cfg): Map<number, { path: number[]; torch: boolean }> {
  type Node = { p: number; torch: boolean; spear: boolean; path: number[] };
  const best = new Map<string, true>();
  const out = new Map<number, { path: number[]; torch: boolean }>();
  const start: Node = { p: pl.p, torch: pl.torch, spear: pl.spear, path: [] };
  out.set(pl.p, { path: [], torch: pl.torch });
  const q: Node[] = [start];
  best.set(`${pl.p}:${pl.torch ? 1 : 0}:${pl.spear ? 1 : 0}`, true);
  while (q.length) {
    const nd = q.shift()!;
    const here = board[nd.p];
    for (let d = 0; d < 4; d++) {
      if (!(mask(here.k, here.rot) & BIT[d])) continue;
      // с охотника — только по стрелке
      if (here.k === 'hunter' && hunterDir(here.rot) !== d) continue;
      const nb = neighbor(nd.p, d);
      if (nb < 0) continue;
      const t = board[nb];
      if (!(mask(t.k, t.rot) & BIT[(d + 2) % 4])) continue;
      if (isRock(t.k)) continue;
      if (t.k === 'hunter' && hunterDir(t.rot) !== d) continue; // входить — по стрелке
      let torch = nd.torch;
      let spear = nd.spear;
      if (isPrey(t.k)) {
        if (!spear) continue;
        if (cfg.quick) spear = false;
      }
      if (isBeast(t.k)) {
        if (!torch) continue;
        torch = false;
      }
      const key = `${nb}:${torch ? 1 : 0}:${spear ? 1 : 0}`;
      if (best.has(key)) continue;
      best.set(key, true);
      const path = [...nd.path, nb];
      const prev = out.get(nb);
      if (!prev || (!prev.torch && torch) || (prev.torch === torch && prev.path.length > path.length)) out.set(nb, { path, torch });
      // в быстрой игре через зверя копьё тратится — дальше без копья
      q.push({ p: nb, torch, spear, path });
    }
  }
  return out;
}

function clone(s: State): State {
  return {
    ...s,
    board: [...s.board],
    stock: [...s.stock],
    players: s.players.map((p) => ({ ...p, carry: [...p.carry], killed: [...p.killed], laid: { ...p.laid } })),
    visited: s.visited.map((v) => [...v]),
    last: [...s.last],
  };
}

export function legal(s: State, seat: number): Action[] {
  if (s.phase === 'over' || seat !== s.turn) return [];
  const out: Action[] = [];
  if (s.phase === 'shift') {
    for (let slot = 0; slot < SLOTS.length; slot++) if (slotOk(s, slot)) for (let rot = 0; rot < 4; rot++) out.push({ type: 'shift', slot, rot });
    return out;
  }
  if (s.phase === 'move') {
    for (const p of reach(s.board, s.players[seat], s.cfg).keys()) out.push({ type: 'move', to: p });
    return out;
  }
  if (s.phase === 'act') return [{ type: 'kill' }, { type: 'spare' }];
  return out;
}

/** Победил ли игрок: туши на всех четырёх стоянках (в быстрой — побывал на всех) и стоит на родной. */
export function won(s: State, seat: number): boolean {
  const pl = s.players[seat];
  if (pl.p !== campOf(s.players.length, seat)) return false;
  if (s.cfg.quick) return CAMPS.every((c) => s.visited[seat].includes(c));
  return CAMPS.every((c) => pl.laid[c] != null);
}

function endTurn(s: State, rng: Rng, events: Event[]) {
  if (won(s, s.turn)) {
    s.phase = 'over';
    s.winner = s.turn;
    events.push({ type: 'end', winner: s.turn });
    return;
  }
  s.turn = (s.turn + 1) % s.players.length;
  s.turns++;
  if (s.turns >= MAX_TURNS) {
    // по числу выложенных туш
    const score = (pl: Player) => (s.cfg.quick ? s.visited[pl.seat].length : Object.keys(pl.laid).length);
    const best = Math.max(...s.players.map(score));
    s.phase = 'over';
    s.winner = s.players.findIndex((pl) => score(pl) === best);
    events.push({ type: 'end', winner: s.winner });
    return;
  }
  s.phase = 'shift';
  s.prey = null;
  draw(s, rng, events);
}

/** Действия на клетке остановки (кроме убийства добычи — его выбирает игрок). */
function stopAt(s: State, pl: Player, ev: Extract<Event, { type: 'move' }>) {
  const t = s.board[pl.p];
  if (t.k === 'hunter' && !pl.spear) {
    pl.spear = true;
    ev.spear = true;
  }
  if (CAMPS.includes(pl.p)) {
    if (s.cfg.quick) {
      if (!s.visited[pl.seat].includes(pl.p)) s.visited[pl.seat].push(pl.p);
    } else if (pl.laid[pl.p] == null && pl.carry.length) {
      const prey = pl.carry.shift()!;
      pl.laid[pl.p] = prey;
      ev.laid = prey;
    }
    if (!pl.torch) {
      pl.torch = true;
      ev.torch = true;
    }
  }
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.phase === 'over' || seat !== s0.turn) return null;
  const s = clone(s0);
  const events: Event[] = [];
  if (s.phase === 'shift' && a.type === 'shift') {
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= SLOTS.length || ![0, 1, 2, 3].includes(a.rot) || !slotOk(s0, a.slot)) return null;
    const r = shifted(s0, a.slot, { k: s.hand!, rot: a.rot });
    s.board = r.board;
    for (const pl of s.players) if (r.moves.has(pl.p)) pl.p = r.moves.get(pl.p)!;
    s.stock.push(r.out);
    s.hand = null;
    s.lastSlot = a.slot;
    s.phase = 'move';
    events.push({ type: 'shift', seat, slot: a.slot, rot: a.rot, out: r.out });
    return { state: s, events };
  }
  if (s.phase === 'move' && a.type === 'move') {
    const pl = s.players[seat];
    const r = reach(s0.board, s0.players[seat], s.cfg).get(a.to);
    if (!r) return null;
    const ev: Extract<Event, { type: 'move' }> = { type: 'move', seat, path: r.path, torchLost: pl.torch && !r.torch, spear: false, torch: false, laid: null, spent: false };
    pl.p = a.to;
    pl.torch = r.torch;
    if (s.cfg.quick && pl.spear && r.path.some((p) => isPrey(s.board[p].k))) {
      pl.spear = false;
      ev.spent = true;
    }
    s.last = [s0.players[seat].p, a.to];
    events.push(ev);
    const t = s.board[pl.p];
    if (!s.cfg.quick && isPrey(t.k) && pl.spear && !pl.killed.includes(t.k)) {
      s.prey = t.k;
      s.phase = 'act';
      return { state: s, events };
    }
    stopAt(s, pl, ev);
    endTurn(s, rng, events);
    return { state: s, events };
  }
  if (s.phase === 'act' && (a.type === 'kill' || a.type === 'spare')) {
    const pl = s.players[seat];
    if (a.type === 'kill' && s.prey) {
      pl.spear = false;
      pl.carry.push(s.prey);
      pl.killed.push(s.prey);
      events.push({ type: 'kill', seat, prey: s.prey });
    }
    s.prey = null;
    endTurn(s, rng, events);
    return { state: s, events };
  }
  return null;
}
