/* Боты «Вкладышей». Видят только свой view (чужая рука и колоды — закрыты).
 * Лёгкий — выкладывает что попало и бьёт куда попало; Средний — самое дорогое по карману, выгодные размены, иначе в лицо;
 * Сложный — перебирает все действия на шаг вперёд с оценкой стола и видит добивание. */
import type { Rng } from '../../core/types';
import { card } from './cards';
import { apply, atkOf, legal, stateFromView, type Action, type State, type Unit, type View } from './engine';

function unitValue(board: Unit[], u: Unit): number {
  let v = atkOf(board, u) * 1.1 + u.hp * 0.9;
  if (u.kw.includes('wall')) v += 1;
  if (u.armor) v += 1;
  if (u.kw.includes('rush')) v += 0.3;
  return v;
}

/** Оценка стола глазами игрока me: больше — лучше. */
export function evaluate(s: State, me: number): number {
  const foe = 1 - me;
  if (s.over) return s.winner === me ? 1e6 : s.winner === foe ? -1e6 : 0;
  const P = s.players[me];
  const F = s.players[foe];
  let v = (P.hero - F.hero) * 0.9;
  // низкое терпение опаснее линейного
  if (P.hero < 8) v -= (8 - P.hero) * 1.2;
  if (F.hero < 8) v += (8 - F.hero) * 1.2;
  v += P.board.reduce((a, u) => a + unitValue(P.board, u), 0);
  v -= F.board.reduce((a, u) => a + unitValue(F.board, u), 0) * 1.05;
  v += P.hand.length * 0.6 - F.hand.length * 0.3;
  return v;
}

function step(s: State, seat: number, a: Action, rng: Rng): State | null {
  try {
    return apply(s, seat, a, rng)?.state ?? null;
  } catch {
    return null; // в симуляции попалась закрытая карта — такой ход не рассматриваем
  }
}

function easy(s: State, seat: number, acts: Action[], rng: Rng): Action {
  const plays = acts.filter((a) => a.t === 'play');
  const attacks = acts.filter((a) => a.t === 'attack');
  if (plays.length && rng.next() < 0.75) return plays[rng.int(plays.length)];
  if (attacks.length && rng.next() < 0.85) return attacks[rng.int(attacks.length)];
  return { t: 'end' };
}

function medium(s: State, seat: number, acts: Action[], rng: Rng): Action {
  const me = s.cur;
  const P = s.players[me];
  const F = s.players[1 - me];
  // 1) самое дорогое, что по карману; цель приёма — по оценке
  const plays = acts.filter((a): a is Extract<Action, { t: 'play' }> => a.t === 'play');
  const base = evaluate(s, me);
  // от дорогих к дешёвым; приём впустую (лечиться при полном терпении) — пропускаем
  for (const cost of [...new Set(plays.map((a) => card(P.hand[a.i]).cost))].sort((a, b) => b - a)) {
    let pick: Action | null = null;
    let pv = base - 0.7;
    for (const a of plays) {
      if (card(P.hand[a.i]).cost !== cost) continue;
      const n = step(s, seat, a, rng);
      const v = n ? evaluate(n, me) : -Infinity;
      if (v > pv) [pv, pick] = [v, a];
    }
    if (pick) return pick;
  }
  // 2) размен: убить и выжить; иначе — в лицо
  const attacks = acts.filter((a): a is Extract<Action, { t: 'attack' }> => a.t === 'attack');
  for (const a of attacks) {
    if (a.tgt.uid === undefined) continue;
    const u = P.board.find((x) => x.uid === a.uid)!;
    const t = F.board.find((x) => x.uid === a.tgt.uid)!;
    const kills = !t.armor && atkOf(P.board, u) >= t.hp;
    const lives = u.armor || atkOf(F.board, t) < u.hp;
    if (kills && lives) return a;
  }
  const face = attacks.find((a) => a.tgt.uid === undefined);
  if (face) return face;
  if (attacks.length) return attacks[rng.int(attacks.length)]; // стенка — бить её
  return { t: 'end' };
}

function hard(s: State, seat: number, acts: Action[], rng: Rng): Action {
  const me = s.cur;
  const base = evaluate(s, me);
  let best: Action = { t: 'end' };
  let bv = base + 0.05;
  for (const a of acts) {
    if (a.t === 'end') continue;
    const n = step(s, seat, a, rng);
    if (!n) continue;
    let v = evaluate(n, me);
    // смотрим, что будет, если этим же ходом ещё и ударить всеми — ловим добивание
    if (!n.over && a.t === 'play') v += 0.01 * n.players[me].board.length;
    if (v > bv) [bv, best] = [v, a];
  }
  return best;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  const s = stateFromView(v);
  if (s.over || s.players[s.cur].seat !== seat) return null;
  const acts = legal(s);
  if (level <= 0) return easy(s, seat, acts, rng);
  if (level === 1) return medium(s, seat, acts, rng);
  return hard(s, seat, acts, rng);
}
