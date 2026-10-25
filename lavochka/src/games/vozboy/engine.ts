/* «Воздушный бой» — движок для обеих версий (материалы и решения — docs/analysis/materials-vozboy.md). Без DOM.
 *
 * Самолёты стоят на узлах сетки и смотрят в одну из четырёх сторон. Ход — последовательность «шагов»: L/R — поворот
 * на 90° на месте, F — на узел вперёд. Через занятые узлы не летают; последний шаг может прийтись на узел самолёта
 * противника — это удар: в бок и в хвост бьёт любой, в лоб — только бомбардировщик истребителя.
 *
 * А «Игрушка»: ходит один самолёт любого типа и делает одну операцию из листка (бомбардировщик — 2 прямо / 2 поворота /
 * поворот и 1 вперёд; истребитель — 3 прямо / 3 поворота / 2 поворота и 1 / поворот и 2), сначала повороты.
 * Взлёт — только прямо; на аэродроме самолёт уязвим со всех сторон. Пролёт над чужой ракетной установкой — сбит,
 * над огневой точкой — сбит, если зашёл не с её тыла (тыл — сторона её хозяина: у синих — запад и юг). Штаб разбомблен,
 * когда над ним пролетит бомбардировщик. Победа — штаб или все бомбардировщики и 8 истребителей соперника.
 * Б «Аэрофото»: за ход — один истребитель (до 3 шагов) и один бомбардировщик (до 2), шаги в любом порядке. Зенитка
 * обстреливает свой узел и узлы слева, сверху, слева-сверху (как видит хозяин) — сбит, если ход там закончился.
 * Победа — бомбардировщик встал на штаб или у соперника не осталось самолётов. */
import type { Options } from '../../core/types';
import { AEROFOTO_MAP, IGRUSHKA_MAP, type MapDef } from './maps';

export type Dir = 'n' | 'e' | 's' | 'w';
export const DIRS: Dir[] = ['n', 'e', 's', 'w'];
const DV: Record<Dir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const LEFT: Record<Dir, Dir> = { n: 'w', w: 's', s: 'e', e: 'n' };
const RIGHT: Record<Dir, Dir> = { n: 'e', e: 's', s: 'w', w: 'n' };
const OPP: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };

export type Kind = 'b' | 'f';
export type Ver = 'a' | 'b';

export interface Plane {
  id: number;
  side: number;
  kind: Kind;
  p: number;
  dir: Dir;
  /** Взлетел (в версии А на аэродроме самолёт уязвим со всех сторон и взлетает только прямо). */
  up: boolean;
}

export interface Cfg {
  ver: Ver;
}
export function cfgFrom(o: Options): Cfg {
  return { ver: o.ver === 'b' ? 'b' : 'a' };
}

export function mapOf(ver: Ver): MapDef {
  return ver === 'b' ? AEROFOTO_MAP : IGRUSHKA_MAP;
}

/** Ничья, если столько ходов сторон подряд никого не сбили. */
export const QUIET = 120;

export interface State {
  cfg: Cfg;
  players: number;
  planes: Plane[];
  /** Чья сторона ходит. */
  side: number;
  /** А вчетвером: чей черёд внутри стороны (0 — бомбардировщики, 1 — истребители), по кругу. */
  ring: number;
  /** Б: какие типы сторона уже сдвинула в этот ход. */
  moved: Kind[];
  over: boolean;
  winner: number | null;
  why: '' | 'hq' | 'planes' | 'stuck' | 'quiet';
  /** Потери: [сторона] → { b, f }. */
  lost: [{ b: number; f: number }, { b: number; f: number }];
  quiet: number;
  turns: number;
  /** Последний полёт (узлы) — для подсветки. */
  path: number[];
}

export type Action = { type: 'fly'; id: number; seq: string };

export type Event =
  | { type: 'fly'; seat: number; id: number; kind: Kind; seq: string; path: { p: number; dir: Dir }[]; took: Plane | null; shot: number; hq: boolean }
  | { type: 'end'; winner: number | null; why: State['why'] };

export const cell = (m: MapDef, c: number, r: number) => r * m.w + c;

/** Место, которое командует таким типом стороны: вдвоём — сторона, вчетвером — 0/1 бомбардировщики, 2/3 истребители. */
export function seatOf(s: State, side: number, kind: Kind): number {
  return s.players === 4 && kind === 'f' ? side + 2 : side;
}
export function sideOf(seat: number): number {
  return seat % 2;
}

export function newState(cfg: Cfg, players: number): State {
  const m = mapOf(cfg.ver);
  const planes: Plane[] = [];
  let id = 0;
  m.sides.forEach((sd, side) => {
    for (const [c, r] of sd.bombers) planes.push({ id: id++, side, kind: 'b', p: cell(m, c, r), dir: sd.face, up: false });
    for (const [c, r] of sd.fighters) planes.push({ id: id++, side, kind: 'f', p: cell(m, c, r), dir: sd.face, up: false });
  });
  return {
    cfg,
    players,
    planes,
    side: 0,
    ring: 0,
    moved: [],
    over: false,
    winner: null,
    why: '',
    lost: [
      { b: 0, f: 0 },
      { b: 0, f: 0 },
    ],
    quiet: 0,
    turns: 0,
    path: [],
  };
}

export const setup = (opts: Options, players: number) => newState(cfgFrom(opts), players);

/** Операции версии А: T — поворот (L или R), F — вперёд; сначала повороты. */
const OPS_A: Record<Kind, string[]> = { b: ['FF', 'TT', 'TF'], f: ['FFF', 'TTT', 'TTF', 'TFF'] };

function expand(pattern: string): string[] {
  let out = [''];
  for (const ch of pattern) out = ch === 'T' ? out.flatMap((x) => [x + 'L', x + 'R']) : out.map((x) => x + 'F');
  return out;
}

const SEQ_A: Record<Kind, string[]> = { b: OPS_A.b.flatMap(expand), f: OPS_A.f.flatMap(expand) };

function allSeqs(max: number): string[] {
  let level = [''];
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    level = level.flatMap((x) => [x + 'L', x + 'R', x + 'F']);
    out.push(...level);
  }
  return out;
}
const SEQ_B: Record<Kind, string[]> = { b: allSeqs(2), f: allSeqs(3) };

export function seqsFor(ver: Ver, pl: Plane): string[] {
  if (ver === 'b') return SEQ_B[pl.kind];
  return pl.up ? SEQ_A[pl.kind] : [pl.kind === 'b' ? 'FF' : 'FFF'];
}

/** Можно ли ударить: dir — куда летит нападающий. */
export function canHit(att: Plane, dir: Dir, vic: Plane, ver: Ver): boolean {
  if (ver === 'a' && !vic.up) return true;
  if (dir === OPP[vic.dir]) return att.kind === 'b' && vic.kind === 'f';
  return true;
}

/** Обстреливает ли чужая зенитка узел (версия Б: по окончании хода). */
function zoneB(m: MapDef, side: number, c: number, r: number): boolean {
  const enemy = m.sides[1 - side];
  // «слева» и «сверху» — как видит хозяин зенитки: у нижней стороны (0) — запад и север, у верхней — восток и юг
  const dx = 1 - side === 0 ? -1 : 1;
  const dy = 1 - side === 0 ? -1 : 1;
  return enemy.guns.some((gn) => (c === gn.c || c === gn.c + dx) && (r === gn.r || r === gn.r + dy));
}

/** Версия А: сбит ли самолёт стороны side, влетевший на узел (c, r) в направлении dir. */
function overGunA(m: MapDef, side: number, c: number, r: number, dir: Dir): boolean {
  const owner = 1 - side;
  const gn = m.sides[owner].guns.find((x) => x.c === c && x.r === r);
  if (!gn) return false;
  if (gn.rocket) return true;
  // тыл огневой точки — сторона её хозяина: у синих (0) самолёт, летящий на восток или север, зашёл сзади
  const rear: Dir[] = owner === 0 ? ['e', 'n'] : ['w', 's'];
  return !rear.includes(dir);
}

export interface Flight {
  a: Action;
  path: { p: number; dir: Dir }[];
  end: number;
  dir: Dir;
  took: Plane | null;
  /** Узел, где сбит (−1 — цел). */
  shot: number;
  hq: boolean;
}

/** Полёт самолёта по последовательности шагов; null — так нельзя. */
export function fly(s: State, pl: Plane, seq: string): Flight | null {
  const m = mapOf(s.cfg.ver);
  const ver = s.cfg.ver;
  let p = pl.p;
  let dir = pl.dir;
  const path = [{ p, dir }];
  let took: Plane | null = null;
  let shot = -1;
  let hq = false;
  const enemyHq = cell(m, ...m.sides[1 - pl.side].hq);
  for (let i = 0; i < seq.length; i++) {
    const ch = seq[i];
    if (ch === 'L') dir = LEFT[dir];
    else if (ch === 'R') dir = RIGHT[dir];
    else {
      const [dx, dy] = DV[dir];
      const c = (p % m.w) + dx;
      const r = Math.floor(p / m.w) + dy;
      if (c < 0 || c >= m.w || r < 0 || r >= m.h) return null;
      const q = r * m.w + c;
      const t = s.planes.find((x) => x.p === q);
      if (t) {
        if (t.side === pl.side || i !== seq.length - 1 || !canHit(pl, dir, t, ver)) return null;
        took = t;
      }
      p = q;
      if (ver === 'a') {
        if (pl.kind === 'b' && q === enemyHq) hq = true;
        if (overGunA(m, pl.side, c, r, dir)) {
          shot = q;
          path.push({ p, dir });
          break;
        }
        if (hq) {
          path.push({ p, dir });
          break;
        }
      }
    }
    path.push({ p, dir });
  }
  if (ver === 'b') {
    if (pl.kind === 'b' && p === enemyHq) hq = true;
    else if (zoneB(m, pl.side, p % m.w, Math.floor(p / m.w))) shot = p;
  }
  return { a: { type: 'fly', id: pl.id, seq }, path, end: p, dir, took, shot, hq };
}

function allowedKinds(s: State): Kind[] {
  const side = s.side;
  const has = (k: Kind) => flightsOfKind(s, side, k).length > 0;
  if (s.cfg.ver === 'a') {
    if (s.players !== 4) return ['b', 'f'];
    const k: Kind = s.ring === 0 ? 'b' : 'f';
    return has(k) ? [k] : [k === 'b' ? 'f' : 'b'];
  }
  const left = (['f', 'b'] as Kind[]).filter((k) => !s.moved.includes(k) && has(k));
  if (s.players === 4) return left.slice(0, 1);
  return left;
}

function flightsOfKind(s: State, side: number, k: Kind): Flight[] {
  const out: Flight[] = [];
  for (const pl of s.planes) if (pl.side === side && pl.kind === k) for (const q of seqsFor(s.cfg.ver, pl)) {
    const f = fly(s, pl, q);
    if (f) out.push(f);
  }
  return out;
}

export function toAct(s: State): number[] {
  if (s.over) return [];
  const kinds = allowedKinds(s);
  if (!kinds.length) return [];
  // вчетвером ходит командир того типа, что сейчас летит (без своих самолётов его черёд берёт напарник — см. allowedKinds)
  return [s.players === 4 ? seatOf(s, s.side, kinds[0]) : s.side];
}

/** Все полёты места, без повторов по итогу (узел, курс, исход). */
export function flights(s: State, seat: number): Flight[] {
  const out: Flight[] = [];
  const seen = new Set<string>();
  const kinds = allowedKinds(s);
  if (!toAct(s).includes(seat)) return out;
  for (const pl of s.planes) {
    if (pl.side !== s.side || !kinds.includes(pl.kind)) continue;
    for (const q of seqsFor(s.cfg.ver, pl)) {
      const f = fly(s, pl, q);
      if (!f) continue;
      const key = `${pl.id}:${f.end}:${f.dir}:${f.shot}:${f.took ? f.took.id : -1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

export function legal(s: State, seat: number): Action[] {
  return flights(s, seat).map((f) => f.a);
}

function end(s: State, winner: number | null, why: State['why'], events: Event[]) {
  s.over = true;
  s.winner = winner;
  s.why = why;
  events.push({ type: 'end', winner, why });
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || !a || a.type !== 'fly' || typeof a.seq !== 'string') return null;
  if (!toAct(s0).includes(seat)) return null;
  const pl0 = s0.planes.find((x) => x.id === a.id);
  if (!pl0 || pl0.side !== s0.side || !allowedKinds(s0).includes(pl0.kind)) return null;
  if (!seqsFor(s0.cfg.ver, pl0).includes(a.seq)) return null;
  const f = fly(s0, pl0, a.seq);
  if (!f) return null;
  const s: State = { ...s0, planes: s0.planes.map((x) => ({ ...x })), moved: [...s0.moved], lost: [{ ...s0.lost[0] }, { ...s0.lost[1] }] };
  const pl = s.planes.find((x) => x.id === a.id)!;
  const events: Event[] = [{ type: 'fly', seat, id: pl.id, kind: pl.kind, seq: a.seq, path: f.path, took: f.took, shot: f.shot, hq: f.hq }];
  const moved = f.end !== pl.p;
  pl.p = f.end;
  pl.dir = f.dir;
  if (moved) pl.up = true;
  if (f.took) {
    s.planes = s.planes.filter((x) => x.id !== f.took!.id);
    s.lost[f.took.side][f.took.kind]++;
  }
  if (f.shot >= 0) {
    s.planes = s.planes.filter((x) => x.id !== pl.id);
    s.lost[pl.side][pl.kind]++;
  }
  s.path = f.path.map((x) => x.p);
  const side = s.side;
  const op = 1 - side;
  if (f.hq && f.shot < 0) {
    end(s, side, 'hq', events);
    return { state: s, events };
  }
  const total = (sd: number) => s.planes.filter((x) => x.side === sd).length;
  if (s.cfg.ver === 'a') {
    if (s.lost[op].b >= 6 && s.lost[op].f >= 8) {
      end(s, side, 'planes', events);
      return { state: s, events };
    }
    if (s.lost[side].b >= 6 && s.lost[side].f >= 8) {
      end(s, op, 'planes', events);
      return { state: s, events };
    }
  } else {
    if (!total(op)) {
      end(s, side, 'planes', events);
      return { state: s, events };
    }
    if (!total(side)) {
      end(s, op, 'planes', events);
      return { state: s, events };
    }
  }
  const hit = !!f.took || f.shot >= 0;
  // смена хода
  if (s.cfg.ver === 'b') {
    s.moved.push(pl0.kind);
    if (!hit) s.quiet++;
    else s.quiet = 0;
    if (allowedKinds(s).length) return { state: s, events };
  } else s.quiet = hit ? 0 : s.quiet + 1;
  s.side = op;
  s.moved = [];
  s.turns++;
  if (s.players === 4 && s.cfg.ver === 'a' && op === 0) s.ring = 1 - s.ring;
  if (s.quiet >= QUIET * (s.cfg.ver === 'b' ? 2 : 1)) end(s, null, 'quiet', events);
  else if (!allowedKinds(s).length) end(s, side, 'stuck', events);
  return { state: s, events };
}
