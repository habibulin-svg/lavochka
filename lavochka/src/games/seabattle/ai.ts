/* Морской бой — боты. Видят только свои выстрелы и потопленные корабли соперника.
 *   Лёгкий — стреляет наугад, раненого добивает не всегда;
 *   Средний — «охота и добивание»: раненого добивает вдоль линии, ищет по шахматке;
 *   Сложный — карта вероятностей: перебирает, где могут стоять оставшиеся корабли, и бьёт в самое вероятное место.
 * Расстановка у всех случайная; сложный не ставит больше двух кораблей вдоль одного борта. */
import type { Rng } from '../../core/types';
import { around, N, randomFleet, shotsPerTurn, SIZES, type Action, type Shot, type State } from './engine';

/** Раненые клетки: попадания, ещё не вошедшие в потопленные корабли. */
function wounded(shots: Shot[], sunk: number[][]): number[] {
  const done = new Set(sunk.flat());
  const out: number[] = [];
  shots.forEach((v, c) => {
    if (v === 2 && !done.has(c)) out.push(c);
  });
  return out;
}

const free = (shots: Shot[], c: number) => c >= 0 && c < N * N && shots[c] === 0;

/** Куда бить, чтобы добить раненого: продолжение линии или соседи по кресту. */
function finishing(shots: Shot[], hits: number[]): number[] {
  if (!hits.length) return [];
  const rows = new Set(hits.map((c) => Math.floor(c / N)));
  const cols = new Set(hits.map((c) => c % N));
  const out: number[] = [];
  if (hits.length > 1 && rows.size === 1) {
    const r = [...rows][0];
    const fs = hits.map((c) => c % N).sort((a, b) => a - b);
    if (fs[0] > 0) out.push(r * N + fs[0] - 1);
    if (fs[fs.length - 1] < N - 1) out.push(r * N + fs[fs.length - 1] + 1);
  } else if (hits.length > 1 && cols.size === 1) {
    const f = [...cols][0];
    const rs = hits.map((c) => Math.floor(c / N)).sort((a, b) => a - b);
    if (rs[0] > 0) out.push((rs[0] - 1) * N + f);
    if (rs[rs.length - 1] < N - 1) out.push((rs[rs.length - 1] + 1) * N + f);
  } else {
    for (const c of hits) {
      const r = Math.floor(c / N);
      const f = c % N;
      if (r > 0) out.push(c - N);
      if (r < N - 1) out.push(c + N);
      if (f > 0) out.push(c - 1);
      if (f < N - 1) out.push(c + 1);
    }
  }
  return [...new Set(out)].filter((c) => free(shots, c));
}

/** Сколько раз каждая клетка накрыта возможными положениями оставшихся кораблей. */
function density(shots: Shot[], sunk: number[][], sizes: number[], touch: boolean): number[] {
  const left = sizes.slice();
  for (const s of sunk) {
    const i = left.indexOf(s.length);
    if (i >= 0) left.splice(i, 1);
  }
  const hits = wounded(shots, sunk);
  const hitSet = new Set(hits);
  const blocked = new Set<number>();
  shots.forEach((v, c) => {
    if (v === 1 || v === 3) blocked.add(c);
  });
  if (!touch) for (const s of sunk) for (const c of s) for (const a of around(c)) blocked.add(a);
  for (const s of sunk) for (const c of s) blocked.add(c);
  const d = Array(N * N).fill(0);
  for (const len of new Set(left)) {
    const mult = left.filter((x) => x === len).length;
    for (let c = 0; c < N * N; c++)
      for (const vert of [false, true]) {
        const r = Math.floor(c / N);
        const f = c % N;
        if (vert ? r + len > N : f + len > N) continue;
        const cells = Array.from({ length: len }, (_, i) => (vert ? c + i * N : c + i));
        if (cells.some((x) => blocked.has(x))) continue;
        const through = cells.filter((x) => hitSet.has(x)).length;
        // без касаний: корабль, не проходящий через раненого, не может стоять с ним рядом
        if (!touch && !through && cells.some((x) => around(x).some((a) => hitSet.has(a)))) continue;
        const w = (through ? 40 * through : 1) * mult;
        for (const x of cells) if (shots[x] === 0) d[x] += w;
      }
  }
  return d;
}

function pickShots(s: State, seat: number, level: number, rng: Rng): number[] {
  const shots = s.shots[seat].slice() as Shot[];
  const sunk = s.sunk[seat];
  const want = Math.min(shotsPerTurn(s, seat), shots.filter((x) => x === 0).length);
  const out: number[] = [];
  for (let k = 0; k < want; k++) {
    let c: number;
    const fin = finishing(shots, wounded(shots, sunk).filter((x) => !out.includes(x)));
    if (level === 0) {
      const open = shots.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
      c = fin.length && rng.next() < 0.6 ? fin[rng.int(fin.length)] : open[rng.int(open.length)];
    } else if (level === 1) {
      if (fin.length) c = fin[rng.int(fin.length)];
      else {
        const open = shots.map((v, i) => (v === 0 && (Math.floor(i / N) + (i % N)) % 2 === 0 ? i : -1)).filter((i) => i >= 0);
        const any = shots.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
        const pool = open.length ? open : any;
        c = pool[rng.int(pool.length)];
      }
    } else {
      const d = density(shots, sunk, SIZES[s.cfg.fleet], s.cfg.touch);
      let best = -1;
      const top: number[] = [];
      d.forEach((v, i) => {
        if (shots[i] !== 0) return;
        if (v > best) {
          best = v;
          top.length = 0;
          top.push(i);
        } else if (v === best) top.push(i);
      });
      c = top.length ? top[rng.int(top.length)] : shots.findIndex((v) => v === 0);
    }
    out.push(c);
    // в сальво следующий выстрел — уже с учётом этого (считаем «мимо», чтобы не повторяться)
    shots[c] = 1;
  }
  return out;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'place') {
    if (s.ready[seat]) return null;
    let fleet = randomFleet(s.cfg, rng);
    if (level >= 2) {
      // не жмёмся к бортам: больше двух кораблей у края — перекладываем
      for (let i = 0; i < 20; i++) {
        const edge = fleet.filter((sh) => sh.some((c) => c < N || c >= N * (N - 1) || c % N === 0 || c % N === N - 1)).length;
        if (edge <= 2) break;
        fleet = randomFleet(s.cfg, rng);
      }
    }
    return { type: 'place', ships: fleet };
  }
  if (s.turn !== seat) return null;
  return { type: 'shoot', cells: pickShots(s, seat, level, rng) };
}
