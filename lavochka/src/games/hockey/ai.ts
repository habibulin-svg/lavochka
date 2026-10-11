/* Бот настольного хоккея: тот же ввод, что у человека (штанга полевого и штанга вратаря), видит только снимок поля.
 * Полевой: встаёт так, чтобы крюк на прокрутке шёл к чужим воротам, отводит клюшку назад (замах — сам поворот штанги) и крутит.
 * Вратарь: держит створ против шайбы, плоскостью поперёк, близкую шайбу выбивает от ворот. */
import type { Rng } from '../../core/types';
import { figPos, G_BACK, G_STICK, GL, GOAL, H, oppGoal, PUCK_R, reach, SLOTS, slotNearest, type HkIn, type HkState, type Team, W } from './engine';

interface Level {
  /** Упреждение по шайбе, с; скорость рук (доля от полной); как часто думает, с; разброс прицела, рад; отвод клюшки, рад. */
  look: number;
  speed: number;
  think: number;
  aim: number;
  wind: number;
  goalie: number;
}

export const LEVELS: Level[] = [
  { look: 0, speed: 0.55, think: 0.22, aim: 0.6, wind: 1.1, goalie: 0.45 },
  { look: 0.04, speed: 0.8, think: 0.1, aim: 0.3, wind: 1.8, goalie: 0.75 },
  { look: 0.07, speed: 1, think: 0.03, aim: 0.1, wind: 2.5, goalie: 1 },
];

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Mem {
  next?: number;
  t?: number;
  /** Удар: сколько ещё можно крутить (страховка), куда и до какого угла. */
  strike?: number;
  sig?: number;
  end?: number;
  gStrike?: number;
  gSig?: number;
  gEnd?: number;
}

/** Штанга бьёт шайбу в сторону g: куда крутить — отвести клюшку, бить или ждать. */
function swing(st: HkState, i: number, g: [number, number], wind: number, mem: { strike?: number; sig?: number; end?: number }, dt: number): number {
  const f = st.figs[i];
  const [cx, cy] = figPos(st, i);
  const dx = st.puck.x - cx;
  const dy = st.puck.y - cy;
  const dist = Math.hypot(dx, dy);
  // удар доводим, пока клюшка не пройдёт шайбу, — и отпускаем: иначе второй оборот отобьёт её назад
  if ((mem.strike ?? 0) > 0) {
    mem.strike! -= dt;
    const sg = mem.sig ?? 1;
    if (sg * ((mem.end ?? f.a) - f.a) > 0) return sg;
    mem.strike = 0;
    return 0;
  }
  const sig = dx * g[1] - dy * g[0] >= 0 ? 1 : -1;
  const toPuck = Math.atan2(dy, dx);
  if (dist < reach(i) + PUCK_R + 0.004) {
    // сколько клюшке ещё крутиться в сторону удара до шайбы
    const delta = wrap(sig * (toPuck - f.a));
    if (delta > TAU - 0.35) return -sig * 0.7; // клюшка только что прошла шайбу — назад, не задевая
    if (delta >= wind) {
      mem.strike = 0.4;
      mem.sig = sig;
      mem.end = f.a + sig * (delta + 0.6);
      return sig;
    }
    return -sig * 0.7;
  }
  // шайба далеко: спокойно держим клюшку отведённой
  const want = toPuck - sig * wind;
  let d = want - f.a;
  d = ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return Math.abs(d) > 0.15 ? clamp(d * 1.5, -0.3, 0.3) : 0;
}

export function botInput(st: HkState, seat: number, level: number, m: Record<string, any>, rng: Rng): HkIn {
  const mem = m as Mem & { fi?: number; tS?: number; tG?: number; gd?: [number, number] };
  const lv = LEVELS[clamp(level, 0, 2)];
  const team = (seat === 0 ? 0 : 1) as Team;
  const fwd = team === 0 ? 1 : -1;
  // время игры: при замедленной физике бот думает и бьёт в том же темпе, что и мир
  const dt = (st.speed || 1) / 60;
  mem.t = (mem.t ?? 0) + dt;
  const p = st.puck;
  const lx = p.x + p.vx * lv.look;
  const ly = p.y + p.vy * lv.look;
  const frozen = st.goalT > 0;
  const fi = team * 6 + st.active[team];
  const gi = team * 6;
  const gsl = SLOTS[gi];
  const gf = st.figs[gi];
  const [gcx, gcy] = figPos(st, gi);

  // куда встать — решает не каждый шаг (реакция по уровню); крутит — каждый шаг
  if (mem.next == null || mem.t >= mem.next || mem.fi !== fi) {
    mem.next = mem.t + lv.think * (0.6 + rng.next() * 0.8);
    mem.fi = fi;
    const fs = SLOTS[fi];
    const [gx, gy] = oppGoal(team);
    let ang = Math.atan2(gy - ly, gx - lx) + (rng.next() - 0.5) * 2 * lv.aim;
    // в своей зоне сойдёт и просто выбить вперёд
    if ((lx - W / 2) * fwd < -0.1 && Math.cos(ang) * fwd < 0.3) ang = fwd > 0 ? 0 : Math.PI;
    mem.gd = [Math.cos(ang), Math.sin(ang)];
    // встать так, чтобы шайба была на крюке, а крюк шёл к цели: центр = шайба + σ·r·⊥g
    let bestS = slotNearest(fs, lx, ly).s;
    let bestE = Infinity;
    for (const sig of [1, -1])
      for (const r of [0.02, 0.027, 0.033]) {
        const n = slotNearest(fs, lx - sig * r * mem.gd[1], ly + sig * r * mem.gd[0]);
        if (n.d < bestE) {
          bestE = n.d;
          bestS = n.s;
        }
      }
    mem.tS = bestS;
    // вратарь: куда шайба придёт на его линию (с отскоком от бортов); слабый смотрит больше на саму шайбу
    let pred = H / 2 + (p.y - H / 2) * 0.5;
    if (p.vx * fwd < -0.05) {
      let y = p.y + (p.vy * (gcx - p.x)) / p.vx;
      for (let k = 0; k < 4 && (y < 0 || y > H); k++) y = y < 0 ? -y : 2 * H - y;
      pred = y;
    }
    const ty = clamp(p.y + (pred - p.y) * lv.goalie, H / 2 - GOAL / 2, H / 2 + GOAL / 2);
    // жестянка несимметрична (крюк длиннее) — ставим в створ её середину
    const off = ((G_STICK - G_BACK) / 2) * Math.sin(gf.a);
    const ownX = team === 0 ? GL : W - GL;
    mem.tG = slotNearest(gsl, ownX + fwd * 0.03, ty - off).s;
  }

  // полевой
  const fs = SLOTS[fi];
  const f = st.figs[fi];
  const move = clamp(((mem.tS! - f.s) * fs.len) / 0.02, -1, 1) * lv.speed;
  const [cx] = figPos(st, fi);
  const ownEnd = team === 0 ? 0 : W;
  // шайба за спиной у своих ворот — не крутим (любое касание — к себе), только заслоняем
  const behind = (p.x - cx) * fwd < -0.005 && Math.abs(p.x - ownEnd) < 0.16;
  let fr = behind && !(mem.strike! > 0) ? 0 : swing(st, fi, mem.gd!, lv.wind, mem, dt);

  // вратарь
  const gMove = clamp(((mem.tG! - gf.s) * gsl.len) / 0.015, -1, 1) * lv.goalie;
  // выбивать — только шайбу перед собой и не летящую: за спиной у ворот любое касание — к себе в ворота
  const ahead = (p.x - gcx) * fwd > 0.006;
  const near = ahead && Math.hypot(p.vx, p.vy) < 0.9 && Math.hypot(p.x - gcx, p.y - gcy) < reach(gi) + PUCK_R + 0.006;
  let gr: number;
  if (near || ((mem.gStrike ?? 0) > 0 && ahead)) {
    const out: [number, number] = [fwd, (p.y < H / 2 ? -1 : 1) * 0.6];
    const gm = { strike: mem.gStrike, sig: mem.gSig, end: mem.gEnd };
    gr = swing(st, gi, out, 1.2, gm, dt);
    mem.gStrike = gm.strike;
    mem.gSig = gm.sig;
    mem.gEnd = gm.end;
  } else {
    // плоскостью поперёк ворот: крюк вдоль прорези
    let d = Math.PI / 2 - gf.a;
    d = ((((d + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
    gr = Math.abs(d) > 0.12 ? clamp(d * 1.5, -0.3, 0.3) : 0;
  }
  if (frozen) fr = gr = 0;
  return { f: { m: frozen ? 0 : move, r: fr }, g: { m: frozen ? 0 : gMove, r: gr }, pick: -1, knock: 0 };
}
