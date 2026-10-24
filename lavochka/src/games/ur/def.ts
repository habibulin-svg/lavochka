/* Царская игра Ура — описание игры: гонка по доске из царского некрополя Ура (около 2600 г. до н. э.).
 * Правила — реконструкция Ирвинга Финкеля (Британский музей) и варианты: табличка Итти-Мардука (5 фишек и ставки),
 * набор Вулли с тремя пирамидками, быстрая партия без точного выхода. */
import type { DemoStep, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, HOME, newState, setup, STAKE, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e9e2cf', light: '#fbf7ec', dark: '#9d927a', ink: '#6a6047' },
  { name: 'Чёрные', color: '#3a3a40', light: '#5c5c66', dark: '#16161a' },
];


function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') return `🎲 ${name(ev.seat)}: выпало ${ev.value}${ev.none ? ' — хода нет' : ''}.`;
  if (ev.type === 'move') {
    const bits: string[] = [];
    if (ev.hit) bits.push('сбил фишку соперника');
    if (ev.again) bits.push('розетка — бросает ещё');
    if (ev.paid) bits.push(`проскочил розетку — ${ev.paid} в кон`);
    if (ev.took) bits.push('взял жетон из кона');
    const tail = ev.to === HOME ? 'фишка вышла' : ev.from === 0 ? `вошёл на ${ev.to}-ю` : `${ev.from} → ${ev.to}`;
    return `${name(ev.seat)}: ${tail}${bits.length ? ', ' + bits.join(', ') : ''}.`;
  }
  if (ev.type === 'end') return `🏁 Все фишки прошли путь — победа: ${name(ev.winner)}.`;
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция для показа: клетки фишек сторон (недостающие — не вошли), кто ходит. */
function pos(white: number[], black: number[], cur = 0, opts: Record<string, any> = {}): State {
  const s = newState(cfgFrom(opts));
  const fill = (a: number[]) => [...a, ...Array(s.cfg.pieces - a.length).fill(0)];
  s.pos = [fill(white), fill(black)];
  s.cur = cur;
  return s;
}
/** Бросок с подкрученными пирамидками: value отмеченных вершин вверх из n. */
const R = (seat: number, value: number, caption?: string, n = 4): DemoStep<Action> => ({
  seat,
  action: { type: 'roll' },
  rig: Array.from({ length: n }, (_, i) => (i < value ? 1 : 0)),
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
  id: 'ur',
  title: 'Царская игра Ура',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    { key: 'pieces', label: 'Фишек у каждого', type: 'select', choices: [{ value: 7, label: '7 — как у Финкеля' }, { value: 5, label: '5 — партия короче' }], default: 7 },
    { key: 'dice', label: 'Пирамидки', type: 'select', choices: [{ value: 4, label: 'четыре: от 0 до 4' }, { value: 3, label: 'три (набор Вулли): от 0 до 3' }], default: 4 },
    { key: 'safe', label: 'Средняя розетка безопасна', hint: 'Фишку на розетке посередине общего ряда нельзя сбить', type: 'toggle', default: true },
    { key: 'exact', label: 'Выход точным броском', hint: 'Выйти можно, только выбросив ровно столько, сколько осталось до выхода', type: 'toggle', default: true },
    { key: 'stakes', label: 'Ставки по табличке', hint: `У каждого ${STAKE} жетонов: проскочил розетку — жетон в кон, встал на розетку — жетон из кона, победитель забирает кон`, type: 'toggle', default: false },
  ],
  presets: [
    { id: 'finkel', label: 'По Финкелю', hint: 'Правила Британского музея: 7 фишек, четыре пирамидки, точный выход', options: { pieces: 7, dice: 4, safe: true, exact: true, stakes: false } },
    { id: 'tablet', label: 'Табличка Итти-Мардука', hint: 'Вавилон, 177 г. до н. э.: 5 фишек и жетоны за розетки', options: { pieces: 5, dice: 4, safe: true, exact: true, stakes: true } },
    { id: 'woolley', label: 'Три пирамидки', hint: 'Как в наборе, найденном Вулли: броски от 0 до 3', options: { pieces: 7, dice: 3, safe: true, exact: true, stakes: false } },
    { id: 'quick', label: 'Быстрая', hint: '5 фишек, выход любым большим броском', options: { pieces: 5, dice: 4, safe: true, exact: false, stakes: false } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    const home = (x: number) => s.pos[x].filter((p) => p === HOME).length;
    const scores = s.cfg.stakes ? { [s.seats[0]]: s.tokens[0], [s.seats[1]]: s.tokens[1] } : { [s.seats[0]]: home(0), [s.seats[1]]: home(1) };
    return { winners: [s.seats[s.winner]], text: s.cfg.stakes ? `жетонов: ${s.tokens[s.winner]}` : `соперник вывел ${home(1 - s.winner)} из ${s.cfg.pieces}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(11);
    for (let i = 0; i < 46 && s.phase !== 'over'; i++) {
      const a = choose(s, s.seats[s.cur], 2, rng);
      if (!a) break;
      s = apply(s, s.seats[s.cur], a, rng)!.state;
    }
    if (s.phase === 'over') s = newState(cfgFrom({}));
    if (s.phase === 'roll') {
      s = apply(s, s.seats[s.cur], { type: 'roll' }, rng)!.state;
    }
    return s;
  },

  rules: {
    goal: 'Первым провести все свои фишки по пути через доску и вывести их с неё.',
    sections: [
      {
        title: 'Доска и путь',
        html: `<p>Этой игре около 4500 лет: доску нашёл Леонард Вулли в царских гробницах Ура, правила по клинописной табличке
          восстановил Ирвинг Финкель из Британского музея. Доска на экране — снимок подлинника из музея (фото BabelStone, CC0).</p>
          <p>У каждого игрока свой крайний ряд. Фишка входит на доску в своём ряду у перемычки, идёт к краю большого блока
          (клетки 1–4), спускается в <b>средний ряд</b> и проходит его целиком (5–12), затем возвращается по своему ряду малого блока (13–14)
          и выходит. Средний ряд — общий: там фишки соперников встречаются.</p>
          <p>Бросают четыре пирамидки; у каждой отмечены две вершины из четырёх. Сколько отмеченных вершин смотрит вверх — на столько клеток
          и ход, от 0 до 4. Чаще всего выпадает 2. За бросок ходят <b>одной</b> фишкой: вводят новую или двигают стоящую. Ноль — ход пропал.</p>`,
        demo: { seats: demoSeats, intro: 'Доска пуста, все фишки у игроков.', steps: [R(0, 2, 'Выпало 2.'), Mv(0, 0, 'Новая фишка встаёт на вторую клетку своего ряда.'), R(1, 3, 'У чёрных — 3.'), Mv(1, 0, 'Чёрная фишка входит на третью клетку.'), R(0, 0, 'Ноль — ход пропадает.')] },
      },
      {
        title: 'Розетки',
        html: `<p>Пять клеток помечены <b>розетками</b> — восьмилепестковыми цветами. Встал на розетку — бросай ещё раз.
          У каждого на пути три розетки: в углу своего ряда (4-я клетка), посередине общего ряда (8-я) и в конце пути (14-я).</p>
          <p>Розетка посередине — самая ценная: фишку на ней <b>нельзя сбить</b>, а соперник не может туда встать.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([1, 6], [3]),
          intro: 'Белая фишка в трёх клетках от угловой розетки.',
          steps: [R(0, 3, 'Выпало 3.'), Mv(0, 1, 'Фишка на розетке — бросок ещё раз.'), R(0, 2), Mv(0, 6, 'Вторая фишка встала на среднюю розетку — тут её не тронут.')],
        },
      },
      {
        title: 'Бой',
        html: `<p>В общем ряду можно встать на клетку с фишкой соперника — она <b>сбита</b> и возвращается к хозяину, начинать путь заново.
          На свою фишку вставать нельзя. В своём ряду фишки в безопасности — соперник туда не заходит.</p>
          <p>Если ходить нечем (все ходы упираются в свои фишки или в занятую среднюю розетку) — ход пропадает.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([5, 2], [7, 8], 0),
          intro: 'Чёрные стоят на 7-й клетке и на средней розетке.',
          steps: [R(0, 2, 'Белым выпало 2.'), Mv(0, 5, 'Сбили чёрную фишку — она вернулась в начало.'), R(1, 1, 'Чёрные бросают: 1.'), Mv(1, 8, 'Чёрная фишка уходит с розетки дальше.')],
        },
      },
      {
        title: 'Выход',
        html: `<p>Выйти с доски можно только <b>точным</b> броском: с 14-й клетки — единицей, с 13-й — двойкой и так далее.
          Лишние очки не годятся. Кто первым вывел все фишки — победил.</p>
          <p>В <b>быстрой</b> партии точности не нужно: любой бросок, которого хватает до выхода, выводит фишку.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([13, 11, 15, 15, 15, 15, 15], [10, 12, 15, 15, 15, 15, 15], 0),
          intro: 'Обоим осталось по две фишки.',
          steps: [R(0, 2, 'Двойка — ровно столько, сколько нужно 13-й.'), Mv(0, 13, 'Фишка вышла.'), R(1, 3), Mv(1, 12, 'Чёрные выводят фишку с 12-й тройкой.')],
        },
      },
      {
        title: 'Варианты',
        html: `<p><b>Табличка Итти-Мардука</b> — правила, которые вавилонский писец записал в 177 году до н. э.: по пять фишек и жетоны.
          У каждого ${STAKE} жетонов; проскочил розетку, не встав на неё, — жетон в кон, встал на розетку — жетон из кона.
          Победитель забирает весь кон.</p>
          <p><b>Три пирамидки</b> — так было в одном из наборов Вулли: броски от 0 до 3, ноль выпадает чаще.
          Можно отключить и безопасность средней розетки — так играют по разбору Джеймса Мастерса.</p>`,
        demo: {
          seats: demoSeats,
          options: { pieces: 5, stakes: true },
          setup: () => {
            const s = pos([2, 6], [10], 0, { pieces: 5, stakes: true });
            s.pool = 1;
            s.tokens = [STAKE - 1, STAKE];
            return s;
          },
          intro: 'В коне один жетон.',
          steps: [R(0, 3, 'Выпало 3.'), Mv(0, 6, 'Фишка проскочила среднюю розетку — жетон в кон.'), R(1, 3), Mv(1, 10, 'Чёрная фишка уходит в свой ряд.'), R(0, 2), Mv(0, 2, 'Белые встали на угловую розетку и забрали жетон.')],
        },
      },
    ],
  },
};
