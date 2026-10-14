/* Черви — описание игры для сборника: 52 или 36 карт, обмен тремя картами, Омнибус (валет бубен −10), до 100 или 50.
 * Ровно 4 игрока; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, winnersOf, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

export const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;
export const SHIFT_NAME: Record<number, string> = { 0: 'без обмена', 1: 'влево', 2: 'напротив', 3: 'вправо' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}: ${ev.shift ? `обмен тремя картами ${SHIFT_NAME[ev.shift]}` : 'без обмена'}.`;
    case 'trick':
      return ev.pts ? `${name(ev.seat)} берёт взятку: ${ev.cards.filter((c) => c.s === 'H' || (c.s === 'S' && c.r === 12) || (c.s === 'D' && c.r === 11)).map(cn).join(' ')} (${ev.pts > 0 ? '+' : ''}${ev.pts}).` : null;
    case 'round':
      return ev.moon != null ? `🌙 ${name(ev.moon)} выстрелил в луну! Остальным по ${Math.max(...ev.add)}.` : `Кон окончен: ${ev.add.map((x, i) => `${name(i)} ${x > 0 ? '+' : ''}${x}`).join(', ')}.`;
    case 'end':
      return `🏁 Партия окончена. Меньше всех у ${ev.winners.map(name).join(', ')}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'swap') return { ...ev, got: ev.got?.map((h, i) => (seats.includes(i) ? h : [])), gave: ev.gave?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2, 3]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.round = 1;
  s.played = 3;
  s.turn = 0;
  return Object.assign(s, extra);
}
const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'hearts',
  title: 'Черви',
  players: { min: 4, max: 4, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 52, label: '52 карты, по 13' },
        { value: 36, label: '36 карт, по 9 — дворовые' },
      ],
      default: 52,
    },
    { key: 'pass', label: 'Обмен тремя картами', type: 'toggle', default: true, hint: 'Влево, вправо, напротив, четвёртый кон — без обмена.' },
    { key: 'omnibus', label: 'Омнибус', type: 'toggle', default: false, hint: 'Валет бубен во взятке — минус 10 очков.' },
    {
      key: 'limit',
      label: 'До скольких',
      type: 'select',
      choices: [
        { value: 100, label: 'до 100' },
        { value: 50, label: 'до 50 — быстрее' },
      ],
      default: 100,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классика', hint: 'Как в Windows: 52 карты, обмен', options: { deck: 52, pass: true, omnibus: false, limit: 100 } },
    { id: 'omnibus', label: 'Омнибус', hint: 'Валет бубен — минус 10', options: { deck: 52, pass: true, omnibus: true, limit: 100 } },
    { id: 'yard', label: 'Дворовые', hint: '36 карт, до 50', options: { deck: 36, pass: true, omnibus: false, limit: 50 } },
    { id: 'nopass', label: 'Без обмена', hint: 'Играют тем, что пришло', options: { deck: 52, pass: false, omnibus: false, limit: 100 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = -s.score[p];
    return { winners: winnersOf(s), text: 'меньше всех штрафа', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(
      pos(['2S 5S 9S 3H 8H JH KD 4C 10C', 'AS 7H 2D 6D QC 8C 3C 9D', '3S 6S 10H 5D 8D JC AC 7C', 'KS 2H 4H 9H AH 4D 7D 5C'], {
        trick: [
          { seat: 1, card: C('KC') },
          { seat: 2, card: C('QS') },
          { seat: 3, card: C('6C') },
        ],
        taken: [[], [], L('5H QH'), []],
        tricks: [1, 2, 1, 0],
        score: [12, 30, 7, 21],
        broken: true,
      }),
      [0]
    ),

  rules: {
    goal: 'Не брать взяток с червами и дамой пик — каждая черва стоит очко штрафа, дама пик — 13. Партия до 100: меньше всех — победа.',
    sections: [
      {
        title: 'Раздача и обмен',
        html: `<p>Четверо, каждый за себя, колода 52 карты по 13 (во дворе — 36 по 9). Перед коном каждый отдаёт три ненужные карты:
          в первом коне — соседу <b>слева</b>, во втором — <b>справа</b>, в третьем — <b>напротив</b>, в четвёртом — без обмена.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>Начинает тот, у кого <b>двойка треф</b> (в 36 картах — шестёрка), — ею и заходит. В масть ходить обязательно; нет масти — сбрасывай
          любую карту. Взятку берёт старшая карта масти захода, козырей нет.</p>
          <p>В первой взятке нельзя сбрасывать черви и даму пик. Заходить с червей нельзя, пока черву кто-нибудь не сбросил.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['KS 7S 3D', '7H 9S 4C', 'QS 5D 2C', '10S 2H JC']),
          steps: [P(0, 'KS', 'Вовка заходит королём пик.'), P(1, '9S', 'Ленка обязана в масть.'), P(2, 'QS', 'У Серёги из пик — только дама: приходится класть её.'), P(3, '10S', 'Король старше: Вовка берёт взятку и 13 очков штрафа.')],
        },
      },
      {
        title: 'Счёт и луна',
        html: `<p>Каждая черва во взятках — 1 очко, дама пик — 13. Взял <b>все</b> черви и даму пик — «выстрел в луну»: себе 0, остальным по 26.</p>
          <p><b>Омнибус</b>: валет бубен во взятках — минус 10. Партия идёт, пока кто-нибудь не наберёт 100 (или 50).</p>`,
      },
    ],
  },
};
