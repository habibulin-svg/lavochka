/* Сундучок — описание игры для сборника: 36 или 52 карты, просьба ранга или конкретной карты, куда уходит ход после «базара».
 * 2–6 игроков; боты с памятью стола, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
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

/** Ранги во множественном числе (винительный: «дай тузов», «дай дам»). */
export const RANK_ACC: Record<number, string> = {
  2: 'двойки', 3: 'тройки', 4: 'четвёрки', 5: 'пятёрки', 6: 'шестёрки', 7: 'семёрки', 8: 'восьмёрки', 9: 'девятки', 10: 'десятки',
  11: 'вальтов', 12: 'дам', 13: 'королей', 14: 'тузов',
};
const RANK_ONE: Record<number, string> = {
  2: 'двойку', 3: 'тройку', 4: 'четвёрку', 5: 'пятёрку', 6: 'шестёрку', 7: 'семёрку', 8: 'восьмёрку', 9: 'девятку', 10: 'десятку',
  11: 'вальта', 12: 'даму', 13: 'короля', 14: 'туза',
};
export const askText = (rank: number, suit?: Suit) => (suit ? `${RANK_ONE[rank]} ${SUIT_SYM[suit]}` : RANK_ACC[rank]);
const RANK_GEN: Record<number, string> = { ...RANK_ACC, 2: 'двоек', 3: 'троек', 4: 'четвёрок', 5: 'пятёрок', 6: 'шестёрок', 7: 'семёрок', 8: 'восьмёрок', 9: 'девяток', 10: 'десяток' };
export const chestText = (rank: number) => `сундучок ${RANK_GEN[rank]}`;

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'ask':
      return `${name(ev.seat)}: «${name(ev.target)}, дай ${askText(ev.rank, ev.suit)}!» — ${ev.cards.length ? `отдаёт ${ev.cards.map(cn).join(' ')}` : '«Иди на базар!»'}`;
    case 'fish':
      return ev.lucky ? `${name(ev.seat)} вытянул с базара ${ev.card ? cn(ev.card) : 'ту самую'} — ходит ещё!` : null;
    case 'chest':
      return `${name(ev.seat)}: «Сундучок!» — ${chestText(ev.rank)}.`;
    case 'refill':
      return `${name(ev.seat)} берёт с базара ${ev.n}.`;
    case 'end': {
      const best = Math.max(...ev.chests);
      const who = ev.chests.map((c, i) => (c === best ? i : -1)).filter((i) => i >= 0);
      return `🏁 Все сундучки собраны. Больше всех — ${who.map(name).join(', ')} (${best}).`;
    }
  }
  return null;
}

/** Вытянутое с базара видит только тянувший (если не «та самая»). */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'fish' && !ev.lucky && !seats.includes(ev.seat)) return { ...ev, card: undefined };
  if (ev.type === 'refill' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], bazaar: string, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), hands.map((_, i) => i));
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.bazaar = L(bazaar);
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, target: number, rank: number, caption?: string) => ({ seat, action: { type: 'ask', target, rank } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'sunduchok',
  title: 'Сундучок',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 36, label: '36 карт — 9 сундучков' },
        { value: 52, label: '52 карты — 13 сундучков' },
      ],
      default: 36,
    },
    { key: 'suit', label: 'Просить с мастью', type: 'toggle', default: false, hint: '«Дай короля пик» — отдают только эту карту. Дольше и хитрее.' },
    { key: 'toAsked', label: 'Ход к спрошенному', type: 'toggle', default: false, hint: 'После «иди на базар» ход переходит к тому, у кого просили, а не к соседу.' },
  ],
  presets: [
    { id: 'classic', label: 'Дай тузов', hint: 'Просят ранг, отдают все карты ранга', options: { deck: 36, suit: false, toAsked: false } },
    { id: 'suit', label: 'С мастью', hint: '«Дай короля пик» — как Go Fish', options: { deck: 36, suit: true, toAsked: false } },
    { id: 'toAsked', label: 'Ход к спрошенному', hint: 'Не угадал — ходит тот, у кого просил', options: { deck: 36, suit: false, toAsked: true } },
    { id: 'big', label: '52 карты', hint: '13 сундучков — партия длиннее', options: { deck: 52, suit: false, toAsked: false } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const best = Math.max(...s.seats.map((p) => s.chests[p].length));
    const winners = s.seats.filter((p) => s.chests[p].length === best);
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.chests[p].length;
    return { winners, text: `больше всех сундучков — ${best}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(
      pos(['7S 7D 7C KH 9C 10D', 'QS 6H', 'AS AH 8D 6C'], '6S JD 9H 10C 8C 8H JS', {
        chests: [[12], [11, 13], []],
        last: { seat: 0, target: 1, rank: 7, got: 1, fish: false, lucky: false },
      }),
      [0]
    ),

  rules: {
    goal: 'Собрать больше всех «сундучков» — четвёрок карт одного ранга, выпрашивая недостающие карты у соперников.',
    sections: [
      {
        title: 'Раздача',
        html: `<p>Вдвоём сдают по 6 карт, втроём — по 5, вчетвером и больше — по 4. Остальное кладут посередине рубашкой вверх — это <b>базар</b>.</p>`,
      },
      {
        title: '«Дай семёрки!»',
        html: `<p>В свой ход попроси у любого соперника карты ранга, который <b>у тебя уже есть</b>. Есть у него такие — он обязан отдать все,
          и ты просишь дальше (у него же или у другого).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['7S 7D KH 9C', 'QS 7C 6H', 'AS 8D 6C'], '7H JD 9H 10C'),
          steps: [A(0, 1, 7, 'Вовка: «Ленка, дай семёрки!» — у неё есть, отдаёт. Вовка ходит дальше.')],
        },
      },
      {
        title: 'Иди на базар',
        html: `<p>Нет у соперника — «Иди на базар!»: тянешь верхнюю карту. Вытянул <b>тот самый</b> ранг — покажи и ходи дальше.
          Нет — ход переходит к соседу.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['7S 7D 7C KH 9C', 'QS 6H', 'AS 8D 6C'], '7H JD 9H 10C'),
          steps: [A(0, 2, 7, '«Серёга, дай семёрки!» — «Иди на базар!» А на базаре — семёрка червей: четвёртая. Сундучок, и ход дальше.')],
        },
      },
      {
        title: 'Сундучок',
        html: `<p>Собрал все четыре карты ранга — крикни «Сундучок!» и выложи их перед собой. Сундучок уже никто не отнимет.</p>
          <p>Кончились карты на руке — в свой ход берёшь с базара до четырёх. Когда все сундучки на столе, побеждает тот, у кого их больше.</p>
          <p>Варианты: просить конкретную карту («дай короля пик»); после неудачи ход переходит к тому, у кого просили.</p>`,
      },
    ],
  },
};
