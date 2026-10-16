/* Шпион — боты. Понимают только признаковые вопросы (ответ — вариант из списка), свободный текст людей пропускают мимо ушей.
 * Мирный знает слово: отвечает правду, а кто ответил не так — тот и шпион. Шпион вычёркивает из списка слова, которые не сходятся с ответами,
 * и отвечает тем вариантом, что чаще встречается у оставшихся; осталось мало — называет слово.
 * Лёгкий: замечает подвох через раз, отвечает наугад, угадывает рано. Сложный: ничего не упускает, спрашивает тех, кого ещё не проверили. */
import type { Rng } from '../../core/types';
import type { Action, View } from './engine';
import { pool, THEME, word as findWord, type Word } from './themes';

const pick = <T>(a: T[], rng: Rng): T => a[rng.int(a.length)];
const now = () => Date.now();

/** Что уже ответили на признаковые вопросы: признак → значение (берём первый ответ; спорные — по большинству). */
function known(v: View, except?: number): Map<number, number> {
  const tally = new Map<number, Map<number, number>>();
  for (const q of v.qa) {
    if (q.facet == null || q.val == null || q.to === except) continue;
    const m = tally.get(q.facet) ?? new Map<number, number>();
    m.set(q.val, (m.get(q.val) ?? 0) + 1);
    tally.set(q.facet, m);
  }
  const out = new Map<number, number>();
  for (const [f, m] of tally) out.set(f, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

/** Слова, которые сходятся с ответами (для шпиона). */
export function candidates(v: View, me: number): Word[] {
  const k = known(v, me);
  const all = pool(v.theme, v.sub);
  const ok = all.filter((w) => [...k].every(([f, val]) => w.f[f] === val));
  return ok.length ? ok : all;
}

/** Подозрения мирного: кто ответил не так, как на самом деле, — почти наверняка шпион. */
function suspicion(v: View, me: number, w: Word, level: number, rng: Rng): Map<number, number> {
  const sus = new Map<number, number>(v.seats.filter((x) => x !== me).map((x) => [x, rng.next() * 0.5]));
  for (const q of v.qa) {
    if (q.to === me || !sus.has(q.to)) continue;
    // лёгкий замечает через раз
    const notice = level >= 1 || ((q.to * 7 + q.from * 3 + v.qa.length) % 2 === 0);
    if (q.facet != null && q.val != null && q.val !== w.f[q.facet] && notice) sus.set(q.to, sus.get(q.to)! + 100);
    if (q.dodge) sus.set(q.to, sus.get(q.to)! + 2);
  }
  return sus;
}

const top = (sus: Map<number, number>) => [...sus].sort((a, b) => b[1] - a[1])[0];

/** Кого спросить: не себя и не того, кто спросил меня. Сложный — того, кто ещё не отвечал на новый признак. */
function chooseTarget(v: View, me: number, level: number, rng: Rng, sus?: Map<number, number>): number {
  const can = v.seats.filter((x) => x !== me && (x !== v.prev || v.seats.length <= 2));
  if (level >= 2) {
    const tested = new Set(v.qa.filter((q) => q.facet != null && q.val != null).map((q) => q.to));
    const fresh = can.filter((x) => !tested.has(x));
    if (sus) {
      const best = [...can].sort((a, b) => sus.get(b)! - sus.get(a)!)[0];
      if (sus.get(best)! > 1) return best;
    }
    if (fresh.length) return pick(fresh, rng);
  }
  return pick(can, rng);
}

/** Какой признак спросить: средний и сложный — ещё не звучавший (если такие остались). */
function chooseFacet(v: View, level: number, rng: Rng): number {
  const n = THEME[v.theme].facets.length;
  const asked = new Set(v.qa.filter((q) => q.facet != null && q.val != null).map((q) => q.facet!));
  const fresh = Array.from({ length: n }, (_, i) => i).filter((i) => !asked.has(i));
  if (level >= 1 && fresh.length && rng.next() < (level >= 2 ? 0.85 : 0.7)) return pick(fresh, rng);
  return rng.int(n);
}

export function choose(v: View, me: number, level: number, rng: Rng): Action | null {
  const card = v.cards[me];
  if (!card) return null;
  const n = v.seats.length;
  switch (v.phase) {
    case 'deal':
      return v.ready.includes(me) ? null : { type: 'ready', at: now() };
    case 'reveal':
      return { type: 'next' };
    case 'over':
      return null;
  }

  if (card.spy) {
    const cands = candidates(v, me);
    const guess = (): Action => ({ type: 'guess', word: pick(cands, rng).id, at: now() });
    if (v.phase === 'vote') return { type: 'vote', yes: true, at: now() };
    if (v.phase === 'final') {
      // время вышло: угадать, если почти ясно, иначе показать на кого-нибудь
      if (cands.length <= (level >= 2 ? 3 : 2)) return guess();
      return { type: 'point', target: pick(v.seats.filter((x) => x !== me), rng) };
    }
    const mine = (v.phase === 'ask' && v.asker === me) || (v.phase === 'answer' && v.target === me);
    if (!mine) return null;
    // под подозрением (на него голосовали) — рискнуть раньше
    const heat = v.qa.some((q) => q.to === me && q.facet != null) ? 1 : 0;
    const long = v.qa.length >= 4 * n;
    if (cands.length === 1 || long) return guess();
    if (level === 0 && cands.length <= 5 && rng.next() < 0.3) return guess();
    if (level === 1 && cands.length <= 2 && rng.next() < 0.5) return guess();
    if (level >= 2 && cands.length <= 2 + heat) return guess();
    if (v.phase === 'answer') {
      const q = v.qa[v.qa.length - 1];
      if (q.facet == null) return { type: 'answer', text: 'Сложно сказать… как у всех, наверное.' };
      const opts = THEME[v.theme].facets[q.facet].a;
      const k = known(v, me);
      if (k.has(q.facet)) return { type: 'answer', val: k.get(q.facet)! };
      if (level === 0 && rng.next() < 0.5) return { type: 'answer', val: rng.int(opts.length) };
      // самый частый вариант у оставшихся слов
      const cnt = opts.map((_, i) => cands.filter((w) => w.f[q.facet!] === i).length);
      const best = cnt.indexOf(Math.max(...cnt));
      if (level >= 2 && cnt[best] < cands.length * 0.5 && rng.next() < 0.25) return { type: 'answer', dodge: true };
      return { type: 'answer', val: best };
    }
    return { type: 'ask', target: chooseTarget(v, me, level, rng), facet: chooseFacet(v, level, rng) };
  }

  const w = findWord(v.theme, card.word)!;
  const sus = suspicion(v, me, w, level, rng);
  if (v.phase === 'vote') {
    const vt = v.vote!;
    const [best, score] = top(sus);
    const s = sus.get(vt.suspect) ?? 0;
    // есть улика — голосуем по ней; нет — как повезёт
    if (s >= 100) return { type: 'vote', yes: true, at: now() };
    if (score >= 100 && best !== vt.suspect) return { type: 'vote', yes: false, at: now() };
    return { type: 'vote', yes: rng.next() < (level === 0 ? 0.5 : 0.35), at: now() };
  }
  if (v.phase === 'final') {
    const [best] = top(sus);
    return { type: 'point', target: best };
  }
  const mine = (v.phase === 'ask' && v.asker === me) || (v.phase === 'answer' && v.target === me);
  if (!mine) return null;
  if (!v.accused.includes(me)) {
    const [best, score] = top(sus);
    const sure = score >= 100 && rng.next() < [0.5, 0.9, 1][level];
    // раунд затянулся — обвинить самого подозрительного
    const long = v.qa.length >= 3 * n && score > 0.3 && level >= 1 && rng.next() < 0.4;
    if (sure || long) return { type: 'accuse', target: best, at: now() };
  }
  if (v.phase === 'answer') {
    const q = v.qa[v.qa.length - 1];
    if (q.facet == null) {
      const f = rng.int(w.f.length);
      return { type: 'answer', text: `Ну… ${THEME[v.theme].facets[f].a[w.f[f]]}, если коротко.` };
    }
    if (level === 0 && rng.next() < 0.1) return { type: 'answer', dodge: true };
    return { type: 'answer', val: w.f[q.facet] };
  }
  return { type: 'ask', target: chooseTarget(v, me, level, rng, sus), facet: chooseFacet(v, level, rng) };
}
