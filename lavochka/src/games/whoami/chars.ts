/* Кто я? — персонажи (chars.json из docs/analysis/who-am-i.json) и вопросы «да/нет», на которые боты отвечают по данным. Без DOM. */
import RAW from './chars.json';

export interface Char {
  id: string;
  name: string;
  category: 'real_person' | 'fictional_character';
  subcategory: string;
  gender: string;
  alive: boolean | null;
  origin: string;
  era: string;
  tags: string[];
}

export type Ans = 'y' | 'n' | '?';

export interface Question {
  q: string;
  /** Ответ про персонажа: да, нет или «непонятно». */
  test(c: Char): Ans;
}

const yn = (b: boolean): Ans => (b ? 'y' : 'n');
const sub = (s: string) => (c: Char) => yn(c.subcategory === s);

export const QUESTIONS: Question[] = [
  { q: 'Я реальный человек?', test: (c) => yn(c.category === 'real_person') },
  { q: 'Я мужского пола?', test: (c) => (c.gender === 'other' ? '?' : yn(c.gender === 'male')) },
  { q: 'Я сейчас жив?', test: (c) => (c.alive == null ? '?' : yn(c.alive)) },
  { q: 'Я наш — из России или СССР?', test: (c) => yn(c.origin === 'russia_ussr') },
  { q: 'Я из XX века или новее?', test: (c) => yn(c.era === '20th_ussr_90s' || c.era === 'modern') },
  { q: 'Я исторический деятель?', test: sub('history') },
  { q: 'Я правитель?', test: (c) => yn(c.tags.some((t) => t === 'ruler' || t === 'tsar' || t === 'empress')) },
  { q: 'Я актёр?', test: sub('actor') },
  { q: 'Я музыкант?', test: sub('musician') },
  { q: 'Я спортсмен?', test: sub('sports') },
  { q: 'Я герой фильма?', test: sub('movie') },
  { q: 'Я из мультфильма?', test: sub('cartoon') },
  { q: 'Я из сказки или былины?', test: sub('fairytale') },
  { q: 'Я герой книги?', test: sub('literature') },
  { q: 'Я из компьютерной игры?', test: sub('games') },
  { q: 'Я из комиксов?', test: sub('comics') },
  { q: 'Я злодей?', test: (c) => yn(c.tags.some((t) => t === 'villain' || t === 'monster')) },
];

export const CHARS = RAW as unknown as Char[];
export const CHAR = Object.fromEntries(CHARS.map((c) => [c.id, c])) as Record<string, Char>;

/** Подборки: кто может достаться. */
export const POOLS: [string, string, (c: Char) => boolean][] = [
  ['all', 'все подряд', () => true],
  ['real', 'знаменитости', (c) => c.category === 'real_person'],
  ['fiction', 'герои кино, книг и мультфильмов', (c) => c.category !== 'real_person'],
  ['ours', 'только наши', (c) => c.origin === 'russia_ussr'],
];

export function poolOf(id: string): Char[] {
  const f = POOLS.find((p) => p[0] === id)?.[2] ?? (() => true);
  return CHARS.filter(f);
}

/** Сравнение догадки с персонажем: без регистра, ё=е, без скобок и знаков. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}
