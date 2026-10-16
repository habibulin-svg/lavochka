/* Словарь «Шляпы»: src/games/hat/words.json из базы кроссвордных вопросов (public/dict/clues.tsv) и списка существительных
 * «Russian Nouns» (Harrix, MIT — https://github.com/Harrix/Russian-Nouns).
 *
 * Берём нарицательные (вид «слово») длиной 3–14 букв. Из списка Harrix возвращаем «ё» (в базе вопросов она заменена на «е»).
 * К каждому слову — подсказка «одним словом» для ботов (третий круг): первое существительное короткого вопроса,
 * которое не выдаёт корень слова, иначе — из обычного вопроса. Сами вопросы игра берёт из clues.tsv при загрузке.
 *
 * Запуск (из lavochka/): node tools/hat/build.mjs <путь к russian_nouns.txt>
 * Выход: строки «слово|сложность|подсказка», по алфавиту. */
import fs from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('Укажите russian_nouns.txt (https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt)');
  process.exit(1);
}
const norm = (w) => w.toLowerCase().replace(/ё/g, 'е');

// слово без «ё» → форма с «ё» (если такая форма одна)
const yo = new Map();
const nouns = new Set();
for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  const w = line.trim().toLowerCase();
  if (!/^[а-яё]+$/.test(w)) continue;
  nouns.add(norm(w));
  if (!w.includes('ё')) continue;
  const k = norm(w);
  yo.set(k, yo.has(k) && yo.get(k) !== w ? null : w);
}

const leaks = (word, tok) => {
  const n = Math.min(4, word.length, tok.length);
  return tok.slice(0, n) === word.slice(0, n) || word.includes(tok.slice(0, Math.max(4, tok.length - 2)));
};
const tokens = (s) => (s.match(/[а-яёА-ЯЁ]+/g) || []).map((t) => t.toLowerCase());
const STOP = new Set(['для', 'без', 'под', 'над', 'при', 'про', 'как', 'или', 'что', 'это', 'тот', 'его', 'еще', 'так', 'вид', 'род', 'тип', 'часть']);

function one(word, short, long) {
  for (const s of [short, long]) {
    const t = tokens(s).find((x) => x.length >= 4 && !STOP.has(norm(x)) && nouns.has(norm(x)) && !leaks(word, norm(x)));
    if (t) return t;
  }
  const rest = tokens(short)
    .filter((x) => x.length >= 4 && !STOP.has(norm(x)) && !leaks(word, norm(x)))
    .sort((a, b) => b.length - a.length);
  return rest[0] || '';
}

const out = [];
const seen = new Set();
for (const line of fs.readFileSync('public/dict/clues.tsv', 'utf8').split('\n')) {
  const [word, diff, kind, short, long] = line.replace(/\r$/, '').split('\t');
  if (kind !== 'слово' || !short || !long || seen.has(word)) continue;
  if (!/^[а-я]{3,14}$/.test(word)) continue;
  const hint = one(word, short, long);
  if (!hint) continue;
  seen.add(word);
  out.push(`${yo.get(word) || word}|${Number(diff) || 2}|${hint}`);
}
out.sort((a, b) => a.localeCompare(b, 'ru'));
fs.writeFileSync('src/games/hat/words.json', JSON.stringify(out).replace(/","/g, '",\n"') + '\n');
const by = [1, 2, 3].map((d) => out.filter((x) => x.split('|')[1] === String(d)).length);
console.log(`${out.length} слов (лёгких ${by[0]}, средних ${by[1]}, трудных ${by[2]}), с «ё» ${out.filter((x) => x.includes('ё')).length}`);
