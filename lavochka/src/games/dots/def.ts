/* Точки — описание игры для сборника: поле на выбор, «крест» в начале, 2–4 игрока; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, setup, SIZES, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Красный', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Синий', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Зелёный', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Фиолетовый', color: '#6a2a8a', light: '#9a6ab8', dark: '#3a1250' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'dot':
      return null;
    case 'capture':
      return `${name(ev.seat)} окружает: <b>+${ev.count}</b>`;
    case 'finish':
      return `${name(ev.seat)} предлагает закончить и посчитать.`;
    case 'accept':
      return `${name(ev.seat)}: согласен.`;
    case 'decline':
      return `${name(ev.seat)}: играем дальше.`;
    case 'end':
      return `🏁 ${ev.reason === 'full' ? 'Поле заполнено' : 'Закончили по согласию'}. ${ev.winners.length > 1 ? 'Ничья' : `Победа — <b>${name(ev.winners[0])}</b>`}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const SMALL = SIZES.small.w;
const D = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'dot', p: y * SMALL + x } as Action, caption });

function demoState(cross = false): State {
  return newState(cfgFrom({ size: 'small', cross }), [0, 1]);
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'dots',
  title: 'Точки',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 'small', label: `маленькое — ${SIZES.small.label}` },
        { value: 'medium', label: `тетрадный лист — ${SIZES.medium.label}` },
        { value: 'sport', label: `спортивное — ${SIZES.sport.label}` },
      ],
      default: 'medium',
    },
    { key: 'cross', label: 'Начать с креста', type: 'toggle', default: true, hint: 'Вдвоём: в центре уже стоят по две точки накрест.' },
  ],
  presets: [
    { id: 'notebook', label: 'На листочке', hint: 'Поле 24×20, крест в центре', options: { size: 'medium', cross: true } },
    { id: 'quick', label: 'Быстрая', hint: 'Маленькое поле 16×14', options: { size: 'small', cross: true } },
    { id: 'sport', label: 'Спортивная', hint: 'Большое поле 39×32, как на турнирах', options: { size: 'sport', cross: true } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over') return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.scores[x];
    return { winners: s.winners, text: s.winners.length > 1 ? 'поровну окружённых' : `окружено точек: ${s.scores[s.winners[0]]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  // превью: у каждого по окружению
  showcase: () => {
    let s = demoState(false);
    const moves: [number, number][] = [
      [4, 5], [5, 5], [5, 4], [9, 6], [6, 5], [10, 7], [5, 6], [10, 5], [10, 6], [11, 6],
      [7, 7], [8, 8], [6, 8], [12, 8], [4, 7], [9, 9], [3, 6], [11, 9], [7, 3], [12, 5], [8, 4], [8, 6], [3, 4], [13, 7],
    ];
    for (const [x, y] of moves) {
      const r = apply(s, s.turn, { type: 'dot', p: y * SMALL + x });
      if (r) s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Окружить как можно больше точек соперника своими точками.',
    sections: [
      {
        title: 'Как окружают',
        html: `<p>Играют на тетрадном листе: по очереди ставят точку своего цвета на пересечение линий. Свои точки, стоящие рядом —
          по горизонтали, вертикали или <b>диагонали</b>, — образуют стенку.</p>
          <p>Если стенка замкнулась вокруг точек соперника, они <b>окружены</b>: каждая — очко, а вся площадь внутри — ваша, туда больше не ставят.</p>`,
        demo: {
          seats: demoSeats,
          options: { size: 'small', cross: false },
          setup: () => demoState(),
          steps: [
            D(0, 4, 5, 'Красный ставит точку.'),
            D(1, 5, 5, 'Синий — рядом.'),
            D(0, 5, 4, 'Красный обходит сверху…'),
            D(1, 10, 9),
            D(0, 6, 5, '…справа…'),
            D(1, 10, 10),
            D(0, 5, 6, '…и снизу: синяя точка окружена! +1 Красному.'),
          ],
        },
      },
      {
        title: 'Домик',
        html: `<p>Пустое окружение — «домик» — очков не даёт. Но если соперник поставит точку внутрь, она тут же окажется окружённой.</p>
          <p>Окружённая стенка перестаёт быть стенкой, а если окружить чужое окружение вместе с вашими пленными — они освобождаются.</p>`,
        demo: {
          seats: demoSeats,
          options: { size: 'small', cross: false },
          setup: () => demoState(),
          steps: [
            D(0, 4, 5),
            D(1, 10, 9),
            D(0, 5, 4),
            D(1, 10, 10),
            D(0, 6, 5),
            D(1, 11, 9),
            D(0, 5, 6, 'Красный построил пустой домик.'),
            D(1, 5, 5, 'Синий лезет внутрь — и сразу попадается: +1 Красному.'),
          ],
        },
      },
      {
        title: 'Крест и конец партии',
        html: `<p>Вдвоём обычно начинают с <b>креста</b>: в центре уже стоят по две точки каждого накрест.</p>
          <p>Партия кончается, когда ставить некуда, — или раньше, если все согласны закончить (кнопка «Закончить и посчитать»).
          Побеждает тот, кто окружил больше точек.</p>`,
        demo: {
          seats: demoSeats,
          options: { size: 'small', cross: true },
          setup: () => demoState(true),
          intro: 'Крест в центре поля.',
          steps: [D(0, 6, 7, 'Красный подпирает синюю точку снизу.'), D(1, 5, 7, 'Синий отвечает тем же.')],
        },
      },
    ],
  },
};

