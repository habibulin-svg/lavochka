/* Преферанс — боты. Видят свою руку, открытый прикуп, открытые руки (в светлую, на мизере) и стол.
 *   Лёгкий — торгуется по тузам и длине, мизер не играет, ходит простыми правилами;
 *   Средний — считает взятки по мастям, вистует по обязательным взяткам, на распасах «сбрасывает» старшие;
 *   Сложный — ещё и находит чистый мизер, сносит в пустоту, вистует смелее, когда второй уже спасовал.
 * Все уровни: торгуются не ниже «выхода» из распасов, слабую руку уводят за полвиста, играют в светлую, безнадёжную игру сдают (если можно). */
import type { Rng } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';
import { allBids, bidRank, BID_SUITS, DUTY, isMisere, legalCards, levelOk, minLevel, trickWinner, type Action, type Bid, type State, type Trick, type Trump } from './engine';

const SUITS: Suit[] = ['S', 'C', 'D', 'H'];
const bySuit = (h: Card[], s: Suit) => h.filter((c) => c.s === s).sort((a, b) => b.r - a.r);

/** Сколько взяток рука возьмёт с таким козырем (примерно). */
export function estimate(h: Card[], trump: Trump): number {
  let t = 0;
  for (const s of SUITS) {
    const cs = bySuit(h, s);
    const n = cs.length;
    if (!n) continue;
    const top = (r: number) => cs.some((c) => c.r === r);
    if (s === trump) {
      // козыри: старшие + длина
      let honors = 0;
      if (top(14)) honors++;
      if (top(13) && n >= 2) honors += top(14) ? 1 : 0.7;
      if (top(12) && n >= 3) honors += top(13) ? 0.8 : 0.4;
      if (top(11) && n >= 4) honors += 0.5;
      t += honors + Math.max(0, n - 3) * 0.9;
      continue;
    }
    if (top(14)) t += 1;
    if (top(13)) t += top(14) ? 0.9 : n >= 2 ? 0.5 : 0;
    if (top(12) && top(13) && top(14)) t += 0.8;
    // длинная масть без козыря добирает
    if (trump === 'NT' && n >= 5 && top(14)) t += (n - 4) * 0.7;
    // короткая масть при козырях — подрезка
    if (trump !== 'NT' && n <= 1 && bySuit(h, trump as Suit).length >= 3) t += 0.4;
  }
  return t;
}

/** Опасные для мизера карты: в каждой масти i-я снизу карта должна быть не выше 7 + 2·(i−1). */
export function misereRisk(h: Card[]): number {
  let risk = 0;
  for (const s of SUITS) {
    const cs = bySuit(h, s).reverse();
    cs.forEach((c, i) => {
      if (c.r > 7 + 2 * i) risk++;
    });
  }
  return risk;
}

/** Лучший козырь и оценка. */
function bestTrump(h: Card[]): { trump: Trump; est: number } {
  let best: { trump: Trump; est: number } = { trump: 'NT', est: estimate(h, 'NT') };
  for (const s of SUITS) {
    const e = estimate(h, s) + (bySuit(h, s).length >= 5 ? 0.3 : 0);
    if (e > best.est) best = { trump: s, est: e };
  }
  return best;
}

/** Взяла бы эта карта взятку сейчас. */
function wouldWin(t: Trick | null, seat: number, c: Card, trump: Trump | null): boolean {
  if (!t || (!t.cards.length && !t.prikup)) return true;
  return trickWinner({ ...t, cards: [...t.cards, { seat, card: c }] }, trump) === seat;
}

function pickCard(s: State, seat: number, mode: 'win' | 'lose', level: number, rng: Rng): Card {
  const legal = legalCards(s, seat);
  if (level === 0 && rng.next() < 0.3) return legal[rng.int(legal.length)];
  const t = s.trick;
  const leading = !t || (!t.cards.length && !t.prikup);
  const asc = legal.slice().sort((a, b) => a.r - b.r);
  if (mode === 'lose') {
    if (leading) return asc[0];
    const losing = asc.filter((c) => !wouldWin(t, seat, c, s.trump));
    // не берём старшей из тех, что не берут; пришлось брать — берём самой старшей (сбросить опасную)
    return losing.length ? losing[losing.length - 1] : asc[asc.length - 1];
  }
  // хотим взятку
  if (leading) {
    // заходим с туза или короля при тузе, иначе мелочью из длинной масти
    const aces = asc.filter((c) => c.r === 14);
    if (aces.length) return aces[aces.length - 1];
    if (s.trump && s.trump !== 'NT' && seat === s.declarer) {
      const tr = asc.filter((c) => c.s === s.trump);
      if (tr.length >= 3) return tr[tr.length - 1];
    }
    return asc[0];
  }
  const winners = asc.filter((c) => wouldWin(t, seat, c, s.trump));
  const last = t!.cards.length === s.players.length - 1;
  // напарник (второй вистующий) уже берёт — не перебиваем
  const cur = trickWinner(t!, s.trump);
  const partner = s.declarer >= 0 && seat !== s.declarer && cur !== s.declarer && t!.cards.length > 0;
  if (partner && s.kind === 'game') return asc[0];
  if (winners.length) return last ? winners[0] : winners[winners.length - 1];
  return asc[0];
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  const who = s.turn;
  const hand = s.hands[who];
  switch (s.phase) {
    case 'dark':
      // пас втёмную — азарт: изредка
      return { type: rng.next() < [0.08, 0.12, 0.15][level] ? 'dark-pass' : 'look' };
    case 'bid': {
      const { trump, est } = bestTrump(hand);
      const e = est * (level === 0 ? 0.85 + rng.next() * 0.2 : level === 1 ? 0.95 : 1) + 0.4; // прикуп
      const min = minLevel(s);
      // мизер — только первым словом
      if (level === 2 && !s.spoke.includes(who) && misereRisk(hand) === 0 && min <= 8 && (!s.bid || bidRank(s.bid) < 14.5)) return { type: 'bid', bid: { misere: true } };
      const level6 = Math.floor(e);
      if (level6 < Math.max(6, min)) return { type: 'pass' };
      const target: Bid = { level: Math.min(10, level6), trump };
      // ставим следующую по старшинству, но не выше своей оценки
      const next = allBids().find((b) => !isMisere(b) && levelOk(b, min) && (!s.bid || bidRank(b) > bidRank(s.bid)));
      if (!next || bidRank(next) > bidRank(target)) return { type: 'pass' };
      return { type: 'bid', bid: next };
    }
    case 'discard': {
      if (s.kind === 'misere') {
        // сносим самые опасные — старшие в масти
        const risky = hand.slice().sort((a, b) => b.r - a.r);
        return { type: 'discard', cards: risky.slice(0, 2) };
      }
      const { trump } = bestTrump(hand);
      // сносим мелочь из коротких некозырных мастей (в пустоту)
      const side = hand.filter((c) => c.s !== trump && c.r < 13);
      const len = (c: Card) => hand.filter((x) => x.s === c.s).length;
      const pool = (side.length >= 2 ? side : hand.filter((c) => c.s !== trump)).slice();
      const pick = (pool.length >= 2 ? pool : hand).sort((a, b) => len(a) - len(b) || a.r - b.r);
      return { type: 'discard', cards: level === 0 ? [hand[0], hand[1]] : pick.slice(0, 2) };
    }
    case 'contract': {
      // безнадёжно (недобор больше, чем «без трёх / двух») — сдать без розыгрыша
      const b0 = s.bid as { level: number; trump: Trump };
      if (s.cfg.concede && level > 0 && b0.level - Math.max(...BID_SUITS.map((t) => estimate(hand, t))) > s.cfg.concede + 0.5) return { type: 'concede' };
      // самая выгодная игра не ниже ставки
      let best: { bid: Bid; margin: number } | null = null;
      for (const t of BID_SUITS) {
        const e = estimate(hand, t);
        for (let l = 6; l <= 10; l++) {
          const b: Bid = { level: l, trump: t };
          if (bidRank(b) < bidRank(s.bid!)) continue;
          const margin = e - l;
          if (!best || margin > best.margin) best = { bid: b, margin };
          break;
        }
      }
      return { type: 'contract', bid: best ? best.bid : (s.bid as Bid) };
    }
    case 'whist': {
      const c = s.contract as { level: number; trump: Trump };
      // одиночный вистующий: в светлую (лёгкий — как придётся)
      if (s.wstep === 'choose') return { type: 'show', open: level > 0 || rng.next() < 0.5 };
      const duty = DUTY[c.level];
      // оборона: тузы и защищённые короли вне козыря, козырные старшие
      let def = 0;
      for (const suit of SUITS) {
        const cs = bySuit(hand, suit);
        if (suit === c.trump) {
          def += cs.filter((x) => x.r >= 13).length * 0.6 + Math.max(0, cs.length - 3) * 0.5;
          continue;
        }
        if (cs.some((x) => x.r === 14)) def += 1;
        if (cs.some((x) => x.r === 13) && cs.length >= 2) def += 0.5;
      }
      const otherPassed = Object.values(s.whist).includes('pass');
      const need = c.level >= 9 ? 1 : duty / 2 + (otherPassed ? duty / 4 : 0);
      const brave = level === 2 ? 0.3 : level === 0 ? -0.5 : 0;
      const strong = c.level < 10 && def + brave >= need;
      // возврат виста после «полвиста» — только с хорошей картой
      if (s.wstep === 'return') return { type: strong && def + brave >= need + 0.5 ? 'whist' : 'pass-whist' };
      // полвиста — без риска: если сам вистовать не готов
      const halfOk = s.wstep === 'd2' && s.cfg.halfWhist && c.level <= 7 && s.whist[s.players.find((x) => x !== who && x !== s.declarer)!] === 'pass';
      if (!strong && halfOk && level > 0) return { type: 'half-whist' };
      return { type: strong ? 'whist' : 'pass-whist' };
    }
    case 'play': {
      let mode: 'win' | 'lose' = 'win';
      // распасы — все не берут; мизер — заказчик не берёт, а ловящие подсаживают его (тоже не берут)
      if (s.kind === 'raspasy' || s.kind === 'misere') mode = 'lose';
      const card = pickCard(s, who, mode, level, rng);
      return { type: 'play', card };
    }
  }
  return null;
}
