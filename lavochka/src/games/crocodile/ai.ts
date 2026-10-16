/* Крокодил — боты. Жестов бот не видит и не показывает, поэтому играет карточками (words.ts): показывая, выкладывает их
 * по порядку — от общего к точному (слоги, эмодзи, толкования; у фраз — число слов и слова по одному); угадывая, перебирает
 * слова и фразы, подходящие ко всем показанным карточкам, — чужие неверные догадки отбрасывает. Слова он не знает:
 * из подходящих сильный бот называет самое ходовое (лёгкое) слово, лёгкий — наугад, и решается реже.
 * Показывая людям, бот кивает на догадки («близко»/«нет»), если это разрешено. Видит только свой view. */
import type { Rng } from '../../core/types';
import type { Action, View } from './engine';
import { candidates, itemLevel, itemText, judge, norm, stem, tokensOf, type Item } from './words';

/** Решится ли назвать слово, когда подходит одно-два: [уровень]. */
const DARE = [0.5, 0.7, 0.88];
const SHOW_MS = [
  [5000, 8000],
  [3500, 6000],
  [2500, 4500],
];
const GUESS_MS = [
  [2200, 5000],
  [1500, 3500],
  [900, 2400],
];

const between = ([a, b]: number[], rng: Rng) => Math.round(a + (b - a) * rng.next());
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

const firstSeen = new Map<string, number>();
const seenAt = (key: string) => {
  if (!firstSeen.has(key)) {
    if (firstSeen.size > 3000) firstSeen.clear();
    firstSeen.set(key, Date.now());
  }
  return firstSeen.get(key)!;
};

/** Чем меньше подходит, тем смелее. */
const sizeFactor = (m: number) => (m <= 1 ? 1 : m <= 3 ? 0.9 : m <= 8 ? 0.65 : m <= 25 ? 0.4 : 0.15);

/** Догадка по показанным карточкам или null (промолчать). */
export function guessFor(v: View, level: number, rng: Rng): string | null {
  if (!v.kind || !v.cards.length) return null;
  const tried = v.tries.filter((t) => t.res !== 'right');
  const cands = candidates(v.kind, v.cards).filter((it) => !tried.some((t) => judge(t.text, it) !== 'no'));
  if (!cands.length) return null;
  if (rng.next() >= DARE[level] * sizeFactor(cands.length)) return null;
  let pick: Item;
  if (level === 0 || cands.length === 1) pick = cands[rng.int(cands.length)];
  else {
    // ходовые слова загадывают чаще: сильный берёт самое простое, средний — простое с перевесом
    const lv = cands.map(itemLevel);
    const min = Math.min(...lv);
    const easy = cands.filter((_, k) => lv[k] === min);
    pick = level === 2 || rng.next() < 0.6 ? easy[rng.int(easy.length)] : cands[rng.int(cands.length)];
  }
  return itemText(pick);
}

/** Кивок показывающего на догадку: близко (та же основа или общее слово фразы) или нет. */
function nodFor(v: View, text: string): 'close' | 'no' {
  if (!v.word) return 'no';
  const a = tokensOf(v.word).map(stem);
  const g = tokensOf(text).map(stem);
  if (a.some((x) => g.includes(x))) return 'close';
  const w = norm(v.word);
  return a.length === 1 && w.length >= 4 && norm(text).slice(0, 3) === w.slice(0, 3) ? 'close' : 'no';
}

/** Показывающий-бот: следующая карточка, а когда кончились — пропуск (если можно) или сдаться. */
function nextShow(v: View): Action | null {
  const n = v.deck?.findIndex((d) => !d.used) ?? -1;
  if (n >= 0) return { type: 'card', n };
  if (v.skip === 'free' || (v.skip === 'one' && v.skips < 1)) return { type: 'skip' };
  return null;
}

/** Показывает бот ботам: условное время. */
function virtual(v: View, seat: number, level: number, rng: Rng): Action {
  if (seat === v.shower) {
    const a = nextShow(v);
    if (!a) return { type: 'stall' };
    return { ...a, dt: a.type === 'card' ? between(SHOW_MS[level], rng) : between([800, 1600], rng) } as Action;
  }
  const g = guessFor(v, level, rng);
  const dt = between(GUESS_MS[level], rng);
  return g ? { type: 'guess', text: g, dt } : { type: 'pass', dt };
}

/** Играет человек: по настоящим часам. */
async function real(v: View, seat: number, level: number, rng: Rng): Promise<Action | null> {
  const turn = `${v.gid}:${v.t}`;
  const deadline = seenAt(turn + ':start') + v.time + 1500;
  const card = `${turn}:${v.seq}:${v.cards.length}`;
  if (seat !== v.shower) {
    // угадывающий: раз на каждую новую карточку
    const g = guessFor(v, level, rng);
    await sleep(seenAt(card + ':g') + between(GUESS_MS[level], rng) - Date.now());
    return g ? { type: 'guess', text: g } : { type: 'pass' };
  }
  // показывающий: кивнуть на свежую догадку
  if (v.nod) {
    const tr = v.tries.find((t) => t.res !== 'right' && !t.nod);
    if (tr) {
      await sleep(seenAt(`${turn}:try${tr.id}`) + between([700, 1600], rng) - Date.now());
      return { type: 'nod', id: tr.id, val: nodFor(v, tr.text) };
    }
  }
  const shown = seenAt(card + ':s');
  const gap = v.cards.length ? between(SHOW_MS[level], rng) + 5000 : 1500;
  const a = nextShow(v);
  const at = a?.type === 'skip' ? shown + gap + 4000 : shown + gap;
  if (!a || (v.time && at >= deadline)) {
    if (v.time) {
      await sleep(deadline - Date.now());
      return { type: 'timeup' };
    }
    await sleep(shown + gap + 8000 - Date.now());
    return { type: 'giveup' };
  }
  await sleep(at - Date.now());
  return a;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null | Promise<Action | null> {
  const people = v.humans.length > 0;
  switch (v.phase) {
    case 'pick':
      // загадывает из трёх; вредный (сильный) — самое длинное
      if (!v.offers?.length) return null;
      if (level === 2) {
        const len = v.offers.map((o) => o.length);
        return { type: 'offer', k: len.indexOf(Math.max(...len)) };
      }
      return { type: 'offer', k: rng.int(v.offers.length) };
    case 'ready':
      return people ? sleep(1200).then(() => ({ type: 'start' }) as Action) : { type: 'start' };
    case 'reveal':
      return people ? sleep(4000).then(() => ({ type: 'next' }) as Action) : { type: 'next' };
    case 'show':
      if (seat !== v.shower && !v.eligible.includes(seat)) return null;
      return v.virt ? virtual(v, seat, level, rng) : real(v, seat, level, rng);
    default:
      return null;
  }
}
