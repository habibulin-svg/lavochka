/* Боты маджонга: видят только свой View.
 * Сброс — тот, после которого рука ближе к готовности (шантен) и ждёт больше костей (приём); темпай, который ничего не стоит
 * (нет яку в риичи, мало фаней в Гонконге), — не темпай. Лёгкий смотрит только на шантен и ошибается, средний считает приём,
 * сложный ещё и защищается: когда соперник в риичи или с тремя открытыми сетами, а своя рука далека — сбрасывает безопасное. */
import type { Rng } from '../../core/types';
import { isDragon, isHonor, isOrphan, isSuit, kindOf, rankOf, suitOf } from '../mahjong/tiles';
import { counts, shanten } from './hand';
import { scoreWin, type WinInfo } from './score';
import { doraOf, isRed, rulesOf, type Action } from './engine';
import { handWaits, visibleCounts, type View } from './view-model';

const kinds = (ids: number[]) => ids.map(kindOf);

/** Стоит ли рука хоть что-то с этой костью (порог стиля). */
export function worth(v: View, seat: number, hand13: number[], winKind: number, tsumo: boolean): boolean {
  const q = v.p[seat];
  const c = v.cfg;
  const closed = counts([...kinds(hand13), winKind]);
  const w: WinInfo = {
    style: c.style,
    closed,
    melds: q.melds,
    win: winKind,
    tsumo,
    seatWind: q.wind,
    roundWind: v.round % 4,
    dealer: seat === v.dealer,
    flowers: q.flowers.map(kindOf),
    sets: rulesOf(c).sets,
    riichi: q.riichi || (c.style === 'riichi' && q.melds.every((m) => !m.open) ? 1 : 0),
    ippatsu: false,
    lastTile: false,
    rinshan: false,
    chankan: false,
    heaven: false,
    earth: false,
    dora: v.dora.map(doraOf),
    ura: [],
    aka: [...hand13, ...q.melds.flatMap((m) => m.ids)].filter((id) => isRed(c, id)).length,
    repeat: v.honba,
    limit: c.limit,
    kuitan: c.kuitan,
  };
  const sc = scoreWin(w);
  if (!sc) return false;
  if (c.style === 'riichi') return sc.yaku;
  if (c.style === 'hk' || c.style === 'tw') return sc.value >= c.min;
  return true;
}

interface Eval {
  sh: number;
  uke: number;
}

/** Шантен и приём руки (13 костей закрытой части). Темпай без цены считается за 1. */
function evalHand(v: View, seat: number, hand: number[], seen: number[], deep: boolean): Eval {
  const q = v.p[seat];
  const r = rulesOf(v.cfg);
  const c = counts(kinds(hand));
  let sh = shanten(c, q.melds.length, r);
  if (v.cfg.sichuan) sh += hand.filter((id) => suitOf(kindOf(id)) === q.missing).length;
  if (sh === 0) {
    const w = handWaits(v, seat, hand).filter((k) => worth(v, seat, hand, k, false) || worth(v, seat, hand, k, true));
    if (!w.length) sh = 1;
    else if (deep) return { sh, uke: w.reduce((a, k) => a + Math.max(0, 4 - c[k] - seen[k]), 0) };
  }
  if (!deep) return { sh, uke: 0 };
  let uke = 0;
  for (let k = 0; k < 34; k++) {
    const left = 4 - c[k] - seen[k];
    if (left <= 0) continue;
    if (v.cfg.sichuan && suitOf(k) === q.missing) continue;
    c[k]++;
    if (shanten(c, q.melds.length, r) < sh) uke += left;
    c[k]--;
  }
  return { sh, uke };
}

/** Насколько кость опасна против соперников, которые «готовы» (0 — безопасная). */
function danger(v: View, seat: number, id: number): number {
  const k = kindOf(id);
  let d = 0;
  for (let x = 0; x < 4; x++) {
    if (x === seat) continue;
    const q = v.p[x];
    const threat = q.riichi ? 1 : q.melds.filter((m) => m.open).length >= 3 ? 0.6 : 0;
    if (!threat || q.won) continue;
    if (q.discards.some((dd) => kindOf(dd.id) === k)) continue; // своё не берут (фуритэн) — безопасно
    let t = 1;
    if (isHonor(k)) {
      const seen = v.p.reduce((a, p) => a + p.discards.filter((dd) => kindOf(dd.id) === k).length, 0);
      t = seen >= 2 ? 0.15 : seen === 1 ? 0.4 : 0.7;
    } else {
      // суджи: сброшены 4 — 1 и 7 безопаснее и т. п.
      const r = rankOf(k);
      const has = (rr: number) => rr >= 1 && rr <= 9 && q.discards.some((dd) => kindOf(dd.id) === k - r + rr);
      const suji = r <= 3 ? has(r + 3) : r >= 7 ? has(r - 3) : has(r - 3) && has(r + 3);
      if (suji) t = 0.45;
      if (isOrphan(k)) t *= 0.8;
    }
    d += t * threat;
  }
  return d;
}

/** Небольшие предпочтения: держать дору и пары драконов/своих ветров, раньше сбрасывать одинокую честь. */
function keepValue(v: View, seat: number, id: number, hand: number[]): number {
  const k = kindOf(id);
  const q = v.p[seat];
  let val = 0;
  if (v.cfg.style === 'riichi') {
    if (v.dora.some((d) => doraOf(d) === k)) val += 1.5;
    if (isRed(v.cfg, id)) val += 1.5;
  }
  const same = hand.filter((x) => kindOf(x) === k).length;
  const valuable = isDragon(k) || k === 27 + q.wind || k === 27 + (v.round % 4);
  if (isHonor(k)) val += same >= 2 ? (valuable ? 2 : 0.8) : valuable ? 0.3 : -0.6;
  else if (isOrphan(k)) val -= 0.2;
  // масть с честью / чистая масть: держаться основной масти
  if (v.cfg.style === 'hk' || v.cfg.style === 'tw' || v.cfg.style === 'classic') {
    const all = [...hand, ...q.melds.flatMap((m) => m.ids)].map(kindOf);
    const by = [0, 0, 0];
    for (const kk of all) if (isSuit(kk)) by[suitOf(kk)]++;
    const main = by.indexOf(Math.max(...by));
    const honors = all.filter(isHonor).length;
    if (by[main] + honors >= 9) val += isSuit(k) ? (suitOf(k) === main ? 1.2 : -1.2) : 0.6;
  }
  return val;
}

function chooseDiscard(v: View, seat: number, level: number, rng: Rng): Action {
  const t = v.turnOpts[seat];
  const hand = v.p[seat].hand!;
  const seen = visibleCounts(v, seat).map((n, k) => n - hand.filter((x) => kindOf(x) === k).length);
  const cand = new Map<number, number>();
  for (const id of t.ok) if (!cand.has(kindOf(id)) || isRed(v.cfg, cand.get(kindOf(id))!)) cand.set(kindOf(id), id);
  let best: { id: number; score: number } | null = null;
  const evals = new Map<number, Eval>();
  let minSh = 9;
  for (const id of cand.values()) {
    const rest = hand.filter((x) => x !== id);
    const e = evalHand(v, seat, rest, seen, level > 0);
    evals.set(id, e);
    minSh = Math.min(minSh, e.sh);
  }
  const defend = level === 2 && minSh >= 2 && v.p.some((q, x) => x !== seat && (q.riichi || q.melds.filter((m) => m.open).length >= 3));
  for (const id of cand.values()) {
    const e = evals.get(id)!;
    let score = -e.sh * 100 + e.uke * 2 - keepValue(v, seat, id, hand) * 3;
    if (level === 0) score += rng.next() * 60;
    else score += rng.next() * 0.5;
    if (level === 2) score -= danger(v, seat, id) * (defend ? 400 : minSh === 1 ? 25 : 8);
    if (!best || score > best.score) best = { id, score };
  }
  const id = best!.id;
  // риичи — если можно и рука закрыта
  if (t.riichi.includes(id) && (level > 0 || rng.next() < 0.6)) return { t: 'discard', id, riichi: true };
  return { t: 'discard', id };
}

/** Брать ли кость заявкой: рука становится ближе и всё ещё может чего-то стоить. */
function claimGood(v: View, seat: number, a: Action, level: number, rng: Rng): boolean {
  const q = v.p[seat];
  const hand = q.hand!;
  const last = v.last!;
  const k = kindOf(last.id);
  const seen = visibleCounts(v, seat).map((n, kk) => n - hand.filter((x) => kindOf(x) === kk).length);
  const before = evalHand(v, seat, hand, seen, false).sh;
  let rest: number[];
  if (a.t === 'pon' || a.t === 'mkan') {
    let n = a.t === 'pon' ? 2 : 3;
    rest = hand.filter((x) => (kindOf(x) === k && n-- > 0 ? false : true));
  } else if (a.t === 'chi') {
    const need = [a.k, a.k + 1, a.k + 2].filter((kk) => kk !== k);
    rest = hand.slice();
    for (const kk of need) rest.splice(rest.findIndex((x) => kindOf(x) === kk), 1);
  } else return false;
  // после заявки — лучший сброс
  const fake: View = { ...v, p: v.p.map((p, x) => (x === seat ? { ...p, melds: [...p.melds, { t: a.t === 'chi' ? 'chi' : a.t === 'pon' ? 'pon' : 'kan', k: a.t === 'chi' ? a.k : k, open: true, ids: [] }] } : p)) };
  let after = 9;
  if (a.t === 'mkan') after = evalHand(fake, seat, rest, seen, false).sh;
  else
    for (const id of rest) {
      const e = evalHand(
        fake,
        seat,
        rest.filter((x) => x !== id),
        seen,
        false
      );
      after = Math.min(after, e.sh);
    }
  if (level === 0) return after < before && rng.next() < 0.5;
  if (a.t === 'mkan') return after <= before && !(v.cfg.style === 'riichi' && q.melds.every((m) => !m.open));
  if (after >= before) return false;
  // в риичи открывать руку — только ради яку: дракон, свой ветер, ветер круга, или всё простое
  if (v.cfg.style === 'riichi') {
    const yakuhai = (a.t === 'pon' && (isDragon(k) || k === 27 + q.wind || k === 27 + (v.round % 4))) || q.melds.some((m) => m.t !== 'chi' && (isDragon(m.k) || m.k === 27 + q.wind || m.k === 27 + (v.round % 4)));
    const tanyao = v.cfg.kuitan && ![...rest, last.id, ...q.melds.flatMap((m) => m.ids)].some((id) => isOrphan(kindOf(id)));
    if (!yakuhai && !tanyao) return false;
    return after <= 1 || level === 1 || yakuhai;
  }
  return after <= 2 || level === 1;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  const q = v.p[seat];
  switch (v.phase) {
    case 'missing': {
      const by = [0, 0, 0];
      for (const id of q.hand ?? []) by[suitOf(kindOf(id))]++;
      return { t: 'missing', suit: by.indexOf(Math.min(...by)) };
    }
    case 'end':
      return { t: 'next' };
    case 'claim': {
      const o = v.claims[seat];
      if (!o) return { t: 'pass' };
      if (o.ron) return { t: 'ron' };
      if (o.mkan && claimGood(v, seat, { t: 'mkan' }, level, rng)) return { t: 'mkan' };
      if (o.pon && claimGood(v, seat, { t: 'pon' }, level, rng)) return { t: 'pon' };
      for (const k of o.chi ?? []) if (claimGood(v, seat, { t: 'chi', k }, level, rng)) return { t: 'chi', k };
      return { t: 'pass' };
    }
    case 'turn': {
      const t = v.turnOpts[seat];
      if (!t) return null;
      if (t.tsumo) return { t: 'tsumo' };
      if (level > 0)
        for (const k of t.kans) {
          const hand = q.hand!;
          const four = hand.filter((x) => kindOf(x) === k).length === 4;
          const rest = hand.filter((x) => kindOf(x) !== k || !four);
          const fake: View = { ...v, p: v.p.map((p, x) => (x === seat ? { ...p, melds: [...p.melds, { t: 'kan', k, open: false, ids: [] }] } : p)) };
          const seen = visibleCounts(v, seat);
          const before = Math.min(...hand.map((id) => evalHand(v, seat, hand.filter((x) => x !== id), seen, false).sh));
          const after = four ? Math.min(...rest.map((id) => evalHand(fake, seat, rest.filter((x) => x !== id), seen, false).sh)) : before;
          if (after <= before) return { t: 'kan', k };
        }
      return chooseDiscard(v, seat, level, rng);
    }
    default:
      return null;
  }
}
