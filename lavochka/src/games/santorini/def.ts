/* Санторин — описание игры для сборника: вдвоём, поле 5×5, без сил богов. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { N, newState, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#efe6d2', light: '#fffaf0', dark: '#9a8a6a', ink: '#6a5a3a' },
  { name: 'Синие', color: '#1f3f8a', light: '#3d63b8', dark: '#0c1d48' },
];

/** Клетка по-шахматному: a1 — левый нижний угол. */
export const cellName = (c: number) => `${'abcde'[c % N]}${N - Math.floor(c / N)}`;
const LEVEL_RU = ['', 'первый ярус', 'второй ярус', 'третий ярус'];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'place') return `${name(ev.seat)}: строитель на ${cellName(ev.at)}`;
  if (ev.type === 'move') return `${name(ev.seat)}: ${cellName(ev.from)} → ${cellName(ev.to)}${ev.up > 0 ? ' (вверх)' : ev.up < 0 ? ' (вниз)' : ''}`;
  if (ev.type === 'build') return `${name(ev.seat)}: ${ev.dome ? 'купол' : LEVEL_RU[ev.level]} на ${cellName(ev.at)}`;
  if (ev.type === 'end') return ev.how === 'climb' ? `🏁 ${name(ev.winner)}: строитель поднялся на третий ярус!` : `🏁 ${name(ev.winner)}: соперник не может сходить.`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const at = (name: string) => (N - Number(name[1])) * N + 'abcde'.indexOf(name[0]);

/** Позиция: высоты клеток «c3: 2» (4 — купол на третьем ярусе), строители белых и синих. */
export function pos(h: Record<string, number>, w0: string[], w1: string[], turn = 0): State {
  const s = newState();
  for (const [k, v] of Object.entries(h)) {
    s.h[at(k)] = Math.min(v, 3);
    s.dome[at(k)] = v === 4;
  }
  s.workers = [w0.map(at), w1.map(at)];
  s.phase = 'move';
  s.turn = turn;
  s.ply = 6;
  return s;
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'santorini',
  title: 'Санторин',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [],
  presets: [{ id: 'base', label: 'Вдвоём', hint: 'Основные правила, без сил богов', options: {} }],
  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, _seat, a) => step(s, a),
  view: (s) => s,
  result(s) {
    if (!s.over || s.winner == null) return null;
    return { winners: [s.winner], text: s.how === 'climb' ? 'подъём на третий ярус' : 'соперник заперт' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos({ b4: 1, c4: 2, d4: 1, b3: 2, c3: 3, d3: 4, c2: 1, b2: 3, d2: 2, e3: 1, a2: 1, c5: 1 }, ['c4', 'd2'], ['b3', 'e3'], 0);
    s.last = { from: at('c5'), to: at('c4'), built: at('c3') };
    return s;
  },

  rules: {
    goal: 'Первым <b>подняться строителем на третий ярус</b> — или запереть соперника так, чтобы ему некуда было шагнуть.',
    sections: [
      {
        title: 'Расстановка',
        html: `<p>Поле — 5×5 клеток. Сначала белые ставят обоих своих строителей на любые свободные клетки, потом синие.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(),
          steps: [
            A(0, { type: 'place', at: at('b2') }, 'Белые ставят первого строителя…'),
            A(0, { type: 'place', at: at('d4') }, '…и второго.'),
            A(1, { type: 'place', at: at('c3') }, 'Синие — в самый центр…'),
            A(1, { type: 'place', at: at('b4') }, '…и рядом с белым.'),
          ],
        },
      },
      {
        title: 'Шаг и постройка',
        html: `<p>Ход — это два действия <b>одним</b> строителем. Сначала шаг на любую из восьми соседних клеток: свободную, без купола,
          подняться можно не больше чем на один ярус, а спуститься — на сколько угодно. Потом этот же строитель <b>строит</b> на соседней свободной клетке:
          ярус на ярус, а на третий — синий купол. На купол не встать никому.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ c3: 1, d3: 2 }, ['b2', 'd5'], ['a5', 'e1']),
          steps: [
            A(0, { type: 'move', w: 0, to: at('c3') }, 'Белый шагает на первый ярус.'),
            A(0, { type: 'build', at: at('c4') }, 'И строит рядом первый ярус.'),
            A(1, { type: 'move', w: 1, to: at('d2') }),
            A(1, { type: 'build', at: at('d3') }, 'Синие достраивают третий ярус — теперь на него можно подняться только со второго.'),
          ],
        },
      },
      {
        title: 'Купол',
        html: `<p>На третий ярус ставят <b>купол</b>. Купол закрывает клетку навсегда — так мешают сопернику, который уже стоит на втором ярусе рядом с третьим.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ c3: 2, d3: 3, b3: 1 }, ['e4', 'a1'], ['c3', 'a5'], 0),
          steps: [A(0, { type: 'move', w: 0, to: at('e3') }), A(0, { type: 'build', at: at('d3') }, 'Синий на втором ярусе рядом с третьим — белые накрывают третий куполом.')],
        },
      },
      {
        title: 'Победа',
        html: `<p>Кто поднялся строителем со второго яруса на третий — сразу выиграл, строить уже не нужно. Если же в свой ход ни один твой строитель не может шагнуть, ты проиграл.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ c3: 2, d3: 3, b4: 1 }, ['c3', 'a1'], ['e5', 'a5']),
          steps: [A(0, { type: 'move', w: 0, to: at('d3') }, 'Со второго яруса на третий — победа!')],
        },
      },
    ],
  },
};
