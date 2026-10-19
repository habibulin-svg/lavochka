/* Поиск игр по сайту (без DOM: его же гоняют тесты). Ищет по названию, подписи, вариантам и другим названиям
 * (site/names.ts) — по-русски и по-английски; понимает запрос в чужой раскладке («ghbdtn»), транслитом («nardy»)
 * и с опечаткой в одну-две буквы. */
import { CATALOG, type CatalogEntry } from '../games/catalog';
import { isReady } from './card';
import { namesOf } from './names';

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const toRu = new Map([...EN].map((c, i) => [c, RU[i]]));
const toEn = new Map([...RU].map((c, i) => [c, EN[i]]));

/** Набрали не в той раскладке: «yfhls» → «нарды», «ytdthj» → «неверо», и обратно. */
export function swapLayout(s: string): string {
  const lat = (s.match(/[a-z]/g) ?? []).length;
  const cyr = (s.match(/[а-яё]/g) ?? []).length;
  const map = lat >= cyr ? toRu : toEn;
  return [...s].map((c) => map.get(c) ?? c).join('');
}

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Сравнимый «скелет» строки латиницей: кириллица транслитом, латиница — с упрощёнными сочетаниями. */
export function skeleton(s: string): string {
  let t = [...s.toLowerCase()].map((c) => TR[c] ?? c).join('');
  t = t
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/kh/g, 'h')
    .replace(/sch|shch/g, 'sh')
    .replace(/ts|tz/g, 'c')
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/j/g, 'y')
    .replace(/q/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/y/g, 'i')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ');
  return t.trim();
}

interface Doc {
  g: CatalogEntry;
  title: string;
  names: string;
  rest: string;
}

let docs: Doc[] | null = null;
function index(): Doc[] {
  return (docs ??= CATALOG.filter((g) => !g.shelved && isReady(g)).map((g) => ({
    g,
    title: skeleton(g.title),
    names: skeleton(namesOf(g.id).join(' · ')),
    rest: skeleton([g.sub, ...(g.variants ?? [])].join(' · ')),
  })));
}

/** Расстояние Левенштейна с отсечкой: больше `max` — неинтересно. */
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Слово запроса похоже на слово текста: начало слова или одна-две опечатки. */
function fuzzyIn(word: string, text: string): boolean {
  const max = word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0;
  if (!max) return false;
  return text.split(' ').some((w) => w.length >= 3 && (lev(word, w.slice(0, word.length + 1), max) <= max || lev(word, w, max) <= max));
}

function score(d: Doc, words: string[], fuzzy: boolean): number {
  let total = 0;
  for (const w of words) {
    // короткое слово («уно», «го») — только с начала слова, иначе найдётся внутри «Горбунка»
    const at = (t: string) => (w.length <= 3 ? (' ' + t).indexOf(' ' + w) : t.indexOf(w));
    let s = 0;
    if (d.title.startsWith(w)) s = 100;
    else if (at(d.title) >= 0) s = 70;
    else if (at(d.names) >= 0) s = 45;
    else if (at(d.rest) >= 0) s = 20;
    else if (fuzzy && fuzzyIn(w, d.title)) s = 30;
    else if (fuzzy && fuzzyIn(w, d.names)) s = 20;
    else if (fuzzy && fuzzyIn(w, d.rest)) s = 8;
    if (!s) return 0;
    total += s;
  }
  return total;
}

function run(q: string, fuzzy: boolean): Doc[] {
  const words = skeleton(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  return index()
    .map((d) => ({ d, s: score(d, words, fuzzy) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.d);
}

/** Найти игры по запросу: сначала как есть, потом в другой раскладке, потом с опечатками. */
export function searchGames(q: string): CatalogEntry[] {
  const query = q.toLowerCase().trim();
  if (!query) return [];
  let hits = run(query, false);
  if (!hits.length) hits = run(swapLayout(query), false);
  if (!hits.length) hits = run(query, true);
  if (!hits.length) hits = run(swapLayout(query), true);
  // ярлык и игра, на которую он ведёт, — обе карточки нужны: у них разные поля
  return hits.map((d) => d.g);
}
