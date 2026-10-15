/* Рэндзю — описание игры: рэндзю с фолами чёрных, гомоку свободное и строгое; 15×15 (гомоку можно 19×19); боты; правила с показом. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, BLACK, cfgFrom, makeView, newState, setup, toAct, WHITE, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1a1a1a', light: '#555555', dark: '#000000' },
  { name: 'Белые', color: '#e8e4d8', light: '#ffffff', dark: '#b8b4a8', ink: '#6a665a' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'end') return ev.winner == null ? 'Доска заполнена — ничья.' : `🏁 Пять в ряд — победа: ${name(ev.winner)}.`;
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция: список камней «x,y» для чёрных и белых (координаты от центра 7,7). */
function pos(black: [number, number][], white: [number, number][], turn = 0, variant = 'renju'): State {
  const s = newState(cfgFrom({ variant }));
  for (const [x, y] of black) s.board[y * 15 + x] = BLACK;
  for (const [x, y] of white) s.board[y * 15 + x] = WHITE;
  s.moves = black.length + white.length;
  s.turn = turn;
  return s;
}
const M = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'play', p: y * 15 + x } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'renju',
  title: 'Рэндзю',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Правила',
      type: 'select',
      choices: [
        { value: 'renju', label: 'рэндзю — фолы у чёрных' },
        { value: 'free', label: 'гомоку свободное — пять и больше' },
        { value: 'exact', label: 'гомоку строгое — ровно пять' },
      ],
      default: 'renju',
    },
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 15, label: '15×15' },
        { value: 19, label: '19×19' },
      ],
      default: 15,
      showIf: (o) => o.variant === 'free' || o.variant === 'exact',
    },
  ],
  presets: [
    { id: 'renju', label: 'Рэндзю', hint: 'Чёрным запрещены 3×3, 4×4 и длинный ряд', options: { variant: 'renju', size: 15 } },
    { id: 'free', label: 'Гомоку', hint: 'Пять и больше в ряд, без запретов', options: { variant: 'free', size: 15 } },
    { id: 'exact', label: 'Строгое гомоку', hint: 'Ровно пять', options: { variant: 'exact', size: 15 } },
    { id: 'big', label: 'Пять в ряд 19×19', hint: 'Как «крестики-нолики на большом поле»', options: { variant: 'free', size: 19 } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: 'пять в ряд' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(
      [
        [7, 7],
        [8, 8],
        [6, 8],
        [9, 9],
        [8, 6],
        [6, 6],
      ],
      [
        [7, 8],
        [8, 7],
        [10, 10],
        [7, 6],
        [9, 7],
      ],
      1
    );
    s.last = 6 * 15 + 6;
    return s;
  },

  rules: {
    goal: 'Первым выстроить пять своих камней в ряд — по горизонтали, вертикали или диагонали.',
    sections: [
      {
        title: 'Пять в ряд',
        html: `<p>Доска 15×15, камни ставят на пересечения по очереди, чёрные — первыми и первый ход в центр. Кто первым выстроил
          <b>пять в ряд</b> — победил. В свободном гомоку подходит и шесть, в строгом — ровно пять.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [5, 7],
                [6, 7],
                [7, 7],
                [8, 7],
              ],
              [
                [5, 8],
                [6, 8],
                [7, 8],
              ],
              0
            ),
          intro: 'У чёрных четыре в ряд.',
          steps: [M(0, 9, 7, 'Пятый камень — победа.')],
        },
      },
      {
        title: 'Фолы чёрных',
        html: `<p>В рэндзю чёрные ходят первыми, и это слишком большое преимущество. Поэтому чёрным <b>запрещено</b>:</p>
          <ul><li><b>3×3</b> — одним ходом сделать сразу две открытые тройки;</li>
          <li><b>4×4</b> — сразу две четвёрки;</li>
          <li><b>длинный ряд</b> — шесть и больше.</li></ul>
          <p>Ход в пятёрку разрешён всегда. Белым можно всё. Запрещённые пункты на вашем ходу отмечены красным крестиком.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [7, 7],
                [8, 7],
                [9, 6],
                [9, 5],
              ],
              [
                [6, 9],
                [11, 11],
                [3, 3],
                [12, 2],
              ],
              0
            ),
          intro: 'Пункт K8 (крестик) дал бы чёрным две открытые тройки сразу — это фол 3×3.',
          steps: [M(0, 7, 4, 'Чёрные ходят в другое место.')],
        },
      },
    ],
  },
};
