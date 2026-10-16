/* Шляпа — словарь. words.json собирает tools/hat/build.mjs: «слово|сложность|подсказка одним словом» — нарицательные из базы вопросов
 * для кроссвордов (public/dict/clues.tsv), «ё» возвращена по списку существительных Harrix (MIT). Толкования для ботов — из той же базы:
 * обычный вопрос кроссворда (подробно) и короткий вопрос сканворда. Без DOM; движку база нужна синхронно (loadClues до игры). */
import { allClues } from '../../words/clues';
import RAW from './words.json';

export type HintKind = 'long' | 'short' | 'one';

export interface Entry {
  /** Как пишется (с «ё»). */
  w: string;
  /** Для сравнения: строчные, «ё» → «е». */
  n: string;
  /** 1 — лёгкое, 2 — среднее, 3 — трудное. */
  d: number;
  /** Подсказка одним словом. */
  one: string;
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z0-9]+/g, ' ')
    .trim();

export const WORDS: Entry[] = (RAW as string[]).map((line) => {
  const [w, d, one] = line.split('|');
  return { w, n: norm(w), d: Number(d) || 2, one };
});

let clueBy: Map<string, { short: string; long: string }> | null = null;
function clues() {
  // база вопросов грузится отдельно (loadClues): пока её нет — не запоминаем пустое
  if (clueBy) return clueBy;
  const m = new Map<string, { short: string; long: string }>();
  for (const c of allClues()) if (c.kind === 'слово' && !m.has(c.word)) m.set(c.word, { short: c.short, long: c.long });
  if (m.size) clueBy = m;
  return m;
}

/** Подсказки к слову по порядку для круга: первый — словами (подробно, потом коротко), второй — коротко и одним словом (бот жестов не покажет),
 * третий — одним словом. */
export function hintsFor(i: number, round: number): { kind: HintKind; text: string }[] {
  const e = WORDS[i];
  if (!e) return [];
  const c = clues().get(e.n.replace(/ /g, ''));
  const one = { kind: 'one' as const, text: e.one.charAt(0).toUpperCase() + e.one.slice(1) };
  const out: { kind: HintKind; text: string }[] = [];
  if (round === 0) {
    if (c) out.push({ kind: 'long', text: c.long }, { kind: 'short', text: c.short });
    else out.push(one);
  } else if (round === 1) {
    if (c) out.push({ kind: 'short', text: c.short });
    out.push(one);
  } else out.push(one);
  return out;
}

let index: Map<string, number[]> | null = null;
function buildIndex() {
  const m = new Map<string, number[]>();
  const add = (k: string, i: number) => {
    const a = m.get(k);
    if (a) a.push(i);
    else m.set(k, [i]);
  };
  WORDS.forEach((e, i) => add(`one:${norm(e.one)}`, i));
  const pos = new Map(WORDS.map((e, i) => [e.n, i]));
  for (const c of allClues()) {
    const i = pos.get(c.word);
    if (c.kind !== 'слово' || i == null) continue;
    add(`long:${norm(c.long)}`, i);
    add(`short:${norm(c.short)}`, i);
  }
  if (allClues().length) index = m;
  return m;
}

/** Какие слова подходят к подсказке (как человек, знающий язык, перебирает в уме). */
export function byHint(kind: HintKind, text: string): number[] {
  return (index ?? buildIndex()).get(`${kind}:${norm(text)}`) ?? [];
}

/** Слова уровня: easy — лёгкие, mid — лёгкие и средние, hard — средние и трудные, all — все. */
export function poolFor(level: string): number[] {
  const ok = level === 'easy' ? [1] : level === 'hard' ? [2, 3] : level === 'all' ? [1, 2, 3] : [1, 2];
  const out: number[] = [];
  WORDS.forEach((e, i) => ok.includes(e.d) && out.push(i));
  return out;
}

export const LEVELS: [string, string][] = [
  ['easy', 'лёгкие'],
  ['mid', 'средние'],
  ['hard', 'трудные'],
  ['all', 'все вперемешку'],
];
