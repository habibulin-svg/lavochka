/* Кинь-двинь: советские настолки-«комиксы» 1990–1992 (П. Шегерян, В. Горохов) и детская «С утра до вечера».
 * Разметка — data/<поле>.json (tools/hodilki/import.py из materials/nastolki/, поправки сверены по полю),
 * картинки — public/hodilki/<поле>/ (tools/hodilki/tiles.py). Тексты клеток — с поля. */
import type { Board, Cell, ItemId, Sign } from './core';
import zatmir from './data/zatmir.json';
import planeta from './data/planeta.json';
import varvary from './data/varvary.json';
import podveski from './data/podveski.json';
import mepl from './data/mepl.json';
import sutra from './data/sutra.json';

export interface Raw {
  w: number;
  h: number;
  end: number;
  cells: { x: number; y: number; l?: string; s?: string; t?: string; r?: string; off?: number }[];
}

/** Знак клетки из кода разметки. */
export function signOf(code: string | undefined, i: number, label: string | undefined, routeText: string | undefined): Sign | null {
  if (!code) return null;
  if (code === 'skip') return { k: 'skip' };
  if (/^skip\d$/.test(code)) return { k: 'skip', n: +code.slice(4) };
  if (code === 'again') return { k: 'again' };
  if (code === 'start') return { k: 'start' };
  const m = /^(skip\+)?to:(\d+)$/.exec(code);
  if (m) {
    const to = +m[2];
    const good = to > i;
    return { k: 'jump', to, good, text: good ? 'идёт вперёд' : 'возвращается назад', ...(m[1] ? { skip: 1 } : {}) };
  }
  if (code.startsWith('route:')) return { k: 'route', cells: code.slice(6).split(',').map(Number), text: routeText ?? 'идёт в обход' };
  // «Лукоморье»: боны, предметы, развилки и условия
  if (code.startsWith('fork:')) {
    const [by, ...branches] = code.slice(5).split('|');
    return { k: 'fork', byDiff: by.split('').map(Number), branches: branches.map((s) => s.split(',').map(Number)), text: routeText ?? 'развилка' };
  }
  if (code.startsWith('need:')) {
    const p = Object.fromEntries(code.slice(5).split(',').map((kv) => kv.split('=')));
    return {
      k: 'need',
      ...(p.item ? { item: p.item as ItemId } : {}),
      ...(p.coins ? { coins: +p.coins } : {}),
      yes: p.yes === 'win' ? ('win' as const) : +p.yes,
      no: +p.no,
      text: routeText ?? 'проверка',
    };
  }
  if (code.startsWith('coins:')) {
    const [n, skip] = code.slice(6).split('+');
    return { k: 'coins', n: +n, ...(skip ? { skip: +skip } : {}), text: routeText ?? 'берёт боны' };
  }
  if (code.startsWith('coinsD:')) {
    const [d, skip] = code.slice(7).split('+');
    return { k: 'coins', dice: +d, ...(skip ? { skip: +skip } : {}), text: routeText ?? 'берёт боны' };
  }
  if (code.startsWith('lose:')) return { k: 'coins', n: +code.slice(5), loss: true, text: routeText ?? 'отдаёт боны' };
  if (code.startsWith('loseD:')) {
    const [d, skip] = code.slice(6).split('+');
    return { k: 'coins', dice: +d, loss: true, ...(skip ? { skip: +skip } : {}), text: routeText ?? 'отдаёт боны' };
  }
  if (code.startsWith('field:')) {
    const [map, to] = code.slice(6).split(':');
    return { k: 'field', map, to: +to, text: routeText ?? 'переходит на другое поле' };
  }
  if (code.startsWith('extra:')) return { k: 'extra', n: +code.slice(6), text: routeText ?? 'дополнительные ходы' };
  if (code.startsWith('extraD:')) return { k: 'extra', dice: +code.slice(7), text: routeText ?? 'дополнительные ходы' };
  if (code.startsWith('item:')) return { k: 'item', item: code.slice(5) as ItemId, text: routeText ?? 'берёт предмет' };
  if (code.startsWith('pick:')) {
    // «загадка: вопрос|ответ,ответ|клетка,клетка»
    const [question, options, to] = code.slice(5).split('|');
    return { k: 'pick', question, options: options.split(','), to: to.split(',').map(Number), text: routeText ?? 'загадка' };
  }
  console.warn('кинь-двинь: неизвестный знак', code, label);
  return null;
}

export function cellsOf(raw: Raw): Cell[] {
  return raw.cells.map((c, i) => {
    const cell: Cell = { x: c.x, y: c.y, sign: signOf(c.s, i, c.l, c.r) };
    if (c.l) cell.label = c.l;
    if (c.t) cell.text = c.t;
    if (c.off) cell.off = true;
    // подпись перехода — с номером клетки, куда ведёт («идёт вперёд на 22»)
    const g = cell.sign;
    if (g?.k === 'jump') {
      const to = raw.cells[g.to]?.l;
      if (to) g.text += ` на ${to}`;
    }
    return cell;
  });
}

/** Размер пуговицы: доля ширины поля — по типичному шагу между клетками. */
export function tokenOf(raw: Raw): number {
  const d: number[] = [];
  for (let i = 1; i <= raw.end; i++) d.push(Math.hypot(raw.cells[i].x - raw.cells[i - 1].x, raw.cells[i].y - raw.cells[i - 1].y));
  d.sort((a, b) => a - b);
  return (d[Math.floor(d.length / 2)] * 0.62) / raw.w;
}

export const imgOf = (id: string, raw: Raw) => ({ w: raw.w, h: raw.h, dir: `/hodilki/${id}`, src: [raw.w, raw.h] as [number, number], levels: 2 });

const SHEGERYAN = `<p>Бросайте кубик и ведите пуговицу по номерам клеток. Попали на цветную клетку — читайте, что случилось с героями, и делайте, что сказано:
  пропустить ход (или два), перейти на другую клетку вперёд или назад. Знак срабатывает один раз: на клетке, куда перенесло, его уже нет.</p>`;

const BRANCH = `<p><b>Ветки</b> «туда и обратно»: фишка следующими бросками идёт по ветке до конца и возвращается той же дорогой на клетку, откуда свернула
  (лишние очки на обратном пути пропадают), а дальше — по основному пути.</p>`;

export const zatmirBoard: Board = {
  id: 'zatmir',
  title: 'Затерянный мир',
  img: imgOf('zatmir', zatmir as Raw),
  cells: cellsOf(zatmir as Raw),
  end: (zatmir as Raw).end,
  token: tokenOf(zatmir as Raw),
  goal: 'Первым добраться до пещеры — клетки 100.',
  winText: 'первым добрался до пещеры',
  rules: SHEGERYAN,
  credit: 'По мотивам повести А. Конан Дойла. Художник П. Шегерян, «Орбита», 1990.',
  demo: [
    { rig: 3, caption: 'Выпало 4 — встреча с траходонами: Вовка пропустит ход.' },
    { rig: 5, caption: 'Ленка встаёт на 6.' },
  ],
};

export const planetaBoard: Board = {
  id: 'planeta',
  title: 'Неукротимая планета',
  img: imgOf('planeta', planeta as Raw),
  cells: cellsOf(planeta as Raw),
  end: (planeta as Raw).end,
  token: tokenOf(planeta as Raw),
  goal: 'Первым добраться до космического корабля — клетки «Конец» (291).',
  winText: 'первым добрался до корабля',
  rules: SHEGERYAN + BRANCH,
  credit: 'По мотивам романа Г. Гаррисона «Неукротимая планета». Художник П. Шегерян, 1991.',
};

export const varvaryBoard: Board = {
  id: 'varvary',
  title: 'Конные варвары',
  img: imgOf('varvary', varvary as Raw),
  cells: cellsOf(varvary as Raw),
  end: (varvary as Raw).end,
  token: tokenOf(varvary as Raw),
  goal: 'Первым дойти до клетки «Конец» (240). Продолжение «Неукротимой планеты».',
  winText: 'первым дошёл до конца',
  rules: SHEGERYAN + `<p>С клетки 91 — <b>кружной путь через ущелье</b>: по жёлтому кольцу, с него — на 90.</p>`,
  credit: 'По мотивам романа Г. Гаррисона «Конные варвары». Художник П. Шегерян, 1991.',
};

export const podveskiBoard: Board = {
  id: 'podveski',
  title: 'Подвески королевы',
  img: imgOf('podveski', podveski as Raw),
  cells: cellsOf(podveski as Raw),
  end: (podveski as Raw).end,
  token: tokenOf(podveski as Raw),
  goal: 'Вместе с д’Артаньяном съездить из Парижа в Лондон за подвесками и первым вернуться в Париж — клетка 150.',
  winText: 'первым привёз подвески в Париж',
  rules:
    SHEGERYAN +
    BRANCH +
    `<p>Ветки здесь — в Крей (с 8), в Булонь (с 40) и в Корней (с 129). С 110 сильный ветер загоняет корабль <b>в порт Фекан</b>:
      фишка идёт по пунктиру в порт и другой дорогой выходит на основной путь у 116.</p>`,
  credit: 'По мотивам романа А. Дюма «Три мушкетёра». Художник П. Шегерян, 1991.',
};

export const meplBoard: Board = {
  id: 'mepl',
  title: 'Приключения в стране Мепл-Уайта',
  img: imgOf('mepl', mepl as Raw),
  cells: cellsOf(mepl as Raw),
  end: (mepl as Raw).end,
  token: tokenOf(mepl as Raw),
  goal: 'Первым найти выход из пещеры — клетка 110.',
  winText: 'первым нашёл выход из пещеры',
  rules: `<p>В стране Мепл-Уайта правила подсказывают картинки: попали на <b>жёлтую</b> клетку — пропускаете ход, на <b>оранжевую</b> — возвращаетесь
    назад по стрелке, на <b>голубую</b> — уходите вперёд по стрелке.</p>
    <p>С жёлтой клетки 27 путь сворачивает <b>в обход</b> — по жёлтой петле вокруг динозавра, с неё — на 29.</p>`,
  credit: 'По повести А. Конан Дойла «Затерянный мир». Художник В. Горохов, «Панорама», 1992.',
};

export const sutraBoard: Board = {
  id: 'sutra',
  title: 'С утра до вечера',
  img: imgOf('sutra', sutra as Raw),
  cells: cellsOf(sutra as Raw),
  end: (sutra as Raw).end,
  token: tokenOf(sutra as Raw),
  goal: 'Прожить день от утра до вечера и первым прийти на 70: «Пришёл ты первым — молодец, и значит, всей игре конец!»',
  winText: 'пришёл первым',
  rules: `<p>Бросайте кубик и шагайте по кружкам. У многих кружков — стишок: <b>зелёные</b> — хорошие дела, они переносят вперёд по стрелке
    (или дают лишний ход); <b>красные</b> — провинности: назад по стрелке или пропуск хода.</p>`,
  credit: 'Детская настольная игра.',
};

export const NASTOLKI = [zatmirBoard, planetaBoard, varvaryBoard, podveskiBoard, meplBoard, sutraBoard];
