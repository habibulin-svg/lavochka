/* Суракарта (Ява, Индонезия) — правила без DOM.
 * Доска — 6×6 точек, соединённых линиями. Вторые от края линии (x = 1, 4 и y = 1, 4) замкнуты по углам малыми петлями
 * в один «малый круг», третьи (x = 2, 3 и y = 2, 3) — большими петлями в «большой круг». Угловые точки ни в один круг
 * не входят. У каждого по 12 фишек в двух ближних рядах; красные (место 0) — снизу, ходят первыми.
 * Ход — на соседнюю пустую точку в любом из 8 направлений. Взятие — проходом по кругу: фишка едет по линии, проходит
 * хотя бы одну петлю и встаёт на место первой встреченной чужой фишки; путь до неё пустой (свою начальную точку можно
 * пересечь — она уже пуста). Брать не обязательно.
 * Конец: сняты все фишки соперника. Если QUIET полуходов подряд никто не берёт — партия кончается, побеждает тот,
 * у кого больше фишек (так у Gambiter; в Википедии — «по соглашению»).
 * «На очки» — серия из нескольких партий: победитель партии получает столько очков, сколько у него осталось фишек;
 * первый ход по очереди. Побеждает больший счёт. */
import type { Options } from '../../core/types';

export const RED = 1;
export const WHITE = 2;
export const N = 6;
export type Look = 'wood' | 'batik';

export interface Cfg {
  /** Партий в серии (1 — одна партия до последней фишки). */
  games: number;
  look: Look;
}

export const GAMES = [1, 2, 4, 6];

export function cfgFrom(o: Options): Cfg {
  const games = Number(o.games);
  return { games: GAMES.includes(games) ? games : 1, look: o.look === 'batik' ? 'batik' : 'wood' };
}

/** Направления шага: 0..7. */
export const DIRS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export const at = (x: number, y: number) => y * N + x;

/** Круг: 24 точки по порядку (точки пересечения своих линий — дважды); loop[i] — петля между seq[i] и seq[i + 1].
 * corner[i] — угол доски, вокруг которого идёт эта петля. */
export interface Circuit {
  k: number;
  seq: number[];
  loop: boolean[];
  corner: [number, number][];
}

function circuit(k: number): Circuit {
  const seq: number[] = [];
  const loop: boolean[] = [];
  const corner: [number, number][] = [];
  const side = (pts: number[], c: [number, number]) => {
    pts.forEach((p, i) => {
      seq.push(p);
      loop.push(i === pts.length - 1);
      corner.push(c);
    });
  };
  const r = [0, 1, 2, 3, 4, 5];
  const m = N - 1 - k;
  side(r.map((x) => at(x, k)), [5, 0]); // вправо по y = k, петля вокруг правого верхнего угла
  side(r.map((y) => at(m, y)), [5, 5]); // вниз по x = 5 − k
  side(r.map((x) => at(5 - x, m)), [0, 5]); // влево по y = 5 − k
  side(r.map((y) => at(k, 5 - y)), [0, 0]); // вверх по x = k
  return { k, seq, loop, corner };
}

/** 0 — малый круг (петли радиуса 1), 1 — большой (радиуса 2). */
export const CIRCUITS: Circuit[] = [circuit(1), circuit(2)];

/** Путь взятия: круг, откуда (номер в seq), в какую сторону, сколько шагов. */
export interface Track {
  c: number;
  i: number;
  d: 1 | -1;
  n: number;
}

/** Точки пути по порядку; loop — перед этой точкой пройдена петля (вокруг угла corner). */
export function trackSteps(t: Track): { p: number; loop: boolean; corner: [number, number] }[] {
  const c = CIRCUITS[t.c];
  const out: { p: number; loop: boolean; corner: [number, number] }[] = [];
  let j = t.i;
  for (let k = 0; k < t.n; k++) {
    const e = t.d === 1 ? j : (j + 23) % 24; // номер ребра между j и следующей
    j = (j + t.d + 24) % 24;
    out.push({ p: c.seq[j], loop: c.loop[e], corner: c.corner[e] });
  }
  return out;
}

export interface State {
  cfg: Cfg;
  board: number[];
  turn: number;
  /** Номер партии в серии (с нуля) и кто её начинал. */
  game: number;
  first: number;
  /** Очки серии. */
  score: [number, number];
  /** Сделано полуходов. */
  ply: number;
  /** Полуходов подряд без взятий. */
  quiet: number;
  over: boolean;
  winner: number | null;
  last: number[];
}

export type Action = { type: 'move'; from: number; to: number };
export type Event =
  | { type: 'step'; seat: number; from: number; to: number }
  | { type: 'take'; seat: number; from: number; to: number; track: Track }
  | { type: 'round'; winner: number | null; why: Why; points: number; score: [number, number] }
  | { type: 'end'; winner: number | null; why: Why };

export type Why = 'all' | 'stuck' | 'quiet' | 'match';

/** Полуходов подряд без взятий до конца партии. */
export const QUIET = 80;

export const own = (seat: number) => (seat === 0 ? RED : WHITE);
export const count = (s: State, seat: number) => s.board.reduce((n, v) => n + (v === own(seat) ? 1 : 0), 0);

function fresh(): number[] {
  const board = new Array(N * N).fill(0);
  for (let x = 0; x < N; x++) {
    board[at(x, 0)] = WHITE;
    board[at(x, 1)] = WHITE;
    board[at(x, 4)] = RED;
    board[at(x, 5)] = RED;
  }
  return board;
}

export function newState(cfg: Cfg): State {
  return { cfg, board: fresh(), turn: 0, game: 0, first: 0, score: [0, 0], ply: 0, quiet: 0, over: false, winner: null, last: [] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Все взятия фишкой с точки p: цель → кратчайший путь. */
export function takesFrom(board: number[], p: number): Map<number, Track> {
  const me = board[p];
  const out = new Map<number, Track>();
  if (!me) return out;
  for (let c = 0; c < 2; c++) {
    const C = CIRCUITS[c];
    for (let i = 0; i < 24; i++) {
      if (C.seq[i] !== p) continue;
      for (const d of [1, -1] as const) {
        let j = i;
        let loops = 0;
        for (let n = 1; n < 24; n++) {
          const e = d === 1 ? j : (j + 23) % 24;
          if (C.loop[e]) loops++;
          j = (j + d + 24) % 24;
          const q = C.seq[j];
          if (q === p) continue; // своя начальная точка пуста
          const v = board[q];
          if (!v) continue;
          if (v !== me && loops > 0) {
            const old = out.get(q);
            if (!old || old.n > n) out.set(q, { c, i, d, n });
          }
          break;
        }
      }
    }
  }
  return out;
}

function stepsFrom(board: number[], p: number): number[] {
  const x = p % N;
  const y = (p - x) / N;
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    const x1 = x + dx;
    const y1 = y + dy;
    if (x1 < 0 || y1 < 0 || x1 >= N || y1 >= N) continue;
    const q = at(x1, y1);
    if (!board[q]) out.push(q);
  }
  return out;
}

/** Ходы места, которое ходит: сначала взятия, потом шаги. */
export function legal(s: State): Action[] {
  if (s.over) return [];
  const me = own(s.turn);
  const takes: Action[] = [];
  const steps: Action[] = [];
  for (let p = 0; p < N * N; p++) {
    if (s.board[p] !== me) continue;
    for (const q of takesFrom(s.board, p).keys()) takes.push({ type: 'move', from: p, to: q });
    for (const q of stepsFrom(s.board, p)) steps.push({ type: 'move', from: p, to: q });
  }
  return [...takes, ...steps];
}

/** Победитель по счёту фишек (null — поровну). */
function byCount(s: State): number | null {
  const a = count(s, 0);
  const b = count(s, 1);
  return a === b ? null : a > b ? 0 : 1;
}

/** Применить ход без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, board: s0.board.slice() };
  const seat = s0.turn;
  const events: Event[] = [];
  const took = !!s.board[a.to];
  if (took) {
    const track = takesFrom(s0.board, a.from).get(a.to)!;
    events.push({ type: 'take', seat, from: a.from, to: a.to, track });
  } else events.push({ type: 'step', seat, from: a.from, to: a.to });
  s.board[a.to] = s.board[a.from];
  s.board[a.from] = 0;
  s.last = [a.from, a.to];
  s.ply++;
  s.quiet = took ? 0 : s.quiet + 1;
  s.turn = 1 - seat;
  let why: Why | null = null;
  let w: number | null = null;
  if (!count(s, s.turn)) {
    why = 'all';
    w = seat;
  } else if (!legal(s).length) {
    why = 'stuck';
    w = seat;
  } else if (s.quiet >= QUIET) {
    why = 'quiet';
    w = byCount(s);
  }
  if (why) endGame(s, w, why, events);
  return { state: s, events };
}

/** Партия кончилась: в серии — очки и новая партия, иначе — конец. */
function endGame(s: State, w: number | null, why: Why, events: Event[]) {
  if (s.cfg.games <= 1) {
    s.over = true;
    s.winner = w;
    events.push({ type: 'end', winner: w, why });
    return;
  }
  const points = w == null ? 0 : count(s, w);
  s.score = [s.score[0], s.score[1]];
  if (w != null) s.score[w] += points;
  events.push({ type: 'round', winner: w, why, points, score: [s.score[0], s.score[1]] });
  if (s.game + 1 >= s.cfg.games) {
    s.over = true;
    s.winner = s.score[0] === s.score[1] ? null : s.score[0] > s.score[1] ? 0 : 1;
    events.push({ type: 'end', winner: s.winner, why: 'match' });
    return;
  }
  s.game++;
  s.first = 1 - s.first;
  s.turn = s.first;
  s.board = fresh();
  s.quiet = 0;
  s.last = [];
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || a.type !== 'move') return null;
  return legal(s).some((m) => m.from === a.from && m.to === a.to) ? step(s, a) : null;
}
