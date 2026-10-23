/* Мельница — описание игры: малая (3), шесть, девять (классика, с полётом) и двенадцать камней (с диагоналями);
 * советская коробка: синее поле с буквами А–Ж, жёлтые и красные фишки уже стоят на своих половинах. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e8e0cc', light: '#fffaf0', dark: '#b0a688', ink: '#6a6352' },
  { name: 'Чёрные', color: '#2a2420', light: '#4a403a', dark: '#100c0a' },
];

const WHY: Record<string, string> = {
  mill: 'три в ряд',
  few: 'у соперника осталось две фишки',
  blocked: 'сопернику некуда ходить',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  if ((ev.type === 'place' || ev.type === 'move') && ev.mills) return `${name(ev.seat)}: мельница${ev.mills > 1 ? ' — даже две' : ''}!`;
  if (ev.type === 'end') {
    if (ev.winner == null) return ev.why === 'full' ? '🏁 Доска заполнена — ничья.' : '🏁 Долго без снятий — ничья.';
    return `🏁 Победа: ${name(ev.winner)} — ${WHY[ev.why]}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Точки доски 24: кольцо r (0 — внешнее), позиция i по часовой с левого верхнего угла. */
const R = (r: number, i: number) => r * 8 + i;
function pos(white: number[], black: number[], hand: [number, number], turn = 0, o: Record<string, any> = {}): State {
  const s = newState(cfgFrom(o));
  s.board.fill(0);
  for (const p of white) s.board[p] = 1;
  for (const p of black) s.board[p] = 2;
  s.hand = hand;
  s.turn = turn;
  return s;
}
const Pl = (seat: number, p: number, caption?: string) => ({ seat, action: { type: 'place', to: p } as Action, caption });
const Mv = (seat: number, from: number, to: number, caption?: string) => ({ seat, action: { type: 'move', from, to } as Action, caption });
const Tk = (seat: number, at: number, caption?: string) => ({ seat, action: { type: 'take', at } as Action, caption });

function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'mill',
  title: 'Мельница',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'men',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 9, label: 'девять камней — три квадрата' },
        { value: 12, label: 'двенадцать камней — с диагоналями' },
        { value: 6, label: 'шесть камней — два квадрата' },
        { value: 3, label: 'малая — три камня' },
      ],
      default: 9,
    },
    { key: 'fly', label: 'Полёт с тремя фишками', hint: 'Когда осталось три фишки, можно ходить на любую пустую точку', type: 'toggle', default: true, showIf: (o) => Number(o.men) >= 9 },
    { key: 'diag', label: 'Диагонали в углах', type: 'toggle', default: false, showIf: (o) => Number(o.men) === 9 },
    { key: 'set', label: 'Фишки уже расставлены', hint: 'Как в советской коробке: каждый начинает со своей половины доски', type: 'toggle', default: false, showIf: (o) => Number(o.men) >= 9 },
    {
      key: 'look',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'wood', label: 'дубовая, с деревянными шашками' },
        { value: 'stone', label: 'каменная плита' },
        { value: 'soviet', label: 'советская коробка' },
      ],
      default: 'wood',
    },
  ],
  presets: [
    { id: 'nine', label: 'Девять камней', hint: 'Классика: расставить по 9, ходить, с тремя — летать', options: { men: 9, fly: true, diag: false, set: false, look: 'wood' } },
    { id: 'soviet', label: 'Советская', hint: 'Коробка с буквами А–Ж: по 9 фишек уже стоят на своих половинах, доска с диагоналями', options: { men: 9, fly: true, diag: true, set: true, look: 'soviet' } },
    { id: 'twelve', label: 'Двенадцать камней', hint: 'Доска с диагоналями, по 12 фишек; заполнили доску — ничья', options: { men: 12, fly: true, set: false, look: 'stone' } },
    { id: 'six', label: 'Шесть камней', hint: 'Два квадрата, по 6 фишек, без полёта', options: { men: 6, look: 'wood' } },
    { id: 'three', label: 'Малая', hint: 'По 3 фишки на поле 3×3: кто первым выстроит ряд', options: { men: 3, look: 'stone' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: 'победа' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({ men: 9 }));
    const rng = fixedRng(5);
    for (let i = 0; i < 22 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Оставить соперника с двумя фишками или запереть так, чтобы ему некуда было ходить.',
    sections: [
      {
        title: 'Расстановка и мельница',
        html: `<p>Доска — три вложенных квадрата, соединённых посередине сторон. У каждого по 9 фишек. Сначала игроки по очереди
          <b>ставят</b> фишки на любые пустые точки.</p>
          <p>Три свои фишки в ряд по одной линии — <b>мельница</b>. Кто её построил, сразу <b>снимает</b> одну фишку соперника.
          Фишки из чужой мельницы трогать нельзя, если есть другие. Две мельницы одним ходом — снимают две фишки.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([R(0, 0), R(0, 1)], [R(1, 1), R(1, 3)], [7, 7], 0),
          intro: 'У белых две фишки в ряд на верхней стороне.',
          steps: [Pl(0, R(0, 2), 'Третья фишка — мельница!'), Tk(0, R(1, 1), 'Белые снимают чёрную фишку.')],
        },
      },
      {
        title: 'Ходы и «качели»',
        html: `<p>Когда все фишки поставлены, игроки <b>ходят</b>: фишку — на соседнюю пустую точку по линии. Мельницу можно разомкнуть
          и снова замкнуть следующим ходом — и снять ещё фишку. Две мельницы рядом так, чтобы фишка ходила из одной в другую,
          называют <b>качелями</b>: они снимают фишку каждый ход.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([R(0, 0), R(0, 1), R(0, 2), R(2, 0), R(2, 4)], [R(1, 1), R(2, 1), R(1, 5), R(2, 5), R(0, 6)], [0, 0], 0),
          intro: 'У белых мельница наверху.',
          steps: [Mv(0, R(0, 2), R(0, 3), 'Белые размыкают мельницу…'), Mv(1, R(0, 6), R(0, 7)), Mv(0, R(0, 3), R(0, 2), '…и замыкают снова.'), Tk(0, R(1, 1), 'Ещё одна фишка снята.')],
        },
      },
      {
        title: 'Полёт и конец партии',
        html: `<p>Когда у игрока остаются <b>три</b> фишки, он может <b>летать</b> — ставить фишку на любую пустую точку, а не только на соседнюю.</p>
          <p>Проигрывает тот, у кого осталось <b>две</b> фишки или кому <b>некуда ходить</b>. Если 50 ходов подряд никто ничего не снял — ничья.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([R(0, 0), R(0, 7), R(2, 2)], [R(0, 1), R(1, 1), R(1, 3), R(1, 5), R(2, 5)], [0, 0], 0),
          intro: 'У белых три фишки — им можно летать.',
          steps: [Mv(0, R(2, 2), R(0, 6), 'Перелёт через всю доску — мельница слева!'), Tk(0, R(0, 1))],
        },
      },
      {
        title: 'Шесть, двенадцать и малая',
        html: `<p><b>Шесть камней</b> — два квадрата и по 6 фишек, без полёта. <b>Двенадцать камней</b> — доска с диагоналями в углах
          (по ним тоже ходят и строят мельницы), по 12 фишек; если расстановкой заполнили всю доску — ничья.
          <b>Малая мельница</b> — поле 3×3 с диагоналями и по 3 фишки: кто первым выстроит три в ряд, тот и выиграл, снимать ничего не нужно.</p>`,
        demo: {
          seats: demoSeats,
          options: { men: 3 },
          intro: 'Малая мельница: поле 3×3.',
          steps: [Pl(0, 4, 'Белые занимают центр.'), Pl(1, 0), Pl(0, 2), Pl(1, 6, 'Чёрные закрывают диагональ.'), Pl(0, 3), Pl(1, 5, 'Фишки расставлены — дальше ходят.')],
        },
      },
      {
        title: 'Советская коробка',
        html: `<p>В советской дорожной коробке поле синее, с буквами А–Ж и цифрами 1–7 по краям и с диагоналями в углах.
          По 9 жёлтых и красных фишек <b>сразу стоят</b> на своих половинах доски, средний ряд пуст — расстановки нет, начинают с ходов.</p>`,
        demo: {
          seats: demoSeats,
          options: { men: 9, diag: true, set: true, look: 'soviet' },
          intro: 'Фишки уже на доске.',
          steps: [Mv(0, R(2, 6), R(2, 7), 'Красные выходят в средний ряд.'), Mv(1, R(2, 2), R(2, 3))],
        },
      },
    ],
  },
};
