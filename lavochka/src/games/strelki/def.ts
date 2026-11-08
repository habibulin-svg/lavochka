/* «Стрелки» — одна карточка: поле 5 × 5 … 16 × 16, стрелки-змейки или прямые, сердца, подсказки, номер уровня.
 * Вдвоём и больше — вместе (одно поле на всех) или наперегонки (у каждого своё такое же). */
import type { DemoScript, GameDef, Options, SeatSpec } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { presetTables, type RecordTable } from '../../core/records';
import { choose } from './bot';
import { apply, freeArrows, newBoard, result, setup, SIZES, toAct, type Action, type Arrow, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'bump':
      return `💥 ${name(ev.seat)}: стрелка упёрлась${ev.lives ? ` — сердец осталось ${ev.lives}` : ''}`;
    case 'clear':
      return `🏁 ${name(ev.seat)}: поле чистое! ${ev.sec} с, ошибок ${ev.mistakes}`;
    case 'fail':
      return `💔 ${name(ev.seat)}: сердца кончились`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const seats1: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 1 }];

/** Поле 5 × 5 для показа: стрелка A упирается в B, остальные выходят по очереди. */
const DEMO_ARROWS: Arrow[] = [
  { cells: [11, 12], dir: 1, tone: 2 }, // A — вправо, мешает B
  { cells: [9, 14, 19], dir: 2, tone: 3 }, // B — вниз, свободна
  { cells: [20, 15, 16, 17], dir: 1, tone: 4 }, // C — изогнутая, вправо, мешает B
  { cells: [2, 7], dir: 2, tone: 1 }, // D — вниз, мешают A и C
  { cells: [0, 1], dir: 1, tone: 0 }, // E — вправо, мешает D
];

function demo(steps: { a: number; caption: string }[], intro: string, opts: Options = {}): DemoScript<State, Action> {
  const options = { size: 5, lives: 3, ...opts };
  return {
    seats: seats1,
    options,
    setup: (_d, rng) => {
      const s = setup([0], options, rng);
      s.arrows = DEMO_ARROWS.map((a) => ({ ...a, cells: a.cells.slice() }));
      s.boards = [newBoard(s.cfg, s.arrows.length, s.boards[0].t0)];
      return s;
    },
    intro,
    steps: steps.map((x) => ({ seat: 0, action: { type: 'tap', a: x.a } as Action, caption: x.caption })),
  };
}

function recTable(o: Options): RecordTable | null {
  const n = Number(o.size) || 9;
  const straight = o.shape === 'straight';
  return { id: `${n}${straight ? '.s' : ''}`, label: `${n} × ${n}${straight ? ', прямые' : ''}` };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'strelki',
  title: 'Стрелки',
  players: { min: 1, max: 4, default: 1 },
  seats: SEATS,
  options: [
    { key: 'size', label: 'Поле', type: 'select', choices: SIZES.map((n) => ({ value: n, label: `${n} × ${n}` })), default: 9 },
    { key: 'level', label: 'Уровень', hint: 'номер задачи: у каждого номера своё поле; после победы — следующий', type: 'number', min: 1, max: 99999, default: 1 },
    {
      key: 'shape',
      label: 'Стрелки',
      type: 'select',
      choices: [
        { value: 'bent', label: 'змейки с изгибами' },
        { value: 'straight', label: 'только прямые' },
      ],
      default: 'bent',
    },
    {
      key: 'lives',
      label: 'Сердца',
      hint: 'сколько раз можно ошибиться: стрелка упёрлась — минус сердце',
      type: 'select',
      choices: [
        { value: 1, label: '1 — без права на ошибку' },
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 0, label: 'без счёта' },
      ],
      default: 3,
    },
    { key: 'hints', label: 'Подсказки', hint: 'кнопка «Подсказка» показывает свободную стрелку', type: 'toggle', default: true },
    {
      key: 'mode',
      label: 'Вдвоём и больше',
      type: 'select',
      choices: [
        { value: 'coop', label: 'вместе: одно поле на всех' },
        { value: 'race', label: 'наперегонки: у каждого своё' },
      ],
      default: 'coop',
    },
  ],
  presets: [
    { id: 'easy', label: 'Разминка', hint: '5 × 5, прямые стрелки', options: { size: 5, shape: 'straight', lives: 3 } },
    { id: 'classic', label: 'Стрелки', hint: '9 × 9, змейки, три сердца', options: { size: 9, shape: 'bent', lives: 3 } },
    { id: 'big', label: 'Большое поле', hint: '13 × 13, змейки', options: { size: 13, shape: 'bent', lives: 3 } },
    { id: 'huge', label: 'Во весь двор', hint: '16 × 16, пять сердец', options: { size: 16, shape: 'bent', lives: 5 } },
    { id: 'hard', label: 'Без права на ошибку', hint: '11 × 11, одно сердце, без подсказок', options: { size: 11, shape: 'bent', lives: 1, hints: false } },
    { id: 'race', label: 'Наперегонки', hint: 'Одинаковые поля — кто первым очистит своё', options: { size: 9, mode: 'race' } },
  ],
  countsHint: (o) => (o.mode === 'race' ? 'у каждого своё поле' : 'все выпускают стрелки с одного поля'),

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
    ),
  // «Сыграть ещё» — следующий уровень
  again: (o) => ({ ...o, level: (Number(o.level) || 1) + 1 }),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,
  records: {
    columns: [
      { key: 'ms', label: 'Время', sort: 'asc', format: 'time' },
      { key: 'err', label: 'Ошибок', sort: 'asc', format: 'score' },
    ],
    table: recTable,
    tables: () => presetTables(def, recTable),
    score: (s) => {
      const b = s.boards[0];
      return b?.done ? { values: { ms: b.t1 - b.t0, err: b.mistakes }, help: b.hints > 0 } : null;
    },
    help: true,
  },

  // превью: 9 × 9, треть стрелок уже выпущена
  showcase: () => {
    const s = setup([0], { size: 9, level: 7 }, new SeededRng(7));
    const b = s.boards[0];
    for (let k = 0; k < Math.round(s.arrows.length * 0.3); k++) {
      const f = freeArrows(s, b.gone);
      if (!f.length) break;
      b.gone[f[k % f.length]] = true;
    }
    return s;
  },

  rules: {
    goal: 'Выпустить с поля все стрелки и не потерять все сердца.',
    sections: [
      {
        title: 'Как играть',
        html: `<p>На асфальте мелом нарисованы <b>стрелки</b> — прямые и изогнутые, как змейки. Нажмите на стрелку — она поползёт
          вперёд, куда смотрит наконечник, и улетит за край поля. Хвост ползёт следом по её же изгибам.</p>
          <p>Улететь стрелка может, только если <b>впереди наконечника до самого края пусто</b>. Если на пути другая стрелка —
          ваша доползёт до неё, отскочит назад, и пропадёт <b>сердце</b> ❤.</p>`,
        demo: demo(
          [
            { a: 0, caption: 'Розовая стрелка смотрит вправо, но там лежит синяя — упёрлась и отскочила. Минус сердце.' },
            { a: 1, caption: 'Синяя смотрит вниз, под ней пусто — улетает.' },
            { a: 0, caption: 'Теперь и розовой путь свободен.' },
            { a: 2, caption: 'Зелёная змейка ползёт по своим изгибам и уходит вправо.' },
            { a: 3, caption: 'Жёлтой путь вниз расчищен.' },
            { a: 4, caption: 'Последняя, белая, — поле чистое!' },
          ],
          'Поле 5 × 5, пять стрелок.',
        ),
      },
      {
        title: 'Как не ошибаться',
        html: `<p>Решение есть всегда: выпуская свободную стрелку, вы только расчищаете путь другим, тупиков не бывает. Вся трудность —
          заметить, какая стрелка свободна. Смотрите вдоль наконечника до самого края. Начинайте с краёв: стрелки, что смотрят
          наружу у самой кромки, уходят первыми.</p>
          <p>Кнопка <b>«Подсказка»</b> подсвечивает свободную стрелку. Партии с подсказками идут в рекорды отдельно.</p>`,
      },
      {
        title: 'Уровни и вариации',
        html: `<p>У каждого номера уровня своё поле, «Сыграть ещё» ведёт к следующему. Поле — от 5 × 5 до 16 × 16. Стрелки бывают
          <b>змейками</b> с изгибами или <b>только прямыми</b>. Сердец — одно, три, пять или без счёта (тогда ошибки просто считаются).</p>
          <p>Вдвоём и больше — <b>вместе</b> (одно поле, выпускают все) или <b>наперегонки</b> (у каждого своё такое же поле, кто первым очистил — победил;
          у кого кончились сердца — выбывает).</p>`,
      },
    ],
  },
};

