/* Футбол на бумаге — описание игры для сборника: русский футбол ломаными, футбол с отскоками и хоккей. Без DOM. */
import { SeededRng } from '../../core/rng';
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, DIR_NAMES, geometry, setup, toAct, type Action, type Event, type State } from './engine';
import type { Options } from '../../core/types';

export const SEATS = [
  { name: 'Синие', color: '#1f3a8f', light: '#5a78c8', dark: '#122450' },
  { name: 'Красные', color: '#b8281e', light: '#e86a5a', dark: '#7a140e' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'move':
      return null;
    case 'kick':
      return `${name(ev.seat)} бьют штрафной — ${DIR_NAMES[ev.dir]}, ${ev.path.length} кл.`;
    case 'stuck':
      return ev.penalty ? `${name(ev.seat)} без хода — пропуск, штрафной сопернику.` : `${name(ev.seat)} без хода.`;
    case 'goal':
      return `${ev.own ? 'Автогол!' : '⚽ Гол!'} Очко — ${name(ev.seat)}. Счёт ${ev.score[0]} : ${ev.score[1]}.`;
    case 'reset':
      return `${ev.why === 'draw' ? 'Штрафной пробить некуда — лист переигрывают. ' : ''}${ev.fresh ? 'Новый лист, с' : 'С'} центра разыгрывают ${name(ev.seat)}.`;
    case 'end':
      return `🏁 ${ev.winners.length > 1 ? 'Ничья' : `Победа — <b>${name(ev.winners[0])}</b>`}: ${ev.text}.`;
  }
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const RU: Options = { mode: 'ru', size: '14x22', goals: 1 };
const BOUNCE: Options = { mode: 'bounce' };
const HOCKEY: Options = { mode: 'hockey', goals: 3 };

/** Узел (x, y) поля с такими настройками. */
const node = (o: Options, x: number, y: number) => (y + 1) * (geometry(o).W + 1) + x;
const P = (o: Options) => (...xy: number[]) => {
  const out: number[] = [];
  for (let i = 0; i < xy.length; i += 2) out.push(node(o, xy[i], xy[i + 1]));
  return out;
};
const ru = P(RU);
const bo = P(BOUNCE);
const ho = P(HOCKEY);
const MV = (seat: number, path: number[], caption?: string) => ({ seat, action: { type: 'move', path } as Action, caption });

/** Позиция: на поле уже проведены ломаные (чьи, узлы по порядку), мяч в конце последней, ходит turn. */
function position(o: Options, drawn: [number, number[]][], turn: number): State {
  const s = setup(o);
  for (const [seat, nodes] of drawn) for (let i = 1; i < nodes.length; i++) s.lines.push(nodes[i - 1], nodes[i], seat, 0);
  const last = drawn[drawn.length - 1][1];
  s.ball = last[last.length - 1];
  s.turn = turn;
  return s;
}

/** Партия ботов посреди игры — для превью карточки. */
function midGame(): State {
  const rng = new SeededRng(19);
  let s = setup({ mode: 'ru', size: '14x22', goals: 3 });
  for (let i = 0; i < 9 && s.phase === 'play'; i++) {
    const a = choose(s, s.turn, i % 2 ? 0 : 1, rng);
    if (!a) break;
    const r = apply(s, s.turn, a);
    if (!r || r.events.some((e) => e.type === 'goal')) break;
    s = r.state;
  }
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'paperball',
  title: 'Футбол на бумаге',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'ru', label: 'футбол — ход в три отрезка' },
        { value: 'bounce', label: 'футбол с отскоками' },
        { value: 'hockey', label: 'хоккей' },
      ],
      default: 'ru',
    },
    {
      key: 'size',
      label: 'Поле',
      hint: 'Классика — лист 32×40, на экране так мелко; «большое» — для планшета.',
      type: 'select',
      choices: [
        { value: '14x22', label: '14×22, ворота 4 клетки' },
        { value: '20x30', label: '20×30, ворота 6 клеток' },
      ],
      default: '14x22',
      showIf: (o) => o.mode === 'ru',
    },
    {
      key: 'goals',
      label: 'До скольких голов',
      hint: 'Футбол — после гола новый лист; хоккей — шайба снова в центре того же поля.',
      type: 'select',
      choices: [1, 3, 5].map((n) => ({ value: n, label: String(n) })),
      default: 1,
      showIf: (o) => o.mode !== 'bounce',
    },
  ],
  presets: [
    { id: 'ru', label: 'Футбол (русский)', hint: 'Ход — ломаная из трёх отрезков, линий не касаться; нет хода — штрафной', options: { mode: 'ru', size: '14x22', goals: 1 } },
    { id: 'bounce', label: 'Футбол с отскоками', hint: 'Поле 8×10, ход по отрезку, от линий и борта мяч отскакивает', options: { mode: 'bounce' } },
    { id: 'hockey', label: 'Хоккей', hint: 'Линии можно пересекать, гол — шайба в узле ворот, до трёх голов', options: { mode: 'hockey', goals: 3 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || !s.winners) return null;
    return { winners: s.winners, text: s.endText, scores: { 0: s.score[0], 1: s.score[1] } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: midGame,

  rules: {
    goal: 'Провести мяч линиями по клеткам тетрадного листа и забить в ворота соперника. Синие атакуют верхние ворота, красные — нижние.',
    sections: [
      {
        title: 'Футбол: ход в три отрезка',
        html: `<p>Поле — клетки тетради, ворота — разрыв посередине коротких сторон, мяч стоит в центре. Ходят по очереди.</p>
          <p><b>Ход — ломаная из трёх отрезков</b> по сторонам или диагоналям клеток, от узла к соседнему узлу.
          Начинается там, где кончился прошлый ход (соперника).</p>
          <p>Ломаная <b>не касается и не пересекает</b> уже проведённые линии — ни свои, ни чужие, — сама себя тоже,
          и не касается краёв поля. Касанием по полю ставьте узлы по одному; допустимые подсвечены, ошиблись — «Отменить отрезок».</p>`,
        demo: {
          seats: demoSeats,
          options: RU,
          steps: [
            MV(0, ru(7, 10, 8, 9, 8, 8), 'Синие начинают с центра: три отрезка вверх, к воротам красных.'),
            MV(1, ru(9, 9, 9, 10, 10, 11), 'Красные продолжают от конца синей линии — и тянут мяч назад, вниз.'),
            MV(0, ru(11, 10, 11, 9, 10, 8), 'Касаться линий нельзя, поэтому синие обходят красную ломаную стороной.'),
          ],
        },
      },
      {
        title: 'Футбол: гол',
        html: `<p>Гол — мяч <b>пересёк линию ворот</b> соперника и ушёл за поле. Встать на саму линию ворот — ещё не гол.
          Если ход кончился голом раньше третьего отрезка, остальные не нужны. Забить можно и себе — автогол.</p>
          <p>Обычно играют до первого гола; можно до трёх или пяти — тогда после гола берут новый лист, разыгрывают пропустившие.</p>`,
        demo: {
          seats: demoSeats,
          options: RU,
          setup: () => position(RU, [[0, ru(8, 8, 8, 7, 8, 6, 8, 5)]], 1),
          intro: 'Синие подвели мяч к воротам красных.',
          steps: [
            MV(1, ru(7, 4, 6, 3, 6, 2), 'Красные ошиблись: увели мяч вбок, но оставили его у своих ворот.'),
            MV(0, ru(6, 1, 6, 0, 6, -1), 'Синие: два отрезка до линии ворот, третий — через неё. Гол!'),
          ],
        },
      },
      {
        title: 'Футбол: нет хода — штрафной',
        html: `<p>Если сделать три отрезка некуда, ход <b>пропускают</b>, а соперник бьёт <b>штрафной</b>:
          прямая из 10 отрезков в одну из восьми сторон. Штрафной может пересекать линии и проходить через занятые узлы,
          но не по проведённой линии и не через борт; кончается в свободном узле или за воротами — тогда это гол.</p>
          <p>Если на 10 не выходит — бьют на 9 или 11, потом на 8 или 12 и так далее. Пробить некуда совсем — ничья.</p>`,
        demo: {
          seats: demoSeats,
          options: RU,
          setup: () => position(RU, [[1, ru(2, 19, 1, 20, 2, 20, 3, 20, 4, 21)]], 0),
          intro: 'Мяч у синих в углу поля.',
          steps: [
            MV(0, ru(3, 21, 2, 21, 1, 21), 'Синие загоняют мяч в угол: у красных отсюда нет ни одного хода.'),
            { seat: 0, action: { type: 'kick', dir: 0 } as Action, caption: 'Красные пропускают ход, синие бьют штрафной: десять отрезков вверх, прямо через красную линию.' },
          ],
        },
      },
      {
        title: 'С отскоками: ход и отскок',
        html: `<p>Поле 8×10, ворота в две клетки. Ход — <b>один отрезок</b> к соседнему узлу, в любую из восьми сторон.
          По уже проведённой линии и по борту ходить нельзя, пересекать линии — можно.</p>
          <p>Если мяч пришёл в узел, где уже есть линия (или на борт), — <b>отскок</b>: тот же игрок ходит ещё.
          Ход кончается, только когда мяч встал в чистый узел. Отскоками можно пролететь полполя.</p>`,
        demo: {
          seats: demoSeats,
          options: BOUNCE,
          steps: [
            MV(0, bo(4, 4), 'Синие — на клетку вверх. Узел был чистый — ход переходит.'),
            MV(1, bo(5, 5), 'Красные — по диагонали вниз.'),
            MV(0, bo(4, 5), 'Синие идут в центр: там уже есть линия — отскок, ходят ещё…'),
            MV(0, bo(5, 4), '…поперёк красной линии — пересекать можно. Узел чистый, ход переходит.'),
          ],
        },
      },
      {
        title: 'С отскоками: борт, тупик и гол',
        html: `<p>От борта мяч тоже отскакивает, но по самому борту не ходят. Гол — мяч за линией ворот соперника.</p>
          <p><b>Нет хода — проигрыш.</b> Угол поля — тупик: вдоль бортов нельзя, мяч застрял. Кто загнал туда себя или кого
          оставил без хода, тот и решил партию.</p>`,
        demo: {
          seats: demoSeats,
          options: BOUNCE,
          setup: () => position(BOUNCE, [[0, bo(3, 6, 2, 7)]], 1),
          steps: [
            MV(1, bo(1, 8), 'Красные тянут мяч к углу.'),
            MV(0, bo(0, 9), 'Синие уходят к борту — отскок…'),
            MV(0, bo(1, 10), '…ещё раз о нижний борт — отскок…'),
            MV(0, bo(2, 9), '…и в чистый узел.'),
            MV(1, bo(1, 9), 'Красные.'),
            MV(0, bo(0, 10), 'Синие в углу: отскок, а ходить дальше некуда — синие проиграли.'),
          ],
        },
      },
      {
        title: 'Хоккей',
        html: `<p>Поле 8×10, ворота — отрезок в четверть короткой стороны, прямо на борту. Ход — один отрезок.
          Линии можно <b>пересекать</b>, но не проводить по уже проведённой. Попала шайба на линию или на борт — отскок, ходишь ещё.</p>
          <p><b>Гол — ход кончился в узле ворот</b> соперника. После гола шайба снова в центре того же поля, разыгрывают пропустившие.
          Нет хода — проигрыш.</p>`,
        demo: {
          seats: demoSeats,
          options: HOCKEY,
          setup: () => position(HOCKEY, [[1, ho(4, 5, 4, 4, 4, 3, 3, 2, 4, 1, 5, 2, 4, 2)]], 0),
          intro: 'Шайба у синих перед воротами красных.',
          steps: [
            MV(0, ho(4, 1), 'Синие — в узел с красной линией: отскок, ходят ещё…'),
            MV(0, ho(4, 0), '…и шайба в узле ворот — гол! Шайба снова в центре, разыгрывают красные.'),
          ],
        },
      },
    ],
  },
};
