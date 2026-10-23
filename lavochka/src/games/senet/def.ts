/* Сенет — описание игры: древнеегипетская гонка по доске 3×10 («игра прохождения»). Правила — реконструкция Тимоти Кендалла
 * (1978), у Белла — по десять фишек на двух первых рядах; простая — без обязательной остановки и точного выхода.
 * Доска — синий фаянс (Аменхотеп III) или слоновая кость с ящиком (Тутанхамон). */
import type { DemoStep, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, OFF, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Конусы', color: '#ece3c8', light: '#fffaf0', dark: '#a3946c', ink: '#6e6040' },
  { name: 'Катушки', color: '#2c3f8a', light: '#4a64c4', dark: '#14204a' },
];

const sq = (p: number) => (p === OFF ? 'за доску' : `на ${p}`);

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') return `🥢 ${name(ev.seat)}: ${ev.value}${ev.none ? ' — хода нет' : ''}${ev.again ? ', бросает ещё' : ''}.`;
  if (ev.type === 'move') {
    let t = `${name(ev.seat)}: ${ev.from} → ${sq(ev.to)}`;
    if (ev.back) t += ' (назад — вперёд хода не было)';
    if (ev.swap) t += ', поменялся местами с фишкой соперника';
    if (ev.water) t += `, «Вода» — фишка уплыла на ${ev.water}`;
    if (ev.to === OFF) t = `${name(ev.seat)}: фишка ушла с доски с ${ev.from}`;
    return t + '.';
  }
  if (ev.type === 'end') return `🏁 Все фишки прошли — победа: ${name(ev.winner)}.`;
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция: клетки фишек сторон, сколько уже вышло, кто ходит. */
function pos(a: number[], b: number[], cur = 0, off: [number, number] = [0, 0], opts: Record<string, any> = {}): State {
  const s = newState(cfgFrom(opts));
  s.board.fill(-1);
  for (const p of a) s.board[p] = 0;
  for (const p of b) s.board[p] = 1;
  s.off = off;
  s.cur = cur;
  return s;
}
/** Бросок палочек на value очков (5 — все тёмной стороной). */
const R = (seat: number, value: number, caption?: string): DemoStep<Action> => ({
  seat,
  action: { type: 'roll' },
  rig: [0, 1, 2, 3].map((i) => (value < 5 && i < value ? 1 : 0)),
  caption,
});
const Mv = (seat: number, from: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'move', from }, caption });

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
  id: 'senet',
  title: 'Сенет',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'pieces',
      label: 'Фишек у каждого',
      type: 'select',
      choices: [
        { value: 5, label: '5 — как у Кендалла' },
        { value: 7, label: '7 — первое издание Кендалла' },
        { value: 10, label: '10 — по Беллу, два ряда' },
      ],
      default: 5,
    },
    { key: 'stop', label: 'На «Дом красоты» встать обязательно', hint: 'Клетку 26 нельзя перепрыгнуть — каждая фишка сначала встаёт на неё', type: 'toggle', default: true },
    { key: 'exact', label: 'Выход точным броском', hint: 'Уйти с доски можно, только выбросив ровно столько, сколько до выхода', type: 'toggle', default: true },
    {
      key: 'look',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'faience', label: 'синий фаянс (Аменхотеп III)' },
        { value: 'ivory', label: 'слоновая кость (Тутанхамон)' },
      ],
      default: 'faience',
    },
  ],
  presets: [
    { id: 'kendall', label: 'По Кендаллу', hint: 'Самая известная реконструкция: 5 фишек, остановка на 26, точный выход', options: { pieces: 5, stop: true, exact: true, look: 'faience' } },
    { id: 'kendall7', label: 'Кендалл, 7 фишек', hint: 'Как в первом издании 1978 года — партия длиннее', options: { pieces: 7, stop: true, exact: true, look: 'ivory' } },
    { id: 'bell', label: 'По Беллу', hint: 'По десять фишек на двух первых рядах, 26-ю можно перепрыгнуть', options: { pieces: 10, stop: false, exact: true, look: 'faience' } },
    { id: 'simple', label: 'Простой', hint: '5 фишек, без обязательной остановки и точного выхода — для первого знакомства', options: { pieces: 5, stop: false, exact: false, look: 'ivory' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    const scores = { [s.seats[0]]: s.off[0], [s.seats[1]]: s.off[1] };
    return { winners: [s.seats[s.winner]], text: `вывел ${s.off[s.winner]} из ${s.cfg.pieces}, соперник — ${s.off[1 - s.winner]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(5);
    for (let i = 0; i < 70 && s.phase !== 'over'; i++) {
      const a = choose(s, s.seats[s.cur], 2, rng);
      if (!a) break;
      s = apply(s, s.seats[s.cur], a, rng)!.state;
    }
    if (s.phase === 'over') s = newState(cfgFrom({}));
    if (s.phase === 'roll') s = apply(s, s.seats[s.cur], { type: 'roll' }, rng)!.state;
    return s;
  },

  rules: {
    goal: 'Первым провести все свои фишки через тридцать клеток и вывести их с доски.',
    sections: [
      {
        title: 'Доска, фишки и палочки',
        html: `<p>В сенет играли в Египте больше трёх тысяч лет; доски клали в гробницы — четыре нашлись у Тутанхамона.
          Правил не сохранилось, их восстанавливают по рисункам и надписям; здесь — реконструкция Тимоти Кендалла.</p>
          <p>Доска — 3 ряда по 10 клеток, путь идёт <b>змейкой</b>: первый ряд слева направо, второй — справа налево, третий — снова слева направо.
          Фишки стоят через одну на первых клетках: конусы на нечётных, катушки на чётных. Первыми ходят конусы.</p>
          <p>Бросают четыре палочки: число светлых сторон — очки хода, а если светлых нет — <b>5</b>. На 1, 4 и 5 бросают ещё раз.
          За бросок ходят одной фишкой ровно на выпавшее число клеток.</p>`,
        demo: { seats: demoSeats, intro: 'Начальная расстановка: фишки через одну.', steps: [R(0, 2, 'Две светлые палочки — 2.'), Mv(0, 9, 'Передний конус ушёл на 11-ю — на второй ряд.'), R(1, 4, 'Четыре светлые — 4, катушки бросят ещё.'), Mv(1, 10, 'Передняя катушка — на 14-ю.'), R(1, 3), Mv(1, 8, 'Катушка встала на 11-ю — конус отошёл на её место.')] },
      },
      {
        title: 'Обмен и защита',
        html: `<p>Встал на клетку с чужой фишкой — вы <b>меняетесь местами</b>: она отходит туда, откуда пришла ваша.
          На свою фишку вставать нельзя.</p>
          <p>Две чужие фишки подряд <b>защищены</b> — их не трогают. Три подряд — <b>стена</b>: её нельзя перепрыгнуть.
          Если вперёд пойти нечем, нужно пойти назад; если нельзя и назад — бросок пропадает.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([5, 9, 12], [7, 13, 14, 18, 19, 20], 0),
          intro: 'У катушек одиночка на 7-й и стена 18–19–20.',
          steps: [R(0, 2, 'Выпало 2.'), Mv(0, 5, 'Конус встал на 7-ю — катушка отошла на 5-ю.'), R(1, 3), Mv(1, 5, 'Катушка уходит с 5-й на 8-ю. Конус на 12-й к паре 13–14 не подойдёт: она защищена.')],
        },
      },
      {
        title: 'Дома в конце пути',
        html: `<p>Клетки с рисунками — особые. На <b>15-й</b> («Дом возрождения») и на домах 26, 28, 29, 30 фишку не бьют.</p>
          <ul><li><b>26 — «Дом красоты»</b>: на него обязательно встать, перепрыгнуть нельзя.</li>
          <li><b>27 — «Вода»</b>: фишка тонет и возвращается на 15-ю (если занято — на ближайшую свободную перед ней).</li>
          <li><b>28, 29, 30</b> — «Три истины», «Две истины», «Ра»: отсюда уходят с доски тройкой, двойкой и единицей.</li></ul>
          <p>С 26-й уходят пятёркой. Выход — только броском ровно за доску. Кто первым вывел все фишки — победил.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([24, 26], [22, 29], 0, [3, 3]),
          intro: 'Конусы на 24-й и на «Доме красоты».',
          steps: [R(0, 1, 'Единица.'), Mv(0, 26, 'С 26-й на «Воду» — фишка уплыла на 15-ю.'), R(0, 2), Mv(0, 24, 'С 24-й — ровно на 26-ю.'), R(1, 2, 'Катушкам 2.'), Mv(1, 29, 'С 29-й двойкой — за доску.')],
        },
      },
      {
        title: 'Варианты',
        html: `<p><b>Кендалл, 7 фишек</b> — как в первом издании его правил: фишки занимают первые 14 клеток, партия длиннее.</p>
          <p><b>По Беллу</b> — у каждого 10 фишек на двух первых рядах, «Дом красоты» можно перепрыгнуть.</p>
          <p><b>Простой</b> — без обязательной остановки на 26 и без точного выхода: любой бросок, которого хватает, уводит фишку с доски.</p>
          <p>Реконструкцию Жекье не делали: от неё остались только общие слова, правил для игры по ней нет.</p>`,
      },
    ],
  },
};
