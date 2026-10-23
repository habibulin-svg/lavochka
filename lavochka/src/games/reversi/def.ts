/* Реверси — описание игры: доска 8×8 (6×6, 10×10), начало «крестом» или свободное, анти-реверси; советская коробка
 * «Электронмаш» (синий войлок) или зелёное сукно; боты; правила с показом. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, BLACK, cfgFrom, count, makeView, newState, setup, toAct, WHITE, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1a1a1a', light: '#555555', dark: '#000000' },
  { name: 'Белые', color: '#e8e4d8', light: '#ffffff', dark: '#b8b4a8', ink: '#6a665a' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'pass') return `${name(ev.seat)}: ходить некуда — пропуск.`;
  if (ev.type === 'end') {
    const [b, w] = ev.score;
    return ev.winner == null ? `🏁 Ничья, ${b}:${w}.` : `🏁 Счёт ${b}:${w} — победа: ${name(ev.winner)}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция на доске 8×8: списки фишек [x, y]. */
function pos(black: [number, number][], white: [number, number][], turn = 0): State {
  const s = newState(cfgFrom({}));
  s.board.fill(0);
  for (const [x, y] of black) s.board[y * 8 + x] = BLACK;
  for (const [x, y] of white) s.board[y * 8 + x] = WHITE;
  s.turn = turn;
  return s;
}
const M = (seat: number, x: number, y: number, caption?: string, n = 8) => ({ seat, action: { type: 'play', p: y * n + x } as Action, caption });

/** Неслучайный генератор для превью. */
function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648),
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'reversi',
  title: 'Реверси',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 8, label: '8×8' },
        { value: 6, label: '6×6 — малая' },
        { value: 10, label: '10×10 — большая' },
      ],
      default: 8,
    },
    {
      key: 'start',
      label: 'Начало',
      type: 'select',
      choices: [
        { value: 'cross', label: 'четыре фишки накрест' },
        { value: 'free', label: 'свободное — первые четыре ставят сами' },
      ],
      default: 'cross',
    },
    { key: 'anti', label: 'Анти-реверси', hint: 'Выигрывает тот, у кого фишек меньше', type: 'toggle', default: false },
    {
      key: 'look',
      label: 'Оформление',
      type: 'select',
      choices: [
        { value: 'soviet', label: 'советская: синий войлок' },
        { value: 'green', label: 'зелёное сукно' },
      ],
      default: 'soviet',
    },
  ],
  presets: [
    { id: 'soviet', label: 'Советская', hint: 'Коробка «Электронмаш»: синий войлок, фишки в трубках', options: { size: 8, start: 'cross', anti: false, look: 'soviet' } },
    { id: 'classic', label: 'На зелёном сукне', hint: 'Те же правила, турнирное зелёное поле', options: { size: 8, start: 'cross', anti: false, look: 'green' } },
    { id: 'free', label: 'Старинная', hint: 'Как в реверси 1880-х: первые четыре фишки ставят сами', options: { size: 8, start: 'free', anti: false, look: 'green' } },
    { id: 'small', label: 'Малая 6×6', hint: 'Короткая партия', options: { size: 6, start: 'cross', anti: false, look: 'soviet' } },
    { id: 'big', label: 'Большая 10×10', hint: 'Длинная партия', options: { size: 10, start: 'cross', anti: false, look: 'green' } },
    { id: 'anti', label: 'Анти-реверси', hint: 'Наоборот: выигрывает тот, у кого фишек меньше', options: { size: 8, start: 'cross', anti: true, look: 'soviet' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over) return null;
    const [b, w] = count(s.board);
    const scores = { 0: b, 1: w };
    if (s.winner == null) return { winners: [], text: `ничья, ${b}:${w}`, scores };
    return { winners: [s.winner], text: `${b}:${w}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(12);
    for (let i = 0; i < 26 && !s.over; i++) {
      const a = choose(s, s.turn, 0, rng);
      if (!a) break;
      s = apply(s, s.turn, a)!.state;
    }
    return s;
  },

  rules: {
    goal: 'К концу партии иметь на доске больше фишек своего цвета, чем у соперника.',
    sections: [
      {
        title: 'Ход и переворот',
        html: `<p>Фишки с одной стороны чёрные, с другой — белые. В начале в центре стоят четыре фишки накрест, первыми ходят чёрные.</p>
          <p>Ход — поставить свою фишку так, чтобы между ней и другой вашей фишкой по прямой <b>без промежутков</b> стояли фишки соперника.
          Все они <b>переворачиваются</b> и становятся вашими. Ставить фишку, которая ничего не переворачивает, нельзя.
          Клетки, куда можно пойти, отмечены точками.</p>`,
        demo: { seats: demoSeats, intro: 'Начало партии. Чёрные ставят фишку над белой.', steps: [M(0, 3, 2, 'Белая фишка между двумя чёрными — переворачивается.'), M(1, 2, 2, 'Белые отвечают по диагонали.')] },
      },
      {
        title: 'Сразу в несколько сторон',
        html: `<p>Фишка переворачивает ряды <b>во всех восьми направлениях</b> сразу — по горизонтали, вертикали и диагоналям,
          если в каждом из них ряд чужих фишек замкнут вашей.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [1, 4],
                [4, 7],
                [6, 2],
                [3, 1],
              ],
              [
                [2, 4],
                [3, 4],
                [4, 5],
                [4, 6],
                [5, 3],
                [5, 5],
              ],
              0
            ),
          intro: 'Одна чёрная фишка замкнёт три ряда сразу.',
          steps: [M(0, 4, 4, 'Перевернулись ряды влево, вниз и по диагонали.')],
        },
      },
      {
        title: 'Пропуск и конец партии',
        html: `<p>Если пойти некуда, ход <b>пропускается</b> — и ходит соперник. Партия кончается, когда доска заполнена или ходов нет ни у кого.
          Считают фишки: у кого больше — тот и выиграл. Если у кого-то не осталось ни одной фишки, партия кончается сразу.</p>
          <p><b>Совет из советской листовки:</b> занимайте края и особенно <b>углы</b> — фишку в углу перевернуть нельзя.
          А клетки рядом с пустым углом лучше не трогать: через них соперник угол и заберёт.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [0, 0],
                [2, 2],
              ],
              [
                [1, 0],
                [3, 3],
              ],
              0
            ),
          intro: 'У белых всего две фишки.',
          steps: [
            M(0, 2, 0, 'Одна белая перевернулась…'),
            M(1, 1, 1, 'Белые переворачивают чёрную по диагонали.'),
            M(0, 4, 4, 'Вся диагональ стала чёрной — белых фишек не осталось, партия окончена.'),
          ],
        },
      },
      {
        title: 'Старинное начало и анти-реверси',
        html: `<p>В реверси, придуманной в Англии в 1880-х, доска сначала пустая: первые <b>четыре фишки</b> игроки по очереди ставят
          на четыре центральные клетки как хотят, ничего не переворачивая. Дальше — обычные ходы. Расстановку накрест закрепили позже,
          в японских турнирах 1970-х; так же было и в советской коробке.</p>
          <p><b>Анти-реверси</b> — наоборот: выигрывает тот, у кого в конце фишек <b>меньше</b>.</p>`,
        demo: {
          seats: demoSeats,
          options: { start: 'free' },
          intro: 'Доска пустая.',
          steps: [M(0, 3, 3, 'Чёрные ставят первую фишку в центр.'), M(1, 4, 3), M(0, 4, 4), M(1, 3, 4, 'Четыре фишки стоят — дальше обычная игра.')],
        },
      },
    ],
  },
};
