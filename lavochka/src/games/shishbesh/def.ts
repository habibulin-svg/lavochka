/* Шиш-беш — описание игры для сборника: правила, боты, показ правил. Без DOM. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { chooseMove } from './ai';
import { applyMove, applyRoll, cfgFrom, DEFAULT_CFG, newGame, type Action, type Cfg, type Event, type State } from './engine';
import { chooseL } from '../ludo/ai';
import { applyLMove, applyLRoll, isL, lcfgFrom, lToAct, newLGame, type LAction, type LEvent, type LState } from '../ludo/engine';
import { chooseC } from '../chaupar/ai';
import { applyCMove, applyCRoll, ccfgFrom, cToAct, GOAL, GRACE, isC, newCGame, throwDice, type CAction, type CEvent, type CState } from '../chaupar/engine';

/** Людо и парчис играются на своих досках своим движком (src/games/ludo), чаупар и пачиси — своим (src/games/chaupar);
 * шиш-беш — этим. */
type AnyState = State | LState | CState;
type AnyAction = Action | LAction | CAction;
type AnyEvent = Event | LEvent | CEvent;
const isLudoOpts = (o: { game?: unknown }) => o.game === 'ludo' || o.game === 'parchis';
const isShishOpts = (o: { game?: unknown }) => (o.game ?? 'shishbesh') === 'shishbesh';

export const SEATS = [
  { name: 'Красный', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Зелёный', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Жёлтый', color: '#d9a521', light: '#f3cf62', dark: '#8a6410' },
  { name: 'Синий', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
];

const AGAIN: Record<string, string> = { double: 'Дубль', capture: 'За срубленную фишку', both: 'Дубль и рубка' };

function describeL(ev: LEvent, name: (seat: number) => string): string {
  const lines: string[] = [];
  const who = name(ev.seat);
  if (ev.type === 'roll') {
    lines.push(`${who} выбросил <b>${ev.die}</b>${ev.value !== ev.die ? ` — ходит на ${ev.value}` : ''}`);
    if (ev.burnt) lines.push(ev.penalty ? '<i>Третья шестёрка подряд — фишка, ходившая последней, идёт домой.</i>' : '<i>Третья шестёрка подряд — ход сгорает.</i>');
    else if (ev.noMoves) lines.push('<i>Ходов нет.</i>');
  } else {
    let t = ev.from < 0 ? `${who} выводит фишку` : ev.bonus ? `${who} ходит бонусом на ${ev.gain}` : `${who} ходит на ${ev.steps}`;
    if (ev.goal) t += ' и доводит её до центра';
    if (ev.captured.length) t += ' и рубит ' + ev.captured.map((c) => name(c.seat)).join(', ') + '!';
    lines.push(t);
    if (ev.win) lines.push(`🏆 ${who} довёл все фишки!`);
  }
  if (ev.again && !(ev.type === 'move' && ev.win)) lines.push(`<i>${name(ev.next)} бросает ещё раз.</i>`);
  return lines.join('<br>');
}

const AGAIN_C: Record<string, string> = { triple: 'Три одинаковые', grace: 'Милость', capture: 'За срубленную фишку' };

function describeC(ev: CEvent, name: (seat: number) => string): string {
  const lines: string[] = [];
  const who = name(ev.seat);
  if (ev.type === 'roll') {
    if (ev.shells) {
      const up = ev.shells.filter(Boolean).length;
      lines.push(`${who}: каури ртом вверх — ${up}, это <b>${ev.dice[0]}</b>${GRACE.includes(ev.dice[0]) ? ' — <b>милость!</b>' : ''}`);
    } else lines.push(`${who} бросил пасы: <b>${ev.dice.join(' · ')}</b>`);
    if (ev.noMoves) lines.push('<i>Ходов нет.</i>');
  } else {
    let t = ev.from < 0 ? `${who} вводит фишку на поле` : ev.home ? `${who} доводит фишку до центра (${ev.value})` : `${who} ходит на ${ev.value}`;
    if (ev.castle && ev.from >= 0) t += ' и встаёт в замок';
    if (ev.captured.length) t += ' и рубит ' + ev.captured.map((c) => name(c.seat)).join(', ') + '!';
    lines.push(t);
    if (ev.forfeit) lines.push('<i>Остальные кости сгорают — ходить нечем.</i>');
    if (ev.done) lines.push(`<i>${who} довёл все фишки и ждёт союзника.</i>`);
    if (ev.win) lines.push(`🏆 ${who} — все фишки в центре!`);
  }
  const te = ev.turnEnd;
  if (te && te.again) lines.push(`<i>${AGAIN_C[te.reason || ''] || 'Ещё бросок'} — ${name(te.next)} бросает ещё раз.</i>`);
  return lines.join('<br>');
}

function describe(ev0: AnyEvent, name: (seat: number) => string): string {
  if ((ev0 as LEvent).lg) return describeL(ev0 as LEvent, name);
  if ((ev0 as CEvent).ch) return describeC(ev0 as CEvent, name);
  const ev = ev0 as Event;
  const lines: string[] = [];
  if (ev.type === 'roll') {
    const dbl = ev.dice[1] && ev.dice[0] === ev.dice[1] ? ' — <b>дубль!</b>' : '';
    lines.push(`${name(ev.seat)} выбросил <b>${ev.dice[1] ? `${ev.dice[0]}:${ev.dice[1]}` : ev.dice[0]}</b>${dbl}`);
    if (ev.retry) lines.push(`<i>Не вышло. Быстрый заряд — ещё ${ev.retry === 1 ? 'одна попытка' : ev.retry + ' попытки'}.</i>`);
    else if (ev.noMoves) lines.push('<i>Ходов нет.</i>');
  } else {
    const who = name(ev.seat);
    let t: string;
    if (ev.kind === 'enter') t = `${who} выводит фишку на старт`;
    else if (ev.kind === 'jump') t = `${who} прыгает с угла по ${ev.value === 1 ? 'прямой' : 'диагонали'} (${ev.value})`;
    else if (ev.homeIn) t = `${who} заводит фишку в домик (${ev.value})`;
    else if (ev.value >= 10 && ev.value % 10 === 0) t = `${who} ходит бонусом на ${ev.value}`;
    else t = `${who} ходит на ${ev.value}`;
    if (ev.house) t += ' и занимает домик';
    if (ev.captured.length) t += ' и рубит ' + ev.captured.map((c) => name(c.seat)).join(', ') + '!';
    lines.push(t);
    if (ev.forfeit) lines.push('<i>Второй кубик сгорает — ходить нечем.</i>');
    if (ev.win) lines.push(`🏆 ${who} завёл все фишки в домик!`);
  }
  const te = ev.turnEnd;
  if (te && te.again && !(ev.type === 'move' && ev.win)) lines.push(`<i>${AGAIN[te.reason || ''] || 'Ещё бросок'} — ${name(te.next)} бросает ещё раз.</i>`);
  return lines.join('<br>');
}

// ---------- показ правил ----------

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Красный', level: 1 },
  { seat: 1, kind: 'bot', name: 'Зелёный', level: 1 },
];

/** Позиция для показа: фишки красного и зелёного, ход красного. */
function pos(red: number[], green: number[], cfg: Cfg = DEFAULT_CFG): State {
  return {
    cfg,
    players: [
      { seat: 0, pieces: red, house: red.map(() => false) },
      { seat: 1, pieces: green, house: green.map(() => false) },
    ],
    cur: 0,
    phase: 'roll',
    dice: [0, 0],
    used: [true, true],
    bonus: false,
    winner: null,
    turn: 1,
  };
}

/** Кубики для подкрутки: dice(6, 4) → значения rng.int(6). */
const dice = (a: number, b: number) => [a - 1, b - 1];

/** Позиция людо/парчиса для показа: фишки красного и зелёного, ход красного. */
function lpos(kind: 'ludo' | 'parchis', red: number[], green: number[], extra: Record<string, unknown> = {}): LState {
  const s = newLGame([0, 1], lcfgFrom({ game: kind, ...extra }));
  s.pieces[0] = red;
  s.pieces[1] = green;
  s.cur = s.seats.indexOf(0);
  return s;
}

/** Позиция чаупара для показа: фишки по местам, ход первого. */
function cpos(pieces: Record<number, number[]>, throws: 'pasa' | 'cowrie' = 'pasa', pairs = true): CState {
  const n = throws === 'pasa' ? 3 : 1;
  return {
    ch: true,
    cfg: { throws, pairs },
    players: Object.entries(pieces).map(([seat, p]) => ({ seat: Number(seat), pieces: p })),
    cur: 0,
    phase: 'roll',
    dice: Array(n).fill(0),
    used: Array(n).fill(true),
    bonus: false,
    winner: null,
    turn: 1,
  };
}
/** Пасы для подкрутки: pasa(6, 5, 2) → индексы граней 1, 2, 5, 6. */
const pasa = (...v: number[]) => v.map((x) => [1, 2, 5, 6].indexOf(x));
/** Каури для подкрутки: сколько раковин ртом вверх. */
const cowries = (up: number) => Array.from({ length: 6 }, (_, i) => (i < up ? 1 : 0));
const quadSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Красный', level: 1 },
  { seat: 1, kind: 'bot', name: 'Зелёный', level: 1 },
  { seat: 2, kind: 'bot', name: 'Жёлтый', level: 1 },
  { seat: 3, kind: 'bot', name: 'Синий', level: 1 },
];

export const def: GameDef<AnyState, AnyAction, AnyEvent, AnyState> = {
  id: 'shishbesh',
  title: 'Шиш-беш',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  seatsFor: (n) => ({ 2: [3, 1], 3: [3, 0, 1], 4: [3, 0, 1, 2] })[n] ?? [3, 0, 1, 2],

  options: [
    {
      key: 'game',
      label: 'Правила',
      type: 'select',
      choices: [
        { value: 'shishbesh', label: 'шиш-беш — два кубика, углы, укрытия' },
        { value: 'ludo', label: 'людо — своя доска, выход на 6' },
        { value: 'parchis', label: 'парчис — испанская доска, выход на 5, барьеры, бонусы' },
        { value: 'chaupar', label: 'чаупар — индийский вышитый крест, пасы или каури' },
      ],
      default: 'shishbesh',
    },
    {
      key: 'ludoBonus',
      label: 'Ещё бросок за рубку и за фишку в доме',
      type: 'toggle',
      default: false,
      showIf: (o) => o.game === 'ludo',
    },
    {
      key: 'ludoBlocks',
      label: 'Блоки',
      type: 'toggle',
      default: false,
      hint: 'Две свои фишки на клетке — ни пройти, ни срубить.',
      showIf: (o) => o.game === 'ludo',
    },
    {
      key: 'throws',
      label: 'Чем бросать',
      type: 'select',
      choices: [
        { value: 'pasa', label: 'три длинные кости-пасы (1, 2, 5, 6)' },
        { value: 'cowrie', label: 'шесть раковин каури — пачиси' },
      ],
      default: 'pasa',
      showIf: (o) => o.game === 'chaupar',
    },
    {
      key: 'pairs',
      label: 'Вчетвером — пары',
      type: 'toggle',
      default: true,
      hint: 'Сидящие напротив — союзники: друг друга не рубят, побеждают вместе.',
      showIf: (o) => o.game === 'chaupar',
    },
    {
      key: 'arm',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 5, label: 'обычное: 5 клеток в плече' },
        { value: 6, label: 'длинное: 6 клеток в плече' },
      ],
      default: 5,
      hint: 'На длинном поле круг 56 клеток, а домик — 5 клеток.',
      showIf: isShishOpts,
    },
    {
      key: 'houses',
      label: 'Домики-укрытия',
      type: 'select',
      choices: [
        { value: 'opposite', label: 'напротив друг друга' },
        { value: 'alternate', label: 'через один (лесенкой)' },
      ],
      default: 'opposite',
      showIf: isShishOpts,
    },
    {
      key: 'start',
      label: 'Выход из парка',
      type: 'select',
      choices: [
        { value: 'six', label: 'на шестёрку' },
        { value: 'double', label: 'на дубль' },
        { value: 'both', label: 'на шестёрку или дубль' },
      ],
      default: 'six',
      showIf: isShishOpts,
    },
    {
      key: 'quick',
      label: 'Быстрый заряд',
      type: 'toggle',
      default: false,
      hint: 'Пока на поле нет ни одной своей фишки, на выход даётся три броска подряд.',
      showIf: isShishOpts,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классический', options: { arm: 5, houses: 'opposite', start: 'six' } },
    { id: 'long', label: 'Длинное поле', hint: 'Плечо креста на клетку длиннее', options: { arm: 6, houses: 'opposite', start: 'six' } },
    { id: 'alternate', label: 'Домики через один', hint: 'Укрытия на луче не напротив, а со сдвигом на клетку', options: { arm: 5, houses: 'alternate', start: 'six' } },
    { id: 'double', label: 'Старт на дубль', hint: 'Фишка выходит из парка только на дубль', options: { arm: 5, houses: 'opposite', start: 'double' } },
    { id: 'ludo', label: 'Людо', hint: 'Своя доска, один кубик, выход и ещё бросок на 6, безопасные звёзды', options: { game: 'ludo', ludoBonus: false, ludoBlocks: false } },
    { id: 'ludoplus', label: 'Людо с бонусами', hint: 'Ещё бросок за рубку и за дом, блоки из двух фишек', options: { game: 'ludo', ludoBonus: true, ludoBlocks: true } },
    { id: 'chaupar', label: 'Чаупар', hint: 'Индийский крест 3 × 8: три кости-пасы, замки, вход на шестёрку, вчетвером — пары', options: { game: 'chaupar', throws: 'pasa', pairs: true } },
    { id: 'pachisi', label: 'Пачиси', hint: 'Тот же крест, но бросают шесть каури: 25, 10 и 6 — «милость»', options: { game: 'chaupar', throws: 'cowrie', pairs: true } },
    { id: 'parchis', label: 'Парчис', hint: 'Испанская доска на 68 клеток: выход на 5, барьеры, +20 за рубку и +10 за дом', options: { game: 'parchis' } },
  ],

  setup: (seats, opts, rng) =>
    opts.game === 'chaupar'
      ? newCGame(seats.map((s) => s.seat), rng, ccfgFrom(opts))
      : isLudoOpts(opts)
        ? newLGame(seats.map((s) => s.seat), lcfgFrom(opts))
        : newGame(seats.map((s) => s.seat), rng, cfgFrom(opts)),

  toAct: (s) => (isL(s) ? lToAct(s) : isC(s) ? cToAct(s) : s.phase === 'over' ? [] : [s.players[s.cur].seat]),

  apply(s0, seat, a0, rng: Rng) {
    if (isC(s0)) {
      if (s0.phase === 'over' || s0.players[s0.cur].seat !== seat) return null;
      const a = a0 as CAction;
      const res = a.type === 'roll' ? applyCRoll(s0, throwDice(s0.cfg, rng)) : applyCMove(s0, a);
      return res && { state: res.state, events: [res.event] };
    }
    if (isL(s0)) {
      if (s0.phase === 'over' || s0.seats[s0.cur] !== seat) return null;
      const a = a0 as LAction;
      if (a.type === 'roll') return applyLRoll(s0, rng.int(6) + 1);
      if (a.type === 'move' && s0.phase === 'move') return applyLMove(s0, a.piece);
      return null;
    }
    const s = s0;
    const a = a0 as Action;
    if (s.phase === 'over' || s.players[s.cur].seat !== seat) return null;
    let res: { state: State; event: Event } | null = null;
    if (a.type === 'roll') res = applyRoll(s, [rng.int(6) + 1, rng.int(6) + 1]);
    else if (a.type === 'move') res = applyMove(s, a);
    return res && { state: res.state, events: [res.event] };
  },

  view: (s) => s,

  result: (s) => {
    if (s.winner == null) return null;
    if (isC(s)) return { winners: s.winners ?? [s.winner], text: (s.winners?.length ?? 1) > 1 ? 'первой парой довели все фишки до центра' : 'первым довёл все четыре фишки до центра' };
    return { winners: [s.winner], text: isL(s) ? 'первым довёл все четыре фишки' : 'первым завёл все четыре фишки в домик' };
  },

  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose(s, seat, level, rng) {
      if (isL(s)) return chooseL(s, seat, level, rng);
      if (isC(s)) return chooseC(s, seat, level, rng);
      if (s.phase === 'roll') return { type: 'roll' };
      const m = chooseMove(s, level, rng);
      return m && { type: 'move', piece: m.piece, die: m.die, to: m.to };
    },
  },

  describe,

  showcase: () => ({
    cfg: DEFAULT_CFG,
    players: [
      { seat: 0, pieces: [5, 14, -1, 50], house: [false, false, false, false] },
      { seat: 1, pieces: [22, 0, -1, -1], house: [false, false, false, false] },
      { seat: 2, pieces: [30, 3, 49, -1], house: [false, false, false, false] },
      { seat: 3, pieces: [9, 40, -1, -1], house: [false, false, false, false] },
    ],
    cur: 3,
    phase: 'move',
    dice: [6, 3],
    used: [false, false],
    bonus: false,
    winner: null,
    turn: 30,
  }),

  rules: {
    goal: 'Первым провести все четыре фишки по кругу креста и завести их в свой домик.',
    sections: [
      {
        title: 'Поле и фишки',
        html: `<p>Играют 2–4 человека, у каждого 4 фишки своего цвета. Поле — крест: по кругу 48 клеток, по 12 на каждую четверть.
          В конце своего луча у каждого игрока — <b>стартовое поле</b> с треугольником, а на средней дорожке луча — <b>домик</b> из 4 клеток («песочные часы»).</p>
          <p>Кидают два кубика, ходят по очереди против часовой стрелки.</p>`,
      },
      {
        title: 'Выход из парка',
        html: `<p>Фишки начинают в «парке» — круглой мандале в углу. Вывести фишку можно только <b>шестёркой</b>: она встаёт на стартовое поле.
          Второй кубик — ход этой или любой другой фишкой.</p>
          <p>Каждый кубик — отдельный ход, порядок выбираете сами. Если кубиком сходить можно — ходить обязательно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([-1, -1, -1, -1], [1, -1, -1, -1]),
          intro: 'Все красные фишки в парке.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 4), caption: 'Выпало 6 и 4. Шестёрка выводит фишку.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 0 }, caption: 'Фишка встаёт на стартовое поле.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 4 }, caption: 'Четвёркой она же идёт дальше по кругу.' },
          ],
        },
      },
      {
        title: 'Рубка и лишний бросок',
        html: `<p>Встав на клетку с чужой фишкой, вы её <b>рубите</b> — она возвращается в парк и снова ждёт шестёрку. <b>Срубивший бросает ещё раз.</b></p>
          <p><b>Дубль</b> — после хода тоже бросаете ещё раз. Две свои фишки на одной клетке стоять не могут.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([10, -1, -1, -1], [1, -1, -1, -1]),
          intro: 'Красная фишка в трёх клетках от зелёной.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(3, 2), caption: 'Выпало 3 и 2.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 13 }, caption: 'Тройкой — прямо на зелёную: рубка! Зелёная уходит в парк.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 15 }, caption: 'Двойкой — дальше. За рубку красный бросает ещё раз.' },
          ],
        },
      },
      {
        title: 'Углы креста: прыжки',
        html: `<p>Четыре тёмные клетки — <b>углы креста</b>. Стоя на углу, кубиком <b>«1»</b> можно прыгнуть по прямой стрелке на соседний угол (вперёд или назад), кубиком <b>«3»</b> — по диагонали на противоположный.
          Можно и просто шагнуть. После прыжка ход продолжают вторым кубиком.</p>
          <p>Прыжок назад к своему лучу — это <b>срез</b>: так фишка сразу оказывается у входа в домик.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([6, -1, -1, -1], [20, -1, -1, -1]),
          intro: 'Красная фишка стоит на углу креста.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(1, 3), caption: 'Выпало 1 и 3.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 42 }, caption: 'Единицей — прыжок на соседний угол, к своему лучу. Это срез почти через весь круг.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 45 }, caption: 'Тройкой — шаг вперёд. До домика рукой подать.' },
          ],
        },
      },
      {
        title: 'Домики-укрытия',
        html: `<p>На 3-м поле с края каждой дорожки нарисована избушка — <b>укрытие</b> на одну фишку. Встав туда, фишка прячется: из укрытия её не выбить.</p>
          <p>Если укрытие занято, пришедшая фишка встаёт на само поле, и там её можно срубить. А фишка в укрытии заперта, пока поле не освободится.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([1, 0, -1, -1], [-1, -1, -1, -1]),
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(2, 5), caption: 'Выпало 2 и 5.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 3 }, caption: 'Двойкой фишка встаёт на поле с избушкой и прячется в укрытие.' },
            { seat: 0, action: { type: 'move', piece: 1, die: 1, to: 5 }, caption: 'Пятёркой ходит фишка со старта.' },
          ],
        },
      },
      {
        title: 'Варианты поля и старта',
        html: `<p><b>Длинное поле</b> — плечо креста на клетку длиннее: 6 клеток вместо 5, круг 56 клеток, домик — 5 клеток.
          Со старта шестёрка уже не доводит до угла.</p>
          <p><b>Домики через один</b> — укрытия на луче стоят не друг напротив друга, а лесенкой: на одной дорожке на 3-м поле с края, на другой — на 4-м.</p>
          <p><b>Старт на дубль</b> — фишка выходит из парка только на дубль, любым его кубиком; вторым кубиком ходят как обычно, а за дубль — ещё бросок.
          Бывает и смешанное правило: выход на шестёрку <i>или</i> на дубль.</p>
          <p><b>Быстрый заряд</b> — пока на поле нет ни одной своей фишки (все в парке или уже в домике), на выход даётся три броска подряд.
          Не выпало за три раза — ход переходит дальше.</p>`,
        demo: {
          seats: demoSeats,
          options: { arm: 5, houses: 'opposite', start: 'double' },
          setup: () => pos([-1, -1, -1, -1], [20, -1, -1, -1], { arm: 5, houses: 'opposite', start: 'double' }),
          intro: 'Правило «старт на дубль». Все красные фишки в парке.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(3, 3), caption: 'Выпал дубль 3:3 — можно выводить фишку.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 0 }, caption: 'Одна тройка выводит фишку на старт.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 3 }, caption: 'Вторая тройка — вперёд, прямо в укрытие. За дубль красный бросает ещё раз.' },
          ],
        },
      },
      {
        title: 'Длинное поле',
        html: `<p>На длинном поле в каждой четверти круга 14 клеток: 6 к центру, угол, 6 от центра и торец.
          Прыжки с углов те же: «1» — на соседний угол, «3» — по диагонали.</p>`,
        demo: {
          seats: demoSeats,
          options: { arm: 6, houses: 'opposite', start: 'six' },
          setup: () => pos([0, -1, -1, -1], [30, -1, -1, -1], { arm: 6, houses: 'opposite', start: 'six' }),
          intro: 'Длинное поле. Красная фишка стоит на старте.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 1), caption: 'Выпало 6 и 1.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 6 }, caption: 'Шестёрка доводит только до последней клетки плеча.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 7 }, caption: 'Единицей — на угол. В следующий раз отсюда можно прыгать.' },
          ],
        },
      },
      {
        title: 'Домик и победа',
        html: `<p>Пройдя круг, фишка через торец своего луча заходит в <b>свой домик</b> — строго по выпавшим очкам. Перепрыгивать свои фишки в домике нельзя, внутри домика фишки можно двигать дальше.</p>
          <p>Побеждает тот, кто первым заведёт все 4 фишки в домик.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([50, 51, 52, 45], [-1, -1, -1, -1]),
          intro: 'Три красные фишки уже дома, четвёртая на подходе.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(4, 1), caption: 'Выпало 4 и 1.' },
            { seat: 0, action: { type: 'move', piece: 3, die: 0, to: 49 }, caption: 'Четвёркой — ровно на первую клетку домика. Победа!' },
          ],
        },
      },
      {
        title: 'Людо',
        html: `<p>Своя доска: крест 15×15, круг из 52 клеток, в углах — дворы, у каждого цвета дорожка из пяти клеток к центру. Кубик <b>один</b>,
          ходят по часовой стрелке. Фишка выходит со двора только на <b>6</b> — на свою цветную стартовую клетку; шестёрка даёт <b>ещё бросок</b>,
          но три шестёрки подряд — ход сгорает.</p>
          <p>Встал на чужую фишку — она идёт обратно во двор. Кроме <b>безопасных</b> клеток: стартовых и звёзд. В центр — только точным броском;
          все четыре фишки в центре — победа. «Людо с бонусами»: ещё бросок за рубку и за фишку в центре, две свои фишки на клетке — блок.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'ludo' },
          setup: () => lpos('ludo', [-1, -1, -1, -1], [43, -1, -1, -1]),
          intro: 'Людо. Все красные фишки во дворе, зелёная — недалеко от красного старта.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: [5], caption: 'Шестёрка — можно выводить.' },
            { seat: 0, action: { type: 'move', piece: 0 }, caption: 'Фишка встаёт на красную стартовую клетку. За шестёрку — ещё бросок.' },
            { seat: 0, action: { type: 'roll' }, rig: [3], caption: 'Выпало 4.' },
            { seat: 0, action: { type: 'move', piece: 0 }, caption: 'Четыре клетки — прямо на зелёную: рубка, зелёная уходит во двор.' },
          ],
        },
      },
      {
        title: 'Людо: в центр',
        html: `<p>Обойдя круг, фишка сворачивает на свою цветную дорожку — туда чужие не заходят. Дальше — только точным броском: выпало больше, чем осталось, — этой фишкой хода нет.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'ludo' },
          setup: () => lpos('ludo', [53, 56, 56, 56], [20, -1, -1, -1]),
          intro: 'Три красные фишки уже в центре, четвёртой осталось три клетки.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: [2], caption: 'Ровно три!' },
            { seat: 0, action: { type: 'move', piece: 0 }, caption: 'Четвёртая фишка в центре — победа.' },
          ],
        },
      },
      {
        title: 'Чаупар: крест и путь',
        html: `<p>Индийская игра на вышитом полотне-кресте: четыре рукава по <b>3 столбца × 8 клеток</b> и центр — <i>чаркони</i>. У каждого 4 фишки-готи,
          играют двое, трое или вчетвером; вчетвером сидящие напротив — <b>пары</b>.</p>
          <p>Фишка входит на поле у центра, спускается по <b>среднему столбцу своего рукава</b>, обходит весь крест против часовой стрелки по внешним столбцам
          (68 клеток) и поднимается по своему среднему столбцу обратно в центр — 84 шага. Свой средний столбец — только для своих фишек.</p>`,
      },
      {
        title: 'Чаупар: пасы и вход',
        html: `<p>Бросают три длинные кости — <b>пасы</b> с гранями 1, 2, 5 и 6. Каждая кость — отдельный ход любой фишкой, порядок любой; сходить можно — ходить обязательно.
          Фишка входит на поле только костью <b>«6»</b>. Три одинаковые кости — после хода ещё бросок.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'chaupar', throws: 'pasa' },
          setup: () => cpos({ 0: [-1, -1, -1, -1], 1: [40, -1, -1, -1] }),
          intro: 'Все красные фишки ждут у края полотна.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: pasa(6, 5, 2), caption: 'Выпало 6, 5 и 2. Шестёрка вводит фишку.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 0 }, caption: 'Фишка встаёт на первую клетку своего столбца, у самого центра.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 5 }, caption: 'Пятёркой — вниз по своему столбцу.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 2, to: 7 }, caption: 'Двойкой — на торец рукава. Это замок, здесь фишку не срубить.' },
          ],
        },
      },
      {
        title: 'Чаупар: рубка',
        html: `<p>Встав на клетку с чужими фишками, вы их <b>рубите</b>: они уходят с поля и снова ждут входа. <b>Срубивший бросает ещё раз.</b>
          Свои фишки (и фишки союзника) могут стоять на одной клетке сколько угодно.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'chaupar', throws: 'pasa' },
          setup: () => cpos({ 0: [12, -1, -1, -1], 1: [65, -1, -1, -1] }),
          intro: 'Зелёная фишка в двух клетках впереди красной.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: pasa(2, 5, 6), caption: 'Выпало 2, 5 и 6.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 14 }, caption: 'Двойкой — прямо на зелёную: рубка! Зелёная уходит с поля.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 19 }, caption: 'Пятёркой — дальше.' },
            { seat: 0, action: { type: 'move', piece: 1, die: 2, to: 0 }, caption: 'Шестёркой входит вторая фишка. За рубку красный бросает ещё раз.' },
          ],
        },
      },
      {
        title: 'Чаупар: замки',
        html: `<p>Клетки с вышитым крестом и зеркальцем — <b>замки</b>: торцы средних столбцов и 4-я клетка от края на каждом внешнем столбце, всего 12.
          В замке не рубят, а на замок, где стоит фишка противника, встать нельзя.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'chaupar', throws: 'pasa' },
          setup: () => cpos({ 0: [15, -1, -1, -1], 1: [71, -1, -1, -1] }),
          intro: 'Зелёная фишка сидит в замке в пяти клетках от красной.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: pasa(5, 2, 1), caption: 'Выпало 5, 2 и 1. Пятёркой встать в замок к зелёной нельзя.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 17 }, caption: 'Двойкой — вперёд, к замку.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 22 }, caption: 'Теперь пятёрка проводит мимо замка: рубить в замке нельзя, а проходить мимо можно.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 2, to: 23 }, caption: 'Единицей — ещё шаг.' },
          ],
        },
      },
      {
        title: 'Пачиси: каури',
        html: `<p>В пачиси вместо костей бросают <b>шесть раковин каури</b> и считают, сколько легли ртом вверх: 2, 3, 4, 5 и 6 — столько и шагов,
          одна — <b>10</b> (или 1, если так удобнее), ни одной — <b>25</b>. Броски 6, 10 и 25 — <b>милость</b>: ими можно ввести фишку, и после хода бросают ещё раз.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'chaupar', throws: 'cowrie' },
          setup: () => cpos({ 0: [-1, -1, -1, 30], 1: [50, -1, -1, -1] }, 'cowrie'),
          intro: 'Пачиси. Три красные фишки ждут входа, одна уже в пути.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: cowries(1), caption: 'Одна раковина ртом вверх — это 10 (можно сходить и на 1), милость.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 0 }, caption: 'Милостью вводим фишку. И бросаем ещё раз.' },
            { seat: 0, action: { type: 'roll' }, rig: cowries(3), caption: 'Три раковины — три шага.' },
            { seat: 0, action: { type: 'move', piece: 3, die: 0, to: 33 }, caption: 'Фишка в пути идёт на три клетки.' },
          ],
        },
      },
      {
        title: 'Чаупар: пары',
        html: `<p>Вчетвером сидящие напротив играют в паре: красный с жёлтым, зелёный с синим. Фишку союзника не рубят — встают к ней на клетку,
          и в замок к союзнику встать можно. Доведя свои фишки, игрок ждёт союзника; побеждает пара, первой заведшая в центр все восемь фишек.</p>`,
        demo: {
          seats: quadSeats,
          options: { game: 'chaupar', throws: 'pasa', pairs: true },
          setup: () => cpos({ 0: [12, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [48, -1, -1, -1], 3: [-1, -1, -1, -1] }),
          intro: 'Жёлтая фишка — союзник красного — в двух клетках впереди.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: pasa(2, 1, 5), caption: 'Выпало 2, 1 и 5.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 0, to: 14 }, caption: 'Двойкой — к жёлтой. Это союзник: никто никого не рубит.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 1, to: 15 }, caption: 'Единицей — дальше.' },
            { seat: 0, action: { type: 'move', piece: 0, die: 2, to: 20 }, caption: 'Пятёркой — в замок на 4-й клетке соседнего рукава.' },
          ],
        },
      },
      {
        title: 'Чаупар: в центр',
        html: `<p>Обойдя крест, фишка поднимается по своему среднему столбцу и входит в центр — только <b>точным</b> броском: лишнего не бывает.
          Побеждает тот, кто первым приведёт в центр все четыре фишки (вчетвером — пара).</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'chaupar', throws: 'pasa' },
          setup: () => cpos({ 0: [GOAL, GOAL, GOAL, 79], 1: [30, -1, -1, -1] }),
          intro: 'Три красные фишки уже в центре, четвёртой осталось четыре клетки.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: pasa(2, 2, 6), caption: 'Выпало 2, 2 и 6. Шестёрка не годится — перебор.' },
            { seat: 0, action: { type: 'move', piece: 3, die: 0, to: 81 }, caption: 'Двойкой — вверх по своему столбцу.' },
            { seat: 0, action: { type: 'move', piece: 3, die: 1, to: GOAL }, caption: 'Второй двойкой — ровно в центр. Победа!' },
          ],
        },
      },
      {
        title: 'Парчис',
        html: `<p>Испанская доска: 68 клеток с номерами, ходят <b>против часовой</b>. У каждого цвета — дом в углу, выход (5, 22, 39, 56) и коридор из семи клеток к центру.
          Кубик один. Фишка выходит на <b>5</b> — и это обязательно, если есть кого выводить. Шестёрка — ещё бросок, а когда во дворе никого нет, она считается за <b>7</b>.
          Третья шестёрка подряд — фишка, ходившая последней, возвращается домой.</p>
          <p>Встал на чужую фишку — она идёт домой, а ты ходишь <b>+20</b> любой своей фишкой; дошёл до центра — <b>+10</b>.
          Не рубят на 12 клетках-<b>сегуро</b> с кружком: там вдвоём могут стоять разные цвета. На клетке не больше двух фишек.
          Две фишки одного цвета — <b>барьер</b>: сквозь него не проходит никто; выпала шестёрка — свой барьер обязан разбить.</p>`,
        demo: {
          seats: demoSeats,
          options: { game: 'parchis' },
          setup: () => lpos('parchis', [0, -1, -1, -1], [55, -1, -1, -1]),
          intro: 'Красная фишка на своём выходе (39), зелёная — на 43.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: [3], caption: 'Выпало 4.' },
            { seat: 0, action: { type: 'move', piece: 0 }, caption: 'Четыре клетки — на 43: рубка! Зелёная домой, красному +20.' },
            { seat: 0, action: { type: 'move', piece: 0 }, caption: 'Бонус: та же фишка проходит двадцать клеток.' },
          ],
        },
      },
    ],
  },
};
