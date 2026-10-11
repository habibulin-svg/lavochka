/* Настольный хоккей — описание игры: двое (или с ботом), до N шайб и/или на время. Игра реального времени:
 * комната (сервер, хост P2P или этот браузер) крутит шаги физики, игроки шлют ввод штанг. Без DOM. */
import { gameSpeed, SPEED_OPTION } from '../../core/realtime';
import type { GameDef } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, newGame, snapshot, step, TICK_MS, type HkEvent, type HkIn, type HkState } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#c8241c', light: '#e8604f', dark: '#6e1210' },
  { name: 'Синие', color: '#2050b0', light: '#5a86d8', dark: '#0e2a60' },
];

const TEAM = ['красные', 'синие'];

export const def: GameDef<HkState, never, HkEvent, HkState> = {
  id: 'hockey',
  title: 'Настольный хоккей',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'goals',
      label: 'До скольких шайб',
      type: 'select',
      choices: [
        { value: 3, label: 'до 3' },
        { value: 5, label: 'до 5' },
        { value: 10, label: 'до 10' },
        { value: 99, label: 'без счёта' },
      ],
      default: 5,
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
    { id: 'std', label: 'До 5 шайб или 3 минуты', options: { goals: 5, minutes: 3 } },
    { id: 'match', label: 'Матч на 10 минут', hint: 'Кто больше забьёт', options: { goals: 99, minutes: 10 } },
    { id: 'quick', label: 'До 3 шайб', hint: 'Без часов', options: { goals: 3, minutes: 0 } },
  ],
  setup(_seats, opts, rng) {
    const goals = Number(opts.goals ?? 5);
    const minutes = Number(opts.minutes ?? 3);
    // без часов и без счёта партия не кончится — тогда хотя бы десять минут
    return newGame(goals, goals >= 99 && minutes <= 0 ? 10 : minutes, rng, gameSpeed(opts));
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
    tick: (s, inputs, rng) => step(s, inputs as HkIn[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'goal') return `🏒 Гол! Забили ${name(ev.team)} — <b>${ev.score[0]}:${ev.score[1]}</b>`;
    if (ev.k === 'knock' && ev.seat >= 0) return `${name(ev.seat)} стучит по борту — шайба сдвинулась.`;
    if (ev.k === 'end') return '🏁 Финальная сирена.';
    return null;
  },
  rules: {
    goal: 'Забить в чужие ворота больше шайб: до условленного счёта или за отведённое время.',
    sections: [
      {
        title: 'Фигурки и штанги',
        html: `<p>У каждой команды шесть плоских жестяных хоккеистов на прорезях: вратарь перед воротами, два защитника в своей
          половине и три нападающих — в чужой. Под полем у каждого своя штанга. Тянешь штангу — хоккеист едет по прорези вперёд-назад,
          крутишь её — хоккеист вертится вокруг оси вместе с клюшкой.</p>
          <p>Отдельного «удара» нет: клюшка — часть фигурки. Крутанул штангу, клюшка встретила шайбу — вот и бросок. Чем резче
          крутанёшь, тем сильнее; куда полетит шайба — зависит от того, каким местом крюка её зацепило.</p>`,
      },
      {
        title: 'Кем управляешь',
        html: `<p>Вратарь всегда под рукой — своими клавишами: <kbd>A</kbd> <kbd>D</kbd> — вдоль ворот, <kbd>W</kbd> <kbd>S</kbd> — крутить.</p>
          <p>Полевой — тот из пятерых, что ближе всех дотянется до шайбы (он подсвечен). Стрелки: вдоль прорези — ехать, поперёк — крутить.
          Можно мышью: ведёшь вдоль прорези — едет, поперёк — крутится (или колёсиком — смотря что выбрано в настройках вида).
          Щелчок по своему хоккеисту — взять его вручную; <kbd>Q</kbd> <kbd>E</kbd> — соседний.</p>
          <p>На телефоне вратарь стоит сам, а полевого водят пальцем: вдоль прорези — ехать, поперёк — крутить.</p>`,
      },
      {
        title: 'Гол, вбрасывание, стук по борту',
        html: `<p>Шайба целиком зашла в «домик» ворот — гол. После гола шайбу бросают на центр.</p>
          <p>Бывает, шайба замирает там, куда не дотянется ни одна клюшка, — как в жизни, по борту стучат, и она сдвигается.
          Стол стучит сам, а можно и самому: <kbd>Пробел</kbd> или кнопка «Стук» (не чаще раза в полторы секунды).</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame(5, 3, { next: () => 0.5, int: () => 0, getState: () => 0 });
    s.faceoff = 0;
    s.score = [2, 1];
    s.t = 74;
    s.puck = { x: 0.47, y: 0.155, vx: 0, vy: 0 };
    s.figs[4].s = 0.35;
    s.figs[4].a = 0.9;
    s.figs[7].s = 0.55;
    s.figs[7].a = -2.2;
    s.figs[10].s = 0.4;
    s.figs[0].a = 1.2;
    return s;
  },
};
