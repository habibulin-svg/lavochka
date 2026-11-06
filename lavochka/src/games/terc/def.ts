/* Терц — описание игры для сборника: старинная карточная на двоих, 32 карты, терцы, полтинники, «сто», марьяж и «разбор фрица». Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { makeDeck, sameCard, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, comboName, makeView, newState, setup, toAct, type Action, type Combo, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Ипполит', color: '#8a2a1e', light: '#c45a44', dark: '#4e140c' },
  { name: 'Порфирий', color: '#2e5a3a', light: '#5f9a6a', dark: '#163220' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
export const cn = (c: Card) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;
export const comboText = (c: Combo) => `${comboName(c)}${c.suit ? ' ' + SUIT_SYM[c.suit] : ''}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}, козырь ${cn(ev.trumpCard)}.`;
    case 'declare':
      return `${name(ev.seat)}: «${comboText(ev.combo)}!» (${ev.combo.pts})`;
    case 'answer':
      return ev.rost ? `${name(ev.seat)}: «Рост!» — ${comboText(ev.combo!)}, +${ev.pts}; перебитая сгорела.` : `${name(ev.seat)}: «Годится». ${name(ev.to)} +${ev.pts}.`;
    case 'marriage':
      return `${name(ev.seat)}: марьяж, +20.`;
    case 'swap':
      return `${name(ev.seat)} меняет козырную семёрку на ${cn(ev.took)}.`;
    case 'break':
      return `${name(ev.seat)} ломает колоду.`;
    case 'fritz':
      return 'Колода кончилась — «разбор фрица»: в масть и перебить.';
    case 'hand':
      return `Взятки: ${Object.values(ev.pts).join(' : ')} → записано ${Object.values(ev.add).join(' : ')}. Счёт ${Object.values(ev.score).join(' : ')}.`;
    case 'end':
      return `🏁 Партия — ${name(ev.winner)}, ${Object.values(ev.score).join(' : ')}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'draw' && !ev.open && !seats.includes(ev.seat)) return { type: 'draw', seat: ev.seat };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция для показа: руки, открытый козырь и сколько карт в колоде (колода — из оставшихся карт по порядку). */
function pos(hands: string[], trumpCard: string | null, stockN: number, extra: Partial<State> = {}, opts: Options = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.trumpCard = trumpCard ? C(trumpCard) : null;
  s.trump = (trumpCard ? C(trumpCard).s : 'H') as Suit;
  const used = [...s.hands.flat(), ...(s.trumpCard ? [s.trumpCard] : []), ...(extra.trick ?? []).map((t) => t.card)];
  s.stock = makeDeck(32).filter((c) => !used.some((u) => sameCard(u, c))).slice(0, stockN);
  s.deal = 1;
  s.dealer = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const seq = (suit: Suit, ranks: number[]): Combo => ({ kind: 'seq', suit, len: ranks.length, top: ranks[ranks.length - 1], pts: ranks.length >= 5 ? 100 : ranks.length === 4 ? 50 : 20, cards: ranks.map((r) => ({ s: suit, r })) });


export const def: GameDef<State, Action, Event, View> = {
  id: 'terc',
  title: 'Терц',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'target',
      label: 'Партия',
      type: 'select',
      choices: [
        { value: 501, label: 'до 501 — длинный терц' },
        { value: 301, label: 'до 301 — короткий' },
      ],
      default: 501,
    },
    { key: 'round', label: 'Округлять очки взяток до десятков (25 → 20, 26 → 30)', type: 'toggle', default: true },
    { key: 'multi', label: 'Несколько комбинаций за заход', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'long', label: 'Терц', hint: 'Длинный, до 501, с округлением, одна комбинация за заход', options: { target: 501, round: true, multi: false } },
    { id: 'short', label: 'Короткий', hint: 'До 301 — на полчаса', options: { target: 301, round: true, multi: false } },
    { id: 'free', label: 'Вольный', hint: 'До 501, очки точно, объявлять сразу сколько есть', options: { target: 501, round: false, multi: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[x];
    return { winners: [s.winner], text: `${s.score[s.winner]} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(['JH 9H AS 10S KD QD JD 8C 7C', 'AH KS QS 7D 10C JC 9D 8D'], 'QH', 4, {
      trick: [{ seat: 1, card: C('AD') }],
      turn: 0,
      broken: true,
      pts: [44, 31],
      score: [212, 168],
      tricks: [3, 2],
      deal: 4,
      decls: [{ seat: 0, combo: seq('D', [11, 12, 13]), pts: 20 }],
    }),

  rules: {
    goal: 'Набрать очки во взятках и комбинациях и первым дойти до 501 (короткий терц — до 301).',
    sections: [
      {
        title: 'Карты и очки',
        html: `<p>Вдвоём, 32 карты. Каждому по 9, следующую карту открывают — её масть козырь; она лежит под колодой и уходит последней.</p>
          <p>В простых мастях старшинство: 7, 8, 9, валет, дама, король, <b>десятка</b>, туз. В козыре старше всех <b>валет</b> («юс», 20 очков),
          за ним <b>девятка</b> («манела», 13), туз, десятка, король, дама. Очки: туз 11, десятка 10, король 3, дама 2, валет 1, мелочь — ноль.
          Последняя взятка — ещё 10. Всего в сдаче 150.</p>`,
      },
      {
        title: 'Пока есть колода',
        html: `<p>Первым ходит сосед сдатчика. Пока колода не кончилась, в масть ходить и бить <b>не обязательно</b> — можно снести любую карту
          и придержать нужные для комбинаций. Взятку берёт старшая карта масти захода или козырь. Потом оба добирают до девяти, взявший — первым.
          После первой взятки колоду «ломают»: не взявший подснимает её, добирают дальше из-под низа.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS 10S KD QD JD 8C 7H 9C 10D', 'AH KS QS 7D 10C JC 9D 8D QC'], 'QH', 12),
          steps: [
            A(0, { type: 'play', card: C('10S') }, 'Ипполит заходит десяткой пик — это 10 очков.'),
            A(1, { type: 'play', card: C('7D') }, 'Порфирий не обязан ни бить, ни ходить в масть: сносит пустую семёрку. Взятка у Ипполита, оба добирают.'),
          ],
        },
      },
      {
        title: 'Комбинации и «Рост?»',
        html: `<p>На своём заходе, пока на руках девять карт, можно объявить одну комбинацию (в «вольном» терце — сколько угодно):</p>
          <ul><li><b>терц</b> — три карты подряд одной масти, 20;</li><li><b>полтинник</b> (кварта) — четыре подряд, 50;</li>
          <li><b>сто</b> — пять и больше подряд, 100;</li><li>четыре туза, короля или дамы — 100, <b>четыре валета — 200</b> (только после ломки колоды).</li></ul>
          <p>Подряд — по порядку 7, 8, 9, 10, В, Д, К, Т. Соперник отвечает «Годится» — и очки пишет объявивший, или «Рост!» — показывает комбинацию старше:
          тогда очки пишет он, а перебитая сгорает. Старше та, где больше карт; при равных — со старшей картой; при равных — козырная; совсем равные — объявленная раньше.
          Четыре валета бьют всё; «сто» подряд — старше четырёх тузов. Одни и те же карты не идут в две последовательности.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['JD QD KD 8C 7H 9C 10D AS 10S', 'AH KS QS 7S 8S 9S 10H JC 9D'], 'QH', 12),
          steps: [
            A(0, { type: 'declare', combo: seq('D', [10, 11, 12, 13]) }, 'Ипполит: «Полтинник от короля бубен!»'),
            A(1, { type: 'answer', rost: false }, 'У Порфирия только терц пик — меньше. «Годится»: Ипполит пишет 50.'),
          ],
        },
      },
      {
        title: 'Марьяж и семёрка',
        html: `<p><b>Марьяж</b> — король и дама козыря, 20 очков. Его объявляют на своём ходу в любой момент; он не перебивает и не перебивается.
          Козырную <b>семёрку</b> на своём заходе можно обменять на открытый козырь, пока в колоде, кроме него, есть ещё хотя бы две карты.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['KH QH 7H AS 10S 8C 9C 10D JD', 'AH KS QS 7D 10C JC 9D 8D QC'], '10H', 12),
          steps: [
            A(0, { type: 'swap' }, 'Ипполит меняет семёрку червей на открытую десятку.'),
            A(0, { type: 'marriage' }, 'И объявляет марьяж — король и дама козыря, +20.'),
          ],
        },
      },
      {
        title: 'Разбор фрица',
        html: `<p>Колода кончилась — начинается «разбор фрица», здесь строго: в масть обязательно и <b>перебить</b>, если есть чем; нет масти — козырем;
          нет и козыря — любую. Козырного валета можно придержать до последней взятки — на него эти обязанности не распространяются.
          Комбинации ещё можно объявить в самом начале, пока на руках девять карт.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS 10S KD QD JD 8C 7C 9C 10D', 'KS QS 7S AC 10C JC 9D 8D AD'], null, 0, { broken: true, trump: 'H' }),
          steps: [
            A(0, { type: 'play', card: C('10S') }, 'Колоды нет. Ипполит заходит десяткой пик.'),
            A(1, { type: 'play', card: C('7S') }, 'Пики у Порфирия — король, дама и семёрка, но перебить десятку нечем: король и дама младше. Кладёт семёрку.'),
          ],
        },
      },
      {
        title: 'Счёт',
        html: `<p>Комбинации и марьяж пишут сразу. В конце сдачи каждому — очки его взяток; по договорённости их округляют до десятков (25 → 20, 26 → 30).
          Партия — до 501 (короткий терц — до 301). Добрались оба — выигрывает взявший последнюю взятку; он же сдаёт следующую.</p>`,
      },
    ],
  },
};
