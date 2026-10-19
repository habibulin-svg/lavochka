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
import { gamePath, rulesPath, SITE_NAME, SITE_URL, VARIANTS } from '../src/site/routes';
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
  const file = join(ROOT, 'src', 'games', id, 'seo.ts');
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

function gameLd(g: CatalogEntry, name: string, path: string, description: string) {
  const p = playersOf(g);
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name,
    url: abs(path),
    description,
    ...(g.thumb ? { image: abs('/thumbs/' + g.thumb) } : {}),
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

/** Похожие игры: тот же раздел, готовые, без самой игры. */
function similar(g: CatalogEntry): string {
  const list = CATALOG.filter((x) => x.id !== g.id && x.cat === g.cat && ready(x) && !x.members).slice(0, 10);
  if (!list.length) return '';
  return `<h2>Похожие игры</h2>\n<ul class="seo-links">${list.map((x) => `<li><a href="${gamePath(x.id)}">${esc(x.title)}</a> — ${esc(x.sub)}</li>`).join('')}</ul>`;
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
  const cr = crumbs([
    [SITE_NAME, '/'],
    [name, path],
  ]);
  const faq = faqBlock(t.faq);
  const intro = t.intro ?? `<p>«${esc(name)}» — ${esc(g.sub)}. ${howToPlay(g, def)}</p>`;
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
    const vcr = crumbs([
      [SITE_NAME, '/'],
      [name, path],
      [vname, vpath],
    ]);
    const vfaq = faqBlock(vt.faq);
    pages.push({
      path: vpath,
      title: vt.title ?? titleFor(vname),
      description: vdesc,
      image,
      priority: 0.8,
      jsonld: [gameLd(g, vname, vpath, vdesc), vcr.ld, ...(vfaq.ld ? [vfaq.ld] : [])],
      body: `${vcr.html}\n<h1>${esc(vt.h1 ?? `${vname} онлайн`)}</h1>\n${vt.intro ?? `<p>${esc(vname)}${p.hint ? ' — ' + esc(p.hint.charAt(0).toLowerCase() + p.hint.slice(1)) : ''}. ${howToPlay(g, def)}</p>`}\n${presetList(g, def, v.preset)}\n<h2>Как играть</h2>\n<p><b>Цель игры.</b> ${def.rules.goal}</p>\n<p><a href="${rulesPath(g.id)}">Правила игры «${esc(def.title)}» полностью</a></p>\n${vfaq.html}\n${similar(g)}`,
    });
  }

  // --- страница правил
  const rt = seo.rules ?? {};
  const rpath = rulesPath(g.id);
  const rname = rt.h1 ?? `Правила игры «${def.title}»`;
  const rcr = crumbs([
    [SITE_NAME, '/'],
    [name, path],
    ['Правила', rpath],
  ]);
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
  const cr = crumbs([
    [SITE_NAME, '/'],
    [g.title, path],
  ]);
  const description = clip(`${g.title}: ${g.sub}. ${membersOf(g).map((m) => m.title).join(', ')} — играть онлайн бесплатно, с ботами и с друзьями.`);
  pages.push({
    path,
    title: titleFor(g.title, 'настольные игры'),
    description,
    image: g.thumb ? '/thumbs/' + g.thumb : undefined,
    priority: 0.8,
    jsonld: [cr.ld],
    body: `${cr.html}\n<h1>${esc(g.title)}</h1>\n<p>${esc(g.sub)}.</p>\n<ul class="seo-links">${membersOf(g)
      .filter(ready)
      .map((m) => `<li><a href="${gamePath(m.id)}">${esc(m.title)}</a> — ${esc(m.sub)}</li>`)
      .join('')}</ul>`,
  });
}

function homePage() {
  const sections = CATEGORIES.map((c) => {
    const list = SHOWN.filter((g) => g.cat === c.id && ready(g));
    if (!list.length) return '';
    return `<h2>${esc(c.title)}</h2>\n<ul class="seo-links">${list.map((g) => `<li><a href="${gamePath(g.id)}">${esc(g.title)}</a> — ${esc(g.sub)}</li>`).join('')}</ul>`;
  }).join('\n');
  const description = 'Сборник дворовых игр онлайн: нарды, дурак, шашки, домино, лото, пасьянсы, советские настолки и «Электроника». Бесплатно, без регистрации, с ботами и с друзьями.';
  pages.push({
    path: '/',
    title: `${SITE_NAME} — дворовые игры онлайн: нарды, дурак, шашки, лото`,
    description,
    priority: 1,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: abs('/'), inLanguage: 'ru' }],
    body: `<h1>${esc(SITE_NAME)} — сборник дворовых игр</h1>\n<p>Игры, в которые играли во дворе, на даче и на кухне: карты, нарды и шашки, домино и лото, игры на бумаге, советские настолки, «Электроника» и игровые автоматы. Всё бесплатно и без регистрации — с ботами, за одним экраном или с друзьями по ссылке.</p>\n${sections}`,
  });
}

// ------------------------------------------------------------------ сборка

homePage();
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
