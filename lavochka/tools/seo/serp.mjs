/*
 * Выдача Яндекса (Yandex Search API, web/search) по главным запросам — для разбора конкурентов.
 *   node tools/seo/serp.mjs           — снять топ-10 по запросам из QUERIES (уже снятые пропускаются)
 *   node tools/seo/serp.mjs --report  — сводка docs/seo/serp.md (домены по частоте, топ по запросам)
 * Ключ — tools/seo/.env (как у wordstat.mjs). Ответы — tools/seo/serp/*.json (в git не идут).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'serp');
const outDir = join(here, '..', '..', '..', 'docs', 'seo');

export const QUERIES = [
  // массовые
  'пасьянс косынка играть бесплатно', 'пасьянс паук играть', 'пасьянс солитер играть', 'пасьянс скорпион', 'косынка по три карты',
  'шахматы онлайн', 'шахматы с компьютером', 'дурак онлайн', 'дурак переводной онлайн', 'дурак подкидной играть',
  'нарды онлайн', 'длинные нарды играть', 'короткие нарды играть', 'шашки онлайн', 'русские шашки играть', 'уголки игра онлайн', 'поддавки онлайн',
  'домино онлайн', 'домино козел играть', 'судоку играть', 'кроссворды онлайн', 'сканворды онлайн', 'японские кроссворды онлайн',
  'тетрис играть', 'бильярд играть бесплатно', 'русский бильярд онлайн', 'покер онлайн бесплатно', 'русский покер онлайн', 'техасский холдем онлайн',
  // средние
  'морской бой онлайн', 'мафия онлайн', 'преферанс онлайн', 'эрудит онлайн', 'лото онлайн', 'русское лото играть бесплатно', 'козел карты онлайн',
  'тысяча карты онлайн', 'черви карты онлайн', 'балда онлайн', 'бура онлайн', 'крестики нолики онлайн', 'игра точки онлайн', 'калах онлайн',
  'игра го онлайн', 'верю не верю карты онлайн', 'кинг карты онлайн', 'сека онлайн', 'очко карты онлайн', '101 карты онлайн', 'крокодил онлайн',
  'шпион игра онлайн', 'кто я игра онлайн', 'данетки онлайн', 'шляпа игра онлайн', 'виселица онлайн', 'девятка карты онлайн', 'храп карты онлайн',
  // ностальгия и общие
  'ну погоди игра онлайн', 'игра электроника ну погоди', 'советские игровые автоматы онлайн', 'brick game онлайн', 'ходилки онлайн',
  'настольная игра менеджер онлайн', 'монополия онлайн с друзьями', 'заколдованная страна книга игра', 'советские настольные игры онлайн',
  'игры онлайн с друзьями', 'карточные игры онлайн', 'настольные игры онлайн', 'игры на двоих онлайн', 'игры для компании онлайн', 'игры по сети с другом',
];

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const fileFor = (q) => join(dir, q.replace(/[^\p{L}\p{N}]+/gu, '_') + '.json');

/** Разобрать XML выдачи: позиции, url, домен, заголовок. */
function parse(xml) {
  const out = [];
  for (const g of xml.split('<group>').slice(1)) {
    const url = g.match(/<url>([^<]*)<\/url>/)?.[1];
    const domain = g.match(/<domain>([^<]*)<\/domain>/)?.[1];
    const title = (g.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
    if (url) out.push({ url, domain, title });
  }
  return out;
}

async function search(env, q) {
  const res = await fetch('https://searchapi.api.cloud.yandex.net/v2/web/search', {
    method: 'POST',
    headers: { Authorization: `Api-Key ${env.YANDEX_SEARCH_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { searchType: 'SEARCH_TYPE_RU', queryText: q, familyMode: 'FAMILY_MODE_MODERATE' },
      groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: '10', docsInGroup: '1' },
      region: '225',
      l10N: 'LOCALIZATION_RU',
      folderId: env.YANDEX_FOLDER_ID,
      responseFormat: 'FORMAT_XML',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} «${q}»: ${text.slice(0, 300)}`);
  const xml = Buffer.from(JSON.parse(text).rawData, 'base64').toString('utf8');
  return parse(xml);
}

async function collect() {
  const env = loadEnv();
  mkdirSync(dir, { recursive: true });
  for (const q of QUERIES) {
    if (existsSync(fileFor(q))) continue;
    try {
      const top = await search(env, q);
      writeFileSync(fileFor(q), JSON.stringify({ q, at: new Date().toISOString(), top }, null, 1));
      console.log(`«${q}»: ${top.slice(0, 3).map((x) => x.domain).join(', ')}`);
    } catch (e) {
      console.error(e.message);
      if (/\b(401|403)\b/.test(e.message)) process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  report();
}

function report() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const dom = new Map();
  const rows = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    rows.push(d);
    d.top.forEach((x, i) => {
      const v = dom.get(x.domain) ?? { n: 0, top3: 0, qs: [] };
      v.n++;
      if (i < 3) v.top3++;
      v.qs.push(d.q);
      dom.set(x.domain, v);
    });
  }
  const md = ['# Выдача Яндекса по главным запросам', '', `Снято ${new Date().toISOString().slice(0, 10)}, запросов: ${rows.length}, регион — Россия.`, '', '## Домены по частоте в топ-10', '', '| Домен | В топ-10 | В топ-3 | Примеры запросов |', '|---|---|---|---|'];
  for (const [d, v] of [...dom].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) md.push(`| ${d} | ${v.n} | ${v.top3} | ${v.qs.slice(0, 3).join('; ')} |`);
  md.push('', '## Топ-10 по запросам', '');
  for (const d of rows) md.push(`**${d.q}**: ` + d.top.map((x, i) => `${i + 1}. ${x.domain}`).join(' · '), '');
  writeFileSync(join(outDir, 'serp.md'), md.join('\n'));
  console.log(`отчёт: ${rows.length} запросов, ${dom.size} доменов → docs/seo/serp.md`);
}

if (process.argv[2] === '--report') report();
else await collect();
