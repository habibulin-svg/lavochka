/* Рамми — комбинации (без DOM): проверка набора и последовательности, разбор руки на комбинации с наименьшим «хвостом».
 * Карта с d — номер колоды (в кункене две колоды: одинаковые карты различаются), r = 15 — джокер. */
import type { Card } from '../../cards/deck';

export interface RCard extends Card {
  d?: number;
}

export interface MeldRules {
  /** Туз — только низкий (джин) или и после короля (рамми: Д-К-Т). */
  aceHigh: boolean;
  /** Круговой проход К-Т-2 (кункен). */
  wrap: boolean;
  /** Джокеры (кункен): не больше половины комбинации. */
  jokers: boolean;
}

export const isJoker = (c: Card) => c.r === 15;
export const same = (a: RCard, b: RCard) => a.s === b.s && a.r === b.r && (a.d ?? 0) === (b.d ?? 0);
/** Ранг для последовательностей: туз — 1. */
const low = (c: Card) => (c.r === 14 ? 1 : c.r);

/** Набор: 3–4 карты одного достоинства разных мастей (джокеры — за недостающие). */
export function isSet(cs: RCard[], rules: MeldRules): boolean {
  if (cs.length < 3 || cs.length > 4) return false;
  const nat = cs.filter((c) => !isJoker(c));
  const jk = cs.length - nat.length;
  if (jk && (!rules.jokers || jk * 2 > cs.length)) return false;
  if (!nat.length) return false;
  if (!nat.every((c) => c.r === nat[0].r)) return false;
  return new Set(nat.map((c) => c.s)).size === nat.length;
}

/** Последовательность: 3+ карты подряд одной масти; возвращает ранги по порядку (с местами джокеров) или null. */
export function runOrder(cs: RCard[], rules: MeldRules): number[] | null {
  if (cs.length < 3) return null;
  const nat = cs.filter((c) => !isJoker(c));
  const jk = cs.length - nat.length;
  if (jk && (!rules.jokers || jk * 2 > cs.length)) return null;
  if (!nat.length || !nat.every((c) => c.s === nat[0].s)) return null;
  const n = cs.length;
  // перебираем начало последовательности: ранги 1…14 (14 — туз сверху), с проходом через короля — по кругу
  const ranks = nat.map((c) => c.r);
  if (new Set(ranks).size !== ranks.length) return null;
  const maxStart = rules.wrap ? 13 : rules.aceHigh ? 14 - n + 1 : 13 - n + 1;
  for (let start = 1; start <= maxStart; start++) {
    const seq: number[] = [];
    for (let k = 0; k < n; k++) {
      let r = start + k;
      if (rules.wrap) r = ((r - 1) % 13) + 1;
      seq.push(r);
    }
    if (!rules.wrap && seq[seq.length - 1] > (rules.aceHigh ? 14 : 13)) continue;
    // ранг 1 и 14 — туз
    const want = seq.map((r) => (r === 1 || r === 14 ? 14 : r));
    const left = ranks.slice();
    let ok = true;
    let miss = 0;
    for (const w of want) {
      const i = left.indexOf(w);
      if (i >= 0) left.splice(i, 1);
      else miss++;
    }
    if (left.length) ok = false;
    if (ok && miss === jk) return seq;
  }
  // туз внизу без прохода: ранги low
  void low;
  return null;
}

export const isRun = (cs: RCard[], rules: MeldRules) => runOrder(cs, rules) != null;
export const isMeld = (cs: RCard[], rules: MeldRules) => isSet(cs, rules) || isRun(cs, rules);

/** Очки карты: картинки 10, туз 1, остальные по номиналу; джокер — 25 (на руке). */
export function value(c: Card, jokerValue = 25): number {
  if (isJoker(c)) return jokerValue;
  if (c.r === 14) return 1;
  return Math.min(10, c.r);
}

/** Очки комбинации на столе (для первой выкладки кункена: джокер — за ту карту, которую заменяет). */
export function meldValue(cs: RCard[], rules: MeldRules): number {
  if (isSet(cs, rules)) {
    const nat = cs.find((c) => !isJoker(c))!;
    return value(nat) * cs.length;
  }
  const seq = runOrder(cs, rules);
  if (!seq) return 0;
  return seq.reduce((x, r) => x + (r === 1 ? 1 : r === 14 ? 10 : Math.min(10, r)), 0);
}

/** Все возможные комбинации из руки (наборы и последовательности, с джокерами). */
export function allMelds(hand: RCard[], rules: MeldRules): RCard[][] {
  const out: RCard[][] = [];
  const nat = hand.filter((c) => !isJoker(c));
  const jokers = hand.filter(isJoker);
  // наборы
  const byRank = new Map<number, RCard[]>();
  for (const c of nat) byRank.set(c.r, [...(byRank.get(c.r) ?? []), c]);
  for (const cs of byRank.values()) {
    const uniq: RCard[] = [];
    for (const c of cs) if (!uniq.some((u) => u.s === c.s)) uniq.push(c);
    const subsets = (arr: RCard[], k: number): RCard[][] => (k === 0 ? [[]] : arr.flatMap((c, i) => subsets(arr.slice(i + 1), k - 1).map((r) => [c, ...r])));
    for (const k of [3, 4]) for (const sub of subsets(uniq, k)) out.push(sub);
    if (rules.jokers && jokers.length) {
      for (const sub of subsets(uniq, 2)) out.push([...sub, jokers[0]]);
      for (const sub of subsets(uniq, 3)) out.push([...sub, jokers[0]]);
      if (jokers.length > 1) for (const sub of subsets(uniq, 2)) out.push([...sub, jokers[0], jokers[1]]);
    }
  }
  // последовательности: по масти, окна подряд
  for (const s of ['S', 'C', 'D', 'H']) {
    const cards = nat.filter((c) => c.s === s);
    const byR = new Map<number, RCard>();
    for (const c of cards) if (!byR.has(c.r)) byR.set(c.r, c);
    const has = (r: number) => byR.get(r === 1 ? 14 : r);
    const top = rules.wrap ? 13 + 12 : rules.aceHigh ? 14 : 13;
    for (let start = 1; start <= 13; start++) {
      const run: RCard[] = [];
      let usedJ = 0;
      for (let r = start; r <= top && run.length < 13; r++) {
        const rr = rules.wrap ? ((r - 1) % 13) + 1 : r;
        if (!rules.aceHigh && !rules.wrap && rr === 14) break;
        const c = has(rr === 14 ? 1 : rr);
        if (c) run.push(c);
        else if (rules.jokers && usedJ < jokers.length && (usedJ + 1) * 2 <= run.length + 1) {
          run.push(jokers[usedJ++]);
        } else break;
        if (run.length >= 3 && isRun(run, rules)) out.push(run.slice());
      }
    }
  }
  // убрать повторы
  const key = (m: RCard[]) => m.map((c) => `${c.s}${c.r}.${c.d ?? 0}`).sort().join(',');
  const seen = new Set<string>();
  return out.filter((m) => !seen.has(key(m)) && (seen.add(key(m)), true) && isMeld(m, rules));
}

/** Лучший разбор руки: комбинации без пересечений с наименьшей суммой «хвоста» (карт вне комбинаций). */
export function bestSplit(hand: RCard[], rules: MeldRules, jokerValue = 25): { melds: RCard[][]; dead: RCard[]; deadValue: number } {
  const ms = allMelds(hand, rules);
  let best: { melds: RCard[][]; deadValue: number } = { melds: [], deadValue: hand.reduce((x, c) => x + value(c, jokerValue), 0) };
  const used = new Set<RCard>();
  const total = best.deadValue;
  let nodes = 0;
  const rec = (i: number, chosen: RCard[][], saved: number) => {
    if (++nodes > 20000) return;
    if (total - saved < best.deadValue) best = { melds: chosen.slice(), deadValue: total - saved };
    for (let k = i; k < ms.length; k++) {
      const m = ms[k];
      if (m.some((c) => used.has(c))) continue;
      for (const c of m) used.add(c);
      chosen.push(m);
      rec(k + 1, chosen, saved + m.reduce((x, c) => x + value(c, jokerValue), 0));
      chosen.pop();
      for (const c of m) used.delete(c);
    }
  };
  rec(0, [], 0);
  const inMeld = new Set(best.melds.flat());
  return { melds: best.melds, dead: hand.filter((c) => !inMeld.has(c)), deadValue: best.deadValue };
}

/** Можно ли доложить карту к комбинации (результат — тоже комбинация). */
export function canLayoff(meld: RCard[], c: RCard, rules: MeldRules): boolean {
  return isMeld([...meld, c], rules);
}
