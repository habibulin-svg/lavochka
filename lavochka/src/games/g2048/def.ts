/* «2048» — одна карточка: поле 3 × 3 … 6 × 6, цель 2048 (или другая, или без конца), камни, отмена хода; вдвоём и больше — наперегонки. */
import type { DemoScript, GameDef, Options, SeatSpec } from '../../core/types';
import { presetTables, type RecordTable } from '../../core/records';
import { choose } from './bot';
import { apply, DIR_NAME, result, setup, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'target':
      return `🏆 ${name(ev.seat)} собирает <b>${ev.v}</b>!`;
    case 'stuck':
      return `${name(ev.seat)}: ходов больше нет — счёт <b>${ev.score}</b>, лучшая плитка ${ev.top}`;
    case 'undo':
      return `${name(ev.seat)} отменяет ход`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const seats1: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 1 }];

/** Показ на заданной доске (0 — пусто, -1 — камень). Новые плитки ставятся rig-ом в первую пустую клетку. */
function demo(cells: number[], options: Record<string, number | boolean>, steps: { dir: 0 | 1 | 2 | 3; caption: string }[], intro: string): DemoScript<State, Action> {
  return {
    seats: seats1,
    options,
    setup: (_d, rng) => {
      const s = setup([0], options, rng);
      const b = s.boards[0];
      b.cells = cells.slice();
      b.ids = cells.map((v, i) => (v > 0 ? 100 + i : 0));
      b.top = Math.max(...cells);
      b.score = 0;
      return s;
    },
    intro,
    steps: steps.map((x) => ({ seat: 0, action: { type: 'move', dir: x.dir } as Action, rig: [0], caption: x.caption })),
  };
}

/** Таблица рекордов: размер поля, цель, камни. Партии с отменой хода — в свою таблицу «с подсказками». */
function recTable(o: Options): RecordTable | null {
  const n = Number(o.n) || 4;
  const t = Number(o.target) || 0;
  const k = Number(o.stones) || 0;
  return { id: `${n}x${n}.${t || 'inf'}${k ? `.s${k}` : ''}`, label: `${n} × ${n}, ${t ? `до ${t}` : 'без конца'}${k ? `, камней: ${k}` : ''}` };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'g2048',
  title: '2048',
  players: { min: 1, max: 4, default: 1 },
  seats: SEATS,
  options: [
    { key: 'n', label: 'Поле', type: 'select', choices: [3, 4, 5, 6].map((n) => ({ value: n, label: `${n} × ${n}` })), default: 4 },
    {
      key: 'target',
      label: 'Цель',
      type: 'select',
      choices: [...[512, 1024, 2048, 4096, 8192].map((t) => ({ value: t, label: String(t) })), { value: 0, label: 'без конца — пока есть ходы' }],
      default: 2048,
    },
    { key: 'stones', label: 'Камни', hint: 'неподвижные клетки: через них плитки не проезжают', type: 'select', choices: [0, 1, 2].map((k) => ({ value: k, label: k ? String(k) : 'нет' })), default: 0 },
    { key: 'undo', label: 'Отмена хода', hint: 'одна отмена после каждого хода (только одному)', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'classic', label: '2048', hint: 'Классика: 4 × 4, до 2048', options: { n: 4, target: 2048, stones: 0, undo: false } },
    { id: 'small', label: '3 × 3', hint: 'Тесно: до 512', options: { n: 3, target: 512, stones: 0 } },
    { id: 'big', label: '5 × 5', hint: 'Просторно: до 4096', options: { n: 5, target: 4096, stones: 0 } },
    { id: 'huge', label: '6 × 6', hint: 'Без конца, пока есть ходы', options: { n: 6, target: 0, stones: 0 } },
    { id: 'stones', label: 'С камнями', hint: '5 × 5 и два камня посреди поля', options: { n: 5, target: 2048, stones: 2 } },
    { id: 'endless', label: 'Без конца', hint: '4 × 4 и игра до последнего хода, с отменой', options: { n: 4, target: 0, undo: true } },
  ],
  countsHint: () => 'вдвоём и больше — наперегонки, у каждого своя доска',

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
    ),
  toAct,
  apply,
  view,
  result,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  records: {
    columns: [
      { key: 'score', label: 'Очки', sort: 'desc', format: 'score' },
      { key: 'top', label: 'Плитка', sort: 'desc', format: 'score' },
    ],
    table: recTable,
    tables: () => presetTables(def, recTable),
    score: (s, { actions }) => {
      const b = s.boards[0];
      if (!b || b.score <= 0) return null;
      return { values: { score: b.score, top: b.top }, help: actions.some((a) => (a as Action).type === 'undo') };
    },
    help: true,
  },
  describe,

  showcase: () => {
    const s = setup([0], { n: 4 }, { next: () => 0.5, int: () => 0, getState: () => 0 });
    const b = s.boards[0];
    b.cells = [2, 4, 8, 2, 16, 32, 4, 0, 1024, 128, 64, 2, 2048, 512, 256, 8];
    b.ids = b.cells.map((v, i) => (v ? i + 1 : 0));
    b.score = 20384;
    b.top = 2048;
    return s;
  },

  rules: {
    goal: 'Сдвигать плитки и складывать одинаковые, пока не получится плитка 2048.',
    sections: [
      {
        title: 'Как ходить',
        html: `<p>Ход — сдвиг <b>всех</b> плиток разом в одну сторону: стрелками на клавиатуре (или W A S D) или проведя пальцем по доске.
          Плитки едут до упора. Две одинаковые при встрече складываются в одну: 2 и 2 — в 4, 4 и 4 — в 8. Новая плитка за ход складывается только раз.</p>
          <p>После каждого хода в пустой клетке появляется двойка (иногда четвёрка). Очки — сумма всех сложенных плиток.</p>`,
        demo: demo([2, 2, 0, 0, 0, 4, 4, 0, 8, 0, 0, 8, 2, 4, 2, 4], { n: 4 }, [
          { dir: 3, caption: `Сдвиг ${DIR_NAME[3]}: 2 и 2 сложились в 4, четвёрки — в 8, восьмёрки — в 16.` },
          { dir: 2, caption: `Сдвиг ${DIR_NAME[2]}: всё съезжает к низу, одинаковые снова встречаются.` },
        ], 'Классика 4 × 4.'),
      },
      {
        title: 'Конец партии',
        html: `<p>Собрали плитку-цель — победа. Если пустых клеток не осталось и соседних одинаковых нет — ходов больше нет, партия окончена.
          В режиме «без конца» игра идёт до последнего хода, а итог — счёт.</p>
          <p><b>Совет:</b> держите самую большую плитку в углу и стройте к ней «лесенку» по убыванию.</p>`,
      },
      {
        title: 'Вариации',
        html: `<p><b>Поле</b> от 3 × 3 до 6 × 6. <b>Камни</b> — неподвижные клетки посреди поля: плитки упираются в них, как в стенку.
          <b>Отмена хода</b> — вернуть последний ход (одна отмена подряд).</p>`,
        demo: demo([2, 0, -1, 2, 0, 0, 0, 0, 0, 4, 0, 4, 0, 0, 0, 0], { n: 4, stones: 1 }, [{ dir: 1, caption: 'Двойки по разные стороны камня не встречаются, а четвёрки сложились.' }], 'Камень в верхнем ряду.'),
      },
      {
        title: 'Наперегонки',
        html: `<p>Вдвоём и больше у каждого своя доска с одинаковым началом. Кто первым собрал цель — победил;
          если ходы кончились у всех — побеждает тот, у кого больше очков. Чужие доски видно в маленьком окне.</p>`,
      },
    ],
  },
};

