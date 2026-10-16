/* Домино «Козёл» — описание игры для сборника: козёл, морской козёл, осёл; боты, журнал, скрытые руки, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { isTrainCfg, MEX, newTrain, trainApply, trainChoose, trainSetup, trainView, type TAction, type TEvent, type TState, type TView } from './train';
import {
  allBones,
  apply,
  badScore,
  cfgFrom,
  makeView,
  newState,
  sameBone,
  seatsFor,
  setup,
  sideOf,
  sideSeats,
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

type DState = State | TState;
type DAction = Action | TAction;
type DEvent = Event | TEvent;
type DView = View | TView;
const isT = (s: { cfg: { variant: string } }): s is TState => s.cfg.variant === 'train';

function describeTrain(ev: TEvent, name: (seat: number) => string): string | null {
  const tr = (t: number, seat: number) => (t === MEX ? 'в мексиканский' : t === seat ? 'в свой поезд' : `в поезд ${name(t)}`);
  switch (ev.type) {
    case 'tdeal':
      return `Кон ${ev.round}: на станции ${ev.engine}-${ev.engine}. В базаре ${ev.yard}. Начинает ${name(ev.first)}.`;
    case 'tplay':
      return `${name(ev.seat)}: <b>${bn(ev.bone)}</b> ${tr(ev.train, ev.seat)}${ev.closed ? ' — дубль закрыт' : ''}${ev.double ? ' — <b>дубль!</b>' : ''}`;
    case 'tdraw':
      return `${name(ev.seat)} берёт из базара.`;
    case 'tpass':
      return `${name(ev.seat)} пропускает — на его поезде паровозик 🚂`;
    case 'tround':
      return `${ev.out != null ? `${name(ev.out)} выложил все кости!` : 'Поезда встали — ходить некому.'} Счёт: ${ev.scores.filter((_, i) => ev.hands[i].length || ev.pips[i] || ev.out === i).join(' : ')}.`;
    case 'tend':
      return `🚂 <b>${ev.winners.map(name).join(' и ')}</b> — меньше всех очков, приехали первыми!`;
  }
  return null;
}
const ARM = ['влево', 'вправо', 'вверх', 'вниз'];

function describe(ev0: DEvent, name: (seat: number) => string): string | null {
  if (ev0.type.startsWith('t')) return describeTrain(ev0 as TEvent, name);
  const ev = ev0 as Event;
  switch (ev.type) {
    case 'deal': {
      const extra = ev.eggs ? ` Разыгрываются яйца (${ev.eggs}).` : ev.sto != null ? ' Кон «на сто»!' : '';
      return `Кон ${ev.round}. ${ev.bazaar ? `В базаре ${ev.bazaar}. ` : ''}Начинает ${name(ev.first)}${ev.opener ? ` — с ${bn(ev.opener)}` : ''}.${extra}`;
    }
    case 'play': {
      let t = `${name(ev.seat)}: <b>${bn(ev.bone)}</b>${ev.center ? '' : ` ${ARM[ev.arm]}`}${ev.close ? ' — <b>«Закрыто!»</b>' : ''}`;
      if (ev.root) t += ' — первый дубль, теперь в четыре стороны';
      if (ev.sto) t += ' — <b>«на сто»!</b>';
      if (ev.pts) t += ` — концы <b>${ev.pts}</b>, пишет себе`;
      return t;
    }
    case 'draw':
      return `${name(ev.seat)} берёт из базара.`;
    case 'pass':
      return `${name(ev.seat)}: «Еду!» — пропуск.`;
    case 'enough':
      return null;
    case 'cut':
      return `${name(ev.seat)}: <b>${bn(ev.bone)}</b> — <b>режет колбасу!</b> ${name(ev.to)} забирает ${ev.moved.length} к.`;
    case 'insert':
      return `${name(ev.seat)}: дубль <b>${bn(ev.bone)}</b> вставлен в стык`;
    case 'skip':
      return `${name(ev.seat)}: ${bn(ev.bone)} некуда — в хвост колбасы.`;
    case 'round': {
      const r = ev.res;
      const who = (i: number) => ev.sides[i].map(name).join(' и ');
      const head = r.fish
        ? r.winner == null
          ? '🐟 <b>Рыба!</b>'
          : `🐟 <b>Рыба!</b> Выиграл ${name(r.winner)}.`
        : `${name(r.winner!)} выходит — кон окончен!`;
      const w = r.wrote.map((x, i) => (x ? `${who(i)} ${x > 0 ? '+' : ''}${x}` : '')).filter(Boolean);
      return `${head}${r.note ? ` ${r.note}` : ''}${w.length ? ` Пишем: ${w.join(', ')}.` : ''} Счёт: ${ev.scores.join(' : ')}.`;
    }
    case 'end':
      if (!ev.winners.length) return `🤝 <b>Ничья</b> — ${ev.text}.`;
      if (ev.text.startsWith('генералы')) return `🎖 <b>${ev.goatSeats.map(name).join(' и ')} — генерал${ev.goatSeats.length > 1 ? 'ы' : ''}!</b> Счёт ${ev.scores.join(' : ')}.`;
      return ev.goatSeats.length && ev.text.startsWith('козёл')
        ? `🐐 <b>${ev.goatSeats.map(name).join(' и ')} — козл${ev.goatSeats.length > 1 ? 'ы' : ''}!</b> Счёт ${ev.scores.join(' : ')}.`
        : `🏆 <b>${ev.winners.map(name).join(' и ')}</b> — победа: ${ev.text}`;
  }
  return null;
}

/** Чужие кости при раздаче и из базара не показываем. */
function redact(ev: DEvent, seats: number[] | 'all'): DEvent | null {
  if (seats === 'all') return ev;
  if (ev.type === 'tdeal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'tdraw' && !seats.includes(ev.seat)) return { ...ev, bone: undefined };
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) && !ev.hidden ? h : [])) };
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

const V_LABEL: Record<string, string> = {
  kozel: 'козёл — до 101, пишут от 13',
  morskoy: 'морской козёл — пишет выигравший, до 125, «на сто»',
  osel: 'осёл — от первого дубля в четыре стороны, «Закрыто!»',
  telefon: 'телефон — «дом», очки кратно пяти, до 225',
  muggins: 'маггинс (все пятёрки) — до 200',
  general: 'генерал — выйти на 0-0 или 6-6',
  sport: 'спортивное — парами, сдачи по очереди',
  train: 'мексиканский поезд — станция, свой поезд и общий',
  kolbasa: 'колбаса — вслепую из своей линии, режь колбасу!',
};

export const def: GameDef<DState, DAction, DEvent, DView> = {
  id: 'domino',
  title: 'Домино',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  seatsFor,
  options: [
    {
      key: 'variant',
      label: 'Игра',
      type: 'select',
      choices: Object.entries(V_LABEL).map(([value, label]) => ({ value, label })),
      default: 'kozel',
    },
    {
      key: 'pairs',
      label: 'Вчетвером — парами',
      type: 'toggle',
      default: true,
      hint: 'Напарник сидит напротив, очки пишут на пару.',
      showIf: (o) => ['kozel', 'osel', 'muggins'].includes(String(o.variant ?? 'kozel')),
    },
    {
      key: 'rounds',
      label: 'Конов',
      type: 'select',
      choices: [
        { value: 7, label: '7 — от 6-6 до 0-0' },
        { value: 3, label: '3 — 6-6, 5-5, 4-4' },
      ],
      default: 7,
      showIf: (o) => o.variant === 'train',
    },
    {
      key: 'deals',
      label: 'Сдач',
      type: 'select',
      choices: [4, 8, 12].map((n) => ({ value: n, label: String(n) })),
      default: 4,
      showIf: (o) => o.variant === 'sport',
    },
    {
      key: 'generals',
      label: 'До скольких генералов',
      type: 'select',
      choices: [1, 3, 5].map((n) => ({ value: n, label: String(n) })),
      default: 3,
      showIf: (o) => o.variant === 'general',
    },
  ],
  presets: [
    { id: 'kozel', label: 'Козёл', hint: 'Классика: проигравшие пишут на себя, до 101', options: { variant: 'kozel', pairs: true } },
    { id: 'morskoy', label: 'Морской козёл', hint: 'Пишет выигравший, от 25 до 125; «на сто», «лысый», рыба и яйца', options: { variant: 'morskoy' } },
    { id: 'osel', label: 'Осёл', hint: 'Первый дубль — на четыре стороны, дубли пачкой, «Закрыто!»', options: { variant: 'osel', pairs: true } },
    { id: 'telefon', label: 'Телефон', hint: 'Домики: сумма концов кратна пяти — пиши себе; до 225', options: { variant: 'telefon' } },
    { id: 'muggins', label: 'Маггинс', hint: 'Английские «все пятёрки»: до 200', options: { variant: 'muggins', pairs: false } },
    { id: 'general', label: 'Генерал', hint: 'Обеденный: кто выйдет на 0-0 или 6-6 — навешивает генерала', options: { variant: 'general', generals: 3 } },
    { id: 'sport', label: 'Спортивное', hint: 'Парами, 4 сдачи, заходят по очереди', options: { variant: 'sport', deals: 4 } },
    { id: 'train', label: 'Мексиканский поезд', hint: 'От станции — свой поезд у каждого и общий мексиканский; семь конов', options: { variant: 'train', rounds: 7 } },
    { id: 'kolbasa', label: 'Колбаса', hint: 'Вдвоём: кости вслепую из своей линии, ножом отрезаешь колбасу сопернику', options: { variant: 'kolbasa' } },
  ],

  setup: (seats, opts, rng) => {
    const list = seats.map((x) => x.seat).sort((a, b) => a - b);
    return isTrainCfg(opts) ? trainSetup(list, opts, rng) : setup(list, opts, rng);
  },
  toAct: (s) => (isT(s) ? (s.phase === 'over' ? [] : [s.turn]) : toAct(s)),
  apply: (s, seat, a, rng) => (isT(s) ? trainApply(s, seat, a as TAction, rng) : apply(s, seat, a as Action, rng)),
  view: (s, seats) => (isT(s) ? trainView(s, seats) : makeView(s, seats)),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    if (isT(s)) {
      const sc: Record<number, number> = {};
      for (const seat of s.seats) sc[seat] = -s.scores[seat];
      return { winners: s.winners, text: `меньше всех очков: ${s.seats.map((x) => s.scores[x]).join(' : ')}`, scores: sc };
    }
    const scores: Record<number, number> = {};
    const sign = badScore(s.cfg) ? -1 : 1;
    for (const seat of s.seats) scores[seat] = sign * s.scores[sideOf(s, seat)];
    if (!s.winners.length) return { winners: [], text: 'ничья', scores };
    const text =
      s.cfg.variant === 'general'
        ? `генералы ${s.scores.join(' : ')}`
        : s.goat != null && badScore(s.cfg)
          ? `козёл — ${sideSeats(s, s.goat).length > 1 ? 'пара' : 'игрок'} с ${s.scores[s.goat]} очками`
          : `счёт ${s.scores.join(' : ')}`;
    return { winners: s.winners, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => (isT(v) ? trainChoose(v, seat, lv, rng) : choose(v, seat, lv, rng)) },
  describe,

  showcase: () => {
    const s = fishPos();
    s.chain.arms[2].tiles = [];
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Первым избавиться от своих костей. В козле очки с рук пишут на себя проигравшие — кто первым наберёт <b>101</b>, тот «козёл»; в других играх очки пишет себе выигравший, а в генерале считают только генералов.',
    sections: [
      {
        title: 'Кости и ход',
        html: `<p>В наборе 28 костей — от «пусто-пусто» до 6-6. Каждому по 7, вчетвером играют <b>парами</b>: напарник сидит напротив.
          Первый кон начинает тот, у кого 1-1 (вдвоём и втроём — меньший дубль), — им и ходит; следующие — выигравший прошлый кон, любой костью.</p>
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
          <p>Меньше 13 очков не пишут — они «висят» и прибавятся в следующий раз. Кто первым набрал <b>101</b>, тот <b>козёл</b>.
          Последнюю кость из базара не берут. Следующий кон заходит выигравший — или тот, кто забил рыбу.</p>`,
      },
      {
        title: 'Морской козёл',
        html: `<p>Пишет <b>выигравший</b> — очки с рук проигравших, но только если их <b>25</b> и больше. Очки бывают только у одной стороны:
          если другая выиграла 25+, она их <b>списывает</b> — у всех по нулям. Набрал <b>125</b> — победа. Вчетвером — парами.</p>
          <p>Можно положить <b>два дубля разом</b> — на оба конца. Одинокое 6-6 на руке — 50, только 0-0 и 6-6 — 75.</p>
          <p>Есть очки и зашёл 6-6 — кон <b>«на сто»</b>: выиграл — выиграл партию, проиграл с 25+ на руках — «свояк», проиграл партию.
          Вышел на 0-0 — <b>«лысый»</b>, партия твоя. Вышел на 6-6 — партия твоя, если у соперника 25+, иначе следующий кон «на сто».</p>
          <p><b>Рыба.</b> Рыбак — кто последним положил не дубль. У него меньше 25, у соперника 25+ — рыбак выиграл и идёт «на сто».
          У рыбака больше и 25+ — он «списывает рыбу»: до трёх конов заходит сам, и если выиграет при 25+ у соперника — списал;
          не смог — «на сто» идёт соперник. Поровну — <b>яйца</b>: следующий кон с 1-1, очки забирает выигравший; три раза не разыграли — протухли.</p>`,
        demo: {
          seats: demoSeats([0, 2]),
          options: { variant: 'morskoy' },
          setup: () =>
            pos({ variant: 'morskoy' }, [0, 2], { 0: [[2, 2], [3, 3], [1, 4]], 2: [[0, 5], [1, 6]] }, {
              turn: 0,
              opener: null,
              chain: { center: { a: 2, b: 3, seat: 2 }, arms: [0, 1, 2, 3].map(() => ({ tiles: [], closed: false })), spin: false },
            }),
          intro: 'На концах 2 и 3, а у Михалыча оба дубля — 2-2 и 3-3.',
          steps: [P(0, 2, 2, 0, 'Кладёт 2-2 налево…'), P(0, 3, 3, 1, '…и тем же ходом 3-3 направо: два дубля разом.')],
        },
      },
      {
        title: 'Осёл',
        html: `<p>Правила как в козле, но <b>первый</b> выставленный дубль открывает ряд в <b>четыре</b> стороны — влево, вправо, вверх и вниз.
          За один ход можно выложить ещё и все свои подходящие <b>дубли</b> на другие концы.</p>
          <p>Хозяин дубля может, положив его, сказать <b>«Закрыто!»</b> — дальше этого дубля больше не ставят.
          Пока дублей не было, можно закрыть двумя дублями оба конца — кон на этом кончается, считают очки.
          «Висящие» меньше 13 сгорают, если в следующем кону на тебя ничего не пришлось.</p>`,
        demo: {
          seats: demoSeats([0, 1, 2, 3]),
          options: { variant: 'osel' },
          setup: () =>
            pos({ variant: 'osel' }, [0, 1, 2, 3], { 0: [[2, 5], [0, 1]], 1: [[5, 5], [0, 2]], 2: [[1, 5], [2, 4]], 3: [[5, 6], [6, 6], [0, 4]] }, { turn: 0, opener: null }),
          intro: 'Михалыч заходит 2-5 — это не дубль, ряд пока прямой.',
          steps: [
            P(0, 2, 5, -1, 'Ряд 2-5: два конца.'),
            P(1, 5, 5, 1, 'Петрович ставит 5-5 — первый дубль! Теперь от него четыре стороны.'),
            P(2, 1, 5, 2, 'Санёк ставит вверх.'),
            P(3, 5, 6, 3, 'Толян — вниз, 5-6…'),
            P(3, 6, 6, 3, '…и тем же ходом дубль 6-6: «Закрыто!» — вниз больше не ставят.', true),
          ],
        },
      },
      {
        title: 'Телефон',
        html: `<p>Вдвоём или вчетвером парами, по 7 костей; первый кон начинает тот, у кого 3-2, дальше — вышедший. Первый дубль — <b>«дом»</b>:
          когда его перекроют с обеих сторон, к нему ставят ещё вверх и вниз — игра идёт на четыре стороны.</p>
          <p>Если после твоего хода сумма открытых концов <b>кратна пяти</b> — пишешь её себе. Дубль на конце считается обеими половинками.
          Кто остался с костями — <b>списывает</b> со своего счёта очки руки, округлённые вниз до пяти (долгов нет). Партия до <b>225</b>;
          набрали оба — ничья.</p>`,
        demo: {
          seats: demoSeats([0, 2]),
          options: { variant: 'telefon' },
          setup: () =>
            pos({ variant: 'telefon' }, [0, 2], { 0: [[6, 6], [1, 2]], 2: [[4, 5], [0, 3]] }, {
              turn: 0,
              opener: null,
              chain: {
                center: { a: 4, b: 4, seat: 2 },
                arms: [{ tiles: [{ a: 4, b: 6, seat: 0 }], closed: false }, { tiles: [{ a: 4, b: 3, seat: 2 }], closed: false }, { tiles: [], closed: false }, { tiles: [], closed: false }],
                spin: true,
              },
            }),
          intro: 'Дом 4-4 перекрыт с обеих сторон: на концах 6 и 3.',
          steps: [P(0, 6, 6, 0, 'Михалыч ставит 6-6: 6 + 6 + 3 = 15 — пишет 15.'), P(2, 4, 5, 2, 'Санёк ставит 4-5 к дому: 12 + 3 + 5 = 20 — пишет 20.')],
        },
      },
      {
        title: 'Маггинс',
        html: `<p>Английские «все пятёрки». Вдвоём по 7, втроём и вчетвером по 5. Первый кон заходит хозяин старшего дубля, дальше — любой костью;
          первый дубль — на четыре стороны. Сумма концов кратна пяти — пишешь её себе. Вышел — ещё <b>10</b>.
          Рыба — у кого меньше на руках, получает разницу с остальными, округлённую до пяти. Партия до <b>200</b>.</p>`,
        demo: {
          seats: demoSeats([0, 2]),
          options: { variant: 'muggins' },
          setup: () => pos({ variant: 'muggins' }, [0, 2], { 0: [[5, 5], [1, 2]], 2: [[0, 5], [3, 4]] }, { turn: 0, opener: null }),
          intro: 'Михалыч заходит дублем 5-5.',
          steps: [P(0, 5, 5, -1, '5 + 5 = 10 — сразу пишет 10.'), P(2, 0, 5, 1, 'Санёк ставит 5-0: пусто + 5 + 5 = 10 — тоже 10.')],
        },
      },
      {
        title: 'Генерал',
        html: `<p>Обеденная игра на предприятии: парами, по 7, каждый кон начинают с <b>1-1</b>, рыба не в счёт — пересдают.
          Цель — <b>выйти</b> на «пусто-пусто» или 6-6. Тогда тот, кто ходит следом, получает <b>генерала</b>; выйти сразу двумя этими
          дублями (их можно положить разом на оба конца) — два генерала. Очков не считают — только генералов: набрал, сколько условились, —
          проиграл. Подмигивать напарнику про 0-0 и надувать щёку про 6-6 за нашим столом не выйдет.</p>`,
        demo: {
          seats: demoSeats([0, 1, 2, 3]),
          options: { variant: 'general' },
          setup: () =>
            pos({ variant: 'general' }, [0, 1, 2, 3], { 0: [[0, 0]], 1: [[3, 5], [2, 2]], 2: [[1, 4]], 3: [[2, 6], [3, 3]] }, {
              turn: 0,
              opener: null,
              chain: { center: { a: 0, b: 1, seat: 3 }, arms: [0, 1, 2, 3].map(() => ({ tiles: [], closed: false })), spin: false },
            }),
          intro: 'У Михалыча осталось одно «пусто-пусто», а на конце как раз пусто.',
          steps: [P(0, 0, 0, 0, 'Выходит на 0-0 — Петрович, который ходит следом, получает генерала!')],
        },
      },
      {
        title: 'Мексиканский поезд',
        html: `<p>Семь конов. В первом на «станцию» в центре ставят дубль 6-6, во втором 5-5 — и так до «пусто-пусто».
          Остальные кости раздают: вдвоём по 8, втроём по 7, вчетвером по 6; лишнее — базар.</p>
          <p>От станции у каждого <b>свой поезд</b>, и ещё один общий — <b>мексиканский</b>. За ход кладёшь одну кость:
          в свой поезд, в мексиканский или в чужой — если на нём стоит <b>паровозик</b>. Нечем ходить — берёшь одну из базара;
          не подошла — пропускаешь, и на твой поезд ставят паровозик: теперь туда могут ходить все, пока сам в него не сходишь.</p>
          <p>Положил <b>дубль</b> — ходи ещё раз и закрой его. Не смог — дубль висит, и все по очереди обязаны закрыть его,
          прежде чем ходить куда-то ещё. Кон кончается, когда кто-то выложил все кости или поезда встали. Очки с рук пишут на себя;
          после седьмого кона выиграл тот, у кого меньше.</p>`,
        demo: {
          seats: demoSeats([0, 1, 2]),
          options: { variant: 'train' },
          setup: () => {
            const s = newTrain({ variant: 'train', rounds: 7 }, [0, 1, 2]);
            s.round = 1;
            s.engine = 6;
            s.hands = [[[4, 4], [1, 4], [0, 2]], [[2, 6], [0, 5]], [[3, 5], [1, 3]], []];
            s.yard = [[2, 3], [0, 0]];
            s.trains = [[{ a: 6, b: 4, seat: 0 }], [{ a: 6, b: 1, seat: 1 }], [{ a: 6, b: 3, seat: 2 }], [], [{ a: 6, b: 5, seat: 2 }]];
            s.open = [false, false, true, false, true];
            s.turn = 0;
            return s;
          },
          intro: 'Станция 6-6. У Санька на поезде паровозик — он открыт для всех.',
          steps: [
            { seat: 0, action: { type: 'play', bone: [4, 4], train: 0 } as TAction, caption: 'Михалыч кладёт дубль 4-4 в свой поезд — и ходит ещё раз…' },
            { seat: 0, action: { type: 'play', bone: [1, 4], train: 0 } as TAction, caption: '…закрывает дубль: 4-1.' },
            { seat: 1, action: { type: 'play', bone: [0, 5], train: MEX } as TAction, caption: 'Петрович — в мексиканский: 5-0.' },
            { seat: 2, action: { type: 'play', bone: [1, 3], train: 2 } as TAction, caption: 'Санёк ходит в свой поезд — паровозик снят.' },
          ],
        },
      },
      {
        title: 'Колбаса',
        html: `<p>Вдвоём, по 14 костей, и каждый выкладывает свои в линию <b>рубашкой вверх</b> — не видит их и сам хозяин.
          В свой ход берёшь крайнюю справа, открываешь и кладёшь к концу ряда. Ряд растёт от первой кости <b>двумя параллельными линиями</b>.
          Некуда положить — кость уходит в хвост твоей линии (налево).</p>
          <p>Кость, у которой числа совпадают со стыком <b>обеих</b> линий на одном месте, — <b>нож</b>: кладёшь её поперёк,
          и всё, что до неё, вместе с первой костью, — отрезанная колбаса — уходит сопернику в хвост линии. Нож становится новым началом.
          Дубль можно вставить в любой стык со своим числом, раздвинув линию.</p>
          <p>Кончились кости — выиграл кон, соперник пишет на себя очки своей линии. Кто набрал <b>101</b> — козёл.</p>`,
        demo: {
          seats: demoSeats([0, 2]),
          options: { variant: 'kolbasa' },
          setup: () =>
            pos({ variant: 'kolbasa' }, [0, 2], { 0: [[0, 5], [2, 3], [1, 1]], 2: [[4, 4], [2, 6], [2, 2], [0, 4]] }, {
              turn: 0,
              opener: null,
              chain: {
                center: { a: 1, b: 2, seat: 2 },
                arms: [
                  { tiles: [{ a: 1, b: 3, seat: 0 }, { a: 3, b: 6, seat: 2 }, { a: 6, b: 5, seat: 0 }], closed: false },
                  { tiles: [{ a: 2, b: 4, seat: 0 }, { a: 4, b: 1, seat: 2 }, { a: 1, b: 0, seat: 0 }], closed: false },
                  { tiles: [], closed: false },
                  { tiles: [], closed: false },
                ],
                spin: false,
              },
            }),
          intro: 'Две линии по три кости, на концах пять и пусто. Михалыч открывает свою крайнюю — 5-0!',
          steps: [{ seat: 0, action: { type: 'cut', k: 3 } as Action, caption: 'Это нож: поперёк обеих линий — и вся колбаса, семь костей, уходит Саньку в хвост.' }],
        },
      },
      {
        title: 'Спортивное',
        html: `<p>Так играют на соревнованиях: четверо, парами. Заходят по очереди, любой костью; играют заранее оговорённое число сдач —
          4, 8 или 12. Выигравшая сдачу пара пишет себе очки с рук соперников (в рыбе — у кого меньше). Победила пара, записавшая больше.</p>`,
      },
    ],
  },
};
