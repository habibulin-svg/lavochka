/* «Освоение галактики» — боты. Видят только свой view (свою цель и свои карточки).
 * Лёгкий — ставит и осваивает почти наугад, лишь бы перевес; средний — целится в планеты своей цели (или самые дешёвые),
 * берёт хотя бы одну территорию за ход ради карточки; сложный — считает шансы боя, добивает соперников с карточками,
 * держит границы планет и подводит силы с тыла. */
import type { Rng } from '../../core/types';
import { ADJ, GOALS, PLANETS, PLANET_TERRS, TERRS } from './data';
import { ALLY, canAttack, canGo, canMove, count, mustTrade, sets, type Action, type State } from './engine';

// ---------- шансы освоения ----------
const P: Record<string, [number, number, number]> = {
  // [защита теряет всё, по одному, нападение теряет всё] для 2 кубиков против 2; для одиночных сравнений — [p защита теряет, 0, p нападение]
  '3,2': [2890 / 7776, 2611 / 7776, 2275 / 7776],
  '2,2': [295 / 1296, 420 / 1296, 581 / 1296],
  '3,1': [855 / 1296, 0, 441 / 1296],
  '2,1': [125 / 216, 0, 91 / 216],
  '1,2': [55 / 216, 0, 161 / 216],
  '1,1': [15 / 36, 0, 21 / 36],
};
const memo = new Map<number, number>();
/** Вероятность взять территорию: a — звездолётов, которыми можно бить (кроме оставляемого), d — защитников. */
export function winProb(a: number, d: number): number {
  if (d <= 0) return 1;
  if (a <= 0) return 0;
  if (a > 40 || d > 40) return a > d * 1.3 ? 0.95 : a > d ? 0.7 : 0.3;
  const key = a * 64 + d;
  const m = memo.get(key);
  if (m != null) return m;
  const ad = Math.min(3, a);
  const dd = Math.min(2, d);
  const [pd, pe, pa] = P[`${ad},${dd}`];
  let r: number;
  if (ad >= 2 && dd === 2) r = pd * winProb(a, d - 2) + pe * winProb(a - 1, d - 1) + pa * winProb(a - 2, d);
  else r = pd * winProb(a, d - 1) + pa * winProb(a - 1, d);
  memo.set(key, r);
  return r;
}

const mine = (v: State, p: number) => TERRS.map((_, i) => i).filter((i) => v.owner[i] === p);

/** Важность планет для игрока: цель, бонус, сколько уже своё. */
function planetWeights(v: State, seat: number, level: number): number[] {
  const g = v.goal[seat] != null ? GOALS[v.goal[seat]!] : null;
  return PLANETS.map((pl, k) => {
    const ts = PLANET_TERRS[k];
    const own = ts.filter((t) => v.owner[t] === seat).length / ts.length;
    let w = pl.bonus / ts.length + own * 2;
    if (g && g.planets.includes(k)) w += level === 2 ? 6 : 4;
    if (g && (g.plusPlanet || g.plusTerrs)) w += own;
    if (v.cfg.mode === 'galaxy' || v.cfg.mode === 'duel') w += own;
    return w;
  });
}

/** Ценность взять территорию t. */
function targetValue(v: State, seat: number, t: number, pw: number[], level: number): number {
  const k = TERRS[t].planet;
  let val = pw[k];
  const ts = PLANET_TERRS[k];
  const left = ts.filter((x) => v.owner[x] !== seat).length;
  if (left === 1) val += PLANETS[k].bonus * (level === 2 ? 2 : 1.2);
  // сломать чужую целую планету
  const o = v.owner[t];
  if (o >= 0 && ts.every((x) => v.owner[x] === o)) val += PLANETS[k].bonus * (level === 2 ? 1.5 : 0.8);
  // добить игрока с карточками
  if (level === 2 && o >= 0 && o < v.n && count(v, o) === 1) val += 3 + v.handN[o];
  // вдвоём важнее бить соперника, чем союзника
  if (v.ally && o === 1 - seat) val += 1;
  const g = v.goal[seat] != null ? GOALS[v.goal[seat]!] : null;
  if (g?.terrs) val += 1.5;
  return val;
}

function bestAttack(v: State, seat: number, level: number, rng: Rng, needCard: boolean): Action | null {
  const pw = planetWeights(v, seat, level);
  let best: { a: Action; score: number } | null = null;
  for (let from = 0; from < TERRS.length; from++) {
    if (v.ships[from] < 2) continue;
    const o = v.owner[from];
    if (o !== seat && !(v.ally && o === ALLY(v))) continue;
    for (const to of ADJ[from]) {
      if (!canAttack(v, seat, from, to)) continue;
      const a = v.ships[from] - 1;
      const d = v.ships[to];
      const p = level === 0 ? (a > d + 1 ? 0.7 : a > d ? 0.55 : 0.2) : winProb(a, d);
      let val = targetValue(v, seat, to, pw, level);
      if (needCard) val += level === 2 ? 4 : 3;
      if (o !== seat) val *= 0.8; // союзником
      const risk = level === 2 ? 0.42 : level === 1 ? 0.5 : 0.6;
      if (p < risk && !(needCard && p > 0.4)) continue;
      // не оголять свою важную границу
      const exposed = level === 2 && o === seat && ADJ[from].some((x) => v.owner[x] !== seat && v.ships[x] > 2) ? 0.6 : 0;
      const score = p * val - exposed + (level === 0 ? rng.next() * 3 : rng.next() * 0.2);
      if (!best || score > best.score) best = { a: { type: 'attack', from, to, dice: Math.min(3, a), all: true }, score };
    }
  }
  if (level === 0 && rng.next() < 0.35) return null;
  return best && best.score > (level === 0 ? 1 : 0.2) ? best.a : null;
}

/** Куда ставить: своя территория у самой ценной цели (или под угрозой). */
function placeSpot(v: State, seat: number, level: number, rng: Rng, ally = false): number {
  const who = ally ? ALLY(v) : seat;
  const own = mine(v, who);
  if (!own.length) return -1;
  if (level === 0) {
    const front = own.filter((t) => ADJ[t].some((u) => v.owner[u] !== who));
    const list = front.length ? front : own;
    return list[rng.int(list.length)];
  }
  if (ally) {
    // союзнические — против соперника там, где он слабее всего
    let best = own[0];
    let bs = -1e9;
    for (const t of own) {
      let sc = -1e9;
      for (const u of ADJ[t]) if (v.owner[u] === 1 - seat) sc = Math.max(sc, v.ships[t] - v.ships[u] + 5);
      if (sc > bs) {
        bs = sc;
        best = t;
      }
    }
    return best;
  }
  const pw = planetWeights(v, seat, level);
  let best = own[0];
  let bs = -1e9;
  for (const t of own) {
    let sc = 0;
    let border = false;
    for (const u of ADJ[t]) {
      if (v.owner[u] === seat) continue;
      border = true;
      const val = targetValue(v, seat, u, pw, level);
      const need = v.ships[u] - (v.ships[t] - 1);
      sc = Math.max(sc, val * 2 - Math.max(0, need) * 0.3);
      // угроза
      if (level === 2 && v.owner[u] !== ALLY(v) && v.ships[u] > v.ships[t]) sc += pw[TERRS[t].planet] * 0.5;
    }
    if (!border) continue;
    sc += rng.next() * 0.3;
    if (sc > bs) {
      bs = sc;
      best = t;
    }
  }
  return best;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const h = v.hand[seat];
  if (!h) return null;
  if (v.phase === 'setup' || v.phase === 'reinforce') {
    if (v.phase === 'reinforce') {
      const ss = sets(v, seat);
      if (ss.length && (mustTrade(v, seat) || level > 0 || h.length >= 4)) {
        // средний/сложный меняет сразу (в нарастающем — сложный выжидает до 4 карточек)
        if (!(level === 2 && v.cfg.growing && h.length < 4 && !mustTrade(v, seat))) return { type: 'trade', cards: ss[0] };
      }
    }
    if (v.allyPending > 0) {
      const t = placeSpot(v, seat, level, rng, true);
      if (t >= 0) return { type: 'place', t, n: v.allyPending };
    }
    if (v.pending > 0) {
      const t = placeSpot(v, seat, level, rng);
      const chunk = level === 0 ? Math.min(v.pending, 1 + rng.int(3)) : Math.min(v.pending, Math.max(1, Math.ceil(v.pending / (level === 2 ? 2 : 3))));
      return { type: 'place', t, n: chunk };
    }
    if (v.phase === 'reinforce' && canGo(v, seat)) return { type: 'go' };
    return null;
  }
  if (v.phase === 'attack') {
    const a = bestAttack(v, seat, level, rng, v.conquered === 0);
    if (a) return a;
    return fortify(v, seat, level, rng) ?? { type: 'end' };
  }
  if (v.phase === 'move') return fortify(v, seat, level, rng) ?? { type: 'end' };
  return null;
}

/** Перемещение: из тыла к границе (самое большое скопление без врагов рядом). */
function fortify(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (level === 0 && rng.next() < 0.5) return null;
  let best: Action | null = null;
  let bs = 0;
  for (const from of mine(v, seat)) {
    if (v.ships[from] < 2) continue;
    const interior = !ADJ[from].some((u) => v.owner[u] !== seat);
    for (const to of ADJ[from]) {
      if (!canMove(v, seat, from, to)) continue;
      const toBorder = ADJ[to].some((u) => v.owner[u] !== seat);
      const threat = ADJ[to].reduce((m, u) => (v.owner[u] !== seat ? Math.max(m, v.ships[u]) : m), 0);
      if (!toBorder) continue;
      const n = interior ? v.ships[from] - 1 : Math.floor((v.ships[from] - 1) / 2);
      if (n < 1) continue;
      const sc = n * (interior ? 2 : 0.6) + (threat > v.ships[to] ? 2 : 0);
      if (sc > bs) {
        bs = sc;
        best = { type: 'move', from, to, n };
      }
    }
  }
  return best;
}
