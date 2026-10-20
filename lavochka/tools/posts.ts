/* Новости и блог: записи — Markdown в content/news/*.md и content/blog/*.md (адрес — имя файла).
 * Шапка записи между строками «---»: title, description, date (ГГГГ-ММ-ДД), необязательные h1, updated, image, games (id через запятую).
 * Разметка — простая: ## и ### заголовки, абзацы, списки (- и 1.), > цитаты, таблицы через |, **жирный**, *курсив*,
 * [ссылка](/адрес/), картинка ![подпись](/путь.webp) отдельной строкой; строка, начинающаяся с <, идёт как есть (HTML).
 * Читают пререндер (tools/prerender.ts) и тест (tests/posts.test.ts). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdown } from '../src/core/markdown';
import { gameCard } from '../src/site/postcard';

export { markdown };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Kind = 'news' | 'blog';
/** Разделы: адрес и названия. */
export const KINDS: Record<Kind, { slug: string; title: string; one: string; dir: string }> = {
  news: { slug: 'novosti', title: 'Новости', one: 'Новость', dir: 'content/news' },
  blog: { slug: 'blog', title: 'Блог', one: 'Статья', dir: 'content/blog' },
};
/** Записей на страницу списка. */
export const PER_PAGE = 10;

export interface Post {
  kind: Kind;
  slug: string;
  path: string;
  title: string;
  h1: string;
  description: string;
  date: string;
  updated?: string;
  image?: string;
  games: string[];
  /** Текст записи (HTML). */
  html: string;
  file: string;
}

/** Разобрать файл записи. */
export function parsePost(kind: Kind, file: string, text: string): Post {
  const slug = file.replace(/\.md$/, '');
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`${KINDS[kind].dir}/${file}: нет шапки --- … ---`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  const need = (k: string) => {
    if (!meta[k]) throw new Error(`${KINDS[kind].dir}/${file}: нет поля ${k}`);
    return meta[k];
  };
  return {
    kind,
    slug,
    path: `/${KINDS[kind].slug}/${slug}/`,
    title: need('title'),
    h1: meta.h1 || meta.title,
    description: need('description'),
    date: need('date'),
    updated: meta.updated || undefined,
    image: meta.image || undefined,
    games: (meta.games || '')
      .replace(/[[\]]/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    html: markdown(m[2], gameCard),
    file,
  };
}

/** Записи из админки (server/content.ts выгружает их из базы в DATA_DIR/posts.json): адрес как у файла — заменяет его,
 * hidden — снимает запись с сайта. */
export interface DbPost {
  kind: Kind;
  slug: string;
  title: string;
  h1?: string;
  description: string;
  date: string;
  updated?: string;
  image?: string;
  games?: string[];
  body: string;
  hidden?: boolean;
}

/** Папка данных сервера: DATA_DIR, иначе /srv/lavochka/data (прод), иначе lavochka/data. */
export function dataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return existsSync('/srv/lavochka/data') ? '/srv/lavochka/data' : join(ROOT, 'data');
}

export function loadDbPosts(): DbPost[] {
  const f = join(dataDir(), 'posts.json');
  if (!existsSync(f)) return [];
  try {
    const list = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('posts.json не читается: ' + e);
    return [];
  }
}

export function fromDb(p: DbPost): Post {
  return {
    kind: p.kind,
    slug: p.slug,
    path: `/${KINDS[p.kind].slug}/${p.slug}/`,
    title: p.title,
    h1: p.h1 || p.title,
    description: p.description,
    date: p.date,
    updated: p.updated || undefined,
    image: p.image || undefined,
    games: p.games ?? [],
    html: markdown(p.body, gameCard),
    file: '(админка)',
  };
}

/** Все записи раздела (файлы + админка), свежие сначала. */
export function loadPosts(kind: Kind, db: DbPost[] = loadDbPosts()): Post[] {
  const dir = join(ROOT, KINDS[kind].dir);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
        .map((f) => parsePost(kind, f, readFileSync(join(dir, f), 'utf8')))
    : [];
  const mine = db.filter((p) => p.kind === kind);
  const bySlug = new Map(files.map((p) => [p.slug, p]));
  for (const p of mine) {
    if (p.hidden) bySlug.delete(p.slug);
    else bySlug.set(p.slug, fromDb(p));
  }
  return [...bySlug.values()].sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «19 октября 2026». */
export const ruDate = (d: string) => {
  const [y, mo, da] = d.split('-').map(Number);
  return `${da} ${MONTHS[mo - 1]} ${y}`;
};

/** Справочная страница сайта (политика конфиденциальности, условия): content/pages/<адрес>.md, адрес — в корне сайта.
 * Шапка: title, description, updated (ГГГГ-ММ-ДД), необязательный h1. */
export interface Doc {
  slug: string;
  path: string;
  title: string;
  h1: string;
  description: string;
  updated: string;
  html: string;
}

export function loadDocs(): Doc[] {
  const dir = join(ROOT, 'content/pages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const p = parsePost('news', f, readFileSync(join(dir, f), 'utf8').replace(/^(---\r?\n[\s\S]*?)updated:/m, '$1date:'));
      return { slug: p.slug, path: `/${p.slug}/`, title: p.title, h1: p.h1, description: p.description, updated: p.date, html: p.html };
    });
}
