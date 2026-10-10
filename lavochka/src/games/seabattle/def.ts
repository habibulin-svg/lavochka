/* Морской бой — описание игры для сборника: советский флот или западный, касание, «ещё выстрел», сальво; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cellName, cfgFrom, LETTERS, makeView, N, NAMES, newState, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'placed':
      return `${name(ev.seat)}: флот на местах.`;
    case 'start':
      return `Флоты на местах. Первым стреляет ${name(ev.first)}.`;
    case 'shots':
      return `${name(ev.seat)}: ${ev.res
        .map((r) => `<b>${cellName(r.cell)}</b> — ${r.sunk ? `убит${r.sunk.length > 1 ? ` (${NAMES[r.sunk.length]}палубный)` : ' (одиночка)'}!` : r.hit ? 'ранен!' : 'мимо'}`)
        .join(', ')}`;
    case 'end':
      return ev.resign ? `🏳 Соперник сдался. Победа — ${name(ev.winner)}.` : `🏆 <b>${name(ev.winner)}</b>: весь флот соперника на дне!`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = SEATS.map((x, seat) => ({ seat, kind: 'bot', name: x.name, level: 1 }));

/** Клетка по имени: «Д5». */
export const at = (name: string) => LETTERS.indexOf(name[0]) + (+name.slice(1) - 1) * N;
/** Корабль «А1-Г1». */
const ship = (t: string) => {
  const [a, b] = t.split('-').map(at);
  if (b == null) return [a];
  const step = b - a >= N ? N : 1;
  const out: number[] = [];
  for (let c = a; c <= b; c += step) out.push(c);
  return out;
};
const FLEET = ['А1-Г1', 'А3-В3', 'Е1-Е3', 'К1-К2', 'А5-Б5', 'Г5-Г6', 'З3', 'Ж7', 'А7', 'К9'].map(ship);
const FLEET2 = ['Б10-Д10', 'Ж10-И10', 'К6-К8', 'Б7-Б8', 'Е7-Ж7', 'А1-Б1', 'Д3', 'Ж4', 'К2', 'И4'].map(ship);

function battle(opts: Record<string, unknown> = {}): State {
  const s = newState(cfgFrom(opts as never));
  s.ships = [FLEET.map((x) => x.slice()), FLEET2.map((x) => x.slice())];
  s.ready = [true, true];
  s.phase = 'battle';
  s.turn = 0;
  return s;
}

const shoot = (seat: number, cells: string[], caption: string) => ({ seat, action: { type: 'shoot', cells: cells.map(at) } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'seabattle',
  title: 'Морской бой',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'fleet',
      label: 'Флот',
      type: 'select',
      choices: [
        { value: 'ussr', label: 'наш: 4 + 3 + 3 + 2 + 2 + 2 + 1 + 1 + 1 + 1' },
        { value: 'west', label: 'западный: 5 + 4 + 3 + 3 + 2' },
      ],
      default: 'ussr',
    },
    { key: 'again', label: 'Попал — стреляй ещё', type: 'toggle', default: true },
    { key: 'touch', label: 'Корабли могут касаться', type: 'toggle', default: false, hint: 'Обычно нельзя — даже углами.' },
    { key: 'salvo', label: 'Сальво', type: 'toggle', default: false, hint: 'За ход столько выстрелов, сколько у тебя кораблей на плаву.' },
  ],
  presets: [
    { id: 'classic', label: 'Классика', hint: 'Как в тетрадке: 10 кораблей, попал — стреляй ещё', options: { fleet: 'ussr', again: true, touch: false, salvo: false } },
    { id: 'salvo', label: 'Сальво', hint: 'Залпом: выстрелов — сколько кораблей на плаву', options: { fleet: 'ussr', again: false, touch: false, salvo: true } },
    { id: 'west', label: 'Западный флот', hint: 'Пять кораблей: авианосец, линкор, крейсер, подлодка, эсминец', options: { fleet: 'west', again: true, touch: false, salvo: false } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    return { winners: [s.winner], text: 'потопили весь флот соперника', scores: { [s.winner]: 1, [1 - s.winner]: 0 } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const s = battle();
    for (const c of ['А1', 'Б1', 'В1', 'Г1', 'Е2', 'Д5', 'К9', 'Ж4', 'В7', 'Ж7']) {
      const r = apply(s, s.turn, { type: 'shoot', cells: [at(c)] }, { next: () => 0, int: () => 0, getState: () => 0 });
      if (r) Object.assign(s, r.state);
    }
    // на превью флот соперника скрыт, как в настоящей партии
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Первым потопить весь флот соперника, не видя, где он стоит.',
    sections: [
      {
        title: 'Флот и расстановка',
        html: `<p>У каждого — поле 10×10: столбцы от А до К (без Й), строки от 1 до 10. На своём поле втайне расставляют флот:
          <b>линкор</b> на 4 клетки, два <b>крейсера</b> по 3, три <b>эсминца</b> по 2 и четыре <b>катера</b>-одиночки.</p>
          <p>Корабли — прямые полоски, по горизонтали или вертикали. <b>Касаться</b> друг друга нельзя — даже углами.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({})),
          intro: 'Пустые поля — сейчас оба расставят флот.',
          steps: [
            { seat: 0, action: { type: 'place', ships: FLEET } as Action, caption: 'Вовка расставляет свои корабли.' },
            { seat: 1, action: { type: 'place', ships: FLEET2 } as Action, rig: [0], caption: 'Серёга тоже готов. Первым стреляет Вовка.' },
          ],
        },
      },
      {
        title: 'Стрельба',
        html: `<p>Стреляют по очереди, называя клетку: «Д5!». Соперник отвечает: <b>мимо</b>, <b>ранил</b> или <b>убил</b>.
          Попал — стреляешь ещё раз. Потопленный корабль «обводят»: вокруг него кораблей быть не может.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => battle(),
          steps: [
            shoot(0, ['Д5'], 'Вовка: «Д5!» — мимо. Ход переходит.'),
            shoot(1, ['Б1'], 'Серёга попал: ранил!'),
            shoot(1, ['В1'], 'Ещё выстрел — снова ранил.'),
            shoot(1, ['А1'], 'И ещё…'),
            shoot(1, ['Г1'], 'Убил линкор! Клетки вокруг него обведены — там пусто.'),
            shoot(1, ['К9'], 'Одиночка — сразу убит.'),
            shoot(1, ['Д8'], 'Мимо — теперь стреляет Вовка.'),
          ],
        },
      },
      {
        title: 'Сальво',
        html: `<p>Вариант для азартных: за ход даётся столько выстрелов, сколько у тебя кораблей на плаву, — все сразу, залпом.
          Потерял корабль — залп становится меньше.</p>`,
        demo: {
          seats: demoSeats,
          options: { salvo: true, again: false },
          setup: () => battle({ salvo: true, again: false }),
          steps: [shoot(0, ['А1', 'Б3', 'В5', 'Г7', 'Д9', 'Е2', 'Ж4', 'З6', 'И8', 'К10'], 'У Вовки 10 кораблей — значит, 10 выстрелов разом.')],
        },
      },
      {
        title: 'Западный флот',
        html: `<p>В западной версии кораблей пять: на 5, 4, 3, 3 и 2 клетки. Остальное — так же.</p>`,
      },
    ],
  },
};
