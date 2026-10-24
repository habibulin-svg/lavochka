/* Царская игра Ура — описание игры: гонка по доске из царского некрополя Ура (около 2600 г. до н. э.).
 * Правила — реконструкция Ирвинга Финкеля (Британский музей) и варианты: табличка Итти-Мардука (5 фишек и ставки),
 * набор Вулли с тремя пирамидками, быстрая партия без точного выхода. */
import type { DemoStep, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, HOME, newState, setup, STAKE, toAct, type Action, type Event, type State } from './engine';
import { cellOf, newSkyruk, PIECES, sapply, skyrukCfg, sToAct, CELL_NAME, EXIT, type SAction, type SEvent, type SState } from './skyruk';
import { schoose } from './skyruk-ai';

type AState = State | SState;
type AAction = Action | SAction;
type AEvent = Event | SEvent;
const isSk = (s: AState): s is SState => (s as SState).mode === 'skyruk';
const SK = (o: Record<string, unknown>) => o.rules === 'skyruk';
const NOSK = (o: Record<string, unknown>) => o.rules !== 'skyruk';

export const SEATS = [
  { name: 'Белые', color: '#e9e2cf', light: '#fbf7ec', dark: '#9d927a', ink: '#6a6047' },
  { name: 'Чёрные', color: '#3a3a40', light: '#5c5c66', dark: '#16161a' },
];


function describe(ev: AEvent, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') return `🎲 ${name(ev.seat)}: выпало ${ev.value}${'start' in ev && ev.start ? ' — не единица, бросает соперник' : ev.none ? ' — хода нет' : ''}.`;
  if (ev.type === 'smove') {
    const bits: string[] = [];
    if (ev.hit != null) bits.push(ev.back ? 'ходом назад срубил фишку соперника' : 'срубил фишку соперника');
    if (ev.ret) bits.push('и вернулся обратно');
    if (ev.flipped) bits.push('фишка перевернулась меченой стороной');
    if (ev.again) bits.push('«звезда» — бросает ещё');
    const tail = ev.to === EXIT ? 'фишка вышла' : ev.from === 0 ? `ввёл фишку на ${CELL_NAME(ev.toCell)}` : `${CELL_NAME(ev.fromCell)} → ${CELL_NAME(ev.toCell)}`;
    return `${name(ev.seat)}: ${tail}${bits.length ? ', ' + bits.join(', ') : ''}.`;
  }
  if (ev.type === 'raise') return `${name(ev.seat)}: ${ev.k === 0 ? `перевернул столбик на ${CELL_NAME(ev.cell)}` : `поднял ${ev.k}-ю фишку столбика на ${CELL_NAME(ev.cell)} наверх`}.`;
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

/** Позиция для показа правил Скирюка: [сторона, место пути, меченая, ряд петли]. */
function sk(pl: [number, number, boolean?, number?][], cur = 0, opts: Record<string, unknown> = {}): SState {
  const s = newSkyruk(skyrukCfg(opts as Options));
  s.phase = 'roll';
  s.cur = cur;
  const k = [0, 0];
  for (const [side, p, m, loop] of pl) {
    const id = side * PIECES + k[side]++;
    const x = s.pieces[id];
    x.p = p;
    x.marked = !!m || (p >= 14 && p < EXIT);
    x.loop = p >= 12 && p < EXIT ? (loop ?? (side === 0 ? 2 : 0)) : null;
    if (p > 0 && p < EXIT) s.cells[cellOf(side, p, x.loop)].push(id);
  }
  return s;
}
/** Бросок трёх пирамидок на value (4 — ни одной отмеченной вершины). */
const RS = (seat: number, value: number, caption?: string): DemoStep<AAction> => ({ seat, action: { type: 'roll' }, rig: value === 4 ? [0, 0, 0] : [0, 1, 2].map((i) => (i < value ? 1 : 0)), caption });
const SM = (seat: number, id: number, caption?: string, extra: Partial<{ back: boolean; loop: number }> = {}): DemoStep<AAction> => ({ seat, action: { type: 'move', id, ...extra }, caption });
const skOpts = { rules: 'skyruk' };

export const def: GameDef<AState, AAction, AEvent, AState> = {
  id: 'ur',
  title: 'Царская игра Ура',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'rules',
      label: 'Правила',
      type: 'select',
      choices: [
        { value: 'finkel', label: 'по Финкелю (Британский музей)' },
        { value: 'skyruk', label: 'по Скирюку: петля по малому блоку, переворот фишек' },
      ],
      default: 'finkel',
    },
    { key: 'flip', label: 'Переворот фишки', type: 'select', choices: [{ value: 'b8', label: 'на B8 и дальше (дуэли у клеток превращения)' }, { value: 'wave', label: 'уже на клетке превращения A8/C8' }], default: 'b8', showIf: SK },
    { key: 'back', label: 'Ход назад, чтобы срубить', hint: 'Дополнение Скирюка: назад можно ходить только ради рубки', type: 'toggle', default: true, showIf: SK },
    { key: 'backStar', label: 'Срубил назад на «звезде»', type: 'select', choices: [{ value: 'stay', label: 'остаётся, но без броска' }, { value: 'return', label: 'возвращается, откуда пришёл' }], default: 'stay', showIf: (o) => SK(o) && o.back !== false },
    { key: 'raise', label: 'Подъём в столбике', hint: 'На клетках безопасности: 2–4 очка поднимают свою фишку наверх, 1 — переворот столбика в ответ', type: 'toggle', default: false, showIf: SK },
    { key: 'finishStack', label: 'Столбик меченых на финише B1', hint: 'Выход верхней фишкой — единицей, пустые фишки перепрыгивают финиш', type: 'toggle', default: false, showIf: SK },
    { key: 'pieces', label: 'Фишек у каждого', showIf: NOSK, type: 'select', choices: [{ value: 7, label: '7 — как у Финкеля' }, { value: 5, label: '5 — партия короче' }], default: 7 },
    { key: 'dice', label: 'Пирамидки', showIf: NOSK, type: 'select', choices: [{ value: 4, label: 'четыре: от 0 до 4' }, { value: 3, label: 'три (набор Вулли): от 0 до 3' }], default: 4 },
    { key: 'safe', showIf: NOSK, label: 'Средняя розетка безопасна', hint: 'Фишку на розетке посередине общего ряда нельзя сбить', type: 'toggle', default: true },
    { key: 'exact', showIf: NOSK, label: 'Выход точным броском', hint: 'Выйти можно, только выбросив ровно столько, сколько осталось до выхода', type: 'toggle', default: true },
    { key: 'stakes', showIf: NOSK, label: 'Ставки по табличке', hint: `У каждого ${STAKE} жетонов: проскочил розетку — жетон в кон, встал на розетку — жетон из кона, победитель забирает кон`, type: 'toggle', default: false },
  ],
  presets: [
    { id: 'finkel', label: 'По Финкелю', hint: 'Правила Британского музея: 7 фишек, четыре пирамидки, точный выход', options: { pieces: 7, dice: 4, safe: true, exact: true, stakes: false } },
    { id: 'tablet', label: 'Табличка Итти-Мардука', hint: 'Вавилон, 177 г. до н. э.: 5 фишек и жетоны за розетки', options: { pieces: 5, dice: 4, safe: true, exact: true, stakes: true } },
    { id: 'woolley', label: 'Три пирамидки', hint: 'Как в наборе, найденном Вулли: броски от 0 до 3', options: { pieces: 7, dice: 3, safe: true, exact: true, stakes: false } },
    { id: 'quick', label: 'Быстрая', hint: '5 фишек, выход любым большим броском', options: { pieces: 5, dice: 4, safe: true, exact: false, stakes: false } },
    { id: 'skyruk', label: 'По Скирюку', hint: 'Три пирамидки, петля по малому блоку, переворот фишек, столбики, ход назад для рубки', options: { rules: 'skyruk', flip: 'b8', back: true, backStar: 'stay', raise: false, finishStack: false } },
    { id: 'skyrukfull', label: 'Скирюк: все дополнения', hint: 'Ещё и подъём в столбиках безопасности и столбик меченых на финише', options: { rules: 'skyruk', flip: 'b8', back: true, backStar: 'stay', raise: true, finishStack: true } },
  ],

  setup: (seats, opts) => (SK(opts) ? newSkyruk(skyrukCfg(opts), seats.length === 2 ? seats.map((x) => x.seat) : [0, 1]) : setup(seats.map((x) => x.seat), opts)),
  toAct: (s) => (isSk(s) ? sToAct(s) : toAct(s)),
  apply: (s, seat, a, rng) => (isSk(s) ? sapply(s, seat, a as SAction, rng) : apply(s, seat, a as Action, rng)),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    if (isSk(s)) {
      const out = (x: number) => s.pieces.filter((q) => q.side === x && q.p === EXIT).length;
      return { winners: [s.seats[s.winner]], text: `соперник вывел ${out(1 - s.winner)} из ${PIECES}`, scores: { [s.seats[0]]: out(0), [s.seats[1]]: out(1) } };
    }
    const home = (x: number) => s.pos[x].filter((p) => p === HOME).length;
    const scores = s.cfg.stakes ? { [s.seats[0]]: s.tokens[0], [s.seats[1]]: s.tokens[1] } : { [s.seats[0]]: home(0), [s.seats[1]]: home(1) };
    return { winners: [s.seats[s.winner]], text: s.cfg.stakes ? `жетонов: ${s.tokens[s.winner]}` : `соперник вывел ${home(1 - s.winner)} из ${s.cfg.pieces}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => (isSk(v) ? schoose(v, lv, rng) : choose(v, seat, lv, rng)) },
  describe,

  showcase: () => {
    let s: State = newState(cfgFrom({}));
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
      {
        title: 'По Скирюку: путь и броски',
        html: `<p>Писатель и знаток древних игр Дмитрий Скирюк предложил свою трактовку Ура. Клетки зовут как в шахматах: ряды A, B, C, столбцы 1–8.
          У каждого <b>7 фишек</b>: одна сторона пустая, другая — меченая. Бросают <b>три пирамидки</b>: сколько отмеченных вершин вверх —
          столько очков, а если ни одной — <b>4</b>. Чаще всего выпадают 1 и 2.</p>
          <p>Начинает тот, кто первым выбросит единицу, — ею и ходит. Фишка входит в свою дорожку (единица — на клетку у перемычки, четвёрка —
          сразу на «звезду» в углу), идёт к краю, сворачивает в средний ряд и проходит его до B7, делает <b>петлю по малому блоку</b> —
          заходит слева или справа, как выгоднее, — возвращается на B7 и идёт средним рядом обратно к <b>финишу B1</b>. Ходы обязательны.</p>`,
        demo: {
          seats: demoSeats,
          options: skOpts,
          setup: () => {
            const s = sk([], 0, skOpts);
            s.phase = 'start';
            return s;
          },
          intro: 'Кто первым выбросит единицу, тот начинает.',
          steps: [RS(0, 2, 'Белым — 2, не единица.'), RS(1, 1, 'Чёрным — единица: они и начинают.'), SM(1, 7, 'Первая фишка — на клетку у перемычки.'), RS(0, 4, 'Ни одной отмеченной вершины — 4 очка.'), SM(0, 0, 'Белые входят сразу на «звезду» в углу и бросают ещё.')],
        },
      },
      {
        title: 'По Скирюку: особые клетки',
        html: `<p><b>«Звёзды»</b> (A1, C1, B4, A7, C7) — ещё бросок, его можно сыграть любой фишкой. На «звезде» рубят как везде.</p>
          <p><b>«Четыре глаза»</b> на своей дорожке (A2, A4, C2, C4) — до четырёх своих фишек столбиком. <b>B7</b> — такое же «депо»,
          но его хозяин — кто занял первым: соперник там не рубит и не встаёт, только перепрыгивает. Ушла последняя фишка — B7 снова ничья.</p>
          <p><b>«Четыре пятёрки» B3 и B6</b> — безопасные клетки: до четырёх любых фишек, ходит только верхняя — так запирают чужие.</p>`,
        demo: {
          seats: demoSeats,
          options: skOpts,
          setup: () => sk([[0, 6], [0, 9], [1, 7]], 0, skOpts),
          intro: 'Белые на B2 и B5, чёрная — на безопасной B3.',
          steps: [RS(0, 1, 'Единица.'), SM(0, 0, 'Белая фишка встаёт на B3 поверх чёрной — та заперта.'), RS(1, 2), SM(1, 8, 'Чёрная вводит новую фишку.'), RS(0, 2, 'Белым — 2.'), SM(0, 1, 'С B5 — на B7: теперь B7 белых.')],
        },
      },
      {
        title: 'По Скирюку: пустые и меченые',
        html: `<p>Фишка входит пустой стороной вверх и переворачивается меченой, когда доходит до центра малого блока <b>B8</b> или проходит его.
          <b>Пустые и меченые друг друга не рубят</b> и не встают друг на друга (кроме столбиков на особых клетках): по среднему ряду
          фишки идут навстречу и проходят мимо. Поэтому у клеток превращения A8 и C8 бывают <b>дуэли</b>: пустые фишки там не боятся
          меченых, а срубить друг друга смогут только на B8, когда обе станут мечеными.</p>
          <p>Вариант: переворачиваться уже на клетке превращения A8/C8.</p>`,
        demo: {
          seats: demoSeats,
          options: skOpts,
          setup: () => sk([[0, 13, false, 2], [1, 14, true, 0], [1, 4]], 0, skOpts),
          intro: 'Белая фишка на C8, чёрная — уже меченая — на B8.',
          steps: [RS(0, 1, 'Единица.'), SM(0, 0, 'Белая встаёт на B8, переворачивается — и рубит меченую чёрную.')],
        },
      },
      {
        title: 'По Скирюку: ход назад',
        html: `<p>Дополнение Скирюка: назад можно ходить <b>только чтобы срубить</b> фишку соперника (такого же вида — пустую пустой,
          меченую меченой). Срубивший ходом назад на «звезде» дополнительного броска не получает. Вариант: после такой рубки фишка
          возвращается туда, откуда пришла.</p>`,
        demo: {
          seats: demoSeats,
          options: skOpts,
          setup: () => sk([[0, 9], [1, 6]], 0, skOpts),
          intro: 'Белая на B5, пустая чёрная — на три клетки позади, на B2.',
          steps: [RS(0, 3, 'Белым — 3.'), SM(0, 0, 'Ходом назад на B2 — чёрная срублена и вернулась в начало.', { back: true })],
        },
      },
      {
        title: 'По Скирюку: финиш',
        html: `<p>Сойти с доски можно с любой из четырёх последних клеток (B4…B1), но только <b>точным</b> броском — на одно очко больше,
          чем осталось клеток. Больше выпало — ходите другой фишкой. Меченую фишку на финише B1 уже никто не срубит, но встать туда она
          не может, если там стоит пустая (своя или чужая). Кто первым вывел все семь фишек — победил.</p>
          <p><b>Дополнения</b>: на клетках безопасности можно <b>поднимать</b> свою фишку в столбике (2, 3, 4 очка — фишку с этого места
          сверху — наверх; единицей — перевернуть весь столбик, если соперник только что поднимал); меченые фишки могут вставать на
          финише столбиком до четырёх — тогда выходит верхняя, и только единицей.</p>`,
        demo: {
          seats: demoSeats,
          options: skOpts,
          setup: () => sk([[0, 21], [0, 23], [1, 3]], 0, skOpts),
          intro: 'Белые меченые на B3 и на финише B1.',
          steps: [RS(0, 3, 'Тройка: с B3 — ровно на выход.'), SM(0, 0, 'Фишка сошла с доски.'), RS(1, 2, 'Чёрной на B1 не встать — там меченая белая.'), SM(1, 8, 'Чёрные вводят новую фишку.'), RS(0, 1, 'Единица — с B1 на выход.'), SM(0, 1, 'Вторая вышла.')],
        },
      },
    ],
  },
};
