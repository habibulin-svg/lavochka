/*
 * Сбор ключевых запросов из Wordstat (Yandex Search API, метод GetTop).
 *
 *   node tools/seo/wordstat.mjs            — пройти все семена из seeds.json (уже скачанные пропускаются)
 *   node tools/seo/wordstat.mjs --report   — только собрать отчёт из скачанного
 *   node tools/seo/wordstat.mjs --check    — один пробный запрос (проверка ключа)
 *
 * Ключ и каталог — в tools/seo/.env (образец — .env.example, сам .env в git не идёт).
 * Квота API — 100 запросов в час, поэтому запросы идут раз в 37 секунд; ответы
 * кэшируются в tools/seo/raw/, и прерванный прогон продолжается с места остановки.
 * Отчёт — docs/seo/keywords.csv (все фразы) и docs/seo/keywords.md (сводка по играм).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, 'raw');
const outDir = join(here, '..', '..', '..', 'docs', 'seo');
const ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests';
const GAP_MS = 37_000;
const NUM = 2000;

function loadEnv() {
  const file = join(here, '.env');
  if (!existsSync(file)) throw new Error(`нет ${file} — скопируйте .env.example в .env и заполните`);
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!env.YANDEX_SEARCH_API_KEY || !env.YANDEX_FOLDER_ID) throw new Error('в .env не заполнены YANDEX_SEARCH_API_KEY и YANDEX_FOLDER_ID');
  return env;
}

const fileFor = (phrase) => join(rawDir, phrase.replace(/[^\p{L}\p{N}]+/gu, '_') + '.json');

async function getTop(env, phrase) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${env.YANDEX_SEARCH_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrase, numPhrases: String(NUM), devices: ['DEVICE_ALL'], folderId: env.YANDEX_FOLDER_ID }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} на «${phrase}»: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedList() {
  const seeds = JSON.parse(readFileSync(join(here, 'seeds.json'), 'utf8'));
  const list = [];
  for (const [game, phrases] of Object.entries(seeds)) {
    if (game === '_') continue;
    for (const phrase of phrases) list.push({ game, phrase });
  }
  return list;
}

async function collect() {
  const env = loadEnv();
  mkdirSync(rawDir, { recursive: true });
  const todo = seedList().filter((s) => !existsSync(fileFor(s.phrase)));
  console.log(`осталось семян: ${todo.length} (≈${Math.ceil((todo.length * GAP_MS) / 60_000)} мин)`);
  for (let i = 0; i < todo.length; i++) {
    const { game, phrase } = todo[i];
    const started = Date.now();
    try {
      const data = await getTop(env, phrase);
      writeFileSync(fileFor(phrase), JSON.stringify({ game, phrase, at: new Date().toISOString(), ...data }, null, 1));
      console.log(`[${i + 1}/${todo.length}] ${game} · «${phrase}»: ${data.totalCount ?? '?'} показов, ${data.results?.length ?? 0} фраз`);
    } catch (e) {
      console.error(`[${i + 1}/${todo.length}] ошибка: ${e.message}`);
      if (/\b(401|403)\b/.test(e.message)) process.exit(1);
      if (/\b429\b/.test(e.message)) { console.log('квота — жду 10 минут'); await sleep(600_000); i--; continue; }
    }
    if (i < todo.length - 1) await sleep(Math.max(0, GAP_MS - (Date.now() - started)));
  }
  report();
}

function report() {
  if (!existsSync(rawDir)) return console.log('нечего сводить — raw/ пуст');
  const byPhrase = new Map(); // фраза → {count, games:Set, seeds:Set}
  const seedTotals = [];
  for (const f of readdirSync(rawDir).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(join(rawDir, f), 'utf8'));
    seedTotals.push({ game: d.game, phrase: d.phrase, total: Number(d.totalCount ?? 0) });
    for (const r of [...(d.results ?? []), ...(d.associations ?? []).map((a) => ({ ...a, assoc: true }))]) {
      const key = r.phrase.trim().toLowerCase();
      const cur = byPhrase.get(key) ?? { count: 0, games: new Set(), seeds: new Set(), assoc: true };
      cur.count = Math.max(cur.count, Number(r.count));
      cur.games.add(d.game);
      cur.seeds.add(d.phrase);
      cur.assoc &&= !!r.assoc;
      byPhrase.set(key, cur);
    }
  }
  const rows = [...byPhrase].sort((a, b) => b[1].count - a[1].count);
  mkdirSync(outDir, { recursive: true });
  const csv = ['phrase;count;games;seeds;association'];
  for (const [p, v] of rows) csv.push([p, v.count, [...v.games].join(','), [...v.seeds].join('|'), v.assoc ? 1 : 0].join(';'));
  writeFileSync(join(outDir, 'keywords.csv'), '﻿' + csv.join('\n'));

  const md = ['# Ключевые запросы (Wordstat, последние 30 дней)', '', `Собрано ${new Date().toISOString().slice(0, 10)}, фраз: ${rows.length}. Полный список — keywords.csv.`, '', '## Семена по объёму', '', '| Игра | Семя | Показов в месяц |', '|---|---|---|'];
  for (const s of seedTotals.sort((a, b) => b.total - a.total)) md.push(`| ${s.game} | ${s.phrase} | ${s.total.toLocaleString('ru')} |`);
  const games = [...new Set(seedTotals.map((s) => s.game))];
  for (const g of games) {
    md.push('', `## ${g}`, '');
    const top = rows.filter(([, v]) => v.games.has(g) && !v.assoc).slice(0, 40);
    for (const [p, v] of top) md.push(`- ${p} — ${v.count.toLocaleString('ru')}`);
  }
  writeFileSync(join(outDir, 'keywords.md'), md.join('\n') + '\n');
  console.log(`отчёт: ${rows.length} фраз → docs/seo/keywords.csv, keywords.md`);
}

const arg = process.argv[2];
if (arg === '--report') report();
else if (arg === '--check') {
  const env = loadEnv();
  const d = await getTop(env, 'нарды');
  console.log(`ключ работает: «нарды» — ${d.totalCount} показов; первые фразы:`, (d.results ?? []).slice(0, 5));
} else await collect();
