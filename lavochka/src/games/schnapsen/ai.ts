/* Шнапсен — боты. Видят свою руку, открытый козырь, сыгранные карты и то, что соперник показал (марьяж, взятый козырь).
 *   Лёгкий — любая допустимая карта, марьяж объявляет, если заметил;
 *   Средний — правила опытного игрока: меняет валета, объявляет марьяжи, не тратит козырь на пустое, бьёт тузы и десятки,
 *             закрывает прикуп, когда 66 у него почти в кармане;
 *   Сложный — перебирает свои ходы на разыгранных раскладах: чужая рука и прикуп — наугад из невидимых карт
 *             (с учётом показанного), дальше партию доигрывают средние боты; под конец, когда прикупа нет, — точный перебор. */
import type { Rng } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { makeDeck, sameCard, SUITS, type Card } from '../../cards/deck';
import { apply, beats, canClose, canExchange, legal, marriages, meldValue, POINTS, POWER, score, strict, type Action, type Event, type State, type View } from './engine';

const has = (list: Card[], c: Card) => list.some((x) => sameCard(x, c));

/** Карты, которых этот игрок не видит (у соперника или в прикупе). */
function unseen(v: View | State, seat: number): Card[] {
  const all = makeDeck(24).filter((c) => v.cfg.deck === 24 || c.r !== 9);
  return all.filter((c) => !has(v.hands[seat], c) && !has(v.gone, c) && !(v.trumpCard && sameCard(v.trumpCard, c)) && !(v.lead && sameCard(v.lead.card, c)));
}

/** Карта — верная взятка в строгой игре: старше всех невидимых карт её масти, и козыри у соперника её не бьют (это козырь). */
function topOf(v: View | State, seat: number, c: Card): boolean {
  return !unseen(v, seat).some((x) => x.s === c.s && POWER[x.r] > POWER[c.r]);
}

// ---------------------------------------------------------------- средний бот

function medium(v: View | State, seat: number, rng: Rng): Action {
  const T = v.trump;
  const hand = v.hands[seat];
  const moves = legal(v, seat);
  const mar = marriages(v, seat);
  const inMarriage = (c: Card) => (c.r === 12 || c.r === 13) && mar.includes(c.s);
  const cheap = (cs: Card[]) => cs.slice().sort((a, b) => cost(a) - cost(b))[0];
  const cost = (c: Card) => POINTS[c.r] + (c.s === T ? 12 + POWER[c.r] : 0) + (inMarriage(c) ? 15 : 0);
  if (v.cfg.manual && !v.lead && v.tricks[seat]) {
    if (score(v, seat) >= 66) return { type: 'claim' };
    const m = !v.meld && mar.find((x) => score(v, seat) + meldValue(v, x) >= 66);
    if (m) return { type: 'claim', meld: m };
  }

  if (!v.lead) {
    if (v.meld) return { type: 'play', card: cheap(moves) };
    if (canExchange(v, seat)) return { type: 'exchange' };
    if (mar.length) {
      // сначала козырный марьяж (40); заходим дамой — король ещё пригодится
      const suit = mar.includes(T) ? T : mar.sort((a, b) => meldValue(v, b) - meldValue(v, a))[0];
      const q = hand.find((c) => c.s === suit && c.r === 12)!;
      return { type: 'play', card: q, meld: true };
    }
    if (canClose(v, seat) && closeGood(v, seat)) return { type: 'close' };
    if (strict(v)) {
      // верные взятки — забираем; потом выбиваем козыри
      const sure = moves.filter((c) => topOf(v, seat, c) && (c.s === T || !unseen(v, seat).some((x) => x.s === T) || unseen(v, seat).some((x) => x.s === c.s)));
      if (sure.length) return { type: 'play', card: sure.sort((a, b) => POINTS[b.r] - POINTS[a.r])[0] };
      return { type: 'play', card: cheap(moves) };
    }
    // прикуп открыт: заходим мелочью, не козырем
    const plain = moves.filter((c) => c.s !== T && !inMarriage(c));
    const low = plain.filter((c) => POINTS[c.r] <= 4);
    if (low.length) return { type: 'play', card: cheap(low) };
    // туз, который никто не перебьёт в масть
    return { type: 'play', card: cheap(plain.length ? plain : moves) };
  }

  const lc = v.lead.card;
  const winners = moves.filter((c) => beats(lc, c, T));
  const sameWin = winners.filter((c) => c.s === lc.s);
  const onTable = POINTS[lc.r];
  if (strict(v)) {
    if (winners.length) return { type: 'play', card: cheap(winners) };
    return { type: 'play', card: cheap(moves) };
  }
  // старшей той же масти — берём, если дёшево или жирно
  if (sameWin.length) {
    const w = sameWin.sort((a, b) => POWER[b.r] - POWER[a.r])[0];
    if (onTable + POINTS[w.r] >= 10 || !inMarriage(w)) return { type: 'play', card: w };
  }
  // туз или десятка на столе — бьём младшим козырем
  if (onTable >= 10) {
    const tr = winners.filter((c) => c.s === T && !inMarriage(c)).sort((a, b) => POWER[a.r] - POWER[b.r]);
    if (tr.length && POWER[tr[0].r] <= POWER[13]) return { type: 'play', card: tr[0] };
    if (tr.length && score(v, seat) + onTable + POINTS[tr[0].r] >= 66) return { type: 'play', card: tr[0] };
  }
  // добить до 66
  for (const c of winners) if (score(v, seat) + onTable + POINTS[c.r] >= 66 && v.tricks[seat] + 1 > 0) return { type: 'play', card: c };
  // иначе — сбросить пустое
  const throwaway = moves.filter((c) => c.s !== T && !inMarriage(c)).sort((a, b) => POINTS[a.r] - POINTS[b.r]);
  if (throwaway.length && POINTS[throwaway[0].r] <= 4) return { type: 'play', card: throwaway[0] };
  return { type: 'play', card: cheap(moves) };
}

/** Закрыть прикуп: верные взятки + уже набранное дают 66. */
function closeGood(v: View | State, seat: number): boolean {
  const T = v.trump;
  const hand = v.hands[seat];
  const opp = unseen(v, seat);
  let sure = score(v, seat);
  // марьяжи, которые можно объявить
  for (const s of marriages(v, seat)) sure += meldValue(v, s);
  for (const c of hand) {
    const top = !opp.some((x) => x.s === c.s && POWER[x.r] > POWER[c.r]);
    if (top && c.s === T) sure += POINTS[c.r] + 6;
    else if (top && c.r === 14) sure += POINTS[c.r] + 4;
  }
  return sure >= 72 && v.tricks[seat] > 0;
}

// ---------------------------------------------------------------- сложный бот

/** Все разумные действия: ход картой (с марьяжем, если можно), обмен, закрытие. */
function candidates(v: View | State, seat: number): Action[] {
  const out: Action[] = [];
  if (!v.lead && !v.meld) {
    if (canExchange(v, seat)) return [{ type: 'exchange' }]; // меняться выгодно всегда
    if (canClose(v, seat)) out.push({ type: 'close' });
    const mar = marriages(v, seat);
    for (const c of legal(v, seat)) {
      if ((c.r === 12 || c.r === 13) && mar.includes(c.s)) out.push({ type: 'play', card: c, meld: true });
      else out.push({ type: 'play', card: c });
    }
    return out;
  }
  for (const c of legal(v, seat)) out.push({ type: 'play', card: c });
  return out;
}

/** Разыграть расклад: невидимые карты делятся на руку соперника и прикуп. */
function world(v: View, seat: number, rng: Rng): State {
  const opp = v.seats.find((x) => x !== seat)!;
  const pool = unseen(v, seat).filter((c) => !has(v.shown[opp], c));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const oppHand = [...v.shown[opp]];
  while (oppHand.length < v.counts[opp]) oppHand.push(pool.pop()!);
  const hands = v.hands.slice();
  hands[opp] = oppHand;
  const { counts: _c, stockLeft: _s, ...rest } = v;
  return { ...(rest as Omit<State, 'stock'>), hands, stock: pool } as State;
}

/** Итог сдачи для seat в очках партии (+ выиграл, − проиграл). */
function handValue(evs: Event[], seat: number): number | null {
  for (const e of evs) if (e.type === 'hand') return e.winner === seat ? e.gp : -e.gp;
  return null;
}

function rollout(s0: State, seat: number, first: Action, rng: Rng): number {
  let s = s0;
  let a: Action = first;
  let who = s.turn;
  for (let guard = 0; guard < 80; guard++) {
    const r = apply(s, who, a, rng);
    if (!r) return -3;
    const hv = handValue(r.events, seat);
    if (hv != null) return hv;
    s = r.state;
    who = s.turn;
    a = medium(s, who, rng);
  }
  return 0;
}

/** Точный перебор в строгой игре (обе руки известны в этом раскладе). */
function exact(s: State, seat: number, depth: number, alpha: number, beta: number, rng: Rng): number {
  const who = s.turn;
  const acts = candidates(s, who).filter((a) => a.type !== 'close');
  let best = who === seat ? -Infinity : Infinity;
  for (const a of acts) {
    const r = apply(s, who, a, rng);
    if (!r) continue;
    const hv = handValue(r.events, seat);
    const val = hv != null ? hv : depth > 40 ? 0 : exact(r.state, seat, depth + 1, alpha, beta, rng);
    if (who === seat) {
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
    } else {
      best = Math.min(best, val);
      beta = Math.min(beta, val);
    }
    if (alpha >= beta) break;
  }
  return best === Infinity || best === -Infinity ? 0 : best;
}

function hard(v: View, seat: number, rng: Rng): Action {
  if (v.cfg.manual) {
    const m = medium(v, seat, rng);
    if (m.type === 'claim') return m;
  }
  const acts = candidates(v, seat);
  if (acts.length === 1) return acts[0];
  const worlds = 80;
  const total = acts.map(() => 0);
  const opp = v.seats.find((x) => x !== seat)!;
  const small = strict(v) && v.counts[opp] + v.hands[seat].length <= 12;
  for (let w = 0; w < worlds; w++) {
    const sim = new SeededRng((rng.int(1 << 30) ^ (w * 7919)) | 0);
    const s = world(v, seat, sim);
    acts.forEach((a, i) => {
      if (small) {
        const r = apply(s, seat, a, sim);
        if (!r) return void (total[i] -= 9);
        const hv = handValue(r.events, seat);
        total[i] += hv != null ? hv : exact(r.state, seat, 0, -Infinity, Infinity, sim);
      } else total[i] += rollout(s, seat, a, sim);
    });
  }
  let bi = 0;
  total.forEach((t, i) => {
    if (t > total[bi] + 1e-9) bi = i;
  });
  return acts[bi];
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  // выйти с 66 — всегда (лёгкий тоже не забывает)
  if (v.cfg.manual && !v.lead && v.tricks[seat] && score(v, seat) >= 66) return { type: 'claim' };
  if (level === 0) {
    if (!v.lead && !v.meld) {
      const mar = marriages(v, seat);
      if (mar.length && rng.next() < 0.6) return { type: 'play', card: v.hands[seat].find((c) => c.s === mar[0] && c.r === 13)!, meld: true };
    }
    const moves = legal(v, seat);
    return { type: 'play', card: moves[rng.int(moves.length)] };
  }
  if (level === 1) return medium(v, seat, rng);
  return hard(v, seat, rng);
}

export const _test = { medium, unseen, world, SUITS };
