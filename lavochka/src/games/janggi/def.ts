/* Чанги — описание игры для сборника: расстановки коней и слонов, подписи фигур, боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, cfgFrom, newState, setup, toAct, type Action, type EndReason, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чо', color: '#1a5a8a', light: '#4a8ac8', dark: '#0a2a4a' },
  { name: 'Хан', color: '#c0302a', light: '#e86a5a', dark: '#6a140e' },
];

export const NAME_RU: Record<string, string> = { K: 'генерал', A: 'советник', E: 'слон', H: 'конь', R: 'колесница', C: 'пушка', P: 'солдат' };

const REASON: Record<EndReason, string> = {
  mate: 'мат',
  points: 'партия решена по очкам',
  bikjang: 'бикджан — по очкам',
  repetition: 'повторение — по очкам',
  resign: 'соперник сдался',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  const pt = (p: number) => 'abcdefghi'[p % 9] + (Math.floor(p / 9) + 1);
  if (ev.type === 'move')
    return `${name(ev.seat)}: ${NAME_RU[ev.piece.toUpperCase()]} ${pt(ev.from)}${ev.captured ? ':' : '-'}${pt(ev.to)}${ev.captured ? ` — взят${ev.captured.toUpperCase() === 'R' || ev.captured.toUpperCase() === 'C' ? 'а' : ''} ${NAME_RU[ev.captured.toUpperCase()]}` : ''}${ev.check ? ' — <b>чанг!</b>' : ''}${ev.bik ? ' — <b>бикджан!</b>' : ''}`;
  if (ev.type === 'pass') return `${name(ev.seat)} пропускает ход.`;
  if (ev.type === 'end') {
    const sc = ev.score ? ` (${ev.score[0]} : ${ev.score[1]})` : '';
    return ev.winner == null ? `🤝 <b>${REASON[ev.reason]}</b>${sc}.` : `🏆 <b>${name(ev.winner)}</b>: ${REASON[ev.reason]}${sc}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Чо', level: 1 },
  { seat: 1, kind: 'bot', name: 'Хан', level: 1 },
];
export const pt = (n: string) => at('abcdefghi'.indexOf(n[0]), Number(n.slice(1)) - 1);
const mv = (seat: number, from: string, to: string, caption?: string) => ({ seat, action: { type: 'move', from: pt(from), to: pt(to) } as Action, caption });
function pos(list: string, turn: 0 | 1 = 0): State {
  const s = newState(cfgFrom({}));
  s.board.fill('');
  for (const t of list.split(/\s+/).filter(Boolean)) s.board[pt(t.slice(1))] = t[0];
  s.turn = turn;
  s.keys = [];
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'janggi',
  title: 'Чанги',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'setup',
      label: 'Кони и слоны',
      type: 'select',
      choices: [
        { value: 'HEEH', label: 'конь-слон … слон-конь' },
        { value: 'EHHE', label: 'слон-конь … конь-слон' },
        { value: 'HEHE', label: 'конь-слон … конь-слон' },
        { value: 'EHEH', label: 'слон-конь … слон-конь' },
      ],
      default: 'HEEH',
      hint: 'В чанги каждый сам решает, где у него стоят кони и слоны; здесь — одна расстановка на обоих.',
    },
    {
      key: 'labels',
      label: 'Подписи фигур',
      type: 'select',
      choices: [
        { value: 'hanja', label: 'иероглифы' },
        { value: 'ru', label: 'по-русски' },
      ],
      default: 'hanja',
    },
  ],
  presets: [
    { id: 'janggi', label: 'Чанги', hint: 'Корейские шахматы: дворцы с диагоналями, пушки прыгают через фигуру', options: { setup: 'HEEH', labels: 'hanja' } },
    { id: 'ru', label: 'Чанги по-русски', hint: 'Те же правила, фигуры подписаны по-русски', options: { setup: 'HEEH', labels: 'ru' } },
    { id: 'inner', label: 'Слоны внутри', hint: 'Расстановка «слон-конь … конь-слон»', options: { setup: 'EHHE', labels: 'hanja' } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over || !s.reason) return null;
    const scores = { 0: s.winner === 0 ? 1 : s.winner === 1 ? 0 : 0.5, 1: s.winner === 1 ? 1 : s.winner === 0 ? 0 : 0.5 };
    return { winners: s.winner == null ? [0, 1] : [s.winner], text: REASON[s.reason], scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = newState(cfgFrom({}));
    for (const [seat, f, t] of [
      [0, 'c4', 'd4'],
      [1, 'c7', 'd7'],
      [0, 'b1', 'c3'],
      [1, 'h10', 'g8'],
    ] as [number, string, string][]) {
      const r = apply(s, seat, { type: 'move', from: pt(f), to: pt(t) });
      if (r) Object.assign(s, r.state);
    }
    return s;
  },

  rules: {
    goal: 'Поставить <b>мат</b> генералу соперника. Если мата нет, партия может решиться по очкам за оставшиеся фигуры.',
    sections: [
      {
        title: 'Доска и фигуры',
        html: `<p>Доска — 9×10 точек, как в сянци, но <b>без реки</b>. Первыми ходят синие (Чо), вторыми — красные (Хан). Генерал стоит в центре <b>дворца</b> — квадрата 3×3 с диагоналями.
          Генерал и советники ходят на одну точку по линиям дворца (и по его диагоналям) и не выходят из него.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Начальная расстановка. Солдат шагает вбок — в чанги это можно с первого хода.',
          steps: [mv(0, 'c4', 'd4', 'Солдат Чо шагает вбок.'), mv(1, 'c7', 'd7', 'Хан отвечает тем же.')],
        },
      },
      {
        title: 'Конь и слон',
        html: `<p><b>Конь</b> — шаг по прямой и шаг по диагонали наружу, как в сянци; фигура на первой точке мешает ему. <b>Слон</b> — шаг по прямой и <b>два</b> по диагонали:
          он дальнобойнее, но спотыкается о фигуру на любой промежуточной точке. Реки нет — слон ходит по всей доске.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Kd2 Hb1 Ec1 ke9 Pa4'),
          intro: 'Конь b1 и слон c1.',
          steps: [mv(0, 'c1', 'e4', 'Слон: шаг вверх и два по диагонали.'), mv(1, 'e9', 'e8'), mv(0, 'b1', 'c3', 'Конь: шаг вверх и шаг наискосок.')],
        },
      },
      {
        title: 'Колесница и пушка',
        html: `<p><b>Колесница</b> ходит как ладья, а во дворце — ещё и по его диагоналям. <b>Пушка</b> и ходит, и бьёт только <b>прыжком</b> через одну фигуру;
          прыгать через пушку и бить пушку нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Kd2 Cb3 Pb4 ke9 hb8'),
          intro: 'Пушка b3, перед ней свой солдат, дальше — конь Хан.',
          steps: [mv(0, 'b3', 'b8', 'Пушка прыгает через солдата и берёт коня.'), mv(1, 'e9', 'f9')],
        },
      },
      {
        title: 'Солдат',
        html: `<p><b>Солдат</b> ходит на одну точку вперёд или вбок (назад — нельзя), а в чужом дворце — ещё и по его диагоналям вперёд.</p>`,
      },
      {
        title: 'Пропуск хода, бикджан и очки',
        html: `<p>Если нет шаха, ход можно <b>пропустить</b>. Шах в чанги называют «чанг!».
          Если генералы встали на одну вертикаль и между ними пусто — это <b>бикджан</b>: соперник должен его разорвать, иначе партия заканчивается подсчётом очков.
          Очки: колесница 13, пушка 7, конь 5, слон 3, советник 3, солдат 2; красные получают ещё 1,5 за то, что ходят вторыми. По очкам решаются и повторение позиции, и затянувшаяся партия.</p>`,
      },
    ],
  },
};
