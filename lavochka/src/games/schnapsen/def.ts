/* Шнапсен и «Шестьдесят шесть» — описание игры для сборника: вдвоём, 20 или 24 карты, марьяжи, обмен, закрытие, до 7 очков. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, score, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Франц', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Грета', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В', 10: '10', 9: '9' };
export const cn = (c: Card) => `<b>${RANK[c.r]}${SUIT_SYM[c.s]}</b>`;
const REASON: Record<string, string> = { claim: '«Хватит!»', wrong: 'ошибся с «Хватит!»', closed: 'закрывший не набрал 66', last: 'последняя взятка' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Козырь — ${cn(ev.trumpCard)}.`;
    case 'meld':
      return `${name(ev.seat)}: марьяж ${SUIT_SYM[ev.suit]} — <b>${ev.pts}</b>.`;
    case 'exchange':
      return `${name(ev.seat)} меняет ${cn(ev.card)} на открытый ${cn(ev.took)}.`;
    case 'close':
      return `${name(ev.seat)} закрывает прикуп.`;
    case 'play':
      return null;
    case 'trick':
      return `${name(ev.seat)} берёт ${ev.cards.map(cn).join(' ')}${ev.pts ? ` (+${ev.pts})` : ''}`;
    case 'claim':
      return ev.ok ? `${name(ev.seat)}: «Хватит!» — ${ev.pts}.` : `${name(ev.seat)}: «Хватит!» — а набрано ${ev.pts}. Ошибка!`;
    case 'hand':
      return `Сдача за ${name(ev.winner)}: <b>+${ev.gp}</b> (${REASON[ev.reason]}; ${ev.pts[0]} : ${ev.pts[1]}). Партия ${ev.game[0]} : ${ev.game[1]}.`;
    case 'end':
      return `🏁 Партия за ${name(ev.winner)} — ${ev.game[0]} : ${ev.game[1]}.`;
  }
  return null;
}

/** Чужая рука и добор из прикупа скрыты (кроме открытого козыря). */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'draw' && !seats.includes(ev.seat) && !ev.trump) return { ...ev, card: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция: руки, открытый козырь, прикуп (верх первым), сыгранные карты и очки. */
function pos(hands: string[], trump: string, stock: string, extra: Partial<State> = {}, opts: Options = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.trumpCard = C(trump);
  s.trump = s.trumpCard.s;
  s.stock = L(stock);
  s.deal = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}

const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'schnapsen',
  title: 'Шнапсен',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 20, label: '20 карт — шнапсен' },
        { value: 24, label: '24 карты — шестьдесят шесть' },
      ],
      default: 20,
    },
    { key: 'last10', label: 'Последняя взятка +10', type: 'toggle', default: false, hint: 'Как в «Шестьдесят шесть»: взявшему последнюю взятку — ещё 10 очков.' },
    { key: 'manual', label: 'Считать в уме', type: 'toggle', default: false, hint: 'Очки сдачи не показываются, 66 надо объявить самому кнопкой «Хватит!». Ошибся — сдача сопернику.' },
    {
      key: 'target',
      label: 'Партия',
      type: 'select',
      choices: [
        { value: 7, label: 'до 7 очков (бумерль)' },
        { value: 11, label: 'до 11 очков' },
        { value: 1, label: 'одна сдача' },
      ],
      default: 7,
    },
  ],
  presets: [
    { id: 'schnapsen', label: 'Шнапсен', hint: '20 карт, по 5, до 7 очков, очки видны', options: { deck: 20, last10: false, manual: false, target: 7 } },
    { id: 'sixtysix', label: 'Шестьдесят шесть', hint: '24 карты с девятками, по 6, последняя взятка +10', options: { deck: 24, last10: true, manual: false, target: 7 } },
    { id: 'classic', label: 'Как в кофейне', hint: 'Шнапсен «в уме»: очки не видны, 66 объявляй сам', options: { deck: 20, last10: false, manual: true, target: 7 } },
    { id: 'quick', label: 'Одна сдача', hint: 'Быстро: кто выиграл сдачу, тот и победил', options: { deck: 20, last10: false, manual: false, target: 1 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.game[x];
    return { winners: [s.winner], text: `${s.game[0]} : ${s.game[1]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => pos(['AH KS QS 10D JC', 'AC 10C KH JD QD'], 'JH', 'AS KD 9C', { lead: { seat: 1, card: C('10S') }, turn: 0, pts: [21, 14], tricks: [2, 1], melds: [{ seat: 0, suit: 'S' }], pending: [20, 0], game: [3, 2], deal: 4 }),

  rules: {
    goal: 'Первым набрать во взятках и марьяжах <b>66</b> очков — и выиграть сдачу. За сдачу дают 1–3 очка партии; партия (бумерль) — до 7.',
    sections: [
      {
        title: 'Карты и очки',
        html: `<p>Колода — 20 карт: туз, десятка, король, дама, валет. Очки: <b>туз</b> — 11, <b>десятка</b> — 10, король — 4, дама — 3, валет — 2;
          всего 120. Десятка старше короля. В «Шестьдесят шесть» — 24 карты, с девятками (0 очков).</p>
          <p>Каждому по 5 карт (в 66 — по 6), следующая карта открыта — это <b>козырь</b>, она лежит поперёк под прикупом.</p>`,
      },
      {
        title: 'Пока прикуп открыт',
        html: `<p>Ходить можно чем угодно: в масть идти не обязательно, бить не обязательно. Взятку берёт старшая карта масти захода или козырь.
          Взявший добирает из прикупа первым, за ним соперник; последним забирают открытый козырь. Взявший и заходит.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH KS QS 10D JC', 'AC 10C KH JD QD'], 'JH', 'AS KD 9C 10S QC QH 10H KC'),
          intro: 'Козырь — черви.',
          steps: [
            A(0, { type: 'play', card: C('10D') }, 'Франц заходит десяткой бубен.'),
            A(1, { type: 'play', card: C('KH') }, 'Грета бьёт королём червей — козырем. 14 очков её, она добирает первой.'),
          ],
        },
      },
      {
        title: 'Марьяж',
        html: `<p>Король и дама одной масти — <b>марьяж</b>: 20 очков, козырный — 40. Объявляют на своём заходе и сразу ходят одной из этих карт.
          Очки марьяжа засчитываются, только когда у объявившего есть хотя бы одна взятка. В «Шестьдесят шесть» после закрытия прикупа марьяж не объявляют.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH KS QS 10D JC', 'AC 10C KH JD QD'], 'JH', 'AS KD 9C 10S QC QH 10H KC', { tricks: [1, 0], pts: [13, 0] }),
          steps: [A(0, { type: 'play', card: C('QS'), meld: true }, 'Франц: «Двадцать!» — и ходит дамой пик. Теперь у него 33.')],
        },
      },
      {
        title: 'Обмен младшего козыря',
        html: `<p>У кого на руке козырный <b>валет</b> (в 66 — девятка), тот на своём заходе может обменять его на открытый козырь —
          пока прикуп не закрыт и не кончился. В «Шестьдесят шесть» — только если у него уже есть взятка.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS JH QS 10D JC', 'AC 10C KH JD QD'], 'AH', 'AD KD 9C 10S'),
          intro: 'Открыт туз червей — козырь. У Франца валет червей.',
          steps: [A(0, { type: 'exchange' }, 'Франц меняет валета на козырного туза.')],
        },
      },
      {
        title: 'Закрыть прикуп',
        html: `<p>Уверен, что доберёшь 66 и без прикупа, — на своём заходе <b>закрой</b> его: козырь переворачивают, больше не добирают.
          С этого мига (и когда прикуп кончился сам) правила строже: <b>в масть и старше</b>, нет масти — козырем, нет и козыря — любой.</p>
          <p>Закрывший обязан выйти с 66. Не вышел — сопернику 2 очка партии, а если у соперника в миг закрытия не было ни одной взятки — 3.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AH 10H KH AS 10S', 'QH JD QD KC JS'], 'JH', 'AD 9C KD 10C', { tricks: [2, 1], pts: [28, 6] }),
          intro: 'У Франца старшие козыри и пики.',
          steps: [
            A(0, { type: 'close' }, 'Франц закрывает прикуп.'),
            A(0, { type: 'play', card: C('AH') }, 'Заход тузом козырей.'),
            A(1, { type: 'play', card: C('QH') }, 'Грета обязана отвечать в масть — отдаёт даму.'),
          ],
        },
      },
      {
        title: 'Счёт сдачи',
        html: `<p>Набрал 66 — сдача твоя (в игре «в уме» надо самому сказать «Хватит!»: ошибся — сдача сопернику, ему 2 очка, а если у него не было взяток — 3).
          За выигрыш: <b>1 очко</b>, если у соперника 33 и больше; <b>2</b> — меньше 33 («шнайдер»); <b>3</b> — у соперника ни одной взятки («шварц»).</p>
          <p>Если никто не набрал 66, а карты кончились, сдачу (1 очко) берёт взявший последнюю взятку. Сдают по очереди; партия — до 7 очков.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS QC', 'KD JC'], 'JH', '', { trumpCard: null, tricks: [3, 2], pts: [55, 30], lead: null }),
          intro: 'Прикуп кончился, у Франца 55.',
          steps: [A(0, { type: 'play', card: C('AS') }, 'Туз пик…'), A(1, { type: 'play', card: C('JC') }, '…и Франц добирает 66: соперник с 30 — 2 очка партии.')],
        },
      },
    ],
  },
};

export const _score = score;
