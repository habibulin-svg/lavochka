/* Очко — описание игры для сборника: дворовое «двадцать одно» с банкиром из игроков и пресет «Блэкджек» с дилером заведения.
 * 2–6 игроков, у каждого 100 рублей. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type Hand, type Res, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

const RL: Record<number, string> = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
export const cn = (c: Card) => (c.r ? `<b>${RL[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>` : '🂠');
export const rub = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'рубль' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'рубля' : 'рублей'}`;

export const RES_TEXT: Record<Res, string> = {
  win: 'выиграл',
  lose: 'проиграл',
  push: 'при своих',
  bust: 'перебор',
  golden: 'золотое очко!',
  bj: 'блэкджек!',
  surr: 'сдался',
  skip: 'без ставки',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return ev.banker != null ? `— Сдача ${ev.n}. Банкует ${name(ev.banker)}${ev.stuk ? ' (стук — последняя)' : ''}.` : `— Сдача ${ev.n}.`;
    case 'bet':
      return `${name(ev.seat)} ставит ${rub(ev.n)}.`;
    case 'double':
      return `${name(ev.seat)} удваивает.`;
    case 'split':
      return `${name(ev.seat)} делит пару.`;
    case 'insure':
      return `${name(ev.seat)} страхуется на ${rub(ev.n)}.`;
    case 'stand':
      return ev.total === 21 ? `${name(ev.seat)}: очко!` : null;
    case 'settle':
      if (ev.res === 'skip') return null;
      return `${name(ev.seat)}: ${RES_TEXT[ev.res]} (${ev.total})${ev.paid > ev.bet ? `, +${ev.paid - ev.bet}` : ev.paid < ev.bet ? `, −${ev.bet - ev.paid}` : ''}.`;
    case 'dtotal':
      return ev.golden ? 'У банкира два туза — забирает все ставки!' : ev.bj ? 'У дилера блэкджек!' : `У ${ev.house ? 'дилера' : 'банкира'} ${ev.total}${ev.total > 21 ? ' — перебор' : ''}.`;
    case 'stuk':
      return `${name(ev.seat)}: «Стук!» В банке ${rub(ev.bank)} — последняя сдача.`;
    case 'banker':
      return ev.prev != null
        ? `${ev.burnt ? `Банк ${name(ev.prev)} прогорел.` : `${name(ev.prev)} забирает банк — ${rub(ev.took)}.`} Банкует ${name(ev.seat)}, в банке ${rub(ev.bank)}.`
        : null;
    case 'broke':
      return `${name(ev.seat)} проигрался вчистую.`;
    case 'end':
      return `🏁 Больше всех денег у ${name(ev.winner)} — ${rub(ev.money[ev.winner])}.`;
  }
  return null;
}

const HIDDEN: Card = { s: 'S', r: 0 };

/** Карты втёмную видит только хозяин; карту банкира — только банкир. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  const me = (p: number | null) => p != null && seats.includes(p);
  if (ev.type === 'deal') return { ...ev, cards: ev.cards.map((c, i) => (me(ev.seats[i]) ? c : HIDDEN)), dealer: ev.dealer.map((c) => (me(ev.banker) ? c : HIDDEN)) };
  if (ev.type === 'card' && !ev.open && !me(ev.seat)) return { ...ev, card: HIDDEN };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция очка: Ленка банкует (банк 20), у Вовки первая карта first, у Ленки — bank; колода — deck. */
function ochkoPos(first: string, bank: string, deck: string, opts: Options = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  s.banker = 1;
  s.money[1] = 80;
  s.bank = 20;
  s.bankStart = 20;
  s.deal = 1;
  s.order = [0];
  s.hands[0] = [{ cards: [C(first)], bet: 0, done: false, open: false }];
  s.dealer = [C(bank)];
  s.deck = L(deck + ' 7H 8C 9D 10S JH QC KD 6S');
  s.turn = 0;
  return s;
}

function bjPos(deck: string): State {
  const s = newState(cfgFrom({ mode: 'bj' }), [0, 1]);
  s.deal = 1;
  s.order = [0];
  s.hands[0] = [{ cards: [], bet: 0, done: false, open: true }];
  s.deck = L(deck + ' 7H 8C 9D 2S 3H 4C');
  s.turn = 0;
  return s;
}

const A = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'ochko',
  title: 'Очко',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'ochko', label: 'Очко — банкует игрок' },
        { value: 'bj', label: 'Блэкджек — дилер заведения' },
      ],
      default: 'ochko',
    },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт' },
        { value: 52, label: '52 карты' },
      ],
      default: 36,
      showIf: (o) => o.mode !== 'bj',
    },
    { key: 'soft', label: 'Туз и за 1', type: 'toggle', default: false, hint: 'При переборе туз считается за одно очко.', showIf: (o) => o.mode !== 'bj' },
    {
      key: 'tie',
      label: 'Ничья',
      type: 'select',
      choices: [
        { value: 'bank', label: 'в пользу банка' },
        { value: 'push', label: 'ставка назад' },
      ],
      default: 'bank',
      showIf: (o) => o.mode !== 'bj',
    },
    { key: 'dealer17', label: 'Банкир тянет до 17', type: 'toggle', default: false, hint: 'Иначе банкир сам решает, брать ли ещё.', showIf: (o) => o.mode !== 'bj' },
    {
      key: 'bank',
      label: 'Банк',
      type: 'select',
      choices: [10, 20, 30, 50].map((n) => ({ value: n, label: rub(n) })),
      default: 20,
      hint: 'Столько банкир кладёт в банк из своих 100.',
      showIf: (o) => o.mode !== 'bj',
    },
    {
      key: 'laps',
      label: 'Банк по кругу',
      type: 'select',
      choices: [
        { value: 1, label: 'один раз' },
        { value: 2, label: 'два раза' },
        { value: 3, label: 'три раза' },
      ],
      default: 1,
      showIf: (o) => o.mode !== 'bj',
    },
    {
      key: 'hands',
      label: 'Сдач',
      type: 'select',
      choices: [10, 20, 30].map((n) => ({ value: n, label: String(n) })),
      default: 20,
      showIf: (o) => o.mode === 'bj',
    },
  ],
  presets: [
    { id: 'yard', label: 'Дворовое', hint: '36 карт, туз 11, ничья — банку, банкир решает сам', options: { mode: 'ochko', deck: 36, soft: false, tie: 'bank', dealer17: false, bank: 20, laps: 1 } },
    { id: 'soft', label: 'Мягкий туз', hint: 'При переборе туз — за одно очко', options: { mode: 'ochko', deck: 36, soft: true, tie: 'bank', dealer17: false, bank: 20, laps: 1 } },
    { id: 'strict', label: 'Банкир до 17', hint: 'Банкир тянет до 17, ничья — ставка назад', options: { mode: 'ochko', deck: 36, soft: false, tie: 'push', dealer17: true, bank: 20, laps: 1 } },
    { id: 'big', label: 'Крупный банк', hint: 'Банк 50, два круга', options: { mode: 'ochko', deck: 36, soft: false, tie: 'bank', dealer17: false, bank: 50, laps: 2 } },
    { id: 'bj', label: 'Блэкджек', hint: '52 карты, дилер до 17, блэкджек 3:2, удвоение, сплит', options: { mode: 'bj', hands: 20 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.money[p];
    const best = s.money[s.winner];
    return { winners: s.seats.filter((p) => s.money[p] === best), text: `больше всех денег — ${rub(best)}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const s = newState(cfgFrom({}), [0, 1, 2, 3]);
    const H = (t: string, bet: number, extra: Partial<Hand> = {}): Hand[] => [{ cards: L(t), bet, done: false, open: true, ...extra }];
    s.banker = 2;
    s.bank = 46;
    s.bankStart = 20;
    s.deal = 3;
    s.money = [92, 71, 80, 111, 100, 100];
    s.order = [3, 0, 1];
    s.hands[3] = H('AS AH', 10, { done: true, res: 'golden', paid: 30 });
    s.hands[0] = H('10D 7C', 6, { done: true });
    s.hands[1] = H('9S QH', 8);
    s.dealer = L('KC');
    s.phase = 'play';
    s.turn = 1;
    return s;
  },

  rules: {
    goal: 'Набрать 21 очко или подобраться к нему ближе банкира — но не перебрать. Два туза — «золотое очко».',
    sections: [
      {
        title: 'Банк и карты',
        html: `<p>У каждого 100 рублей. Банкир (первым — кому выпал туз) кладёт банк. Карты стоят: <b>туз 11, король 4, дама 3, валет 2</b>,
          остальные — по числу.</p>
          <p>Каждому сдаётся карта втёмную. Посмотрел — ставь, но не больше, чем в банке осталось непокрытым. Потом берёшь карты:
          «<b>ещё</b>» — пока не скажешь «<b>хватит</b>».</p>`,
        demo: {
          seats: demoSeats,
          setup: () => ochkoPos('10H', '9C', '6S KH 8D'),
          steps: [
            A(0, { type: 'bet', n: 5 }, 'У Вовки десятка — ставит 5 рублей. Вторая карта — шестёрка: 16.'),
            A(0, { type: 'hit' }, '«Ещё!» — король, это 4 очка: 20.'),
            A(0, { type: 'stand' }, '«Хватит». Ленка-банкир открывает девятку…'),
            A(1, { type: 'hit' }, '…берёт восьмёрку — 17.'),
            A(1, { type: 'stand' }, 'Хватит. 20 больше 17 — банк платит Вовке.'),
          ],
        },
      },
      {
        title: 'Перебор',
        html: `<p>Больше 21 — <b>перебор</b>: карты на стол, ставка сразу уходит в банк, даже если банкир потом сам переберёт.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => ochkoPos('10C', '8S', '6D AS'),
          steps: [A(0, { type: 'bet', n: 5 }, 'Десятка и шестёрка — 16.'), A(0, { type: 'hit' }, 'Ещё — туз, 11 очков. 27, перебор: пять рублей в банк.')],
        },
      },
      {
        title: 'Золотое очко',
        html: `<p><b>Два туза</b> на двух картах — «золотое очко»: открываешь сразу, банк платит вдвойне. У банкира два туза — он забирает все ставки.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => ochkoPos('AS', '9C', 'AH'),
          steps: [A(0, { type: 'bet', n: 5 }, 'Туз, ставка 5 — и второй туз! Золотое очко: банк платит десятку.')],
        },
      },
      {
        title: 'Банкир, ничья и стук',
        html: `<p>Когда все понтёры сыграли, банкир открывает свою карту и добирает сам. Перебрал — платит всем, кто остался. Иначе сравнивают очки:
          больше, чем у банкира, — банк платит ставку, меньше — ставка в банк. <b>Ничья — в пользу банка</b> (в настройках можно «ставка назад»).</p>
          <p>Банк прогорел — колода уходит соседу слева. Банк вырос втрое или банкир сдал три раза — «<b>стук</b>»: последняя сдача, потом банкир
          забирает банк себе. Когда банк обойдёт стол, побеждает самый богатый.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => ochkoPos('10H', '10D', '7S 7C'),
          steps: [
            A(0, { type: 'bet', n: 5 }, 'Десятка и семёрка — 17.'),
            A(0, { type: 'stand' }, 'Хватит.'),
            A(1, { type: 'hit' }, 'Банкир: десятка и семёрка — тоже 17.'),
            A(1, { type: 'stand' }, 'Ничья — ставка Вовки уходит в банк.'),
          ],
        },
      },
      {
        title: 'Блэкджек',
        html: `<p>Казино-вариант: колода 52 карты, банкует дилер заведения. Туз — 1 или 11, картинки — по 10. Каждому и дилеру по две карты,
          у дилера одна закрыта. Туз и десятка с раздачи — <b>блэкджек</b>, платится 3:2.</p>
          <p>На двух картах можно <b>удвоить</b> (двойная ставка, ровно одна карта), <b>разделить пару</b> на две руки или <b>сдаться</b> за половину ставки.
          Туз у дилера — можно застраховаться на половину ставки. Дилер тянет до 17, ничья — ставка назад.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'bj' },
          setup: () => bjPos('6C 5D 5H 10C 10H KS'),
          steps: [
            A(0, { type: 'bet', n: 10 }, 'Ставка 10. У Вовки 6 и 5 — 11, у дилера открыта пятёрка.'),
            A(0, { type: 'double' }, 'Удвоение: ставка 20 и ровно одна карта — десятка, 21. Дилер открывает 15, берёт короля — перебор.'),
          ],
        },
      },
    ],
  },
};
