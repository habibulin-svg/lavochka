/* Перудо — описание игры для сборника: 2–6 игроков, джокеры-единицы, «точно», палафико; боты; правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { alive, apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

const FACE_GEN: Record<number, [string, string, string]> = {
  1: ['единица', 'единицы', 'единиц'],
  2: ['двойка', 'двойки', 'двоек'],
  3: ['тройка', 'тройки', 'троек'],
  4: ['четвёрка', 'четвёрки', 'четвёрок'],
  5: ['пятёрка', 'пятёрки', 'пятёрок'],
  6: ['шестёрка', 'шестёрки', 'шестёрок'],
};
/** «5 четвёрок», «2 единицы», «1 шестёрка». */
export function bidText(n: number, face: number): string {
  const [one, few, many] = FACE_GEN[face];
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  return `${n} ${word}`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'roll':
      return `Кон ${ev.round}${ev.palafico ? ' — палафико: единицы не джокеры, грань не меняют' : ''}. Начинает ${name(ev.starter)}.`;
    case 'bid':
      return `${name(ev.seat)}: «${bidText(ev.n, ev.face)}»`;
    case 'reveal': {
      const r = ev.reveal;
      const what = r.kind === 'dudo' ? '«Не верю!»' : '«Точно!»';
      const res = r.loser != null ? `${name(r.loser)} теряет кость` : r.gainer != null ? `${name(r.gainer)} возвращает кость` : 'точно — но костей и так полно';
      return `${name(r.caller)}: ${what} На столе ${bidText(r.actual, r.bid.face)} — ${res}.`;
    }
    case 'out':
      return `${name(ev.seat)} выбывает.`;
    case 'end':
      return `🏁 Последние кости — у ${name(ev.winner)}!`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all' || ev.type !== 'roll') return ev;
  return { ...ev, dice: ev.dice?.map((d, p) => (seats.includes(p) ? d : [])) };
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
function pos(dice: number[][], extra: Partial<State> = {}, opts = {}): State {
  const s = newState(cfgFrom(opts), [0, 1, 2]);
  dice.forEach((d, i) => {
    s.dice[i] = d.slice();
    s.counts[i] = d.length;
  });
  s.round = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string, rig?: number[]) => ({ seat, action: a, caption, rig });

export const def: GameDef<State, Action, Event, State> = {
  id: 'perudo',
  title: 'Перудо',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    { key: 'jokers', label: 'Единицы — джокеры', type: 'toggle', default: true, hint: '«Пако»: единица считается за любую грань.' },
    { key: 'calza', label: '«Точно!»', type: 'toggle', default: true, hint: 'Ровно столько — вернёшь кость, нет — потеряешь. Когда за столом трое и больше.' },
    { key: 'palafico', label: 'Палафико', type: 'toggle', default: true, hint: 'Осталась последняя кость — кон без джокеров, грань не меняют.' },
    {
      key: 'dice',
      label: 'Костей у каждого',
      type: 'select',
      choices: [
        { value: 5, label: 'по 5' },
        { value: 4, label: 'по 4' },
        { value: 3, label: 'по 3 — быстро' },
      ],
      default: 5,
    },
  ],
  presets: [
    { id: 'perudo', label: 'Перудо', hint: 'Джокеры, «точно», палафико', options: { jokers: true, calza: true, palafico: true, dice: 5 } },
    { id: 'liar', label: 'Лжец на костях', hint: 'Только «не верю», без палафико', options: { jokers: true, calza: false, palafico: false, dice: 5 } },
    { id: 'plain', label: 'Без джокеров', hint: 'Единица — просто единица', options: { jokers: false, calza: false, palafico: false, dice: 5 } },
    { id: 'quick', label: 'Быстрый', hint: 'По 3 кости', options: { jokers: true, calza: true, palafico: true, dice: 3 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const w = alive(s);
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.counts[p];
    return { winners: w, text: `кости остались только у одного`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos([[1, 3, 4, 4, 6], [2, 2, 5], [1, 4, 5, 6]]);
    s.seats = [0, 1, 2, 3];
    s.dice[3] = [3, 4];
    s.counts = [5, 3, 4, 2, 0, 0];
    s.bid = { seat: 3, n: 5, face: 4 };
    s.history = [
      { seat: 1, n: 3, face: 2 },
      { seat: 2, n: 4, face: 4 },
      s.bid,
    ];
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Сохранить свои кости и выбить чужие: угадывать, сколько каких граней лежит под всеми стаканчиками, и ловить соседей на вранье.',
    sections: [
      {
        title: 'Заявки',
        html: `<p>У каждого пять костей под стаканчиком, свои видишь только ты. По кругу заявляют: «пять четвёрок» — значит, на всём столе,
          <b>у всех вместе</b>, не меньше пяти четвёрок. <b>Единицы — джокеры</b>: считаются за любую грань.</p>
          <p>Следующий обязан повысить: больше костей — или столько же, но грань старше. На единицы можно перейти вдвое меньшим числом
          (с округлением вверх), обратно — вдвое больше плюс один. Начинать кон с единиц нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[1, 4, 4, 2, 6], [3, 4, 5, 5, 1], [2, 2, 6, 6, 4]]),
          intro: 'У Вовки две четвёрки и единица — уже три «четвёрки».',
          steps: [
            A(0, { type: 'bid', n: 4, face: 4 }, '«Четыре четвёрки».'),
            A(1, { type: 'bid', n: 4, face: 5 }, 'Ленка: «четыре пятёрки» — столько же, но грань старше.'),
            A(2, { type: 'bid', n: 2, face: 1 }, 'Серёга переходит на единицы: «две единицы» — вдвое меньше.'),
          ],
        },
      },
      {
        title: '«Не верю!»',
        html: `<p>Не веришь заявке — скажи «Не верю!». Все поднимают стаканчики и считают (с единицами). Меньше заявленного — кость теряет
          заявивший, столько или больше — тот, кто не поверил. Потерявший начинает следующий кон, все кости перебрасываются.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[1, 4, 4, 2, 6], [3, 4, 5, 5, 1], [2, 2, 6, 6, 4]], { bid: { seat: 0, n: 7, face: 4 }, history: [{ seat: 0, n: 7, face: 4 }], turn: 1 }),
          intro: 'Вовка заявил «семь четвёрок».',
          steps: [A(1, { type: 'dudo' }, 'Ленка: «Не верю!» Четвёрок четыре, единиц две — всего шесть, а не семь. Вовка теряет кость.', Array(14).fill(2))],
        },
      },
      {
        title: '«Точно!» и палафико',
        html: `<p><b>«Точно!»</b> — когда за столом трое и больше: если на столе ровно столько, сказавший возвращает потерянную кость, если нет — теряет.</p>
          <p><b>Палафико:</b> у кого осталась последняя кость, следующий кон (один раз) идёт без джокеров, а грань в нём менять нельзя — только число.
          Без костей — выбыл. Последний с костями — победил.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => {
            const s = pos([[1, 4, 4, 2, 3], [3, 4, 5, 5, 1], [2, 6, 6, 4]], { bid: { seat: 1, n: 6, face: 4 }, history: [{ seat: 1, n: 6, face: 4 }], turn: 2 });
            return s;
          },
          intro: 'Ленка заявила «шесть четвёрок». У Серёги одной кости уже нет.',
          steps: [A(2, { type: 'calza' }, 'Серёга: «Точно!» Четвёрок четыре и единиц две — ровно шесть. Серёга возвращает себе кость.', Array(14).fill(3))],
        },
      },
    ],
  },
};
