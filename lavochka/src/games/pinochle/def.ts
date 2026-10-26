/* Пинокль — описание игры для сборника: вчетвером пара на пару (до 1500) или втроём с прикупом (до 1000). Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, pairs, PASS, setup, teamOf, toAct, type Action, type Event, type PCard, type State, type View } from './engine';

export const SEATS = [
  { name: 'Билл', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Джо', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Мэгги', color: '#c84a1a', light: '#f08050', dark: '#7a2a0a' },
  { name: 'Хэнк', color: '#1f5a9a', light: '#5a8ad0', dark: '#0f2a5a' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
export const cn = (c: PCard) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}.`;
    case 'bid':
      return `${name(ev.seat)}: ${ev.n}.`;
    case 'pass':
      return `${name(ev.seat)}: пас.`;
    case 'won':
      return `Заказ — ${name(ev.seat)}, ${ev.bid}${ev.widow ? `; прикуп: ${ev.widow.map(cn).join(' ')}` : ''}.`;
    case 'trump':
      return ev.pending ? `Козырь — ${SUIT_SYM[ev.suit]}. Обмен с напарником: по ${PASS} карты.` : `Козырь — ${SUIT_SYM[ev.suit]}. Мелды: ${ev.meld.join(' : ')}.`;
    case 'give':
      return null;
    case 'hand':
      return `Сдача: ${ev.add.map((x) => (x > 0 ? '+' : '') + x).join(' : ')}${ev.lines.length ? ` (${ev.lines.join(', ')})` : ''}. Счёт ${ev.score.join(' : ')}.`;
    case 'end':
      return `🏁 Партия — ${ev.score.join(' : ')}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'give' && !seats.includes(ev.seat) && !seats.includes(ev.to)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demo4: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string, d = 0): PCard => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)), d });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map((x) => C(x.replace("'", ''), x.endsWith("'") ? 1 : 0));

function pos(hands: string[], extra: Partial<State> = {}, opts: Options = {}): State {
  const s = newState(cfgFrom(opts, 4), [0, 1, 2, 3]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.deal = 1;
  s.dealer = 3;
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'pinochle',
  title: 'Пинокль',
  players: { min: 3, max: 4, default: 4 },
  teams: (_o, seats) => (seats.length === 4 ? [[seats[0], seats[2]], [seats[1], seats[3]]] : null),
  seats: SEATS,
  options: [
    {
      key: 'target',
      label: 'Партия',
      type: 'select',
      choices: [
        { value: 1500, label: 'до 1500 (вчетвером)' },
        { value: 1000, label: 'до 1000 (втроём)' },
        { value: 500, label: 'до 500 — быстро' },
      ],
      default: 1500,
    },
    { key: 'exchange', label: 'Обмен с напарником — по 4 карты', type: 'toggle', default: true, hint: 'Вчетвером: после козыря напарник отдаёт заказчику 4 карты, тот возвращает 4 — мелды считают уже после обмена.' },
  ],
  presets: [
    { id: 'partners', label: 'Пара на пару', hint: 'Вчетвером, по 12 карт, торги от 250, до 1500', options: { target: 1500 } },
    { id: 'cutthroat', label: 'Втроём', hint: 'Каждый сам за себя, по 15 и прикуп 3, до 1000', options: { target: 1000 } },
    { id: 'quick', label: 'До 500', hint: 'Короткая партия', options: { target: 500 } },
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
    return { winners, text: `${s.score[s.winner]} очков${pairs(s) ? ' у пары' : ''}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(["AH 10H KH QH JH 9H QS JD AS AD' KC 10C", "AH' 10S KS 9S QD 10D KD 9C QC JC' JS 9D", "AC 10C' KH' QH' JH' 9H' QS' JD' AS' KC' 9C' 10H'", "AD 10D' KD' QD' JD 9D' AC' KS' QC' JC JS' 10S'"], {
      phase: 'play',
      trump: 'H',
      bid: 350,
      bidder: 0,
      meld: [230, 60],
      trick: [{ seat: 1, card: C('AH', 1) }],
      turn: 2,
      score: [520, 410],
    }),

  rules: {
    goal: 'Набрать мелдами (комбинациями на руке) и взятками не меньше заказанного — и первыми дойти до 1500.',
    sections: [
      {
        title: 'Колода',
        html: `<p>48 карт: по две каждой от девятки до туза в четырёх мастях. Старшинство: туз, десятка, король, дама, валет, девятка.
          Вчетвером играют пара на пару по 12 карт; втроём — каждый за себя по 15, и 3 карты — прикуп.</p>`,
      },
      {
        title: 'Торги и козырь',
        html: `<p>По кругу заказывают, сколько очков наберут мелдами и взятками: от 250 с шагом 10 или пас (спасовавший больше не торгуется).
          Все спасовали — сдатчик играет за 250. Взявший заказ называет козырь (втроём — сперва забирает прикуп и закапывает три карты: их очки — ему).</p>`,
        demo: {
          seats: demo4,
          setup: () => pos(["AH 10H KH QH JH 9H QS JD AS AD' KC 10C", "AH' 10S KS 9S QD 10D KD 9C QC JC' JS 9D", "AC 10C' KH' QH' JH' 9H' QS' JD' AS' KC' 9C' 10H'", "AD 10D' KD' QD' JD 9D' AC' KS' QC' JC JS' 10S'"]),
          steps: [
            A(0, { type: 'bid', n: 300 }, 'У Билла ран в червах — он заказывает 300.'),
            A(1, { type: 'pass' }),
            A(2, { type: 'pass' }),
            A(3, { type: 'pass' }),
            A(0, { type: 'trump', suit: 'H' }, 'Козырь — черви: ран 150, дикс 10, пинокль 40.'),
          ],
        },
      },
      {
        title: 'Мелды',
        html: `<p>Как только назван козырь, все показывают мелды: <b>ран</b> (Т-10-К-Д-В козыря) — 150, <b>королевский марьяж</b> (К+Д козыря) — 40, марьяж — 20,
          <b>дикс</b> (девятка козыря) — 10, <b>пинокль</b> (дама пик и валет бубен) — 40, двойной — 300, тузы всех мастей — 100, короли — 80, дамы — 60, вальты — 40
          (двойные — вдесятеро). Мелды пары складываются.</p>`,
      },
      {
        title: 'Розыгрыш и счёт',
        html: `<p>Первым ходит взявший заказ. В масть и старше, если можно; нет масти — козырем (и старше козырей на столе); нет и козыря — любой.
          Из двух одинаковых карт старше та, что легла раньше. Тузы, десятки и короли во взятках — по 10, последняя взятка — 10.</p>
          <p>Взявшая сторона набрала мелды + взятки не меньше заказа — записывает всё, иначе — минус заказ. Остальные — свои очки (мелды — если взяли хоть одну взятку).</p>`,
      },
    ],
  },
};
