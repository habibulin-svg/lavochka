/* Разведчик и дозор — описание игры. Коробка «Малыша» (1984, автор-художник Ю. Лобачёв): лес с кружками и тропинками,
 * шесть зелёных фишек-дозорных с кружками-номерами и красная фишка разведчика. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, SCOUT, SCOUT_LIMIT, step, toAct, type Action, type Event, type State } from './engine';

const TEAL = { color: '#1f8a7c', light: '#5cc4b4', dark: '#0c4a42' };
export const SEATS = [
  { name: 'Разведчик', color: '#d8321e', light: '#ff7a5a', dark: '#7a1206' },
  { name: 'Дозор', ...TEAL },
  { name: 'Дозор', color: '#2a7aa0', light: '#64b4dc', dark: '#123e56' },
  { name: 'Дозор', color: '#3c8a2a', light: '#7ccc62', dark: '#1a4a10' },
  { name: 'Дозор', color: '#6a5aa8', light: '#a898e0', dark: '#30285a' },
  { name: 'Дозор', color: '#a8802a', light: '#e0bc62', dark: '#5a4010' },
  { name: 'Дозор', color: '#8a3a6a', light: '#cc78aa', dark: '#481a36' },
];

const WHY: Record<string, string> = { escaped: 'разведчик прорвался к красному кружку', caught: 'разведчик окружён' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'skip') return `Дозорному №${ev.piece} некуда ходить — пропускает ход.`;
  if (ev.type === 'end') {
    if (ev.why === 'long') return `🏁 Разведчик сделал ${SCOUT_LIMIT} ходов — не прорвался, но и не пойман. Ничья.`;
    return ev.winner === 0 ? `🏁 Победа разведчика (${name(0)}): ${WHY.escaped}!` : `🏁 Победа дозора: ${WHY.caught}!`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция: разведчик и дозорные (по номерам) на кружках, ход фишки cur. */
function pos(scout: number, dozors: number[], cur = SCOUT, o = {}): State {
  const s = newState(cfgFrom(o), 2);
  s.pos = [scout, ...dozors];
  s.phase = 'move';
  s.cur = cur;
  return s;
}
const Mv = (seat: number, from: number, to: number, caption?: string) => ({ seat, action: { type: 'move', from, to } as Action, caption });
const Pl = (seat: number, to: number, caption?: string) => ({ seat, action: { type: 'place', to } as Action, caption });

function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'razvedchik',
  title: 'Разведчик и дозор',
  players: { min: 2, max: 7, default: 2 },
  countsFor: (o) => (cfgFrom(o).dozors === 5 ? [2, 3, 4, 5, 6] : [2, 3, 4, 5, 6, 7]),
  countsHint: () => 'один — разведчик, остальные делят дозорных',
  seats: SEATS,
  options: [
    {
      key: 'order',
      label: 'Порядок ходов',
      type: 'select',
      choices: [
        { value: 'box', label: 'все дозорные, потом разведчик — по коробке' },
        { value: 'alt', label: 'по очереди: дозорный — разведчик' },
      ],
      default: 'box',
    },
    {
      key: 'dozors',
      label: 'Дозорных',
      type: 'select',
      choices: [
        { value: 6, label: 'шесть — по коробке' },
        { value: 5, label: 'пять' },
      ],
      default: 6,
    },
  ],
  presets: [
    { id: 'box', label: 'По коробке', hint: 'Шесть дозорных ходят по номерам, потом разведчик', options: { order: 'box', dozors: 6 } },
    { id: 'alt', label: 'По очереди', hint: 'Дозорный — разведчик — следующий дозорный…', options: { order: 'alt', dozors: 6 } },
    { id: 'five', label: 'Пять дозорных', hint: 'Дозор меньше на одну фишку, ходы по коробке', options: { order: 'box', dozors: 5 } },
  ],

  setup: (seats, opts) => newState(cfgFrom(opts), seats.length),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья — не прорвался и не пойман' };
    if (s.winner === 0) return { winners: [0], text: 'разведчик прорвался' };
    return { winners: Array.from({ length: s.players - 1 }, (_, i) => i + 1), text: 'разведчик окружён' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, _seat, lv, rng) => choose(v, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}), 2);
    const rng = fixedRng(11);
    for (let i = 0; i < 26 && !s.over; i++) {
      const a = choose(s, 1, rng);
      if (!a) break;
      const n = step(s, a).state;
      if (n.over) break;
      s = n;
    }
    return s;
  },

  rules: {
    goal: 'Разведчику — прорваться из чащи к любому красному кружку на краю леса. Дозору — окружить разведчика так, чтобы ему некуда было ходить.',
    sections: [
      {
        title: 'Поле и расстановка',
        html: `<p>Поле — лес, по нему вьются тропинки между кружками: <b>красные</b> — по краю леса, <b>жёлтые</b> — кольцом в чаще,
          остальные белые. Дозорные — шесть зелёных фишек с номерами от 1 до 6, разведчик — красная фишка.</p>
          <p>Сначала дозорные <b>по номерам</b> встают на любые свободные красные кружки, затем разведчик — на любой жёлтый.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Дозорные ждут на краю поля, разведчик — у штаба.',
          steps: [Pl(1, 0, 'Дозорный №1 — на красный кружок.'), Pl(1, 25, '№2…'), Pl(1, 49), Pl(1, 48), Pl(1, 1), Pl(1, 47, '…и №6.'), Pl(0, 26, 'Разведчик встаёт на жёлтый кружок в чаще.')],
        },
      },
      {
        title: 'Как ходят',
        html: `<p>Фишка переходит <b>по линии</b> на соседний <b>свободный</b> кружок — в любую сторону. По красной линии по краю и по жёлтой
          в чаще ходить тоже можно. Вставать на занятый кружок и перепрыгивать через фишку нельзя.</p>
          <p>Ходить <b>обязательно</b>. Пропустить ход можно, только если рядом нет ни одного свободного кружка.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(27, [0, 25, 49, 48, 1, 47], 1),
          intro: 'Расстановка готова — ходят дозорные.',
          steps: [Mv(1, 0, 10, 'Дозорный №1 переходит по красной линии.'), Mv(1, 25, 30, '№2 сходит с края в лес.'), Mv(1, 49, 44), Mv(1, 48, 43), Mv(1, 1, 3), Mv(1, 47, 39, 'Все шесть сходили.'), Mv(0, 27, 38, 'Теперь разведчик: по тропинке на соседний кружок.')],
        },
      },
      {
        title: 'Порядок ходов',
        html: `<p><b>По коробке</b>: сначала ходят все дозорные по номерам — от первого до шестого, — потом разведчик, и снова дозорные.</p>
          <p><b>По очереди</b> (домашний вариант): дозорный, разведчик, следующий дозорный, разведчик… Разведчику так легче.
          Можно играть и <b>пятью дозорными</b>.</p>
          <p>Играют от двоих до семи: один — за разведчика, остальные делят дозорных (всемером — по фишке на каждого).</p>`,
      },
      {
        title: 'Кто выигрывает',
        html: `<p>Разведчик выигрывает, как только встанет на <b>любой красный кружок</b>. Дозор выигрывает, если <b>окружит</b> разведчика:
          все соседние кружки заняты, ходить ему некуда.</p>
          <p>Ход обязателен и для дозорных — стоять на красном кружке до конца не выйдет. Если разведчик сделал ${SCOUT_LIMIT} ходов,
          а исхода нет, — ничья (в правилах коробки предела нет, это наше).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(44, [47, 49, 37, 40, 42, 21], 1),
          intro: 'Разведчик у самого края, оба красных кружка рядом заняты.',
          steps: [
            Mv(1, 47, 39, 'Дозорный №1 обязан ходить — и сходит с красного кружка.'),
            Mv(1, 49, 47, '№2 закрывает его — но освобождает свой.'),
            Mv(1, 37, 32),
            Mv(1, 40, 46),
            Mv(1, 42, 41),
            Mv(1, 21, 16),
            Mv(0, 44, 49, 'Разведчик на красном кружке — прорвался!'),
          ],
        },
      },
      {
        title: 'Окружили!',
        html: `<p>Когда у разведчика не остаётся ни одного свободного соседнего кружка, его взяли в плен — партия окончена,
          даже если дозорные ещё не все сходили.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(33, [26, 31, 41, 47, 0, 4], 3),
          intro: 'У разведчика три соседних кружка, два уже заняты.',
          steps: [Mv(1, 41, 38, 'Дозорный №3 занимает последний — разведчик окружён.')],
        },
      },
    ],
  },
};

