/* «Пасьянсы» — одна карточка: косынка, паук, солитёр, пирамида, три вершины, гольф, воры, скорпион, колодец.
 * Без DOM. Один игрок — обычный пасьянс; несколько — дуэль: у каждого своя доска с одной и той же раздачей, кто первым сошёлся.
 * Сложность — это раздача: лёгкие, средние и сложные отобраны заранее решателем (tools/solitaire/seeds.ts, seeds.json),
 * все они сходятся; «случайная» — как ляжет. */
import { cardName } from '../../cards/deck';
import { SeededRng, shuffle } from '../../core/rng';
import type { DemoScript, DemoStep, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { presetTables, type RecordTable } from '../../core/records';
import { autoFinish, ctxOf, play, undo, type Board, type Cfg, type Ctx, type GameId, type Move } from './engine';
import { GAMES, GAME_IDS } from './games';
import { bestMove, botMove } from './solver';
import SEEDS from './seeds.json';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
];

export type Level = 'easy' | 'medium' | 'hard' | 'any';
export const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'easy', label: 'Лёгкая', hint: 'всегда сходится, без хитростей' },
  { id: 'medium', label: 'Средняя', hint: 'всегда сходится, придётся подумать' },
  { id: 'hard', label: 'Сложная', hint: 'сходится, но путь один-два' },
  { id: 'any', label: 'Случайная', hint: 'как ляжет — может и не сойтись' },
];

export const GAME_LABEL: Record<GameId, string> = {
  klondike: 'Косынка',
  spider: 'Паук',
  freecell: 'Солитёр',
  pyramid: 'Пирамида',
  tripeaks: 'Три вершины',
  golf: 'Гольф',
  thieves: 'Сорок воров',
  scorpion: 'Скорпион',
  well: 'Колодец',
};

export interface State {
  game: GameId;
  cfg: Cfg;
  level: Level;
  /** Номер раздачи: колода — shuffle(cards, SeededRng(seed)). */
  seed: number;
  deck: Card[];
  seats: number[];
  boards: Record<number, Board>;
  /** Кто сошёлся — по порядку. */
  order: number[];
  /** Счётчик ходов стола: сдвигает очередь, чтобы боты в дуэли ходили по кругу. */
  turn: number;
}

type Card = import('../../cards/deck').Card;

export interface Summary {
  prog: number;
  total: number;
  moves: number;
  score: number;
  end: 0 | 1 | 2;
}

export interface View {
  game: GameId;
  cfg: Cfg;
  level: Level;
  seed: number;
  seats: number[];
  /** Колода для зрителя: закрытые на его доске карты — null. */
  deck: (Card | null)[];
  /** Свои доски (без снимков отмены). */
  boards: Record<number, Board & { undo: boolean }>;
  /** Все места коротко — для боковой панели и дуэли. */
  sum: Record<number, Summary>;
  order: number[];
}

/** hint — игрок посмотрел подсказку: доска не меняется, но партия идёт в таблицу рекордов «с подсказками». */
export type Action = Move | { t: 'undo' } | { t: 'auto' } | { t: 'giveup' } | { t: 'think' } | { t: 'hint' };

export type Event =
  | { type: 'move'; seat: number; m: Move }
  | { type: 'undo'; seat: number }
  | { type: 'auto'; seat: number }
  | { type: 'won'; seat: number; moves: number; score: number; place: number }
  | { type: 'giveup'; seat: number };

// ---------------------------------------------------------------- настройки

export function cfgOf(o: Options): Cfg {
  const vegas = !!o.kVegas;
  const draw = Number(o.kDraw) === 3 ? 3 : 1;
  const game = String(o.game) as GameId;
  return {
    draw,
    passes: game === 'pyramid' ? Number(o.pyPasses ?? 3) : vegas ? (draw === 3 ? 3 : 1) : Number(o.kPasses ?? 0),
    vegas,
    suits: ([1, 2, 4].includes(Number(o.spSuits)) ? Number(o.spSuits) : 1) as 1 | 2 | 4,
    cells: Math.max(1, Math.min(4, Number(o.fcCells ?? 4))),
    baker: !!o.fcBaker,
    wrap: game === 'tripeaks' ? o.tpWrap !== false : !!o.gWrap,
  };
}

/** Ключ набора раздач: только то, что меняет решаемость. */
export function seedKey(game: GameId, c: Cfg): string {
  switch (game) {
    case 'klondike':
      return `klondike-${c.draw}-${c.passes}`;
    case 'spider':
      return `spider-${c.suits}`;
    case 'freecell':
      return `freecell-${c.cells}${c.baker ? '-baker' : ''}`;
    case 'pyramid':
      return `pyramid-${c.passes}`;
    case 'tripeaks':
      return `tripeaks${c.wrap ? '-wrap' : ''}`;
    case 'golf':
      return `golf${c.wrap ? '-wrap' : ''}`;
    case 'thieves':
      return 'forty';
    default:
      return game;
  }
}

const seedLists = SEEDS as Record<string, Partial<Record<Level, number[]>> & { rate?: number; tried?: number }>;

/** Известные доли решаемых раздач (исследования и большие прогоны решателей). */
const KNOWN: Record<string, string> = {
  'freecell-4': 'около 99,999%',
  'klondike-1-0': 'около 82%',
  'tripeaks-wrap': 'больше 90%',
};

/** Есть ли отобранные раздачи этого уровня (иначе — честная случайная). */
export function hasLevel(game: GameId, c: Cfg, level: Level) {
  return level === 'any' || !!seedLists[seedKey(game, c)]?.[level]?.length;
}

/** Есть ли у пасьянса с такими настройками уровни сложности вообще. */
export const hasLevels = (game: GameId, c: Cfg) => !!seedLists[seedKey(game, c)]?.easy?.length;

/** Сколько раздач сходится: известная цифра или нижняя оценка по нашему решателю. null — не считали. */
export function convergence(game: GameId, c: Cfg): string | null {
  const key = seedKey(game, c);
  if (KNOWN[key]) return KNOWN[key];
  const r = seedLists[key];
  if (!r?.tried) return null;
  return r.rate ? `не меньше ${String(r.rate).replace('.', ',')}% (столько разложил наш решатель из ${r.tried})` : `меньше 1 из ${r.tried} у нашего решателя — пасьянс из самых трудных`;
}

export function pickSeed(game: GameId, c: Cfg, level: Level, rng: Rng): number {
  const list = level === 'any' ? null : seedLists[seedKey(game, c)]?.[level];
  if (list?.length) return list[rng.int(list.length)];
  return 1 + rng.int(2_000_000_000);
}

export function deckOf(game: GameId, c: Cfg, seed: number): Card[] {
  return shuffle(GAMES[game].cards(c), new SeededRng(seed));
}

export function newState(game: GameId, c: Cfg, level: Level, seed: number, seats: number[]): State {
  const deck = deckOf(game, c, seed);
  const ctx = ctxOf(GAMES[game], c, deck);
  const b = GAMES[game].deal(ctx);
  b.score = GAMES[game].startScore?.(c) ?? b.score;
  const boards: Record<number, Board> = {};
  for (const s of seats) boards[s] = structuredClone(b);
  return { game, cfg: c, level, seed, deck, seats, boards, order: [], turn: 0 };
}

export const ctxFor = (s: Pick<State, 'game' | 'cfg'>, deck: (Card | null)[]): Ctx => ctxOf(GAMES[s.game], s.cfg, deck);

// ---------------------------------------------------------------- ход

function toAct(s: State): number[] {
  const live = s.seats.filter((x) => !s.boards[x].end);
  if (!live.length) return [];
  const k = s.turn % live.length;
  return [...live.slice(k), ...live.slice(0, k)];
}

function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  const b0 = s0.boards[seat];
  if (!b0 || b0.end || !a || typeof a !== 'object') return null;
  const c = ctxFor(s0, s0.deck);
  let b: Board | null = null;
  const ev: Event[] = [];
  switch (a.t) {
    case 'think':
    case 'hint':
      b = b0;
      break;
    case 'mv':
    case 'stock':
      b = play(c, b0, a.t === 'stock' ? { t: 'stock' } : { t: 'mv', f: a.f, n: a.n, to: a.to });
      if (b) ev.push({ type: 'move', seat, m: a.t === 'stock' ? { t: 'stock' } : { t: 'mv', f: a.f, n: a.n, to: a.to } });
      break;
    case 'undo':
      b = undo(b0);
      if (b) ev.push({ type: 'undo', seat });
      break;
    case 'auto':
      b = autoFinish(c, b0);
      if (b) ev.push({ type: 'auto', seat });
      break;
    case 'giveup':
      b = { ...b0, end: 2 };
      ev.push({ type: 'giveup', seat });
      break;
    default:
      return null;
  }
  if (!b) return null;
  const s: State = { ...s0, boards: { ...s0.boards, [seat]: b }, turn: s0.turn + 1, order: s0.order.slice() };
  if (b.end === 1 && !b0.end) {
    s.order.push(seat);
    ev.push({ type: 'won', seat, moves: b.moves, score: b.score, place: s.order.length });
  }
  return { state: s, events: ev };
}

export function summaryOf(s: Pick<State, 'game' | 'cfg'>, deck: (Card | null)[], b: Board): Summary {
  const c = ctxFor(s, deck);
  return { prog: c.g.progress(c, b), total: c.g.total(c), moves: b.moves, score: b.score, end: b.end };
}

function view(s: State, seats: number[] | 'all'): View {
  const mine = seats === 'all' ? s.seats : seats.filter((x) => s.seats.includes(x));
  const deck = s.deck.map((x, id) => (mine.some((m) => s.boards[m].up[id]) ? x : null));
  const boards: View['boards'] = {};
  for (const m of mine) {
    const { hist, ...rest } = s.boards[m];
    boards[m] = { ...rest, undo: !!hist?.length };
  }
  const sum: View['sum'] = {};
  for (const x of s.seats) sum[x] = summaryOf(s, s.deck, s.boards[x]);
  return { game: s.game, cfg: s.cfg, level: s.level, seed: s.seed, seats: s.seats, deck, boards, sum, order: s.order };
}

function result(s: State) {
  if (toAct(s).length) return null;
  const sums = s.seats.map((x) => ({ x, ...summaryOf(s, s.deck, s.boards[x]) }));
  const name = GAME_LABEL[s.game];
  if (s.seats.length === 1) {
    const b = s.boards[s.seats[0]];
    return { winners: b.end === 1 ? [s.seats[0]] : [], text: b.end === 1 ? `${name}: сошёлся за ${b.moves} ходов` : `${name}: не сошёлся`, scores: { [s.seats[0]]: sums[0].score } };
  }
  const scores: Record<number, number> = {};
  for (const r of sums) scores[r.x] = r.prog;
  if (s.order.length) return { winners: [s.order[0]], text: `${name}: первым сошёлся пасьянс`, scores };
  const best = Math.max(...sums.map((r) => r.prog));
  return { winners: sums.filter((r) => r.prog === best).map((r) => r.x), text: `${name}: ни у кого не сошёлся — больше карт убрано`, scores };
}

// ---------------------------------------------------------------- показ правил

/** Какая карта: «туз пик». */
const cn = (s: State, id: number | undefined) => (id == null ? '' : cardName(s.deck[id]));

/** Подпись к ходу из показа. */
function caption(s: State, b: Board, m: Move): string {
  const c = ctxFor(s, s.deck);
  if (m.t === 'stock') return 'Ходов на столе нет — открываем карту из колоды.';
  const id = b.p[m.f][b.p[m.f].length - m.n];
  const k = c.kinds[m.to];
  const what = m.n > 1 ? `${cn(s, id)} и ещё ${m.n - 1}` : cn(s, id);
  const tgt = b.p[m.to][b.p[m.to].length - 1];
  if (s.game === 'pyramid') return k === 'found' ? `Король снимается один.` : `${cn(s, id)} и ${cn(s, tgt)} — вместе 13, обе уходят.`;
  if (k === 'found') return tgt == null ? `${cap(what)} — в пустой дом.` : `${cap(what)} — в дом, на ${cn(s, tgt)}.`;
  if (k === 'cell') return `${cap(what)} — в свободную ячейку.`;
  if (tgt == null) return `${cap(what)} — на пустое место.`;
  return `${cap(what)} — на ${cn(s, tgt)}.`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const demoSeats: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 2 }];

/** Показ: известная раздача и первые ходы «по уму» с подписями. */
function demo(game: GameId, opts: Options, seed: number, n: number, intro: string, first?: string): DemoScript<State, Action> {
  const c = cfgOf({ game, ...opts });
  const start = () => newState(game, c, 'any', seed, [0]);
  let steps: DemoStep<Action>[] | null = null;
  return {
    seats: demoSeats,
    options: { game, ...opts },
    setup: () => start(),
    intro,
    get steps() {
      if (steps) return steps;
      steps = [];
      let s = start();
      for (let k = 0; k < n; k++) {
        const b = s.boards[0];
        const ctx = ctxFor(s, s.deck);
        const m: Move | null = bestMove(ctx, b, 2) ?? (ctx.g.canStock(ctx, b) ? { t: 'stock' } : null);
        if (!m) break;
        const text = k === 0 && first ? first + ' ' + caption(s, b, m) : caption(s, b, m);
        steps.push({ seat: 0, action: m, caption: text });
        const r = apply(s, 0, m);
        if (!r) break;
        s = r.state;
      }
      return steps;
    },
  };
}

// ---------------------------------------------------------------- описание

const opt = (game: GameId) => (o: Options) => o.game === game;

/** Таблица рекордов: пасьянс с правилами, меняющими решаемость, и уровень раздачи. */
function recTable(o: Options): RecordTable | null {
  const game = (GAME_IDS.includes(o.game as GameId) ? o.game : 'klondike') as GameId;
  const c = cfgOf({ ...o, game });
  const lv = hasLevels(game, c) ? (LEVELS.find((l) => l.id === o.level) ?? LEVELS[0]) : LEVELS[3];
  const rules: string[] = [];
  if (game === 'klondike') rules.push(c.draw === 3 ? 'по три' : 'по одной', ...(c.vegas ? ['Вегас'] : c.passes ? [`проходов: ${c.passes}`] : []));
  if (game === 'spider') rules.push(c.suits === 1 ? 'одна масть' : c.suits === 2 ? 'две масти' : 'четыре масти');
  if (game === 'freecell') rules.push(`ячеек: ${c.cells}`, ...(c.baker ? ['Бейкер'] : []));
  if (game === 'pyramid') rules.push(c.passes ? `проходов: ${c.passes}` : 'без ограничения');
  if ((game === 'tripeaks' || game === 'golf') && c.wrap) rules.push('по кругу');
  return { id: `${seedKey(game, c)}${c.vegas ? '-vegas' : ''}.${lv.id}`, label: `${GAME_LABEL[game]}${rules.length ? ` (${rules.join(', ')})` : ''}, раздача: ${lv.label.toLowerCase()}` };
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'solitaire',
  title: 'Пасьянсы',
  players: { min: 1, max: 4, default: 1 },
  seats: SEATS,
  options: [
    { key: 'game', label: 'Пасьянс', type: 'select', choices: GAME_IDS.map((g) => ({ value: g, label: GAME_LABEL[g] })), default: 'klondike' },
    { key: 'level', label: 'Раздача', type: 'select', hint: 'лёгкие, средние и сложные раздачи всегда сходятся — отобраны заранее; где отобрать не удалось, раздача случайная', choices: LEVELS.map((l) => ({ value: l.id, label: `${l.label} — ${l.hint}` })), default: 'easy', showIf: (o) => hasLevels((GAME_IDS.includes(o.game as GameId) ? o.game : 'klondike') as GameId, cfgOf(o)) },
    { key: 'kDraw', label: 'Из колоды', type: 'select', choices: [{ value: 1, label: 'по одной карте' }, { value: 3, label: 'по три карты' }], default: 1, showIf: opt('klondike') },
    { key: 'kVegas', label: 'Вегас', hint: 'ставка 52, за карту в доме +5; колоду — один проход (по три — три прохода)', type: 'toggle', default: false, showIf: opt('klondike') },
    { key: 'kPasses', label: 'Проходов колоды', type: 'select', choices: [{ value: 0, label: 'без ограничения' }, { value: 3, label: 'три' }, { value: 1, label: 'один' }], default: 0, showIf: (o) => o.game === 'klondike' && !o.kVegas },
    { key: 'spSuits', label: 'Мастей', type: 'select', choices: [{ value: 1, label: 'одна (пики)' }, { value: 2, label: 'две' }, { value: 4, label: 'четыре' }], default: 1, showIf: opt('spider') },
    { key: 'fcCells', label: 'Свободных ячеек', type: 'select', choices: [4, 3, 2, 1].map((n) => ({ value: n, label: String(n) })), default: 4, showIf: opt('freecell') },
    { key: 'fcBaker', label: 'Бейкер', hint: 'в столбцах — по масти, а не через цвет', type: 'toggle', default: false, showIf: opt('freecell') },
    { key: 'pyPasses', label: 'Проходов колоды', type: 'select', choices: [{ value: 3, label: 'три' }, { value: 1, label: 'один' }, { value: 0, label: 'без ограничения' }], default: 3, showIf: opt('pyramid') },
    { key: 'tpWrap', label: 'Туз на короля', hint: 'туз и король — соседи по кругу', type: 'toggle', default: true, showIf: opt('tripeaks') },
    { key: 'gWrap', label: 'По кругу', hint: 'туз и король — соседи; на короля можно класть', type: 'toggle', default: false, showIf: opt('golf') },
  ],
  presets: [
    { id: 'klondike', label: 'Косынка', hint: 'Из колоды по одной карте', options: { game: 'klondike', kDraw: 1, kVegas: false, kPasses: 0 } },
    { id: 'klondike3', label: 'Косынка по три', hint: 'Из колоды по три карты', options: { game: 'klondike', kDraw: 3, kVegas: false, kPasses: 0 } },
    { id: 'vegas', label: 'Вегас', hint: 'Ставка 52, колода — один проход', options: { game: 'klondike', kDraw: 1, kVegas: true } },
    { id: 'spider1', label: 'Паук: одна масть', options: { game: 'spider', spSuits: 1 } },
    { id: 'spider2', label: 'Паук: две масти', options: { game: 'spider', spSuits: 2 } },
    { id: 'spider4', label: 'Паук: четыре масти', options: { game: 'spider', spSuits: 4 } },
    { id: 'freecell', label: 'Солитёр', hint: 'Свободные ячейки, все карты открыты', options: { game: 'freecell', fcCells: 4, fcBaker: false } },
    { id: 'pyramid', label: 'Пирамида', hint: 'Пары на 13', options: { game: 'pyramid' } },
    { id: 'tripeaks', label: 'Три вершины', hint: 'На карту выше или ниже', options: { game: 'tripeaks' } },
    { id: 'golf', label: 'Гольф', options: { game: 'golf' } },
    { id: 'forty', label: 'Сорок воров', hint: 'Две колоды, по одной карте', options: { game: 'thieves' } },
    { id: 'scorpion', label: 'Скорпион', options: { game: 'scorpion' } },
    { id: 'well', label: 'Колодец', hint: 'Две колоды, резервы ромбом', options: { game: 'well' } },
  ],

  setup(seats, o, rng) {
    const game = (GAME_IDS.includes(o.game as GameId) ? o.game : 'klondike') as GameId;
    const c = cfgOf({ ...o, game });
    const level = (hasLevels(game, c) && LEVELS.some((l) => l.id === o.level) ? o.level : hasLevels(game, c) ? 'easy' : 'any') as Level;
    const seed = Number(o.seed) > 0 ? Number(o.seed) : pickSeed(game, c, level, rng);
    return newState(
      game,
      c,
      level,
      seed,
      seats.map((x) => x.seat).sort((a, b) => a - b)
    );
  },
  // «Сыграть ещё» — новая раздача того же уровня
  again: ({ seed, ...rest }) => rest,
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view,
  redact(ev, seats) {
    // чужие ходы не показываем — только итог
    if (ev.type === 'won' || ev.type === 'giveup') return ev;
    return seats === 'all' || seats.includes(ev.seat) ? ev : null;
  },
  result,
  records: {
    columns: [
      { key: 'ms', label: 'Время', sort: 'asc', format: 'time' },
      { key: 'moves', label: 'Ходов', sort: 'asc', format: 'score' },
    ],
    table: recTable,
    tables: () => presetTables(def, recTable),
    // отмена, подсказка или заранее заданная раздача («сыграть эту же») — таблица «с подсказками»
    score: (s, { ms, actions, opts }) => {
      const b = s.boards[s.seats[0]];
      if (b?.end !== 1) return null;
      const help = Number(opts.seed) > 0 || actions.some((a) => (a as Action).t === 'undo' || (a as Action).t === 'hint');
      return { values: { ms, moves: b.moves }, help };
    },
    minMs: () => 5000,
    help: true,
  },
  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose(v, seat, level, rng) {
      const b = v.boards[seat];
      if (!b) return { t: 'think' };
      return botMove(ctxFor(v, v.deck), b, level, rng) as Action;
    },
  },
  describe(ev, name) {
    if (ev.type === 'won') return `🏁 ${name(ev.seat)}: пасьянс сошёлся за ${ev.moves} ходов${ev.place > 1 ? ` (${ev.place}-е место)` : ''}`;
    if (ev.type === 'giveup') return `${name(ev.seat)} сдаётся`;
    return null;
  },

  showcase() {
    const s = newState('klondike', cfgOf({ game: 'klondike' }), 'any', 1077, [0]);
    let st = s;
    for (let k = 0; k < 40; k++) {
      const b = st.boards[0];
      const c = ctxFor(st, st.deck);
      const m = bestMove(c, b, 2) ?? (c.g.canStock(c, b) ? ({ t: 'stock' } as Move) : null);
      if (!m) break;
      const r = apply(st, 0, m);
      if (!r) break;
      st = r.state;
    }
    return st;
  },

  rules: {
    goal: 'Разложить пасьянс: убрать все карты в дома (или со стола — в пирамиде, трёх вершинах и гольфе). Вдвоём и больше — у всех одна и та же раздача, кто первым сошёлся.',
    sections: [
      {
        title: 'Косынка',
        html: `<p>Семь столбцов, в первом одна карта, в последнем семь; открыта только верхняя. Остальное — колода.
          Наверх в столбцах кладут карту <b>на единицу младше и другого цвета</b> (чёрную девятку на красную десятку); переносить можно и целую такую лесенку.
          На пустое место — только короля.</p>
          <p>Дома — четыре, по мастям, <b>от туза до короля</b>. Колоду открывают по одной или по три карты; играть можно верхнюю открытую.
          <b>Вегас</b>: ставка 52 очка, за каждую карту в доме +5, колоду — один раз (по три — три раза).</p>`,
        demo: demo('klondike', {}, 1077, 6, 'Косынка по одной карте.', 'Сначала — то, что открывает закрытые карты.'),
      },
      {
        title: 'Паук',
        html: `<p>Две колоды, десять столбцов, сверху открыто по карте. Класть можно любую карту <b>на единицу младше</b>, масть не важна,
          а переносить пачкой — только лесенку <b>одной масти</b>. Когда в столбце собрана масть от короля до туза — она уходит сама.</p>
          <p>Ходов нет — сдать из колоды ещё по карте в каждый столбец (пустых столбцов при этом быть не должно). Сложность — одна, две или четыре масти.
          Счёт: 500 в начале, −1 за ход, +100 за собранную масть.</p>`,
        demo: demo('spider', { spSuits: 1 }, 31, 5, 'Паук в одну масть.'),
      },
      {
        title: 'Солитёр',
        html: `<p>Все 52 карты открыты в восьми столбцах. Слева — <b>четыре свободные ячейки</b>, в каждую можно положить одну любую карту.
          В столбцах — на единицу младше и другого цвета; на пустой столбец — любую карту. Дома — от туза до короля.</p>
          <p>Пачку переносят, если хватает свободных мест: (ячейки + 1), и вдвое больше за каждый пустой столбец.
          Карты, которые точно больше не нужны в столбцах, уходят в дом сами. <b>Бейкер</b> — то же, но в столбцах по масти.</p>`,
        demo: demo('freecell', {}, 5, 6, 'Солитёр: все карты видны сразу — можно продумать всё.'),
      },
      {
        title: 'Пирамида',
        html: `<p>Пирамида из 28 карт, открыты все, но взять можно только незакрытые снизу. Снимают <b>пары на 13</b>: туз — 1, валет — 11, дама — 12;
          <b>король</b> снимается один. В пару идут открытые карты пирамиды, верхняя карта колоды и верх сброса.</p>
          <p>Цель — разобрать пирамиду. Колоду можно пройти три раза.</p>`,
        demo: demo('pyramid', {}, 12, 5, 'Пирамида.'),
      },
      {
        title: 'Три вершины',
        html: `<p>Три горки по 10 карт, открыт нижний ряд. В сброс кладут открытую карту <b>на единицу старше или младше</b> верхней карты сброса,
          масть не важна; король и туз — соседи. Карта открывается, когда с неё сняли обе накрывающие.</p>
          <p>Ходов нет — новая карта из колоды в сброс (колода — один раз). Серия подряд даёт больше очков.</p>`,
        demo: demo('tripeaks', {}, 9, 6, 'Три вершины.'),
      },
      {
        title: 'Гольф',
        html: `<p>Семь столбцов по пять открытых карт. На сброс кладут нижнюю карту столбца <b>на единицу старше или младше</b>, масть не важна.
          По строгим правилам на <b>короля</b> ничего не кладут. Ходов нет — карту из колоды на сброс, колода — один раз. Цель — убрать все 35 карт.</p>`,
        demo: demo('golf', {}, 3, 6, 'Гольф.'),
      },
      {
        title: 'Сорок воров',
        html: `<p>Две колоды, десять столбцов по четыре открытые карты, восемь домов от туза. В столбцах — на единицу младше <b>той же масти</b>,
          переносят <b>по одной карте</b>; на пустой столбец — любую. Колода — по одной карте, один раз. Один из самых трудных пасьянсов.</p>`,
        demo: demo('thieves', {}, 4, 5, 'Сорок воров.'),
      },
      {
        title: 'Скорпион',
        html: `<p>Семь столбцов по семь карт; в первых четырёх по три закрытые. Взять можно <b>любую открытую карту вместе со всем, что на ней</b>,
          и положить на карту <b>той же масти на единицу старше</b>. На пустое место — только король. Три карты колоды можно в любой момент сдать
          на первые три столбца. Собранная от короля до туза масть уходит. Цель — собрать все четыре.</p>`,
        demo: demo('scorpion', {}, 6, 5, 'Скорпион.'),
      },
      {
        title: 'Колодец',
        html: `<p>Две колоды. В середине — «колодец»: четыре резерва по 10 открытых карт ромбом, рядом с каждым — столбец из одной карты.
          Пятый столбец слева пуст и начинается только с туза. В столбцах карты кладут <b>по масти вверх</b>, по кругу: на короля — туз.
          Опустевший столбец сам берёт карту из своего резерва.</p>
          <p>Дома — по одному на масть, <b>от короля вниз</b>, а после туза — снова король и вниз: 26 карт в доме. Колоду сдают на пять стопок сброса;
          кончилась — сбросы собираются обратно, и каждый новый круг — на одну стопку меньше (всего четыре пересдачи).</p>`,
        demo: demo('well', {}, 8, 5, 'Колодец.'),
      },
      {
        title: 'Сложность, дуэль и управление',
        html: `<p><b>Раздача</b>: лёгкая, средняя и сложная — <b>всегда сходятся</b>, их заранее разложил решатель (как в пасьянсах Microsoft);
          лёгкая — простым путём, сложная — только хитрым. <b>Случайная</b> — честная перетасовка, может и не сойтись.</p>
          <p>Карту тянут мышью или пальцем; простое нажатие отправляет карту в лучшее место (в дом, если можно). Нажатие на колоду — открыть карту.
          Есть отмена хода, подсказка и «Собрать», когда все карты открыты.</p>
          <p>Вдвоём и больше — дуэль: у каждого своя доска с той же раздачей, побеждает тот, кто сошёлся первым.
          Боты-соперники: лёгкий думает долго и ходит неточно, сложный смотрит на ход вперёд.</p>`,
      },
    ],
  },
};
