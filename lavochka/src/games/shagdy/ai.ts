/* Шагды — боты. Ход бота: для каждого незакрытого сочетания перебираются шаги (сложный — лучом, средний — жадно),
 * позиция после хода оценивается; выбирается сочетание с лучшей оценкой за вычетом «цены» сочетания
 * (дубли и большие суммы жалко тратить по мелочи). Дальше шаги делаются по найденному плану.
 *   Оценка: продвижение (сумма номеров) и фишки в цели, введённые фишки, минус одинокие фишки под ударом, плюс снятые чужие.
 *   Лёгкий — случайное сочетание и шаги «вперёд как получится». */
import type { Rng } from '../../core/types';
import { CELLS, combos, home, inGoal, legal, POS, progress, step, stepMoves, stepsOf, type Action, type State } from './engine';

function score(s: State, me: number): number {
  const opp = 1 - me;
  const side = (seat: number) => {
    let v = progress(s, seat) * 2 + home(s, seat) * 12 + s.entered[seat] * 3;
    // одинокие фишки вне цели, когда соперник уже может снимать
    if (s.entered[1 - seat] >= 10) {
      s.board.forEach((x, cell) => {
        if (x !== seat + 1) return;
        const p = POS[seat][cell];
        if (inGoal(p.pos, p.slot)) return;
        const pair = CELLS[seat][p.pos].filter((c) => s.board[c] === seat + 1).length >= 2;
        if (!pair) v -= 6 + p.pos * 0.6;
      });
    }
    return v - s.reserve[seat] * (s.entered[seat] >= 10 ? 10 : 0);
  };
  return side(me) - side(opp) * 0.8;
}

/** Лучшая последовательность шагов из позиции s (ход уже выбран): луч ширины width. */
function plan(s: State, width: number): { acts: Action[]; v: number } {
  const me = s.turn;
  let beam: { st: State; acts: Action[] }[] = [{ st: s, acts: [] }];
  let best = { acts: [] as Action[], v: score(s, me) };
  for (let depth = 0; depth < 4 && beam.length; depth++) {
    const next: { st: State; acts: Action[]; v: number }[] = [];
    for (const b of beam) {
      if (b.st.pick < 0 || b.st.turn !== me || b.st.over) continue;
      for (const a of stepMoves(b.st)) {
        const st = step(b.st, a).state;
        const v = st.over ? (st.winner === me ? 1e5 : st.winner == null ? 0 : -1e5) : score(st, me);
        next.push({ st, acts: [...b.acts, a], v });
      }
    }
    next.sort((x, y) => y.v - x.v);
    for (const n of next) if (n.v > best.v || (n.st.pick < 0 && best.acts.length === 0)) best = { acts: n.acts, v: n.v };
    // доведённые до конца хода варианты не продолжаем
    beam = next.filter((n) => n.st.pick >= 0 && n.st.turn === me).slice(0, width);
    for (const n of next) if (n.st.pick < 0 && n.v >= best.v) best = { acts: n.acts, v: n.v };
  }
  return best;
}

/** Цена сочетания: насколько жаль его тратить (сумма шагов, дубли — дороже). */
function cost(s: State, i: number): number {
  const [a, b] = combos(s.cfg.variant)[i];
  return stepsOf(s.cfg.variant, a, b).reduce((x, y) => x + y, 0) * 1.1;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const acts = legal(s);
  if (!acts.length) return null;
  if (level <= 0) {
    if (s.pick < 0) return acts[rng.int(acts.length)];
    // вперёд как получится: чаще — самый дальний шаг
    if (rng.next() < 0.5) return acts[rng.int(acts.length)];
    return acts.reduce((x, y) => (span(s, y) > span(s, x) ? y : x));
  }
  const width = level >= 2 ? 24 : 1;
  if (s.pick < 0) {
    let best: Action = acts[0];
    let bv = -Infinity;
    for (const a of acts) {
      if (a.type !== 'combo') continue;
      const st = step(s, a).state;
      const v = (st.turn !== seat || st.pick < 0 ? score(st, seat) : plan(st, width).v) - (level >= 2 ? cost(s, a.i) : 0) + (rng.next() - 0.5) * (level >= 2 ? 0.5 : 4);
      if (v > bv) {
        bv = v;
        best = a;
      }
    }
    return best;
  }
  const p = plan(s, width);
  return p.acts[0] ?? acts[0];
}

function span(s: State, a: Action): number {
  if (a.type !== 'step') return 0;
  const seat = s.turn;
  return POS[seat][a.to].pos - (a.from < 0 ? 0 : POS[seat][a.from].pos);
}

