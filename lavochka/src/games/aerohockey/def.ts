/* Аэрохоккей — описание игры: двое (или с ботом), до N шайб и/или на время. Игра реального времени:
 * комната (сервер, хост P2P или этот браузер) крутит шаги физики, игроки шлют, куда тянется рука. Без DOM. */
import { gameSpeed, SPEED_OPTION } from '../../core/realtime';
import type { GameDef } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, L, newGame, snapshot, step, TICK_MS, type AhEvent, type AhIn, type AhState } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#e8322a', light: '#ff7a64', dark: '#7a1210' },
  { name: 'Синие', color: '#2a6ae8', light: '#7aa8ff', dark: '#0e2a70' },
];

const TEAM = ['красные', 'синие'];

/** Столы — у каждого своё оформление; на физику не влияет. */
export const TABLES = [
  { value: 'katok', label: 'Дворовый каток' },
  { value: 'disco', label: 'Дискотека' },
  { value: 'lager', label: 'Пионерлагерь' },
  { value: 'kosmos', label: 'Космос' },
];

export const def: GameDef<AhState, never, AhEvent, AhState> = {
  id: 'aerohockey',
  title: 'Аэрохоккей',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'goals',
      label: 'До скольких шайб',
      type: 'select',
      choices: [
        { value: 5, label: 'до 5' },
        { value: 7, label: 'до 7' },
        { value: 10, label: 'до 10' },
        { value: 99, label: 'без счёта' },
      ],
      default: 7,
    },
    {
      key: 'minutes',
      label: 'Время',
      type: 'select',
      choices: [
        { value: 0, label: 'без времени' },
        { value: 3, label: '3 минуты' },
        { value: 5, label: '5 минут' },
        { value: 10, label: '10 минут' },
      ],
      default: 0,
    },
    {
      key: 'table',
      label: 'Стол',
      type: 'select',
      choices: TABLES,
      default: 'katok',
    },
    { ...SPEED_OPTION, default: 0.7 },
  ],
  presets: [
    { id: 'std', label: 'До 7 шайб', hint: 'Как на турнирах: кто первым забьёт семь', options: { goals: 7, minutes: 0 } },
    { id: 'quick', label: 'До 5 шайб', hint: 'Быстрая партия', options: { goals: 5, minutes: 0 } },
    { id: 'time', label: 'На время, 3 минуты', hint: 'Кто больше забьёт; ничья бывает', options: { goals: 99, minutes: 3 } },
  ],
  setup(_seats, opts, rng) {
    const goals = Number(opts.goals ?? 7);
    const minutes = Number(opts.minutes ?? 0);
    const s = newGame(goals, goals >= 99 && minutes <= 0 ? 5 : minutes, rng, gameSpeed({ speed: opts.speed ?? 0.7 }));
    s.table = String(opts.table ?? 'katok');
    return s;
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
    tick: (s, inputs, rng) => step(s, inputs as AhIn[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'goal') return `🥅 ${ev.own ? 'Автогол — шайба в свои ворота' : 'Гол!'} Очко — ${name(ev.seat)}: <b>${ev.score[0]}:${ev.score[1]}</b>`;
    if (ev.k === 'end') return '🏁 Партия окончена.';
    return null;
  },
  rules: {
    goal: 'Загнать шайбу в щель чужих ворот раньше соперника: кто первым забьёт условленное число шайб (обычно семь) — тот и выиграл.',
    sections: [
      {
        title: 'Стол и шайба',
        html: `<p>Стол гладкий, весь в мелких дырочках: снизу дует вентилятор, и шайба скользит на воздушной подушке почти без трения —
          пущенная сильно, она летает от борта к борту, пока кто-нибудь её не остановит. Борта упругие: от них шайба отскакивает,
          как бильярдный шар. В торцах — узкие щели ворот.</p>`,
      },
      {
        title: 'Бита',
        html: `<p>У каждого бита — «грибок» с ручкой. Двигай мышь (или палец) — бита едет следом. Удар — это сама бита на ходу:
          чем быстрее ведёшь её в шайбу, тем сильнее летит шайба, а куда — зависит от того, каким боком биты попал.</p>
          <p>За центральную линию бита не заходит: каждый играет на своей половине. Шайба на середине — достаёт любой.</p>`,
      },
      {
        title: 'Гол и подача',
        html: `<p>Шайба целиком провалилась в щель — гол. После гола шайбу кладут на половину <b>пропустившего</b> — он подаёт.</p>
          <p>Шайба забилась в угол или замерла посередине, где её не достать, — стол сам поддувает её на чью-нибудь половину.</p>`,
      },
      {
        title: 'Как бить',
        html: `<p><b>Прямой</b> — сквозь шайбу в ворота. <b>От борта</b> — в боковой борт, чтобы шайба отскочила в ворота под углом:
          соперник ждёт её не оттуда. В защите держи биту между шайбой и своими воротами, не выскакивай вперёд без нужды —
          шайба, отбитая в борт, вернётся быстрее, чем кажется.</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame(7, 0, { next: () => 0.2, int: () => 0, getState: () => 0 });
    s.table = 'disco';
    s.score = [4, 3];
    s.t = 95;
    s.puck = { x: 0.18, y: L * 0.56, vx: 2.4, vy: 3.2 };
    s.mal[0] = { x: 0.05, y: 0.62, vx: 0, vy: 0 };
    s.mal[1] = { x: -0.12, y: L - 0.3, vx: 0, vy: 0 };
    return s;
  },
};
