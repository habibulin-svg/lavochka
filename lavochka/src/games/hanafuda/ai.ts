/* Ханафуда — боты. Видят свою руку, стол и всё взятое (оно лежит открыто).
 *   Лёгкий — любой допустимый ход, на «коикои/го» отвечает наугад, но с хорошими очками останавливается;
 *   Средний — берёт самое ценное и то, что ведёт к комбинациям, не оставляет сопернику готовых пар к его комбинациям;
 *             «коикои/го» — только при малых очках и длинной руке;
 *   Сложный — для каждого хода разыгрывает кон до конца в нескольких раскладах невидимых карт (ходы — как у среднего)
 *             и выбирает лучший средний итог. */
import type { Rng } from '../../core/types';
import { SeededRng, shuffle } from '../../core/rng';
import { BOAR, BUTTERFLY, CURTAIN, DEER, MOON, RAIN, SAKE, info, monthOf } from './cards';
import { apply, cloneState, goMin, moves, pointsOf, unseen, type Action, type State, type View } from './engine';
import { piValue } from './yaku';

/** Ценность карты для взявшего (с учётом того, что уже взято). */
function worth(v: View | State, seat: number, id: number): number {
  const c = info(id);
  const mine = v.caps[seat];
  const go = v.cfg.mode === 'gostop';
  let w = 0.4;
  if (c.kind === 'hikari') w = id === RAIN ? 3 : 6;
  else if (c.kind === 'tane') w = [BOAR, DEER, BUTTERFLY].includes(id) || id === SAKE ? 4 : 2.2;
  else if (c.kind === 'tan') w = c.ribbon === 'red' ? 1.6 : 3;
  else w = go ? 0.6 * piValue(id) : 0.5;
  // близко к комбинации — дороже
  if (c.kind === 'hikari') w += mine.filter((x) => info(x).kind === 'hikari').length * 1.5;
  if (c.ribbon && c.ribbon !== 'red') w += mine.filter((x) => info(x).ribbon === c.ribbon).length * 1.2;
  if (!go && id === SAKE && (mine.includes(CURTAIN) || mine.includes(MOON))) w += 4;
  if (!go && (id === CURTAIN || id === MOON) && mine.includes(SAKE)) w += 4;
  if (go && c.kind === 'kasu') w += Math.max(0, mine.reduce((a, x) => a + piValue(x), 0) - 5) * 0.15;
  return w;
}

/** Ценность хода «сразу»: что берём сыгранной картой; что оставляем на столе сопернику. */
function playGain(v: View, seat: number, a: Action): number {
  if (a.type === 'pass') return 0;
  if (a.type === 'bomb') {
    const cards = [...v.hands[seat].filter((c) => monthOf(c) === a.month), ...v.table.filter((c) => monthOf(c) === a.month)];
    return cards.reduce((x, c) => x + worth(v, seat, c), 0) + 4;
  }
  if (a.type !== 'play') return 0;
  const m = monthOf(a.card);
  const on = v.table.filter((c) => monthOf(c) === m);
  const opp = v.seats.filter((x) => x !== seat);
  const oppWorth = (c: number) => Math.max(...opp.map((x) => worth(v, x, c)));
  if (!on.length) {
    // положил на стол: заберут, только если у кого-то (или в колоде) есть карта этого месяца;
    // своя пара на руке — заберу сам следующим ходом
    const hidden = unseen(v, seat).filter((c) => monthOf(c) === m);
    const mate = v.hands[seat].some((c) => c !== a.card && monthOf(c) === m);
    let risk = hidden.length ? oppWorth(a.card) * Math.min(1, 0.4 + hidden.length * 0.3) : 0;
    if (mate) risk *= 0.5;
    return -risk * 0.7 - worth(v, seat, a.card) * 0.15 + (a.shake ? 1.5 : 0);
  }
  const got = on.length === 2 ? [a.onto!] : on;
  let g = worth(v, seat, a.card) + got.reduce((x, c) => x + worth(v, seat, c), 0);
  if (on.length === 2) g -= oppWorth(on.find((c) => c !== a.onto)!) * 0.3;
  return g;
}

function decideCall(v: View | State, seat: number, level: number, rng: Rng): Action {
  const pts = pointsOf(v, seat).total;
  const hand = v.hands[seat].length + v.skips[seat];
  const opp = v.seats.filter((x) => x !== seat);
  const oppPts = Math.max(...opp.map((x) => pointsOf(v, x).total));
  if (level === 0) return { type: 'call', go: pts < 4 && rng.next() < 0.5 };
  if (v.cfg.mode === 'koikoi') {
    const oppNear = opp.some((x) => v.caps[x].filter((c) => info(c).kind === 'hikari').length >= 2 || v.caps[x].filter((c) => info(c).kind === 'tan').length >= 4);
    return { type: 'call', go: pts <= 3 && hand >= 4 && !oppNear };
  }
  const need = goMin(v.seats.length);
  return { type: 'call', go: hand >= 3 && pts < need + 3 && oppPts < need - 2 };
}

function medium(v: View | State, seat: number, rng: Rng, level = 1): Action | null {
  const all = moves(v, seat);
  if (!all.length) return null;
  if (all.length === 1) return all[0];
  if (v.phase === 'call') return decideCall(v, seat, level, rng);
  if (v.phase === 'pick') {
    let best = all[0];
    let bw = -Infinity;
    for (const a of all) {
      const w = a.type === 'pick' ? worth(v, seat, a.card) : 0;
      if (w > bw) {
        bw = w;
        best = a;
      }
    }
    return best;
  }
  let best = all[0];
  let bs = -Infinity;
  for (const a of all) {
    const sc = playGain(v as View, seat, a) + rng.next() * 0.05;
    if (sc > bs) {
      bs = sc;
      best = a;
    }
  }
  return best;
}

/** Расклад: невидимые карты — по чужим рукам и в колоду наугад. */
function sample(v: View, seat: number, rng: Rng): State {
  const pool = shuffle(unseen(v, seat), rng);
  const s = cloneState({ ...(v as unknown as State), deck: [], hands: v.hands });
  for (const x of v.seats) if (x !== seat) s.hands[x] = pool.splice(0, v.counts[x]);
  s.deck = pool;
  return s;
}

/** Доиграть кон средними ходами; итог — очки места минус лучшие чужие. */
function rollout(s0: State, seat: number, rng: Rng): number {
  let s = s0;
  const r0 = s.round;
  for (let k = 0; k < 200; k++) {
    if (s.round !== r0 || s.over) break;
    const who = s.turn;
    const a = medium(s, who, rng);
    if (!a) break;
    const r = apply(s, who, a, rng);
    if (!r) break;
    s = r.state;
  }
  if (s.round === r0 && !s.over) return 0;
  const add = s.last?.add ?? [];
  const mine = add[seat] ?? 0;
  const others = Math.max(...s.seats.filter((x) => x !== seat).map((x) => add[x] ?? 0));
  return s.cfg.mode === 'koikoi' ? mine - others : mine;
}

function hard(v: View, seat: number, rng: Rng, worlds: number): Action | null {
  const all = moves(v, seat);
  if (all.length <= 1) return all[0] ?? null;
  // отбросить заведомо плохие ходы: оставить 6 лучших по оценке «сразу»
  let cand = all;
  if (v.phase === 'play' && all.length > 6) cand = all.map((a) => ({ a, g: playGain(v, seat, a) })).sort((x, y) => y.g - x.g).slice(0, 6).map((x) => x.a);
  // одни и те же расклады и та же случайность доигрывания для всех ходов — сравниваем ходы, а не удачу
  const seeds = Array.from({ length: worlds }, () => rng.int(1 << 30));
  let best = cand[0];
  let bs = -Infinity;
  for (const a of cand) {
    let sum = 0;
    for (const seed of seeds) {
      const wr = new SeededRng(seed);
      const s = sample(v, seat, wr);
      const r = apply(s, seat, a, wr);
      if (!r) continue;
      sum += r.state.round !== s.round || r.state.over ? (r.state.last?.add[seat] ?? 0) : rollout(r.state, seat, wr);
    }
    const sc = sum / worlds + (a.type === 'play' || a.type === 'bomb' ? playGain(v, seat, a) * 0.02 : 0);
    if (sc > bs) {
      bs = sc;
      best = a;
    }
  }
  return best;
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** Сколько раскладов у сложного; в быстрых проверках (vitest без SIM_GAMES) — меньше, чтобы партии ботов шли быстро. */
export const HARD = { worlds: env?.VITEST && !env?.SIM_GAMES ? 3 : 50 };

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const all = moves(v, seat);
  if (!all.length) return null;
  if (v.phase === 'draw') return all[0];
  if (level === 0) {
    if (v.phase === 'call') return decideCall(v, seat, 0, rng);
    return all[rng.int(all.length)];
  }
  if (level === 1) return medium(v, seat, rng);
  return hard(v, seat, rng, HARD.worlds);
}
