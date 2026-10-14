/* Храп — описание игры для сборника: одна карточка, пресеты Храп / Рамс / Горб; 2–6 игроков; банк из спичек; боты; правила
 * с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, KHRAP_PAY, makeView, maxPlayers, newState, setup, toAct, winners, type Action, type Bid, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

export const khrapWord = (s: { cfg: { mode: string } }) => (s.cfg.mode === 'rams' ? 'Рамс' : 'Храп');
export const BID_NAME: Record<Bid, string> = { play: 'играю', pass: 'пас', khrap: 'храп!', widow: 'беру лапу' };
const spichek = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'спичка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'спички' : 'спичек'}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.round}. Козырь — ${SUIT_NAME[ev.trump]} ${SUIT_SYM[ev.trump]}${ev.bank ? `, в банке ${spichek(ev.bank)}` : ''}.`;
    case 'bid':
      return `${name(ev.seat)}: «${ev.bid === 'khrap' ? 'Храп!' : BID_NAME[ev.bid]}»`;
    case 'swap':
      return ev.count ? `${name(ev.seat)} меняет ${ev.count}` : `${name(ev.seat)} не меняет`;
    case 'alone':
      return ev.seat != null ? `${name(ev.seat)} играет один — забирает банк (${spichek(ev.bank)}).` : 'Все спасовали — банк ждёт следующей сдачи.';
    case 'settle': {
      const parts = ev.gains.map((g, p) => (g ? `${name(p)} ${g > 0 ? '+' : ''}${g}` : '')).filter(Boolean);
      const sat = ev.sat.length ? ` Сели: ${ev.sat.map(name).join(', ')}.` : '';
      const kh = ev.khrap != null ? ` Храп ${ev.khrapOk ? 'взят' : 'не взят'}!` : '';
      return `Расчёт: ${parts.join(', ') || 'никому'}.${kh}${sat}`;
    }
    case 'gorb': {
      const g = ev.add.map((x, p) => (x > 0 ? `${name(p)} — горб` : x < 0 ? `${name(p)} снимает горб` : '')).filter(Boolean);
      return g.length ? g.join(', ') + '.' : 'Без горбов.';
    }
    case 'end':
      return `🏁 Победа: ${ev.winners.map(name).join(', ')}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'swap' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  if (ev.type === 'bid' && !seats.includes(ev.seat)) return { ...ev, hand: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(mode: string, hands: string[], trump: string, deck: string, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({ mode }), [0, 1, 2]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.trumpCard = C(trump);
  s.trump = s.trumpCard.s;
  s.deck = [...L(deck), s.trumpCard];
  s.round = 1;
  s.dealer = 2;
  s.turn = 0;
  s.bank = 3;
  s.chips = [19, 19, 19, 19, 19, 19];
  if (mode === 'rams') s.widow = L('AC 10C 10H 7C 7D');
  if (mode === 'gorb') {
    s.phase = 'play';
    s.inPlay = [true, true, true, false, false, false];
  }
  return Object.assign(s, extra);
}
const B = (seat: number, bid: Bid, caption?: string) => ({ seat, action: { type: 'bid', bid } as Action, caption });
const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });
const S = (seat: number, cards: string, caption?: string) => ({ seat, action: { type: 'swap', cards: L(cards) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'khrap',
  title: 'Храп',
  players: { min: 2, max: 6, default: 4 },
  countsFor: (o) => [2, 3, 4, 5, 6].filter((n) => n <= maxPlayers(cfgFrom(o))),
  countsHint: (o) => (cfgFrom(o).mode === 'rams' ? 'в рамсе — не больше пятерых' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'khrap', label: 'Храп — по 4, обмен, храп' },
        { value: 'rams', label: 'Рамс — по 5, лапа, перебивать' },
        { value: 'gorb', label: 'Горб — по 3, играют все' },
      ],
      default: 'khrap',
    },
    { key: 'strict', label: 'Обязан перебивать', type: 'toggle', default: false, hint: 'В масть — старшей, если есть; козырем — старше лежащего. В рамсе включено.', showIf: (o) => o.mode !== 'rams' },
    {
      key: 'stake',
      label: 'Спичек у каждого',
      type: 'select',
      choices: [
        { value: 10, label: '10 — быстро' },
        { value: 20, label: '20' },
        { value: 30, label: '30 — долго' },
      ],
      default: 20,
      showIf: (o) => o.mode !== 'gorb',
    },
    {
      key: 'limit',
      label: 'До скольких горбов',
      type: 'select',
      choices: [
        { value: 3, label: 'до 3' },
        { value: 5, label: 'до 5' },
        { value: 7, label: 'до 7' },
      ],
      default: 5,
      showIf: (o) => o.mode === 'gorb',
    },
  ],
  presets: [
    { id: 'khrap', label: 'Храп', hint: 'По 4 карты, смена до трёх, «храп» — все взятки', options: { mode: 'khrap', strict: false, stake: 20 } },
    { id: 'rams', label: 'Рамс', hint: '32 карты, по 5, лапа, обязан перебивать', options: { mode: 'rams', stake: 20 } },
    { id: 'gorb', label: 'Горб', hint: 'По 3, играют все: без взятки — горб', options: { mode: 'gorb', strict: false, limit: 5 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.cfg.mode === 'gorb' ? -s.gorbs[p] : s.chips[p];
    const w = winners(s);
    return { winners: w, text: s.cfg.mode === 'gorb' ? `меньше всех горбов — ${s.gorbs[w[0]]}` : `${spichek(s.chips[w[0]])}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos('khrap', ['AS 10S KH 7C', 'QD 9S 8H', 'JS 6H 9D', 'KS QC AD'], 'QH', '7D 8D', { phase: 'play', bank: 7 });
    s.seats = [0, 1, 2, 3];
    s.inPlay = [true, true, true, true, false, false];
    s.trick = [
      { seat: 1, card: C('AC') },
      { seat: 2, card: C('10C') },
      { seat: 3, card: C('9C') },
    ];
    s.tricks = [0, 0, 1, 0, 0, 0];
    s.chips = [17, 24, 15, 21, 20, 20];
    s.bids = ['play', 'play', 'play', 'play', null, null];
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Брать взятки и забирать за них долю банка. Взялся играть и не взял ни одной — «сел»: плати банк. У кого кончились спички — партия окончена, побеждает самый богатый.',
    sections: [
      {
        title: 'Сдача и торговля',
        html: `<p>Перед сдачей каждый кладёт в банк спичку. Храп: 36 карт, по 4, следующая карта открыта — козырь.</p>
          <p>По кругу слева от сдающего: <b>«играю»</b> — обязуюсь взять хоть одну взятку; <b>«пас»</b> — карты в сторону, ничем не рискую.
          Играющие могут сменить до трёх карт из колоды (последним идёт открытый козырь). Сыграл один — банк его без игры.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('khrap', ['AH 10S 7C 8D', '9S 6C 7D JS', 'KH QS 9C 6D'], 'QH', 'AD 10H KC 8S 9D'),
          intro: 'Козырь — черви. В банке три спички.',
          steps: [
            B(0, 'play', 'У Вовки туз козырей — «играю».'),
            B(1, 'pass', 'У Ленки пусто — «пас».'),
            B(2, 'play', 'Серёга с королём козырей — тоже играет.'),
            S(0, '7C 8D', 'Вовка меняет две мелкие — приходят туз бубен и десятка червей.'),
            S(2, '6D', 'Серёга меняет шестёрку.'),
          ],
        },
      },
      {
        title: 'Розыгрыш',
        html: `<p>В масть ходить обязательно. Нет масти — <b>обязан козырять</b>; нет и козырей — любую карту. Взятку берёт старший козырь,
          без козырей — старшая карта масти захода. Порядок: туз, король, дама, валет, 10 … 6.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('khrap', ['AS 7H', '10S 8C', 'KD 9C'], 'QH', '', { phase: 'play', inPlay: [true, true, true, false, false, false] }),
          intro: 'Козырь — черви.',
          steps: [P(0, 'AS', 'Вовка заходит тузом пик.'), P(1, '10S', 'Ленка обязана в масть.'), P(2, 'KD', 'У Серёги ни пик, ни червей — сносит любую. Взятка Вовке.')],
        },
      },
      {
        title: 'Расчёт и «сел»',
        html: `<p>Каждая взятка — доля банка (при четырёх картах — четверть). Играл и <b>не взял ни одной</b> — «сел»: кладёт в банк столько,
          сколько в нём было. Банк растёт, следующая сдача дороже.</p>
          <p><b>«Храп!»</b> — заявка взять все взятки. После неё играют все, никто не пасует. Взял все — каждый платит храпящему по ${KHRAP_PAY} спичек,
          не взял — он платит каждому по ${KHRAP_PAY}.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('khrap', ['AH KH QH AS', '9S 6C 7D JS', '10C 8S 9C 6D'], 'JH', 'AD 10H KC 8D 7S'),
          intro: 'У Вовки три старших козыря и туз пик.',
          steps: [B(0, 'khrap', '«Храп!» — теперь играют все, а Вовка обязан взять все четыре взятки.')],
        },
      },
      {
        title: 'Рамс',
        html: `<p>32 карты, по 5, на стол кладут «лапу» — ещё пять карт рубашкой. Играющий может вместо своих карт <b>взять лапу</b> (одна на сдачу).
          Обмена нет, зато <b>обязан перебивать</b>: в масть — старшей картой, если есть; козырем — старше лежащего козыря.
          «Рамс!» — все пять взяток, как храп.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('rams', ['9S 8C 9D 10D JC', 'QS AH 8S 7H 9C', 'KS 10S QH JD 8D'], 'KH', '', { phase: 'play', inPlay: [true, true, true, false, false, false], cfg: cfgFrom({ mode: 'rams' }) }),
          intro: 'Козырь — черви, обязан перебивать.',
          steps: [P(0, '9S', 'Вовка заходит девяткой пик.'), P(1, 'QS', 'Ленка обязана перебить — дама, восьмёркой нельзя.'), P(2, 'KS', 'Серёга перебивает королём — десяткой нельзя.')],
        },
      },
      {
        title: 'Горб',
        html: `<p>По 3 карты, торговли нет — играют все, банка тоже нет. Не взял ни одной взятки — получаешь <b>горб</b>.
          Взял все три — горб снимается. Набрал пять горбов — проиграл.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => {
            const s = pos('gorb', ['AS', '7S', '9S'], 'QH', '');
            s.cfg = cfgFrom({ mode: 'gorb' });
            return s;
          },
          intro: 'Последняя взятка.',
          steps: [P(0, 'AS', 'Вовка — тузом.'), P(1, '7S'), P(2, '9S', 'У Ленки и Серёги ни одной взятки — обоим по горбу.')],
        },
      },
    ],
  },
};
