/* Все типы задач «А у нас во дворе». Без DOM. */
import { shuffle, SeededRng } from '../../../core/rng';
import { stageOf } from '../stages';
import { checkBulls, genBulls, solveBulls, type BullsData } from './bulls';
import { checkClock, genClock, ruleOf, solveClock, type ClockData } from './clock';
import { genChain, run, solveChain, type ChainData } from './chain';
import { checkHashi, genHashi, solveHashi, spansOf, type HashiData } from './hashi';
import { checkHidato, genHidato, solveHidato, type HidatoData } from './hidato';
import type { Kind } from './kind';
import { checkFuto, checkKakurasu, checkKript, checkOchered, genFuto, genKakurasu, genKript, genOchered, solveFuto, solveKakurasu, solveKript, solveOchered, type FutoData, type KakurasuData, type KriptData, type OcheredData } from './order';
import { checkKakuro, checkKrat, checkMirror, checkRask, genKakuro, genKrat, genMirror, genRask, solveKakuro, solveKrat, solveMirror, solveRask, type KakuroData, type KratData, type MirrorData, type RaskData } from './paint';
import { checkGears, checkZem, genGears, genTurnir, genZem, solveGears, solveTurnir, solveZem, type GearsAns, type GearsData, type TurnirData, type ZemData } from './mech';
import { checkKartinka, genKartinka, genMatrix, genOdin, genVenn, solveKartinka, solveMatrix, solveOdin, solveVenn, type KartinkaData, type MatrixData, type OdinData, type VennData } from './misc';
import { checkFonari, genFonari, solveFonari, type FonariData } from './fonari';
import { checkGryadki, genGryadki, solveGryadki, VEG_NAMES, type GryadkiData } from './gryadki';
import { checkPalatki, genPalatki, solvePalatki, type PalatkiData } from './palatki';
import { checkShikaku, genShikaku, solveShikaku, type ShikakuData } from './shikaku';
import { checkLab, genLab, solveLab, type LabData } from './labirint';
import { checkMorboy, genMorboy, solveMorboy, type MorboyData } from './morboy';
import { checkSaper, genSaper, solveSaper, type SaperData } from './saper';
import { checkStrelki, genStrelki, solveStrelki, type StrelkiData } from './strelki';
import { checkKenken, genKenken, solveKenken, type KenkenData } from './kenken';
import { genKazaki, genOkno, solveKazaki, solveOkno, type KazakiData, type OknoData } from './liars';
import { fitsAll, genOstatki, solveOstatki, type OstatkiData } from './ostatki';
import { GOODS, genShop, shopKnown, solveShop, type ShopData } from './shop';
import { checkStopki, genStopki, solveStopki, type StopkiData } from './stopki';
import { genZadachka, solveZadachka, type ZadachkaData } from './zadachki';
import { checkZebra, genZebra, solveZebra, type ZebraData } from './zebra';

export type { Hint, Kind } from './kind';
export { LEVELS } from './kind';

/** Детерминированный порядок «чего открывать» по номеру подсказки (чтобы k-я подсказка не зависела от прошлых). */
function nth<T>(items: T[], k: number, seed: number): T | undefined {
  return shuffle(items, new SeededRng(seed))[k];
}

const hidato: Kind<HidatoData, number[], number[]> = {
  id: 'hidato',
  title: 'Классики',
  how: 'Впиши числа по порядку: каждое следующее — в соседней клетке (вбок, вверх-вниз или наискосок).',
  par: [60, 150, 300],
  pts: [2, 3, 4],
  gen: (lv, rng) => genHidato(lv, rng),
  check: (d, _s, a) => checkHidato(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const empty = d.cells.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0);
    const i = nth(empty, k, d.cells.length * 7 + empty.length);
    if (i == null) return null;
    return { text: `Число ${sol[i]} стоит в отмеченной клетке.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveHidato(d),
};

const hashi: Kind<HashiData, number[], number[]> = {
  id: 'hashi',
  title: 'Мостки',
  how: 'Соедини кирпичи досками: число — сколько досок у кирпича; доски прямые, не пересекаются, не больше двух между парой, всё связано.',
  par: [90, 180, 360],
  pts: [2, 3, 5],
  gen: (lv, rng) => genHashi(lv, rng),
  check: (d, _s, a) => checkHashi(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const sp = spansOf(d);
    const idx = sp.map((_, i) => i).filter((i) => sol[i] > 0);
    const i = nth(idx, k, d.isl.length * 13 + sp.length);
    if (i == null) return null;
    return { text: `Между отмеченными кирпичами — ${sol[i] === 2 ? 'две доски' : 'одна доска'}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveHashi(d),
};

const zebra: Kind<ZebraData, number[][], number[][]> = {
  id: 'zebra',
  title: 'Кто где',
  how: 'Разберись по подсказкам, у кого что. Отмечай в сетке: ✓ — точно да, ✕ — точно нет. Заполни таблицу ответа.',
  par: [120, 240, 420],
  pts: [2, 3, 5],
  gen: (lv, rng, ctx) => genZebra(lv, ctx.names, stageOf(ctx.stage).zebra ?? stageOf('pryatki').zebra!, rng),
  check: (_d, sol, a) => checkZebra(sol, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const cells = d.cats.flatMap((_, c) => d.names.map((_, i) => [c, i]));
    const ci = nth(cells, k, d.names.length * 31 + d.clues.length);
    if (!ci) return null;
    const [c, i] = ci;
    return { text: `${d.names[i]}: ${d.cats[c].title.toLowerCase()} — ${d.cats[c].vals[sol[c][i]]}.`, reveal: { c, i, v: sol[c][i] } };
  },
  solve: (d) => solveZebra(d),
};

const okno: Kind<OknoData, number, number> = {
  id: 'okno',
  title: 'Кто разбил',
  how: 'Известно, сколько ребят сказали правду. Найди виновника.',
  par: [60, 90, 150],
  pts: [1, 2, 3],
  gen: (lv, rng, ctx) => genOkno(lv, ctx.names, rng),
  check: (_d, sol, a) => a === sol,
  hint(d, sol, k) {
    if (k === 0) return { text: 'Предположи по очереди, что виноват каждый, и посчитай, сколько тогда сказали правду.' };
    const inn = d.names.map((_, i) => i).filter((i) => i !== sol);
    const i = nth(inn, k - 1, d.names.length * 17 + d.truth);
    if (i == null || k > d.names.length - 2) return null;
    return { text: `${d.names[i]} точно ни при чём.`, reveal: { not: i } };
  },
  solve: (d) => solveOkno(d),
};

const kazaki: Kind<KazakiData, boolean[], boolean[]> = {
  id: 'kazaki',
  title: 'Казаки и разбойники',
  how: 'Казаки всегда говорят правду, разбойники всегда врут. Отметь, кто есть кто.',
  par: [60, 120, 200],
  pts: [2, 3, 4],
  gen: (lv, rng, ctx) => genKazaki(lv, ctx.names, rng),
  check: (_d, sol, a) => Array.isArray(a) && sol.every((v, i) => a[i] === v),
  hint(d, sol, k) {
    if (k === 0) return { text: 'Предположи, что первый — казак, и проверь, не выйдет ли противоречия. Если выйдет — значит, он разбойник.' };
    const i = nth(d.names.map((_, j) => j), k - 1, d.names.length * 19 + d.says.length);
    if (i == null || k > 2) return null;
    return { text: `${d.names[i]} — ${sol[i] ? 'разбойник' : 'казак'}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveKazaki(d),
};

const bulls: Kind<BullsData, number[], number[]> = {
  id: 'bulls',
  title: 'Быки и коровы',
  how: 'Загадан код из разных цифр. «Бык» — цифра угадана и стоит на своём месте, «корова» — цифра есть в коде, но на другом месте. Найди код.',
  par: [90, 180, 300],
  pts: [2, 3, 5],
  gen: (lv, rng) => genBulls(lv, rng),
  check: (d, _s, a) => checkBulls(d, a),
  hint(d, sol, k) {
    if (k > 1) return null;
    const i = nth([...Array(d.len).keys()], k, d.len * 23 + d.guesses.length);
    if (i == null) return null;
    return { text: `${i + 1}-я цифра кода — ${sol[i]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveBulls(d),
};

const stopki: Kind<StopkiData, number[], number[]> = {
  id: 'stopki',
  title: 'Стопки',
  how: 'В каждой строке и каждом столбце — стопки высотой от 1 кирпича до размера поля, по одной каждой высоты. Число с края — сколько стопок видно оттуда: высокая загораживает те, что ниже, за ней.',
  par: [90, 180, 360],
  pts: [2, 3, 5],
  gen: (lv, rng) => genStopki(lv, rng),
  check: (d, _s, a) => checkStopki(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const empty = d.given.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    const i = nth(empty, k, d.n * 29 + empty.length);
    if (i == null) return null;
    return { text: `В отмеченной клетке стопка из ${sol[i]} ${sol[i] === 1 ? 'кирпича' : 'кирпичей'}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveStopki(d),
};

const kenken: Kind<KenkenData, number[], number[]> = {
  id: 'kenken',
  title: 'Квадрат',
  how: 'В каждой строке и каждом столбце — все числа от 1 до размера квадрата, по разу. В углу загона — что получится, если сложить (+), вычесть (−), перемножить (×) или разделить (:) его числа.',
  par: [120, 240, 420],
  pts: [2, 4, 5],
  gen: (lv, rng) => genKenken(lv, rng),
  check: (d, _s, a) => checkKenken(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const cells = d.cages.filter((c) => c.op !== '=').flatMap((c) => c.cells);
    const i = nth(cells, k, d.n * 37 + d.cages.length);
    if (i == null) return null;
    return { text: `В отмеченной клетке — ${sol[i]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveKenken(d),
};

const chain: Kind<ChainData, number, number> = {
  id: 'chain',
  title: 'Фантики',
  how: 'Считай по цепочке, сколько фантиков осталось. Можно на бумажке.',
  par: [45, 90, 150],
  pts: [1, 2, 3],
  gen: (lv, rng, ctx) => genChain(lv, ctx.names, rng),
  check: (_d, sol, a) => Number(a) === sol,
  hint(d, _sol, k) {
    // промежуточные итоги: на середине, потом за шаг до конца
    const at = [Math.ceil(d.steps.length / 2), d.steps.length - 1][k];
    if (at == null) return null;
    return { text: `После ${at}-го шага было ${run(d, at)}.`, reveal: { at, v: run(d, at) } };
  },
  solve: (d) => solveChain(d),
};

const clock: Kind<ClockData, string, string> = {
  id: 'clock',
  title: 'Шифр по часам',
  how: 'Каждый циферблат — одна буква: номер буквы в алфавите считается по часам и минутам. Расшифруй записку.',
  par: [90, 150, 270],
  pts: [2, 3, 5],
  gen: (lv, rng) => genClock(lv, rng),
  check: (_d, sol, a) => checkClock(sol, a),
  hint(d, sol, k) {
    if (!d.rule && k === 0) return { text: `Правило: ${ruleOf(d).text}.`, reveal: { rule: ruleOf(d).text } };
    const kk = d.rule ? k : k - 1;
    if (kk > 1) return null;
    const idx = [...sol].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
    const i = nth(idx, kk, sol.length * 41);
    if (i == null) return null;
    return { text: `${sol.slice(0, i).replace(/ /g, '').length + 1}-й циферблат записки — буква «${sol[i]}».`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveClock(d),
};

const shop: Kind<ShopData, number, number> = {
  id: 'shop',
  title: 'Магазин',
  how: 'У каждого товара своя цена. По тому, сколько стоили покупки, найди, сколько стоит то, что спрашивают.',
  par: [90, 180, 300],
  pts: [2, 3, 4],
  gen: (lv, rng) => genShop(lv, rng),
  check: (_d, sol, a) => Number(a) === sol,
  hint(d, _sol, k) {
    if (k === 0) return { text: 'Сравни две покупки, которые отличаются одним товаром: разница сумм — его цена (или цена нескольких штук).' };
    if (k > 1) return null;
    const one = shopKnown(d);
    if (!one) return null;
    return { text: `${GOODS[d.goods[one.i]].icon} ${GOODS[d.goods[one.i]].name} стоит ${one.v} коп.`, reveal: one };
  },
  solve: (d) => solveShop(d),
};

const ostatki: Kind<OstatkiData, number, number> = {
  id: 'ostatki',
  title: 'Лишний',
  how: 'Ребята делятся на команды, и кто-то остаётся лишним. Найди, сколько всего ребят.',
  par: [60, 120, 200],
  pts: [1, 2, 4],
  gen: (lv, rng) => genOstatki(lv, rng),
  check: (d, _s, a) => typeof a === 'number' && a > d.lo && a < d.hi && fitsAll(d, a),
  hint(d, _sol, k) {
    if (k === 0) {
      const s = d.splits[d.splits.length - 1];
      const xs: number[] = [];
      for (let x = d.lo + 1; x < d.hi && xs.length < 6; x++) if (x % s.m === s.r) xs.push(x);
      return { text: `Начни с самого большого деления: по ${s.m} с ${s.r} лишними подходят ${xs.join(', ')}… Теперь проверь их другими делениями.` };
    }
    if (k === 1) return { text: 'Если при делении на два числа лишних «одного не хватает» — ищи число, на единицу меньше общего кратного.' };
    return null;
  },
  solve: (d) => solveOstatki(d),
};

const zadachka: Kind<ZadachkaData, number, number> = {
  id: 'zadachka',
  title: 'Задачка',
  how: 'Задачка на смекалку: ответ — одно число. Не спеши — первый ответ, что приходит в голову, часто неверный.',
  par: [60, 120, 210],
  pts: [1, 2, 4],
  gen: (lv, rng, ctx) => genZadachka(lv, ctx.names, rng),
  check: (_d, sol, a) => Number(a) === sol,
  hint: (d, _sol, k) => (d.hints[k] ? { text: d.hints[k] } : null),
  solve: (d) => solveZadachka(d),
};

const labirint: Kind<LabData, number[], number[]> = {
  id: 'labirint',
  title: 'Подвал',
  how: 'Выведи из подвала к двери: нажимай клетки — путь тянется по прямому коридору, где нет стены. Нажатие на клетку пути — откатиться к ней.',
  par: [40, 80, 150],
  pts: [1, 2, 3],
  gen: (lv, rng) => genLab(lv, rng),
  check: (d, _s, a) => checkLab(d, a),
  hint(_d, sol, k) {
    if (k > 1) return null;
    const len = Math.ceil((sol.length * (k + 1)) / 3);
    return { text: k ? 'Ещё кусок пути проложен.' : 'Первая треть пути проложена.', reveal: { path: sol.slice(0, len) } };
  },
  solve: (d) => solveLab(d),
};

const strelki: Kind<StrelkiData, number[], number[]> = {
  id: 'strelki',
  title: 'Стрелки',
  how: 'Пронумеруй клетки от 1 до последней: следующая клетка лежит по направлению стрелки (на любом расстоянии). Звёздочка — конец пути.',
  par: [90, 180, 330],
  pts: [2, 3, 5],
  gen: (lv, rng) => genStrelki(lv, rng),
  check: (d, _s, a) => checkStrelki(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const empty = d.given.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    const i = nth(empty, k, d.n * 43 + empty.length);
    if (i == null) return null;
    return { text: `В отмеченной клетке — ${sol[i]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveStrelki(d),
};

const saper: Kind<SaperData, number[], number[]> = {
  id: 'saper',
  title: 'Сапёр',
  how: 'Число в открытой клетке — сколько мин среди восьми соседей. Отметь все мины (нажатием на закрытую клетку). Угадывать не нужно.',
  par: [90, 180, 300],
  pts: [2, 3, 5],
  gen: (lv, rng) => genSaper(lv, rng),
  check: (d, _s, a) => checkSaper(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const i = nth(sol, k, d.w * 47 + d.mines);
    if (i == null) return null;
    return { text: 'В отмеченной клетке точно мина.', reveal: { i } };
  },
  solve: (d) => solveSaper(d),
};

const morboy: Kind<MorboyData, number[], number[]> = {
  id: 'morboy',
  title: 'Морской бой',
  how: 'Расставь флот: число у строки и столбца — сколько в них палуб. Корабли прямые и не касаются друг друга даже углами.',
  par: [120, 240, 420],
  pts: [2, 4, 5],
  gen: (lv, rng) => genMorboy(lv, rng),
  check: (d, _s, a) => checkMorboy(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const ships = sol.map((v, i) => (v && !d.shown[i] ? i : -1)).filter((i) => i >= 0);
    const i = nth(ships, k, d.n * 53 + d.fleet.length);
    if (i == null) return null;
    return { text: 'В отмеченной клетке — палуба.', reveal: { i, v: 2 } };
  },
  solve: (d) => solveMorboy(d),
};

const shikaku: Kind<ShikakuData, number[], number[]> = {
  id: 'shikaku',
  title: 'Ножички',
  how: 'Раздели поле на прямоугольники: в каждом ровно одно число, и оно равно площади участка. Тяни пальцем или мышью от угла до угла; нажатие по участку — убрать.',
  par: [60, 150, 300],
  pts: [2, 3, 5],
  gen: (lv, rng) => genShikaku(lv, rng),
  check: (d, _s, a) => checkShikaku(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const clues = d.nums.map((v, i) => (v > 1 ? i : -1)).filter((i) => i >= 0);
    const c = nth(clues, k, d.w * 59 + clues.length);
    if (c == null) return null;
    return { text: `Участок числа ${d.nums[c]} отмечен.`, reveal: { c, cells: sol.map((o, i) => (o === c ? i : -1)).filter((i) => i >= 0) } };
  },
  solve: (d) => solveShikaku(d),
};

const palatki: Kind<PalatkiData, number[], number[]> = {
  id: 'palatki',
  title: 'Палатки',
  how: 'У каждого дерева — своя палатка в соседней клетке (сбоку, сверху или снизу). Палатки не касаются даже углами. Число у строки и столбца — сколько в них палаток.',
  par: [90, 180, 300],
  pts: [2, 3, 5],
  gen: (lv, rng) => genPalatki(lv, rng),
  check: (d, _s, a) => checkPalatki(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const tents = sol.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const i = nth(tents, k, d.n * 61 + d.trees.length);
    if (i == null) return null;
    return { text: 'Палатка в отмеченной клетке стоит верно.', reveal: { i } };
  },
  solve: (d) => solvePalatki(d),
};

const fonari: Kind<FonariData, number[], number[]> = {
  id: 'fonari',
  title: 'Фонари',
  how: 'Поставь фонари так, чтобы осветить все светлые клетки. Фонарь светит по строке и столбцу до стены; два фонаря не должны светить друг на друга. Число на стене — сколько фонарей с ней рядом.',
  par: [90, 180, 330],
  pts: [2, 3, 5],
  gen: (lv, rng) => genFonari(lv, rng),
  check: (d, _s, a) => checkFonari(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const bulbs = sol.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const i = nth(bulbs, k, d.n * 67 + bulbs.length);
    if (i == null) return null;
    return { text: 'В отмеченной клетке — фонарь.', reveal: { i } };
  },
  solve: (d) => solveFonari(d),
};

const gryadki: Kind<GryadkiData, number[], number[]> = {
  id: 'gryadki',
  title: 'Грядки',
  how: 'В каждой строке, каждом столбце и на каждой грядке (обведена) — все овощи по одному разу. Досади огород.',
  par: [90, 180, 330],
  pts: [2, 3, 5],
  gen: (lv, rng) => genGryadki(lv, rng),
  check: (d, _s, a) => checkGryadki(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const empty = d.given.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    const i = nth(empty, k, d.n * 71 + empty.length);
    if (i == null) return null;
    return { text: `В отмеченной клетке — ${VEG_NAMES[sol[i] - 1]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveGryadki(d),
};

const kartinka: Kind<KartinkaData, number[], number[]> = {
  id: 'kartinka',
  title: 'Картинка',
  how: 'Числа слева и сверху — длины закрашенных отрезков в строке и столбце по порядку, между отрезками хоть одна пустая клетка. Закрась картинку: нажатие — закрасить, ещё — крестик, ещё — стереть; можно протягивать.',
  par: [60, 180, 360],
  pts: [2, 3, 5],
  gen: (lv, rng) => genKartinka(lv, rng),
  check: (d, _s, a) => checkKartinka(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const known = new Set(d.open.map(([i]) => i));
    const cells = sol.map((v, i) => (v && !known.has(i) ? i : -1)).filter((i) => i >= 0);
    const i = nth(cells, k, d.w * 73 + cells.length);
    if (i == null) return null;
    return { text: 'Отмеченная клетка закрашена.', reveal: { i, v: 1 } };
  },
  solve: (d) => solveKartinka(d),
};

const odin: Kind<OdinData, number, number> = {
  id: 'odin',
  title: 'Одиночка',
  how: 'Все значки здесь парные — кроме одного. Найди одиночку и нажми на него.',
  par: [30, 50, 80],
  pts: [1, 2, 3],
  gen: (lv, rng) => genOdin(lv, rng),
  check: (_d, sol, a) => a === sol,
  hint(d, sol, k) {
    if (k > 2) return null;
    const icons = [...new Set(d.cells)].filter((x) => x !== d.cells[sol]);
    const icon = nth(icons, k, d.cells.length * 79);
    if (!icon) return null;
    return { text: `${icon} — не одиночка, убираем.`, reveal: { icon } };
  },
  solve: (d) => solveOdin(d),
};

const matrix: Kind<MatrixData, number, number> = {
  id: 'matrix',
  title: 'Что дальше',
  how: 'В каждой строке фигуры меняются по одному правилу: какой-то признак (форма, цвет, сколько штук) одинаков во всей строке, а какой-то перебирает три разных значения. Выбери недостающую фигуру.',
  par: [45, 90, 150],
  pts: [1, 2, 4],
  gen: (lv, rng) => genMatrix(lv, rng),
  check: (_d, sol, a) => a === sol,
  hint(d, sol, k) {
    if (k > 2) return null;
    const wrong = d.options.map((_, i) => i).filter((i) => i !== sol);
    const i = nth(wrong, k, 83 + d.options.length);
    if (i == null) return null;
    return { text: 'Один неверный вариант убран.', reveal: { not: i } };
  },
  solve: (d) => solveMatrix(d),
};

const venn: Kind<VennData, number, number> = {
  id: 'venn',
  title: 'Кружки',
  how: 'Нарисуй кружки, впиши сначала числа в самую серединку, где кружки пересекаются, потом — по краям.',
  par: [60, 90, 180],
  pts: [1, 2, 4],
  gen: (lv, rng) => genVenn(lv, rng),
  check: (_d, sol, a) => Number(a) === sol,
  hint(d, _sol, k) {
    if (k > 1) return null;
    if (k === 0) return { text: 'Кто ходит в оба кружка, посчитан дважды — и среди одних, и среди других.' };
    if (d.q === 'onlyA') return { text: `В «${d.sets[0]}» без других: из всех вычти тех, кто ходит ещё и в «${d.sets[1]}» или «${d.sets[2]}», но тех, кто во всех трёх, вычтешь дважды — верни их.` };
    return { text: `Только в «${d.sets[0]}» — ${d.q === 'none' ? d.p[1] - d.p[3] : d.p[0] - d.p[2]}.` };
  },
  solve: (d) => solveVenn(d),
};

const gears: Kind<GearsData, GearsAns, GearsAns> = {
  id: 'gears',
  title: 'Шестерёнки',
  how: 'Сколько оборотов и в какую сторону сделает отмеченная шестерёнка? Зубья, что прошли по одной, прошли и по другой.',
  par: [60, 120, 200],
  pts: [1, 2, 4],
  gen: (lv, rng) => genGears(lv, rng),
  check: (d, _s, a) => checkGears(d, a),
  hint(d, sol, k) {
    if (k === 0) return { text: `Промежуточные шестерёнки число оборотов не меняют: важны только первая (${d.teeth[0]} зубьев) и отмеченная (${d.teeth[d.ask]}). Сколько зубьев прошло у первой?` };
    if (k === 1) return { text: `Отмеченная крутится ${sol.cw ? 'по часовой' : 'против часовой'} стрелки.` };
    return null;
  },
  solve: (d) => solveGears(d),
};

const turnir: Kind<TurnirData, number, number> = {
  id: 'turnir',
  title: 'Турнир',
  how: 'По очкам команд и известным результатам восстанови, как прошёл турнир.',
  par: [60, 180, 300],
  pts: [1, 3, 5],
  gen: (lv, rng) => genTurnir(lv, rng),
  check: (_d, sol, a) => a === sol,
  hint(d, _sol, k) {
    if (k === 0) return { text: `Каждый матч приносит командам вместе 3 очка, а ничья — только 2. Матчей всего ${(d.teams.length * (d.teams.length - 1)) / 2}.` };
    if (k === 1 && d.ask) return { text: 'Начни с команды, у которой очков совсем мало или очень много: её результаты почти однозначны.' };
    return null;
  },
  solve: (d) => solveTurnir(d),
};

const zem: Kind<ZemData, number, string> = {
  id: 'zem',
  title: 'Земелька',
  how: 'Сколько клеток в участке? Удобно обвести его прямоугольником и вычесть лишние треугольники по углам.',
  par: [45, 120, 200],
  pts: [1, 3, 4],
  gen: (lv, rng) => genZem(lv, rng),
  check: (d, _s, a) => checkZem(d, a),
  hint(_d, _sol, k) {
    if (k === 0) return { text: 'Обведи участок прямоугольником по линиям клеток и посчитай его площадь.' };
    if (k === 1) return { text: 'Прямоугольный треугольник с катетами a и b — это ровно половина прямоугольника a × b.' };
    return null;
  },
  solve: (d) => String(solveZem(d)).replace('.', ','),
};

const krat: Kind<KratData, number[], number[]> = {
  id: 'krat',
  title: 'По кратным',
  how: 'Пройди от зелёной клетки до красной, наступая только на числа, которые делятся без остатка на указанное. Ходить — вбок, вверх, вниз.',
  par: [45, 90, 150],
  pts: [1, 2, 3],
  gen: (lv, rng) => genKrat(lv, rng),
  check: (d, _s, a) => checkKrat(d, a),
  hint(d, sol, k) {
    if (k === 0) return { text: `Признак: число делится на ${d.k}, если ${d.k === 3 ? 'сумма цифр делится на 3' : d.k === 4 ? 'две последние цифры делятся на 4' : d.k === 6 ? 'оно чётное и сумма цифр делится на 3' : d.k === 8 ? 'оно есть в таблице умножения на 8: 8, 16, 24, … 96' : 'оно есть в таблице умножения на 7: 7, 14, 21, … 98'}.` };
    if (k === 1) return { text: 'Первая половина пути проложена.', reveal: { path: sol.slice(0, Math.ceil(sol.length / 2)) } };
    return null;
  },
  solve: (d) => solveKrat(d),
};

const mirror: Kind<MirrorData, number[], number[]> = {
  id: 'mirror',
  title: 'Зеркало',
  how: 'Половина узора нарисована. Дорисуй вторую — зеркально.',
  par: [45, 90, 150],
  pts: [1, 2, 3],
  gen: (lv, rng) => genMirror(lv, rng),
  check: (d, _s, a) => checkMirror(d, a),
  hint(d, _sol, k) {
    if (k > 0) return null;
    return { text: d.axis === 'd' ? 'Клетка в строке r и столбце c отражается в строку c и столбец r.' : 'Иди по строке: что слева от зеркала на таком-то расстоянии, то справа на таком же.' };
  },
  solve: (d) => solveMirror(d),
};

const rask: Kind<RaskData, number[], number[]> = {
  id: 'rask',
  title: 'Раскраска',
  how: 'Раскрась все участки так, чтобы соседние (по стороне) были разного цвета. Часть уже покрашена.',
  par: [60, 120, 200],
  pts: [1, 2, 4],
  gen: (lv, rng) => genRask(lv, rng),
  check: (d, _s, a) => checkRask(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const known = new Set(d.given.map(([r]) => r));
    const free = sol.map((_, r) => r).filter((r) => !known.has(r));
    const r = nth(free, k, sol.length * 89 + d.colors);
    if (r == null) return null;
    return { text: 'Ещё один участок покрашен.', reveal: { r, c: sol[r] } };
  },
  solve: (d) => solveRask(d),
};

const kakuro: Kind<KakuroData, number[], number[]> = {
  id: 'kakuro',
  title: 'Какуро',
  how: 'Впиши цифры от 1 до 9: число в тёмной клетке — сумма цифр справа от неё (верхнее) или под ней (нижнее). Внутри одной суммы цифры не повторяются.',
  par: [60, 150, 300],
  pts: [2, 3, 5],
  gen: (lv, rng) => genKakuro(lv, rng),
  check: (d, _s, a) => checkKakuro(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const free = d.cells.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    const i = nth(free, k, d.w * 97 + free.length);
    if (i == null) return null;
    return { text: `В отмеченной клетке — ${sol[i]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveKakuro(d),
};

const ochered: Kind<OcheredData, number[], number[]> = {
  id: 'ochered',
  title: 'Очередь',
  how: 'Ребята стоят в очереди за мороженым. По подсказкам расставь всех по местам — от ларька.',
  par: [60, 120, 200],
  pts: [1, 2, 4],
  gen: (lv, rng, ctx) => genOchered(lv, ctx.names, rng),
  check: (d, _s, a) => checkOchered(d, a),
  hint(d, sol, k) {
    if (k > 1) return null;
    const p = nth([...sol.keys()], k, d.names.length * 101 + d.clues.length);
    if (p == null) return null;
    return { text: `${p + 1}-м стоит ${d.names[sol[p]]}.`, reveal: { p, v: sol[p] } };
  },
  solve: (d) => solveOchered(d),
};

const futo: Kind<FutoData, number[], number[]> = {
  id: 'futo',
  title: 'Кто выше',
  how: 'В каждой строке и каждом столбце — числа от 1 до размера поля по разу. Знаки между клетками говорят, где больше: открытая сторона — к большему.',
  par: [90, 180, 330],
  pts: [2, 3, 5],
  gen: (lv, rng) => genFuto(lv, rng),
  check: (d, _s, a) => checkFuto(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const empty = d.given.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    const i = nth(empty, k, d.n * 103 + empty.length);
    if (i == null) return null;
    return { text: `В отмеченной клетке — ${sol[i]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveFuto(d),
};

const kript: Kind<KriptData, number[], number[]> = {
  id: 'kript',
  title: 'Шифровка',
  how: 'Пример на сложение, где цифры заменены буквами. Одинаковые буквы — одинаковые цифры, разные — разные. Найди, какая буква что значит.',
  par: [90, 180, 330],
  pts: [2, 3, 5],
  gen: (lv, rng) => genKript(lv, rng),
  check: (d, _s, a) => checkKript(d, a),
  hint(d, sol, k) {
    if (k === 0) {
      const longer = d.c.length > Math.max(d.a.length, d.b.length);
      return { text: longer ? `Сумма длиннее слагаемых — значит, первая буква суммы «${d.c[0]}» равна 1.` : 'Начни с правого столбца: последняя цифра суммы — это последняя цифра сложения двух букв над ней.' };
    }
    if (k > 2) return null;
    const i = nth([...d.letters.keys()], k - 1, d.letters.length * 107);
    if (i == null) return null;
    return { text: `${d.letters[i]} = ${sol[i]}.`, reveal: { i, v: sol[i] } };
  },
  solve: (d) => solveKript(d),
};

const kakurasu: Kind<KakurasuData, number[], number[]> = {
  id: 'kakurasu',
  title: 'Какурасу',
  how: 'Закрась клетки. Число справа от строки — сумма номеров столбцов её закрашенных клеток; число под столбцом — сумма номеров строк.',
  par: [90, 180, 300],
  pts: [2, 3, 5],
  gen: (lv, rng) => genKakurasu(lv, rng),
  check: (d, _s, a) => checkKakurasu(d, a),
  hint(d, sol, k) {
    if (k > 2) return null;
    const on = sol.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const i = nth(on, k, d.n * 109 + on.length);
    if (i == null) return null;
    return { text: 'Отмеченная клетка закрашена.', reveal: { i } };
  },
  solve: (d) => solveKakurasu(d),
};

export const KINDS: Record<string, Kind> = { zebra, hidato, hashi, okno, kazaki, bulls, stopki, kenken, chain, clock, shop, ostatki, zadachka, labirint, strelki, saper, morboy, shikaku, palatki, fonari, gryadki, kartinka, odin, matrix, venn, gears, turnir, zem, krat, mirror, rask, kakuro, ochered, futo, kript, kakurasu };

export const kindOf = (id: string): Kind => KINDS[id] ?? zebra;
