// Подготовка рисунков костей маджонга: node tools/mahjong/tiles.mjs <fluffy/Regular> <cangjie-svg-dir>
// Наборы:
//  jp — FluffyStuff/riichi-mahjong-tiles (CC0), японский рисунок; цветов и сезонов там нет — берём у Cangjie6;
//  hk — Cangjie6, Wikimedia Commons (CC BY-SA 4.0), гонконгский рисунок; нарисованный корпус кости снимаем — корпус рисует игра.
// На выходе public/mahjong/<набор>/<вид>.svg (вид — номер 0–41 из src/games/mahjong/tiles.ts), 4r/13r/22r — красные пятёрки.
import fs from 'node:fs';
import path from 'node:path';
import { optimize } from 'svgo';

const [fluffy, cj] = process.argv.slice(2);
if (!fluffy || !cj) throw new Error('usage: tiles.mjs <fluffy/Regular> <cangjie dir>');
const out = path.resolve('public/mahjong');

const svgo = (s) =>
  optimize(s, { multipass: true, plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }, 'removeDimensions'] }).data;

function save(set, name, svg) {
  fs.mkdirSync(path.join(out, set), { recursive: true });
  fs.writeFileSync(path.join(out, set, name + '.svg'), svgo(svg));
}

// --- jp
const FL = [...['Pin', 'Sou', 'Man'].flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => s + i)), 'Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun'];
FL.forEach((n, k) => {
  let s = fs.readFileSync(path.join(fluffy, n + '.svg'), 'utf8');
  // белый дракон у FluffyStuff — пустая кость; у нас синяя рамка, как на гонконгских, чтобы не путать с пустым местом
  if (n === 'Haku')
    s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect x="62" y="78" width="176" height="244" rx="16" fill="none" stroke="#1f3f95" stroke-width="15"/><rect x="88" y="104" width="124" height="192" rx="8" fill="none" stroke="#1f3f95" stroke-width="6"/></svg>';
  save('jp', String(k), s);
});
['Pin5', 'Sou5', 'Man5'].forEach((n, i) => save('jp', `${4 + 9 * i}r`, fs.readFileSync(path.join(fluffy, n + '-Dora.svg'), 'utf8')));

// --- hk: снять корпус (тень, зелёная рубашка, светлый торец, лицо с градиентом, блик)
const CJ = [...['t', 's', 'w'].flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `MJ${s}${i}-`)), 'MJf1-', 'MJf2-', 'MJf3-', 'MJf4-', 'MJd3-', 'MJd2-', 'MJd1-'];
// цветы у Cangjie6 — h5–h8 (слива, орхидея, хризантема, бамбук), сезоны — h1–h4
const BONUS = ['MJh5-', 'MJh6-', 'MJh7-', 'MJh8-', 'MJh1-', 'MJh2-', 'MJh3-', 'MJh4-'];
const BODY = /<path[^>]*\bid="(rect4031|rect3767|rect3861|rect3765|rect3008|path3932)"[^>]*\/>/gs;
// лицо кости rect3008 в координатах рисунка (с учётом transform группы g4630)
const FACE = 'viewBox="-178.7 346.5 149.4 189.3"';

function strip(name) {
  let s = fs.readFileSync(path.join(cj, name + '.svg'), 'utf8');
  const before = (s.match(BODY) || []).length;
  if (before < 5) console.warn('корпус не найден целиком:', name, before);
  s = s.replace(BODY, '').replace(/viewBox="[^"]*"/, FACE).replace(/style="enable-background:[^"]*"/, '');
  return s;
}
CJ.forEach((n, k) => save('hk', String(k), strip(n)));
BONUS.forEach((n, i) => {
  const s = strip(n);
  save('hk', String(34 + i), s);
  save('jp', String(34 + i), s);
});
console.log('готово:', out);
