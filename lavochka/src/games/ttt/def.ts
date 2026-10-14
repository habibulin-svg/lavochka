/* Крестики-нолики — описание игры для сборника: классика 3×3 и ультимативные на девяти полях, серии партий. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Крестики', color: '#1f3a8f', light: '#5a78c8', dark: '#122450' },
  { name: 'Нолики', color: '#b8281e', light: '#e86a5a', dark: '#7a140e' },
];

const half = (n: number) => (n % 2 ? `${(n - 1) / 2}½` : String(n / 2)).replace(/^0½$/, '½');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'mark':
      return null;
    case 'board':
      return ev.owner === 2 ? `Поле ${ev.b + 1} заполнено вничью.` : `${name(ev.owner)} забирает поле ${ev.b + 1}.`;
    case 'round':
      return ev.result === 2 ? `Партия ${ev.round}: ничья.` : `Партия ${ev.round}: выиграли <b>${name(ev.result)}</b>.`;
    case 'newround':
      return `Партия ${ev.round}: первыми ходят ${name(ev.first)}.`;
    case 'end':
      return `🏁 Счёт ${half(ev.score[0])} : ${half(ev.score[1])}. ${ev.winners.length > 1 ? 'Ничья' : `Победа — <b>${name(ev.winners[0])}</b>`}.`;
  }
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const M = (seat: number, p: number, caption?: string) => ({ seat, action: { type: 'mark', p } as Action, caption });
/** Клетка ультимативного поля: поле b (0…8), клетка c (0…8). */
const U = (b: number, c: number) => b * 9 + c;

/** Позиция ультимативных: у Крестиков левое верхнее и центральное поля, ходят Нолики в правое нижнее — для показа и превью. */
function ultimateMid(): State {
  const s = setup({ mode: 'ultimate', rounds: 1 });
  const X: [number, number[]][] = [[0, [0, 4, 8]], [4, [2, 4, 6]], [6, [0, 4]], [8, [4]], [2, [0]]];
  const O: [number, number[]][] = [[0, [1, 2]], [4, [0, 8]], [6, [2]], [2, [4]], [1, [4]], [3, [4]], [5, [4]]];
  for (const [b, cs] of X) for (const c of cs) s.cells[U(b, c)] = 0;
  for (const [b, cs] of O) for (const c of cs) s.cells[U(b, c)] = 1;
  s.boards[0] = 0;
  s.boards[4] = 0;
  s.turn = 1;
  s.next = 8;
  s.last = U(4, 6);
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'ttt',
  title: 'Крестики-нолики',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Вариант',
      type: 'select',
      choices: [
        { value: 'classic', label: 'классические 3×3' },
        { value: 'ultimate', label: 'ультимативные — девять полей' },
      ],
      default: 'classic',
    },
    {
      key: 'rounds',
      label: 'Партий в серии',
      hint: 'Первый ход переходит по очереди. Победа — очко, ничья — пол-очка.',
      type: 'select',
      choices: [1, 3, 5, 7].map((n) => ({ value: n, label: String(n) })),
      default: 3,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классические', hint: '3×3, серия из трёх партий', options: { mode: 'classic', rounds: 3 } },
    { id: 'ultimate', label: 'Ультимативные', hint: 'Девять полей: ваш ход решает, где ходит соперник', options: { mode: 'ultimate', rounds: 1 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over') return null;
    const [a, b] = s.score;
    const winners = a === b ? [0, 1] : a > b ? [0] : [1];
    const text = s.rounds === 1 ? (a === b ? 'ничья' : `три в ряд у ${winners[0] === 0 ? 'Крестиков' : 'Ноликов'}`) : `счёт ${half(a)} : ${half(b)}`;
    return { winners, text, scores: { 0: a / 2, 1: b / 2 } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: ultimateMid,

  rules: {
    goal: 'Первым поставить три своих знака в ряд — по горизонтали, вертикали или диагонали.',
    sections: [
      {
        title: 'Классические',
        html: `<p>Поле 3×3. Крестики и нолики ставят свои знаки по очереди, первыми ходят крестики.
          Кто первым выстроил три своих знака в ряд — по горизонтали, вертикали или диагонали, — выиграл.
          Заполнили поле, а тройки нет — ничья.</p>
          <p>Если оба не ошибаются, партия всегда кончается вничью, поэтому играют серией: первый ход переходит по очереди,
          за победу — очко, за ничью — пол-очка.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'classic', rounds: 1 },
          steps: [
            M(0, 4, 'Крестики занимают центр — самый сильный первый ход.'),
            M(1, 1, 'Нолики ставят на край — это ошибка.'),
            M(0, 0, 'Крестики грозят диагональю…'),
            M(1, 8, '…нолики закрывают.'),
            M(0, 6, 'Вилка: теперь крестики грозят и столбцом, и диагональю.'),
            M(1, 3, 'Закрыть обе угрозы нельзя.'),
            M(0, 2, 'Три в ряд по диагонали — победа крестиков!'),
          ],
        },
      },
      {
        title: 'Ультимативные: куда отправил',
        html: `<p>Большое поле 3×3, в каждой его клетке — маленькое поле 3×3. Первый ход — в любую клетку любого маленького поля.</p>
          <p>Главное правило: <b>клетка, куда вы поставили знак, отправляет соперника в маленькое поле на том же месте</b>.
          Поставили в правый верхний угол маленького поля — соперник обязан ходить в правое верхнее маленькое поле.
          Доступные поля подсвечены.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'ultimate', rounds: 1 },
          steps: [
            M(0, U(4, 2), 'Крестики ходят в центральное поле, в правый верхний угол…'),
            M(1, U(2, 4), '…и нолики обязаны ходить в правое верхнее поле. Они ставят в центр…'),
            M(0, U(4, 0), '…и отправляют крестиков обратно в центральное поле.'),
            M(1, U(0, 4), 'Крестики сходили в левый верхний угол — ноликам туда же, в левое верхнее поле.'),
          ],
        },
      },
      {
        title: 'Ультимативные: поля и победа',
        html: `<p>Три в ряд в маленьком поле — оно ваше: на нём рисуют большой знак, туда больше не ходят.
          Если отправили в поле, которое уже взято или заполнено, — ходите <b>в любое</b> открытое поле.
          Это подарок сопернику, так что смотрите, куда отправляете.</p>
          <p>Побеждает тот, кто взял <b>три маленьких поля в ряд</b> на большом поле.
          Если все поля решены, а тройки нет, — выигрывает тот, у кого полей больше; поровну — ничья.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'ultimate', rounds: 1 },
          setup: () => ultimateMid(),
          intro: 'Крестики уже взяли левое верхнее и центральное поля.',
          steps: [M(1, U(8, 6), 'Нолики ходят в правое нижнее поле…'), M(0, U(6, 8), '…и крестики забирают левое нижнее поле.')],
        },
      },
    ],
  },
};
