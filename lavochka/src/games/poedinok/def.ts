/* «Поединок» — описание игры. Советский выпуск «Duell» («Электромера»): жёлтое поле 9×8, по девять кубиков,
 * один из них — король. Правила — по инструкции, неясности (размер поля, дворцы, пат) решены по фото —
 * docs/analysis/materials-poedinok.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, COLS, legal, newState, QUIET, setup, toAct, type Action, type Die, type Dir, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e8e2cc', light: '#ffffff', dark: '#8a8270', ink: '#6a624e' },
  { name: 'Чёрные', color: '#2a2a2c', light: '#6a6a70', dark: '#000000' },
];

const WHY: Record<string, string> = {
  king: 'король взят',
  palace: 'король вошёл во дворец соперника',
  stuck: 'ходов нет ни у кого — ничья',
  quiet: `${QUIET / 2} ходов без взятий — ничья`,
};

const colName = (p: number) => 'abcdefghi'[p % COLS] + (8 - Math.floor(p / COLS));

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move') {
    const took = ev.took ? (ev.took.king ? ' — <b>берёт короля!</b>' : ' — взятие') : '';
    return `${name(ev.seat)}: ${colName(ev.from)} → ${colName(ev.to)}${took}`;
  }
  if (ev.type === 'pass') return `${name(ev.seat)}: ходов нет — пропуск.`;
  if (ev.type === 'end') return ev.winner == null ? `🏁 Ничья: ${WHY[ev.why]}.` : `🏁 Победа — ${name(ev.winner)}: ${WHY[ev.why]}!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];

/** Клетка по обозначению: столбец a…i, ряд 1…8 снизу (от белых). */
const at = (c: string, r: number) => 'abcdefghi'.indexOf(c) + (8 - r) * COLS;
/** Восточная грань при северной 4 (белые) — по стартовой раскладке. */
const EAST: Record<number, number> = { 5: 6, 1: 5, 2: 1, 6: 2 };
const W = (t: number): Die => ({ owner: 0, king: false, t, n: 4, e: EAST[t] });
const B = (t: number): Die => ({ owner: 1, king: false, t, n: 3, e: 7 - EAST[t] });
const K = (owner: number): Die => ({ owner, king: true, t: 1, n: owner ? 3 : 4, e: 2 });

function pos(list: [number, Die][], turn = 0): State {
  const s = newState(cfgFrom({}));
  s.cells = s.cells.map(() => null);
  for (const [p, d] of list) s.cells[p] = d;
  s.turn = turn;
  return s;
}
const Mv = (seat: number, from: number, d1: Dir, k: number, d2: Dir | null, caption?: string) => ({ seat, action: { type: 'move', from, d1, k, d2 } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'poedinok',
  title: 'Поединок',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'win',
      label: 'Как победить',
      type: 'select',
      choices: [
        { value: 'both', label: 'взять короля или привести своего во дворец — по инструкции' },
        { value: 'king', label: 'только взять короля' },
      ],
      default: 'both',
    },
  ],
  presets: [
    { id: 'box', label: 'По инструкции', hint: 'Взять короля или привести своего короля во дворец соперника', options: { win: 'both' } },
    { id: 'king', label: 'Охота на короля', hint: 'Дворцов нет — только взять короля', options: { win: 'king' } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: WHY[s.why] };
    return { winners: [s.winner], text: WHY[s.why], scores: { [s.winner]: 1, [1 - s.winner]: 0 } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = { n: 7, next() { this.n = (this.n * 1103515245 + 12345) % 2147483648; return this.n / 2147483648; }, int(k: number) { return Math.floor(this.next() * k); }, getState() { return this.n; } };
    for (let i = 0; i < 14 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng) ?? legal(s, s.turn)[0];
      const r = apply(s, s.turn, a);
      if (!r || r.state.over) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Взять королевский кубик соперника — или привести своего короля в «дворец» соперника, на клетку, где его король стоял в начале.',
    sections: [
      {
        title: 'Поле и кубики',
        html: `<p>Поле — 9 клеток в ширину и 8 в глубину. У каждого — 9 кубиков: 8 обычных и <b>король</b> с «крестом» на всех гранях.
          Кубики стоят в своём крайнем ряду; слева направо сверху видно <b>5, 1, 2, 6, король, 6, 2, 1, 5</b>. К себе каждый кубик
          повёрнут тройкой, к сопернику — четвёркой. Клетка короля в начале партии — его <b>дворец</b>. Первыми ходят белые.</p>`,
      },
      {
        title: 'Как ходят',
        html: `<p>Кубик <b>перекатывается</b> через ребро на соседнюю клетку — и сверху оказывается другая грань. За ход он делает
          <b>ровно столько перекатов, сколько точек сверху</b> в начале хода: пятёрка — пять клеток. Король ходит на одну клетку.</p>
          <p>Путь — по прямой или с <b>одним поворотом</b> под прямым углом, только по свободным клеткам: перепрыгивать кубики нельзя,
          на одну клетку дважды вставать нельзя. Если к клетке ведут два пути и сверху выходят разные грани — выбираете путь сами.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({})),
          steps: [
            Mv(0, at('a', 1), 'n', 5, null, 'Пятёрка катится вперёд на пять клеток — сверху теперь другая грань.'),
            Mv(1, at('b', 8), 's', 1, null, 'Единица — на одну клетку.'),
            Mv(0, at('c', 1), 'n', 1, 'e', 'Двойка — две клетки с поворотом: вперёд и вправо.'),
          ],
        },
      },
      {
        title: 'Взятие',
        html: `<p>Если последний перекат приходится на клетку с кубиком соперника, тот <b>взят</b> — снимается с поля, а ваш кубик встаёт
          на его место. Взятые кубики складывают в тубу. Свои брать нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[at('c', 3), W(2)], [at('d', 4), B(5)], [at('e', 1), K(0)], [at('e', 8), K(1)], [at('h', 6), B(1)]]),
          steps: [Mv(0, at('c', 3), 'n', 1, 'e', 'Двойка: вперёд, потом вправо — и берёт чёрную пятёрку.')],
        },
      },
      {
        title: 'Победа',
        html: `<p>Побеждает тот, кто <b>возьмёт короля</b> соперника — или приведёт <b>своего короля во дворец</b> соперника (его клетка
          в начале партии). В варианте «Охота на короля» дворцов нет.</p>
          <p>Если ходить некому, ход пропускают; пропустили оба — ничья. И ничья, если ${QUIET / 2} ходов подряд никого не брали
          (в инструкции об этом ничего нет — это наше).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[at('e', 7), K(0)], [at('d', 8), B(6)], [at('a', 1), W(1)], [at('i', 3), K(1)], [at('f', 2), B(5)]]),
          steps: [Mv(0, at('e', 7), 'n', 1, null, 'Белый король входит во дворец чёрных — победа!')],
        },
      },
    ],
  },
};
