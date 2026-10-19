/* «Головоломки» — одна карточка: судоку, пикросс, кроссворд, сканворд. Решают вместе: все вписывают в одну сетку.
 * Без DOM. Движок — engine.ts, генераторы — sudoku.ts / picross.ts / crossword.ts / scanword.ts, боты-помощники — bot.ts.
 * Кроссворду и сканворду нужна база вопросов (words/clues.ts) — её грузит defs.ts / каталог до начала партии. */
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { choose } from './bot';
import { apply, CROSS_SIZES, type Kind, type WordData, KIND_LABEL, newState, PICROSS_LEVELS, PICROSS_SIZES, SCAN_SIZES, setup, SUDOKU_LEVELS, toAct, view, WORD_LEVELS, type Action, type Event, type State } from './engine';

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
function demo(kind: Kind, level: number, size: string, seed: number, pick: (s: State) => { seat: number; action: Action; caption?: string }[], intro: string): DemoScript<State, Action> {
  let base: State | null = null;
  const get = () => (base ??= newState(kind, level, size, seed, [0, 1]));
  return {
    seats: demoSeats,
    options: kind === 'sudoku' ? { kind, sLevel: level } : kind === 'picross' ? { kind, pLevel: level, pSize: size } : kind === 'crossword' ? { kind, cLevel: level, cSize: size } : { kind, scLevel: level, scSize: size },
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

/** Кроссворд/сканворд: первое слово по буквам, Вовка и Ленка по очереди. */
function wordSteps(s: State, caption: string) {
  const wd = (s.data as WordData).words[0];
  return wd.cells.map((c, k) => ({
    seat: k % 2,
    action: { type: 'set', is: [c], v: s.sol[c] } as Action,
    caption: k === 0 ? `${caption} «${wd.clue}» — ${wd.cells.length} букв.` : k === wd.cells.length - 1 ? 'Слово вписано. Буквы в пересечениях подсказывают соседние слова.' : undefined,
  }));
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
  title: 'Кроссворды и судоку',
  players: { min: 1, max: 6, default: 1 },
  seats: SEATS,
  options: [
    {
      key: 'kind',
      label: 'Головоломка',
      type: 'select',
      choices: (['crossword', 'scanword', 'sudoku', 'picross'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] })),
      default: 'crossword',
    },
    { key: 'cSize', label: 'Размер', type: 'select', choices: Object.entries(CROSS_SIZES).map(([v, x]) => ({ value: v, label: `${x.label} (~${x.target} слов)` })), default: 'medium', showIf: (o) => o.kind === 'crossword' },
    { key: 'cLevel', label: 'Сложность', type: 'select', choices: WORD_LEVELS.map((l, i) => ({ value: i + 1, label: l })), default: 2, showIf: (o) => o.kind === 'crossword' },
    { key: 'scSize', label: 'Размер', type: 'select', choices: Object.entries(SCAN_SIZES).map(([v, x]) => ({ value: v, label: `${x.label} (${x.w} × ${x.h})` })), default: 'medium', showIf: (o) => o.kind === 'scanword' },
    { key: 'scLevel', label: 'Сложность', type: 'select', choices: WORD_LEVELS.map((l, i) => ({ value: i + 1, label: l })), default: 2, showIf: (o) => o.kind === 'scanword' },
    { key: 'sLevel', label: 'Сложность', type: 'select', choices: SUDOKU_LEVELS.map((l, i) => ({ value: i + 1, label: l })), default: 2, showIf: (o) => o.kind === 'sudoku' },
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
    { id: 'crossword', label: 'Кроссворд', hint: 'Слова по номерам: по горизонтали и по вертикали', options: { kind: 'crossword' } },
    { id: 'scanword', label: 'Сканворд', hint: 'Вопросы прямо в клетках, стрелка показывает, куда писать', options: { kind: 'scanword' } },
    { id: 'sudoku', label: 'Судоку', hint: 'Цифры 1–9 в каждой строке, столбце и квадрате', options: { kind: 'sudoku' } },
    { id: 'picross', label: 'Пикросс', hint: 'Японский кроссворд: закрась клетки по числам — выйдет картинка', options: { kind: 'picross' } },
  ],

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
    ),
  // продолженная головоломка (сид и введённое из сохранения) не повторяется: «Сыграть ещё» — новая с теми же настройками
  again: ({ seed, fill, ...rest }) => rest,
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

  // превью: сканворд с картинкой, наполовину решённый двумя игроками
  showcase: () => {
    const s = newState('scanword', 1, 'medium', 2024, [0, 1]);
    const words = (s.data as WordData).words;
    words.forEach((wd, k) => {
      if (k % 2) return;
      for (const c of wd.cells) {
        s.cells[c] = s.sol[c];
        s.who[c] = k % 4 ? 1 : 0;
      }
    });
    s.cur[1] = words[1]?.cells[0] ?? -1;
    return s;
  },

  rules: {
    goal: 'Решить головоломку — одному или всем двором в одну сетку.',
    sections: [
      {
        title: 'Кроссворд',
        html: `<p>Слова пересекаются в общих буквах. Вопросы — в списках «По горизонтали» и «По вертикали», номер вопроса стоит в первой клетке слова.</p>
          <p>Нажмите клетку и печатайте — буквы идут по слову; повторное нажатие на клетку меняет направление. Вопрос из списка сразу ведёт к своему слову.
          Сложность — какие слова попадаются: на лёгком только всем известные.</p>`,
        demo: demo('crossword', 1, 'small', 31, (s) => wordSteps(s, 'Первый вопрос:'), 'Маленький кроссворд.'),
      },
      {
        title: 'Сканворд',
        html: `<p>Вопросы стоят прямо в клетках поля, коротко — в два-три слова. Стрелка показывает, куда писать ответ: вправо или вниз от вопроса.
          В одной клетке бывает два вопроса. Почти каждая буква — в двух словах сразу.</p>
          <p>Нажатие на вопрос — к его слову (второе нажатие — ко второму вопросу клетки). «Фото 1» — ответ к картинке с номером 1.</p>`,
        demo: demo('scanword', 1, 'small', 17, (s) => wordSteps(s, 'Вопрос в голубой клетке:'), 'Маленький сканворд.'),
      },
      {
        title: 'Судоку',
        html: `<p>Поле 9 × 9 разбито на квадраты 3 × 3. Впишите цифры от 1 до 9 так, чтобы в каждой <b>строке</b>, каждом <b>столбце</b>
          и каждом <b>квадрате</b> каждая цифра встречалась ровно один раз. Решение всегда одно, и до него можно дойти рассуждением, без угадывания.
          На лёгком, среднем и сложном хватает «одиночек» (цифре больше некуда встать), чем выше уровень — тем меньше открыто;
          на «Эксперте» нужны пары, блокировки и «крестокрыл».</p>
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
