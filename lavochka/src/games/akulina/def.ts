/* Акулина (Зассыха) — описание игры для сборника: какая карта без пары (дама пик, валет пик или случайная втёмную), пары по рангу
 * или по рангу и цвету, 36 или 52 карты. 2–6 игроков. Тянут наугад — боты тоже (веер перетасован, угадывать нечего). Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { apply, cfgFrom, makeView, newState, offerer, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

export const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

/** Как зовут проигравшего: Акулина, Зассыха или Пиковый валет. */
export const loserName = (s: State) => (s.cfg.odd === 'random' ? 'Зассыха' : s.cfg.odd === 'jack' ? 'Пиковый валет' : 'Акулина');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'pair':
      return `${name(ev.seat)} тянет у ${name(ev.from)} — пара ${ev.cards.map(cn).join(' ')} в отбой.`;
    case 'out':
      return `${name(ev.seat)} без карт — ${ev.place}-е место.`;
    case 'end':
      return `🏁 ${name(ev.loser)} остаётся с ${ev.card ? cn(ev.card) : 'картой'}.`;
  }
  return null;
}

/** Вытянутую карту видят только двое: кто тянул и у кого. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'draw' && !seats.includes(ev.seat) && !seats.includes(ev.from)) return { ...ev, card: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 0 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], extra: Partial<State> = {}, opts = {}): State {
  const s = newState(cfgFrom(opts), hands.map((_, i) => i));
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, index: number, caption?: string) => ({ seat, action: { type: 'draw', index } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'akulina',
  title: 'Акулина',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'odd',
      label: 'Кто без пары',
      type: 'select',
      choices: [
        { value: 'queen', label: 'дама пик — Акулина' },
        { value: 'random', label: 'случайная втёмную — Зассыха' },
        { value: 'jack', label: 'валет пик' },
      ],
      default: 'queen',
    },
    { key: 'color', label: 'Пары по цвету', type: 'toggle', default: false, hint: 'Пара — только красное с красным, чёрное с чёрным.' },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт' },
        { value: 52, label: '52 карты' },
      ],
      default: 36,
    },
  ],
  presets: [
    { id: 'classic', label: 'Акулина', hint: 'Без пары — дама пик', options: { odd: 'queen', color: false, deck: 36 } },
    { id: 'zassyha', label: 'Зассыха', hint: 'Убрана случайная карта — никто не знает какая', options: { odd: 'random', color: false, deck: 36 } },
    { id: 'color', label: 'По цвету', hint: 'Пары только одного цвета', options: { odd: 'queen', color: true, deck: 36 } },
    { id: 'jack', label: 'Пиковый валет', hint: 'Без пары — валет пик', options: { odd: 'jack', color: false, deck: 36 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.loser == null) return null;
    const scores: Record<number, number> = {};
    s.done.forEach((p, i) => (scores[p] = s.seats.length - i));
    scores[s.loser] = 0;
    return { winners: s.seats.filter((p) => p !== s.loser), text: `${loserName(s)} — у проигравшего`, scores };
  },
  // тянуть наугад: веер перетасован, все уровни берут случайную карту
  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v, seat, _lv, rng) => {
      if (v.loser != null || v.turn !== seat) return null;
      const n = v.counts[offerer(v, seat)];
      return n ? { type: 'draw', index: rng.int(n) } : null;
    },
  },
  describe,

  showcase: () => makeView(pos(['8S QS 10H', 'KD 8H', '10C KC 6D 7S'], { pairs: [L('9S 9C'), L('AH AD'), L('JS JC'), L('6H 6S'), L('QH QD'), L('7H 7D')] }), [0]),

  rules: {
    goal: 'Сбросить все карты парами и не остаться последним с единственной непарной картой — «Акулиной».',
    sections: [
      {
        title: 'Колода и раздача',
        html: `<p>Из колоды убирают <b>даму треф</b>: теперь пиковой даме пары нет — это и есть Акулина. Дамы складываются в пару
          только по цвету (червовая с бубновой), так что Акулина всегда пиковая.</p>
          <p>Раздают все карты, каждый сразу сбрасывает пары одного ранга. Три одинаковые — сбрасывается две, одна остаётся.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>По кругу тянешь <b>наугад</b> одну карту из веера соседа (он держит карты рубашкой к тебе). Сложилась пара — в отбой.
          Потом сосед тянет у следующего — и так далее.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['8S QS 10H', 'KD 8H', '10C KC 6D 7S']),
          steps: [A(0, 1, 'Вовка тянет у Ленки — восьмёрка червей! Пара восьмёрок в отбой.'), A(1, 0, 'Теперь Ленка тянет у Серёги.')],
        },
      },
      {
        title: 'Конец',
        html: `<p>Сбросил последнюю карту — вышел. В конце у одного остаётся непарная дама пик — он «Акулина».</p>
          <p><b>Зассыха</b> — то же, но убирают случайную карту втёмную: без пары окажется неизвестно что, до самого конца.
          Можно играть со строгими парами по цвету или с пиковым валетом вместо дамы.</p>`,
        demo: {
          seats: demoSeats.slice(0, 2),
          setup: () => pos(['8S', 'QS 8H']),
          steps: [A(0, 1, 'У Вовки восьмёрка пик. Тянет у Ленки — восьмёрка! Пара, Вовка вышел, Ленка — Акулина.')],
        },
      },
    ],
  },
};
