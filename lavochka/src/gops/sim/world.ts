/* Мир партии ГОПС и его шаг step(world, input) — 60 раз в секунду. Детерминированно (CODE.md §2):
 * один и тот же мир + один и тот же поток ввода → один и тот же мир на любой машине.
 *
 * Ход: 'turn' (боец под управлением, таймер) → выстрел → 'retreat' (ещё можно отбежать) → 'settle' (ждём,
 * пока всё упадёт и взорвётся) → выбывшие сдуваются, остаются кепки → следующая бригада. */
import { type Body, GRAVITY, free, stepBody } from './body';
import { ANG_FULL, ONE, fromAngle, len, toPx, trunc } from './fx';
import type { Mask } from './mask';
import { Rng } from './rng';
import { WEAPONS } from './weapons';
import { WORM_R, type Worm, type WormEvent, jump, makeWorm, tickWorm, walk } from './worm';

export const TICK_HZ = 60;
/** Предел наклона прицела от горизонтали (≈ 84°). */
export const AIM_MAX = 960;
const AIM_STEP = 12;
/** Полная сила набирается за 1,5 с, на максимуме выстрел уходит сам. */
export const CHARGE_MAX = 90;
/** Ветер: ускорение Q8 за кадр² = ветер (−100…100) · WIND_K / 100. */
const WIND_K = 12;
/** Верёвка: длина от 16 px до дальности крюка, подтягивание и раскачка — Q8 за кадр. */
const ROPE_MIN = 16 * ONE;
const ROPE_REEL = 2 * ONE;
const ROPE_PUSH = 14;
/** Дольше этого «оседание» не ждём (10 с). */
const SETTLE_MAX = 600;

export interface Scheme {
  /** Время хода и отхода, с. */
  turnTime: number;
  retreat: number;
  /** Наибольшая сила ветра 0…1. */
  wind: number;
  /** Урон от падения, % (0…100). */
  fallDamage: number;
  /** Время раунда, с; после него — внезапная смерть: жидкость поднимается каждый ход на riseStep px. */
  roundTime: number;
  riseStep: number;
  /** Вероятность ящика перед ходом, % (0…100). */
  crates: number;
}

export const DEFAULT_SCHEME: Scheme = { turnTime: 45, retreat: 3, wind: 1, fallDamage: 100, roundTime: 600, riseStep: 24, crates: 60 };

export interface Team {
  id: number;
  /** id бойцов бригады по порядку. */
  worms: number[];
  /** Чей был последний ход (индекс в worms). */
  last: number;
  /** Запас оружия: −1 — бесконечно. */
  ammo: Record<string, number>;
}

export type ProjState = 'fly' | 'idle' | 'armed' | 'fuse';

export interface Proj extends Body {
  id: number;
  weapon: string;
  owner: number;
  /** Кадров до взрыва; −1 — нет таймера. */
  fuse: number;
  state: ProjState;
  age: number;
}

export type CrateKind = 'weapon' | 'health' | 'util';

/** Ящик: падает медленно (зонт/шарики/простыня), подбирается касанием бойца. */
export interface Crate {
  id: number;
  x: number;
  y: number;
  vy: number;
  kind: CrateKind;
  /** id оружия или утилиты; у аптечки — сколько здоровья. */
  content: string;
  falling: boolean;
}

/** Что бывает в ящиках (только то, что есть в WEAPONS). */
export const CRATE_WEAPONS = ['mukha', 'limonka', 'sling', 'obrez', 'tnt', 'mine', 'armatura'];
export const CRATE_UTILS = ['rope'];
const CRATE_R = 8;
const CRATE_FALL = 200;
const HEALTH = 25;

/** Кепка выбывшего на месте, где он сдулся. */
export interface Cap {
  x: number;
  y: number;
  team: number;
}

export type Phase = 'turn' | 'retreat' | 'settle' | 'over';

export type SimEvent =
  | { t: 'turn'; team: number; worm: number }
  | { t: 'fire'; weapon: string; worm: number }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'shot'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'hit'; worm: number; dmg: number }
  | { t: 'bounce'; proj: number }
  | { t: 'splash'; x: number }
  | { t: 'drown'; worm: number }
  | { t: 'deflate'; worm: number }
  | { t: 'land'; worm: number }
  | { t: 'rise'; y: number }
  | { t: 'rope'; x: number; y: number }
  | { t: 'crate-drop'; x: number; kind: CrateKind }
  | { t: 'crate'; worm: number; kind: CrateKind; content: string }
  | { t: 'unrope'; worm: number }
  | { t: 'over'; winner: number };

export interface World {
  tick: number;
  mask: Mask;
  rng: Rng;
  /** Верх смертельной жидкости, px. */
  waterY: number;
  scheme: Scheme;
  /** Ветер −100…100 (вправо — плюс). */
  wind: number;
  worms: Worm[];
  teams: Team[];
  projs: Proj[];
  crates: Crate[];
  caps: Cap[];
  nextId: number;
  phase: Phase;
  /** Кадров до конца фазы. */
  left: number;
  team: number;
  /** id активного бойца. */
  active: number;
  /** Прицел: наклон от горизонтали в сторону взгляда, −AIM_MAX (вверх) … AIM_MAX (вниз). */
  aim: number;
  weapon: string;
  /** Таймер гранат, с (1…5). */
  fuse: number;
  charge: number;
  /** Осталось выстрелов этим оружием в этот ход. */
  shots: number;
  /** Кнопка огня была нажата в прошлом кадре. */
  firePrev: boolean;
  /** Здоровье активного бойца в начале хода — ранен в свой ход → ход окончен. */
  hpAtTurn: number;
  winner: number;
  /** Кадров до внезапной смерти (идёт только в ходы, как в жанре). */
  roundLeft: number;
  /** Крюк верёвки активного бойца (Q8) и длина; null — не висит. */
  rope: { ax: number; ay: number; len: number } | null;
  /** Верёвку в этот ход уже брали (запас списывается раз за ход, цепочка крюков — бесплатно). */
  ropeUsed: boolean;
  events: SimEvent[];
}

/** Ввод одного кадра: от человека, бота или сети. */
export interface Input {
  move?: -1 | 0 | 1;
  aim?: -1 | 0 | 1;
  /** 1 — прыжок вперёд, 2 — сальто назад. */
  jump?: 0 | 1 | 2;
  /** Огонь: состояние кнопки (держит/отпустил). */
  fire?: boolean;
  weapon?: string;
  fuse?: number;
}

export interface WorldSetup {
  mask: Mask;
  waterY: number;
  seed: number;
  scheme?: Scheme;
  /** Бригады: точки высадки (px, по поверхности), здоровье, запас. */
  teams: { spawns: [number, number][]; hp: number; ammo: Record<string, number> }[];
}

export function createWorld(s: WorldSetup): World {
  const w: World = {
    tick: 0, mask: s.mask, rng: new Rng(s.seed), waterY: s.waterY, scheme: s.scheme ?? DEFAULT_SCHEME,
    wind: 0, worms: [], teams: [], projs: [], crates: [], caps: [], nextId: 1, phase: 'settle', left: SETTLE_MAX,
    team: s.teams.length - 1, active: -1, aim: -128, weapon: 'mukha', fuse: 3, charge: 0, shots: 0,
    firePrev: false, hpAtTurn: 0, winner: -1, roundLeft: 0, rope: null, ropeUsed: false, events: [],
  };
  w.roundLeft = w.scheme.roundTime * TICK_HZ;
  s.teams.forEach((t, ti) => {
    const team: Team = { id: ti, worms: [], last: -1, ammo: { ...t.ammo } };
    for (const [x, y] of t.spawns) {
      const worm = makeWorm(w.nextId++, ti, x, y - WORM_R - 2, t.hp);
      worm.facing = x < s.mask.w / 2 ? 1 : -1;
      w.worms.push(worm);
      team.worms.push(worm.id);
    }
    w.teams.push(team);
  });
  return w;
}

export const wormById = (w: World, id: number): Worm | undefined => w.worms.find((x) => x.id === id);
const alive = (x: Worm) => x.state !== 'dead';

/** Направление прицела в мировой угол (0 — вправо, по часовой, y вниз). */
export function aimAngle(w: World, worm: Worm): number {
  return worm.facing === 1 ? (w.aim + ANG_FULL) % ANG_FULL : (ANG_FULL / 2 - w.aim + ANG_FULL) % ANG_FULL;
}

/** Один кадр мира. События кадра — в w.events (очищаются в начале шага). */
export function step(w: World, input: Input): void {
  w.events = [];
  w.tick++;
  const worm = wormById(w, w.active);
  if (w.phase === 'turn' || w.phase === 'retreat') {
    if (worm && alive(worm)) control(w, worm, input, w.phase === 'turn');
    if (w.roundLeft > 0) w.roundLeft--;
    if (--w.left <= 0) {
      w.phase = 'settle';
      w.left = SETTLE_MAX;
    }
  }
  w.firePrev = !!input.fire;
  if (worm && worm.state === 'rope') {
    if (w.phase === 'turn' || w.phase === 'retreat') tickRope(w, worm, input);
    else unrope(w, worm);
  }

  const wev: WormEvent[] = [];
  for (const x of w.worms) tickWorm(x, w.mask, w.waterY, wev);
  for (const e of wev) {
    if (e.kind === 'fall-damage') {
      const x = wormById(w, e.id)!;
      const extra = trunc((e.value! * (100 - w.scheme.fallDamage)) / 100);
      x.hp += extra; // схема уменьшает урон от падения: вернуть лишнее
      x.bounce = 0;
      if (e.value! - extra > 0) w.events.push({ t: 'hit', worm: e.id, dmg: e.value! - extra });
    } else if (e.kind === 'drown') {
      w.events.push({ t: 'drown', worm: e.id }, { t: 'splash', x: toPx(wormById(w, e.id)!.x) });
    } else if (e.kind === 'land') {
      wormById(w, e.id)!.bounce = 0;
      w.events.push({ t: 'land', worm: e.id });
    }
  }
  tickProjs(w);
  tickCrates(w);

  // ранен в свой ход — ход окончен
  if ((w.phase === 'turn' || w.phase === 'retreat') && worm && (worm.hp < w.hpAtTurn || !alive(worm))) {
    w.phase = 'settle';
    w.left = SETTLE_MAX;
  }
  if (w.phase === 'settle') {
    if (calm(w) || --w.left <= 0) endTurn(w);
  }
}

/** Всё успокоилось: никто не летит, снарядов в полёте нет, мины не тикают. */
function calm(w: World): boolean {
  for (const x of w.worms) if (x.state === 'air' || x.state === 'rope') return false;
  for (const p of w.projs) if (p.state === 'fly' || p.state === 'fuse') return false;
  return true;
}

function control(w: World, worm: Worm, inp: Input, canFire: boolean): void {
  const team = w.teams[w.team];
  const fresh = w.shots === (WEAPONS[w.weapon]?.shots ?? 1); // после первого выстрела обреза оружие не меняют
  if (canFire && fresh && inp.weapon && inp.weapon !== w.weapon && WEAPONS[inp.weapon] && (team.ammo[inp.weapon] ?? 0) !== 0 && w.charge === 0) {
    w.weapon = inp.weapon;
    w.shots = WEAPONS[inp.weapon].shots ?? 1;
  }
  if (inp.fuse && inp.fuse >= 1 && inp.fuse <= 5) w.fuse = inp.fuse | 0;
  if (worm.state === 'rope') {
    // на верёвке: ↑/↓ — длина, ←/→ — раскачка (в tickRope), прыжок — отцепиться, огонь — новый крюк
    if (inp.move) worm.facing = inp.move;
    if (inp.jump) unrope(w, worm);
    else if (canFire && inp.fire && !w.firePrev && WEAPONS[w.weapon]?.kind === 'rope') fire(w, worm);
    return;
  }
  if (inp.aim) w.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, w.aim + inp.aim * AIM_STEP));
  if (worm.state === 'stand' && w.charge === 0) {
    if (inp.jump) jump(worm, inp.jump === 2);
    else if (inp.move) walk(worm, w.mask, inp.move, []);
  }
  if (!canFire) return;
  const def = WEAPONS[w.weapon];
  if (!def || (worm.state !== 'stand' && !(def.kind === 'rope' && worm.state === 'air'))) return;
  if (def.charged) {
    if (inp.fire) w.charge++;
    if ((w.firePrev && !inp.fire && w.charge > 0) || w.charge >= CHARGE_MAX) fire(w, worm);
  } else if (inp.fire && !w.firePrev) fire(w, worm);
}

function fire(w: World, worm: Worm): void {
  const def = WEAPONS[w.weapon];
  const team = w.teams[w.team];
  const ammo = team.ammo[w.weapon] ?? 0;
  if (ammo === 0) return;
  const ang = aimAngle(w, worm);
  const wx = toPx(worm.x), wy = toPx(worm.y);
  if (def.kind === 'rope') {
    shootRope(w, worm, wx, wy, ang, def.range!);
    if (w.rope && !w.ropeUsed) {
      w.ropeUsed = true;
      if (ammo > 0) team.ammo[w.weapon] = ammo - 1;
    }
    return;
  }
  w.events.push({ t: 'fire', weapon: w.weapon, worm: worm.id });
  switch (def.kind) {
    case 'missile':
    case 'grenade':
    case 'stone': {
      const sp = trunc((def.speed! * Math.max(8, w.charge)) / CHARGE_MAX);
      const [vx, vy] = fromAngle(ang, sp);
      const [ox, oy] = fromAngle(ang, (WORM_R + 4) * ONE);
      spawnProj(w, def.kind === 'grenade' ? w.fuse * TICK_HZ : -1, worm, worm.x + ox, worm.y + oy, vx, vy);
      break;
    }
    case 'placed':
    case 'mine':
      spawnProj(w, def.kind === 'placed' ? def.fuse! * TICK_HZ : -1, worm, worm.x + worm.facing * 6 * ONE, worm.y, 0, 0);
      break;
    case 'hitscan':
      shoot(w, worm, wx, wy, ang, def.range!);
      break;
    case 'melee':
      melee(w, worm, ang);
      break;
    case 'surrender':
      for (const id of team.worms) wormById(w, id)!.hp = 0;
      break;
    case 'skip':
      break;
  }
  w.charge = 0;
  w.shots--;
  if (ammo > 0 && (w.shots <= 0 || def.kind !== 'hitscan')) team.ammo[w.weapon] = ammo - 1;
  if (w.shots <= 0 || def.kind === 'skip' || def.kind === 'surrender') {
    const retreat = def.kind === 'skip' || def.kind === 'surrender' ? 0 : w.scheme.retreat * TICK_HZ;
    w.phase = retreat > 0 ? 'retreat' : 'settle';
    w.left = retreat > 0 ? retreat : SETTLE_MAX;
  }
}

function spawnProj(w: World, fuse: number, worm: Worm, x: number, y: number, vx: number, vy: number): void {
  const def = WEAPONS[w.weapon];
  w.projs.push({
    id: w.nextId++, weapon: w.weapon, owner: worm.id, x, y, vx, vy, r: def.r ?? 3,
    bounce: def.bounce ?? 0, slide: def.slide ?? 0, fuse, state: def.kind === 'mine' ? 'fly' : fuse >= 0 ? 'fuse' : 'fly', age: 0,
  });
}

function tickProjs(w: World): void {
  const windAcc = trunc((w.wind * WIND_K) / 100);
  for (const p of w.projs.slice()) {
    const def = WEAPONS[p.weapon];
    p.age++;
    if (p.state === 'idle' || p.state === 'armed') {
      // мина лежит: взводится через секунду, потом ждёт, кто подойдёт
      if (!free(w.mask, p.x, p.y + ONE, p.r)) {
        if (p.state === 'idle' && p.age > TICK_HZ) p.state = 'armed';
        if (p.state === 'armed' && w.worms.some((x) => alive(x) && len(toPx(x.x) - toPx(p.x), toPx(x.y) - toPx(p.y)) < 40)) {
          p.state = 'fuse';
          p.fuse = def.fuse! * TICK_HZ;
        }
        continue;
      }
      p.state = 'fly'; // земля ушла из-под мины
    }
    const px = p.x, py = p.y;
    const hit = stepBody(p, w.mask, undefined, def.wind ? windAcc : 0);
    if (toPx(p.y) > w.waterY) {
      w.events.push({ t: 'splash', x: toPx(p.x) });
      remove(w, p);
      continue;
    }
    if (toPx(p.x) < -200 || toPx(p.x) > w.mask.w + 200) {
      remove(w, p);
      continue;
    }
    // по бойцу — проверка вдоль пути за кадр (быстрый снаряд не проскакивает)
    const victim = p.age > 3 || def.kind === 'stone' ? wormOnPath(w, px, py, p.x, p.y, p.r, p.age <= 6 ? p.owner : -1) : undefined;
    if (def.kind === 'missile' && (hit || victim)) {
      explode(w, toPx(p.x), toPx(p.y), def.radius!, def.damage!);
      remove(w, p);
      continue;
    }
    if (def.kind === 'stone' && (hit || victim)) {
      if (victim) {
        const l = len(p.vx, p.vy) || 1;
        hurt(w, victim, def.damage!, trunc((p.vx * def.push!) / l), trunc((p.vy * def.push!) / l) - 300);
      }
      remove(w, p);
      continue;
    }
    if (hit && hit.speed > 200) w.events.push({ t: 'bounce', proj: p.id });
    if (def.kind === 'mine' && p.state === 'fly' && hit && Math.abs(p.vx) < 80 && Math.abs(p.vy) < 80) {
      p.vx = p.vy = 0;
      p.state = 'idle';
    }
    if (p.state === 'fuse' && --p.fuse <= 0) {
      explode(w, toPx(p.x), toPx(p.y), def.radius!, def.damage!);
      remove(w, p);
    }
  }
}

function remove(w: World, p: Proj): void {
  const i = w.projs.indexOf(p);
  if (i >= 0) w.projs.splice(i, 1);
}

/** Ближайший к началу пути боец, которого задевает отрезок (кроме skip). Целые, без переполнения точности. */
function wormOnPath(w: World, x0: number, y0: number, x1: number, y1: number, r: number, skip: number): Worm | undefined {
  const ax = toPx(x0), ay = toPx(y0), bx = toPx(x1), by = toPx(y1);
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const RR = (WORM_R + r) * (WORM_R + r);
  let best: Worm | undefined, bestT = Infinity;
  for (const x of w.worms) {
    if (!alive(x) || x.id === skip) continue;
    const px = toPx(x.x) - ax, py = toPx(x.y) - ay;
    const t = px * dx + py * dy;
    let hit: boolean;
    if (L === 0 || t <= 0) hit = px * px + py * py <= RR;
    else if (t >= L) hit = (px - dx) * (px - dx) + (py - dy) * (py - dy) <= RR;
    else {
      const cross = px * dy - py * dx;
      hit = cross * cross <= RR * L;
    }
    if (hit && t < bestT) {
      best = x;
      bestT = t;
    }
  }
  return best;
}

/** Урон и толчок бойцу: здоровье сразу, выбывание — в конце хода. */
function hurt(w: World, x: Worm, dmg: number, vx: number, vy: number): void {
  if (!alive(x)) return;
  if (dmg > 0) {
    x.hp = Math.max(0, x.hp - dmg);
    w.events.push({ t: 'hit', worm: x.id, dmg });
  }
  if (vx || vy) {
    if (x.state === 'rope') w.rope = null;
    x.vx += vx;
    x.vy += vy;
    x.state = 'air';
    x.bounce = 70;
    x.slide = 200;
  }
}

/** Взрыв: воронка, урон с убыванием к краю, толчок от центра. Мины рядом детонируют сразу. */
export function explode(w: World, cx: number, cy: number, r: number, damage: number): void {
  w.mask.carveCircle(cx, cy, r);
  w.events.push({ t: 'explode', x: cx, y: cy, r });
  const reach = r + WORM_R;
  for (const x of w.worms) {
    if (!alive(x)) continue;
    const dx = toPx(x.x) - cx, dy = toPx(x.y) - cy;
    const d = len(dx, dy);
    if (d >= reach) continue;
    const dmg = trunc((damage * (reach - d)) / reach);
    const kick = dmg * 28 + 300;
    // направление от центра, с подбросом вверх
    const ux = d === 0 ? 0 : trunc((dx * kick) / d);
    const uy = d === 0 ? -kick : trunc((dy * kick) / d) - trunc(kick / 3);
    hurt(w, x, dmg, ux, uy);
  }
  for (const c of w.crates.slice()) {
    if (len(toPx(c.x) - cx, toPx(c.y) - cy) >= r + CRATE_R) continue;
    w.crates.splice(w.crates.indexOf(c), 1);
    if (c.kind === 'weapon') {
      // ящик с оружием рвётся сам — маленький взрыв на его месте (в следующем кадре цепочки нет)
      w.events.push({ t: 'explode', x: toPx(c.x), y: toPx(c.y), r: 24 });
      w.mask.carveCircle(toPx(c.x), toPx(c.y), 24);
    }
  }
  for (const p of w.projs) {
    if (WEAPONS[p.weapon].kind !== 'mine' || p.state === 'fuse') continue;
    const d = len(toPx(p.x) - cx, toPx(p.y) - cy);
    if (d < r + 8) {
      p.state = 'fuse';
      p.fuse = 1 + (d >> 3); // цепочкой, с крошечной задержкой
    } else if (d < r * 2) {
      p.vy -= 400;
      p.state = 'fly';
    }
  }
}

/** Пуля: луч от бойца до земли или первого задетого бойца. */
function shoot(w: World, worm: Worm, wx: number, wy: number, ang: number, range: number): void {
  const def = WEAPONS[w.weapon];
  const [ex, ey] = fromAngle(ang, range * ONE);
  const [sx, sy] = fromAngle(ang, (WORM_R + 2) * ONE);
  const x0 = wx + toPx(sx), y0 = wy + toPx(sy);
  let x1 = wx + toPx(ex), y1 = wy + toPx(ey);
  const ground = w.mask.raycast(x0, y0, x1, y1);
  if (ground) [x1, y1] = ground;
  const victim = wormOnPath(w, x0 * ONE, y0 * ONE, x1 * ONE, y1 * ONE, 0, worm.id);
  if (victim) {
    x1 = toPx(victim.x);
    y1 = toPx(victim.y);
    const [px, py] = fromAngle(ang, def.push!);
    hurt(w, victim, def.damage!, px, py - 150);
  } else if (ground) {
    w.mask.carveCircle(x1, y1, def.radius!);
  }
  w.events.push({ t: 'shot', x0, y0, x1, y1 });
}

/** Удар перед собой: все бойцы в полукруге range по направлению прицела. */
function melee(w: World, worm: Worm, ang: number): void {
  const def = WEAPONS[w.weapon];
  const [fx, fy] = fromAngle(ang, def.range! * ONE);
  const cx = toPx(worm.x + fx), cy = toPx(worm.y + fy);
  for (const x of w.worms) {
    if (x === worm || !alive(x)) continue;
    if (len(toPx(x.x) - cx, toPx(x.y) - cy) > def.range!) continue;
    const [px, py] = fromAngle(ang, def.push!);
    hurt(w, x, def.damage!, px, py - 400);
  }
}

/** Ящик с неба над случайным местом суши (не над жидкостью). */
export function dropCrate(w: World, kind?: CrateKind, content?: string, xPx?: number): Crate | null {
  let x = xPx ?? -1;
  for (let tries = 0; x < 0 && tries < 20; tries++) {
    const cx = 40 + w.rng.below(w.mask.w - 80);
    const sy = w.mask.surfaceBelow(cx, 0);
    if (sy > 0 && sy < w.waterY - 10) x = cx;
  }
  if (x < 0) return null;
  const roll = w.rng.below(100);
  const k: CrateKind = kind ?? (roll < 50 ? 'weapon' : roll < 85 ? 'health' : 'util');
  const c: Crate = {
    id: w.nextId++, x: x * ONE, y: -20 * ONE, vy: 0, kind: k, falling: true,
    content: content ?? (k === 'weapon' ? CRATE_WEAPONS[w.rng.below(CRATE_WEAPONS.length)] : k === 'util' ? CRATE_UTILS[w.rng.below(CRATE_UTILS.length)] : String(HEALTH)),
  };
  w.crates.push(c);
  w.events.push({ t: 'crate-drop', x, kind: k });
  return c;
}

/** Ящики: медленное падение, приземление, подбор касанием, утонувший — пропал. */
function tickCrates(w: World): void {
  for (const c of w.crates.slice()) {
    if (c.falling || free(w.mask, c.x, c.y + ONE, CRATE_R)) {
      c.vy = Math.min(CRATE_FALL, c.vy + GRAVITY);
      const b: Body = { x: c.x, y: c.y, vx: 0, vy: c.vy, r: CRATE_R, bounce: 0, slide: 0 };
      const hit = stepBody(b, w.mask, 0);
      c.x = b.x;
      c.y = b.y;
      if (hit) {
        c.falling = false;
        c.vy = 0;
      }
    }
    if (toPx(c.y) - CRATE_R > w.waterY) {
      w.crates.splice(w.crates.indexOf(c), 1);
      w.events.push({ t: 'splash', x: toPx(c.x) });
      continue;
    }
    for (const x of w.worms) {
      if (!alive(x) || len(toPx(x.x) - toPx(c.x), toPx(x.y) - toPx(c.y)) > WORM_R + CRATE_R) continue;
      const team = w.teams[x.team];
      if (c.kind === 'health') x.hp += Number(c.content);
      else if ((team.ammo[c.content] ?? 0) >= 0) team.ammo[c.content] = (team.ammo[c.content] ?? 0) + 1;
      w.crates.splice(w.crates.indexOf(c), 1);
      w.events.push({ t: 'crate', worm: x.id, kind: c.kind, content: c.content });
      // подлечился в свой ход — это не «ранен»: поднять планку
      if (x.id === w.active && c.kind === 'health') w.hpAtTurn = x.hp;
      break;
    }
  }
}

/** Крюк по лучу прицела: зацепился за землю — боец повис (длина — до крюка). */
function shootRope(w: World, worm: Worm, wx: number, wy: number, ang: number, range: number): void {
  const [ex, ey] = fromAngle(ang, range * ONE);
  const hit = w.mask.raycast(wx, wy, wx + toPx(ex), wy + toPx(ey));
  if (worm.state === 'rope') unrope(w, worm);
  if (!hit) return;
  const ax = hit[0] * ONE + ONE / 2, ay = hit[1] * ONE + ONE / 2;
  const d = len(ax - worm.x, ay - worm.y);
  if (d < ROPE_MIN) return;
  w.rope = { ax, ay, len: d };
  worm.state = 'rope';
  worm.stride = 0;
  w.events.push({ t: 'rope', x: hit[0], y: hit[1] });
}

function unrope(w: World, worm: Worm): void {
  w.rope = null;
  if (worm.state === 'rope') {
    worm.state = 'air';
    worm.bounce = 0;
    w.events.push({ t: 'unrope', worm: worm.id });
  }
}

/** Кадр на верёвке: длина, раскачка, гравитация, полёт с касаниями земли и связь «не дальше длины». */
function tickRope(w: World, worm: Worm, inp: Input): void {
  const r = w.rope!;
  const maxLen = (WEAPONS.rope.range ?? 320) * ONE;
  if (inp.aim) r.len = Math.max(ROPE_MIN, Math.min(maxLen, r.len + inp.aim * ROPE_REEL));
  if (inp.move) worm.vx += inp.move * ROPE_PUSH;
  worm.vy += GRAVITY;
  worm.bounce = 60;
  worm.slide = 230;
  stepBody(worm, w.mask, 0);
  const dx = worm.x - r.ax, dy = worm.y - r.ay;
  const d = len(dx, dy);
  if (d > r.len && d > 0) {
    // вернуть на окружность длины верёвки и убрать скорость «от крюка»
    const nx = r.ax + trunc((dx * r.len) / d), ny = r.ay + trunc((dy * r.len) / d);
    if (free(w.mask, nx, ny, worm.r)) {
      worm.x = nx;
      worm.y = ny;
    }
    const vr = trunc((worm.vx * dx + worm.vy * dy) / d);
    if (vr > 0) {
      worm.vx -= trunc((vr * dx) / d);
      worm.vy -= trunc((vr * dy) / d);
    }
  }
  if (toPx(worm.y) - worm.r > w.waterY) unrope(w, worm);
}

/** Конец хода: выбывшие сдуваются, проверка победы, следующая бригада. */
function endTurn(w: World): void {
  for (const x of w.worms) {
    if (x.state !== 'dead' && x.hp <= 0) {
      x.state = 'dead';
      w.caps.push({ x: toPx(x.x), y: toPx(x.y), team: x.team });
      w.events.push({ t: 'deflate', worm: x.id });
    }
  }
  const standing = w.teams.filter((t) => t.worms.some((id) => alive(wormById(w, id)!)));
  if (standing.length <= 1) {
    w.phase = 'over';
    w.winner = standing.length ? standing[0].id : -1;
    w.events.push({ t: 'over', winner: w.winner });
    return;
  }
  if (w.roundLeft <= 0 && w.scheme.riseStep > 0) {
    w.waterY = Math.max(40, w.waterY - w.scheme.riseStep);
    w.events.push({ t: 'rise', y: w.waterY });
  }
  // следующая бригада, у которой есть живые, и её следующий живой боец
  let ti = w.team;
  do ti = (ti + 1) % w.teams.length;
  while (!w.teams[ti].worms.some((id) => alive(wormById(w, id)!)));
  const team = w.teams[ti];
  let k = team.last;
  do k = (k + 1) % team.worms.length;
  while (!alive(wormById(w, team.worms[k])!));
  team.last = k;
  const worm = wormById(w, team.worms[k])!;
  w.team = ti;
  w.active = worm.id;
  w.phase = 'turn';
  w.left = w.scheme.turnTime * TICK_HZ;
  w.charge = 0;
  w.rope = null;
  w.ropeUsed = false;
  w.hpAtTurn = worm.hp;
  w.wind = trunc((w.rng.int(-100, 100) * w.scheme.wind * 100) / 100);
  if (w.rng.below(100) < w.scheme.crates) dropCrate(w);
  if ((team.ammo[w.weapon] ?? 0) === 0) w.weapon = Object.keys(team.ammo).find((k2) => team.ammo[k2] !== 0 && WEAPONS[k2]) ?? 'kuryu';
  w.shots = WEAPONS[w.weapon].shots ?? 1;
  w.events.push({ t: 'turn', team: ti, worm: worm.id });
}

/** Хеш мира для сверки клиентов (FNV-1a по маске и всем числам состояния). */
export function worldHash(w: World): number {
  let h = w.mask.hash();
  const mix = (v: number) => {
    h = Math.imul(h ^ (v & 0xffff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xffff), 0x01000193);
  };
  mix(w.tick); mix(w.rng.s); mix(w.waterY); mix(w.roundLeft); mix(w.wind); mix(w.left); mix(w.active); mix(w.aim); mix(w.charge); if (w.rope) { mix(w.rope.ax); mix(w.rope.ay); mix(w.rope.len); }
  for (const x of w.worms) { mix(x.x); mix(x.y); mix(x.vx); mix(x.vy); mix(x.hp); }
  for (const p of w.projs) { mix(p.x); mix(p.y); mix(p.vx); mix(p.vy); mix(p.fuse); }
  for (const c of w.crates) { mix(c.x); mix(c.y); mix(c.id); }
  return h >>> 0;
}
