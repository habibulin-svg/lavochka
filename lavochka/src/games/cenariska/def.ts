/* «Цена риска» — описание игры. Настольная игра 90-х («Супер игра»): лабиринт 7×7 из тайлов, охотники ледникового
 * периода носят туши на четыре священные стоянки. Правила — по самодельной перепечатке (docx), тайлы — с фото коробки.
 * Материалы и решения — docs/analysis/materials-cenariska.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { ACC, apply, at, cfgFrom, COLORS, MAX_TURNS, NAMES, newState, setup, toAct, type Action, type Event, type Kind, type State } from './engine';

export const SEATS = [
  { name: 'Жёлтые', color: COLORS[0], light: '#ffe27a', dark: '#7a5e04', ink: '#8a6a04' },
  { name: 'Бирюзовые', color: COLORS[1], light: '#7ad6da', dark: '#0a4a4e' },
  { name: 'Зелёные', color: COLORS[2], light: '#9ad67a', dark: '#1a4a0a' },
  { name: 'Оранжевые', color: COLORS[3], light: '#ffa27a', dark: '#7a2004' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move') {
    const t: string[] = [];
    if (ev.torchLost) t.push('факел погас у хищника');
    if (ev.spent) t.push('копьё сломано о зверя');
    if (ev.spear) t.push('охотник дал копьё');
    if (ev.laid) t.push(`🥩 туша (${NAMES[ev.laid]}) на стоянке`);
    if (ev.torch) t.push('🔥 факел зажжён');
    return t.length ? `${name(ev.seat)}: ${t.join(', ')}.` : null;
  }
  if (ev.type === 'kill') return `🗡 ${name(ev.seat)} убивает ${ACC[ev.prey]}!`;
  if (ev.type === 'end') return `🏁 ${name(ev.winner)} — вождь племени!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];
const fixed = { next: () => 0.3, int: () => 0, getState: () => 0 };

/** Доска для показа: в верхнем ряду прямой, охотник (стрелка на восток) и бизон; ходит место 0 со своей стоянки. */
function scene(phase: State['phase'], patch: (s: State) => void = () => {}): State {
  const s = newState(cfgFrom({}), 2, fixed);
  const put = (r: number, c: number, k: Kind, rot = 0) => (s.board[at(r, c)] = { k, rot });
  put(0, 1, 'I');
  put(0, 3, 'hunter');
  put(0, 5, 'bison');
  put(1, 0, 'tiger', 1);
  s.phase = phase;
  s.hand = phase === 'shift' ? 'L' : null;
  patch(s);
  return s;
}
const Go = (to: number, caption?: string) => ({ seat: 0, action: { type: 'move', to } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'cenariska',
  title: 'Цена риска',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'full', label: 'по правилам: убить четырёх зверей и разнести туши по стоянкам' },
        { value: 'quick', label: 'быстрая: побывать на всех стоянках (копьё — на один проход через зверя)' },
      ],
      default: 'full',
    },
  ],
  presets: [
    { id: 'full', label: 'По правилам', hint: 'Туши мамонта, носорога, оленя и бизона — на четыре стоянки, и домой', options: { mode: 'full' } },
    { id: 'quick', label: 'Быстрая игра', hint: 'Туши не носят — обойти все стоянки и вернуться домой', options: { mode: 'quick' } },
  ],

  setup: (seats, opts, rng) => setup(opts, seats.length, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    return { winners: [s.winner], text: s.turns >= MAX_TURNS ? 'больше всех туш на стоянках' : 'вождь племени' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const rng = { n: 4, next() { this.n = (this.n * 1103515245 + 12345) % 2147483648; return this.n / 2147483648; }, int(k: number) { return Math.floor(this.next() * k); }, getState() { return this.n; } };
    let s = setup({}, 4, rng);
    for (let i = 0; i < 60 && s.phase !== 'over'; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r || r.state.phase === 'over') break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Первым разнести по туше на каждую из четырёх священных стоянок — мамонта, носорога, оленя и бизона — и вернуться на свою родную стоянку. Кто сделал это, тот вождь племени.',
    sections: [
      {
        title: 'Поле и тайлы',
        html: `<p>Поле 7×7: 16 тайлов закреплены (по углам — стоянки четырёх цветов), остальные двигаются, ещё 13 лежат в запасе.
          По краям тайлов — каменная кладка: где её нет, там проход. На тайлах бывают <b>звери-добыча</b> (мамонт, носорог,
          олень, бизон), <b>хищники</b> (тигр и лев), <b>охотники</b> со стрелкой и <b>камни</b>. У каждого в начале — факел,
          копья нет.</p>`,
      },
      {
        title: 'Сдвиг',
        html: `<p>Ход начинается со сдвига: из запаса вслепую берут тайл, поворачивают как хотят и вдвигают в любой подвижный ряд
          или столбец со стрелкой. Тайл с другого конца выпадает и уходит в запас; фишки едут вместе с тайлами. Нельзя сдвигать
          ряд, если на выпадающей клетке стоит чья-то фишка.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => scene('shift'),
          steps: [{ seat: 0, action: { type: 'shift', slot: 8, rot: 1 } as Action, caption: 'Поворот на четверть и сдвиг ряда — выпавший тайл ушёл в запас.' }],
        },
      },
      {
        title: 'Манёвр',
        html: `<p>Затем фишка идёт по открытым проходам на любое число клеток (можно и остаться). Через кладку и край поля не ходят.
          <b>Охотник</b> — только по стрелке: войти с хвоста, выйти по острию. Остановился на охотнике без копья — получил копьё.
          <b>Хищник</b> пропустит только с факелом, а факел погаснет. <b>Камень</b> не пройти. Зажечь факел можно на любой стоянке.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => scene('move'),
          steps: [Go(at(0, 3), 'Через прямой и развилку — к охотнику по его стрелке: копьё получено.')],
        },
      },
      {
        title: 'Добыча и стоянки',
        html: `<p>Зверь-добыча пропускает только того, у кого копьё. Остановился на звере, которого ещё не убивал, — можно убить:
          копьё ломается, туша — твоя. Нести можно сколько угодно туш, но каждого зверя — один раз. На любой стоянке, где твоей
          туши ещё нет, можно выложить одну.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            scene('move', (s) => {
              s.players[0].p = at(0, 4);
              s.players[0].spear = true;
            }),
          steps: [
            Go(at(0, 5), 'С копьём — на бизона…'),
            { seat: 0, action: { type: 'kill' } as Action, caption: '…и бизон убит: копьё сломано, туша в руках.' },
          ],
        },
      },
      {
        title: 'Победа',
        html: `<p>Побеждает первый, у кого туши лежат на <b>всех четырёх</b> стоянках (и на родной тоже), когда он вернулся на свою
          стоянку. В «Быстрой игре» туш не носят: достаточно побывать на всех стоянках и вернуться, а копьё ломается о первого
          же зверя, через которого прошёл. Если партия затянулась на ${MAX_TURNS} ходов, побеждает тот, у кого больше туш на
          стоянках (это наше правило).</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            scene('move', (s) => {
              s.board[at(0, 5)] = { k: 'I', rot: 0 };
              s.players[0].p = at(0, 5);
              s.players[0].carry = ['bison'];
              s.players[0].killed = ['bison'];
            }),
          steps: [Go(at(0, 6), 'Туша бизона — на бирюзовую стоянку. Осталось ещё три.')],
        },
      },
    ],
  },
};
