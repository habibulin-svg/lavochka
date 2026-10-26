/* Окей и руммикуб — боты. Видят свою подставку, стол, сбросы и индикатор.
 * Окей: выходят, как только можно (сложный — по возможности океем); из сброса соседа берут фишку, если она сближает руку
 *   с выходом (лёгкий — никогда); сбрасывают самую «одинокую» фишку (без соседей по номеру и цвету), окей не сбрасывают.
 * Руммикуб: лёгкий выкладывает только свои комбинации; средний ещё и докладывает фишки к столу; сложный пробует и перестроить весь стол.
 *   Первая выкладка — как только набирается 30. */
import type { Rng } from '../../core/types';
import { arrange, arrange101, canFinish, faceOf, leftOf, OPEN, OPEN101, rulesOf, showTile, type Action, type View } from './engine';
import { groupValue, partition, sameTile, validGroup, type Face, type Tile } from './tiles';

/** Связность фишки с остальными: тот же номер другого цвета, соседний номер того же цвета. */
function links(rack: Tile[], t: Tile, face: (t: Tile) => Face): number {
  const f = face(t);
  if (f.wild) return 100;
  let v = 0;
  for (const x of rack) {
    if (x === t) continue;
    const g = face(x);
    if (g.wild) {
      v += 0.5;
      continue;
    }
    if (g.n === f.n && g.c !== f.c) v += 2;
    if (g.c === f.c && Math.abs(g.n - f.n) === 1) v += 2.2;
    if (g.c === f.c && Math.abs(g.n - f.n) === 2) v += 1;
    if (g.c === f.c && g.n === f.n) v += 0.6; // пара — для семи пар
  }
  return v;
}

/** Все комбинации из фишек подставки (наборы и ряды, с джокерами). */
function groupsOf(rack: Tile[], face: (t: Tile) => Face, wrap: boolean): Tile[][] {
  const out: Tile[][] = [];
  const rules = { wrap13: wrap };
  const wild = rack.filter((t) => face(t).wild);
  const nat = rack.filter((t) => !face(t).wild);
  for (let n = 1; n <= 13; n++) {
    const byC: Tile[] = [];
    for (let c = 0; c < 4; c++) {
      const t = nat.find((x) => face(x).n === n && face(x).c === c);
      if (t) byC.push(t);
    }
    const subs = (arr: Tile[], k: number): Tile[][] => (k === 0 ? [[]] : arr.flatMap((x, i) => subs(arr.slice(i + 1), k - 1).map((r) => [x, ...r])));
    for (const k of [3, 4]) out.push(...subs(byC, k));
    if (wild.length) for (const k of [2, 3]) for (const s of subs(byC, k)) out.push([...s, wild[0]]);
  }
  for (let c = 0; c < 4; c++) {
    for (let start = 1; start <= 13; start++) {
      let run: Tile[] = [];
      let w = 0;
      for (let n = start; n <= (wrap ? 14 : 13); n++) {
        const want = n === 14 ? 1 : n;
        const t = nat.find((x) => face(x).c === c && face(x).n === want && !run.includes(x));
        if (t) run = [...run, t];
        else if (w < wild.length) run = [...run, wild[w++]];
        else break;
        if (run.length >= 3 && validGroup(run.map(face), rules)) out.push(run.slice());
      }
    }
  }
  return out;
}

/** Лучший набор непересекающихся комбинаций (по числу фишек, при равенстве — по очкам). */
export function bestCover(rack: Tile[], face: (t: Tile) => Face, wrap: boolean): Tile[][] {
  const gs = groupsOf(rack, face, wrap);
  const rules = { wrap13: wrap };
  let best: Tile[][] = [];
  let bestScore = -1;
  let nodes = 0;
  const used = new Set<Tile>();
  const rec = (i: number, acc: Tile[][], cnt: number, val: number) => {
    if (++nodes > 20000) return;
    const sc = cnt * 100 + val;
    if (sc > bestScore) (bestScore = sc), (best = acc.slice());
    for (let k = i; k < gs.length; k++) {
      const g = gs[k];
      if (g.some((t) => used.has(t))) continue;
      for (const t of g) used.add(t);
      acc.push(g);
      rec(k + 1, acc, cnt + g.length, val + groupValue(g, face, rules));
      acc.pop();
      for (const t of g) used.delete(t);
    }
  };
  rec(0, [], 0, 0);
  return best;
}

/** Сброс: самая «одинокая» фишка вне комбинаций, окей не сбрасывают. */
function loneliest(v: View, rack: Tile[], level: number, rng: Rng): Tile {
  const face = faceOf(v);
  const cover = level > 0 ? new Set(bestCover(rack, face, true).flat()) : new Set<Tile>();
  const cands = rack.filter((t) => !face(t).wild && !cover.has(t));
  const pool = cands.length ? cands : rack.filter((t) => !face(t).wild);
  if (!pool.length) return rack[0];
  if (level === 0) return pool[rng.int(pool.length)];
  let best = pool[0];
  let bv = Infinity;
  for (const t of pool) {
    const s = links(rack, t, face) + rng.next() * 0.1;
    if (s < bv) (bv = s), (best = t);
  }
  return best;
}

/** Пары одинаковых фишек на подставке (без джокеров). */
function pairsIn(rack: Tile[], face: (t: Tile) => Face): Tile[] {
  const by = new Map<string, Tile[]>();
  for (const t of rack) {
    const f = face(t);
    if (f.wild) continue;
    by.set(`${f.c}.${f.n}`, [...(by.get(`${f.c}.${f.n}`) ?? []), t]);
  }
  return [...by.values()].flatMap((l) => (l.length >= 2 ? l.slice(0, 2) : []));
}

/** «Окей 101»: выкладка (первая — от 101 или пятью парами), докладка, сброс. */
function okey101(v: View, seat: number, level: number, rng: Rng): Action {
  const face = faceOf(v);
  const rules = rulesOf(v.cfg);
  const rack = v.racks[seat];
  if (v.phase === 'draw') return { type: 'draw', from: 'stock' };
  const ok = (tiles: Tile[]) => tiles.length && tiles.length < rack.length && arrange101(v, seat, tiles);
  if (!v.opened[seat] || !v.pairs?.[seat]) {
    const cover = bestCover(rack, face, true);
    const own = cover.flat();
    const sum = cover.reduce((x, g) => x + groupValue(g, face, rules), 0);
    if (v.opened[seat] || sum >= OPEN101) {
      if (ok(own)) return { type: 'play', tiles: own };
      if (v.opened[seat] && level > 0)
        for (const t of rack) if (!face(t).wild && v.table.some((g) => g.length >= 3 && validGroup([...g, t].map(face), rules)) && ok([t])) return { type: 'play', tiles: [t] };
    }
  }
  const pairs = pairsIn(rack, face);
  if ((!v.opened[seat] && pairs.length >= 10 && level > 0) || (v.opened[seat] && v.pairs?.[seat] && pairs.length)) if (ok(pairs)) return { type: 'play', tiles: pairs };
  return { type: 'discard', tile: loneliest(v, rack, level, rng) };
}

function okey(v: View, seat: number, level: number, rng: Rng): Action {
  const face = faceOf(v);
  const rack = v.racks[seat];
  // показ индикатора — сразу, пока можно
  if (showTile(v, seat)) return { type: 'show' };
  if (v.phase === 'draw') {
    const left = v.discards[leftOf(v.seats, seat)];
    const top = left[left.length - 1];
    if (level > 0 && top) {
      if (face(top).wild) return { type: 'draw', from: 'left' };
      const gain = links([...rack, top], top, face);
      if (gain >= (level === 2 ? 4 : 4.4)) return { type: 'draw', from: 'left' };
    }
    return { type: 'draw', from: 'stock' };
  }
  // выход
  const finishers = rack.filter((t) => canFinish(v, seat, t));
  if (finishers.length) {
    const wild = finishers.find((t) => face(t).wild);
    return { type: 'discard', tile: level === 2 && wild ? wild : finishers.find((t) => !face(t).wild) ?? finishers[0], finish: true };
  }
  // сброс: самая одинокая; в комбинациях — не трогать
  const cover = level > 0 ? new Set(bestCover(rack, face, true).flat()) : new Set<Tile>();
  const cands = rack.filter((t) => !face(t).wild && !cover.has(t));
  const pool = cands.length ? cands : rack.filter((t) => !face(t).wild);
  if (level === 0) return { type: 'discard', tile: pool[rng.int(pool.length)] ?? rack[0] };
  let best = pool[0];
  let bv = Infinity;
  for (const t of pool) {
    const s = links(rack, t, face) + rng.next() * 0.1;
    if (s < bv) (bv = s), (best = t);
  }
  return { type: 'discard', tile: best };
}

function rummikub(v: View, seat: number, level: number, rng: Rng): Action {
  const face = faceOf(v);
  const rules = rulesOf(v.cfg);
  const rack = v.racks[seat];
  const cover = bestCover(rack, face, false);
  const own = cover.flat();
  if (!v.opened[seat]) {
    const sum = cover.reduce((x, g) => x + groupValue(g, face, rules), 0);
    if (sum >= OPEN && arrange(v, seat, own)) return { type: 'play', tiles: own };
    return { type: 'draw', from: 'stock' };
  }
  let play = own.length && (level > 0 || rng.next() < 0.6) ? own.slice() : [];
  if (level > 0) {
    // доложить остальные фишки по одной
    for (const t of rack) {
      if (play.some((x) => sameTile(x, t))) continue;
      const next = [...play, t];
      // средний — только если ложится без перестройки (проверяем по вставке к группам)
      if (level === 1) {
        const fits = v.table.some((g) => validGroup([...g, t].map(face), rules));
        if (!fits) continue;
      }
      if (arrange(v, seat, next)) play = next;
    }
  }
  if (play.length && arrange(v, seat, play)) return { type: 'play', tiles: play };
  if (own.length && arrange(v, seat, own)) return { type: 'play', tiles: own };
  return { type: 'draw', from: 'stock' };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  return v.cfg.mode === 'okey' ? okey(v, seat, level, rng) : v.cfg.mode === 'o101' ? okey101(v, seat, level, rng) : rummikub(v, seat, level, rng);
}

export const _test = { bestCover, groupsOf, partition };
