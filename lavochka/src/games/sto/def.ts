/* 101 — описание игры для сборника: колода 36/52, 4 или 5 карт, до 101 или 121, обнуление, разворот десяткой; 2–6 игроков. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#6a3d8f', light: '#9a70c0', dark: '#3a1f52' },
  { name: 'Колян', color: '#5a5a5a', light: '#9a9a9a', dark: '#2a2a2a' },
];

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}, начинает ${name(ev.first)}.`;
    case 'play':
      return `${name(ev.seat)}: ${cn(ev.card)}${ev.suit ? ` — заказ: <b>${SUIT_NAME[ev.suit]}</b>` : ''}${ev.card.r === 6 ? ' — кроет сам' : ''}`;
    case 'draw':
      return ev.forced ? `${name(ev.seat)} берёт ${ev.count}` : null;
    case 'skip':
      return `${name(ev.seat)} пропускает ход`;
    case 'reverse':
      return 'Разворот!';
    case 'pass':
      return `${name(ev.seat)}: «пас».`;
    case 'reshuffle':
      return 'Колода кончилась — перемешали сброс.';
    case 'round': {
      const pts = ev.pts.map((p, i) => ({ p, i })).filter((x) => x.i !== ev.winner && x.p);
      return `${name(ev.winner)} выходит${ev.bonus ? ` на даме — себе ${ev.bonus}` : ''}! ${pts.map((x) => `${name(x.i)} +${x.p}`).join(', ')}.${ev.reset.length ? ` Ровно ${'101'}: ${ev.reset.map(name).join(', ')} — в ноль!` : ''}${ev.out.length ? ` Выбыли: ${ev.out.map(name).join(', ')}.` : ''}`;
    }
    case 'end':
      return `🏆 <b>${name(ev.winner)}</b> — последний оставшийся.`;
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

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(n: number, hands: string[], pile: string, stock: string, extra: Partial<State> = {}): State {
  const seats = Array.from({ length: n }, (_, i) => i);
  const s = newState(cfgFrom({}), seats);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.pile = L(pile);
  s.stock = L(stock);
  s.round = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const P = (seat: number, card: string, caption?: string, suit?: Suit) => ({ seat, action: { type: 'play', card: C(card), suit } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: '101',
  title: '101',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт' },
        { value: 52, label: '52 карты — для большой компании' },
      ],
      default: 36,
    },
    {
      key: 'hand',
      label: 'Карт на руку',
      type: 'select',
      choices: [
        { value: 4, label: 'по 4' },
        { value: 5, label: 'по 5' },
      ],
      default: 4,
    },
    {
      key: 'limit',
      label: 'До скольких',
      type: 'select',
      choices: [
        { value: 101, label: 'до 101' },
        { value: 121, label: 'до 121' },
      ],
      default: 101,
    },
    { key: 'reset', label: 'Ровно — в ноль', type: 'toggle', default: true, hint: 'Набрал ровно 101 (121) — счёт обнуляется.' },
    { key: 'reverse', label: 'Десятка — разворот', type: 'toggle', default: false, hint: 'Положил десятку — ход пошёл в другую сторону.' },
    { key: 'drawOne', label: 'Нечем ходить — одна карта', type: 'toggle', default: false, hint: 'Берёшь одну карту; не подошла — пропускаешь ход. Иначе тянешь, пока не найдётся.' },
  ],
  presets: [
    { id: 'classic', label: 'Классическая', hint: '36 карт, по 4, до 101, ровно — в ноль', options: { deck: 36, hand: 4, limit: 101, reset: true, reverse: false, drawOne: false } },
    { id: 'reverse', label: 'С разворотом', hint: 'Десятка поворачивает ход', options: { deck: 36, hand: 4, limit: 101, reset: true, reverse: true, drawOne: false } },
    { id: '121', label: 'До 121', hint: 'Подольше: выбывают после 121', options: { deck: 36, hand: 5, limit: 121, reset: true, reverse: false, drawOne: false } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = -s.scores[x];
    return { winners: [s.winner], text: `продержался дольше всех (${s.scores[s.winner]} очков)`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => makeView(pos(3, ['9S KH 7C QD', '8H 10H AS', 'JC 6D 9C 10S'], '7H 9H', '6S 7S 8S 9D', { scores: [34, 61, 18, 0, 0, 0] }), [0]),

  rules: {
    goal: 'Первым избавиться от карт. Остальные пишут себе очки с рук; набрал больше <b>101</b> — выбыл. Побеждает последний оставшийся.',
    sections: [
      {
        title: 'Ход',
        html: `<p>Кладут по одной карте <b>той же масти</b> или <b>того же достоинства</b>, что сверху. Нечем ходить — берёшь из колоды, пока не найдётся подходящая.</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => pos(3, ['9S KH 7C', '10S 10H AD', 'JC 6D 9C'], '9H', '6S 7S 8D'),
          intro: 'Сверху девятка червей.',
          steps: [P(0, '9S', 'Вовка кладёт девятку пик — по достоинству.'), P(1, '10S', 'Ленка — в масть, пики.'), { seat: 2, action: { type: 'draw' } as Action, caption: 'У Серёги ни пик, ни восьмёрок — тянет из колоды…' }, P(2, '6S', '…шестёрка пик! Её кладёт.')],
        },
      },
      {
        title: 'Шестёрка',
        html: `<p>Шестёрку нужно <b>покрыть</b>: тот же игрок сразу кладёт ещё карту — в масть шестёрки, другую шестёрку или даму. Нечем — тянет, пока не найдёт.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos(2, ['6H 10H 7C', '8S 9D AD'], '9H', '6S 7S 8D'),
          steps: [P(0, '6H', 'Вовка кладёт шестёрку червей…'), P(0, '10H', '…и сам же кроет её десяткой.')],
        },
      },
      {
        title: 'Особые карты',
        html: `<ul><li><b>7</b> — следующий берёт 2 карты и пропускает ход;</li><li><b>8</b> — следующий берёт 1 и пропускает;</li>
          <li><b>туз</b> — следующий пропускает ход;</li><li><b>король пик</b> — следующий берёт 4 и пропускает;</li>
          <li><b>дама</b> — кладётся на любую карту, и игрок заказывает масть;</li><li><b>10</b> — разворот хода (если так договорились).</li></ul>`,
        demo: {
          seats: demoSeats(3),
          setup: () => pos(3, ['7H KS QC', 'JS 8D 10D AD', '8H JC 9C'], '9H', '6S 7S 8S 9S 10S JD QH KD'),
          steps: [
            P(0, '7H', 'Семёрка: Ленка берёт две карты и пропускает ход.'),
            P(2, '8H', 'Серёга — восьмёркой: Вовка берёт одну и пропускает.'),
            P(1, '8D', 'Ленка кладёт восьмёрку бубен — по достоинству. Теперь пропускает Серёга.'),
            P(0, 'QC', 'Вовка кладёт даму на что угодно и заказывает бубны.', 'D'),
          ],
        },
      },
      {
        title: 'Подсчёт и выбывание',
        html: `<p>Кто первым избавился от карт, выиграл кон. Остальные пишут очки с рук: 6–10 — по номиналу, валет — 2, дама — 3, король — 4, туз — 11.
          Кончил <b>дамой</b> — себе минус 20 (пиковой — минус 40).</p>
          <p>Набрал больше 101 — выбыл. Ровно 101 — счёт обнуляется. Играют, пока не останется один — он победитель.</p>`,
      },
    ],
  },
};
