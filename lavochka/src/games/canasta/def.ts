/* Канаста — описание игры для сборника: вчетвером пара на пару или вдвоём; до 5000 или 2500. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, teamOf, toAct, type Action, type CCard, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Эстер', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Хуан', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Лусия', color: '#c84a1a', light: '#f08050', dark: '#7a2a0a' },
  { name: 'Педро', color: '#1f5a9a', light: '#5a8ad0', dark: '#0f2a5a' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В', 15: '★' };
export const cn = (c: CCard) => (c.r === 15 ? '<b>★</b>' : `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`);
export const RANK_RU: Record<number, string> = { 3: 'тройки', 4: 'четвёрки', 5: 'пятёрки', 6: 'шестёрки', 7: 'семёрки', 8: 'восьмёрки', 9: 'девятки', 10: 'десятки', 11: 'вальты', 12: 'дамы', 13: 'короли', 14: 'тузы' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}, в сбросе — ${cn(ev.up)}.`;
    case 'red3':
      return `${name(ev.seat)}: красная тройка ${cn(ev.card)} — премия.`;
    case 'pile':
      return `${name(ev.seat)} берёт колоду сброса (${ev.n}) с ${cn(ev.top)}.`;
    case 'meld':
      return `${name(ev.seat)}: ${RANK_RU[ev.rank]} ${ev.cards.map(cn).join(' ')}${ev.canasta ? ' — <b>канаста!</b>' : ''}`;
    case 'hand':
      return `Сдача${ev.out != null ? ` — вышел ${name(ev.out)}` : ''}: ${ev.add.map((x) => (x > 0 ? '+' : '') + x).join(' : ')}. Счёт ${ev.score.join(' : ')}.`;
    case 'end':
      return `🏁 Партия: ${ev.winner === 0 ? 'пара 1' : 'пара 2'} — ${ev.score[ev.winner]}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'draw' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string, d = 0): CCard => (t === 'JK' ? { s: 'H', r: 15, d } : { s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)), d });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map((x) => C(x.replace("'", ''), x.endsWith("'") ? 1 : 0));

function pos(hands: string[], pile: string, opts: Options = {}, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.stock = L("4C' 5C' 6C' 7C' 8C' 9C' 10C' JC' QC' KC'");
  s.pile = L(pile);
  s.deal = 1;
  s.turn = 0;
  s.phase = 'draw';
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'canasta',
  title: 'Канаста',
  players: { min: 2, max: 4, default: 4 },
  countsFor: () => [2, 4],
  teams: (_o, seats) => (seats.length === 4 ? [[seats[0], seats[2]], [seats[1], seats[3]]] : null),
  seats: SEATS,
  options: [
    {
      key: 'target',
      label: 'До скольких',
      type: 'select',
      choices: [
        { value: 5000, label: 'до 5000' },
        { value: 2500, label: 'до 2500 — быстрее' },
      ],
      default: 5000,
    },
  ],
  presets: [
    { id: 'classic', label: 'Канаста', hint: 'Вчетвером пара на пару, до 5000', options: { target: 5000 } },
    { id: 'quick', label: 'До 2500', hint: 'Короткая партия', options: { target: 2500 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const winners = s.seats.filter((x) => teamOf(s, x) === s.winner);
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[teamOf(s, x)];
    return { winners, text: `${s.score[s.winner]} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(['KH KS 9D 9C 9H 5S 2C JK 7D 7H AC', 'QH QS 6D 6C 4H 4D 10S 10C 8H JD 3S'], 'QD 8S 4C', {}, {
      phase: 'play',
      melds: [
        [{ rank: 14, cards: L("AH AS AD AC' 2H JK'") }, { rank: 10, cards: L('10H 10D 10S') }],
        [{ rank: 12, cards: L("QC QH' QS' JK") }],
      ],
      red3: [L('3H'), []],
      opened: [true, true],
      score: [1240, 860],
    }),

  rules: {
    goal: 'Собирать канасты — комбинации из семи карт одного достоинства — и первыми набрать 5000 очков.',
    sections: [
      {
        title: 'Карты',
        html: `<p>Две колоды и четыре джокера. Вчетвером играют пара на пару (напарники напротив), по 11 карт; вдвоём — по 15.
          <b>Двойки и джокеры — дикие</b>: заменяют любую карту. <b>Красная тройка</b> сразу выкладывается (премия 100, все четыре — 800), вместо неё берут карту.
          <b>Чёрная тройка</b> — стопор: сверху колоды сброса её взять нельзя.</p>`,
      },
      {
        title: 'Комбинации и канаста',
        html: `<p>Комбинация — три и больше карт одного достоинства: натуральных не меньше двух и больше, чем диких (диких — не больше трёх). Комбинации у пары общие.
          <b>Канаста</b> — 7 карт: «чистая», без диких, — 500, «грязная» — 300. Очки карт: джокер 50, двойка и туз 20, король–восьмёрка 10, семёрка–четвёрка 5.</p>
          <p>Первая выкладка пары — на минимум по её счёту: при отрицательном — 15, до 1500 — 50, до 3000 — 90, дальше — 120.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['KH KS KD 9D 9C 2H 7D 7H AC', 'QH QS 6D 6C 4H 4D 10S 10C 8H'], '5D', {}, { phase: 'play' }),
          steps: [A(0, { type: 'meld', groups: [{ rank: 13, cards: L('KH KS KD') }, { rank: 9, cards: L('9D 9C 2H') }] }, 'Эстер выкладывает трёх королей и две девятки с двойкой: 30 + 40 = 70, минимум 50 есть.')],
        },
      },
      {
        title: 'Колода сброса',
        html: `<p>Вместо карты из колоды можно взять <b>всю колоду сброса</b>, если верхнюю карту сразу выложить: с двумя натуральными той же масти с руки.
          Если пара уже выложилась и в сбросе нет диких, хватит одной натуральной и дикой — или можно доложить верхнюю к своей комбинации.
          Дикая карта в сбросе его «замораживает».</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['KH KS 9D 9C 9H 7D 7H AC', 'QH QS 6D 6C 4H 4D 10S 10C 8H'], '5S 8C 4D KD'),
          steps: [A(0, { type: 'pile', cards: L('KH KS 9D 9C 9H') }, 'Сверху король: Эстер кладёт к нему двух своих королей и три девятки (30 + 40 = 70) — и забирает весь сброс.')],
        },
      },
      {
        title: 'Выход и счёт',
        html: `<p>Выйти — избавиться от всех карт — можно, только если у пары есть канаста (вдвоём — две). За выход 100, а если всё выложили одним ходом — 200.
          Счёт: очки карт в комбинациях, канасты, красные тройки, выход — минус карты, оставшиеся на руках. Красные тройки у пары, которая так и не выложилась, — в минус. Партия — до 5000.</p>`,
      },
    ],
  },
};
