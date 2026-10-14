/* Виселица — боты. Видят маску слова («к_р_в_»), названные буквы и неверные слова — как человек.
 * Лёгкий: частые буквы русского языка, иногда наугад. Средний: слова словаря под маску — самая частая среди них буква.
 * Сложный: то же по обиходным словам (откуда компьютер и загадывает), слово целиком — как только остался один вариант.
 * Аукцион: ставка — доля ожидаемого выигрыша от лучшей буквы. Ведущий-бот загадывает обиходное слово. */
import type { Rng } from '../../core/types';
import { ALPHABET, hasWord, wordsOfLength } from '../../words/dict';
import { drawWord, guessers, pool, PTS, puzzleOf, type Action, type Puzzle, type State } from './engine';

const FREQ = 'оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфъ';

function candidates(p: Puzzle, source: string[]): string[] {
  const wrong = new Set(p.letters.filter((l) => !p.word.includes(l)));
  return source.filter((w) => {
    if (w.length !== p.word.length || p.wrongWords.includes(w)) return false;
    for (let i = 0; i < w.length; i++) {
      const m = p.word[i];
      const c = w[i];
      if (m === '_') {
        if (p.letters.includes(c) || wrong.has(c)) return false;
      } else if (m !== c) return false;
    }
    return true;
  });
}

/** Лучшая буква и доля вариантов, где она есть. */
function bestLetter(p: Puzzle, cands: string[], rng: Rng): { l: string; share: number; avg: number } {
  const free = [...ALPHABET].filter((l) => !p.letters.includes(l));
  if (!cands.length) {
    const l = [...FREQ].find((x) => free.includes(x)) ?? free[rng.int(free.length)];
    return { l, share: 0.3, avg: 1 };
  }
  let best = free[0];
  let bestN = -1;
  let occ = 0;
  for (const l of free) {
    let n = 0;
    let o = 0;
    for (const w of cands) {
      const k = [...w].filter((c, i) => c === l && p.word[i] === '_').length;
      if (k) {
        n++;
        o += k;
      }
    }
    if (n > bestN || (n === bestN && rng.next() < 0.3)) {
      best = l;
      bestN = n;
      occ = o;
    }
  }
  return { l: best, share: bestN / cands.length, avg: bestN ? occ / bestN : 1 };
}

let poolCache: { diff: number; words: string[] } | null = null;
function poolWords(diff: number): string[] {
  if (!poolCache || poolCache.diff !== diff) poolCache = { diff, words: pool(diff).map((x) => x.word) };
  return poolCache.words;
}

function sourceFor(s: State, level: number, len: number): string[] {
  // сложный знает, откуда компьютер берёт слова; если загадал человек — только словарь
  if (level >= 2 && !s.byPlayers) return poolWords(s.diff);
  return wordsOfLength(len);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  switch (s.phase) {
    case 'between':
      return { type: 'next' };
    case 'set': {
      for (let i = 0; i < 20; i++) {
        const w = drawWord(s, rng).word;
        if (hasWord(w)) return { type: 'set', word: w };
      }
      return { type: 'set', word: 'виселица' };
    }
    case 'bid': {
      const p = puzzleOf(s, seat);
      const bank = s.scores[seat];
      if (level === 0) return { type: 'bid', n: Math.min(bank, rng.int(6)) };
      const cands = candidates(p, sourceFor(s, level, p.word.length));
      const b = bestLetter(p, cands, rng);
      const ev = b.share * b.avg * PTS.auctionLetter;
      const k = level === 1 ? 0.4 : 0.65;
      // в конце кона, когда букв мало, торговаться выгоднее за слово
      const n = Math.floor(ev * k + rng.next() * 3);
      return { type: 'bid', n: Math.max(0, Math.min(bank, n)) };
    }
    case 'guess': {
      const p = puzzleOf(s, seat);
      const free = [...ALPHABET].filter((l) => !p.letters.includes(l));
      if (level === 0) {
        const l = rng.next() < 0.35 ? free[rng.int(free.length)] : ([...FREQ].find((x) => free.includes(x)) ?? free[0]);
        return { type: 'letter', l };
      }
      const cands = candidates(p, sourceFor(s, level, p.word.length));
      const hiddenN = [...p.word].filter((c) => c === '_').length;
      if (cands.length === 1 && hiddenN > 1 && (level >= 2 || rng.next() < 0.5)) return { type: 'word', word: cands[0] };
      // в одиночку на последней ошибке сложный рискует словом, если вариантов мало
      if (level >= 2 && cands.length > 1 && cands.length <= 2 && p.misses === s.limit - 1 && guessers(s).length === 1) return { type: 'word', word: cands[rng.int(cands.length)] };
      return { type: 'letter', l: bestLetter(p, cands, rng).l };
    }
    default:
      return null;
  }
}
