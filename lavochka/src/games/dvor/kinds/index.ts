/* Все типы задач «А у нас во дворе». Без DOM. */
import { shuffle, SeededRng } from '../../../core/rng';
import { stageOf } from '../stages';
import { checkBulls, genBulls, solveBulls, type BullsData } from './bulls';
import { checkClock, genClock, ruleOf, solveClock, type ClockData } from './clock';
import { genChain, run, solveChain, type ChainData } from './chain';
import { checkHashi, genHashi, solveHashi, spansOf, type HashiData } from './hashi';
import { checkHidato, genHidato, solveHidato, type HidatoData } from './hidato';
import type { Kind } from './kind';
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

export const KINDS: Record<string, Kind> = { zebra, hidato, hashi, okno, kazaki, bulls, stopki, kenken, chain, clock, shop, ostatki, zadachka, labirint, strelki, saper, morboy };

export const kindOf = (id: string): Kind => KINDS[id] ?? zebra;
