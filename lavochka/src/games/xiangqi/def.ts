/* Сянци — описание игры для сборника: пресеты (сянци, ко-туонг, ко-уп), подписи фигур, боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, cfgFrom, makeView, newState, setup, toAct, type Action, type EndReason, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#c0302a', light: '#e86a5a', dark: '#6a140e' },
  { name: 'Чёрные', color: '#2a2622', light: '#5a544c', dark: '#0d0b09' },
];

export const NAME_RU: Record<string, string> = { K: 'генерал', A: 'советник', E: 'слон', H: 'конь', R: 'колесница', C: 'пушка', P: 'солдат' };

const REASON: Record<EndReason, string> = {
  mate: 'мат',
  stalemate: 'пат — у соперника нет ходов',
  perpetual: 'вечный шах запрещён',
  repetition: 'повторение позиции — ничья',
  quiet: '60 ходов без взятий — ничья',
  material: 'нечем атаковать — ничья',
  resign: 'соперник сдался',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move') {
    const k = ev.piece.toUpperCase();
    return `${name(ev.seat)}: ${NAME_RU[k] ?? 'фигура'} ${ev.text}${ev.revealed ? ' (открылась)' : ''}${ev.captured ? ` — взят${ev.captured.toUpperCase() === 'C' || ev.captured.toUpperCase() === 'R' ? 'а' : ''} ${NAME_RU[ev.captured.toUpperCase()] ?? 'фигура'}` : ''}${ev.check ? ' — <b>шах!</b>' : ''}`;
  }
  if (ev.type === 'end') return ev.winner == null ? `🤝 <b>${REASON[ev.reason]}</b>.` : `🏆 <b>${name(ev.winner)}</b>: ${REASON[ev.reason]}.`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Красные', level: 1 },
  { seat: 1, kind: 'bot', name: 'Чёрные', level: 1 },
];
/** Точка по имени: 'e1' — вертикаль a..i, горизонталь 1..10. */
export const pt = (n: string) => at('abcdefghi'.indexOf(n[0]), Number(n.slice(1)) - 1);
const mv = (seat: number, from: string, to: string, caption?: string) => ({ seat, action: { type: 'move', from: pt(from), to: pt(to) } as Action, caption });
/** Позиция для показа: фигуры списком «Ke1 a f10 …» (заглавные — красные). */
function pos(list: string, turn: 0 | 1 = 0, opts: Record<string, string> = {}): State {
  const s = newState(cfgFrom(opts));
  s.board.fill('');
  for (const t of list.split(/\s+/).filter(Boolean)) s.board[pt(t.slice(1))] = t[0];
  s.turn = turn;
  s.keys = [];
  return s;
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'xiangqi',
  title: 'Сянци',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'xiangqi', label: 'сянци — китайские шахматы' },
        { value: 'kotuong', label: 'ко-туонг — вьетнамские' },
        { value: 'up', label: 'ко-уп — фигуры закрыты' },
      ],
      default: 'xiangqi',
    },
    {
      key: 'labels',
      label: 'Подписи фигур',
      type: 'select',
      choices: [
        { value: 'hanzi', label: 'иероглифы' },
        { value: 'ru', label: 'по-русски' },
        { value: 'vi', label: 'по-вьетнамски' },
      ],
      default: 'hanzi',
    },
  ],
  presets: [
    { id: 'xiangqi', label: 'Сянци', hint: 'Китайские шахматы: река, дворец, пушки', options: { mode: 'xiangqi', labels: 'hanzi' } },
    { id: 'ru', label: 'Сянци по-русски', hint: 'Те же правила, фигуры подписаны по-русски', options: { mode: 'xiangqi', labels: 'ru' } },
    { id: 'kotuong', label: 'Ко-туонг', hint: 'Вьетнамские шахматы: те же правила, своя доска и подписи', options: { mode: 'kotuong', labels: 'vi' } },
    { id: 'up', label: 'Ко-уп', hint: 'Фигуры перемешаны и стоят рубашкой вверх, открываются первым ходом', options: { mode: 'up', labels: 'hanzi' } },
  ],

  setup: (_seats, opts, rng) => setup(opts, rng),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over || !s.reason) return null;
    const scores = { 0: s.winner === 0 ? 1 : s.winner === 1 ? 0 : 0.5, 1: s.winner === 1 ? 1 : s.winner === 0 ? 0 : 0.5 };
    return { winners: s.winner == null ? [0, 1] : [s.winner], text: REASON[s.reason], scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos('Ke1 Ad1 Af1 Eg1 Ee3 Hc3 Hi1 Ra3 Rf2 Cb3 Ce5 Pc4 Pe4 Pg5 Pi4 ke10 ad10 af10 ec10 eg10 hc8 hh10 ra10 rd9 cb8 ch6 pa7 pc7 pe7 pg7 pi7');
    s.last = { from: pt('h3'), to: pt('e5') };
    return s;
  },

  rules: {
    goal: 'Поставить <b>мат</b> генералу соперника — или оставить его без ходов: в сянци пат тоже проигрыш.',
    sections: [
      {
        title: 'Доска',
        html: `<p>Фигуры стоят не на клетках, а на <b>пересечениях</b> линий: 9 вертикалей и 10 горизонталей. Посередине — <b>река</b>, у каждой стороны — <b>дворец</b>
          3×3 точки с диагоналями. Первыми ходят красные, дальше — по очереди. Брать — вставая на место чужой фигуры, как в шахматах.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Начальная расстановка. Пушка встаёт в центр — самый частый первый ход.',
          steps: [mv(0, 'b3', 'e3', 'Красная пушка — на центральную вертикаль.'), mv(1, 'h10', 'g8', 'Чёрные выводят коня.')],
        },
      },
      {
        title: 'Генерал и советники',
        html: `<p><b>Генерал</b> ходит на одну точку по вертикали или горизонтали и не выходит из дворца. <b>Советники</b> — на одну точку по диагонали, тоже только во дворце.
          Генералы <b>не могут смотреть друг на друга</b>: стоять на одной вертикали, если между ними пусто, нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Ad1 Re5 ke10 af10 pd7'),
          intro: 'Генералы на одной вертикали, между ними — красная колесница.',
          steps: [mv(0, 'e1', 'e2', 'Генерал шагает внутри дворца.'), mv(1, 'f10', 'e9', 'Советник — по диагонали дворца.'), mv(0, 'e5', 'e6', 'Колеснице нельзя уйти с вертикали e: генералы посмотрели бы друг на друга.')],
        },
      },
      {
        title: 'Слон и конь',
        html: `<p><b>Слон</b> ходит ровно на две точки по диагонали и <b>не переходит реку</b>; если на середине пути стоит фигура («глаз слона» закрыт) — ход невозможен.
          <b>Конь</b> делает шаг по прямой и шаг по диагонали наружу; если на первой точке стоит фигура («подножка»), он туда не пойдёт.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Ec1 Hb1 Pb2 kd10'),
          intro: 'Конь на b1 зажат своей пешкой на b2: вверх ему нельзя.',
          steps: [mv(0, 'c1', 'e3', 'Слон шагает на две точки по диагонали.'), mv(1, 'd10', 'd9'), mv(0, 'b1', 'd2', 'Конь идёт в сторону — слон ушёл с c1, подножки нет.')],
        },
      },
      {
        title: 'Колесница и пушка',
        html: `<p><b>Колесница</b> ходит как ладья — на любое расстояние по прямой. <b>Пушка</b> ходит так же, а <b>бьёт</b> только прыжком через одну фигуру (любого цвета) — «лафет».</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Ce3 Pe4 ke10 he8 ra10'),
          intro: 'Красная пушка e3, перед ней свой солдат e4, дальше чёрный конь e8.',
          steps: [mv(0, 'e3', 'e8', 'Пушка прыгает через солдата и берёт коня.'), mv(1, 'e10', 'd10', 'Генерал уходит с вертикали пушки.')],
        },
      },
      {
        title: 'Солдат',
        html: `<p><b>Солдат</b> ходит на одну точку вперёд. Перейдя реку, он может ходить ещё и вбок, но назад — никогда. Превращений нет.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Pc5 kd10'),
          intro: 'Красный солдат у реки.',
          steps: [mv(0, 'c5', 'c6', 'Шаг вперёд — и он уже за рекой.'), mv(1, 'd10', 'd9'), mv(0, 'c6', 'd6', 'Теперь можно и вбок.')],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Мат — победа. Если ходить нечем, это тоже поражение (пата-ничьей нет). Повторить позицию трижды, всё время объявляя шах, нельзя — вечный шах проигрывает.
          Ничья — при повторении без шахов, после 60 ходов без взятий или когда атаковать некому.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Rh9 Ra1 kd10 ad9 af9'),
          intro: 'Чёрный генерал заперт своими советниками.',
          steps: [mv(0, 'a1', 'a10', 'Колесница на последнюю горизонталь — мат.')],
        },
      },
      {
        title: 'Ко-туонг',
        html: `<p>Вьетнамские шахматы (cờ tướng) — та же игра, что сянци: те же доска, фигуры и ходы. Фигуры подписаны по-вьетнамски: Tướng — генерал, Sĩ — советник,
          Tượng — слон, Mã — конь, Xe — колесница, Pháo — пушка, Tốt — солдат.</p>`,
      },
      {
        title: 'Ко-уп — закрытые фигуры',
        html: `<p>Вьетнамский вариант: открыты только генералы, остальные фигуры перемешаны по своим местам и стоят <b>рубашкой вверх</b> — какая где, не знает никто.
          Закрытая фигура ходит как та, что стоит на этом месте в обычной расстановке, и после хода открывается. Открытые советники и слоны ходят по всей доске —
          без дворца и реки.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'up' },
          setup: (_d, rng) => setup({ mode: 'up' }, rng),
          intro: 'Все фигуры, кроме генералов, закрыты.',
          steps: [mv(0, 'b3', 'e3', 'Закрытая фигура с места пушки ходит как пушка — и открывается.'), mv(1, 'b8', 'b5', 'Чёрные тоже открывают фигуру.')],
        },
      },
    ],
  },
};
