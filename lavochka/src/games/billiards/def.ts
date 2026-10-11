/* Бильярд — описание игры: пул «восьмёрка», русский бильярд (американка, московская, невская, классическая пирамида до 71) и снукер;
 * столы трёх размеров по настоящим меркам; один или двое; боты; правила с показом (удары считаются настоящей физикой). Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, ballName, geoOf, makeView, POCKET_NAMES, setup, snookerMarks, tableOf, toAct, type Action, type Event, type State, type View } from './engine';
import type { Ball } from './physics';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
];

const VARIANT_NAME: Record<string, string> = {
  pool8: 'Пул «восьмёрка»',
  american: 'Американка',
  moscow: 'Московская',
  nevsky: 'Невская',
  classic: 'Классическая пирамида',
  snooker: 'Снукер',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'place':
      return `${name(ev.seat)} ставит биток с руки.`;
    case 'shot': {
      const call = ev.call ? ` <i>(заказ: ${ev.call.ball} → ${POCKET_NAMES[ev.call.pocket]})</i>` : '';
      return `${name(ev.seat)}: ${ev.foul ? `<b>фол</b> — ${ev.text.replace(/^фол: /, '')}` : ev.text}${call}`;
    }
    case 'end':
      return `🏁 ${ev.text}.`;
  }
  return null;
}

/** Позиция для показа правил: шары где сказано (координаты — доли стола). */
function pos(opts: Record<string, string>, balls: [number, number, number][], extra: Partial<State> = {}): State {
  const s = setup([0, 1], opts, { next: () => 0.5, int: () => 0, getState: () => 0 });
  const t = tableOf(s.cfg);
  s.balls = balls.map(([id, x, y]): Ball => ({ id, x: x * t.w, y: y * t.h, on: true }));
  s.phase = 'shot';
  s.breakShot = false;
  s.fromHand = false;
  return Object.assign(s, extra);
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Угол от шара a к шару b в позиции. */
function aim(s: State, a: number, b: number): number {
  const p = s.balls.find((x) => x.id === a)!;
  const q = s.balls.find((x) => x.id === b)!;
  return Math.atan2(q.y - p.y, q.x - p.x);
}
/** Угол от шара к середине створа лузы. */
function aimPocket(s: State, a: number, pocket: number): number {
  const p = s.balls.find((x) => x.id === a)!;
  const q = geoOf(s.cfg).pockets[pocket];
  return Math.atan2(q.y - p.y, q.x - p.x);
}

const POOL = { variant: 'pool8', size: 'small', pockets: 'real' };
const straightPos = () => pos(POOL, [
  [0, 0.25, 0.5],
  [3, 0.5, 0.5],
], { groups: ['solid', 'stripe', null, null] });
const pocketPos = () => {
  const s = pos(POOL, [
    [0, 0.42, 0.62],
    [3, 0.25, 0.35],
  ], { groups: ['solid', 'stripe', null, null] });
  // биток — на продолжении линии «тройка — левая верхняя луза»
  const b3 = s.balls[1];
  const a = aimPocket(s, 3, 0);
  s.balls[0].x = b3.x - Math.cos(a) * 0.45;
  s.balls[0].y = b3.y - Math.sin(a) * 0.45;
  return s;
};

export const def: GameDef<State, Action, Event, View> = {
  id: 'billiards',
  title: 'Бильярд',
  players: { min: 1, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'pool8', label: 'Пул «восьмёрка»' },
        { value: 'american', label: 'Американка (русский, любым шаром)' },
        { value: 'moscow', label: 'Московская (цветным битком)' },
        { value: 'nevsky', label: 'Невская (динамичная, с руки)' },
        { value: 'classic', label: 'Классическая пирамида (до 71, с заказом)' },
        { value: 'snooker', label: 'Снукер' },
      ],
      default: 'pool8',
    },
    {
      key: 'size',
      label: 'Стол',
      hint: 'Пул: 7, 8 или 9 футов; русский: 9, 10 или 12 футов; снукер: 10 или 12 футов. Чем больше стол, тем мельче на нём шары',
      type: 'select',
      choices: [
        { value: 'small', label: 'маленький' },
        { value: 'mid', label: 'средний' },
        { value: 'big', label: 'большой (турнирный)' },
      ],
      default: 'small',
    },
    {
      key: 'pockets',
      label: 'Лузы',
      hint: 'На русском столе настоящие лузы чуть шире шара — с мышкой это очень трудно',
      type: 'select',
      choices: [
        { value: 'real', label: 'настоящие' },
        { value: 'wide', label: 'пошире' },
      ],
      default: 'real',
    },
  ],
  presets: [
    { id: 'pool8', label: 'Восьмёрка', hint: 'Пул на 7-футовом столе: сплошные и полосатые, чёрная последней', options: { variant: 'pool8', size: 'small', pockets: 'real' } },
    { id: 'american', label: 'Американка', hint: 'Русский бильярд: любым шаром, до 8', options: { variant: 'american', size: 'mid', pockets: 'wide' } },
    { id: 'moscow', label: 'Московская', hint: 'Цветной биток, упал — с руки из дома', options: { variant: 'moscow', size: 'mid', pockets: 'wide' } },
    { id: 'nevsky', label: 'Невская', hint: 'Динамичная: упал биток — с руки откуда угодно', options: { variant: 'nevsky', size: 'mid', pockets: 'wide' } },
    { id: 'classic', label: 'Классика 71', hint: 'Номерные шары, заказ шара и лузы, до 71 очка', options: { variant: 'classic', size: 'mid', pockets: 'wide' } },
    { id: 'snooker', label: 'Снукер', hint: 'Красный — цветной, 147 максимум; стол 12 футов', options: { variant: 'snooker', size: 'big', pockets: 'real' } },
  ],
  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => makeView(s),
  result(s) {
    if (s.phase !== 'over' || !s.winners) return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.score[p];
    const v = s.cfg.variant;
    const best = Math.max(...s.seats.map((p) => s.score[p]));
    const txt = v === 'pool8' ? 'забил восьмёрку' : v === 'classic' || v === 'snooker' ? `набрал ${best} очков` : `забил ${best} шаров`;
    return { winners: s.winners, text: s.winners.length ? txt : 'партия проиграна', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(POOL, [
      [0, 0.3, 0.62],
      [1, 0.55, 0.4],
      [3, 0.7, 0.28],
      [5, 0.62, 0.7],
      [8, 0.8, 0.5],
      [10, 0.45, 0.22],
      [12, 0.86, 0.76],
      [14, 0.36, 0.84],
      [9, 0.83, 0.22],
    ], { groups: ['solid', 'stripe', null, null] }),

  rules: {
    goal: 'Забивать шары в лузы ударом кия по битку. В «восьмёрке» — убрать свои шары и последней забить чёрную восьмёрку; в русских играх — первым забить 8 шаров (в классике — набрать 71 очко); в снукере — набрать больше очков.',
    sections: [
      {
        title: 'Удар',
        html: `<p><b>Мышью:</b> ведите — кий целится от битка к указателю. Нажмите и тяните назад — кий оттягивается, сверху растёт шкала силы; отпустите — удар.
          Отпустили без оттяжки — удара нет. Точнее навести — стрелки ←/→ (с Shift — ещё тоньше).
          <b>Пальцем:</b> водите по столу — прицел; возьмитесь за кий или биток и тяните назад — сила, отпустите — удар.
          Линия-подсказка показывает, в какой шар придёт биток («шар-призрак») и куда покатятся оба.</p>`,
        demo: {
          seats: demoSeats,
          options: POOL,
          setup: pocketPos,
          intro: 'Тройка и биток — на одной линии с левой верхней лузой.',
          steps: [{ seat: 0, action: { type: 'shot', cue: 0, angle: aimPocket(pocketPos(), 3, 0), power: 0.36, spinX: 0, spinY: 0 }, caption: 'Прямой удар — тройка в лузе, бьёт ещё раз.' }],
        },
      },
      {
        title: 'Винт: накат, оттяжка, «стоп»',
        html: `<p>Шар в углу стола — точка удара по битку. По центру — биток скользит и после прямого удара <b>встаёт</b> («стоп»).
          Выше центра — <b>накат</b>: биток идёт вслед за прицельным. Ниже — <b>оттяжка</b>: биток возвращается назад.
          Вбок — <b>боковой винт</b>: меняет отскок битка от борта. Чем дальше от центра и чем сильнее удар, тем заметнее.</p>`,
        demo: {
          seats: demoSeats,
          options: POOL,
          setup: straightPos,
          intro: 'Прямой удар с оттяжкой — нижняя точка битка.',
          steps: [{ seat: 0, action: { type: 'shot', cue: 0, angle: aim(straightPos(), 0, 3), power: 0.45, spinX: 0, spinY: -1 }, caption: 'Тройка ушла к борту, биток откатился назад.' }],
        },
      },
      {
        title: 'Пул «восьмёрка»',
        html: `<p>Шары 1–7 сплошные, 9–15 полосатые, 8 — чёрная. Разбой — с руки из «дома» (за первой четвертью стола). Пока никто не забил шар после разбоя, стол открыт;
          забил — его группа твоя. Забил свой — бьёшь ещё. <b>Фол</b>: биток в лузе, мимо всех, первым задет чужой шар, после касания никто не коснулся борта —
          сопернику «шар в руку»: ставит биток куда угодно. Восьмёрку забивают последней, в заказанную лузу; раньше времени или с фолом — проигрыш.</p>`,
      },
      {
        title: 'Русский бильярд',
        html: `<p>Шары крупнее (68 мм), лузы почти впритык к шару, 15 белых шаров и цветной биток. Партия — до 8 забитых шаров, засчитываются и прицельный, и «свояк» (биток, упавший после касания).
          <b>Американка</b>: после разбоя бить можно любым шаром. <b>Московская</b>: бьют только цветным; упал — засчитан, следующий ставит его с руки в доме.
          <b>Невская</b>: упал биток — следующий бьёт с руки с любого места, но с руки засчитывается только прицельный, свояк с руки — фол.
          Фол (мимо всех) — удар не засчитан, сопернику шар со стола на полку.</p>`,
      },
      {
        title: 'Классическая пирамида',
        html: `<p>Шары с номерами: №1 стоит 11 очков, остальные — по номеру; кто забил последний шар — ещё +10. Перед каждым ударом — <b>заказ</b> шара и лузы
          (подсказка выбирает сама, лузу можно сменить нажатием). Заказанный шар упал в заказанную лузу — засчитываются все упавшие, иначе они выставляются обратно.
          Фол (мимо всех, биток в лузе) — минус 5 очков. Партия до 71 очка.</p>`,
      },
      {
        title: 'Снукер',
        html: `<p>Стол 12 футов, шары мелкие (52,5 мм), лузы скруглённые. 15 красных — по 1 очку; цветные: жёлтый 2, зелёный 3, коричневый 4, синий 5, розовый 6, чёрный 7.
          Пока на столе есть красные, бьют по очереди: красный, потом любой цветной (какой задет первым — тот и заказан); забитый цветной выставляется обратно на свою точку.
          Красные кончились — цветные по порядку, от жёлтого до чёрного, уже насовсем. Забил — бьёшь ещё (это «серия»).
          <b>Фол</b>: первым задет не тот шар, забит не тот, биток в лузе, мимо всех — сопернику штраф: 4 очка или стоимость шара, если она больше; биток в лузе — с руки в «D».
          Упрощения: нет «свободного шара» и правила «мисс»; партия кончается, когда всё забито или на столе один чёрный, а отставание больше 7.</p>`,
        demo: {
          seats: demoSeats,
          options: { variant: 'snooker', size: 'big', pockets: 'real' },
          setup: () => snookerDemo(),
          intro: 'Красный у лузы, синий на своей точке.',
          steps: [
            { seat: 0, action: { type: 'shot', cue: 0, angle: aimPocket(snookerDemo(), 1, 2), power: 0.33, spinX: 0, spinY: 0.4 }, caption: 'Красный в лузе: +1, теперь — цветной.' },
          ],
        },
      },
    ],
  },
};

function snookerDemo(): State {
  const opts = { variant: 'snooker', size: 'big', pockets: 'real' };
  const s = setup([0, 1], opts, { next: () => 0.5, int: () => 0, getState: () => 0 });
  const t = tableOf(s.cfg);
  const { spots } = snookerMarks(t);
  const red = { id: 1, x: t.w * 0.86, y: t.h * 0.22, on: true };
  const p = geoOf(s.cfg).pockets[2];
  const a = Math.atan2(p.y - red.y, p.x - red.x);
  const cue = { id: 0, x: red.x - Math.cos(a) * 0.6, y: red.y - Math.sin(a) * 0.6, on: true };
  s.balls = [cue, red, ...[16, 17, 18, 19, 20, 21].map((id) => ({ id, x: spots[id][0], y: spots[id][1], on: true }))];
  s.phase = 'shot';
  s.breakShot = false;
  s.fromHand = false;
  return s;
}

export { VARIANT_NAME, ballName };
