/* Настольный баскетбол «щелчок — и в кольцо» — логика без DOM. Вид сбоку: у каждого игрока катапульта в ямке на полу,
 * кольца со щитами — у дальних стенок (красные бросают в правое, синие — в левое). Пол с горбом посередине: мяч скатывается в ближнюю ямку.
 * Мяч в своей катапульте — держишь кнопку, сила растёт; отпустил — бросок под постоянным углом. Попал сверху в кольцо — 2 очка.
 * Единицы — метры (x вправо, y вверх), секунды. */

export const W = 1.0;
export const HGT = 0.6;
export const BALL_R = 0.018;
const G = 3.2;
export const RIM = { y: 0.4, half: 0.04, from: 0.075 };
export const BOARD = { x: 0.035, top: 0.52, bottom: 0.36 };
/** Катапульты: x, угол броска. */
export const CATS = [
  { x: 0.2, ang: (62 * Math.PI) / 180 },
  { x: W - 0.2, ang: Math.PI - (62 * Math.PI) / 180 },
];

/** Высота пола: ямки у катапульт, горб посередине, приподнятые края у стенок. */
export function floor(x: number): number {
  const pit = (cx: number) => 0.028 * Math.exp(-(((x - cx) / 0.05) ** 2));
  const hump = 0.05 * Math.exp(-(((x - W / 2) / 0.18) ** 2));
  const edge = 0.06 * (Math.exp(-((x / 0.08) ** 2)) + Math.exp(-(((W - x) / 0.08) ** 2)));
  return 0.04 + hump + edge - pit(CATS[0].x) - pit(CATS[1].x);
}
const slope = (x: number) => (floor(x + 0.001) - floor(x - 0.001)) / 0.002;

export type BMode = 'bot0' | 'bot1' | 'bot2' | 'duel';

export class Basket {
  x = W / 2;
  y = HGT * 0.8;
  vx = 0;
  vy = 0;
  score: [number, number] = [0, 0];
  time: number;
  over = false;
  /** Набор силы (0…1) у каждого, пока держит кнопку. */
  charge: [number, number] = [0, 0];
  holding: [boolean, boolean] = [false, false];
  /** Чей мяч лежит в катапульте (−1 — ничей). */
  owner = -1;
  rest = 0;
  lastScore: 0 | 1 | null = null;
  sounds: ('shot' | 'rim' | 'board' | 'score' | 'bounce' | 'whistle')[] = [];
  private botT = [0, 0];
  private botAim = [0.6, 0.6];

  constructor(
    readonly mode: BMode,
    readonly points = 21,
    minutes = 3,
    private seed = 1
  ) {
    this.time = minutes * 60;
    this.drop();
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Спорный: мяч падает над серединой. */
  private drop() {
    this.x = W / 2 + (this.rnd() - 0.5) * 0.04;
    this.y = HGT * 0.85;
    this.vx = (this.rnd() - 0.5) * 0.3;
    this.vy = 0;
    this.owner = -1;
    this.sounds.push('whistle');
  }

  /** Нажал / отпустил кнопку катапульты. */
  press(team: 0 | 1, down: boolean) {
    if (this.over) return;
    if (down) {
      this.holding[team] = true;
      return;
    }
    if (!this.holding[team]) return;
    this.holding[team] = false;
    const p = this.charge[team];
    this.charge[team] = 0;
    if (this.owner === team) this.launch(team, p);
  }

  /** Бросок с силой p (0…1). */
  launch(team: 0 | 1, p: number) {
    const c = CATS[team];
    const v = 1.0 + Math.max(0, Math.min(1, p)) * 2.4;
    this.vx = Math.cos(c.ang) * v;
    this.vy = Math.sin(c.ang) * v;
    this.y += 0.01;
    this.owner = -1;
    this.sounds.push('shot');
  }

  /** Какая сила нужна, чтобы попасть в кольцо (для бота): перебором. */
  static needed(team: 0 | 1): number {
    let best = 0.5;
    let bd = Infinity;
    for (let p = 0; p <= 1; p += 0.002) {
      const c = CATS[team];
      const v = 1.0 + p * 2.4;
      const vx = Math.cos(c.ang) * v;
      const vy = Math.sin(c.ang) * v;
      const rimX = team === 0 ? W - RIM.from : RIM.from;
      const t = (rimX - c.x) / vx;
      if (t <= 0) continue;
      const y = floor(c.x) + BALL_R + vy * t - (G * t * t) / 2;
      // на подлёте к кольцу мяч должен падать
      if (vy - G * t > 0) continue;
      const d = Math.abs(y - RIM.y - 0.01);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
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
    for (const t of [0, 1] as const) if (this.holding[t]) this.charge[t] = Math.min(1, this.charge[t] + dt * 0.8);
    if (this.mode !== 'duel') this.bot(1, this.mode === 'bot0' ? 0 : this.mode === 'bot1' ? 1 : 2, dt);
    if (this.owner >= 0) return;
    for (let k = 0; k < 6; k++) this.step(dt / 6);
  }

  private step(dt: number) {
    const r = BALL_R;
    this.vy -= G * dt;
    const py = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // стенки и потолок
    if (this.x < r) (this.x = r), (this.vx = Math.abs(this.vx) * 0.6);
    if (this.x > W - r) (this.x = W - r), (this.vx = -Math.abs(this.vx) * 0.6);
    if (this.y > HGT - r) (this.y = HGT - r), (this.vy = -Math.abs(this.vy) * 0.5);
    // щиты
    for (const side of [0, 1]) {
      const bx = side === 0 ? BOARD.x : W - BOARD.x;
      if (this.y > BOARD.bottom && this.y < BOARD.top && Math.abs(this.x - bx) < r) {
        this.x = bx + (side === 0 ? r : -r);
        this.vx = (side === 0 ? 1 : -1) * Math.abs(this.vx) * 0.55;
        this.sounds.push('board');
      }
    }
    // дужки колец: две точки
    for (const side of [0, 1]) {
      const cx = side === 0 ? RIM.from : W - RIM.from;
      for (const ex of [cx - RIM.half, cx + RIM.half]) {
        const dx = this.x - ex;
        const dy = this.y - RIM.y;
        const d = Math.hypot(dx, dy);
        if (d < r + 0.003 && d > 0) {
          const nx = dx / d;
          const ny = dy / d;
          this.x = ex + nx * (r + 0.003);
          this.y = RIM.y + ny * (r + 0.003);
          const vn = this.vx * nx + this.vy * ny;
          if (vn < 0) {
            this.vx -= 1.6 * vn * nx;
            this.vy -= 1.6 * vn * ny;
            this.sounds.push('rim');
          }
        }
      }
      // попадание: центр мяча прошёл сверху вниз через кольцо между дужками
      if (py >= RIM.y && this.y < RIM.y && Math.abs(this.x - cx) < RIM.half - r * 0.3 && this.vy < 0) {
        const scorer: 0 | 1 = side === 1 ? 0 : 1;
        this.score[scorer] += 2;
        this.lastScore = scorer;
        this.sounds.push('score');
        if (this.score[scorer] >= this.points) this.over = true;
        // мяч проваливается в корзину и выпадает вниз
        this.vx *= 0.2;
        this.vy = Math.min(this.vy, -0.3);
      }
    }
    // пол
    const fy = floor(this.x) + r;
    if (this.y < fy) {
      this.y = fy;
      const s = slope(this.x);
      const n = Math.hypot(1, s);
      const nx = -s / n;
      const ny = 1 / n;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        if (vn < -0.4) this.sounds.push('bounce');
        this.vx -= 1.45 * vn * nx;
        this.vy -= 1.45 * vn * ny;
      }
      // качение: скатывается по склону, трение
      this.vx += -s * G * 0.6 * dt;
      this.vx *= 1 - 1.2 * dt;
      // лёг в ямку катапульты
      for (const t of [0, 1] as const) {
        if (Math.abs(this.x - CATS[t].x) < 0.012 && Math.hypot(this.vx, this.vy) < 0.25) {
          this.x = CATS[t].x;
          this.y = floor(CATS[t].x) + r;
          this.vx = this.vy = 0;
          this.owner = t;
          this.rest = 0;
        }
      }
    }
  }

  bot(team: 0 | 1, lv: number, dt: number) {
    if (this.owner !== team) {
      this.botT[team] = [0.9, 0.6, 0.4][lv] + this.rnd() * 0.3;
      if (this.holding[team]) this.holding[team] = false;
      this.charge[team] = 0;
      return;
    }
    if (this.botT[team] > 0) {
      this.botT[team] -= dt;
      if (this.botT[team] <= 0) this.botAim[team] = Basket.needed(team) + (this.rnd() - 0.5) * [0.12, 0.05, 0.02][lv];
      return;
    }
    // бросок сразу с нужной силой (бот «знает» её с ошибкой по уровню)
    this.launch(team, this.botAim[team]);
  }

  result(): number {
    const [a, b] = this.score;
    if (a > b) return 1000 * (this.mode === 'bot2' ? 3 : this.mode === 'bot1' ? 2 : 1) + (a - b) * 20 + Math.round(this.time);
    return a * 10;
  }
}
