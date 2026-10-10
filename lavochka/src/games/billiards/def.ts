/* Бильярд — описание игры: пул «восьмёрка» и русский бильярд (американка, московская, невская, классическая пирамида до 71);
 * один или двое; боты; правила с показом (удары считаются настоящей физикой). Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, makeView, POCKET_NAMES, setup, tableOf, toAct, type Action, type Event, type State, type View } from './engine';
import type { Ball } from './physics';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
];

const VARIANT_NAME: Record<string, string> = { pool8: 'Пул «восьмёрка»', american: 'Американка', moscow: 'Московская', nevsky: 'Невская', classic: 'Классическая пирамида' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'place':
      return `${name(ev.seat)} ставит биток с руки.`;
    case 'shot': {
      const call = ev.call ? ` <i>(заказ: ${ev.call.ball} → ${POCKET_NAMES[ev.call.pocket]})</i>` : '';
      return `${name(ev.seat)}: ${ev.foul ? `<b>фол</b> — ${ev.foul}` : ev.text}${call}`;
    }
    case 'end':
      return `🏁 ${ev.text}.`;
  }
  return null;
}

/** Позиция для показа правил: биток и шары где сказано. */
function pos(opts: Record<string, string>, balls: [number, number, number][], extra: Partial<State> = {}): State {
  const s = setup([0, 1], opts, { next: () => 0.5, int: () => 0, getState: () => 0 });
  s.balls = balls.map(([id, x, y]): Ball => ({ id, x, y, on: true }));
  s.phase = 'shot';
  s.breakShot = false;
  s.fromHand = false;
  return Object.assign(s, extra);
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const diag = (from: [number, number], to: [number, number]) => Math.atan2(to[1] - from[1], to[0] - from[0]);

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
      ],
      default: 'pool8',
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
      default: 'wide',
    },
  ],
  presets: [
    { id: 'pool8', label: 'Восьмёрка', hint: 'Пул: сплошные и полосатые, чёрная последней', options: { variant: 'pool8', pockets: 'real' } },
    { id: 'american', label: 'Американка', hint: 'Русский бильярд: любым шаром, до 8', options: { variant: 'american', pockets: 'wide' } },
    { id: 'moscow', label: 'Московская', hint: 'Цветной биток, упал — с руки из дома', options: { variant: 'moscow', pockets: 'wide' } },
    { id: 'nevsky', label: 'Невская', hint: 'Динамичная: упал биток — с руки откуда угодно', options: { variant: 'nevsky', pockets: 'wide' } },
    { id: 'classic', label: 'Классика 71', hint: 'Номерные шары, заказ шара и лузы, до 71 очка', options: { variant: 'classic', pockets: 'wide' } },
  ],
  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => makeView(s),
  result(s) {
    if (s.phase !== 'over' || !s.winners) return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.score[p];
    const v = s.cfg.variant;
    const txt = v === 'pool8' ? 'забил восьмёрку' : v === 'classic' ? `набрал ${Math.max(...s.seats.map((p) => s.score[p]))} очков` : `забил ${Math.max(...s.seats.map((p) => s.score[p]))} шаров`;
    return { winners: s.winners, text: s.winners.length ? txt : 'партия проиграна', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const t = tableOf(cfgFrom({ variant: 'pool8' }));
    return pos({ variant: 'pool8' }, [
      [0, t.w * 0.3, t.h * 0.62],
      [1, t.w * 0.55, t.h * 0.4],
      [3, t.w * 0.7, t.h * 0.3],
      [5, t.w * 0.62, t.h * 0.7],
      [8, t.w * 0.8, t.h * 0.5],
      [10, t.w * 0.45, t.h * 0.22],
      [12, t.w * 0.85, t.h * 0.75],
      [14, t.w * 0.35, t.h * 0.85],
    ], { groups: ['solid', 'stripe', null, null] });
  },

  rules: {
    goal: 'Забивать шары в лузы ударом кия по битку. В «восьмёрке» — убрать свои шары и последней забить чёрную восьмёрку; в русских играх — первым забить 8 шаров (в классике — набрать 71 очко).',
    sections: [
      {
        title: 'Удар',
        html: `<p>Ведите мышью (пальцем) — кий целится от битка к указателю. Нажмите и тяните назад — сила удара, отпустите — удар.
          Сила и винт есть и в панели: винт — точка на битке (выше — накат, ниже — оттяжка, вбок — боковой). Линия-подсказка показывает,
          в какой шар придёт биток и куда тот покатится.</p>`,
        demo: {
          seats: demoSeats,
          options: { variant: 'pool8' },
          setup: () => pos({ variant: 'pool8' }, [
            [0, 0.9, 0.9],
            [3, 0.4, 0.4],
          ], { groups: ['solid', 'stripe', null, null] }),
          intro: 'Шар 3 и биток — на одной линии с угловой лузой.',
          steps: [{ seat: 0, action: { type: 'shot', cue: 0, angle: diag([0.9, 0.9], [0.4, 0.4]), power: 0.45, spinX: 0, spinY: 0 }, caption: 'Прямой удар — тройка в лузе, бьёт ещё раз.' }],
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
        html: `<p>Стол больше, лузы чуть шире шара, 15 белых шаров и цветной биток. Партия — до 8 забитых шаров, засчитываются и прицельный, и «свояк» (биток, упавший после касания).
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
    ],
  },
};

export { VARIANT_NAME };
