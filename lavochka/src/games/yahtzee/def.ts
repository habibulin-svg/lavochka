/* Яхтзи — описание игры для сборника: Яхтзи, Генерал, Покер на костях; 1–6 игроков; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, CAT_NAME, cfgFrom, HAND_NAME, makeView, newState, pokerRank, setup, toAct, total, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

export const diceText = (d: number[]) => `[${d.join(' ')}]`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'score':
      return `${name(ev.seat)}: ${diceText(ev.dice)} → «${CAT_NAME[ev.cat]}» <b>${ev.pts}</b>${ev.bonus ? ` и +${ev.bonus} за повторный яхтзи` : ''}`;
    case 'instant':
      return `🎲 ${name(ev.seat)}: генерал с руки — сразу победа!`;
    case 'stand':
      return `${name(ev.seat)}: ${diceText(ev.dice)} — ${HAND_NAME[ev.rank[0]]}`;
    case 'pround':
      return ev.winners.length === 1 ? `Кон за ${name(ev.winners[0])}.` : `Ничья: ${ev.winners.map(name).join(', ')} — кон никому.`;
    case 'end':
      return `🏁 Победа: ${ev.winners.map(name).join(', ')}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const pos = (variant: string, extra: Partial<State> = {}) => Object.assign(newState(cfgFrom({ variant }), [0, 1]), { turn: 0 }, extra);
const A = (a: Action, caption?: string, rig?: number[]) => ({ seat: 0, action: a, caption, rig });
/** rig для броска: значения граней 1–6 → rng.int(6). */
const R = (...faces: number[]) => faces.map((f) => f - 1);
const H = (...idx: number[]) => [0, 1, 2, 3, 4].map((i) => idx.includes(i));

export const def: GameDef<State, Action, Event, State> = {
  id: 'yahtzee',
  title: 'Яхтзи',
  players: { min: 1, max: 6, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'yahtzee', label: 'Яхтзи — 13 граф' },
        { value: 'generala', label: 'Генерал — 11 граф' },
        { value: 'poker', label: 'Покер на костях — коны' },
      ],
      default: 'yahtzee',
    },
    {
      key: 'wins',
      label: 'До скольких побед',
      type: 'select',
      choices: [
        { value: 3, label: 'до 3 конов' },
        { value: 5, label: 'до 5 конов' },
        { value: 7, label: 'до 7 конов' },
      ],
      default: 3,
      showIf: (o) => o.variant === 'poker',
    },
  ],
  presets: [
    { id: 'yahtzee', label: 'Яхтзи', hint: '13 граф, бонус 35 за 63 в верхних', options: { variant: 'yahtzee' } },
    { id: 'generala', label: 'Генерал', hint: 'Комбинация с руки — на 5 больше, генерал с руки — победа', options: { variant: 'generala' } },
    { id: 'poker', label: 'Покер на костях', hint: 'Без таблицы: старшая комбинация берёт кон, до 3 побед', options: { variant: 'poker', wins: 3 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = total(s, p);
    if (s.instant != null) return { winners: [s.instant], text: 'генерал с руки', scores };
    const top = Math.max(...s.seats.map((p) => scores[p]));
    const winners = s.seats.filter((p) => scores[p] === top);
    return { winners, text: s.cfg.variant === 'poker' ? `${top} выигранных кона` : `${top} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos('yahtzee', { dice: [5, 5, 5, 2, 2], held: [true, true, true, false, false], rolls: 2 });
    s.seats = [0, 1, 2];
    Object.assign(s.sheet[0], { n1: 3, n3: 9, n5: 20, three: 24, small: 30, chance: 22 });
    Object.assign(s.sheet[1], { n2: 6, n4: 12, n6: 18, full: 25, large: 40, yahtzee: 0 });
    Object.assign(s.sheet[2], { n1: 2, n2: 8, n6: 24, four: 26, yahtzee: 50 });
    return s;
  },

  rules: {
    goal: 'Пятью костями собирать комбинации и записывать их в таблицу так, чтобы к концу набрать больше всех очков. В покере на костях — выигрывать коны старшей комбинацией.',
    sections: [
      {
        title: 'Ход: три броска',
        html: `<p>За ход — до трёх бросков. Сначала бросаются все пять костей; потом можно <b>отложить</b> любые (коснитесь кубика)
          и перебросить остальные. После любого броска можно остановиться и записать результат в свободную графу.
          Ничего не подходит — пишите ноль в любую.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('yahtzee'),
          steps: [
            A({ type: 'roll' }, 'Первый бросок: 2, 3, 4, 4, 6.', R(2, 3, 4, 4, 6)),
            A({ type: 'roll', hold: H(0, 1, 2) }, 'Откладываем 2-3-4 и перебрасываем две: 5 и 1 — большой стрит!', R(5, 1)),
            A({ type: 'score', cat: 'large' }, '«Большой стрит» — 40 очков.'),
          ],
        },
      },
      {
        title: 'Таблица Яхтзи',
        html: `<p><b>Верх:</b> единицы…шестёрки — сумма костей этого номинала. Набрал в верхних 63 и больше — <b>+35</b>.</p>
          <p><b>Низ:</b> тройка и каре — сумма всех костей; фулл-хаус (3+2) — 25; малый стрит (4 подряд) — 30; большой (5 подряд) — 40;
          <b>яхтзи</b> (пять одинаковых) — 50; шанс — сумма всех. Повторный яхтзи — ещё +100, и его можно записать «джокером» в свободную графу.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('yahtzee'),
          steps: [
            A({ type: 'roll' }, 'Три шестёрки сразу.', R(6, 6, 6, 1, 3)),
            A({ type: 'roll', hold: H(0, 1, 2) }, 'Держим шестёрки — и ещё две!', R(6, 6)),
            A({ type: 'score', cat: 'yahtzee' }, 'Яхтзи — 50 очков.'),
          ],
        },
      },
      {
        title: 'Генерал',
        html: `<p>11 граф: верх без бонуса, <b>стрит</b> 20 (1-2-3-4-5, 2-3-4-5-6 или 3-4-5-6-1), <b>фулл</b> 30, <b>покер</b> (каре) 40,
          <b>генерал</b> (пять одинаковых) 50, двойной генерал — 100. Собрал с первого броска («с руки») — на 5 больше.
          <b>Генерал с руки</b> — сразу выигрыш всей партии.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('generala'),
          steps: [
            A({ type: 'roll' }, 'С руки: три четвёрки и две двойки — фулл.', R(4, 4, 2, 4, 2)),
            A({ type: 'score', cat: 'full' }, 'Фулл с руки — 35 вместо 30.'),
          ],
        },
      },
      {
        title: 'Покер на костях',
        html: `<p>Без таблицы. Кон: каждый по очереди бросает до трёх раз и останавливается; старшая комбинация берёт кон.
          ${HAND_NAME.slice(1).join(' &lt; ')}. При равных — по старшим костям; совсем поровну — кон никому. До трёх побед.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('poker'),
          steps: [
            A({ type: 'roll' }, 'Пара пятёрок.', R(5, 2, 5, 1, 6)),
            A({ type: 'roll', hold: H(0, 2) }, 'Держим пару — вышла ещё пятёрка и двойки: фулл!', R(2, 5, 2)),
            A({ type: 'stand' }, `Стоп: ${HAND_NAME[pokerRank([5, 2, 5, 5, 2])[0]]}.`),
          ],
        },
      },
    ],
  },
};
