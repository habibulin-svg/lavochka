/* Пулук — боты. Ход один (бросок уже сделан), выбор — каким воином ходить. Средний оценивает позицию после хода:
 * свободные воины сторон, убитые и пленные, близость стопок с пленными к концу дорожки и угрозу от врагов (вероятность, что
 * следующий бросок соперника приведёт его на поле). Сложный ещё перебирает все пять бросков соперника и его лучший ответ.
 * Лёгкий ходит наугад, но взятие замечает через раз. */
import type { Rng } from '../../core/types';
import { applyMove, applyRoll, free, legalMoves, P, side, type Action, type State } from './engine';

/** Что стоит воин или пленный: вес «живого» и «убитого». */
function material(s: State, sd: number): number {
  let v = 0;
  for (let i = 0; i < s.n; i++) {
    const k = free(s, i) * 100 - s.dead[i] * 20;
    v += side(i) === sd ? k : -k;
  }
  return v;
}

/** Угроза: для каждой стопки — вероятность, что на неё встанет враг следующим броском, умноженная на её цену. */
function danger(s: State, sd: number): number {
  const len = s.cfg.len;
  let sum = 0;
  s.track.forEach((st, c) => {
    if (!st || side(st.seat) !== sd) return;
    let pr = 0;
    for (let v = 1; v <= 5; v++) {
      let hit = false;
      // враги на дорожке, идущие к этой клетке
      s.track.forEach((e, ec) => {
        if (!e || side(e.seat) === sd || hit) return;
        if (ec + e.dir * v === c) hit = true;
      });
      // вход из дома соперника
      if (!hit) {
        for (let i = 0; i < s.n; i++) {
          if (side(i) === sd || s.home[i] <= 0) continue;
          const at = side(i) === 0 ? v - 1 : len - v;
          if (at === c) hit = true;
        }
      }
      if (hit) pr += P[v];
    }
    // цена стопки: сам воин и пленные (своих освободят, чужих отберут)
    sum += pr * (100 + st.pris.length * 100);
  });
  return sum;
}

/** Стопки с пленными ближе к концу дорожки — ближе к тому, чтобы пленных убить. */
function carry(s: State, sd: number): number {
  const len = s.cfg.len;
  let v = 0;
  s.track.forEach((st, c) => {
    if (!st || side(st.seat) !== sd || !st.pris.length) return;
    const left = st.dir === 1 ? len - c : c + 1;
    v += st.pris.length * (len - left) * 2;
  });
  return v;
}

function score(s: State, sd: number, careful: boolean): number {
  if (s.phase === 'over') return s.winner === sd ? 1e6 : s.winner == null ? 0 : -1e6;
  let v = material(s, sd) + carry(s, sd) - carry(s, 1 - sd);
  if (careful) {
    // кто ходит следующим — тот и бьёт первым
    const mine = side(s.turn) === sd;
    v -= danger(s, sd) * (mine ? 0.3 : 0.9);
    v += danger(s, 1 - sd) * (mine ? 0.6 : 0.2);
  }
  return v;
}

/** Лучший ответ стороны того, кто сейчас бросает: средняя оценка по пяти броскам (для стороны sd). */
function reply(s: State, sd: number): number {
  if (s.phase !== 'roll') return score(s, sd, true);
  const opp = side(s.turn);
  let sum = 0;
  for (let v = 1; v <= 5; v++) {
    const k = v === 5 ? [0, 0, 0, 0] : [0, 1, 2, 3].map((i) => (i < v ? 1 : 0));
    const r = applyRoll(s, k).state;
    let best = -Infinity;
    let pick = r;
    for (const m of legalMoves(r)) {
      const t = applyMove(r, m.from)!.state;
      const x = score(t, opp, true);
      if (x > best) {
        best = x;
        pick = t;
      }
    }
    sum += P[v] * score(pick, sd, true);
  }
  return sum;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const ms = legalMoves(s);
  if (!ms.length) return null;
  if (level <= 0) {
    const takes = ms.filter((m) => m.took || m.killed);
    const pool = takes.length && rng.next() < 0.5 ? takes : ms;
    return { type: 'move', from: pool[rng.int(pool.length)].from };
  }
  const sd = side(seat);
  let best: Action | null = null;
  let bv = -Infinity;
  for (const m of ms) {
    const t = applyMove(s, m.from)!.state;
    const v = (level >= 2 ? reply(t, sd) : score(t, sd, true)) + rng.next() * (level >= 2 ? 0.5 : 8);
    if (v > bv) {
      bv = v;
      best = { type: 'move', from: m.from };
    }
  }
  return best;
}
