/* «Сапёр» — как в Windows: Новичок / Любитель / Профессионал / Особое поле, флажки и «?», щелчок по числу.
 * Вариации: поле-тор, соседи ходом коня, первая клетка — поляна или поле без угадывания; режимы «наперегонки» и «охота на мины». */
import { SeededRng } from '../../core/rng';
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './bot';
import { apply, MODE_LABEL, nbrOf, preArm, result, setup, SIZES, toAct, view, type Action, type Event, type State } from './engine';
import { deduceAll } from './solver';

export const SEATS = [
  { name: 'Вовка', color: '#d02018', light: '#ff6a5a', dark: '#7a100a' },
  { name: 'Ленка', color: '#1a3ed0', light: '#6a8aff', dark: '#0a1a70' },
  { name: 'Серёга', color: '#1a8a2a', light: '#5ac86a', dark: '#0a4a14' },
  { name: 'Танька', color: '#9a6a00', light: '#d8a840', dark: '#4a3200' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'boom':
      return `💥 ${name(ev.seat)} подрывается на мине`;
    case 'won':
      return `😎 ${name(ev.seat)}: поле разминировано за <b>${ev.sec}</b> с`;
    case 'claim':
      return `🚩 ${name(ev.seat)} находит мину — <b>${ev.score}</b>`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const seats1: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 1 }];
const seats2: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
type Step = { seat: number; action: Action; caption?: string };

/** Показ на настоящем поле: позиция задаётся сидом, шаги считаются по ней (мины известны показу). */
function demo(seats: SeatSpec[], options: Record<string, string | number | boolean>, seed: number, pick: (s: State, rng: Rng) => Step[], intro: string): DemoScript<State, Action> {
  let base: State | null = null;
  const get = () => {
    if (base) return base;
    base = setup(seats.map((x) => x.seat), options, new SeededRng(seed));
    if (base.boards[0].st === 'new') base = preArm(base, centre(base), new SeededRng(seed));
    return base;
  };
  return {
    seats,
    options,
    setup: () => get(),
    intro,
    get steps() {
      return pick(get(), new SeededRng(seed + 1));
    },
  };
}

const centre = (s: State) => Math.floor(s.cfg.h / 2) * s.cfg.w + Math.floor(s.cfg.w / 2);

/** Классика: первый щелчок, флажок на выведенной мине, щелчок по числу. */
function classicSteps(s0: State): Step[] {
  const c = s0.cfg;
  const i0 = centre(s0);
  const steps: Step[] = [{ seat: 0, action: { type: 'open', i: i0 }, caption: 'Первый щелчок никогда не попадает на мину. Открылась поляна: числа — сколько мин вокруг клетки.' }];
  const r = apply(s0, 0, { type: 'open', i: i0 }, new SeededRng(5), 0);
  if (!r) return steps;
  const b = r.state.boards[0];
  const nbr = nbrOf(c);
  const d = deduceAll(nbr, b.open, b.num, new Array(b.open.length).fill(false), 0);
  const mine = d.mine.findIndex((m, i) => m && !b.open[i]);
  if (mine < 0) return steps;
  steps.push({ seat: 0, action: { type: 'mark', i: mine, m: 1 }, caption: 'У этой единицы закрыт один сосед — значит, мина там. Правая кнопка — флажок.' });
  const marked = b.mark.slice();
  marked[mine] = 1;
  const chord = nbr[mine].find((j) => b.open[j] && b.num[j] === 1 && nbr[j].some((k) => !b.open[k] && marked[k] !== 1));
  if (chord != null)
    steps.push({ seat: 0, action: { type: 'chord', i: chord }, caption: 'Щелчок по числу, у которого флажков уже столько, сколько мин, — открывает всех остальных соседей разом.' });
  return steps;
}

function raceSteps(s: State): Step[] {
  const b = s.boards[0];
  const c = s.cfg;
  const nbr = nbrOf(c);
  const d = deduceAll(nbr, b.open, b.num, new Array(b.open.length).fill(false), 1);
  const out: Step[] = [];
  if (d.safe[0] != null) out.push({ seat: 0, action: { type: 'open', i: d.safe[0] }, caption: 'Поляна в начале — общая. Вовка открывает свою клетку…' });
  if (d.safe[1] != null) out.push({ seat: 1, action: { type: 'open', i: d.safe[1] }, caption: '…а Ленка — свою, на своём поле. Мины у всех одинаковые, а чужого поля не видно — только сколько осталось.' });
  return out;
}

function flagsSteps(s: State): Step[] {
  const b = s.boards[0];
  const mine = b.mine.findIndex(Boolean);
  const safe = b.mine.findIndex((m, i) => !m && b.num[i] > 0);
  return [
    { seat: 0, action: { type: 'open', i: mine }, caption: 'Вовка попал на мину — это очко, и он ходит ещё раз.' },
    { seat: 0, action: { type: 'open', i: safe }, caption: 'Пусто — ход переходит к Ленке. Числа помогают сопернику не меньше, чем вам.' },
  ];
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'saper',
  title: 'Сапёр',
  players: { min: 1, max: 4, default: 1 },
  countsFor: (o) => (o.mode === 'flags' ? [2, 3, 4] : [1, 2, 3, 4]),
  countsHint: (o) => (o.mode === 'flags' ? 'охота на мины — вдвоём и больше' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Режим',
      type: 'select',
      choices: (['solo', 'race', 'flags'] as const).map((m) => ({ value: m, label: MODE_LABEL[m] })),
      default: 'solo',
    },
    {
      key: 'size',
      label: 'Поле',
      type: 'select',
      choices: [...Object.entries(SIZES).map(([v, x]) => ({ value: v, label: `${x.label}: ${x.w} × ${x.h}, ${x.m} мин` })), { value: 'custom', label: 'Особое' }],
      default: 'beginner',
    },
    { key: 'cw', label: 'Ширина', type: 'number', min: 6, max: 40, default: 20, showIf: (o) => o.size === 'custom' },
    { key: 'ch', label: 'Высота', type: 'number', min: 6, max: 30, default: 12, showIf: (o) => o.size === 'custom' },
    { key: 'cm', label: 'Мин', type: 'number', min: 1, max: 999, default: 40, showIf: (o) => o.size === 'custom' && o.mode !== 'flags' },
    {
      key: 'start',
      label: 'Первая клетка',
      type: 'select',
      choices: [
        { value: 'win', label: 'как в Windows: не мина' },
        { value: 'zero', label: 'всегда поляна' },
        { value: 'noguess', label: 'без угадывания: всё решается логикой' },
      ],
      default: 'win',
      showIf: (o) => o.mode !== 'flags',
    },
    { key: 'torus', label: 'Тор', hint: 'края поля склеены: у крайних клеток соседи — на другом краю', type: 'toggle', default: false },
    { key: 'knight', label: 'Ход конём', hint: 'соседи клетки — восемь клеток на ход шахматного коня', type: 'toggle', default: false },
    { key: 'marks', label: 'Отметки (?)', hint: 'правая кнопка ставит и «?», как в Windows', type: 'toggle', default: true, showIf: (o) => o.mode !== 'flags' },
  ],
  presets: [
    { id: 'beginner', label: 'Новичок', hint: '9 × 9, 10 мин', options: { mode: 'solo', size: 'beginner' } },
    { id: 'amateur', label: 'Любитель', hint: '16 × 16, 40 мин', options: { mode: 'solo', size: 'amateur' } },
    { id: 'pro', label: 'Профессионал', hint: '30 × 16, 99 мин', options: { mode: 'solo', size: 'pro' } },
    { id: 'noguess', label: 'Без угадывания', hint: 'Любитель, но всё выводится логикой — ни одной «50 на 50»', options: { mode: 'solo', size: 'amateur', start: 'noguess' } },
    { id: 'torus', label: 'Тор', hint: 'Края склеены — углов нет', options: { mode: 'solo', size: 'amateur', torus: true, start: 'zero' } },
    { id: 'knight', label: 'Ход конём', hint: 'Числа считают мины на ход коня', options: { mode: 'solo', size: 'beginner', knight: true, start: 'zero' } },
    { id: 'race', label: 'Наперегонки', hint: 'Одинаковые поля, кто первым разминирует', options: { mode: 'race', size: 'amateur', start: 'noguess' } },
    { id: 'flags', label: 'Охота на мины', hint: 'По очереди: нашёл мину — очко и ещё ход', options: { mode: 'flags', size: 'amateur' } },
  ],

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
    ),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view,
  result,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  // превью: «Профессионал» посреди партии — поляны, числа и флажки
  showcase: () => {
    let s = setup([0], { mode: 'solo', size: 'pro', start: 'noguess' }, new SeededRng(1995), 0);
    const c = s.cfg;
    const i0 = centre(s);
    s = apply(s, 0, { type: 'open', i: i0 }, new SeededRng(1995), 0)!.state;
    const nbr = nbrOf(c);
    for (let k = 0; k < 60; k++) {
      const b = s.boards[0];
      const d = deduceAll(nbr, b.open, b.num, b.mark.map((m) => m === 1), 1);
      if (!d.safe.length) break;
      const r = apply(s, 0, { type: 'open', i: d.safe[0] }, new SeededRng(k), 0);
      if (!r) break;
      s = r.state;
      d.mine.forEach((m, i) => m && !s.boards[0].open[i] && (s.boards[0].mark[i] = 1));
    }
    s.boards[0].t0 = Date.now() - 87_000;
    return s;
  },

  rules: {
    goal: 'Открыть все клетки без мин и ни разу не подорваться.',
    sections: [
      {
        title: 'Как в Windows',
        html: `<p>Под закрытыми клетками спрятаны мины. Щелчок открывает клетку; число на ней — сколько мин в соседних восьми клетках.
          Если вокруг пусто, открывается целая поляна. Первый щелчок мины не находит никогда.</p>
          <p><b>Правая кнопка</b> — флажок (ещё раз — «?», ещё раз — снять). На телефоне флажок — долгим нажатием или в режиме 🚩.
          <b>Щелчок по числу</b>, вокруг которого флажков уже столько, сколько мин, открывает остальных соседей разом (а неверный флажок — подорвёт).</p>
          <p>Слева на табло — сколько мин осталось (мины минус флажки), справа — секундомер. Рожица — новая игра.</p>`,
        demo: demo(seats1, { mode: 'solo', size: 'beginner', start: 'noguess' }, 11, (s) => classicSteps(s), 'Новичок: 9 × 9, 10 мин.'),
      },
      {
        title: 'Поля и вариации',
        html: `<p><b>Новичок</b> — 9 × 9 и 10 мин, <b>Любитель</b> — 16 × 16 и 40, <b>Профессионал</b> — 30 × 16 и 99, <b>Особое</b> — любое своё.</p>
          <p><b>Без угадывания</b> — поле подобрано так, что от первой поляны до конца всё выводится логикой. <b>Тор</b> — края склеены: правый край соседствует с левым, верх — с низом.
          <b>Ход конём</b> — число считает мины не вокруг, а на восьми клетках, куда пошёл бы шахматный конь.</p>`,
      },
      {
        title: 'Вместе и наперегонки',
        html: `<p><b>Одному или вместе</b> — одно поле на всех: открывать и ставить флажки может каждый, а мина — проигрыш для всех. Боты — помощники: делают то, что выводится, а угадывать оставляют людям.</p>
          <p><b>Наперегонки</b> — у каждого своё поле, мины на всех одинаковые, стартовая поляна общая. Чужого поля не видно — только сколько клеток у соперника осталось.
          Кто первым разминировал — победил; подорвавшийся выбывает.</p>`,
        demo: demo(seats2, { mode: 'race', size: 'beginner', start: 'noguess' }, 23, (s) => raceSteps(s), 'Наперегонки вдвоём.'),
      },
      {
        title: 'Охота на мины',
        html: `<p>Как «Minesweeper Flags»: одно поле, ходят по очереди, и мины теперь — <b>цель</b>. Попал на мину — она твоя (флажок твоего цвета), и ходишь ещё раз.
          Открыл пустую клетку — ход переходит дальше. Мин нечётное число (на 16 × 16 — 51); побеждает тот, кого уже не догнать.</p>`,
        demo: demo(seats2, { mode: 'flags', size: 'beginner' }, 7, (s) => flagsSteps(s), 'Охота на мины вдвоём.'),
      },
    ],
  },
};

