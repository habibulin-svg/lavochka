/* Преферанс — описание игры для сборника: записи «Сочи», «Ленинград», «Ростов», «Классика», «Скачки» и все выбираемые соглашения;
 * пресеты, в том числе «Кодекс»; втроём и вчетвером; боты, правила с показом. Без DOM. */
import type { GameDef, OptionDef, Options, SeatSpec } from '../../core/types';
import { sameCard, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, bidName, cfgFrom, makeDeck32, makeView, newState, setup, SKAKS, toAct, VARIANT_DEFAULTS, type Action, type Bid, type Cfg, type Event, type State, type Variant, type View } from './engine';

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
    case 'dark':
      return ev.dark ? `${name(ev.seat)}: <b>пас втёмную!</b>` : null;
    case 'bid':
      return `${name(ev.seat)}: ${bidName(ev.bid)}`;
    case 'pass':
      return `${name(ev.seat)}: пас`;
    case 'prikup':
      return `Прикуп: ${ev.cards.map(cn).join(' ')} — ${name(ev.seat)} берёт.`;
    case 'raspasy':
      return ev.forced ? '<b>Распасы</b> (обязательные).' : '<b>Распасы!</b>';
    case 'discard':
      return `${name(ev.seat)} сносит две карты.`;
    case 'contract':
      return `${name(ev.seat)} играет <b>${bidName(ev.bid)}</b>.`;
    case 'whist':
      return `${name(ev.seat)}: ${ev.half ? 'полвиста' : ev.back ? 'вист (возвращает)' : ev.whist ? (ev.forced ? 'вист (обязательный)' : 'вист') : 'пас'}`;
    case 'show':
      return `${name(ev.seat)} играет ${ev.open ? 'в светлую' : 'втёмную'}.`;
    case 'open':
      return `Карты ${name(ev.seat)} открыты.`;
    case 'score': {
      const d = ev.declarer;
      const x = ev.mult ? ` <i>(×${ev.mult})</i>` : '';
      if (ev.kind === 'raspasy') return `Распасы: взятки — ${ev.players.map((i) => `${name(i)} ${ev.tricks[i]}`).join(', ')}.${x}`;
      if (ev.kind === 'free') return `Вистовать никто не стал — ${name(d)}: ${bidName(ev.contract)} сыграна.${x}`;
      if (ev.kind === 'half') return `Полвиста — ${name(d)}: ${bidName(ev.contract)} сыграна без розыгрыша.${x}`;
      if (ev.kind === 'concede') return `${name(d)} сдаёт ${bidName(ev.contract)} без розыгрыша: без ${ev.notes.includes('concede:2') ? 'двух' : 'трёх'}.${x}`;
      const pk = ev.notes.find((n) => n.startsWith('prikup:'));
      return `${name(d)}: ${bidName(ev.contract)} ${ev.made ? 'сыграна' : '<b>без взяток: ' + (ev.contract && 'level' in ev.contract ? ev.contract.level - ev.tricks[d] : ev.tricks[d]) + '</b>'} (взяток ${ev.tricks[d]}).${x}${pk ? ` Платный прикуп: ${pk.slice(7)}.` : ''}`;
    }
    case 'skak':
      return `🏇 Скак ${ev.skak} окончен: первым пулю набрал ${ev.first.map(name).join(' и ')} (+300 с каждого), меньше всех горы — ${ev.lowGora.map(name).join(' и ')} (+200 с каждого).`;
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

// ---------------------------------------------------------------- настройки

const notV = (...v: Variant[]) => (o: Options) => !v.includes((o.variant as Variant) ?? 'sochi');
const isV = (...v: Variant[]) => (o: Options) => v.includes((o.variant as Variant) ?? 'sochi');

const OPTIONS: OptionDef[] = [
  {
    key: 'variant',
    label: 'Запись',
    type: 'select',
    choices: [
      { value: 'sochi', label: '«Сочи» — классика' },
      { value: 'leningrad', label: '«Ленинград» — висты вдвойне, без помощи' },
      { value: 'rostov', label: '«Ростов» — распасы на висты' },
      { value: 'classic', label: '«Классика» — бомбы, пас втёмную' },
      { value: 'skachki', label: `«Скачки» — ${SKAKS} скака до 22 с призами` },
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
      { value: 50, label: 'до 50 — турнирная' },
    ],
    default: 10,
    showIf: notV('skachki'),
  },
  {
    key: 'whistStyle',
    label: 'Вист',
    hint: 'При одном вистующем и подсаде заказчика: жлобский — все висты вистующему, джентльменский — пополам с пасовавшим (и первый может уйти за полвиста)',
    type: 'select',
    choices: [
      { value: 'greedy', label: 'жлобский' },
      { value: 'gentle', label: 'джентльменский' },
    ],
    default: 'greedy',
  },
  {
    key: 'resp',
    label: 'Недовист',
    type: 'select',
    choices: [
      { value: 'full', label: 'ответственный — полная цена' },
      { value: 'half', label: 'полуответственный — половина' },
    ],
    default: 'full',
  },
  { key: 'halfWhist', label: 'Полвиста на шестерной и семерной', type: 'toggle', default: true },
  {
    key: 'ten',
    label: 'Десятерная',
    type: 'select',
    choices: [
      { value: 'whist', label: 'вистуется' },
      { value: 'check', label: 'проверяется (без риска)' },
    ],
    default: 'whist',
  },
  { key: 'stalingrad', label: '«Сталинград»: 6♠ вистуется обязательно', type: 'toggle', default: false },
  {
    key: 'lead',
    label: 'Первый ход',
    hint: 'При игре в светлую и на мизере',
    type: 'select',
    choices: [
      { value: 'light', label: 'всветлую — карты открывают до хода' },
      { value: 'dark', label: 'втёмную — открывают после первой взятки' },
    ],
    default: 'light',
  },
  {
    key: 'concede',
    label: 'Сдать игру без розыгрыша',
    type: 'select',
    choices: [
      { value: 0, label: 'нельзя' },
      { value: 3, label: 'без трёх' },
      { value: 2, label: 'без двух' },
    ],
    default: 0,
  },
  {
    key: 'exit',
    label: 'Выход из распасов',
    hint: 'С какой игры начинается торговля после 1, 2, 3 … распасов подряд',
    type: 'select',
    choices: [
      { value: '666', label: '6-6-6 — простой' },
      { value: '677', label: '6-7-7 — затруднённый' },
      { value: '6788', label: '6-7-8-8 — тяжёлый' },
      { value: '678678', label: '6-7-8-6-7-8 — по кругу' },
    ],
    default: '666',
  },
  { key: 'exitByFail', label: 'Выход подсадом (несыгранная игра тоже выводит)', type: 'toggle', default: true },
  { key: 'slide', label: 'Переход сдачи после распасов', type: 'toggle', default: true },
  {
    key: 'raspPrice',
    label: 'Цена взятки на распасах',
    type: 'select',
    choices: [
      { value: 1, label: '1' },
      { value: 2, label: '2' },
    ],
    default: 1,
    showIf: notV('rostov'),
  },
  {
    key: 'prog',
    label: 'Прогрессия распасов',
    type: 'select',
    choices: [
      { value: 'none', label: 'без прогрессии' },
      { value: 'arith', label: '1-2-3' },
      { value: 'geom', label: '1-2-4' },
    ],
    default: 'none',
    showIf: notV('rostov'),
  },
  { key: 'raspPrikup', label: 'Прикуп на распасах задаёт масть', type: 'toggle', default: true, showIf: notV('rostov') },
  { key: 'paidPrikup', label: 'Платный прикуп (за тузы и марьяж сдающий пишет висты)', type: 'toggle', default: false },
  { key: 'darkPass', label: 'Пас втёмную первой руки', type: 'toggle', default: true, showIf: isV('classic') },
  {
    key: 'opening',
    label: 'Обязательные распасы в начале',
    type: 'select',
    choices: [
      { value: 0, label: 'нет' },
      { value: 1, label: 'один круг' },
      { value: 2, label: 'два круга' },
    ],
    default: 1,
    showIf: isV('classic'),
  },
];

/** Опции из соглашений записи. */
function conv(variant: Variant, pulya = 10, extra: Partial<Cfg> = {}): Options {
  const d = { ...VARIANT_DEFAULTS[variant], ...extra };
  return {
    variant,
    pulya,
    whistStyle: d.greedy ? 'greedy' : 'gentle',
    resp: d.resp ? 'full' : 'half',
    halfWhist: d.halfWhist,
    ten: d.tenCheck ? 'check' : 'whist',
    stalingrad: d.stalingrad,
    lead: d.darkLead ? 'dark' : 'light',
    concede: d.concede,
    exit: d.exit,
    exitByFail: d.exitByFail,
    slide: d.slide,
    raspPrice: d.raspPrice,
    prog: d.prog,
    raspPrikup: d.raspPrikup,
    paidPrikup: d.paidPrikup,
    darkPass: d.darkPass,
    opening: d.opening,
  };
}

const PRESETS = [
  { id: 'sochi', label: 'Сочи', hint: 'Жлобский ответственный вист, полвиста, распасы по 1, пуля до 10', options: conv('sochi') },
  { id: 'leningrad', label: 'Ленинград', hint: 'Висты вдвойне, джентльменский полуответственный вист, распасы по 2 с прогрессией, выход 6-7-8, без помощи', options: conv('leningrad') },
  { id: 'rostov', label: 'Ростов', hint: 'Распасы на висты (по 5 за взятку, без прикупа), консоляция 10, полуответственный вист, платный прикуп', options: conv('rostov') },
  { id: 'classic', label: 'Классика с брандерами', hint: 'Обязательные распасы и пас втёмную дают бомбы, Сталинград, выход семерной, первый ход втёмную, сдача не переходит', options: conv('classic') },
  { id: 'skachki', label: 'Скачки', hint: `${SKAKS} скака до 22: первому — по 300, меньшая гора — по 200, в начале скака распасы по 2`, options: conv('skachki') },
  { id: 'kodex', label: 'Кодекс', hint: 'По «Кодексу преферанса» 1996 г.: Сочи, пуля до 20, полвиста, вист не обязателен, выход шестерной, скользящая сдача, без прогрессии', options: conv('sochi', 20) },
];

export const def: GameDef<State, Action, Event, View> = {
  id: 'preferans',
  title: 'Преферанс',
  players: { min: 3, max: 4, default: 3 },
  seats: SEATS,
  options: OPTIONS,
  presets: PRESETS,

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
          <p>Если вистует один, он выбирает: <b>в светлую</b> (карты обоих вистующих открыты, за пасовавшего ходит он) или <b>втёмную</b>.
          Когда открывают карты — до первого хода или после первой взятки, — решает настройка «первый ход».</p>
          <p>Вистующие отвечают за обязательные взятки: недобрали — в гору (ответственный вист — полная цена игры за взятку, полуответственный — половина).
          Вдвоём на шестерной и семерной каждый отвечает за половину, на восьмерной и выше — тот, кто завистовал вторым.</p>
          <p>«Сталинград» (настройка): 6♠ вистуют оба обязательно. Десятерная может «проверяться» — вистующие играют в открытую без риска.</p>`,
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
              wstep: 'd1',
            }),
          intro: 'Вовка играет 7♠.',
          steps: [
            A(1, { type: 'whist' }, 'Ленка: вист.'),
            A(2, { type: 'pass-whist' }, 'Серёга: пас. Вистует одна Ленка — ей решать, как играть.'),
            A(1, { type: 'show', open: true }, 'Ленка: «в светлую» — карты вистующих открываются, ходить за Серёгу будет она.'),
            P(0, 'AS', 'Вовка заходит тузом козырей.'),
            P(1, '7S', 'Ленка кладёт семёрку пик.'),
            P(1, '8D', 'За Серёгу (пик нет) тоже ходит Ленка — сбрасывает бубну.'),
          ],
        },
      },
      {
        title: 'Полвиста',
        html: `<p>На шестерной и семерной, если первый спасовал, второй может сказать <b>«полвиста»</b>: игра засчитывается без розыгрыша,
          а он пишет висты за половину обязательных взяток (на шестерной — за 2, на семерной — за 1). Спасовавший может <b>вернуть вист</b> —
          тогда играет он, а ушедший за полвиста пасует. При джентльменском висте уйти за полвиста может и первый, если второй спасовал.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(['AS KS QS JS 10S 9S AH KH 8H 7H', HANDS[1], HANDS[2]], '8H 7H', {
              phase: 'whist',
              kind: 'game',
              bid: { level: 6, trump: 'S' },
              contract: { level: 6, trump: 'S' },
              declarer: 0,
              trump: 'S',
              turn: 1,
              wstep: 'd1',
            }),
          intro: 'Вовка играет 6♠ — карта у него сильная.',
          steps: [
            A(1, { type: 'pass-whist' }, 'Ленка: пас.'),
            A(2, { type: 'half-whist' }, 'Серёга: полвиста! Без розыгрыша он запишет висты за две взятки.'),
            A(1, { type: 'pass-whist' }, 'Ленка вист не возвращает — шестерная засчитана Вовке, Серёге — висты за полвиста.'),
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
          их открывают по одной, и в их масть надо ходить (в «Ростове» прикуп не участвует). Каждая взятка — цена взятки в гору (1 или 2, с прогрессией 1-2-3 или 1-2-4
          для распасов подряд), ни одной — цена взятки в пулю.</p>
          <p><b>Выход.</b> После распасов подряд торговаться можно не со всякой игры: «6-7-7» — после первых распасов не ниже семерной, «6-7-8-8» — после вторых не ниже восьмерной
          и т. д. «Выход подсадом» — несыгранная игра тоже выводит из распасов, иначе выводит только сыгранная. Без «перехода сдачи» после распасов сдаёт тот же.</p>`,
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
          и считают, кто кому сколько должен.</p>
          <p><b>Жлобский вист:</b> при одном вистующем все висты — ему, пасовавший пишет только консоляцию. <b>Джентльменский:</b> при подсаде заказчика висты пополам.
          <b>Платный прикуп:</b> за туза в прикупе сдающий пишет на заказчика цену взятки, за туза с королём одной масти — две, за двух тузов — три, за марьяж — одну.
          <b>Сдать без трёх (двух):</b> заказчик после сноса может не играть и записать в гору «без трёх» на той игре, до которой доторговался; висты никто не пишет.</p>`,
      },
      {
        title: 'Ленинград, Ростов, Классика, Скачки',
        html: `<p><b>«Ленинград»:</b> висты и консоляция вдвое, распасы по 2 с прогрессией, помощи нет — перебор пули списывается с горы вдвойне, недобор пишется в гору вдвойне;
          партия кончается, когда сумма пуль дошла до общей.</p>
          <p><b>«Ростов»:</b> распасы на висты — взявший меньше всех пишет по 5 вистов за каждую взятку остальных (двое поровну — пополам), прикуп не участвует;
          за подсад заказчика каждый пишет по 10 вистов за взятку.</p>
          <p><b>«Классика» с брандерами (бомбами):</b> в начале — обязательные распасы, за каждые всем по бомбе. Первая рука может <b>спасовать втёмную</b>, не глядя в карты:
          перебить это можно только семерной (повторно — восьмерной); если будут распасы — они вдвое, а пасовавшему бомба. Бомба удваивает всю запись следующей игры её хозяина
          и сгорает, когда игра сыграна.</p>
          <p><b>«Скачки»:</b> ${SKAKS} скака до 22 в пуле без помощи. Первая сдача скака — распасы по 2. Скак кончается, когда кто-то набрал 22 (не на распасах):
          первый набравший пишет по 300 вистов с каждого, у кого меньше горы — по 200. В конце за самую большую пулю всех скаков — ещё по 300, за самую маленькую гору — по 200.</p>`,
      },
    ],
  },
};
