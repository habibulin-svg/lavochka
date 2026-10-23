/* Шатра (алтайские шахматы) — описание игры для сборника: вдвоём, резерв в крепости, шашечное взятие, превращение шатры. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cell, cfgFrom, N, newState, num, setup, toAct, type Action, type Event, type Kind, type Piece, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e8d6aa', light: '#fbf3e2', dark: '#9a7a4a', ink: '#6a4a1a' },
  { name: 'Чёрные', color: '#5a3418', light: '#8a5a34', dark: '#2a1608' },
];

export const KIND_RU: Record<Kind, string> = { K: 'бий', Q: 'батыр', R: 'тура', B: 'ялкын', P: 'шатра' };
const KIND_GEN: Record<Kind, string> = { K: 'бия', Q: 'батыра', R: 'туру', B: 'ялкына', P: 'шатру' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'move':
      return `${name(ev.seat)}: ${KIND_RU[ev.kind]} ${ev.path.map(num).join(ev.taken.length ? ' × ' : ' — ')}${ev.taken.length ? ` — срублено ${ev.taken.length}` : ''}`;
    case 'drop':
      return `${name(ev.seat)} выставляет ${KIND_GEN[ev.kind]} из крепости: ${num(ev.from)} → ${num(ev.to)}`;
    case 'promote':
      return `${name(ev.seat)}: шатра на ${num(ev.at)} становится — <b>${KIND_RU[ev.kind]}</b>`;
    case 'end':
      return ev.winner == null ? '🏁 Ничья.' : `🏁 Победа: ${name(ev.winner)} — ${ev.reason === 'king' ? 'бий срублен' : 'у соперника нет ходов'}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция по номерам полей: { 28: 'wP', 21: 'bQ' }, резервы пусты (крепости — обычные поля), если не сказано иначе. */
function pos(cells: Record<number, string>, turn = 0, keepReserve = false): State {
  const s = newState(cfgFrom({}));
  if (!keepReserve) {
    s.board = new Array(N).fill(null);
    s.reserve = [[], []];
  }
  for (const [n, t] of Object.entries(cells)) s.board[cell(Number(n))] = { o: t[0] === 'w' ? 0 : 1, k: t[1] as Kind } as Piece;
  s.turn = turn;
  s.ply = 10;
  return s;
}
const mv = (...nums: number[]): Action => ({ type: 'move', path: nums.map(cell) });
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'shatra',
  title: 'Шатра',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'promo',
      label: 'Превращение шатры',
      type: 'select',
      choices: [
        { value: 'any', label: 'в любую срубленную фигуру' },
        { value: 'batyr', label: 'всегда в батыра' },
      ],
      default: 'any',
      hint: 'Источники расходятся: в большинстве — в любую свою срубленную фигуру, у «Вокруг света» — в батыра.',
    },
    { key: 'order', label: 'Резерв — по порядку', type: 'toggle', default: false, hint: 'Выставлять фигуры из крепости строго по порядку полей (по одному из описаний), а не любую.' },
  ],
  presets: [
    { id: 'classic', label: 'Шатра', hint: 'Превращение в любую срубленную фигуру, резерв — любую', options: { promo: 'any', order: false } },
    { id: 'batyr', label: 'Шатра — в батыра', hint: 'Шатра на краю всегда становится батыром', options: { promo: 'batyr', order: false } },
    { id: 'strict', label: 'Строгий резерв', hint: 'Из крепости — по порядку полей', options: { promo: 'any', order: true } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, _seat, a) => apply(s, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores = { 0: s.lost[1].length, 1: s.lost[0].length };
    if (s.winner == null) return { winners: [], text: 'ничья', scores };
    return { winners: [s.winner], text: s.lost[1 - s.winner].includes('K') ? 'бий срублен' : 'у соперника нет ходов', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = newState(cfgFrom({}));
    const set = (n: number, t: string | null) => (s.board[cell(n)] = t ? ({ o: t[0] === 'w' ? 0 : 1, k: t[1] as Kind } as Piece) : null);
    set(46, null);
    set(48, null);
    set(13, null);
    set(15, null);
    set(39, 'wP');
    set(34, 'wP');
    set(27, 'bP');
    set(22, 'bP');
    set(57, null);
    set(41, 'wR');
    set(5, null);
    set(20, 'bR');
    s.reserve = [s.reserve[0].filter((c) => c !== cell(57) && c !== cell(55)), s.reserve[1].filter((c) => c !== cell(5))];
    set(55, null);
    set(36, 'wP');
    s.lost = [['P'], ['P']];
    s.ply = 14;
    return s;
  },

  rules: {
    goal: 'Срубить бия соперника — или оставить его без ходов.',
    sections: [
      {
        title: 'Доска и фигуры',
        html: `<p>Доска — 62 поля: большое поле 7×6, посередине — ров, с каждой стороны — <b>крепость</b> 3×3 и ворота. У каждого: <b>бий</b> (князь) в воротах,
          <b>батыр</b>, две <b>туры</b>, два <b>ялкына</b> и одиннадцать <b>шатр</b> — четыре в крепости и семь в первом ряду поля. Белые ходят первыми.</p>
          <p>Бий ходит на одно поле в любую сторону, батыр — как ферзь, тура — как ладья, ялкын — по диагонали на любое число полей.</p>`,
      },
      {
        title: 'Шатра',
        html: `<p>На своей половине шатра ходит только вперёд на одно поле (из первого ряда — можно на два), у рва — ещё и вперёд наискось.
          Перейдя ров, она ходит на одно поле в любую сторону. Дошла до дальнего ряда чужой крепости — становится любой своей уже срубленной фигурой.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ 49: 'wP', 36: 'wP', 53: 'wK', 10: 'bK' }),
          steps: [A(0, mv(49, 35), 'Из первого ряда — сразу на два поля вперёд.'), A(1, mv(10, 14)), A(0, mv(36, 30), 'У рва — вперёд наискось, через ров.')],
        },
      },
      {
        title: 'Взятие',
        html: `<p>Бьют, как в шашках, — <b>прыжком</b> через чужую фигуру на свободное поле за ней, в любую сторону, и вперёд, и назад.
          Батыр, тура и ялкын бьют по своим линиям издалека и встают на любое свободное поле за срубленной.
          Бить <b>обязательно</b> (только бий может отказаться), серию доводят до конца, одну фигуру дважды не перепрыгивают.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ 29: 'wP', 22: 'bP', 14: 'bP', 53: 'wK', 3: 'bK' }),
          steps: [A(0, mv(29, 15, 13), 'Шатра бьёт через 22, потом через 14 — серия из двух взятий.')],
        },
      },
      {
        title: 'Резерв в крепости',
        html: `<p>Фигуры в своей крепости и воротах — <b>резерв</b>: сами они не ходят. Вместо хода любую из них можно выставить на свободное поле
          своей половины большого поля. Пока резерв не пуст, в свою крепость возвращаться нельзя; опустел — крепость и ворота становятся обычными полями.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({})),
          steps: [A(0, { type: 'drop', from: cell(61), to: cell(42) }, 'Белые выставляют батыра из крепости в центр своей половины.')],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Бий срублен — партия проиграна. Нет ни одного хода — тоже проигрыш. 60 ходов подряд без взятий — ничья.</p>
          <p>Шатру записал в 1960 году алтайский исследователь С. Я. Пахаев; описания расходятся в мелочах, спорные правила вынесены в настройки.</p>`,
      },
    ],
  },
};
