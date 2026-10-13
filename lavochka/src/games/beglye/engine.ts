/* «Беглые, или Вот тебе, бабушка, и Юрьев день» — движок: ход по знакам кубика, состояния фишки
 * (монастырь, помещик, острог, плен, шайка разбойников), лодка и лошадь, гибель и начало заново.
 * Без DOM: гоняет и сервер, и тесты. Карта — public/beglye/field.webp. */
import type { Rng } from '../../core/types';
import data from './data.json';

interface RawCell {
  id: string;
  x: number;
  y: number;
  kind: 'point' | 'start' | 'finish';
  signs: string[];
  next: string[];
}

export const W = (data as { w: number }).w;
export const H = (data as { h: number }).h;
export const CELLS = (data as { cells: RawCell[] }).cells;
export const IDX: { [id: string]: number } = {};
CELLS.forEach((c, i) => (IDX[c.id] = i));
export const NEIGH: number[][] = CELLS.map((c) => c.next.map((id) => IDX[id]));
export const START = IDX[(data as { start: string }).start];
export const FINISH = IDX[(data as { finish: string }).finish];

/** Грани кубика: две особые («Побег» и «Юрьев день») и четыре с четырьмя значками. */
export interface Face {
  id: string;
  name: string;
  short: string;
  symbols: string[];
  escape?: boolean;
  free?: boolean;
}

export const FACES: Face[] = [
  { id: 'escape', name: 'Побег', short: '🏃', symbols: [], escape: true },
  { id: 'yuriev', name: 'Юрьев день', short: '🌿', symbols: [], free: true },
  { id: 'a', name: 'Грань с лесом', short: '🌲', symbols: ['forest', 'resident', 'ostrog', 'robber'] },
  { id: 'b', name: 'Грань с пленом', short: '🐎', symbols: ['forest', 'resident', 'ostrog', 'plen'] },
  { id: 'c', name: 'Грань с острогом', short: '⛓', symbols: ['arrest', 'death', 'monastery'] },
  { id: 'd', name: 'Грань со зверем', short: '🐻', symbols: ['arrest', 'death', 'monastery'] },
];

/** Названия знаков — как в легенде карты. */
export const SIGN_NAME: { [k: string]: string } = {
  monastery: 'монастырь',
  resident: 'помещик',
  ostrog: 'острог',
  arrest: 'арест',
  forest: 'заблудился в лесу',
  plen: 'плен',
  robber: 'разбойник',
  death: 'гибель',
  boat: 'лодка',
  horse: 'лошадь',
  cart: 'лошадь с телегой',
};

/** Что фишка делает: свободна, сидит или плывёт. */
export type Hold = 'none' | 'monastery' | 'resident' | 'plen' | 'robber' | 'ostrog';

export interface State {
  seats: number[];
  pos: number[];
  turn: number;
  phase: 'roll' | 'move' | 'event' | 'over';
  /** Сколько пунктов осталось пройти в этом ходу. */
  left: number;
  /** Выпавшая грань. */
  face: string;
  /** Кто где держится. */
  hold: Hold[];
  /** Сколько раз подряд выпадал «арест» (второй раз — в острог). */
  arrests: number[];
  /** Кто плывёт в лодке. */
  boat: boolean[];
  winner: number | null;
  log: string[];
  moves: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'step'; to: number }
  | { type: 'stay' };

export type Event =
  | { type: 'roll'; seat: number; face: string }
  | { type: 'step'; seat: number; to: number }
  | { type: 'move'; seat: number; n: number; why: string }
  | { type: 'hold'; seat: number; hold: Hold; why: string }
  | { type: 'free'; seat: number; why: string }
  | { type: 'extra'; seat: number }
  | { type: 'jail'; seat: number }
  | { type: 'death'; seat: number; why: string }
  | { type: 'win'; seat: number };

const clone = (s: State): State => ({
  ...s,
  pos: s.pos.slice(),
  hold: s.hold.slice(),
  arrests: s.arrests.slice(),
  boat: s.boat.slice(),
  log: s.log.slice(),
});

export function newState(seats: number[]): State {
  return {
    seats: seats.slice(),
    pos: CELLS.map(() => START),
    turn: seats[0],
    phase: 'roll',
    left: 0,
    face: FACES[0].id,
    hold: CELLS.map(() => 'none' as Hold),
    arrests: CELLS.map(() => 0),
    boat: CELLS.map(() => false),
    winner: null,
    log: [],
    moves: 0,
  };
}

const nextSeat = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

/** Кратчайший путь к финишу (для острога: ведут «по этапу» назад, к монастырю). */
function distTo(target: number): number[] {
  const d = CELLS.map(() => -1);
  d[target] = 0;
  const q = [target];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of NEIGH[cur]) if (d[n] < 0) {
      d[n] = d[cur] + 1;
      q.push(n);
    }
  }
  return d;
}
export const TO_FINISH = distTo(FINISH);
export const TO_START = distTo(START);

const pass = (s: State, seat: number, ev: Event[]) => {
  s.turn = nextSeat(s, seat);
  s.phase = 'roll';
  s.left = 0;
  void ev;
};

/** Освобождение: из монастыря и от помещика отпускают «Побег» и «Юрьев день», из плена и шайки — только «Побег». */
function tryFree(s: State, seat: number, face: Face, ev: Event[]): boolean {
  const hold = s.hold[seat];
  if (hold === 'none') return false;
  const byEscape = !!face.escape;
  const byYuriev = !!face.free && (hold === 'monastery' || hold === 'resident');
  if (!byEscape && !byYuriev) return false;
  s.hold[seat] = 'none';
  ev.push({ type: 'free', seat, why: face.name });
  if (byEscape) ev.push({ type: 'extra', seat });
  return true;
}

/** Разыграть знак клетки, если он есть на выпавшей грани. */
function cellSign(s: State, seat: number, face: Face, ev: Event[], rng: Rng) {
  const cell = CELLS[s.pos[seat]];
  const hit = cell.signs.filter((x) => face.symbols.includes(x));
  if (!hit.length) return;
  for (const sign of hit) {
    if (sign === 'death') {
      s.pos[seat] = START;
      s.hold[seat] = 'none';
      s.boat[seat] = false;
      s.arrests[seat] = 0;
      ev.push({ type: 'death', seat, why: SIGN_NAME[sign] });
      return;
    }
    if (sign === 'plen') {
      s.hold[seat] = 'plen';
      s.boat[seat] = false;
      ev.push({ type: 'hold', seat, hold: 'plen', why: 'татары взяли в плен' });
      return;
    }
    if (sign === 'robber') {
      s.hold[seat] = 'robber';
      s.boat[seat] = false;
      ev.push({ type: 'hold', seat, hold: 'robber', why: 'ушёл в шайку разбойников' });
      return;
    }
    if (sign === 'monastery') {
      s.hold[seat] = 'monastery';
      ev.push({ type: 'hold', seat, hold: 'monastery', why: 'монастырь: сидеть до побега' });
      return;
    }
    if (sign === 'resident') {
      s.hold[seat] = 'resident';
      ev.push({ type: 'hold', seat, hold: 'resident', why: 'помещик: сидеть до Юрьева дня' });
      return;
    }
    if (sign === 'ostrog') {
      s.hold[seat] = 'ostrog';
      s.boat[seat] = false;
      ev.push({ type: 'jail', seat });
      return;
    }
    if (sign === 'arrest') {
      s.arrests[seat]++;
      if (s.arrests[seat] >= 2) {
        s.hold[seat] = 'ostrog';
        s.boat[seat] = false;
        s.arrests[seat] = 0;
        ev.push({ type: 'jail', seat });
        return;
      }
      continue;
    }
    if (sign === 'forest') {
      // заблудился: ход пропадает
      s.left = 0;
      ev.push({ type: 'hold', seat, hold: 'none', why: 'заблудился в лесу — ход пропал' });
      return;
    }
    if (sign === 'horse' || sign === 'cart') {
      const n = 2;
      s.left += n;
      ev.push({ type: 'move', seat, n, why: SIGN_NAME[sign] });
      continue;
    }
    if (sign === 'boat') {
      s.boat[seat] = true;
      const n = 2;
      s.left += n;
      ev.push({ type: 'move', seat, n, why: 'лодка: вниз по течению' });
      continue;
    }
  }
  void rng;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];

  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    const face = FACES[rng.int(6)];
    s.face = face.id;
    s.moves++;
    ev.push({ type: 'roll', seat, face: face.name });
    // острог: по этапу на север, к монастырю — пока не выпадет «Побег»
    if (s.hold[seat] === 'ostrog') {
      if (face.escape) {
        s.hold[seat] = 'none';
        ev.push({ type: 'free', seat, why: 'побег с этапа' });
        ev.push({ type: 'extra', seat });
      } else {
        const here = s.pos[seat];
        const ns = NEIGH[here].slice().sort((x, y) => (TO_START[x] ?? 999) - (TO_START[y] ?? 999));
        if (ns.length && (TO_START[ns[0]] ?? 999) < (TO_START[here] ?? 999)) {
          s.pos[seat] = ns[0];
          ev.push({ type: 'step', seat, to: ns[0] });
        }
        pass(s, seat, ev);
        return { state: s, events: ev };
      }
    }
    // освобождение и знак клетки
    const freed = tryFree(s, seat, face, ev);
    if (s.hold[seat] === 'none') cellSign(s, seat, face, ev, rng);
    if (s.hold[seat] !== 'none') {
      pass(s, seat, ev);
      return { state: s, events: ev };
    }
    if (s.left <= 0) s.left = 1;
    if (freed && face.escape) s.left = 1;
    s.phase = 'move';
    if (!NEIGH[s.pos[seat]].length) {
      pass(s, seat, ev);
      return { state: s, events: ev };
    }
    return { state: s, events: ev };
  }

  if (a.type === 'step') {
    if (s.phase !== 'move' || s.left <= 0) return null;
    if (!NEIGH[s.pos[seat]].includes(a.to)) return null;
    s.pos[seat] = a.to;
    s.left--;
    ev.push({ type: 'step', seat, to: a.to });
    if (a.to === FINISH) {
      s.winner = seat;
      ev.push({ type: 'win', seat });
      return { state: s, events: ev };
    }
    if (s.left <= 0) pass(s, seat, ev);
    return { state: s, events: ev };
  }

  if (a.type === 'stay') {
    if (s.phase !== 'move') return null;
    pass(s, seat, ev);
    return { state: s, events: ev };
  }
  return null;
}

export const toAct = (s: State) => (s.winner != null ? [] : [s.turn]);
export const view = (s: State) => s;

export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'roll':
      return `${name(ev.seat)} бросает кубик: выпало «${ev.face}».`;
    case 'step':
      return `${name(ev.seat)} идёт на один пункт.`;
    case 'move':
      return `${ev.why}: ещё ${ev.n} пункта.`;
    case 'hold':
      return ev.hold === 'none'
        ? `${name(ev.seat)}: ${ev.why}.`
        : `${name(ev.seat)} — ${ev.why}.`;
    case 'free':
      return `${name(ev.seat)} на свободе: ${ev.why}.`;
    case 'extra':
      return `«Побег» — ${name(ev.seat)} бросает кубик ещё раз.`;
    case 'jail':
      return `${name(ev.seat)} идёт по этапу: острог.`;
    case 'death':
      return `💀 ${name(ev.seat)} погиб (${ev.why}) — начинает из Кирилло-Белозерского монастыря.`;
    case 'win':
      return `🏆 ${name(ev.seat)} дошёл до устья Дона — воля!`;
    default:
      return null;
  }
}
