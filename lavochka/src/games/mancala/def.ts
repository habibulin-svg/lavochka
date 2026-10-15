/* Манкала — описание игры: калах и оваре пресетами; 2 игрока; боты (минимакс); правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'sow') {
    const parts: string[] = [];
    if (ev.again) parts.push('последний в дом — ходит ещё');
    if (ev.captured.length) parts.push('берёт камни');
    return parts.length ? `${name(ev.seat)}: ${parts.join(', ')}` : null;
  }
  if (ev.type === 'end') return `🏁 ${ev.store[0]} : ${ev.store[1]}${ev.winner == null ? ' — ничья' : ` — победа: ${name(ev.winner)}`}.`;
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
function pos(variant: string, pits: number[], store: [number, number] = [0, 0], turn = 0): State {
  const s = newState(cfgFrom({ variant }));
  s.pits = pits.slice();
  s.store = store;
  s.turn = turn;
  return s;
}
const S = (seat: number, pit: number, caption?: string) => ({ seat, action: { type: 'sow', pit } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'mancala',
  title: 'Манкала',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'kalah', label: 'калах — с домами, повторный ход' },
        { value: 'oware', label: 'оваре — бери по 2 и 3' },
      ],
      default: 'kalah',
    },
    {
      key: 'seeds',
      label: 'Камней в лунке',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 4, label: '4' },
        { value: 5, label: '5' },
        { value: 6, label: '6' },
      ],
      default: 4,
      showIf: (o) => o.variant !== 'oware',
    },
  ],
  presets: [
    { id: 'kalah', label: 'Калах', hint: 'По 4 камня, дома, повторный ход и взятие напротив', options: { variant: 'kalah', seeds: 4 } },
    { id: 'kalah6', label: 'Калах (6)', hint: 'По 6 камней — дольше', options: { variant: 'kalah', seeds: 6 } },
    { id: 'oware', label: 'Оваре', hint: 'Африканская: бери по 2 и 3, корми соперника', options: { variant: 'oware' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over) return null;
    const scores = { 0: s.store[0], 1: s.store[1] };
    return { winners: s.winner == null ? [] : [s.winner], text: `${s.store[0]} : ${s.store[1]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => pos('kalah', [0, 5, 3, 7, 1, 2, 4, 0, 6, 2, 1, 3], [9, 5], 0),

  rules: {
    goal: 'Собрать больше камней, чем соперник: в свой дом (калах) или взятками (оваре).',
    sections: [
      {
        title: 'Раскладка',
        html: `<p>У каждого ряд из шести лунок, его — ближний. Ход: взять все камни из своей лунки и класть по одному в следующие против часовой стрелки.
          В калахе свой дом справа тоже получает камень, чужой — пропускается. <b>Последний камень в свой дом</b> — ходишь ещё раз.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('kalah', [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
          intro: 'Калах, по четыре в лунке.',
          steps: [S(0, 2, 'Из третьей лунки: четыре камня — последний в дом. Ход ещё раз!'), S(0, 5, 'Теперь из шестой: пять камней — один в дом, четыре сопернику.')],
        },
      },
      {
        title: 'Взятие в калахе',
        html: `<p>Последний камень лёг в <b>свою пустую лунку</b>, а напротив есть камни — забираешь их вместе со своим камнем в дом.
          Ряд у кого-то опустел — конец: оставшиеся камни соперник кладёт в свой дом.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('kalah', [1, 0, 0, 3, 1, 2, 4, 5, 2, 1, 6, 3], [6, 5]),
          intro: 'Вторая лунка Вовки пуста, напротив — шесть камней.',
          steps: [S(0, 0, 'Один камень — во вторую, пустую лунку. Вовка забирает шесть напротив и свой камень.')],
        },
      },
      {
        title: 'Оваре',
        html: `<p>Домов на доске нет. Последний камень попал к сопернику и там стало <b>2 или 3</b> — забираешь их, а с ними и предыдущие лунки
          соперника подряд, если там тоже 2 или 3. Забрать сразу все камни соперника нельзя. Если у соперника пусто — <b>обязан</b> дать ему камни.
          Из 12 и больше камней исходную лунку при обходе пропускают. Набрал 25 — победа.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('oware', [1, 3, 0, 4, 2, 2, 1, 2, 4, 1, 5, 3], [0, 0]),
          intro: 'Оваре. В шестой лунке Вовки два камня.',
          steps: [S(0, 5, 'Два камня: в первую и вторую лунки Ленки — там стало 2 и 3. Вовка берёт обе.')],
        },
      },
    ],
  },
};
