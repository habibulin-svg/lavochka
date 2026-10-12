/* «Головоломки» — одна карточка: судоку и пикросс (дальше — кроссворд и сканворд). Решают вместе: все вписывают в одну сетку.
 * Без DOM. Движок — engine.ts, генераторы — sudoku.ts / picross.ts, боты-помощники — bot.ts. */
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { choose } from './bot';
import { apply, KIND_LABEL, newState, PICROSS_LEVELS, PICROSS_SIZES, setup, SUDOKU_LEVELS, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
  { name: 'Димка', color: '#6a2a8a', light: '#9a6ab8', dark: '#3a1250' },
  { name: 'Оля', color: '#127a7a', light: '#4ab0b0', dark: '#0a4a4a' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'set':
      return null;
    case 'hint':
      return `${name(ev.seat)} берёт подсказку`;
    case 'check':
      return ev.wrong ? `${name(ev.seat)} проверяет: ошибок — <b>${ev.wrong}</b>` : `${name(ev.seat)} проверяет: ошибок нет`;
    case 'solved':
      return `🏁 Решено!${ev.hints ? ` Подсказок: ${ev.hints}.` : ' Без подсказок.'}`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Показ: настоящая головоломка с известным сидом; ходы — верные клетки из решения. */
function demo(kind: 'sudoku' | 'picross', level: number, size: string, seed: number, pick: (s: State) => { seat: number; action: Action; caption?: string }[], intro: string): DemoScript<State, Action> {
  let base: State | null = null;
  const get = () => (base ??= newState(kind, level, size, seed, [0, 1]));
  return {
    seats: demoSeats,
    options: kind === 'sudoku' ? { kind, sLevel: level } : { kind, pLevel: level, pSize: size },
    setup: () => get(),
    intro,
    get steps() {
      return pick(get());
    },
  };
}

/** Первые k клеток судоку, решаемых по логике, — верными цифрами. */
function sudokuSteps(s: State, captions: string[]) {
  const steps: { seat: number; action: Action; caption?: string }[] = [];
  const open = s.cells.map((c, i) => i).filter((i) => !s.fixed[i]);
  for (let k = 0; k < captions.length && k < open.length; k++) {
    const i = open[k];
    steps.push({ seat: k % 2, action: { type: 'set', is: [i], v: s.sol[i] }, caption: captions[k] });
  }
  return steps;
}

function picrossSteps(s: State) {
  const filled = s.sol.map((v, i) => i).filter((i) => s.sol[i] === '#');
  const empty = s.sol.map((v, i) => i).filter((i) => s.sol[i] === '.');
  const row = Math.floor(filled[0] / s.w);
  const inRow = filled.filter((i) => Math.floor(i / s.w) === row);
  return [
    { seat: 0, action: { type: 'set', is: inRow, v: '#' } as Action, caption: 'Вовка закрашивает блок в строке: числа слева говорят, сколько клеток подряд.' },
    { seat: 1, action: { type: 'set', is: [empty[0]], v: 'x' } as Action, caption: 'Ленка ставит крестик: здесь точно пусто.' },
  ];
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'puzzles',
  title: 'Головоломки',
  players: { min: 1, max: 6, default: 1 },
  seats: SEATS,
  options: [
    {
      key: 'kind',
      label: 'Головоломка',
      type: 'select',
      choices: (['sudoku', 'picross'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] })),
      default: 'sudoku',
    },
    { key: 'sLevel', label: 'Сложность', type: 'select', choices: SUDOKU_LEVELS.map((l, i) => ({ value: i + 1, label: l })), default: 2, showIf: (o) => o.kind !== 'picross' },
    {
      key: 'pSize',
      label: 'Размер',
      type: 'select',
      choices: PICROSS_SIZES.map((s) => ({ value: s, label: s.replace('x', ' × ') })),
      default: '10x10',
      showIf: (o) => o.kind === 'picross',
    },
    { key: 'pLevel', label: 'Сложность', type: 'select', choices: PICROSS_LEVELS.map((l, i) => ({ value: i + 1, label: l })), default: 2, showIf: (o) => o.kind === 'picross' },
  ],
  presets: [
    { id: 'sudoku', label: 'Судоку', hint: 'Цифры 1–9 в каждой строке, столбце и квадрате', options: { kind: 'sudoku' } },
    { id: 'picross', label: 'Пикросс', hint: 'Японский кроссворд: закрась клетки по числам — выйдет картинка', options: { kind: 'picross' } },
  ],

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
    ),
  toAct,
  apply,
  view: (s) => view(s),
  result(s) {
    if (!s.done) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.credit[x];
    return { winners: s.seats.slice(), text: `${KIND_LABEL[s.kind]} решено${s.hints ? `, подсказок: ${s.hints}` : ' без подсказок'}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const s = newState('sudoku', 2, '9x9', 4242, [0, 1]);
    const open = s.cells.map((c, i) => i).filter((i) => !s.fixed[i]);
    open.slice(0, 18).forEach((i, k) => {
      s.cells[i] = s.sol[i];
      s.who[i] = k % 2;
    });
    s.cur[0] = open[20];
    s.cur[1] = open[30];
    return s;
  },

  rules: {
    goal: 'Решить головоломку — одному или всем двором в одну сетку.',
    sections: [
      {
        title: 'Судоку',
        html: `<p>Поле 9 × 9 разбито на квадраты 3 × 3. Впишите цифры от 1 до 9 так, чтобы в каждой <b>строке</b>, каждом <b>столбце</b>
          и каждом <b>квадрате</b> каждая цифра встречалась ровно один раз. Решение всегда одно, и до него можно дойти рассуждением, без угадывания
          (кроме уровня «Эксперт» — там иногда приходится пробовать).</p>
          <p>Выберите клетку и нажмите цифру. «Карандаш» — пометки мелкими цифрами, какие варианты ещё возможны.</p>`,
        demo: demo('sudoku', 1, '9x9', 77, (s) => sudokuSteps(s, ['Вовка вписывает цифру.', 'Ленка — свою: решают вместе.', 'И ещё одну.']), 'Лёгкое судоку.'),
      },
      {
        title: 'Пикросс (японский кроссворд)',
        html: `<p>Числа слева от строки и над столбцом — длины закрашенных блоков в этой линии, по порядку. Между блоками — хотя бы одна пустая клетка.
          Закрасьте все нужные клетки — выйдет картинка.</p>
          <p>Нажатие — закрасить, правая кнопка (или режим «✕») — крестик «здесь пусто». Можно вести по клеткам, не отпуская.</p>`,
        demo: demo('picross', 1, '5x5', 9, picrossSteps, 'Пикросс 5 × 5.'),
      },
      {
        title: 'Вместе, подсказки и сохранение',
        html: `<p>За столом решают все сразу, в одну сетку: видно, кто что вписал, и где чей курсор. Боты — помощники: иногда вписывают верную клетку.</p>
          <p><b>Проверить</b> — подсветит ошибки. <b>Подсказка</b> — откроет одну клетку. Недорешённое сохраняется само:
          вернуться к нему можно на экране игры, в списке «Недорешённые».</p>`,
      },
    ],
  },
};
