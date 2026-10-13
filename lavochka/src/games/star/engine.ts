/* «Звезда Африки» — карта-граф: фишка идёт по рёбрам (суша/море/авиа) шаг за шагом, сама выбирая дорогу.
 * Жетоны (30 штук) лежат закрытыми: остановился — открыл. Деньги идут за камни, за выход в море и за перелёт.
 * Цель — найти «Звезду Африки» и принести её в Танжер или Каир. Без DOM: движок гоняет сервер и тесты. */
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
/** Порт — город на карте (жетон-город или Танжер/Каир): выход из него в море стоит 100. */
export const PORT = CELLS.map((c) => c.kind === 'token' || c.kind === 'city');

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
  robber: '🗡',
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

export interface State {
  seats: number[];
  /** Где чья фишка (индекс клетки). */
  pos: number[];
  money: number[];
  /** Подковы: их хранят и тратят по желанию (100 денег или лишний бросок). */
  horses: number[];
  /** Что под жетоном на каждой клетке (null — жетона там нет). */
  tokens: (TokKind | null)[];
  /** Открыт ли жетон. */
  open: boolean[];
  turn: number;
  /** 'roll' — бросать кубик, 'step' — шагать по рёбрам (осталось left шагов). */
  phase: 'roll' | 'step';
  /** Сколько шагов осталось в этом ходу. */
  left: number;
  /** Кто несёт алмаз (-1 — не найден). */
  diamond: number;
  /** Кто первым пришёл в Кейптаун (премия 500). */
  cape: number;
  skip: number[];
  winner: number | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'step'; to: number }
  | { type: 'stop' }
  | { type: 'air'; to: number }
  | { type: 'horse'; use: 'money' | 'move' };

export type Event =
  | { type: 'roll'; seat: number; die: number }
  | { type: 'step'; seat: number; to: number; kind: Kind; fee?: number }
  | { type: 'air'; seat: number; to: number; fee: number }
  | { type: 'token'; seat: number; cell: number; tok: TokKind; gain?: number; lost?: number; slavery?: boolean }
  | { type: 'money'; seat: number; delta: number; total: number }
  | { type: 'horse'; seat: number; use: 'money' | 'move'; left: number }
  | { type: 'stop'; seat: number }
  | { type: 'skip'; seat: number }
  | { type: 'win'; seat: number };

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
    pos: CELLS.map(() => START),
    money: CELLS.map(() => START_MONEY),
    horses: CELLS.map(() => 0),
    tokens,
    open: CELLS.map(() => false),
    turn: seats[0],
    phase: 'roll',
    left: 0,
    diamond: -1,
    cape: -1,
    skip: CELLS.map(() => 0),
    winner: null,
  };
}

export const clone = (s: State): State => ({
  ...s,
  pos: s.pos.slice(),
  money: s.money.slice(),
  horses: s.horses.slice(),
  open: s.open.slice(),
  skip: s.skip.slice(),
});

const nextSeat = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** Открыть жетон, на который встала фишка: клад, камень, подкова, разбойник или алмаз. */
function reveal(s: State, seat: number, cell: number, ev: Event[]) {
  if (!TOKEN_AT[cell] || s.open[cell]) {
    // открытый разбойник: проход стоит 100, пока алмаз не найден
    if (s.open[cell] && s.tokens[cell] === 'robber' && s.diamond < 0) {
      const fee = Math.min(100, s.money[seat]);
      if (fee > 0) {
        s.money[seat] -= fee;
        ev.push({ type: 'money', seat, delta: -fee, total: s.money[seat] });
      }
    }
    return;
  }
  const tok = s.tokens[cell] ?? 'empty';
  s.open[cell] = true;
  const e: Event = { type: 'token', seat, cell, tok };
  if (STONE[tok]) {
    const gain = (STONE[tok] ?? 0) * (cell === GOLD ? 2 : 1);
    s.money[seat] += gain;
    e.gain = gain;
    ev.push(e, { type: 'money', seat, delta: gain, total: s.money[seat] });
    return;
  }
  if (tok === 'horse') {
    s.horses[seat]++;
  } else if (tok === 'robber') {
    e.lost = s.money[seat];
    s.money[seat] = 0;
    if (cell === SLAVE) {
      s.skip[seat] = Math.max(s.skip[seat], 3);
      e.slavery = true;
    }
  } else if (tok === 'diamond') {
    s.diamond = seat;
  }
  ev.push(e);
}

/** Фишка встала на клетку: премия Кейптауна, жетон, победа с алмазом в Танжере или Каире. */
function land(s: State, seat: number, cell: number, ev: Event[]) {
  s.pos[seat] = cell;
  if (cell === CAPE && s.cape < 0) {
    s.cape = seat;
    s.money[seat] += FIRST_CAPE;
    ev.push({ type: 'money', seat, delta: FIRST_CAPE, total: s.money[seat] });
  }
  reveal(s, seat, cell, ev);
  if (s.diamond === seat && FINISH.includes(cell)) {
    s.winner = seat;
    ev.push({ type: 'win', seat });
    return true;
  }
  return false;
}

/** Ход закончился: ход переходит дальше (кто не пропускает). */
function pass(s: State, seat: number, ev: Event[]) {
  s.phase = 'roll';
  s.left = 0;
  let t = nextSeat(s, seat);
  for (let i = 0; i < 4 * s.seats.length && s.skip[t] > 0; i++) {
    s.skip[t]--;
    ev.push({ type: 'skip', seat: t });
    t = nextSeat(s, t);
  }
  s.turn = t;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (a?.type === 'roll') {
    if (s.phase !== 'roll') return null;
    if (s.skip[seat] > 0) {
      s.skip[seat]--;
      ev.push({ type: 'skip', seat });
      pass(s, seat, ev);
      return { state: s, events: ev };
    }
    const die = rng.int(6) + 1;
    s.left = die;
    s.phase = 'step';
    ev.push({ type: 'roll', seat, die });
    // если шагать некуда (тупик) — ход заканчивается сразу
    if (!NEIGH[s.pos[seat]].length && !AIR[s.pos[seat]].length) pass(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a?.type === 'horse') {
    if (s.horses[seat] <= 0) return null;
    s.horses[seat]--;
    if (a.use === 'money') {
      s.money[seat] += 100;
      ev.push({ type: 'horse', seat, use: 'money', left: s.left }, { type: 'money', seat, delta: 100, total: s.money[seat] });
    } else {
      s.phase = 'roll';
      s.left = 0;
      ev.push({ type: 'horse', seat, use: 'move', left: 0 });
    }
    return { state: s, events: ev };
  }
  if (a?.type === 'air') {
    if (s.phase !== 'roll' || !AIR[s.pos[seat]].includes(a.to)) return null;
    if (s.money[seat] < AIR_FEE) return null;
    s.money[seat] -= AIR_FEE;
    ev.push({ type: 'air', seat, to: a.to, fee: AIR_FEE }, { type: 'money', seat, delta: -AIR_FEE, total: s.money[seat] });
    if (land(s, seat, a.to, ev)) return { state: s, events: ev };
    pass(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a?.type === 'stop') {
    if (s.phase !== 'step') return null;
    // остановился на открытом разбойнике — ещё и пропуск хода
    if (s.open[s.pos[seat]] && s.tokens[s.pos[seat]] === 'robber' && s.diamond < 0) s.skip[seat] = Math.max(s.skip[seat], 1);
    ev.push({ type: 'stop', seat });
    pass(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a?.type !== 'step' || s.phase !== 'step' || s.left <= 0) return null;
  const from = s.pos[seat];
  const i = NEIGH[from].indexOf(a.to);
  if (i < 0) return null;
  const kind = EDGE[from][i];
  const fee = kind === 'sea' && PORT[from] ? SEA_FEE : 0;
  let paid = 0;
  if (fee > 0) {
    paid = Math.min(fee, s.money[seat]);
    s.money[seat] -= paid;
    ev.push({ type: 'money', seat, delta: -paid, total: s.money[seat] });
  }
  s.left--;
  ev.push({ type: 'step', seat, to: a.to, kind, ...(paid ? { fee: paid } : {}) });
  if (land(s, seat, a.to, ev)) return { state: s, events: ev };
  if (s.left <= 0) pass(s, seat, ev);
  return { state: s, events: ev };
}

/** Места, которые могут ходить прямо сейчас. */
export const toAct = (s: State) => (s.winner != null ? [] : [s.turn]);

/** Всё, что видит клиент: закрытые жетоны не выдают, что под ними. */
export function view(s: State): State {
  return { ...s, tokens: s.tokens.map((t, i) => (s.open[i] ? t : null)) };
}

export const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;

/** Короткая запись хода для журнала. */
export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'roll':
      return `${name(ev.seat)} бросает кубик: <b>${ev.die}</b>.`;
    case 'step': {
      const cell = CELLS[ev.to];
      const kind = ev.kind === 'sea' ? 'по морю' : 'по суше';
      const fee = ev.fee ? ` (−${ev.fee} $ за выход из порта)` : '';
      return `${name(ev.seat)} идёт ${kind}${cell.t ? ` в ${cell.t}` : ''}${fee}.`;
    }
    case 'air':
      return `${name(ev.seat)} летит самолётом (−${ev.fee} $)${CELLS[ev.to].t ? ` в ${CELLS[ev.to].t}` : ''}.`;
    case 'token': {
      const what = TOK_NAME[ev.tok];
      if (ev.tok === 'diamond') return `💎 ${name(ev.seat)} находит <b>«Звезду Африки»</b>! Её надо донести до Танжера или Каира.`;
      if (ev.gain) return `${TOK_ICON[ev.tok]} ${name(ev.seat)} открывает жетон: <b>${what}</b> — в банк ${ev.gain} $.`;
      if (ev.tok === 'robber') {
        return `🗡 ${name(ev.seat)} открывает <b>разбойника</b>: все деньги (${ev.lost ?? 0} $) пропали${ev.slavery ? ', да ещё рабство — три хода' : ''}.`;
      }
      if (ev.tok === 'horse') return `🧲 ${name(ev.seat)} открывает <b>подкову</b>: её можно обменять на 100 $ или на лишний ход.`;
      return `· ${name(ev.seat)} открывает пустой жетон.`;
    }
    case 'money':
      return ev.delta >= 0
        ? `💰 ${name(ev.seat)} получает <b>${ev.delta}</b> $ (всего ${ev.total}).`
        : `💸 ${name(ev.seat)} платит <b>${-ev.delta}</b> $ (осталось ${ev.total}).`;
    case 'horse':
      return ev.use === 'money'
        ? `🧲 ${name(ev.seat)} обменивает подкову на 100 $.`
        : `🧲 ${name(ev.seat)} тратит подкову на лишний бросок.`;
    case 'stop':
      return `${name(ev.seat)} останавливается.`;
    case 'skip':
      return `${name(ev.seat)} пропускает ход.`;
    case 'win':
      return `🏁 ${name(ev.seat)} доставил «Звезду Африки» — победа!`;
  }
  return null;
}
