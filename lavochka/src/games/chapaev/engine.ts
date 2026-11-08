/* Чапаев и карром — правила (без DOM). Физика удара — physics.ts.
 *
 * Чапаев (по Википедии): шахматная доска, по 8 шашек на крайних рядах, щелчком выбивают чужие шашки, свои стараются сохранить.
 * Удар — своей шашкой в любую сторону. Выбил хотя бы одну чужую, а ударная осталась на доске — бьёшь ещё (вариант «строго
 * по очереди» — всегда переход хода). Раунд выигрывает тот, кто выбил все чужие шашки, сохранив хотя бы одну свою; в следующем
 * раунде его ряд сдвигается на линию вперёд (не потерял ни одной — на две). Когда ряды сходятся вплотную, раунд решает партию.
 * Все шашки слетели — раунд переигрывают. Первый ход в партии — у белых, дальше — у победителя прошлого раунда, но тот,
 * кого прижали к последней линии, бьёт первым («удар последней надежды»).
 *
 * Карром (Индия): квадратная доска с бортами и четырьмя лузами, по 9 светлых и тёмных фишек, красная «королева», биток.
 * Биток ставят на свою линию и щелчком загоняют свои фишки в лузы. Забил свою — ещё удар. Королеву надо «покрыть» — следующим
 * ударом забить свою фишку, иначе она возвращается в центр. Забил биток — штраф: одна своя забитая фишка — обратно в центр.
 * Забил все свои (и королева покрыта) — партия: победителю — оставшиеся фишки соперника, за королеву +3. Играют до 25.
 * Разбой: первый удар сдачи, не сдвинувший ни одной фишки, можно повторить — всего три попытки, потом ход переходит.
 * Последнюю свою фишку нельзя забить раньше королевы: фол — она и ещё одна забитая (штраф) возвращаются в центр, ход переходит.
 *
 * Щелчок Чапаева (доработка 2026-11-08): шашки — дерево, удар неупругий (часть силы теряется — ряд одним щелчком не сносится),
 * сила ограничена (полный удар — чуть дальше доски), у сильного щелчка рука дрожит: направление чуть уходит в сторону
 * (разброс растёт с квадратом силы, его тянет rng комнаты — один и тот же у всех).
 * Варианты Чапаева (их можно сочетать):
 *   дома — спичечные коробки посреди доски, шашки от них отскакивают, за ними прячутся;
 *   король — шашка на поле e: сбил чужого короля — раунд твой, потерял своего — раунд проигран (шахматный Чапаев);
 *   ловушки — лунки: медленная шашка над лункой проваливается (выбыла), быструю проносит;
 *   танки — по две шашки «стопкой» в ряду: вдвое тяжелее, бьют сильнее, сами еле сдвигаются;
 *   ветер — перед каждым ходом дует в случайную сторону и сносит катящиеся шашки;
 *   лёд и песок — пятна посреди доски: на льду шашка катится далеко, в песке вязнет.
 */
import type { Options } from '../../core/types';
import type { Rng } from '../../core/types';
import { simulate, shotSpeed, type Box, type Disc, type Field, type SimResult, type Trap, type Zone } from './physics';

export type Mode = 'chapaev' | 'carrom';

export interface Cfg {
  mode: Mode;
  /** Чапаев: строго по очереди (без повторного удара). */
  strict: boolean;
  /** Карром: до скольких очков. */
  target: number;
  /** Варианты Чапаева. */
  houses: boolean;
  king: boolean;
  traps: boolean;
  tanks: boolean;
  wind: boolean;
  terrain: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const ch = o.mode !== 'carrom';
  return {
    mode: ch ? 'chapaev' : 'carrom',
    strict: !!o.strict,
    target: [13, 25].includes(Number(o.target)) ? Number(o.target) : 25,
    houses: ch && !!o.houses,
    king: ch && !!o.king,
    traps: ch && !!o.traps,
    tanks: ch && !!o.tanks,
    wind: ch && !!o.wind,
    terrain: ch && !!o.terrain,
  };
}

// ---------------------------------------------------------------- поле

export const CH_R = 0.4;
/** Полный щелчок: шашка в одиночку прокатится ≈ v²/2f = 8,4 клетки — через всю доску, но не «с запасом в три доски», как было. */
export const CH_MAX = 8.6;
export const CH_FIELD: Field = { w: 8, h: 8, walls: false, pockets: [], friction: 4.4, e: 0.55, eWall: 0, eBox: 0.45 };
/** Разброс направления (рад, наибольший): у самого слабого щелчка — CH_AIM, у полного — CH_AIM + CH_SPREAD (растёт с квадратом силы).
 * Сила тоже «гуляет» — до ±CH_POW·сила. */
export const CH_AIM = 0.07;
export const CH_SPREAD = 0.12;
export const CH_POW = 0.15;
export const spread = (power: number) => CH_AIM + CH_SPREAD * power * power;
/** Масса танка (стопка из двух шашек). */
export const TANK_M = 2;

/** Дома — спичечные коробки (≈ 5 × 3,5 см на клетке 4,5 см): посередине и у краёв, симметрично для обоих. */
export const HOUSES: Box[] = [
  { x: 4, y: 4, hw: 0.56, hh: 0.36 },
  { x: 1.25, y: 4, hw: 0.56, hh: 0.36 },
  { x: 6.75, y: 4, hw: 0.56, hh: 0.36 },
];
/** Лунки-ловушки: между домами; медленнее v — проваливается. */
export const TRAPS: Trap[] = [
  { x: 2.6, y: 4, r: 0.3, v: 3.2 },
  { x: 5.4, y: 4, r: 0.3, v: 3.2 },
];
/** Лёд посередине, песок по краям. */
export const ZONES: Zone[] = [
  { x: 4, y: 4, r: 1.25, k: 0.25 },
  { x: 1.1, y: 4, r: 1.0, k: 3.5 },
  { x: 6.9, y: 4, r: 1.0, k: 3.5 },
];

/** Поле Чапаева со всеми включёнными вариантами (ветер — текущий). */
export function chField(s: State): Field {
  const c = s.cfg;
  return {
    ...CH_FIELD,
    boxes: c.houses ? HOUSES : undefined,
    traps: c.traps ? TRAPS : undefined,
    zones: c.terrain ? ZONES : undefined,
    wind: c.wind && s.wind ? s.wind : undefined,
  };
}

/** Карром: поле 8×8 единиц (≈ 74 см), фишка Ø ≈ 3,2 см → r 0,17; биток Ø 4,1 см → r 0,22; лузы Ø 4,5 см в углах. */
export const CR = { size: 8, coin: 0.17, striker: 0.22, pocket: 0.27, base: 6.75, baseFrom: 1.75, baseTo: 6.25 };
export const CR_FIELD: Field = {
  w: CR.size,
  h: CR.size,
  walls: true,
  pockets: [
    { x: 0.27, y: 0.27, r: 0.3 },
    { x: CR.size - 0.27, y: 0.27, r: 0.3 },
    { x: 0.27, y: CR.size - 0.27, r: 0.3 },
    { x: CR.size - 0.27, y: CR.size - 0.27, r: 0.3 },
  ],
  friction: 1.6,
  e: 0.9,
  eWall: 0.75,
};
export const CR_MAX = 16;

export interface Piece {
  id: number;
  /** 0 / 1 — чья (у каррома 0 — светлые, 1 — тёмные), 2 — королева, 3 — биток. */
  o: number;
  x: number;
  y: number;
  /** Чапаев: король. */
  k?: 1;
  /** Чапаев: танк — стопка из двух шашек. */
  t?: 1;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  pieces: Piece[];
  turn: number;
  /** Чапаев: на какой линии от своего края стоит ряд каждого (0 — свой край). */
  line: [number, number];
  round: number;
  /** Карром: счёт партий, забитые за сдачу (возвращаются при штрафе), кто должен покрыть королеву. */
  score: [number, number];
  pocketed: [number, number];
  cover: number | null;
  queenBy: number | null;
  /** Карром: попыток разбоя в этой сдаче (null — сдача уже разбита). */
  breakTries?: number | null;
  shots: number;
  /** Чапаев с ветром: ускорение (клеток/с²), меняется перед каждым ходом. */
  wind?: { x: number; y: number };
  last: { seat: number; result: string } | null;
  over: boolean;
  winner: number | null;
}

export type View = State;
export type Action = { type: 'shot'; id: number; angle: number; power: number } | { type: 'strike'; x: number; angle: number; power: number };
export type Event =
  | { type: 'shot'; seat: number; id: number; angle: number; power: number; x?: number; gone: number[]; again: boolean }
  | { type: 'round'; winner: number | null; line: [number, number]; text: string }
  | { type: 'board'; winner: number; pts: number; score: [number, number] }
  | { type: 'foul'; seat: number; text: string }
  | { type: 'end'; winner: number };

export const MAX_SHOTS = 600;

// ---------------------------------------------------------------- расстановка

export const KING_COL = 4;
export const TANK_COLS = [1, 6];

/** Ряд шашек стороны: белые (0) — снизу (ряд 7 − line), чёрные (1) — сверху (ряд line).
 * Шашку, что встала бы на дом, отодвигают к своему краю вплотную к дому. */
function chapaevRow(cfg: Cfg, o: number, line: number): Piece[] {
  const y = o === 0 ? 7.5 - line : 0.5 + line;
  return Array.from({ length: 8 }, (_, i) => {
    const p: Piece = { id: o * 8 + i, o, x: i + 0.5, y };
    if (cfg.king && i === KING_COL) p.k = 1;
    if (cfg.tanks && TANK_COLS.includes(i)) p.t = 1;
    if (cfg.houses)
      for (const b of HOUSES)
        if (Math.abs(p.x - b.x) < b.hw + CH_R && Math.abs(p.y - b.y) < b.hh + CH_R) p.y = o === 0 ? b.y + b.hh + CH_R + 0.02 : b.y - b.hh - CH_R - 0.02;
    return p;
  });
}

const rows = (s: State) => [...chapaevRow(s.cfg, 0, s.line[0]), ...chapaevRow(s.cfg, 1, s.line[1])];

/** Ветер на следующий ход — от номера удара и раунда (одинаково у всех): сила 0,4…2 клетки/с², направление любое. */
export function windFor(s: State): { x: number; y: number } {
  let h = (s.shots * 2654435761 + s.round * 40503 + 12345) >>> 0;
  const nx = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0), h / 4294967296);
  const a = nx() * Math.PI * 2;
  const f = 0.4 + nx() * 1.6;
  return { x: Math.round(Math.cos(a) * f * 100) / 100, y: Math.round(Math.sin(a) * f * 100) / 100 };
}

function carromSetup(): Piece[] {
  const c = CR.size / 2;
  const d = CR.coin * 2 + 0.01;
  const out: Piece[] = [{ id: 0, o: 2, x: c, y: c }];
  // внутренний круг — 6 фишек, внешний — 12, цвета чередуются
  let id = 1;
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    out.push({ id: id++, o: k % 2, x: c + Math.cos(a) * d, y: c + Math.sin(a) * d });
  }
  for (let k = 0; k < 12; k++) {
    const a = (Math.PI / 6) * k;
    const rr = k % 2 ? d * 1.732 : d * 2;
    out.push({ id: id++, o: k % 2 ? 0 : 1, x: c + Math.cos(a + (k % 2 ? 0 : 0)) * rr, y: c + Math.sin(a) * rr });
  }
  return out;
}

export function newState(cfg: Cfg, seats: number[]): State {
  const s: State = {
    cfg,
    seats: seats.slice(0, 2),
    pieces: [],
    turn: 0,
    line: [0, 0],
    round: 1,
    score: [0, 0],
    pocketed: [0, 0],
    cover: null,
    queenBy: null,
    breakTries: 0,
    shots: 0,
    last: null,
    over: false,
    winner: null,
  };
  s.pieces = cfg.mode === 'carrom' ? carromSetup() : rows(s);
  if (cfg.wind) s.wind = windFor(s);
  return s;
}

export const setup = (opts: Options): State => newState(cfgFrom(opts), [0, 1]);
export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

// ---------------------------------------------------------------- удар

const STRIKER = 99;

/** Шашки для физики (биток каррома ставится на линию игрока). */
export function discsFor(s: State, a: Action): { discs: Disc[]; striker: number } | null {
  if (s.cfg.mode === 'chapaev') {
    if (a.type !== 'shot') return null;
    const p = s.pieces.find((q) => q.id === a.id);
    if (!p || p.o !== s.turn) return null;
    // танк — стопка: щёлкают по нижней с той же скоростью, а удар (импульс) вдвое больше; самого его сдвинуть вдвое труднее
    const v = shotSpeed(a.power, CH_MAX);
    const discs = s.pieces.map((q) => ({ id: q.id, x: q.x, y: q.y, r: CH_R, m: q.t ? TANK_M : 1, vx: q.id === a.id ? Math.cos(a.angle) * v : 0, vy: q.id === a.id ? Math.sin(a.angle) * v : 0 }));
    return { discs, striker: a.id };
  }
  if (a.type !== 'strike') return null;
  if (!(a.x >= CR.baseFrom && a.x <= CR.baseTo)) return null;
  const by = s.turn === 0 ? CR.base : CR.size - CR.base;
  const sx = s.turn === 0 ? a.x : CR.size - a.x;
  // биток не должен лежать на фишке
  if (s.pieces.some((q) => Math.sqrt((q.x - sx) ** 2 + (q.y - by) ** 2) < CR.coin + CR.striker)) return null;
  const v = shotSpeed(a.power, CR_MAX);
  const discs: Disc[] = s.pieces.map((q) => ({ id: q.id, x: q.x, y: q.y, r: CR.coin, m: 1, vx: 0, vy: 0 }));
  discs.push({ id: STRIKER, x: sx, y: by, r: CR.striker, m: 1.6, vx: Math.cos(a.angle) * v, vy: Math.sin(a.angle) * v });
  return { discs, striker: STRIKER };
}

export function shoot(s: State, a: Action): SimResult | null {
  const d = discsFor(s, a);
  if (!d) return null;
  return simulate(s.cfg.mode === 'carrom' ? CR_FIELD : chField(s), d.discs, d.striker);
}

function clone(s: State): State {
  return { ...s, pieces: s.pieces.map((p) => ({ ...p })), wind: s.wind && { ...s.wind }, line: [...s.line] as [number, number], score: [...s.score] as [number, number], pocketed: [...s.pocketed] as [number, number] };
}

/** Применить удар. rng (комнаты) даёт дрожь руки у сильного щелчка Чапаева; без rng (тесты, расчёт) — точно в прицел. */
export function apply(s0: State, seat: number, a: Action, rng?: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  if (!(a.power > 0 && a.power <= 1) || !Number.isFinite(a.angle)) return null;
  if (s0.cfg.mode === 'chapaev' && rng && a.type === 'shot')
    a = { ...a, angle: a.angle + spread(a.power) * (rng.next() + rng.next() - 1), power: Math.min(1, a.power * (1 + CH_POW * a.power * (rng.next() + rng.next() - 1))) };
  const sim = shoot(s0, a);
  if (!sim) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  s.shots++;
  const goneIds = sim.discs.filter((d) => d.gone && d.id !== STRIKER).map((d) => d.id);
  const pos = new Map(sim.discs.map((d) => [d.id, d]));
  s.pieces = s.pieces.filter((p) => !pos.get(p.id)!.gone).map((p) => ({ ...p, x: pos.get(p.id)!.x, y: pos.get(p.id)!.y }));
  const me = seat;
  if (s.cfg.mode === 'chapaev') return chapaevAfter(s0, s, a as Extract<Action, { type: 'shot' }>, goneIds, ev);
  // разбой: биток не сдвинул ни одной фишки — ещё попытка (всего три), потом ход переходит
  if (s0.breakTries != null) {
    const moved = s0.pieces.some((p) => {
      const d = pos.get(p.id)!;
      return d.gone || Math.hypot(d.x - p.x, d.y - p.y) > 1e-6;
    });
    if (!moved) {
      const tries = (s0.breakTries ?? 0) + 1;
      s.breakTries = tries < 3 ? tries : 0;
      if (tries >= 3) s.turn = 1 - me;
      ev.push({ type: 'foul', seat: me, text: tries < 3 ? `разбой не вышел — ещё попытка (${tries + 1} из 3)` : 'три попытки разбоя — ход переходит' });
      ev.splice(0, 0, { type: 'shot', seat: me, id: STRIKER, angle: (a as Extract<Action, { type: 'strike' }>).angle, power: a.power, x: (a as Extract<Action, { type: 'strike' }>).x, gone: [], again: tries < 3 });
      return { state: s, events: ev };
    }
    s.breakTries = null;
  }
  return carromAfter(s0, s, a as Extract<Action, { type: 'strike' }>, goneIds, !!pos.get(STRIKER)!.gone, ev, me);
}

function chapaevAfter(s0: State, s: State, a: Extract<Action, { type: 'shot' }>, gone: number[], ev: Event[]) {
  const me = s.turn;
  const op = 1 - me;
  const lostOp = gone.filter((id) => s0.pieces.find((p) => p.id === id)!.o === op).length;
  const strikerOn = !gone.includes(a.id);
  const again = !s.cfg.strict && lostOp > 0 && strikerOn;
  ev.push({ type: 'shot', seat: me, id: a.id, angle: a.angle, power: a.power, gone, again });
  const mine = s.pieces.filter((p) => p.o === me).length;
  const theirs = s.pieces.filter((p) => p.o === op).length;
  if (s.cfg.king) {
    // шахматный Чапаев: раунд решают короли
    const kingGone = (o: number) => gone.some((id) => s0.pieces.some((p) => p.id === id && p.o === o && p.k));
    const myK = kingGone(me);
    const opK = kingGone(op);
    if (myK || opK) return endRound(s, myK && opK ? null : myK ? op : me, ev, myK && !opK ? 'свой король слетел' : 'король сбит');
  }
  if (!mine || !theirs) return endRound(s, mine ? me : theirs ? op : null, ev);
  if (!again) {
    s.turn = op;
    if (s.cfg.wind) s.wind = windFor(s);
  }
  if (s.shots >= MAX_SHOTS) {
    s.over = true;
    s.winner = mine >= theirs ? me : op;
    ev.push({ type: 'end', winner: s.winner });
  }
  return { state: s, events: ev };
}

function endRound(s: State, w: number | null, ev: Event[], why?: string) {
  if (w == null) {
    // все слетели (или оба короля) — переиграть с теми же рядами
    s.pieces = rows(s);
    if (s.cfg.wind) s.wind = windFor(s);
    ev.push({ type: 'round', winner: null, line: [...s.line] as [number, number], text: why ? 'оба короля слетели — переигрываем' : 'все шашки слетели — переигрываем' });
    return { state: s, events: ev };
  }
  const left = s.pieces.filter((p) => p.o === w).length;
  const step = left === 8 ? 2 : 1;
  const gap = 7 - s.line[0] - s.line[1];
  if (gap - step <= 0 || gap <= 1) {
    // ряды сошлись — раунд решил партию
    s.over = true;
    s.winner = w;
    ev.push({ type: 'round', winner: w, line: [...s.line] as [number, number], text: `${why ? why + ', ' : ''}ряды сошлись — партия` });
    ev.push({ type: 'end', winner: w });
    return { state: s, events: ev };
  }
  s.line[w] += Math.min(step, gap - 1);
  s.round++;
  s.pieces = rows(s);
  // ход у победителя; но прижатый к последней линии (сам ещё не сдвинут, а соперник — вплотную) бьёт первым
  s.turn = 7 - s.line[0] - s.line[1] <= 1 ? 1 - w : w;
  if (s.cfg.wind) s.wind = windFor(s);
  ev.push({ type: 'round', winner: w, line: [...s.line] as [number, number], text: `${why ? why + ' — ' : ''}${step === 2 ? 'без потерь — на две линии' : 'вперёд на линию'}` });
  return { state: s, events: ev };
}

function carromAfter(s0: State, s: State, a: Extract<Action, { type: 'strike' }>, gone: number[], strikerIn: boolean, ev: Event[], me: number) {
  const op = 1 - me;
  const kinds = gone.map((id) => s0.pieces.find((p) => p.id === id)!.o);
  const own = kinds.filter((o) => o === me).length;
  const theirs = kinds.filter((o) => o === op).length;
  const queen = kinds.includes(2);
  s.pocketed[me] += own;
  s.pocketed[op] += theirs;
  let again = own > 0 || queen;
  // королева: покрыта, если забил свою этим же или следующим ударом
  if (queen) s.cover = own > 0 ? null : me;
  if (queen && own > 0) s.queenBy = me;
  else if (s.cover === me && !queen) {
    if (own > 0) {
      s.queenBy = me;
      s.cover = null;
    } else {
      // не покрыл — королева в центр
      s.pieces.push({ id: 0, o: 2, x: CR.size / 2, y: CR.size / 2 });
      s.cover = null;
      ev.push({ type: 'foul', seat: me, text: 'королева не покрыта — обратно в центр' });
    }
  }
  if (strikerIn) {
    again = false;
    // штраф: одна своя забитая — в центр
    if (s.pocketed[me] > 0) {
      s.pocketed[me]--;
      const id = 100 + s.shots;
      s.pieces.push({ id, o: me, x: CR.size / 2 + 0.01, y: CR.size / 2 + CR.coin * 2.2 });
    }
    if (s.cover === me) {
      s.pieces.push({ id: 0, o: 2, x: CR.size / 2, y: CR.size / 2 });
      s.cover = null;
    }
    ev.push({ type: 'foul', seat: me, text: 'биток в лузе — штраф' });
  }
  // последняя своя — не раньше королевы: она и ещё одна забитая — обратно в центр, ход переходит
  if (own > 0 && !s.pieces.some((p) => p.o === me) && (s.pieces.some((p) => p.o === 2) || s.cover === me)) {
    for (let k = 0; k < 2 && s.pocketed[me] > 0; k++) {
      s.pocketed[me]--;
      s.pieces.push({ id: 200 + s.shots * 2 + k, o: me, x: CR.size / 2 + (k ? -1 : 1) * CR.coin * 2.2, y: CR.size / 2 });
    }
    again = false;
    ev.push({ type: 'foul', seat: me, text: 'последняя своя раньше королевы — фол' });
  }
  ev.splice(0, 0, { type: 'shot', seat: me, id: STRIKER, angle: a.angle, power: a.power, x: a.x, gone, again });
  // конец сдачи: у кого-то не осталось фишек
  const leftMe = s.pieces.filter((p) => p.o === me).length;
  const leftOp = s.pieces.filter((p) => p.o === op).length;
  const queenOn = s.pieces.some((p) => p.o === 2);
  if ((leftMe === 0 && !queenOn && s.cover == null) || leftOp === 0) {
    const w = leftMe === 0 ? me : op;
    const l = 1 - w;
    const pts = s.pieces.filter((p) => p.o === l).length + (s.queenBy === w ? 3 : 0);
    s.score[w] += Math.max(1, pts);
    ev.push({ type: 'board', winner: w, pts: Math.max(1, pts), score: [...s.score] as [number, number] });
    if (s.score[w] >= s.cfg.target) {
      s.over = true;
      s.winner = w;
      ev.push({ type: 'end', winner: w });
      return { state: s, events: ev };
    }
    s.pieces = carromSetup();
    s.pocketed = [0, 0];
    s.cover = null;
    s.queenBy = null;
    s.breakTries = 0;
    s.round++;
    s.turn = l;
    return { state: s, events: ev };
  }
  if (leftMe === 0 && queenOn) again = true; // осталась королева — бьёт дальше
  if (!again) s.turn = op;
  if (s.shots >= MAX_SHOTS) {
    s.over = true;
    s.winner = s.score[0] === s.score[1] ? (s.pocketed[0] >= s.pocketed[1] ? 0 : 1) : s.score[0] > s.score[1] ? 0 : 1;
    ev.push({ type: 'end', winner: s.winner });
  }
  return { state: s, events: ev };
}
