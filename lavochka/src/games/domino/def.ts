/* Домино «Козёл» — описание игры для сборника: козёл, морской козёл, осёл; боты, журнал, скрытые руки, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import {
  allBones,
  apply,
  cfgFrom,
  makeView,
  newState,
  sameBone,
  seatsFor,
  setup,
  sideSeats,
  teams,
  toAct,
  type Action,
  type Bone,
  type Cfg,
  type Chain,
  type Event,
  type State,
  type View,
} from './engine';

export const SEATS = [
  { name: 'Михалыч', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Петрович', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Санёк', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Толян', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

const bn = (b: Bone) => `${b[0]}-${b[1]}`;
const ARM = ['влево', 'вправо', 'вверх', 'вниз'];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}. ${ev.bazaar ? `В базаре ${ev.bazaar}. ` : ''}Начинает ${name(ev.first)}${ev.opener ? ` — с ${bn(ev.opener)}` : ''}.`;
    case 'play':
      return `${name(ev.seat)}: <b>${bn(ev.bone)}</b>${ev.center ? '' : ` ${ARM[ev.arm]}`}${ev.close ? ' — <b>«Закрыто!»</b>' : ''}`;
    case 'draw':
      return `${name(ev.seat)} берёт из базара${ev.left ? '' : ' последнюю'}.`;
    case 'pass':
      return `${name(ev.seat)}: «Еду!» — пропуск.`;
    case 'enough':
      return null;
    case 'round': {
      const r = ev.res;
      const who = (i: number) => ev.sides[i].map(name).join(' и ');
      const head = r.fish
        ? r.winner == null
          ? '🐟 <b>Рыба!</b> Очков поровну — «яйца», они переходят в следующий кон.'
          : `🐟 <b>Рыба!</b> Меньше всех на руках — у ${name(r.winner)}.`
        : `${name(r.winner!)} выходит — кон окончен!`;
      const w = r.wrote.map((x, i) => (x ? `${who(i)} +${x}` : '')).filter(Boolean);
      return `${head}${w.length ? ` Пишем: ${w.join(', ')}.` : ''} Счёт: ${ev.scores.join(' : ')}.`;
    }
    case 'end':
      return `🐐 <b>${ev.goatSeats.map(name).join(' и ')} — козл${ev.goatSeats.length > 1 ? 'ы' : ''}!</b> Счёт ${ev.scores.join(' : ')}.`;
  }
  return null;
}

/** Чужие кости при раздаче и из базара не показываем. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'draw' && !seats.includes(ev.seat)) return { ...ev, bone: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (seats: number[]): SeatSpec[] => seats.map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция для показа: руки по местам, базар, ряд. */
function pos(c: Partial<Cfg>, seats: number[], hands: Record<number, Bone[]>, extra: Partial<State> = {}): State {
  const s = newState({ ...cfgFrom({}), ...c }, seats);
  for (const [k, h] of Object.entries(hands)) s.hands[+k] = h;
  s.round = 1;
  Object.assign(s, extra);
  return s;
}

const P = (seat: number, a: number, b: number, arm: number, caption?: string, close = false) => ({
  seat,
  action: { type: 'play', bone: [a, b], arm, close } as Action,
  caption,
});

/** Ряд рыбы: в центре 6-6, обе стороны кончаются шестёрками; не хватает только 5-6. */
function fishChain(): Chain {
  const t = (a: number, b: number, seat = 0) => ({ a, b, seat });
  return {
    center: t(6, 6),
    arms: [
      { tiles: [t(6, 1), t(1, 2), t(2, 6), t(6, 0), t(0, 3), t(3, 6)], closed: false },
      { tiles: [t(6, 4), t(4, 5)], closed: false },
      { tiles: [], closed: false },
      { tiles: [], closed: false },
    ],
  };
}
const ON_TABLE: Bone[] = [[6, 6], [1, 6], [1, 2], [2, 6], [0, 6], [0, 3], [3, 6], [4, 6], [4, 5]];

function fishPos(): State {
  const rest = allBones().filter((b) => !ON_TABLE.some((x) => sameBone(x, b)) && !sameBone(b, [5, 6]));
  return pos({}, [0, 1, 2, 3], { 0: [[5, 6], ...rest.slice(0, 4)], 1: rest.slice(4, 9), 2: rest.slice(9, 13), 3: rest.slice(13, 17) }, { chain: fishChain(), turn: 0, opener: null });
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'domino',
  title: 'Домино «Козёл»',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  seatsFor,
  options: [
    {
      key: 'variant',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'kozel', label: 'козёл — до 101, пишут от 13' },
        { value: 'morskoy', label: 'морской козёл — до 125, пишут от 25' },
        { value: 'osel', label: 'осёл — ряд в четыре стороны, дубли пачкой, «Закрыто!»' },
      ],
      default: 'kozel',
    },
    { key: 'pairs', label: 'Вчетвером — парами', type: 'toggle', default: true, hint: 'Напарник сидит напротив, очки пишут на пару.' },
  ],
  presets: [
    { id: 'kozel', label: 'Козёл', hint: 'Классика: до 101 очка', options: { variant: 'kozel', pairs: true } },
    { id: 'morskoy', label: 'Морской козёл', hint: 'Пишут от 25, игра до 125', options: { variant: 'morskoy', pairs: true } },
    { id: 'osel', label: 'Осёл', hint: 'Ряд в четыре стороны, дубли пачкой, можно закрыть сторону', options: { variant: 'osel', pairs: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || s.goat == null) return null;
    const scores: Record<number, number> = {};
    for (const seat of s.seats) scores[seat] = -s.scores[teams(s) ? seat % 2 : s.seats.indexOf(seat)];
    const goatNames = sideSeats(s, s.goat);
    return { winners: s.winners, text: `козёл — ${goatNames.length > 1 ? 'пара' : 'игрок'} с ${s.scores[s.goat]} очками`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = fishPos();
    s.chain.arms[2].tiles = [];
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Первым избавиться от своих костей, а очки, оставшиеся на руках, пусть пишут соперники. Кто первым наберёт <b>101</b> очко — тот «козёл».',
    sections: [
      {
        title: 'Кости и ход',
        html: `<p>В наборе 28 костей — от «пусто-пусто» до 6-6. Каждому по 7, вчетвером играют <b>парами</b>: напарник сидит напротив.
          Первый кон начинает тот, у кого 1-1, — им и ходит; следующие — выигравший прошлый кон, любой костью.</p>
          <p>Ходят по кругу: к концу ряда приставляют кость с тем же числом. Дубли кладут поперёк.</p>`,
        demo: {
          seats: demoSeats([0, 1, 2, 3]),
          setup: () =>
            pos({}, [0, 1, 2, 3], { 0: [[1, 1], [2, 5], [0, 4]], 1: [[1, 4], [3, 3], [0, 2]], 2: [[1, 6], [2, 2], [3, 5]], 3: [[4, 4], [0, 5], [6, 6]] }, { turn: 0, opener: [1, 1] }),
          intro: 'У Михалыча 1-1 — ему и начинать.',
          steps: [P(0, 1, 1, -1, 'Михалыч кладёт 1-1.'), P(1, 1, 4, 1, 'Петрович приставляет 1-4 справа.'), P(2, 1, 6, 0, 'Санёк — 1-6 слева.'), P(3, 4, 4, 1, 'Толян кладёт дубль 4-4 поперёк.')],
        },
      },
      {
        title: 'Базар',
        html: `<p>Вдвоём и втроём на руки раздают по 7, остальное — <b>базар</b>. Нечем ходить — берёшь из базара по одной кости, пока не найдётся подходящая.
          Базар кончился, а ходить нечем — пропускаешь ход: «еду!».</p>`,
        demo: {
          seats: demoSeats([0, 2]),
          setup: () =>
            pos({}, [0, 2], { 0: [[1, 2], [0, 3]], 2: [[4, 4], [2, 6]] }, {
              turn: 0,
              opener: null,
              bazaar: [[2, 4], [1, 1], [5, 6], [3, 4]],
              chain: { center: { a: 5, b: 5, seat: 2 }, arms: [0, 1, 2, 3].map(() => ({ tiles: [], closed: false })) },
            }),
          intro: 'На столе 5-5, а у Михалыча нет пятёрок.',
          steps: [
            { seat: 0, action: { type: 'draw' } as Action, caption: 'Берёт из базара: 2-4 — не подходит.' },
            { seat: 0, action: { type: 'draw' } as Action, caption: 'Ещё: 1-1 — тоже мимо.' },
            { seat: 0, action: { type: 'draw' } as Action, caption: 'Третья — 5-6! Есть чем ходить.' },
            P(0, 5, 6, 1, 'Михалыч приставляет 5-6.'),
          ],
        },
      },
      {
        title: 'Рыба',
        html: `<p>Если на обоих концах одно и то же число, а все семь костей с ним уже на столе, ходить не может никто — это <b>рыба</b>.
          Кто её «забил», обычно стучит костью по столу. Выигрывает сторона, у которой на руках меньше очков.
          Если поровну — «яйца»: никто не пишет, а очки переходят в следующий кон.</p>`,
        demo: {
          seats: demoSeats([0, 1, 2, 3]),
          setup: () => fishPos(),
          intro: 'На концах 6 и 5, шестёрок не осталось ни у кого, кроме последней — 5-6 у Михалыча.',
          steps: [P(0, 5, 6, 1, 'Михалыч ставит 5-6: на обоих концах шестёрки, и все шестёрки вышли. Рыба!')],
        },
      },
      {
        title: 'Счёт и козёл',
        html: `<p>Кто первым выложил все кости, тот и выиграл кон. Проигравшие записывают на себя очки, оставшиеся у них на руках
          (вчетвером — на пару). Одинокое «пусто-пусто» на руке — 25 очков.</p>
          <p>Меньше 13 очков не пишут — они «висят» и прибавятся в следующий раз. Кто первым набрал <b>101</b>, тот <b>козёл</b>.</p>`,
      },
      {
        title: 'Морской козёл',
        html: `<p>То же самое, но запись начинается с <b>25</b> очков, а козлом становится тот, кто набрал <b>125</b>.</p>`,
      },
      {
        title: 'Осёл',
        html: `<p>Правила как в козле, но от первого дубля ряд можно строить в <b>четыре</b> стороны — влево, вправо, вверх и вниз.
          За один ход можно выложить ещё и все свои подходящие <b>дубли</b>.</p>
          <p>Хозяин дубля может, положив его, сказать <b>«Закрыто!»</b> — в эту сторону больше приставлять нельзя.</p>`,
        demo: {
          seats: demoSeats([0, 1, 2, 3]),
          options: { variant: 'osel' },
          setup: () =>
            pos({ variant: 'osel' }, [0, 1, 2, 3], { 0: [[3, 3], [0, 1]], 1: [[3, 5], [0, 2]], 2: [[1, 3], [2, 4]], 3: [[3, 6], [6, 6], [0, 4]] }, { turn: 0, opener: null }),
          intro: 'Михалыч начинает дублем 3-3.',
          steps: [
            P(0, 3, 3, -1, 'Дубль в центре — теперь можно ставить в четыре стороны.'),
            P(1, 3, 5, 2, 'Петрович ставит вверх.'),
            P(2, 1, 3, 3, 'Санёк — вниз.'),
            P(3, 3, 6, 0, 'Толян — влево, 3-6…'),
            P(3, 6, 6, 0, '…и тем же ходом докладывает дубль 6-6: «Закрыто!» — влево больше не ставят.', true),
          ],
        },
      },
    ],
  },
};

