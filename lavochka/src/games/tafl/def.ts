/* Тафл (хнефатафл) — описание: Копенгаген 11×11 (со «стенкой»), Фетлар 11×11, Таблут Линнея 9×9 (король уходит на край),
 * Брандубх 7×7. Оформление: резная тонированная доска с кельтскими узлами и «бочонками», король с латунной пирамидкой;
 * светлая фанера с рунами и фигуры-щиты с латунными умбонами. */
import type { GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, ATT, cfgFrom, DEF, KING, newState, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Нападающие', color: '#3a3430', light: '#5a524a', dark: '#14100c' },
  { name: 'Защитники', color: '#e0c49a', light: '#f4e2c0', dark: '#a8865a', ink: '#7a5a30' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.taken.length) return `${name(ev.seat)}: взято фигур — ${ev.taken.length}.`;
  if (ev.type === 'end') {
    if (ev.why === 'escape') return `🏁 Король ушёл — победа: ${name(1)}.`;
    if (ev.why === 'king') return `🏁 Король окружён — победа: ${name(0)}.`;
    if (ev.why === 'stuck') return `🏁 Сопернику некуда ходить — победа: ${name(ev.winner!)}.`;
    return '🏁 Триста ходов без исхода — ничья.';
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
type XY = [number, number];
function pos(att: XY[], def: XY[], king: XY, turn: number, o: Options = {}): State {
  const s = newState(cfgFrom(o));
  const n = s.n;
  s.board.fill(0);
  for (const [x, y] of att) s.board[y * n + x] = ATT;
  for (const [x, y] of def) s.board[y * n + x] = DEF;
  s.board[king[1] * n + king[0]] = KING;
  s.turn = turn;
  return s;
}
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string, n = 11) => ({ seat, action: { type: 'move', from: y * n + x, to: y2 * n + x2 } as Action, caption });

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
  id: 'tafl',
  title: 'Хнефатафл',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'kind',
      label: 'Правила',
      type: 'select',
      choices: [
        { value: 'copenhagen', label: 'копенгагенские, 11×11' },
        { value: 'fetlar', label: 'фетларские, 11×11' },
        { value: 'tablut', label: 'таблут Линнея, 9×9' },
        { value: 'brandubh', label: 'брандубх, 7×7' },
      ],
      default: 'copenhagen',
    },
    {
      key: 'look',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'carved', label: 'резная, с кельтскими узлами' },
        { value: 'shields', label: 'с рунами, фигуры-щиты' },
      ],
      default: 'carved',
    },
  ],
  presets: [
    { id: 'copenhagen', label: 'Копенгаген', hint: 'Турнирные правила 11×11: король уходит в угол, «стенка» вдоль края', options: { kind: 'copenhagen', look: 'carved' } },
    { id: 'fetlar', label: 'Фетлар', hint: 'Те же 11×11, без «стенки»', options: { kind: 'fetlar', look: 'shields' } },
    { id: 'tablut', label: 'Таблут', hint: 'Лапландская игра в записи Линнея, 9×9: король уходит на любой край', options: { kind: 'tablut', look: 'shields' } },
    { id: 'brandubh', label: 'Брандубх', hint: 'Ирландский малый тафл 7×7: короткая партия', options: { kind: 'brandubh', look: 'carved' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: s.winner === 1 ? 'король ушёл' : 'король взят' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(9);
    for (let i = 0; i < 16 && !s.over; i++) {
      const a = choose(s, s.turn, 0, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Защитникам — увести короля из центра в угол доски. Нападающим — окружить короля.',
    sections: [
      {
        title: 'Фигуры и ходы',
        html: `<p>Хнефатафл — игра викингов. В центре, на троне, стоит <b>король</b> с защитниками, по краям — вдвое больше нападающих.
          Первыми ходят <b>нападающие</b>. Любая фигура ходит как ладья: по прямой на сколько угодно свободных клеток, не перепрыгивая.</p>
          <p>На трон и на угловые клетки (они помечены крестиком) встаёт только король. Через пустой трон ходить можно.</p>`,
        demo: { seats: demoSeats, intro: 'Начальная расстановка копенгагенского тафла.', steps: [Mv(0, 3, 0, 3, 2, 'Нападающий выходит из строя.'), Mv(1, 5, 3, 2, 3, 'Защитник уходит влево — у короля освобождается путь.')] },
      },
      {
        title: 'Взятие в клещи',
        html: `<p>Фигуру берут, <b>зажав с двух сторон</b> по прямой: ходом ставите свою фигуру так, чтобы чужая оказалась между ней и другой вашей.
          Вместо второй фигуры годится угловая клетка, а пустой трон враждебен всем. Король тоже помогает брать.
          Самому вставать между двумя чужими фигурами можно — так не берут.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 2],
                [6, 2],
                [6, 0],
                [8, 8],
              ],
              [
                [3, 2],
                [1, 0],
                [9, 9],
              ],
              [5, 5],
              0
            ),
          intro: 'Защитник стоит рядом с нападающим.',
          steps: [Mv(0, 6, 2, 4, 2, 'Клещи — защитник снят.'), Mv(1, 9, 9, 9, 8), Mv(0, 6, 0, 2, 0, 'Угол работает как вторая фигура.')],
        },
      },
      {
        title: 'Король уходит',
        html: `<p>Защитники выигрывают, когда король доходит до <b>угловой клетки</b>. Король, у которого открыты два пути к углам сразу, уже не остановить.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [4, 4],
                [6, 6],
                [8, 2],
              ],
              [[6, 4]],
              [0, 5],
              1
            ),
          intro: 'Король на краю, путь в угол открыт.',
          steps: [Mv(1, 0, 5, 0, 0, 'Король в углу — победа защитников.')],
        },
      },
      {
        title: 'Как взять короля',
        html: `<p>Короля берут, окружив <b>с четырёх сторон</b>; рядом с троном хватит трёх фигур — трон за четвёртую. На краю доски короля не взять.</p>
          <p><b>«Стенка»</b> (только в Копенгагене): ряд из двух и больше фигур вдоль края, закрытый с обоих концов (угол годится)
          и с каждой фигурой напротив вражеской, снимается весь сразу. Король в стенке не снимается.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 3],
                [4, 3],
                [3, 2],
                [3, 7],
              ],
              [[9, 9]],
              [3, 3],
              0
            ),
          intro: 'Король окружён с трёх сторон.',
          steps: [Mv(0, 3, 7, 3, 4, 'Четвёртая сторона закрыта — король взят.')],
        },
      },
      {
        title: 'Стенка',
        html: `<p>Два защитника стоят вдоль верхнего края, напротив каждого — нападающий. Закрыть ряд с конца — и сняты оба.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [3, 1],
                [4, 1],
                [2, 0],
                [5, 3],
              ],
              [
                [3, 0],
                [4, 0],
                [8, 8],
              ],
              [5, 5],
              0
            ),
          intro: 'Защитники прижаты к краю.',
          steps: [Mv(0, 5, 3, 5, 0, 'Стенка закрыта — оба защитника сняты.')],
        },
      },
      {
        title: 'Фетлар, Таблут и Брандубх',
        html: `<p><b>Фетлар</b> — те же 11×11, но без стенки. <b>Таблут</b> — лапландская игра, которую в 1732 году записал Карл Линней:
          доска 9×9, король уходит на <b>любую клетку края</b>, угловые клетки обычные; вдали от трона короля берут в клещи двумя фигурами.
          <b>Брандубх</b> — ирландский малый тафл 7×7 на 13 фигур: короля берут двумя фигурами, уходит он в угол.</p>`,
        demo: {
          seats: demoSeats,
          options: { kind: 'tablut' },
          intro: 'Таблут: 16 нападающих против короля и 8 защитников.',
          steps: [Mv(0, 3, 0, 3, 2, 'Первый ход нападающих.', 9)],
        },
      },
    ],
  },
};

