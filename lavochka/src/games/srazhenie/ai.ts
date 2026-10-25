/* «Сражение» — боты. Видят только свой view: чужие нераскрытые фишки — без ранга, но видно, ходила ли фишка
 * (ходившая — не мина и не знамя) и сколько каких фишек соперник уже потерял.
 * Лёгкий — случайный ход, охотно нападает. Средний — оценка хода на один полуход: бой с известными по рангам,
 * с неизвестными — по вероятностям оставшихся рангов, отход от угрозы. Сложный — то же плюс угрозы от неизвестных
 * ходивших фишек, охота сапёрами на неходившие, бережёт Маршала от Разведчика и знает, где искать знамя. */
import type { Rng } from '../../core/types';
import { apply, COUNT, FLAG, fight, legalMoves, MARSHAL, MINE, movable, N, row, SAPPER, SCOUT, SIZE, type Action, type State } from './engine';

const V: Record<number, number> = { 1: 100, 2: 80, 3: 60, 4: 45, 5: 35, 6: 25, 7: 18, 8: 30, 9: 9, 10: 40, 11: 12, 12: 5000 };

/** Распределение ранга неизвестной фишки соперника. */
function belief(v: State, enemy: number, moved: boolean, deep: boolean, back: number): Map<number, number> {
  const left: Record<number, number> = { ...COUNT };
  for (const r of v.lost[enemy]) left[r]--;
  for (const c of v.cells) if (c && c.owner === enemy && c.rank != null) left[c.rank]--;
  const m = new Map<number, number>();
  let sum = 0;
  for (const r of Object.keys(left).map(Number)) {
    let w = Math.max(0, left[r]);
    if (moved && !movable(r)) w = 0;
    // сложный: мины и знамя чаще стоят в задних рядах
    if (deep && !moved && (r === MINE || r === FLAG)) w *= 0.4 + back * 0.6;
    if (w > 0) {
      m.set(r, w);
      sum += w;
    }
  }
  for (const [r, w] of m) m.set(r, w / sum);
  return m;
}

/** Насколько клетка в глубине зоны соперника (0 — середина поля, 1 — его задний ряд). */
function depth(p: number, enemy: number): number {
  const r = row(p);
  const d = enemy === 1 ? 3 - r : r - 6;
  return d < 0 ? 0 : (d + 1) / 4;
}

function battleValue(att: number, def: number): number {
  const res = fight(att, def);
  if (res === 'win') return V[def];
  if (res === 'lose') return -V[att];
  return V[def] - V[att];
}

const NB = [-SIZE, SIZE, -1, 1];
function neighbours(p: number): number[] {
  const out: number[] = [];
  for (const d of NB) {
    const q = p + d;
    if (q < 0 || q >= N) continue;
    if ((d === 1 || d === -1) && Math.floor(q / SIZE) !== Math.floor(p / SIZE)) continue;
    out.push(q);
  }
  return out;
}

/** Опасность для нашей фишки ранга rank на клетке p от соседних фишек соперника (кроме взятой). */
function danger(v: State, p: number, rank: number, me: number, deep: boolean, skip: number): number {
  let worst = 0;
  for (const q of neighbours(p)) {
    if (q === skip) continue;
    const c = v.cells[q];
    if (!c || c.owner === me) continue;
    if (c.rank != null) {
      if (!movable(c.rank)) continue;
      const res = fight(c.rank, rank);
      if (res !== 'lose') worst = Math.max(worst, V[rank] - (res === 'both' ? V[c.rank] : 0));
    } else if (deep && c.moved) {
      let e = 0;
      for (const [r, pr] of belief(v, 1 - me, true, deep, 0)) {
        const res = fight(r, rank);
        if (res === 'win') e += pr * V[rank];
        else if (res === 'both') e += pr * (V[rank] - V[r]);
      }
      worst = Math.max(worst, e * 0.6);
    }
  }
  return worst;
}

function score(v: State, a: Extract<Action, { type: 'move' }>, me: number, level: number, rng: Rng): number {
  const deep = level >= 2;
  const enemy = 1 - me;
  const pc = v.cells[a.from]!;
  const rank = pc.rank!;
  const t = v.cells[a.to];
  let s = 0;
  if (t) {
    if (t.rank != null) s += battleValue(rank, t.rank);
    else {
      const b = belief(v, enemy, t.moved, deep, depth(a.to, enemy));
      let e = 0;
      for (const [r, pr] of b) e += pr * battleValue(rank, r);
      s += e;
      // разведка боем: дешёвыми фишками неизвестное трогать не жалко
      if (rank === 9 || rank === 7) s += 6;
      // сапёр — на неходившие в глубине
      if (deep && rank === SAPPER && !t.moved) s += 10 * depth(a.to, enemy);
      // ценные — не в слепой бой
      if (rank <= 3) s -= 15;
    }
  } else {
    // вперёд, к сопернику; Маршал и Генерал не спешат
    const fwd = me === 0 ? row(a.from) - row(a.to) : row(a.to) - row(a.from);
    s += fwd * (rank <= 2 ? 0.5 : 2);
    // прежняя угроза снята — плюс
    s += danger(v, a.from, rank, me, deep, -1) * 0.8;
  }
  // после хода фишка может оказаться под ударом
  const stays = !t || (t.rank != null && fight(rank, t.rank) === 'win');
  if (stays) s -= danger(v, a.to, rank, me, deep, a.to) * (deep ? 0.9 : 0.6);
  if (deep && rank === MARSHAL) {
    // Разведчик (10) бьёт Маршала, если нападёт первым
    for (const q of neighbours(a.to)) {
      const c = v.cells[q];
      if (c && c.owner === enemy && (c.rank === SCOUT || (c.rank == null && c.moved))) s -= c.rank === SCOUT ? V[MARSHAL] : 8;
    }
  }
  return s + rng.next() * (level === 0 ? 30 : 3);
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'deploy') {
    if (v.ready[seat]) return null;
    if (level > 0 && !v.laid[seat]) return { type: 'auto' };
    return { type: 'ready' };
  }
  if (v.phase !== 'play' || v.turn !== seat) return null;
  const moves = legalMoves(v, seat) as Extract<Action, { type: 'move' }>[];
  if (!moves.length) return null;
  if (level === 0) {
    const att = moves.filter((m) => v.cells[m.to]);
    if (att.length && rng.next() < 0.5) return att[rng.int(att.length)];
    return moves[rng.int(moves.length)];
  }
  const scored = moves.map((m) => ({ m, sc: score(v, m, seat, level, rng) })).sort((a, b) => b.sc - a.sc);
  if (level < 2) return scored[0].m;
  return search(v, seat, scored.slice(0, 10), rng);
}

/** Раскладка неизвестных рангов соперника, согласная с тем, что известно: ходившие — не мины и не знамя,
 * знамя и мины — скорее в задних рядах. */
function sample(v: State, me: number, rng: Rng): State {
  const enemy = 1 - me;
  const left: number[] = [];
  const cnt: Record<number, number> = { ...COUNT };
  for (const r of v.lost[enemy]) cnt[r]--;
  for (const c of v.cells) if (c && c.owner === enemy && c.rank != null) cnt[c.rank]--;
  for (const r of Object.keys(cnt).map(Number)) for (let k = 0; k < cnt[r]; k++) left.push(r);
  const cells = v.cells.map((c) => (c ? { ...c } : null));
  const hidden = cells.map((c, p) => ({ c, p })).filter((x) => x.c && x.c.owner === enemy && x.c.rank == null);
  const fixed = left.filter((r) => !movable(r));
  const mob = left.filter((r) => movable(r));
  // неходившие по глубине (с шумом): самые глубокие получают знамя и мины
  const still = hidden.filter((x) => !x.c!.moved).sort((a, b) => depth(b.p, enemy) + rng.next() * 0.6 - (depth(a.p, enemy) + rng.next() * 0.6));
  const moved = hidden.filter((x) => x.c!.moved);
  const pool = [...mob];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  fixed.sort((a, b) => b - a); // знамя (12) — первым, в самую глубину
  for (const x of moved) x.c!.rank = pool.pop() ?? 9;
  for (const x of still) x.c!.rank = rng.next() < 0.75 && fixed.length ? fixed.shift()! : (pool.pop() ?? fixed.shift() ?? 9);
  return { ...v, cells };
}

/** Тяга к чужому знамени в раскладке (подобрано партиями: сложный против среднего ~7:3). */
const FLAG_PULL = 10;
const dist = (a: number, b: number) => Math.abs(row(a) - row(b)) + Math.abs((a % SIZE) - (b % SIZE));

function material(s: State, me: number): number {
  let m = 0;
  const flags = [-1, -1];
  s.cells.forEach((c, p) => {
    if (c && c.rank === FLAG) flags[c.owner] = p;
  });
  s.cells.forEach((c, p) => {
    if (!c || c.rank == null) return;
    m += (c.owner === me ? 1 : -1) * Math.min(V[c.rank], 400);
    if (!movable(c.rank)) return;
    // близость к чужому знамени: свои — плюс, чужие у нашего — минус
    const f = flags[1 - c.owner];
    if (f >= 0) m += (c.owner === me ? 1 : -1.5) * FLAG_PULL * Math.max(0, 6 - dist(p, f));
  });
  if (s.phase === 'over') m += s.winner === me ? 5000 : s.winner == null ? 0 : -5000;
  return m;
}

/** Сложный: на нескольких раскладках проверить свой ход и лучший ответ соперника. Соперник наших рангов не знает —
 * его выгоду от нападения на нераскрытую фишку берём с весом 0,3.
 * В оценке — материал и близость фишек к знамёнам (в раскладке знамя соперника «известно»). */
function search(v: State, me: number, cand: { m: Extract<Action, { type: 'move' }>; sc: number }[], rng: Rng): Action {
  const K = 16;
  const total = cand.map((x) => x.sc * 0.3);
  const noop: Rng = { next: () => 0.5, int: () => 0, getState: () => 0 };
  for (let k = 0; k < K; k++) {
    const w = sample(v, me, rng);
    const base = material(w, me);
    cand.forEach((x, i) => {
      const r = apply(w, me, x.m, noop);
      if (!r) return;
      const s1 = r.state;
      let after = material(s1, me);
      if (s1.phase === 'play') {
        let worst = 0;
        for (const e of legalMoves(s1, 1 - me) as Extract<Action, { type: 'move' }>[]) {
          const t = s1.cells[e.to];
          if (!t) continue;
          const r2 = apply(s1, 1 - me, e, noop);
          if (!r2) continue;
          let loss = after - material(r2.state, me);
          if (!t.known) loss *= 0.3;
          if (loss > worst) worst = loss;
        }
        after -= worst;
      }
      total[i] += (after - base) / K;
    });
  }
  let bi = 0;
  for (let i = 1; i < cand.length; i++) if (total[i] > total[bi]) bi = i;
  return cand[bi].m;
}
