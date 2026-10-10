/* Настольный хоккей «на штырьках» — логика без DOM. Площадка сверху, длинная ось — слева направо; красные защищают левые ворота, синие — правые.
 * В команде шесть фигурок на прорезях: вратарь (поперёк у ворот), два защитника и три нападающих (вдоль поля). Фигурка ездит по своей прорези
 * и вращается — клюшка бьёт шайбу. Игрок управляет фигуркой, что ближе к шайбе (переключается сама); движение — вдоль прорези, поворот — клюшкой.
 * Единицы — метры, секунды. Шайба скользит с трением, отскакивает от бортов (скруглённые углы), гол — шайба целиком за линией ворот в створе. */

export const W = 0.9;
export const H = 0.54;
export const CORNER = 0.08;
export const GOAL = 0.13;
export const PUCK_R = 0.0125;
export const BODY_R = 0.018;
export const STICK = 0.045;
const FRICTION = 0.28;
const WALL = 0.82;

export interface Slot {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Fig {
  team: 0 | 1;
  role: 'G' | 'D' | 'F';
  slot: Slot;
  /** Положение на прорези 0…1. */
  s: number;
  /** Угол клюшки и угловая скорость. */
  a: number;
  w: number;
  /** Скорость вдоль прорези (м/с), для удара по шайбе. */
  vs: number;
}

export interface Input {
  /** Куда тянут фигурку на экране (−1…1 по x и y): она едет по прорези, насколько это направление вдоль неё. */
  dx: number;
  dy: number;
  /** Вращение: −1 — против часовой, 1 — по часовой. */
  turn: number;
}

/** Прорези для левой команды (красных); у правой — зеркально. */
function slots(team: 0 | 1): { role: Fig['role']; slot: Slot }[] {
  const m = (x: number) => (team === 0 ? x : W - x);
  const S = (ax: number, ay: number, bx: number, by: number) => ({ ax: m(ax), ay, bx: m(bx), by });
  return [
    { role: 'G', slot: S(0.055, H / 2 - 0.09, 0.055, H / 2 + 0.09) },
    { role: 'D', slot: S(0.11, 0.13, 0.36, 0.13) },
    { role: 'D', slot: S(0.11, H - 0.13, 0.36, H - 0.13) },
    { role: 'F', slot: S(0.33, H / 2, 0.8, H / 2) },
    { role: 'F', slot: S(0.42, 0.06, 0.82, 0.07) },
    { role: 'F', slot: S(0.42, H - 0.06, 0.82, H - 0.07) },
  ];
}

export const figPos = (f: Fig) => ({ x: f.slot.ax + (f.slot.bx - f.slot.ax) * f.s, y: f.slot.ay + (f.slot.by - f.slot.ay) * f.s });
const slotLen = (s: Slot) => Math.hypot(s.bx - s.ax, s.by - s.ay);

/** Знак «вперёд» по прорези: +1 — рост s ведёт к чужим воротам (у вратаря — вниз). */
export const fwdOf = (f: Fig) => ((f.slot.bx - f.slot.ax) * (f.team === 0 ? 1 : -1) >= 0 ? 1 : -1);

export type HockeyMode = 'bot0' | 'bot1' | 'bot2' | 'duel';

export class Hockey {
  figs: Fig[] = [];
  px = W / 2;
  py = H / 2;
  pvx = 0;
  pvy = 0;
  score: [number, number] = [0, 0];
  /** Оставшееся время, с. */
  time: number;
  over = false;
  /** Пауза после гола (вбрасывание). */
  faceoff = 1.2;
  /** Активная фигурка у каждой команды. */
  active: [number, number] = [3, 9];
  sounds: ('hit' | 'wall' | 'goal' | 'post' | 'whistle')[] = [];
  lastGoal: 0 | 1 | null = null;

  constructor(
    readonly mode: HockeyMode,
    readonly goals = 5,
    minutes = 3,
    private seed = 1
  ) {
    this.time = minutes * 60;
    for (const team of [0, 1] as const)
      for (const { role, slot } of slots(team)) {
        this.figs.push({ team, role, slot, s: role === 'G' ? 0.5 : role === 'F' && slot.ay === H / 2 ? 0.05 : 0.3, a: team === 0 ? 0 : Math.PI, w: 0, vs: 0 });
      }
    this.drop();
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Вбрасывание в центре. */
  private drop() {
    this.px = W / 2;
    this.py = H / 2;
    this.pvx = (this.rnd() - 0.5) * 0.05;
    this.pvy = (this.rnd() - 0.5) * 0.4;
    this.faceoff = 1.0;
    this.sounds.push('whistle');
  }

  /** Ближайшая к шайбе фигурка команды (с запасом, чтобы не дёргалось). */
  private pick(team: 0 | 1) {
    const cur = this.active[team];
    let best = cur;
    let bd = Infinity;
    this.figs.forEach((f, i) => {
      if (f.team !== team) return;
      const p = figPos(f);
      // как далеко фигурка может дотянуться: ближайшая точка прорези к шайбе
      const sl = f.slot;
      const ex = sl.bx - sl.ax;
      const ey = sl.by - sl.ay;
      const u = Math.max(0, Math.min(1, ((this.px - sl.ax) * ex + (this.py - sl.ay) * ey) / (ex * ex + ey * ey)));
      const d = Math.hypot(sl.ax + ex * u - this.px, sl.ay + ey * u - this.py) + 0.3 * Math.hypot(p.x - this.px, p.y - this.py);
      if (d < bd - (i === cur ? -0.02 : 0)) {
        bd = d;
        best = i;
      }
    });
    this.active[team] = best;
  }

  /** Шаг игры. inputs[0] — красные, inputs[1] — синие (в игре с ботом синие ходят сами). */
  update(ms: number, inputs: [Input, Input]) {
    if (this.over) return;
    const dt = Math.min(0.05, ms / 1000);
    this.time -= dt;
    if (this.time <= 0) {
      this.time = 0;
      this.over = true;
      this.sounds.push('whistle');
      return;
    }
    for (const team of [0, 1] as const) this.pick(team);
    if (this.mode !== 'duel') inputs = [inputs[0], this.bot(1, this.mode === 'bot0' ? 0 : this.mode === 'bot1' ? 1 : 2)];
    // фигурки
    for (const team of [0, 1] as const) {
      const f = this.figs[this.active[team]];
      const inp = inputs[team];
      const len = slotLen(f.slot);
      const ux = (f.slot.bx - f.slot.ax) / len;
      const uy = (f.slot.by - f.slot.ay) / len;
      const along = Math.max(-1, Math.min(1, inp.dx * ux + inp.dy * uy));
      const sp = 0.9; // м/с вдоль прорези
      const ds = (along * sp * dt) / len;
      const ns = Math.max(0, Math.min(1, f.s + ds));
      f.vs = ((ns - f.s) * len) / dt;
      f.s = ns;
      f.w = inp.turn * 26;
      f.a += f.w * dt;
      // остальные фигурки команды — без движения
      for (const g of this.figs) if (g.team === team && g !== f) {
        g.w = 0;
        g.vs = 0;
      }
    }
    if (this.faceoff > 0) {
      this.faceoff -= dt;
      return;
    }
    // шайба
    const steps = 4;
    for (let k = 0; k < steps; k++) this.puckStep(dt / steps);
  }

  private puckStep(dt: number) {
    this.px += this.pvx * dt;
    this.py += this.pvy * dt;
    const sp = Math.hypot(this.pvx, this.pvy);
    if (sp > 0) {
      const ns = Math.max(0, sp - FRICTION * dt);
      this.pvx *= ns / sp;
      this.pvy *= ns / sp;
    }
    // ворота
    const inGoal = Math.abs(this.py - H / 2) < GOAL / 2 - PUCK_R;
    if (inGoal && (this.px < -PUCK_R * 1.5 || this.px > W + PUCK_R * 1.5)) {
      const scorer: 0 | 1 = this.px < 0 ? 1 : 0;
      this.score[scorer]++;
      this.lastGoal = scorer;
      this.sounds.push('goal');
      if (this.score[scorer] >= this.goals) this.over = true;
      this.drop();
      return;
    }
    // борта (в створе ворот — проход, за линией — сетка)
    if (!inGoal || (this.px > 0 && this.px < W)) this.walls();
    else {
      // в воротах: сетка по бокам и сзади
      if (Math.abs(this.py - H / 2) > GOAL / 2 - PUCK_R) this.pvy = -this.pvy;
    }
    // фигурки
    for (const f of this.figs) this.hitFig(f);
  }

  private walls() {
    const r = PUCK_R;
    let hit = false;
    // скруглённые углы
    for (const [cx, cy] of [
      [CORNER, CORNER],
      [W - CORNER, CORNER],
      [W - CORNER, H - CORNER],
      [CORNER, H - CORNER],
    ]) {
      const inX = cx === CORNER ? this.px < cx : this.px > cx;
      const inY = cy === CORNER ? this.py < cy : this.py > cy;
      if (!inX || !inY) continue;
      const dx = this.px - cx;
      const dy = this.py - cy;
      const d = Math.hypot(dx, dy);
      if (d > CORNER - r) {
        const nx = dx / d;
        const ny = dy / d;
        this.px = cx + nx * (CORNER - r);
        this.py = cy + ny * (CORNER - r);
        const vn = this.pvx * nx + this.pvy * ny;
        if (vn > 0) {
          this.pvx -= (1 + WALL) * vn * nx;
          this.pvy -= (1 + WALL) * vn * ny;
          hit = true;
        }
      }
    }
    const inGoalMouth = Math.abs(this.py - H / 2) < GOAL / 2;
    if (this.px < r && !inGoalMouth) {
      this.px = r;
      if (this.pvx < 0) (this.pvx = -this.pvx * WALL), (hit = true);
    }
    if (this.px > W - r && !inGoalMouth) {
      this.px = W - r;
      if (this.pvx > 0) (this.pvx = -this.pvx * WALL), (hit = true);
    }
    if (this.py < r) {
      this.py = r;
      if (this.pvy < 0) (this.pvy = -this.pvy * WALL), (hit = true);
    }
    if (this.py > H - r) {
      this.py = H - r;
      if (this.pvy > 0) (this.pvy = -this.pvy * WALL), (hit = true);
    }
    // штанги
    for (const gx of [0, W])
      for (const gy of [H / 2 - GOAL / 2, H / 2 + GOAL / 2]) {
        const dx = this.px - gx;
        const dy = this.py - gy;
        const d = Math.hypot(dx, dy);
        if (d < r + 0.004 && d > 0) {
          const nx = dx / d;
          const ny = dy / d;
          this.px = gx + nx * (r + 0.004);
          this.py = gy + ny * (r + 0.004);
          const vn = this.pvx * nx + this.pvy * ny;
          if (vn < 0) {
            this.pvx -= (1 + WALL) * vn * nx;
            this.pvy -= (1 + WALL) * vn * ny;
            this.sounds.push('post');
          }
        }
      }
    if (hit && Math.hypot(this.pvx, this.pvy) > 0.2) this.sounds.push('wall');
  }

  /** Шайба о фигурку: тело — круг, клюшка — отрезок, вращающийся с угловой скоростью w. */
  private hitFig(f: Fig) {
    const p = figPos(f);
    const sx = Math.cos(f.a);
    const sy = Math.sin(f.a);
    // ближайшая точка клюшки (от края тела до конца) к шайбе
    const rel = (this.px - p.x) * sx + (this.py - p.y) * sy;
    const u = Math.max(0, Math.min(STICK, rel));
    const cx = p.x + sx * u;
    const cy = p.y + sy * u;
    const dBody = Math.hypot(this.px - p.x, this.py - p.y);
    let nx: number;
    let ny: number;
    let vx: number;
    let vy: number;
    let reach: number;
    const ex = (f.slot.bx - f.slot.ax) / slotLen(f.slot);
    const ey = (f.slot.by - f.slot.ay) / slotLen(f.slot);
    if (dBody < BODY_R + PUCK_R) {
      nx = (this.px - p.x) / (dBody || 1);
      ny = (this.py - p.y) / (dBody || 1);
      reach = BODY_R + PUCK_R - dBody;
      vx = ex * f.vs;
      vy = ey * f.vs;
    } else {
      const d = Math.hypot(this.px - cx, this.py - cy);
      if (d >= PUCK_R + 0.003 || d === 0) return;
      nx = (this.px - cx) / d;
      ny = (this.py - cy) / d;
      reach = PUCK_R + 0.003 - d;
      // скорость точки клюшки: вращение + движение по прорези
      vx = -f.w * u * sy + ex * f.vs;
      vy = f.w * u * sx + ey * f.vs;
    }
    this.px += nx * reach;
    this.py += ny * reach;
    const relv = (this.pvx - vx) * nx + (this.pvy - vy) * ny;
    if (relv < 0) {
      this.pvx -= 1.6 * relv * nx;
      this.pvy -= 1.6 * relv * ny;
      // предел скорости шайбы
      const sp = Math.hypot(this.pvx, this.pvy);
      if (sp > 3.2) {
        this.pvx *= 3.2 / sp;
        this.pvy *= 3.2 / sp;
      }
      if (Math.abs(relv) > 0.15) this.sounds.push('hit');
    }
  }

  /** Бот: подводит активную фигурку к шайбе и бьёт к чужим воротам. */
  bot(team: 0 | 1, lv: number): Input {
    const f = this.figs[this.active[team]];
    const goalX = team === 1 ? 0 : W;
    const back = team === 1 ? 1 : -1;
    const p = figPos(f);
    // куда встать на прорези: к проекции шайбы (с упреждением)
    const look = [0.05, 0.12, 0.18][lv];
    const tx = this.px + this.pvx * look;
    const ty = this.py + this.pvy * look;
    const sl = f.slot;
    const ex = sl.bx - sl.ax;
    const ey = sl.by - sl.ay;
    const L2 = ex * ex + ey * ey;
    let u = Math.max(0, Math.min(1, ((tx - sl.ax) * ex + (ty - sl.ay) * ey) / L2));
    // встать чуть за шайбой со стороны своих ворот, чтобы бить к чужим
    if (f.role !== 'G' && ex) u = Math.max(0, Math.min(1, u + (0.035 * back * Math.sign(ex)) / Math.sqrt(L2)));
    const diff = (u - f.s) * Math.sqrt(L2);
    const move = Math.max(-1, Math.min(1, diff / 0.03)) * [0.55, 0.8, 1][lv];
    const L = Math.sqrt(L2);
    // удар: шайба рядом — вращаем так, чтобы клюшка шла к левым воротам
    const d = Math.hypot(this.px - p.x, this.py - p.y);
    let turn = 0;
    if (d < STICK + PUCK_R + 0.02) {
      const toGoal = Math.atan2(H / 2 - this.py, goalX - this.px);
      const toPuck = Math.atan2(this.py - p.y, this.px - p.x);
      // клюшка должна догнать направление на шайбу, вращаясь в сторону, противоположную воротам
      let diffA = toPuck - toGoal;
      while (diffA > Math.PI) diffA -= 2 * Math.PI;
      while (diffA < -Math.PI) diffA += 2 * Math.PI;
      turn = diffA > 0 ? -1 : 1;
      if (lv === 0 && this.rnd() < 0.3) turn = 0;
    } else {
      // клюшкой — в сторону шайбы, не спеша
      let da = Math.atan2(this.py - p.y, this.px - p.x) - f.a;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      turn = Math.abs(da) > 0.3 ? Math.sign(da) * 0.4 : 0;
    }
    return { dx: (ex / L) * move, dy: (ey / L) * move, turn };
  }

  /** Очки для рекордов (игра с компьютером): победа — 1000 + разница × 100 + время, иначе — забитые × 50. */
  result(): number {
    const [a, b] = this.score;
    if (a > b) return 1000 * (this.mode === 'bot2' ? 3 : this.mode === 'bot1' ? 2 : 1) + (a - b) * 100 + Math.round(this.time);
    return a * 50;
  }
}
