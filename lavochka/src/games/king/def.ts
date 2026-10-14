/* Кинг — описание игры для сборника: строгий или заказной, 32 или 36 карт, с положительными сдачами или без.
 * Ровно 4 игрока; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, CONTRACT_NAME, makeView, newState, setup, toAct, winnersOf, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

export const trumpName = (s: Suit | null) => (s ? `козыри — ${SUIT_NAME[s]} ${SUIT_SYM[s]}` : 'бескозырка');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'contract':
      return `Сдача: <b>${CONTRACT_NAME[ev.contract]}</b>${ev.contract !== 'plus' ? ` (сдаёт ${name(ev.seat)})` : ''}.`;
    case 'trump':
      return `${name(ev.seat)} назначает: ${trumpName(ev.suit)}.`;
    case 'trick':
      return ev.pts < 0 ? `${name(ev.seat)} берёт взятку: ${ev.pts}.` : null;
    case 'round':
      return `${ev.early ? 'Всё штрафное взято — сдача окончена. ' : ''}${ev.add.map((x, i) => (x ? `${name(i)} ${x > 0 ? '+' : ''}${x}` : '')).filter(Boolean).join(', ') || 'Никому ничего'}.`;
    case 'end':
      return `🏁 Партия окончена. Больше всех у ${ev.winners.map(name).join(', ')}.`;
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

function pos(hands: string[], extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2, 3]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.deal = 1;
  s.dealer = 3;
  s.turn = 0;
  return Object.assign(s, extra);
}
const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'king',
  title: 'Кинг',
  players: { min: 4, max: 4, default: 4 },
  seats: SEATS,
  options: [
    { key: 'ordered', label: 'Заказной', type: 'toggle', default: false, hint: 'Сдающий, посмотрев карты, сам выбирает, какую из оставшихся «не брать» играть.' },
    {
      key: 'plus',
      label: 'Положительные сдачи',
      type: 'select',
      choices: [
        { value: 4, label: 'четыре «брать» — каждый назначает козырь' },
        { value: 0, label: 'без них — только «не брать»' },
      ],
      default: 4,
    },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 32, label: '32 карты, по 8' },
        { value: 36, label: '36 карт, по 9' },
      ],
      default: 32,
    },
  ],
  presets: [
    { id: 'strict', label: 'Строгий', hint: 'Семь «не брать» по порядку, потом четыре «брать»', options: { ordered: false, plus: 4, deck: 32 } },
    { id: 'ordered', label: 'Заказной', hint: 'Сдающий выбирает контракт по своим картам', options: { ordered: true, plus: 4, deck: 32 } },
    { id: 'minus', label: 'Только минусы', hint: 'Семь сдач «не брать»', options: { ordered: false, plus: 0, deck: 32 } },
    { id: 'yard', label: 'На 36 картах', hint: 'Дворовая колода, по 9 карт', options: { ordered: false, plus: 4, deck: 36 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.score[p];
    return { winners: winnersOf(s), text: 'больше всех очков', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(
      pos(['AS 9S 7D QD 10C 8H 7C', '10S 8D KC 9C JH QH 7S', 'JS AD 9D 8C AC 7H 9H', 'QS KS 10D JD JC 10H AH'], {
        contract: 'king',
        used: ['tricks', 'hearts', 'boys', 'girls', 'last2', 'king'],
        deal: 6,
        played: 1,
        trick: [
          { seat: 1, card: C('KD') },
          { seat: 2, card: C('KH') },
          { seat: 3, card: C('8S') },
        ],
        score: [-12, -26, -8, -18],
        tricks: [1, 0, 0, 0],
      }),
      [0]
    ),

  rules: {
    goal: 'Набрать больше всех очков за 11 сдач: в семи «не брать» — избегать штрафных карт, в четырёх «брать» — набрать побольше взяток.',
    sections: [
      {
        title: 'Сдачи',
        html: `<p>Четверо, каждый за себя, 32 карты по 8. Сдачи по порядку:</p>
          <p><b>Не брать взяток</b> — −2 за каждую; <b>не брать червей</b> — −2 за черву; <b>мальчиков</b> — −4 за валета;
          <b>девочек</b> — −4 за даму; <b>две последние</b> — по −8; <b>кинга</b> — −16 за короля червей; <b>ералаш</b> — всё сразу.</p>
          <p>Потом четыре сдачи <b>«брать»</b>: сдающий по очереди назначает козырь (или бескозырку), каждая взятка +6.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>В масть ходить обязательно; нет масти — сброс любой карты (в «брать» — обязан бить козырем). На «червях», «кинге» и «ералаше»
          с червей не заходят, пока есть другие масти.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10S 7D', 'AS 7S', 'QH 8D', 'KS 9D'], { contract: 'girls', used: ['tricks', 'hearts', 'boys', 'girls'] }),
          intro: 'Сдача «не брать девочек».',
          steps: [P(0, '10S', 'Вовка заходит десяткой пик.'), P(1, '7S', 'У Ленки туз и семёрка — она осторожно кладёт семёрку.'), P(2, 'QH', 'У Серёги пик нет — он с удовольствием сносит даму червей.'), P(3, 'KS', 'Танька обязана в масть — король берёт взятку и даму: −4.')],
        },
      },
      {
        title: 'Кинг',
        html: `<p>На сдаче «не брать кинга» король червей стоит −16. Нет масти захода — <b>обязан</b> сбросить короля червей, если он у тебя.
          Как только король взят, сдача кончается. Так же «черви», «мальчики» и «девочки» кончаются, когда взято всё штрафное.</p>
          <p><b>Заказной кинг</b>: сдающий, посмотрев карты, сам выбирает, какую из ещё не сыгранных «не брать» играть.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AD 7S', '10D 8S', 'KH 9S', '7D 10S'], { contract: 'king', used: ['tricks', 'hearts', 'boys', 'girls', 'last2', 'king'] }),
          steps: [P(0, 'AD', 'Вовка заходит тузом бубен.'), P(1, '10D', 'Ленка — в масть.'), P(2, 'KH', 'У Серёги бубен нет — он обязан сбросить кинга!'), P(3, '7D', 'Туз Вовки берёт взятку с кингом: −16, сдача окончена.')],
        },
      },
    ],
  },
};
