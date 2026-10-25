/* Блоки — описание игры для сборника: классика 20×20 (2–4), на троих, Дуо 14×14. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { cfgFrom, newState, PIECE_SIZE, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Синие', color: '#1f6fe0', light: '#8ec0ff', dark: '#0b3c8a' },
  { name: 'Жёлтые', color: '#f2bf1d', light: '#fff0a0', dark: '#9a7208', ink: '#8a6400' },
  { name: 'Красные', color: '#e2362b', light: '#ff9a8e', dark: '#8a1610' },
  { name: 'Зелёные', color: '#27a347', light: '#8fe6a0', dark: '#0f5e24' },
];
const COLOR_RU = ['синий', 'жёлтый', 'красный', 'зелёный'];
const SIZE_RU = (k: number) => (k === 1 ? 'клетку' : `фигурку из ${k} клеток`);

function describe(ev: Event, name: (seat: number) => string): string | null {
  // цвет — только если игрок ходит не своим (вдвоём по два цвета, втроём общий зелёный)
  if (ev.type === 'place') return `${name(ev.seat)}${ev.color === ev.seat ? '' : ` (${COLOR_RU[ev.color]})`}: ${SIZE_RU(PIECE_SIZE[ev.piece])}`;
  if (ev.type === 'out') return `${COLOR_RU[ev.color][0].toUpperCase() + COLOR_RU[ev.color].slice(1)} больше не ходит.`;
  if (ev.type === 'end') return `🏁 Итог: ${ev.scores.map((x, i) => `${name(i)} ${x > 0 ? '+' : ''}${x}`).join(', ')}`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (k: number): SeatSpec[] => Array.from({ length: k }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const put = (piece: number, cells: number[]): Action => ({ type: 'place', piece, cells });
const D = 14;
const at = (r: number, c: number) => r * D + c;

/** Позиция Дуо с уже выложенными клетками: цвет → клетки. */
function duo(cells: Record<number, number[]>, ply = 4): State {
  const s = newState(cfgFrom({ mode: 'duo' }), 2);
  for (const [col, cs] of Object.entries(cells)) for (const c of cs) s.board[c] = Number(col);
  // как будто выложены первые фигурки (иначе цвет «ещё не начал»)
  for (const col of [0, 1]) s.hand[col] = s.hand[col].filter((p) => p !== 20);
  s.ply = ply;
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'blokus',
  title: 'Блоки',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 'classic', label: 'Классика 20×20 (четыре цвета)' },
        { value: 'three', label: 'На троих 20×20 (зелёный — по очереди)' },
        { value: 'duo', label: 'Дуо 14×14 (вдвоём)' },
      ],
      default: 'classic',
      hint: 'В классике вдвоём у каждого по два цвета.',
    },
  ],
  presets: [
    { id: 'classic', label: 'Классика', hint: 'Поле 20×20, четыре цвета: вчетвером или вдвоём по два цвета', options: { mode: 'classic' } },
    { id: 'three', label: 'На троих', hint: 'Свой цвет у каждого, зелёным ходят все по очереди', options: { mode: 'three' } },
    { id: 'duo', label: 'Дуо', hint: 'Вдвоём на поле 14×14', options: { mode: 'duo' } },
  ],
  countsFor: (o) => (o.mode === 'duo' ? [2] : o.mode === 'three' ? [3] : [2, 4]),
  setup: (seats, opts) => setup(opts, seats.length),
  toAct,
  apply: (s, _seat, a) => step(s, a),
  view: (s) => s,
  result(s) {
    if (!s.over || !s.scores) return null;
    const best = Math.max(...s.scores);
    const winners = s.scores.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
    const scores: Record<number, number> = {};
    s.scores.forEach((x, i) => (scores[i] = x));
    return { winners, text: `лучший счёт ${best > 0 ? '+' : ''}${best}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    // середина партии на классическом поле: ходы ботов с постоянным сидом
    const s0 = newState(cfgFrom({ mode: 'classic' }), 4);
    let s = s0;
    let seed = 12345;
    const rng = {
      next: () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648),
      int: (n: number) => Math.floor(rng.next() * n),
      getState: () => seed,
    };
    for (let i = 0; i < 28 && !s.over; i++) s = step(s, choose(s, toAct(s)[0], 1, rng)!)!.state;
    return s;
  },

  rules: {
    goal: 'Выложить на поле <b>как можно больше клеток</b> своих фигурок. У кого меньше всего осталось на руках — тот и выиграл.',
    sections: [
      {
        title: 'Фигурки и первый ход',
        html: `<p>У каждого цвета 21 фигурка из одной–пяти клеток. Цвета ходят по кругу: синий, жёлтый, красный, зелёный. Первая фигурка цвета
          должна накрыть его <b>начальную клетку</b> — угол поля (в Дуо — клетку ближе к центру). Фигурки можно поворачивать и переворачивать.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { mode: 'duo' },
          setup: () => newState(cfgFrom({ mode: 'duo' }), 2),
          steps: [
            A(0, put(20, [at(3, 5), at(4, 3), at(4, 4), at(4, 5), at(5, 4)]), 'Синие накрывают свою начальную клетку.'),
            A(1, put(17, [at(8, 9), at(9, 8), at(9, 9), at(9, 10), at(10, 9)]), 'Жёлтые — свою.'),
          ],
        },
      },
      {
        title: 'Только уголком',
        html: `<p>Каждая новая фигурка должна касаться фигурок своего цвета <b>хотя бы одним уголком</b> — и <b>ни одной стороной</b>.
          Чужих можно касаться как угодно. Так цвета расползаются по полю и перекрывают друг другу дорогу.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { mode: 'duo' },
          setup: () => duo({ 0: [at(3, 5), at(4, 3), at(4, 4), at(4, 5), at(5, 4)], 1: [at(8, 9), at(9, 8), at(9, 9), at(9, 10), at(10, 9)] }),
          steps: [
            A(0, put(9, [at(6, 5), at(6, 6), at(6, 7), at(6, 8), at(6, 9)]), 'Синяя палка касается своих только уголком.'),
            A(1, put(14, [at(6, 10), at(6, 12), at(7, 10), at(7, 11), at(7, 12)]), 'Жёлтая — тоже уголком, а синих касается стороной: это можно.'),
          ],
        },
      },
      {
        title: 'Конец и счёт',
        html: `<p>Если цвету некуда положить ни одну фигурку, он выбывает, остальные ходят дальше. Когда не ходит никто, считают очки:
          минус одно за каждую клетку на руках; выложил всё — <b>+15</b>, а если последней была одиночная клетка — ещё <b>+5</b>.</p>
          <p>В классике вдвоём у каждого по два цвета, втроём зелёным ходят все по очереди, и его очки не считаются.</p>`,
      },
    ],
  },
};

