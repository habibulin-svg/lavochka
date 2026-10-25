/* «Идут танки» — движок. Материалы и решения — docs/analysis/materials-tanki.md; разметка поля — map.ts. Без DOM.
 *
 * Зелёные (место 0) стартуют снизу, красные (место 1) — сверху; цель — провести танки по дорогам на большие кружки
 * соперника. Ход — либо танки: кубик «1:3» бросают столько раз, сколько танков может ходить, после каждого броска один танк
 * (каждый — раз за ход) едет вперёд на выпавшее число кружков (свернул на перекрёстке — на кружок меньше; развернуться —
 * потратить ход танка без броска), — либо полёт самолёта над дугой, где стоит танк соперника. Мины соперника: «Т-Р» —
 * танк разбит, «Л-П» — стоп и пропуск хода танка, «Н-С» — не сработала. Остановился на разрушенном мосту — провалился:
 * следующий ход игрока пропускается. Вариант без кубика: все танки ходят на 1, 2, 3 и 4 кружка в любом порядке. */
import type { Options, Rng } from '../../core/types';
import { ARCS, BRIDGES, CROSS, LINKS, N, ROADS, STARTS } from './map';

export type MineLabel = 'tr' | 'lp' | 'ns';
export type RocketLabel = 'hit' | 'miss';

export interface Tank {
  id: number;
  side: number;
  p: number;
  /** Дорога и направление по ней (+1 — вниз по списку дороги, −1 — вверх). */
  road: number;
  dir: number;
  state: 'board' | 'done' | 'dead';
  /** Ремонт после «Л-П»: пропускает ближайший ход своей стороны. */
  repair: boolean;
}

export interface Mine {
  p: number;
  side: number;
  /** Метка; в view — null (её не знает никто, пока не наехали). */
  label: MineLabel | null;
}

export interface Cfg {
  dice: boolean;
}
export function cfgFrom(o: Options): Cfg {
  return { dice: o.mode !== 'fixed' };
}

/** Ничья по пределу: столько ходов сторон. */
export const MAX_TURNS = 300;

export interface State {
  cfg: Cfg;
  tanks: Tank[];
  mines: Mine[];
  /** Ракеты: [сторона] → метка для каждой дуги её половины (в порядке ARCS этой стороны); чужие в view — null. */
  rockets: [(RocketLabel | null)[], (RocketLabel | null)[]];
  /** Самолёты: [сторона] → номер аэродрома (0 — левый, 1 — правый) или −1 — сбит. */
  planes: [number[], number[]];
  side: number;
  phase: 'turn' | 'move' | 'rockets' | 'return' | 'over';
  /** Выпавшее число (или в варианте без кубика — оставшиеся числа). */
  roll: number;
  left: number[];
  /** Танки, уже ходившие в этот ход. */
  moved: number[];
  /** Сколько бросков осталось. */
  rolls: number;
  /** Провалился на мосту — следующий ход стороны пропускается. */
  skip: [boolean, boolean];
  /** Кто решает о ракетах после полёта (фаза rockets) — хозяин ракет. */
  rocketsBy: number;
  winner: number | null;
  why: '' | 'tanks' | 'count' | 'limit';
  turns: number;
  lostPlanes: [number, number];
  last: number[];
}

export type Action =
  | { type: 'roll' }
  | { type: 'move'; id: number; path: number[]; value?: number }
  | { type: 'reverse'; id: number; value?: number }
  | { type: 'pass' }
  | { type: 'fly'; plane: number; arc: number }
  | { type: 'swap'; a: number; b: number }
  | { type: 'keep' }
  | { type: 'return'; at: number }
  | { type: 'noreturn' };

export type Event =
  | { type: 'roll'; seat: number; value: number }
  | { type: 'move'; seat: number; id: number; path: number[]; took: number | null; mine: { p: number; label: MineLabel } | null; fell: boolean; done: boolean; both: number | null }
  | { type: 'reverse'; seat: number; id: number }
  | { type: 'lost'; seat: number; value: number }
  | { type: 'fly'; seat: number; plane: number; arc: number; from: number; label: RocketLabel; tank: number | null; shot: boolean }
  | { type: 'swap'; seat: number }
  | { type: 'return'; seat: number; id: number; at: number }
  | { type: 'skip'; seat: number }
  | { type: 'end'; winner: number | null; why: State['why'] };

/** Номер клетки в дороге. */
const INDEX: Map<number, number>[] = ROADS.map((r) => new Map(r.map((p, i) => [p, i])));

/** Дуги половины side (над ней летает соперник). */
export const arcsOf = (side: number) => ARCS.map((a, i) => ({ ...a, i })).filter((a) => a.side === side);

function shuffle<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Клетки между своим стартом и ближайшей дугой — по дороге от старта start (мосты и перекрёстки пропускаются). */
function mineCells(side: number, start: number): number[] {
  const ri = ROADS.findIndex((r) => r[0] === start || r[r.length - 1] === start);
  const road = side === 0 ? [...ROADS[ri]].reverse() : ROADS[ri];
  const arcCells = new Set(ARCS.filter((a) => a.side === side).flatMap((a) => a.cells));
  const out: number[] = [];
  for (let i = 1; i < road.length; i++) {
    if (arcCells.has(road[i])) break;
    // на мост и перекрёсток мину не кладём, но дорогу за ними — можно
    if (!BRIDGES.has(road[i]) && !CROSS.has(road[i]) && !STARTS[1 - side].includes(road[i])) out.push(road[i]);
  }
  return out;
}

export function newState(cfg: Cfg, rng: Rng): State {
  const tanks: Tank[] = [];
  for (const side of [0, 1]) {
    STARTS[side].forEach((p, k) => {
      const ri = ROADS.findIndex((r) => r[0] === p || r[r.length - 1] === p);
      tanks.push({ id: side * 10 + k, side, p, road: ri, dir: ROADS[ri][0] === p ? 1 : -1, state: 'board', repair: false });
    });
  }
  // мины: из пяти фишек соперник вслепую убирает одну, оставшиеся четыре — по одной на дорогу
  const mines: Mine[] = [];
  for (const side of [0, 1]) {
    const labels = shuffle<MineLabel>(['tr', 'tr', 'lp', 'lp', 'ns'], rng).slice(1);
    STARTS[side].forEach((st, k) => {
      const cells = mineCells(side, st);
      if (cells.length) mines.push({ p: cells[rng.int(cells.length)], side, label: labels[k] });
    });
  }
  const rockets: State['rockets'] = [shuffle<RocketLabel>(['hit', 'hit', 'miss'], rng), shuffle<RocketLabel>(['hit', 'hit', 'miss'], rng)];
  return {
    cfg,
    tanks,
    mines,
    rockets,
    planes: [
      [0, 1],
      [0, 1],
    ],
    side: 0,
    phase: 'turn',
    roll: 0,
    left: [],
    moved: [],
    rolls: 0,
    skip: [false, false],
    rocketsBy: -1,
    winner: null,
    why: '',
    turns: 0,
    lostPlanes: [0, 0],
    last: [],
  };
}

export const setup = (opts: Options, rng: Rng) => beginTurn(newState(cfgFrom(opts), rng));

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'rockets') return [s.rocketsBy];
  return [s.side];
}

/** Танки стороны, которые могут ходить в этот ход. */
export function ready(s: State, side: number): Tank[] {
  return s.tanks.filter((t) => t.side === side && t.state === 'board' && !t.repair && !s.moved.includes(t.id));
}

export interface Route {
  path: number[];
  road: number;
  dir: number;
}

/** Пути танка на v кружков: вперёд по своей дороге, на перекрёстках можно свернуть (стоит кружок). Нельзя через танки;
 * в последней клетке может быть танк соперника (бой) — или бой раньше, если наехал на него по пути. */
export function routes(s: State, t: Tank, v: number): Route[] {
  const out: Route[] = [];
  const occ = new Map(s.tanks.filter((x) => x.state === 'board' || x.state === 'done').map((x) => [x.p, x]));
  const walk = (p: number, road: number, dir: number, steps: number, path: number[], turned: boolean) => {
    if (steps === 0) {
      out.push({ path, road, dir });
      return;
    }
    // свернуть на перекрёстке (до шага), если ещё не сворачивали в этой клетке
    if (CROSS.has(p) && !turned && steps >= 2) {
      for (const [, ri] of LINKS[p]) {
        if (ri === road) continue;
        for (const d of [1, -1]) walk(p, ri, d, steps - 1, path, true);
      }
    }
    const i = INDEX[road].get(p)!;
    const q = ROADS[road][i + dir];
    if (q == null || path.includes(q)) return;
    const o = occ.get(q);
    if (o) {
      if (o.side === t.side || o.state === 'done') return;
      out.push({ path: [...path, q], road, dir }); // наехал — бой, дальше не едет
      return;
    }
    // на чужой старт можно встать только последним шагом (там дорога кончается)
    walk(q, road, dir, steps - 1, [...path, q], false);
  };
  walk(t.p, t.road, t.dir, v, [], false);
  // старт соперника — цель: если дорога кончилась раньше (лишние очки), танк встаёт на цель
  const goal = new Set(STARTS[1 - t.side]);
  const i0 = INDEX[t.road].get(t.p)!;
  const toEnd: number[] = [];
  for (let i = i0 + t.dir; ROADS[t.road][i] != null; i += t.dir) toEnd.push(ROADS[t.road][i]);
  if (toEnd.length && toEnd.length < v && goal.has(toEnd[toEnd.length - 1]) && toEnd.every((q, k) => k === toEnd.length - 1 || !occ.has(q))) {
    const last = occ.get(toEnd[toEnd.length - 1]);
    if (!last || (last.side !== t.side && last.state !== 'done')) out.push({ path: toEnd, road: t.road, dir: t.dir });
  }
  // без повторов по конечной клетке и направлению
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.path[r.path.length - 1]}:${r.road}:${r.dir}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Дуги, по которым сторона может лететь: над половиной соперника, где стоит его танк. */
export function flights(s: State, side: number): { plane: number; arc: number }[] {
  const out: { plane: number; arc: number }[] = [];
  const op = 1 - side;
  for (const a of arcsOf(op)) {
    if (!a.cells.some((p) => s.tanks.some((t) => t.side === op && t.state === 'board' && t.p === p))) continue;
    s.planes[side].forEach((f, k) => {
      if (f >= 0) out.push({ plane: k, arc: a.i });
    });
  }
  return out;
}

export function legal(s: State, seat: number): Action[] {
  if (!toAct(s).includes(seat)) return [];
  const out: Action[] = [];
  if (s.phase === 'rockets') {
    out.push({ type: 'keep' }, { type: 'swap', a: 0, b: 1 }, { type: 'swap', a: 0, b: 2 }, { type: 'swap', a: 1, b: 2 });
    return out;
  }
  if (s.phase === 'return') {
    for (const p of freeStarts(s, seat)) out.push({ type: 'return', at: p });
    out.push({ type: 'noreturn' });
    return out;
  }
  const tanks = ready(s, seat);
  if (s.phase === 'turn') {
    if (s.cfg.dice) {
      if (tanks.length) out.push({ type: 'roll' });
      for (const t of tanks) out.push({ type: 'reverse', id: t.id });
    } else {
      for (const t of tanks) {
        for (const val of new Set(s.left)) for (const r of routes(s, t, val)) out.push({ type: 'move', id: t.id, path: r.path, value: val });
        out.push({ type: 'reverse', id: t.id, value: Math.min(...s.left) });
      }
    }
    if (!s.moved.length) for (const f of flights(s, seat)) out.push({ type: 'fly', ...f });
    if (!out.length) out.push({ type: 'pass' });
    return out;
  }
  if (s.phase === 'move') {
    for (const t of tanks) for (const r of routes(s, t, s.roll)) out.push({ type: 'move', id: t.id, path: r.path });
    if (!out.length) out.push({ type: 'pass' });
  }
  return out;
}

function freeStarts(s: State, side: number): number[] {
  return STARTS[side].filter((p) => !s.tanks.some((t) => t.p === p && (t.state === 'board' || t.state === 'done')));
}

function clone(s: State): State {
  return {
    ...s,
    tanks: s.tanks.map((t) => ({ ...t })),
    mines: s.mines.map((m) => ({ ...m })),
    rockets: [[...s.rockets[0]], [...s.rockets[1]]],
    planes: [[...s.planes[0]], [...s.planes[1]]],
    left: [...s.left],
    moved: [...s.moved],
    skip: [...s.skip] as [boolean, boolean],
    lostPlanes: [...s.lostPlanes] as [number, number],
    last: [...s.last],
  };
}

/** Начало хода стороны s.side: сколько бросков, варианты чисел, пропуск после провала на мосту. */
function beginTurn(s: State, events: Event[] = []): State {
  for (let k = 0; k < 2; k++) {
    if (s.skip[s.side]) {
      s.skip[s.side] = false;
      events.push({ type: 'skip', seat: s.side });
      // ремонт после «Л-П» тоже отбыт этим ходом
      for (const t of s.tanks) if (t.side === s.side) t.repair = false;
      s.side = 1 - s.side;
      s.turns++;
      continue;
    }
    break;
  }
  s.phase = 'turn';
  s.moved = [];
  s.roll = 0;
  const n = s.tanks.filter((t) => t.side === s.side && t.state === 'board' && !t.repair).length;
  s.rolls = n;
  s.left = [1, 2, 3, 4].slice(4 - n);
  return s;
}

function endTurn(s: State, events: Event[]) {
  // ремонт отбыт: танки, пропустившие этот ход, снова в строю
  for (const t of s.tanks) if (t.side === s.side && t.repair && !s.moved.includes(t.id)) t.repair = false;
  if (checkEnd(s, events)) return;
  s.side = 1 - s.side;
  s.turns++;
  if (s.turns >= MAX_TURNS) {
    finishByCount(s, 'limit', events);
    return;
  }
  beginTurn(s, events);
}

function finishByCount(s: State, why: State['why'], events: Event[]) {
  const done = (sd: number) => s.tanks.filter((t) => t.side === sd && t.state === 'done').length;
  let w: number | null = null;
  if (done(0) !== done(1)) w = done(0) > done(1) ? 0 : 1;
  else if (s.lostPlanes[0] !== s.lostPlanes[1]) w = s.lostPlanes[0] < s.lostPlanes[1] ? 0 : 1;
  s.phase = 'over';
  s.winner = w;
  s.why = why;
  events.push({ type: 'end', winner: w, why });
}

function checkEnd(s: State, events: Event[]): boolean {
  for (const sd of [0, 1]) {
    if (s.tanks.filter((t) => t.side === sd).every((t) => t.state === 'dead')) {
      s.phase = 'over';
      s.winner = 1 - sd;
      s.why = 'tanks';
      events.push({ type: 'end', winner: 1 - sd, why: 'tanks' });
      return true;
    }
  }
  if (!s.tanks.some((t) => t.state === 'board')) {
    finishByCount(s, 'count', events);
    return true;
  }
  return false;
}

/** Провести танк по пути: мины, бой, мост, цель. */
function drive(s: State, t: Tank, path: number[], road: number, dir: number, events: Event[], seat: number) {
  const goal = new Set(STARTS[1 - t.side]);
  let took: number | null = null;
  let mine: { p: number; label: MineLabel } | null = null;
  let fell = false;
  let done = false;
  let both: number | null = null;
  const went: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const q = path[i];
    went.push(q);
    const mi = s.mines.findIndex((m) => m.p === q && m.side !== t.side);
    if (mi >= 0) {
      const m = s.mines[mi];
      mine = { p: q, label: m.label as MineLabel };
      s.mines.splice(mi, 1);
      if (m.label === 'tr') {
        t.state = 'dead';
        t.p = q;
        break;
      }
      if (m.label === 'lp') {
        t.repair = true;
        break;
      }
    }
    const o = s.tanks.find((x) => x.p === q && x.state === 'board' && x.id !== t.id);
    if (o && o.side !== t.side) {
      o.state = 'dead';
      took = o.id;
      break;
    }
  }
  const end = went[went.length - 1];
  if (t.state !== 'dead') {
    t.p = end;
    t.road = road;
    t.dir = dir;
    if (goal.has(end)) {
      t.state = 'done';
      done = true;
    } else if (BRIDGES.has(end) && !took) {
      // провалился; если на мосту уже провалился чужой — оба выбывают
      const other = s.tanks.find((x) => x.p === end && x.id !== t.id && x.state === 'board');
      if (other) {
        other.state = 'dead';
        t.state = 'dead';
        both = other.id;
      } else {
        fell = true;
        s.skip[t.side] = true;
      }
    }
  }
  s.last = [path.length ? path[0] : t.p, end];
  events.push({ type: 'move', seat, id: t.id, path: went, took, mine, fell, done, both });
  return done;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const events: Event[] = [];
  if (s.phase === 'rockets') {
    if (a.type === 'swap') {
      if (![0, 1, 2].includes(a.a) || ![0, 1, 2].includes(a.b) || a.a === a.b) return null;
      const r = s.rockets[seat];
      [r[a.a], r[a.b]] = [r[a.b], r[a.a]];
      events.push({ type: 'swap', seat });
    } else if (a.type !== 'keep') return null;
    s.phase = 'turn';
    endTurn(s, events);
    return { state: s, events };
  }
  if (s.phase === 'return') {
    if (a.type === 'return') {
      if (!freeStarts(s, seat).includes(a.at)) return null;
      const dead = s.tanks.find((t) => t.side === seat && t.state === 'dead');
      if (!dead) return null;
      const ri = ROADS.findIndex((r) => r[0] === a.at || r[r.length - 1] === a.at);
      Object.assign(dead, { p: a.at, road: ri, dir: ROADS[ri][0] === a.at ? 1 : -1, state: 'board', repair: false });
      s.moved.push(dead.id); // ходить им — со следующего хода
      events.push({ type: 'return', seat, id: dead.id, at: a.at });
    } else if (a.type !== 'noreturn') return null;
    s.phase = 'turn';
    afterMove(s, events);
    return { state: s, events };
  }
  if (s.phase === 'turn' && a.type === 'fly') {
    if (s.moved.length || !flights(s, seat).some((f) => f.plane === a.plane && f.arc === a.arc)) return null;
    const arc = ARCS[a.arc];
    const from = s.planes[seat][a.plane];
    const op = 1 - seat;
    const k = arcsOf(op).findIndex((x) => x.i === a.arc);
    const label = s.rockets[op][k] as RocketLabel;
    // порядок пролёта: с левого аэродрома — слева направо
    const order = from === 0 ? arc.cells.map((p, i) => ({ p, i })) : arc.cells.map((p, i) => ({ p, i })).reverse();
    const target = order.find((x) => s.tanks.some((t) => t.side === op && t.state === 'board' && t.p === x.p))!;
    const tankFirst = from === 0 ? target.i < arc.rocket : target.i >= arc.rocket;
    const tank = s.tanks.find((t) => t.side === op && t.state === 'board' && t.p === target.p)!;
    let bombed = false;
    let shot = false;
    if (label === 'miss') bombed = true;
    else if (tankFirst) bombed = shot = true;
    else shot = true;
    if (bombed) tank.state = 'dead';
    if (shot) {
      s.planes[seat][a.plane] = -1;
      s.lostPlanes[seat]++;
    } else s.planes[seat][a.plane] = 1 - from;
    events.push({ type: 'fly', seat, plane: a.plane, arc: a.arc, from, label, tank: bombed ? tank.id : null, shot });
    if (checkEnd(s, events)) return { state: s, events };
    // хозяин ракет может их переставить
    s.phase = 'rockets';
    s.rocketsBy = op;
    return { state: s, events };
  }
  if (a.type === 'pass') {
    if (legal(s0, seat).some((x) => x.type !== 'pass')) return null;
    if (s.phase === 'move') events.push({ type: 'lost', seat, value: s.roll });
    endTurn(s, events);
    return { state: s, events };
  }
  if (s.phase === 'turn' && a.type === 'roll') {
    if (!s.cfg.dice || !ready(s, seat).length) return null;
    s.roll = 1 + rng.int(3);
    s.rolls--;
    s.phase = 'move';
    events.push({ type: 'roll', seat, value: s.roll });
    if (!legal(s, seat).some((x) => x.type === 'move')) {
      events.push({ type: 'lost', seat, value: s.roll });
      s.phase = 'turn';
      afterMove(s, events);
    }
    return { state: s, events };
  }
  if (a.type === 'reverse' && s.phase === 'turn') {
    const t = ready(s, seat).find((x) => x.id === a.id);
    if (!t) return null;
    if (!s.cfg.dice) {
      if (a.value == null || !s.left.includes(a.value)) return null;
      s.left.splice(s.left.indexOf(a.value), 1);
    } else s.rolls--;
    t.dir = -t.dir;
    s.moved.push(t.id);
    events.push({ type: 'reverse', seat, id: t.id });
    afterMove(s, events);
    return { state: s, events };
  }
  if (a.type === 'move' && (s.phase === 'move' || (s.phase === 'turn' && !s.cfg.dice))) {
    const t = ready(s, seat).find((x) => x.id === a.id);
    if (!t || !Array.isArray(a.path)) return null;
    const v = s.cfg.dice ? s.roll : a.value;
    if (v == null || (!s.cfg.dice && !s.left.includes(v))) return null;
    const r = routes(s0, s0.tanks.find((x) => x.id === a.id)!, v).find((x) => x.path.length === a.path.length && x.path.every((p, i) => p === a.path[i]));
    if (!r) return null;
    if (!s.cfg.dice) s.left.splice(s.left.indexOf(v), 1);
    s.moved.push(t.id);
    const done = drive(s, t, r.path, r.road, r.dir, events, seat);
    if (checkEnd(s, events)) return { state: s, events };
    if (done && s.tanks.some((x) => x.side === seat && x.state === 'dead') && freeStarts(s, seat).length) {
      s.phase = 'return';
      return { state: s, events };
    }
    s.phase = 'turn';
    afterMove(s, events);
    return { state: s, events };
  }
  return null;
}

/** После хода танком: ещё броски — продолжаем, иначе ход переходит. */
function afterMove(s: State, events: Event[]) {
  if (s.phase === 'over') return;
  const more = s.cfg.dice ? s.rolls > 0 && ready(s, s.side).length > 0 : s.left.length > 0 && ready(s, s.side).length > 0;
  if (!more) endTurn(s, events);
}

/** Что видит место: метки мин — никто (пока не наехали), чужие ракеты — нет. */
export function makeView(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || s.phase === 'over') return s;
  return {
    ...s,
    mines: s.mines.map((m) => ({ ...m, label: null })),
    rockets: s.rockets.map((r, i) => (seats.includes(i) ? r : r.map(() => null))) as State['rockets'],
  };
}

export { N };
