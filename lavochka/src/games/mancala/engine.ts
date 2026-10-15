/* Манкала — калах и оваре (без DOM). Два ряда по шесть лунок; ход — взять все камни из своей лунки и раскладывать по одному
 * против часовой стрелки.
 *
 * Калах: у каждого свой «дом» (калах) справа. При раскладке свой дом получает камень, чужой — пропускается.
 * Последний камень в свой дом — ход ещё раз. Последний камень в свою пустую лунку, а напротив есть камни, — забираешь и их,
 * и этот камень в дом. Ряд у кого-то опустел — конец: оставшиеся камни соперника идут в его дом. Больше в доме — победа.
 * Оваре (абапа): домов на доске нет. Из 12 и более камней исходную лунку при обходе пропускают. Последний камень в лунке
 * соперника сделал там 2 или 3 — забираешь, и так же из предыдущих лунок соперника подряд, пока там 2 или 3.
 * Забрать сразу все камни соперника нельзя (взятие отменяется). Если у соперника пусто — обязан ходом дать ему камни;
 * не можешь — партия кончается, свои камни забираешь себе. 25 и больше — победа; бесконечный круг — каждый берёт свои.
 * Тогыз кумалак — 2×9 лунок, туздык: правила в togyz.ts.
 */
import type { Options } from '../../core/types';
import { TOGYZ_SEEDS, tApply, tFinish, tLegal, tRow } from './togyz';

export interface Cfg {
  variant: 'kalah' | 'oware' | 'togyz';
  seeds: number;
}

export function cfgFrom(o: Options): Cfg {
  const variant = o.variant === 'oware' ? 'oware' : o.variant === 'togyz' ? 'togyz' : 'kalah';
  const seeds = [3, 4, 5, 6].includes(Number(o.seeds)) ? Number(o.seeds) : 4;
  return { variant, seeds: variant === 'oware' ? 4 : variant === 'togyz' ? TOGYZ_SEEDS : seeds };
}

export interface State {
  cfg: Cfg;
  /** Лунки 0–5 — место 0 (слева направо снизу), 6–11 — место 1 (справа налево сверху); в тогыз кумалаке — 0–8 и 9–17. */
  pits: number[];
  /** Дом (калах), взятое (оваре) или казан (тогыз). */
  store: [number, number];
  /** Туздык каждого (номер лунки на стороне соперника) или -1; только в тогыз кумалаке. */
  tuz: [number, number];
  turn: number;
  moves: number;
  last: { seat: number; pit: number; path: number[]; captured: number[]; again: boolean } | null;
  over: boolean;
  winner: number | null;
}

export type Action = { type: 'sow'; pit: number };
export type Event = { type: 'sow'; seat: number; pit: number; path: number[]; captured: number[]; again: boolean; tuz?: boolean } | { type: 'end'; winner: number | null; store: [number, number] };

/** Лунок в ряду. */
export const pitsPerRow = (cfg: Cfg) => (cfg.variant === 'togyz' ? 9 : 6);
export const own = (seat: number, pit: number) => (seat === 0 ? pit < 6 : pit >= 6);
const rowOf = (seat: number, cfg?: Cfg) => (cfg?.variant === 'togyz' ? tRow(seat) : seat === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]);
export const opposite = (pit: number) => 11 - pit;

export function newState(cfg: Cfg): State {
  return { cfg, pits: Array(pitsPerRow(cfg) * 2).fill(cfg.seeds), store: [0, 0], tuz: [-1, -1], turn: 0, moves: 0, last: null, over: false, winner: null };
}

export function setup(_s: number[], opts: Options): State {
  return newState(cfgFrom(opts));
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Раскладка без проверок: путь (лунки, -1/-2 — дом места 0/1), новая доска. */
function sowRaw(s: State, seat: number, pit: number) {
  const pits = s.pits.slice();
  const store = [...s.store] as [number, number];
  let n = pits[pit];
  pits[pit] = 0;
  const path: number[] = [];
  if (s.cfg.variant === 'kalah') {
    // кольцо из 14: лунки 0–5, дом места 0 (6), лунки 6–11 (7–12), дом места 1 (13); чужой дом пропускаем
    const toRing = (q: number) => (q < 6 ? q : q + 1);
    let r = toRing(pit);
    while (n > 0) {
      r = (r + 1) % 14;
      if ((r === 6 && seat === 1) || (r === 13 && seat === 0)) continue;
      if (r === 6 || r === 13) {
        store[r === 6 ? 0 : 1]++;
        path.push(r === 6 ? -1 : -2);
      } else {
        const q = r < 6 ? r : r - 1;
        pits[q]++;
        path.push(q);
      }
      n--;
    }
  } else {
    let pos = pit;
    while (n > 0) {
      pos = (pos + 1) % 12;
      if (pos === pit) continue;
      pits[pos]++;
      path.push(pos);
      n--;
    }
  }
  return { pits, store, path, end: path[path.length - 1] };
}

/** Можно ли пойти из лунки. */
export function legal(s: State, seat: number): number[] {
  if (s.cfg.variant === 'togyz') return tLegal(s, seat);
  const row = rowOf(seat).filter((p) => s.pits[p] > 0);
  if (s.cfg.variant === 'oware') {
    // соперник пуст — только ходы, которые дают ему камни
    const opp = rowOf(1 - seat);
    if (opp.every((p) => s.pits[p] === 0)) return row.filter((p) => sowRaw(s, seat, p).path.some((q) => q >= 0 && own(1 - seat, q)));
  }
  return row;
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'sow' || !legal(s0, seat).includes(a.pit)) return null;
  const s: State = { ...s0, store: [...s0.store] as [number, number] };
  if (s.cfg.variant === 'togyz') {
    const t = tApply(s, seat, a.pit);
    s.moves++;
    s.turn = 1 - seat;
    const ev: Event[] = [{ type: 'sow', seat, pit: a.pit, path: s.last!.path, captured: t.captured, again: false, tuz: t.tuz }];
    if (tFinish(s)) finish(s, ev);
    return { state: s, events: ev };
  }
  const r = sowRaw(s0, seat, a.pit);
  s.pits = r.pits;
  s.store = r.store;
  const captured: number[] = [];
  let again = false;
  if (s.cfg.variant === 'kalah') {
    if ((seat === 0 && r.end === -1) || (seat === 1 && r.end === -2)) again = true;
    else if (r.end >= 0 && own(seat, r.end) && s.pits[r.end] === 1 && s.pits[opposite(r.end)] > 0) {
      const o = opposite(r.end);
      s.store[seat] += s.pits[o] + 1;
      captured.push(o, r.end);
      s.pits[o] = 0;
      s.pits[r.end] = 0;
    }
  } else if (r.end >= 0 && !own(seat, r.end)) {
    const take: number[] = [];
    let p = r.end;
    while (!own(seat, p) && (s.pits[p] === 2 || s.pits[p] === 3)) {
      take.push(p);
      p = (p + 11) % 12;
    }
    const oppTotal = rowOf(1 - seat).reduce((x, q) => x + s.pits[q], 0);
    const sum = take.reduce((x, q) => x + s.pits[q], 0);
    // забрать всё у соперника нельзя — взятие отменяется
    if (take.length && sum < oppTotal) {
      for (const q of take) {
        s.store[seat] += s.pits[q];
        s.pits[q] = 0;
      }
      captured.push(...take);
    }
  }
  s.moves++;
  s.last = { seat, pit: a.pit, path: r.path, captured, again };
  const ev: Event[] = [{ type: 'sow', seat, pit: a.pit, path: r.path, captured, again }];
  s.turn = again ? seat : 1 - seat;
  finishIfOver(s, ev);
  return { state: s, events: ev };
}

function finishIfOver(s: State, ev: Event[]) {
  const sum = (seat: number) => rowOf(seat).reduce((x, p) => x + s.pits[p], 0);
  let end = false;
  if (s.cfg.variant === 'kalah') {
    if (sum(0) === 0 || sum(1) === 0) {
      for (const seat of [0, 1]) {
        s.store[seat] += sum(seat);
        for (const p of rowOf(seat)) s.pits[p] = 0;
      }
      end = true;
    }
  } else {
    const half = s.cfg.seeds * 6;
    if (s.store[0] > half || s.store[1] > half) end = true;
    else if (!legal(s, s.turn).length || s.moves >= 300) {
      // не может накормить (или бесконечный круг) — каждый берёт свои
      for (const seat of [0, 1]) {
        s.store[seat] += sum(seat);
        for (const p of rowOf(seat)) s.pits[p] = 0;
      }
      end = true;
    }
  }
  if (end) finish(s, ev);
}

function finish(s: State, ev: Event[]) {
  s.over = true;
  s.winner = s.store[0] > s.store[1] ? 0 : s.store[1] > s.store[0] ? 1 : null;
  ev.push({ type: 'end', winner: s.winner, store: [...s.store] as [number, number] });
}

export const makeView = (s: State): State => s;
export { rowOf };
