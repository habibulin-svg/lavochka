/* «Бородино» — движок (без DOM). Правила — по брошюре игры «Бородино» (Инфобанк, 1991): 20 ходов по полчаса, ход — фаза французов, затем русских;
 * в фазе: приведение в боевое состояние → передвижение → сражения. Местность, зоны контроля, таблица результатов боя, преследование,
 * огонь артиллерии, командующие (рейтинг, моральный дух, ранения). Победа — по потерям русской армии в очках боевой силы. */
import type { Rng } from '../../core/types';
import { byLabel, center, dist, exists, isForest, isRedoubt, isRiver, isRoad, isShrub, isVillage, level, line, N, neighbors, redoubtSide, ROAD_HEX, stepCost, type MoveKind } from './hex';
import { commands, RUSSIAN_TOTAL, UNITS, type UnitDef } from './units';

export const TURNS = 20;
export const FR = 0;
export const RU = 1;

export interface Cfg {
  /** Гипотетический сценарий: сначала русские, потом французы расставляют части сами. */
  free: boolean;
  /** Проверка здоровья командующих после боя. */
  wounds: boolean;
  turns: number;
}
export const cfgFrom = (o: Record<string, unknown>): Cfg => ({ free: o.scenario === 'free', wounds: o.wounds !== false, turns: Number(o.turns) || TURNS });

export type Phase = 'deploy' | 'rally' | 'move' | 'combat' | 'pursue' | 'over';

export interface UState {
  hex: number;
  /** Деморализована (у артиллерии — «на колёсах»). */
  dem: boolean;
  /** Очков движения осталось в этой фазе. */
  mp: number;
  moved: boolean;
  attacked: boolean;
  /** Выбыл: уничтожен, убит, тяжело ранен, взят в плен; легко ранен — вернётся на ходу back. */
  out: null | 'dead' | 'wounded' | 'captured' | 'light';
  back: number;
}

export interface CombatLog {
  att: number[];
  def: number;
  a: number;
  d: number;
  diff: number;
  roll: number;
  res: Res;
}

export interface State {
  cfg: Cfg;
  turn: number;
  side: 0 | 1;
  phase: Phase;
  u: UState[];
  /** Проигравшие и отступившие в этот ход — второй раз не атакуются. */
  beaten: number[];
  /** Потери в очках силы: [французы, русские]. */
  losses: [number, number];
  pursuit: { hex: number; units: number[] } | null;
  last: { move?: [number, number]; combat?: CombatLog } | null;
  result: { winners: number[]; text: string; level: number } | null;
}

export type Action =
  | { type: 'rally' }
  | { type: 'move'; u: number; to: number }
  | { type: 'wheels'; u: number }
  | { type: 'endMove' }
  | { type: 'attack'; def: number; att: number[] }
  | { type: 'pursue'; u: number | null }
  | { type: 'endCombat' }
  | { type: 'deploy'; u: number; to: number }
  | { type: 'ready' };

export type Res = 'АУ' | 'А2' | 'А1' | 'З1' | 'З2' | 'ЗУ' | '*';
export type Event =
  | { type: 'phase'; side: 0 | 1; phase: Phase; turn: number }
  | { type: 'rally'; side: 0 | 1; rolls: { u: number; roll: number; ok: boolean }[] }
  | { type: 'move'; u: number; path: number[] }
  | { type: 'wheels'; u: number; on: boolean }
  | { type: 'combat'; log: CombatLog; a: number; d: number }
  | { type: 'retreat'; u: number; path: number[] }
  | { type: 'hold'; u: number; cmd: number; roll: number }
  | { type: 'dead'; u: number }
  | { type: 'pursue'; u: number; to: number }
  | { type: 'wound'; u: number; roll: number[]; res: 'dead' | 'wounded' | 'light' | 'ok' }
  | { type: 'captured'; u: number }
  | { type: 'back'; u: number; hex: number }
  | { type: 'end'; winners: number[]; text: string; level: number };

/** Таблица 2: результаты боя по броску (1–6) и столбцу разницы сил (−9/−10 … +17/+18). */
const CRT: Res[][] = [
  ['АУ', 'АУ', 'А2', 'А2', 'А1', 'А1', 'А1', 'А1', 'А1', 'А1', 'З1', 'З1', '*', '*', '*'],
  ['АУ', 'А2', 'А2', 'А1', 'А1', 'А1', 'А1', 'А1', 'З1', 'З1', 'З1', 'З2', 'З2', 'З2', 'З2'],
  ['А2', 'А2', 'А1', 'А1', 'А1', 'А1', 'А1', 'З1', 'З1', 'З1', 'З2', 'З2', 'З2', 'З2', 'З2'],
  ['А2', 'А2', 'А1', 'А1', 'А1', 'З1', 'З1', 'З1', 'З1', 'З2', 'З2', 'З2', 'З2', 'З2', 'ЗУ'],
  ['А2', 'А1', 'А1', 'З1', 'З1', 'З1', 'З1', 'З1', 'З2', 'З2', 'З2', 'З2', 'З2', 'ЗУ', 'ЗУ'],
  ['*', '*', 'З1', 'З1', 'З1', 'З1', 'З1', 'З2', 'З2', 'З2', 'З2', 'ЗУ', 'ЗУ', 'ЗУ', 'ЗУ'],
];
export const CRT_TABLE = CRT;
export const CRT_COLS = ['−10…−9', '−8…−7', '−6…−5', '−4…−3', '−2…−1', '0', '+1…+2', '+3…+4', '+5…+6', '+7…+8', '+9…+10', '+11…+12', '+13…+14', '+15…+16', '+17…+18'];
export function crtCol(diff: number): number {
  if (diff === 0) return 5;
  if (diff > 0) return Math.min(14, 6 + Math.floor((diff - 1) / 2));
  return Math.max(0, 4 - Math.floor((-diff - 1) / 2));
}
/** Порог приведения в боевое состояние. */
export const RALLY: Record<string, number> = { ru: 2, fr: 3, xx: 4 };

const clone = (s: State): State => JSON.parse(JSON.stringify(s));
export const U = UNITS;
export const isCombat = (i: number) => U[i].kind !== 'cmd';
export const alive = (s: State, i: number) => s.u[i].out === null && s.u[i].hex >= 0;
/** Части и командующие в клетке. */
export function at(s: State, hex: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < U.length; i++) if (s.u[i].hex === hex && s.u[i].out === null) out.push(i);
  return out;
}
export const unitAt = (s: State, hex: number) => at(s, hex).find((i) => isCombat(i)) ?? -1;
export const side = (i: number) => U[i].side;

/** Боевое состояние: части и командующие. */
export function newState(cfg: Cfg): State {
  const s: State = {
    cfg,
    turn: 1,
    side: cfg.free ? RU : FR,
    phase: cfg.free ? 'deploy' : 'rally',
    u: U.map((d) => ({ hex: byLabel(d.at), dem: false, mp: 0, moved: false, attacked: false, out: null, back: 0 })),
    beaten: [],
    losses: [0, 0],
    pursuit: null,
    last: null,
    result: null,
  };
  if (!cfg.free) startPhase(s, []);
  return s;
}

export const toAct = (s: State) => (s.phase === 'over' ? [] : [s.side]);

// ---------- зоны контроля ----------

/** Даёт ли часть i зону контроля на соседнюю клетку n. */
export function zocInto(s: State, i: number, n: number): boolean {
  if (!isCombat(i) || !alive(s, i) || s.u[i].dem) return false;
  const h = s.u[i].hex;
  if (isForest(n) || isShrub(n)) return false;
  if (isRiver(h, n) || redoubtSide(h, n)) return false;
  return true;
}
/** Клетка n — в зоне контроля стороны sd. */
export function inZoc(s: State, sd: number, n: number): boolean {
  for (const m of neighbors(n)) {
    const e = unitAt(s, m);
    if (e >= 0 && side(e) === sd && zocInto(s, e, n)) return true;
  }
  return false;
}

// ---------- передвижение ----------

export function moveKind(s: State, i: number): MoveKind {
  const k = U[i].kind;
  if (k === 'art') return 'wheels';
  if (k === 'cav') return 'cav';
  if (k === 'cmd') return 'cmd';
  return 'inf';
}

/** Куда может дойти часть: клетка → цена и откуда пришли (для пути). */
export function reach(s: State, i: number): Map<number, { cost: number; prev: number; path?: number[] }> {
  const out = new Map<number, { cost: number; prev: number; path?: number[] }>();
  const st = s.u[i];
  if (!alive(s, i)) return out;
  const d = U[i];
  const enemy = 1 - d.side;
  const kind = moveKind(s, i);
  if (d.kind === 'art' && !st.dem) return out;
  let budget = st.mp;
  const startRoad = ROAD_HEX.has(st.hex);
  if (kind === 'wheels' && startRoad) budget += 1;
  const cmd = d.kind === 'cmd';
  if (!cmd && kind !== 'cav' && inZoc(s, enemy, st.hex)) return out;
  out.set(st.hex, { cost: 0, prev: -1 });
  const open: number[] = [st.hex];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (out.get(open[k])!.cost < out.get(open[bi])!.cost) bi = k;
    const a = open.splice(bi, 1)[0];
    const ca = out.get(a)!.cost;
    // в зоне контроля останавливаются
    if (a !== st.hex && !cmd && kind !== 'cav' && inZoc(s, enemy, a)) continue;
    for (const b of neighbors(a)) {
      const occ = at(s, b);
      if (occ.some((j) => side(j) !== d.side && isCombat(j))) continue;
      if (cmd && occ.some((j) => side(j) !== d.side)) continue;
      const c = ca + stepCost(a, b, kind);
      if (c > budget) continue;
      const cur = out.get(b);
      if (cur && cur.cost <= c) continue;
      out.set(b, { cost: c, prev: a });
      open.push(b);
    }
  }
  // путь до каждой клетки — по полному дереву, пока ничего не вычеркнули
  const tree = new Map(out);
  for (const [h, v] of out) {
    const p: number[] = [];
    for (let x = h; x >= 0; x = tree.get(x)?.prev ?? -1) p.unshift(x);
    v.path = p;
  }
  // конец хода: не в клетке с другой частью; артиллерия с «дорожным» очком — только на дороге
  for (const [h, v] of [...out]) {
    if (h === st.hex) continue;
    const occ = at(s, h).filter((j) => j !== i);
    if (!cmd && occ.some((j) => isCombat(j))) out.delete(h);
    else if (kind === 'wheels' && v.cost > st.mp && !(startRoad && ROAD_HEX.has(h))) out.delete(h);
  }
  out.delete(st.hex);
  return out;
}

export function pathTo(r: Map<number, { cost: number; prev: number; path?: number[] }>, to: number): number[] {
  return r.get(to)?.path ?? [to];
}

// ---------- сражение ----------

const isArt = (i: number) => U[i].kind === 'art';
export const strengthOf = (s: State, i: number) => (s.u[i].dem ? U[i].str2 : U[i].str);
/** Командующий в клетке части, который может её вести. */
export function leader(s: State, i: number): number {
  let best = -1;
  for (const j of at(s, s.u[i].hex)) if (U[j].kind === 'cmd' && commands(U[j], U[i]) && (best < 0 || U[j].str > U[best].str)) best = j;
  return best;
}

/** Таблица 1: прибавка атакующему (A) и защищающемуся (З) по типам и состоянию. */
function table1(att: UnitDef, def: UnitDef, defDem: boolean): { a: number; d: number } {
  const ak = att.kind;
  if (def.kind === 'inf') {
    if (!defDem) return { a: ak === 'cav' ? 2 : 0, d: 0 };
    return { a: ak === 'inf' ? 1 : ak === 'cav' ? 3 : 1, d: 0 };
  }
  if (def.kind === 'cav') {
    if (!defDem) return { a: 0, d: ak === 'inf' ? 2 : 0 };
    return { a: ak === 'cav' || ak === 'art' ? 1 : 0, d: 0 };
  }
  // артиллерия: к бою / на колёсах
  if (!defDem) return { a: 0, d: ak === 'inf' ? 4 : 2 };
  return { a: ak === 'inf' ? 1 : 0, d: 0 };
}
/** Таблица 3: огонь артиллерии — прибавка по дальности и цели. */
function table3(def: UnitDef, defDem: boolean, d: number): number {
  if (def.kind === 'inf') return defDem ? [0, 8, 6, 1, 0][d] ?? 0 : [0, 6, 4, 0, 0][d] ?? 0;
  if (def.kind === 'cav') return defDem ? [0, 4, 2, 0, 0][d] ?? 0 : [0, 2, 1, 0, 0][d] ?? 0;
  return 0;
}

/** Может ли часть i участвовать в атаке на def; null — может, иначе причина. */
export function canJoin(s: State, i: number, def: number): string | null {
  const st = s.u[i];
  const d = U[i];
  if (!alive(s, i) || !isCombat(i) || d.side !== s.side) return 'не своя часть';
  if (st.attacked) return 'уже атаковала';
  if (st.dem) return d.kind === 'art' ? 'на колёсах' : 'деморализована';
  const a = st.hex;
  const b = s.u[def].hex;
  const r = dist(a, b);
  if (d.kind === 'art') {
    const range = level(a) > level(b) ? 4 : 3;
    if (r > range) return 'далеко';
    if (r > 1 && level(b) > level(a)) return 'цель выше';
    if (line(a, b).some((h) => isForest(h) || isVillage(h))) return 'нет прямой линии огня';
    if (r === 1 && (isForest(b) || isForest(a)) && !isRoad(a, b)) return 'в лесу не сражаются';
    return null;
  }
  if (r !== 1) return 'не рядом';
  if (isRiver(a, b)) return 'через реку';
  if ((isForest(b) || isForest(a)) && !isRoad(a, b)) return 'в лесу не сражаются';
  return null;
}

/** Можно ли атаковать часть def. */
export function canTarget(s: State, def: number): boolean {
  return alive(s, def) && isCombat(def) && side(def) !== s.side && !s.beaten.includes(def);
}

export interface Odds {
  a: number;
  d: number;
  diff: number;
  parts: string[];
}
/** Сила сторон в атаке att на def. */
export function odds(s: State, att: number[], def: number): Odds {
  const D = U[def];
  const dDem = s.u[def].dem;
  const parts: string[] = [];
  let a = 0;
  let dBonus = 0;
  const dh = s.u[def].hex;
  let lower = false;
  for (const i of att) {
    const t = table1(U[i], D, dDem);
    let v = U[i].str + t.a;
    const L = leader(s, i);
    if (L >= 0) v += U[L].str;
    if (isArt(i)) v += table3(D, dDem, dist(s.u[i].hex, dh));
    a += v;
    dBonus = Math.max(dBonus, t.d);
    if (level(s.u[i].hex) < level(dh) && (!isArt(i) || dist(s.u[i].hex, dh) === 1)) lower = true;
  }
  let d = strengthOf(s, def);
  const dl = leader(s, def);
  if (dl >= 0) {
    d += U[dl].str;
    parts.push(`командующий +${U[dl].str}`);
  }
  if (dBonus) {
    d += dBonus;
    parts.push(`тип частей +${dBonus}`);
  }
  if (isShrub(dh)) {
    d += 1;
    parts.push('кустарник +1');
  }
  if (isVillage(dh)) {
    d += 2;
    parts.push('деревня +2');
  }
  if (lower) {
    d += 2;
    parts.push('склон +2');
  }
  if (isRedoubt(dh)) {
    d += 2;
    parts.push('редут +2');
  }
  return { a, d, diff: a - d, parts };
}

// ---------- фазы ----------

function startPhase(s: State, ev: Event[]) {
  s.beaten = s.side === FR ? [] : s.beaten;
  for (let i = 0; i < U.length; i++) {
    const st = s.u[i];
    st.moved = false;
    st.attacked = false;
    if (U[i].side === s.side) st.mp = U[i].kind === 'art' ? 0 : st.dem ? U[i].mp2 : U[i].mp;
  }
  // легко раненые командующие возвращаются к своим частям
  for (let i = 0; i < U.length; i++) {
    const st = s.u[i];
    if (st.out === 'light' && U[i].side === s.side && s.turn >= st.back) {
      const j = U.findIndex((d, k) => alive(s, k) && isCombat(k) && commands(U[i], d));
      if (j >= 0) {
        st.out = null;
        st.hex = s.u[j].hex;
        ev.push({ type: 'back', u: i, hex: st.hex });
      }
    }
  }
  const dem = U.some((d, i) => d.side === s.side && alive(s, i) && s.u[i].dem && d.kind !== 'art');
  s.phase = dem ? 'rally' : 'move';
  ev.push({ type: 'phase', side: s.side, phase: s.phase, turn: s.turn });
}

function nextPhase(s: State, ev: Event[]) {
  if (s.side === FR) s.side = RU;
  else {
    s.side = FR;
    s.turn++;
    s.beaten = [];
    if (s.turn > s.cfg.turns) return finish(s, ev);
  }
  startPhase(s, ev);
}

/** Итог по потерям русских (таблица условий победы): уровень 1–4, победитель. */
export function verdict(losses: number): { level: number; winners: number[]; text: string } {
  const p = losses / RUSSIAN_TOTAL;
  if (p > 0.5) return { level: 1, winners: [FR], text: 'решающая победа французов' };
  if (p >= 0.35) return { level: 2, winners: [FR], text: 'частичная победа французов' };
  if (p > 0.25) return { level: 3, winners: [RU], text: 'частичная победа русских' };
  return { level: 4, winners: [RU], text: 'решающая победа русских' };
}

function finish(s: State, ev: Event[]) {
  const v = verdict(s.losses[RU]);
  s.phase = 'over';
  s.result = { ...v, text: `${v.text}: русские потеряли ${s.losses[RU]} из ${RUSSIAN_TOTAL} очков силы` };
  ev.push({ type: 'end', winners: v.winners, text: s.result.text, level: v.level });
}

function destroy(s: State, i: number, ev: Event[]) {
  const st = s.u[i];
  // командующие в клетке остаются одни — проверка плена ниже
  st.out = 'dead';
  st.hex = -1;
  s.losses[side(i)] += U[i].str;
  ev.push({ type: 'dead', u: i });
}

/** Командующие, оставшиеся одни рядом с вражеской частью, попадают в плен. */
function captures(s: State, ev: Event[]) {
  for (let i = 0; i < U.length; i++) {
    if (U[i].kind !== 'cmd' || !alive(s, i)) continue;
    const h = s.u[i].hex;
    if (at(s, h).some((j) => isCombat(j) && side(j) === side(i))) continue;
    const near = neighbors(h).some((m) => {
      const e = unitAt(s, m);
      return e >= 0 && side(e) !== side(i);
    });
    if (near || at(s, h).some((j) => isCombat(j) && side(j) !== side(i))) {
      s.u[i].out = 'captured';
      s.u[i].hex = -1;
      ev.push({ type: 'captured', u: i });
    }
  }
}

/** Отступление на n клеток от победителей; false — некуда (часть уничтожается). */
function retreat(s: State, i: number, n: number, from: number[], ev: Event[]): boolean {
  const h0 = s.u[i].hex;
  const sd = side(i);
  const kind = moveKind(s, i);
  const dmin = (h: number) => Math.min(...from.map((f) => dist(f, h)));
  let best: number[] | null = null;
  let bestScore = -Infinity;
  const go = (path: number[]) => {
    const h = path[path.length - 1];
    if (path.length - 1 === n) {
      if (unitAt(s, h) >= 0 && h !== h0) return;
      if (inZoc(s, 1 - sd, h)) return;
      const friends = neighbors(h).filter((m) => {
        const j = unitAt(s, m);
        return j >= 0 && side(j) === sd;
      }).length;
      const sc = dmin(h) * 10 + friends - (inZoc(s, 1 - sd, h) ? 50 : 0);
      if (sc > bestScore) {
        bestScore = sc;
        best = path.slice();
      }
      return;
    }
    for (const m of neighbors(h)) {
      if (path.includes(m)) continue;
      if (dmin(m) <= dmin(h)) continue;
      const j = unitAt(s, m);
      if (j >= 0 && side(j) !== sd) continue;
      if (redoubtSide(h, m)) continue;
      if (stepCost(h, m, kind === 'cmd' ? 'inf' : kind) === Infinity) continue;
      path.push(m);
      go(path);
      path.pop();
    }
  };
  go([h0]);
  if (!best) return false;
  const p = best as number[];
  const to = p[p.length - 1];
  for (const j of at(s, h0)) if (j === i || (U[j].kind === 'cmd' && side(j) === sd)) s.u[j].hex = to;
  ev.push({ type: 'retreat', u: i, path: p });
  return true;
}

/** Часть должна отступить: командующий в клетке может удержать (бросок не больше рейтинга). */
function mustRetreat(s: State, i: number, n: number, from: number[], rng: Rng, ev: Event[]): 'held' | 'gone' | 'dead' {
  const L = leader(s, i);
  if (L >= 0) {
    const roll = rng.int(6) + 1;
    if (roll <= U[L].str) {
      ev.push({ type: 'hold', u: i, cmd: L, roll });
      return 'held';
    }
  }
  if (isArt(i)) {
    // артиллерия отступает, только если победитель рядом; переводится «на колёса»
    if (!from.some((f) => dist(f, s.u[i].hex) === 1)) return 'held';
  }
  if (retreat(s, i, n, from, ev)) {
    s.u[i].dem = true;
    return 'gone';
  }
  destroy(s, i, ev);
  return 'dead';
}

function woundCheck(s: State, cmd: number, rng: Rng, ev: Event[]) {
  const r1 = rng.int(6) + 1;
  if (r1 > 2) return;
  const r2 = rng.int(6) + 1;
  const res = r2 === 1 ? 'dead' : r2 === 2 ? 'wounded' : r2 <= 4 ? 'light' : 'ok';
  ev.push({ type: 'wound', u: cmd, roll: [r1, r2], res });
  if (res === 'ok') return;
  const st = s.u[cmd];
  st.hex = -1;
  st.out = res;
  if (res === 'light') st.back = s.turn + 2;
  if (res === 'dead') for (let i = 0; i < U.length; i++) if (alive(s, i) && isCombat(i) && commands(U[cmd], U[i]) && !isArt(i)) s.u[i].dem = true;
}

function resolve(s: State, att: number[], def: number, rng: Rng, ev: Event[]) {
  const o = odds(s, att, def);
  const roll = rng.int(6) + 1;
  const res = CRT[roll - 1][crtCol(o.diff)];
  const dh = s.u[def].hex;
  const log: CombatLog = { att: att.slice(), def, a: o.a, d: o.d, diff: o.diff, roll, res };
  s.last = { combat: log };
  ev.push({ type: 'combat', log, a: o.a, d: o.d });
  for (const i of att) s.u[i].attacked = true;
  // командующие, участвовавшие в бою
  const cmds = new Set<number>();
  for (const i of att) {
    const L = leader(s, i);
    if (L >= 0) cmds.add(L);
  }
  const dl = leader(s, def);
  if (dl >= 0) cmds.add(dl);
  const adj = att.filter((i) => dist(s.u[i].hex, dh) === 1);
  const attHexes = adj.map((i) => s.u[i].hex);
  let vacated = false;
  if (res === 'А1' || res === 'А2') {
    for (const i of adj) mustRetreat(s, i, res === 'А1' ? 1 : 2, [dh], rng, ev);
  } else if (res === 'АУ') {
    for (const i of adj) destroy(s, i, ev);
  } else if (res === 'З1' || res === 'З2') {
    const r = mustRetreat(s, def, res === 'З1' ? 1 : 2, attHexes.length ? attHexes : att.map((i) => s.u[i].hex), rng, ev);
    if (r !== 'held') {
      s.beaten.push(def);
      vacated = true;
    }
  } else if (res === 'ЗУ') {
    if (!isArt(def) || adj.length) {
      destroy(s, def, ev);
      vacated = true;
    }
  } else {
    // * — уничтожены защищающийся и одна атакующая часть: самая слабая из тех, что не слабее защитника
    const ds = strengthOf(s, def);
    destroy(s, def, ev);
    vacated = true;
    const pool = adj.length ? adj : att;
    const strong = pool.filter((i) => U[i].str >= ds).sort((x, y) => U[x].str - U[y].str);
    const victim = strong[0] ?? pool.slice().sort((x, y) => U[y].str - U[x].str)[0];
    if (victim != null) destroy(s, victim, ev);
  }
  if (s.cfg.wounds) for (const c of cmds) if (alive(s, c)) woundCheck(s, c, rng, ev);
  captures(s, ev);
  // преследование: одна из победивших частей (не артиллерия) может занять освободившуюся клетку
  if (vacated && unitAt(s, dh) < 0) {
    const units = adj.filter((i) => alive(s, i) && !isArt(i) && dist(s.u[i].hex, dh) === 1);
    if (units.length) {
      s.pursuit = { hex: dh, units };
      s.phase = 'pursue';
    }
  }
}

/** Части стороны, обязанные атаковать (в зоне контроля врага, атака возможна). */
export function obliged(s: State): number[] {
  const out: number[] = [];
  for (let i = 0; i < U.length; i++) {
    if (side(i) !== s.side || !alive(s, i) || !isCombat(i) || isArt(i) || s.u[i].attacked || s.u[i].dem) continue;
    const h = s.u[i].hex;
    for (const m of neighbors(h)) {
      const e = unitAt(s, m);
      if (e < 0 || side(e) === s.side || !zocInto(s, e, h) || !canTarget(s, e)) continue;
      if (canJoin(s, i, e) === null) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

// ---------- расстановка (гипотетический сценарий) ----------

const LINE = ['1311', '1915', '2017', '1827'].map((l) => center(byLabel(l)));
/** Русским — восточнее линии Бородино — редут Раевского — Семёновская — Утица. */
export function russianZone(h: number): boolean {
  const p = center(h);
  let x = LINE[0].x;
  if (p.y >= LINE[LINE.length - 1].y) x = LINE[LINE.length - 1].x;
  else
    for (let k = 0; k < LINE.length - 1; k++) {
      const a = LINE[k];
      const b = LINE[k + 1];
      if (p.y >= a.y && p.y <= b.y) x = a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1);
    }
  return p.x >= x - 1;
}
export function deployOk(s: State, i: number, h: number): boolean {
  if (!exists(h)) return false;
  if (isCombat(i) && at(s, h).some((j) => j !== i && isCombat(j))) return false;
  if (U[i].kind === 'art' && (isForest(h) || isShrub(h))) return false;
  if (side(i) === RU) return russianZone(h);
  for (let j = 0; j < U.length; j++) if (side(j) === RU && isCombat(j) && alive(s, j) && dist(s.u[j].hex, h) < 6) return false;
  return true;
}
/** Поставить части вне зоны на ближайшие подходящие клетки. */
function fixDeploy(s: State, sd: number) {
  for (let i = 0; i < U.length; i++) {
    if (side(i) !== sd || deployOk(s, i, s.u[i].hex)) continue;
    let best = -1;
    let bd = Infinity;
    for (let h = 0; h < N; h++) {
      if (!exists(h) || !deployOk(s, i, h)) continue;
      const d = dist(h, s.u[i].hex);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best >= 0) s.u[i].hex = best;
  }
}

// ---------- ход ----------

export function apply(s0: State, sd: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || sd !== s0.side) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'deploy': {
      if (s.phase !== 'deploy' || side(a.u) !== sd || !deployOk(s, a.u, a.to)) return null;
      const from = s.u[a.u].hex;
      s.u[a.u].hex = a.to;
      // командующие, стоявшие с частью, переходят с ней
      if (isCombat(a.u)) for (const j of at(s0, from)) if (U[j].kind === 'cmd' && side(j) === sd) s.u[j].hex = a.to;
      ev.push({ type: 'move', u: a.u, path: [from, a.to] });
      break;
    }
    case 'ready': {
      if (s.phase !== 'deploy') return null;
      fixDeploy(s, sd);
      if (sd === RU) {
        s.side = FR;
        fixDeploy(s, FR);
        ev.push({ type: 'phase', side: FR, phase: 'deploy', turn: 0 });
      } else {
        s.side = FR;
        startPhase(s, ev);
      }
      break;
    }
    case 'rally': {
      if (s.phase !== 'rally') return null;
      const rolls: { u: number; roll: number; ok: boolean }[] = [];
      for (let i = 0; i < U.length; i++) {
        if (side(i) !== sd || !alive(s, i) || !s.u[i].dem || isArt(i) || !isCombat(i)) continue;
        const roll = rng.int(6) + 1;
        const bonus = leader(s, i) >= 0 ? 1 : 0;
        const ok = roll + bonus >= RALLY[U[i].nat];
        if (ok) {
          s.u[i].dem = false;
          s.u[i].mp = U[i].mp;
        }
        rolls.push({ u: i, roll, ok });
      }
      ev.push({ type: 'rally', side: s.side, rolls });
      s.phase = 'move';
      break;
    }
    case 'wheels': {
      if (s.phase !== 'move' || side(a.u) !== sd || !isArt(a.u) || !alive(s, a.u)) return null;
      const st = s.u[a.u];
      if (!st.dem) {
        if (st.moved) return null;
        st.dem = true;
        st.mp = U[a.u].mp2 - 2;
      } else {
        st.dem = false;
        st.mp = 0;
        st.moved = true;
      }
      ev.push({ type: 'wheels', u: a.u, on: st.dem });
      break;
    }
    case 'move': {
      if (s.phase !== 'move' || side(a.u) !== sd || s.u[a.u].moved) return null;
      const r = reach(s, a.u);
      if (!r.has(a.to)) return null;
      const path = pathTo(r, a.to);
      const from = s.u[a.u].hex;
      s.u[a.u].hex = a.to;
      s.u[a.u].moved = true;
      s.u[a.u].mp = 0;
      s.last = { move: [from, a.to] };
      ev.push({ type: 'move', u: a.u, path });
      captures(s, ev);
      break;
    }
    case 'endMove': {
      if (s.phase !== 'move') return null;
      s.phase = 'combat';
      ev.push({ type: 'phase', side: s.side, phase: 'combat', turn: s.turn });
      break;
    }
    case 'attack': {
      if (s.phase !== 'combat' || !canTarget(s, a.def)) return null;
      const att = [...new Set(a.att)];
      if (!att.length || att.some((i) => canJoin(s, i, a.def) !== null)) return null;
      resolve(s, att, a.def, rng, ev);
      break;
    }
    case 'pursue': {
      if (s.phase !== 'pursue' || !s.pursuit) return null;
      if (a.u != null) {
        if (!s.pursuit.units.includes(a.u) || !alive(s, a.u) || unitAt(s, s.pursuit.hex) >= 0) return null;
        const from = s.u[a.u].hex;
        for (const j of at(s, from)) if (j === a.u || (U[j].kind === 'cmd' && side(j) === sd)) s.u[j].hex = s.pursuit.hex;
        ev.push({ type: 'pursue', u: a.u, to: s.pursuit.hex });
        captures(s, ev);
      }
      s.pursuit = null;
      s.phase = 'combat';
      break;
    }
    case 'endCombat': {
      if (s.phase !== 'combat' || obliged(s).length) return null;
      nextPhase(s, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

/** Ход по часам: 1 → «06:00». */
export const clock = (turn: number) => {
  const m = 6 * 60 + (turn - 1) * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
