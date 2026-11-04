/* Честность случайной карты (DESIGN.md §7.5): расстояния в очках хода от каждого города до шахт, сокровищ, середины и соседа.
 * Меряем «геометрию»: охрана считается проходимой, навыков нет, армия средней скорости. */
import { Heap } from './gen';
import { NATIVE, ROAD_COST, TERRAINS, WATER } from './data';
import type { TownFaction } from './town';
import { type World, neighbors, xOf, yOf } from './world';

/** Дейкстра от клетки: цена шага как у героя без навыков; лодка — по воде за 100. Со входа объекта дальше не идём, кроме стражи. */
export function travel(w: World, from: number, faction: TownFaction, boat: boolean): Int32Array {
  const n = w.w * w.h;
  const dist = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const stack = new Set(w.objects.filter((o) => o.kind === 'stack').map((o) => o.cell));
  const entry = new Set([...w.objects.map((o) => o.cell), ...w.towns.map((t) => t.cell)]);
  const heap = new Heap();
  heap.push(0, from);
  dist[from] = 0;
  while (heap.size) {
    const [d, c] = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c !== from && entry.has(c) && !stack.has(c)) continue;
    for (const nb of neighbors(w, c)) {
      if (done[nb] || w.block[nb]) continue;
      const water = w.terrain[nb] === WATER;
      if (water && !boat) continue;
      const t = TERRAINS[w.terrain[nb]];
      let cost = water ? 100 : NATIVE[faction] === t.id ? 100 : t.cost;
      if (!water && w.road[nb]) cost = Math.min(cost, ROAD_COST[w.road[nb]]);
      if (xOf(w, c) !== xOf(w, nb) && yOf(w, c) !== yOf(w, nb)) cost = Math.trunc((cost * 141) / 100);
      const nd = d + cost;
      if (dist[nb] < 0 || nd < dist[nb]) {
        dist[nb] = nd;
        heap.push(nd, nb);
      }
    }
  }
  return dist;
}

export const FAIR_METRICS = ['mine-wood', 'mine-stone', 'mine-semki', 'mine-rare', 'treasury', 'center', 'neighbor'] as const;
export type FairMetric = (typeof FAIR_METRICS)[number];

/** Для каждой метрики — расстояние от города каждого игрока до ближайшего (−1 — нет такого или не дойти). */
export function fairness(w: World, boat: boolean): Record<FairMetric, number[]> {
  const out = Object.fromEntries(FAIR_METRICS.map((m) => [m, [] as number[]])) as Record<FairMetric, number[]>;
  const group = (kind: string): FairMetric | null => {
    if (kind === 'mine-wood' || kind === 'mine-stone' || kind === 'mine-semki') return kind;
    if (kind.startsWith('mine-')) return 'mine-rare';
    if (kind.startsWith('treasury-')) return 'treasury';
    return null;
  };
  for (const t of w.towns) {
    if (t.owner < 0) continue;
    const d = travel(w, t.cell, t.faction, boat);
    const best = (cells: number[]): number => cells.reduce((m, c) => (d[c] >= 0 && (m < 0 || d[c] < m) ? d[c] : m), -1);
    for (const m of FAIR_METRICS) {
      let cells: number[];
      if (m === 'center') cells = w.shard >= 0 ? [w.shard] : [];
      else if (m === 'neighbor') cells = w.towns.filter((o) => o !== t).map((o) => o.cell);
      else cells = w.objects.filter((o) => group(o.kind) === m).map((o) => o.cell);
      out[m][t.owner] = best(cells);
    }
  }
  return out;
}
