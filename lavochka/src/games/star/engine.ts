/* «Звезда Африки» — карта-граф: фишка идёт по рёбрам (суша/море) шаг за шагом, сама выбирая дорогу, или летит
 * по авиалинии. На 30 квадратах лежат закрытые жетоны: остановился на квадрате — открыл; прошёл мимо, истратив
 * все очки, — можно открыть за 100. Деньги идут за камни, за выход из порта в море и за перелёт.
 * Цель — найти «Звезду Африки» и принести её в Танжер или Каир. Без DOM: движок гоняет сервер и тесты.
 *
 * Правила (инструкция к игре, начало 1990-х):
 *  - проход через клетку: открытый разбойник (пока алмаз не найден) берёт 100; после находки алмаза
 *    остальные, пройдя через разбойника (открытого или закрытого), становятся разбойниками-соперниками;
 *    разбойник-соперник, пройдя через точку владельца, забирает алмаз и его деньги; владелец алмаза, войдя
 *    в Танжер или Каир, побеждает; первый, кто дошёл до Кейптауна, получает 500;
 *  - остановка: закрытый жетон открывается; на открытом разбойнике — ещё и пропуск хода; на обведённом
 *    кружке — пропуск хода. */
import type { Rng } from '../../core/types';
import raw from './data.json';

export type Kind = 'land' | 'sea' | 'air';
export type TokKind = 'diamond' | 'ruby' | 'emerald' | 'topaz' | 'horse' | 'robber' | 'empty';
interface RawCell {
  id: string;
  x: number;
  y: number;
  kind: 'token' | 'land' | 'sea' | 'city';
  t?: string;
  next: string[];
  kinds?: Record<string, Kind>;
  air?: string[];
  /** 'skip' — обведённый кружок у Сахары и Св. Елены, 'bonus500' — Кейптаун. */
  sign?: string;
  /** Признак острова: с Канар, Св. Елены и Мадагаскара по суше не уйти. */
  island?: number;
}
const data = raw as unknown as {
  w: number;
  h: number;
  start: string;
  finish: string[];
  gold: string;
  slave: string;
  cape: string;
  tokens: [TokKind, number][];
  cells: RawCell[];
};

export const W = data.w;
export const H = data.h;
export const CELLS = data.cells;
export const IDX: Record<string, number> = Object.fromEntries(CELLS.map((c, i) => [c.id, i]));
export const START = IDX[data.start];
export const FINISH = data.finish.map((id) => IDX[id]);
export const GOLD = IDX[data.gold];
export const SLAVE = IDX[data.slave];
export const CAPE = IDX[data.cape];
export const TOKEN_AT = CELLS.map((c) => c.kind === 'token');
export const NEIGH: number[][] = CELLS.map((c) => (c.next ?? []).map((n) => IDX[n]));
export const EDGE: Kind[][] = CELLS.map((c) => (c.next ?? []).map((n) => c.kinds?.[n] ?? 'land'));
export const AIR: number[][] = CELLS.map((c) => (c.air ?? []).map((n) => IDX[n]));
/** Порт — город на карте (квадрат жетона или Танжер/Каир): выход из него в море стоит 100. */
export const PORT = CELLS.map((c) => c.kind === 'token' || c.kind === 'city');
/** Обведённые кружки у Сахары и Св. Елены: остановился — пропускаешь ход. */
export const HALT_AT = CELLS.map((c) => c.sign === 'skip');
/** Острова: без денег и подков отсюда не уплыть — три хода в ожидании. */
export const ISLAND_AT = CELLS.map((c) => !!c.island);
/** Сколько мест бывает за столом (массивы по местам). */
const SEATS_MAX = 4;

/** Сколько жетонов какого вида в наборе (перемешиваются и раскладываются по 30 квадратам). */
export const DECK: TokKind[] = data.tokens.flatMap(([k, n]) => Array.from({ length: n }, () => k));

export const TOK_NAME: Record<TokKind, string> = {
  diamond: '«Звезда Африки»',
  ruby: 'рубин',
  emerald: 'изумруд',
  topaz: 'топаз',
  horse: 'подкова',
  robber: 'разбойник',
  empty: 'пусто',
};
export const TOK_ICON: Record<TokKind, string> = {
  diamond: '💎',
  ruby: '🔴',
  emerald: '🟢',
  topaz: '🟡',
  horse: '🧲',
  robber: '⚔️',
  empty: '·',
};
export const TOK_FILE: Record<TokKind, string> = {
  diamond: 'token-diamond',
  ruby: 'token-ruby',
  emerald: 'token-emerald',
  topaz: 'token-topaz',
  horse: 'token-horseshoe',
  robber: 'token-robber',
  empty: 'token-empty',
};
/** Плата за камни. */
const STONE: Partial<Record<TokKind, number>> = { topaz: 300, emerald: 500, ruby: 800 };

export const SEA_FEE = 100;
export const AIR_FEE = 300;
export const START_MONEY = 500;
export const FIRST_CAPE = 500;
/** Проход по открытому разбойнику (пока алмаз не найден) и открытие пройденного жетона. */
export const ROBBER_FEE = 100;
export const OPEN_FEE = 100;
export const HORSE_MONEY = 100;

export interface State {
  seats: number[];
  /** Где чья фишка (индекс клетки). */
  pos: number[];
  money: number[];
  /** Подковы: их хранят и тратят по желанию (100 денег или лишний ход). */
  horses: number[];
  /** Лишние ходы за подковы: после своего хода игрок ходит ещё раз. */
  extra: number[];
  /** Что под жетоном на каждой клетке (null — жетона там нет). */
  tokens: (TokKind | null)[];
  /** Открыт ли жетон. */
  open: boolean[];
  turn: number;
  /** 'start' — каждый выбирает, откуда начинать (Танжер или Каир, так в правилах);
   * 'roll' — бросать кубик или лететь; 'step' — шагать по рёбрам (осталось left шагов);
   * 'open' — очки истрачены: можно открыть пройденные жетоны за 100 или закончить ход. */
  phase: 'start' | 'roll' | 'step' | 'open';
  /** Кто уже выбрал стартовый город. */
  started: boolean[];
  /** Выпало на кубике и сколько шагов осталось в этом ходу. */
  die: number;
  left: number;
  /** Кто несёт алмаз (-1 — не найден). */
  diamond: number;
  /** Алмаз лежит открыто на этой клетке (владелец налетел на разбойника) — иначе -1. */
  diamondSite: number;
  /** Кто первым пришёл в Кейптаун (премия 500). */
  cape: number;
  skip: number[];
  /** Разбойники-соперники: после находки алмаза охотятся за его владельцем. */
  bandit: boolean[];
  /** Жетон разбойника, сделавший игрока разбойником: выбывает, когда тот догонит владельца. */
  banditTok: number[];
  /** Закрытые жетоны, через которые фишка прошла в этом ходу: истратив все очки, их открывают за 100. */
  passed: number[];
  /** Отсидел три хода на острове без денег: следующий выход в море — бесплатно (вывозят). */
  served: boolean[];
  winner: number | null;
}

export type Action =
  | { type: 'start'; at: number }
  | { type: 'roll' }
  | { type: 'step'; to: number }
  | { type: 'stop' }
  | { type: 'air'; to: number }
  | { type: 'horse'; use: 'money' | 'move' }
  | { type: 'open'; cell: number };

export type Event =
  | { type: 'start'; seat: number; at: number }
  | { type: 'roll'; seat: number; die: number }
  | { type: 'step'; seat: number; from: number; to: number; kind: Kind; fee?: number; last?: boolean }
  | { type: 'air'; seat: number; from: number; to: number; fee: number }
  | { type: 'token'; seat: number; cell: number; tok: TokKind; gain?: number; lost?: number; slavery?: boolean; paid?: number }
  | { type: 'money'; seat: number; delta: number; total: number }
  | { type: 'horse'; seat: number; use: 'money' | 'move' }
  | { type: 'robfee'; seat: number; cell: number; paid: number }
  | { type: 'cape'; seat: number }
  | { type: 'stop'; seat: number }
  | { type: 'extra'; seat: number }
  | { type: 'skip'; seat: number }
  | { type: 'halt'; seat: number; cell: number }
  | { type: 'island'; seat: number }
  | { type: 'ferry'; seat: number }
  | { type: 'bandit'; seat: number; cell: number }
  | { type: 'catch'; seat: number; victim: number; money: number }
  | { type: 'drop'; seat: number; cell: number }
  | { type: 'pickup'; seat: number; cell: number }
  | { type: 'win'; seat: number };

const perSeat = <T>(v: T): T[] => Array.from({ length: SEATS_MAX }, () => v);

/** Жетоны раскладываются по 30 квадратам рубашкой вниз (перемешивание — из общего rng партии). */
export function newState(seats: number[], rng: Rng): State {
  const deck = DECK.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tokens: (TokKind | null)[] = CELLS.map(() => null);
  let k = 0;
  for (let i = 0; i < CELLS.length; i++) if (TOKEN_AT[i]) tokens[i] = deck[k++] ?? 'empty';
  return {
    seats: seats.slice(),
    pos: perSeat(START),
    money: perSeat(START_MONEY),
    horses: perSeat(0),
    extra: perSeat(0),
    tokens,
    open: CELLS.map(() => false),
    turn: seats[0],
    phase: 'roll',
    started: perSeat(false),
    die: 0,
    left: 0,
    diamond: -1,
    diamondSite: -1,
    cape: -1,
    skip: perSeat(0),
    bandit: perSeat(false),
    banditTok: perSeat(-1),
    passed: [],
    served: perSeat(false),
    winner: null,
  };
}

export const clone = (s: State): State => ({
  ...s,
  pos: s.pos.slice(),
  money: s.money.slice(),
  horses: s.horses.slice(),
  extra: s.extra.slice(),
  tokens: s.tokens.slice(),
  open: s.open.slice(),
  skip: s.skip.slice(),
  bandit: s.bandit.slice(),
  banditTok: s.banditTok.slice(),
  passed: s.passed.slice(),
  served: s.served.slice(),
  started: s.started.slice(),
});

const nextSeat = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** Заплатить сколько можешь (в долг не пускаем): возвращает списанное. */
function pay(s: State, seat: number, sum: number, ev: Event[]): number {
  const paid = Math.min(sum, Math.max(0, s.money[seat]));
  if (paid > 0) {
    s.money[seat] -= paid;
    ev.push({ type: 'money', seat, delta: -paid, total: s.money[seat] });
  }
  return paid;
}

function gain(s: State, seat: number, sum: number, ev: Event[]) {
  s.money[seat] += sum;
  ev.push({ type: 'money', seat, delta: sum, total: s.money[seat] });
}

/** Открытый разбойник на клетке? */
export const robberOpen = (s: Pick<State, 'open' | 'tokens'>, cell: number) => s.open[cell] && s.tokens[cell] === 'robber';

/** Можно ли шагнуть по ребру from→to: владельцу алмаза — не через открытых разбойников, в море из порта — за 100. */
export function canStep(s: State, seat: number, from: number, k: number): boolean {
  const to = NEIGH[from][k];
  if (to == null) return false;
  if (s.diamond === seat && robberOpen(s, to)) return false;
  if (EDGE[from][k] === 'sea' && PORT[from] && !s.served[seat] && s.money[seat] < SEA_FEE) return false;
  return true;
}

/** Владелец алмаза налетел на разбойника: деньги в банк, а алмаз выставляется на Кейптаун. */
function dropDiamond(s: State, seat: number, ev: Event[]) {
  s.diamond = -1;
  s.diamondSite = CAPE;
  ev.push({ type: 'drop', seat, cell: CAPE });
}

/** Игрок стал разбойником-соперником (алмаз найден, а он прошёл через разбойника). */
function makeBandit(s: State, seat: number, cell: number, ev: Event[]) {
  s.open[cell] = true;
  s.bandit[seat] = true;
  s.banditTok[seat] = cell;
  ev.push({ type: 'bandit', seat, cell });
}

/** Открыть жетон на клетке: остановка на ней или плата за пройденный. */
function reveal(s: State, seat: number, cell: number, ev: Event[], paid = 0) {
  if (!TOKEN_AT[cell] || s.open[cell]) return;
  const tok = s.tokens[cell] ?? 'empty';
  s.open[cell] = true;
  const e: Event = { type: 'token', seat, cell, tok, ...(paid ? { paid } : {}) };
  const stone = STONE[tok];
  if (stone) {
    const sum = stone * (cell === GOLD ? 2 : 1);
    e.gain = sum;
    ev.push(e);
    gain(s, seat, sum, ev);
    return;
  }
  if (tok === 'horse') {
    s.horses[seat]++;
  } else if (tok === 'robber') {
    // после находки алмаза разбойники грабят только его владельца, а остальных делают охотниками
    if (s.diamond >= 0 && s.diamond !== seat) {
      ev.push(e);
      if (!s.bandit[seat]) makeBandit(s, seat, cell, ev);
      return;
    }
    e.lost = s.money[seat];
    s.money[seat] = 0;
    if (cell === SLAVE && s.pos[seat] === cell && s.diamond < 0) {
      s.skip[seat] = Math.max(s.skip[seat], 3);
      e.slavery = true;
    }
    ev.push(e);
    if (s.diamond === seat) dropDiamond(s, seat, ev);
    return;
  } else if (tok === 'diamond') {
    s.diamond = seat;
    s.diamondSite = -1;
    s.tokens[cell] = 'empty';
  }
  ev.push(e);
}

/** Фишка вошла на клетку (шагом или перелётом): всё, что случается при проходе. true — победа. */
function enter(s: State, seat: number, cell: number, ev: Event[]): boolean {
  s.pos[seat] = cell;
  if (s.diamondSite === cell && s.diamond < 0) {
    s.diamondSite = -1;
    s.diamond = seat;
    s.bandit[seat] = false;
    ev.push({ type: 'pickup', seat, cell });
  }
  if (cell === CAPE && s.cape < 0) {
    s.cape = seat;
    ev.push({ type: 'cape', seat });
    gain(s, seat, FIRST_CAPE, ev);
  }
  if (TOKEN_AT[cell] && s.tokens[cell] === 'robber') {
    if (s.diamond < 0) {
      // пока алмаз не найден, проход через открытого разбойника стоит 100
      if (s.open[cell]) {
        const paid = pay(s, seat, ROBBER_FEE, ev);
        ev.push({ type: 'robfee', seat, cell, paid });
      }
    } else if (s.diamond !== seat && !s.bandit[seat]) {
      // алмаз найден: через разбойника (открытого или закрытого) — сам становишься разбойником
      makeBandit(s, seat, cell, ev);
    }
  }
  // разбойник-соперник прошёл через точку владельца: алмаз и деньги переходят к нему
  const victim = s.diamond;
  if (s.bandit[seat] && victim >= 0 && victim !== seat && s.pos[victim] === cell) {
    const money = s.money[victim];
    s.money[victim] = 0;
    s.money[seat] += money;
    s.diamond = seat;
    s.bandit[seat] = false;
    const tok = s.banditTok[seat];
    if (tok >= 0) {
      // жетон разбойника выбывает из игры
      s.tokens[tok] = 'empty';
      s.banditTok[seat] = -1;
    }
    ev.push({ type: 'catch', seat, victim, money });
    if (money > 0) ev.push({ type: 'money', seat, delta: money, total: s.money[seat] });
  }
  if (s.diamond === seat && FINISH.includes(cell)) {
    s.winner = seat;
    ev.push({ type: 'win', seat });
    return true;
  }
  return false;
}

/** Фишка остановилась: открыть жетон, разбойник и кружки — пропуск хода. */
function halt(s: State, seat: number, ev: Event[]) {
  const cell = s.pos[seat];
  if (TOKEN_AT[cell] && !s.open[cell]) reveal(s, seat, cell, ev);
  else if (robberOpen(s, cell) && s.diamond < 0) s.skip[seat] = Math.max(s.skip[seat], 1);
  if (HALT_AT[cell]) {
    s.skip[seat] = Math.max(s.skip[seat], 1);
    ev.push({ type: 'halt', seat, cell });
  }
}

/** Ход закончился: лишний ход за подкову или следующий игрок (кто не пропускает). */
function pass(s: State, seat: number, ev: Event[]) {
  s.phase = 'roll';
  s.left = 0;
  s.passed = [];
  if (s.extra[seat] > 0 && s.skip[seat] <= 0) {
    s.extra[seat]--;
    ev.push({ type: 'extra', seat });
    s.turn = seat;
    return;
  }
  let t = nextSeat(s, seat);
  for (let i = 0; i < 4 * s.seats.length && s.skip[t] > 0; i++) {
    s.skip[t]--;
    ev.push({ type: 'skip', seat: t });
    t = nextSeat(s, t);
  }
  s.turn = t;
}

/** Закрытые жетоны, мимо которых фишка прошла в этом ходу (их можно открыть за 100). */
export const openable = (s: State) => s.passed.filter((c) => TOKEN_AT[c] && !s.open[c]);

/** Очки кончились: если есть что открыть и есть на что — ждём решения, иначе ход переходит. */
function spent(s: State, seat: number, ev: Event[]) {
  halt(s, seat, ev);
  if (s.winner == null && openable(s).length && s.money[seat] >= OPEN_FEE) {
    s.phase = 'open';
    s.left = 0;
  } else pass(s, seat, ev);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const done = () => ({ state: s, events: ev });
  // начало партии: каждый сам решает, откуда идти — из Танжера или из Каира (так в правилах)
  if (a.type === 'start') {
    if (s.phase !== 'start' || !FINISH.includes(a.at)) return null;
    s.pos[seat] = a.at;
    s.started[seat] = true;
    ev.push({ type: 'start', seat, at: a.at });
    const left = s.seats.filter((x) => !s.started[x]);
    if (left.length) s.turn = left[0];
    else {
      s.phase = 'roll';
      s.turn = s.seats[0];
    }
    return done();
  }
  if (s.phase === 'start') return null;
  if (a.type === 'horse') {
    if (s.horses[seat] <= 0 || (a.use !== 'money' && a.use !== 'move')) return null;
    s.horses[seat]--;
    ev.push({ type: 'horse', seat, use: a.use });
    if (a.use === 'money') gain(s, seat, HORSE_MONEY, ev);
    else s.extra[seat]++;
    return done();
  }
  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    // остров: без денег и подков отсюда не уплыть — три хода в ожидании, потом вывозят бесплатно
    const here = s.pos[seat];
    if (ISLAND_AT[here] && !s.served[seat] && s.money[seat] < SEA_FEE && s.horses[seat] <= 0 && s.skip[seat] <= 0) {
      s.served[seat] = true;
      s.skip[seat] = 3;
      ev.push({ type: 'island', seat });
    }
    if (s.skip[seat] > 0) {
      s.skip[seat]--;
      ev.push({ type: 'skip', seat });
      pass(s, seat, ev);
      return done();
    }
    const die = rng.int(6) + 1;
    s.die = die;
    s.left = die;
    s.phase = 'step';
    s.passed = [];
    ev.push({ type: 'roll', seat, die });
    // если шагать некуда — ход заканчивается сразу
    if (!NEIGH[here].some((_, k) => canStep(s, seat, here, k))) pass(s, seat, ev);
    return done();
  }
  if (a.type === 'air') {
    if (s.phase !== 'roll' || !AIR[s.pos[seat]].includes(a.to) || s.money[seat] < AIR_FEE) return null;
    // владельцу алмаза и на открытого разбойника не прилететь
    if (s.diamond === seat && robberOpen(s, a.to)) return null;
    const from = s.pos[seat];
    s.money[seat] -= AIR_FEE;
    ev.push({ type: 'air', seat, from, to: a.to, fee: AIR_FEE }, { type: 'money', seat, delta: -AIR_FEE, total: s.money[seat] });
    if (enter(s, seat, a.to, ev)) return done();
    halt(s, seat, ev);
    pass(s, seat, ev);
    return done();
  }
  if (a.type === 'open') {
    if (s.phase !== 'open' || !openable(s).includes(a.cell) || s.money[seat] < OPEN_FEE) return null;
    s.money[seat] -= OPEN_FEE;
    ev.push({ type: 'money', seat, delta: -OPEN_FEE, total: s.money[seat] });
    reveal(s, seat, a.cell, ev, OPEN_FEE);
    if (!openable(s).length || s.money[seat] < OPEN_FEE) pass(s, seat, ev);
    return done();
  }
  if (a.type === 'stop') {
    if (s.phase === 'open') {
      ev.push({ type: 'stop', seat });
      pass(s, seat, ev);
      return done();
    }
    if (s.phase !== 'step') return null;
    ev.push({ type: 'stop', seat });
    // остановился, не истратив очков: открыть можно только то, на чём стоишь (если уже шагнул)
    if (s.left < s.die) halt(s, seat, ev);
    pass(s, seat, ev);
    return done();
  }
  if (a.type !== 'step' || s.phase !== 'step' || s.left <= 0) return null;
  const from = s.pos[seat];
  const k = NEIGH[from].indexOf(a.to);
  if (k < 0 || !canStep(s, seat, from, k)) return null;
  const kind = EDGE[from][k];
  let fee = 0;
  if (kind === 'sea' && PORT[from]) {
    if (s.served[seat] && s.money[seat] < SEA_FEE) {
      s.served[seat] = false;
      ev.push({ type: 'ferry', seat });
    } else {
      fee = pay(s, seat, SEA_FEE, ev);
      s.served[seat] = false;
    }
  }
  // клетка, с которой ушли (не стартовая этого хода), — пройденная: её закрытый жетон можно открыть за 100
  if (s.left < s.die && TOKEN_AT[from] && !s.open[from] && !s.passed.includes(from)) s.passed.push(from);
  s.left--;
  ev.push({ type: 'step', seat, from, to: a.to, kind, ...(fee ? { fee } : {}), ...(s.left <= 0 ? { last: true } : {}) });
  if (enter(s, seat, a.to, ev)) return done();
  if (s.left <= 0) spent(s, seat, ev);
  else if (!NEIGH[a.to].some((_, j) => canStep(s, seat, a.to, j))) {
    // дальше идти некуда — стоим здесь
    halt(s, seat, ev);
    pass(s, seat, ev);
  }
  return done();
}

/** Места, которые могут ходить прямо сейчас. */
export const toAct = (s: State) => (s.winner != null ? [] : [s.turn]);

/** Всё, что видит клиент: закрытые жетоны не выдают, что под ними. */
export function view(s: State): State {
  return { ...s, tokens: s.tokens.map((t, i) => (s.open[i] ? t : null)) };
}

export const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;

/** Название клетки для журнала. */
export const placeName = (cell: number) => CELLS[cell]?.t ?? null;

/** Короткая запись хода для журнала. */
export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'start':
      return `${name(ev.seat)} ставит фишку в ${placeName(ev.at) ?? 'город'} и начинает оттуда.`;
    case 'roll':
      return `${name(ev.seat)} бросает кубик: <b>${ev.die}</b>.`;
    case 'step': {
      // журнал пишет только заметные шаги: выход в море за плату и приход в город
      const place = placeName(ev.to);
      if (!ev.fee && !place) return null;
      const kind = ev.kind === 'sea' ? 'по морю' : 'по суше';
      const fee = ev.fee ? ` (−${ev.fee} $ за выход из порта)` : '';
      return `${name(ev.seat)} идёт ${kind}${place ? `: ${place}` : ''}${fee}.`;
    }
    case 'air':
      return `✈ ${name(ev.seat)} летит самолётом${placeName(ev.to) ? `: ${placeName(ev.from) ?? ''} → ${placeName(ev.to)}` : ''} (−${ev.fee} $).`;
    case 'token': {
      const what = TOK_NAME[ev.tok];
      const paid = ev.paid ? `, заплатив ${ev.paid} $` : '';
      const where = placeName(ev.cell) ? ` (${placeName(ev.cell)})` : '';
      if (ev.tok === 'diamond') return `💎 ${name(ev.seat)} находит <b>«Звезду Африки»</b>${where}! Её надо донести до Танжера или Каира.`;
      if (ev.gain) return `${TOK_ICON[ev.tok]} ${name(ev.seat)} открывает жетон${where}${paid}: <b>${what}</b> — из банка ${ev.gain} $.`;
      if (ev.tok === 'robber') {
        if (ev.lost == null) return `⚔️ ${name(ev.seat)} открывает жетон${where}${paid}: <b>разбойник</b>.`;
        return `⚔️ ${name(ev.seat)} открывает жетон${where}${paid}: <b>разбойник</b> — все деньги (${ev.lost} $) пропали${ev.slavery ? ', да ещё рабство — три хода' : ''}.`;
      }
      if (ev.tok === 'horse') return `🧲 ${name(ev.seat)} открывает жетон${where}${paid}: <b>подкова</b> — её меняют на 100 $ или на лишний ход.`;
      return `· ${name(ev.seat)} открывает жетон${where}${paid}: пусто.`;
    }
    case 'money':
      return null; // деньги видны в строке игрока; в журнале — только причина
    case 'horse':
      return ev.use === 'money'
        ? `🧲 ${name(ev.seat)} сдаёт подкову в банк: +100 $.`
        : `🧲 ${name(ev.seat)} тратит подкову на лишний ход.`;
    case 'robfee':
      return `⚔️ ${name(ev.seat)} проходит мимо открытого разбойника${placeName(ev.cell) ? ` (${placeName(ev.cell)})` : ''}: −${ev.paid} $.`;
    case 'cape':
      return `🏁 ${name(ev.seat)} первым добрался до Кейптауна: премия <b>500 $</b>.`;
    case 'stop':
      return null;
    case 'extra':
      return `🧲 ${name(ev.seat)} ходит ещё раз (подкова).`;
    case 'skip':
      return `${name(ev.seat)} пропускает ход.`;
    case 'halt':
      return `🔵 ${name(ev.seat)} встаёт на обведённый кружок — следующий ход пропущен.`;
    case 'island':
      return `🏝 ${name(ev.seat)} остался на острове без денег и подков — три хода в ожидании.`;
    case 'ferry':
      return `⛵ ${name(ev.seat)} вывозят с острова бесплатно.`;
    case 'bandit':
      return `⚔️ ${name(ev.seat)} проходит через разбойника и сам становится <b>разбойником-соперником</b> — теперь он охотится за алмазом.`;
    case 'catch':
      return `⚔️ ${name(ev.seat)} настигает ${name(ev.victim)}: «Звезда Африки» и ${ev.money} $ переходят к нему!`;
    case 'drop':
      return `💎 ${name(ev.seat)} налетел на разбойника: деньги в банк, а алмаз выставлен открыто на Кейптаун.`;
    case 'pickup':
      return `💎 ${name(ev.seat)} подбирает «Звезду Африки» на Кейптауне!`;
    case 'win':
      return `🏁 ${name(ev.seat)} доставил «Звезду Африки» — победа!`;
  }
  return null;
}
