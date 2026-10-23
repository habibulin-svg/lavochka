/* Перекати-поле — описание игры: кубики со «шляпкой» перекатываются через ребро на другую сторону поля.
 * Поле печатной версии (6×6 между стартовыми рядами), коробка «Малыша» (5×6) и рисунок из правил (5×7). */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, cfgFrom, cubeId, done, newState, PLY_LIMIT, setup, SOUTH, step, toAct, UP, type Action, type Cfg, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Жёлтые', color: '#f2c419', light: '#ffe680', dark: '#a07c00', ink: '#7a5a00' },
  { name: 'Красные', color: '#d8262a', light: '#f26068', dark: '#700a10' },
];

export function kubikov(n: number): string {
  const m = n % 10;
  const t = n % 100;
  return `${n} ${m === 1 && t !== 11 ? 'кубик' : m >= 2 && m <= 4 && (t < 12 || t > 14) ? 'кубика' : 'кубиков'}`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.locked) return `🎩 ${name(ev.seat)}: кубик встал на финиш шляпкой вверх.`;
  if (ev.type === 'end') {
    const score = `На финише: ${name(0)} — ${ev.done[0]}, ${name(1)} — ${ev.done[1]}.`;
    const res = ev.winner == null ? 'Ничья.' : `Победа: ${name(ev.winner)}.`;
    if (ev.why === 'all') return `🏁 ${name(ev.winner!)} поставили все кубики на финиш шляпкой вверх — победа!`;
    if (ev.why === 'stuck') return `🔒 ${name(ev.stuck!)}: кубики заперты, хода нет — игра окончена. ${score} ${res}`;
    return `⏱ По ${PLY_LIMIT / 2} ходов у каждого — считаем кубики. ${score} ${res}`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const MAL: Cfg = cfgFrom({ size: 'malysh' });

/** Позиция на поле «Малыша» 5×6: кубики [место, x, y, где шляпка]. */
function pos(cubes: [number, number, number, number][], turn = 0): State {
  const s = newState(MAL, turn);
  s.board.fill(-1);
  const n = [0, 0];
  for (const [seat, x, y, f] of cubes) {
    const id = cubeId(seat, n[seat]++);
    s.board[at(MAL, x, y)] = id;
    s.face[id] = f;
  }
  s.ply = 2;
  return s;
}
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({ seat, action: { type: 'move', from: at(MAL, x, y), to: at(MAL, x2, y2) } as Action, caption });
const start = (first = 0) => () => newState(MAL, first);

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
  id: 'perekati',
  title: 'Перекати-поле',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 'print', label: '6×6, по 6 кубиков — печатная версия' },
        { value: 'malysh', label: '5×6, по 5 кубиков — коробка «Малыша»' },
        { value: 'drawing', label: '5×7, по 5 кубиков — как на рисунке в правилах' },
      ],
      default: 'print',
    },
    {
      key: 'look',
      label: 'Вид',
      type: 'select',
      choices: [
        { value: 'green', label: 'зелёное поле «Малыша»' },
        { value: 'blue', label: 'синий пластиковый лоток' },
        { value: 'paper', label: 'бумажное поле для печати' },
      ],
      default: 'green',
    },
  ],
  presets: [
    { id: 'print', label: 'Большое поле', hint: 'По 6 кубиков, между стартовыми рядами — 6×6 клеток', options: { size: 'print', look: 'green' } },
    { id: 'malysh', label: 'Коробка «Малыша»', hint: 'По 5 кубиков на зелёном поле 5×6, как в коробке 1987 года', options: { size: 'malysh', look: 'green' } },
    { id: 'drawing', label: 'Длинное поле', hint: 'По 5 кубиков, поле 5×7 — как на рисунке в листке правил', options: { size: 'drawing', look: 'blue' } },
    { id: 'paper', label: 'Печатная', hint: 'Бумажное поле и кубики-развёртки, 6×6', options: { size: 'print', look: 'paper' } },
  ],

  setup: (_seats, opts, rng) => setup(opts, rng),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const d = [done(s, 0), done(s, 1)];
    const scores = { 0: d[0], 1: d[1] };
    if (s.winner == null) return { winners: [], text: `ничья: на финише поровну, по ${kubikov(d[0])}`, scores };
    const text = s.why === 'all' ? 'все кубики на финише шляпкой вверх' : `на финише больше кубиков: ${d[s.winner]} против ${d[1 - s.winner]}`;
    return { winners: [s.winner], text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({ size: 'print' }), 0);
    const rng = fixedRng(5);
    // середина партии: у обоих уже есть кубики на финише шляпкой вверх
    for (let i = 0; i < 300 && !s.over && (done(s, 0) < 2 || done(s, 1) < 1); i++) s = step(s, choose(s, s.turn, 2, rng)!).state;
    s.last = [];
    return s;
  },

  rules: {
    goal: 'Перекатывая кубики, первым перевести все свои на другую сторону поля — в клетки, где стояли кубики соперника, — и поставить их <b>шляпкой вверх</b>.',
    sections: [
      {
        title: 'Поле и кубики',
        html: `<p>Играют двое. У каждого <b>пять кубиков</b> своего цвета (на большом поле — шесть). Одна грань у кубика другого
          цвета — её зовут <b>контрольной</b>, а мы для краткости — <b>шляпкой</b>. Кубики стоят в первом ряду со своей
          стороны, шляпкой вверх. Кто ходит первым — решает <b>жребий</b>.</p>
          <p>Шляпку видно всегда: наверху — цветной квадрат на верхней грани; на боковой грани — полоска с этого бока; снизу —
          пунктирный квадратик посередине.</p>`,
        demo: { seats: demoSeats, setup: start(0), intro: 'Поле «Малыша»: жёлтые снизу, красные сверху, все шляпками вверх.', steps: [Mv(0, 2, 5, 2, 4, 'Жёлтый кубик перекатился вперёд — шляпка ушла на дальнюю грань.'), Mv(1, 1, 0, 1, 1, 'Красный перекатился к нам — его шляпка теперь на ближней грани.')] },
      },
      {
        title: 'Кубик катится через ребро',
        html: `<p>Ход — <b>перекатить один свой кубик</b> через ребро на <b>свободную соседнюю клетку</b>: вперёд, назад или вбок,
          но не по диагонали. Кубик при этом поворачивается, и шляпка уходит на другую грань. Четыре переката в одну сторону —
          и она снова наверху.</p>
          <p>Ходить можно любым своим кубиком, <b>пропускать ход нельзя</b>.</p>`,
        demo: {
          seats: demoSeats,
          setup: start(0),
          intro: 'Следим за левым жёлтым кубиком.',
          steps: [
            Mv(0, 0, 5, 0, 4, 'Раз — шляпка на дальней грани.'),
            Mv(1, 4, 0, 4, 1),
            Mv(0, 0, 4, 0, 3, 'Два — шляпка внизу.'),
            Mv(1, 3, 0, 3, 1),
            Mv(0, 0, 3, 0, 2, 'Три — шляпка на ближней грани.'),
            Mv(1, 4, 1, 4, 2),
            Mv(0, 0, 2, 0, 1, 'Четыре — шляпка снова вверху.'),
            Mv(1, 3, 1, 3, 2),
            Mv(0, 0, 1, 1, 1, 'Вбок — шляпка ушла на боковую грань.'),
          ],
        },
      },
      {
        title: 'Прыгать нельзя',
        html: `<p><b>Перепрыгивать через кубики нельзя</b> — ни через свои, ни через чужие. Если клетки впереди заняты, приходится
          катиться вбок или назад и обходить.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 2, 3, UP],
              [0, 0, 5, UP],
              [1, 2, 2, UP],
              [1, 1, 2, UP],
              [1, 4, 0, UP],
            ]),
          intro: 'Впереди жёлтого кубика — красный, слева тоже красный.',
          steps: [Mv(0, 2, 3, 3, 3, 'Вперёд нельзя — обходим справа.'), Mv(1, 4, 0, 4, 1), Mv(0, 3, 3, 3, 2, 'И теперь вперёд.')],
        },
      },
      {
        title: 'Финиш — шляпкой вверх',
        html: `<p>Финиш — <b>первый ряд соперника</b>, клетки, где стояли его кубики. Кубик засчитан, только если стоит там
          <b>шляпкой вверх</b>; такой кубик <b>больше не двигают</b>. Встал шляпкой вбок — не беда, но его придётся скатить
          с финиша и закатить снова.</p>
          <p>Выигрывает тот, кто <b>первым</b> поставит на финиш шляпкой вверх все свои кубики.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 2, 1, SOUTH],
              [0, 3, 1, UP],
              [0, 0, 5, UP],
              [1, 1, 4, UP],
              [1, 4, 3, UP],
            ]),
          intro: 'Два жёлтых кубика у самого финиша.',
          steps: [Mv(0, 2, 1, 2, 0, 'Шляпка была на ближней грани — перекат вперёд, и она вверху. Кубик на финише, его больше не трогают.'), Mv(1, 1, 4, 1, 5), Mv(0, 3, 1, 3, 0, 'А этот встал шляпкой на дальнюю грань — не в зачёт, придётся перекатывать ещё.')],
        },
      },
      {
        title: 'Повторять ход нельзя',
        html: `<p>Нельзя <b>больше двух раз</b> повторять один и тот же ход — катать кубик туда-обратно, выжидая. Мы считаем
          повтором тот же перекат того же кубика с той же клетки на ту же в том же положении среди своих последних восьми
          ходов. Такой ход не подсвечивается — если, конечно, есть другие.</p>`,
        demo: {
          seats: demoSeats,
          setup: start(0),
          intro: 'Жёлтые катают один кубик взад-вперёд.',
          steps: [
            Mv(0, 2, 5, 2, 4, 'Раз.'),
            Mv(1, 0, 0, 0, 1),
            Mv(0, 2, 4, 2, 5),
            Mv(1, 0, 1, 1, 1),
            Mv(0, 2, 5, 2, 4, 'Два — тот же ход второй раз.'),
            Mv(1, 1, 1, 1, 2),
            Mv(0, 2, 4, 2, 5, 'Вернулись. В третий раз скатить этот кубик вперёд уже нельзя — надо ходить иначе.'),
          ],
        },
      },
      {
        title: 'Заперли — считаем',
        html: `<p>Если кубики игрока <b>заперты</b> — окружены со всех сторон и походить нечем, — игра кончается. Выигрывает тот,
          кто успел поставить <b>больше кубиков</b> на финиш шляпкой вверх; поровну — ничья.</p>
          <p>Чтобы партия не тянулась вечно, после ${PLY_LIMIT / 2} ходов каждого тоже считаем кубики на финише.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 0, 1, UP],
              [0, 1, 1, UP],
              [0, 2, 1, SOUTH],
              [0, 0, 5, UP],
              [0, 1, 5, UP],
              [1, 0, 0, UP],
              [1, 1, 0, UP],
              [1, 2, 5, UP],
              [1, 3, 5, UP],
              [1, 4, 5, UP],
            ]),
          intro: 'Два красных кубика в углу, вокруг — жёлтые.',
          steps: [Mv(0, 2, 1, 2, 0, 'Жёлтые закрыли последний выход: красным ходить нечем. Но на финише у красных три кубика, у жёлтых — один. Победа красных.')],
        },
      },
    ],
  },
};
