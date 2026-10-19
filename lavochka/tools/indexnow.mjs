// IndexNow после выкладки: сравнить отпечатки страниц (dist/pages.json, пишет tools/prerender.ts)
// с прошлой выкладкой, сообщить поисковикам изменившиеся адреса и проставить в dist/sitemap.xml
// настоящие даты изменения (а не дату сборки).
//
//   node tools/indexnow.mjs <папка данных> [--dry]
//
// Память — <папка данных>/pages.json: { путь: { hash, date } }. Запускает deploy.sh (папка — /srv/lavochka/data).
// Ключ — файл public/<KEY>.txt с тем же ключом внутри (IndexNow проверяет, что сайт наш).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = '5d5662878d201021de29dc39d3b3305d';
const SITE = 'https://lavochka-games.ru';
// Яндекс — основной; общий адрес IndexNow сам раздаёт остальным (Bing и др.)
const ENDPOINTS = ['https://yandex.com/indexnow', 'https://api.indexnow.org/indexnow'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const dataDir = process.argv[2];
const dry = process.argv.includes('--dry');
if (!dataDir) {
  console.error('нужна папка данных: node tools/indexnow.mjs /srv/lavochka/data');
  process.exit(2);
}

const memFile = join(dataDir, 'pages.json');
const mem = existsSync(memFile) ? JSON.parse(readFileSync(memFile, 'utf8')) : {};
const pages = JSON.parse(readFileSync(join(DIST, 'pages.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const changed = [];
const next = {};
for (const p of pages) {
  const old = mem[p.path];
  if (old?.hash === p.hash) next[p.path] = old;
  else {
    next[p.path] = { hash: p.hash, date: today };
    changed.push(SITE + p.path);
  }
}
// исчезнувшие страницы — тоже сообщить: робот сходит и увидит 404/301
for (const path of Object.keys(mem)) if (!next[path]) changed.push(SITE + path);

// sitemap: lastmod — дата последнего изменения страницы
const smFile = join(DIST, 'sitemap.xml');
if (existsSync(smFile)) {
  const sm = readFileSync(smFile, 'utf8').replace(
    /<loc>([^<]+)<\/loc><lastmod>[^<]*<\/lastmod>/g,
    (all, loc) => {
      const d = next[loc.replace(SITE, '').replace(/&amp;/g, '&')]?.date;
      return d ? `<loc>${loc}</loc><lastmod>${d}</lastmod>` : all;
    }
  );
  writeFileSync(smFile, sm);
}

if (!changed.length) {
  console.log('indexnow: изменений нет');
  process.exit(0);
}
console.log(`indexnow: изменилось ${changed.length} адресов${dry ? ' (--dry, не отправляю)' : ''}`);
if (dry) {
  console.log(changed.slice(0, 20).join('\n'));
  process.exit(0);
}

let ok = false;
for (const url of ENDPOINTS) {
  // не больше 10 000 адресов за раз
  for (let i = 0; i < changed.length; i += 10000) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: changed.slice(i, i + 10000) }),
        signal: AbortSignal.timeout(20000),
      });
      console.log(`  ${url}: ${r.status}`);
      if (r.status === 200 || r.status === 202) ok = true;
    } catch (e) {
      console.log(`  ${url}: ${e.message}`);
    }
  }
}
// память обновляем, только если хоть один поисковик принял — иначе повторим в следующий раз
if (ok) writeFileSync(memFile, JSON.stringify(next));
