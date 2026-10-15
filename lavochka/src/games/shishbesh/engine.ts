/* Шиш-беш — правила (чистая логика, без DOM).
 *
 * Геометрия зависит от варианта (cfg): A — клеток в плече креста (5 обычно, 6 на длинном поле).
 * Четверть круга Q = 2A + 2 клеток: 0..A-1 к центру, A — угол креста, A+1..2A от центра по соседнему лучу,
 * 2A+1 — торец соседнего луча. Круг L = 4Q (48 на обычном поле).
 * Позиция фишки p хранится относительно её владельца:
 *   -1          — в парке (вне поля)
 *    0          — на стартовом поле (выступ в конце своего луча, вне круга)
 *    1..L       — на круге (1 — первая клетка своей дорожки, L — торец своего луча)
 *    L+1..L+A-1 — в домике (клетки своего цвета на средней дорожке луча)
 * Глобальная клетка круга: g = (p - 1 + Q*seat) % L.
 * Укрытия — по одному у каждой внешней дорожки луча. «Напротив»: 3-е поле с края на обеих дорожках
 * (клетки 2 и Q-4 четверти). «Через один»: на дорожке входа 3-е поле, на дорожке выхода 4-е (клетки 2 и Q-5) —
 * укрытия стоят лесенкой, со сдвигом на клетку.
 *
 * Людо (game = 'ludo') и парчис ('parchis') — на том же кресте с длинным плечом (56 клеток круга, домик из 5):
 *   Людо — один кубик; выход на 6 сразу на свою первую клетку; 6 — бросок ещё раз (три шестёрки подряд — ход сгорает);
 *   рубка — на любой клетке, кроме безопасных (своя стартовая и «звезда» через 8 от неё); свои фишки стоят вместе;
 *   в домик — точным броском до последней клетки, все четыре там — победа.
 *   Парчис — два кубика, выход на 5 (кубиком или суммой); две свои фишки на клетке — блокада, её никто не проходит;
 *   на безопасных клетках не рубят; срубил — +20 ходов одной фишкой, завёл в домик — +10; дубль — бросок ещё раз,
 *   третий дубль подряд — дальняя фишка возвращается в парк.
 */
import type { Options, Rng } from '../../core/types';

export const PIECES = 4;

export type Houses = 'opposite' | 'alternate';
export type StartRule = 'six' | 'double' | 'both';

export type GameRules = 'shishbesh' | 'ludo' | 'parchis';

export interface Cfg {
  arm: number;
  /** Правила: шиш-беш (по умолчанию), людо, парчис. */
  game?: GameRules;
  houses: Houses;
  start: StartRule;
  /** Быстрый заряд: пока на поле нет ни одной фишки, на выход даётся три броска подряд. */
  quick?: boolean;
}

export const DEFAULT_CFG: Cfg = { arm: 5, houses: 'opposite', start: 'six' };

export function cfgFrom(o: Options): Cfg {
  const arm = Number(o.arm) === 6 ? 6 : 5;
  const houses = (['opposite', 'alternate'] as const).find((x) => x === o.houses) ?? 'opposite';
  const start = (['six', 'double', 'both'] as const).find((x) => x === o.start) ?? 'six';
  const game: GameRules = o.game === 'ludo' || o.game === 'parchis' ? o.game : 'shishbesh';
  if (game !== 'shishbesh') return { arm: 6, houses: 'opposite', start: 'six', game };
  return { arm, houses, start, quick: o.quick === true };
}

export const rulesOf = (s: { cfg?: Cfg }): GameRules => s.cfg?.game ?? 'shishbesh';
/** Людо и парчис: безопасная клетка по номеру в четверти. */
export const SAFE: Record<'ludo' | 'parchis', number[]> = { ludo: [0, 8], parchis: [0, 7, 12] };

/** Размеры и проверки клеток для варианта поля. */
export interface Geo {
  cfg: Cfg;
  arm: number;
  /** Клеток в четверти круга. */
  Q: number;
  /** Клеток на круге — это же последняя позиция на круге (торец своего луча). */
  L: number;
  /** Первая и последняя клетки своего домика. */
  HS: number;
  HE: number;
  /** Угол креста у своего луча: с других углов сюда ведёт срез. */
  homeCorner: number;
  onLoop(p: number): boolean;
  isCorner(p: number): boolean;
  toGlobal(seat: number, p: number): number;
  isHouseG(g: number): boolean;
  wrap(p: number, delta: number): number;
  /** Можно ли вывести фишку из парка кубиком d при броске dice. */
  canEnter(d: number, dice: [number, number]): boolean;
}

const geoCache = new Map<string, Geo>();

export function makeGeo(cfg: Cfg): Geo {
  const key = `${cfg.arm}:${cfg.houses}:${cfg.start}:${cfg.game ?? ''}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const A = cfg.arm;
  const Q = 2 * A + 2;
  const L = 4 * Q;
  const onLoop = (p: number) => p >= 1 && p <= L;
  const g: Geo = {
    cfg,
    arm: A,
    Q,
    L,
    HS: L + 1,
    HE: L + A - 1,
    homeCorner: 3 * Q + A + 1,
    onLoop,
    isCorner: (p) => onLoop(p) && (p - 1) % Q === A,
    toGlobal: (seat, p) => (p - 1 + Q * seat) % L,
    // в людо и парчисе «укрытия» на поле — безопасные клетки
    isHouseG: (x) => (cfg.game === 'ludo' || cfg.game === 'parchis' ? SAFE[cfg.game].includes(x % Q) : x % Q === 2 || x % Q === (cfg.houses === 'alternate' ? Q - 5 : Q - 4)),
    wrap: (p, delta) => ((((p - 1 + delta) % L) + L) % L) + 1,
    canEnter: (d, dice) =>
      cfg.game === 'ludo' ? d === 6 : cfg.game === 'parchis' ? d === 5 : (cfg.start !== 'double' && d === 6) || (cfg.start !== 'six' && dice[0] === dice[1] && dice[0] > 0),
  };
  geoCache.set(key, g);
  return g;
}

/** Геометрия партии. Старые сохранения без cfg — обычное поле. */
export const geoOf = (s: { cfg?: Cfg }) => makeGeo(s.cfg ?? DEFAULT_CFG);

export interface Player {
  seat: number;
  pieces: number[];
  house: boolean[];
}

export interface State {
  cfg?: Cfg;
  players: Player[];
  /** Индекс в players того, чей ход. */
  cur: number;
  phase: 'roll' | 'move' | 'over';
  dice: [number, number];
  used: [boolean, boolean];
  bonus: boolean;
  winner: number | null;
  turn: number;
  /** Сколько бросков на выход уже сделано в этот ход (быстрый заряд). */
  tries?: number;
  /** Парчис: бонусные ходы (+20, +10) — ходит одна фишка на всю величину. */
  extra?: number[];
  /** Людо/парчис: сколько шестёрок/дублей подряд. */
  streak?: number;
}

export type Action = { type: 'roll' } | { type: 'move'; piece: number; die: number; to: number };

export type MoveKind = 'enter' | 'step' | 'home' | 'jump';

export interface Move {
  piece: number;
  die: number;
  value: number;
  from: number;
  to: number;
  kind: MoveKind;
}

export interface TurnEnd {
  again: boolean;
  reason: 'double' | 'capture' | 'both' | null;
  next: number;
}

export type Event =
  | { type: 'roll'; seat: number; dice: [number, number]; noMoves?: boolean; turnEnd?: TurnEnd; retry?: number }
  | {
      type: 'move';
      seat: number;
      piece: number;
      from: number;
      to: number;
      kind: MoveKind;
      value: number;
      path: number[];
      captured: { seat: number; piece: number; from: number }[];
      house: boolean;
      /** Фишка с круга зашла в свой домик. */
      homeIn?: boolean;
      /** Фишка дошла до своего домика (для звука и подсветки). */
      atHome?: boolean;
      win?: boolean;
      forfeit?: boolean;
      turnEnd?: TurnEnd;
    };

export const clone = (o: State): State => JSON.parse(JSON.stringify(o));
export const playerBySeat = (s: State, seat: number) => s.players.find((p) => p.seat === seat);

/** Все фишки, стоящие на глобальной клетке g. */
export function piecesAt(s: State, g: number) {
  const G = geoOf(s);
  const out: { pi: number; k: number; house: boolean }[] = [];
  s.players.forEach((pl, pi) => {
    pl.pieces.forEach((p, k) => {
      if (G.onLoop(p) && G.toGlobal(pl.seat, p) === g) out.push({ pi, k, house: !!pl.house[k] });
    });
  });
  return out;
}

/** Фишка сидит в домике-укрытии, а на его клетке стоит другая фишка — выйти нельзя. */
export function isBlocked(s: State, pi: number, k: number) {
  const pl = s.players[pi];
  if (!pl.house[k]) return false;
  const g = geoOf(s).toGlobal(pl.seat, pl.pieces[k]);
  return piecesAt(s, g).some((o) => !o.house);
}

/** Можно ли фишке игрока pi встать на клетку круга t (позиция владельца). */
function canLand(s: State, pi: number, k: number, t: number) {
  const G = geoOf(s);
  const pl = s.players[pi];
  const g = G.toGlobal(pl.seat, t);
  const here = piecesAt(s, g).filter((o) => !(o.pi === pi && o.k === k));
  if (G.isHouseG(g) && !here.some((o) => o.house)) return true; // свободный домик
  return !here.some((o) => o.pi === pi && !o.house); // на клетке своя фишка — нельзя
}

// ---------------------------------------------------------------- людо и парчис

/** Фишки на глобальной клетке g: сколько своих и чужих. */
function countsAt(s: State, pi: number, g: number) {
  const here = piecesAt(s, g);
  return { own: here.filter((o) => o.pi === pi).length, opp: here.filter((o) => o.pi !== pi).length, all: here.length };
}

/** Блокада (парчис): две фишки одного цвета на клетке. */
function blockadeAt(s: State, g: number): boolean {
  const here = piecesAt(s, g);
  return s.players.some((_, i) => here.filter((o) => o.pi === i).length >= 2);
}

function raceTargets(s: State, pi: number, k: number, d: number): { to: number; kind: MoveKind }[] {
  const G = geoOf(s);
  const rules = rulesOf(s);
  const pl = s.players[pi];
  const p = pl.pieces[k];
  if (p === -1) {
    if (!G.canEnter(d, s.dice)) return [];
    if (rules === 'parchis' && countsAt(s, pi, G.toGlobal(pl.seat, 1)).own >= 2) return [];
    return [{ to: 1, kind: 'enter' }];
  }
  if (p >= G.HS) return p + d <= G.HE ? [{ to: p + d, kind: 'home' }] : [];
  const t = p + d;
  if (t > G.HE) return [];
  if (rules === 'parchis') {
    // путь до конца круга не должен идти через блокаду
    for (let x = p + 1; x <= Math.min(t, G.L); x++) if (blockadeAt(s, G.toGlobal(pl.seat, x))) return [];
    if (t <= G.L) {
      const g = G.toGlobal(pl.seat, t);
      const c = countsAt(s, pi, g);
      if (G.isHouseG(g) && c.all >= 2) return [];
    }
  }
  return [{ to: t, kind: t > G.L ? 'home' : 'step' }];
}

/** Куда может пойти фишка k игрока pi значением кубика d. */
export function pieceTargets(s: State, pi: number, k: number, d: number) {
  if (rulesOf(s) !== 'shishbesh') return raceTargets(s, pi, k, d);
  const G = geoOf(s);
  const pieces = s.players[pi].pieces;
  const p = pieces[k];
  const res: { to: number; kind: MoveKind }[] = [];
  const ownAt = (pos: number) => pieces.some((q, i) => i !== k && q === pos);
  const homeFree = (a: number, b: number) => {
    for (let x = Math.max(a, G.HS); x <= b; x++) if (ownAt(x)) return false;
    return true;
  };

  if (p === -1) {
    if (G.canEnter(d, s.dice) && !ownAt(0)) res.push({ to: 0, kind: 'enter' });
    return res;
  }
  if (p >= G.HS) {
    const t = p + d;
    if (t <= G.HE && homeFree(p + 1, t)) res.push({ to: t, kind: 'home' });
    return res;
  }
  if (isBlocked(s, pi, k)) return res;
  const t = p + d;
  if (t <= G.L) {
    if (canLand(s, pi, k, t)) res.push({ to: t, kind: 'step' });
  } else if (t <= G.HE && homeFree(G.HS, t)) {
    res.push({ to: t, kind: 'home' });
  }
  if (G.isCorner(p)) {
    // «1» — по прямым стрелкам на соседние углы, «3» — по диагонали.
    const jumps = d === 1 ? [G.wrap(p, G.Q), G.wrap(p, -G.Q)] : d === 3 ? [G.wrap(p, 2 * G.Q)] : [];
    for (const j of jumps) if (canLand(s, pi, k, j)) res.push({ to: j, kind: 'jump' });
  }
  return res;
}

export function legalMoves(s: State): Move[] {
  if (s.phase !== 'move') return [];
  const pi = s.cur;
  const out: Move[] = [];
  const seen = new Set<string>();
  const rules = rulesOf(s);
  if (rules !== 'shishbesh' && s.extra?.length) {
    // бонус (+20/+10): одна фишка с поля на всю величину
    const d = s.extra[0];
    for (let k = 0; k < PIECES; k++) {
      const p = s.players[pi].pieces[k];
      if (p < 1) continue;
      for (const tg of raceTargets(s, pi, k, d)) out.push({ piece: k, die: 3, value: d, from: p, to: tg.to, kind: tg.kind });
    }
    return out;
  }
  if (rules === 'parchis' && !s.used[0] && !s.used[1] && s.dice[0] + s.dice[1] === 5) {
    // выход суммой двух кубиков
    const G = geoOf(s);
    const pl = s.players[pi];
    const k = pl.pieces.indexOf(-1);
    if (k >= 0 && countsAt(s, pi, G.toGlobal(pl.seat, 1)).own < 2) out.push({ piece: k, die: 2, value: 5, from: -1, to: 1, kind: 'enter' });
  }
  for (let i = 0; i < 2; i++) {
    if (s.used[i]) continue;
    const d = s.dice[i];
    for (let k = 0; k < PIECES; k++) {
      for (const tg of pieceTargets(s, pi, k, d)) {
        const key = k + ':' + tg.to + ':' + tg.kind + ':' + d;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ piece: k, die: i, value: d, from: s.players[pi].pieces[k], to: tg.to, kind: tg.kind });
      }
    }
  }
  return out;
}

/** Переставляет фишку (мутирует s), решает вопрос с домиком и рубкой. */
export function movePiece(s: State, pi: number, k: number, to: number) {
  const G = geoOf(s);
  const pl = s.players[pi];
  if (rulesOf(s) !== 'shishbesh') {
    const from = pl.pieces[k];
    pl.pieces[k] = to;
    pl.house[k] = false;
    const captured: { seat: number; piece: number; from: number }[] = [];
    if (G.onLoop(to)) {
      const g = G.toGlobal(pl.seat, to);
      // на безопасных не рубят; в парчисе выход на свою стартовую рубит и там
      const safe = G.isHouseG(g) && !(rulesOf(s) === 'parchis' && from === -1);
      if (!safe)
        for (const o of piecesAt(s, g)) {
          if (o.pi === pi) continue;
          const op = s.players[o.pi];
          captured.push({ seat: op.seat, piece: o.k, from: op.pieces[o.k] });
          op.pieces[o.k] = -1;
        }
    }
    return { captured, house: false };
  }
  pl.pieces[k] = to;
  pl.house[k] = false;
  const captured: { seat: number; piece: number; from: number }[] = [];
  let house = false;
  if (G.onLoop(to)) {
    const g = G.toGlobal(pl.seat, to);
    const here = piecesAt(s, g).filter((o) => !(o.pi === pi && o.k === k));
    if (G.isHouseG(g) && !here.some((o) => o.house)) {
      pl.house[k] = true; // занимаем укрытие — из него не выбивают
      house = true;
    } else {
      for (const o of here) {
        if (o.house || o.pi === pi) continue;
        const op = s.players[o.pi];
        captured.push({ seat: op.seat, piece: o.k, from: op.pieces[o.k] });
        op.pieces[o.k] = -1;
        op.house[o.k] = false;
      }
    }
  }
  return { captured, house };
}

export function newGame(seats: number[], rng: Rng, cfg: Cfg = DEFAULT_CFG): State {
  const players = seats
    .slice()
    .sort((a, b) => a - b)
    .map((seat) => ({ seat, pieces: [-1, -1, -1, -1], house: [false, false, false, false] }));
  return {
    cfg: { ...cfg },
    players,
    cur: rng.int(players.length),
    phase: 'roll',
    dice: [0, 0],
    used: [true, true],
    bonus: false,
    winner: null,
    turn: 1,
  };
}

// Дубль или срубленная фишка — тот же игрок бросает ещё раз.
function finishTurn(s: State, forceEnd = false): TurnEnd {
  const rules = rulesOf(s);
  const dbl = rules === 'ludo' ? s.dice[0] === 6 : s.dice[0] === s.dice[1];
  const again = !forceEnd && (dbl || (rules === 'shishbesh' && s.bonus));
  s.extra = [];
  if (!again) s.streak = 0;
  const reason = s.bonus ? (dbl ? 'both' : 'capture') : dbl ? 'double' : null;
  s.phase = 'roll';
  s.used = [true, true];
  s.bonus = false;
  s.tries = 0;
  if (!again) s.cur = (s.cur + 1) % s.players.length;
  s.turn++;
  return { again, reason, next: s.players[s.cur].seat };
}

export const QUICK_TRIES = 3;

export function applyRoll(state: State, dice: [number, number]) {
  if (state.phase !== 'roll') return null;
  const s = clone(state);
  s.dice = [dice[0], dice[1]];
  s.used = [false, false];
  s.bonus = false;
  s.phase = 'move';
  const ev: Event = { type: 'roll', seat: s.players[s.cur].seat, dice: [dice[0], dice[1]] };
  const rules = rulesOf(s);
  if (rules !== 'shishbesh') {
    if (rules === 'ludo') s.used = [false, true];
    const hit = rules === 'ludo' ? dice[0] === 6 : dice[0] === dice[1];
    s.streak = hit ? (s.streak ?? 0) + 1 : 0;
    if (s.streak >= 3) {
      // третья шестёрка (людо) — ход сгорает; третий дубль (парчис) — дальняя фишка в парк
      if (rules === 'parchis') {
        const pl = s.players[s.cur];
        const G = geoOf(s);
        let far = -1;
        pl.pieces.forEach((p, k) => {
          if (G.onLoop(p) && (far < 0 || p > pl.pieces[far])) far = k;
        });
        if (far >= 0) pl.pieces[far] = -1;
      }
      ev.noMoves = true;
      ev.turnEnd = finishTurn(s, true);
      return { state: s, event: ev };
    }
  }
  if (legalMoves(s).length === 0) {
    ev.noMoves = true;
    const G = geoOf(s);
    const empty = !s.players[s.cur].pieces.some((p) => G.onLoop(p));
    const tries = (s.tries ?? 0) + 1;
    if (s.cfg?.quick && empty && tries < QUICK_TRIES) {
      // быстрый заряд: фишек на поле нет — бросает ещё раз, ход не переходит
      s.tries = tries;
      s.phase = 'roll';
      s.used = [true, true];
      ev.retry = QUICK_TRIES - tries;
    } else ev.turnEnd = finishTurn(s);
  }
  return { state: s, event: ev };
}

export function applyMove(state: State, mv: { piece: number; die: number; to: number }) {
  const legal = legalMoves(state).find((m) => m.piece === mv.piece && m.die === mv.die && m.to === mv.to);
  if (!legal) return null;
  const G = geoOf(state);
  const s = clone(state);
  const pl = s.players[s.cur];
  const from = pl.pieces[legal.piece];
  const { captured, house } = movePiece(s, s.cur, legal.piece, legal.to);
  const race = rulesOf(s) !== 'shishbesh';
  if (legal.die === 2) s.used = [true, true];
  else if (legal.die === 3) s.extra = (s.extra ?? []).slice(1);
  else s.used[legal.die] = true;
  if (race) {
    if (rulesOf(s) === 'parchis') {
      if (captured.length) s.extra = [...(s.extra ?? []), 20];
      if (legal.to === G.HE) s.extra = [...(s.extra ?? []), 10];
    }
  } else if (captured.length) s.bonus = true;

  let path: number[];
  if (legal.kind === 'enter') path = [legal.to];
  else if (legal.kind === 'jump') path = [legal.to];
  else {
    path = [];
    for (let x = from + 1; x <= legal.to; x++) path.push(x);
  }

  const ev: Extract<Event, { type: 'move' }> = {
    type: 'move',
    seat: pl.seat,
    piece: legal.piece,
    from,
    to: legal.to,
    kind: legal.kind,
    value: legal.value,
    path,
    captured,
    house,
  };
  if (legal.to >= G.HS) ev.atHome = true;
  if (legal.to >= G.HS && from < G.HS) ev.homeIn = true;

  if (race && s.extra?.length && !legalMoves(s).length) s.extra = [];
  if (race ? pl.pieces.every((p) => p === G.HE) : pl.pieces.every((p) => p >= G.HS)) {
    s.phase = 'over';
    s.winner = pl.seat;
    ev.win = true;
  } else if (s.used.every(Boolean) && !s.extra?.length) {
    ev.turnEnd = finishTurn(s);
  } else if (legalMoves(s).length === 0) {
    ev.forfeit = true;
    ev.turnEnd = finishTurn(s);
  }
  return { state: s, event: ev as Event };
}
