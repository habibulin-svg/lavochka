/* Так — описание игры для сборника: вдвоём, доски 3×3…8×8, коми. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { cfgFrom, DIR_RU, newState, setup, step, toAct, type Action, type Event, type Kind, type Piece, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e2c48e', light: '#fff2d6', dark: '#8a6a3a', ink: '#6a4a1a' },
  { name: 'Чёрные', color: '#4a2c16', light: '#7a5434', dark: '#1a0c04' },
];

const KIND_RU: Record<Kind, string> = { F: 'плоский камень', S: 'стенку', C: 'капстоун' };
/** Клетка по-шахматному: a1 — левый нижний угол. */
const cellName = (n: number, c: number) => `${'abcdefgh'[c % n]}${n - Math.floor(c / n)}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'place') return `${name(ev.seat)}: ${ev.owner !== ev.seat ? 'камень соперника' : KIND_RU[ev.kind]} на ${cellName(ev.n, ev.at)}`;
  if (ev.type === 'move') return `${name(ev.seat)}: стопку с ${cellName(ev.n, ev.from)} ${DIR_RU[ev.dir]} — ${ev.drops.join(' + ')}${ev.flatten ? ', капстоун сплющил стенку' : ''}`;
  if (ev.type === 'end') return ev.winner == null ? `🏁 Ничья по плоским (${ev.flats[0]} : ${ev.flats[1]}).` : `🏁 ${name(ev.winner)}: ${ev.how === 'road' ? 'дорога!' : `больше плоских (${ev.flats[0]} : ${ev.flats[1]})`}`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция на 5×5: клетки строкой «a1» → стопка снизу вверх ('w' 'b' — плоские, 'W' 'B' — стенки, 'c' 'C' — капстоуны). */
function pos(cells: Record<string, string>, turn = 0, opts: Options = {}): State {
  const s = newState(cfgFrom(opts));
  const n = s.cfg.size;
  for (const [name, stack] of Object.entries(cells)) {
    const c = (n - Number(name.slice(1))) * n + 'abcdefgh'.indexOf(name[0]);
    s.board[c] = stack.split('').map((ch) => ({ o: ch === 'w' || ch === 'W' || ch === 'c' ? 0 : 1, k: ch === 'W' || ch === 'B' ? 'S' : ch === 'c' || ch === 'C' ? 'C' : 'F' }) as Piece);
  }
  s.turn = turn;
  s.ply = 10;
  return s;
}
const at = (name: string, n = 5) => (n - Number(name.slice(1))) * n + 'abcdefgh'.indexOf(name[0]);
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'tak',
  title: 'Так',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 3, label: '3×3 — учебная' },
        { value: 4, label: '4×4' },
        { value: 5, label: '5×5 — основная' },
        { value: 6, label: '6×6' },
        { value: 7, label: '7×7' },
        { value: 8, label: '8×8' },
      ],
      default: 5,
    },
    {
      key: 'komi',
      label: 'Коми чёрным',
      type: 'select',
      choices: [
        { value: 0, label: 'нет' },
        { value: 1, label: '+1 плоский' },
        { value: 2, label: '+2 плоских' },
      ],
      default: 0,
      hint: 'Прибавка вторым при счёте плоских — первый ход даёт белым небольшое преимущество.',
    },
  ],
  presets: [
    { id: 'five', label: '5×5', hint: 'Основная: 21 камень и капстоун', options: { size: 5, komi: 0 } },
    { id: 'four', label: '4×4', hint: 'Быстрая: 15 камней, без капстоуна', options: { size: 4, komi: 0 } },
    { id: 'six', label: '6×6', hint: 'Турнирная: 30 камней и капстоун, коми 2', options: { size: 6, komi: 2 } },
    { id: 'three', label: '3×3', hint: 'Учебная: 10 камней', options: { size: 3, komi: 0 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, _seat, a) => step(s, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const f = s.flats ?? [0, 0];
    const scores = { 0: f[0], 1: f[1] };
    if (s.winner == null) return { winners: [], text: `ничья, плоских ${f[0]} : ${f[1]}`, scores };
    return { winners: [s.winner], text: s.how === 'road' ? 'дорога' : `плоских ${f[0]} : ${f[1]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => pos({ a1: 'w', b1: 'w', b2: 'bw', c2: 'w', c3: 'bbw', d3: 'B', c4: 'b', d4: 'wbC', e4: 'b', b4: 'W', a5: 'b', e2: 'c', d1: 'b' }, 0),

  rules: {
    goal: 'Построить <b>дорогу</b> — цепочку своих камней от одного края доски до противоположного.',
    sections: [
      {
        title: 'Камни и первый ход',
        html: `<p>У каждого запас камней (на доске 5×5 — 21 и один капстоун). За ход либо ставят камень из запаса на пустую клетку, либо перекладывают стопку.
          Первым ходом каждый ставит <b>камень соперника</b> — так никто не начинает с готовым преимуществом.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({})),
          steps: [A(0, { type: 'place', at: at('a1'), kind: 'F' }, 'Белые ставят чёрный камень в угол.'), A(1, { type: 'place', at: at('c3'), kind: 'F' }, 'Чёрные — белый в центр.')],
        },
      },
      {
        title: 'Плоский, стенка, капстоун',
        html: `<p>Камень можно положить <b>плоско</b> — он идёт в дорогу, или поставить <b>стоймя</b> — стенка в дорогу не идёт, зато на неё нельзя ходить.
          <b>Капстоун</b> идёт в дорогу, на него тоже нельзя ходить, а придя один последним шагом, он сплющивает стенку.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ c3: 'B', b3: 'c' }, 0),
          steps: [A(0, { type: 'move', from: at('b3'), dir: 1, drops: [1] }, 'Капстоун вправо — чёрная стенка становится плоским камнем.')],
        },
      },
      {
        title: 'Перекладка стопки',
        html: `<p>Стопкой владеет тот, чей камень сверху. Снимают сверху до стольких камней, какова сторона доски, идут по прямой и на каждой клетке
          оставляют снизу хотя бы один. Так забирают чужие стопки и перекрывают чужие дороги.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ a3: 'bww', b3: 'b', d3: 'b' }, 0),
          steps: [A(0, { type: 'move', from: at('a3'), dir: 1, drops: [1, 1] }, 'Белые несут два верхних камня вправо: один на b3, второй на c3.')],
        },
      },
      {
        title: 'Дорога',
        html: `<p>Дорога — цепочка клеток, где сверху твои плоские камни или капстоун, соединяющая противоположные края (по соседям по стороне, не по диагонали).
          Построил — выиграл. Если ход дал дорогу обоим, выигрывает ходивший.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ a3: 'w', b3: 'w', c3: 'w', d3: 'w', a1: 'b', b5: 'b', c1: 'b', d5: 'b' }, 0),
          steps: [A(0, { type: 'place', at: at('e3'), kind: 'F' }, 'Пятый камень — и дорога от края до края готова.')],
        },
      },
      {
        title: 'Конец по плоским',
        html: `<p>Если доска заполнилась или у кого-то кончился запас, считают плоские камни сверху (стенки и капстоуны не в счёт). Больше — победа, поровну — ничья.
          На больших досках вторым иногда дают <b>коми</b> — прибавку в один-два камня.</p>`,
      },
    ],
  },
};

