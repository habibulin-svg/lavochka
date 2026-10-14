/* Верю — не верю — описание игры для сборника: 36 или 52 карты, проверка всех карт или одной, с подкладыванием или без,
 * четвёрки в отбой. 2–6 игроков; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

/** Ранг: [одна, две-четыре, пять и больше], женский ли род. */
const WORDS: Record<number, [string, string, string, boolean]> = {
  2: ['двойка', 'двойки', 'двоек', true],
  3: ['тройка', 'тройки', 'троек', true],
  4: ['четвёрка', 'четвёрки', 'четвёрок', true],
  5: ['пятёрка', 'пятёрки', 'пятёрок', true],
  6: ['шестёрка', 'шестёрки', 'шестёрок', true],
  7: ['семёрка', 'семёрки', 'семёрок', true],
  8: ['восьмёрка', 'восьмёрки', 'восьмёрок', true],
  9: ['девятка', 'девятки', 'девяток', true],
  10: ['десятка', 'десятки', 'десяток', true],
  11: ['валет', 'валета', 'валетов', false],
  12: ['дама', 'дамы', 'дам', true],
  13: ['король', 'короля', 'королей', false],
  14: ['туз', 'туза', 'тузов', false],
};

/** «две восьмёрки», «один туз», «семь дам». */
export function claimText(n: number, r: number): string {
  const [one, few, many, fem] = WORDS[r];
  const num = ['', fem ? 'одна' : 'один', fem ? 'две' : 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'][n] ?? String(n);
  const k = n % 100;
  const form = k >= 11 && k <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
  return `${num} ${form}`;
}
export const rankPlural = (r: number) => WORDS[r][2];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'lead':
      return `${name(ev.seat)} кладёт: «${claimText(ev.n, ev.rank)}».`;
    case 'add':
      return `${name(ev.seat)}: «Верю, и ещё ${claimText(ev.n, ev.rank)}».`;
    case 'believe':
      return `${name(ev.seat)}: «Верю». Стопка — в отбой.`;
    case 'check':
      return `${name(ev.seat)}: «Не верю!» — ${ev.shown.map(cn).join(' ')}. ${ev.liar ? `Враньё! ${name(ev.of)} забирает` : `Правда! ${name(ev.seat)} забирает`} ${ev.count} карт.`;
    case 'bin':
      return `Стопка (${ev.count}) — в отбой.`;
    case 'quad':
      return `${name(ev.seat)} сбрасывает четыре ${rankPlural(ev.rank)}.`;
    case 'done':
      return `${name(ev.seat)} избавился от карт — ${ev.place}-е место.`;
    case 'end':
      return `🏁 С картами остался ${name(ev.loser)} — брехун!`;
  }
  return null;
}

/** Положенные карты видит только тот, кто клал. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if ((ev.type === 'lead' || ev.type === 'add') && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], extra: Partial<State> = {}, opts = {}): State {
  const s = newState(cfgFrom(opts), hands.map((_, i) => i));
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'bluff',
  title: 'Верю — не верю',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт' },
        { value: 52, label: '52 карты' },
      ],
      default: 36,
    },
    { key: 'one', label: 'Проверять одну карту', type: 'toggle', default: false, hint: 'При «Не верю» открывается одна карта наугад, а не все.' },
    { key: 'noAdd', label: 'Без подкладывания', type: 'toggle', default: false, hint: '«Верю» — и стопка сразу уходит в отбой, поверивший заходит.' },
    { key: 'quads', label: 'Четвёрки в отбой', type: 'toggle', default: true, hint: 'Четыре карты одного ранга на руке сразу сбрасываются в открытую.' },
  ],
  presets: [
    { id: 'classic', label: 'Верю и докладываю', hint: 'Классика двора', options: { deck: 36, one: false, noAdd: false, quads: true } },
    { id: 'one', label: 'Одна карта', hint: 'Проверяют одну карту наугад', options: { deck: 36, one: true, noAdd: false, quads: true } },
    { id: 'quick', label: 'Без подкладывания', hint: 'Верю — в отбой, не верю — проверка', options: { deck: 36, one: false, noAdd: true, quads: true } },
    { id: 'big', label: '52 карты', hint: 'Для большой компании', options: { deck: 52, one: false, noAdd: false, quads: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.loser == null) return null;
    const scores: Record<number, number> = {};
    s.done.forEach((p, i) => (scores[p] = s.seats.length - i));
    scores[s.loser] = 0;
    return { winners: s.done.length ? [s.done[0]] : [], text: 'первым избавился от карт', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(
      pos(['10S 10H JC 7D 9H QS AD', 'KH 6D 8C AS', '7C 8H', 'KS 7H QH 9C 6S'], {
        pile: L('10D 6C 9S 10C 8S'),
        plays: [
          { seat: 1, n: 2 },
          { seat: 2, n: 3 },
        ],
        rank: 10,
        last: { seat: 2, cards: L('9S 10C 8S') },
        turn: 3,
      }),
      [0]
    ),

  rules: {
    goal: 'Первым избавиться от всех карт, выкладывая их рубашкой вверх и называя ранг — можно и соврать. Последний с картами — проиграл.',
    sections: [
      {
        title: 'Заход',
        html: `<p>Карты раздаются все. Заходящий кладёт <b>от одной до четырёх</b> карт рубашкой вверх и называет ранг: «две восьмёрки».
          Можно сказать правду, а можно положить что угодно — блеф.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10S 10H JC 7D', 'KH 6D 10C', '7C 8H 9S']),
          intro: 'У Вовки две десятки и валет.',
          steps: [A(0, { type: 'lead', cards: L('10S 10H JC'), rank: 10 }, '«Три десятки!» — а там валет. Блеф.')],
        },
      },
      {
        title: 'Верю — и докладываю',
        html: `<p>Следующий говорит «Верю» и докладывает свои 1–4 карты под тот же ранг (тоже можно соврать). Проверять теперь будут уже его.
          Стопка растёт, пока кто-нибудь не скажет «Не верю».</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10S 10H JC 7D', 'KH 6D 10C', '7C 8H 9S']),
          steps: [A(0, { type: 'lead', cards: L('10S 10H JC'), rank: 10 }, '«Три десятки».'), A(1, { type: 'add', cards: L('10C') }, 'Ленка: «Верю, и ещё одна десятка» — честно.')],
        },
      },
      {
        title: 'Не верю!',
        html: `<p>Не поверил — говори «Не верю!»: открываются карты <b>предыдущего</b>. Есть хоть одна не того ранга — врун забирает всю стопку себе.
          Всё честно — стопку забирает тот, кто не поверил. Следующий заход — за тем, кто оказался прав.</p>
          <p>Считайте: в колоде всего четыре карты каждого ранга, а несколько из них могут быть у вас на руке.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10S 10H JC 7D', 'KH 6D 10C', '7C 8H 10D']),
          steps: [
            A(0, { type: 'lead', cards: L('10S 10H JC'), rank: 10 }, '«Три десятки».'),
            A(1, { type: 'add', cards: L('10C') }, '«Верю, и ещё одна» — уже четыре десятки…'),
            A(2, { type: 'check' }, '…а у Серёги на руке пятая! «Не верю!» Но Ленка положила честную десятку — стопка уходит Серёге.'),
          ],
        },
      },
      {
        title: 'Четвёрки и конец',
        html: `<p>Собрал на руке все четыре карты одного ранга — они сразу уходят в отбой в открытую. Избавился от всех карт, и тебя не поймали —
          вышел из игры. Последний, у кого остались карты, — проиграл («брехун»).</p>
          <p>Варианты: при «Не верю» открывают одну карту наугад; или без подкладывания — «Верю» сразу отправляет стопку в отбой.</p>`,
      },
    ],
  },
};
