/* Мир партии ГОПС и его шаг step(world, input) — 60 раз в секунду. Детерминированно (CODE.md §2):
 * один и тот же мир + один и тот же поток ввода → один и тот же мир на любой машине.
 *
 * Ход: 'turn' (боец под управлением, таймер) → выстрел → 'retreat' (ещё можно отбежать) → 'settle' (ждём,
 * пока всё упадёт и взорвётся) → выбывшие сдуваются, остаются кепки → следующая бригада. */
import { type Body, GRAVITY, free, stepBody } from './body';
import { ANG_FULL, ONE, fromAngle, len, toPx, trunc } from './fx';
import type { Mask } from './mask';
import { Rng } from './rng';
import { type WeaponDef, WEAPONS } from './weapons';
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
/** Наводка: скорость к точке (Q8 за кадр), доля поворота за кадр (из 256), через сколько кадров ракета рвётся сама. */
const HOMING_SPEED = 2200;
const HOMING_TURN = 28;
const HOMING_LIFE = 360;
/** Зонтик: предел скорости падения. */
const CHUTE_VY = 160;
/** Кирпичи и посылки появляются над картой на этой высоте, px. */
const SKY_Y = -30;
/** Ранец: тяга вверх и вбок, Q8 за кадр², предел скорости. */
const JET_UP = 72;
const JET_SIDE = 22;
const JET_MAX = 700;
/** Руль голубя и змея за кадр (1/4096 оборота). */
const STEER = 40;
/** Резинка: срабатывает при падении быстрее этого (Q8 за кадр), длина, px. */
const BUNGEE_VY = 600;
const BUNGEE_LEN = 70;
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
  /** Тяжесть, Q8 за кадр² (по умолчанию GRAVITY); без ходьбы — только прыжки и утилиты. */
  gravity?: number;
  noWalk?: boolean;
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
  /** Невидимка: до своего следующего хода или первого урона. */
  hidden: boolean;
  /** Сколько своих ходов бригада начала (задержки оружия, цели миссий). */
  turns: number;
}

/** Предмет миссии: флажок, мишень, бочка (и прочее взрывное), подопечный, заложник. Координаты — px. */
export type ObjKind = 'flag' | 'target' | 'barrel' | 'ward' | 'hostage';

export interface Obj {
  id: number;
  kind: ObjKind;
  /** Как рисовать (бабка, улей, тепловоз, банка, холодильник…). */
  look: string;
  x: number;
  y: number;
  r: number;
  /** Здоровье; −1 — неуязвим (флажок). */
  hp: number;
  /** Ещё стоит (не сбит, не взят, не спасён). */
  alive: boolean;
  /** Рвётся, когда разбит (бочка, котёл). */
  explosive: boolean;
  /** Качается по x вокруг bx на swing px (движущиеся мишени). */
  bx: number;
  swing: number;
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
  /** Точка наводки, px (−1 — нет). */
  tx: number;
  ty: number;
  /** Бегущие: куда бегут; управляемые: курс (1/4096 оборота); stride — дробный шаг (у ледобура 1 — ввинчивается). */
  dir: 1 | -1;
  ang: number;
  stride: number;
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
export const CRATE_WEAPONS = [
  'mukha', 'limonka', 'sling', 'obrez', 'tnt', 'mine', 'armatura', 'homing', 'mortar', 'carbide', 'korsar', 'posylka', 'samogon',
  'kalash', 'pulemet', 'uppercut', 'mawashi', 'kukuruznik', 'pochta', 'vanna',
];
export const CRATE_UTILS = ['rope', 'marshrutka', 'plita', 'otboinik', 'payalnik', 'zontik', 'buratino', 'kedy', 'yagga', 'ukazka', 'tyidi'];
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
  /** Земля убрана без взрыва (отбойник, лампа) или добавлена (плита). */
  | { t: 'carve'; x: number; y: number; r: number }
  | { t: 'girder'; x0: number; y0: number; x1: number; y1: number; r: number }
  | { t: 'teleport'; worm: number; x: number; y: number }
  | { t: 'buff'; worm: number; weapon: string }
  | { t: 'freeze'; x: number; y: number; r: number }
  | { t: 'obj'; id: number; kind: ObjKind }
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
  /** Точка на карте для наводки, авиаудара, маршрутки, плиты (px); null — не выбрана. */
  target: [number, number] | null;
  /** Усилители этого хода: гравитация (Q8 за кадр²), быстрый шаг, множитель урона, лазер, зонтик. */
  grav: number;
  fast: boolean;
  dmgMul: number;
  laser: boolean;
  chute: boolean;
  /** Отбойник/лампа в работе: кадров осталось. */
  dig: { left: number } | null;
  /** Очередь: кадров до следующего выстрела; −1 — очередь не начата. */
  burst: number;
  /** Управляемые снаряды хода (дворняга, голубь…): id оружия; '' — нет. Пока они есть, ввод идёт им. */
  ctrl: string;
  /** Ранец: топливо (кадров тяги); thrust — в этом кадре тянет (для огня из сопла). */
  jet: number;
  thrust: boolean;
  /** Резинка взведена. */
  bungee: boolean;
  /** «За пацанов!»: кадров полёта осталось. */
  kami: number;
  /** Предметы миссии. */
  objs: Obj[];
  /** Задержка оружия: доступно с хода бригады номер delay + 1. */
  delays: Record<string, number>;
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
  /** Точка на карте, px (щелчок/тап). */
  target?: [number, number];
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
    firePrev: false, hpAtTurn: 0, winner: -1, roundLeft: 0, rope: null, ropeUsed: false, target: null,
    grav: s.scheme?.gravity ?? GRAVITY, fast: false, dmgMul: 1, laser: false, chute: false, dig: null, burst: -1, ctrl: '', jet: 0, thrust: false,
    bungee: false, kami: 0, objs: [], delays: {}, events: [],
  };
  w.roundLeft = w.scheme.roundTime * TICK_HZ;
  s.teams.forEach((t, ti) => {
    const team: Team = { id: ti, worms: [], last: -1, ammo: { ...t.ammo }, hidden: false, turns: 0 };
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
  return tiltAngle(w.aim, worm.facing);
}

/** Наклон от горизонтали (как у прицела) в мировой угол для взгляда facing. */
function tiltAngle(tilt: number, facing: 1 | -1): number {
  return facing === 1 ? (tilt + ANG_FULL) % ANG_FULL : (ANG_FULL / 2 - tilt + ANG_FULL) % ANG_FULL;
}

/** Один кадр мира. События кадра — в w.events (очищаются в начале шага). */
export function step(w: World, input: Input): void {
  w.events = [];
  w.tick++;
  w.thrust = false;
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

  if (worm && worm.state === 'fly') tickKamikaze(w, worm);
  if (worm && w.bungee && worm.state === 'air' && worm.vy > BUNGEE_VY && (w.phase === 'turn' || w.phase === 'retreat')) {
    // резинка: зацепилась там, где начал падать
    w.bungee = false;
    w.rope = { ax: worm.x, ay: worm.y - 4 * ONE, len: BUNGEE_LEN * ONE };
    worm.state = 'rope';
    w.events.push({ t: 'rope', x: toPx(worm.x), y: toPx(worm.y) - 4 });
  }
  if (worm && w.chute) {
    if (worm.state === 'air') {
      // зонтик: падает медленно, ветер сносит
      worm.vy = Math.min(worm.vy, CHUTE_VY);
      worm.vx = trunc((worm.vx * 240) / 256) + trunc((w.wind * WIND_K) / 200);
    } else if (worm.state !== 'rope') w.chute = false;
  }
  const wev: WormEvent[] = [];
  for (const x of w.worms) tickWorm(x, w.mask, w.waterY, wev, w.grav);
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
  tickObjs(w);

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
  for (const x of w.worms) if (x.state === 'air' || x.state === 'rope' || x.state === 'fly') return false;
  for (const p of w.projs) if (p.state === 'fly' || p.state === 'fuse') return false;
  return true;
}

function control(w: World, worm: Worm, inp: Input, canFire: boolean): void {
  const team = w.teams[w.team];
  if (w.dig) {
    if (inp.aim) w.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, w.aim + inp.aim * AIM_STEP));
    tickDig(w, worm, inp);
    return;
  }
  if (w.ctrl) {
    if (canFire) steer(w, inp);
    return;
  }
  if (worm.state === 'fly') return;
  if (inp.target && canFire) w.target = [inp.target[0] | 0, inp.target[1] | 0];
  if (w.jet > 0 && worm.state !== 'rope' && (inp.aim === -1 || (inp.move && worm.state === 'air'))) {
    // ранец: ↑ — тяга вверх, ←/→ в воздухе — вбок; прицел и ходьба в это время не работают
    if (inp.aim === -1) {
      worm.vy = Math.max(worm.vy - JET_UP, -JET_MAX);
      worm.state = 'air';
    }
    if (inp.move) {
      worm.vx = Math.max(-JET_MAX, Math.min(JET_MAX, worm.vx + inp.move * JET_SIDE));
      worm.facing = inp.move;
    }
    worm.bounce = 0;
    w.jet--;
    w.thrust = true;
    return;
  }
  const fresh = w.shots === (WEAPONS[w.weapon]?.shots ?? 1); // после первого выстрела обреза оружие не меняют
  if (canFire && fresh && w.burst < 0 && inp.weapon && inp.weapon !== w.weapon && WEAPONS[inp.weapon] && ready(w, inp.weapon) && w.charge === 0) {
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
    else if (inp.move && w.scheme.noWalk) worm.facing = inp.move;
    else if (inp.move) {
      walk(worm, w.mask, inp.move, []);
      if (w.fast) walk(worm, w.mask, inp.move, []);
    }
  }
  if (!canFire) return;
  const def = WEAPONS[w.weapon];
  if (!def) return;
  // в воздухе — только верёвка и зонтик; зонтик — только в воздухе
  const inAir = worm.state === 'air' && (def.kind === 'rope' || def.buff === 'chute');
  if ((worm.state !== 'stand' && !inAir) || (def.buff === 'chute' && worm.state !== 'air')) return;
  if (def.auto) {
    if (w.burst < 0) {
      if (inp.fire && !w.firePrev) fire(w, worm);
    } else if (!inp.fire) {
      // отпустил — очередь кончилась, остаток пропал
      if ((team.ammo[w.weapon] ?? 0) > 0) team.ammo[w.weapon]--;
      w.shots = 0;
      endAttack(w, false);
    } else if (--w.burst <= 0) fire(w, worm);
  } else if (def.charged) {
    if (inp.fire) w.charge++;
    if ((w.firePrev && !inp.fire && w.charge > 0) || w.charge >= CHARGE_MAX) fire(w, worm);
  } else if (inp.fire && !w.firePrev) fire(w, worm);
}

function fire(w: World, worm: Worm): void {
  const def = WEAPONS[w.weapon];
  const team = w.teams[w.team];
  const ammo = team.ammo[w.weapon] ?? 0;
  if (ammo === 0 || !ready(w, w.weapon)) return;
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
  if (def.target && !w.target) return; // сначала точка на карте
  // ход не кончают: усилитель, другой боец, начало копки, выпущенный бегун/летун, полёт «за пацанов!»
  if (def.kind === 'buff' || def.kind === 'select' || def.kind === 'dig' || def.kind === 'walker' || def.kind === 'flyer' || def.kind === 'kamikaze') {
    if (def.kind === 'walker' || def.kind === 'flyer') launch(w, worm, def, ang);
    else if (def.kind === 'kamikaze') {
      unrope(w, worm);
      [worm.vx, worm.vy] = fromAngle(ang, def.speed!);
      worm.state = 'fly';
      w.kami = def.fuse! * TICK_HZ;
    } else if (def.kind === 'buff') applyBuff(w, def);
    else if (def.kind === 'select' && !selectNext(w, worm)) return;
    else if (def.kind === 'dig') w.dig = { left: def.fuse! * TICK_HZ };
    if (ammo > 0) team.ammo[w.weapon] = ammo - 1;
    w.events.push(def.kind === 'buff' ? { t: 'buff', worm: worm.id, weapon: w.weapon } : { t: 'fire', weapon: w.weapon, worm: worm.id });
    if (def.kind === 'buff' || def.kind === 'select') pickAfterUse(w);
    return;
  }
  switch (def.kind) {
    case 'missile':
    case 'grenade':
    case 'stone': {
      const sp = trunc((def.speed! * Math.max(8, w.charge)) / CHARGE_MAX);
      const [vx, vy] = fromAngle(ang, sp);
      const [ox, oy] = fromAngle(ang, (WORM_R + 4) * ONE);
      const fuse = def.kind === 'grenade' ? (def.fixedFuse ? def.fuse! : w.fuse) * TICK_HZ : -1;
      const p = spawnProj(w, w.weapon, fuse, worm.id, worm.x + ox, worm.y + oy, vx, vy);
      if (def.homing && w.target) [p.tx, p.ty] = w.target;
      break;
    }
    case 'placed':
    case 'mine':
      spawnProj(w, w.weapon, def.kind === 'placed' ? def.fuse! * TICK_HZ : -1, worm.id, worm.x + worm.facing * 6 * ONE, worm.y, 0, 0);
      break;
    case 'hitscan': {
      const a = def.spread ? (ang + w.rng.int(-def.spread, def.spread) + ANG_FULL) % ANG_FULL : ang;
      shoot(w, worm, wx, wy, a, def.range!);
      break;
    }
    case 'melee':
      melee(w, worm, def.meleeAim === undefined ? ang : tiltAngle(def.meleeAim, worm.facing));
      break;
    case 'strike':
      strike(w, worm, def);
      break;
    case 'teleport':
      if (!teleport(w, worm)) return;
      break;
    case 'girder':
      if (!placeGirder(w, worm, def)) return;
      break;
    case 'justice':
      justice(w);
      break;
    case 'flood':
      w.waterY = Math.max(40, w.waterY - def.range!);
      w.events.push({ t: 'rise', y: w.waterY });
      break;
    case 'surrender':
      for (const id of team.worms) wormById(w, id)!.hp = 0;
      break;
    case 'skip':
      break;
  }
  w.events.push({ t: 'fire', weapon: w.weapon, worm: worm.id });
  w.charge = 0;
  w.shots--;
  if (ammo > 0 && (w.shots <= 0 || def.kind !== 'hitscan')) team.ammo[w.weapon] = ammo - 1;
  const instant = def.kind === 'skip' || def.kind === 'surrender' || def.kind === 'justice' || def.kind === 'flood';
  if (w.shots <= 0 || instant) endAttack(w, instant);
  else if (def.auto) w.burst = def.auto;
}

/** Атака закончена: отход (или сразу оседание). */
function endAttack(w: World, noRetreat: boolean): void {
  const retreat = noRetreat ? 0 : w.scheme.retreat * TICK_HZ;
  w.phase = retreat > 0 ? 'retreat' : 'settle';
  w.left = retreat > 0 ? retreat : SETTLE_MAX;
  w.burst = -1;
  w.dig = null;
}

/** Утилита кончилась — в руки то, что ещё есть (иначе следующий огонь — впустую). */
function pickAfterUse(w: World): void {
  const team = w.teams[w.team];
  if ((team.ammo[w.weapon] ?? 0) !== 0) return;
  w.weapon = Object.keys(team.ammo).find((k) => team.ammo[k] !== 0 && WEAPONS[k] && !WEAPONS[k].hidden) ?? 'kuryu';
  w.shots = WEAPONS[w.weapon].shots ?? 1;
}

function applyBuff(w: World, def: WeaponDef): void {
  if (def.buff === 'lowgrav') w.grav = GRAVITY >> 1;
  else if (def.buff === 'fast') w.fast = true;
  else if (def.buff === 'double') w.dmgMul = 2;
  else if (def.buff === 'laser') w.laser = true;
  else if (def.buff === 'chute') w.chute = true;
  else if (def.buff === 'jet') w.jet = def.fuse! * TICK_HZ;
  else if (def.buff === 'bungee') w.bungee = true;
  else if (def.buff === 'invisible') w.teams[w.team].hidden = true;
}

/** «Ты иди»: ход переходит следующему живому бойцу бригады. */
function selectNext(w: World, worm: Worm): boolean {
  const team = w.teams[w.team];
  const i0 = team.worms.indexOf(worm.id);
  for (let k = 1; k < team.worms.length; k++) {
    const i = (i0 + k) % team.worms.length;
    const next = wormById(w, team.worms[i])!;
    if (!alive(next) || next.hp <= 0) continue;
    unrope(w, worm);
    team.last = i;
    w.active = next.id;
    w.hpAtTurn = next.hp;
    w.events.push({ t: 'turn', team: w.team, worm: next.id });
    return true;
  }
  return false;
}

/** «По понятиям»: здоровье всех стоящих — поровну. */
function justice(w: World): void {
  const live = w.worms.filter((x) => alive(x) && x.hp > 0);
  if (!live.length) return;
  const avg = trunc(live.reduce((s, x) => s + x.hp, 0) / live.length);
  for (const x of live) x.hp = avg;
}

/** С неба: над точкой рядком через gap px, либо (без точки) вразброс по всей карте и с разной высоты. */
function strike(w: World, worm: Worm, def: WeaponDef): void {
  const n = def.drops!;
  for (let i = 0; i < n; i++) {
    let x: number, y: number;
    if (def.target) {
      x = w.target![0] + trunc(((i * 2 - (n - 1)) * def.gap!) / 2);
      y = SKY_Y - (i & 1) * 8;
    } else {
      x = 30 + w.rng.below(w.mask.w - 60);
      y = SKY_Y - i * 50;
    }
    spawnProj(w, def.drop!, -1, worm.id, x * ONE, y * ONE, 0, 200);
  }
}

/** Маршрутка: в точку, если там свободно и не в жидкости. */
function teleport(w: World, worm: Worm): boolean {
  const [tx, ty] = w.target!;
  if (tx < WORM_R || tx >= w.mask.w - WORM_R || ty < WORM_R || ty >= w.waterY - WORM_R) return false;
  if (!free(w.mask, tx * ONE, ty * ONE, WORM_R)) return false;
  unrope(w, worm);
  worm.x = tx * ONE;
  worm.y = ty * ONE;
  worm.vx = worm.vy = 0;
  worm.state = 'air';
  w.events.push({ t: 'teleport', worm: worm.id, x: tx, y: ty });
  return true;
}

/** Бетонная плита: капсула длиной 2·range по направлению прицела; не на бойца. */
function placeGirder(w: World, worm: Worm, def: WeaponDef): boolean {
  const [tx, ty] = w.target!;
  const [dx, dy] = fromAngle(aimAngle(w, worm), def.range! * ONE);
  const x0 = tx - toPx(dx), y0 = ty - toPx(dy), x1 = tx + toPx(dx), y1 = ty + toPx(dy);
  const R = 4;
  if (wormOnPath(w, x0 * ONE, y0 * ONE, x1 * ONE, y1 * ONE, R + 1, -1)) return false;
  w.mask.fillSegment(x0, y0, x1, y1, R);
  w.events.push({ t: 'girder', x0, y0, x1, y1, r: R });
  return true;
}

/** Кадр копки: отбойник — вниз, лампа — по прицелу; огонь ещё раз — стоп. */
function tickDig(w: World, worm: Worm, inp: Input): void {
  const def = WEAPONS[w.weapon];
  const d = w.dig!;
  if ((inp.fire && !w.firePrev) || --d.left <= 0 || !alive(worm) || worm.state === 'rope') {
    endAttack(w, false);
    return;
  }
  if (inp.move) worm.facing = inp.move;
  const ang = def.down ? ANG_FULL / 4 : aimAngle(w, worm);
  const [dx, dy] = fromAngle(ang, 6 * ONE);
  if (w.tick % 3 === 0) {
    const cx = toPx(worm.x + dx), cy = toPx(worm.y + dy);
    w.mask.carveCircle(cx, cy, def.range!);
    w.events.push({ t: 'carve', x: cx, y: cy, r: def.range! });
  }
  if (!def.down) {
    // лампа ведёт бойца по прорезанному ходу
    const [mx, my] = fromAngle(ang, 96);
    if (free(w.mask, worm.x + mx, worm.y + my, worm.r)) {
      worm.x += mx;
      worm.y += my;
    }
    worm.vx = worm.vy = 0;
  }
}

function spawnProj(w: World, weapon: string, fuse: number, owner: number, x: number, y: number, vx: number, vy: number): Proj {
  const def = WEAPONS[weapon];
  const p: Proj = {
    id: w.nextId++, weapon, owner, x, y, vx, vy, r: def.r ?? 3,
    bounce: def.bounce ?? 0, slide: def.slide ?? 0, fuse, state: def.kind === 'mine' ? 'fly' : fuse >= 0 ? 'fuse' : 'fly', age: 0,
    tx: -1, ty: -1, dir: 1, ang: 0, stride: 0,
  };
  w.projs.push(p);
  return p;
}

/** Взрыв снаряда и осколки веером вверх. */
function detonate(w: World, p: Proj): void {
  const def = WEAPONS[p.weapon];
  if (def.freeze) {
    freeze(w, toPx(p.x), toPx(p.y), def.freeze);
    remove(w, p);
    return;
  }
  explode(w, toPx(p.x), toPx(p.y), def.radius!, def.damage!);
  remove(w, p);
  const c = def.cluster;
  if (!c) return;
  for (let i = 0; i < c.n; i++) {
    const ang = (ANG_FULL * 3) / 4 + w.rng.int(-640, 640);
    const [vx, vy] = fromAngle(ang, trunc((c.speed * (192 + w.rng.below(128))) / 256));
    spawnProj(w, c.fragment, -1, p.owner, p.x, p.y - 4 * ONE, vx, vy);
  }
}

function tickProjs(w: World): void {
  const windAcc = trunc((w.wind * WIND_K) / 100);
  for (const p of w.projs.slice()) {
    const def = WEAPONS[p.weapon];
    p.age++;
    if (toPx(p.y) > w.waterY) {
      w.events.push({ t: 'splash', x: toPx(p.x) });
      remove(w, p);
      continue;
    }
    if (def.kind === 'walker') {
      tickWalker(w, p, def);
      continue;
    }
    if (def.kind === 'flyer') {
      tickFlyer(w, p, def, windAcc);
      continue;
    }
    if (def.kind === 'flame') {
      tickFlame(w, p, def, windAcc);
      continue;
    }
    if (def.drill && p.stride === 1) {
      // ледобур ввинчивается: режет грунт по курсу, взрыв по таймеру или о бойца
      const px = p.x, py = p.y;
      p.x += p.vx;
      p.y += p.vy;
      if (p.age % 3 === 0) {
        w.mask.carveCircle(toPx(p.x), toPx(p.y), p.r + 5);
        w.events.push({ t: 'carve', x: toPx(p.x), y: toPx(p.y), r: p.r + 5 });
      }
      if (--p.fuse <= 0 || wormOnPath(w, px, py, p.x, p.y, p.r, -1) || toPx(p.y) >= w.mask.h) detonate(w, p);
      continue;
    }
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
    if (def.homing && p.tx >= 0 && p.age > 20) {
      // наводка: скорость плавно поворачивает к точке, гравитация погашена
      if (p.age > HOMING_LIFE) {
        detonate(w, p);
        continue;
      }
      const dx = p.tx - toPx(p.x), dy = p.ty - toPx(p.y);
      const l = len(dx, dy) || 1;
      p.vx += trunc(((trunc((dx * HOMING_SPEED) / l) - p.vx) * HOMING_TURN) / 256);
      p.vy += trunc(((trunc((dy * HOMING_SPEED) / l) - p.vy) * HOMING_TURN) / 256) - w.grav;
    }
    const px = p.x, py = p.y, vx0 = p.vx, vy0 = p.vy;
    const hit = stepBody(p, w.mask, w.grav, def.wind ? windAcc : 0);
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
    const thing = !victim && (def.kind === 'missile' || def.kind === 'stone') ? objOnPath(w, px, py, p.x, p.y, p.r) : undefined;
    if (thing && def.kind === 'stone') {
      hitObj(w, thing, def.damage!);
      remove(w, p);
      continue;
    }
    if (def.drill && hit && !victim) {
      // ледобур коснулся земли — дальше ввинчивается по курсу
      // курс — как летел до удара (отскок скорость уже погасил)
      const l = len(vx0, vy0) || 1;
      const sp = 160;
      p.vx = trunc((vx0 * sp) / l);
      p.vy = trunc((vy0 * sp) / l);
      p.stride = 1;
      p.state = 'fuse';
      p.fuse = def.drill;
      continue;
    }
    if (def.kind === 'missile' && (hit || victim || thing)) {
      detonate(w, p);
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
    if (p.state === 'fuse' && --p.fuse <= 0) detonate(w, p);
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
  if (!alive(x) || x.frozen > 0) return;
  dmg *= w.dmgMul;
  if (dmg > 0) w.teams[x.team].hidden = false;
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
  for (const o of w.objs) {
    if (!o.alive || o.hp < 0) continue;
    const d = len(o.x - cx, o.y - cy);
    if (d < r + o.r) hitObj(w, o, trunc((damage * (r + o.r - d)) / (r + o.r)) + 1);
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
  const thing = objOnPath(w, x0 * ONE, y0 * ONE, x1 * ONE, y1 * ONE, 0);
  const dist = (x: number, y: number) => (x - x0) * (x - x0) + (y - y0) * (y - y0);
  if (thing && (!victim || dist(thing.x, thing.y) < dist(toPx(victim.x), toPx(victim.y)))) {
    x1 = thing.x;
    y1 = thing.y;
    hitObj(w, thing, def.damage!);
  } else if (victim) {
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
  worm.vy += w.grav;
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

/** Выпустить бегунов (дворняга, бабка, козы — стадом) или летуна; ввод хода переходит им. */
function launch(w: World, worm: Worm, def: WeaponDef, ang: number): void {
  const n = def.count ?? 1;
  for (let i = 0; i < n; i++) {
    // стадо — цепочкой впереди бойца
    const p = spawnProj(w, w.weapon, def.fuse! * TICK_HZ + i * 20, worm.id, worm.x + worm.facing * (WORM_R + 4 + i * 14) * ONE, worm.y - 2 * ONE, 0, 0);
    p.dir = worm.facing;
    p.ang = def.kind === 'flyer' ? ang : 0;
  }
  w.ctrl = w.weapon;
}

/** Ввод хода управляемым: огонь ещё раз — взрыв (змей — сброс бомбы), ←/→ — руль летуна. Улетели все — атака кончилась. */
function steer(w: World, inp: Input): void {
  const def = WEAPONS[w.ctrl];
  const mine = w.projs.filter((p) => p.weapon === w.ctrl);
  if (!mine.length) {
    w.ctrl = '';
    endAttack(w, false);
    return;
  }
  const press = inp.fire && !w.firePrev;
  for (const p of mine) {
    if (def.kind === 'flyer' && inp.move) p.ang = (p.ang + inp.move * STEER + ANG_FULL) % ANG_FULL;
    if (!press || !def.refire || p.age < 10) continue;
    if (def.drop) {
      // змей сбрасывает бомбу и улетает
      const b = spawnProj(w, def.drop, -1, p.owner, p.x, p.y + 4 * ONE, trunc(p.vx / 2), 0);
      b.age = 7;
      remove(w, p);
    } else detonate(w, p);
  }
}

/** Бегун: шагает по земле как боец (ступенька до CLIMB), упёрся — прыжок; взрыв по таймеру или о бойца (козы). */
function tickWalker(w: World, p: Proj, def: WeaponDef): void {
  if (--p.fuse <= 0) {
    detonate(w, p);
    return;
  }
  if (def.contact && p.age > 30 && wormOnPath(w, p.x, p.y, p.x, p.y, p.r, p.age < 90 ? p.owner : -1)) {
    detonate(w, p);
    return;
  }
  if (toPx(p.x) < -40 || toPx(p.x) > w.mask.w + 40) {
    remove(w, p);
    return;
  }
  const grounded = !free(w.mask, p.x, p.y + ONE, p.r);
  if (!grounded || p.vy < 0) {
    // в прыжке давит вперёд — перелезает стенку, а не сползает по ней
    if (free(w.mask, p.x + p.dir * 2 * ONE, p.y, p.r)) p.vx = p.dir * Math.max(p.vx * p.dir, 200);
    p.bounce = 0;
    p.slide = 200;
    stepBody(p, w.mask, w.grav, 0);
    return;
  }
  p.vx = p.vy = 0;
  p.stride += def.speed!;
  while (p.stride >= ONE) {
    p.stride -= ONE;
    const nx = p.x + p.dir * ONE;
    let ny = -1;
    for (let lift = 0; lift <= 6; lift++) {
      if (free(w.mask, nx, p.y - lift * ONE, p.r)) {
        ny = p.y - lift * ONE;
        break;
      }
    }
    if (ny < 0) {
      // стенка: прыжок через неё
      p.vx = p.dir * 260;
      p.vy = -def.jump!;
      p.stride = 0;
      return;
    }
    let drop = 0;
    while (drop <= 6 && free(w.mask, nx, ny + ONE, p.r)) {
      ny += ONE;
      drop++;
    }
    p.x = nx;
    p.y = ny;
    if (drop > 6) {
      p.vx = p.dir * def.speed!;
      p.stride = 0;
      return;
    }
  }
}

/** Летун: постоянная скорость по курсу без тяжести; об землю или бойца — взрыв (змей — просто падает), топливо кончилось — так же. */
function tickFlyer(w: World, p: Proj, def: WeaponDef, windAcc: number): void {
  const crash = () => (def.drop ? remove(w, p) : detonate(w, p));
  if (--p.fuse <= 0) {
    crash();
    return;
  }
  [p.vx, p.vy] = fromAngle(p.ang, def.speed!);
  if (def.drop) p.vx += windAcc * 8; // змея сносит ветром
  const px = p.x, py = p.y;
  const hit = stepBody(p, w.mask, 0, 0);
  const victim = p.age > 20 ? wormOnPath(w, px, py, p.x, p.y, p.r, -1) : undefined;
  if (toPx(p.x) < -200 || toPx(p.x) > w.mask.w + 200 || toPx(p.y) < -400) remove(w, p);
  else if (hit || victim) crash();
}

/** Огонь: падает, на земле горит fuse секунд — подъедает грунт и жжёт бойцов рядом (без толчка). */
function tickFlame(w: World, p: Proj, def: WeaponDef, windAcc: number): void {
  p.bounce = 0;
  p.slide = 120;
  const hit = stepBody(p, w.mask, w.grav, windAcc);
  if (p.state === 'fly' && (hit || !free(w.mask, p.x, p.y + ONE, p.r))) {
    p.state = 'fuse';
    p.fuse = def.fuse! * TICK_HZ;
  }
  if (p.state !== 'fuse') return;
  if ((p.age & 7) === 0) {
    const x = toPx(p.x), y = toPx(p.y) + 2;
    w.mask.carveCircle(x, y, 3);
    w.events.push({ t: 'carve', x, y, r: 3 });
    for (const x2 of w.worms) if (alive(x2) && len(toPx(x2.x) - x, toPx(x2.y) - y) < WORM_R + 4) hurt(w, x2, def.damage!, 0, 0);
  }
  if (--p.fuse <= 0) remove(w, p);
}

/** «За пацанов!»: боец летит по прямой без тяжести, взрыв — о землю, бойца, по времени; сам он выбывает. */
function tickKamikaze(w: World, worm: Worm): void {
  const def = WEAPONS.zapacanov;
  const px = worm.x, py = worm.y;
  const hit = stepBody(worm, w.mask, 0, 0);
  const victim = wormOnPath(w, px, py, worm.x, worm.y, 0, worm.id);
  const out = toPx(worm.y) > w.waterY || toPx(worm.x) < 0 || toPx(worm.x) >= w.mask.w;
  if (!hit && !victim && !out && --w.kami > 0) return;
  worm.state = 'air';
  worm.vx = worm.vy = 0;
  worm.hp = 0;
  explode(w, toPx(worm.x), toPx(worm.y), def.radius!, def.damage!);
}

/** Заморозка: бойцы в радиусе круг не берут урон и толчков (снимается в их ход). */
function freeze(w: World, cx: number, cy: number, r: number): void {
  w.events.push({ t: 'freeze', x: cx, y: cy, r });
  for (const x of w.worms) {
    if (!alive(x) || len(toPx(x.x) - cx, toPx(x.y) - cy) > r + WORM_R) continue;
    x.frozen = w.teams.length;
    x.vx = x.vy = 0;
  }
}

/** Оружие есть в запасе и задержка прошла (доступно с хода бригады delay + 1). */
export function ready(w: World, id: string): boolean {
  const team = w.teams[w.team];
  return (team.ammo[id] ?? 0) !== 0 && team.turns > (w.delays[id] ?? 0);
}

/** Ближайший к началу пути целый уязвимый предмет, который задевает отрезок (Q8). */
function objOnPath(w: World, x0: number, y0: number, x1: number, y1: number, r: number): Obj | undefined {
  const ax = toPx(x0), ay = toPx(y0), bx = toPx(x1), by = toPx(y1);
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let best: Obj | undefined, bestT = Infinity;
  for (const o of w.objs) {
    if (!o.alive || o.hp < 0 || o.kind === 'hostage') continue;
    const RR = (o.r + r) * (o.r + r);
    const px = o.x - ax, py = o.y - ay;
    const t = px * dx + py * dy;
    let hit: boolean;
    if (L === 0 || t <= 0) hit = px * px + py * py <= RR;
    else if (t >= L) hit = (px - dx) * (px - dx) + (py - dy) * (py - dy) <= RR;
    else {
      const cross = px * dy - py * dx;
      hit = cross * cross <= RR * L;
    }
    if (hit && t < bestT) [best, bestT] = [o, t];
  }
  return best;
}

/** Урон предмету; разбитый — событие, взрывной — рвётся сам (цепочкой). */
function hitObj(w: World, o: Obj, dmg: number): void {
  if (!o.alive || o.hp < 0) return;
  o.hp = Math.max(0, o.hp - dmg);
  if (o.hp > 0) return;
  o.alive = false;
  w.events.push({ t: 'obj', id: o.id, kind: o.kind });
  if (o.explosive) explode(w, o.x, o.y, 40, 30);
}

/** Предметы: движущиеся мишени качаются (треугольник, период 4 с), остальные падают, если из-под них выбили землю;
 * утонувший уязвимый предмет считается разбитым. */
function tickObjs(w: World): void {
  for (const o of w.objs) {
    if (!o.alive) continue;
    if (o.swing) {
      const ph = (w.tick + o.id * 37) % 240;
      const k = ph < 120 ? ph : 240 - ph; // 0…120…0
      o.x = o.bx - o.swing + trunc((k * 2 * o.swing) / 120);
      continue;
    }
    if (!w.mask.hitsCircle(o.x, o.y + 1, o.r)) o.y++;
    if (o.y - o.r > w.waterY && o.hp >= 0) {
      w.events.push({ t: 'splash', x: o.x });
      o.hp = 1;
      hitObj(w, o, 1);
    }
  }
}

/** Мина схемы миссии — лежит на земле, ничья. */
export function addMine(w: World, x: number, y: number): void {
  spawnProj(w, 'mine', -1, -1, x * ONE, y * ONE, 0, 0);
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
  // одиночное испытание (одна бригада) кончается, только когда бригады не осталось
  if (standing.length === 0 || (standing.length === 1 && w.teams.length > 1)) {
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
  w.target = null;
  w.grav = w.scheme.gravity ?? GRAVITY;
  w.fast = w.laser = w.chute = false;
  w.dmgMul = 1;
  w.dig = null;
  w.burst = -1;
  w.ctrl = '';
  w.jet = 0;
  w.bungee = false;
  w.kami = 0;
  team.hidden = false;
  team.turns++;
  for (const x of w.worms) if (x.frozen > 0) x.frozen--;
  worm.frozen = 0;
  w.hpAtTurn = worm.hp;
  w.wind = trunc((w.rng.int(-100, 100) * w.scheme.wind * 100) / 100);
  if (w.rng.below(100) < w.scheme.crates) dropCrate(w);
  if (!ready(w, w.weapon)) w.weapon = Object.keys(team.ammo).find((k2) => ready(w, k2) && WEAPONS[k2] && !WEAPONS[k2].hidden) ?? 'kuryu';
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
  mix(w.tick); mix(w.rng.s); mix(w.waterY); mix(w.roundLeft); mix(w.wind); mix(w.left); mix(w.active); mix(w.aim); mix(w.charge); mix(w.grav); mix(w.dmgMul); mix(w.jet); mix(w.kami); if (w.target) { mix(w.target[0]); mix(w.target[1]); } if (w.rope) { mix(w.rope.ax); mix(w.rope.ay); mix(w.rope.len); }
  for (const x of w.worms) { mix(x.x); mix(x.y); mix(x.vx); mix(x.vy); mix(x.hp); }
  for (const p of w.projs) { mix(p.x); mix(p.y); mix(p.vx); mix(p.vy); mix(p.fuse); }
  for (const c of w.crates) { mix(c.x); mix(c.y); mix(c.id); }
  for (const o of w.objs) { mix(o.x); mix(o.hp); }
  return h >>> 0;
}
