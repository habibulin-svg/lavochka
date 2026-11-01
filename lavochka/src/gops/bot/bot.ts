/* Бот ГОПС: перебирает оружие × угол × силу, прогоняет полёт тем же кодом физики (stepBody по маске,
 * мир не меняется), оценивает урон в точке взрыва по формуле explode. Уровни — шириной перебора и «дрожанием руки».
 * Работает у хоста, по сети уходит его ввод — поэтому здесь можно и float. */
import { type Body, stepBody } from '../sim/body';
import { ANG_FULL, ONE, fromAngle, len, toPx } from '../sim/fx';
import { WEAPONS } from '../sim/weapons';
import { AIM_MAX, CHARGE_MAX, type Input, TICK_HZ, type World, wormById } from '../sim/world';
import { WORM_R, type Worm } from '../sim/worm';

export type BotLevel = 'easy' | 'medium' | 'hard';

interface Plan {
  weapon: string;
  facing: 1 | -1;
  aim: number;
  charge: number;
  fuse: number;
  score: number;
  /** Точка на карте (авиаудар, наводка), px. */
  target?: [number, number];
}

const LEVEL = {
  easy: { angles: 10, powers: 4, jitterAim: 70, jitterPow: 14, jitterTarget: 40, weapons: ['mukha', 'limonka', 'makarov', 'carbide'] },
  medium: {
    angles: 20, powers: 7, jitterAim: 30, jitterPow: 6, jitterTarget: 18,
    weapons: ['mukha', 'limonka', 'obrez', 'sling', 'makarov', 'mortar', 'carbide', 'kalash', 'uppercut', 'kukuruznik'],
  },
  hard: {
    angles: 40, powers: 12, jitterAim: 6, jitterPow: 2, jitterTarget: 4,
    weapons: ['mukha', 'limonka', 'obrez', 'sling', 'armatura', 'tnt', 'mortar', 'korsar', 'samogon', 'kalash', 'pulemet',
      'uppercut', 'mawashi', 'homing', 'kukuruznik', 'vanna', 'pochta'],
  },
};

/** Бот одного хода: план считается на первом кадре хода, дальше выдаёт ввод по кадрам. */
export class Bot {
  private plan: Plan | null = null;
  /** Чей ход планировали; сбрасывается, как только ход закончился. */
  private worm = -1;
  private t = 0;
  private wait = 0;
  /** Кадров подхода к врагу, если выгодного выстрела нет; после — подумать ещё раз. */
  private walk = 0;

  constructor(readonly level: BotLevel, private rand: () => number = Math.random) {}

  input(w: World): Input {
    if (w.phase !== 'turn') {
      this.worm = -1;
      return {};
    }
    const me = wormById(w, w.active)!;
    if (this.worm !== w.active || !this.plan) {
      this.plan = think(w, me, this.level, this.rand);
      this.worm = w.active;
      this.t = 0;
      this.wait = 30 + Math.floor(this.rand() * 40); // «подумать» — чтобы человек видел, кто ходит
      this.walk = this.plan.score <= 0 ? Math.min(w.left - 8 * TICK_HZ, 4 * TICK_HZ) : 0;
    }
    this.t++;
    if (this.t < this.wait) return {};
    if (this.walk > 0) {
      this.walk--;
      const foe = nearestFoe(w, me);
      if (!foe || me.state !== 'stand') return {};
      const dir = toPx(foe.x) < toPx(me.x) ? -1 : 1;
      // упёрся — прыжок; дошёл — подумать заново
      if (this.walk === 0 || len(toPx(foe.x) - toPx(me.x), toPx(foe.y) - toPx(me.y)) < 140) {
        this.walk = 0;
        this.plan = think(w, me, this.level, this.rand);
        return {};
      }
      return this.t % 50 === 49 ? { jump: 1 } : { move: dir };
    }
    const p = this.plan!;
    if (w.weapon !== p.weapon) return { weapon: p.weapon, fuse: p.fuse };
    if (p.target && (!w.target || w.target[0] !== p.target[0] || w.target[1] !== p.target[1])) return { target: p.target };
    if (me.facing !== p.facing) return { move: p.facing };
    if (me.state !== 'stand') return {};
    if (Math.abs(w.aim - p.aim) > 6) return { aim: w.aim < p.aim ? 1 : -1, fuse: p.fuse };
    const def = WEAPONS[p.weapon];
    if (def.auto) return { fire: true };
    if (!def.charged) return { fire: !w.firePrev };
    return { fire: w.charge < p.charge };
  }
}

function nearestFoe(w: World, me: Worm): Worm | undefined {
  let best: Worm | undefined, bd = Infinity;
  for (const x of w.worms) {
    if (x.state === 'dead' || x.team === me.team || w.teams[x.team].hidden) continue;
    const d = len(toPx(x.x) - toPx(me.x), toPx(x.y) - toPx(me.y));
    if (d < bd) [best, bd] = [x, d];
  }
  return best;
}

function think(w: World, me: Worm, level: BotLevel, rand: () => number): Plan {
  const L = LEVEL[level];
  const ammo = w.teams[w.team].ammo;
  let best: Plan = { weapon: 'kuryu', facing: me.facing, aim: 0, charge: 0, fuse: 3, score: -1 };
  for (const id of L.weapons) {
    if ((ammo[id] ?? 0) === 0) continue;
    const def = WEAPONS[id];
    if (def.target) {
      // по точке: над каждым видимым врагом
      for (const foe of w.worms) {
        if (foe.state === 'dead' || foe.team === me.team || w.teams[foe.team].hidden) continue;
        const target: [number, number] = [toPx(foe.x), toPx(foe.y)];
        const score = def.kind === 'strike' ? strikeScore(w, me, id, target[0]) : blast(w, me, target[0], target[1], def.radius!, def.damage!) * 0.8;
        const facing = target[0] < toPx(me.x) ? -1 : 1;
        if (score > best.score) best = { weapon: id, facing, aim: -640, charge: Math.round(CHARGE_MAX * 0.6), fuse: 3, score, target };
      }
      continue;
    }
    const powers = def.charged ? L.powers : 1;
    for (const facing of [1, -1] as const) {
      for (let ai = 0; ai < L.angles; ai++) {
        const aim = Math.round(-AIM_MAX + ((2 * AIM_MAX) / (L.angles - 1)) * ai);
        for (let pi = 1; pi <= powers; pi++) {
          const charge = def.charged ? Math.round((CHARGE_MAX * pi) / powers) : 0;
          const fuse = def.kind === 'grenade' ? 2 + (pi % 3) : 3;
          const score = evaluate(w, me, id, facing, aim, charge, fuse);
          if (score > best.score) best = { weapon: id, facing, aim, charge, fuse, score };
        }
      }
    }
  }
  // дрожание руки
  if (best.target) best.target = [best.target[0] + Math.round((rand() * 2 - 1) * L.jitterTarget), best.target[1]];
  best.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, best.aim + Math.round((rand() * 2 - 1) * L.jitterAim)));
  if (WEAPONS[best.weapon].charged) best.charge = Math.max(4, Math.min(CHARGE_MAX - 1, best.charge + Math.round((rand() * 2 - 1) * L.jitterPow)));
  if (best.score <= 0) best.weapon = (ammo.kuryu ?? 0) !== 0 ? 'kuryu' : best.weapon;
  return best;
}

/** Ожидаемая польза выстрела: урон врагам минус урон своим (свой боец — дороже). */
function evaluate(w: World, me: Worm, id: string, facing: 1 | -1, aim: number, charge: number, fuse: number): number {
  const def = WEAPONS[id];
  const tilt = def.meleeAim ?? aim;
  const ang = facing === 1 ? (tilt + ANG_FULL) % ANG_FULL : (ANG_FULL / 2 - tilt + ANG_FULL) % ANG_FULL;
  const mx = toPx(me.x), my = toPx(me.y);
  if (def.kind === 'hitscan' || def.kind === 'melee') {
    const range = def.range!;
    const [ex, ey] = fromAngle(ang, range * ONE);
    const ground = w.mask.raycast(mx, my, mx + toPx(ex), my + toPx(ey));
    const lim = ground ? len(ground[0] - mx, ground[1] - my) : range;
    let s = 0;
    for (const x of w.worms) {
      if (x.state === 'dead' || x.id === me.id) continue;
      const dx = toPx(x.x) - mx, dy = toPx(x.y) - my;
      const along = (dx * Math.cos((ang / ANG_FULL) * 2 * Math.PI) + dy * Math.sin((ang / ANG_FULL) * 2 * Math.PI));
      if (along < 0 || along > lim + WORM_R) continue;
      const off = Math.abs(dx * Math.sin((ang / ANG_FULL) * 2 * Math.PI) - dy * Math.cos((ang / ANG_FULL) * 2 * Math.PI));
      if (off > WORM_R) continue;
      // очередь разлетается — в цель идёт примерно половина
      const dmg = (def.damage ?? 0) * (def.kind === 'hitscan' ? (def.shots ?? 1) * (def.auto ? 0.5 : 1) : 1) + (def.push ?? 0) / 200;
      s += value(w, me, x, dmg);
      break; // пуля останавливается на первом
    }
    return s;
  }
  if (def.kind === 'placed') {
    return blast(w, me, mx + facing * 6, my, def.radius!, def.damage!) * 0.8;
  }
  if (def.kind !== 'missile' && def.kind !== 'grenade' && def.kind !== 'stone') return 0;
  const sp = Math.trunc((def.speed! * Math.max(8, charge)) / CHARGE_MAX);
  const [vx, vy] = fromAngle(ang, sp);
  const [ox, oy] = fromAngle(ang, (WORM_R + 4) * ONE);
  const b: Body = { x: me.x + ox, y: me.y + oy, vx, vy, r: def.r ?? 3, bounce: def.bounce ?? 0, slide: def.slide ?? 0 };
  const windAcc = def.wind ? Math.trunc((w.wind * 12) / 100) : 0;
  const life = def.kind === 'grenade' ? fuse * TICK_HZ : 600;
  for (let t = 0; t < life; t++) {
    const px = b.x, py = b.y;
    const hit = stepBody(b, w.mask, undefined, windAcc);
    if (toPx(b.y) > w.waterY || toPx(b.x) < -100 || toPx(b.x) > w.mask.w + 100) return 0;
    if (t > 3) {
      for (const x of w.worms) {
        if (x.state === 'dead' || (x.id === me.id && t < 7)) continue;
        if (nearSeg(toPx(x.x), toPx(x.y), toPx(px), toPx(py), toPx(b.x), toPx(b.y), WORM_R + b.r)) {
          if (def.kind === 'stone') return value(w, me, x, def.damage! + 8);
          if (def.kind === 'missile') return blast(w, me, toPx(b.x), toPx(b.y), def.radius!, def.damage!);
        }
      }
    }
    if (hit && def.kind === 'missile') return blast(w, me, toPx(b.x), toPx(b.y), def.radius!, def.damage!);
    if (hit && def.kind === 'stone') return 0;
  }
  return def.kind === 'grenade' ? blast(w, me, toPx(b.x), toPx(b.y), def.radius!, def.damage!) : 0;
}

/** Польза удара с неба над x: каждый груз падает до первой земли сверху. */
function strikeScore(w: World, me: Worm, id: string, x: number): number {
  const def = WEAPONS[id];
  const drop = WEAPONS[def.drop!];
  const n = def.drops!;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const dx = Math.trunc(((i * 2 - (n - 1)) * def.gap!) / 2);
    const sy = w.mask.surfaceBelow(x + dx, 0);
    if (sy < 0) continue;
    // мина с почты лежит и ждёт — половина цены
    s += drop.kind === 'mine' ? blast(w, me, x + dx, sy, drop.radius!, drop.damage!) * 0.5 : blast(w, me, x + dx, sy, drop.radius!, drop.damage!);
  }
  return s;
}

function blast(w: World, me: Worm, cx: number, cy: number, r: number, damage: number): number {
  const reach = r + WORM_R;
  let s = 0;
  for (const x of w.worms) {
    if (x.state === 'dead') continue;
    const d = len(toPx(x.x) - cx, toPx(x.y) - cy);
    if (d >= reach) continue;
    let dmg = (damage * (reach - d)) / reach;
    // толчок к жидкости — почти верный вылет
    if (toPx(x.y) > w.waterY - 80) dmg += 25;
    s += value(w, me, x, dmg);
  }
  return s;
}

function value(w: World, me: Worm, x: Worm, dmg: number): number {
  if (x.frozen > 0 || (x.team !== me.team && w.teams[x.team].hidden)) return 0;
  const kill = dmg >= x.hp ? 30 : 0;
  return x.team === me.team ? -(dmg + kill) * 1.6 : dmg + kill;
}

function nearSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy <= r * r;
}
