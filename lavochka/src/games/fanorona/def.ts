/* Фанорона — описание игры: мадагаскарские «шашки» на доске-алькерке 9×5, взятие подходом и отходом, цепочки взятий;
 * малые доски — Фанорон-дими 5×5 и Фанорон-тэло 3×3 (три в ряд); вела — фора проигравшему прошлую партию. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, BLACK, cfgFrom, count, newState, setup, step, toAct, WHITE, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#ece3cf', light: '#fffaf0', dark: '#a89a7c', ink: '#5a4e36' },
  { name: 'Чёрные', color: '#3a2a22', light: '#6a5446', dark: '#120a06' },
];

function fishek(n: number): string {
  const m = n % 10;
  const t = n % 100;
  return `${n} ${m === 1 && t !== 11 ? 'фишку' : m >= 2 && m <= 4 && (t < 12 || t > 14) ? 'фишки' : 'фишек'}`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if ((ev.type === 'move' || ev.type === 'pick') && ev.taken.length) return `⚔️ ${name(ev.seat)}: ${ev.how === 'a' ? 'подходом' : 'отходом'} — снято ${fishek(ev.taken.length)}.`;
  if (ev.type === 'vela') return `🤝 Вела кончилась: у ${name(ev.seat)} осталось пять фишек — дальше по обычным правилам.`;
  if (ev.type === 'end') {
    if (ev.why === 'long') return '🏁 Долго без взятий — ничья.';
    if (ev.why === 'row') return `🏁 Три в ряд — победа: ${name(ev.winner!)}.`;
    if (ev.why === 'stuck') return `🏁 Сопернику некуда ходить — победа: ${name(ev.winner!)}.`;
    return `🏁 Сняты все фишки соперника — победа: ${name(ev.winner!)}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const at = (x: number, y: number) => y * 9 + x;
/** Позиция на полной доске: белые, чёрные, чей ход. */
function pos(white: [number, number][], black: [number, number][], turn = 0): State {
  const s = newState(cfgFrom({}));
  s.board.fill(0);
  for (const [x, y] of white) s.board[at(x, y)] = WHITE;
  for (const [x, y] of black) s.board[at(x, y)] = BLACK;
  s.turn = turn;
  s.ply = 2;
  return s;
}
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({ seat, action: { type: 'move', from: at(x, y), to: at(x2, y2) } as Action, caption });
const Pick = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'pick', at: at(x, y) } as Action, caption });
const Tp = (seat: number, p: number, caption?: string) => ({ seat, action: { type: 'place', to: p } as Action, caption });

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
  id: 'fanorona',
  title: 'Фанорона',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'full', label: 'полная 9×5, по 22 фишки' },
        { value: 'dimy', label: 'Фанорон-дими 5×5, по 12' },
        { value: 'telo', label: 'Фанорон-тэло 3×3 — три в ряд' },
      ],
      default: 'full',
    },
    {
      key: 'vela',
      label: 'Вела (фора)',
      hint: 'Отдающий только ходит, соперник берёт по одной фишке, пока у отдающего не останется пять',
      type: 'select',
      choices: [
        { value: -1, label: 'без велы' },
        { value: 0, label: 'отдают белые' },
        { value: 1, label: 'отдают чёрные' },
      ],
      default: -1,
    },
    { key: 'opening', label: 'Первый ход — одно взятие', hint: 'Домашнее правило: в самом первом ходе партии цепочки нет', type: 'toggle', default: false },
    {
      key: 'look',
      label: 'Вид',
      type: 'select',
      choices: [
        { value: 'wood', label: 'резная доска, ракушки и семена' },
        { value: 'stone', label: 'камень с лунками, галька' },
      ],
      default: 'wood',
    },
  ],
  presets: [
    { id: 'full', label: 'Полная 9×5', hint: 'Настоящая фанорона: по 22 фишки, цепочки взятий', options: { size: 'full', vela: -1, opening: false, look: 'wood' } },
    { id: 'dimy', label: 'Фанорон-дими', hint: 'Малая доска 5×5, по 12 фишек — партия покороче', options: { size: 'dimy', vela: -1, opening: false, look: 'wood' } },
    { id: 'telo', label: 'Фанорон-тэло', hint: 'Детская 3×3: расставь три фишки и выстрой их в ряд', options: { size: 'telo', vela: -1, opening: false, look: 'stone' } },
    { id: 'vela', label: 'Вела', hint: 'Фора: чёрные (победитель прошлой партии) отдают фишки, пока не останется пять', options: { size: 'full', vela: 1, opening: false, look: 'wood' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores = { 0: count(s, 0), 1: count(s, 1) };
    if (s.winner == null) return { winners: [], text: 'ничья', scores };
    if (s.cfg.size === 'telo') return { winners: [s.winner], text: 'три в ряд', scores };
    return { winners: [s.winner], text: `осталось ${fishek(count(s, s.winner))}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(11);
    for (let i = 0; i < 60 && s.ply < 5 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Снять с доски все фишки соперника. В малой Фанорон-тэло — выстроить три свои фишки в ряд.',
    sections: [
      {
        title: 'Доска и первый ход',
        html: `<p>Фанорона — главная игра Мадагаскара. Доска — <b>45 точек</b> (9×5), соединённых линиями; из каждой второй точки
          идут и диагонали. У каждого по <b>22 фишки</b>: две ближние линии свои, в средней — через одну, центр пуст.
          Первыми ходят <b>белые</b>.</p>
          <p>Ход — на соседнюю <b>пустую</b> точку по линии. Простой ход без взятия называется <i>пайка</i>.</p>`,
        demo: { seats: demoSeats, intro: 'Начальная расстановка: пуст только центр.', steps: [Mv(0, 4, 3, 4, 2, 'Белая встаёт в центр — и подходом снимает две чёрные фишки впереди.')] },
      },
      {
        title: 'Взятие подходом',
        html: `<p>Если фишка пришла вплотную к чужой фишке и та стоит <b>прямо по ходу</b>, на той же линии, — чужая фишка снимается.
          А с ней и <b>все чужие фишки подряд</b> за ней по этой линии, пока не встретится пустая точка или своя фишка.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [1, 2],
                [7, 2],
                [0, 4],
              ],
              [
                [3, 2],
                [4, 2],
                [5, 2],
                [8, 0],
              ]
            ),
          intro: 'Три чёрные фишки стоят в ряд.',
          steps: [Mv(0, 1, 2, 2, 2, 'Белая подходит — снимается весь ряд до своей фишки.')],
        },
      },
      {
        title: 'Взятие отходом и выбор',
        html: `<p>Взятие <b>отходом</b> — наоборот: фишка стоит вплотную к чужой и <b>отходит от неё</b> по той же линии.
          Снимается чужая фишка, оставшаяся позади, и все чужие подряд за ней.</p>
          <p>Если один ход берёт и подходом, и отходом, — берут <b>что-то одно</b>, на выбор: нажмите на фишку, которую снимаете.</p>
          <p>Взятие <b>обязательно</b>: если можно взять, пайкой ходить нельзя. Но какое взятие выбрать — решаете сами.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [4, 2],
                [0, 4],
              ],
              [
                [1, 2],
                [2, 2],
                [3, 2],
                [6, 2],
                [8, 0],
              ]
            ),
          intro: 'Белая зажата: слева три чёрные, справа через точку — одна.',
          steps: [Mv(0, 4, 2, 5, 2, 'Шаг вправо: подходом — одна фишка, отходом — три.'), Pick(0, 3, 2, 'Выбираем отход: снимаются три.')],
        },
      },
      {
        title: 'Цепочка взятий',
        html: `<p>Взявшая фишка может <b>брать дальше</b> — тем же ходом, как в шашках. Но с двумя запретами:
          нельзя прийти в точку, где она <b>уже побывала</b> в этом ходе (и в исходную тоже), и нельзя идти
          <b>в том же направлении</b>, что и прошлым шагом. В цепочке — только взятия.</p>
          <p>Цепочку можно <b>остановить</b> в любой момент — кнопкой «Хватит брать».</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 2],
                [0, 4],
              ],
              [
                [4, 2],
                [3, 0],
                [5, 1],
                [8, 4],
              ]
            ),
          intro: 'Одна белая фишка снимет три чёрные подряд.',
          steps: [
            Mv(0, 2, 2, 3, 2, 'Подход вправо — первая снята.'),
            Mv(0, 3, 2, 3, 1, 'Вправо снова нельзя — поворот вверх, подходом вторая.'),
            Mv(0, 3, 1, 4, 1, 'Снова поворот — и третья.'),
          ],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Выигрывает тот, кто <b>снял все фишки</b> соперника (или запер их так, что ходить некуда).
          Если пятьдесят ходов подряд никто ничего не снял — <b>ничья</b>.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 2],
                [6, 4],
              ],
              [
                [4, 2],
                [5, 2],
              ]
            ),
          intro: 'У чёрных осталось две фишки.',
          steps: [Mv(0, 2, 2, 3, 2, 'Подходом — обе. Победа белых.')],
        },
      },
      {
        title: 'Вела — фора',
        html: `<p>На Мадагаскаре победитель прошлой партии в следующей играет <b>велу</b>: он только ходит, не беря,
          а проигравший снимает <b>по одной фишке за ход</b>, без цепочек. Когда у отдающего остаётся <b>пять</b> фишек,
          дальше играют как обычно. В источниках вела описана по-разному — у нас она такая.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({ vela: 1 })),
          intro: 'Чёрные отдают фишки.',
          steps: [Mv(0, 4, 3, 4, 2, 'Подход снял бы две — но в веле берут только одну.'), Mv(1, 3, 1, 4, 1, 'Чёрные только ходят.')],
        },
      },
      {
        title: 'Фанорон-дими и Фанорон-тэло',
        html: `<p><b>Фанорон-дими</b> — та же игра на доске 5×5, по 12 фишек: партия короче.</p>
          <p><b>Фанорон-тэло</b> — детская игра на доске 3×3 с диагоналями. Взятий нет: по очереди ставят по <b>три</b> фишки,
          потом ходят ими на соседнюю пустую точку. Кто первым выстроит <b>три в ряд</b> по любой линии — победил.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({ size: 'telo' })),
          intro: 'Пустая доска 3×3.',
          steps: [Tp(0, 4, 'Белые занимают центр.'), Tp(1, 0), Tp(0, 2, 'Угроза: 2–4–6.'), Tp(1, 6, 'Чёрные закрыли — и сами грозят по краю.'), Tp(0, 3, 'Белые закрывают.'), Tp(1, 5, 'Все фишки на доске — дальше ходы.')],
        },
      },
    ],
  },
};
