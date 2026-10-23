/* Игры на кресте — описание: лиса и гуси (13 гусей; гандикап — две лисы против 17), асальто (штурм крепости),
 * солитёр «Йога» (один игрок, 33 или 37 лунок). Советская коробка: голубой войлок, белые линии с диагоналями в каждом
 * квадрате, фишки-«шашечки»; деревянная доска со стеклянными шариками. */
import type { GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, EMPTY, FOX, geo, MAN, men, newState, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Гуси', color: '#e8e6e0', light: '#ffffff', dark: '#a8a49a', ink: '#6a665a' },
  { name: 'Лиса', color: '#d9781e', light: '#f3a04e', dark: '#8a4410' },
];

const WHY: Record<string, string> = {
  trapped: 'заперли',
  eaten: 'съедено слишком много',
  stuck: 'сопернику некуда ходить',
  fort: 'крепость взята',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.eat >= 0 && ev.seat === 1) return `${name(ev.seat)}: съел${ev.kind === FOX ? '' : 'а'} фишку.`;
  if (ev.type === 'end') {
    if (ev.why === 'solved') return '🏁 Осталась одна фишка — и та в центре! Идеально.';
    if (ev.why === 'left') return ev.left === 1 ? '🏁 Осталась одна фишка — решено!' : `🏁 Ходов нет, осталось фишек: ${ev.left}.`;
    if (ev.why === 'long') return '🏁 Триста ходов без исхода — ничья.';
    return `🏁 Победа: ${name(ev.winner!)} — ${WHY[ev.why]}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const soloSeats: SeatSpec[] = [{ seat: 0, kind: 'bot', name: 'Игрок', level: 1 }];
const P = (x: number, y: number) => geo(cfgFrom({})).at[y * 7 + x];
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({ seat, action: { type: 'move', from: P(x, y), to: P(x2, y2) } as Action, caption });

function pos(mans: [number, number][], foxes: [number, number][], turn: number, o: Options = {}): State {
  const s = newState(cfgFrom(o));
  s.board.fill(EMPTY);
  for (const [x, y] of mans) s.board[P(x, y)] = MAN;
  for (const [x, y] of foxes) s.board[P(x, y)] = FOX;
  s.turn = turn;
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

const row = (y: number, xs: number[]) => xs.map((x) => [x, y] as [number, number]);

export const def: GameDef<State, Action, Event, State> = {
  id: 'foxgeese',
  title: 'Лиса и гуси',
  players: { min: 1, max: 2, default: 2 },
  countsFor: (o) => (o.mode === 'yoga' ? [1] : [2]),
  countsHint: (o) => (o.mode === 'yoga' ? 'солитёр — головоломка для одного' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'fox', label: 'лиса и гуси' },
        { value: 'asalto', label: 'асальто — штурм крепости' },
        { value: 'yoga', label: 'солитёр «Йога» — для одного' },
      ],
      default: 'fox',
    },
    {
      key: 'geese',
      label: 'Гусей',
      type: 'select',
      choices: [13, 15, 17].map((v) => ({ value: v, label: `${v}` })),
      default: 13,
      showIf: (o) => o.mode === 'fox',
    },
    {
      key: 'foxes',
      label: 'Лис',
      type: 'select',
      choices: [
        { value: 1, label: 'одна' },
        { value: 2, label: 'две — гандикап' },
      ],
      default: 1,
      showIf: (o) => o.mode === 'fox',
    },
    { key: 'back', label: 'Гусям можно назад', type: 'toggle', default: false, showIf: (o) => o.mode === 'fox' },
    {
      key: 'lines',
      label: 'Диагонали',
      type: 'select',
      choices: [
        { value: 'alt', label: 'через точку — старинная доска' },
        { value: 'all', label: 'в каждом квадрате — советская' },
      ],
      default: 'all',
      showIf: (o) => o.mode !== 'yoga',
    },
    {
      key: 'holes',
      label: 'Лунок',
      type: 'select',
      choices: [
        { value: 33, label: '33 — английский крест' },
        { value: 37, label: '37 — французская доска' },
      ],
      default: 33,
      showIf: (o) => o.mode === 'yoga',
    },
    {
      key: 'look',
      label: 'Оформление',
      type: 'select',
      choices: [
        { value: 'soviet', label: 'советская коробка' },
        { value: 'wood', label: 'деревянная доска со стеклянными шариками' },
      ],
      default: 'soviet',
    },
  ],
  presets: [
    { id: 'fox', label: 'Лиса и гуси', hint: 'Лиса против 13 гусей: гуси запирают, лиса ест', options: { mode: 'fox', geese: 13, foxes: 1, back: false, lines: 'all', look: 'soviet' } },
    { id: 'handicap', label: 'Гандикап', hint: 'Две лисы против 17 гусей — для равных сил', options: { mode: 'fox', geese: 17, foxes: 2, back: false, lines: 'all', look: 'soviet' } },
    { id: 'old', label: 'Старинная доска', hint: 'Лиса и гуси на деревянной доске, диагонали через точку', options: { mode: 'fox', geese: 13, foxes: 1, back: false, lines: 'alt', look: 'wood' } },
    { id: 'asalto', label: 'Асальто', hint: '24 повстанца штурмуют крепость, два офицера обороняют', options: { mode: 'asalto', lines: 'alt', look: 'soviet' } },
    { id: 'yoga', label: 'Йога', hint: 'Солитёр: прыгайте, пока не останется одна фишка', options: { mode: 'yoga', holes: 33, look: 'soviet' } },
    { id: 'french', label: 'Французский солитёр', hint: 'Доска на 37 лунок, стеклянные шарики', options: { mode: 'yoga', holes: 37, look: 'wood' } },
  ],

  // один игрок — всегда солитёр
  setup: (seats, opts) => newState(cfgFrom(seats.length === 1 ? { ...opts, mode: 'yoga' } : opts)),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.cfg.mode === 'yoga') {
      const left = men(s);
      return { winners: left === 1 ? [0] : [], text: left === 1 ? 'осталась одна фишка' : `осталось фишек: ${left}`, scores: { 0: left } };
    }
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: s.winner === 1 ? `съедено: ${s.eaten}` : s.cfg.mode === 'asalto' ? 'крепость взята' : 'лиса заперта' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(3);
    for (let i = 0; i < 14 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Гусям — запереть лису, чтобы ей некуда было ходить. Лисе — съесть столько гусей, чтобы запереть её стало нечем.',
    sections: [
      {
        title: 'Лиса и гуси',
        html: `<p>Доска — крест из 33 точек. Внизу — 13 гусей, наверху — лиса. Первыми ходят <b>гуси</b>: на соседнюю пустую точку
          по прямой линии — вперёд или вбок, но <b>не назад</b> и не по диагонали. Лиса ходит на соседнюю точку по любой линии, и по диагонали тоже.</p>
          <p>Гуси держатся плотно: за каждым гусем, к которому подошла лиса, точка должна быть занята.</p>`,
        demo: { seats: demoSeats, intro: 'Гуси внизу, лиса наверху.', steps: [Mv(0, 3, 4, 3, 3, 'Гусь выходит вперёд.'), Mv(1, 3, 1, 3, 2, 'Лиса подходит к нему вплотную.'), Mv(0, 3, 5, 3, 4, 'Гуси закрывают тыл — прыгнуть некуда.')] },
      },
      {
        title: 'Лиса ест',
        html: `<p>Лиса ест, <b>перепрыгивая</b> через соседнего гуся по линии на пустую точку за ним — гусь снят. Если с новой точки можно
          прыгнуть ещё — лиса может продолжать (а может и остановиться — кнопка «Хватит»). Есть не обязательно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([...row(6, [2, 3, 4]), ...row(5, [2, 4]), ...row(4, [0, 1, 2, 3, 4, 5, 6])], [[3, 3]], 1),
          intro: 'Под гусем перед лисой — пустая точка.',
          steps: [Mv(1, 3, 3, 3, 5, 'Прыжок — гусь съеден…'), Mv(1, 3, 5, 1, 3, '…и сразу второй, по диагонали.')],
        },
      },
      {
        title: 'Кто выигрывает',
        html: `<p>Гуси выигрывают, <b>заперев</b> лису: ей некуда ни шагнуть, ни прыгнуть. Лиса выигрывает, когда гусей осталось
          <b>меньше девяти</b> — запереть её уже нечем, — или когда гусям некуда ходить. Если за 300 ходов исхода нет — ничья.</p>
          <p><b>Гандикап</b> — уравнять силы: <b>две лисы</b> против 17 гусей. На старинной доске диагонали проведены через точку,
          в советской коробке — в каждом квадрате.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([...row(0, [3, 4]), ...row(1, [2]), ...row(2, [2, 3, 4]), ...row(4, [2, 3, 4]), [3, 5]], [[2, 0]], 0),
          intro: 'Лиса забилась в угол.',
          steps: [Mv(0, 3, 2, 3, 1, 'Последний выход закрыт — лиса заперта.')],
        },
      },
      {
        title: 'Асальто',
        html: `<p><b>Асальто</b> («штурм») — та же доска, но верхняя ветвь креста — <b>крепость</b> из 9 точек. В ней два офицера,
          вокруг — 24 повстанца. Повстанцы ходят первыми, на соседнюю точку только <b>к крепости</b>: вперёд, вбок или вперёд по диагонали.
          Офицеры ходят куда угодно и бьют прыжком, как лиса, но <b>обязаны</b> бить, если можно, и продолжать прыжки до конца.</p>
          <p>Повстанцы выигрывают, заняв <b>все 9 точек</b> крепости или заперев офицеров. Офицеры — когда повстанцев осталось меньше девяти.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'asalto', lines: 'alt' },
          intro: 'Офицеры в крепости, повстанцы вокруг.',
          steps: [Mv(0, 3, 3, 3, 2, 'Повстанец входит в крепость.'), Mv(1, 4, 2, 3, 1, 'Офицер заходит ему за спину…'), Mv(0, 3, 4, 3, 3, '…но тыл закрыт: бить нечего.')],
        },
      },
      {
        title: 'Йога — солитёр',
        html: `<p>Головоломка для одного. Все лунки заняты, кроме центральной. Фишка <b>прыгает</b> по прямой (не по диагонали) через соседнюю
          на пустую лунку, а перепрыгнутая снимается. Ходы кончаются, когда прыгать некуда.</p>
          <p>Цель — оставить <b>одну</b> фишку, а лучше всего — в самом центре. В СССР эту игру продавали под названием «Йога»;
          на французской доске 37 лунок, и решения с одной фишкой из центра там нет — начинают с соседней лунки.</p>`,
        demo: {
          seats: soloSeats,
          options: { mode: 'yoga' },
          intro: 'Пустая лунка — в центре.',
          steps: [Mv(0, 3, 1, 3, 3, 'Первый прыжок — в центр.'), Mv(0, 5, 2, 3, 2, 'Второй — в освободившуюся лунку.')],
        },
      },
    ],
  },
};
