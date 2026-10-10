/* Шашки — описание игры для сборника: русские, международные, бразильские, поддавки, фук; боты, журнал, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, fromList, newGame, setup, sqOf, toAct, type Action, type EndReason, type Event, type State, type Variant } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#efe0c0', light: '#fffaf0', dark: '#8a7a5a', ink: '#7a5f30' },
  { name: 'Чёрные', color: '#2a211c', light: '#5a4a40', dark: '#0d0a08' },
];

const REASON: Record<EndReason, string> = {
  nomoves: 'ходить нечем',
  resign: 'соперник сдался',
  repetition: 'троекратное повторение — ничья',
  kings: 'дамки ходят без толку — ничья',
  endgame: 'одинокую дамку не поймать — ничья',
  agreed: 'ничья по согласию',
};

const VARIANT: Record<Variant, string> = { russian: 'Русские шашки', international: 'Международные шашки (10×10)', brazil: 'Бразильские шашки' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'start':
      return `${VARIANT[ev.variant]}${ev.giveaway ? ', поддавки' : ''}.`;
    case 'move':
      return `${ev.seat === 0 ? `${ev.num}.` : `${ev.num}…`} <b>${ev.text}</b>${ev.move.promo ? ' — дамка!' : ''}${ev.missed ? ' — <i>не побил!</i>' : ''}`;
    case 'fuk':
      return `${name(ev.seat)} берут за фук шашку на ${ev.name}.`;
    case 'offer':
      return `${name(ev.seat)} предлагают ничью.`;
    case 'decline':
      return `${name(ev.seat)} отказываются от ничьей.`;
    case 'end':
      if (ev.winner == null) return `🤝 <b>${REASON[ev.reason]}</b>.`;
      return `🏆 <b>${name(ev.winner)}</b> победили: ${ev.reason === 'nomoves' ? 'у соперника нет ходов' : REASON[ev.reason]}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Белые', level: 1 },
  { seat: 1, kind: 'bot', name: 'Чёрные', level: 1 },
];

/** Ход для показа: mv(0, 8, 'c3', 'e5', 'g7') — поля по порядку. */
const mv = (seat: number, n: number, ...sqs: string[]) => {
  const [from, ...path] = sqs.map((x) => sqOf(n, x));
  return { seat, action: { type: 'move', from, path } as Action };
};
const cap = (step: ReturnType<typeof mv>, caption: string) => ({ ...step, caption });

const RU = cfgFrom({});
const INT = cfgFrom({ variant: 'international' });

export const def: GameDef<State, Action, Event, State> = {
  id: 'checkers',
  title: 'Шашки',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,

  options: [
    {
      key: 'variant',
      label: 'Шашки',
      type: 'select',
      choices: [
        { value: 'russian', label: 'русские — 8×8, бить можно любой веткой' },
        { value: 'international', label: 'международные — 10×10, бить больше всех' },
        { value: 'brazil', label: 'бразильские — 8×8 по международным правилам' },
      ],
      default: 'russian',
    },
    {
      key: 'giveaway',
      label: 'Поддавки',
      type: 'toggle',
      default: false,
      hint: 'Наоборот: выигрывает тот, кто первым отдаст все шашки или запрёт их.',
    },
    {
      key: 'fuk',
      label: 'Фук (по-дворовому)',
      type: 'toggle',
      default: false,
      hint: 'Бить не обязательно, но если не побил — соперник забирает шашку «за фук», а потом ходит сам.',
    },
  ],
  presets: [
    { id: 'russian', label: 'Русские', hint: 'Обычные шашки на доске 8×8', options: { variant: 'russian', giveaway: false, fuk: false } },
    { id: 'international', label: 'Международные', hint: 'Доска 10×10, по 20 шашек, бить больше всех', options: { variant: 'international', giveaway: false, fuk: false } },
    { id: 'giveaway', label: 'Поддавки', hint: 'Кто первым отдаст все шашки — тот и выиграл', options: { variant: 'russian', giveaway: true, fuk: false } },
    { id: 'fuk', label: 'С фуком', hint: 'Как во дворе: не побил — отдай шашку', options: { variant: 'russian', giveaway: false, fuk: true } },
    { id: 'brazil', label: 'Бразильские', hint: '8×8, но бить обязательно больше всех', options: { variant: 'brazil', giveaway: false, fuk: false } },
  ],

  setup: (_seats, opts) => setup(opts).state,
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || !s.reason) return null;
    const scores = { 0: s.winner === 0 ? 1 : s.winner === 1 ? 0 : 0.5, 1: s.winner === 1 ? 1 : s.winner === 0 ? 0 : 0.5 };
    if (s.winner == null) return { winners: [0, 1], text: REASON[s.reason], scores };
    const text = s.reason === 'nomoves' ? (s.cfg.giveaway ? 'отдали все шашки' : 'у соперника не осталось ходов') : REASON[s.reason];
    return { winners: [s.winner], text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  // середина партии: у белых дамка, чёрные давят в центре
  showcase: () =>
    fromList(RU, {
      w: ['a1', 'c1', 'e1', 'b2', 'f2', 'a3', 'e3', 'g3', 'd4', 'h4'],
      W: ['h6'],
      b: ['b8', 'd8', 'a7', 'e7', 'g7', 'b6', 'f6', 'c5', 'e5'],
    }),

  rules: {
    goal: 'Побить или запереть все шашки соперника — так, чтобы ему стало нечем ходить. В <b>поддавках</b> — наоборот: первым отдать все свои.',
    sections: [
      {
        title: 'Доска и ход',
        html: `<p>Играют на тёмных полях. У каждого по 12 шашек (в международных — по 20 на доске 10×10). Белые начинают, дальше — по очереди.</p>
          <p>Простая шашка ходит на одно поле <b>вперёд по диагонали</b>. Ходы записывают полями: c3-d4.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newGame(RU),
          intro: 'Начальная расстановка.',
          steps: [
            cap(mv(0, 8, 'c3', 'd4'), 'Белые ходят первыми: c3-d4.'),
            cap(mv(1, 8, 'f6', 'g5'), 'Чёрные отвечают: f6-g5.'),
            cap(mv(0, 8, 'g3', 'f4'), 'Белые подводят вторую шашку: g3-f4.'),
          ],
        },
      },
      {
        title: 'Взятие',
        html: `<p>Если рядом по диагонали стоит чужая шашка, а за ней свободное поле, её <b>бьют</b>: перепрыгивают и снимают с доски.
          Бить <b>обязательно</b>, а простая шашка бьёт и вперёд, и <b>назад</b>.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => fromList(RU, { w: ['e5', 'a1'], b: ['d4', 'h8', 'b8'] }),
          intro: 'Чёрная шашка забралась белой за спину.',
          steps: [cap(mv(0, 8, 'e5', 'c3'), 'Бить обязательно — и назад тоже: e5:c3.'), cap(mv(1, 8, 'h8', 'g7'), 'Чёрные отходят.')],
        },
      },
      {
        title: 'Несколько шашек за ход',
        html: `<p>Если после взятия можно бить дальше — бьют дальше, тем же ходом, пока есть кого. Останавливаться на полпути нельзя.</p>
          <p>В русских шашках, если бой ветвится, можно выбрать <b>любую</b> ветку — не обязательно ту, где больше шашек.
          Побитые снимают после хода («турецкий удар»): через одну шашку дважды не прыгают.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => fromList(RU, { w: ['c3', 'a1'], b: ['d4', 'f6', 'f4', 'h8'] }),
          intro: 'Белые могут бить в две стороны: c3:e5:g7 или c3:e5:g3.',
          steps: [cap(mv(0, 8, 'c3', 'e5', 'g7'), 'Две шашки за ход: c3:e5:g7.'), cap(mv(1, 8, 'h8', 'f6'), 'Но шашка встала под бой — чёрные отыгрываются: h8:f6.')],
        },
      },
      {
        title: 'Дамка',
        html: `<p>Шашка, дошедшая до последнего ряда, становится <b>дамкой</b> (её накрывают второй шашкой). Дамка ходит по диагонали
          на <b>любое</b> число полей — вперёд и назад, а бьёт издалека: перепрыгивает чужую шашку и встаёт на любое свободное поле за ней.
          Если с какого-то из этих полей можно бить дальше — встать нужно туда.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => fromList(RU, { w: ['c7', 'a1'], b: ['f6', 'a5', 'h8'] }),
          intro: 'Белой шашке остался шаг до края доски.',
          steps: [
            cap(mv(0, 8, 'c7', 'd8'), 'c7-d8 — дамка!'),
            cap(mv(1, 8, 'a5', 'b4'), 'Чёрные идут вперёд.'),
            cap(mv(0, 8, 'd8', 'h4'), 'Дамка бьёт через всю диагональ: d8:h4.'),
          ],
        },
      },
      {
        title: 'Дамкой посреди боя',
        html: `<p>В русских шашках простая, которая во время боя дошла до последнего ряда, <b>сразу</b> становится дамкой и бьёт дальше уже как дамка.</p>
          <p>В международных и бразильских — нет: шашка станет дамкой, только если закончит ход на последнем ряду.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => fromList(RU, { w: ['b6', 'a1'], b: ['c7', 'f6', 'h8'] }),
          intro: 'Белая шашка бьёт на d8 — край доски.',
          steps: [cap(mv(0, 8, 'b6', 'd8', 'h4'), 'b6:d8 — дамка, и тем же ходом бьёт дальше: d8:h4.')],
        },
      },
      {
        title: 'Международные шашки',
        html: `<p>Доска 10×10, у каждого по 20 шашек, поля записывают номерами от 1 до 50. Главное отличие — бить нужно <b>больше всех</b>:
          из нескольких веток боя выбирают ту, где побитых шашек больше (дамка и простая считаются одинаково).</p>
          <p>Бразильские шашки — те же международные правила, но на доске 8×8.</p>`,
        demo: {
          seats: demoSeats,
          options: { variant: 'international' },
          setup: () => fromList(INT, { w: ['c3', 'a1'], b: ['b4', 'd4', 'd6', 'j10'] }),
          intro: 'Можно побить одну шашку влево — или две вправо.',
          steps: [cap(mv(0, 10, 'c3', 'e5', 'c7'), 'Обязательно бить больше: две шашки вместо одной.')],
        },
      },
      {
        title: 'Поддавки',
        html: `<p>Ходят и бьют как обычно, но цель наоборот: выигрывает тот, у кого первым не осталось ходов — все шашки отдал или их заперли.
          Бить по-прежнему обязательно, поэтому шашку можно «подставить» — и соперник будет вынужден её взять.</p>`,
        demo: {
          seats: demoSeats,
          options: { giveaway: true },
          setup: () => newGame(cfgFrom({ giveaway: true })),
          steps: [
            cap(mv(0, 8, 'c3', 'd4'), 'Белые выходят в центр.'),
            cap(mv(1, 8, 'f6', 'e5'), 'Чёрные подставляют шашку.'),
            cap(mv(0, 8, 'd4', 'f6'), 'Белые обязаны бить: d4:f6.'),
            cap(mv(1, 8, 'g7', 'e5'), 'А теперь обязаны бить чёрные: g7:e5. Счёт по отданным — 1:1.'),
          ],
        },
      },
      {
        title: 'Фук',
        html: `<p>Старое дворовое правило: бить <b>не обязательно</b>. Но если игрок мог побить и не побил, соперник перед своим ходом может
          «взять за фук» — снять с доски шашку, которая должна была бить. После этого он ходит как обычно.</p>`,
        demo: {
          seats: demoSeats,
          options: { fuk: true },
          setup: () => fromList(cfgFrom({ fuk: true }), { w: ['c3', 'g3', 'a1'], b: ['d4', 'h8'] }),
          intro: 'Белые могут побить c3:e5.',
          steps: [
            cap(mv(0, 8, 'g3', 'h4'), 'Но зевают и ходят g3-h4.'),
            { seat: 1, action: { type: 'fuk', sq: sqOf(8, 'c3') } as Action, caption: 'Чёрные снимают шашку c3 «за фук»…' },
            cap(mv(1, 8, 'd4', 'e3'), '…и делают свой ход.'),
          ],
        },
      },
      {
        title: 'Ничья',
        html: `<p>Ничья бывает, если:</p><ul>
          <li>одна и та же позиция повторилась три раза;</li>
          <li>у обоих есть дамки, а 15 ходов подряд (в международных — 25) никто не бил и не ходил простой шашкой;</li>
          <li>в международных: одинокая дамка против трёх шашек с дамкой продержалась 16 ходов (против двух — 5);</li>
          <li>игроки договорились — ничью можно предложить перед своим ходом.</li></ul>`,
      },
    ],
  },
};
