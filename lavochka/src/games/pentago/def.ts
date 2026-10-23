/* Пентаго — описание игры: шарик в лунку и поворот квадранта, пять в ряд. Классика 6×6 вдвоём, большая 9×9 на 2–4,
 * «поворот по желанию». Дерево или камень. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1c1c20', light: '#5a5a62', dark: '#000000' },
  { name: 'Белые', color: '#ece8de', light: '#ffffff', dark: '#b8b2a4', ink: '#6a665a' },
  { name: 'Красные', color: '#c8242a', light: '#f26068', dark: '#6a0a10' },
  { name: 'Синие', color: '#2050c0', light: '#6a96f0', dark: '#0c2468' },
];

/** «Квадрант» по номеру для журнала. */
export function quadName(size: number, q: number): string {
  if (size === 6) return ['левый верхний', 'правый верхний', 'левый нижний', 'правый нижний'][q];
  return ['левый верхний', 'верхний средний', 'правый верхний', 'левый средний', 'центральный', 'правый средний', 'левый нижний', 'нижний средний', 'правый нижний'][q];
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'end') {
    if (ev.why === 'full') return '🤝 Доска заполнена, а пяти в ряд нет ни у кого — ничья.';
    if (ev.why === 'both') return '🤝 Поворот сложил ряд обоим — ничья.';
    return ev.winners.length > 1 ? `🏁 Ряд сразу у нескольких — побеждают все: ${ev.winners.map(name).join(', ')}.` : `🏁 Пять в ряд — победа: ${name(ev.winners[0])}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция 6×6: строки по 6 знаков — '.', 'x' (чёрные), 'o' (белые). */
function pos(rows: string[], turn = 0, free = false): State {
  const s = newState(cfgFrom({ size: 6, free }), [0, 1]);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (s.board[y * 6 + x] = ch === 'x' ? 0 : ch === 'o' ? 1 : -1)));
  s.turn = turn;
  s.ply = rows.join('').replace(/\./g, '').length * 2;
  return s;
}
const P = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'place', p: y * 6 + x } as Action, caption });
const T = (seat: number, q: number, dir: number, caption?: string) => ({ seat, action: { type: 'twist', q, dir } as Action, caption });

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
  id: 'pentago',
  title: 'Пентаго',
  players: { min: 2, max: 4, default: 2 },
  countsFor: (o) => (Number(o.size) === 9 ? [2, 3, 4] : [2]),
  countsHint: (o) => (Number(o.size) === 9 ? 'большая доска — от двух до четырёх' : 'классика — вдвоём'),
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 6, label: '6×6, четыре квадранта — классика' },
        { value: 9, label: '9×9, девять квадрантов — на 2–4' },
      ],
      default: 6,
    },
    { key: 'free', label: 'Поворот по желанию', hint: 'Квадрант можно не крутить (домашнее облегчение)', type: 'toggle', default: false },
    {
      key: 'look',
      label: 'Вид',
      type: 'select',
      choices: [
        { value: 'wood', label: 'светлое дерево, стеклянные шарики' },
        { value: 'stone', label: 'тёмный камень' },
      ],
      default: 'wood',
    },
  ],
  presets: [
    { id: 'classic', label: 'Классика 6×6', hint: 'Вдвоём: шарик и обязательный поворот, пять в ряд', options: { size: 6, free: false, look: 'wood' } },
    { id: 'big', label: 'Большая 9×9', hint: 'Девять квадрантов, от двух до четырёх игроков, крутят только по часовой', options: { size: 9, free: false, look: 'stone' } },
    { id: 'free', label: 'Поворот по желанию', hint: 'Классика, но квадрант можно не крутить', options: { size: 6, free: true, look: 'wood' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (!s.winners.length) return { winners: [], text: s.why === 'full' ? 'доска заполнена — ничья' : 'ряд у обоих — ничья' };
    return { winners: s.winners, text: 'пять в ряд' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({ size: 6 }), [0, 1]);
    const rng = fixedRng(9);
    // середина партии, ещё без ряда; ход — на повороте, чтобы видно было стрелки
    for (let i = 0; i < 200 && s.ply < 23; i++) {
      const n = step(s, choose(s, s.turn, 1, rng)!).state;
      if (n.over) break;
      s = n;
    }
    return s;
  },

  rules: {
    goal: 'Первым выстроить <b>пять своих шариков в ряд</b> — по горизонтали, вертикали или диагонали.',
    sections: [
      {
        title: 'Доска и ход',
        html: `<p>Доска 6×6 собрана из <b>четырёх квадрантов</b> 3×3, и каждый можно поворачивать. Ход состоит из двух частей:</p>
          <ol><li><b>поставить</b> свой шарик в любую пустую лунку;</li>
          <li><b>повернуть</b> любой квадрант на четверть оборота — по часовой стрелке или против. Не обязательно тот, куда
          поставили шарик; пустой — тоже можно.</li></ol>
          <p>Первыми ходят чёрные. Чтобы повернуть квадрант, нажмите на его <b>левую половину</b> — против часовой,
          на <b>правую</b> — по часовой.</p>`,
        demo: { seats: demoSeats, intro: 'Пустая доска.', steps: [P(0, 0, 0, 'Чёрные ставят шарик в угол…'), T(0, 0, 1, '…и поворачивают этот квадрант по часовой — шарик уехал в другой угол.'), P(1, 4, 4), T(1, 1, -1, 'Белые крутят пустой квадрант — так тоже можно.')] },
      },
      {
        title: 'Пять в ряд',
        html: `<p>Побеждает тот, у кого <b>пять шариков в ряд</b> — ряд может проходить через несколько квадрантов. Если ряд
          сложился сразу, как вы поставили шарик, — победа, крутить уже не нужно. Чаще ряд собирают <b>поворотом</b>:
          четыре шарика стоят врозь, а четверть оборота ставит их в линию.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['xxx...', '......', '......', '......', 'x.....', 'oo.o.o'], 0),
          intro: 'У чёрных три шарика лежат поперёк, вверху, и один — внизу слева.',
          steps: [P(0, 0, 3, 'Чёрные ставят шарик под ряд…'), T(0, 0, -1, '…и поворот левого верхнего квадранта против часовой ставит верхние три столбиком: пять в ряд!')],
        },
      },
      {
        title: 'Ничья',
        html: `<p>Если поворот сложил ряд <b>сразу обоим</b> — ничья. Доска заполнилась, а пяти в ряд ни у кого нет, — тоже ничья.</p>`,
      },
      {
        title: 'Большая доска на 2–4',
        html: `<p>На доске <b>9×9</b> девять квадрантов, играют от двух до четырёх, по кругу: чёрные, белые, красные, синие.
          Ряд — те же <b>пять</b> шариков. Квадрант здесь крутят <b>только по часовой</b> — нажмите на любой. Если поворот
          сложил ряд нескольким сразу, побеждают все они.</p>`,
      },
      {
        title: 'Поворот по желанию',
        html: `<p>Домашнее облегчение: квадрант можно <b>не крутить</b> — после постановки шарика есть кнопка «Не крутить».
          Игра становится спокойнее и ближе к обычным «пяти в ряд».</p>`,
        demo: {
          seats: demoSeats,
          options: { free: true },
          setup: () => pos(['......', '.x..o.', '......', '......', '.o..x.', '......'], 0, true),
          steps: [P(0, 2, 2, 'Чёрные ставят шарик'), { seat: 0, action: { type: 'twist', q: -1, dir: 0 } as Action, caption: '…и ничего не крутят.' }],
        },
      },
    ],
  },
};
