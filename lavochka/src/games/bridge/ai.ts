/* Бридж — боты.
 * Торговля — упрощённая «Стандартная американская»: открытие 1♣/1♦ с 3+, 1♥/1♠ с 5+, 1БК 15–17 ровная, 2БК 20–21, 2♣ 22+,
 * слабые 2♦/2♥/2♠ (6 карт, 5–10), блок 3 (7 карт). Ответы: подъём мажора, новая масть, 1БК 6–10, Стейман и трансферы на 1БК.
 * Дальше — «расстановка»: по своим очкам и тому, что показал партнёр, ищется фит и уровень (частичка / гейм / шлем).
 * Вмешательство: заявка с 5+ картами, 1БК 15–18, вызывная контра с 12+ и короткой мастью противника.
 * Розыгрыш: лёгкий — правила (второй низко, третий высоко, бить дешевле, сносить мелочь); средний и сложный — Монте-Карло:
 * раскладывают невидимые карты (с учётом ренонсов, сложный — и очков из торговли), каждый кандидат доигрывают правилами
 * до конца сдачи и берут ход с лучшим средним числом взяток. */
import type { Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';
import {
  countOf,
  dblState,
  hcpOf,
  lastBid,
  legal,
  legalCall,
  newState,
  next,
  partner,
  side,
  startBoard,
  trickWinner,
  trumpOf,
  type Action,
  type Call,
  type CallRec,
  type Contract,
  type State,
  type Strain,
  type View,
} from './engine';

const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
const SYM: Record<Strain, string> = { C: '♣', D: '♦', H: '♥', S: '♠', N: 'БК' };
const lens = (h: Card[]) => Object.fromEntries(SUITS.map((s) => [s, h.filter((c) => c.s === s).length])) as Record<Suit, number>;
const balanced = (h: Card[]) => {
  const l = Object.values(lens(h)).sort((a, b) => a - b);
  return l[0] >= 2 && l[3] <= 5 && !(l[1] === 2 && l[0] === 2);
};
const longest = (h: Card[], from: Suit[] = SUITS) => from.slice().sort((a, b) => lens(h)[b] - lens(h)[a] || SUITS.indexOf(b) - SUITS.indexOf(a))[0];

interface Shown {
  min: number;
  max: number;
  len: Record<Suit, number>;
  bal: boolean;
}

/** Что показал игрок своими заявками (очень упрощённо). */
function shownBy(calls: CallRec[], p: number): Shown {
  const sh: Shown = { min: 0, max: 37, len: { C: 0, D: 0, H: 0, S: 0 }, bal: false };
  let first = true;
  for (let i = 0; i < calls.length; i++) {
    const r = calls[i];
    if (r.seat !== p) continue;
    const before = calls.slice(0, i);
    const anyBid = before.some((x) => x.call.type === 'bid');
    const pBids = before.filter((x) => x.seat === partner(p) && x.call.type === 'bid');
    const c = r.call;
    if (c.type === 'pass') {
      if (first && !anyBid) sh.max = Math.min(sh.max, 11);
      continue;
    }
    if (c.type === 'double') {
      if (first) sh.min = Math.max(sh.min, 12);
      first = false;
      continue;
    }
    if (c.type !== 'bid') continue;
    const st = c.strain;
    if (first && !anyBid) {
      // открытие
      if (st === 'N') Object.assign(sh, c.level === 1 ? { min: 15, max: 17, bal: true } : { min: 20, max: 21, bal: true });
      else if (c.level === 1) {
        sh.min = 12;
        sh.max = 21;
        sh.len[st] = Math.max(sh.len[st], st === 'H' || st === 'S' ? 5 : 3);
      } else if (c.level === 2 && st === 'C') sh.min = 22;
      else {
        sh.min = 5;
        sh.max = 10;
        sh.len[st] = c.level === 2 ? 6 : 7;
      }
    } else if (first && pBids.length) {
      // ответ партнёру
      const pb = pBids[0].call as { level: number; strain: Strain };
      if (pb.strain === 'N' && pb.level === 1) {
        if (st === 'C' && c.level === 2) sh.min = 8;
        else if (st === 'D' && c.level === 2) sh.len.H = 5;
        else if (st === 'H' && c.level === 2) sh.len.S = 5;
        else if (st === 'N') Object.assign(sh, c.level === 2 ? { min: 8, max: 9 } : { min: 10, max: 15 });
      } else if (st === pb.strain && st !== 'N') {
        sh.len[st] = Math.max(sh.len[st], 3);
        Object.assign(sh, c.level >= 4 ? { min: 13, max: 18 } : c.level === 3 ? { min: 10, max: 12 } : { min: 6, max: 9 });
      } else if (st === 'N') Object.assign(sh, c.level === 1 ? { min: 6, max: 10 } : c.level === 2 ? { min: 11, max: 12 } : { min: 13, max: 15 });
      else {
        sh.min = c.level >= 2 ? 11 : 6;
        sh.len[st] = Math.max(sh.len[st], 4);
      }
    } else if (first) {
      // вмешательство
      if (st === 'N') Object.assign(sh, { min: 15, max: 18, bal: true });
      else {
        sh.min = 8;
        sh.max = 16;
        sh.len[st] = Math.max(sh.len[st], 5);
      }
    } else {
      // повторные заявки: повтор своей масти — 6+, поддержка партнёра — 4
      const own = calls.slice(0, i).some((x) => x.seat === p && x.call.type === 'bid' && (x.call as { strain: Strain }).strain === st);
      const pSuit = pBids.some((x) => (x.call as { strain: Strain }).strain === st);
      if (st !== 'N' && own) sh.len[st] = Math.max(sh.len[st], 6);
      else if (st !== 'N' && pSuit) sh.len[st] = Math.max(sh.len[st], 4);
      else if (st !== 'N') sh.len[st] = Math.max(sh.len[st], 4);
    }
    first = false;
  }
  return sh;
}

/** Очки руки с поправкой на расклад (длинные масти). */
const points = (h: Card[]) => hcpOf(h) + Object.values(lens(h)).reduce((a, l) => a + Math.max(0, l - 4), 0);

function bidCall(level: number, strain: Strain, note: string): Call & { note: string } {
  return { type: 'bid', level, strain, note } as Call & { note: string };
}

function chooseCall(v: View, seat: number, level: number, rng: Rng): Call & { note?: string } {
  const h = v.hands[seat];
  const L = lens(h);
  const hcp = hcpOf(h);
  const pts = points(h);
  const calls = v.calls;
  const can = (lv: number, st: Strain) => legalCall(v, seat, { type: 'bid', level: lv, strain: st });
  const pass = { type: 'pass' } as Call & { note?: string };
  const lb = lastBid(calls);
  const ourBids = calls.filter((x) => side(x.seat) === side(seat) && x.call.type === 'bid');
  const theirBids = calls.filter((x) => side(x.seat) !== side(seat) && x.call.type === 'bid');
  const myBids = calls.filter((x) => x.seat === seat && x.call.type !== 'pass');
  const pBids = calls.filter((x) => x.seat === partner(seat) && x.call.type === 'bid');
  const major = (s: Suit) => s === 'H' || s === 'S';

  if (level === 0 && rng.next() < 0.15) return pass;
  // шлем противников, а у нас есть сила — штрафная контра
  if (lb && side(lb.seat) !== side(seat) && lb.call.level >= 6 && hcp >= 8 && legalCall(v, seat, { type: 'double' })) return { type: 'double', note: 'штрафная: шлем не выйдет' } as never;

  // открытие
  if (!ourBids.length && !theirBids.length) {
    if (hcp >= 22) return bidCall(2, 'C', '22+ очков, сильная');
    if (hcp >= 20 && hcp <= 21 && balanced(h)) return bidCall(2, 'N', '20–21, ровная');
    if (hcp >= 15 && hcp <= 17 && balanced(h)) return bidCall(1, 'N', '15–17, ровная');
    const two = SUITS.slice().sort((a, b) => L[b] - L[a]);
    if (hcp >= 12 || (hcp >= 10 && hcp + L[two[0]] + L[two[1]] >= 20)) {
      const m = L.S >= 5 && L.S >= L.H ? 'S' : L.H >= 5 ? 'H' : null;
      if (m) return bidCall(1, m, `12–21, 5+ ${SYM[m]}`);
      const mi: Suit = L.D >= 4 && L.D >= L.C ? 'D' : L.C >= 3 ? 'C' : 'D';
      return bidCall(1, mi, `12–21, 3+ ${SYM[mi]}`);
    }
    for (const s of ['S', 'H', 'D'] as Suit[]) if (L[s] === 6 && hcp >= 5 && hcp <= 10 && can(2, s)) return bidCall(2, s, `слабая: 6 ${SYM[s]}, 5–10`);
    for (const s of SUITS) if (L[s] >= 7 && hcp >= 5 && hcp <= 10 && can(3, s)) return bidCall(3, s, `блок: 7 ${SYM[s]}`);
    return pass;
  }

  // противник открыл, мы молчим — вмешательство
  if (!ourBids.length && theirBids.length && !calls.some((x) => side(x.seat) === side(seat) && x.call.type === 'double')) {
    const their = (lb!.call as { strain: Strain }).strain;
    for (const s of SUITS.slice().sort((a, b) => L[b] - L[a])) {
      if (L[s] < 5 || s === their) continue;
      for (let lv = 1; lv <= 2; lv++) if (can(lv, s) && hcp >= (lv === 1 ? 8 : 11) && hcp <= 17) return bidCall(lv, s, `вмешательство: 5+ ${SYM[s]}`);
    }
    if (hcp >= 15 && hcp <= 18 && balanced(h) && can(1, 'N')) return bidCall(1, 'N', '15–18, ровная, с остановкой');
    if (hcp >= 12 && their !== 'N' && L[their as Suit] <= 2 && legalCall(v, seat, { type: 'double' })) return { type: 'double', note: 'вызывная: 12+, коротко в их масти' } as never;
    return pass;
  }

  // ответы на 1БК партнёра
  const pOpen = pBids[0];
  if (pOpen && !myBids.length && (pOpen.call as { level: number }).level === 1 && (pOpen.call as { strain: Strain }).strain === 'N' && lb === pOpen) {
    if (L.H >= 5 && can(2, 'D')) return bidCall(2, 'D', 'трансфер: 5+ ♥');
    if (L.S >= 5 && can(2, 'H')) return bidCall(2, 'H', 'трансфер: 5+ ♠');
    if (hcp >= 8 && (L.H === 4 || L.S === 4) && can(2, 'C')) return bidCall(2, 'C', 'Стейман: есть 4 в мажоре');
    if (hcp >= 10 && can(3, 'N')) return bidCall(3, 'N', 'гейм');
    if (hcp >= 8 && can(2, 'N')) return bidCall(2, 'N', 'инвит: 8–9');
    return pass;
  }
  // открывший 1БК отвечает на Стейман и трансферы
  const myOpen = myBids[0];
  if (myOpen && myBids.length === 1 && myOpen.call.type === 'bid' && myOpen.call.level === 1 && myOpen.call.strain === 'N' && lb && lb.seat === partner(seat) && lb.call.level === 2) {
    const st = lb.call.strain;
    if (st === 'C') {
      if (L.H >= 4 && can(2, 'H')) return bidCall(2, 'H', 'на Стейман: 4 ♥');
      if (L.S >= 4 && can(2, 'S')) return bidCall(2, 'S', 'на Стейман: 4 ♠');
      if (can(2, 'D')) return bidCall(2, 'D', 'на Стейман: мажора нет');
    }
    if (st === 'D' && can(2, 'H')) return bidCall(2, 'H', 'принял трансфер');
    if (st === 'H' && can(2, 'S')) return bidCall(2, 'S', 'принял трансфер');
  }
  // ответ на открытие масти партнёра
  if (pOpen && !myBids.length && pOpen.call.type === 'bid' && pOpen.call.strain !== 'N' && pOpen.call.level === 1) {
    const ps = pOpen.call.strain as Suit;
    if (hcp < 6) return pass;
    if (major(ps) && L[ps] >= 3) {
      if (hcp >= 13 && can(4, ps)) return bidCall(4, ps, `гейм: фит ${SYM[ps]}, 13+`);
      if (hcp >= 10 && L[ps] >= 4 && can(3, ps)) return bidCall(3, ps, `инвит: 4 ${SYM[ps]}, 10–12`);
      if (hcp <= 9 && can(2, ps)) return bidCall(2, ps, `подъём: 3+ ${SYM[ps]}, 6–9`);
    }
    for (const s of ['S', 'H'] as Suit[]) if (L[s] >= 4 && s !== ps && can(1, s)) return bidCall(1, s, `новая масть: 4+ ${SYM[s]}, 6+`);
    if (hcp >= 13 && balanced(h) && can(3, 'N')) return bidCall(3, 'N', '13–15, ровная');
    if (hcp >= 11) {
      const s = longest(h, SUITS.filter((x) => x !== ps));
      if (L[s] >= 4 && can(2, s)) return bidCall(2, s, `2/1: 4+ ${SYM[s]}, 11+`);
    }
    if (!major(ps) && L[ps] >= 5 && hcp <= 10 && can(2, ps)) return bidCall(2, ps, `подъём минора`);
    if (hcp <= 10 && can(1, 'N')) return bidCall(1, 'N', '6–10');
    if (can(2, 'N')) return bidCall(2, 'N', '11–12');
  }

  // расстановка: фит, совместная сила, уровень
  const ps = shownBy(calls, partner(seat));
  const pMid = Math.min(ps.max, ps.min + (ps.max >= 37 ? 4 : Math.round((ps.max - ps.min) / 2)));
  const total = pts + pMid;
  let best: Strain = 'N';
  let fit = 0;
  for (const s of ['S', 'H', 'D', 'C'] as Suit[]) {
    const f = L[s] + ps.len[s];
    if (f >= 8 && (f > fit || (f === fit && major(s) && !major(best as Suit)))) {
      fit = f;
      best = s;
    }
  }
  // минорный фит — лучше БК, если обе ровные
  if (best !== 'N' && !major(best as Suit) && (balanced(h) || ps.bal) && total < 29) best = 'N';
  if (fit === 0 && !balanced(h) && !ps.bal) {
    const own = longest(h);
    if (L[own] >= 6) best = own;
  }
  const game = best === 'N' ? 3 : major(best as Suit) ? 4 : 5;
  let target = total >= 33 ? 6 : total >= 25 ? game : total >= 23 && level > 0 ? game - 1 : best === 'N' ? 1 : 2;
  if (target === 6 && total >= 37) target = 7;
  // контракт уже наш и не ниже цели — пас
  if (lb && side(lb.seat) === side(seat)) {
    if (lb.call.level >= target || (lb.call.strain === best && lb.call.level >= target - 1 && target < game)) return pass;
  }
  // противник выше: штрафная контра при большой совместной силе
  if (lb && side(lb.seat) !== side(seat) && lb.call.level >= 3 && total >= 24 && dblState(calls) === 0 && legalCall(v, seat, { type: 'double' })) {
    const theirs = lb.call.strain;
    if (theirs === 'N' || L[theirs as Suit] >= 3) return { type: 'double', note: 'штрафная' } as never;
  }
  for (let lv = 1; lv <= target; lv++) if (can(lv, best)) return bidCall(lv, best, total >= 25 ? `к гейму, ${SYM[best]}` : `частичка, ${SYM[best]}`);
  return pass;
}

// ---------------------------------------------------------------- розыгрыш

/** Простые правила хода (лёгкий бот и доигрыш в прогонах). Видит руку p, стол и козырь. */
export function ruleCard(s: State, p: number): Card {
  const moves = legal(s, p);
  if (moves.length === 1) return moves[0];
  const T = trumpOf(s);
  const low = (cs: Card[]) => cs.reduce((a, c) => (c.r < a.r || (a.s === T && c.s !== T && c.r <= a.r + 4) ? c : a));
  const high = (cs: Card[]) => cs.reduce((a, c) => (c.r > a.r ? c : a));
  if (!s.trick.length) {
    // заход: туз-король сверху, иначе — длинная масть, четвёртая сверху
    const h = s.hands[p];
    for (const c of h) if (c.r === 14 && h.some((x) => x.s === c.s && x.r === 13)) return c;
    const decl = s.contract ? side(s.contract.declarer) === side(p) : false;
    if (decl && T) {
      const mine = h.filter((c) => c.s === T);
      const out = 13 - s.played.filter((c) => c.s === T).length - mine.length - s.hands[partner(p)].filter((c) => c.s === T).length;
      if (mine.length && out > 0) return high(mine);
    }
    const by = SUITS.filter((x) => x !== T && h.some((c) => c.s === x)).sort((a, b) => h.filter((c) => c.s === b).length - h.filter((c) => c.s === a).length);
    const suit = by[0] ?? h[0].s;
    const cs = h.filter((c) => c.s === suit).sort((a, b) => b.r - a.r);
    return cs.length >= 4 ? cs[3] : cs[cs.length - 1];
  }
  const w = trickWinner(s.trick, T);
  const partnerWins = side(w) === side(p);
  const last = s.trick.length === 3;
  const winners = moves.filter((c) => trickWinner([...s.trick, { seat: p, card: c }], T) === p);
  if (partnerWins && (last || s.trick.length === 2)) return low(moves);
  if (winners.length && (last || s.trick.length === 2 || (s.trick.length === 1 && winners.some((c) => c.r >= 13)))) return low(winners);
  return low(moves);
}

/** Раздать невидимые карты (с учётом ренонсов). */
function sample(s: View, rng: Rng): State | null {
  const known = new Set<string>();
  // видимые руки — те, что пришли в виде целиком (своя, открытый болван, пустые)
  const vis = [0, 1, 2, 3].filter((p) => s.hands[p].length === countOf(s, p));
  for (const p of vis) for (const c of s.hands[p]) known.add(c.s + c.r);
  for (const c of s.played) known.add(c.s + c.r);
  for (const t of s.trick) known.add(t.card.s + t.card.r);
  const pool: Card[] = [];
  for (const su of SUITS) for (let r = 2; r <= 14; r++) if (!known.has(su + r)) pool.push({ s: su, r });
  const hidden = [0, 1, 2, 3].filter((p) => !vis.includes(p));
  for (let tryN = 0; tryN < 40; tryN++) {
    const deck = pool.slice();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const hands = s.hands.map((h) => h.slice());
    let ok = true;
    // сначала раздаём с ренонсами — карты нужной масти не туда
    for (const p of hidden) hands[p] = [];
    const rest = deck;
    for (const p of hidden) {
      const need = countOf(s, p);
      const take: Card[] = [];
      for (let i = 0; i < rest.length && take.length < need; i++) {
        if (s.voids[p].includes(rest[i].s)) continue;
        take.push(rest[i]);
        rest.splice(i, 1);
        i--;
      }
      if (take.length < need) {
        ok = false;
        break;
      }
      hands[p] = take;
    }
    if (!ok) continue;
    const st = { ...(s as State), hands, deal: hands.map((x) => x.slice()) };
    return st;
  }
  return null;
}

/** Доиграть сдачу правилами; вернуть взятки стороны side. */
function rollout(st0: State, first: Card, sd: number): number {
  const st: State = { ...st0, hands: st0.hands.map((h) => h.slice()), trick: st0.trick.slice(), played: st0.played.slice(), tricks: [...st0.tricks] as [number, number] };
  const T = trumpOf(st);
  let card: Card | null = first;
  for (let guard = 0; guard < 60; guard++) {
    const p = st.turn;
    if (!st.hands[p].length) break;
    const c = card ?? ruleCard(st, p);
    card = null;
    st.hands[p] = st.hands[p].filter((x) => !sameCard(x, c));
    st.trick.push({ seat: p, card: c });
    st.played.push(c);
    if (st.trick.length < 4) {
      st.turn = next(p);
      continue;
    }
    const w = trickWinner(st.trick, T);
    st.tricks[side(w)]++;
    st.trick = [];
    st.turn = w;
  }
  return st.tricks[sd];
}

function choosePlay(v: View, seat: number, level: number, rng: Rng): Card {
  const p = v.turn;
  const moves = legal(v, p);
  if (moves.length === 1 || level === 0) return level === 0 && rng.next() < 0.2 ? moves[rng.int(moves.length)] : ruleCard(v, p);
  // соседние по старшинству карты одной масти равноценны — берём по одной
  const cands = moves.filter((c, _i, a) => !a.some((x) => x.s === c.s && x.r === c.r + 1 && !v.played.some((y) => y.s === c.s && y.r > c.r && y.r < x.r)) || c.r === Math.max(...a.filter((x) => x.s === c.s).map((x) => x.r)));
  const N = level === 2 ? 28 : 10;
  const sd = side(seat);
  const score = new Map<Card, number>();
  for (const c of cands) score.set(c, 0);
  let used = 0;
  for (let k = 0; k < N; k++) {
    const st = sample(v, rng);
    if (!st) continue;
    used++;
    for (const c of cands) score.set(c, score.get(c)! + rollout(st, c, sd));
  }
  if (!used) return ruleCard(v, p);
  let best = cands[0];
  for (const c of cands) if (score.get(c)! > score.get(best)! || (score.get(c) === score.get(best) && c.r < best.r)) best = c;
  return best;
}

function chooseMini(v: View, seat: number): Action {
  const h = v.hands[seat];
  const d = v.hands[v.dummy];
  const L = lens(h);
  const D = lens(d);
  const tot = hcpOf(h) + hcpOf(d);
  let st: Strain = 'N';
  for (const s of ['S', 'H'] as Suit[]) if (L[s] + D[s] >= 8) st = s;
  if (st === 'N' && !(balanced(h) && balanced(d)))
    for (const s of ['D', 'C'] as Suit[]) if (L[s] + D[s] >= 9) st = s;
  const game = tot >= (st === 'N' ? 25 : st === 'H' || st === 'S' ? 24 : 28);
  return { type: 'mini', level: game ? 3 : 1, strain: st };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'over') return null;
  if (v.phase === 'auction') return v.turn === seat ? (chooseCall(v, seat, level, rng) as Action) : null;
  if (v.phase === 'mini') return chooseMini(v, seat);
  return { type: 'play', card: choosePlay(v, seat, level, rng) };
}

/** Другой стол (спортивный): та же сдача, все четверо — средние боты. */
export function playOtherTable(s: State, rngSeed = 7): { contract: Contract | null; tricks: number } {
  let seed = rngSeed + s.board * 101;
  const rng = { next: () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000), int: (n: number) => Math.floor(((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000) * n), getState: () => seed };
  const t: State = { ...newState(s.cfg), board: s.board, dealer: s.dealer, hands: s.deal.map((h) => h.slice()), deal: s.deal.map((h) => h.slice()), cfg: { ...s.cfg, format: 'chicago' } };
  startBoard(t, []);
  // торговля
  for (let g = 0; g < 60 && t.phase === 'auction'; g++) {
    const c = chooseCall({ ...t, counts: t.hands.map((h) => h.length) }, t.turn, 1, rng);
    const call: Call = c.type === 'bid' ? { type: 'bid', level: c.level, strain: c.strain } : { type: c.type };
    if (!legalCall(t, t.turn, call)) {
      t.calls.push({ seat: t.turn, call: { type: 'pass' } });
    } else t.calls.push({ seat: t.turn, call });
    const n = t.calls.length;
    const passes = (k: number) => n >= k && t.calls.slice(-k).every((x) => x.call.type === 'pass');
    if ((n === 4 && passes(4)) || (lastBid(t.calls) && passes(3))) {
      const lb = lastBid(t.calls);
      if (!lb) return { contract: null, tricks: 0 };
      const decl = t.calls.find((x) => x.call.type === 'bid' && side(x.seat) === side(lb.seat) && (x.call as { strain: Strain }).strain === lb.call.strain)!.seat;
      t.contract = { level: lb.call.level, strain: lb.call.strain, dbl: dblState(t.calls), declarer: decl };
      t.dummy = partner(decl);
      t.phase = 'play';
      t.turn = next(decl);
      break;
    }
    t.turn = next(t.turn);
  }
  if (!t.contract) return { contract: null, tricks: 0 };
  // розыгрыш правилами с открытыми картами (быстро)
  const tricks = rollout(t, ruleCard(t, t.turn), side(t.contract.declarer));
  return { contract: { ...t.contract }, tricks };
}

