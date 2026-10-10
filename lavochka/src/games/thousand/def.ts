/* Тысяча — описание игры для сборника: бочка, болты, самосвал, тёмная, роспись, пересдачи, тузовый марьяж, золотой кон, шаг торговли;
 * втроём и вчетвером; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, marriageValue, newState, setup, toAct, type Action, type Event, type MarriageKind, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

const mName = (m: MarriageKind) => (m === 'A' ? 'тузовый марьяж' : `марьяж ${SUIT_SYM[m]}`);
const REDEAL: Record<string, string> = { nines: 'четыре девятки', prikup9: 'две девятки в прикупе', prikupLow: 'пустой прикуп' };
const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;

const NOTE: Record<string, (who: string) => string> = {
  bolt: (w) => `${w} — болт`,
  bolt3: (w) => `${w}: третий болт, −120`,
  bolt5: (w) => `${w}: пятый болт, −120`,
  rospis3: (w) => `${w}: третья роспись, ещё −120`,
  barrel: (w) => `${w} на бочке!`,
  fall: (w) => `${w} слетает с бочки`,
  zero: (w) => `${w} в третий раз слетает с бочки — счёт в ноль`,
  dump: (w) => `${w}: самосвал, 555 → 0`,
  dumpm: (w) => `${w}: самосвал, −555 → 0`,
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}, сдаёт ${name(ev.dealer)}.${ev.golden ? ' <b>Золотой кон</b>: 120 без торговли, очки ×2.' : ''}`;
    case 'redeal':
      return `Пересдача: ${REDEAL[ev.reason]} у ${name(ev.seat)}${ev.cards ? ` (${ev.cards.map(cn).join(' ')})` : ''}.`;
    case 'dark':
      return ev.dark ? `${name(ev.seat)}: <b>темню!</b> 120 не глядя, очки ×2.` : null;
    case 'rospis':
      return `${name(ev.seat)} <b>расписывается</b> на ${ev.bid}.`;
    case 'fine':
      return `Третья пересдача подряд — плохая раздача: ${name(ev.seat)} ${ev.amount}.`;
    case 'bid':
      return `${name(ev.seat)}: ${ev.value}`;
    case 'pass':
      return `${name(ev.seat)}: пас`;
    case 'prikup':
      return `${name(ev.seat)}: прикуп за ${ev.bid}${ev.dark ? ' (втёмную)' : ''} — ${ev.cards.map(cn).join(' ')}`;
    case 'give':
      return ev.card ? `${name(ev.seat)} отдаёт ${name(ev.to)} ${cn(ev.card)}` : `${name(ev.seat)} отдаёт карту ${name(ev.to)}`;
    case 'raise':
      return `${name(ev.seat)} поднимает заказ до <b>${ev.value}</b>`;
    case 'play':
      return ev.marriage ? `${name(ev.seat)}: ${mName(ev.marriage)} — <b>+${marriageValue(ev.marriage)}</b>${ev.marriage !== 'A' ? `, козырь ${SUIT_SYM[ev.marriage]}` : ''}!` : null;
    case 'trick':
      return null;
    case 'score': {
      const lines = ev.deltas.map((d, i) => ({ d, i })).filter((x) => x.d !== 0 || x.i === ev.bidder);
      const notes = ev.notes
        .map((n) => {
          const [k, v] = n.split(':');
          const who = name(+v);
          return NOTE[k] ? NOTE[k](who) : '';
        })
        .filter(Boolean);
      const head = ev.rospis
        ? `${name(ev.bidder)} расписался на ${ev.bid}${ev.dark ? ' втёмную' : ''}.`
        : `${name(ev.bidder)}: заказ ${ev.bid}${ev.dark ? ' втёмную' : ''} ${ev.made ? 'сыгран' : '<b>не сыгран</b>'} (набрано ${ev.pts[ev.bidder]}).`;
      const bonus = ev.dealerBonus ? ` Сдающему — марьяж из прикупа, +${ev.dealerBonus}.` : '';
      return `${head}${bonus} ${lines.map((x) => `${name(x.i)} ${x.d >= 0 ? '+' : ''}${x.d}`).join(', ')}${notes.length ? '. ' + notes.join('; ') : ''}.`;
    }
    case 'end':
      return `🏆 <b>${name(ev.winner)}</b> — тысяча!`;
  }
  return null;
}

/** Чужие карты не показываем: раздача — только своя рука, отданная карта — только двоим. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  // темнящий свою руку не видит, пока не решит
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) && i !== ev.darkSeat ? h : [])) };
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
    { key: 'barrel', label: 'Бочка', type: 'toggle', default: true, hint: 'С 880 очков сидишь на бочке: выйти можно только своим заказом, на это три кона; не вышел — минус 120.' },
    {
      key: 'barrelAt',
      label: 'Бочка с',
      type: 'select',
      choices: [
        { value: 880, label: '880' },
        { value: 900, label: '900' },
      ],
      default: 880,
      showIf: (o) => o.barrel !== false,
    },
    {
      key: 'goal',
      label: 'Выход с бочки',
      type: 'select',
      choices: [
        { value: 1000, label: 'до 1000' },
        { value: 1001, label: 'до 1001 («набрать 121»)' },
      ],
      default: 1000,
      showIf: (o) => o.barrel !== false,
    },
    { key: 'barrelZero', label: 'Три слёта — в ноль', type: 'toggle', default: true, hint: 'Кто трижды слетел с бочки, начинает с нуля («с трёх — на ноль»).', showIf: (o) => o.barrel !== false },
    {
      key: 'boltMode',
      label: 'Болты',
      type: 'select',
      hint: 'Болт — кон без единой взятки. Сидящему на бочке не пишут.',
      choices: [
        { value: '3', label: 'каждый третий — минус 120' },
        { value: '3row', label: 'три подряд — минус 120' },
        { value: '5', label: 'каждый пятый — минус 120' },
        { value: 'off', label: 'без болтов' },
      ],
      default: '3',
    },
    {
      key: 'dumpMode',
      label: 'Самосвал',
      type: 'select',
      choices: [
        { value: 'both', label: '555 и −555 — в ноль' },
        { value: 'plus', label: 'только 555 — в ноль' },
        { value: 'off', label: 'без самосвала' },
      ],
      default: 'both',
    },
    { key: 'dark', label: 'Тёмная', type: 'toggle', default: true, hint: 'Первая рука может, не глядя в карты, сыграть 120 — очки заказчика вдвойне. Перебить тёмную можно только с марьяжем.' },
    {
      key: 'rospis',
      label: 'Роспись',
      type: 'select',
      hint: 'Взявший прикуп может сдаться до первого хода: себе минус заказ, соперникам — очки.',
      choices: [
        { value: '60', label: 'соперникам по 60' },
        { value: 'half', label: 'соперникам по половине заказа' },
        { value: 'off', label: 'без росписи' },
      ],
      default: '60',
    },
    { key: 'rospis3', label: 'Третья роспись — минус 120', type: 'toggle', default: true, hint: 'Каждая третья роспись — расписавшемуся ещё минус 120.', showIf: (o) => o.rospis !== 'off' },
    { key: 'redeal9', label: 'Пересдача: 4 девятки на руке', type: 'toggle', default: true },
    { key: 'redealPrikup9', label: 'Пересдача: 2 девятки в прикупе', type: 'toggle', default: true, hint: 'Решает взявший прикуп.' },
    {
      key: 'redealPrikupMin',
      label: 'Пересдача: в прикупе меньше',
      type: 'select',
      hint: 'Решает взявший прикуп.',
      choices: [
        { value: 0, label: 'не пересдают' },
        { value: 2, label: '2 очков' },
        { value: 4, label: '4 очков' },
        { value: 5, label: '5 очков' },
        { value: 8, label: '8 очков' },
      ],
      default: 5,
    },
    { key: 'redeal3', label: 'Три пересдачи подряд — минус 120', type: 'toggle', default: true, hint: '«Плохая раздача»: штраф сдающему.' },
    { key: 'aces', label: 'Тузовый марьяж', type: 'toggle', default: false, hint: 'Четыре туза — 200 очков, объявляют заходом с туза; козырь не меняется.' },
    { key: 'firstMarriage', label: 'Марьяж с первого хода', type: 'toggle', default: false },
    { key: 'golden', label: 'Золотой кон', type: 'toggle', default: false, hint: 'Первые коны (по числу игроков) каждый по очереди играет 120 без торговли; все очки и штрафы вдвойне.' },
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
    {
      id: 'classic',
      label: 'Классическая',
      hint: 'Бочка, болты, самосвал ±555, тёмная, роспись по 60, пересдачи',
      options: { barrel: true, barrelAt: 880, goal: 1000, barrelZero: true, boltMode: '3', dumpMode: 'both', dark: true, rospis: '60', redeal9: true, redealPrikup9: true, redealPrikupMin: 5, rospis3: true, redeal3: true, aces: false, firstMarriage: false, golden: false, step: 5 },
    },
    {
      id: 'simple',
      label: 'Простая',
      hint: 'Без бочки, болтов и договорённостей — кто первым до тысячи',
      options: { barrel: false, boltMode: 'off', dumpMode: 'off', dark: false, rospis: 'off', redeal9: false, redealPrikup9: false, redealPrikupMin: 0, rospis3: false, redeal3: false, aces: false, firstMarriage: false, golden: false, step: 5 },
    },
    {
      id: 'golden',
      label: 'Золотой кон',
      hint: 'Классика + золотой кон в начале и тузовый марьяж',
      options: { barrel: true, barrelAt: 880, goal: 1000, barrelZero: true, boltMode: '3', dumpMode: 'both', dark: true, rospis: '60', redeal9: true, redealPrikup9: true, redealPrikupMin: 5, rospis3: true, redeal3: true, aces: true, firstMarriage: false, golden: true, step: 5 },
    },
    {
      id: 'strict',
      label: '1001',
      hint: 'Строже: с бочки до 1001, болты три подряд, роспись по половине заказа',
      options: { barrel: true, barrelAt: 880, goal: 1001, barrelZero: true, boltMode: '3row', dumpMode: 'both', dark: true, rospis: 'half', redeal9: true, redealPrikup9: true, redealPrikupMin: 2, rospis3: true, redeal3: true, aces: false, firstMarriage: false, golden: false, step: 5 },
    },
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
        html: `<p>Заказчик набрал заказ (взятки + марьяжи) — пишет заказ, не набрал — пишет минус заказ. Остальные пишут свои очки, округлённые до 5 (17 → 15, 18 → 20).</p>
          <p><b>Бочка</b>: с 880 очков игрок «на бочке» — очки ему не пишут, выйти на 1000 он может только своим заказом, на это три кона; не вышел — минус 120.
          Двое на бочке не сидят — новый сталкивает прежнего. Кто слетел с бочки в третий раз — начинает с нуля.</p>
          <p><b>Болт</b> — кон без единой взятки; каждый третий болт — минус 120 (по договорённости — три подряд или каждый пятый). На бочке болтов не пишут.
          <b>Самосвал</b>: ровно 555 или −555 — в ноль.</p>`,
      },
      {
        title: 'Тёмная',
        html: `<p>Первая рука может <b>темнить</b> — до того, как посмотрит карты, заказать 120. Тогда очки заказчика вдвойне: сыграл — +240, нет — −240.
          Перебить тёмную («растемнить») можно только с марьяжем на руке — от 125. Темнить нельзя в минусе и когда кто-то сидит на бочке.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH 10H KH QH 9S JC 10D', 'AS 10S KS 9H JH AD QC', 'QS JS AC 10C KC 9C KD'], 'QD JD 9D', { phase: 'dark', turn: 0, first: 0 }),
          intro: 'Вовка — первая рука. Карт он ещё не видел.',
          steps: [
            A(0, { type: 'dark' }, 'Вовка: «Темню!» — 120 не глядя.'),
            A(1, { type: 'pass' }, 'У Ленки марьяжа нет — перебить нечем, пас.'),
            A(2, { type: 'pass' }, 'Серёга тоже пас. Прикуп Вовкин, играет 120 втёмную — на кону 240.'),
          ],
        },
      },
      {
        title: 'Роспись и пересдача',
        html: `<p><b>Роспись</b>: взявший прикуп видит, что заказ не сыграть, — может расписаться до первого хода. Себе он пишет минус заказ, соперникам — по 60
          (по договорённости — по половине заказа). Каждая третья роспись — ещё минус 120. На бочке и на золотом коне не расписываются.</p>
          <p><b>Пересдача</b>: четыре девятки на руке — пересдают сразу. Если в прикупе две девятки или меньше 5 очков, взявший прикуп может пересдать, пока не отдал карт. Три пересдачи подряд — «плохая раздача»: сдающему минус 120.</p>
          <p><b>Тузовый марьяж</b> (по договорённости) — четыре туза, 200 очков. <b>Золотой кон</b> — в начале партии каждый по очереди играет 120 без торговли, все очки вдвойне.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(['9S JC 10D 9C QC JH 9H QD JD 9D','AS 10S KS AH JS AD 10H', 'QS KH AC 10C KC QH KD'], 'QD JD 9D', { phase: 'give', turn: 0, bidder: 0, bid: 100, shown: true }),
          intro: 'Вовка взял прикуп за 100, а рука — пустая.',
          steps: [
            A(0, { type: 'give', to: 1, card: C('9S') }, 'Отдаёт девятку Ленке…'),
            A(0, { type: 'give', to: 2, card: C('9C') }, '…и Серёге.'),
            A(0, { type: 'rospis' }, 'Расписывается: себе −100, Ленке и Серёге по 60.'),
          ],
        },
      },
    ],
  },
};

