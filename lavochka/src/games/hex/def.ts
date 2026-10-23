/* Гекс — описание игры: ромб 11×11 (9×9, 13×13), правило обмена; советская пластиковая доска; боты; правила с показом. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, BLACK, cfgFrom, makeView, newState, setup, toAct, WHITE, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1a1a1a', light: '#555555', dark: '#000000' },
  { name: 'Белые', color: '#e8e4d8', light: '#ffffff', dark: '#b8b4a8', ink: '#6a665a' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'swap') return `${name(1)} забирают первый ход себе (обмен).`;
  if (ev.type === 'end') return `🏁 Стороны соединены — победа: ${name(ev.winner)}.`;
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция на доске 9×9: списки камней [x, y]. */
function pos(black: [number, number][], white: [number, number][], turn = 0): State {
  const s = newState(cfgFrom({ size: 9, swap: false }));
  for (const [x, y] of black) s.board[y * 9 + x] = BLACK;
  for (const [x, y] of white) s.board[y * 9 + x] = WHITE;
  s.moves = black.length + white.length;
  s.turn = turn;
  return s;
}
const M = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'play', p: y * 9 + x } as Action, caption });

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
  id: 'hex',
  title: 'Гекс',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 11, label: '11×11 — как советская' },
        { value: 9, label: '9×9 — быстрая' },
        { value: 13, label: '13×13 — большая' },
      ],
      default: 11,
    },
    { key: 'swap', label: 'Правило обмена', hint: 'После первого хода белые могут забрать его себе', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'soviet', label: 'Советская 11×11', hint: 'Как в коробке, с правилом обмена', options: { size: 11, swap: true } },
    { id: 'small', label: 'Быстрая 9×9', hint: 'Короткая партия', options: { size: 9, swap: true } },
    { id: 'big', label: 'Большая 13×13', hint: 'Для любителей длинных партий', options: { size: 13, swap: true } },
    { id: 'noswap', label: 'Без обмена', hint: 'Первый ход ничем не ограничен — у чёрных большое преимущество', options: { size: 11, swap: false } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over || s.winner == null) return null;
    return { winners: [s.winner], text: 'стороны соединены' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({ size: 11, swap: false }));
    const rng = fixedRng(5);
    for (let i = 0; i < 34 && !s.over; i++) {
      const a = choose(s, s.turn, 0, rng);
      if (!a) break;
      const r = apply(s, s.turn, a);
      if (!r || r.state.over) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Первым соединить цепочкой своих камней две свои стороны доски: чёрные — верхнюю и нижнюю, белые — левую и правую.',
    sections: [
      {
        title: 'Ход и цель',
        html: `<p>Доска — ромб из шестиугольников, у каждого игрока две противоположные стороны (они отмечены его цветом).
          Ходят по очереди, чёрные первыми: ставят свой камень на любую пустую клетку. Камни не двигают и не снимают.</p>
          <p>Кто первым протянул <b>непрерывную цепочку</b> соседних камней от одной своей стороны до другой — победил.
          Ничьих в гексе не бывает: на заполненной доске чья-то цепочка обязательно сложится.</p>`,
        demo: {
          seats: demoSeats,
          options: { size: 9, swap: false },
          setup: () =>
            pos(
              [
                [4, 0],
                [4, 1],
                [4, 2],
                [3, 3],
                [3, 4],
                [3, 5],
                [2, 6],
                [2, 7],
              ],
              [
                [5, 0],
                [5, 1],
                [4, 3],
                [4, 4],
                [6, 4],
                [3, 6],
                [3, 7],
                [1, 8],
              ],
              0
            ),
          intro: 'Чёрным не хватает одного камня до нижней стороны.',
          steps: [M(0, 2, 8, 'Цепочка от верха до низа — чёрные выиграли.')],
        },
      },
      {
        title: 'Мост',
        html: `<p>Два своих камня через клетку, у которых <b>две общие пустые соседки</b>, — «мост». Разорвать его нельзя:
          займёт соперник одну клетку — вы займёте другую. Мостами цепочку тянут вдвое быстрее, чем камень к камню.</p>`,
        demo: {
          seats: demoSeats,
          options: { size: 9, swap: false },
          setup: () =>
            pos(
              [
                [4, 3],
                [5, 4],
              ],
              [
                [2, 2],
                [6, 6],
              ],
              1
            ),
          intro: 'У чёрных мост: камни связаны через две пустые клетки.',
          steps: [M(1, 4, 4, 'Белые влезли в мост…'), M(0, 5, 3, '…чёрные занимают вторую клетку — камни снова связаны.')],
        },
      },
      {
        title: 'Правило обмена',
        html: `<p>Тот, кто ходит первым, получает большое преимущество. Поэтому после первого хода чёрных белые могут
          <b>забрать этот ход себе</b>: камень становится белым (и поворачивается к белым сторонам), а следующий ход — снова за чёрными.
          Значит, первым ходом лучше поставить камень не в центр, а так, чтобы его не захотелось забирать.</p>`,
        demo: {
          seats: demoSeats,
          options: { size: 9, swap: true },
          intro: 'Игра с правилом обмена.',
          steps: [M(0, 4, 4, 'Чёрные пошли в самый центр — слишком сильно.'), { seat: 1, action: { type: 'swap' } as Action, caption: 'Белые забирают ход себе: камень стал белым.' }],
        },
      },
    ],
  },
};
