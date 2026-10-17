/**
 * «Магия» — описание игры для сборника: настройки, пресеты, боты, показ правил, превью.
 * Поле и знаки — data.ts, движок — engine.ts.
 */
import type { BotDef, DemoStep, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { APEX, CELLS, HEROES, MAIN, POWERS, SPIRITS, START, cellByName, type Cell, type Spirit } from './data';
import { apply, botAction, describe, newState, routes, score, type Action, type Event, type Opts, type State } from './engine';

export type MagiyaView = State;

const SEAT_LOOK = [
  { name: 'Рыцарь', color: '#2c6fd1', light: '#b3cdf3', dark: '#173f7d' },
  { name: 'Принцесса', color: '#c0392b', light: '#f3b7ae', dark: '#7d2016' },
  { name: 'Монах', color: '#5b4636', light: '#d9c8b8', dark: '#2e231a' },
  { name: 'Охотник', color: '#2f9e5f', light: '#b2e3c7', dark: '#175c35' },
  { name: 'Разбойник', color: '#c9a227', light: '#f0e0a8', dark: '#7d6314', ink: '#8a6d10' },
  { name: 'Мастер', color: '#8e44ad', light: '#dcc0ea', dark: '#4f2063' },
];

export function optsOf(o: Options): Opts {
  return {
    need: Number(o.need ?? 8) || 8,
    needPower: Number(o.needPower ?? 4) || 4,
    arrows: o.arrows === 'stop' ? 'stop' : 'pass',
    apex: o.apex === 'stop' ? 'stop' : 'exact',
    goal: o.goal === 'all' ? 'all' : 'first',
    start: Number(o.start ?? 0) || 0,
    rounds: Number(o.rounds ?? 0) || 0,
  };
}

const seat = (n: number, name = SEAT_LOOK[n].name): SeatSpec => ({ seat: n, kind: 'bot', name, level: 2 });
const TWO = [seat(0), seat(1)];

// ---------- показ правил: шаги строятся прогоном движка, чтобы быть заведомо допустимыми ----------

type Target = string | ((c: Cell) => boolean);
type Line =
  | { seat: number; roll: number; to?: Target; caption?: string; then?: string }
  | { seat: number; act: Action; caption?: string };

const rigged = (vals: number[]): Rng => {
  const q = [...vals];
  return { next: () => 0.5, int: (n: number) => Math.min(n - 1, q.shift() ?? 0), getState: () => 0 };
};

function demoState(opts: Partial<Opts>, put: (s: State) => void): (d: GameDef, rng: Rng) => State {
  return () => {
    const s = newState(TWO, { ...optsOf({}), ...opts });
    put(s);
    return s;
  };
}

function steps(setup: () => State, script: Line[]): DemoStep<Action>[] {
  let s = setup();
  const out: DemoStep<Action>[] = [];
  const run = (st: number, a: Action, rig?: number[]) => {
    const r = apply(s, st, a, rigged(rig ?? []));
    if (!r) throw new Error('показ «Магии»: ход отклонён ' + JSON.stringify(a));
    s = r.state;
  };
  for (const l of script) {
    if ('act' in l) {
      out.push({ seat: l.seat, action: l.act, caption: l.caption });
      run(l.seat, l.act);
      continue;
    }
    out.push({ seat: l.seat, action: { type: 'roll' }, rig: [l.roll - 1], caption: l.caption });
    const die = l.roll;
    run(l.seat, { type: 'roll' }, [l.roll - 1]);
    if ((s.phase as string) === 'move') {
      const ends = [...routes(s, l.seat, die).keys()];
      const want = l.to == null ? ends : ends.filter((c) => (typeof l.to === 'string' ? c === cellByName(l.to) : (l.to as (c: Cell) => boolean)(CELLS[c])));
      if (!want.length) throw new Error('показ «Магии»: нет пути к цели');
      const go: Action = { type: 'go', to: want[0] };
      out.push({ seat: l.seat, action: go, caption: l.then });
      run(l.seat, go);
    }
  }
  return out;
}

/** Клетка основного пути за n шагов до именованной. */
const before = (name: string, n: number) => MAIN[(MAIN.indexOf(cellByName(name)) - n + MAIN.length) % MAIN.length];
const at = (s: State, seatNo: number, cell: number, more: Partial<State['heroes'][number]> = {}) => {
  s.heroes[seatNo] = { ...s.heroes[seatNo], cell, prev: -1, ...more };
};
const ALL_SPIRITS = SPIRITS.map((x) => x.id);
const ALL_POWERS = POWERS.map((x) => x.id);

const demos = {
  maze: (() => {
    const setup = demoState({}, () => {});
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 5, to: (c) => c.sign.k === 'gain', caption: 'Выпало 5. Из «Начала пути» — в лабиринт.', then: 'Стенки обходим, назад (налево) не ходим. Остановился на треугольнике — 3 талисмана из банка.' },
      { seat: 1, roll: 3, caption: 'Принцесса тоже входит в лабиринт.' },
    ]) };
  })(),
  signs: (() => {
    const setup = demoState({}, (s) => {
      at(s, 0, before('envA', 3), { tri: 1 });
      at(s, 1, before('sevenA', 4), { tri: 4 });
    });
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 3, to: 'envA', caption: 'Конверт с цифрой 3: отдать 3 треугольника. У Рыцаря один — он пропустит 3 хода.' },
      { seat: 1, roll: 4, to: 'sevenA', caption: 'Треугольник с цифрой 7 — Принцесса берёт 7 из банка.' },
      { seat: 1, roll: 2, caption: 'Рыцарь пропускает ход — снова бросает Принцесса.' },
    ]) };
  })(),
  spirits: (() => {
    const setup = demoState({}, (s) => {
      at(s, 0, before('tA', 2), { tri: 2 });
      at(s, 1, before('koldun3', 3), { tri: 6 });
    });
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 2, to: 'tA', caption: 'Буква «Т» — талисман защиты на выбор.' },
      { seat: 0, act: { type: 'take', spirit: 'koldun' }, caption: 'Рыцарь берёт талисман против колдуна.' },
      { seat: 1, roll: 3, to: 'koldun3', caption: 'Принцесса во владениях колдуна: чёрный квадрат 3 — отдать 3 треугольника.' },
      { seat: 0, roll: 2, to: 'koldun3', caption: 'Рыцарь защищён — колдун ему не страшен, треугольники целы.' },
    ]) };
  })(),
  pocket: (() => {
    const setup = demoState({ arrows: 'stop' }, (s) => {
      at(s, 0, cellByName('gAnkh'), { tri: 3 });
      at(s, 1, START);
    });
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 3, to: (c) => c.sign.k === 'power', caption: 'Рыцарь начал ход на зелёной стрелке — можно свернуть в карман.', then: 'Красная стрелка с белым треугольником — талисман власти «Анх».' },
    ]) };
  })(),
  bsq: (() => {
    const setup = demoState({}, (s) => {
      at(s, 0, before('vampire1', 2), { tri: 0, portrait: false });
      at(s, 1, START);
    });
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 2, to: 'vampire1', caption: 'Владения вампира, а отдать нечего — Рыцарь попадает в «чёрный квадрат».' },
      { seat: 1, roll: 2 },
      { seat: 0, roll: 5, caption: 'В «чёрном квадрате» идут против часовой стрелки.' },
      { seat: 1, roll: 1 },
      { seat: 0, roll: 4, caption: 'Остановился на пространственном туннеле — выход!' },
      { seat: 0, act: { type: 'tunnel', to: CELLS.filter((c) => c.sign.k === 'web')[3].id }, caption: 'Туннель переносит на любую клетку с таким же рисунком.' },
    ]) };
  })(),
  line: (() => {
    const setup = demoState({}, (s) => {
      at(s, 0, before('Lb', 2), { tri: 4 });
      at(s, 1, before('princess', 2), { tri: 4 });
    });
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 2, to: 'Lb', caption: 'Синий кружок: фишку можно поставить на любую клетку голубой линии.' },
      { seat: 0, act: { type: 'line', to: cellByName('tB') }, caption: 'Рыцарь переходит на «Т» и берёт талисман защиты.' },
      { seat: 0, act: { type: 'take', spirit: 'witch' } },
      { seat: 1, roll: 2, to: 'princess', caption: 'Принцесса встала на свой портрет — ещё бросок.' },
      { seat: 1, roll: 3 },
    ]) };
  })(),
  pyramid: (() => {
    const setup = demoState({}, (s) => {
      at(s, 0, cellByName('blue'), { tri: 20, prot: [...ALL_SPIRITS] as Spirit[], power: [...ALL_POWERS] });
      at(s, 1, START);
    });
    return { setup, steps: steps(() => setup(null as never, null as never), [
      { seat: 0, roll: 4, to: (c) => c.id === APEX, caption: 'Все талисманы собраны. От голубой стрелки — к вершине пирамиды.', then: 'Красный ромб: талисман «Маг» — Рыцарь посвящён в Магию!' },
    ]) };
  })(),
};

export const def: GameDef<State, Action, Event, MagiyaView> = {
  id: 'magiya',
  title: 'Магия',
  players: { min: 2, max: 6, default: 3 },
  seats: SEAT_LOOK,

  options: [
    {
      key: 'need', label: 'Талисманы защиты', hint: 'сколько разных талисманов защиты от злых духов нужно для посвящения', type: 'select',
      choices: [{ value: '8', label: 'от всех восьми духов (по правилам)' }, { value: '6', label: 'шесть' }, { value: '4', label: 'четыре' }],
      default: '8',
    },
    {
      key: 'needPower', label: 'Талисманы власти', type: 'select',
      choices: [{ value: '4', label: 'все четыре (по правилам)' }, { value: '2', label: 'два' }],
      default: '4',
    },
    {
      key: 'arrows', label: 'Зелёные и голубая стрелки', type: 'select',
      hint: 'по правилам свернуть в карман или на другую линию можно, только начав ход на стрелке',
      choices: [{ value: 'stop', label: 'только с остановки (по правилам)' }, { value: 'pass', label: 'можно свернуть и проходом' }],
      default: 'pass',
    },
    {
      key: 'apex', label: 'Вершина пирамиды', type: 'select',
      choices: [{ value: 'exact', label: 'только точным броском (по правилам)' }, { value: 'stop', label: 'собравшего всё останавливает' }],
      default: 'exact',
    },
    {
      key: 'goal', label: 'Конец партии', type: 'select',
      choices: [{ value: 'first', label: 'первый посвящённый побеждает' }, { value: 'all', label: 'пока не посвятятся все' }],
      default: 'first',
    },
    {
      key: 'start', label: 'Треугольники на старте', type: 'select',
      choices: [{ value: '0', label: 'нет (по правилам)' }, { value: '5', label: '5' }, { value: '10', label: '10' }],
      default: '0',
    },
    {
      key: 'rounds', label: 'Предел кругов', hint: 'по пределу побеждает собравший больше талисманов', type: 'select',
      choices: [{ value: '0', label: 'без предела' }, { value: '60', label: '60 кругов' }, { value: '120', label: '120 кругов' }],
      default: '0',
    },
  ],
  presets: [
    { id: 'normal', label: 'Обычная', hint: 'все талисманы; в карманы можно свернуть проходом', options: { need: '8', needPower: '4', arrows: 'pass', apex: 'exact', goal: 'first', start: '0', rounds: '0' } },
    { id: 'rules', label: 'По правилам', hint: 'всё как в оригинале — очень долгая партия', options: { need: '8', needPower: '4', arrows: 'stop', apex: 'exact', goal: 'first', start: '0', rounds: '0' } },
    { id: 'short', label: 'Короткая', hint: '4 талисмана защиты и 2 власти, вершина останавливает', options: { need: '4', needPower: '2', arrows: 'pass', apex: 'stop', goal: 'first', start: '5', rounds: '0' } },
    { id: 'all', label: 'Пока все не станут Магами', hint: 'играют до посвящения всех', options: { need: '8', needPower: '4', arrows: 'pass', apex: 'exact', goal: 'all', start: '0', rounds: '0' } },
  ],

  setup: (seats: SeatSpec[], opts: Options): State => newState(seats.map((s) => ({ seat: s.seat, name: s.name })), optsOf(opts)),

  toAct: (s) => (s.over ? [] : [s.turn]),
  apply: (s, seatNo, a, rng) => apply(s, seatNo, a, rng),
  view: (s) => s,

  result: (s) => {
    if (!s.over) return null;
    return { winners: s.over.winners, text: s.over.text, scores: Object.fromEntries(s.seats.map((x) => [x, Math.round(score(s.heroes[x]))])) };
  },

  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v, seatNo, level, rng) => botAction(v, seatNo, level, rng),
  } as BotDef<MagiyaView, Action>,

  describe: (ev, name) => describe(ev, name),

  /** Превью: середина партии — четверо героев по разным линиям, у кого-то уже талисманы. */
  showcase: () => {
    const s = newState([0, 1, 2, 3].map((n) => ({ seat: n, name: SEAT_LOOK[n].name })), optsOf({}));
    at(s, 0, cellByName('gCandle'), { tri: 17, prot: ['koldun', 'ghost', 'witch'], power: ['ankh'] });
    at(s, 1, cellByName('shortIn'), { tri: 9, prot: ['dragon', 'leshy'], power: ['flame', 'candle'] });
    at(s, 2, cellByName('outCircles'), { tri: 24, prot: ['vampire'], power: [] });
    at(s, 3, cellByName('tB'), { tri: 6, prot: ['night', 'death', 'witch', 'ghost'], power: ['circles', 'ankh', 'candle'] });
    s.turn = 0;
    return s;
  },

  rules: {
    goal:
      'Пройти лабиринт и «основной путь», собрать талисманы защиты от всех злых духов и все четыре талисмана власти, ' +
      'встать на красный ромб на вершине пирамиды и получить талисман «Маг» — посвящение в Магию.',
    sections: [
      {
        title: 'Начало пути и лабиринт',
        html:
          '<p>Каждый выбирает героя: рыцарь, принцесса, монах, охотник, разбойник или мастер. Все начинают с клетки «Начало пути». ' +
          'Бросаешь кубик и идёшь ровно на столько клеток; цифры и знаки действуют, только если фишка <b>остановилась</b> на клетке. ' +
          'Ходить можно только вперёд.</p>' +
          '<p>Сначала — <b>лабиринт</b>: обходишь стенки, назад не ходишь (налево — никогда). Остановился на треугольнике — получаешь ' +
          'столько красных талисманов-треугольников из банка. Набирай побольше: ими откупаются от тёмных сил.</p>',
        demo: { seats: TWO, setup: demos.maze.setup, intro: 'Рыцарь и Принцесса у «Начала пути».', steps: demos.maze.steps },
      },
      {
        title: 'Знаки основного пути',
        html:
          '<p>Из лабиринта выходишь на <b>основной путь</b> — замкнутую зигзагообразную линию. Знаки на клетках:</p>' +
          '<ul><li><b>треугольник с цифрой</b> — получить столько треугольников;</li>' +
          '<li><b>перечёркнутый треугольник</b> — потерять все;</li>' +
          '<li><b>конверт с цифрой</b> — отдать столько, а если нет — пропустить столько ходов;</li>' +
          '<li><b>чёрный квадрат 8 или 10</b> (вне владений духов) — отдать столько, а не хватает — в «чёрный квадрат»;</li>' +
          '<li><b>портрет героя</b> — хозяину портрета ещё один бросок.</li></ul>',
        demo: { seats: TWO, setup: demos.signs.setup, intro: 'У Рыцаря 1 треугольник, у Принцессы 4.', steps: demos.signs.steps },
      },
      {
        title: 'Злые духи и талисманы защиты',
        html:
          '<p>Чёрные квадраты с цифрами 1, 2, 3 — владения восьми злых духов: призрака, колдуна, демона смерти, ведьмы, вампира, ' +
          'демона ночи, дракона и лешего. Встал — отдай столько треугольников; нет такого количества — в «чёрный квадрат».</p>' +
          '<p>На клетке с буквой <b>«Т»</b> берёшь на выбор талисман защиты от одного духа — во владениях этого духа больше ничего ' +
          'не отдаёшь. <b>Конверт с черепом</b> отбирает один талисман защиты на выбор, а если их нет — в «чёрный квадрат».</p>',
        demo: { seats: TWO, setup: demos.spirits.setup, intro: 'Рыцарь в двух шагах от «Т», Принцесса подходит к владениям колдуна.', steps: demos.spirits.steps },
      },
      {
        title: 'Карманы и талисманы власти',
        html:
          '<p>У основного пути четыре <b>кармана</b>, в каждом — талисман власти: анх, три круга, светильник и пламя. ' +
          'Свернуть в карман или перейти на другую линию можно с <b>зелёной стрелки</b>: по правилам — только начав ход на ней ' +
          '(в настройках можно разрешить сворачивать и проходом). Остановился на красной стрелке с белым треугольником — ' +
          'получаешь талисман власти этого кармана.</p>' +
          '<p>Собрав все четыре талисмана власти, получаешь власть над духами, от которых защищён: в их владениях не отдаёшь, ' +
          'а <b>получаешь</b> указанное число треугольников.</p>',
        demo: { seats: TWO, options: { arrows: 'stop' }, setup: demos.pocket.setup, intro: 'Рыцарь стоит на зелёной стрелке у кармана с анхом.', steps: demos.pocket.steps },
      },
      {
        title: '«Чёрный квадрат» и туннели',
        html:
          '<p>Попав в <b>«чёрный квадрат»</b>, каждый ход идёшь по нему против часовой стрелки, пока не остановишься на ' +
          '<b>пространственном туннеле</b>; оттуда — на любую клетку поля с таким же рисунком.</p>' +
          '<p>Туннели есть и на основном пути: остановился — можешь уйти на любой другой. <b>Талисман-портрет</b> своего героя ' +
          'можно использовать один раз за игру: он уберегает от «чёрного квадрата» или от потери талисмана.</p>',
        demo: { seats: TWO, setup: demos.bsq.setup, intro: 'У Рыцаря нет треугольников, а портрет уже использован.', steps: demos.bsq.steps },
      },
      {
        title: 'Голубая линия',
        html:
          '<p><b>Синий кружок с линией</b>: остановившись на нём, можешь поставить фишку на любую клетку вдоль голубой линии — ' +
          'и знак той клетки сработает. Линий две: в ряду с владениями ведьмы и у дракона.</p>',
        demo: { seats: TWO, setup: demos.line.setup, intro: 'Рыцарь подходит к синему кружку, Принцесса — к своему портрету.', steps: demos.line.steps },
      },
      {
        title: 'Пирамида и посвящение',
        html:
          '<p>Собрав талисманы защиты от всех злых духов и все талисманы власти, иди к <b>голубой стрелке</b> — только от неё есть ' +
          'путь к вершине пирамиды. Встал на <b>красный ромб</b> — получаешь талисман «Маг»: посвящение в Магию и победа. ' +
          'Без всех талисманов ромб ничего не даёт, путь продолжается вниз по пирамиде.</p>' +
          '<p>Можно играть, пока в Магию не посвятятся все (настройка «Конец партии»).</p>',
        demo: { seats: TWO, setup: demos.pyramid.setup, intro: 'У Рыцаря все талисманы, он на голубой стрелке.', steps: demos.pyramid.steps },
      },
    ],
  },
};

export { HEROES };
export default def;
