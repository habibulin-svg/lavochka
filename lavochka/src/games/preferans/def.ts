/* Преферанс — описание игры для сборника: «Сочи» и «Ленинград», пуля до 10/20/30; втроём и вчетвером; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { sameCard, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, bidName, cfgFrom, makeDeck32, makeView, newState, setup, toAct, type Action, type Bid, type Event, type State, type View } from './engine';

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
      return `Сдача ${ev.round}, сдаёт ${name(ev.dealer)}.`;
    case 'bid':
      return `${name(ev.seat)}: ${bidName(ev.bid)}`;
    case 'pass':
      return `${name(ev.seat)}: пас`;
    case 'prikup':
      return `Прикуп: ${ev.cards.map(cn).join(' ')} — ${name(ev.seat)} берёт.`;
    case 'raspasy':
      return '<b>Распасы!</b>';
    case 'discard':
      return `${name(ev.seat)} сносит две карты.`;
    case 'contract':
      return `${name(ev.seat)} играет <b>${bidName(ev.bid)}</b>.`;
    case 'whist':
      return `${name(ev.seat)}: ${ev.whist ? 'вист' : 'пас'}`;
    case 'open':
      return `Карты ${name(ev.seat)} открыты.`;
    case 'score': {
      const d = ev.declarer;
      if (ev.kind === 'raspasy') return `Распасы: взятки — ${ev.players.map((i) => `${name(i)} ${ev.tricks[i]}`).join(', ')}.`;
      if (ev.kind === 'free') return `Вистовать никто не стал — ${name(d)}: ${bidName(ev.contract)} сыграна.`;
      return `${name(d)}: ${bidName(ev.contract)} ${ev.made ? 'сыграна' : '<b>без взяток: ' + (ev.contract && 'level' in ev.contract ? ev.contract.level - ev.tricks[d] : ev.tricks[d]) + '</b>'} (взяток ${ev.tricks[d]}).`;
    }
    case 'end':
      return `🏁 Пуля закрыта. Итог в вистах: ${ev.final.map((v, i) => ({ v, i })).filter((x) => x.v !== 0).map((x) => `${name(x.i)} ${x.v > 0 ? '+' : ''}${x.v}`).join(', ') || 'все при своих'}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'discard' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция втроём: сдаёт Серёга, первая рука — Вовка. */
function pos(hands: string[], prikup: string, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2]);
  s.players = [0, 1, 2];
  s.dealer = 2;
  s.turn = 0;
  s.round = 1;
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.prikup = L(prikup);
  return Object.assign(s, extra);
}

/** Мизерная рука Вовки, остальное — соперникам и в прикуп. */
function miserePos(): State {
  const mine = L('7S 9S JS 7C 9C 7D 9D JD 7H 8H');
  const rest = makeDeck32().filter((c) => !mine.some((x) => sameCard(x, c)));
  const s = pos([], '');
  s.hands[0] = mine;
  s.hands[1] = rest.slice(0, 10);
  s.hands[2] = rest.slice(10, 20);
  s.prikup = rest.slice(20, 22);
  return s;
}

const HANDS = ['AS KS QS JS 10S 9S AH KH 7C 7D', '8S 7S AC KC QC JC 10C 9C 8C AD', 'KD QD JD 10D 9D 8D QH JH 10H 9H'];
const B = (seat: number, bid: Bid, caption?: string) => ({ seat, action: { type: 'bid', bid } as Action, caption });
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'preferans',
  title: 'Преферанс',
  players: { min: 3, max: 4, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Запись',
      type: 'select',
      choices: [
        { value: 'sochi', label: '«Сочи» — классика' },
        { value: 'leningrad', label: '«Ленинград» — висты вдвойне, распасы с прогрессией' },
      ],
      default: 'sochi',
    },
    {
      key: 'pulya',
      label: 'Пуля',
      type: 'select',
      choices: [
        { value: 10, label: 'до 10 — короткая' },
        { value: 20, label: 'до 20' },
        { value: 30, label: 'до 30 — длинная' },
      ],
      default: 10,
    },
  ],
  presets: [
    { id: 'sochi', label: 'Сочи', hint: 'Классический подсчёт, пуля до 10', options: { variant: 'sochi', pulya: 10 } },
    { id: 'leningrad', label: 'Ленинград', hint: 'Висты вдвойне, распасы с прогрессией', options: { variant: 'leningrad', pulya: 10 } },
    { id: 'long', label: 'Длинная пуля', hint: 'Сочи до 20', options: { variant: 'sochi', pulya: 20 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || !s.final) return null;
    const best = Math.max(...s.seats.map((x) => s.final![x]));
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.final[x];
    return { winners: s.seats.filter((x) => s.final![x] === best), text: `в плюсе на ${best} вистов`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    makeView(
      pos(['KS QS JS 10S 9S AH KH 8H 7H', '8S AC KC QC JC 10C 9C 8C AD', 'KD QD JD 10D 9D 8D QH JH 10H 9H'], '8H 7H', {
        phase: 'play',
        kind: 'game',
        contract: { level: 7, trump: 'S' },
        declarer: 0,
        trump: 'S',
        whist: { 1: 'whist', 2: 'pass' },
        open: 2,
        trick: { leader: 0, cards: [{ seat: 0, card: C('AS') }, { seat: 1, card: C('7S') }] },
        turn: 2,
        pulya: [6, 2, 4, 0],
        gora: [0, 4, 2, 0],
        whists: [[0, 12, 8, 0], [4, 0, 6, 0], [2, 10, 0, 0], [0, 0, 0, 0]],
      }),
      [0]
    ),

  rules: {
    goal: 'Закрыть свою <b>пулю</b> сыгранными играми, не набрав <b>горы</b>, и написать побольше <b>вистов</b> на соперников. В конце всё переводится в висты.',
    sections: [
      {
        title: 'Торговля',
        html: `<p>Колода — 32 карты (от семёрки до туза). Троим по 10, две — в <b>прикуп</b>. Торгуются, начиная с первой руки: 6♠ — самая младшая игра,
          дальше 6♣, 6♦, 6♥, 6 без козыря (БК), 7♠ … 10 БК. <b>Мизер</b> — между 8 БК и 9♠, заявить его можно только первым словом.
          Кто спасовал, дальше не торгуется.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(HANDS, '8H 7H'),
          intro: 'У Вовки шесть пик с тузом и королём.',
          steps: [
            B(0, { level: 6, trump: 'S' }, 'Вовка: 6♠.'),
            B(1, { level: 6, trump: 'C' }, 'Ленка: 6♣ — трефы у неё длинные.'),
            A(2, { type: 'pass' }, 'Серёга: пас.'),
            B(0, { level: 7, trump: 'S' }, 'Вовка поднимает: 7♠.'),
            A(1, { type: 'pass' }, 'Ленка пасует — игра Вовкина, прикуп его.'),
            A(0, { type: 'discard', cards: L('7C 7D') }, 'Вовка сносит две ненужные семёрки…'),
            A(0, { type: 'contract', bid: { level: 7, trump: 'S' } }, '…и заказывает 7♠.'),
          ],
        },
      },
      {
        title: 'Вист и игра в светлую',
        html: `<p>Двое других решают: <b>вист</b> (играть против и писать висты за свои взятки) или <b>пас</b>. На шестерной вистующие должны взять вместе 4 взятки,
          на семерной — 2, на восьмерной и выше — 1. Оба спасовали — игра засчитана без розыгрыша.</p>
          <p>Если вистует один, игра идёт <b>в светлую</b>: карты пасующего открывают, и за него ходит вистующий.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(['AS KS QS JS 10S 9S AH KH 8H 7H', '8S 7S AC KC QC JC 10C 9C 8C AD', 'KD QD JD 10D 9D 8D QH JH 10H 9H'], '8H 7H', {
              phase: 'whist',
              kind: 'game',
              bid: { level: 7, trump: 'S' },
              contract: { level: 7, trump: 'S' },
              declarer: 0,
              trump: 'S',
              turn: 1,
            }),
          intro: 'Вовка играет 7♠.',
          steps: [
            A(1, { type: 'whist' }, 'Ленка: вист.'),
            A(2, { type: 'pass-whist' }, 'Серёга: пас — его карты открываются, ходить за него будет Ленка.'),
            P(0, 'AS', 'Вовка заходит тузом козырей.'),
            P(1, '7S', 'Ленка кладёт семёрку пик.'),
            P(1, '8D', 'За Серёгу (пик нет) тоже ходит Ленка — сбрасывает бубну.'),
          ],
        },
      },
      {
        title: 'Мизер',
        html: `<p>На мизере заказчик обязуется не взять <b>ни одной</b> взятки. После первой взятки ловящие открывают карты и вместе стараются «посадить» заказчика.
          Сыграл — 10 в пулю, взял хоть одну — по 10 в гору за каждую.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => miserePos(),
          intro: 'У Вовки одни мелкие карты.',
          steps: [B(0, { misere: true }, 'Вовка: мизер!'), A(1, { type: 'pass' }), A(2, { type: 'pass' }, 'Перебивать мизер нечем — играет Вовка.')],
        },
      },
      {
        title: 'Распасы',
        html: `<p>Если все спасовали — <b>распасы</b>: каждый играет сам за себя и старается взять как можно меньше. Первые две взятки заходят картами прикупа:
          их открывают по одной, и в их масть надо ходить. Каждая взятка — очко в гору, ни одной — очко в пулю.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(HANDS, '8H 7H'),
          steps: [A(0, { type: 'pass' }), A(1, { type: 'pass' }), A(2, { type: 'pass' }, 'Все спасовали — распасы. Первая взятка заходит прикупом: 8♥.'), P(0, 'KH', 'Вовка в черви кладёт короля… и, скорее всего, возьмёт.')],
        },
      },
      {
        title: 'Пуля, гора и висты',
        html: `<p>Сыгранная игра пишется в <b>пулю</b>: 6 — 2, 7 — 4, 8 — 6, 9 — 8, 10 — 10, мизер — 10. Недобор — цена игры в <b>гору</b> за каждую недобранную взятку,
          а вистующим — столько же вистов («консоляция»). Вистующий пишет на заказчика цену игры за каждую свою взятку.</p>
          <p>Пуля переполнена — лишнее закрывает пулю соседу, и за помощь пишут висты на него. Когда пули всех закрыты, гору переводят в висты (10 за очко)
          и считают, кто кому сколько должен. «Ленинград»: висты вдвойне, распасы подряд — с прогрессией.</p>`,
      },
    ],
  },
};
