/* Шифровка — боты. Видят только свой view (капитан — весь ключ, отгадчик — открытое).
 * Ассоциации — из words.json: к каждому слову поля 25 слов по убыванию силы. Сила связи подсказки со словом — по месту в списке
 * (плюс грубое совпадение начала слова — для подсказок людей, которых в списках нет).
 * Капитан ищет подсказку, общую для нескольких своих слов и далёкую от чужих, нейтральных и ловушки:
 * лёгкий — на одно слово (не всегда лучшее), средний — до двух, сложный — до четырёх, с запасом от ловушки.
 * Отгадчик открывает самые близкие к подсказке слова, пока связь уверенная; сложный добирает слова по старым подсказкам. */
import type { Rng } from '../../core/types';
import DATA from './words.json';
import { clueProblem, norm, type Action, type View } from './engine';

/** Слово поля → (ассоциация → место в списке). */
const RANK = new Map<string, Map<string, number>>();
const BY_CLUE = new Map<string, string[]>();
/** Как писать подсказку (с ё): нормальная форма → исходная. */
const SPELL = new Map<string, string>();
for (const [w, list] of Object.entries(DATA.assoc as Record<string, string>)) {
  const m = new Map<string, number>();
  list.split(' ').forEach((a, i) => {
    const n = norm(a);
    if (!m.has(n)) m.set(n, i);
    if (!SPELL.has(n) || a.includes('ё')) SPELL.set(n, a);
  });
  RANK.set(norm(w), m);
}
for (const [w, m] of RANK) for (const a of m.keys()) (BY_CLUE.get(a) ?? BY_CLUE.set(a, []).get(a)!).push(w);

const fromRank = (r: number) => 1 - r / 32;

/** Насколько подсказка c подходит к слову поля w (0…1). */
export function strength(word: string, clue: string): number {
  const w = norm(word);
  const c = norm(clue);
  const m = RANK.get(w);
  if (!m) return 0;
  const r = m.get(c);
  if (r != null) return fromRank(r);
  // подсказка — тоже слово поля, и у неё в списке есть w
  const back = RANK.get(c)?.get(w);
  if (back != null) return fromRank(back) * 0.8;
  // другая форма того же слова: общее начало от 5 букв
  let best = 0;
  if (c.length >= 5)
    for (const [a, i] of m) {
      let k = 0;
      while (k < a.length && k < c.length && a[k] === c[k]) k++;
      if (k >= 5 && k >= Math.min(a.length, c.length) - 2) best = Math.max(best, fromRank(i) * 0.7);
    }
  return best;
}

interface Plan {
  word: string;
  n: number;
  score: number;
}

function captain(v: View, me: number, level: number, rng: Rng): Action {
  const t = v.turn;
  const open = (i: number) => v.opened[i] == null;
  const mine = v.words.map((w, i) => i).filter((i) => open(i) && v.key[i] === t);
  const others = v.words.map((w, i) => i).filter((i) => open(i) && v.key[i] !== t);
  const used = new Set(v.clues.map((c) => norm(c.word)));
  const cands = new Set<string>();
  for (const i of mine) for (const a of RANK.get(norm(v.words[i]))?.keys() ?? []) cands.add(a);
  const cap = level === 0 ? 1 : level === 1 ? 2 : 4;
  const margin = level === 0 ? 0.02 : level === 1 ? 0.08 : 0.14;
  const plans: Plan[] = [];
  for (const c of cands) {
    if (used.has(c) || clueProblem(c, v.words, v.opened)) continue;
    let bad = 0;
    for (const i of others) {
      const k = v.key[i];
      const w = k === 'x' ? 1.6 : k === 'n' ? 1 : 1.15;
      bad = Math.max(bad, strength(v.words[i], c) * w + (k === 'x' && level >= 2 ? 0.12 : 0));
    }
    const good = mine.map((i) => strength(v.words[i], c)).filter((x) => x > bad + margin && x > 0.25).sort((a, b) => b - a).slice(0, cap);
    if (!good.length) continue;
    // уверенность: самая слабая из выбранных
    const score = good.length + good[good.length - 1] * 0.8 + good.reduce((a, b) => a + b, 0) * 0.15 - bad * 0.6;
    plans.push({ word: c, n: good.length, score });
  }
  plans.sort((a, b) => b.score - a.score);
  if (!plans.length) {
    // ничего надёжного: подсказка к одному своему слову — первая подходящая ассоциация
    for (const i of mine)
      for (const a of RANK.get(norm(v.words[i]))?.keys() ?? []) if (!used.has(a) && !clueProblem(a, v.words, v.opened)) return { type: 'clue', word: SPELL.get(a) ?? a, n: 1 };
    return { type: 'clue', word: 'пароль', n: 1 };
  }
  const top = level === 0 ? plans.slice(0, 6) : level === 1 ? plans.slice(0, 3) : plans.slice(0, 1);
  const p = top[rng.int(top.length)];
  return { type: 'clue', word: SPELL.get(p.word) ?? p.word, n: p.n };
}

function guesser(v: View, level: number, rng: Rng): Action {
  const clue = v.clues[v.clues.length - 1];
  const free = v.words.map((_, i) => i).filter((i) => v.opened[i] == null);
  const made = clue.picks.length;
  const noise = () => (level === 0 ? rng.next() * 0.35 : level === 1 ? rng.next() * 0.1 : rng.next() * 0.02);
  const score = (i: number) => strength(v.words[i], clue.word) + noise();
  const ranked = free.map((i) => [i, score(i)] as const).sort((a, b) => b[1] - a[1]);
  const want = clue.n > 0 ? clue.n : clue.n === 0 ? 0 : 9;
  const thr = level === 0 ? 0.1 : level === 1 ? 0.22 : 0.3;
  if (!made) return { type: 'guess', index: ranked[0][0] };
  if (made < want && ranked[0][1] > thr) return { type: 'guess', index: ranked[0][0] };
  // лишняя попытка — по старым подсказкам своей команды, если связь сильная
  if (level >= 2 && made === want && clue.n > 0) {
    const old = v.clues.filter((c) => c.team === v.turn && c !== clue);
    let best: [number, number] | null = null;
    for (const c of old) {
      const got = c.picks.filter((i) => v.key[i] === v.turn).length;
      if (c.n <= 0 || got >= c.n) continue;
      for (const i of free) {
        const s = strength(v.words[i], c.word);
        if (s > 0.62 && (!best || s > best[1])) best = [i, s];
      }
    }
    if (best) return { type: 'guess', index: best[0] };
  }
  return { type: 'stop' };
}

export function choose(v: View, me: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'clue') return v.captains[v.turn] === me ? captain(v, me, level, rng) : null;
  if (v.phase === 'guess') return guesser(v, level, rng);
  return null;
}

/** Есть ли подсказка в таблице ассоциаций (для подсказки людям, что боты её поймут). */
export const knownClue = (c: string) => BY_CLUE.has(norm(c));
