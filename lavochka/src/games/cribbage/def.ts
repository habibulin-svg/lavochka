/* Криббедж — описание игры для сборника: вдвоём, втроём, вчетвером пара на пару; до 121 или 61; доска с колышками. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Джон', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Мэри', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Том', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Энн', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
export const cn = (c: Card) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)} — его криб.`;
    case 'starter':
      return `Стартер: ${cn(ev.card)}${ev.heels ? ' — валет, сдатчику +2 «за пятки»' : ''}.`;
    case 'play':
      return ev.items.length ? `${name(ev.seat)}: ${cn(ev.card)}, ${ev.count} — ${ev.items.map((i) => `${i.what} +${i.pts}`).join(', ')}.` : null;
    case 'goPoint':
      return `${name(ev.seat)}: ${ev.last ? 'последняя карта' : '«пас» у всех'} +1.`;
    case 'show':
      return `${name(ev.seat)}${ev.crib ? ' (криб)' : ''}: ${ev.cards.map(cn).join(' ')} — <b>${ev.items.reduce((x, i) => x + i.pts, 0)}</b>${ev.items.length ? ` (${ev.items.map((i) => `${i.what} ${i.pts}`).join(', ')})` : ''}.`;
    case 'end':
      return `🏁 Партия: ${ev.winners.map(name).join(' и ')} — ${ev.score[ev.winners[0]]}.`;
  }
  return null;
}

/** Чужие руки и сброс в криб скрыты. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'discard' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Розыгрыш вдвоём: руки (по 4), стартер, криб; сдаёт второй. */
function peg(hands: string[], starter: string, opts: Options = {}, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  s.dealer = 1;
  s.deal = 1;
  hands.forEach((h, i) => {
    s.hands[i] = L(h);
    s.left[i] = L(h);
    s.discards[i] = L('2S 3S');
  });
  s.crib = L('2S 3S 4D 9C');
  s.starter = C(starter);
  s.phase = 'peg';
  s.turn = 0;
  s.deck = L('8S 8D 8C');
  return Object.assign(s, extra);
}

const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'cribbage',
  title: 'Криббедж',
  players: { min: 2, max: 4, default: 2 },
  teams: (_o, seats) => (seats.length === 4 ? [[seats[0], seats[2]], [seats[1], seats[3]]] : null),
  seats: SEATS,
  options: [
    {
      key: 'target',
      label: 'Партия',
      type: 'select',
      choices: [
        { value: 121, label: 'до 121 — два круга по доске' },
        { value: 61, label: 'до 61 — один круг' },
      ],
      default: 121,
    },
  ],
  presets: [
    { id: 'classic', label: 'До 121', hint: 'Классика: вдвоём по 6 карт, два круга по доске', options: { target: 121 } },
    { id: 'short', label: 'До 61', hint: 'Короткая партия — один круг', options: { target: 61 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[x];
    const lose = Math.min(...s.seats.map((x) => s.score[x]));
    return { winners: s.winners, text: `${s.score[s.winners[0]]} : ${lose}${s.cfg.target === 121 && lose < 91 ? ' — «скунс»!' : ''}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    peg(['5H JD 4C', '10S 6D 9H'], '5S', {}, {
      pile: [
        { seat: 1, card: C('KC') },
        { seat: 0, card: C('5D') },
      ],
      played: [
        { seat: 1, card: C('KC') },
        { seat: 0, card: C('5D') },
      ],
      count: 15,
      score: [74, 58],
      back: [70, 52],
      turn: 1,
      deal: 6,
      left: [L('5H JD 4C'), L('10S 6D 9H')],
    }),

  rules: {
    goal: 'Первым провести колышек по доске до <b>121</b>: очки дают розыгрыш карт (15, 31, пары, последовательности) и показ руки.',
    sections: [
      {
        title: 'Сдача и криб',
        html: `<p>Колода — 52 карты. Вдвоём каждому по 6; две карты каждый сбрасывает в <b>криб</b> — лишнюю руку сдатчика, её он посчитает в конце.
          Втроём — по 5 и одна из колоды в криб, вчетвером (пара на пару) — по 5, в криб по одной. Сосед сдатчика снимает колоду,
          верхнюю карту открывают — это <b>стартер</b>. Валет-стартер — сдатчику 2 очка «за пятки».</p>`,
      },
      {
        title: 'Розыгрыш до 31',
        html: `<p>По очереди кладут по карте и называют сумму: туз — 1, картинки — 10. Перевалить за 31 нельзя.
          Сумма <b>15</b> — 2 очка, ровно <b>31</b> — 2. Карта того же достоинства, что предыдущая, — <b>пара</b>, 2; три подряд — 6, четыре — 12.
          Последние три карты и больше складываются в <b>последовательность</b> (в любом порядке) — по очку за карту.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => peg(['4C 6H 5H 7S', '5C 5D 10S 9H'], 'KS'),
          steps: [
            P(0, '4C', 'Джон: «Четыре».'),
            P(1, '5C', 'Мэри: «Девять».'),
            P(0, '6H', '«Пятнадцать — два, и 4-5-6 — три»: пять очков.'),
            P(1, '5D', '«Двадцать».'),
            P(0, '5H', '«Двадцать пять — пара»: два очка.'),
          ],
        },
      },
      {
        title: '«Пас» и последняя карта',
        html: `<p>Нечем ходить, не перевалив за 31, — «пас». Когда не может никто, последний положивший получает 1 очко, сумма начинается заново.
          Последняя карта розыгрыша — тоже 1 очко.</p>`,
      },
      {
        title: 'Показ руки',
        html: `<p>Потом каждый считает свои четыре карты <b>вместе со стартером</b> (первым — сосед сдатчика, сдатчик — последним, а за ним — криб):
          каждая комбинация на 15 — 2 очка, каждая пара — 2, каждая последовательность — по очку за карту,
          четыре карты одной масти — 4 (с мастью стартера — 5; криб — только все пять), валет в масть стартера — 1 («за нос»).
          Самая большая рука — 29: три пятёрки, валет и пятёрка той же масти стартером.</p>`,
      },
      {
        title: 'Доска',
        html: `<p>Очки отмечают колышками на доске: у каждой стороны два, задний перешагивает через передний на число очков — так видно и счёт, и последнюю запись.
          Кто первым дошёл до 121 (или до 61), выиграл сразу, даже посреди розыгрыша. Проигравший, не прошедший трёх четвертей доски (91), — «скунс».</p>`,
      },
    ],
  },
};
