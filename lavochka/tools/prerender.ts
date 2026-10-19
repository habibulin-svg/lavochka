/* Пререндер SEO-страниц: после `vite build` раскладывает готовый HTML по адресам игр (dist/nardy/dlinnye/index.html),
 * плюс sitemap.xml и robots.txt. Поисковик видит текст без JS; в браузере поверх монтируется сама игра,
 * а текст страницы (article#seo) встаёт под экран игры (src/site/page.ts).
 * Запуск: npx tsx tools/prerender.ts  (входит в npm run build). Адрес сайта — SITE_URL (по умолчанию из routes.ts). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALOG, CATEGORIES, membersOf, SHOWN, type CatalogEntry } from '../src/games/catalog';
import { DEFS } from '../src/games/defs';
import type { GameDef, Preset } from '../src/core/types';
import { gamePath, rulesPath, sectionPath, SITE_NAME, SITE_URL, VARIANTS } from '../src/site/routes';
import { cardMarkup } from '../src/site/card';
import { NAMES } from '../src/site/names';
import { GROUPS, HOME, SECTIONS } from '../src/site/sections';
import { clip, plain, type Faq, type GameSeo, type PageText } from '../src/site/seo';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = (process.env.SITE_URL || SITE_URL).replace(/\/$/, '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (p: string) => SITE + p;

// ------------------------------------------------------------------ данные

const ready = (g: CatalogEntry) => !g.shelved && (!!g.load || !!g.of || membersOf(g).length > 0);
const catTitle = (g: CatalogEntry) => CATEGORIES.find((c) => c.id === g.cat)?.title ?? '';

async function loadDef(id: string): Promise<GameDef | null> {
  const f = (DEFS as Record<string, (() => Promise<GameDef>) | undefined>)[id];
  return f ? f() : null;
}

async function loadSeo(id: string): Promise<GameSeo> {
  // папка игры обычно совпадает с id; у «101» папка sto
  const file = join(ROOT, 'src', 'games', id === '101' ? 'sto' : id, 'seo.ts');
  if (!existsSync(file)) return {};
  return ((await import(pathToFileURL(file).href)) as { seo: GameSeo }).seo ?? {};
}

const playersOf = (g: CatalogEntry) => {
  const m = g.players.match(/(\d+)\D+(\d+)/);
  return m ? { min: +m[1], max: +m[2] } : { min: +g.players || 1, max: +g.players || 1 };
};

/** Как играть: с кем — одной фразой, по карточке и игре. */
function howToPlay(g: CatalogEntry, def: GameDef | null): string {
  const p = playersOf(g);
  if (p.max <= 1) return 'Играйте онлайн бесплатно и без регистрации, прямо в браузере — на компьютере и на телефоне.';
  const bots = def?.bot.levels.length ? `против ботов (${def.bot.levels.map((l) => l.toLowerCase()).join(', ')})` : 'с компьютером';
  return `Играйте онлайн бесплатно и без регистрации: ${bots}, вдвоём за одним экраном или с друзьями по ссылке — за сетевым столом есть чат, голос и камера.`;
}

function titleFor(name: string, tail = 'играть бесплатно'): string {
  const t = `${name} онлайн — ${tail}`;
  return t.length + SITE_NAME.length + 3 <= 65 ? `${t} | ${SITE_NAME}` : t;
}

// ------------------------------------------------------------------ шаблон

// чистая оболочка сайта: из неё собираются все страницы; её же сервер отдаёт столам и неизвестным адресам (noindex)
const SPA = join(DIST, '_spa.html');
// index.html после vite build — чистая оболочка; после пререндера там уже главная, поэтому повторный запуск берёт копию
const built = readFileSync(join(DIST, 'index.html'), 'utf8');
const shell = built.includes('id="seo"') && existsSync(SPA) ? readFileSync(SPA, 'utf8') : built;
writeFileSync(SPA, shell);

interface Page {
  path: string;
  title: string;
  description: string;
  body: string;
  image?: string;
  jsonld?: object[];
  /** В sitemap: 1.0 главная, 0.9 игры, 0.8 варианты, 0.6 правила. */
  priority: number;
}

const pages: Page[] = [];

function html(p: Page): string {
  const head = [
    `<link rel="canonical" href="${esc(abs(p.path))}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:url" content="${esc(abs(p.path))}">`,
    `<meta property="og:locale" content="ru_RU">`,
    p.image ? `<meta property="og:image" content="${esc(abs(p.image))}">` : '',
    `<meta name="twitter:card" content="${p.image ? 'summary_large_image' : 'summary'}">`,
    ...(p.jsonld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
  ]
    .filter(Boolean)
    .join('\n');
  let out = shell.replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`).replace(
    /<meta name="description"[^>]*>/,
    `<meta name="description" content="${esc(p.description)}">`
  );
  out = out.replace('</head>', head + '\n</head>');
  out = out.replace('<div id="app"></div>', `<div id="app"></div>\n<article id="seo" class="seo-page" data-path="${esc(p.path)}">\n${p.body}\n</article>`);
  return out;
}

/** Раздел игры (у игры из группы — раздел группы). */
const sectionOf = (g: CatalogEntry) => CATEGORIES.find((c) => c.id === g.cat)!;
const sectionCrumb = (g: CatalogEntry): [string, string] => [sectionOf(g).title, sectionPath(g.cat)];
const groupOf = (g: CatalogEntry) => (g.group ? CATALOG.find((x) => x.id === g.group) : undefined);
/** Крошки до игры: двор › раздел › (группа) › игра. */
function trail(g: CatalogEntry): [string, string][] {
  const grp = groupOf(g);
  return [[SITE_NAME, '/'], sectionCrumb(g), ...(grp ? [[grp.title, gamePath(grp.id)] as [string, string]] : []), [g.title, gamePath(g.id)]];
}

/** Карточки игр прямо в HTML. `yard` — на страницах двора: там их показывает сам двор, и текст страницы их прячет (page.ts). */
const cards = (list: CatalogEntry[], yard = false) =>
  list.length ? `<div class="cards seo-cards"${yard ? ' data-yard' : ''}>${list.map((g) => cardMarkup(g)).join('')}</div>` : '';

/** «Как ещё называют» — другие русские и английские названия. */
function akaBlock(id: string): string {
  const n = NAMES[id];
  if (!n?.ru?.length && !n?.en?.length) return '';
  const part = (label: string, list?: string[]) => (list?.length ? `<b>${label}</b> ${list.map(esc).join(', ')}.` : '');
  return `<p class="seo-aka">${part('Как ещё называют:', n.ru)} ${part('По-английски:', n.en)}</p>`;
}

/** Снимок игры рядом с вводным текстом. */
function shot(g: CatalogEntry, caption: string): string {
  const t = g.thumb ?? (g.of ? CATALOG.find((x) => x.id === g.of)?.thumb : undefined);
  if (!t) return '';
  return `<figure class="seo-shot"><img src="/thumbs/${esc(t)}" alt="${esc(caption)}" width="480" height="300"><figcaption>${esc(caption)}</figcaption></figure>`;
}

const crumbs = (list: [string, string][]) => ({
  html: `<nav class="seo-crumbs">${list.map(([name, path], i) => (i < list.length - 1 ? `<a href="${path}">${esc(name)}</a>` : `<span>${esc(name)}</span>`)).join(' › ')}</nav>`,
  ld: {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: list.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
  },
});

function faqBlock(faq?: Faq[]) {
  if (!faq?.length) return { html: '', ld: null };
  return {
    html: `<h2>Частые вопросы</h2>\n<dl class="seo-faq">${faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${f.a}</dd>`).join('')}</dl>`,
    ld: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
    },
  };
}

const namesAll = (id: string) => [...(NAMES[id]?.ru ?? []), ...(NAMES[id]?.en ?? [])];

function gameLd(g: CatalogEntry, name: string, path: string, description: string) {
  const p = playersOf(g);
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name,
    url: abs(path),
    description,
    ...(g.thumb ? { image: abs('/thumbs/' + g.thumb) } : {}),
    ...(namesAll(g.id).length ? { alternateName: namesAll(g.id) } : {}),
    inLanguage: 'ru',
    genre: catTitle(g),
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: p.min, maxValue: p.max },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
  };
}

/** Похожие игры карточками: сначала из той же группы, потом из того же раздела. */
function similar(g: CatalogEntry): string {
  const grp = groupOf(g);
  const same = grp ? membersOf(grp).filter((x) => x.id !== g.id && ready(x)) : [];
  const rest = SHOWN.filter((x) => x.id !== g.id && x.id !== grp?.id && x.cat === g.cat && ready(x));
  const list = [...same, ...rest].slice(0, 8);
  if (!list.length) return '';
  return `<h2>Похожие игры</h2>\n${cards(list)}\n<p><a href="${sectionPath(g.cat)}">Все игры раздела «${esc(sectionOf(g).title)}»</a></p>`;
}

function presetList(g: CatalogEntry, def: GameDef, skip?: string): string {
  const ps = (def.presets ?? []).filter((p) => p.id !== skip);
  if (!ps.length) return '';
  const item = (p: Preset) => {
    const own = VARIANTS.find((v) => v.game === def.id && v.preset === p.id);
    const name = own ? `<a href="/${own.path}/">${esc(p.label)}</a>` : `<b>${esc(p.label)}</b>`;
    return `<li>${name}${p.hint ? ' — ' + esc(p.hint) : ''}</li>`;
  };
  return `<h2>${skip ? 'Другие варианты' : 'Варианты правил'}</h2>\n<ul class="seo-links">${ps.map(item).join('')}</ul>`;
}

// ------------------------------------------------------------------ страницы

async function gamePages(g: CatalogEntry) {
  const target = g.of ? CATALOG.find((x) => x.id === g.of)! : g;
  const def = await loadDef(target.id);
  const seo = await loadSeo(g.id);
  const path = gamePath(g.id);
  const name = g.title;
  const image = g.thumb ? '/thumbs/' + g.thumb : undefined;

  // --- страница игры
  const t: PageText = seo;
  const description = t.description ?? clip(`${name} онлайн бесплатно и без регистрации: ${g.sub}. ${g.variants?.length ? `Варианты: ${g.variants.slice(0, 5).join(', ')}. ` : ''}С ботами и с друзьями по ссылке, правила с показом.`);
  const cr = crumbs(trail(g));
  const faq = faqBlock(t.faq);
  const intro = shot(g, `${name} — ${g.sub}`) + (t.intro ?? `<p>«${esc(name)}» — ${esc(g.sub)}. ${howToPlay(g, def)}</p>`) + akaBlock(g.id);
  const variantsHtml = def && !g.of ? presetList(g, def) : g.variants?.length ? `<h2>Варианты</h2>\n<ul class="seo-links">${g.variants.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '';
  const rulesHtml = def
    ? `<h2>Как играть</h2>\n<p><b>Цель игры.</b> ${def.rules.goal}</p>\n<p>${def.rules.sections.map((s) => esc(s.title)).join(' · ')}</p>\n<p><a href="${rulesPath(g.of ?? g.id)}">Правила игры «${esc(def.title)}» полностью — с показом на доске</a></p>`
    : '';
  pages.push({
    path,
    title: t.title ?? titleFor(name),
    description,
    image,
    priority: 0.9,
    jsonld: [gameLd(g, name, path, description), cr.ld, ...(faq.ld ? [faq.ld] : [])],
    body: `${cr.html}\n<h1>${esc(t.h1 ?? `${name} онлайн`)}</h1>\n${intro}\n${variantsHtml}\n${rulesHtml}\n${faq.html}\n${similar(g)}`,
  });

  if (!def || g.of) return;

  // --- страницы вариантов
  for (const v of VARIANTS.filter((x) => x.game === g.id)) {
    const p = def.presets!.find((x) => x.id === v.preset)!;
    const vt = seo.variants?.[v.preset] ?? {};
    const vname = vt.h1?.replace(/ онлайн$/, '') ?? `${name}: ${p.label}`;
    const vpath = `/${v.path}/`;
    const vdesc = vt.description ?? clip(`${vname} онлайн бесплатно и без регистрации. ${p.hint ? p.hint + '. ' : ''}С ботами трёх уровней и с друзьями по ссылке, правила с показом на доске.`);
    const vcr = crumbs([...trail(g), [vname, vpath]]);
    const vfaq = faqBlock(vt.faq);
    pages.push({
      path: vpath,
      title: vt.title ?? titleFor(vname),
      description: vdesc,
      image,
      priority: 0.8,
      jsonld: [gameLd(g, vname, vpath, vdesc), vcr.ld, ...(vfaq.ld ? [vfaq.ld] : [])],
      body: `${vcr.html}\n<h1>${esc(vt.h1 ?? `${vname} онлайн`)}</h1>\n${shot(g, vname)}${vt.intro ?? `<p>${esc(vname)}${p.hint ? ' — ' + esc(p.hint.charAt(0).toLowerCase() + p.hint.slice(1)) : ''}. ${howToPlay(g, def)}</p>`}\n${presetList(g, def, v.preset)}\n<h2>Как играть</h2>\n<p><b>Цель игры.</b> ${def.rules.goal}</p>\n<p><a href="${rulesPath(g.id)}">Правила игры «${esc(def.title)}» полностью</a></p>\n${vfaq.html}\n${similar(g)}`,
    });
  }

  // --- страница правил
  const rt = seo.rules ?? {};
  const rpath = rulesPath(g.id);
  const rname = rt.h1 ?? `Правила игры «${def.title}»`;
  const rcr = crumbs([...trail(g), ['Правила', rpath]]);
  const rfaq = faqBlock(rt.faq);
  pages.push({
    path: rpath,
    title: rt.title ?? clip(`${rname}: как играть — с примерами на доске`, 65),
    description: rt.description ?? clip(`${rname}: ${plain(def.rules.goal)} ${def.rules.sections.map((s) => s.title).join(', ')}.`),
    image,
    priority: 0.6,
    jsonld: [rcr.ld, ...(rfaq.ld ? [rfaq.ld] : [])],
    body: `${rcr.html}\n<h1>${esc(rname)}</h1>\n${rt.intro ?? ''}\n<p><b>Цель игры.</b> ${def.rules.goal}</p>\n${def.rules.sections.map((s) => `<h2>${esc(s.title)}</h2>\n${s.html}`).join('\n')}\n${rfaq.html}\n<p><a href="${path}">Играть в «${esc(def.title)}» онлайн</a></p>`,
  });
}

function groupPage(g: CatalogEntry) {
  const path = gamePath(g.id);
  const t = GROUPS[g.id] ?? {};
  const cr = crumbs(trail(g));
  const list = membersOf(g).filter(ready);
  const description = t.description ?? clip(`${g.title}: ${g.sub}. ${list.map((m) => m.title).join(', ')} — играть онлайн бесплатно, с ботами и с друзьями.`);
  const faq = faqBlock(t.faq);
  pages.push({
    path,
    title: t.title ?? titleFor(g.title, 'настольные игры'),
    description,
    image: g.thumb ? '/thumbs/' + g.thumb : undefined,
    priority: 0.8,
    jsonld: [cr.ld, ...(faq.ld ? [faq.ld] : [])],
    body: `${cr.html}\n<h1>${esc(t.h1 ?? g.title)}</h1>\n${t.intro ?? `<p>${esc(g.sub)}.</p>`}\n${akaBlock(g.id)}\n${cards(list, true)}\n${faq.html}\n${otherSections(g.cat)}`,
  });
}

/** Ссылки на остальные разделы. */
function otherSections(skip?: string): string {
  const list = CATEGORIES.filter((c) => c.id !== skip && SECTIONS[c.id] && SHOWN.some((g) => g.cat === c.id && ready(g)));
  return `<h2>${skip ? 'Другие разделы' : 'Разделы'}</h2>\n<p class="seo-chips">${list.map((c) => `<a href="${sectionPath(c.id)}">${esc(c.title)}</a>`).join(' ')}</p>`;
}

function sectionPage(cat: (typeof CATEGORIES)[number]) {
  const t = SECTIONS[cat.id];
  const list = SHOWN.filter((g) => g.cat === cat.id && ready(g));
  if (!t || !list.length) return;
  const path = sectionPath(cat.id);
  const cr = crumbs([
    [SITE_NAME, '/'],
    [cat.title, path],
  ]);
  const faq = faqBlock(t.faq);
  pages.push({
    path,
    title: t.title ?? titleFor(cat.title, 'играть бесплатно'),
    description: t.description ?? clip(plain(t.short)),
    image: list[0].thumb ? '/thumbs/' + list[0].thumb : undefined,
    priority: 0.9,
    jsonld: [
      cr.ld,
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: t.h1 ?? cat.title,
        itemListElement: list.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, url: abs(gamePath(g.id)) })),
      },
      ...(faq.ld ? [faq.ld] : []),
    ],
    body: `${cr.html}\n<h1>${esc(t.h1 ?? cat.title)}</h1>\n${t.intro ?? t.short}\n${cards(list, true)}\n${faq.html}\n${otherSections(cat.id)}`,
  });
}

function homePage() {
  const sections = CATEGORIES.map((c) => {
    const t = SECTIONS[c.id];
    if (!t || !SHOWN.some((g) => g.cat === c.id && ready(g))) return '';
    return `<h2><a href="${sectionPath(c.id)}">${esc(c.title)}</a></h2>\n${t.short}`;
  }).join('\n');
  pages.push({
    path: '/',
    title: HOME.title!,
    description: HOME.description!,
    priority: 1,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: abs('/'), inLanguage: 'ru' }],
    body: `<h1>${esc(HOME.h1!)}</h1>\n${HOME.intro}\n${cards(SHOWN.filter(ready), true)}\n${sections}`,
  });
}

// ------------------------------------------------------------------ сборка

homePage();
for (const c of CATEGORIES) sectionPage(c);
for (const g of CATALOG) {
  if (!ready(g)) continue;
  if (g.members) groupPage(g);
  else await gamePages(g);
}

for (const p of pages) {
  const file = p.path === '/' ? join(DIST, 'index.html') : join(DIST, ...p.path.split('/').filter(Boolean), 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html(p));
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${esc(abs(p.path))}</loc><lastmod>${today}</lastmod><priority>${p.priority.toFixed(1)}</priority></url>`)
    .join('\n')}\n</urlset>\n`
);
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nDisallow: /stol/\nDisallow: /poisk\nDisallow: /api/\nDisallow: /*?igra\nDisallow: /*?thumb\n\nSitemap: ${abs('/sitemap.xml')}\n`);

console.log(`пререндер: ${pages.length} страниц, sitemap.xml, robots.txt → ${SITE}`);
