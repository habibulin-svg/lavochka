/* Новости и блог: записи — Markdown в content/news/*.md и content/blog/*.md (адрес — имя файла).
 * Шапка записи между строками «---»: title, description, date (ГГГГ-ММ-ДД), необязательные h1, updated, image, games (id через запятую).
 * Разметка — простая: ## и ### заголовки, абзацы, списки (- и 1.), > цитаты, таблицы через |, **жирный**, *курсив*,
 * [ссылка](/адрес/), картинка ![подпись](/путь.webp) отдельной строкой; строка, начинающаяся с <, идёт как есть (HTML).
 * Читают пререндер (tools/prerender.ts) и тест (tests/posts.test.ts). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Строчная разметка: экранирование, ссылки, жирный, курсив, код. */
function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(«])\*([^*\s][^*]*?)\*(?=[\s).,:;!?»]|$)/g, '$1<i>$2</i>');
  t = t.replace(/(^|[\s(«])_([^_\s][^_]*?)_(?=[\s).,:;!?»]|$)/g, '$1<i>$2</i>');
  return t;
}

/** Markdown → HTML (подмножество, см. шапку файла). */
export function markdown(src: string): string {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{2,4}\s|[-*]\s|\d+\.\s|>\s?|\||<|!\[)/.test(l) || !l.trim();
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{2,4})\s+(.*)$/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if ((m = l.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) {
      out.push(`<figure class="post-pic"><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy">${m[1] ? `<figcaption>${inline(m[1])}</figcaption>` : ''}</figure>`);
      i++;
    } else if (/^[-*]\s/.test(l) || /^\d+\.\s/.test(l)) {
      const ordered = /^\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s/ : /^[-*]\s/).test(lines[i])) {
        let item = lines[i].replace(/^([-*]|\d+\.)\s+/, '');
        i++;
        // продолжение пункта — строка с отступом
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (/^>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(q.join('\n'))}</blockquote>`);
    } else if (/^\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // строка-разделитель под заголовком
        rows.push(cells);
      }
      const [head, ...body] = rows;
      out.push(
        `<table class="seo-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
    } else if (/^</.test(l)) {
      const raw: string[] = [];
      while (i < lines.length && lines[i].trim()) raw.push(lines[i++]);
      out.push(raw.join('\n'));
    } else {
      const p: string[] = [l.trim()];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) p.push(lines[i++].trim());
      out.push(`<p>${inline(p.join(' '))}</p>`);
    }
  }
  return out.join('\n');
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
    html: markdown(m[2]),
    file,
  };
}

/** Все записи раздела, свежие сначала. */
export function loadPosts(kind: Kind): Post[] {
  const dir = join(ROOT, KINDS[kind].dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => parsePost(kind, f, readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «19 октября 2026». */
export const ruDate = (d: string) => {
  const [y, mo, da] = d.split('-').map(Number);
  return `${da} ${MONTHS[mo - 1]} ${y}`;
};
