/* «В атаку!» — описание игры. Советская военная игра (автор Н. Авцын, художник В. Антипов): поле с рекой и бродами,
 * по 21 пластиковой фигуре у красных и зелёных, стенка для тайной расстановки, мины записываются на листке.
 * Материалы и решения — docs/analysis/materials-vataku.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { ACC, apply, at, cellName, cfgFrom, LETTERS, makeView, NAMES, newState, QUIET, redact, setup, toAct, type Action, type Event, type Kind, type State } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#d8281a', light: '#ff7a64', dark: '#7a0c04' },
  { name: 'Зелёные', color: '#2a7c2c', light: '#6cc66a', dark: '#0e3e10' },
];

const WHY: Record<string, string> = {
  frame: 'рамка соперника занята',
  army: 'армия соперника разбита',
  quiet: `${QUIET} серий без боя — ничья`,
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'ready') return `${name(ev.seat)}: расставились.`;
  if (ev.type === 'start') return 'Стенку убрали — в атаку! Первыми ходят красные: 1 ход, потом 2, 2 и дальше по 3.';
  if (ev.type === 'move') {
    let t = `${name(ev.seat)}: ${NAMES[ev.kind]} ${cellName(ev.from)} → ${cellName(ev.to)}`;
    if (ev.boom >= 0) return `${t} — 💥 мина на ${cellName(ev.boom)}!`;
    if (ev.took) t += ` — бьёт ${ACC[ev.took.kind]}`;
    return t;
  }
  if (ev.type === 'shoot') return `${name(ev.seat)}: пушка ${cellName(ev.from)} стреляет по ${cellName(ev.to)} — ${NAMES[ev.took.kind]} подбит.`;
  if (ev.type === 'end') return ev.winner == null ? `🏁 Ничья: ${WHY[ev.why]}.` : `🏁 Победа — ${name(ev.winner)}: ${WHY[ev.why]}!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];

/** Клетка по подписи на поле: «Д», 8 → Д-8. */
const X = (ch: string, r: number) => at(LETTERS.indexOf(ch), r - 1);

/** Позиция посреди партии: [клетка, сторона, фигура]; ходят красные, серия из трёх ходов. */
function pos(list: [number, number, Kind][], mines: [number[], number[]] = [[], []]): State {
  const s = newState(cfgFrom({}));
  s.phase = 'play';
  s.ready = [true, true];
  s.laid = [true, true];
  s.series = 3;
  s.left = 3;
  list.forEach(([p, side, kind], i) => (s.cells[p] = { id: i, side, kind, face: side === 0 ? 1 : -1 }));
  s.mines = mines;
  return s;
}
const Mv = (from: number, to: number, caption?: string) => ({ seat: 0, action: { type: 'move', from, to } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'vataku',
  title: 'В атаку!',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'river',
      label: 'Река для самолётов и ракет',
      type: 'select',
      choices: [
        { value: 'slow', label: 'тоже по клетке за ход — как в листке' },
        { value: 'fly', label: 'перелетают, как над сушей' },
      ],
      default: 'slow',
    },
  ],
  presets: [
    { id: 'box', label: 'По листку', hint: 'Реку все переходят по клетке за ход', options: { river: 'slow' } },
    { id: 'fly', label: 'Над рекой летают', hint: 'Самолёты и ракеты не замедляются над рекой', options: { river: 'fly' } },
  ],

  setup: (_seats, opts, rng) => setup(opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    if (s.winner == null) return { winners: [], text: WHY[s.why] };
    return { winners: [s.winner], text: WHY[s.why], scores: { [s.winner]: 1, [1 - s.winner]: 0 } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const rng = { n: 9, next() { this.n = (this.n * 1103515245 + 12345) % 2147483648; return this.n / 2147483648; }, int(k: number) { return Math.floor(this.next() * k); }, getState() { return this.n; } };
    let s = setup({}, rng);
    s = { ...s, phase: 'play', ready: [true, true] };
    for (let i = 0; i < 30 && s.phase === 'play'; i++) {
      const seat = toAct(s)[0];
      const a = choose(s, seat, 2, rng);
      if (!a) break;
      const r = apply(s, seat, a, rng);
      if (!r || r.state.phase !== 'play') break;
      s = r.state;
    }
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Первым занять все шесть клеток рамки на стороне противника — и чтобы среди фигур в рамке было не меньше трёх пехотинцев.',
    sections: [
      {
        title: 'Поле и фигуры',
        html: `<p>Поле 20×15: столбцы от А до Ф, ряды от 1 до 15. Посередине — <b>река</b> с двумя <b>бродами</b> (З-2…З-4 и Н-12…Н-14),
          по углам — жёлтые клетки <b>резерва</b>, у краёв — красные <b>рамки</b> 2×3: у красных А–Б 7–9, у зелёных У–Ф 7–9.</p>
          <p>У каждого — 3 <b>ракеты</b>, 2 <b>самолёта</b>, 4 <b>танка</b>, 4 <b>пушки</b>, 8 <b>пехотинцев</b> и 2 тайные <b>мины</b>.</p>`,
      },
      {
        title: 'Расстановка за стенкой',
        html: `<p>Посреди поля ставят стенку, и каждый расставляет фигуры на <b>своей половине</b> (не на реку) и записывает две мины
          на листке. Здесь стенку заменяет тайная расстановка: свои фигуры переставляются нажатиями, мины — чёрные кружки в углу клетки.
          Когда оба готовы, стенку убирают: фигуры видны всем, мины — нет.</p>`,
        demo: {
          seats: demoSeats,
          setup: (_d, rng) => setup({}, rng),
          steps: [
            { seat: 0, action: { type: 'auto' } as Action, caption: 'Красные расставились: пехота и танки у реки, пушки за ними, ракеты и самолёты сзади.' },
            { seat: 0, action: { type: 'ready' } as Action },
            { seat: 1, action: { type: 'ready' } as Action, caption: 'Зелёные тоже готовы — стенку убрали.' },
          ],
        },
      },
      {
        title: 'Как ходят',
        html: `<p>Ходят <b>сериями</b>: первый — 1 ход, второй — 2, первый — 2, а дальше всё время по 3. Каждый ход — одна фигура,
          вперёд, назад, в сторону, с поворотами: ракета — на 1–5 клеток, самолёт — на 1–10, танк — на 1–3, пушка — на 1,
          пехотинец — на 1–2. Перескакивать фигуры могут только <b>ракеты и самолёты</b>.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[X('Д', 8), 0, 'tank'], [X('Е', 5), 0, 'inf'], [X('Б', 12), 0, 'plane'], [X('В', 12), 0, 'inf'], [X('Т', 8), 1, 'inf']]),
          steps: [Mv(X('Д', 8), X('Д', 5), 'Танк — на три клетки.'), Mv(X('Е', 5), X('Ж', 6), 'Пехотинец — на две, с поворотом.'), Mv(X('Б', 12), X('Л', 12), 'Самолёт пролетает девять клеток — и над своим пехотинцем.')],
        },
      },
      {
        title: 'Река, броды и резерв',
        html: `<p>Через <b>реку</b> каждая фигура проходит по <b>одной клетке</b> за ход; <b>броды</b> — обычная суша. В <b>резерве</b>
          (жёлтые клетки) фигуры не бьют и не бьются; вывести их можно в любой момент, а вернуться — нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[X('Ж', 3), 0, 'inf'], [X('И', 8), 0, 'tank'], [X('Т', 8), 1, 'inf']]),
          steps: [Mv(X('Ж', 3), X('И', 3), 'Пехотинец переходит реку вброд.'), Mv(X('И', 8), X('К', 8), 'Танк входит в реку — только на одну клетку.'), Mv(X('К', 8), X('Л', 8), 'И ещё на одну.')],
        },
      },
      {
        title: 'Бой',
        html: `<p>Любая фигура бьёт любую: встаёт на её клетку, побитую снимают. <b>Пушка</b> не наезжает, а <b>стреляет</b> по прямой
          на расстояние до трёх клеток и остаётся на месте. <b>Ракета</b> бьёт один раз: вместе с целью снимается и сама.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [X('Д', 8), 0, 'tank'],
              [X('Д', 6), 1, 'inf'],
              [X('Г', 10), 0, 'gun'],
              [X('Ж', 10), 1, 'tank'],
              [X('Б', 3), 0, 'rocket'],
              [X('Б', 7), 1, 'plane'],
              [X('Ф', 12), 1, 'inf'],
            ]),
          steps: [
            Mv(X('Д', 8), X('Д', 6), 'Танк бьёт пехотинца.'),
            { seat: 0, action: { type: 'shoot', from: X('Г', 10), to: X('Ж', 10) } as Action, caption: 'Пушка стреляет на три клетки — танк подбит, пушка на месте.' },
            Mv(X('Б', 3), X('Б', 7), 'Ракета сбивает самолёт — и снимается сама.'),
          ],
        },
      },
      {
        title: 'Мины',
        html: `<p>Если фигура противника <b>остановилась</b> на клетке с миной или <b>прошла через неё</b>, хозяин мины показывает
          листок и снимает фигуру. Самолёты и ракеты над минами пролетают, а сев на мину — подрываются. Свои мины своим не страшны.
          Взорванная мина больше не действует.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[X('М', 4), 0, 'inf'], [X('Ф', 12), 1, 'inf']], [[], [X('Н', 4)]]),
          steps: [Mv(X('М', 4), X('О', 4), 'Пехотинец идёт через Н-4 — а там мина зелёных.')],
        },
      },
      {
        title: 'Победа',
        html: `<p>Побеждает тот, кто первым займёт <b>все шесть клеток рамки</b> противника, причём не меньше трёх из них — пехотинцами.
          Если армия соперника разбита целиком — тоже победа. ${QUIET} серий подряд без боя — ничья (это наше правило).</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [X('У', 7), 0, 'inf'],
              [X('У', 8), 0, 'inf'],
              [X('Ф', 7), 0, 'tank'],
              [X('Ф', 8), 0, 'tank'],
              [X('Ф', 9), 0, 'gun'],
              [X('Т', 9), 0, 'inf'],
              [X('Р', 2), 1, 'inf'],
            ]),
          steps: [Mv(X('Т', 9), X('У', 9), 'Третий пехотинец входит в рамку — все шесть клеток заняты. Победа!')],
        },
      },
    ],
  },
};
