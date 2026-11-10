/* Пекарь — описание игры: от двух до шести игроков, каждый сам за себя; пекарь — по очереди. Игра реального времени:
 * комната крутит шаги, каждый ведёт своего пацана (бег, рывок), бросает палку «рогаткой», пекарь несёт банку и салит
 * (engine.ts). Без DOM. */
import { DS_SPEED_OPTION, dsSpeed } from '../../core/dvorsport/sim';
import { demoApply, rtStep } from '../../core/dvorsport/demo';
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { botInput } from './ai';
import {
  canHome,
  cleanInput,
  idleInput,
  newGame,
  pekarSpot,
  rankName,
  snapshot,
  step,
  stickFlight,
  throwFrom,
  TICK_MS,
  VP,
  VR,
  waitSpot,
  yawTo,
  type Event,
  type In,
  type State,
} from './engine';

export const SEATS = [
  { name: 'Красный', color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: 'Синий', color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
  { name: 'Зелёный', color: '#2f9a48', light: '#7ad88a', dark: '#104a1e' },
  { name: 'Жёлтый', color: '#e0a020', light: '#ffd86a', dark: '#6a4a08', ink: '#a87410' },
  { name: 'Фиолетовый', color: '#8a4ac8', light: '#c8a0f0', dark: '#3a1a60' },
  { name: 'Белый', color: '#e8e4da', light: '#ffffff', dark: '#6a665e', ink: '#6a665e' },
];

// ---------------------------------------------------------------- показ правил
// Шаг показа — кусок партии тем же движком (core/dvorsport/demo.ts): ввод мест держится весь шаг, остальные стоят.

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Петя', level: 0 },
  { seat: 1, kind: 'bot', name: 'Вова', level: 1 },
  { seat: 2, kind: 'bot', name: 'Серый', level: 1 },
];
const DSP = 1;
const CL = { ranks: 'full', dist: 14, demote: false, target: 5, speed: DSP };
const DV = { ranks: 'short', dist: 11, demote: true, target: 5, speed: DSP };

/** Позиция показа после жеребьёвки: пекарь — Серый (2), бросают Петя и Вова; все на местах. */
function pos(opts: Record<string, string | number | boolean>, patch?: (s: State) => void) {
  return (): State => {
    const s = newGame(opts, [0, 1, 2]);
    s.demo = true;
    s.phase = 'play';
    s.kicks = [12, 10, 7];
    s.order = [0, 1, 2];
    s.pekar = 2;
    s.sticks[2].at = 'pekar';
    [s.men[2].x, s.men[2].y] = pekarSpot(s.cfg);
    patch?.(s);
    return s;
  };
}

/** Направление бега от точки к точке (длина 1). */
const dir = (a: [number, number], b: [number, number]): In => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1;
  return { mx: dx / d, my: dy / d };
};
/** Шагов движка, чтобы пробежать d метров (с запасом). */
const run = (d: number, v = VR) => Math.ceil((d / (v * DSP)) * 60) + 4;

/** Сила броска с места, при которой палка сбивает банку (перебор по настоящему полёту). */
function hitPow(opts: Record<string, string | number | boolean>, x: number, y: number): number {
  const c = newGame(opts, [0, 1, 2]).cfg;
  const yaw = yawTo(c, x, y);
  const ok: number[] = [];
  for (let p = 0.4; p <= 0.95; p += 0.01) if (stickFlight(throwFrom(c, x, y, p, yaw, 'flat'), 'flat', canHome(c)).hit) ok.push(p);
  return ok.length ? ok[Math.floor(ok.length / 2)] : 0.66;
}

const C14 = newGame(CL, [0, 1, 2]).cfg;
const W0 = waitSpot(C14, 0, 0);
const PK = pekarSpot(C14);
const HOME = canHome(C14);
const HIT0 = hitPow(CL, W0[0], W0[1]);
const T = (seat: number, inputs: Record<number, In>, caption: string, o: { ticks?: number; until?: string; tail?: number; rig?: number[] } = {}) => ({
  seat,
  action: rtStep({ ticks: o.ticks ?? 600, inputs, until: o.until, tail: o.tail }) as never,
  caption,
  rig: o.rig,
});
const still: In = { mx: 0, my: 0 };

/** Сбитая банка лежит тут, палка Пети — недалеко от банки (показы бега и пекаря). */
const CAN_DOWN: [number, number] = [1.6, 16.2];
const STICK0: [number, number] = [-0.6, 12.6];
const knocked = (s: State) => {
  s.can = { mode: 'down', x: CAN_DOWN[0], y: CAN_DOWN[1], a: 0.6, fx: HOME[0], fy: HOME[1], t0: 0 };
  s.sticks[0] = { at: 'ground', x: STICK0[0], y: STICK0[1], a: 0.4 };
  s.men[0].rank = 1;
  s.men[0].knocks = 1;
};
const B1: [number, number] = [0.4, 11.6];

/** Ловля: Вова перекидывает, пекарь стоит на пути палки за банкой и ловит её, когда она рядом. */
const W1 = waitSpot(C14, 1, 0);
const LONG1 = { type: 'throw' as const, pow: 0.97, yaw: 0, style: 'flat' as const };
const CATCH_AT = (() => {
  const f = stickFlight(throwFrom(C14, W1[0], W1[1], LONG1.pow, yawTo(C14, W1[0], W1[1]) + LONG1.yaw, 'flat'), 'flat', HOME);
  const pt = f.frames.find((fr) => fr[2] >= C14.dist + 1.2 && fr[3] < 1.6) ?? f.frames[f.frames.length - 1];
  // нажать чуть раньше, чем палка поравняется с пекарем (окно ловли — пока она в 1,1 м)
  return { x: pt[1] + 0.5, y: pt[2], ticks: Math.max(1, Math.ceil((pt[0] - 0.2) * 60)) };
})();

const DEMOS: Record<string, DemoScript<State, never>> = {
  catch: {
    seats: demoSeats,
    setup: pos(CL, (s) => {
      s.last = 0;
      [s.men[2].x, s.men[2].y] = [CATCH_AT.x, CATCH_AT.y];
    }),
    steps: [
      T(1, { 1: { ...still, th: { n: 1, ...LONG1 } } }, 'Вова перекинул — палка летит мимо банки. Пекарь стоит за банкой на её пути…', { ticks: CATCH_AT.ticks }),
      T(2, { 2: { ...still, a: 1 } }, '…и ловит её своей палкой! Поймал — печёт хозяин палки, Вова.', { until: 'pekar', tail: 20, ticks: 300 }),
    ],
  },
  kick: {
    seats: demoSeats,
    setup: () => {
      const s = newGame(CL, [0, 1, 2]);
      s.demo = true;
      return s;
    },
    steps: [
      T(0, { 0: { ...still, k: { n: 1, pow: 0.75 } } }, 'Петя пинает палку с носка…', { until: 'land', tail: 20 }),
      T(1, { 1: { ...still, k: { n: 1, pow: 0.6 } } }, '…Вова — чуть ближе…', { until: 'land', tail: 20 }),
      T(2, { 2: { ...still, k: { n: 1, pow: 0.3 } } }, '…у Серого ближе всех: он и пекарь. Остальные бросают по дальности пинка.', { until: 'draw', tail: 150, ticks: 900 }),
    ],
  },
  throw: {
    seats: demoSeats,
    setup: pos(CL),
    steps: [
      T(0, { 0: { ...still, th: { n: 1, pow: 0.3, yaw: 0, style: 'flat' } } }, 'Слабо — палка легла, не долетев. Пока Петя её не подберёт, бросать ему нечем.', { until: 'land', tail: 30 }),
      T(1, { 1: { ...still, th: { n: 1, pow: 0.97, yaw: 0, style: 'flat' } } }, 'Вова перекинул — палка улетела за банку, к самому пекарю.', { until: 'land', tail: 30 }),
    ],
  },
  knock: {
    seats: demoSeats,
    setup: pos(CL),
    steps: [T(0, { 0: { ...still, th: { n: 1, pow: HIT0, yaw: 0, style: 'flat' } } }, 'Точно в банку! Петя теперь ефрейтор — и его черта ближе к банке.', { until: 'land', tail: 60 })],
  },
  run: {
    seats: demoSeats,
    setup: pos(CL, knocked),
    steps: [
      T(0, { 0: dir(W0, STICK0), 2: dir(PK, CAN_DOWN) }, 'Банка лежит — пекарю сперва за ней. Петя бежит за палкой…', { until: 'pick', tail: 6, ticks: run(Math.hypot(STICK0[0] - W0[0], STICK0[1] - W0[1])) }),
      T(0, { 0: dir(STICK0, [STICK0[0], -1]), 2: dir(CAN_DOWN, HOME) }, '…подобрал — и назад за свою черту: там не осалят. Пекарь несёт банку в кружок.', { ticks: run(STICK0[1] + 1.2) }),
    ],
  },
  tag: {
    seats: demoSeats,
    setup: pos(CL, (s) => {
      knocked(s);
      s.sticks[0].at = 'hand';
      // Вова зазевался у своей палки
      s.sticks[1] = { at: 'ground', x: B1[0] + 0.3, y: B1[1] + 0.9, a: 1 };
      [s.men[1].x, s.men[1].y] = B1;
    }),
    steps: [
      T(2, { 2: dir(PK, CAN_DOWN) }, 'Пекарь бежит к сбитой банке и подбирает её…', { until: 'can', tail: 6, ticks: run(Math.hypot(CAN_DOWN[0] - PK[0], CAN_DOWN[1] - PK[1]), VP) }),
      T(2, { 2: dir(CAN_DOWN, HOME) }, '…несёт в кружок и ставит. Пока банка не стояла, салить было нельзя.', { until: 'can', tail: 10 }),
      T(2, { 2: { ...dir(HOME, B1), a: 1 } }, 'Теперь можно: догнал Вову в поле — осалил! Теперь пекарь — Вова.', { until: 'pekar', tail: 20, ticks: 900 }),
    ],
  },
  ranks: {
    seats: demoSeats,
    options: DV,
    setup: pos(DV, (s) => {
      s.men[1].rank = 2;
      [s.men[1].x, s.men[1].y] = [0.6, 8];
      s.sticks[1] = { at: 'ground', x: 0.7, y: 8.6, a: 0.3 };
      [s.men[2].x, s.men[2].y] = [1.3, 9.2];
    }),
    steps: [T(2, { 2: { mx: -0.5, my: -0.8, a: 1 } }, '«Дворовый короткий»: лейтенант Вова попался пекарю — и печёт уже сержантом.', { until: 'pekar', tail: 30, ticks: 900 })],
  },
};

export const def: GameDef<State, never, Event, State> = {
  id: 'pekar',
  title: 'Пекарь',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'ranks',
      label: 'Звания',
      hint: 'Сбил банку — звание выше и черта ближе к банке',
      type: 'select',
      choices: [
        { value: 'full', label: 'от рядового до маршала (9)' },
        { value: 'short', label: 'короткие: рядовой — генерал (5)' },
        { value: 'none', label: 'без званий — на счёт' },
      ],
      default: 'full',
    },
    {
      key: 'dist',
      label: 'До банки',
      hint: 'От черты рядового до банки',
      type: 'select',
      choices: [
        { value: 14, label: '14 м' },
        { value: 11, label: '11 м' },
        { value: 9, label: '9 м — малышам' },
      ],
      default: 14,
    },
    {
      key: 'target',
      label: 'Без званий: до сбитых банок',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 7, label: '7' },
      ],
      default: 5,
    },
    { key: 'catch', label: 'Пекарь ловит палки', hint: 'Палку, летящую мимо банки, пекарь может поймать из-за банки — тогда печёт её хозяин', type: 'toggle', default: true },
    { key: 'demote', label: 'Пекарь теряет звание', hint: 'Кого осалили — тот пекарь и на ступень ниже', type: 'toggle', default: false },
    DS_SPEED_OPTION,
  ],
  presets: [
    { id: 'classic', label: 'Классика со званиями', hint: 'рядовой → маршал, 14 м до банки; сбил маршалом — победа', options: { ranks: 'full', dist: 14, demote: false, target: 5 } },
    { id: 'dvor', label: 'Дворовый короткий', hint: '5 званий, 11 м, осаленный теряет звание', options: { ranks: 'short', dist: 11, demote: true, target: 5 } },
    { id: 'schet', label: 'Без званий', hint: 'одна черта в 11 м, до пяти сбитых банок', options: { ranks: 'none', dist: 11, demote: false, target: 5 } },
  ],
  setup: (seats, opts) => newGame(opts, seats.map((s) => s.seat).sort((a, b) => a - b), dsSpeed(opts)),
  toAct: (s) => (s.over ? [] : s.seats.slice()),
  apply: (s, _seat, a, rng) => demoApply(s, a, rng, { step, view: snapshot }) as never,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    s.seats.forEach((seat, i) => (scores[seat] = s.cfg.ranks.length > 1 ? s.men[i].rank : s.men[i].knocks));
    const m = s.men[s.seats.indexOf(s.winners[0])];
    return {
      winners: s.winners,
      text: s.cfg.ranks.length > 1 ? (m && m.rank >= s.cfg.ranks.length ? 'сбил банку маршалом' : `выше всех званием — ${m ? rankName(s.cfg, m) : ''}`) : `сбил ${m?.knocks ?? 0} банок`,
      scores,
    };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 2,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as In[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    // в событиях — номера игроков; места идут подряд с 0 (setup сортирует), номер = место
    const nm = (i: number) => `<b>${name(i)}</b>`;
    switch (ev.k) {
      case 'kick':
        return ev.slip ? `🦶 ${nm(ev.who)}: палка сорвалась с ноги — ${ev.d.toFixed(1)} м.` : `🦶 ${nm(ev.who)} пнул палку на ${ev.d.toFixed(1)} м.`;
      case 'draw':
        return `🥫 Пекарь — ${nm(ev.pekar)}: ближе всех.`;
      case 'knock':
        return `💥 ${nm(ev.who)} сбил банку!`;
      case 'tag':
        return `✋ Пекарь осалил ${nm(ev.who)}!`;
      case 'pekar':
        return `🥫 Теперь пекарь — ${nm(ev.who)}.`;
      case 'skip':
        return `⏳ ${nm(ev.who)} не бросил — ход дальше.`;
      case 'end':
        return '🏁 Партия окончена.';
      default:
        return null;
    }
  },
  rules: {
    goal: 'Сбить палкой консервную банку столько раз, чтобы дойти от рядового до маршала и сбить её маршалом. Сторожит банку пекарь: кого он осалит в поле — тот и печёт.',
    sections: [
      {
        title: 'Жеребьёвка: кто пекарь',
        html: `<p>Перед игрой каждый ставит палку на носок и <b>пинком</b> выбрасывает её вперёд. У кого палка улетела <b>ближе всех</b> — тот первый пекарь.
          Остальные бросают по дальности пинка: дальше всех — первым. Пнёшь изо всех сил — палка может сорваться с ноги.</p>`,
        demo: DEMOS.kick,
      },
      {
        title: 'Банка и броски',
        html: `<p>В меловом кружке стоит <b>консервная банка</b>, рядом сторожит пекарь. Игроки по очереди кидают в неё палки из-за <b>своей черты</b>.
          Палка остаётся лежать там, где упала: пока её не подобрал, бросать нечем. Кидают <b>низом</b> — палка крутится плашмя и сметает широко, —
          или <b>навесом</b>, кувырком.</p>`,
        demo: DEMOS.throw,
      },
      {
        title: 'Звания',
        html: `<p>Сбил банку — получаешь <b>звание</b>: рядовой, ефрейтор, сержант, лейтенант, капитан, майор, полковник, генерал, маршал.
          Чем выше звание, тем <b>ближе к банке</b> твоя черта. Кто сбил банку маршалом — выиграл.</p>`,
        demo: DEMOS.knock,
      },
      {
        title: 'За палкой — и назад за черту',
        html: `<p>За своей палкой бегаешь сам, когда хочешь. Подобрал — беги обратно <b>за свою черту</b>: там тебя не осалить.
          Удобнее всего бежать, пока банка лежит: пекарь сначала должен сбегать за ней, подобрать и <b>поставить в кружок</b>, а до тех пор салить нельзя.
          Палка, упавшая у самой банки, — самая опасная.</p>`,
        demo: DEMOS.run,
      },
      {
        title: 'Пекарь салит',
        html: `<p>Когда банка стоит, пекарь гоняется за теми, кто в поле, и <b>салит палкой</b>: догнал и коснулся — или замахнулся рядом.
          Осаленный становится пекарем, а бывший пекарь берёт палку и встаёт за свою черту. Уворачивайтесь рывком.</p>
          <p>Если бросить уже некому — все палки в поле, — идти за ними придётся всё равно: пекарь осалит кого-то одного, остальные успеют.</p>`,
        demo: DEMOS.tag,
      },
      {
        title: 'Пекарь ловит палку',
        html: `<p>Палку, которая летит <b>мимо банки</b>, пекарь может поймать — остановить своей палкой. Ловить можно только <b>из-за банки</b>,
          не стоя между банкой и игроками. Поймал — печёт <b>хозяин палки</b>, а бывший пекарь встаёт за свою черту. Поэтому перекидывать банку опасно.</p>
          <p>Пекарем: когда палка летит мимо, на земле появится кольцо — встань туда и жми «Лови!» (пробел), когда палка рядом. Рано или поздно — не поймаешь.
          Вариант можно выключить в настройках.</p>`,
        demo: DEMOS.catch,
      },
      {
        title: 'Варианты',
        html: `<p><b>Дворовый короткий</b>: званий пять — рядовой, сержант, лейтенант, капитан, генерал, до банки 11 м, а кого осалили, тот не только печёт,
          но и теряет одно звание. <b>Без званий</b>: все бросают с одной черты, побеждает тот, кто первым собьёт пять банок.
          «Скорость игры» замедляет всё движение — успеваешь и прицелиться, и увернуться.</p>`,
        demo: DEMOS.ranks,
      },
      {
        title: 'Управление',
        html: `<p><b>Бег:</b> WASD или стрелки (на телефоне — стик слева внизу), <b>рывок</b> — Shift (кнопка «Рывок»). Палку подбираете, просто добежав до неё.</p>
          <p><b>Бросок</b> (когда ваш ход и вы за чертой): нажмите на поле и потяните вниз, как рогатку, — дальше тянете, сильнее; вбок — в сторону.
          Пунктир — полёт, кольцо — где ляжет палка. Рука чуть дрожит. Внизу — <b>низом</b> или <b>навесом</b>. На жеребьёвке так же — пинок.</p>
          <p><b>Пекарем:</b> добегите до банки — подберёте, донесите до кружка — поставите. Потом догоняйте и <b>«Салить!»</b> (пробел) рядом с бегущим.</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame({}, [0, 1, 2, 3]);
    s.phase = 'play';
    s.kicks = [12, 10, 9, 7];
    s.order = [0, 1, 2, 3];
    s.pekar = 3;
    s.sticks[3].at = 'pekar';
    s.men[3].x = 1.3;
    s.men[3].y = s.cfg.dist + 1.1;
    s.men[0].rank = 3;
    s.men[0].x = 0.2;
    s.men[0].y = 3 * s.cfg.step - 0.3;
    s.sticks[1] = { at: 'ground', x: 1.2, y: 9.5, a: 0.6 };
    s.men[1].x = 0.9;
    s.men[1].y = 7.5;
    s.shot = true;
    return s;
  },
};
