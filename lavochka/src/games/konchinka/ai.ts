/* Кончинка — боты. Видят свою руку, стол и всё взятое (брали открыто).
 *   Лёгкий — любой допустимый ход;
 *   Средний — берёт самое ценное (карты, масть за очко, двойку треф и десятку бубен, в скопе — семёрки и бубны, скопу),
 *             а класть старается то, что не жалко и после чего стол не сметут одной картой;
 *   Сложный — то же, но вычитает лучший ответ следующего соперника: его руку разыгрывает наугад из невидимых карт. */
import type { Rng } from '../../core/types';
import { makeDeck, sameCard, type Card } from '../../cards/deck';
import { captures, moves, teamOf, value, type Action, type Cfg, type View } from './engine';

/** Ценность карты для взявшего. */
function worth(cfg: Cfg, c: Card): number {
  let w = 1;
  if (cfg.rules === 'konch') {
    if (c.s === cfg.suit) w += 0.5;
    if (cfg.suit === 'C' ? c.s === 'C' && c.r === 2 : c.s === 'S' && c.r === 14) w += 4;
    if (c.s === 'D' && c.r === 10) w += 4;
  } else {
    if (c.s === 'D') w += 0.6;
    if (c.s === 'D' && c.r === 7) w += 5;
    if (c.r === 7) w += cfg.rules === 'escoba' ? 1.2 : 1.4;
    if (c.r === 6 && cfg.rules === 'scopa') w += 0.7;
    if (c.r === 14 && cfg.rules === 'scopa') w += 0.5;
  }
  return w;
}

/** Ценность хода сразу: взятое + скопа; положенная карта — минус её ценность (её могут забрать). */
function gain(v: View, a: Action, lastPlay: boolean): number {
  if (!a.take.length) return -worth(v.cfg, a.card) * 0.6;
  let g = worth(v.cfg, a.card) + a.take.reduce((x, c) => x + worth(v.cfg, c), 0);
  if (v.cfg.rules !== 'konch' && a.take.length === v.table.length && !lastPlay) g += 8;
  return g;
}

/** Невидимые карты: колода минус своя рука, стол и всё взятое. */
function unseen(v: View, seat: number): Card[] {
  const all = makeDeck(52).filter((c) => v.cfg.deck === 52 || c.r <= 7 || c.r >= 11);
  const known = [...v.hands[seat], ...v.table, ...v.piles.flat()];
  return all.filter((c) => !known.some((k) => sameCard(k, c)));
}

/** Лучшее, что сможет сделать соперник со столом после хода (по его возможной руке). */
function replyBest(v: View, table: Card[], hand: Card[]): number {
  let best = 0;
  for (const c of hand) {
    for (const set of captures(v.cfg, table, c)) {
      let g = worth(v.cfg, c) + set.reduce((x, t) => x + worth(v.cfg, t), 0);
      if (v.cfg.rules !== 'konch' && set.length === table.length) g += 8;
      best = Math.max(best, g);
    }
  }
  return best;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const all = moves(v, seat);
  if (!all.length) return null;
  if (level === 0 || all.length === 1) return all[rng.int(all.length)];
  const lastPlay = !v.deckLeft && v.seats.every((x) => (x === seat ? v.hands[x].length === 1 : v.counts[x] === 0));
  const after = (a: Action) => (a.take.length ? v.table.filter((t) => !a.take.some((x) => sameCard(x, t))) : [...v.table, a.card]);
  const idx = v.seats.indexOf(seat);
  const next = v.seats[(idx + 1) % v.seats.length];
  const enemyNext = teamOf(v, next) !== teamOf(v, seat);
  let best = all[0];
  let bestScore = -Infinity;
  const pool = level === 2 ? unseen(v, seat) : [];
  for (const a of all) {
    let sc = gain(v, a, lastPlay);
    const t = after(a);
    if (level === 1) {
      // опасность: стол можно смести одной картой (скопа) или на столе осталось ценное
      if (v.cfg.rules !== 'konch' && t.length) {
        const sum = t.reduce((x, c) => x + value(v.cfg, c), 0);
        if (v.cfg.rules === 'scopa' ? sum <= 10 : sum <= 14 && sum >= 5) sc -= enemyNext ? 3 : -1;
      }
      sc -= t.reduce((x, c) => x + (worth(v.cfg, c) > 2 ? 1.5 : 0), 0) * (enemyNext ? 1 : -0.5);
    } else if (enemyNext && pool.length && t.length) {
      const k = Math.min(v.counts[next] || 0, pool.length);
      let sum = 0;
      const tries = 24;
      for (let i = 0; i < tries; i++) {
        const hand: Card[] = [];
        const p = pool.slice();
        for (let j = 0; j < k; j++) hand.push(p.splice(rng.int(p.length), 1)[0]);
        sum += replyBest(v, t, hand);
      }
      sc -= (sum / tries) * 0.8;
    }
    sc += rng.next() * 0.01;
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  return best;
}
