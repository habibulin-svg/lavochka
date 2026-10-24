/* Французское таро — описание игры для сборника: 3–5 игроков, торги в один круг, прикуп, удлеры, пуанье, пти о бу. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { minor, tarotLabel, tarotName } from '../../cards/tarot';
import { choose } from './ai';
import { apply, cfgFrom, CONTRACT_RU, EXCUSE, makeView, MONDE, newState, PETIT, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Жан', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Мари', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Пьер', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Софи', color: '#8a5a1e', light: '#c58a3e', dark: '#4e300c' },
  { name: 'Люк', color: '#6a3d8a', light: '#9a6dbb', dark: '#3a1f4e' },
];

/** Короткое имя карты для журнала: «XXI», «Эскюз», «король Мечей». */
export const cardRu = (c: number) => (c === EXCUSE ? 'Эскюз' : c >= 1 && c <= 21 ? `козырь ${tarotLabel(c).split('.')[0]}` : tarotName(c).toLowerCase());

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}.`;
    case 'petitSec':
      return `У ${name(ev.seat)} «пти сек» — пересдача.`;
    case 'bid':
      return `${name(ev.seat)}: ${CONTRACT_RU[ev.c]}.`;
    case 'pass':
      return `${name(ev.seat)}: пас.`;
    case 'redeal':
      return 'Все спасовали — пересдача.';
    case 'won':
      return `Играет ${name(ev.seat)}: ${CONTRACT_RU[ev.c]}.`;
    case 'call':
      return `${name(ev.seat)} называет: ${cardRu(ev.card)}.`;
    case 'chien':
      return ev.cards ? `Прикуп: ${ev.cards.map(cardRu).join(', ')}.` : ev.to === 'taker' ? 'Прикуп — в очки взявшему, не глядя.' : 'Прикуп — в очки защите.';
    case 'discard':
      return `${name(ev.seat)} снёс прикуп${ev.trumps.length ? `, в сносе козыри: ${ev.trumps.map(cardRu).join(', ')}` : ''}.`;
    case 'poignee':
      return `${name(ev.seat)}: ${['', 'одинарная', 'двойная', 'тройная'][ev.level]} пуанье — ${ev.cards.length} козырей.`;
    case 'partner':
      return `Напарник взявшего — ${name(ev.seat)}.`;
    case 'hand': {
      const r = ev.res;
      return `${name(r.taker)}${r.partner != null ? ` и ${name(r.partner)}` : ''}: ${r.won ? 'выиграно' : 'проиграно'} — ${r.pts} из нужных ${r.need} (удлеров ${r.oudlers}). ${r.lines.join(', ')}. Счёт ${ev.score.filter((x) => x != null).join(' : ')}.`;
    }
    case 'end':
      return `🏁 Партия — ${name(ev.winner)}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 2 }));
const W = (r: number) => minor('W', r);
const C = (r: number) => minor('C', r);
const S = (r: number) => minor('S', r);
const P = (r: number) => minor('P', r);

/** Позиция для показа: вчетвером, сдавал Софи, первый — Жан. */
function pos(hands: number[][], chien: number[], extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2, 3]);
  hands.forEach((h, i) => (s.hands[i] = h));
  s.chien = chien;
  s.dealer = 3;
  s.deal = 1;
  s.turn = 0;
  for (const x of s.seats) s.poignee[x] = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

// руки для показа: у Жана много козырей и XXI
const H0 = [MONDE, 19, 17, 15, 12, 9, 6, 4, W(14), W(13), W(5), C(14), C(3), S(12), S(2), P(14), P(9), P(1)];
const H1 = [20, 18, 13, 8, 3, W(12), W(9), W(2), C(13), C(10), C(6), C(1), S(14), S(9), S(4), P(13), P(6), P(2)];
const H2 = [EXCUSE, 16, 11, 7, 2, W(11), W(8), W(3), C(12), C(9), C(5), S(13), S(10), S(6), S(1), P(12), P(8), P(4)];
const H3 = [PETIT, 14, 10, 5, W(10), W(7), W(4), W(1), C(11), C(8), C(4), C(2), S(11), S(8), S(5), P(11), P(10), P(7)];
const CHIEN = [W(6), C(7), S(7), S(3), P(5), P(3)];

export const def: GameDef<State, Action, Event, View> = {
  id: 'tarot',
  title: 'Французское таро',
  players: { min: 3, max: 5, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'rounds',
      label: 'Длина партии',
      type: 'select',
      choices: [
        { value: 1, label: 'по сдаче на каждого' },
        { value: 2, label: 'по две сдачи на каждого' },
        { value: 3, label: 'по три' },
        { value: 4, label: 'по четыре' },
      ],
      default: 2,
    },
    { key: 'bonuses', label: 'Пуанье и «пти о бу»', type: 'toggle', default: true, hint: 'Премии за 10/13/15 козырей на руке и за козырь I в последней взятке.' },
  ],
  presets: [
    { id: 'classic', label: 'Таро', hint: 'По правилам Французской федерации, по две сдачи на каждого', options: { rounds: 2, bonuses: true } },
    { id: 'quick', label: 'Короткая партия', hint: 'По одной сдаче на каждого', options: { rounds: 1, bonuses: true } },
    { id: 'simple', label: 'Без премий', hint: 'Только заявка и очки — для знакомства с игрой', options: { rounds: 2, bonuses: false } },
    { id: 'long', label: 'Длинная', hint: 'По четыре сдачи на каждого', options: { rounds: 4, bonuses: true } },
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
    pos([H0.slice(3), H1.slice(2), H2.slice(2), H3.slice(2)], [], {
      phase: 'play',
      taker: 0,
      contract: 2,
      chienOpen: true,
      ecart: CHIEN,
      trick: [
        { seat: 1, card: 20 },
        { seat: 2, card: 16 },
        { seat: 3, card: 14 },
      ],
      turn: 0,
      score: [212, -86, -40, -86],
      deal: 4,
    }),

  rules: {
    goal: 'Взяв торги, набрать во взятках нужные очки (от 36 до 56 — чем больше удлеров, тем меньше) одному против всех; иначе — помешать взявшему.',
    sections: [
      {
        title: 'Колода и очки',
        html: `<p>78 карт: <b>21 козырь</b> (старшие арканы, сильнее всех — XXI), <b>Эскюз</b> (Шут) и четыре масти по 14 карт: король, дама, рыцарь, паж, 10…1.
          Три карты особые — <b>удлеры</b>: XXI, I («пти») и Эскюз. Очки: удлеры и короли — 4,5, дамы — 3,5, рыцари — 2,5, пажи — 1,5, остальные — 0,5; всего 91.</p>
          <p>Вчетвером — по 18 карт и 6 в прикуп; втроём — по 24 и 6; впятером — по 15 и 3.</p>`,
      },
      {
        title: 'Торги',
        html: `<p>Один круг, начиная с соседа сдающего: пас или заявка выше прежней — <b>малая</b> (×1), <b>гард</b> (×2), <b>гард без прикупа</b> (×4), <b>гард против прикупа</b> (×6).
          Все спасовали — пересдача. Взявший играет один против всех; впятером он называет короля — у кого этот король, тот его тайный напарник.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([H0, H1, H2, H3], CHIEN),
          steps: [
            A(0, { type: 'bid', c: 2 }, 'У Жана семь козырей с XXI и два короля — он заявляет гард.'),
            A(1, { type: 'pass' }, 'Мари пасует.'),
            A(2, { type: 'pass' }, 'Пьер пасует.'),
            A(3, { type: 'pass' }, 'Софи пасует — играет Жан.'),
          ],
        },
      },
      {
        title: 'Прикуп',
        html: `<p>При малой и гарде прикуп открывают всем, взявший берёт его и сносит столько же карт — их очки его. Сносить нельзя королей и удлеров,
          козыри — только если больше нечего (их показывают). Гард без прикупа — прикуп не открывают, его очки взявшему; гард против — защите.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([H0, H1, H2, H3], CHIEN, { phase: 'bid', bids: [2, 0, 0, null], turn: 3 }),
          steps: [
            A(3, { type: 'pass' }, 'Софи пасует — прикуп открывают, Жан забирает его.'),
            A(0, { type: 'discard', cards: [W(6), W(5), C(7), C(3), S(7), S(3)] }, 'Жан сносит мелкие кубки и мечи — оставляет короли и козыри.'),
          ],
        },
      },
      {
        title: 'Как ходят',
        html: `<p>В масть ходить обязательно. Нет масти — надо бить козырем, а если во взятке уже есть козырь — <b>перебить</b> его старшим, когда есть чем.
          Нечем — любую карту. Взятку берёт старший козырь, а без козырей — старшая карта масти хода.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([H0.slice(1), H1, H2, H3], [], { phase: 'play', taker: 0, contract: 2, ecart: CHIEN, turn: 1 }),
          steps: [
            A(1, { type: 'play', card: S(14) }, 'Мари ходит королём мечей.'),
            A(2, { type: 'play', card: S(13) }, 'Пьер — в масть, дамой.'),
            A(3, { type: 'play', card: S(11) }, 'Софи — пажом.'),
            A(0, { type: 'play', card: S(12) }, 'Жан — рыцарем, король Мари берёт взятку.'),
          ],
        },
      },
      {
        title: 'Эскюз',
        html: `<p>Эскюз можно сыграть в любую взятку вместо положенной карты. Взятку он не берёт, но остаётся у хозяина (его 4,5 очка), а взявшему тот отдаёт полочка взамен.
          В последней взятке Эскюз пропадает — уходит взявшему, если только его сторона не взяла все взятки до этого.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([H0, H1, H2, H3], [], { phase: 'play', taker: 0, contract: 2, ecart: CHIEN, turn: 1 }),
          steps: [
            A(1, { type: 'play', card: C(13) }, 'Мари ходит дамой кубков.'),
            A(2, { type: 'play', card: EXCUSE }, 'Пьер не хочет отдавать даму — играет Эскюз.'),
            A(3, { type: 'play', card: C(11) }, 'Софи — пажом.'),
            A(0, { type: 'play', card: C(14) }, 'Жан берёт королём. Эскюз Пьер оставит себе.'),
          ],
        },
      },
      {
        title: 'Счёт',
        html: `<p>Взявшему нужно <b>56</b> очков без удлеров, <b>51</b> с одним, <b>41</b> с двумя, <b>36</b> с тремя. Цена сдачи — (25 + разница) × множитель заявки.
          <b>Пти о бу</b>: козырь I в последней взятке — 10 × множитель тому, кто её взял. <b>Пуанье</b>: 10, 13 или 15 козырей (вчетвером), показанные перед первой картой, —
          20, 30 или 40 той стороне, что выиграла заявку. <b>Шлем</b> — все взятки — 200. Взявший получает цену с каждого защитника (или платит каждому).</p>`,
      },
    ],
  },
};
