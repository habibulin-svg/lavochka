/* Шашки — правила (без DOM): русские, международные (10×10), бразильские, столбовые (башни) и Ласка (7×7);
 * поддавки и «фук» по-дворовому — на любой доске.
 *
 * Доска n×n, индекс = ряд * n + вертикаль (a1 = 0, ряд 0 — со стороны белых). Играют только тёмные поля: (ряд + вертикаль) чётно.
 * Поле — строка шашек сверху вниз: '' — пусто, 'w' / 'W' — белая простая / дамка, 'b' / 'B' — чёрная.
 * В обычных шашках на поле не больше одной шашки; в столбовых — башня, ходит она на правах верхней («wbB» — белая простая сверху).
 * Место 0 — белые (ходят первыми), 1 — чёрные.
 * Обычные шашки бьют «турецким ударом»: побитые снимаются после хода, а до того мешают и второй раз их не бьют.
 * В столбовых побитая (верхняя шашка башни) сразу уходит под низ бьющей башни — с одной башни можно взять несколько.
 */
import type { Options } from '../../core/types';

export type Variant = 'russian' | 'international' | 'brazil' | 'bashni' | 'lasca';

export interface Cfg {
  variant: Variant;
  /** Поддавки: выигрывает тот, кто первым остался без ходов. */
  giveaway: boolean;
  /** Бить не обязательно, но за пропущенное взятие соперник может «взять за фук» шашку, которая должна была бить. */
  fuk: boolean;
  /** Часы: минут на партию каждому (0 — без часов), добавка за ход в секундах. */
  clock: number;
  inc: number;
}

export const DEFAULT_CFG: Cfg = { variant: 'russian', giveaway: false, fuk: false, clock: 0, inc: 0 };

const VARIANTS: Variant[] = ['russian', 'international', 'brazil', 'bashni', 'lasca'];

export function cfgFrom(o: Options): Cfg {
  const v = String(o.variant) as Variant;
  return {
    variant: VARIANTS.includes(v) ? v : 'russian',
    giveaway: !!o.giveaway,
    fuk: !!o.fuk,
    clock: Math.max(0, Math.min(180, Number(o.clock) || 0)),
    inc: Math.max(0, Math.min(60, Number(o.inc) || 0)),
  };
}

interface Rules {
  n: number;
  /** Рядов шашек у каждого в начале. */
  rows: number;
  /** Бить наибольшее число шашек. */
  maxCapture: boolean;
  /** Простая дошла до последнего ряда во время боя: 'continue' — сразу дамка и бьёт дальше как дамка,
   *  'stop' — становится дамкой и останавливается, 'none' — остаётся простой (дамка — только если там закончит ход). */
  promoteMid: 'continue' | 'stop' | 'none';
  /** Простая бьёт и назад. */
  backCapture: boolean;
  /** Дамка ходит и бьёт издалека (иначе — только на соседнее поле). */
  flying: boolean;
  /** Столбовые: побитые уходят под бьющую башню. */
  columns: boolean;
  /** Ничья через столько полуходов: в обычных — у обоих есть дамки, никто не бил и не ходил простой;
   *  в столбовых — никто не бил и не делал дамку (соотношение сил не менялось). */
  quietLimit: number;
}

export const RULES: Record<Variant, Rules> = {
  russian: { n: 8, rows: 3, maxCapture: false, promoteMid: 'continue', backCapture: true, flying: true, columns: false, quietLimit: 30 },
  international: { n: 10, rows: 4, maxCapture: true, promoteMid: 'none', backCapture: true, flying: true, columns: false, quietLimit: 50 },
  brazil: { n: 8, rows: 3, maxCapture: true, promoteMid: 'none', backCapture: true, flying: true, columns: false, quietLimit: 50 },
  bashni: { n: 8, rows: 3, maxCapture: false, promoteMid: 'continue', backCapture: true, flying: true, columns: true, quietLimit: 30 },
  lasca: { n: 7, rows: 3, maxCapture: false, promoteMid: 'stop', backCapture: false, flying: false, columns: true, quietLimit: 30 },
};

export interface Move {
  from: number;
  /** Поля, на которые встаёт шашка по ходу (последнее — куда пришла). */
  path: number[];
  /** Побитые шашки по порядку (в столбовых одно поле может встретиться несколько раз). */
  caps: number[];
  /** Шашка стала дамкой. */
  promo: boolean;
}

export interface MoveRec {
  text: string;
  seat: number;
}

export type EndReason = 'nomoves' | 'resign' | 'repetition' | 'kings' | 'material' | 'endgame' | 'agreed' | 'time';

export interface State {
  game: 'draughts';
  cfg: Cfg;
  n: number;
  board: string[];
  turn: 0 | 1;
  moves: MoveRec[];
  last: { from: number; path: number[]; caps: number[] } | null;
  /** Ключи позиций — для троекратного повторения. */
  keys: string[];
  /** Полуходы для ничьей «без толку» (см. Rules.quietLimit). */
  kq: number;
  /** Полуходы в окончании «одинокая дамка против трёх и меньше» (международные). */
  eg: number;
  phase: 'play' | 'draw' | 'over';
  offer: number;
  winner: number | null;
  reason: EndReason | null;
  /** Сколько шашек побил каждый. */
  taken: [number, number];
  /** Шашки соперника, которые ходящий может взять за фук (соперник не побил, хотя был обязан). */
  fuk: number[];
  /** Остаток времени, мс, и когда начался текущий ход (время хозяина партии). */
  clock: [number, number];
  turnStart: number;
}

export type Action =
  | { type: 'move'; path: number[]; from: number }
  | { type: 'fuk'; sq: number }
  | { type: 'resign' }
  | { type: 'offer' }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'flag' };

export type Event =
  | { type: 'start'; variant: Variant; giveaway: boolean }
  | { type: 'move'; seat: number; move: Move; text: string; num: number; missed: boolean }
  | { type: 'fuk'; seat: number; sq: number; name: string }
  | { type: 'offer'; seat: number }
  | { type: 'decline'; seat: number }
  | { type: 'end'; winner: number | null; reason: EndReason };

// ---------------------------------------------------------------- клетки

/** Цвет шашки (или башни — по верхней). */
export const colorOf = (p: string): 0 | 1 => (p.charAt(0) === 'w' || p.charAt(0) === 'W' ? 0 : 1);
export const isKing = (p: string) => p.charAt(0) === 'W' || p.charAt(0) === 'B';
const own = (p: string, c: number) => p !== '' && colorOf(p) === c;
const DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Имя поля: в 8×8 — «c3»; в 10×10 — номер 1…50 (1 — в левом верхнем углу со стороны чёрных); в 7×7 (Ласка) — номер 1…25 от белых. */
export function sqName(n: number, sq: number): string {
  const r = Math.floor(sq / n);
  const f = sq % n;
  if (n === 8) return 'abcdefgh'[f] + (r + 1);
  if (n === 7) return String(Math.floor(r / 2) * 7 + (r % 2 ? 4 : 0) + Math.floor(f / 2) + 1);
  return String((n - 1 - r) * (n / 2) + Math.floor(f / 2) + 1);
}

/** Поле по буквенной записи «c3» (и для 10×10: a1…j10) — для тестов и показа правил. */
export function sqOf(n: number, name: string): number {
  return (+name.slice(1) - 1) * n + 'abcdefghij'.indexOf(name[0]);
}

export const dark = (n: number, sq: number) => (Math.floor(sq / n) + (sq % n)) % 2 === 0;

function step(n: number, sq: number, dr: number, df: number): number {
  const r = Math.floor(sq / n) + dr;
  const f = (sq % n) + df;
  return r < 0 || r >= n || f < 0 || f >= n ? -1 : r * n + f;
}

const lastRow = (n: number, c: number, sq: number) => Math.floor(sq / n) === (c === 0 ? n - 1 : 0);

// ---------------------------------------------------------------- расстановка

export function newGame(cfg: Cfg): State {
  const { n, rows } = RULES[cfg.variant];
  const board = Array<string>(n * n).fill('');
  for (let sq = 0; sq < n * n; sq++) {
    if (!dark(n, sq)) continue;
    const r = Math.floor(sq / n);
    if (r < rows) board[sq] = 'w';
    else if (r >= n - rows) board[sq] = 'b';
  }
  return fromBoard(cfg, board, 0);
}

export function fromBoard(cfg: Cfg, board: string[], turn: 0 | 1): State {
  const s: State = {
    game: 'draughts',
    cfg,
    n: RULES[cfg.variant].n,
    board,
    turn,
    moves: [],
    last: null,
    keys: [],
    kq: 0,
    eg: 0,
    phase: 'play',
    offer: -1,
    winner: null,
    reason: null,
    taken: [0, 0],
    fuk: [],
    clock: [cfg.clock * 60000, cfg.clock * 60000],
    turnStart: Date.now(),
  };
  s.keys = [posKey(s)];
  return s;
}

/** Позиция по списку полей: fromList(cfg, { w: ['c3'], W: ['d8'], b: ['f6'] }, 0). Башни — ключом-строкой: { 'wbb': ['e5'] }. */
export function fromList(cfg: Cfg, pcs: Record<string, string[] | undefined>, turn: 0 | 1 = 0): State {
  const n = RULES[cfg.variant].n;
  const board = Array<string>(n * n).fill('');
  for (const [p, list] of Object.entries(pcs)) for (const name of list || []) board[sqOf(n, name)] = p;
  return fromBoard(cfg, board, turn);
}

export const posKey = (s: Pick<State, 'board' | 'turn'>) => s.board.map((p) => p || '.').join(',') + s.turn;

// ---------------------------------------------------------------- ходы

/** Все серии взятий шашкой (башней) с поля from. */
function capturesFrom(b: string[], n: number, from: number, rules: Rules, out: Move[]) {
  const p = b[from];
  const c = colorOf(p);
  const fwd = c === 0 ? 1 : -1;
  // на время хода поле, с которого ушли, свободно
  const work = b.slice();
  work[from] = '';
  const caps: number[] = [];
  const path: number[] = [];
  const dirs = (king: boolean) => (king || rules.backCapture ? DIRS : DIRS.filter(([dr]) => dr === fwd));
  // побитую в обычных шашках второй раз не бьют; в столбовых она уже ушла, а башня под ней — снова цель
  const target = (t: number) => own(work[t], 1 - c) && (rules.columns || !caps.includes(t));

  /** Кого можно бить с поля sq в направлении (dr, df): поле жертвы и поля, куда можно встать. */
  const victimAt = (sq: number, king: boolean, dr: number, df: number): { v: number; lands: number[] } | null => {
    let t = step(n, sq, dr, df);
    if (king && rules.flying) while (t >= 0 && work[t] === '') t = step(n, t, dr, df);
    if (t < 0 || !target(t)) return null;
    const lands: number[] = [];
    let l = step(n, t, dr, df);
    while (l >= 0 && work[l] === '') {
      lands.push(l);
      if (!king || !rules.flying) break;
      l = step(n, l, dr, df);
    }
    return lands.length ? { v: t, lands } : null;
  };

  const canCapture = (sq: number, king: boolean) => dirs(king).some(([dr, df]) => victimAt(sq, king, dr, df));

  const dfs = (sq: number, king: boolean) => {
    for (const [dr, df] of dirs(king)) {
      const hit = victimAt(sq, king, dr, df);
      if (!hit) continue;
      caps.push(hit.v);
      // столбовые: верхняя шашка жертвы сразу уходит под бьющую башню
      const saved = work[hit.v];
      if (rules.columns) work[hit.v] = saved.slice(1);
      const next = hit.lands.map((l) => {
        const promoted = !king && lastRow(n, c, l) && rules.promoteMid !== 'none';
        return { l, k: king || (promoted && rules.promoteMid === 'continue'), promoted, stop: promoted && rules.promoteMid === 'stop' };
      });
      // дамка обязана встать туда, откуда бой продолжается (если такое поле есть)
      const cont = next.filter((x) => !x.stop && canCapture(x.l, x.k));
      for (const x of cont.length ? cont : next) {
        path.push(x.l);
        if (cont.length) dfs(x.l, x.k);
        else out.push({ from, path: path.slice(), caps: caps.slice(), promo: !isKing(p) && (x.k || x.promoted || lastRow(n, c, x.l)) });
        path.pop();
      }
      work[hit.v] = saved;
      caps.pop();
    }
  };
  dfs(from, isKing(p));
}

function quietFrom(b: string[], n: number, from: number, rules: Rules, out: Move[]) {
  const p = b[from];
  const c = colorOf(p);
  if (isKing(p)) {
    for (const [dr, df] of DIRS) {
      let t = step(n, from, dr, df);
      while (t >= 0 && b[t] === '') {
        out.push({ from, path: [t], caps: [], promo: false });
        if (!rules.flying) break;
        t = step(n, t, dr, df);
      }
    }
    return;
  }
  const dr = c === 0 ? 1 : -1;
  for (const df of [-1, 1]) {
    const t = step(n, from, dr, df);
    if (t >= 0 && b[t] === '') out.push({ from, path: [t], caps: [], promo: lastRow(n, c, t) });
  }
}

/** Ходы по правилам: бить обязательно (в международных и бразильских — больше всех). */
export function properMoves(s: Pick<State, 'board' | 'turn' | 'cfg' | 'n'>): Move[] {
  const rules = RULES[s.cfg.variant];
  const caps: Move[] = [];
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) capturesFrom(s.board, s.n, sq, rules, caps);
  if (caps.length) {
    if (!rules.maxCapture) return caps;
    const max = Math.max(...caps.map((m) => m.caps.length));
    return caps.filter((m) => m.caps.length === max);
  }
  const out: Move[] = [];
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) quietFrom(s.board, s.n, sq, rules, out);
  return out;
}

/** Все допустимые ходы. С «фуком» можно и не бить — но тогда соперник возьмёт шашку за фук. */
export function legalMoves(s: Pick<State, 'board' | 'turn' | 'cfg' | 'n'>): Move[] {
  const proper = properMoves(s);
  if (!s.cfg.fuk || !proper.length || !proper[0].caps.length) return proper;
  const rules = RULES[s.cfg.variant];
  const out: Move[] = [];
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) capturesFrom(s.board, s.n, sq, rules, out);
  for (let sq = 0; sq < s.board.length; sq++) if (own(s.board[sq], s.turn)) quietFrom(s.board, s.n, sq, rules, out);
  return out;
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Сделать ход на доске (без проверки правил), счётчики ничьей — тоже. */
export function play(s: State, m: Move): State {
  const rules = RULES[s.cfg.variant];
  const b = s.board.slice();
  let p = b[m.from];
  b[m.from] = '';
  if (rules.columns)
    for (const v of m.caps) {
      p += b[v].charAt(0);
      b[v] = b[v].slice(1);
    }
  else for (const v of m.caps) b[v] = '';
  const to = m.path[m.path.length - 1];
  b[to] = m.promo ? p.charAt(0).toUpperCase() + p.slice(1) : p;
  const turn = (1 - s.turn) as 0 | 1;
  let kq: number;
  if (rules.columns) kq = m.caps.length || m.promo ? 0 : s.kq + 1;
  else {
    const kings = (c: number) => b.some((x) => own(x, c) && isKing(x));
    kq = kings(0) && kings(1) && !m.caps.length && isKing(p) ? s.kq + 1 : 0;
  }
  const n: State = { ...s, board: b, turn, kq, last: { from: m.from, path: m.path, caps: m.caps }, fuk: [] };
  n.eg = endgameLimit(n) && !m.caps.length && isKing(p) ? s.eg + 1 : 0;
  return n;
}

/** Международные: одинокая дамка против дамки и ещё не больше двух шашек — 16 ходов (против двух — 5), иначе ничья. */
function endgameLimit(s: State): number {
  if (s.cfg.variant !== 'international') return 0;
  const cnt = (c: number) => s.board.filter((x) => own(x, c)).length;
  const kings = (c: number) => s.board.filter((x) => own(x, c) && isKing(x)).length;
  for (const c of [0, 1]) {
    const o = 1 - c;
    if (cnt(c) === 1 && kings(c) === 1 && kings(o) >= 1) {
      if (cnt(o) <= 2) return 10;
      if (cnt(o) <= 3) return 32;
    }
  }
  return 0;
}

export function moveText(n: number, m: Move): string {
  const sep = m.caps.length ? (n === 10 ? '×' : ':') : '-';
  return [m.from, ...m.path].map((x) => sqName(n, x)).join(sep);
}

// ---------------------------------------------------------------- партия

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : s.phase === 'draw' ? [1 - s.offer] : [s.turn]);

function finish(s: State, winner: number | null, reason: EndReason, ev: Event[]) {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

/** Ходящий без ходов (нет шашек или все заперты): проиграл, а в поддавках — выиграл. */
function checkStuck(s: State, ev: Event[]): boolean {
  if (legalMoves(s).length) return false;
  finish(s, s.cfg.giveaway ? s.turn : 1 - s.turn, 'nomoves', ev);
  return true;
}

export function setup(opts: Options): { state: State; events: Event[] } {
  const cfg = cfgFrom(opts);
  return { state: newGame(cfg), events: [{ type: 'start', variant: cfg.variant, giveaway: cfg.giveaway }] };
}

/** Сколько времени ушло на ход: перерыв больше получаса не считается (партию отложили). */
function spent(s: State, now: number) {
  const e = now - s.turnStart;
  return e < 0 || e > 30 * 60000 ? 0 : e;
}

export function apply(s0: State, seat: number, a: Action, now: number = Date.now()): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  const timed = s0.cfg.clock > 0;
  if (a.type === 'flag') {
    // своё время вышло — проигрыш (сообщает клиент, хозяин проверяет по своим часам)
    if (!timed || s0.phase !== 'play' || spent(s0, now) < s0.clock[seat]) return null;
    const s = { ...s0, clock: [...s0.clock] as [number, number] };
    s.clock[seat] = 0;
    finish(s, 1 - seat, 'time', ev);
    return { state: s, events: ev };
  }
  if (s0.phase === 'draw') {
    if (a.type === 'accept') {
      const s = { ...s0 };
      finish(s, null, 'agreed', ev);
      return { state: s, events: ev };
    }
    if (a.type === 'decline') {
      ev.push({ type: 'decline', seat });
      return { state: { ...s0, phase: 'play', offer: -1 }, events: ev };
    }
    return null;
  }
  switch (a.type) {
    case 'resign': {
      const s = { ...s0 };
      finish(s, 1 - seat, 'resign', ev);
      return { state: s, events: ev };
    }
    case 'offer': {
      if (s0.moves.length < 2) return null;
      ev.push({ type: 'offer', seat });
      return { state: { ...s0, phase: 'draw', offer: seat }, events: ev };
    }
    case 'fuk': {
      if (!s0.fuk.includes(a.sq)) return null;
      const b = s0.board.slice();
      // за фук снимают провинившуюся шашку (в столбовых — всю башню)
      b[a.sq] = '';
      const s: State = { ...s0, board: b, fuk: [], taken: [...s0.taken] as [number, number], kq: 0, eg: 0 };
      s.taken[seat]++;
      ev.push({ type: 'fuk', seat, sq: a.sq, name: sqName(s.n, a.sq) });
      s.keys = [...s0.keys, posKey(s)];
      // взяли за фук последнюю шашку
      if (!b.some((x) => own(x, 1 - seat))) finish(s, s.cfg.giveaway ? 1 - seat : seat, 'nomoves', ev);
      else checkStuck(s, ev);
      return { state: s, events: ev };
    }
    case 'move': {
      if (!Array.isArray(a.path)) return null;
      const m = legalMoves(s0).find((x) => x.from === a.from && samePath(x.path, a.path));
      if (!m) return null;
      const proper = s0.cfg.fuk ? properMoves(s0) : [];
      const missed = s0.cfg.fuk && proper.length > 0 && proper[0].caps.length > 0 && !proper.some((x) => x.from === m.from && samePath(x.path, m.path));
      const clock = [...s0.clock] as [number, number];
      if (timed) {
        clock[seat] -= spent(s0, now);
        if (clock[seat] <= 0) {
          const s = { ...s0, clock };
          clock[seat] = 0;
          finish(s, 1 - seat, 'time', ev);
          return { state: s, events: ev };
        }
        clock[seat] += s0.cfg.inc * 1000;
      }
      const text = moveText(s0.n, m);
      const s = play(s0, m);
      s.clock = clock;
      s.turnStart = now;
      s.offer = -1;
      s.taken = [...s0.taken] as [number, number];
      s.taken[seat] += m.caps.length;
      s.moves = [...s0.moves, { text, seat }];
      if (missed) {
        // за фук — любая шашка, которая должна была бить (сходившая — на новом месте)
        const to = m.path[m.path.length - 1];
        s.fuk = [...new Set(proper.map((x) => (x.from === m.from ? to : x.from)))];
      }
      ev.push({ type: 'move', seat, move: m, text, num: Math.floor(s0.moves.length / 2) + 1, missed });
      const key = posKey(s);
      s.keys = [...s0.keys, key];
      if (checkStuck(s, ev)) return { state: s, events: ev };
      const rules = RULES[s.cfg.variant];
      if (s.keys.filter((k) => k === key).length >= 3) finish(s, null, 'repetition', ev);
      else if (s.kq >= rules.quietLimit) finish(s, null, rules.columns ? 'material' : 'kings', ev);
      else if (s.eg && s.eg >= endgameLimit(s)) finish(s, null, 'endgame', ev);
      return { state: s, events: ev };
    }
  }
  return null;
}
