/* Абалон — описание игры для сборника: вдвоём, три расстановки (стандартная, бельгийская и немецкая ромашки), до 6 или 4. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { at, cfgFrom, CELLS, newState, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#26262c', light: '#6a6a72', dark: '#050506' },
  { name: 'Белые', color: '#d8d4ca', light: '#ffffff', dark: '#8a8476', ink: '#5a5446' },
];

const DIR_RU = ['вправо', 'вниз-вправо', 'вниз-влево', 'влево', 'вверх-влево', 'вверх-вправо'];
const LET = 'IHGFEDCBA';
/** Обозначение лунки: ряд буквой (A — нижний), номер по диагонали, как на коробке. */
const cellName = (c: number) => `${LET[CELLS[c].row]}${CELLS[c].q + 5}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move') {
    const what = ev.cells.length === 1 ? 'шар' : `${ev.cells.length} шара`;
    const push = ev.pushed.length ? (ev.out ? ` — <b>вытолкнул шар!</b>` : ` — толкает ${ev.pushed.length === 1 ? 'чужой шар' : 'два чужих'}`) : '';
    return `${name(ev.seat)}: ${what} ${ev.cells.map(cellName).join('-')} ${DIR_RU[ev.dir]}${push}`;
  }
  if (ev.type === 'end') return ev.winner == null ? '🏁 Ничья.' : `🏁 Победа: ${name(ev.winner)} (${ev.lost[1 - ev.winner]} вытолкнуто).`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция: списки шаров в осевых координатах (q, r). */
function pos(black: [number, number][], white: [number, number][], extra: Partial<State> = {}, opts: Options = {}): State {
  const s = newState(cfgFrom(opts));
  s.board.fill(-1);
  for (const [q, r] of black) s.board[at(q, r)] = 0;
  for (const [q, r] of white) s.board[at(q, r)] = 1;
  return Object.assign(s, extra);
}
const mv = (cells: [number, number][], dir: number): Action => ({ type: 'move', cells: cells.map(([q, r]) => at(q, r)), dir });
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'abalone',
  title: 'Абалон',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'layout',
      label: 'Расстановка',
      type: 'select',
      choices: [
        { value: 'standard', label: 'стандартная — стенка на стенку' },
        { value: 'belgian', label: 'бельгийская ромашка' },
        { value: 'german', label: 'немецкая ромашка' },
      ],
      default: 'standard',
    },
    {
      key: 'goal',
      label: 'До скольких',
      type: 'select',
      choices: [
        { value: 6, label: 'вытолкнуть 6' },
        { value: 4, label: 'вытолкнуть 4 — быстро' },
      ],
      default: 6,
    },
    {
      key: 'skin',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'classic', label: 'чёрный пластик' },
        { value: 'wood', label: 'тёмное дерево' },
      ],
      default: 'classic',
    },
  ],
  presets: [
    { id: 'standard', label: 'Стандартная', hint: 'Шары стенкой у своего края — как в коробке', options: { layout: 'standard', goal: 6 } },
    { id: 'belgian', label: 'Бельгийская ромашка', hint: 'Турнирная: по две «ромашки» из семи шаров, сразу в бой', options: { layout: 'belgian', goal: 6 } },
    { id: 'german', label: 'Немецкая ромашка', hint: 'Ромашки ближе к центру', options: { layout: 'german', goal: 6 } },
    { id: 'quick', label: 'Быстрая', hint: 'Бельгийская ромашка до четырёх вытолкнутых', options: { layout: 'belgian', goal: 4 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, _seat, a) => step(s, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores = { 0: s.lost[1], 1: s.lost[0] };
    if (s.winner == null) return { winners: [], text: `ничья, ${s.lost[1]} : ${s.lost[0]}`, scores };
    return { winners: [s.winner], text: `вытолкнуто ${s.lost[1 - s.winner]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = setup({ layout: 'belgian' });
    s.board.fill(-1);
    const B: [number, number][] = [[0, 0], [1, 0], [-1, 1], [0, 1], [2, -1], [1, -1], [-2, 2], [-1, 2], [0, 2], [3, -2], [-3, 3], [-2, 3]];
    const W: [number, number][] = [[2, 0], [3, 0], [1, 1], [2, 1], [-1, 0], [-2, 1], [0, -1], [1, -2], [-1, -1], [4, -1], [2, -3]];
    for (const [q, r] of B) s.board[at(q, r)] = 0;
    for (const [q, r] of W) s.board[at(q, r)] = 1;
    s.lost = [2, 3];
    s.ply = 41;
    return s;
  },

  rules: {
    goal: 'Вытолкнуть за край доски <b>шесть</b> шаров соперника.',
    sections: [
      {
        title: 'Доска и ход',
        html: `<p>Шестиугольная доска на 61 лунку, у каждого 14 шаров; первыми ходят чёрные. За ход двигают <b>один, два или три</b> своих шара,
          стоящих подряд на одной линии, — на одну лунку в любом из шести направлений.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 2], [0, 3], [0, 4]], [[0, -4], [1, -4]], { turn: 0 }),
          steps: [A(0, mv([[0, 2], [0, 3], [0, 4]], 4), 'Три чёрных шара — шаг вперёд по своей линии.')],
        },
      },
      {
        title: 'В линию и вбок',
        html: `<p>Ход <b>в линию</b> — вдоль линии шаров: передний шар идёт в пустую лунку (или толкает чужие). Ход <b>вбок</b> — поперёк линии:
          все шары шагают параллельно, и все лунки впереди должны быть свободны; вбок толкать нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[-1, 2], [0, 2], [1, 2]], [[0, -4]], { turn: 0 }),
          steps: [A(0, mv([[-1, 2], [0, 2], [1, 2]], 5), 'Три шара поперёк — все сразу на лунку вверх-вправо.')],
        },
      },
      {
        title: 'Сумито — толчок',
        html: `<p>Двигаясь в линию, можно толкать чужие шары, если своих больше: <b>2 против 1, 3 против 1, 3 против 2</b>.
          За чужими шарами должна быть пустая лунка или край доски. Поровну (1 на 1, 2 на 2, 3 на 3) толкать нельзя, а больше трёх своих не двигают.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 1], [0, 2], [0, 3]], [[0, 0], [0, -1]], { turn: 0 }),
          steps: [A(0, mv([[0, 1], [0, 2], [0, 3]], 4), 'Три чёрных толкают два белых на лунку вверх.')],
        },
      },
      {
        title: 'Вытолкнуть за край',
        html: `<p>Если за толкаемыми шарами край доски, крайний чужой шар вылетает — он выбыл. Кто первым вытолкнул <b>шесть</b>, тот выиграл.
          Свой шар за край не толкают. Если партия затянулась (300 ходов), побеждает вытолкнувший больше.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, -3], [0, -2]], [[0, -4]], { turn: 0 }),
          steps: [A(0, mv([[0, -3], [0, -2]], 4), 'Два против одного у края — белый шар вылетает.')],
        },
      },
      {
        title: 'Расстановки',
        html: `<p><b>Стандартная</b> — как в коробке: шары стенкой у своего края. <b>Бельгийская ромашка</b> — турнирная: у каждого две «ромашки» по семь шаров
          по разным углам, бой начинается сразу. <b>Немецкая ромашка</b> — те же ромашки, но ближе к центру.</p>`,
      },
    ],
  },
};
