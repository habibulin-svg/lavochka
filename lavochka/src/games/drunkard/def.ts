/* Пьяница — описание игры для сборника: 36 или 52 карты, шестёрка бьёт туза, спор с подкладкой или открытый, лимит конов.
 * 2–6 игроков; решать нечего — боты просто открывают карту. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

export const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'war':
      return `${ev.n > 1 ? 'Опять спор' : 'Спор'}: ${ev.seats.map(name).join(', ')}!`;
    case 'take':
      return ev.war || ev.count > 6 ? `${name(ev.seat)} забирает ${ev.count} карт (${cn(ev.by)}).` : null;
    case 'out':
      return `${name(ev.seat)} без карт — выбыл.`;
    case 'end':
      return ev.reason === 'all' ? `🏁 ${name(ev.winner)} собрал всю колоду!` : `🏁 Стемнело — по домам. Больше всех карт у ${name(ev.winner)} (${ev.counts[ev.winner]}).`;
  }
  return null;
}

/** Подкладку рубашкой не видит никто. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'flip' && ev.closed) return { ...ev, card: { s: 'S', r: 0 } };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 0 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(stacks: string[], opts = {}): State {
  const s = newState(cfgFrom(opts), stacks.map((_, i) => i));
  stacks.forEach((t, i) => (s.stacks[i] = L(t)));
  return s;
}
const A = (seat: number, caption?: string) => ({ seat, action: { type: 'flip' } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'drunkard',
  title: 'Пьяница',
  players: { min: 2, max: 6, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт' },
        { value: 52, label: '52 карты — дольше' },
      ],
      default: 36,
    },
    { key: 'low', label: 'Младшая бьёт туза', type: 'toggle', default: true, hint: 'Шестёрка (в 52 картах — двойка) забирает туза.' },
    { key: 'closed', label: 'Спор с подкладкой', type: 'toggle', default: true, hint: 'В споре сначала карта рубашкой, потом открытая. Выключено — сразу открытая.' },
    {
      key: 'limit',
      label: 'Сколько конов',
      type: 'select',
      choices: [
        { value: 0, label: 'до победного' },
        { value: 100, label: '100 — потом у кого больше' },
        { value: 200, label: '200' },
        { value: 300, label: '300' },
      ],
      default: 0,
    },
  ],
  presets: [
    { id: 'classic', label: 'Дворовая', hint: '36 карт, шестёрка бьёт туза, спор с подкладкой', options: { deck: 36, low: true, closed: true, limit: 0 } },
    { id: 'open', label: 'Открытый спор', hint: 'В споре — сразу открытая карта', options: { deck: 36, low: true, closed: false, limit: 0 } },
    { id: 'big', label: '52 карты', hint: 'Двойка бьёт туза, партия длиннее', options: { deck: 52, low: true, closed: true, limit: 0 } },
    { id: 'strict', label: 'Без шестёрки', hint: 'Туз старше всех, без исключений', options: { deck: 36, low: false, closed: true, limit: 0 } },
    { id: 'quick', label: 'Быстрая', hint: '100 конов — потом у кого больше карт', options: { deck: 36, low: true, closed: true, limit: 100 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.stacks[x].length;
    return { winners: [s.winner], text: s.out.length === s.seats.length - 1 ? 'собрал всю колоду' : `больше всех карт — ${s.stacks[s.winner].length}`, scores };
  },
  // решать нечего: все уровни просто открывают карту
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat) => (v.pending.includes(seat) ? { type: 'flip' } : null) },
  describe,

  showcase: () => {
    const s = pos(['7S 9D QC 6H 8S 10C JD', 'KH 6D 8C AS 9S', '7C 8H JH QD 9C', 'KS 7H QH'], {});
    s.table[0] = [{ c: C('10H'), up: true }, { c: C('8D'), up: false }, { c: C('6S'), up: true }];
    s.table[1] = [{ c: C('7D'), up: true }];
    s.table[2] = [{ c: C('10S'), up: true }, { c: C('JC'), up: false }, { c: C('AD'), up: true }];
    s.table[3] = [{ c: C('9H'), up: true }];
    s.war = 1;
    s.round = 23;
    return makeView(s, 'all');
  },

  rules: {
    goal: 'Собрать у себя всю колоду. Думать не надо — только открывать карты и надеяться на удачу.',
    sections: [
      {
        title: 'Раздача и ход',
        html: `<p>Колода делится поровну, лишние карты «спят» до следующей партии. Свои карты не смотрят — держат стопкой рубашкой вверх.</p>
          <p>Все разом открывают верхнюю карту. <b>Старшая</b> забирает все открытые карты себе под низ стопки. Масти значения не имеют.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['KS 7D 9H', '10C 8S JD']),
          steps: [A(0, 'Вовка открывает короля.'), A(1, 'Ленка — десятку. Король старше: обе карты уходят Вовке под низ.')],
        },
      },
      {
        title: 'Шестёрка бьёт туза',
        html: `<p>Туз старше всех, но <b>шестёрка</b> (в колоде из 52 карт — двойка) его забирает. Семёрка шестёрку бьёт как обычно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH 7D 9H', '6C 8S JD']),
          steps: [A(0, 'У Вовки туз…'), A(1, '…а у Ленки шестёрка — она и забирает туза.')],
        },
      },
      {
        title: 'Спор',
        html: `<p>Старшие карты равны — <b>спор</b>. Спорщики кладут по карте рубашкой («подкладка»), а сверху — открытую. Чья старше, тот забирает
          весь стол, вместе с подкладками. Снова равны — спорят ещё раз.</p>
          <p>Кончились карты в споре — последняя открытая и спорит. Нет карт вовсе — выбыл.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10S 8D 6D QS', '10H JC AC 9S']),
          steps: [A(0, 'Вовка открывает десятку…'), A(1, '…и Ленка десятку. Спор!'), A(0, 'Вовка: подкладка и шестёрка.'), A(1, 'Ленка: подкладка и туз. Но шестёрка бьёт туза — все шесть карт Вовкины.')],
        },
      },
      {
        title: 'Конец',
        html: `<p>Остался без карт — выбыл, он и есть «пьяница». Кто собрал всю колоду — победил. Можно договориться о числе конов: когда стемнеет,
          побеждает тот, у кого больше карт.</p><p>Партия бывает долгой — включите <b>«Автоигру»</b>, и карты будут открываться сами.</p>`,
      },
    ],
  },
};
