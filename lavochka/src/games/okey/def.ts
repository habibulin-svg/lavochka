/* Окей (Турция) и руммикуб — описание игры для сборника: 2–4 игрока, 106 фишек. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';
import { COLORS, type Tile } from './tiles';

export const SEATS = [
  { name: 'Мехмет', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Айше', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Осман', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Зейнеп', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

export const TILE_COLORS = ['#c8281e', '#d08a00', '#1f5aa8', '#1a1a1a'];
const CL = ['к', 'ж', 'с', 'ч'];
export const tn = (t: Tile) => (t.n === 0 ? '<b>☺</b>' : `<b style="color:${TILE_COLORS[t.c]}">${t.n}</b>`);

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return ev.indicator ? `Сдача ${ev.round}. Индикатор — ${tn(ev.indicator)} (${COLORS[ev.indicator.c]}), окей — ${ev.indicator.n === 13 ? 1 : ev.indicator.n + 1}.` : `Сдача ${ev.round}.`;
    case 'draw':
      return ev.from === 'left' && ev.tile ? `${name(ev.seat)} берёт сброс соседа ${tn(ev.tile)}.` : null;
    case 'discard':
      return ev.finish ? `${name(ev.seat)} сбрасывает ${tn(ev.tile)} и <b>выходит</b>!` : null;
    case 'play':
      return `${name(ev.seat)} выкладывает ${ev.tiles.map(tn).join(' ')}.`;
    case 'pass':
      return `${name(ev.seat)}: пас.`;
    case 'hand':
      return ev.winner == null ? `Сдача без победителя: ${ev.text}.` : `Сдача за ${name(ev.winner)} — ${ev.text}.`;
    case 'end':
      return `🏁 Партия: ${name(ev.winner)}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, racks: ev.racks?.map((r, i) => (seats.includes(i) ? r : [])) };
  if (ev.type === 'draw' && ev.from === 'stock' && !seats.includes(ev.seat)) return { ...ev, tile: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** «к5 ж5 с5» — цвет буквой и номер; ☺ — джокер / ложный окей. */
const T = (s: string, k = 0): Tile => (s === '☺' ? { c: 0, n: 0, k } : { c: CL.indexOf(s[0]), n: Number(s.slice(1)), k });
const TS = (s: string) => s.split(/\s+/).filter(Boolean).map((x) => T(x.replace("'", ''), x.endsWith("'") ? 1 : 0));

function pos(racks: string[], opts: Options, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  racks.forEach((r, i) => (s.racks[i] = TS(r)));
  s.stock = TS('к1 к2 ж1 ж2 с1 с2 ч1 ч2');
  s.round = 1;
  s.turn = 0;
  if (s.cfg.mode === 'okey') {
    s.indicator = T('ч9');
    s.okey = { c: 3, n: 10 };
    s.phase = 'discard';
  } else s.phase = 'turn';
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'okey',
  title: 'Окей',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'okey', label: 'окей — турецкий, джокер по индикатору' },
        { value: 'rummikub', label: 'руммикуб — выкладка на стол' },
      ],
      default: 'okey',
    },
    {
      key: 'start',
      label: 'Окей — очков на старте',
      type: 'select',
      choices: [
        { value: 20, label: '20' },
        { value: 10, label: '10 — быстро' },
      ],
      default: 20,
    },
    {
      key: 'rounds',
      label: 'Руммикуб — сдач',
      type: 'select',
      choices: [
        { value: 1, label: 'одна' },
        { value: 3, label: 'три' },
        { value: 5, label: 'пять' },
      ],
      default: 3,
    },
  ],
  presets: [
    { id: 'okey', label: 'Окей', hint: 'Вчетвером, у всех по 20 очков; вышел — соперникам минус', options: { mode: 'okey', start: 20 } },
    { id: 'quick', label: 'Окей до 10', hint: 'Короткая партия', options: { mode: 'okey', start: 10 } },
    { id: 'rummikub', label: 'Руммикуб', hint: 'Выкладка на стол от 30 очков, перестройка стола, три сдачи', options: { mode: 'rummikub', rounds: 3 } },
    { id: 'rummikub1', label: 'Руммикуб — одна сдача', hint: 'Быстро: кто первым выложил всё', options: { mode: 'rummikub', rounds: 1 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[x];
    return { winners: [s.winner], text: `${s.score[s.winner]} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => pos(['к3 к4 к5 ж7 с7 ч7 с10 с11 с12 ж1 ж2 ч10 к9 к9\' ж13', 'с1 с2 с3 ч4 ч5 ч6 к11 ж11 с11\' ч11 ж8 ж9 к13 ч2'], { mode: 'okey' }, { discards: [TS('с4'), TS('ж5 к8')] }),

  rules: {
    goal: 'Первым разложить все фишки в комбинации — группы одного номера и ряды одного цвета.',
    sections: [
      {
        title: 'Фишки и окей',
        html: `<p>106 фишек: номера 1–13 четырёх цветов (красный, жёлтый, синий, чёрный), каждая по две, и два «ложных окея» со смайликом.
          Перед сдачей открывают <b>индикатор</b>; <b>окей</b> — джокер — это фишка того же цвета на единицу старше (после 13 — 1).
          Ложный окей заменяет саму фишку-окей и играет её номером. Первому игроку 15 фишек, остальным по 14.</p>`,
      },
      {
        title: 'Комбинации и ход',
        html: `<p><b>Группа</b> — 3 или 4 фишки одного номера разных цветов. <b>Ряд</b> — 3 и больше подряд одного цвета; 12-13-1 можно, 13-1-2 нельзя.
          Ход: возьмите верхнюю фишку колоды или последнюю, сброшенную соседом слева, и сбросьте одну. На стол ничего не выкладывают — всё на подставке.</p>`,
      },
      {
        title: 'Выход и очки',
        html: `<p>Когда 14 фишек раскладываются в комбинации (или в семь пар одинаковых), сбросьте пятнадцатую — это выход.
          У всех на старте по 20 очков: при выходе соперники теряют по 2, а если вышли, сбросив окей, или семью парами — по 4.
          Как только у кого-то очков не осталось, партия кончается: выигрывает тот, у кого больше.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'okey' },
          setup: () => pos(['к3 к4 к5 ж7 с7 ч7 с10 с11 с12 с13 ж1 ж2 ч10 ж4 к13', 'с1 с2 с3 ч4 ч5 ч6 к11 ж11 с11\' ч11 ж8 ж9 к13 ч2'], { mode: 'okey' }),
          intro: 'Индикатор — чёрная 9, значит окей — чёрная 10.',
          steps: [A(0, { type: 'discard', tile: T('к13'), finish: true }, 'Окей встаёт на место жёлтой тройки: ж1-ж2-окей-ж4. Мехмет сбрасывает красную 13 — и выходит.')],
        },
      },
      {
        title: 'Руммикуб',
        html: `<p>Те же фишки, но вместо ложных океев — два настоящих джокера, и комбинации выкладывают на стол. Первый раз — на <b>30 очков</b> и только своими фишками.
          Дальше можно докладывать к любым комбинациям и перестраивать весь стол — лишь бы в конце хода всё на нём было правильным.
          Нечего выложить — берите фишку. Вышел — соперникам минус сумма их фишек (джокер — 30), вам — плюс.</p>
          <p>Здесь стол перестраивается сам: выберите фишки и нажмите «Выложить» — игра найдёт, как всё уложить.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'rummikub' },
          setup: () => pos(['к10 ж10 с10 ч1 ч2 ч3 к5', 'с1 с2 с3 ч4 ч5 ч6 к11 ж11 с11 ч11 ж8 ж9 к13 ч12'], { mode: 'rummikub' }),
          steps: [A(0, { type: 'play', tiles: TS('к10 ж10 с10 ч1 ч2 ч3') }, 'Три десятки (30) и ряд 1-2-3 — первая выкладка на 36.')],
        },
      },
    ],
  },
};
