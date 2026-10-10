/* Тысяча — описание игры для сборника: бочка, болты, самосвал, шаг торговли; втроём и вчетвером; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, MARRIAGE, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}, сдаёт ${name(ev.dealer)}.${ev.dealerBonus ? ` В прикупе марьяж — сдающему +${ev.dealerBonus}.` : ''}`;
    case 'bid':
      return `${name(ev.seat)}: ${ev.value}`;
    case 'pass':
      return `${name(ev.seat)}: пас`;
    case 'prikup':
      return `${name(ev.seat)}: прикуп за ${ev.bid} — ${ev.cards.map(cn).join(' ')}`;
    case 'give':
      return ev.card ? `${name(ev.seat)} отдаёт ${name(ev.to)} ${cn(ev.card)}` : `${name(ev.seat)} отдаёт карту ${name(ev.to)}`;
    case 'raise':
      return `${name(ev.seat)} поднимает заказ до <b>${ev.value}</b>`;
    case 'play':
      return ev.marriage ? `${name(ev.seat)}: марьяж ${SUIT_SYM[ev.marriage]} — <b>+${MARRIAGE[ev.marriage]}</b>, козырь ${SUIT_SYM[ev.marriage]}!` : null;
    case 'trick':
      return null;
    case 'score': {
      const lines = ev.deltas.map((d, i) => ({ d, i })).filter((x) => x.d !== 0 || x.i === ev.bidder);
      const notes = ev.notes
        .map((n) => {
          const [k, v] = n.split(':');
          const who = name(+v);
          return k === 'bolt' ? `${who} — болт` : k === 'bolt3' ? `${who}: три болта, −120` : k === 'barrel' ? `${who} на бочке!` : k === 'fall' ? `${who} слетает с бочки` : k === 'dump' ? `${who}: самосвал, 555 → 0` : '';
        })
        .filter(Boolean);
      return `${name(ev.bidder)}: заказ ${ev.bid} ${ev.made ? 'сыгран' : '<b>не сыгран</b>'} (набрано ${ev.pts[ev.bidder]}). ${lines.map((x) => `${name(x.i)} ${x.d >= 0 ? '+' : ''}${x.d}`).join(', ')}${notes.length ? '. ' + notes.join('; ') : ''}.`;
    }
    case 'end':
      return `🏆 <b>${name(ev.winner)}</b> — тысяча!`;
  }
  return null;
}

/** Чужие карты не показываем: раздача — только своя рука, отданная карта — только двоим. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'give' && !seats.includes(ev.seat) && !seats.includes(ev.to)) return { ...ev, card: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => {
  const s = t.slice(-1) as Suit;
  const r = t.slice(0, -1);
  return { s, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[r] ?? Number(r) };
};
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция: руки трёх игроков, прикуп; торговля с Вовки (он «на ста»), ходит следующий. */
function pos(hands: string[], prikup: string, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2]);
  s.players = [0, 1, 2];
  s.dealer = 2;
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.prikup = L(prikup);
  s.round = 1;
  s.bidder = 0;
  s.turn = 1;
  return Object.assign(s, extra);
}

const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'thousand',
  title: 'Тысяча',
  players: { min: 3, max: 4, default: 3 },
  seats: SEATS,
  options: [
    { key: 'barrel', label: 'Бочка', type: 'toggle', default: true, hint: 'С 880 очков сидишь на бочке: выйти на 1000 можно только своим заказом, три попытки.' },
    { key: 'bolts', label: 'Болты', type: 'toggle', default: true, hint: 'Кон без единой взятки — болт; три болта — минус 120.' },
    { key: 'dump', label: 'Самосвал', type: 'toggle', default: false, hint: 'Ровно 555 очков — сгорают до нуля.' },
    {
      key: 'step',
      label: 'Шаг торговли',
      type: 'select',
      choices: [
        { value: 5, label: 'по 5' },
        { value: 10, label: 'по 10' },
      ],
      default: 5,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классическая', hint: 'Бочка и болты', options: { barrel: true, bolts: true, dump: false, step: 5 } },
    { id: 'simple', label: 'Простая', hint: 'Без бочки и болтов — кто первым до тысячи', options: { barrel: false, bolts: false, dump: false, step: 5 } },
    { id: 'full', label: 'С самосвалом', hint: 'Бочка, болты и 555 — в ноль', options: { barrel: true, bolts: true, dump: true, step: 5 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.scores[x];
    return { winners: [s.winner], text: `набрал ${s.scores[s.winner]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  // середина кона: Вовка играет 140, черви — козырь, на столе взятка
  showcase: () =>
    makeView(
      pos(['10H KH QH 9S JC 10D KC', 'KS 9H JH AD QC', 'JS 10C 9C KD QD'], '', {
        phase: 'play',
        players: [0, 1, 2],
        turn: 0,
        bidder: 0,
        bid: 140,
        trump: 'H',
        tricksPlayed: 2,
        trick: { leader: 1, cards: [{ seat: 1, card: C('AS') }, { seat: 2, card: C('QS') }] },
        scores: [340, 215, 480, 0],
        roundPts: [111, 15, 0, 0],
      }),
      [0]
    ),

  rules: {
    goal: 'Первым набрать <b>1000</b> очков. Очки дают взятки и марьяжи; кто заказал и не набрал — пишет минус.',
    sections: [
      {
        title: 'Карты и очки',
        html: `<p>Колода — 24 карты, от девятки до туза. Старшинство и очки: <b>туз</b> — 11, <b>десятка</b> — 10, <b>король</b> — 4, <b>дама</b> — 3, <b>валет</b> — 2, девятка — 0.
          Всего в колоде 120 очков. Десятка старше короля!</p>
          <p>Втроём раздают по 7 карт, три кладут в <b>прикуп</b>. Вчетвером сдающий не играет, а если в прикупе марьяж — получает его очки.</p>`,
      },
      {
        title: 'Торговля и прикуп',
        html: `<p>Первый за сдающим «сидит на ста» — уже назвал 100. Дальше по кругу: поднять на 5 (или пас). Больше 120 можно заказать, только если на руке есть марьяж.
          Кто назвал больше всех, берёт прикуп — его видят все, — отдаёт по карте каждому сопернику и может поднять заказ.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH 10H KH QH 9S JC 10D', 'AS 10S KS 9H JH AD QC', 'QS JS AC 10C KC 9C KD'], 'QD JD 9D'),
          intro: 'Вовка «на ста». У него марьяж ♥ — можно торговаться и выше 120.',
          steps: [
            A(1, { type: 'bid', value: 105 }, 'Ленка: 105.'),
            A(2, { type: 'pass' }, 'Серёга: пас.'),
            A(0, { type: 'bid', value: 110 }, 'Вовка: 110.'),
            A(1, { type: 'pass' }, 'Ленка пасует — прикуп Вовкин.'),
            A(0, { type: 'give', to: 1, card: C('9S') }, 'Вовка отдаёт Ленке девятку…'),
            A(0, { type: 'give', to: 2, card: C('JD') }, '…а Серёге — валета.'),
            A(0, { type: 'raise', value: 140 }, 'И поднимает заказ до 140: на марьяж рассчитывает.'),
          ],
        },
      },
      {
        title: 'Ход и марьяж',
        html: `<p>Первым ходит заказчик. Ходят <b>в масть</b>; нет масти — надо бить <b>козырем</b>; нет и козыря — любую карту. Взятку берёт старшая карта масти хода или старший козырь.</p>
          <p><b>Марьяж</b> — король и дама одной масти: ♥ 100, ♦ 80, ♣ 60, ♠ 40. Его объявляют, заходя с короля или дамы пары (не в первый ход кона), —
          очки сразу ваши, а масть становится козырем.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH 10H KH QH 9S JC 10D', 'AS 10S KS 9H JH AD QC', 'QS JS AC 10C KC 9C KD'], '', { phase: 'play', turn: 0, bidder: 0, bid: 120, players: [0, 1, 2] }),
          intro: 'Вовка играет 120 и ходит первым.',
          steps: [
            A(0, { type: 'play', card: C('AH') }, 'Туз червей…'),
            A(1, { type: 'play', card: C('9H') }, 'Ленка кладёт в масть.'),
            A(2, { type: 'play', card: C('KD') }, 'У Серёги червей нет, козыря нет — сбрасывает. Взятка Вовкина.'),
            A(0, { type: 'play', card: C('QH'), marriage: true }, 'Теперь можно: дама червей — марьяж! +100, черви — козырь.'),
          ],
        },
      },
      {
        title: 'Подсчёт',
        html: `<p>Заказчик набрал заказ (взятки + марьяжи) — пишет заказ, не набрал — пишет минус заказ. Остальные пишут свои очки, округлённые до 5.</p>
          <p><b>Бочка</b>: с 880 очков игрок «на бочке» — очки ему не пишут, выйти на 1000 он может только своим заказом, на это три кона; не вышел — минус 120.
          Двое на бочке не сидят — новый сталкивает прежнего. <b>Болт</b> — кон без единой взятки; за три болта — минус 120. <b>Самосвал</b>: ровно 555 — в ноль.</p>`,
      },
    ],
  },
};

