/* Девятка — описание игры для сборника: старт с девятки бубен или любой, штраф по картам или по очкам, игра на банк, «Семёрка»
 * на 52 карты. 2–4 игрока; боты с «зажимом», правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, winnersOf, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}.`;
    case 'pass':
      return `${name(ev.seat)}: «Пас» (стук).`;
    case 'round': {
      const pen = ev.add.map((x, i) => (x && i !== ev.winner ? `${name(i)} +${x}` : '')).filter(Boolean);
      if (ev.add[ev.winner]) return `Кон за ${name(ev.winner)} — забирает банк: ${ev.add[ev.winner]}.`;
      return `Кон за ${name(ev.winner)}. Штраф: ${pen.join(', ') || 'никому'}.`;
    }
    case 'end':
      return `🏁 Партия окончена. Победил ${ev.winners.map(name).join(', ')}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], rows: Partial<State['rows']> = {}, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), hands.map((_, i) => i));
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.rows = { S: null, C: null, D: null, H: null, ...rows };
  s.round = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'devyatka',
  title: 'Девятка',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  options: [
    { key: 'diamond', label: 'Первый ход — девяткой бубен', type: 'toggle', default: true, hint: 'Выключено — начинает сосед сдающего любой девяткой (нет девятки — пас).' },
    {
      key: 'scoring',
      label: 'Счёт',
      type: 'select',
      choices: [
        { value: 'cards', label: 'карта — очко штрафа' },
        { value: 'points', label: 'по достоинству (Т 11, 10…6, К 4, Д 3, В 2)' },
        { value: 'bank', label: 'на банк — фишки' },
      ],
      default: 'cards',
    },
    {
      key: 'limit',
      label: 'Сколько играть',
      type: 'select',
      choices: [
        { value: 0, label: 'по кону на каждого' },
        { value: 50, label: 'до 50 штрафных' },
        { value: 100, label: 'до 100 штрафных' },
      ],
      default: 0,
      showIf: (o) => o.scoring !== 'bank',
    },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт — от девяток' },
        { value: 52, label: '52 карты — «Семёрка»' },
      ],
      default: 36,
    },
  ],
  presets: [
    { id: 'classic', label: 'Дворовая', hint: 'С девятки бубен, карта — очко штрафа', options: { diamond: true, scoring: 'cards', limit: 0, deck: 36 } },
    { id: 'any', label: 'С любой девятки', hint: 'Начинает сосед сдающего', options: { diamond: false, scoring: 'cards', limit: 0, deck: 36 } },
    { id: 'points', label: 'До 100 по очкам', hint: 'Штраф по достоинству карт', options: { diamond: true, scoring: 'points', limit: 100, deck: 36 } },
    { id: 'bank', label: 'На банк', hint: 'Ставка за кон и фишка за каждый пас', options: { diamond: true, scoring: 'bank', limit: 0, deck: 36 } },
    { id: 'sevens', label: 'Семёрка', hint: '52 карты, ряды от семёрок', options: { diamond: true, scoring: 'cards', limit: 0, deck: 52 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.cfg.scoring === 'bank' ? s.score[p] : -s.score[p];
    return { winners: winnersOf(s), text: s.cfg.scoring === 'bank' ? 'больше всех фишек' : 'меньше всех штрафа', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(pos(['6D QD 9H 8C JS 10S 7H', 'KD 6S', '7C AS 8H QH', 'KC AH 6H'], { D: { lo: 7, hi: 11 }, S: { lo: 8, hi: 9 }, C: { lo: 9, hi: 12 } }, { score: [3, 7, 2, 5] }), [0]),

  rules: {
    goal: 'Первым избавиться от всех карт, выкладывая их рядами мастей от девяток. Остальным — штраф за оставшиеся карты.',
    sections: [
      {
        title: 'Первый ход',
        html: `<p>Колода из 36 карт раздаётся вся. Начинает тот, у кого <b>девятка бубен</b>, — ею и ходит.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['9D 6S KH', '10D 9S QC', '8D 7H AC']),
          steps: [A(0, '9D', 'У Вовки девятка бубен — ему и начинать.'), A(1, '10D', 'Ленка кладёт десятку бубен выше.'), A(2, '8D', 'Серёга — восьмёрку ниже.')],
        },
      },
      {
        title: 'Ряды',
        html: `<p>Ход — одна карта: новая <b>девятка</b> (открывает ряд масти), карта <b>на одну выше</b> верхней в ряду своей масти
          (10, В, Д, К, Т) или <b>на одну ниже</b> нижней (8, 7, 6). Туз закрывает ряд сверху, шестёрка — снизу.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['6D QD 9H 8C', 'KD 6S', '7C AS'], { D: { lo: 7, hi: 11 }, S: { lo: 9, hi: 9 } }),
          intro: 'Бубны — от семёрки до валета, пики — одна девятка. Восьмёрку треф Вовке класть некуда: девятки треф нет.',
          steps: [A(0, '9H', 'Вовка открывает черви девяткой — у него дальше есть что положить.')],
        },
      },
      {
        title: 'Пас — только когда нечем',
        html: `<p>Есть подходящая карта — ходить <b>обязан</b>. Нечем — «пас» (стук по столу), ход переходит дальше. На столе это происходит само.</p>
          <p>Хитрость — «зажим»: не развивать масть, в которой у тебя пусто, и придерживать карту, без которой соседи стоят.</p>`,
      },
      {
        title: 'Счёт',
        html: `<p>Кон кончается, как только кто-то выложил последнюю карту. Остальным — штраф: по очку за каждую оставшуюся карту
          (или по достоинству: 6–10 по номиналу, валет 2, дама 3, король 4, туз 11). Играют по кону на каждого сдатчика или до 50/100.
          Меньше штрафа — победа.</p>
          <p><b>На банк</b>: каждый кон все кладут в банк по фишке, за каждый пас — ещё фишка; выигравший кон забирает банк.
          <b>Семёрка</b> — то же на 52 картах, ряды от семёрок.</p>`,
      },
    ],
  },
};
