/* Козёл (карточный) — описание игры для сборника: козырь по последней карте или всегда трефы, обязанность козырять, до 12 «рогов»,
 * 36 или 32 карты. Ровно 4 игрока пара на пару; боты с «смазкой», правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#c0452f', light: '#e57a5f', dark: '#6e2414' },
  { name: 'Танька', color: '#2b7aa0', light: '#5fb0d8', dark: '#16405a' },
];

export const pairName = (t: number, name: (seat: number) => string) => `${name(t)} и ${name(t + 2)}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}. Козырь — ${SUIT_NAME[ev.trump]} ${SUIT_SYM[ev.trump]}.`;
    case 'trick':
      return ev.pts >= 20 ? `${name(ev.seat)} берёт взятку на ${ev.pts}.` : null;
    case 'round':
      if (ev.eggs) return `«Яйца»: ${ev.pts[0]} на ${ev.pts[1]}. Следующий кон — вдвойне.`;
      return `Очки: ${pairName(0, name)} — ${ev.pts[0]}, ${pairName(1, name)} — ${ev.pts[1]}. Рога: ${ev.add[0] ? pairName(0, name) : pairName(1, name)} +${Math.max(...ev.add)}.`;
    case 'end':
      return `🐐 ${pairName(ev.loser, name)} — козлы! (${ev.horns[ev.loser]})`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], trump: Suit, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2, 3]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.trump = trump;
  s.round = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'kozel',
  title: 'Козёл',
  players: { min: 4, max: 4, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'trump',
      label: 'Козырь',
      type: 'select',
      choices: [
        { value: 'last', label: 'по последней карте сдатчика' },
        { value: 'clubs', label: 'всегда трефы' },
      ],
      default: 'last',
    },
    { key: 'force', label: 'Обязан козырять', type: 'toggle', default: true, hint: 'Нет масти — бей козырем. Выключено — можно снести любую.' },
    {
      key: 'limit',
      label: 'До скольких рогов',
      type: 'select',
      choices: [
        { value: 6, label: 'до 6 — быстро' },
        { value: 12, label: 'до 12' },
        { value: 24, label: 'до 24 — долгая' },
      ],
      default: 12,
    },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт, по 9' },
        { value: 32, label: '32 карты, по 8' },
      ],
      default: 36,
    },
  ],
  presets: [
    { id: 'classic', label: 'Дворовый', hint: 'Козырь по последней карте, до 12', options: { trump: 'last', force: true, limit: 12, deck: 36 } },
    { id: 'clubs', label: 'Трефы — козырь', hint: 'Постоянный козырь', options: { trump: 'clubs', force: true, limit: 12, deck: 36 } },
    { id: 'short', label: '32 карты', hint: 'Без шестёрок, по 8', options: { trump: 'last', force: true, limit: 12, deck: 32 } },
    { id: 'quick', label: 'Быстрый', hint: 'До 6 рогов', options: { trump: 'last', force: true, limit: 6, deck: 36 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const lose = s.horns[0] >= s.cfg.limit ? 0 : 1;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = -s.horns[p % 2];
    return { winners: s.seats.filter((p) => p % 2 !== lose), text: 'соперники сварили козла', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(
      pos(['JC AS 10D KH 7C 9S', 'QD 8S 6H 10C 9D', 'AH JD 7S QS 8C', '10S KC 6D 9H AD'], 'D', {
        trick: [
          { seat: 1, card: C('AC') },
          { seat: 2, card: C('QH') },
          { seat: 3, card: C('JS') },
        ],
        pts: [34, 21],
        tricks: [1, 1, 1, 0],
        horns: [4, 6],
      }),
      [0]
    ),

  rules: {
    goal: 'Вдвоём с напарником набрать во взятках больше 60 очков из 120. Проигравшей паре — «рога»; кто набрал 12 — «сварил козла».',
    sections: [
      {
        title: 'Пары и козыри',
        html: `<p>Четверо, напарники сидят друг напротив друга. По 9 карт, козырь — масть последней карты сдатчика.</p>
          <p><b>Вальты</b> — всегда старшие козыри: трефовый, пиковый, червовый, бубновый. За ними <b>дамы</b> в том же порядке. Потом карты козырной
          масти: туз, <b>десятка</b>, король, 9, 8, 7, 6. Вальты и дамы — не своей масти, а козыри.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>В масть ходить обязательно. Нет масти — <b>обязан бить козырем</b> (вальтом, дамой или козырной картой). Нет и козыря — сносишь любую.
          Взятку берёт старший козырь, а без козырей — старшая карта масти захода.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS 7C', '10S 8C', 'JD 9H', 'JC 6H'], 'D'),
          intro: 'Козырь — бубны.',
          steps: [
            P(0, 'AS', 'Вовка заходит тузом пик.'),
            P(1, '10S', 'Ленка обязана в масть — отдаёт десятку.'),
            P(2, 'JD', 'У Серёги пик нет — бьёт бубновым вальтом.'),
            P(3, 'JC', 'Но Танька кроет трефовым вальтом — старшая карта игры! Взятка паре Ленки и Таньки: 11 + 10 + 2 + 2.'),
          ],
        },
      },
      {
        title: 'Счёт',
        html: `<p>Туз — 11, десятка — 10, король — 4, дама — 3, валет — 2. Набрала пара 61 и больше — выиграла кон. Проигравшим: <b>2</b> рога,
          если у них 31–59; <b>4</b> — если 30 и меньше; <b>6</b> — если ни одной взятки. 60 на 60 — «яйца»: никому, следующий кон вдвойне.</p>
          <p>Хитрость — «смазка»: когда взятку держит напарник, подкладывай ему туза или десятку.</p>`,
      },
    ],
  },
};
