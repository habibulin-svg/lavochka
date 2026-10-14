/* Расписной покер — описание игры для сборника: заказ взяток по расписанию сдач, джокер, особые сдачи.
 * 3–6 игроков; варианты: грузинский, круговые козыри, лобовая, 54 карты. Боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, cur, isJoker, KIND_NAME, makeView, newState, setup, toAct, winnersOf, type Action, type Cfg, type Event, type JokerPlay, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3d9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Олька', color: '#c25a8a', light: '#e48cb4', dark: '#6e2a4a' },
];

export const trumpName = (s: Suit | null) => (s ? `козыри — ${SUIT_NAME[s]} ${SUIT_SYM[s]}` : 'без козыря');
const GEN: Record<Suit, string> = { S: 'пикам', C: 'трефам', D: 'бубнам', H: 'червям' };
const GEN1: Record<Suit, string> = { S: 'пика', C: 'трефа', D: 'бубна', H: 'черва' };

/** Как прозвучало объявление джокера. */
export function jokerSay(j: JokerPlay | undefined, trump: Suit | null): string {
  if (!j) return '';
  if (j.mode === 'high') return 'забираю!';
  if (j.mode === 'want') return j.suit === trump ? 'по старшим козырям!' : `по старшим ${GEN[j.suit]}!`;
  return j.suit ? `за младшую — ${GEN1[j.suit]}` : 'скидываю';
}

export const jokerLabel = (cfg: Cfg) => (cfg.deck === 54 ? 'два джокера' : `джокер — ${cfg.joker === 6 ? 'шестёрка' : 'семёрка'} пик`);

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal + 1}: <b>${KIND_NAME[ev.kind]}</b>, по ${ev.cards} ${ev.cards === 1 ? 'карте' : 'карты'}, сдаёт ${name(ev.dealer)}.`;
    case 'bid':
      return `${name(ev.seat)}: ${ev.n ? `заказ ${ev.n}` : 'пас'}.`;
    case 'play':
      return ev.joker ? `${name(ev.seat)} — джокер: ${jokerSay(ev.joker, null)}` : null;
    case 'round':
      return ev.add.map((x, i) => ({ x, i })).filter((o) => o.x).map((o) => `${name(o.i)} ${o.x > 0 ? '+' : ''}${o.x}`).join(', ') + '.';
    case 'end':
      return `🏁 Партия окончена. Больше всех у ${ev.winners.map(name).join(', ')}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2, 3]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.dealer = 3;
  s.turn = 0;
  s.phase = 'play';
  s.trump = 'H';
  s.trumpCard = C('9H');
  s.deal = 1;
  return Object.assign(s, extra);
}
const P = (seat: number, card: string, caption?: string, joker?: JokerPlay) => ({ seat, action: { type: 'play', card: C(card), joker } as Action, caption });
const B = (seat: number, n: number, caption?: string) => ({ seat, action: { type: 'bid', n } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'raspisnoy',
  title: 'Расписной покер',
  players: { min: 3, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт, джокер — простая карта' },
        { value: 54, label: '54 карты, два джокера' },
      ],
      default: 36,
    },
    {
      key: 'joker',
      label: 'Джокер в 36 картах',
      type: 'select',
      choices: [
        { value: 7, label: 'семёрка пик' },
        { value: 6, label: 'шестёрка пик' },
      ],
      default: 7,
    },
    {
      key: 'specials',
      label: 'Особые сдачи',
      type: 'select',
      choices: [
        { value: 'circle', label: 'тёмная, бескозырка, золотая, мизер — по кругу' },
        { value: 'one', label: 'каждая по разу' },
        { value: 'none', label: 'без особых' },
      ],
      default: 'circle',
    },
    { key: 'lob', label: 'Лобовая в конце', type: 'toggle', default: false, hint: 'По одной карте: свою не видишь, чужие видишь.' },
    { key: 'free', label: 'Сдающий заказывает что угодно', type: 'toggle', default: false, hint: 'Редкое правило: сумма заказов может совпасть с числом карт.' },
    { key: 'circular', label: 'Круговые козыри', type: 'toggle', default: false, hint: 'Козырь каждой взятки — масть, следующая за мастью захода.' },
    { key: 'georgian', label: 'Грузинский счёт', type: 'toggle', default: false, hint: 'Свои сдачи (до 8, по 9 дважды по кругу) и счёт заказ×50+50.' },
  ],
  presets: [
    { id: 'classic', label: 'Расписной', hint: '36 карт, джокер — семёрка пик, особые сдачи по кругу', options: { deck: 36, joker: 7, specials: 'circle', lob: false, free: false, circular: false, georgian: false } },
    { id: 'short', label: 'Короткий', hint: 'Особые сдачи — по разу', options: { deck: 36, joker: 7, specials: 'one', lob: false, free: false, circular: false, georgian: false } },
    { id: 'lob', label: 'С лобовой', hint: 'В конце — лобовая: карта на лбу', options: { deck: 36, joker: 7, specials: 'one', lob: true, free: false, circular: false, georgian: false } },
    { id: 'circular', label: 'Круговые козыри', hint: 'Козырь — масть после масти захода', options: { deck: 36, joker: 7, specials: 'one', lob: false, free: false, circular: true, georgian: false } },
    { id: 'georgian', label: 'Грузинский', hint: '54 карты, дважды по 9, заказ×50+50', options: { deck: 54, joker: 7, specials: 'none', lob: false, free: false, circular: false, georgian: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
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
      pos(['7S AH 10D QC JC 8H', 'KS 9D 8C 6H 10S JD', 'AS QD 9C 7H AC 6D', 'QS KD 10C 8D 9S KC'], {
        deal: 12,
        bids: [2, 1, 0, 2, null, null],
        tricks: [1, 0, 0, 1, 0, 0],
        trick: [
          { seat: 1, card: C('KH') },
          { seat: 2, card: C('10H') },
          { seat: 3, card: C('JH') },
        ],
        turn: 0,
        score: [64, 41, 25, 52, 0, 0],
      }),
      [0]
    ),

  rules: {
    goal: 'Набрать больше всех очков: в каждой сдаче заказать, сколько возьмёшь взяток, — и взять ровно столько.',
    sections: [
      {
        title: 'Расписание',
        html: `<p>Колода 36 карт; одна из них — <b>джокер</b> (обычно семёрка пик). Сдают по кругу: сперва по 1 карте, потом по 2, по 3…
          до максимума (вчетвером — 9), максимум — столько раз, сколько игроков, потом обратно до 1. Затем <b>особые сдачи</b>.</p>
          <p>Козырь — верхняя карта остатка колоды. Раздали всю колоду или открылся джокер — играют без козыря.</p>
          <p>Таблицу с заказами и очками ведут на бумажке — отсюда и «расписной».</p>`,
      },
      {
        title: 'Заказ',
        html: `<p>Первым заказывает левый от сдающего: сколько взяток возьмёт, от паса (0) до числа карт. <b>Сдающий</b> заказывает последним
          и не имеет права сделать так, чтобы сумма заказов совпала с числом карт: кто-нибудь обязательно ошибётся.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH 7S KC', 'QH 9D 8S', '10H AC JD', 'KD 9C 6S'], { phase: 'bid', plan: [{ kind: 'up', cards: 3 }, { kind: 'up', cards: 3 }] }),
          intro: 'Сдача по 3 карты, козыри — червы.',
          steps: [B(0, 2, 'Вовка: у него джокер и туз козырей — заказ 2.'), B(1, 0, 'Ленка пасует.'), B(2, 1, 'Серёга заказывает одну — на туза треф.'), B(3, 1, 'Танька сдаёт: 0 нельзя (2+0+1=3 карты), заказывает одну.')],
        },
      },
      {
        title: 'Ход',
        html: `<p>Ходить в масть; нет масти — <b>обязан бить козырем</b>; нет и козырей — любую карту. Козырем при масти бить нельзя.
          Взявший взятку заходит следующим.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AC 8D', 'QC 9H', '6H 10S', 'KC 7D']),
          steps: [P(0, 'AC', 'Вовка заходит тузом треф.'), P(1, 'QC', 'Ленка — в масть.'), P(2, '6H', 'У Серёги треф нет — он обязан козырнуть, и шестёрка червей бьёт туза!'), P(3, 'KC', 'Танька кладёт короля. Взятка Серёги.')],
        },
      },
      {
        title: 'Джокер',
        html: `<p>Джокер можно положить всегда — на него не действует правило масти. Заходя с джокера, говорят:</p>
          <p><b>«По старшим козырям!»</b> (или «по старшим пикам…») — все обязаны отдать свою старшую карту этой масти, нет её — козырь,
          нет и его — любую. Взятку берёт джокер, если её не перебили козырем. <b>«За младшую»</b> — джокер идёт самой младшей картой
          названной масти, чтобы не брать.</p>
          <p>Не на заходе джокер либо <b>забирает</b> взятку (старше всего), либо <b>скидывается</b> (младше всего).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['7S 6C', 'KH 8H', 'AD 10H', 'QH 9C']),
          steps: [
            P(0, '7S', 'Вовка заходит джокером (семёрка пик): «По старшим козырям!»', { mode: 'want', suit: 'H' }),
            P(1, 'KH', 'Ленка обязана отдать старший козырь — короля.'),
            P(2, '10H', 'Серёга — свою десятку червей.'),
            P(3, 'QH', 'Танька — даму. Джокер забирает взятку и выбивает старшие козыри.'),
          ],
        },
      },
      {
        title: 'Очки',
        html: `<p><b>Взял ровно заказ</b> — по 10 очков за взятку; пас и ни одной взятки — 5. <b>Перебор</b> — всего по 1 очку за взятку.
          <b>Недобор</b> — минус 10 за каждую недобранную.</p>`,
      },
      {
        title: 'Особые сдачи',
        html: `<p><b>Тёмная</b> — заказывают, не глядя в карты; очки вдвое. <b>Бескозырка</b> — без козыря, очки вдвое.
          <b>Золотая</b> — без заказа, каждая взятка +20. <b>Мизер</b> — без заказа, каждая взятка −20.</p>
          <p><b>Лобовая</b> (вариант): по одной карте, свою не видишь — видишь чужие («карта на лбу»). Взятка по заказу — 50, недобор — −50.</p>`,
      },
      {
        title: 'Варианты',
        html: `<p><b>Круговые козыри</b>: козырь каждой взятки — масть, следующая за мастью захода (♠→♣→♦→♥→♠).</p>
          <p><b>Грузинский</b>: 54 карты с двумя джокерами, сдачи до 8 (вшестером до 6), по 9 карт по кругу, вниз до 1 и снова по 9 по кругу.
          Точный заказ — заказ×50+50, мимо — по 10 за взятку.</p>`,
      },
    ],
  },
};

/** Подпись сдачи для таблички. */
export function dealTitle(v: View): string {
  const d = cur(v);
  return `${KIND_NAME[d.kind]} · по ${d.cards}`;
}

export { isJoker };
