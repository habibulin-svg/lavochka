/* Китайские шашки — описание игры для сборника: «Ромашка» (советская доска-цветок), звезда, халма 16×16; 2–6 игроков; боты; правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, geoOf, moves, newState, seatsFor, toAct, type Action, type Event, type State } from './engine';

/** Место = угол звезды (снизу по часовой): цвет шариков — как у лепестка «Ромашки». */
export const SEATS = [
  { name: 'Коричневые', color: '#7a4a24', light: '#b88a5a', dark: '#3a2010' },
  { name: 'Оранжевые', color: '#e86a10', light: '#f8a860', dark: '#7a3000' },
  { name: 'Синие', color: '#1a5ab8', light: '#5a9ae8', dark: '#0a2a60' },
  { name: 'Жёлтые', color: '#e0b000', light: '#f8d850', dark: '#7a5a00', ink: '#8a6a00' },
  { name: 'Зелёные', color: '#1a7a3a', light: '#4ab86a', dark: '#0a3a1a' },
  { name: 'Красные', color: '#c8202a', light: '#f06a6a', dark: '#6a0a0e' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move') return ev.path.length > 2 ? `${name(ev.seat)}: прыжки цепочкой — ${ev.path.length - 1}.` : null;
  if (ev.type === 'end') return ev.winner == null ? '🤝 Ничья.' : `🏆 <b>${name(ev.winner)}</b> первыми заняли дом напротив.`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [
  { seat: 2, kind: 'bot', name: 'Синие', level: 1 },
  { seat: 5, kind: 'bot', name: 'Красные', level: 1 },
];
const cfg2 = cfgFrom({ mode: 'romashka' }, 2);
/** Первые ходы для показа: шаг синих, шаг красных, затем прыжок синих (подбираем по настоящим ходам начальной позиции). */
function opening() {
  let s = newState(cfg2, [2, 5]);
  const steps: { seat: number; action: Action; caption?: string }[] = [];
  const play = (seat: number, pick: (ms: ReturnType<typeof moves>) => ReturnType<typeof moves>[number], caption: string) => {
    const m = pick(moves(s, seat));
    steps.push({ seat, action: { type: 'move', from: m.from, to: m.to }, caption });
    s = apply(s, seat, { type: 'move', from: m.from, to: m.to })!.state;
  };
  const g = geoOf(cfg2);
  const tip = (seat: number) => g.tip[g.opp[s.corner[seat]]];
  const far = (seat: number) => (ms: ReturnType<typeof moves>) => ms.slice().sort((a, b) => g.dist(b.from, tip(seat)) - g.dist(b.to, tip(seat)) - (g.dist(a.from, tip(seat)) - g.dist(a.to, tip(seat))))[0];
  const stepOnly = (seat: number) => (ms: ReturnType<typeof moves>) => far(seat)(ms.filter((m) => m.path.length === 2));
  play(2, stepOnly(2), 'Синий шарик шагает на соседнюю лунку.');
  play(5, stepOnly(5), 'Красные — тоже.');
  play(2, far(2), 'А этот прыгает через свой шарик — прыжки можно делать цепочкой, сколько получится.');
  return steps;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'chinesecheckers',
  title: 'Китайские шашки',
  players: { min: 2, max: 6, default: 2 },
  countsFor: (o) => (o.mode === 'halma' ? [2, 4] : [2, 3, 4, 6]),
  countsHint: (o) => (o.mode === 'halma' ? 'вдвоём — по 19 фишек, вчетвером — по 13' : 'вдвоём, втроём, вчетвером или вшестером — по 10 шариков'),
  seatsFor,
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'romashka', label: '«Ромашка» — советская доска-цветок' },
        { value: 'star', label: 'звезда — китайские шашки' },
        { value: 'halma', label: 'халма — квадратная доска 16×16' },
      ],
      default: 'romashka',
    },
  ],
  presets: [
    { id: 'romashka', label: 'Ромашка', hint: 'Советская доска-цветок: шесть лепестков, шарики в лунках', options: { mode: 'romashka' } },
    { id: 'star', label: 'Китайские шашки', hint: 'Звезда на 121 лунку', options: { mode: 'star' } },
    { id: 'halma', label: 'Халма', hint: 'Квадратная доска 16×16, ходы во все восемь сторон', options: { mode: 'halma' } },
  ],

  setup: (seats, opts) => {
    const list = seats.map((x) => x.seat).sort((a, b) => a - b);
    return newState(cfgFrom(opts, list.length), list);
  },
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over || s.winner == null) return null;
    return { winners: [s.winner], text: 'первыми заняли дом напротив' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({ mode: 'romashka' }, 3), [1, 3, 5]);
    // несколько ходов по очереди, чтобы шарики вышли из домов
    for (let i = 0; i < 15; i++) {
      const seat = s.turn;
      const g = geoOf(s.cfg);
      const tip = g.tip[g.opp[s.corner[seat]]];
      const ms = moves(s, seat).sort((a, b) => g.dist(a.to, tip) - g.dist(b.to, tip) || a.from - b.from);
      s = apply(s, seat, { type: 'move', from: ms[0].from, to: ms[0].to })!.state;
    }
    return s;
  },

  rules: {
    goal: 'Первым перевести все свои шарики в <b>дом напротив</b> — в лепесток (луч, угол) на другой стороне доски.',
    sections: [
      {
        title: 'Доска и шарики',
        html: `<p>Доска — шестиконечная звезда на 121 лунку; в советской «Ромашке» лучи звезды нарисованы цветными лепестками. У каждого игрока 10 шариков в своём лепестке.
          Играют вдвоём, втроём, вчетвером или вшестером; ходят по очереди.</p>`,
        demo: { seats: demoSeats, options: { mode: 'romashka' }, setup: () => newState(cfg2, [2, 5]), intro: 'Вдвоём: синие против красных, дома — напротив.', steps: opening() },
      },
      {
        title: 'Ходы',
        html: `<p>За ход можно сдвинуть один шарик на <b>соседнюю</b> свободную лунку — или <b>перепрыгнуть</b> через соседний шарик (свой или чужой) на свободную лунку сразу за ним.
          Прыжки можно продолжать цепочкой, меняя направление, — так шарик проходит пол-доски за один ход. Шарики не снимаются: через них только прыгают.</p>`,
      },
      {
        title: 'Победа',
        html: `<p>Побеждает тот, кто первым занял все лунки дома напротив. Если чужой шарик засел в вашем целевом доме, он не мешает: дом считается занятым, когда все лунки в нём заполнены
          и среди них есть хоть один ваш шарик. Вошедший в целевой дом шарик назад из него не выходит.</p>`,
      },
      {
        title: 'Халма',
        html: `<p>Старинная английская игра, прародительница китайских шашек: квадратная доска 16×16, лагеря в углах. Вдвоём у каждого по 19 фишек, вчетвером — по 13.
          Ходить и прыгать можно во все восемь сторон — по прямой и по диагонали.</p>`,
      },
    ],
  },
};
