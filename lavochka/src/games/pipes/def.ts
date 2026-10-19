/* «Водопроводчик» — одна карточка: поле 5 × 5 … 15 × 15, тор, крестовины, номер уровня (сид генератора). Вместе — одно поле на всех; наперегонки — у каждого своё. */
import { SeededRng } from '../../core/rng';
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { choose } from './bot';
import { apply, result, rotCCW, rotCW, setup, SIZES, toAct, type Action, type Event, type State } from './engine';
import { solve } from './solver';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'solved') return `💧 ${name(ev.seat)}: вода пошла! ${ev.sec} с, поворотов ${ev.turns}`;
  return null;
}

/** Повороты, которые ведут кусок i к решению (по кратчайшему пути). */
function stepsTo(cur: number, want: number): (1 | -1)[] {
  if (cur === want) return [];
  if (rotCW(cur) === want) return [1];
  if (rotCCW(cur) === want) return [-1];
  return [1, 1];
}

const seats1: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 1 }];

function demo(options: Record<string, number | boolean | string>, count: number, captions: string[], intro: string): DemoScript<State, Action> {
  let base: State | null = null;
  const get = () => (base ??= setup([0], options, new SeededRng(4)));
  return {
    seats: seats1,
    options,
    setup: () => get(),
    intro,
    get steps() {
      const s = get();
      const b = s.boards[0];
      const sol = solve(s.cfg, b.tile, s.src) ?? b.tile;
      // сначала куски у бака — видно, как вода идёт дальше
      const order = b.tile.map((_, i) => i).sort((a, c) => dist(s, a) - dist(s, c));
      const out: { seat: number; action: Action; caption?: string }[] = [];
      const tile = b.tile.slice();
      for (const i of order) {
        if (count && out.length >= count) break;
        for (const d of stepsTo(tile[i], sol[i])) {
          out.push({ seat: 0, action: { type: 'rot', i, d }, caption: captions[out.length] });
          tile[i] = d === 1 ? rotCW(tile[i]) : rotCCW(tile[i]);
        }
      }
      return out;
    },
  };
}

const dist = (s: State, i: number) => Math.abs((i % s.cfg.w) - (s.src % s.cfg.w)) + Math.abs(Math.floor(i / s.cfg.w) - Math.floor(s.src / s.cfg.w));

export const def: GameDef<State, Action, Event, State> = {
  id: 'pipes',
  title: 'Водопроводчик',
  players: { min: 1, max: 4, default: 1 },
  seats: SEATS,
  options: [
    { key: 'size', label: 'Поле', type: 'select', choices: SIZES.map((n) => ({ value: n, label: `${n} × ${n}` })), default: 7 },
    { key: 'level', label: 'Уровень', hint: 'номер задачи: у каждого номера своя сеть; после победы — следующий', type: 'number', min: 1, max: 99999, default: 1 },
    { key: 'wrap', label: 'Тор', hint: 'трубы могут уходить за край и выходить с другой стороны', type: 'toggle', default: false },
    { key: 'cross', label: 'Крестовины', hint: 'бывают куски с четырьмя выходами', type: 'toggle', default: false },
    {
      key: 'mode',
      label: 'Вдвоём и больше',
      type: 'select',
      choices: [
        { value: 'coop', label: 'вместе: одно поле на всех' },
        { value: 'race', label: 'наперегонки: у каждого своё' },
      ],
      default: 'coop',
    },
  ],
  presets: [
    { id: 'novice', label: 'Подмастерье', hint: '5 × 5', options: { size: 5, wrap: false, cross: false } },
    { id: 'master', label: 'Слесарь', hint: '7 × 7', options: { size: 7, wrap: false, cross: false } },
    { id: 'big', label: 'Сантехник', hint: '9 × 9', options: { size: 9, wrap: false, cross: false } },
    { id: 'pro', label: 'Главный инженер', hint: '13 × 13 с крестовинами', options: { size: 13, wrap: false, cross: true } },
    { id: 'wrap', label: 'Тор', hint: '9 × 9, трубы уходят за край', options: { size: 9, wrap: true, cross: false } },
    { id: 'race', label: 'Наперегонки', hint: 'Одинаковые поля — кто первым пустит воду', options: { size: 7, mode: 'race' } },
  ],
  countsHint: (o) => (o.mode === 'race' ? 'у каждого своё поле' : 'все крутят одно поле'),

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
    ),
  // «Сыграть ещё» — следующий уровень
  again: (o) => ({ ...o, level: (Number(o.level) || 1) + 1 }),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  // превью: 7 × 7, сеть почти собрана, вода дошла до половины кранов
  showcase: () => {
    const s = setup([0], { size: 7, level: 12 }, new SeededRng(3), Date.now());
    const b = s.boards[0];
    const sol = solve(s.cfg, b.tile, s.src);
    if (sol) {
      const order = b.tile.map((_, i) => i).sort((a, c) => dist(s, a) - dist(s, c));
      order.slice(0, Math.round(order.length * 0.7)).forEach((i) => (b.tile[i] = sol[i]));
    }
    return s;
  },

  rules: {
    goal: 'Повернуть куски труб так, чтобы вода из бака дошла до каждого крана и нигде не текло.',
    sections: [
      {
        title: 'Как играть',
        html: `<p>В середине поля — <b>бак с водой</b>. Каждый кусок трубы можно поворачивать: <b>щелчок</b> — по часовой стрелке,
          <b>правая кнопка</b> — против. Трубы, по которым дошла вода, наполняются — видно, как она течёт.</p>
          <p>Решено, когда все трубы — одна сеть: у каждого выхода есть ответный, ни одного открытого конца, и вода дошла до всех кранов.</p>`,
        demo: demo({ size: 5 }, 6, ['Вовка поворачивает кусок у бака — вода пошла дальше.'], 'Подмастерье: 5 × 5.'),
      },
      {
        title: 'Подсказки к решению',
        html: `<p>Начинайте с края: кусок у стенки не может смотреть в стенку. Прямая у края — только вдоль него, угол в углу поля — только одним способом.
          Два крана (куски с одним выходом) никогда не смотрят друг на друга. Уверены в куске — <b>закрепите</b> его
          (долгое нажатие или колёсико мыши): закреплённый кусок не повернуть случайно.</p>`,
      },
      {
        title: 'Уровни и вариации',
        html: `<p>У каждого номера уровня — своя сеть, «Сыграть ещё» ведёт к следующему. Поле — от 5 × 5 до 15 × 15.
          <b>Тор</b> — трубы уходят за край и выходят с другой стороны. <b>Крестовины</b> — куски с четырьмя выходами (их крутить бесполезно, зато они путают).</p>
          <p>Вдвоём и больше — <b>вместе</b> (одно поле, крутят все) или <b>наперегонки</b> (у каждого своё одинаковое поле).</p>`,
      },
    ],
  },
};

