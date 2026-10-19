/* Новости и блог (content/*.md): шапка записи, адреса, ссылки внутри текста — только на существующие страницы. */
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog';
import { ARTICLES, MODE_PAGES, parseRoute, SECTION_SLUGS, SLUGS, VARIANTS } from '../src/site/routes';
import { KINDS, loadPosts, markdown, type Kind } from '../tools/posts';

const posts = (Object.keys(KINDS) as Kind[]).flatMap((k) => loadPosts(k));

// адреса сайта, на которые можно ссылаться из записей
const known = new Set<string>(['/', '/novosti/', '/blog/']);
for (const p of Object.values(SLUGS)) known.add(`/${p}/`).add(`/${p}/pravila/`);
for (const v of [...VARIANTS, ...ARTICLES, ...MODE_PAGES]) known.add(`/${v.path}/`);
for (const p of Object.values(SECTION_SLUGS)) known.add(`/${p}/`);
for (const p of posts) known.add(p.path);

describe('записи новостей и блога', () => {
  it('есть новости и статьи блога', () => {
    expect(posts.some((p) => p.kind === 'news')).toBe(true);
    expect(posts.some((p) => p.kind === 'blog')).toBe(true);
  });

  for (const p of posts) {
    it(p.path, () => {
      expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.slug.startsWith('stranica-')).toBe(false); // занято постраничной навигацией
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.title.length).toBeLessThanOrEqual(75);
      expect(p.description.length).toBeGreaterThanOrEqual(80);
      expect(p.description.length).toBeLessThanOrEqual(175);
      for (const id of p.games) expect(CATALOG.some((g) => g.id === id), `игра ${id}`).toBe(true);
      expect(parseRoute(p.path)).toMatchObject({ kind: 'page', tab: p.kind });
      const links = [...p.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h.startsWith('/'));
      for (const href of links) expect(known.has(href.split(/[?#]/)[0]), `ссылка ${href}`).toBe(true);
    });
  }
});

describe('разметка записей', () => {
  it('заголовки, списки, таблицы, ссылки, экранирование', () => {
    const html = markdown('## Раз\n\nТекст **жирный** и *курсив*, [ссылка](/nardy/) <тег>.\nвторая строка\n\n- а\n- б\n\n1. один\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> цитата');
    expect(html).toContain('<h2>Раз</h2>');
    expect(html).toContain('<p>Текст <b>жирный</b> и <i>курсив</i>, <a href="/nardy/">ссылка</a> &lt;тег&gt;. вторая строка</p>');
    expect(html).toContain('<ul><li>а</li><li>б</li></ul>');
    expect(html).toContain('<ol><li>один</li></ol>');
    expect(html).toContain('<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>');
    expect(html).toContain('<blockquote><p>цитата</p></blockquote>');
  });
});

describe('каталог: дата появления', () => {
  it('у каждой карточки added — ГГГГ-ММ-ДД', () => {
    for (const g of CATALOG) expect(g.added, g.id).toMatch(/^20\d\d-\d\d-\d\d$/);
  });
});
