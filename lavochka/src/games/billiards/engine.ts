/* Бильярд — правила (без DOM). Удар — ход: хозяин партии считает физику (physics.ts), клиенты получают итог и кадры для анимации.
 *
 * Пул «восьмёрка»: 1–7 сплошные, 9–15 полосатые, 8 — последней в заказанную лузу. Разбой — с руки из дома.
 *   Фол: биток в лузе, ни одного касания, первым задет чужой шар (на открытом столе — восьмёрка), после касания ничего не упало и ни один шар не коснулся борта;
 *   на разбое — ничего не упало и меньше четырёх шаров у бортов. После фола сопернику «шар в руку» — биток куда угодно.
 *   Стол открыт, пока кто-то не забьёт шар не на разбое: его группа — забившему. Забил свой — бьёшь ещё.
 *   Восьмёрка: на разбое — выставляется; потом — победа, если своя группа уже убрана, без фола и в заказанную лузу, иначе проигрыш.
 * Русский бильярд (15 белых шаров + цветной биток, партия до 8 шаров):
 *   Американка — бить можно любым шаром, засчитываются и прицельный, и свояк;
 *   Московская (комбинированная) — бьют только цветным; упал биток — засчитан, следующий ставит его с руки в доме;
 *   Невская (динамичная) — бьют только цветным; упал биток — засчитан, следующий бьёт с руки с любого места, с руки засчитывается только прицельный, свояк с руки — фол.
 *   Фол (ни одного касания, свояк с руки): удар не засчитан, сопернику — шар со стола на полку, ход сопернику.
 * Классическая пирамида (до 71 очка): 15 номерных шаров (№1 — 11 очков, остальные — по номеру, последний шар — ещё +10), белый биток;
 *   каждый удар — заказ шара и лузы; заказанный упал куда заказан — засчитываются все упавшие, иначе выставляются; фол — −5 очков.
 * Одиночная партия — тренировка: тот же стол без соперника. */
import type { Options, Rng } from '../../core/types';
import { freeSpot, geometry, simulate, spotNear, TABLES, type Ball, type Geometry, type Shot, type TableSpec } from './physics';

export type Variant = 'pool8' | 'american' | 'moscow' | 'nevsky' | 'classic';

export interface Cfg {
  variant: Variant;
  /** Лузы пошире настоящих (×1,3). */
  wide: boolean;
  /** До скольких шаров (русский) или очков (классика). */
  target: number;
}

export function cfgFrom(o: Options): Cfg {
  const variant = (['pool8', 'american', 'moscow', 'nevsky', 'classic'] as const).includes(o.variant as Variant) ? (o.variant as Variant) : 'pool8';
  return { variant, wide: o.pockets == null ? variant !== 'pool8' : o.pockets === 'wide', target: variant === 'classic' ? 71 : variant === 'pool8' ? 0 : 8 };
}

export const isRussian = (v: Variant) => v !== 'pool8';

export function tableOf(cfg: Cfg): TableSpec {
  const t = TABLES[cfg.variant === 'pool8' ? 'pool' : 'russian'];
  return cfg.wide ? { ...t, corner: t.corner * 1.3, side: t.side * 1.25 } : t;
}

const geoCache = new Map<string, Geometry>();
export function geoOf(cfg: Cfg): Geometry {
  const key = `${cfg.variant === 'pool8' ? 'pool' : 'russian'}:${cfg.wide}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = geometry(tableOf(cfg))));
  return g;
}

/** Стоимость шара в классической пирамиде. */
export const classicValue = (id: number) => (id === 1 ? 11 : id);

export type Phase = 'place' | 'shot' | 'over';
export type Group = 'solid' | 'stripe' | 'all';

export interface State {
  cfg: Cfg;
  seats: number[];
  turn: number;
  balls: Ball[];
  phase: Phase;
  /** Куда можно поставить биток с руки. */
  zone: 'kitchen' | 'any';
  /** Удар с руки (невская: засчитывается только прицельный). */
  fromHand: boolean;
  /** Первый удар партии. */
  breakShot: boolean;
  score: number[];
  /** Пул: группы игроков (null — стол открыт). */
  groups: (Group | null)[];
  shots: number;
  winners: number[] | null;
  /** Чем кончился прошлый удар (для журнала и подсказок). */
  last: { seat: number; text: string } | null;
}

export type View = State;

export type Action =
  | { type: 'place'; x: number; y: number }
  | { type: 'shot'; cue?: number; angle: number; power: number; spinX?: number; spinY?: number; call?: { ball: number; pocket: number } };

export type Event =
  | { type: 'place'; seat: number; x: number; y: number }
  | {
      type: 'shot';
      seat: number;
      cue: number;
      frames: { t: number; p: number[] }[];
      ids: number[];
      pocketed: { id: number; pocket: number }[];
      foul: string | null;
      points: number;
      text: string;
      call?: { ball: number; pocket: number };
    }
  | { type: 'spot'; ids: number[] }
  | { type: 'end'; winners: number[]; text: string };

export const POCKET_NAMES = ['левая угловая у дома', 'левая средняя', 'дальняя левая угловая', 'дальняя правая угловая', 'правая средняя', 'правая угловая у дома'];

// ---------------------------------------------------------------- расстановка

export function rack(cfg: Cfg, rng: Rng): Ball[] {
  const t = tableOf(cfg);
  const d = t.r * 2.005;
  const fx = t.w * 0.75;
  const cy = t.h / 2;
  const pos: [number, number][] = [];
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) pos.push([fx + row * d * 0.866, cy + (i - row / 2) * d]);
  let ids = Array.from({ length: 15 }, (_, i) => i + 1);
  if (cfg.variant === 'pool8') {
    // 8 — в центре третьего ряда, в задних углах — сплошной и полосатый
    const rest = ids.filter((x) => x !== 8);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const solid = rest.findIndex((x) => x < 8);
    const sId = rest.splice(solid, 1)[0];
    const stripe = rest.findIndex((x) => x > 8);
    const tId = rest.splice(stripe, 1)[0];
    ids = [];
    let k = 0;
    for (let i = 0; i < 15; i++) {
      if (i === 4) ids.push(8);
      else if (i === 10) ids.push(sId);
      else if (i === 14) ids.push(tId);
      else ids.push(rest[k++]);
    }
  } else {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  const balls: Ball[] = ids.map((id, i) => ({ id, x: pos[i][0], y: pos[i][1], on: true }));
  balls.unshift({ id: 0, x: t.w * 0.2, y: cy, on: true });
  return balls;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const cfg = cfgFrom(opts);
  return {
    cfg,
    seats: seats.slice(),
    turn: seats[0],
    balls: rack(cfg, rng),
    phase: 'place',
    zone: 'kitchen',
    fromHand: true,
    breakShot: true,
    score: [0, 0, 0, 0],
    groups: [null, null, null, null],
    shots: 0,
    winners: null,
    last: null,
  };
}

export const toAct = (s: State) => (s.phase === 'over' ? [] : [s.turn]);
const other = (s: State, seat: number) => (s.seats.length === 1 ? seat : s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length]);

export const groupOf = (id: number): Group | null => (id >= 1 && id <= 7 ? 'solid' : id >= 9 && id <= 15 ? 'stripe' : null);
export const onTable = (s: State, id: number) => s.balls.some((b) => b.id === id && b.on);

/** Свои шары в пуле (пусто — пора восьмёрку). */
export function ownBalls(s: State, seat: number): number[] {
  const g = s.groups[seat];
  if (!g) return [];
  return s.balls.filter((b) => b.on && b.id !== 0 && b.id !== 8 && (g === 'all' || groupOf(b.id) === g)).map((b) => b.id);
}

/** По каким шарам можно бить первым (пул). */
export function legalTargets(s: State, seat: number): number[] {
  const objs = s.balls.filter((b) => b.on && b.id !== 0).map((b) => b.id);
  if (s.cfg.variant !== 'pool8') return objs;
  if (!s.groups[seat]) return objs.filter((id) => id !== 8 || objs.length === 1);
  const own = ownBalls(s, seat);
  return own.length ? own : [8];
}

/** Какими шарами можно бить. */
export function cueBalls(s: State): number[] {
  if (s.cfg.variant === 'american' && !s.breakShot && !s.fromHand) return s.balls.filter((b) => b.on).map((b) => b.id);
  return [0];
}

export function placeOk(s: State, x: number, y: number): boolean {
  const t = tableOf(s.cfg);
  if (s.zone === 'kitchen' && x > t.w / 4 - t.r) return false;
  return freeSpot(t, s.balls, x, y, 0);
}

// ---------------------------------------------------------------- ход

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, balls: s0.balls.map((b) => ({ ...b })), score: s0.score.slice(), groups: s0.groups.slice() };
  const ev: Event[] = [];
  if (s0.phase === 'place') {
    if (a.type !== 'place' || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !placeOk(s0, a.x, a.y)) return null;
    const cue = s.balls.find((b) => b.id === 0)!;
    cue.x = a.x;
    cue.y = a.y;
    cue.on = true;
    s.phase = 'shot';
    ev.push({ type: 'place', seat, x: a.x, y: a.y });
    return { state: s, events: ev };
  }
  if (a.type !== 'shot' || !Number.isFinite(a.angle) || !Number.isFinite(a.power)) return null;
  const cueId = a.cue ?? 0;
  if (!cueBalls(s0).includes(cueId) || !onTable(s0, cueId)) return null;
  const call = a.call && Number.isInteger(a.call.ball) && Number.isInteger(a.call.pocket) && a.call.pocket >= 0 && a.call.pocket < 6 ? a.call : undefined;
  if (s.cfg.variant === 'classic' && (!call || !onTable(s0, call.ball) || call.ball === 0)) return null;
  const shot: Shot = { cue: cueId, angle: a.angle, power: Math.max(0, Math.min(1, a.power)), spinX: Math.max(-1, Math.min(1, a.spinX ?? 0)), spinY: Math.max(-1, Math.min(1, a.spinY ?? 0)) };
  const res = simulate(geoOf(s.cfg), s.balls, shot);
  s.balls = res.balls;
  s.shots++;
  const judge = s.cfg.variant === 'pool8' ? judgePool(s0, s, seat, res, call) : s.cfg.variant === 'classic' ? judgeClassic(s0, s, seat, res, call!) : judgeRussian(s0, s, seat, res, cueId);
  ev.push({ type: 'shot', seat, cue: cueId, frames: res.frames, ids: res.ids, pocketed: res.pocketed, foul: judge.foul, points: judge.points, text: judge.text, call });
  if (judge.spot.length) ev.push({ type: 'spot', ids: judge.spot });
  s.last = { seat, text: judge.text };
  s.breakShot = false;
  if (judge.end) {
    s.phase = 'over';
    s.winners = judge.end.winners;
    ev.push({ type: 'end', winners: judge.end.winners, text: judge.end.text });
    return { state: s, events: ev };
  }
  if (!judge.again) s.turn = other(s, seat);
  // биток с руки
  const cue = s.balls.find((b) => b.id === 0)!;
  if (judge.hand) {
    s.phase = 'place';
    s.zone = judge.hand;
    s.fromHand = true;
    if (!cue.on) {
      // где поставить по умолчанию — в доме
      const t = tableOf(s.cfg);
      const [x, y] = spotNear(t, s.balls, t.w * 0.2, t.h / 2, 0);
      cue.x = x;
      cue.y = y;
    }
  } else {
    s.phase = 'shot';
    s.fromHand = false;
  }
  return { state: s, events: ev };
}

interface Judge {
  foul: string | null;
  points: number;
  again: boolean;
  hand: 'kitchen' | 'any' | null;
  spot: number[];
  text: string;
  end?: { winners: number[]; text: string };
}

/** Выставить шары обратно на стол (заднюю отметку и рядом). */
function respot(s: State, ids: number[]) {
  const t = tableOf(s.cfg);
  for (const id of ids) {
    const b = s.balls.find((x) => x.id === id)!;
    const [x, y] = spotNear(t, s.balls, t.w * 0.75, t.h / 2, id);
    b.x = x;
    b.y = y;
    b.on = true;
  }
}

function judgePool(s0: State, s: State, seat: number, res: ReturnType<typeof simulate>, call?: { ball: number; pocket: number }): Judge {
  const solo = s.seats.length === 1;
  const ids = res.pocketed.map((p) => p.id);
  const cueIn = ids.includes(0);
  const eight = res.pocketed.find((p) => p.id === 8);
  const objs = ids.filter((id) => id !== 0 && id !== 8);
  const legal = legalTargets(s0, seat);
  let foul: string | null = null;
  if (cueIn) foul = 'биток в лузе';
  else if (res.first < 0) foul = 'ни одного касания';
  else if (!legal.includes(res.first)) foul = `первым задет чужой шар (${res.first})`;
  else if (s0.breakShot && !ids.length && res.railBalls.length < 4) foul = 'слабый разбой';
  else if (!ids.length && res.railsAfter === 0) foul = 'после касания ни один шар не коснулся борта';
  const spot: number[] = [];
  const hand = foul ? (s0.breakShot ? 'kitchen' : 'any') : null;
  // восьмёрка
  if (eight) {
    if (s0.breakShot) {
      respot(s, [8]);
      spot.push(8);
    } else {
      const own = solo ? s0.balls.filter((b) => b.on && b.id !== 0 && b.id !== 8).length === 0 : !!s0.groups[seat] && ownBalls(s0, seat).length === 0;
      const winOk = own && !foul && (!call || call.ball !== 8 || call.pocket === eight.pocket);
      const opp = other(s, seat);
      if (winOk) return { foul, points: 0, again: false, hand: null, spot, text: 'восьмёрка в лузе — победа!', end: { winners: [seat], text: 'забил восьмёрку' } };
      return {
        foul: foul ?? 'восьмёрка раньше времени',
        points: 0,
        again: false,
        hand: null,
        spot,
        text: 'восьмёрка не по правилам — проигрыш',
        end: { winners: solo ? [] : [opp], text: solo ? 'восьмёрка не по правилам' : 'соперник забил восьмёрку не по правилам' },
      };
    }
  }
  if (cueIn) s.balls.find((b) => b.id === 0)!.on = false;
  // группы
  if (!foul && !s0.breakShot && objs.length && !s.groups[seat]) {
    if (solo) s.groups[seat] = 'all';
    else {
      const g = groupOf(objs[0])!;
      s.groups[seat] = g;
      s.groups[other(s, seat)] = g === 'solid' ? 'stripe' : 'solid';
    }
  }
  if (solo && !s.groups[seat]) s.groups[seat] = 'all';
  const mine = (id: number) => {
    const g = s.groups[seat];
    return !g || g === 'all' || groupOf(id) === g;
  };
  const again = !foul && (s0.breakShot ? objs.length > 0 : objs.some(mine));
  const text = foul ? `фол: ${foul}` : objs.length ? `забито: ${objs.join(', ')}` : 'мимо';
  return { foul, points: objs.length, again: again || solo, hand, spot, text };
}

/** Снять со стола шар на полку соперника (за штраф). */
function penaltyBall(s: State): number | null {
  const objs = s.balls.filter((b) => b.on && b.id !== 0);
  if (!objs.length) return null;
  const b = objs[objs.length - 1];
  b.on = false;
  return b.id;
}

function judgeRussian(s0: State, s: State, seat: number, res: ReturnType<typeof simulate>, cueId: number): Judge {
  const v = s.cfg.variant;
  const solo = s.seats.length === 1;
  const opp = other(s, seat);
  const ids = res.pocketed.map((p) => p.id);
  const cueIn = ids.includes(cueId);
  let foul: string | null = null;
  if (res.first < 0) foul = 'ни одного касания';
  else if (v === 'nevsky' && s0.fromHand && cueIn) foul = 'свояк с руки';
  let points = 0;
  const spot: number[] = [];
  if (foul) {
    // упавшие при фоле — обратно, сопернику — шар на полку
    const back = ids.filter((id) => id !== 0);
    respot(s, back);
    spot.push(...back);
    if (solo) s.score[seat] = Math.max(0, s.score[seat] - 1);
    else {
      const pb = penaltyBall(s);
      if (pb != null) s.score[opp]++;
    }
  } else {
    // засчитываются все упавшие (на невской с руки — без битка; биток тут не падает — иначе фол)
    points = ids.length;
    s.score[seat] += points;
  }
  // цветной биток упал — вернуть: московская — с руки в доме, невская — с руки откуда угодно
  const colorIn = ids.includes(0);
  let hand: 'kitchen' | 'any' | null = null;
  if (colorIn) {
    if (v === 'nevsky') hand = 'any';
    else if (v === 'moscow') hand = 'kitchen';
    else {
      // американка: цветной стал обычным, но если упал — упал (засчитан); бить дальше любым
    }
  }
  if (foul && colorIn && v !== 'american') hand = v === 'nevsky' ? 'any' : 'kitchen';
  // американка: если на столе не осталось шаров, кроме одного — партия по очкам
  const left = s.balls.filter((b) => b.on).length;
  const text = foul ? `фол: ${foul}` : points ? `забито шаров: ${points}` : 'мимо';
  const target = s.cfg.target;
  const winner = s.seats.find((p) => s.score[p] >= target);
  if (winner != null) return { foul, points, again: false, hand, spot, text, end: { winners: [winner], text: `${target} шаров` } };
  if (left <= 1 || (v !== 'american' && !s.balls.some((b) => b.on && b.id !== 0))) {
    const best = Math.max(...s.seats.map((p) => s.score[p]));
    return { foul, points, again: false, hand, spot, text, end: { winners: s.seats.filter((p) => s.score[p] === best), text: 'шары кончились' } };
  }
  if (hand && v !== 'american') {
    // биток вынут — ставится с руки
    s.balls.find((b) => b.id === 0)!.on = false;
  }
  return { foul, points, again: (!foul && points > 0) || solo, hand, spot, text };
}

function judgeClassic(s0: State, s: State, seat: number, res: ReturnType<typeof simulate>, call: { ball: number; pocket: number }): Judge {
  const solo = s.seats.length === 1;
  const ids = res.pocketed.map((p) => p.id);
  const cueIn = ids.includes(0);
  const objs = ids.filter((id) => id !== 0);
  let foul: string | null = null;
  if (res.first < 0) foul = 'ни одного касания';
  else if (cueIn) foul = 'биток в лузе';
  const hit = res.pocketed.some((p) => p.id === call.ball && p.pocket === call.pocket);
  let points = 0;
  const spot: number[] = [];
  if (foul) {
    s.score[seat] -= 5;
    respot(s, objs);
    spot.push(...objs);
  } else if (hit) {
    points = objs.reduce((a, id) => a + classicValue(id), 0);
    // последний шар — ещё +10
    if (!s.balls.some((b) => b.on && b.id !== 0)) points += 10;
    s.score[seat] += points;
  } else if (objs.length) {
    respot(s, objs);
    spot.push(...objs);
  }
  const hand = cueIn ? 'kitchen' : null;
  if (cueIn) s.balls.find((b) => b.id === 0)!.on = false;
  const text = foul ? `фол: ${foul} (−5)` : hit ? `заказ сыгран: +${points}` : objs.length ? 'не тот шар или не та луза — выставлены' : 'мимо';
  const winner = s.seats.find((p) => s.score[p] >= s.cfg.target);
  if (winner != null) return { foul, points, again: false, hand, spot, text, end: { winners: [winner], text: `${s.cfg.target} очко` } };
  if (!s.balls.some((b) => b.on && b.id !== 0)) {
    const best = Math.max(...s.seats.map((p) => s.score[p]));
    return { foul, points, again: false, hand, spot, text, end: { winners: s.seats.filter((p) => s.score[p] === best), text: 'шары кончились' } };
  }
  return { foul, points, again: (!foul && hit) || solo, hand, spot, text };
}

export const makeView = (s: State): View => s;
