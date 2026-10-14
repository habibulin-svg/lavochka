/**
 * «Корона Эмбера 1994» — описание игры для сборника: настройки, боты, показ правил, превью.
 * Движок обеих частей — engine.ts, данные полей и колоды — data.ts.
 */
import type { BotDef, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { DECK } from './data';
import { apply, botAction, newState, progress, result, START_CELL, type Action, type Event, type State } from './engine';
import { FALL_NEED_DEFAULT, START, STATS } from './rules';

/** Что видит игрок: всё, кроме порядка колоды (в «Короне» нет скрытого — характеристики открыты). */
export type KoronaView = Omit<State, 'deck'> & { deckLeft: number };

const SEAT_LOOK = [
  { name: 'Красный', color: '#c0392b', light: '#f3b7ae', dark: '#7d2016' },
  { name: 'Синий', color: '#2c6fd1', light: '#b3cdf3', dark: '#173f7d' },
  { name: 'Зелёный', color: '#2f9e5f', light: '#b2e3c7', dark: '#175c35' },
  { name: 'Жёлтый', color: '#c9a227', light: '#f0e0a8', dark: '#7d6314', ink: '#8a6d10' },
];

const opt = (o: Options) => ({
  deck: o.deck === 'short' ? 60 : DECK.length,
  need: Number(o.need) || FALL_NEED_DEFAULT,
});

const seat = (n: number, name = `Игрок ${n + 1}`) => ({ seat: n, kind: 'bot' as const, name, level: 1 });

export const def: GameDef<State, Action, Event, KoronaView> = {
  id: 'korona',
  title: 'Корона Эмбера',
  // на 78 клетках вшестером тесно — партия до четырёх путников
  players: { min: 2, max: 4, default: 3 },
  seats: SEAT_LOOK,

  options: [
    {
      key: 'need',
      label: 'Порог Провала',
      hint: 'сколько нужно по каждой характеристике (ПС, ПУ, ПМ, ПО), чтобы уйти через ПРОВАЛ в Королевство Эмбер',
      type: 'select',
      choices: [
        { value: '4', label: '4 — быстрая партия' },
        { value: '6', label: '6 — обычная' },
        { value: '9', label: '9 — долгая' },
        { value: '13', label: '13 — как в оригинале (долго)' },
      ],
      default: String(FALL_NEED_DEFAULT),
    },
    {
      key: 'deck',
      label: 'Карточки приключений',
      type: 'select',
      choices: [
        { value: 'all', label: `вся колода (${DECK.length})` },
        { value: 'short', label: '60 карточек' },
      ],
      default: 'all',
    },
  ],
  presets: [
    { id: 'main', label: 'Полный путь к короне', hint: 'порог Провала 6, вся колода', options: { need: '6', deck: 'all' } },
    { id: 'short', label: 'Короткая партия', hint: 'порог Провала 4, 60 карточек', options: { need: '4', deck: 'short' } },
  ],

  setup: (seats: SeatSpec[], opts: Options, rng: Rng): State =>
    newState(
      seats.map((s) => ({ seat: s.seat, kind: s.kind === 'human' ? ('human' as const) : ('bot' as const), name: s.name, level: s.level })),
      opt(opts),
      rng,
    ),

  toAct: (s) => (s.winner == null ? [s.turn] : []),

  apply: (s, seat, a, rng) => apply(s, seat, a, rng),

  view: (s): KoronaView => {
    const { deck, ...rest } = s;
    return { ...rest, log: s.log.slice(-12), deckLeft: deck.length };
  },

  result: (s) => {
    const r = result(s);
    return r ? { winners: [r.winner], text: r.text, scores: Object.fromEntries(s.seats.map((seat, i) => [seat, r.scores[i]])) } : null;
  },

  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v, seat, level, rng) => botAction({ ...v, deck: [] }, seat, level, rng),
  } as BotDef<KoronaView, Action>,

  describe: (ev, name) => {
    const sg = (d: number) => (d > 0 ? `+${d}` : `−${-d}`);
    switch (ev.type) {
      case 'roll':
        return ev.dice ? `${name(ev.seat)}: лицей, кубики ${ev.dice.join(' и ')}` : `${name(ev.seat)} бросает кубик: ${ev.die}`;
      case 'card':
        return `${name(ev.seat)}: <b>${ev.card.title}</b>${ev.card.lines.length ? ` (${ev.card.lines.join(', ')})` : ''}`;
      case 'zone':
        return ev.text;
      case 'duel':
        return `Поединок: ${name(ev.seat)} ${ev.a.join('+')} против ${name(ev.target)} ${ev.b.join('+')}`;
      case 'skip':
        return `${name(ev.seat)} пропускает ход`;
      case 'over':
        return `${name(ev.winner)} коронован — Владыка Королевства Эмбер!`;
      case 'pj':
        return `${name(ev.seat)}: ПЖ принца ${sg(ev.delta)}`;
      default:
        return null;
    }
  },

  /** Превью: середина партии — трое путников в разных мирах, у одного почти всё набрано. */
  showcase: () => {
    const s = newState([seat(0), seat(1), seat(2)], { need: 6 }, { int: (n: number) => n - 1, next: () => 0.5, getState: () => 0 } as Rng);
    const at = (n: number, cell: number, st: Partial<typeof START>) => {
      s.heroes[n] = { ...s.heroes[n], cell, st: { ...s.heroes[n].st, ...st } };
    };
    at(0, 9, { ПС: 5, ПУ: 6, ПМ: 4, ПО: 5 });
    at(1, 16, { ПС: 6, ПУ: 3, ПМ: 3, ПО: 4 });
    at(2, 5, { ПС: 3, ПУ: 4, ПМ: 6, ПО: 6 });
    s.turn = 0;
    return s;
  },

  rules: {
    goal:
      'Пройти Мир Приключений, набрать силы, ума, магии и опыта, уйти через ПРОВАЛ в Королевство Эмбер, ' +
      'пройти лабиринт и подняться по дворцовым покоям в тронный зал — первым стать Владыкой Королевства Эмбер.',
    sections: [
      {
        title: 'Ход по Миру Приключений',
        html:
          '<p>Бросаешь кубик и идёшь ровно на столько клеток — куда хочешь, но только через проходы: между клетками одного ' +
          'мира — тонкая линия, а через толстую рамку, змею или полосу можно перейти только там, где нарисована серая стрелка «⇄». ' +
          'Назад на только что пройденную клетку не шагают.</p>' +
          '<p>Жёлтые кружки показывают, куда можно прийти; наведи на кружок — увидишь маршрут. На обменных пунктах, в ЛАЗАРЕТЕ, ' +
          'ЗАГОТКОНТОРЕ и на ПРОВАЛАХ можно «остановиться проходом», не дойдя все шаги.</p>' +
          `<p>У путника четыре характеристики — ${STATS.join(', ')} (сила, ум, магия, опыт), по ${START['ПС']} на старте, ` +
          'жизни ПЖ (до 4) и 20 талеров.</p>',
        demo: {
          seats: [seat(0, 'Красный'), seat(1, 'Синий')],
          intro: 'Красный стоит на Золотой шахте. Бросок — и он идёт по проходам Мира Золота.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: [2], caption: 'Выпало 3: три клетки по проходам.' },
            { seat: 0, action: { type: 'go', path: [73, 74, 70] }, caption: 'Через Чёрную кассу мафии и Детективное бюро — в Аэропорт: там карточка приключений.' },
            { seat: 0, action: { type: 'ok' }, caption: 'Прочитал — ход переходит к Синему.' },
          ],
        },
      },
      {
        title: 'Клетки и карточки',
        html:
          '<p>На большинстве клеток берут <b>карточку приключений</b>: в этой версии работает то, что в ней сказано про характеристики, ' +
          'ПЖ и талеры («возьми 2 ПУ», «теряешь 1 ПС»).</p>' +
          '<p><b>ЛИЦЕЙ</b> — дважды бросаешь кубик и учишься по таблице с поля (от розог до золотой совы). <b>ОБМЕННЫЙ ПУНКТ</b> — ' +
          'купить характеристику за 5 талеров или обменять 2 одной на 1 другой. <b>ЛАЗАРЕТ</b> лечит до 4 ПЖ по 2 талера. ' +
          '<b>Храм Бааля</b> и <b>Перевал</b> затягивают: бродишь по кругу из восьми секторов, пока не выпадет сектор 8 — выход.</p>' +
          '<p>Кончились ПЖ — приходишь в себя в лазарете.</p>',
        demo: {
          seats: [seat(0, 'Красный'), seat(1, 'Синий')],
          setup: (d: GameDef<State, Action>, rng: Rng) => {
            const s = d.setup([seat(0, 'Красный'), seat(1, 'Синий')], { need: '6', deck: 'all' }, rng);
            s.heroes[0] = { ...s.heroes[0], cell: 10 };
            return s;
          },
          intro: 'Красный на Броде, в двух шагах от Лицея.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: [1], caption: 'Выпало 2.' },
            { seat: 0, action: { type: 'go', path: [9, 8] }, rig: [4, 5], caption: 'Лицей: кубики 5 и 6 — «преддипломная практика», по 2 ПС, ПУ и ПМ.' },
            { seat: 0, action: { type: 'ok' } },
          ],
        },
      },
      {
        title: 'ПРОВАЛ и дорога в Эмбер',
        html:
          '<p>Три ПРОВАЛА (Мира Магии, Ума и Силы) пускают в Королевство Эмбер, если по <b>всем четырём</b> характеристикам набран ' +
          'порог (в оригинале 13, в настройках можно взять меньше) и котомка пуста. Не пустил — теряешь 1 характеристику.</p>' +
          '<p>Выйдя из провала, откладываешь все ПО и идёшь по дороге второго поля <b>только по стрелкам</b>. На развилке с кружком ' +
          'сворачиваешь по чётному (2, 4, 6) или нечётному (1, 3, 5) броску. Клетки «+1 ПС», «−2 ПУ» меняют характеристики; ' +
          'если не хватает — теряешь 1 ПЖ.</p>',
        demo: {
          seats: [seat(0, 'Красный'), seat(1, 'Синий')],
          setup: (d: GameDef<State, Action>, rng: Rng) => {
            const s = d.setup([seat(0, 'Красный'), seat(1, 'Синий')], { need: '6', deck: 'all' }, rng);
            s.heroes[0] = { ...s.heroes[0], cell: 12, st: { ПС: 6, ПУ: 7, ПМ: 6, ПО: 6 } };
            s.heroes[1] = { ...s.heroes[1], cell: 64 };
            return s;
          },
          intro: 'У Красного по 6 и больше по всем характеристикам, рядом ПРОВАЛ МИРА УМА.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: [0], caption: 'Выпало 1 — шаг на Провал.' },
            { seat: 0, action: { type: 'go', path: [22] }, caption: 'Провал пропускает в Королевство Эмбер.' },
            { seat: 0, action: { type: 'ok' } },
            { seat: 1, action: { type: 'roll' }, rig: [0] },
            { seat: 1, action: { type: 'go', path: [65] }, rig: [0] },
            { seat: 1, action: { type: 'ok' } },
            { seat: 0, action: { type: 'roll' }, rig: [5], caption: 'Второе поле: 6 клеток по стрелкам к столице.' },
          ],
        },
      },
      {
        title: 'Столица, лабиринт и корона',
        html:
          '<p>В <b>столице</b> становишься Принцем: ПЖ принца — твои жизни плюс 4. Перед лабиринтом можно купить 1 ПЖ за 20 талеров ' +
          'или обменять 5 ПС, ПУ или ПМ на 1 ПЖ. В <b>лабиринт</b> берёшь только ПЖ.</p>' +
          '<p>Три кольца ворот: на бросок 4–6 идёшь налево и берёшь ПЖ (1, 2, 3 — от внешнего кольца к центру), на 1–3 — направо ' +
          'и отдаёшь (3, 4, 5). ПЖ кончились — новый принц начинает из столицы. Из центра попадаешь во <b>дворец</b>.</p>' +
          '<p>Из дворца поднимаешься по <b>дворцовым покоям</b> — по клетке за ход (+1, +1, +2, +3 ПЖ) — и входишь в тронный зал: ' +
          'коронация и победа. Во дворце можно вызвать на <b>поединок</b> принца, который уже в покоях: каждый дважды бросает кубик, ' +
          'у кого меньше — теряет 1 ПЖ; бьются до последнего, проигравший возвращается в столицу.</p>',
        demo: {
          seats: [seat(0, 'Красный'), seat(1, 'Синий')],
          setup: (d: GameDef<State, Action>, rng: Rng) => {
            const s = d.setup([seat(0, 'Красный'), seat(1, 'Синий')], { need: '6', deck: 'all' }, rng);
            s.heroes[0] = { ...s.heroes[0], zone: 'capital', prince: true, pj: 8, thalers: 25 };
            s.heroes[1] = { ...s.heroes[1], zone: 'chambers', prince: true, pj: 4, room: 1 };
            return s;
          },
          intro: 'Красный — принц в столице, Синий уже поднимается по покоям.',
          steps: [
            { seat: 0, action: { type: 'buyPj' }, caption: 'Покупка 1 ПЖ за 20 талеров.' },
            { seat: 0, action: { type: 'labyrinth' }, caption: 'В лабиринт — только с ПЖ.' },
            { seat: 1, action: { type: 'climb' }, caption: 'Синий поднимается: +2 ПЖ.' },
            { seat: 0, action: { type: 'roll' }, rig: [4], caption: 'Внешнее кольцо: 5 — налево, +1 ПЖ.' },
            { seat: 1, action: { type: 'climb' }, caption: 'Синий на верхней клетке покоев: +3 ПЖ.' },
            { seat: 0, action: { type: 'roll' }, rig: [1], caption: 'Среднее кольцо: 2 — направо, −4 ПЖ.' },
            { seat: 1, action: { type: 'climb' }, caption: 'Синий входит в тронный зал — коронация!' },
          ],
        },
      },
    ],
  },
};

/** Для отладки и тестов: насколько продвинулся каждый. */
export const progressOf = (s: State) => s.seats.map((seat) => progress(s.heroes[seat], s.need));
export { START_CELL };
export default def;
