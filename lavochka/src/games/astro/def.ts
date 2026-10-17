/* «Астронавты» — игра-путешествие по карте звёздного неба (автор-художник Ю. В. Раевский). Два варианта из правил:
 * карточки планет и созвездий на красных точках и «ориентирование по звёздам» с маршрутом в красных кружках. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { SEATS as HSEATS } from '../hodilki/core';
import { cardOf } from './data';
import { apply, describe, newState, rightAnswer, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = HSEATS.slice(0, 6);

/** Как часто бот помнит небо: название и звёзды по уровням. */
const KNOWS = [
  [0.45, 0.3],
  [0.7, 0.55],
  [0.92, 0.85],
];

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.winner != null || s.turn !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const q = s.quiz;
  if (!q || q.seat !== seat) return null;
  const right = rightAnswer(q);
  const p = KNOWS[Math.max(0, Math.min(2, level))][q.step === 'name' ? 0 : 1];
  if (rng.next() < p) return { type: 'answer', pick: right };
  const wrong = q.options.filter((o) => o !== right);
  return { type: 'answer', pick: wrong[rng.int(wrong.length)] ?? right };
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

function demo(opts: Record<string, string | boolean>, patch: (s: State) => void, steps: DemoScript<State, Action>['steps']): DemoScript<State, Action> {
  const options = { variant: 'cards', route: false, exact: false, ...opts };
  return {
    seats: demoSeats,
    options,
    setup: () => {
      const s = newState([0, 1], options);
      patch(s);
      return s;
    },
    steps,
  };
}

const roll = (seat: number, d: number, caption: string) => ({ seat, action: { type: 'roll' } as Action, rig: [d - 1], caption });
const answer = (seat: number, pick: string, caption: string) => ({ seat, action: { type: 'answer', pick } as Action, caption });

const RULES = [
  {
    title: 'Старт с Земли',
    html: `<p>Корабли стоят на планете <b>Земля</b> внизу карты. Бросают кубик по очереди и летят по точкам маршрута — от 1 до 190 по белым линиям.</p>
      <p>С первого хода каждый <b>теряет два очка</b>: при взлёте экипаж переносит большие перегрузки. Значит, чтобы взлететь, на кубике нужно
      не меньше 3 — при единице и двойке корабль остаётся на Земле.</p>`,
    demo: demo({}, () => undefined, [
      roll(0, 2, 'Вовке выпало 2: минус 2 очка за взлёт — корабль остаётся на Земле.'),
      roll(1, 5, 'Ленке выпало 5: минус 2 — она взлетает на 3 точки.'),
      roll(0, 4, 'Вовка: перегрузки уже позади, 4 — ход на 4 точки.'),
    ]),
  },
  {
    title: 'Красные точки — карточки',
    html: `<p><b>Первый вариант.</b> Встал корабль на <b>красную точку</b> — берут карточку с тем же номером: на одной стороне — рисунок созвездия
      или планеты, на другой — что там исследует экипаж и что дальше. Карточку можно переворачивать касанием.</p>
      <p>Очки с карточки <b>прибавляются или снимаются в следующем ходе</b>: «добавляется 2 очка» — к следующему броску прибавят два,
      «снимается 1 очко» — один отнимут, «пропускается ход» — следующий ход корабль стоит.</p>`,
    demo: demo({}, (s) => {
      s.pos = [3, 15];
      s.bonus = [0, 0];
    }, [
      roll(0, 2, 'Вовка встаёт на красную точку 5 — карточка «Созвездие Орион»: спектральный анализ Бетельгейзе и Ригеля, добавляется 2 очка.'),
      roll(1, 4, 'Ленка — на точку 19, планета Уран: исследование спутников, пропускается ход.'),
      roll(0, 3, 'Вовке выпало 3, и 2 очка с карточки Ориона — ход на 5. А Ленка в этот круг пропускает.'),
    ]),
  },
  {
    title: 'Второй вариант: назови небо',
    html: `<p>Когда игроки хорошо изучат звёздное небо, играют по <b>второму варианту</b>. На красной точке нужно назвать
      <b>планету или созвездие</b> — по рисунку на карточке. Верно названная планета — <b>+1</b>, созвездие — <b>+2</b>.</p>
      <p>Если в этом созвездии есть звёзды, по которым находят <b>Полярную звезду</b> (на карте и карточках они отмечены красными стрелками),
      нужно назвать и их: созвездие и звёзды — <b>+5</b>, только созвездие — <b>минус 1</b>. Ошибся с названием — <b>минус 2</b>.
      Очки, как всегда, — в следующем ходе.</p>`,
    demo: demo({ variant: 'quiz', route: true }, (s) => {
      s.pos = [3, 60];
      s.bonus = [0, 0];
    }, [
      roll(0, 2, 'Вовка на красной точке 5. Что это за созвездие?'),
      answer(0, 'Орион', '«Орион» — верно! Теперь звёзды-ориентиры.'),
      answer(0, cardOf(5).stars!, 'Ригель и Бетельгейзе — верно: созвездие и звёзды, +5 к следующему ходу.'),
    ]),
  },
  {
    title: 'Маршрут второго варианта',
    html: `<p>Точки, <b>обведённые красным кружком</b>, — остановки маршрута второго варианта: стыковки со станциями, выходы в открытый
      космос, облёт астероидов. На них прибавляют или снимают очки либо пропускают ход — как написано в правилах (в игре это видно в журнале).</p>
      <p>В первом варианте эти точки можно включить настройкой «Маршрут второго варианта».</p>`,
    demo: demo({ variant: 'quiz', route: true }, (s) => {
      s.pos = [25, 46];
      s.bonus = [0, 0];
    }, [
      roll(0, 3, 'Вовка встал на точку 28: выход в открытый космос для исследований — пропускается ход.'),
      roll(1, 4, 'Ленка — на точку 50: нужно увеличить скорость, чтобы избежать столкновения с кометой, +2 очка.'),
      roll(1, 1, 'Вовка пропускает, снова бросает Ленка: 1 и 2 очка прибавки — ход на 3.'),
    ]),
  },
  {
    title: 'Возвращение на Землю',
    html: `<p>Побеждает тот, кто <b>первым облетит звёздное небо</b> — пройдёт все точки до 190 — <b>и вернётся на Землю</b>.
      Точный бросок не нужен; настройкой «На Землю — точным броском» можно требовать ровно столько очков, сколько осталось.</p>`,
    demo: demo({}, (s) => {
      s.pos = [187, 120];
      s.bonus = [0, 0];
    }, [roll(0, 6, 'Вовке до Земли 4 точки, выпало 6 — корабль дома, Вовка победил!')]),
  },
];

export const def: GameDef<State, Action, Event, State> = {
  id: 'astro',
  title: 'Астронавты',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Вариант',
      type: 'select',
      choices: [
        { value: 'cards', label: 'Первый: карточки на красных точках' },
        { value: 'quiz', label: 'Второй: назвать планету, созвездие и звёзды' },
      ],
      default: 'cards',
    },
    { key: 'route', label: 'Маршрут второго варианта', hint: 'точки в красных кружках: стыковки, выходы в космос, кометы', type: 'toggle', default: false },
    { key: 'exact', label: 'На Землю — точным броском', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'first', label: 'Первый вариант', hint: 'карточки планет и созвездий', options: { variant: 'cards', route: false, exact: false } },
    { id: 'second', label: 'Второй вариант', hint: 'ориентирование по звёздам и маршрут', options: { variant: 'quiz', route: true, exact: false } },
    { id: 'full', label: 'Карточки и маршрут', hint: 'первый вариант с остановками второго', options: { variant: 'cards', route: true, exact: false } },
  ],
  setup: (seats, opts) => newState(seats.map((x) => x.seat).sort((a, b) => a - b), opts),
  apply,
  toAct,
  view,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,
  result: (s) =>
    s.winner == null ? null : { winners: [s.winner], text: `${SEATS[s.winner]?.name ?? s.winner} первым облетел звёздное небо и вернулся на Землю!` },
  showcase: () => {
    const s = newState([0, 1, 2, 3], { variant: 'cards' });
    s.pos = [95, 90, 97, 91];
    s.bonus = [1, 2, -1, 0];
    s.turn = 1;
    s.moves = 12;
    return s;
  },
  rules: {
    goal: 'Первым облететь звёздное небо — по точкам карты от Земли через созвездия и планеты — и вернуться на Землю.',
    sections: RULES,
  },
};
