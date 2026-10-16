// Шпион: собрать базы слов из docs/analysis/spy-*.json в src/games/spy/words.json.
// У каждого слова — признаки (номера значений вопросов темы, см. src/games/spy/themes.ts), по ним отвечают боты.
// Картинки — public/spy/<тема>/<id>.webp (есть файл — img: 1); лицензии из public/spy/credits-*.json (подбор — tools/spy/commons.py) сводятся в public/spy/credits.html.
// Запуск из lavochka/: node tools/spy/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = '../docs/analysis';
const PUB = 'public/spy';
const load = (t) => JSON.parse(fs.readFileSync(path.join(SRC, `spy-${t}.json`), 'utf8'));
const has = (x, t) => (x.tags || []).includes(t);

/** Тема → [признаки записи по порядку вопросов темы, подпись под словом]. Порядок значений — как в themes.ts. */
const THEMES = {
  locations: (x) => [[['indoor', 'outdoor', 'transport'].indexOf(x.where), ['work', 'rest', 'study', 'trade', 'health', 'service', 'travel'].indexOf(x.purpose), x.crowd === 'many' ? 0 : 1], ''],
  movies: (x) => {
    const g = [].concat(x.genre || []);
    const cartoon = has(x, 'animation') || g.includes('animation') || g.includes('anime') || x.country === 'anime';
    const mood = g.includes('comedy') ? 0 : g.includes('horror') || g.includes('thriller') ? 2 : 1;
    return [[x.country === 'ussr' ? 0 : x.country === 'russia' ? 1 : 2, cartoon ? 0 : 1, x.year < 1980 ? 0 : x.year < 2000 ? 1 : 2, mood], String(x.year || '')];
  },
  music: (x) => {
    const era = (x.eras || [])[0];
    return [[x.country === 'russia' ? 0 : 1, x.genre === 'rock' || x.genre === 'metal' ? 0 : 1, era === '80s' ? 0 : era === '90s' ? 1 : 2], x.hit ? `«${x.hit.split(' / ')[0]}»` : ''];
  },
  books: (x) => [[x.region === 'russia' ? 0 : x.region === 'ussr' ? 1 : 2, x.genre === 'sci-fi_fantasy' ? 1 : x.genre === 'detective' ? 2 : 0, x.period === 'modern' ? 1 : 0], x.author || ''],
  games: (x) => {
    const era = (x.eras || [])[0];
    const g = { shooter: 0, strategy: 1, rpg: 2 }[x.genre] ?? 3;
    return [[x.origin === 'cis' ? 0 : 1, g, era === '80s' || era === '90s' ? 0 : era === '00s' ? 1 : 2], x.year ? String(x.year) : ''];
  },
  art: (x) => {
    const subj = has(x, 'portrait') ? 0 : has(x, 'landscape') || has(x, 'seascape') ? 1 : 2;
    return [[x.region === 'russia' ? 0 : 1, x.year < 1700 ? 0 : x.year < 1900 ? 1 : 2, subj], [x.artist, x.year].filter(Boolean).join(', ')];
  },
  geography: (x) => [[x.type === 'city' ? 0 : 1, { russia: 0, europe: 1, usa: 2 }[x.region] ?? 3], x.country && x.country !== x.name ? x.country : ''],
  history: (x) => [[x.category === 'historical_place' ? 0 : 1, { ancient: 0, middle_ages: 1, modern_history: 2, '20th_century': 3 }[x.epoch] ?? 2, x.region === 'russia' ? 0 : 1], ''],
};

/** Метки для подборок темы (см. SUBS в themes.ts): 1 — наше, 2 — зарубежное, 4 — советское, 8 — мульты. */
function marks(t, x) {
  let m = 0;
  const ours = { movies: ['ussr', 'russia'].includes(x.country), music: x.country === 'russia', books: x.region !== 'world', games: x.origin === 'cis', art: x.region === 'russia', geography: x.region === 'russia', history: x.region === 'russia' }[t];
  if (ours != null) m |= ours ? 1 : 2;
  if (t === 'movies' && x.country === 'ussr') m |= 4;
  if (t === 'movies' && THEMES.movies(x)[0][1] === 0) m |= 8;
  return m;
}

const out = {};
// credits-a.json — первая партия, credits-b-<тема>.json — tools/spy/commons.py; более поздние перекрывают
const credits = Object.assign({}, ...fs.readdirSync(PUB).filter((f) => /^credits-.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(`${PUB}/${f}`, 'utf8'))));
let imgs = 0;
for (const [t, fn] of Object.entries(THEMES)) {
  const seen = new Set();
  out[t] = load(t).flatMap((x) => {
    if (seen.has(x.id)) return [];
    seen.add(x.id);
    const [f, sub] = fn(x);
    if (f.some((v) => v < 0 || v == null)) throw new Error(`${t}/${x.id}: нет признака ${JSON.stringify(f)}`);
    const name = (x.name || x.title).replace(/\s*\([^)]*[A-Za-z][^)]*\)\s*$/, '').trim();
    const w = { id: x.id, name, f };
    if (sub) w.sub = sub;
    const m = marks(t, x);
    if (m) w.m = m;
    if (x.roles) w.roles = x.roles;
    if (x.questions) w.q = x.questions;
    if (fs.existsSync(`${PUB}/${t}/${x.id}.webp`) && credits[`${t}/${x.id}`]) {
      w.img = 1;
      imgs++;
    }
    return [w];
  });
}
fs.writeFileSync('src/games/spy/words.json', JSON.stringify(out));

// страница с авторами картинок
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rows = Object.entries(out).flatMap(([t, ws]) =>
  ws.filter((w) => w.img).map((w) => {
    const c = credits[`${t}/${w.id}`];
    return `<tr><td>${esc(w.name)}</td><td>${esc(c.author || '—')}</td><td>${esc(c.license || '')}</td><td><a href="${esc(c.source || '#')}">источник</a></td></tr>`;
  }),
);
fs.writeFileSync(
  `${PUB}/credits.html`,
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Шпион — авторы картинок</title>
<style>body{font:14px/1.4 'PT Sans',Arial,sans-serif;margin:16px;background:#f4efe4;color:#222}td{padding:3px 8px;border-bottom:1px solid #ddd}</style>
<h1>Шпион — авторы картинок</h1><p>Картинки взяты с Wikimedia Commons под свободными лицензиями (общественное достояние, CC0, CC BY, CC BY-SA) и уменьшены.</p>
<table>${rows.join('\n')}</table>`,
);
console.log(Object.entries(out).map(([t, ws]) => `${t} ${ws.length}`).join(', '), `· картинок ${imgs}`);
