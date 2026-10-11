/* Настольный баскетбол — описание игры: двое (или с ботом), до N очков и/или на время. Игра реального времени:
 * комната крутит шаги физики, игроки шлют нажатия клавиш. Без DOM. */
import { gameSpeed, SPEED_OPTION } from '../../core/realtime';
import type { GameDef } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, newGame, snapshot, step, TICK_MS, type BbEvent, type BbIn, type BbState } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#c8241c', light: '#e8604f', dark: '#6e1210' },
  { name: 'Синие', color: '#2050b0', light: '#5a86d8', dark: '#0e2a60' },
];

const TEAM = ['красные', 'синие'];

export const def: GameDef<BbState, never, BbEvent, BbState> = {
  id: 'basketball',
  title: 'Настольный баскетбол',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'points',
      label: 'До скольких очков',
      type: 'select',
      choices: [
        { value: 11, label: 'до 11' },
        { value: 21, label: 'до 21' },
        { value: 31, label: 'до 31' },
        { value: 999, label: 'без счёта' },
      ],
      default: 21,
    },
    {
      key: 'minutes',
      label: 'Время',
      type: 'select',
      choices: [
        { value: 3, label: '3 минуты' },
        { value: 5, label: '5 минут' },
        { value: 10, label: '10 минут' },
        { value: 0, label: 'без времени' },
      ],
      default: 3,
    },
    SPEED_OPTION,
  ],
  presets: [
    { id: 'std', label: 'До 21 очка или 3 минуты', options: { points: 21, minutes: 3 } },
    { id: 'match', label: 'Матч на 5 минут', hint: 'Кто больше наберёт', options: { points: 999, minutes: 5 } },
    { id: 'quick', label: 'До 11 очков', hint: 'Без часов', options: { points: 11, minutes: 0 } },
  ],
  setup(_seats, opts, rng) {
    const points = Number(opts.points ?? 21);
    const minutes = Number(opts.minutes ?? 3);
    return newGame(points, points >= 999 && minutes <= 0 ? 10 : minutes, rng, gameSpeed(opts));
  },
  toAct: (s) => (s.over ? [] : [0, 1]),
  apply: () => null,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const [a, b] = s.score;
    if (a === b) return { winners: [], text: `Ничья ${a}:${b}`, scores: { 0: a, 1: b } };
    const w = a > b ? 0 : 1;
    return { winners: [w], text: `Победили ${TEAM[w]} — ${a}:${b}`, scores: { 0: a, 1: b } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 2,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as BbIn[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'score') return `🏀 Есть! Два очка — ${name(ev.team)} · <b>${ev.score[0]}:${ev.score[1]}</b>`;
    if (ev.k === 'end') return '🏁 Финальный свисток.';
    return null;
  },
  rules: {
    goal: 'Набрать больше очков, забрасывая мяч в кольцо на дальнем конце поля: до условленного счёта или за отведённое время.',
    sections: [
      {
        title: 'Поле и лунки',
        html: `<p>Поле — жёлтые ямки-пирамиды, на дне каждой лунка с катапультой. Брошенный мяч падает, катится по граням и ложится
          в одну из лунок. Сверху всё накрыто прозрачным колпаком: мяч бьётся о него и отскакивает, с поля не улетает.</p>
          <p>У каждой лунки два номера — красный и синий. У каждого игрока на своём торце — ряд клавиш <b>1 2 3 … 9 0</b>.</p>`,
      },
      {
        title: 'Кто бросает',
        html: `<p>Мяч лёг в лунку — смотри её номер своего цвета и жми эту клавишу. Кто нажал первым, того катапульта и бросает —
          в кольцо на дальнем конце. Попал — <b>2 очка</b>, мяч проваливается сквозь корзинку и снова катится в лунку.</p>
          <p>Нажал не ту клавишу — рука «залипает» на полсекунды: тыкать во всё подряд невыгодно.</p>
          <p>Клавиши на компьютере — нижний ряд: <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> … <kbd>/</kbd> (это 1…0 слева направо, подписаны на корпусе).
          Можно и мышью или пальцем — нажать на лунку с мячом или на клавишу на корпусе.
          Вдвоём за одной клавиатурой: красные — верхний ряд <kbd>Q</kbd>…<kbd>P</kbd>, синие — нижний.</p>`,
      },
      {
        title: 'Мяч застрял',
        html: `<p>Если мяч замер на гребне между ямками, стол сам слегка встряхивают — и мяч скатывается в лунку.</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame(21, 3, { next: () => 0.5, int: () => 0, getState: () => 0 });
    s.serve = 0;
    s.score = [8, 6];
    s.t = 71;
    s.ball = { x: 0.07, y: 0.128, z: 0.02, vx: 0.4, vy: 0, vz: 0 };
    s.flick[5] = 0.1;
    s.flickBy[5] = 0;
    return s;
  },
};
