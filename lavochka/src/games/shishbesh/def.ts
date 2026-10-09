/* Шиш-беш — описание игры для сборника: правила, боты, показ правил. Без DOM. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { chooseMove } from './ai';
import { applyMove, applyRoll, cfgFrom, DEFAULT_CFG, newGame, type Action, type Cfg, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Красный', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Зелёный', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Жёлтый', color: '#d9a521', light: '#f3cf62', dark: '#8a6410' },
  { name: 'Синий', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
];

const AGAIN: Record<string, string> = { double: 'Дубль', capture: 'За срубленную фишку', both: 'Дубль и рубка' };

function describe(ev: Event, name: (seat: number) => string): string {
  const lines: string[] = [];
  if (ev.type === 'roll') {
    const dbl = ev.dice[0] === ev.dice[1] ? ' — <b>дубль!</b>' : '';
    lines.push(`${name(ev.seat)} выбросил <b>${ev.dice[0]}:${ev.dice[1]}</b>${dbl}`);
    if (ev.noMoves) lines.push('<i>Ходов нет.</i>');
  } else {
    const who = name(ev.seat);
    let t: string;
    if (ev.kind === 'enter') t = `${who} выводит фишку на старт`;
    else if (ev.kind === 'jump') t = `${who} прыгает с угла по ${ev.value === 1 ? 'прямой' : 'диагонали'} (${ev.value})`;
    else if (ev.homeIn) t = `${who} заводит фишку в домик (${ev.value})`;
    else t = `${who} ходит на ${ev.value}`;
    if (ev.house) t += ' и занимает домик';
    if (ev.captured.length) t += ' и рубит ' + ev.captured.map((c) => name(c.seat)).join(', ') + '!';
    lines.push(t);
    if (ev.forfeit) lines.push('<i>Второй кубик сгорает — ходить нечем.</i>');
    if (ev.win) lines.push(`🏆 ${who} завёл все фишки в домик!`);
  }
  const te = ev.turnEnd;
  if (te && te.again && !(ev.type === 'move' && ev.win)) lines.push(`<i>${AGAIN[te.reason || ''] || 'Ещё бросок'} — ${name(te.next)} бросает ещё раз.</i>`);
  return lines.join('<br>');
}

// ---------- показ правил ----------

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Красный', level: 1 },
  { seat: 1, kind: 'bot', name: 'Зелёный', level: 1 },
];

/** Позиция для показа: фишки красного и зелёного, ход красного. */
function pos(red: number[], green: number[], cfg: Cfg = DEFAULT_CFG): State {
  return {
    cfg,
    players: [
      { seat: 0, pieces: red, house: red.map(() => false) },
      { seat: 1, pieces: green, house: green.map(() => false) },
    ],
    cur: 0,
    phase: 'roll',
    dice: [0, 0],
    used: [true, true],
    bonus: false,
    winner: null,
    turn: 1,
  };
}

/** Кубики для подкрутки: dice(6, 4) → значения rng.int(6). */
const dice = (a: number, b: number) => [a - 1, b - 1];

export const def: GameDef<State, Action, Event, State> = {
  id: 'shishbesh',
  title: 'Шиш-беш',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  seatsFor: (n) => ({ 2: [3, 1], 3: [3, 0, 1], 4: [3, 0, 1, 2] })[n] ?? [3, 0, 1, 2],

  options: [
    {
      key: 'arm',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 5, label: 'обычное: 5 клеток в плече' },
        { value: 6, label: 'длинное: 6 клеток в плече' },
      ],
      default: 5,
      hint: 'На длинном поле круг 56 клеток, а домик — 5 клеток.',
    },
    {
      key: 'houses',
      label: 'Домики-укрытия',
      type: 'select',
      choices: [
        { value: 'opposite', label: 'напротив друг друга' },
        { value: 'alternate', label: 'через один (лесенкой)' },
      ],
      default: 'opposite',
    },
    {
      key: 'start',
      label: 'Выход из парка',
      type: 'select',
      choices: [
        { value: 'six', label: 'на шестёрку' },
        { value: 'double', label: 'на дубль' },
        { value: 'both', label: 'на шестёрку или дубль' },
      ],
      default: 'six',
    },
  ],
  presets: [
    { id: 'classic', label: 'Классический', options: { arm: 5, houses: 'opposite', start: 'six' } },
    { id: 'long', label: 'Длинное поле', hint: 'Плечо креста на клетку длиннее', options: { arm: 6, houses: 'opposite', start: 'six' } },
    { id: 'alternate', label: 'Домики через один', hint: 'Укрытия на луче не напротив, а со сдвигом на клетку', options: { arm: 5, houses: 'alternate', start: 'six' } },
    { id: 'double', label: 'Старт на дубль', hint: 'Фишка выходит из парка только на дубль', options: { arm: 5, houses: 'opposite', start: 'double' } },
  ],

  setup: (seats, opts, rng) => newGame(seats.map((s) => s.seat), rng, cfgFrom(opts)),

  toAct: (s) => (s.phase === 'over' ? [] : [s.players[s.cur].seat]),

  apply(s, seat, a, rng: Rng) {
    if (s.phase === 'over' || s.players[s.cur].seat !== seat) return null;
    let res: { state: State; event: Event } | null = null;
    if (a.type === 'roll') res = applyRoll(s, [rng.int(6) + 1, rng.int(6) + 1]);
    else if (a.type === 'move') res = applyMove(s, a);
    return res && { state: res.state, events: [res.event] };
  },

  view: (s) => s,

  result: (s) =>
    s.winner == null ? null : { winners: [s.winner], text: 'первым завёл все четыре фишки в домик' },

  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose(s, _seat, level, rng) {
      if (s.phase === 'roll') return { type: 'roll' };
      const m = chooseMove(s, level, rng);
      return m && { type: 'move', piece: m.piece, die: m.die, to: m.to };
    },
  },

  describe,

  showcase: () => ({
    cfg: DEFAULT_CFG,
    players: [
      { seat: 0, pieces: [5, 14, -1, 50], house: [false, false, false, false] },
      { seat: 1, pieces: [22, 0, -1, -1], house: [false, false, false, false] },
      { seat: 2, pieces: [30, 3, 49, -1], house: [false, false, false, false] },
      { seat: 3, pieces: [9, 40, -1, -1], house: [false, false, false, false] },
    ],
    cur: 3,
    phase: 'move',
    dice: [6, 3],
    used: [false, false],
    bonus: false,
    winner: null,
    turn: 30,
  }),

  rules: {
    goal: 'Первым провести все четыре фишки по кругу креста и завести их в свой домик.',
    sections: [
      {
        title: 'Поле и фишки',
        html: `<p>Играют 2–4 человека, у каждого 4 фишки своего цвета. Поле — крест: по кругу 48 клеток, по 12 на каждую четверть.
          В конце своего луча у каждого игрока — <b>стартовое поле</b> с треугольником, а на средней дорожке луча — <b>домик</b> из 4 клеток («песочные часы»).</p>
          <p>Кидают два кубика, ходят по очереди против часовой стрелки.</p>`,
      },
      {
        title: 'Выход из парка',
        html: `<p>Фишки начинают в «парке» — круглой мандале в углу. Вывести фишку можно только <b>шестёркой</b>: она встаёт на стартовое поле.
          Второй кубик — ход этой или любой другой фишкой.</p>
          <p>Каждый кубик — отдельный ход, порядок выбираете сами. Если кубиком сходить можно — ходить обязательно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([-1, -1, -1, -1], [1, -1, -1, -1]),
          intro: 'Все красные фишки в парке.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 4), caption: 'Выпало 6 и 4. Шестёрка выводит фишку.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 0 }, caption: 'Фишка встаёт на стартовое поле.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 4 }, caption: 'Четвёркой она же идёт дальше по кругу.' },
          ],
        },
      },
      {
        title: 'Рубка и лишний бросок',
        html: `<p>Встав на клетку с чужой фишкой, вы её <b>рубите</b> — она возвращается в парк и снова ждёт шестёрку. <b>Срубивший бросает ещё раз.</b></p>
          <p><b>Дубль</b> — после хода тоже бросаете ещё раз. Две свои фишки на одной клетке стоять не могут.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([10, -1, -1, -1], [1, -1, -1, -1]),
          intro: 'Красная фишка в трёх клетках от зелёной.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(3, 2), caption: 'Выпало 3 и 2.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 13 }, caption: 'Тройкой — прямо на зелёную: рубка! Зелёная уходит в парк.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 15 }, caption: 'Двойкой — дальше. За рубку красный бросает ещё раз.' },
          ],
        },
      },
      {
        title: 'Углы креста: прыжки',
        html: `<p>Четыре тёмные клетки — <b>углы креста</b>. Стоя на углу, кубиком <b>«1»</b> можно прыгнуть по прямой стрелке на соседний угол (вперёд или назад), кубиком <b>«3»</b> — по диагонали на противоположный.
          Можно и просто шагнуть. После прыжка ход продолжают вторым кубиком.</p>
          <p>Прыжок назад к своему лучу — это <b>срез</b>: так фишка сразу оказывается у входа в домик.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([6, -1, -1, -1], [20, -1, -1, -1]),
          intro: 'Красная фишка стоит на углу креста.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(1, 3), caption: 'Выпало 1 и 3.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 42 }, caption: 'Единицей — прыжок на соседний угол, к своему лучу. Это срез почти через весь круг.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 45 }, caption: 'Тройкой — шаг вперёд. До домика рукой подать.' },
          ],
        },
      },
      {
        title: 'Домики-укрытия',
        html: `<p>На 3-м поле с края каждой дорожки нарисована избушка — <b>укрытие</b> на одну фишку. Встав туда, фишка прячется: из укрытия её не выбить.</p>
          <p>Если укрытие занято, пришедшая фишка встаёт на само поле, и там её можно срубить. А фишка в укрытии заперта, пока поле не освободится.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([1, 0, -1, -1], [-1, -1, -1, -1]),
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(2, 5), caption: 'Выпало 2 и 5.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 3 }, caption: 'Двойкой фишка встаёт на поле с избушкой и прячется в укрытие.' },
            { seat: 0, action: { type: 'move', piece: 1, die: 1, to: 5 }, caption: 'Пятёркой ходит фишка со старта.' },
          ],
        },
      },
      {
        title: 'Варианты поля и старта',
        html: `<p><b>Длинное поле</b> — плечо креста на клетку длиннее: 6 клеток вместо 5, круг 56 клеток, домик — 5 клеток.
          Со старта шестёрка уже не доводит до угла.</p>
          <p><b>Домики через один</b> — укрытия на луче стоят не друг напротив друга, а лесенкой: на одной дорожке на 3-м поле с края, на другой — на 4-м.</p>
          <p><b>Старт на дубль</b> — фишка выходит из парка только на дубль, любым его кубиком; вторым кубиком ходят как обычно, а за дубль — ещё бросок.
          Бывает и смешанное правило: выход на шестёрку <i>или</i> на дубль.</p>`,
        demo: {
          seats: demoSeats,
          options: { arm: 5, houses: 'opposite', start: 'double' },
          setup: () => pos([-1, -1, -1, -1], [20, -1, -1, -1], { arm: 5, houses: 'opposite', start: 'double' }),
          intro: 'Правило «старт на дубль». Все красные фишки в парке.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(3, 3), caption: 'Выпал дубль 3:3 — можно выводить фишку.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 0 }, caption: 'Одна тройка выводит фишку на старт.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 3 }, caption: 'Вторая тройка — вперёд, прямо в укрытие. За дубль красный бросает ещё раз.' },
          ],
        },
      },
      {
        title: 'Длинное поле',
        html: `<p>На длинном поле в каждой четверти круга 14 клеток: 6 к центру, угол, 6 от центра и торец.
          Прыжки с углов те же: «1» — на соседний угол, «3» — по диагонали.</p>`,
        demo: {
          seats: demoSeats,
          options: { arm: 6, houses: 'opposite', start: 'six' },
          setup: () => pos([0, -1, -1, -1], [30, -1, -1, -1], { arm: 6, houses: 'opposite', start: 'six' }),
          intro: 'Длинное поле. Красная фишка стоит на старте.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 1), caption: 'Выпало 6 и 1.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 6 }, caption: 'Шестёрка доводит только до последней клетки плеча.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 7 }, caption: 'Единицей — на угол. В следующий раз отсюда можно прыгать.' },
          ],
        },
      },
      {
        title: 'Домик и победа',
        html: `<p>Пройдя круг, фишка через торец своего луча заходит в <b>свой домик</b> — строго по выпавшим очкам. Перепрыгивать свои фишки в домике нельзя, внутри домика фишки можно двигать дальше.</p>
          <p>Побеждает тот, кто первым заведёт все 4 фишки в домик.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([50, 51, 52, 45], [-1, -1, -1, -1]),
          intro: 'Три красные фишки уже дома, четвёртая на подходе.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(4, 1), caption: 'Выпало 4 и 1.' },
            { seat: 0, action: { type: 'move', piece: 3, die: 0, to: 49 }, caption: 'Четвёркой — ровно на первую клетку домика. Победа!' },
          ],
        },
      },
    ],
  },
};
