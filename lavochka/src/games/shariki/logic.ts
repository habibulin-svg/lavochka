/* «Шарики» — цепочка катится к яме, логика без DOM. Поле 800×600 (единицы — точки). Путь — спираль от края к яме (форма — по уровню),
 * цепочку толкают сзади; лягушка в середине стреляет шаром по прямой: попал в цепочку — шар встаёт в неё; три и больше одного цвета подряд
 * исчезают. Разрыв стягивается, если по краям шары одного цвета (и это снова может дать тройку — комбо). Все шары выпущены и убраны — победа;
 * хоть один докатился до ямы — проигрыш. Сто уровней: витки, скорость, цвета, длина цепочки растут с номером. */

export const FW = 800;
export const FH = 600;
export const D = 30;
const SHOT_SPEED = 900;

export interface Ball {
  color: number;
  s: number;
  id: number;
}

export interface LevelSpec {
  n: number;
  colors: number;
  total: number;
  speed: number;
  turns: number;
  /** Форма: 0 — спираль, 1 — сплюснутая, 2 — с петлёй. */
  shape: number;
  frog: { x: number; y: number };
}

export function levelSpec(n: number): LevelSpec {
  const shape = n % 3;
  return {
    n,
    colors: n < 10 ? 4 : n < 40 ? 5 : 6,
    total: Math.min(140, 40 + n),
    speed: 22 + Math.min(30, n * 0.35),
    turns: 1.6 + (n % 5) * 0.12 + Math.min(0.8, n / 120),
    shape,
    frog: { x: FW / 2, y: FH / 2 + (shape === 1 ? 10 : 0) },
  };
}

/** Путь — ломаная с равным шагом 2 точки, от старта к яме. */
export function makePath(sp: LevelSpec): { pts: [number, number][]; len: number } {
  const raw: [number, number][] = [];
  const steps = 2000;
  const cx = FW / 2;
  const cy = FH / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = -Math.PI / 2 + t * sp.turns * Math.PI * 2;
    const r = 1 - t * 0.66;
    let x = Math.cos(a) * r;
    let y = Math.sin(a) * r;
    if (sp.shape === 1) y *= 0.75;
    if (sp.shape === 2) x += 0.18 * Math.sin(a * 2) * r;
    raw.push([cx + x * 360, cy + y * 260]);
  }
  // равный шаг 2 точки
  const pts: [number, number][] = [raw[0]];
  let prev = raw[0];
  let need = 2;
  for (let i = 1; i < raw.length; i++) {
    const cur = raw[i];
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (seg >= need) {
      const t = need / seg;
      const p: [number, number] = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      pts.push(p);
      prev = p;
      seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      need = 2;
    }
    need -= seg;
    prev = cur;
  }
  return { pts, len: (pts.length - 1) * 2 };
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
}

export class Zuma {
  readonly spec: LevelSpec;
  readonly path: { pts: [number, number][]; len: number };
  balls: Ball[] = [];
  shots: Shot[] = [];
  spawned = 0;
  score = 0;
  combo = 0;
  won = false;
  lost = false;
  /** Шар во рту и следующий. */
  cur: number;
  next: number;
  aim = -Math.PI / 2;
  /** Начальный разгон: цепочка быстро выкатывается. */
  private rush = 2.2;
  private nextId = 1;
  private seed: number;
  sounds: ('shot' | 'hit' | 'pop' | 'combo' | 'win' | 'lose')[] = [];

  constructor(n: number, seed = n * 104729 + 7) {
    this.spec = levelSpec(n);
    this.path = makePath(this.spec);
    this.seed = seed;
    this.cur = this.rndColor();
    this.next = this.rndColor();
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private rndColor(): number {
    // цвета — из тех, что есть в цепочке (в начале — любые)
    const have = [...new Set(this.balls.map((b) => b.color))];
    if (have.length && this.spawned >= Math.min(10, this.spec.total)) return have[Math.floor(this.rnd() * have.length)];
    return Math.floor(this.rnd() * this.spec.colors);
  }

  /** Точка пути по длине s. */
  at(s: number): [number, number] {
    const i = Math.max(0, Math.min(this.path.pts.length - 1, s / 2));
    const i0 = Math.floor(i);
    const i1 = Math.min(this.path.pts.length - 1, i0 + 1);
    const k = i - i0;
    const a = this.path.pts[i0];
    const b = this.path.pts[i1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }

  /** Сплошные куски цепочки (индексы [от, до]). */
  private groups(): [number, number][] {
    const g: [number, number][] = [];
    let st = 0;
    for (let i = 1; i <= this.balls.length; i++) {
      if (i === this.balls.length || this.balls[i].s - this.balls[i - 1].s > D + 0.5) {
        if (this.balls.length) g.push([st, i - 1]);
        st = i;
      }
    }
    return g;
  }

  shoot() {
    if (this.won || this.lost || this.shots.length >= 2) return;
    const { x, y } = this.spec.frog;
    this.shots.push({ x: x + Math.cos(this.aim) * 30, y: y + Math.sin(this.aim) * 30, vx: Math.cos(this.aim) * SHOT_SPEED, vy: Math.sin(this.aim) * SHOT_SPEED, color: this.cur });
    this.cur = this.next;
    this.next = this.rndColor();
    this.sounds.push('shot');
  }

  swap() {
    [this.cur, this.next] = [this.next, this.cur];
  }

  update(ms: number) {
    if (this.won || this.lost) return;
    const dt = Math.min(0.05, ms / 1000);
    // выпуск новых шаров с начала пути
    while (this.spawned < this.spec.total && (!this.balls.length || this.balls[0].s >= D)) {
      this.balls.unshift({ color: this.streakColor(), s: (this.balls[0]?.s ?? D) - D, id: this.nextId++ });
      this.spawned++;
    }
    // толкание: задний кусок едет вперёд
    const sp = this.spec.speed * (this.rush > 0 ? 6 : 1) * (this.danger() > 0.85 ? 0.6 : 1);
    this.rush -= dt;
    const gs = this.groups();
    if (gs.length) {
      const [a, b] = gs[0];
      for (let i = a; i <= b; i++) this.balls[i].s += sp * dt;
    }
    // разрывы: если по краям одинаковые цвета — передний кусок откатывается назад
    for (let k = 1; k < gs.length; k++) {
      const back = this.balls[gs[k - 1][1]];
      const front = this.balls[gs[k][0]];
      if (back.color === front.color) for (let i = gs[k][0]; i <= gs[k][1]; i++) this.balls[i].s -= 300 * dt;
    }
    // раздвинуть наложения
    for (let i = 1; i < this.balls.length; i++) {
      if (this.balls[i].s < this.balls[i - 1].s + D) {
        const joined = this.balls[i].s > this.balls[i - 1].s + D - 6;
        this.balls[i].s = this.balls[i - 1].s + D;
        // кусок догнал — проверить тройку на стыке
        if (!joined) this.checkAt(i, true);
      }
    }
    // выстрелы
    for (const sh of [...this.shots]) {
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      if (sh.x < -40 || sh.y < -40 || sh.x > FW + 40 || sh.y > FH + 40) {
        this.shots.splice(this.shots.indexOf(sh), 1);
        continue;
      }
      const hit = this.balls.findIndex((b) => {
        const [bx, by] = this.at(b.s);
        return Math.hypot(bx - sh.x, by - sh.y) < D * 0.95;
      });
      if (hit >= 0) {
        this.shots.splice(this.shots.indexOf(sh), 1);
        this.insert(hit, sh);
      }
    }
    // конец
    if (this.balls.some((b) => b.s >= this.path.len - D * 0.5)) {
      this.lost = true;
      this.sounds.push('lose');
    } else if (this.spawned >= this.spec.total && !this.balls.length) {
      this.won = true;
      this.sounds.push('win');
    }
  }

  /** Чем ближе голова к яме (0…1). */
  danger(): number {
    const head = this.balls[this.balls.length - 1];
    return head ? head.s / this.path.len : 0;
  }

  /** Цвет с «полосами»: чаще повторяет предыдущий. */
  private streakColor(): number {
    const prev = this.balls[0]?.color;
    if (prev != null && this.rnd() < 0.45) return prev;
    return Math.floor(this.rnd() * this.spec.colors);
  }

  /** Шар вставляется перед или после того, в кого попал. */
  private insert(hit: number, sh: Shot) {
    const b = this.balls[hit];
    const [bx, by] = this.at(b.s);
    const [fx, fy] = this.at(b.s + 2);
    // по направлению пути: впереди или позади попавшего
    const ahead = (sh.x - bx) * (fx - bx) + (sh.y - by) * (fy - by) > 0;
    const idx = ahead ? hit + 1 : hit;
    const s = ahead ? b.s + D : b.s;
    this.balls.splice(idx, 0, { color: sh.color, s, id: this.nextId++ });
    // сдвинуть идущих следом в том же куске
    for (let i = idx + 1; i < this.balls.length; i++) {
      if (this.balls[i].s < this.balls[i - 1].s + D) this.balls[i].s = this.balls[i - 1].s + D;
      else break;
    }
    this.sounds.push('hit');
    this.combo = 0;
    this.checkAt(idx, false);
  }

  /** Тройка (и больше) одного цвета вокруг индекса — убрать. */
  private checkAt(i: number, chain: boolean) {
    if (i < 0 || i >= this.balls.length) return;
    const c = this.balls[i].color;
    let a = i;
    let b = i;
    while (a > 0 && this.balls[a - 1].color === c && this.balls[a].s - this.balls[a - 1].s <= D + 0.5) a--;
    while (b < this.balls.length - 1 && this.balls[b + 1].color === c && this.balls[b + 1].s - this.balls[b].s <= D + 0.5) b++;
    if (b - a + 1 < 3) return;
    this.combo = chain ? this.combo + 1 : 1;
    const n = b - a + 1;
    this.score += n * 10 * this.combo + (this.combo > 1 ? 50 * this.combo : 0);
    this.balls.splice(a, n);
    this.sounds.push(this.combo > 1 ? 'combo' : 'pop');
    // цвета во рту — только существующие
    const have = new Set(this.balls.map((x) => x.color));
    if (have.size && !have.has(this.cur)) this.cur = this.rndColor();
    if (have.size && !have.has(this.next)) this.next = this.rndColor();
  }

  /** Подсказка/бот: направление на шар цепочки того же цвета, что во рту (ближе к яме — важнее). */
  bestAim(): number | null {
    const { x, y } = this.spec.frog;
    let best: number | null = null;
    let bv = -Infinity;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.color !== this.cur) continue;
      const [bx, by] = this.at(b.s + this.spec.speed * 0.1);
      // путь выстрела не должен задевать другие шары раньше
      const ang = Math.atan2(by - y, bx - x);
      const dist = Math.hypot(bx - x, by - y);
      let blocked = false;
      for (const o of this.balls) {
        if (o === b) continue;
        const [ox, oy] = this.at(o.s);
        const proj = (ox - x) * Math.cos(ang) + (oy - y) * Math.sin(ang);
        if (proj <= 0 || proj >= dist - D * 0.5) continue;
        const perp = Math.abs(-(ox - x) * Math.sin(ang) + (oy - y) * Math.cos(ang));
        if (perp < D * 0.9) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const same = (this.balls[i - 1]?.color === b.color ? 1 : 0) + (this.balls[i + 1]?.color === b.color ? 1 : 0);
      const v = same * 2 + b.s / this.path.len;
      if (v > bv) {
        bv = v;
        best = ang;
      }
    }
    return best;
  }
}
