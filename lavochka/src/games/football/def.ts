/* Настольный футбол «Kopana» — описание игры: двое (или с ботом), до N голов и/или на время. Игра реального времени:
 * комната крутит шаги физики, игроки шлют, какую фигурку оттягивают и куда, и где их вратарь. Без DOM. */
import { gameSpeed, SPEED_OPTION } from '../../core/realtime';
import type { GameDef } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, newGame, snapshot, step, TICK_MS, type FbEvent, type FbIn, type FbState } from './engine';

export const SEATS = [
  { name: 'Рыжие', color: '#d0622a', light: '#e88a5a', dark: '#7a3210' },
  { name: 'Белые', color: '#8a8a80', light: '#f2f0e6', dark: '#4a4a44' },
];

const TEAM = ['рыжие', 'белые'];

export const def: GameDef<FbState, never, FbEvent, FbState> = {
  id: 'football',
  title: 'Настольный футбол',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'goals',
      label: 'До скольких голов',
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
      default: 5,
    },
    SPEED_OPTION,
  ],
  presets: [
    { id: 'std', label: 'До 5 голов или 5 минут', options: { goals: 5, minutes: 5 } },
    { id: 'match', label: 'Матч на 10 минут', hint: 'Кто больше забьёт', options: { goals: 99, minutes: 10 } },
    { id: 'quick', label: 'До 3 голов', hint: 'Без часов', options: { goals: 3, minutes: 0 } },
  ],
  setup(_seats, opts, rng) {
    const goals = Number(opts.goals ?? 5);
    const minutes = Number(opts.minutes ?? 5);
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
    tick: (s, inputs, rng) => step(s, inputs as FbIn[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'goal') return `⚽ Гол! ${ev.own ? 'Автогол — засчитан' : 'Забили'} ${name(ev.team)} — <b>${ev.score[0]}:${ev.score[1]}</b>`;
    if (ev.k === 'knock' && ev.seat >= 0) return `${name(ev.seat)} стучит по подносу — мяч сдвинулся.`;
    if (ev.k === 'end') return '🏁 Финальный свисток.';
    return null;
  },
  rules: {
    goal: 'Забить в чужие ворота больше голов: до условленного счёта или за отведённое время.',
    sections: [
      {
        title: 'Фигурки на пружинах',
        html: `<p>На жестяном поле стоят по десять рыжих и белых футболистов. Каждый — на пружине, внизу у него шарик-подставка.
          Оттянул фигурку пальцем и отпустил — она качнулась, и подставка ударила по мячу. Чем сильнее оттянул, тем сильнее удар.</p>
          <p>Мяч летит по линии «середина подставки — мяч»: какой стороной он лежит у ног, туда и полетит. Можно махнуть
          вскользь, под углом, — мяч уйдёт вбок.</p>
          <p>У ног каждой фигурки поле чуть прогнуто: медленный мяч сам скатывается к ближнему футболисту. Бьют обе команды
          одновременно — кто раньше щёлкнул своего у мяча, тот и пнул.</p>`,
      },
      {
        title: 'Как управлять',
        html: `<p><b>Мышью или пальцем</b>: возьми своего футболиста, оттяни в сторону и отпусти.</p>
          <p><b>Клавишами</b>: подсвечен твой футболист, ближний к мячу; <kbd>Q</kbd> <kbd>E</kbd> — соседний.
          Держи <kbd>Пробел</kbd> — фигурка оттягивается от мяча (дольше держишь — сильнее), отпусти — удар.
          Стрелки <kbd>←</kbd> <kbd>→</kbd> во время оттяжки — махнуть вскользь, левее или правее.</p>
          <p><b>Вратарь</b> — на рычаге, ездит поперёк ворот: <kbd>A</kbd> <kbd>D</kbd> или мышью за самого вратаря; пока не тронул — стоит сам.</p>
          <p>Вдвоём за одной клавиатурой: рыжие — <kbd>W</kbd> (удар), <kbd>A</kbd> <kbd>D</kbd> (вскользь), <kbd>Q</kbd> <kbd>E</kbd> (выбор);
          белые — <kbd>↑</kbd>, <kbd>←</kbd> <kbd>→</kbd>, <kbd>,</kbd> <kbd>.</kbd>; вратари стоят сами.</p>`,
      },
      {
        title: 'Гол и стук по подносу',
        html: `<p>Мяч целиком зашёл в ворота — гол, мяч кладут на центр. Если мяч замер там, где никто не достаёт, по подносу стучат,
          и он сдвигается: стол стучит сам, а можно и самому — кнопка «Стук» (не чаще раза в полторы секунды).</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame(5, 5, { next: () => 0.5, int: () => 0, getState: () => 0 });
    s.faceoff = 0;
    s.score = [2, 1];
    s.t = 131;
    s.ball = { x: 0.06, z: 0.06, vx: 0, vz: 0 };
    s.figs[7].ox = -0.012;
    s.figs[7].oz = -0.006;
    s.figs[7].held = true;
    s.keep = [0.01, -0.012];
    return s;
  },
};
