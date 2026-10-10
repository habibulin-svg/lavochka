/* Техасский холдем — описание игры для сборника: стек, блайнды, рост блайндов; 2–9 игроков; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, deal, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#6a3d8f', light: '#9a70c0', dark: '#3a1f52' },
  { name: 'Колян', color: '#5a5a5a', light: '#9a9a9a', dark: '#2a2a2a' },
  { name: 'Светка', color: '#c2185b', light: '#e0609a', dark: '#6e0e34' },
  { name: 'Жека', color: '#0f7a7a', light: '#4ab0b0', dark: '#074242' },
  { name: 'Михалыч', color: '#8a5a2a', light: '#c08a50', dark: '#4a2e12' },
];

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;
const ACT: Record<string, string> = { fold: 'пас', check: 'чек', call: 'колл', raise: 'рейз', allin: 'ва-банк!' };
const STREET: Record<string, string> = { flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Раздача ${ev.hand}. Баттон — ${name(ev.button)}, блайнды ${ev.big / 2}/${ev.big}.`;
    case 'blinds':
      return `Блайнды растут: теперь ${ev.big / 2}/${ev.big}.`;
    case 'blind':
      return null;
    case 'act':
      return `${name(ev.seat)}: ${ACT[ev.action]}${ev.action === 'raise' || ev.action === 'allin' ? ` до ${ev.to}` : ev.action === 'call' ? ` ${ev.amount}` : ''}`;
    case 'street':
      return `${STREET[ev.street]}: ${ev.cards.map(cn).join(' ')}`;
    case 'show':
      return `${name(ev.seat)} открывает ${ev.cards.map(cn).join(' ')} — ${ev.hand}`;
    case 'win':
      return `💰 ${name(ev.seat)} забирает <b>${ev.amount}</b>${ev.hand ? ` (${ev.hand})` : ''}.`;
    case 'bust':
      return `${name(ev.seat)} вылетает.`;
    case 'end':
      return `🏆 <b>${name(ev.winner)}</b> забирает все фишки!`;
  }
  return null;
}

/** Чужие закрытые карты не показываем. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hole: ev.hole?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Раздача втроём: баттон — Серёга, малый блайнд — Вовка, большой — Ленка; карты и колода — заданные. */
function pos(holes: string[], deck: string): State {
  const s = deal(newState(cfgFrom({}), [0, 1, 2]), new SeededRng(3)).state;
  holes.forEach((h, i) => (s.hole[i] = L(h)));
  s.deck = L(deck);
  return s;
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
// колода после раздачи: сброс, флоп, сброс, тёрн, сброс, ривер
const DECK = '3C KS 9H 4H 5C 2H 6C 10C 8D 8S';

export const def: GameDef<State, Action, Event, View> = {
  id: 'holdem',
  title: 'Техасский холдем',
  players: { min: 2, max: 9, default: 5 },
  seats: SEATS,
  options: [
    {
      key: 'chips',
      label: 'Фишек у каждого',
      type: 'select',
      choices: [
        { value: 500, label: '500' },
        { value: 1000, label: '1000' },
        { value: 2000, label: '2000' },
      ],
      default: 1000,
    },
    {
      key: 'blind',
      label: 'Большой блайнд',
      type: 'select',
      choices: [
        { value: 10, label: '10' },
        { value: 20, label: '20' },
        { value: 50, label: '50' },
      ],
      default: 20,
    },
    {
      key: 'every',
      label: 'Блайнды удваиваются',
      type: 'select',
      choices: [
        { value: 5, label: 'каждые 5 раздач' },
        { value: 10, label: 'каждые 10 раздач' },
        { value: 20, label: 'каждые 20 раздач' },
        { value: 0, label: 'никогда' },
      ],
      default: 10,
    },
  ],
  presets: [
    { id: 'tourney', label: 'Турнир', hint: '1000 фишек, блайнды растут каждые 10 раздач', options: { chips: 1000, blind: 20, every: 10 } },
    { id: 'turbo', label: 'Турбо', hint: '500 фишек, блайнды растут каждые 5 раздач', options: { chips: 500, blind: 20, every: 5 } },
    { id: 'deep', label: 'Глубокие стеки', hint: '2000 фишек, рост каждые 20 раздач', options: { chips: 2000, blind: 20, every: 20 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.chips[x];
    return { winners: [s.winner], text: `все фишки — ${s.chips[s.winner]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(['AH KH', '7C 2D', 'QS QD'], DECK);
    s.board = L('KS 9H 4H');
    s.street = 'flop';
    s.chips = [880, 980, 880, 0, 0, 0, 0, 0, 0];
    s.total = [120, 20, 120, 0, 0, 0, 0, 0, 0];
    s.bet = [60, 0, 0, 0, 0, 0, 0, 0, 0];
    s.current = 60;
    s.folded[1] = true;
    s.turn = 2;
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Забрать все фишки соперников: выигрывать банки лучшей комбинацией — или заставить всех сбросить карты.',
    sections: [
      {
        title: 'Раздача и торговля',
        html: `<p>Каждому — две закрытые карты. Двое слева от баттона ставят <b>блайнды</b> — малый и большой. Затем торговля: каждый по очереди
          <b>пас</b> (сбросить карты), <b>колл</b> (уравнять ставку), <b>рейз</b> (поднять) или <b>чек</b>, если ставить не нужно.</p>
          <p>Потом открывают три общие карты — <b>флоп</b>, ещё одну — <b>тёрн</b>, и последнюю — <b>ривер</b>; после каждой — снова торговля.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH KH', '7C 2D', 'QS QD'], DECK),
          intro: 'Серёга на баттоне, Вовка — малый блайнд (10), Ленка — большой (20).',
          steps: [
            A(2, { type: 'raise', to: 60 }, 'У Серёги пара дам — поднимает до 60.'),
            A(0, { type: 'call' }, 'Вовка с тузом и королём червей уравнивает.'),
            A(1, { type: 'fold' }, 'Ленке с 7-2 тут нечего ловить — пас.'),
            A(0, { type: 'check' }, 'Флоп: К♠ 9♥ 4♥. У Вовки пара королей и четыре червы — пока чек.'),
            A(2, { type: 'raise', to: 80 }, 'Серёга ставит 80.'),
            A(0, { type: 'call' }, 'Вовка отвечает.'),
          ],
        },
      },
      {
        title: 'Комбинации',
        html: `<p>На вскрытии каждый составляет лучшую пятёрку из своих двух карт и пяти общих. Снизу вверх:</p><ol>
          <li>старшая карта;</li><li><b>пара</b>;</li><li><b>две пары</b>;</li><li><b>сет</b> — три одинаковые;</li>
          <li><b>стрит</b> — пять подряд (туз бывает и единицей: Т-2-3-4-5);</li><li><b>флеш</b> — пять одной масти;</li>
          <li><b>фулл-хаус</b> — сет и пара;</li><li><b>каре</b> — четыре одинаковые;</li><li><b>стрит-флеш</b> — стрит одной масти.</li></ol>
          <p>При равных комбинациях решают старшие карты (кикеры); совсем поровну — банк делят.</p>`,
      },
      {
        title: 'Ва-банк и побочные банки',
        html: `<p>Не хватает фишек уравнять — можно пойти <b>ва-банк</b> на все. Тогда игрок претендует только на ту часть банка, которую покрыл,
          а остальное разыгрывают между собой те, у кого фишек больше, — это <b>побочный банк</b>.</p>
          <p>Остался без фишек — вылетел. Блайнды со временем растут; побеждает тот, у кого окажутся все фишки.</p>`,
      },
    ],
  },
};
