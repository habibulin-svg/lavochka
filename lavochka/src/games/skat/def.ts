/* Скат — описание игры для сборника: втроём, торги, масть / гранд / нуль, счёт простой или по Зегеру–Фабиану. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type GameKind, type State, type View } from './engine';

export const SEATS = [
  { name: 'Ганс', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Фриц', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Лотта', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
];

export const GAME_RU = (k: GameKind) => (k === 'grand' ? 'гранд' : k === 'null' ? 'нуль' : `${SUIT_SYM[k]} ${SUIT_NAME[k]}`);
const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
const cn = (c: Card) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}.`;
    case 'bid':
      return `${name(ev.seat)}: ${ev.n}.`;
    case 'hold':
      return `${name(ev.seat)}: да.`;
    case 'pass':
      return `${name(ev.seat)}: пас.`;
    case 'won':
      return `Играет ${name(ev.seat)}, заявка ${ev.bid}.`;
    case 'skat':
      return ev.take ? `${name(ev.seat)} берёт скат.` : `${name(ev.seat)} играет с руки.`;
    case 'declare':
      return `${name(ev.seat)}: ${GAME_RU(ev.contract.kind)}${ev.contract.hand ? ', с руки' : ''}${ev.contract.schneider ? ', объявлен шнайдер' : ''}${ev.contract.schwarz ? ', шварц' : ''}${ev.contract.ouvert ? ', открытая' : ''}${ev.ouvertHand ? `: ${ev.ouvertHand.map(cn).join(' ')}` : ''}.`;
    case 'hand':
      return `${ev.won ? 'Выиграно' : 'Проиграно'}: ${ev.value} (очков ${ev.pts}${ev.lines.length ? `; ${ev.lines.join(', ')}` : ''}). Счёт ${ev.score.join(' : ')}.`;
    case 'end':
      return `🏁 Партия — ${name(ev.winner)}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'skat' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], skat: string, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.skat = L(skat);
  s.dealer = 2;
  s.deal = 1;
  s.asker = 1;
  s.listener = 0;
  s.turn = 1;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const H0 = 'JC JS AH 10H KH 9H AS 10S 7D 8D';
const H1 = 'JH QH 8H AC 10C KC QS 9S 7S KD';
const H2 = 'JD 7H AD 10D QD 9D QC 9C 8C 7C';

export const def: GameDef<State, Action, Event, View> = {
  id: 'skat',
  title: 'Скат',
  players: { min: 3, max: 3, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'deals',
      label: 'Сдач в партии',
      type: 'select',
      choices: [
        { value: 6, label: '6 — быстро' },
        { value: 12, label: '12' },
        { value: 24, label: '24' },
        { value: 36, label: '36' },
      ],
      default: 12,
    },
    { key: 'fabian', label: 'Счёт Зегера–Фабиана', type: 'toggle', default: true, hint: 'Турнирный: +50 за выигранную игру, −50 за проигранную и по 40 соперникам.' },
  ],
  presets: [
    { id: 'classic', label: 'Скат', hint: '12 сдач, турнирный счёт', options: { deals: 12, fabian: true } },
    { id: 'simple', label: 'Простой счёт', hint: 'Только ценность игр, 12 сдач', options: { deals: 12, fabian: false } },
    { id: 'quick', label: 'Шесть сдач', hint: 'Короткая партия', options: { deals: 6, fabian: true } },
    { id: 'long', label: 'Длинный', hint: '36 сдач — по 12 на каждого сдатчика', options: { deals: 36, fabian: true } },
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
    pos([H0, H1, H2], 'KS QH', {
      phase: 'play',
      declarer: 0,
      bid: 36,
      contract: { kind: 'H', hand: false },
      trick: [{ seat: 1, card: C('AC') }],
      turn: 2,
      score: [184, -96, 40],
      deal: 7,
    }),

  rules: {
    goal: 'Взяв торги, набрать во взятках 61 очко из 120 — одному против двоих; иначе помешать играющему.',
    sections: [
      {
        title: 'Карты и козыри',
        html: `<p>32 карты, втроём по 10, две — в скат. Очки: туз 11, десятка 10, король 4, дама 3, валет 2. Старшие козыри — <b>вальты</b> (трефовый, пиковый, червовый, бубновый),
          за ними козырная масть: туз, десятка, король, дама, 9, 8, 7. Валет — всегда козырь, а не своя масть.</p>`,
      },
      {
        title: 'Торги',
        html: `<p>Второй называет числа первому — 18, 20, 22, 23, 24, 27, 30… — тот отвечает «да» или «пас». Потом третий торгуется с победителем. Кто удержался, играет один против двоих:
          берёт скат и сносит две карты — или играет «с руки». Число в торгах — сколько стоит игра, которую он собирается объявить.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([H0, H1, H2], 'KS QH'),
          steps: [A(1, { type: 'bid', n: 18 }, 'Фриц называет 18.'), A(0, { type: 'hold' }, 'Ганс: «да».'), A(1, { type: 'pass' }, 'Фриц пасует.'), A(2, { type: 'pass' }, 'Лотта тоже — играет Ганс.')],
        },
      },
      {
        title: 'Игра и её цена',
        html: `<p>Играющий объявляет масть (трефы 12, пики 11, червы 10, бубны 9), <b>гранд</b> (24, козыри — только вальты) или <b>нуль</b> (не взять ни одной взятки: 23, с руки 35, открытый 46).
          Цена — базовое число × множитель: <b>матадоры</b> (вальты и козыри подряд от трефового — «с ними» или «без них» столько, сколько не хватает) + 1, плюс за игру с руки, шнайдер (90 очков) и шварц (все взятки).
          Если цена меньше заявки — перебор, игра проиграна.</p>`,
      },
      {
        title: 'Счёт',
        html: `<p>Выиграл — записывает цену игры, проиграл — минус двойную цену. По турнирному счёту Зегера–Фабиана ещё +50 за выигрыш, −50 за проигрыш и по 40 соперникам.
          Партия — заданное число сдач, побеждает тот, у кого больше.</p>`,
      },
    ],
  },
};
