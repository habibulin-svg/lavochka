/* Чиж — описание игры: от двух до шести игроков, каждый сам за себя; бьющий — по очереди (кто поймал или попал в кон).
 * Игра реального времени: комната крутит шаги, каждый ведёт своего пацана (бег, рывок), бьющий подбивает чижа
 * «рогаткой» и бьёт в момент, водящие ловят и бросают в кон (engine.ts). Без DOM. */
import { demoApply, rtStep } from '../../core/dvorsport/demo';
import { DS_SPEED_OPTION, dsSpeed } from '../../core/dvorsport/sim';
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { botInput } from './ai';
import {
  BATTER_SPOT,
  chFlight,
  cleanInput,
  idleInput,
  inKon,
  newGame,
  popBody,
  snapshot,
  step,
  throwBody,
  TICK_MS,
  total,
  VR,
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
// Случайности в движке нет: исходы показов подобраны здесь перебором по тому же движку (и проверены тестом).

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Петя', level: 0 },
  { seat: 1, kind: 'bot', name: 'Вова', level: 1 },
  { seat: 2, kind: 'bot', name: 'Серый', level: 1 },
];
const DSP = 1;
type O = Record<string, string | number | boolean>;
const CL: O = { kon: 'circle', score: 'merki', tries: 3, bonus: 2, burn: false, target: 200, speed: DSP };
const GO: O = { kon: 'square', score: 'hits', tries: 3, bonus: 0, burn: true, targetHits: 10, speed: DSP };
const still: In = { mx: 0, my: 0 };

/** Позиция показа: бьёт Петя, Вова и Серый в поле. */
function pos(opts: O, patch?: (s: State) => void) {
  return (): State => {
    const s = newGame(opts, [0, 1, 2]);
    s.demo = true;
    patch?.(s);
    return s;
  };
}

const T = (seat: number, inputs: Record<number, In>, caption: string, o: { ticks?: number; until?: string; tail?: number } = {}) => ({
  seat,
  action: rtStep({ ticks: o.ticks ?? 600, inputs, until: o.until, tail: o.tail }) as never,
  caption,
});

/** Сколько шагов от подбива до удара, чтобы попасть чижу «в пояс» на спуске (или рано — на взлёте). */
function swingTicks(opts: O, yaw: number, early = false): number {
  const base = newGame(opts, [0, 1, 2]);
  let best = early ? 3 : 30;
  let bq = -1;
  for (let k = 2; k < 80; k++) {
    const s = snapshot(base);
    const ins = (q: In | null): (In | null)[] => [q, null, null];
    step(s, ins({ ...still, th: { n: 1, pow: 0.9, yaw } }), null as never);
    for (let j = 1; j < k; j++) step(s, ins({ ...still }), null as never);
    const ev = step(s, ins({ ...still, s: 1 }), null as never);
    const h = ev.find((e) => e.k === 'hit') as { q: number } | undefined;
    if (early) {
      if (!h) return k;
      continue;
    }
    if (h && h.q >= bq) (bq = h.q), (best = k);
  }
  return best;
}

/** Куда упадёт чиж после такого подбива и удара (для показа ловли: Вова встанет туда, где чиж на высоте рук). */
function hitFlight(opts: O, yaw: number, k: number) {
  const s = newGame(opts, [0, 1, 2]);
  s.men[1].y = s.men[2].y = 59;
  step(s, [{ ...still, th: { n: 1, pow: 0.9, yaw } }, null, null], null as never);
  for (let j = 1; j < k; j++) step(s, [{ ...still }, null, null], null as never);
  step(s, [{ ...still, s: 1 }, null, null], null as never);
  return chFlight(s.ch.b0!);
}

/** Сила броска с места, при которой чиж ляжет в кон. */
function konPow(opts: O, x: number, y: number): number {
  const c = newGame(opts, [0, 1, 2]).cfg;
  const ok: number[] = [];
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const f = chFlight(throwBody(x, y, p, 0));
    if (inKon(c, f.rest[0], f.rest[1])) ok.push(p);
  }
  return ok.length ? ok[Math.floor(ok.length / 2)] : 0.5;
}

const dirTo = (a: [number, number], b: [number, number]): In => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { mx: (b[0] - a[0]) / d, my: (b[1] - a[1]) / d };
};
const run = (d: number) => Math.ceil((d / (VR * DSP)) * 60) + 4;

let demosCache: Record<string, DemoScript<State, never>> | null = null;
/** Показы считаются при первом открытии правил (перебор по движку — не на старте сервера). */
function demos(): Record<string, DemoScript<State, never>> {
  if (demosCache) return demosCache;
  const YAW = 0.18;
  const K = swingTicks(CL, YAW);
  const KE = swingTicks(CL, YAW, true);
  // ловля: Вова там, где чиж спускается на высоту груди
  const f = hitFlight(CL, YAW, K);
  const fr = f.frames.find((q, i) => i > 3 && q[3] < 1.3 && q[3] < f.frames[i - 1][3]) ?? f.frames[f.frames.length - 1];
  const CATCH_AT: [number, number] = [fr[1] + 0.15, fr[2] + 0.1];
  // бросок в кон с места падения
  const LIE: [number, number] = [-5.5, 15];
  const NEAR: [number, number] = [-4.2, 13.6];
  const P_KON = konPow(CL, LIE[0], LIE[1]);
  const P_GO = konPow(GO, LIE[0], LIE[1]);
  const field = (s: State) => {
    s.phase = 'field';
    s.phaseT = 0;
    s.ch = { mode: 'ground', x: LIE[0], y: LIE[1], a: 0.4 };
    [s.men[1].x, s.men[1].y] = NEAR;
    [s.men[2].x, s.men[2].y] = [6, 20];
    [s.men[0].x, s.men[0].y] = [-0.6, 0.3];
  };
  // отбить бросок: Петя вышел навстречу — когда чиж подлетит к нему
  const DEF_AT: [number, number] = [-0.35, 1.7];
  const defTicks = (() => {
    const s = newGame(CL, [0, 1, 2]);
    field(s);
    s.ch.mode = 'held';
    s.holder = 1;
    [s.men[1].x, s.men[1].y] = LIE;
    [s.men[0].x, s.men[0].y] = DEF_AT;
    step(s, [null, { ...still, th: { n: 1, pow: P_KON, yaw: 0 } }, null], null as never);
    const b = s.men[0];
    for (let k = 1; k < 300; k++) {
      step(s, [null, null, null], null as never);
      const ff = chFlight(s.ch.b0!);
      const q = ff.frames[Math.min(ff.frames.length - 1, Math.round((s.t - s.ch.t0!) * 60))];
      if (q && Math.hypot(q[1] - b.x, q[2] - b.y) < 0.7 && q[3] < 1.3 && q[3] > 0.3) return k;
    }
    return 60;
  })();
  const bonusAt: [number, number] = [-1.6, 6.5];
  const bonusK = (() => {
    // добивание: подбив с земли у чижа — тот же расчёт, но с места
    const base = newGame(CL, [0, 1, 2]);
    base.phase = 'bonus';
    base.strikes = 2;
    base.ch = { mode: 'ground', x: bonusAt[0], y: bonusAt[1], a: 0 };
    [base.men[0].x, base.men[0].y] = [bonusAt[0] - 0.3, bonusAt[1] - 0.45];
    let best = 30;
    let bq = -1;
    for (let k = 2; k < 80; k++) {
      const s = snapshot(base);
      step(s, [{ ...still, th: { n: 1, pow: 0.9, yaw: -0.25 } }, null, null], null as never);
      for (let j = 1; j < k; j++) step(s, [{ ...still }, null, null], null as never);
      const h = step(s, [{ ...still, s: 1 }, null, null], null as never).find((e) => e.k === 'hit') as { q: number } | undefined;
      if (h && h.q >= bq) (bq = h.q), (best = k);
    }
    return best;
  })();
  demosCache = {
    kon: {
      seats: demoSeats,
      setup: pos(CL),
      steps: [
        T(0, { 0: { ...still, th: { n: 1, pow: 0.9, yaw: YAW } } }, 'Петя бьёт ребром биты по заточенному концу чижа — чиж подлетает…', { ticks: K }),
        T(0, { 0: { ...still, s: 1 } }, '…и, пока он в воздухе, — удар вдаль, на уровне пояса!', { until: 'land', tail: 40 }),
      ],
    },
    miss: {
      seats: demoSeats,
      setup: pos(CL),
      steps: [
        T(0, { 0: { ...still, th: { n: 1, pow: 0.9, yaw: YAW } } }, 'Подбил…', { ticks: KE }),
        T(0, { 0: { ...still, s: 1 } }, '…но махнул рано: бита прошла под чижом. Это промах — у бьющего три попытки.', { until: 'miss', tail: 50 }),
      ],
    },
    catch: {
      seats: demoSeats,
      setup: pos(CL, (s) => {
        [s.men[1].x, s.men[1].y] = CATCH_AT;
        [s.men[2].x, s.men[2].y] = [-7, 9];
      }),
      steps: [
        T(0, { 0: { ...still, th: { n: 1, pow: 0.9, yaw: YAW } } }, 'Петя подбил и бьёт…', { ticks: K }),
        T(0, { 0: { ...still, s: 1 } }, '…а Вова стоял как раз там — поймал с лёта! Теперь бьёт Вова.', { until: 'batter', tail: 30 }),
      ],
    },
    throw: {
      seats: demoSeats,
      setup: pos(CL, field),
      steps: [
        T(1, { 1: dirTo(NEAR, LIE) }, 'Чиж упал. Кто из водящих первым добежал — подбирает его…', { until: 'pick', tail: 10, ticks: run(3) }),
        T(1, { 1: { ...still, th: { n: 1, pow: P_KON, yaw: 0 } } }, '…и с места падения бросает в кон. Попал — теперь бьёт Вова.', { until: 'batter', tail: 20 }),
      ],
    },
    def: {
      seats: demoSeats,
      setup: pos(CL, (s) => {
        field(s);
        s.ch.mode = 'held';
        s.holder = 1;
        [s.men[1].x, s.men[1].y] = LIE;
        [s.men[0].x, s.men[0].y] = DEF_AT;
      }),
      steps: [
        T(1, { 1: { ...still, th: { n: 1, pow: P_KON, yaw: 0 } } }, 'Вова бросает точно в кон…', { ticks: defTicks }),
        T(0, { 0: { ...still, s: 1 } }, '…но Петя отбивает чижа битой — тот улетает обратно. В кон не попал — Петя добивает.', { until: 'land', tail: 40 }),
      ],
    },
    bonus: {
      seats: demoSeats,
      setup: pos(CL, (s) => {
        s.phase = 'bonus';
        s.phaseT = 0;
        s.strikes = 2;
        s.ch = { mode: 'ground', x: bonusAt[0], y: bonusAt[1], a: 0.3 };
        [s.men[0].x, s.men[0].y] = [bonusAt[0] - 0.3, bonusAt[1] - 0.45];
        [s.men[1].x, s.men[1].y] = [3, 16];
        [s.men[2].x, s.men[2].y] = [-8, 24];
      }),
      steps: [
        T(0, { 0: { ...still, th: { n: 1, pow: 0.9, yaw: -0.25 } } }, 'Водящий в кон не попал: Петя добивает чижа с того места, где он лежит, — подбил…', { ticks: bonusK }),
        T(0, { 0: { ...still, s: 1 } }, '…и ударил ещё дальше от кона.', { until: 'land', tail: 30 }),
        T(0, { 0: { ...still, st: 1 } }, 'Хватит — меряем: сколько раз бита уложится от кона до чижа, столько и очков.', { until: 'score', tail: 120 }),
      ],
    },
    gorod: {
      seats: demoSeats,
      options: GO,
      setup: pos(GO, (s) => {
        field(s);
        s.men[0].run = 3;
        s.ch.mode = 'held';
        s.holder = 1;
        [s.men[1].x, s.men[1].y] = LIE;
      }),
      steps: [T(1, { 1: { ...still, th: { n: 1, pow: P_GO, yaw: 0 } } }, '«Город»: у Пети за этот выход три очка, но Вова попал чижом в город — очки сгорели, бьёт Вова.', { until: 'batter', tail: 30 })],
    },
  };
  return demosCache;
}

/** Показ — лениво (перебор по движку только когда правила открыли). */
const lazy = (k: string): DemoScript<State, never> => ({
  seats: demoSeats,
  get options() {
    return demos()[k].options;
  },
  setup: (...a: Parameters<NonNullable<DemoScript<State, never>['setup']>>) => demos()[k].setup!(...a),
  get steps() {
    return demos()[k].steps;
  },
});

export const DEMOS = { kon: lazy('kon'), miss: lazy('miss'), catch: lazy('catch'), throw: lazy('throw'), def: lazy('def'), bonus: lazy('bonus'), gorod: lazy('gorod') };

export const def: GameDef<State, never, Event, State> = {
  id: 'chizh',
  title: 'Чиж',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'kon',
      label: 'Кон',
      hint: 'Куда кладут чижа и куда водящие его бросают',
      type: 'select',
      choices: [
        { value: 'circle', label: 'круг Ø 1 м' },
        { value: 'square', label: 'квадрат-город 80 см' },
      ],
      default: 'circle',
    },
    {
      key: 'score',
      label: 'Счёт',
      type: 'select',
      choices: [
        { value: 'merki', label: 'мерками битой — от кона до чижа' },
        { value: 'hits', label: 'по удару — очко за чижа за чертой' },
      ],
      default: 'merki',
    },
    {
      key: 'target',
      label: 'Мерками: до скольких',
      type: 'select',
      choices: [
        { value: 100, label: '100' },
        { value: 200, label: '200' },
        { value: 300, label: '300' },
      ],
      default: 200,
    },
    {
      key: 'targetHits',
      label: 'По удару: до скольких',
      type: 'select',
      choices: [
        { value: 5, label: '5' },
        { value: 10, label: '10' },
        { value: 15, label: '15' },
      ],
      default: 10,
    },
    {
      key: 'tries',
      label: 'Попыток у кона',
      hint: 'Сколько промахов подряд — и бьёт следующий',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 2, label: '2' },
        { value: 1, label: '1' },
      ],
      default: 3,
    },
    {
      key: 'bonus',
      label: 'Добиваний',
      hint: 'Водящий не попал в кон — бьющий бьёт ещё с места, где лежит чиж',
      type: 'select',
      choices: [
        { value: 2, label: '2' },
        { value: 1, label: '1' },
        { value: 0, label: 'нет' },
      ],
      default: 2,
    },
    { key: 'burn', label: 'Попал в кон — очки сгорают', hint: 'Очки этого выхода (счёт по удару)', type: 'toggle', default: false },
    DS_SPEED_OPTION,
  ],
  presets: [
    { id: 'classic', label: 'Классика: кон и мерки', hint: 'круг, 3 попытки, 2 добивания, мерками до 200', options: { kon: 'circle', score: 'merki', target: 200, tries: 3, bonus: 2, burn: false } },
    { id: 'gorod', label: 'Квадрат-город', hint: 'квадрат, очко за удар за черту, в город попали — очки сгорают; до 10', options: { kon: 'square', score: 'hits', targetHits: 10, tries: 3, bonus: 0, burn: true } },
    { id: 'bystryi', label: 'Быстрый двор', hint: 'круг, 2 попытки, 1 добивание, мерками до 100', options: { kon: 'circle', score: 'merki', target: 100, tries: 2, bonus: 1, burn: false } },
  ],
  setup: (seats, opts) => newGame(opts, seats.map((s) => s.seat).sort((a, b) => a - b), dsSpeed(opts)),
  toAct: (s) => (s.over ? [] : s.seats.slice()),
  apply: (s, _seat, a, rng) => demoApply(s, a, rng, { step, view: snapshot }) as never,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    s.seats.forEach((seat, i) => (scores[seat] = total(s.men[i])));
    const w = s.men[s.seats.indexOf(s.winners[0])];
    return { winners: s.winners, text: s.cfg.score === 'merki' ? `${w ? total(w) : 0} мерок` : `${w ? total(w) : 0} очков`, scores };
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
    // номера игроков = места (setup сортирует места подряд с 0)
    const nm = (i: number) => `<b>${name(i)}</b>`;
    switch (ev.k) {
      case 'catch':
        return `🖐 ${nm(ev.who)} поймал чижа с лёта!`;
      case 'kon':
        return ev.burnt ? `🎯 ${nm(ev.who)} попал в город — ${ev.burnt} очк. сгорели.` : `🎯 ${nm(ev.who)} попал чижом в кон!`;
      case 'score':
        return `📏 ${nm(ev.who)}: ${ev.d.toFixed(1)} м — ${ev.pts} мерок.`;
      case 'out':
        return `🔁 Бьёт ${nm(ev.next)}.`;
      case 'miss':
        return ev.left > 0 ? `💨 ${nm(ev.who)}: промах (осталось ${ev.left}).` : null;
      case 'def':
        return `🏏 ${nm(ev.who)} отбил бросок!`;
      case 'end':
        return '🏁 Партия окончена.';
      default:
        return null;
    }
  },
  rules: {
    goal: 'Отбивать чижа битой как можно дальше и набрать условленное число мерок (или очков). Водящие ловят чижа с лёта и бросают его в кон: кто поймал или попал — тот и бьёт.',
    sections: [
      {
        title: 'Подбил — бей!',
        html: `<p>Чиж — палочка в ладонь длиной, оба конца заточены. Он лежит в меловом <b>коне</b> — круге метр в поперечнике.
          Бьющий бьёт ребром биты по заточенному концу — чиж <b>подлетает</b>, — и, пока он в воздухе, бьёт второй раз, <b>вдаль</b>.
          Лучше всего — когда чиж на уровне пояса: раньше — уйдёт влево и слабее, позже — вправо.</p>`,
        demo: DEMOS.kon,
      },
      {
        title: 'Промахи',
        html: `<p>Не попал по чижу или он упал ближе <b>черты</b> (3 м от кона) — это промах. У бьющего <b>три попытки</b>:
          промахнулся три раза подряд — бить переходит следующему по кругу.</p>`,
        demo: DEMOS.miss,
      },
      {
        title: 'Водящие ловят',
        html: `<p>Все остальные — водящие, каждый сам за себя. Отбитого чижа можно <b>поймать с лёта</b>: подбежать туда, куда он падает, и «Ловить!».
          Влетел прямо в руки — поймаешь и без кнопки. <b>Поймал — сам бьёшь</b>, а бьющий становится водящим.</p>`,
        demo: DEMOS.catch,
      },
      {
        title: 'Бросок в кон',
        html: `<p>Не поймали — кто первым добежал до упавшего чижа, подбирает его и <b>с места падения</b> бросает обратно в кон.
          Чиж лёг в кон — <b>бросивший бьёт</b>.</p>`,
        demo: DEMOS.throw,
      },
      {
        title: 'Отбить бросок',
        html: `<p>Бьющий стоит у кона с битой и может <b>отбить</b> летящего чижа — подальше от кона. Не успел махнуть — чиж может лечь прямо в кон.</p>`,
        demo: DEMOS.def,
      },
      {
        title: 'Добивания и мерки',
        html: `<p>Не попали в кон — бьющий <b>добивает</b>: подходит к чижу и бьёт с того места, где он лежит, так же — подбил и ударил (до двух раз, можно остановиться — «Считать»).
          Потом меряют: сколько раз <b>бита</b> (60 см) уложится от кона до чижа, столько очков-<b>мерок</b>. Поймали на добивании — очков за кон нет, бьёт поймавший.
          Кто первым наберёт условленное (200 мерок), тот выиграл.</p>`,
        demo: DEMOS.bonus,
      },
      {
        title: 'Квадрат-город и другие варианты',
        html: `<p><b>Квадрат-город</b>: кон — квадрат 80 см, черта в 4 м, добиваний нет; каждый чиж, отбитый за черту, — очко. Но если водящий попадёт чижом в город,
          все очки этого выхода <b>сгорают</b>. Играют до 10. <b>Быстрый двор</b>: две попытки, одно добивание, до 100 мерок.
          «Скорость игры» замедляет полёт чижа и бег — легче попасть по чижу и поймать его.</p>`,
        demo: DEMOS.gorod,
      },
      {
        title: 'Управление',
        html: `<p><b>Бег:</b> WASD или стрелки (на телефоне — стик), <b>рывок</b> — Shift.</p>
          <p><b>Бьющему:</b> нажмите на поле и потяните вниз, как рогатку: дальше — сильнее, вбок — куда бить; отпустите — чиж подлетит.
          Сразу жмите <b>«Бей!»</b> — пробел, кнопка или тап по полю, — когда чиж на уровне пояса. Летит бросок водящего — «Бей!» отбивает.
          На добивании подбегите к чижу и так же; «Считать» — хватит добивать.</p>
          <p><b>Водящему:</b> бегите туда, где кольцо падения, и <b>«Ловить!»</b> (пробел). Упал — добегите, подберёте сами, потом тяните «рогатку» — бросок в кон.</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame({}, [0, 1, 2, 3]);
    // бьющий подбил чижа — тот в воздухе у пояса
    s.phase = 'pop';
    s.t = 1;
    s.ch = { mode: 'pop', x: 0, y: 0, a: 0, b0: popBody(0, 0, 0.1), t0: 1 - 0.62 };
    s.men[0].score = 64;
    s.men[1].score = 38;
    [s.men[0].x, s.men[0].y] = BATTER_SPOT;
    [s.men[1].x, s.men[1].y] = [-2.5, 9];
    [s.men[2].x, s.men[2].y] = [3.5, 13];
    [s.men[3].x, s.men[3].y] = [-6, 17];
    s.shot = true;
    return s;
  },
};
