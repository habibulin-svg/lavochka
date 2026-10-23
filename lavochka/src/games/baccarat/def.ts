/* Баккара — описание игры для сборника: пунто банко (банк — заведение) и шмен де фер (банк по кругу); 1–6 игроков; без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type Side, type State, type View } from './engine';

export const SEATS = [
  { name: 'Жорж', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Мадлен', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Анри', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Софи', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Луи', color: '#6b3fa0', light: '#9a76c8', dark: '#3b1f5e' },
  { name: 'Колетт', color: '#1f8a8a', light: '#4fbcbc', dark: '#0f4a4a' },
];

export const SIDE: Record<Side, string> = { P: 'Игрок', B: 'Банкир', T: 'Ничья' };
/** «Ставит на …»: Игрока, Банкира, ничью. */
export const SIDE_ON: Record<Side, string> = { P: 'Игрока', B: 'Банкира', T: 'ничью' };
const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
const cn = (c: Card) => `<b>${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'coup':
      return ev.banker != null ? `Сдача ${ev.coup}. Банк держит ${name(ev.banker)}${ev.bank ? ` — ${ev.bank}` : ''}.` : `Сдача ${ev.coup}. Делайте ставки!`;
    case 'shuffle':
      return 'Крупье перемешал новый шуз.';
    case 'bank':
      return `${name(ev.seat)} кладёт банк: <b>${ev.n}</b>.`;
    case 'bet':
      return ev.banco ? `${name(ev.seat)}: «Банко!» — <b>${ev.n}</b>.` : `${name(ev.seat)} ставит <b>${ev.n}</b> на ${SIDE_ON[ev.side]}.`;
    case 'skip':
      return `${name(ev.seat)} пропускает.`;
    case 'card':
      return ev.third ? `${ev.hand === 'P' ? 'Игроку' : 'Банкиру'} третья карта: ${cn(ev.card)}.` : null;
    case 'choice':
      return `${name(ev.seat)}: ${ev.draw ? '«Карту!»' : '«Хватит»'}.`;
    case 'result':
      return `${ev.natural ? 'Натуральная! ' : ''}Игрок ${ev.p} — Банкир ${ev.b}: ${ev.win === 'T' ? 'ничья' : `выиграл ${SIDE[ev.win].toLowerCase()}`}.`;
    case 'keep':
      return ev.keep ? `${name(ev.seat)} держит банк (${ev.bank}).` : `${name(ev.seat)} забирает ${ev.bank} и передаёт банк.`;
    case 'end':
      return `🏁 Партия окончена: больше всех у ${name(ev.winner)} — ${ev.money[ev.winner]}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Сдача с заданным шузом: карты идут Игрок, Банкир, Игрок, Банкир, дальше третьи. */
function pos(n: number, shoe: string, opts: Options = {}, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom(opts), Array.from({ length: n }, (_, i) => i));
  s.shoe = [...L(shoe), ...L('2S 3S 4S 5S 6S 7S 8S 9S 10S JS QS KS AS 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH AH 2C 3C 4C 5C')];
  s.coup = 1;
  if (s.cfg.mode === 'pb') {
    s.phase = 'bet';
    s.order = s.seats.slice();
    s.turn = 0;
  } else {
    s.bankSeat = 0;
    s.phase = 'open';
    s.turn = 0;
  }
  return Object.assign(s, extra);
}

const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'baccarat',
  title: 'Баккара',
  players: { min: 1, max: 6, default: 3 },
  countsFor: (o) => (o.mode === 'chemmy' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'pb', label: 'пунто банко — банк держит казино' },
        { value: 'chemmy', label: 'шмен де фер — банк по кругу' },
      ],
      default: 'pb',
    },
    {
      key: 'coups',
      label: 'Сдач в партии',
      type: 'select',
      choices: [
        { value: 10, label: '10 — быстро' },
        { value: 20, label: '20' },
        { value: 40, label: '40' },
      ],
      default: 20,
    },
    {
      key: 'tie',
      label: 'Ничья платит',
      type: 'select',
      choices: [
        { value: 8, label: '8 к 1' },
        { value: 9, label: '9 к 1' },
      ],
      default: 8,
      hint: 'Только в пунто банко.',
    },
    { key: 'vig', label: 'Комиссия 5% с Банкира', type: 'toggle', default: true, hint: 'Только в пунто банко: у Банкира шансы чуть лучше, поэтому с выигрыша на него берут 5%.' },
  ],
  presets: [
    { id: 'punto', label: 'Пунто банко', hint: 'Ставки на Игрока, Банкира или ничью; карты раздаёт крупье', options: { mode: 'pb', coups: 20, tie: 8, vig: true } },
    { id: 'chemmy', label: 'Шмен де фер', hint: 'Банк держат по очереди, «Банко!», решения на пятёрке', options: { mode: 'chemmy', coups: 20, tie: 8, vig: true } },
    { id: 'quick', label: 'Десять сдач', hint: 'Короткая партия пунто банко', options: { mode: 'pb', coups: 10, tie: 8, vig: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (!s.over || s.winner == null) return null;
    const best = s.money[s.winner];
    const winners = s.seats.filter((x) => s.money[x] === best);
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.money[x];
    return { winners, text: `больше всех — ${best}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(3, '');
    s.phase = 'bet';
    s.turn = 2;
    s.player = L('KH 7S');
    s.banker = L('4D 2C 9H');
    s.bets = [
      { seat: 0, side: 'B', n: 100 },
      { seat: 1, side: 'P', n: 50 },
    ];
    s.money = [900, 950, 1000];
    s.coup = 7;
    s.turn = null;
    return s;
  },

  rules: {
    goal: 'Угадать, чья рука — Игрока или Банкира — окажется ближе к <b>девяти</b>, и к концу партии остаться с самыми большими деньгами.',
    sections: [
      {
        title: 'Счёт карт',
        html: `<p>Туз — 1 очко, двойка–девятка — по номиналу, десятки и картинки — 0. Считается только <b>последняя цифра</b> суммы:
          7 + 8 = 15 — это 5. Больше девяти не бывает. Восемь или девять с двух карт — <b>натуральная</b>: третьих карт никто не берёт.</p>`,
      },
      {
        title: 'Пунто банко',
        html: `<p>Банк держит заведение. Все ставят на <b>Игрока</b>, на <b>Банкира</b> или на <b>ничью</b> — это не люди за столом, а две руки,
          которые раздаёт крупье. Решать за руки ничего не надо: карты идут строго по таблице.</p>
          <p>На Игрока платят 1 к 1, на Банкира — 1 к 1 минус 5% (у Банкира шансы чуть лучше), ничья — 8 к 1, а ставки на Игрока и Банкира при ничьей возвращаются.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos(2, '3H 9D 4C KS 8S'),
          steps: [
            A(0, { type: 'bet', side: 'B', n: 100 }, 'Жорж ставит 100 на Банкира.'),
            A(1, { type: 'bet', side: 'P', n: 50 }, 'Мадлен — 50 на Игрока. Крупье раздаёт: у Игрока 7, у Банкира 9 — натуральная!'),
          ],
        },
      },
      {
        title: 'Третья карта',
        html: `<p><b>Игрок</b> берёт третью карту при 0–5 и стоит при 6–7. <b>Банкир</b>, если Игрок стоял, — так же. Если Игрок брал, Банкир смотрит на его третью карту:
          при 0–2 берёт всегда; при 3 — кроме восьмёрки; при 4 — если у Игрока пришла 2–7; при 5 — если 4–7; при 6 — если 6 или 7; при 7 стоит.</p>`,
        demo: {
          seats: demoSeats(1),
          setup: () => pos(1, '2H 5D 2C KS 6S 3H'),
          intro: 'У Игрока будет 4, у Банкира 5.',
          steps: [A(0, { type: 'bet', side: 'P', n: 100 }, 'Игрок с четырьмя берёт шестёрку — 0. Банкир с пятью на шестёрку берёт тройку — 8.')],
        },
      },
      {
        title: 'Шмен де фер',
        html: `<p>Банк держат сами игроки по очереди. Банкир кладёт банк, остальные по кругу ставят против него; кто крикнул <b>«Банко!»</b>, ставит на весь банк сразу.
          Руку Игрока ведёт самая крупная ставка — и на <b>пятёрке</b> сам решает, брать ли карту. Банкир тоже решает сам в спорных клетках:
          при 3 против девятки, при 4 против туза, при 5 против четвёрки и при 5, когда понтёр стоял.</p>
          <p>Выиграл банк — ставки уходят в банк, и банкир решает, держать его дальше или забрать и передать. Проиграл — банк переходит к соседу. Ничья — ставки возвращаются.</p>`,
        demo: {
          seats: demoSeats(3),
          options: { mode: 'chemmy' },
          setup: () => pos(3, '3H 2D 2C 4S 6C', { mode: 'chemmy' }),
          steps: [
            A(0, { type: 'bank', n: 100 }, 'Жорж кладёт банк 100.'),
            A(1, { type: 'banco' }, 'Мадлен: «Банко!» — на все сто. Крупье раздаёт: у неё 5, у банка 6.'),
            A(1, { type: 'draw' }, 'На пятёрке решает сама — берёт карту: шестёрка, итого 1. Банк выиграл.'),
          ],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>У каждого на старте 1000. Партия — 10, 20 или 40 сдач; побеждает тот, у кого в конце больше денег. Всё — на фишки, без настоящих денег.</p>`,
      },
    ],
  },
};
