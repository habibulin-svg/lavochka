/* Плиточник — описание игры для сборника: 2–4 игрока, цветная и серая стена. Без DOM. */
import { SeededRng } from '../../core/rng';
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { colOf, KIND_RU, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Серёга', color: '#2f6fb0', light: '#7fb2e8', dark: '#173a60' },
  { name: 'Вован', color: '#b3442a', light: '#e88f78', dark: '#5e1f10' },
  { name: 'Димон', color: '#3d8a3a', light: '#8fd08a', dark: '#1d461b' },
  { name: 'Колян', color: '#8a6a1d', light: '#d8bc6e', dark: '#47360b' },
];
const ROW_RU = ['первую', 'вторую', 'третью', 'четвёртую', 'пятую'];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'take')
    return `${name(ev.seat)}: ${ev.n} × ${KIND_RU[ev.kind]} ${ev.src === -1 ? 'с прилавка' : 'из ящика'} — ${ev.row === 5 ? 'в бой' : `в ${ROW_RU[ev.row]} строку`}${ev.trowel ? ' (и мастерок)' : ''}`;
  if (ev.type === 'tile') return `${name(ev.seat)}: плитка на стену, +${ev.pts}`;
  if (ev.type === 'floor') return `${name(ev.seat)}: бой ${ev.pts}`;
  if (ev.type === 'fill') return 'Новый раунд: ящики снова полны.';
  if (ev.type === 'end') return `🏁 Стена готова! Итог: ${ev.scores.map((x, i) => `${name(i)} ${x}${ev.bonus[i] ? ` (бонус +${ev.bonus[i]})` : ''}`).join(', ')}`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const take = (src: number, kind: number, row: number): Action => ({ type: 'take', src, kind, row });

/** Начало партии вдвоём; первые ящики — заданные. */
function base(boxes: number[][], rng: Rng = new SeededRng(4)): State {
  const s = setup({}, 2, rng);
  boxes.forEach((b, i) => (s.factories[i] = b));
  return s;
}

/** Конец раунда: у белых полна первая строка (голубой), на стене уже есть сосед; в последнем ящике — одна метлахская. */
function endOfRound(): State {
  const s = base([]);
  s.factories = s.factories.map(() => []);
  s.factories[0] = [3];
  s.center = [];
  s.trowel = false;
  const b = s.boards[0];
  b.lines[0] = { k: 1, n: 1 };
  b.wall[0][colOf(1, 0) + 1] = 2;
  b.wall[1][colOf(1, 0)] = 0;
  b.score = 4;
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'azul',
  title: 'Плиточник',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'wall',
      label: 'Стена',
      type: 'select',
      choices: [
        { value: 'color', label: 'Размеченная — у каждой плитки своё место' },
        { value: 'grey', label: 'Серая — место выбираешь сам' },
      ],
      default: 'color',
      hint: 'На серой стене в каждом столбце — не больше одной плитки каждого вида.',
    },
  ],
  presets: [
    { id: 'color', label: 'Размеченная стена', hint: 'Основные правила: место каждой плитки на стене задано', options: { wall: 'color' } },
    { id: 'grey', label: 'Серая стена', hint: 'Место плитки в ряду выбираешь сам, в столбце — без повторов', options: { wall: 'grey' } },
  ],
  setup: (seats, opts, rng) => setup(opts, seats.length, rng),
  toAct,
  apply: (s, _seat, a, rng) => step(s, a, rng!),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    s.boards.forEach((b, i) => (scores[i] = b.score));
    return { winners: s.winners, text: `стена выложена, ${Math.max(...s.boards.map((b) => b.score))} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const rng = new SeededRng(21);
    let s = setup({}, 2, rng);
    for (let i = 0; i < 26 && !s.over; i++) s = step(s, choose(s, toAct(s)[0], 2, rng)!, rng)!.state;
    return s;
  },

  rules: {
    goal: 'Выложить стену ванной у Михалыча <b>красивее всех</b>: плитки рядом друг с другом дают больше очков, а лишнее, что разбил, — минус.',
    sections: [
      {
        title: 'Закупка на стройрынке',
        html: `<p>На рынке стоят ящики с плиткой (вдвоём 5, втроём 7, вчетвером 9), в каждом — по четыре. В свой ход берут <b>все плитки одного вида</b>
          из одного ящика, а остальные из него сваливают на прилавок. Можно вместо ящика взять все плитки одного вида с прилавка.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => base([[2, 2, 0, 3]]),
          steps: [
            A(0, take(0, 2, 1), 'Серёга берёт два расписных — белая и метлахская уходят на прилавок.'),
            A(1, take(-1, 0, 0), 'Вован первым берёт с прилавка — белую плитку и мастерок.'),
          ],
        },
      },
      {
        title: 'Ведро с раствором',
        html: `<p>Взятое кладут в одну из пяти строк слева: в первую помещается одна плитка, в пятую — пять. В строке — только один вид,
          и такого вида ещё не должно быть в том же ряду стены. Что не поместилось — в <b>бой</b> внизу. Можно и сразу всё в бой.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => base([[4, 4, 4, 1]]),
          steps: [A(0, take(0, 4, 1), 'Три чёрных во вторую строку: две легли, третья — в бой.')],
        },
      },
      {
        title: 'Мастерок',
        html: `<p>Кто первым в раунде берёт с прилавка, забирает и <b>мастерок</b>: следующий раунд он начинает первым, но мастерок лежит в бое и стоит очко.</p>`,
      },
      {
        title: 'Кладка и очки',
        html: `<p>Когда ящики и прилавок опустели, из каждой полной строки одна плитка идёт на стену в тот же ряд, остальные — в коробку.
          Одинокая плитка — 1 очко, а если рядом уже есть плитки — по очку за каждую подряд в её ряду и в столбце. Бой вычитается:
          −1, −1, −2, −2, −2, −3, −3.</p>
          <p>Когда у кого-то сложился полный ряд, раунд доигрывают и считают бонусы: ряд +2, столбец +7, все пять плиток одного вида +10.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => endOfRound(),
          steps: [A(0, take(0, 3, 4), 'Последняя плитка с рынка — и кладка: у голубой сосед справа и снизу, две по ряду и две по столбцу — +4.')],
        },
      },
      {
        title: 'Серая стена',
        html: `<p>В варианте с серой стеной места плиток не размечены: при кладке сам выбираешь клетку ряда, но в каждом столбце — не больше одной плитки каждого вида.
          Если положить некуда, плитки строки идут в бой.</p>`,
      },
    ],
  },
};

