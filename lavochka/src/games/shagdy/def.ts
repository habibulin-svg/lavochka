/* Шагды («двойные ходы») — советская настольная игра (Жмеринка, арт. 10-ВН, цена 2-60): чёрная пластмассовая коробка,
 * в одной половине доска 8×8 с двумя крепостями, в другой — вспомогательное поле с сочетаниями цифр; красные и белые штырьки. */
import type { DemoStep, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, CELLS, cfgFrom, combos, newState, PIECES, progress, RESERVE, setup, step, toAct, type Action, type Event, type State, type Variant } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#efe9dc', light: '#ffffff', dark: '#b9b0a0', ink: '#6a6352' },
  { name: 'Красные', color: '#d8261e', light: '#ff7a68', dark: '#7a0a08' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'combo') return `${name(ev.seat)}: ${ev.a}/${ev.b}${ev.steps.length === 4 ? ' — дубль, четыре шага' : ''}.`;
  if (ev.type === 'step' && ev.took >= 0) return `${name(ev.seat)} снимает одинокую фишку соперника.`;
  if (ev.type === 'pass') return `${name(ev.seat)}: ходить нечем — сочетание закрыто.`;
  if (ev.type === 'end') {
    if (ev.winner == null) return ev.why === 'both' ? '🏁 Оба завели фишки в крепость за равное число ходов — ничья.' : '🏁 Продвинулись поровну — ничья.';
    return `🏁 Победа: ${name(ev.winner)} — ${ev.why === 'fort' ? 'все фишки в крепости противника' : 'фишки продвинулись дальше'}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Номер сочетания a/b в варианте. */
export const comboIdx = (v: Variant, a: number, b: number) => combos(v).findIndex(([x, y]) => x === a && y === b);
const C = (seat: number, pos: number, slot = 0) => CELLS[seat][pos][slot];
const Pick = (seat: number, a: number, b: number, caption?: string, v: Variant = 'normal'): DemoStep<Action> => ({ seat, action: { type: 'combo', i: comboIdx(v, a, b) }, caption });
const St = (seat: number, from: number, to: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'step', from, to }, caption });

/** Позиция для показа: фишки [место, номер, слот]. */
function pos(list: [number, number, number][], o: Partial<State> = {}): State {
  const s = newState(cfgFrom({}));
  for (const [seat, p, slot] of list) s.board[CELLS[seat][p][slot]] = seat + 1;
  const on = (seat: number) => list.filter((x) => x[0] === seat).length;
  s.reserve = [PIECES - on(0), PIECES - on(1)];
  s.entered = [PIECES, PIECES];
  return { ...s, ...o };
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
  id: 'shagdy',
  title: 'Шагды',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Вариант',
      type: 'select',
      choices: [
        { value: 'normal', label: 'обычный — 28 ходов (цифры 0–6)' },
        { value: 'easy', label: 'упрощённый — 21 ход (цифры 1–6)' },
        { value: 'hard', label: 'усложнённый — 36 ходов (цифры 0–7, без удвоения)' },
      ],
      default: 'normal',
    },
  ],
  presets: [
    { id: 'normal', label: 'Обычный', hint: '28 сочетаний цифр от 0 до 6 — 28 ходов у каждого, дубли удваиваются', options: { variant: 'normal' } },
    { id: 'easy', label: 'Упрощённый', hint: '21 сочетание цифр от 1 до 6 — как у пары кубиков', options: { variant: 'easy' } },
    { id: 'hard', label: 'Усложнённый', hint: '36 сочетаний цифр от 0 до 7, дубли не удваиваются', options: { variant: 'hard' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: s.why === 'fort' ? 'все фишки в крепости' : `продвинулись дальше: ${progress(s, s.winner)} против ${progress(s, 1 - s.winner)}` };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(3);
    for (let i = 0; i < 70 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      s = step(s, a).state;
      if (s.pick < 0 && s.moves[1] >= 8) break;
    }
    return s;
  },

  rules: {
    goal: 'Провести все свои 10 фишек в «крепость» противника раньше него. Ходы не бросают на кубиках, а выбирают: у каждого — своё поле сочетаний цифр, и каждое сочетание можно взять только один раз.',
    sections: [
      {
        title: 'Поле и дорожка',
        html: `<p>Доска 8×8, на ней две <b>крепости</b> по 14 клеток: своя — у вашего края, чужая — напротив. Фишки входят на поле у клеток
          с номером 1 и идут против часовой стрелки: вдоль края, через свою крепость, по другому краю — в крепость противника.
          У каждого игрока <b>своя нумерация</b>: на каждой клетке два номера, ваш — внизу слева.</p>
          <p>Дорожка двойная: у номера есть основная клетка и клетка «со штрихом» (у угловых 5, 10, 15 — даже две). На клетку со штрихом
          можно встать, только если основная того же номера уже занята своей фишкой; такие две фишки — <b>парные</b>.</p>`,
      },
      {
        title: 'Ход: сочетание цифр',
        html: `<p>В свой ход выберите на своём вспомогательном поле квадрат с сочетанием цифр, например 4/2, — и сделайте два <b>шага</b>: 4 и 2.
          Шагать можно разными фишками или одной (тогда промежуточная клетка должна быть свободна). Новая фишка вводится из запаса:
          «0—4» — на четвёртую клетку. Квадрат после этого закрывается: <b>одно сочетание — один раз за игру</b>, поэтому ходов у каждого
          столько, сколько сочетаний.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Начало партии: все фишки в запасе.',
          steps: [Pick(0, 4, 2, 'Белые выбирают 4/2.'), St(0, RESERVE, C(0, 4), 'Новая фишка — на четвёртую клетку…'), St(0, C(0, 4), C(0, 6), '…и ещё на два шага вперёд.')],
        },
      },
      {
        title: 'Дубли',
        html: `<p>Сочетание из двух одинаковых цифр <b>удваивается</b>: 3/3 — это четыре шага по три. Можно ввести две фишки на 6 и 6,
          или на 3 и 9, или одну сразу на 12, или продвинуть четыре фишки на три клетки. В усложнённом варианте дубли не удваиваются.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Белые берут дубль.',
          steps: [
            Pick(0, 3, 3, 'Дубль 3/3 — четыре шага по три.'),
            St(0, RESERVE, C(0, 3), 'Фишка на третью клетку.'),
            St(0, RESERVE, C(0, 3, 1), 'Вторая — на третью «со штрихом»: основная уже занята своей.'),
            St(0, C(0, 3), C(0, 6)),
            St(0, C(0, 3, 1), C(0, 6, 1), 'Парные фишки на шестой клетке.'),
          ],
        },
      },
      {
        title: 'Снятие фишек',
        html: `<p>Пока не введены все 10 фишек, в крепость противника заходить нельзя. Потом можно и <b>снимать</b>: встав на одинокую фишку
          соперника, вы отправляете её обратно в запас, и ему придётся вводить её заново. Парные фишки не снимаются, и фишки, уже дошедшие
          до своей цели, тоже. Нельзя занимать своими фишками все основные клетки 5–10 в своей крепости, чтобы запереть соперника.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 10, 0],
              [0, 12, 0],
              [0, 12, 1],
              [1, 5, 0],
              [1, 8, 0],
              [1, 8, 1],
            ]),
          intro: 'Красная фишка стоит одна — на пятнадцатой клетке белых.',
          steps: [Pick(0, 3, 2, 'Белые берут 3/2.'), St(0, C(0, 10), C(0, 13)), St(0, C(0, 13), C(0, 15), 'Красная фишка снята и уходит в запас.')],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Кто первым заведёт все 10 фишек в крепость противника, тот и победил — но ходов у обоих должно быть поровну: если первым
          успел начинавший, второй делает свой последний ход, и если успеет тоже — ничья. Если сочетания кончились, а в крепость так никто
          и не прошёл, побеждает тот, чьи фишки <b>продвинулись дальше</b> (сумма номеров клеток).</p>
          <p>Нечем ходить — ход пропускают, закрыв любое из оставшихся сочетаний.</p>`,
      },
    ],
  },
};

