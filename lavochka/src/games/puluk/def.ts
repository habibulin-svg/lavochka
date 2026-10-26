/* Пулук (буль) — игра майя: дорожка из полей между двумя домами, четыре зерна-кости, воины берут пленных и уводят их.
 * Движок — engine.ts, боты — ai.ts. */
import type { DemoStep, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, setup, side, tally, toAct, type Action, type Event, type Stack, type State } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#b5502c', light: '#e08a62', dark: '#6e2a12' },
  { name: 'Чёрные', color: '#2f3230', light: '#6a706c', dark: '#121413' },
  { name: 'Охристые', color: '#c9963a', light: '#ecc77a', dark: '#7a5418', ink: '#7a5418' },
  { name: 'Нефритовые', color: '#3f7a5c', light: '#7fb898', dark: '#1d4230' },
];

const SIDE = ['красные', 'чёрные'];
const sideName = (sd: number, n: number) => (n === 4 ? (sd === 0 ? 'красные и охристые' : 'чёрные и нефритовые') : SIDE[sd]);
const voin = (k: number) => (k === 1 ? 'воина' : k < 5 ? `${k} воинов` : `${k} воинов`);

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') {
    const v = ev.value === 5 ? 'ни одной метки — 5' : `меток: ${ev.value}`;
    return `${name(ev.seat)}: ${v}${ev.none ? ' — ходить некуда, ход пропал' : ''}.`;
  }
  if (ev.type === 'move') {
    const parts: string[] = [];
    if (ev.took) parts.push(`берёт в плен ${voin(ev.took)}`);
    if (ev.freed.length) parts.push(`освобождает ${voin(ev.freed.length)}`);
    if (ev.turned) parts.push('и поворачивает домой');
    if (ev.to < 0) parts.push(ev.killed ? `уходит домой, пленных убито: ${ev.killed}` : 'доходит до конца дорожки и возвращается домой');
    return parts.length ? `${name(ev.seat)} ${parts.join(', ')}.` : null;
  }
  if (ev.type === 'end') {
    if (ev.winner == null) return '🏁 Ничья.';
    return `🏁 Победа: ${ev.why === 'all' ? `у соперника не осталось свободных воинов` : 'больше убитых и пленных'}.`;
  }
  return null;
}

const demoSeats = (n = 2): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Значение броска → rig (четыре rng.int(2): 1 — меткой вверх). */
const kern = (v: number) => [0, 1, 2, 3].map((i) => (v < 5 && i < v ? 1 : 0));
const Roll = (seat: number, v: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'roll' }, rig: kern(v), caption });
const Mv = (seat: number, from: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'move', from }, caption });

/** Позиция для показа: стопки [поле, место, пленные], воины дома. Ходит место 0, ждёт броска. */
function pos(list: [number, number, number[]][], home: number[], opts: Options = {}): State {
  const s = newState(cfgFrom(opts), 0);
  for (const [c, seat, pris] of list) s.track[c] = { seat, dir: side(seat) === 0 ? 1 : -1, pris } as Stack;
  s.home = home;
  return s;
}

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
  id: 'puluk',
  title: 'Пулук',
  players: { min: 2, max: 4, default: 2 },
  countsFor: (o) => (o.teams === true ? [4] : [2]),
  countsHint: (o) => (o.teams === true ? 'двое на двое' : undefined),
  teams: (o, seats) => (o.teams === true && seats.length === 4 ? [[seats[0], seats[2]], [seats[1], seats[3]]] : null),
  seats: SEATS,
  options: [
    {
      key: 'len',
      label: 'Дорожка',
      type: 'select',
      choices: [
        { value: 10, label: '10 полей (короткая)' },
        { value: 15, label: '15 полей (по Кьюлину)' },
        { value: 20, label: '20 полей (длинная)' },
      ],
      default: 10,
    },
    {
      key: 'warriors',
      label: 'Воинов у каждого',
      type: 'select',
      choices: [3, 4, 5, 6].map((v) => ({ value: v, label: String(v) })),
      default: 5,
    },
    { key: 'teams', label: 'Командами, двое на двое', hint: 'красные с охристыми против чёрных с нефритовыми', type: 'toggle', default: false },
    { key: 'back', label: 'Домой с добычей', hint: 'взяв пленного, воин разворачивается и несёт его к своему дому', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'puluk', label: 'Пулук', hint: 'Кекчи, Гватемала: 10 полей, по 5 воинов, воины идут навстречу', options: { len: 10, warriors: 5, teams: false, back: false } },
    { id: 'bul', label: 'Буль', hint: 'Мопан, Белиз: длинная дорожка на 15 полей', options: { len: 15, warriors: 5, teams: false, back: false } },
    { id: 'back', label: 'Домой с добычей', hint: 'Взяв пленного, воин поворачивает к своему дому', options: { len: 10, warriors: 5, teams: false, back: true } },
    { id: 'team', label: 'Командная', hint: 'Четверо, двое на двое, по 4 воина, дорожка 15 полей', options: { len: 15, warriors: 4, teams: true, back: false } },
  ],

  setup: (seats, opts: Options, rng) => setup(opts, rng, seats.length || 4),
  toAct,
  apply,
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over') return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    const winners = Array.from({ length: s.n }, (_, i) => i).filter((i) => side(i) === s.winner);
    const text = s.why === 'all' ? `победили ${sideName(s.winner, s.n)}: у соперника не осталось свободных воинов` : `больше убитых и пленных: ${tally(s, s.winner)} против ${tally(s, 1 - s.winner)}`;
    return { winners, text };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}), 0);
    const rng = fixedRng(5);
    for (let i = 0; i < 300 && s.phase !== 'over'; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r) break;
      s = r.state;
      // середина партии: на дорожке несколько стопок, у кого-то пленные
      const stacks = s.track.filter((t) => t);
      if (s.ply >= 16 && s.phase === 'move' && stacks.length >= 4 && stacks.some((t) => t!.pris.length)) break;
    }
    return s;
  },

  rules: {
    goal: 'Взять в плен или убить всех воинов соперника. Воины выходят из своего дома и идут по дорожке навстречу врагу; встал на врага — он в плену и едет под вашим воином, довёл пленного до конца дорожки — пленный убит.',
    sections: [
      {
        title: 'Дорожка и дома',
        html: `<p>Майя кекчи и мопан выкладывают на земле ряд палочек или зёрен кукурузы — промежутки между ними и есть поля.
          На концах ряда — <b>дома</b> двух сторон. У каждого игрока по пять воинов; в начале все они дома.</p>
          <p>Воины идут навстречу друг другу: красные — от своего дома к дому чёрных, чёрные — наоборот.
          Обычная дорожка — 10 полей; по описанию Кьюлина — 15, бывает и 20.</p>`,
      },
      {
        title: 'Зёрна вместо кубика',
        html: `<p>Кости — четыре зерна кукурузы, у каждого одна сторона помечена чёрной точкой. Бросают все четыре:
          сколько меток легло вверх — на столько полей ход; <b>ни одной метки — 5</b>. Бросок один за ход.</p>
          <p>Воина из дома выводят на поле с номером броска, считая от своего дома. После броска переставьте воина сами:
          нажмите на него (или на дом), затем на подсвеченное поле.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => newState(cfgFrom({}), 0),
          intro: 'Начало партии: все воины дома.',
          steps: [
            Roll(0, 3, 'Красным выпало три метки.'),
            Mv(0, -1, 'Первый воин выходит на третье поле.'),
            Roll(1, 5, 'Чёрным — ни одной метки: это пять.'),
            Mv(1, -1, 'Их воин встаёт на пятое поле от своего дома.'),
          ],
        },
      },
      {
        title: 'Каким воином ходить',
        html: `<p>Каждый ход — одним воином: вывести нового из дома или двинуть того, что уже на дорожке. Через воинов,
          своих и чужих, можно перескакивать. А вот <b>встать на поле со своим</b> нельзя. Если ходить некуда, ход пропадает.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[1, 0, []], [3, 0, []], [8, 1, []]], [3, 4]),
          intro: 'Два красных воина на дорожке.',
          steps: [Roll(0, 2, 'Две метки. Из дома воин встал бы на второе поле, задний воин — на соседа: оба хода закрыты.'), Mv(0, 3, 'Остаётся передний: он идёт на два поля.')],
        },
      },
      {
        title: 'Плен',
        html: `<p>Встав на поле с воином соперника, вы берёте его <b>в плен</b>: он остаётся под вашим воином и ездит с ним.
          Пленный не ходит. Воина с пленными можно захватить так же — встав на него.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[2, 0, []], [5, 1, []]], [4, 4]),
          intro: 'Красный воин в трёх полях от чёрного.',
          steps: [Roll(0, 3, 'Три метки.'), Mv(0, 2, 'Чёрный воин в плену — он под красным.'), Roll(1, 1, 'Чёрные отвечают единицей.'), Mv(1, -1, 'Выводят нового воина.')],
        },
      },
      {
        title: 'Отбить своих',
        html: `<p>Если встать на вражеского воина, который везёт ваших пленных, он сам попадает в плен, а ваши воины
          <b>освобождаются</b> и возвращаются домой — оттуда они снова могут выйти. Вражеских пленных под ним вы забираете себе.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[1, 0, []], [4, 1, [0, 0]]], [2, 4]),
          intro: 'Чёрный воин ведёт двух красных пленных.',
          steps: [Roll(0, 3, 'Три метки — как раз до него.'), Mv(0, 1, 'Чёрный в плену, двое красных свободны и ушли домой.')],
        },
      },
      {
        title: 'Конец дорожки',
        html: `<p>Дойдя до конца дорожки — до дома соперника, — воин возвращается в свой дом и снова может выйти; точного броска
          не нужно. Пленные под ним <b>убиты</b> и из игры выбывают.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[8, 0, [1]], [6, 1, []]], [4, 3]),
          intro: 'Красный воин с пленным почти у дома чёрных.',
          steps: [Roll(0, 4, 'Четыре метки — дальше конца дорожки, это не страшно.'), Mv(0, 8, 'Воин дома, чёрный пленный убит.')],
        },
      },
      {
        title: 'Домой с добычей',
        html: `<p>В одном из записанных вариантов воин, взяв пленного, сразу разворачивается и несёт его к <b>своему</b> дому.
          Дойдя, он так же убивает пленных и снова может выйти. По пути назад можно брать новых пленных.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[2, 0, []], [4, 1, []]], [4, 4], { back: true }),
          intro: 'Вариант «домой с добычей».',
          steps: [Roll(0, 2, 'Две метки.'), Mv(0, 2, 'Взял пленного — и повернул к своему дому.'), Roll(1, 1), Mv(1, -1), Roll(0, 5, 'Пять!'), Mv(0, 4, 'Дома: пленный убит.')],
        },
      },
      {
        title: 'Командами',
        html: `<p>У майя в буль играют и командами: в каждой — несколько человек. У нас — четверо, двое на двое: красные с охристыми
          выходят из одного дома, чёрные с нефритовыми — из другого. Ходят по кругу, каждый своими воинами; на поле с напарником
          вставать нельзя, а напарника из плена освобождать можно. Тот, у кого не осталось свободных воинов, ход пропускает.</p>`,
      },
      {
        title: 'Конец партии',
        html: `<p>Сторона, у которой не осталось ни одного свободного воина — ни дома, ни на дорожке, — проиграла: все её воины в плену
          или убиты. Кто начинает, решает жребий.</p>`,
      },
    ],
  },
};
