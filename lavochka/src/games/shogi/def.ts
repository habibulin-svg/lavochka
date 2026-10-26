/* Сёги — описание игры для сборника: сёги 9×9, мини-сёги 5×5, «животные сёги» 3×4; подписи фигур; боты; правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, GEO, newState, setup, toAct, type Action, type EndReason, type Event, type Mode, type State, type View } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#3a2a1a', light: '#6a5a4a', dark: '#120a04' },
  { name: 'Белые', color: '#efe2c2', light: '#fffaf0', dark: '#8a7a5a', ink: '#7a5f30' },
];

export const NAME_RU: Record<string, string> = { K: 'король', R: 'ладья', B: 'слон', G: 'золото', S: 'серебро', N: 'конь', L: 'копьё', P: 'пешка', W: 'жираф', F: 'слон' };
const DOBUTSU_RU: Record<string, string> = { K: 'лев', W: 'жираф', F: 'слон', P: 'цыплёнок' };
export const pieceName = (k: string, mode: Mode) => (mode === 'dobutsu' ? DOBUTSU_RU[k] : NAME_RU[k]) ?? 'фигура';

const REASON: Record<EndReason, string> = {
  mate: 'мат',
  try: 'лев дошёл до последнего ряда',
  perpetual: 'вечный шах запрещён',
  repetition: 'четырежды повторилась позиция — ничья',
  moves: 'партия слишком затянулась — ничья',
  resign: 'соперник сдался',
  impasse: 'импас — оба короля в лагере соперника, а очков у другого меньше 24',
  impasseDraw: 'импас — оба короля в лагере соперника, у обоих по 24 очка — ничья',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move') return `${name(ev.seat)}: ${ev.text}${ev.drop ? ' (сброс)' : ''}${ev.promo ? ' — переворот' : ''}${ev.check ? ' — <b>шах!</b>' : ''}`;
  if (ev.type === 'end') return ev.winner == null ? `🤝 <b>${REASON[ev.reason]}</b>.` : `🏆 <b>${name(ev.winner)}</b>: ${REASON[ev.reason]}.`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Чёрные', level: 1 },
  { seat: 1, kind: 'bot', name: 'Белые', level: 1 },
];
/** Поле по имени для доски режима: 'e5' — вертикаль a.., горизонталь от чёрных. */
export const sq = (mode: Mode, n: string) => (Number(n.slice(1)) - 1) * GEO[mode].w + 'abcdefghi'.indexOf(n[0]);
const mv = (seat: number, from: string, to: string, caption?: string, promo?: boolean, mode: Mode = 'shogi') => ({ seat, action: { type: 'move', from: sq(mode, from), to: sq(mode, to), promo } as Action, caption });
const drop = (seat: number, kind: string, to: string, caption?: string, mode: Mode = 'shogi') => ({ seat, action: { type: 'drop', kind, to: sq(mode, to) } as Action, caption });
/** Позиция для показа: «Ke1 rb8 +Pc7» — заглавная — чёрные, строчная — белые, «+» — перевёрнута; руки — h0='P2' и т. п. */
function pos(list: string, mode: Mode = 'shogi', turn: 0 | 1 = 0, hand0: Record<string, number> = {}, hand1: Record<string, number> = {}): State {
  const s = newState(cfgFrom({ mode }));
  s.board.fill(null);
  for (const t of list.split(/\s+/).filter(Boolean)) {
    const pr = t[0] === '+';
    const c = pr ? t[1] : t[0];
    s.board[sq(mode, t.slice(pr ? 2 : 1))] = { o: c === c.toUpperCase() ? 0 : 1, k: c.toUpperCase(), pr };
  }
  Object.assign(s.hands[0], hand0);
  Object.assign(s.hands[1], hand1);
  s.turn = turn;
  s.keys = [];
  return s;
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'shogi',
  title: 'Сёги',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'shogi', label: 'сёги — доска 9×9' },
        { value: 'mini', label: 'мини-сёги — 5×5' },
        { value: 'dobutsu', label: 'животные сёги — 3×4' },
      ],
      default: 'shogi',
    },
    {
      key: 'labels',
      label: 'Подписи фигур',
      type: 'select',
      choices: [
        { value: 'kanji', label: 'иероглифы' },
        { value: 'ru', label: 'по-русски' },
      ],
      default: 'kanji',
      showIf: (o) => o.mode !== 'dobutsu',
    },
  ],
  presets: [
    { id: 'shogi', label: 'Сёги', hint: 'Японские шахматы: взятые фигуры возвращаются в бой', options: { mode: 'shogi', labels: 'kanji' } },
    { id: 'ru', label: 'Сёги по-русски', hint: 'Те же правила, фигуры подписаны по-русски', options: { mode: 'shogi', labels: 'ru' } },
    { id: 'mini', label: 'Мини-сёги', hint: 'Доска 5×5, по шесть фигур — партия на 10 минут', options: { mode: 'mini', labels: 'kanji' } },
    { id: 'dobutsu', label: 'Животные сёги', hint: 'Доска 3×4: лев, жираф, слон и цыплёнок — для детей', options: { mode: 'dobutsu' } },
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
    // размен слонов в начале партии: у каждого по слону в руке
    let s = newState(cfgFrom({}));
    for (const [seat, f, to, promo] of [
      [0, 'c3', 'c4', false],
      [1, 'g7', 'g6', false],
      [0, 'b2', 'h8', true],
      [1, 'g9', 'h8', false],
    ] as [number, string, string, boolean][]) {
      const r = apply(s, seat, { type: 'move', from: sq('shogi', f), to: sq('shogi', to), promo });
      if (r) s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Поставить <b>мат</b> королю соперника. Взятые фигуры не пропадают — их можно вернуть на доску уже своими.',
    sections: [
      {
        title: 'Доска и фигуры',
        html: `<p>Доска 9×9 клеток, у каждого 20 фигур — плоские «домики» с иероглифом; чьи они, видно по тому, куда смотрит острие. Первыми ходят <b>чёрные</b>.</p>
          <ul><li><b>Король</b> (玉/王) — на одно поле в любую сторону.</li>
          <li><b>Ладья</b> (飛) — по прямой на любое расстояние, <b>слон</b> (角) — по диагонали.</li>
          <li><b>Золото</b> (金) — на поле вперёд, вбок, назад и вперёд по диагонали; <b>серебро</b> (銀) — вперёд и по всем четырём диагоналям.</li>
          <li><b>Конь</b> (桂) — прыжком на два поля вперёд и одно вбок (только вперёд!); <b>копьё</b> (香) — вперёд на любое расстояние; <b>пешка</b> (歩) — на поле вперёд и бьёт так же.</li></ul>`,
        demo: {
          seats: demoSeats,
          intro: 'Начальная расстановка. Обычное начало — открыть дорогу слону.',
          steps: [mv(0, 'c3', 'c4', 'Пешка шагает вперёд — слону открыта диагональ.'), mv(1, 'g7', 'g6', 'Белые отвечают тем же.')],
        },
      },
      {
        title: 'Превращение',
        html: `<p>Три дальние горизонтали — <b>зона превращения</b>. Фигура, которая входит в неё, выходит из неё или ходит внутри, может <b>перевернуться</b>:
          ладья становится драконом (ходит ещё и на поле по диагонали), слон — лошадью (ещё и на поле по прямой), серебро, конь, копьё и пешка — ходят как золото.
          Переворачиваться не обязательно, кроме случаев, когда фигуре иначе некуда будет ходить (пешка и копьё на последней горизонтали, конь — на двух последних).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Pc6 ke9', 'shogi'),
          intro: 'Пешка у самой зоны превращения.',
          steps: [mv(0, 'c6', 'c7', 'Пешка входит в зону и переворачивается в «токин» — теперь она ходит как золото.', true)],
        },
      },
      {
        title: 'Сбросы',
        html: `<p>Взятая фигура переходит к вам «в руку». Вместо хода её можно <b>поставить</b> на любое пустое поле — уже своей и неперевёрнутой.
          Нельзя ставить фигуру туда, откуда ей некуда ходить; нельзя ставить пешку на вертикаль, где уже есть своя неперевёрнутая пешка (<i>нифу</i>),
          и нельзя ставить мат сбросом пешки (<i>утифудзумэ</i>).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('Ke1 Gd2 ke9 ge8', 'shogi', 0, { S: 1 }),
          intro: 'У чёрных в руке серебро.',
          steps: [drop(0, 'S', 'd8', 'Серебро ставится рядом с белым королём — шах.'), mv(1, 'e9', 'f9', 'Король уходит.')],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Мат — победа; если ходить нечем, это тоже поражение. Если одна и та же позиция повторилась четыре раза — ничья (<i>сэннитэ</i>), но если при этом одна сторона всё время
          давала шах — она проигрывает.</p>
          <p><b>Импас</b> (<i>дзисёги</i>): если оба короля вошли в лагерь соперника, мата уже не дождаться — считают очки за фигуры на доске
          и в руке: ладья и слон по 5, остальные по 1. У кого меньше 24 — проигрыш; у обоих хватает — ничья.</p>`,
      },
      {
        title: 'Мини-сёги',
        html: `<p>Доска 5×5, у каждого король, золото, серебро, слон, ладья и пешка. Зона превращения — одна последняя горизонталь. Сбросы и все ограничения — как в обычных сёги.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'mini' },
          setup: () => newState(cfgFrom({ mode: 'mini' })),
          intro: 'Вся армия — шесть фигур.',
          steps: [mv(0, 'd1', 'b3', 'Слон выходит на диагональ.', false, 'mini'), mv(1, 'b5', 'd3', 'Белый слон — тоже.', false, 'mini')],
        },
      },
      {
        title: 'Животные сёги',
        html: `<p>Детские сёги на доске 3×4 (<i>доубуцу сёги</i>): <b>лев</b> ходит как король, <b>жираф</b> — на поле по прямой, <b>слон</b> — на поле по диагонали,
          <b>цыплёнок</b> — на поле вперёд, а дойдя до последнего ряда, становится <b>курицей</b> (ходит как золото). Взятых зверей можно сбрасывать.
          Выигрывает тот, кто поставит мат льву или проведёт своего льва в последний ряд так, что его нельзя тут же взять.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'dobutsu' },
          setup: () => newState(cfgFrom({ mode: 'dobutsu' })),
          intro: 'Лев в центре, жираф и слон по бокам, цыплёнок впереди.',
          steps: [mv(0, 'b2', 'b3', 'Цыплёнок бьёт цыплёнка — он теперь в руке у чёрных.', false, 'dobutsu'), mv(1, 'b4', 'b3', 'Белый лев отбивает.', false, 'dobutsu')],
        },
      },
    ],
  },
};
