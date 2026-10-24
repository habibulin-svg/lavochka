/* Рамми — описание игры для сборника: рамми (2–6), джин-рамми (вдвоём), кункен (2–6, две колоды с джокерами). Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';
import type { RCard } from './melds';

export const SEATS = [
  { name: 'Сэм', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Рита', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Боря', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Фира', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Додик', color: '#6b3fa0', light: '#9a76c8', dark: '#3b1f5e' },
  { name: 'Соня', color: '#1f8a8a', light: '#4fbcbc', dark: '#0f4a4a' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В', 15: '★' };
export const cn = (c: RCard) => (c.r === 15 ? '<b>★</b>' : `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`);

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}, в сброс — ${cn(ev.up)}.`;
    case 'draw':
      return ev.from === 'discard' && ev.card ? `${name(ev.seat)} берёт из сброса ${cn(ev.card)}.` : null;
    case 'meld':
      return `${name(ev.seat)} выкладывает ${ev.cards.map(cn).join(' ')}.`;
    case 'layoff':
      return `${name(ev.seat)} докладывает ${cn(ev.card)}.`;
    case 'discard':
      return ev.knock ? `${name(ev.seat)} сбрасывает ${cn(ev.card)} и <b>стучит</b>!` : null;
    case 'reshuffle':
      return 'Колода кончилась — сброс перемешан.';
    case 'show':
      return `${name(ev.seat)}: ${ev.melds.map((m) => m.map(cn).join('')).join(' · ')}${ev.dead.length ? ` | лишние ${ev.dead.map(cn).join(' ')} = ${ev.deadValue}` : ''}`;
    case 'hand':
      return ev.winner == null ? 'Сдача без победителя.' : `Сдача за ${name(ev.winner)}${ev.lines.length ? ` (${ev.lines.join('; ')})` : ''}.`;
    case 'end':
      return `🏁 Партия: ${name(ev.winner)}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'draw' && ev.from === 'stock' && !seats.includes(ev.seat)) return { ...ev, card: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): RCard => (t === 'JK' ? { s: 'H', r: 15, d: 0 } : { s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], stock: string, discard: string, opts: Options = {}, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.stock = L(stock);
  s.discard = L(discard);
  s.deal = 1;
  s.turn = 0;
  s.phase = 'draw';
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'rummy',
  title: 'Рамми',
  players: { min: 2, max: 6, default: 2 },
  countsFor: (o) => (o.mode === 'gin' ? [2] : [2, 3, 4, 5, 6]),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'rummy', label: 'рамми — выкладка на стол' },
        { value: 'gin', label: 'джин-рамми — вдвоём, стук' },
        { value: 'kunken', label: 'кункен — две колоды и джокеры' },
      ],
      default: 'rummy',
    },
    {
      key: 'target',
      label: 'До скольких',
      type: 'select',
      choices: [
        { value: 50, label: '50 — быстро' },
        { value: 100, label: '100' },
        { value: 150, label: '150' },
      ],
      default: 100,
      hint: 'В рамми и джине — очки победителя; в кункене — штрафные: кто набрал, тот проиграл.',
    },
  ],
  presets: [
    { id: 'rummy', label: 'Рамми', hint: 'Выкладывай наборы и последовательности, докладывай к любым — первым избавься от карт', options: { mode: 'rummy', target: 100 } },
    { id: 'gin', label: 'Джин-рамми', hint: 'Вдвоём: собери комбинации на руке и постучи — или «джин»', options: { mode: 'gin', target: 100 } },
    { id: 'kunken', label: 'Кункен', hint: 'Две колоды, джокеры, по 12 карт, первая выкладка на 40', options: { mode: 'kunken', target: 100 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.cfg.mode === 'kunken' ? -s.score[x] : s.score[x];
    return { winners: [s.winner], text: s.cfg.mode === 'kunken' ? `меньше всех штрафных — ${s.score[s.winner]}` : `${s.score[s.winner]} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(['5H 6H 9S 9D QC 2C AS', 'KC KD QS JS 3D 4H 8C'], '8H 2S 3S', '4C 7H', {}, {
      phase: 'play',
      melds: [
        { id: 1, owner: 1, cards: L('10D JD QD') },
        { id: 2, owner: 0, cards: L('3S 3H 3C') },
      ],
      nextMeld: 3,
      score: [34, 21],
      deal: 3,
    }),

  rules: {
    goal: 'Собрать карты в комбинации — наборы одного достоинства и последовательности одной масти — и первым избавиться от карт.',
    sections: [
      {
        title: 'Комбинации',
        html: `<p><b>Набор</b> — 3 или 4 карты одного достоинства (разных мастей). <b>Последовательность</b> — 3 и больше карт подряд одной масти; туз — младшая карта (Т-2-3).
          Очки карт: картинки — 10, туз — 1, остальные — по номиналу.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>Возьмите верхнюю карту колоды или сброса, выложите на стол комбинации, доложите карты к любым комбинациям на столе — и сбросьте одну карту.
          Кто первым избавился от всех карт, получает очки карт, оставшихся у соперников. Партия — до 100.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['5H 6H 7H 9S 9D 9C 2C', 'KC KD QS JS 3D 4H 8C'], '8H 2S 3S', '4C'),
          steps: [
            A(0, { type: 'draw', from: 'stock' }, 'Сэм берёт из колоды — восьмёрку червей.'),
            A(0, { type: 'meld', cards: L('5H 6H 7H 8H 9S 9D 9C') }, 'Выкладывает 5-6-7-8 червей и три девятки.'),
            A(0, { type: 'discard', card: C('2C') }, 'Последнюю карту — в сброс: Сэм вышел.'),
          ],
        },
      },
      {
        title: 'Джин-рамми',
        html: `<p>Вдвоём по 10 карт, на стол ничего не выкладывают. Сбросив карту, можно <b>постучать</b>, если карты вне комбинаций дают не больше 10 очков.
          Тогда оба раскрываются, и соперник докладывает свои лишние карты к вашим комбинациям. Ваших лишних меньше — вам разница;
          у соперника столько же или меньше — <b>андеркат</b>: ему разница и 25 сверху. Все десять в комбинациях — <b>джин</b>: 25 и все лишние соперника.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'gin' },
          setup: () => pos(['5H 6H 7H 9S 9D 9C 2C 3D AC AD', 'KC KD KH 4S 5S 6S 8D 8C 2H 3C'], '8H 2S 3S', '4C', { mode: 'gin' }),
          steps: [A(0, { type: 'draw', from: 'stock' }, 'Сэм берёт восьмёрку червей — к своей последовательности.'), A(0, { type: 'discard', card: C('3D'), knock: true }, 'Сбрасывает тройку и стучит: лишних всего 4 очка.')],
        },
      },
      {
        title: 'Кункен',
        html: `<p>Одесская игра на двух колодах с четырьмя джокерами, по 12 карт. Первая выкладка — сразу на <b>40 очков</b> и больше, докладывать к чужим можно, только выложившись.
          Последовательности бывают и через туза (К-Т-2), джокер заменяет любую карту, но джокеров не больше половины комбинации.
          Карту из сброса берут, только чтобы сразу пустить её в дело. Вышел — остальным штраф очками карт на руке (с джокером на руке — вдвойне),
          а за «экспресс» (вышел одним ходом, не выкладываясь раньше) — ещё вдвое. Набравший 100 штрафных проиграл.</p>`,
      },
    ],
  },
};
