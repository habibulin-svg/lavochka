/* Сека — описание игры для сборника: три карты, торговля с игрой втёмную, очки по масти, джокер, свара. Пресет «Свара».
 * 2–6 игроков, у каждого 100 рублей. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
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

const RL: Record<number, string> = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
const cn = (c: Card) => (c.r ? `<b>${RL[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>` : '🂠');
export const rub = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'рубль' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'рубля' : 'рублей'}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return ev.svara ? `— Свара: играют ${ev.seats.map(name).join(', ')}.` : `— Сдача ${ev.n}, сдаёт ${name(ev.dealer)}. Кон по ${rub(ev.ante)}.`;
    case 'look':
      return `${name(ev.seat)} смотрит карты.`;
    case 'call':
      return ev.paid ? `${name(ev.seat)} доставляет ${rub(ev.paid)}${ev.dark ? ' втёмную' : ''}.` : `${name(ev.seat)}: «дальше».`;
    case 'raise':
      return `${name(ev.seat)} набавляет до ${ev.to}${ev.dark ? ' втёмную' : ''}.`;
    case 'fold':
      return `${name(ev.seat)}: пас.`;
    case 'show':
      return `${name(ev.seat)}: ${ev.cards.map(cn).join(' ')} — ${ev.score}.`;
    case 'win':
      return `${name(ev.seat)} забирает банк — ${rub(ev.pot)}${ev.shown ? '' : ', не вскрываясь'}.`;
    case 'svara':
      return `Свара! У ${ev.seats.map(name).join(' и ')} поровну. Банк ${rub(ev.pot)} остаётся.`;
    case 'join':
      return ev.yes ? `${name(ev.seat)} примазывается к сваре за ${rub(ev.fee)}.` : null;
    case 'out':
      return `${name(ev.seat)} проигрался.`;
    case 'end':
      return `🏁 Больше всех денег у ${name(ev.winner)} — ${rub(ev.money[ev.winner])}.`;
  }
  return null;
}

const HIDDEN: Card = { s: 'S', r: 0 };

/** Карты при сдаче не видит никто — свои открываются, когда посмотрел. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands.map((h) => h.map(() => HIDDEN)) };
  if (ev.type === 'look' && !seats.includes(ev.seat)) return { ...ev, cards: ev.cards.map(() => HIDDEN) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Вовка и Ленка с картами a и b, кон по рублю в банке, ходит first. */
function pos(a: string, b: string, opts: Options = {}, first = 0): State {
  const s = newState(cfgFrom({ dark: false, ...opts }), [0, 1]);
  s.deal = 1;
  s.dealer = 1 - first;
  s.hands[0] = L(a);
  s.hands[1] = L(b);
  s.live = [0, 1];
  s.money[0] = s.money[1] = 99;
  s.pot = 2;
  s.seen = [!s.cfg.dark, !s.cfg.dark, false, false, false, false];
  s.turn = first;
  return s;
}

const A = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'seka',
  title: 'Сека',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'joker',
      label: 'Джокер',
      type: 'select',
      choices: [
        { value: 'c6', label: 'шестёрка треф' },
        { value: 'six', label: 'все шестёрки' },
        { value: 's7', label: 'семёрка пик (чепак)' },
        { value: 'none', label: 'без джокера' },
      ],
      default: 'c6',
    },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт' },
        { value: 32, label: '32 карты (без шестёрок)' },
      ],
      default: 36,
    },
    { key: 'sevens', label: 'Три семёрки — 34', type: 'toggle', default: false, hint: 'Три семёрки старше трёх тузов, как в Сваре.' },
    { key: 'dark', label: 'Втёмную', type: 'toggle', default: true, hint: 'Можно торговаться, не глядя в карты: тёмный платит вполовину.' },
    {
      key: 'join',
      label: 'Вход в свару',
      type: 'select',
      choices: [
        { value: 3, label: 'треть банка' },
        { value: 2, label: 'половина банка' },
      ],
      default: 3,
    },
    {
      key: 'ante',
      label: 'Кон',
      type: 'select',
      choices: [1, 2, 5].map((n) => ({ value: n, label: rub(n) })),
      default: 1,
    },
    {
      key: 'deals',
      label: 'Сдач',
      type: 'select',
      choices: [10, 20, 30].map((n) => ({ value: n, label: String(n) })),
      default: 20,
    },
  ],
  presets: [
    { id: 'yard', label: 'Дворовая', hint: '36 карт, шестёрка треф — джокер, втёмную, свара за треть банка', options: { joker: 'c6', deck: 36, sevens: false, dark: true, join: 3, ante: 1 } },
    { id: 'strict', label: 'Без джокера', hint: 'Строгая: чистая колода', options: { joker: 'none', deck: 36, sevens: false, dark: true, join: 3, ante: 1 } },
    { id: 'six', label: 'Четыре джокера', hint: 'Все шестёрки — джокеры', options: { joker: 'six', deck: 36, sevens: false, dark: true, join: 3, ante: 1 } },
    { id: 'svara', label: 'Свара', hint: '32 карты, семёрка пик — джокер, три семёрки — 34, вход за полбанка', options: { joker: 's7', deck: 32, sevens: true, dark: true, join: 2, ante: 1 } },
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
    s.deal = 4;
    s.dealer = 3;
    s.hands = [L('AH KH 6C'), L('9S 10S 7D'), L('AS QD 8C'), L('JH 7H 10C'), [], []];
    s.seen = [true, true, false, true, false, false];
    s.live = [0, 1, 2];
    s.put = [6, 6, 3, 2, 0, 0];
    s.money = [88, 71, 109, 96, 100, 100];
    s.level = 6;
    s.pot = 21;
    s.acted = [1, 2];
    s.turn = 0;
    return s;
  },

  rules: {
    goal: 'Забрать банк: набрать больше очков при вскрытии — или так набавить, чтобы все спасовали.',
    sections: [
      {
        title: 'Очки',
        html: `<p>Каждому сдаётся по три карты. Туз — 11, король, дама, валет и десятка — по 10, остальные — по числу. Считаются <b>карты одной масти</b>:
          туз, король и дама червей — 31. Карты разных мастей — по старшей. <b>Два туза</b> — 22 в любых мастях, <b>три одинаковые</b> — втрое
          (три десятки — 30), <b>три туза</b> — 33, выше нет.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('AH KH 7S', 'AS AC 8D'),
          steps: [A(0, { type: 'raise', to: 2 }, 'У Вовки туз и король червей — 21. Набавляет.'), A(1, { type: 'call' }, 'Ленка доставляет — вскрытие. У неё два туза, 22: банк её.')],
        },
      },
      {
        title: 'Джокер',
        html: `<p><b>Шестёрка треф</b> — джокер («шоха»): становится любой картой, обычно тузом нужной масти. Туз, король и шоха — 31.
          В вариантах джокером бывают все шестёрки или семёрка пик.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('6C AH KH', '10S JS 9S'),
          steps: [A(0, { type: 'raise', to: 5 }, 'У Вовки туз, король и шестёрка треф.'), A(1, { type: 'call' }, 'У Ленки три пики — 29. У Вовки шоха стала дамой червей: 31.')],
        },
      },
      {
        title: 'Торговля и игра втёмную',
        html: `<p>Сначала все кладут кон. Потом по кругу: <b>пас</b>, <b>доставить</b> — уравнять ставку, или <b>набавить</b>. Когда все уравняли последнее
          «набавить» — вскрытие. Спасовали все, кроме одного, — он забирает банк, не показывая карт.</p>
          <p>Можно играть <b>втёмную</b>, не глядя в карты: тёмный платит половину. Посмотрел — доплачивай до полной: зрячий платит вдвое.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => {
            const s = pos('KD 10D 8S', 'QC JC 9C', { dark: true }, 1);
            s.seen[1] = true;
            return s;
          },
          steps: [
            A(1, { type: 'raise', to: 2 }, 'Ленка посмотрела карты и набавляет до двух.'),
            A(0, { type: 'call' }, 'Вовка не смотрит — доставляет втёмную, всего рубль. Вскрытие: у Ленки три трефы, 29 — банк её.'),
          ],
        },
      },
      {
        title: 'Свара',
        html: `<p>Очков поровну у лучших — <b>свара</b>: банк никому, остаётся на столе. Равные играют новую сдачу бесплатно,
          остальные могут «примазаться», заплатив треть банка (в Сваре — половину).</p>
          <p>Партия — двадцать сдач (можно 10 или 30). Побеждает самый богатый.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('AH AD 7C', 'AS AC 8D'),
          steps: [A(0, { type: 'raise', to: 2 }, 'У обоих по два туза…'), A(1, { type: 'call' }, '…22 и 22 — свара! Банк остаётся, им сдают заново.')],
        },
      },
    ],
  },
};
