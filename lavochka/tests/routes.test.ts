import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG, CATEGORIES } from '../src/games/catalog';
import { DEFS } from '../src/games/defs';
import { ARTICLES, gamePath, MODE_PAGES, modePath, parseRoute, RESERVED, rulesPath, SECTION_SLUGS, sectionPath, SLUGS, VARIANTS } from '../src/site/routes';
import type { GameSeo } from '../src/site/seo';

describe('адреса сайта', () => {
  it('у каждой карточки каталога есть адрес, и лишних адресов нет', () => {
    const ids = CATALOG.map((g) => g.id).sort();
    expect(Object.keys(SLUGS).sort()).toEqual(ids);
  });

  it('адреса не повторяются и не заняты разделами сайта', () => {
    const all = [...Object.values(SLUGS), ...VARIANTS.map((v) => v.path), ...ARTICLES.map((a) => a.path), ...MODE_PAGES.map((m) => m.path), ...Object.values(SECTION_SLUGS)];
    expect(new Set(all).size, 'повтор адреса').toBe(all.length);
    for (const p of all) {
      expect(p, p).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/);
      expect(RESERVED, p).not.toContain(p.split('/')[0]);
      expect(p.split('/'), p).not.toContain('pravila');
    }
  });

  it('статьи и игры серии разбираются в свою игру', () => {
    for (const a of ARTICLES) expect(parseRoute(`/${a.path}/`), a.path).toMatchObject({ kind: 'game', id: a.game, article: true });
    for (const m of MODE_PAGES) {
      expect(parseRoute(`/${m.path}/`), m.path).toMatchObject({ kind: 'game', id: m.game, mode: m.mode });
      expect(modePath(m.game, m.mode)).toBe(`/${m.path}/`);
    }
    expect(parseRoute('/poker/kombinacii/pravila/').kind).toBe('missing');
    // вложенные страницы кружка — в свой раздел
    expect(parseRoute('/shahmatnyj-kruzhok/uchebnik/vilka/')).toMatchObject({ kind: 'game', id: 'kruzhok', mode: 'uchebnik' });
    expect(parseRoute('/shahmatnyj-kruzhok/debyuty/sicilianskaya-zashchita/')).toMatchObject({ kind: 'game', id: 'kruzhok', mode: 'enciklopediya' });
    expect(parseRoute('/shahmatnyj-kruzhok/terminy/')).toMatchObject({ kind: 'game', id: 'kruzhok', mode: 'enciklopediya' });
    expect(parseRoute('/shahmatnyj-kruzhok/uchebnik/vilka/eshche/').kind).toBe('missing');
    expect(parseRoute('/gadanie-na-kartah/znacheniya-kart/devyatka-mechej/')).toMatchObject({ kind: 'game', id: 'gadanie', mode: 'znacheniya' });
    expect(parseRoute('/gadanie-na-kartah/znacheniya-kart/net-takoj/').kind).toBe('missing');
  });

  it('у страницы игры серии — настоящая игра аркады', async () => {
    const lists: Record<string, { id: string }[]> = {
      elektronika: (await import('../src/games/elektronika/games')).GAMES,
      avtomaty: (await import('../src/games/avtomaty/games')).GAMES,
      kruzhok: [...(await import('../src/games/kruzhok/pages')).MODES],
      gadanie: [...(await import('../src/games/gadanie/pages')).MODES],
    };
    for (const m of MODE_PAGES) expect(lists[m.game]?.map((g) => g.id), m.path).toContain(m.mode);
  });

  it('страница варианта указывает на настоящий пресет игры', async () => {
    for (const v of VARIANTS) {
      const load = (DEFS as Record<string, (() => Promise<{ presets?: { id: string }[] }>) | undefined>)[v.game];
      expect(load, v.path).toBeTruthy();
      const def = await load!();
      expect(def.presets?.map((p) => p.id), v.path).toContain(v.preset);
    }
  });

  it('у страницы каждого варианта свой текст, заголовки и описания разумной длины', async () => {
    const dir = join(__dirname, '..', 'src', 'games');
    const seos = new Map<string, GameSeo>();
    for (const id of readdirSync(dir)) {
      const f = join(dir, id, 'seo.ts');
      if (existsSync(f)) seos.set(id, ((await import(pathToFileURL(f).href)) as { seo: GameSeo }).seo);
    }
    for (const v of VARIANTS) {
      const t = seos.get(v.game)?.variants?.[v.preset];
      expect(t?.h1 && t.title && t.description && t.intro, `текст страницы /${v.path}/`).toBeTruthy();
    }
    for (const [id, s] of seos) {
      for (const t of [s, s.rules ?? {}, ...Object.values(s.variants ?? {})]) {
        if (t.title) expect(t.title.length, `${id}: title «${t.title}»`).toBeLessThanOrEqual(70);
        if (t.description) expect(t.description.length, `${id}: description «${t.description}»`).toBeLessThanOrEqual(200);
      }
    }
  });

  it('адрес разбирается обратно в тот же экран', () => {
    for (const g of CATALOG) {
      const r = parseRoute(gamePath(g.id));
      expect(r, g.id).toEqual({ kind: 'game', id: g.id, preset: undefined, rules: undefined, play: undefined });
      expect(parseRoute(rulesPath(g.id))).toMatchObject({ kind: 'game', id: g.id, rules: true });
    }
    for (const v of VARIANTS) {
      expect(gamePath(v.game, v.preset)).toBe(`/${v.path}/`);
      expect(parseRoute(`/${v.path}/`, '?igra')).toMatchObject({ kind: 'game', id: v.game, preset: v.preset, play: true });
    }
    expect(parseRoute('/')).toEqual({ kind: 'yard' });
    for (const c of CATEGORIES) expect(parseRoute(sectionPath(c.id)), c.id).toEqual({ kind: 'yard', cat: c.id });
    expect(parseRoute('/stol/ab12cd')).toEqual({ kind: 'table', code: 'AB12CD' });
    expect(parseRoute('/nichego-net/')).toEqual({ kind: 'missing', path: 'nichego-net' });
    // вариант без своей страницы — адрес игры
    expect(gamePath('nardy', 'fevga')).toBe('/nardy/');
  });
});
