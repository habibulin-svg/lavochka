/* Настольный футбол «жми рычаги» — логика без DOM. Фигурки стоят на своих местах (1-4-3-3), у каждой рычаг: нажал — фигурка бьёт по мячу,
 * если он у её ноги; вратарь ещё и ездит поперёк ворот. Красные бьют вправо, синие — влево. Рычаги — по линиям (вратарь, защита, полузащита,
 * нападение: бьют все фигурки линии) или по одной фигурке (нажатием на неё). Мяч катится с трением, отскакивает от бортов и фигурок.
 * У ноги каждой фигурки — ямка: медленный мяч скатывается к ней (как на настоящих столах). Застрял — судья вбрасывает в центре. */

export const W = 0.9;
export const H = 0.58;
export const GOAL = 0.15;
export const BALL_R = 0.011;
export const BODY_R = 0.016;
/** До какого расстояния от ноги фигурка достаёт мяч. */
export const REACH = 0.034;
const FRICTION = 0.35;
const WALL = 0.7;
const KICK = 1.9;
const KICK_T = 0.25;

export type Line = 'G' | 'D' | 'M' | 'F';

export interface Fig {
  team: 0 | 1;
  line: Line;
  x: number;
  y: number;
  /** Куда бьёт: 0 — вправо (красные), π — влево (синие). */
  face: number;
  /** Время до конца удара (анимация и откат). */
  kick: number;
}

export type FootMode = 'bot0' | 'bot1' | 'bot2' | 'duel';

const LINES: { line: Line; x: number; ys: number[] }[] = [
  { line: 'G', x: 0.035, ys: [H / 2] },
  { line: 'D', x: 0.16, ys: [0.09, 0.22, 0.36, 0.49] },
  { line: 'M', x: 0.36, ys: [0.13, 0.29, 0.45] },
  { line: 'F', x: 0.62, ys: [0.12, 0.29, 0.46] },
];

export const footPos = (f: Fig) => ({ x: f.x + Math.cos(f.face) * BODY_R, y: f.y + Math.sin(f.face) * BODY_R });

export class Football {
  figs: Fig[] = [];
  bx = W / 2;
  by = H / 2;
  vx = 0;
  vy = 0;
  score: [number, number] = [0, 0];
  time: number;
  over = false;
  pause = 1;
  stuck = 0;
  lastGoal: 0 | 1 | null = null;
  sounds: ('kick' | 'wall' | 'goal' | 'post' | 'whistle')[] = [];
  private botT = [0, 0];

  constructor(
    readonly mode: FootMode,
    readonly goals = 5,
    minutes = 3,
    private seed = 1
  ) {
    this.time = minutes * 60;
    for (const team of [0, 1] as const)
      for (const L of LINES)
        for (const y of L.ys) this.figs.push({ team, line: L.line, x: team === 0 ? L.x : W - L.x, y: team === 0 ? y : H - y, face: team === 0 ? 0 : Math.PI, kick: 0 });
    this.drop();
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private drop() {
    this.bx = W / 2;
    this.by = H / 2 + (this.rnd() - 0.5) * 0.1;
    const a = this.rnd() * Math.PI * 2;
    const sp = 0.6 + this.rnd() * 0.5;
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp;
    this.pause = 0.8;
    this.stuck = 0;
    this.sounds.push('whistle');
  }

  /** Достаёт ли фигурка мяч. */
  reach(f: Fig): boolean {
    const p = footPos(f);
    const d = Math.hypot(this.bx - p.x, this.by - p.y);
    // мяч должен быть спереди или сбоку, не за спиной
    const front = (this.bx - f.x) * Math.cos(f.face) + (this.by - f.y) * Math.sin(f.face);
    return d < REACH && front > -BODY_R * 0.5;
  }

  /** Нажать рычаг фигурки. */
  kickFig(i: number) {
    const f = this.figs[i];
    if (!f || f.kick > 0 || this.over || this.pause > 0) return;
    f.kick = KICK_T;
    if (!this.reach(f)) return;
    // направление: вперёд с поправкой на то, где мяч относительно ноги
    const lat = (this.by - f.y) * Math.cos(f.face) - (this.bx - f.x) * Math.sin(f.face);
    const ang = f.face + Math.max(-0.7, Math.min(0.7, (lat / REACH) * 0.8)) + (this.rnd() - 0.5) * 0.12;
    const power = KICK * (f.line === 'G' ? 1.2 : 1) * (0.9 + this.rnd() * 0.2);
    this.vx = Math.cos(ang) * power;
    this.vy = Math.sin(ang) * power;
    this.sounds.push('kick');
  }

  /** Рычаги линии: бьют все фигурки линии. */
  kickLine(team: 0 | 1, line: Line) {
    this.figs.forEach((f, i) => f.team === team && f.line === line && this.kickFig(i));
  }

  /** Вратарь едет поперёк ворот: dir −1 вверх, 1 вниз. */
  moveKeeper(team: 0 | 1, dir: number, dt: number) {
    const g = this.figs.find((f) => f.team === team && f.line === 'G')!;
    g.y = Math.max(H / 2 - GOAL / 2 + BODY_R * 0.5, Math.min(H / 2 + GOAL / 2 - BODY_R * 0.5, g.y + dir * 0.5 * dt));
  }

  update(ms: number) {
    if (this.over) return;
    const dt = Math.min(0.05, ms / 1000);
    this.time -= dt;
    if (this.time <= 0) {
      this.time = 0;
      this.over = true;
      this.sounds.push('whistle');
      return;
    }
    for (const f of this.figs) f.kick = Math.max(0, f.kick - dt);
    if (this.mode !== 'duel') this.bot(1, this.mode === 'bot0' ? 0 : this.mode === 'bot1' ? 1 : 2, dt);
    if (this.pause > 0) {
      this.pause -= dt;
      return;
    }
    for (let k = 0; k < 4; k++) this.step(dt / 4);
    // застрял — вбрасывание
    if (Math.hypot(this.vx, this.vy) < 0.02) {
      this.stuck += dt;
      if (this.stuck > (this.figs.some((f) => this.reach(f)) ? 6 : 1.5)) this.drop();
    } else this.stuck = 0;
  }

  private step(dt: number) {
    // ямки у ног: медленный мяч скатывается к ближайшей
    if (Math.hypot(this.vx, this.vy) < 0.6) {
      for (const f of this.figs) {
        const p = footPos(f);
        const fx = f.x + Math.cos(f.face) * (BODY_R + BALL_R + 0.004);
        const fy = f.y + Math.sin(f.face) * (BODY_R + BALL_R + 0.004);
        const dx = fx - this.bx;
        const dy = fy - this.by;
        const d = Math.hypot(dx, dy);
        if (d < 0.075 && d > 0.002 && p) {
          const acc = 0.9 * (1 - d / 0.075);
          this.vx += (dx / d) * acc * dt;
          this.vy += (dy / d) * acc * dt;
        }
      }
    }
    this.bx += this.vx * dt;
    this.by += this.vy * dt;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - FRICTION * dt);
      this.vx *= ns / sp;
      this.vy *= ns / sp;
    }
    const r = BALL_R;
    const mouth = Math.abs(this.by - H / 2) < GOAL / 2 - r;
    if (mouth && (this.bx < -r * 1.5 || this.bx > W + r * 1.5)) {
      const scorer: 0 | 1 = this.bx < 0 ? 1 : 0;
      this.score[scorer]++;
      this.lastGoal = scorer;
      this.sounds.push('goal');
      if (this.score[scorer] >= this.goals) this.over = true;
      this.drop();
      return;
    }
    let hit = false;
    if (this.by < r) {
      this.by = r;
      if (this.vy < 0) (this.vy = -this.vy * WALL), (hit = true);
    }
    if (this.by > H - r) {
      this.by = H - r;
      if (this.vy > 0) (this.vy = -this.vy * WALL), (hit = true);
    }
    if (!mouth || (this.bx > 0 && this.bx < W)) {
      if (this.bx < r && !mouth) {
        this.bx = r;
        if (this.vx < 0) (this.vx = -this.vx * WALL), (hit = true);
      }
      if (this.bx > W - r && !mouth) {
        this.bx = W - r;
        if (this.vx > 0) (this.vx = -this.vx * WALL), (hit = true);
      }
    } else if (Math.abs(this.by - H / 2) > GOAL / 2 - r) this.vy = -this.vy;
    // штанги
    for (const gx of [0, W])
      for (const gy of [H / 2 - GOAL / 2, H / 2 + GOAL / 2]) {
        const dx = this.bx - gx;
        const dy = this.by - gy;
        const d = Math.hypot(dx, dy);
        if (d < r + 0.005 && d > 0) {
          const nx = dx / d;
          const ny = dy / d;
          this.bx = gx + nx * (r + 0.005);
          this.by = gy + ny * (r + 0.005);
          const vn = this.vx * nx + this.vy * ny;
          if (vn < 0) {
            this.vx -= (1 + WALL) * vn * nx;
            this.vy -= (1 + WALL) * vn * ny;
            this.sounds.push('post');
          }
        }
      }
    if (hit && Math.hypot(this.vx, this.vy) > 0.25) this.sounds.push('wall');
    // фигурки — препятствия
    for (const f of this.figs) {
      const dx = this.bx - f.x;
      const dy = this.by - f.y;
      const d = Math.hypot(dx, dy);
      const min = BODY_R + r;
      if (d >= min || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      this.bx = f.x + nx * min;
      this.by = f.y + ny * min;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= 1.6 * vn * nx;
        this.vy -= 1.6 * vn * ny;
      }
    }
  }

  /** Бот: вратарь следит за мячом; фигурка, до которой мяч дошёл, бьёт (с задержкой реакции). */
  bot(team: 0 | 1, lv: number, dt: number) {
    const g = this.figs.find((f) => f.team === team && f.line === 'G')!;
    // вратарь: туда, где мяч пересечёт линию ворот (если летит к ним), иначе — за мячом
    const gx = g.x;
    const toward = (gx - this.bx) * this.vx > 0 && Math.abs(this.vx) > 0.05;
    const cross = toward ? this.by + this.vy * ((gx - this.bx) / this.vx) : this.by;
    const aim = lv === 0 ? H / 2 + (this.by - H / 2) * 0.5 : cross;
    const ty = Math.max(H / 2 - GOAL / 2, Math.min(H / 2 + GOAL / 2, aim));
    const dy = ty - g.y;
    if (Math.abs(dy) > 0.004) this.moveKeeper(team, Math.sign(dy) * [0.45, 0.75, 1][lv], dt);
    this.botT[team] -= dt;
    if (this.botT[team] > 0) return;
    const i = this.figs.findIndex((f) => f.team === team && this.reach(f) && f.kick === 0);
    if (i < 0) return;
    // сильные ждут, пока мяч ляжет к ноге (удар точнее), но не упускают уходящий
    const f = this.figs[i];
    const p = footPos(f);
    const d = Math.hypot(this.bx - p.x, this.by - p.y);
    const leaving = (this.bx - p.x) * this.vx + (this.by - p.y) * this.vy > 0 && Math.hypot(this.vx, this.vy) > 0.25;
    if (lv > 0 && d > REACH * (lv === 2 ? 0.5 : 0.75) && !leaving) return;
    // реакция: лёгкий — медленно и иногда прозевает
    if (lv === 0 && this.rnd() < 0.4) {
      this.botT[team] = 0.3;
      return;
    }
    this.botT[team] = [0.35, 0.18, 0.06][lv];
    this.kickFig(i);
  }

  result(): number {
    const [a, b] = this.score;
    if (a > b) return 1000 * (this.mode === 'bot2' ? 3 : this.mode === 'bot1' ? 2 : 1) + (a - b) * 100 + Math.round(this.time);
    return a * 50;
  }
}
