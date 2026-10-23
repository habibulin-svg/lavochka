/* Кончинка — описание игры для сборника: русская кончинка (52 карты, по 4), «по червям», итальянские скопа и скопоне, испанская эскоба.
 * 2–4 игрока, вчетвером — пара на пару. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, teamOf, toAct, type Action, type Cfg, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Дед Матвей', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Нюра', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Кузьмич', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Глаша', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
export const cn = (c: Card) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;
export const RULES_NAME = (cfg: Cfg) =>
  cfg.rules === 'konch' ? `Кончинка${cfg.suit === 'H' ? ' по червям' : ''}` : cfg.rules === 'escoba' ? 'Эскоба — сумма 15' : cfg.hand === 10 ? 'Скопоне научное' : cfg.hand === 9 ? 'Скопоне' : 'Скопа';

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return ev.first ? `Кон ${ev.round}. Сдаёт ${name(ev.dealer)}${ev.table.length ? `, на столе: ${ev.table.map(cn).join(' ')}` : ''}.` : null;
    case 'play':
      if (!ev.take.length) return `${name(ev.seat)} кладёт ${cn(ev.card)}.`;
      return `${name(ev.seat)}: ${cn(ev.card)} берёт ${ev.take.map(cn).join(' ')}${ev.sweep ? ' — <b>стол чист!</b>' : ''}`;
    case 'rest':
      return `Остаток стола (${ev.cards.length}) забирает ${name(ev.seat)}.`;
    case 'score':
      return ev.lines.length ? `Счёт кона: ${ev.lines.map((l) => `${name(l.seat)} — ${l.what} +${l.pts}`).join('; ')}.` : 'Кон без очков.';
    case 'end':
      return `🏁 Партия: ${ev.winners.map(name).join(' и ')} — ${ev.score[ev.winners[0]]}.`;
  }
  return null;
}

/** Чужие руки скрыты. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], table: string, opts: Options = {}, deck = '2S 3S 4S 5S 6S 7S 8S 9S'): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.table = L(table);
  s.deck = L(deck);
  s.round = 1;
  s.dealer = 1;
  s.turn = 0;
  return s;
}

const A = (seat: number, card: string, take: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card), take: L(take) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'konchinka',
  title: 'Кончинка',
  players: { min: 2, max: 4, default: 2 },
  countsFor: (o) => (Number(o.hand) >= 9 ? [4] : [2, 3, 4]),
  teams: (o, seats) => (seats.length === 4 && o.pairs !== false ? [[seats[0], seats[2]], [seats[1], seats[3]]] : null),
  seats: SEATS,
  options: [
    {
      key: 'rules',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'konch', label: 'кончинка — 52 карты, взятие по сумме' },
        { value: 'scopa', label: 'скопа — 40 карт, итальянская' },
        { value: 'escoba', label: 'эскоба — 40 карт, сумма 15' },
      ],
      default: 'konch',
    },
    {
      key: 'hand',
      label: 'На руку',
      type: 'select',
      choices: [
        { value: 4, label: 'по 4 (кончинка)' },
        { value: 3, label: 'по 3 (скопа, эскоба)' },
        { value: 9, label: 'по 9 — скопоне, вчетвером' },
        { value: 10, label: 'по 10, стол пуст — скопоне научное' },
      ],
      default: 4,
    },
    {
      key: 'suit',
      label: 'Масть за очко',
      type: 'select',
      choices: [
        { value: 'C', label: 'трефы и двойка треф' },
        { value: 'H', label: 'черви и туз пик' },
      ],
      default: 'C',
      hint: 'Только в кончинке: в некоторых компаниях трефы заменяют червами, а двойку треф — тузом пик.',
    },
    { key: 'pairs', label: 'Вчетвером — пара на пару', type: 'toggle', default: true },
    {
      key: 'target',
      label: 'До скольких',
      type: 'select',
      choices: [
        { value: 11, label: 'до 11' },
        { value: 16, label: 'до 16' },
        { value: 21, label: 'до 21' },
        { value: 31, label: 'до 31' },
      ],
      default: 21,
    },
  ],
  presets: [
    { id: 'konchinka', label: 'Кончинка', hint: '52 карты, по 4, берут по сумме; карты, трефы, 2♣ и 10♦', options: { rules: 'konch', hand: 4, suit: 'C', target: 21 } },
    { id: 'chervi', label: 'По червям', hint: 'Очко за черви и туз пик вместо треф и двойки треф', options: { rules: 'konch', hand: 4, suit: 'H', target: 21 } },
    { id: 'scopa', label: 'Скопа', hint: 'Италия: 40 карт, по 3, скопа — смёл стол, примиера, до 11', options: { rules: 'scopa', hand: 3, target: 11 } },
    { id: 'scopone', label: 'Скопоне', hint: 'Вчетвером парами, по 9 карт и 4 на стол, до 11', options: { rules: 'scopa', hand: 9, pairs: true, target: 11 } },
    { id: 'scientifico', label: 'Скопоне научное', hint: 'По 10 карт, стол пуст — чистый расчёт', options: { rules: 'scopa', hand: 10, pairs: true, target: 11 } },
    { id: 'escoba', label: 'Эскоба', hint: 'Испания: берут карты, которые с твоей дают 15', options: { rules: 'escoba', hand: 3, target: 21 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[x];
    const w = s.winners;
    return { winners: w, text: `${s.score[w[0]]} очков${w.length > 1 && teamOf(s, w[0]) === teamOf(s, w[1]) ? ' у пары' : ''}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(['10D 7C KS 3H', 'AS 5D 9C 2H'], '7H 3C QD 2C 6S');
    s.piles = [L('4S 4D 8C 8H JC JH'), L('5S 5C')];
    s.score = [9, 7];
    s.round = 3;
    return s;
  },

  rules: {
    goal: 'Брать со стола как можно больше карт — особенно трефы, двойку треф и десятку бубен — и первым набрать <b>21</b> очко.',
    sections: [
      {
        title: 'Сдача',
        html: `<p>Колода — 52 карты. Каждому по 4, ещё 4 открывают на стол. Ходят по кругу от соседа сдатчика. Когда руки кончились, сдатчик сдаёт ещё по 4,
          но на стол уже не кладёт — и так, пока не кончится колода. Вчетвером играют пара на пару, напарники — напротив.</p>`,
      },
      {
        title: 'Как брать',
        html: `<p>Картой с руки берут со стола карту того же достоинства — или несколько карт, которые вместе дают столько же очков.
          Туз — 1, двойка–десятка — по номиналу: десяткой можно взять семёрку, двойку и туза. Валет, дама и король берут только такую же картинку.
          Если взять можно — брать обязательно; нечем — карту кладут на стол.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10D 7C KS 3H', 'AS 5D 9C 2H'], '7H 2C AH QD 6S'),
          steps: [A(0, '10D', '7H 2C AH', 'Десятка бубен берёт семёрку, двойку и туза: 7 + 2 + 1 = 10.'), A(1, 'AS', '', 'Тузу пик взять нечего — ложится на стол.'), A(0, '7C', '6S AS', 'Семёрка треф берёт шестёрку и туза. А королём даму не взять: картинки берут только такую же картинку.')],
        },
      },
      {
        title: 'Счёт кона',
        html: `<p>Колода кончилась — остаток стола забирает тот, кто брал последним. Очки: <b>больше всех карт</b> — 2 (поровну — по 1), <b>больше всех треф</b> — 1,
          <b>двойка треф</b> — 1, <b>десятка бубен</b> — 1. Сдатчик меняется; играют до 21. «По червям» — то же, но очко за черви и туз пик.</p>`,
      },
      {
        title: 'Скопа и скопоне',
        html: `<p>Итальянская родня кончинки — на 40 картах (туз–семёрка, валет 8, дама 9, король 10), по 3 на руку. Если на столе есть карта того же значения,
          взять можно только её. Смёл со стола всё — <b>скопа</b>, очко (кроме последнего хода кона).</p>
          <p>Очки: больше карт, больше бубен, семёрка бубен («сеттебелло») и <b>примиера</b> — лучшая сумма по старшей карте каждой масти
          (семёрка 21, шестёрка 18, туз 16, пятёрка 15, четвёрка 14, тройка 13, двойка 12, картинки 10) — по очку, поровну — никому. До 11.
          Скопоне — вчетвером парами по 9 карт; «научное» — по 10, стол пуст.</p>`,
        demo: {
          seats: demoSeats,
          options: { rules: 'scopa', hand: 3, target: 11 },
          setup: () => pos(['7D 4C KS', 'AS 5D 6C'], '4H 3S', { rules: 'scopa', hand: 3 }),
          steps: [A(0, '7D', '4H 3S', 'Семёрка бубен берёт четвёрку и тройку — и стол пуст: скопа!'), A(1, 'AS', '', 'Тузу брать нечего.'), A(0, 'KS', '', 'Король тоже ложится на стол.')],
        },
      },
      {
        title: 'Эскоба',
        html: `<p>Испанская игра на 40 картах: берут карты, которые <b>вместе с сыгранной</b> дают 15. Смёл стол — эскоба, очко.
          Очки: больше карт, больше бубен, больше семёрок, семёрка бубен, эскобы. До 21.</p>`,
        demo: {
          seats: demoSeats,
          options: { rules: 'escoba', hand: 3 },
          setup: () => pos(['KD 4C 2S', 'AS 5D 6C'], '5H 7S', { rules: 'escoba', hand: 3 }),
          steps: [A(0, 'KD', '5H', 'Король — 10, с пятёркой — 15: взял.')],
        },
      },
    ],
  },
};
