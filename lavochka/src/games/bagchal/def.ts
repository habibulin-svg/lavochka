/* Баг-Чал — описание игры: 4 тигра против 20 коз на доске 5×5 с диагоналями; латунная непальская доска или деревянная;
 * вариант «мирная расстановка» (тигры не едят, пока козы не все на доске — домашнее облегчение для коз). */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, GOAT, newState, setup, step, TIGER, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Козы', color: '#d9d2c0', light: '#f4efe2', dark: '#9c9480', ink: '#6a6352' },
  { name: 'Тигры', color: '#c8781e', light: '#e9a04a', dark: '#7a4410' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.eat >= 0) return `🐅 ${name(ev.seat)}: тигр съел козу.`;
  if (ev.type === 'end') {
    if (ev.why === 'long') return '🏁 Двести ходов без исхода — ничья.';
    if (ev.why === 'eaten') return `🏁 Тигры наелись — победа: ${name(ev.winner!)}.`;
    return `🏁 ${ev.winner === 0 ? 'Тигры заперты' : 'Козам некуда ходить'} — победа: ${name(ev.winner!)}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const at = (x: number, y: number) => y * 5 + x;
/** Позиция: козы, тигры, коз в запасе, чей ход. */
function pos(goats: [number, number][], tigers: [number, number][], hand: number, turn: number, calm = false): State {
  const s = newState(cfgFrom({ calm }));
  s.board.fill(0);
  for (const [x, y] of goats) s.board[at(x, y)] = GOAT;
  for (const [x, y] of tigers) s.board[at(x, y)] = TIGER;
  s.hand = hand;
  s.eaten = 20 - hand - goats.length;
  s.turn = turn;
  return s;
}
const P = (x: number, y: number, caption?: string) => ({ seat: 0, action: { type: 'place', to: at(x, y) } as Action, caption });
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({ seat, action: { type: 'move', from: at(x, y), to: at(x2, y2) } as Action, caption });

function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'bagchal',
  title: 'Баг-Чал',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'need',
      label: 'Тиграм для победы съесть',
      type: 'select',
      choices: [
        { value: 5, label: '5 коз' },
        { value: 4, label: '4 козы — легче тиграм' },
        { value: 6, label: '6 коз — легче козам' },
      ],
      default: 5,
    },
    { key: 'calm', label: 'Мирная расстановка', hint: 'Пока козы не все на доске, тигры только ходят и не едят', type: 'toggle', default: false },
    {
      key: 'look',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'brass', label: 'латунная, с литыми фигурками' },
        { value: 'wood', label: 'деревянная, резная' },
      ],
      default: 'brass',
    },
  ],
  presets: [
    { id: 'classic', label: 'Обычный', hint: 'Как в Непале: тигры едят с первого хода, нужно съесть 5 коз', options: { need: 5, calm: false, look: 'brass' } },
    { id: 'calm', label: 'Мирная расстановка', hint: 'Тигры не едят, пока козы не расставлены, — козам легче', options: { need: 5, calm: true, look: 'wood' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores = { 0: 20 - s.eaten, 1: s.eaten };
    if (s.winner == null) return { winners: [], text: 'ничья', scores };
    return { winners: [s.winner], text: s.winner === 1 ? `съедено коз: ${s.eaten}` : 'тигры заперты', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(7);
    for (let i = 0; i < 23 && !s.over; i++) {
      const a = choose(s, s.turn, i % 2 ? 0 : 1, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Тиграм — съесть пять коз. Козам — запереть всех четырёх тигров, чтобы им некуда было ходить.',
    sections: [
      {
        title: 'Доска и расстановка',
        html: `<p>Баг-Чал — «игра в тигров» из Непала. Фигуры стоят на <b>точках</b> доски 5×5 и ходят по линиям; из каждой второй точки
          идут ещё и диагонали. Четыре тигра стоят в углах, у коз 20 фигурок вне доски. Первыми ходят <b>козы</b>.</p>
          <p>Пока не все козы на доске, коза <b>ставится</b> на любую пустую точку. Тигр в это время уже ходит — на соседнюю точку по линии.</p>`,
        demo: { seats: demoSeats, intro: 'Тигры в углах, доска пуста.', steps: [P(2, 0, 'Коза встала на середину края.'), Mv(1, 0, 0, 1, 1, 'Тигр шагнул по диагонали к центру.'), P(2, 2, 'Вторая коза — в центр.')] },
      },
      {
        title: 'Тигр ест козу',
        html: `<p>Тигр ест, <b>перепрыгивая</b> через соседнюю козу по линии на пустую точку сразу за ней — коза уходит с доски.
          Прыгать можно и по диагонали, если там есть линия. Через двух коз подряд или через тигра прыгать нельзя. Есть не обязательно.</p>
          <p>Поэтому козы стоят плотно: коза, за которой точка занята, в безопасности.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 1],
                [1, 2],
                [3, 3],
              ],
              [
                [2, 0],
                [0, 0],
                [4, 0],
                [4, 4],
              ],
              17,
              1
            ),
          intro: 'Под козой в центре верхнего края пусто.',
          steps: [Mv(1, 2, 0, 2, 2, 'Прыжок — коза съедена.'), P(3, 2, 'Козы закрывают тигра с боков…'), Mv(1, 2, 2, 2, 1, 'Тигр отступает.')],
        },
      },
      {
        title: 'Ходы коз и конец партии',
        html: `<p>Когда все 20 коз на доске, козы тоже <b>ходят</b> — на соседнюю пустую точку по линии. Козы не едят.</p>
          <p>Тигры выигрывают, съев <b>пять коз</b>. Козы — когда <b>все тигры заперты</b> и ходить им некуда.
          Козе нельзя ходом повторить позицию, которая уже была в партии, — так козы не могут бесконечно ходить туда-сюда.
          Если и так за 200 ходов исхода нет — ничья.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [1, 0],
                [0, 1],
                [1, 1],
                [2, 0],
                [2, 1],
                [0, 2],
                [2, 2],
                [3, 1],
                [4, 1],
                [3, 3],
                [4, 3],
                [3, 4],
                [2, 4],
                [2, 3],
                [1, 3],
                [1, 4],
                [0, 4],
                [0, 3],
              ],
              [
                [0, 0],
                [4, 0],
                [4, 4],
                [3, 2],
              ],
              0,
              0
            ),
          intro: 'Все козы на доске, тиграм почти некуда ходить.',
          steps: [Mv(0, 2, 2, 1, 2, 'Коза отходит — ловушка?'), Mv(1, 3, 2, 2, 2, 'Тигр выходит в центр.')],
        },
      },
      {
        title: 'Мирная расстановка и другие счета',
        html: `<p>В <b>мирной расстановке</b> — домашнем облегчении для начинающих — тигры не едят, пока козы не все на доске: только ходят.
          Можно договориться и о счёте: тигры выигрывают, съев <b>4</b> козы (тиграм легче) или <b>6</b> (легче козам).</p>`,
      },
    ],
  },
};
