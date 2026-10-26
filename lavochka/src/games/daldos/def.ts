/* Далдос — датско-норвежская игра на доске-лодке: три ряда лунок, фишки-лопатки и фишки-обелиски, две кости-призмы A/II/III/IIII.
 * Движок — engine.ts, боты — ai.ts. */
import type { DemoStep, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, cellOf, holes, newState, setup, tally, toAct, width, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Светлые', color: '#e8cf9a', light: '#fff1cf', dark: '#9b7a44', ink: '#7a5a24' },
  { name: 'Тёмные', color: '#4a2c1a', light: '#8a5a3a', dark: '#22120a' },
];

/** Подпись грани кости: A (дал) или римская цифра; в Норвегии дал помечали X. */
export const face = (v: number, cfg?: { size: string }) => (v === 1 ? (cfg?.size === 'no' ? 'X' : 'A') : 'I'.repeat(v));

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') {
    const d = ev.dice.map((v) => face(v, ev)).join(' и ');
    if (ev.none) return `${name(ev.seat)}: ${d} — ходить нечем, ход пропал.`;
    return `${name(ev.seat)}: ${d}${ev.again ? ' — дал-дал, ещё бросок' : ''}.`;
  }
  if (ev.type === 'move') {
    const parts: string[] = [];
    if (ev.dal) parts.push('далит фишку');
    if (ev.took.length) parts.push(ev.took.length > 1 ? `снимает ${ev.took.length} фишки соперника` : 'снимает фишку соперника');
    return parts.length ? `${name(ev.seat)} ${parts.join(' и ')}.` : null;
  }
  if (ev.type === 'end') {
    if (ev.winner == null) return '🏁 Ничья.';
    const why = ev.why === 'all' ? 'сняты все фишки соперника' : ev.why === 'one' ? 'у соперника осталась одна фишка' : 'на доске больше фишек';
    return `🏁 Победа: ${name(ev.winner)} — ${why}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const DK = cfgFrom({});
const C = (row: number, col: number) => cellOf(DK, row, col);
/** Значения костей → rig (rng.int(4) + 1). */
const dice = (a: number, b: number) => [a - 1, b - 1];
const Roll = (seat: number, a: number, b: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'roll' }, rig: dice(a, b), caption });
const Mv = (seat: number, from: number, to: number, use: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'move', from, to, use }, caption });

/** Позиция для показа: [место, ряд, столбец, надалена]. Ходит место 0, ждёт броска. */
function pos(list: [number, number, number, boolean][]): State {
  const s = newState(DK, 0);
  s.board = s.board.map(() => null);
  for (const [seat, row, col, dal] of list) s.board[C(row, col)] = { seat, dal };
  s.count = [list.filter((x) => x[0] === 0).length, list.filter((x) => x[0] === 1).length];
  return s;
}
/** Недаленные фишки места в своём ряду, столбцы from…to. */
const homeRun = (seat: number, from: number, to: number): [number, number, number, boolean][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [seat, seat === 0 ? 0 : 2, from + i, false]);

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
  id: 'daldos',
  title: 'Далдос',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'dk', label: 'датская: 16 + 17 + 16 лунок, по 16 фишек' },
        { value: 'no', label: 'норвежская (далдоса): 12 + 13 + 12, по 12 фишек' },
      ],
      default: 'dk',
    },
    { key: 'sternOnly', label: 'Далить только крайнюю у кормы', hint: 'по некоторым записям: недаленную фишку далят строго по очереди, от кормы', type: 'toggle', default: false },
    { key: 'passCapture', label: 'Сложенными костями бить и по пути', hint: 'снимается и фишка там, где кончилась первая кость', type: 'toggle', default: false },
    { key: 'lastOne', label: 'Короткая партия', hint: 'проигрывает тот, у кого осталась одна фишка', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'dk', label: 'Далдос', hint: 'Датская доска из Тисте: 16 фишек, ряды 16 + 17 + 16 лунок', options: { size: 'dk', sternOnly: false, passCapture: false, lastOne: false } },
    { id: 'no', label: 'Далдоса', hint: 'Норвежская доска из Йерена: 12 фишек, ряды 12 + 13 + 12, дал помечен X', options: { size: 'no', sternOnly: false, passCapture: false, lastOne: false } },
    { id: 'strict', label: 'Строгий порядок', hint: 'Далят только крайнюю у кормы фишку, сложенными костями бьют и по пути', options: { size: 'dk', sternOnly: true, passCapture: true, lastOne: false } },
    { id: 'short', label: 'Короткая', hint: 'Норвежская доска, а проигрывает тот, у кого осталась одна фишка', options: { size: 'no', sternOnly: false, passCapture: false, lastOne: true } },
  ],

  setup: (_seats, opts: Options, rng) => setup(opts, rng),
  toAct,
  apply,
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over') return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: s.why === 'all' ? 'сняты все фишки соперника' : s.why === 'one' ? 'у соперника осталась одна фишка' : `больше фишек на доске: ${s.count[s.winner]} против ${s.count[1 - s.winner]}` };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(DK, 0);
    const rng = fixedRng(11);
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r) break;
      s = r.state;
      // середина партии: многие фишки уже надалены, кое-кого сняли
      if (s.ply >= 26 && s.phase === 'move' && tally(s, 0).dal + tally(s, 1).dal >= 7) break;
    }
    return s;
  },

  rules: {
    goal: 'Снять с доски все фишки соперника. Фишки бегут по кругу через средний ряд и ряд соперника; встал на чужую фишку — снял её. Ход решают две кости-призмы, а начинается всё с «дала».',
    sections: [
      {
        title: 'Доска-лодка',
        html: `<p>Доска похожа на лодку: у неё нос и корма, три ряда лунок. В крайних рядах по 16 лунок, в среднем — 17: лишняя лунка
          в носу. У каждого игрока 16 фишек, в начале они стоят во всех лунках своего ряда <b>поперёк ряда</b>. У светлых фишки —
          широкие лопатки, у тёмных — обелиски. В норвежской «далдосе» лунок 12 + 13 + 12 и фишек по 12.</p>
          <p>Путь фишки: по своему ряду к корме, оттуда в средний ряд и по нему к носу, из носа — в ряд соперника и по нему снова
          к корме, потом опять средний ряд — и так по кругу. В свой ряд фишка больше не возвращается. По среднему ряду обе стороны
          бегут в одну сторону.</p>`,
      },
      {
        title: 'Кости и дал',
        html: `<p>Кости — две длинные четырёхгранные призмы с насечками <b>A</b>, II, III и IIII (A — это единица, «дал»). Бросают обе.</p>
          <p>Пока фишка стоит поперёк ряда, ходить ею нельзя. Сначала её надо <b>надалить</b>: кость A разворачивает фишку вдоль ряда
          и продвигает на одну лунку. Первой можно надалить только крайнюю у кормы фишку — остальным некуда шагнуть. Если надаленных
          фишек нет, а дал не выпал, ход пропадает.</p>
          <p>После броска сами переставьте фишку: нажмите на неё, затем на подсвеченную лунку.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(DK, 0),
          intro: 'Начало партии: все фишки стоят поперёк своих рядов.',
          steps: [
            Roll(0, 1, 3, 'Светлым выпали A и III.'),
            Mv(0, C(0, 0), C(1, 3), 2, 'Дал разворачивает крайнюю у кормы фишку, и с тройкой она уходит на четыре лунки — в средний ряд.'),
            Roll(1, 2, 4, 'Тёмным — II и IIII: дала нет, надаленных фишек нет. Ход пропал.'),
          ],
        },
      },
      {
        title: 'Ход двумя костями',
        html: `<p>Очки костей можно сыграть <b>разными фишками</b> или <b>сложить</b> для одной. Например, A и III: надалить фишку и сходить
          другой на три; или надалить и пройти этой же фишкой четыре; или сходить двумя надаленными фишками на 3 и на 1; или одной на 4.
          Сыграть надо обе кости, если можно; нельзя — хоть одну.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([...homeRun(0, 6, 15), [0, 1, 3, true], [0, 1, 14, true], ...homeRun(1, 0, 9), [1, 1, 9, true]]),
          intro: 'Две светлые фишки уже в среднем ряду.',
          steps: [
            Roll(0, 4, 2, 'Выпали IIII и II.'),
            Mv(0, C(1, 14), C(2, 14), 0, 'Четыре лунки: через нос — в ряд тёмных.'),
            Mv(0, C(1, 3), C(1, 5), 1, 'А другой фишкой — на две.'),
          ],
        },
      },
      {
        title: 'Взятие',
        html: `<p>Встав на лунку с фишкой соперника, вы её <b>снимаете</b> — и надаленную, и ещё стоящую поперёк. Через чужие фишки
          можно перескакивать, их это не снимает; через свои — нельзя, и на свою фишку вставать нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([...homeRun(0, 10, 15), [0, 1, 4, true], [0, 1, 7, true], ...homeRun(1, 4, 12), [1, 1, 6, true], [1, 1, 9, true]]),
          intro: 'В среднем ряду светлые и тёмные вперемешку.',
          steps: [
            Roll(0, 2, 3, 'Выпали II и III.'),
            Mv(0, C(1, 7), C(1, 9), 0, 'Двойкой — на тёмную фишку: она снята.'),
            Mv(0, C(1, 4), C(1, 7), 1, 'Тройкой — через тёмную фишку: перескочить можно, она остаётся на месте.'),
          ],
        },
      },
      {
        title: 'Сложенные кости',
        html: `<p>Если сложить обе кости для одной фишки, снимается только фишка соперника в конце хода, а промежуточную она
          перескакивает. В варианте «бить и по пути» снимается и фишка там, где кончилась бы первая кость.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([...homeRun(0, 8, 15), [0, 1, 2, true], ...homeRun(1, 3, 12), [1, 1, 4, true], [1, 1, 7, true]]),
          intro: 'Впереди светлой фишки — две тёмные.',
          steps: [Roll(0, 2, 3, 'Выпали II и III.'), Mv(0, C(1, 2), C(1, 7), 2, 'Всего пять лунок: дальняя тёмная снята, ближнюю перескочили.')],
        },
      },
      {
        title: 'Дал-дал',
        html: `<p>Две кости A — <b>дал-дал</b>: сыграв их, бросаете ещё раз.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(DK, 0),
          steps: [
            Roll(0, 1, 1, 'Дал-дал!'),
            Mv(0, C(0, 0), C(1, 0), 0, 'Первый дал — крайняя фишка уходит в средний ряд.'),
            Mv(0, C(0, 1), C(0, 0), 1, 'Второй дал — следующая разворачивается и встаёт на её место.'),
            Roll(0, 3, 4, 'И ещё бросок: III и IIII.'),
            Mv(0, C(1, 0), C(1, 4), 1),
            Mv(0, C(0, 0), C(1, 2), 0, 'Обе надаленные фишки в пути.'),
          ],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Побеждает тот, кто снимет все фишки соперника. Конец бывает долгим, поэтому в короткой партии проигрывает тот,
          у кого осталась одна фишка. Кто начинает, решает пробный бросок — у кого больше.</p>
          <p>Совет из старых описаний: выгодно держать надаленные фишки наготове у носа в своём ряду и в ряду соперника позади
          всех его фишек — оттуда удобно бить.</p>`,
      },
    ],
  },
};

/** Для вида: размеры доски. */
export const dims = (s: State) => ({ H: holes(s.cfg), W: width(s.cfg) });
