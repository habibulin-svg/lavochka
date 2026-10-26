/* Патолли — боты. Бросок уже сделан, выбор — какой фишкой ходить (или вводить новую). Средний оценивает позицию после
 * хода: ставки, пройденный путь, ушедшие фишки, угрозу сбивания (вероятность, что соперник следующим броском встанет на
 * фишку) и треугольники. Сложный ещё перебирает броски следующего соперника и его лучший ответ.
 * Лёгкий ходит наугад, но выгодное (уйти с поля, сбить, встать на полукруг) замечает через раз. */
import type { Rng } from '../../core/types';
import { applyMove, applyRoll, canHitAt, CELLS, cellOf, legalMoves, PC, type Action, type State } from './engine';

/** Значение броска для c меток. */
function valueOf(s: State, c: number) {
  if (s.cfg.throws === 'modern') return c === 0 ? 10 : c;
  return c === 5 ? 10 : c;
}

/** Вероятность, что соперники следующим броском встанут на клетку cell. */
function threat(s: State, seat: number, cell: number): number {
  if (!canHitAt(s.cfg, cell)) return 0;
  let pr = 0;
  for (let c = 0; c <= 5; c++) {
    const v = valueOf(s, c);
    if (v <= 0) continue;
    let hit = false;
    for (let i = 0; i < s.n && !hit; i++) {
      if (i === seat || s.out[i]) continue;
      const arm = s.arms[i];
      for (const p of s.pos[i]) {
        if (p < 0 || p >= CELLS) {
          if (p < 0 && (s.cfg.enter === 'any' || v === 1) && cellOf(arm, v - 1) === cell) hit = true;
          continue;
        }
        if (p + v < CELLS && cellOf(arm, p + v) === cell) hit = true;
      }
    }
    if (hit) pr += PC[c];
  }
  return pr;
}

function score(s: State, seat: number, careful: boolean): number {
  if (s.phase === 'over') return s.winners.includes(seat) ? 1e6 : -1e6;
  let v = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.out[i]) {
      v += i === seat ? -1e5 : 3000 / s.n;
      continue;
    }
    let k = s.stakes[i] * (s.cfg.goal === 'stakes' ? 60 : 25) + s.laps[i] * (s.cfg.goal === 'race' ? 120 : 40);
    for (const p of s.pos[i]) {
      if (p >= CELLS) continue;
      if (p >= 0) {
        k += 20 + p * 2;
        if (careful) k -= threat(s, i, cellOf(s.arms[i], p)) * (40 + p * 2 + 25);
      }
    }
    // на мели — опаснее: следующая плата может выбить
    if (s.stakes[i] <= 1) k -= 40;
    v += i === seat ? k : -k / Math.max(1, s.n - 1);
  }
  return v;
}

/** Ответ следующего игрока: средняя оценка (для seat) по его броскам и его лучшему ходу. */
function reply(s: State, seat: number): number {
  if (s.phase !== 'roll' || s.turn === seat) return score(s, seat, true);
  let sum = 0;
  for (let c = 0; c <= 5; c++) {
    const beans = [0, 1, 2, 3, 4].map((i) => (i < c ? 1 : 0));
    const r = applyRoll(s, beans).state;
    let pick = r;
    if (r.phase === 'move') {
      let best = -Infinity;
      for (const m of legalMoves(r)) {
        const t = applyMove(r, m.from)!.state;
        const x = score(t, r.turn, true);
        if (x > best) {
          best = x;
          pick = t;
        }
      }
    }
    sum += PC[c] * score(pick, seat, true);
  }
  return sum;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const ms = legalMoves(s);
  if (!ms.length) return null;
  if (level <= 0) {
    const good = ms.filter((m) => m.hit >= 0 || m.kind === 'home' || m.kind === 'cap');
    const pool = good.length && rng.next() < 0.5 ? good : ms;
    return { type: 'move', from: pool[rng.int(pool.length)].from };
  }
  let best: Action | null = null;
  let bv = -Infinity;
  for (const m of ms) {
    const t = applyMove(s, m.from)!.state;
    const v = (level >= 2 ? reply(t, seat) : score(t, seat, true)) + rng.next() * (level >= 2 ? 0.5 : 6);
    if (v > bv) {
      bv = v;
      best = { type: 'move', from: m.from };
    }
  }
  return best;
}
