/* «За рулём» — описание игры: 1–4 машинки на одном диске (люди, боты, по сети), гонка на N кругов или «на дальность».
 * Игра реального времени: комната крутит шаги, игроки шлют руль и передачу. Без DOM. */
import type { GameDef } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, MAX_CRASHES, newGame, snapshot, standings, step, TICK_MS, type Goal, type TrackId, type Why, type ZrEvent, type ZrIn, type ZrState } from './engine';

export const SEATS = [
  { name: 'Красная', color: '#d4281c', light: '#ef6a5c', dark: '#6e1210' },
  { name: 'Синяя', color: '#2456c8', light: '#6a92e8', dark: '#0e2a60' },
  { name: 'Жёлтая', color: '#e8b414', light: '#f8d66a', dark: '#7a5a00', ink: '#a07800' },
  { name: 'Зелёная', color: '#22963a', light: '#62c476', dark: '#0e4a1a' },
];

const CAR = ['красная', 'синяя', 'жёлтая', 'зелёная'];

export const WHY: Record<Why, string> = {
  pillar: 'врезался в опору эстакады',
  sign: 'снёс знак',
  fence: 'въехал в заборчик',
};

/** 83,4 → «1:23,4». */
export const clock = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1).replace('.', ',')}`;
};

export const def: GameDef<ZrState, never, ZrEvent, ZrState> = {
  id: 'zarulem',
  title: 'За рулём',
  players: { min: 1, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'goal',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'race', label: 'гонка на круги' },
        { value: 'distance', label: 'на дальность' },
      ],
      default: 'race',
    },
    {
      key: 'laps',
      label: 'Кругов',
      type: 'select',
      choices: [
        { value: 3, label: '3 круга' },
        { value: 5, label: '5 кругов' },
        { value: 10, label: '10 кругов' },
      ],
      default: 5,
      showIf: (o) => (o.goal ?? 'race') === 'race',
    },
    {
      key: 'minutes',
      label: 'Время',
      hint: 'без времени — пока не разобьётся (вдвоём и больше — 5 минут)',
      type: 'select',
      choices: [
        { value: 2, label: '2 минуты' },
        { value: 3, label: '3 минуты' },
        { value: 5, label: '5 минут' },
        { value: 0, label: 'без времени' },
      ],
      default: 3,
      showIf: (o) => o.goal === 'distance',
    },
    {
      key: 'track',
      label: 'Трасса',
      type: 'select',
      choices: [
        { value: 'wide', label: 'широкая' },
        { value: 'narrow', label: 'узкая, круче изгибы' },
      ],
      default: 'wide',
    },
  ],
  presets: [
    { id: 'race', label: 'Гонка на 5 кругов', hint: 'Кто первым проедет пять кругов', options: { goal: 'race', laps: 5, track: 'wide' } },
    { id: 'race-hard', label: 'Гонка по узкой трассе', hint: 'Дорога уже, изгибы круче', options: { goal: 'race', laps: 5, track: 'narrow' } },
    { id: 'distance', label: 'На дальность, 3 минуты', hint: 'Больше метров; три аварии — сход', options: { goal: 'distance', minutes: 3, track: 'wide' } },
    { id: 'classic', label: 'Как в игрушке', hint: 'Один, без времени: ехать, пока не разобьёшься', options: { goal: 'distance', minutes: 0, track: 'wide' } },
  ],
  setup(seats, opts) {
    const goal: Goal = opts.goal === 'distance' ? 'distance' : 'race';
    const tr: TrackId = opts.track === 'narrow' ? 'narrow' : 'wide';
    let minutes = Number(opts.minutes ?? 3);
    if (goal === 'distance' && minutes <= 0 && seats.length > 1) minutes = 5;
    const laps = Math.max(1, Number(opts.laps ?? 5));
    return newGame(
      seats.map((s) => s.seat).sort((a, b) => a - b),
      goal,
      tr,
      laps,
      minutes
    );
  },
  toAct: (s) => (s.over ? [] : s.cars.map((c) => c.seat)),
  apply: () => null,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const order = standings(s);
    const scores: Record<number, number> = {};
    if (s.goal === 'race') {
      for (const c of s.cars) scores[c.seat] = c.fin >= 0 ? s.laps : c.laps;
      const w = order[0];
      if (s.cars.length === 1)
        return w.fin >= 0
          ? { winners: [w.seat], text: `${s.laps} кругов за ${clock(w.fin)}, аварий: ${w.crashes}`, scores }
          : { winners: [], text: `Не доехал: ${w.laps} из ${s.laps} кругов`, scores };
      if (w.fin < 0) return { winners: [], text: 'Никто не доехал до финиша', scores };
      return { winners: [w.seat], text: `Первой пришла ${CAR[w.seat]} машина — ${s.laps} кругов за ${clock(w.fin)}`, scores };
    }
    for (const c of s.cars) scores[c.seat] = Math.floor(c.meters);
    const w = order[0];
    if (s.cars.length === 1) return { winners: [w.seat], text: `Проехали ${Math.floor(w.meters)} м`, scores };
    return { winners: [w.seat], text: `Дальше всех уехала ${CAR[w.seat]} машина — ${Math.floor(w.meters)} м`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 3,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs) => step(s, inputs as ZrIn[]),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'go') return '🚦 Марш!';
    if (ev.k === 'crash') return `💥 ${name(ev.seat)} — ${WHY[ev.why]}`;
    if (ev.k === 'out') return `🚫 ${name(ev.seat)} сходит: ${MAX_CRASHES} аварии`;
    if (ev.k === 'finish') return `🏁 ${name(ev.seat)} — финиш, ${ev.place}-е место, ${clock(ev.time)}`;
    if (ev.k === 'end') return '🏁 Заезд окончен.';
    return null;
  },
  rules: {
    goal: 'Удержать машинку на дороге, пока под ней крутится диск с трассой, и первым проехать нужное число кругов (или уехать дальше всех).',
    sections: [
      {
        title: 'Игрушка',
        html: `<p>«За рулём» — электромеханическая игрушка Томского приборного завода. На корпусе с рулём крутится диск с нарисованной
          трассой; над дорогой — эстакада на опорах, вдоль дороги — знаки и заборчики. Машинка стоит на магните: руль двигает её
          только поперёк — к центру диска и к краю, а дорога сама бежит под ней. Рычаг <b>Н–1–2–3</b> — скорость диска.</p>
          <p>Здесь на одном диске может ехать до четырёх машинок. У каждого диск повёрнут так, что его машинка стоит слева, как в игрушке,
          а остальные едут рядом — впереди или сзади.</p>`,
      },
      {
        title: 'Аварии',
        html: `<p>Задача — крутить руль и ничего не задеть: опора эстакады, знак, заборчик — авария. После аварии машинка стоит,
          мигает, и её ставят на дорогу чуть дальше. Съехать на траву не страшно, но там машинка вязнет и метры не идут.</p>
          <p>Машинки толкаются: догнал сзади — упёрся и потерял скорость; обгонять — по другой полосе.</p>`,
      },
      {
        title: 'Гонка и «на дальность»',
        html: `<p><b>Гонка:</b> кто первым проедет условленное число кругов. Высокая передача быстрее, но на крутых изгибах руль не успевает —
          перед поворотом лучше сбросить.</p>
          <p><b>На дальность:</b> одометр считает метры по дороге; кто за отведённое время уедет дальше. Три аварии — сход
          (его метры остаются). Один и без времени — как в игрушке: едешь, пока не разобьёшься.</p>`,
      },
      {
        title: 'Управление',
        html: `<p><kbd>←</kbd> <kbd>→</kbd> — руль, <kbd>↑</kbd> <kbd>↓</kbd> — передача. Мышью или пальцем — тянуть влево-вправо в любом месте
          поля; передачу — кнопками под полем или рычагом на корпусе. Вдвоём за одним экраном: второй игрок — <kbd>A</kbd> <kbd>D</kbd> руль,
          <kbd>W</kbd> <kbd>S</kbd> передача.</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame([0, 1, 2], 'race', 'wide', 5, 0);
    s.t = 41.3;
    const go = [
      { s: 0, g: 3 },
      { s: 0, g: 2 },
      { s: 0, g: 2 },
    ];
    // пусть разъедутся по трассе: сильный бот везёт всех
    const mem = [{}, {}, {}];
    const rng = { next: () => 0.5, int: () => 0, getState: () => 0 };
    for (let i = 0; i < 60 * 9; i++)
      step(
        s,
        s.cars.map((c, k) => ({ ...botInput(s, c.seat, 2, mem[k], rng), g: go[k].g }))
      );
    s.cars[0].laps = 2;
    return s;
  },
};
