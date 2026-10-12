/* База вопросов для кроссвордов и сканвордов: public/dict/clues.tsv — по строке на вопрос:
 * слово (а–я, ё → е) \t сложность 1–3 \t вид («слово», «город», «человек» …) \t короткий (сканворд) \t обычный (кроссворд).
 * Вопросы написаны для сборника заново; смысл сверялся с Викисловарём (CC BY-SA) и Викиданными (CC0).
 * Загружается один раз, как словарь балды: в браузере — fetch, на сервере и в тестах — с диска. */

export interface Clue {
  word: string;
  diff: number;
  kind: string;
  short: string;
  long: string;
}

/** Картинка к слову для сканворда (фото с Викисклада): файл public/scan/<file>.webp, автор и лицензия — для подписи. */
export interface Pic {
  word: string;
  file: string;
  author: string;
  license: string;
  src: string;
}

let all: Clue[] = [];
let pics: Pic[] = [];
let loading: Promise<void> | null = null;

function parse(text: string) {
  const out: Clue[] = [];
  for (const line of text.split('\n')) {
    const [word, diff, kind, short, long] = line.replace(/\r$/, '').split('\t');
    if (!word || !short || !long) continue;
    out.push({ word, diff: Number(diff) || 2, kind: kind || 'слово', short, long });
  }
  all = out;
}

async function readText(name = 'clues.tsv'): Promise<string> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const r = await fetch(`${base}dict/${name}`);
    if (!r.ok) throw new Error(`База вопросов не загрузилась: ${r.status}`);
    return r.text();
  }
  const fsName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsName)) as typeof import('node:fs');
  const rel = [`../../public/dict/${name}`, `../dist/dict/${name}`, `../public/dict/${name}`];
  for (const u of rel.map((r) => new URL(r, import.meta.url))) if (fs.existsSync(u)) return fs.readFileSync(u, 'utf8');
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? '.';
  for (const p of [`${cwd}/public/dict/${name}`, `${cwd}/dist/dict/${name}`, `${cwd}/lavochka/public/dict/${name}`])
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  throw new Error(`База вопросов не найдена (public/dict/${name})`);
}

export function loadClues(): Promise<void> {
  if (!loading)
    loading = Promise.all([
      readText().then(parse),
      // картинки необязательны: нет файла — сканворды без фото
      readText('pics.json')
        .then((t) => (pics = JSON.parse(t) as Pic[]))
        .catch(() => (pics = [])),
    ])
      .then(() => undefined)
      .catch((e) => {
        loading = null;
        throw e;
      });
  return loading;
}

export const cluesReady = () => all.length > 0;

/** Все вопросы (индекс в массиве — устойчивый номер вопроса, пока база та же). */
export const allClues = () => all;

export const allPics = () => pics;

/** Для тестов: подложить свою базу. */
export function setClues(list: Clue[]) {
  all = list;
  loading = Promise.resolve();
}
