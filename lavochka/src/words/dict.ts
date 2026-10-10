/* Словарь существительных для словесных игр (балда, эрудит): public/dict/nouns.txt — по слову в строке, а–я, ё заменена на е.
 * Загружается один раз: в браузере — fetch с сайта, на сервере и в тестах — с диска. После loadDict() все проверки синхронные,
 * поэтому движки игр остаются без await. Префиксы ищутся двоичным поиском по отсортированному списку. */

export const ALPHABET = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';

let list: string[] = [];
let set = new Set<string>();
let loading: Promise<void> | null = null;

/** Привести слово к виду словаря: строчные, ё → е. */
export const norm = (w: string) => w.toLowerCase().replace(/ё/g, 'е');

function fill(text: string) {
  list = text
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .sort();
  set = new Set(list);
}

async function readText(): Promise<string> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const r = await fetch(`${base}dict/nouns.txt`);
    if (!r.ok) throw new Error(`Словарь не загрузился: ${r.status}`);
    return r.text();
  }
  // Node: сервер (dist-server/index.js → ../dist/dict) или исходники (src/words → ../../public/dict)
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as typeof import('node:fs');
  // пути строками в массиве: Vite не должен принять new URL(…, import.meta.url) за ассет и тащить словарь в сборку
  const rel = ['../../public/dict/nouns.txt', '../dist/dict/nouns.txt', '../public/dict/nouns.txt'];
  const tries = rel.map((r) => new URL(r, import.meta.url));
  for (const u of tries) if (fs.existsSync(u)) return fs.readFileSync(u, 'utf8');
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? '.';
  for (const p of [`${cwd}/public/dict/nouns.txt`, `${cwd}/dist/dict/nouns.txt`, `${cwd}/lavochka/public/dict/nouns.txt`])
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  throw new Error('Словарь не найден (public/dict/nouns.txt)');
}

export function loadDict(): Promise<void> {
  if (!loading)
    loading = readText()
      .then(fill)
      .catch((e) => {
        loading = null;
        throw e;
      });
  return loading;
}

export const dictReady = () => list.length > 0;
export const dictSize = () => list.length;

/** Есть ли слово в словаре. */
export const hasWord = (w: string) => set.has(w);

/** Начинается ли с p хотя бы одно слово словаря. */
export function hasPrefix(p: string): boolean {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m] < p) lo = m + 1;
    else hi = m;
  }
  return lo < list.length && list[lo].startsWith(p);
}

/** Слова заданной длины (для начального слова балды). */
export const wordsOfLength = (n: number) => list.filter((w) => w.length === n);

/** Для тестов: подложить свой словарь. */
export function setDict(words: string[]) {
  fill(words.join('\n'));
  loading = Promise.resolve();
}
