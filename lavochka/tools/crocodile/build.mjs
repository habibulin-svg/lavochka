/* Эмодзи для «Крокодила»: src/games/crocodile/emoji.json из русских подписей Unicode CLDR
 * (cldr-json, annotations/ru — Unicode License v3, https://github.com/unicode-org/cldr-json).
 *
 * Берём эмодзи без оттенков кожи; выбрасываем те, где нарисованы буквы и иероглифы (🅰, 🆗, 🈁, ™…) — буквы показывать нельзя.
 * Каждая строка: «эмодзи|название|ключевое слово|…» — строчными, «ё» → «е». Игра по ним ищет эмодзи для набора,
 * подбирает «пантомиму» бота к слову (эмодзи, у которых слово — среди ключевых) и угадывает слово по показанным эмодзи.
 *
 * Запуск (из lavochka/): node tools/crocodile/build.mjs <путь к annotations.json>
 * (https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-annotations-full/annotations/ru/annotations.json) */
import fs from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('Укажите annotations.json (cldr-annotations-full/annotations/ru)');
  process.exit(1);
}
const ann = JSON.parse(fs.readFileSync(src, 'utf8')).annotations.annotations;
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').trim();

const letters = (cp) =>
  (cp >= 0x1f170 && cp <= 0x1f251) || // 🅰 🆗 🈁 — буквы и иероглифы в рамке
  (cp >= 0x1f520 && cp <= 0x1f524) || // 🔠 🔡 🔤
  [0x2122, 0x2139, 0x24c2, 0xa9, 0xae, 0x3030, 0x303d, 0x3297, 0x3299].includes(cp);

const out = [];
for (const [e, a] of Object.entries(ann)) {
  const cps = [...e].map((c) => c.codePointAt(0));
  if (cps[0] < 0x80) continue; // знаки клавиатуры
  if (cps.some((cp) => cp >= 0x1f3fb && cp <= 0x1f3ff)) continue; // оттенки кожи
  if (cps.some(letters)) continue;
  if (!/\p{Extended_Pictographic}/u.test(e)) continue; // знаки препинания и прочие символы — не картинки
  const name = norm((a.tts ?? [])[0] ?? '');
  if (!name) continue;
  const kw = [...new Set((a.default ?? []).map(norm).filter((k) => k && k !== name && !k.includes('|')))];
  out.push([e, name, ...kw].join('|'));
}
fs.writeFileSync(new URL('../../src/games/crocodile/emoji.json', import.meta.url), '[\n' + out.map((l) => JSON.stringify(l)).join(',\n') + '\n]\n');
console.log(`эмодзи: ${out.length}`);
