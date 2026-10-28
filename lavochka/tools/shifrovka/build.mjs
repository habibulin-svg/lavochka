/* Шифровка: собрать src/games/shifrovka/words.json из words.txt (свой словарь: частотные слова + топонимы) и assoc/*.json
 * (ассоциации к каждому слову, по убыванию силы; писали агенты пачками). Запуск: node tools/shifrovka/build.mjs */
import fs from 'fs';
const dir = 'tools/shifrovka/';
const lines = fs.readFileSync(dir + 'words.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const cut = lines.indexOf('# топонимы');
const words = lines.slice(0, cut).filter((s) => !s.startsWith('#'));
const topo = lines.slice(cut + 1).filter((s) => !s.startsWith('#'));
const A = {};
for (const f of fs.readdirSync(dir + 'assoc').sort()) Object.assign(A, JSON.parse(fs.readFileSync(dir + 'assoc/' + f, 'utf8')));
const assoc = {};
for (const w of [...words, ...topo]) {
  if (!A[w]) throw new Error('нет ассоциаций: ' + w);
  assoc[w] = [...new Set(A[w].map((s) => s.trim().toLowerCase()).filter((s) => /^[а-яё]{2,20}$/.test(s)))].join(' ');
}
fs.writeFileSync('src/games/shifrovka/words.json', JSON.stringify({ words, topo, assoc }));
console.log(words.length, 'слов,', topo.length, 'топонимов');
