/* ГОПС — «Бомбермен» во дворе, логика без DOM. Поле 15×11 клеток: по краю забор, внутри через клетку — гаражи (не ломаются),
 * остальное — ящики (ломаются) и проходы. Игроки — гопники в кепках: ходят по клеткам, кладут петарду; через 2,2 с она рвётся крестом
 * на дальность (ящик гасит взрыв и ломается, гараж — гасит), от взрыва рвутся соседние петарды. Попал под взрыв — выбыл.
 * Под ящиками — бонусы: +петарда, +дальность, кеды (быстрее). «Районы»: десять уровней с дворовыми собаками и дворниками;
 * всех прогнал — открывается люк под одним из ящиков, зашёл — следующий район. «Стенка на стенку»: до четырёх, последний на ногах выигрывает раунд. */

export const GW = 15;
export const GH = 11;
export const FUSE = 2.2;
export const FLAME = 0.5;

export type Cell = 'floor' | 'wall' | 'crate';
export type Bonus = 'bomb' | 'fire' | 'speed' | 'exit';

export interface Mover {
  x: number;
  y: number;
  /** Откуда шагнул (для плавности) и сколько осталось шага (0…1). */
  fx: number;
  fy: number;
  t: number;
  alive: boolean;
}

export interface Player extends Mover {
  id: number;
  bombs: number;
  fire: number;
  speed: number;
  /** Человек (номер набора клавиш) или бот. */
  human: number | null;
  wins: number;
}

export interface Enemy extends Mover {
  kind: 'dog' | 'janitor';
  dir: [number, number];
  cd: number;
}

export interface Bomb {
  x: number;
  y: number;
  t: number;
  fire: number;
  owner: number;
}

export interface Flame {
  x: number;
  y: number;
  t: number;
}

export type GopsMode = 'story' | 'battle';

export const DISTRICTS = ['Черёмушки', 'Гаражи', 'Стройка', 'Рынок', 'Школьный двор', 'Промзона', 'Железка', 'Парк', 'Пятиэтажки', 'Центр'];

export interface Input {
  dx: number;
  dy: number;
  bomb: boolean;
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class Gops {
  grid: Cell[][] = [];
  bonus: (Bonus | null)[][] = [];
  players: Player[] = [];
  enemies: Enemy[] = [];
  bombs: Bomb[] = [];
  flames: Flame[] = [];
  level: number;
  score = 0;
  over = false;
  won = false;
  /** Раунд окончен (битва) — кто победил (−1 — ничья). */
  roundWinner: number | null = null;
  exitOpen = false;
  time = 0;
  sounds: ('boom' | 'place' | 'bonus' | 'die' | 'exit' | 'win')[] = [];
  private seed: number;
  private prevBomb: boolean[] = [];

  constructor(
    readonly mode: GopsMode,
    /** Люди: сколько (1–2), всего игроков в битве (2–4). */
    readonly humans = 1,
    readonly total = 1,
    level = 1,
    seed = 1
  ) {
    this.level = level;
    this.seed = seed;
    this.build();
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  static starts: [number, number][] = [
    [1, 1],
    [GW - 2, GH - 2],
    [GW - 2, 1],
    [1, GH - 2],
  ];

  build() {
    const lv = this.level;
    const density = this.mode === 'battle' ? 0.6 : 0.45 + lv * 0.02;
    this.grid = [];
    this.bonus = [];
    for (let y = 0; y < GH; y++) {
      const row: Cell[] = [];
      const brow: (Bonus | null)[] = [];
      for (let x = 0; x < GW; x++) {
        const edge = x === 0 || y === 0 || x === GW - 1 || y === GH - 1;
        const pillar = x % 2 === 0 && y % 2 === 0;
        row.push(edge || pillar ? 'wall' : this.rnd() < density ? 'crate' : 'floor');
        brow.push(null);
      }
      this.grid.push(row);
      this.bonus.push(brow);
    }
    // старты свободны
    const n = this.mode === 'battle' ? this.total : this.humans;
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = Gops.starts[i];
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = sx + dx;
        const y = sy + dy;
        if (this.grid[y]?.[x] === 'crate') this.grid[y][x] = 'floor';
      }
    }
    // бонусы под ящиками
    const crates: [number, number][] = [];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (this.grid[y][x] === 'crate') crates.push([x, y]);
    for (let i = crates.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [crates[i], crates[j]] = [crates[j], crates[i]];
    }
    const kinds: Bonus[] = ['bomb', 'fire', 'speed', 'bomb', 'fire', 'bomb', 'fire', 'speed'];
    let k = 0;
    if (this.mode === 'story' && crates.length) {
      const [ex, ey] = crates[k++];
      this.bonus[ey][ex] = 'exit';
    }
    for (const b of kinds.slice(0, this.mode === 'battle' ? 8 : 4)) {
      if (k >= crates.length) break;
      const [x, y] = crates[k++];
      this.bonus[y][x] = b;
    }
    // игроки (в сюжете — сохраняют силы между районами)
    const old = this.players;
    this.players = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = Gops.starts[i];
      const o = old[i];
      this.players.push({ id: i, x, y, fx: x, fy: y, t: 0, alive: true, bombs: o?.bombs ?? 1, fire: o?.fire ?? 2, speed: o?.speed ?? 4, human: i < this.humans ? i : null, wins: o?.wins ?? 0 });
    }
    this.prevBomb = this.players.map(() => false);
    // враги — в сюжете
    this.enemies = [];
    if (this.mode === 'story') {
      const count = 2 + Math.floor(lv * 0.6);
      for (let i = 0; i < count; i++) {
        for (let tries = 0; tries < 200; tries++) {
          const x = 1 + Math.floor(this.rnd() * (GW - 2));
          const y = 1 + Math.floor(this.rnd() * (GH - 2));
          if (this.grid[y][x] !== 'floor' || x + y < 6) continue;
          this.enemies.push({ x, y, fx: x, fy: y, t: 0, alive: true, kind: lv > 3 && i % 3 === 2 ? 'janitor' : 'dog', dir: DIRS[i % 4], cd: 0 });
          break;
        }
      }
    }
    this.bombs = [];
    this.flames = [];
    this.exitOpen = false;
    this.roundWinner = null;
  }

  free(x: number, y: number): boolean {
    return this.grid[y]?.[x] === 'floor' && !this.bombs.some((b) => b.x === x && b.y === y);
  }

  /** Попадёт ли клетка под взрыв уже лежащих петард (для ботов). */
  danger(x: number, y: number): number {
    let soon = Infinity;
    if (this.flames.some((f) => f.x === x && f.y === y)) return 0;
    for (const b of this.bombs) {
      if (b.x === x && b.y === y) soon = Math.min(soon, b.t);
      for (const [dx, dy] of DIRS)
        for (let r = 1; r <= b.fire; r++) {
          const cx = b.x + dx * r;
          const cy = b.y + dy * r;
          const c = this.grid[cy]?.[cx];
          if (c !== 'floor') break;
          if (cx === x && cy === y) soon = Math.min(soon, b.t);
        }
    }
    return soon;
  }

  private stepMover(m: Mover, dx: number, dy: number, speed: number, dt: number, canPass: (x: number, y: number) => boolean): boolean {
    if (m.t > 0) {
      m.t = Math.max(0, m.t - speed * dt);
      return false;
    }
    if (!dx && !dy) return false;
    // одно направление (по большему)
    if (dx && dy) dy = 0;
    const nx = m.x + Math.sign(dx);
    const ny = m.y + Math.sign(dy);
    if (!canPass(nx, ny)) return false;
    m.fx = m.x;
    m.fy = m.y;
    m.x = nx;
    m.y = ny;
    m.t = 1;
    return true;
  }

  update(ms: number, inputs: Input[]) {
    if (this.over || this.roundWinner != null) return;
    const dt = Math.min(0.05, ms / 1000);
    this.time += dt;
    // игроки
    this.players.forEach((p, i) => {
      if (!p.alive) return;
      const inp = p.human != null ? (inputs[p.human] ?? { dx: 0, dy: 0, bomb: false }) : this.bot(p);
      this.stepMover(p, inp.dx, inp.dy, p.speed, dt, (x, y) => this.free(x, y));
      // петарда — по нажатию (фронт), не больше своего запаса, одна на клетку
      if (inp.bomb && !this.prevBomb[i] && this.bombs.filter((b) => b.owner === p.id).length < p.bombs && !this.bombs.some((b) => b.x === p.x && b.y === p.y)) {
        this.bombs.push({ x: p.x, y: p.y, t: FUSE, fire: p.fire, owner: p.id });
        this.sounds.push('place');
      }
      this.prevBomb[i] = inp.bomb;
      // бонус
      const b = this.bonus[p.y][p.x];
      if (b && this.grid[p.y][p.x] === 'floor') {
        if (b === 'exit') {
          if (this.exitOpen && p.t === 0) this.nextLevel();
          return;
        }
        if (b === 'bomb') p.bombs = Math.min(6, p.bombs + 1);
        if (b === 'fire') p.fire = Math.min(7, p.fire + 1);
        if (b === 'speed') p.speed = Math.min(8, p.speed + 1);
        this.bonus[p.y][p.x] = null;
        this.score += 50;
        this.sounds.push('bonus');
      }
    });
    // враги
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const sp = e.kind === 'dog' ? 2.6 + this.level * 0.1 : 2.0;
      if (e.t > 0) {
        e.t = Math.max(0, e.t - sp * dt);
        continue;
      }
      // дворник — к ближайшему игроку, если на одной линии; собака — бегает
      let dir = e.dir;
      const target = this.players.find((p) => p.alive && (p.x === e.x || p.y === e.y));
      if (e.kind === 'janitor' && target) dir = [Math.sign(target.x - e.x), Math.sign(target.y - e.y)] as [number, number];
      if (!this.free(e.x + dir[0], e.y + dir[1]) || this.rnd() < 0.15) {
        const opts = DIRS.filter(([dx, dy]) => this.free(e.x + dx, e.y + dy));
        dir = opts.length ? opts[Math.floor(this.rnd() * opts.length)] : [0, 0];
      }
      e.dir = dir;
      this.stepMover(e, dir[0], dir[1], sp, dt, (x, y) => this.free(x, y));
    }
    // петарды и огонь
    for (const b of this.bombs) b.t -= dt;
    let exploded = true;
    while (exploded) {
      exploded = false;
      for (const b of [...this.bombs]) if (b.t <= 0) {
        this.explode(b);
        exploded = true;
      }
    }
    for (const f of this.flames) f.t -= dt;
    this.flames = this.flames.filter((f) => f.t > 0);
    // кто под огнём или поймал враг
    for (const p of this.players) {
      if (!p.alive) continue;
      if (this.flames.some((f) => f.x === p.x && f.y === p.y) || this.enemies.some((e) => e.alive && e.x === p.x && e.y === p.y)) {
        p.alive = false;
        this.sounds.push('die');
      }
    }
    for (const e of this.enemies) {
      if (e.alive && this.flames.some((f) => f.x === e.x && f.y === e.y)) {
        e.alive = false;
        this.score += e.kind === 'dog' ? 100 : 200;
      }
    }
    if (this.mode === 'story') {
      if (!this.exitOpen && this.enemies.every((e) => !e.alive)) {
        this.exitOpen = true;
        this.sounds.push('exit');
      }
      if (this.players.every((p) => !p.alive)) this.over = true;
    } else {
      const alive = this.players.filter((p) => p.alive);
      if (alive.length <= 1 && !this.flames.length) {
        this.roundWinner = alive[0]?.id ?? -1;
        if (alive[0]) {
          alive[0].wins++;
          if (alive[0].wins >= 3) {
            this.over = true;
            this.won = alive[0].human != null;
          }
        }
        this.sounds.push('win');
      }
    }
  }

  private explode(b: Bomb) {
    this.bombs.splice(this.bombs.indexOf(b), 1);
    this.sounds.push('boom');
    const add = (x: number, y: number) => this.flames.push({ x, y, t: FLAME });
    add(b.x, b.y);
    for (const [dx, dy] of DIRS)
      for (let r = 1; r <= b.fire; r++) {
        const x = b.x + dx * r;
        const y = b.y + dy * r;
        const c = this.grid[y][x];
        if (c === 'wall') break;
        add(x, y);
        if (c === 'crate') {
          this.grid[y][x] = 'floor';
          this.score += 10;
          break;
        }
        // бонусы сгорают (кроме люка)
        if (this.bonus[y][x] && this.bonus[y][x] !== 'exit') this.bonus[y][x] = null;
        const other = this.bombs.find((o) => o.x === x && o.y === y);
        if (other) other.t = Math.min(other.t, 0);
      }
  }

  private nextLevel() {
    this.sounds.push('win');
    if (this.level >= DISTRICTS.length) {
      this.over = true;
      this.won = true;
      this.score += 1000;
      return;
    }
    this.level++;
    this.score += 300;
    this.build();
  }

  /** Следующий раунд битвы. */
  nextRound() {
    if (this.over) return;
    this.build();
  }

  /** Бот: уходит из-под огня, кладёт петарду у ящика/врага/соперника, если есть куда отбежать, идёт к цели. */
  private bot(p: Player): Input {
    if (p.t > 0) return { dx: 0, dy: 0, bomb: false };
    const safeNow = this.danger(p.x, p.y) === Infinity;
    const path = (goal: (x: number, y: number) => boolean, avoid: boolean): [number, number] | null => {
      const prev = new Map<string, string>();
      const q: [number, number][] = [[p.x, p.y]];
      const seen = new Set([`${p.x},${p.y}`]);
      while (q.length) {
        const [x, y] = q.shift()!;
        if ((x !== p.x || y !== p.y) && goal(x, y)) {
          // первый шаг
          let k = `${x},${y}`;
          while (prev.get(k) !== `${p.x},${p.y}`) k = prev.get(k)!;
          const [fx, fy] = k.split(',').map(Number);
          return [fx - p.x, fy - p.y];
        }
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const k = `${nx},${ny}`;
          if (seen.has(k) || !this.free(nx, ny)) continue;
          if (avoid && this.danger(nx, ny) < 0.6) continue;
          seen.add(k);
          prev.set(k, `${x},${y}`);
          q.push([nx, ny]);
        }
      }
      return null;
    };
    if (!safeNow) {
      const step = path((x, y) => this.danger(x, y) === Infinity, false);
      return step ? { dx: step[0], dy: step[1], bomb: false } : { dx: 0, dy: 0, bomb: false };
    }
    // рядом ящик или соперник на линии — петарда, если есть куда уйти
    const near = DIRS.some(([dx, dy]) => this.grid[p.y + dy]?.[p.x + dx] === 'crate');
    const rival = this.players.some((o) => o !== p && o.alive && Math.abs(o.x - p.x) + Math.abs(o.y - p.y) <= 2);
    const foe = this.enemies.some((e) => e.alive && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 2);
    if ((near || rival || foe) && this.bombs.filter((b) => b.owner === p.id).length < p.bombs && !this.bombs.some((b) => b.x === p.x && b.y === p.y)) {
      // проверить отход: представим петарду и поищем безопасную клетку
      this.bombs.push({ x: p.x, y: p.y, t: FUSE, fire: p.fire, owner: -99 });
      const esc = path((x, y) => this.danger(x, y) === Infinity, false);
      this.bombs.pop();
      if (esc && this.rnd() < 0.5) return { dx: 0, dy: 0, bomb: true };
    }
    // к бонусу, ящику или сопернику
    const step =
      path((x, y) => !!this.bonus[y][x] && this.bonus[y][x] !== 'exit', true) ??
      path((x, y) => DIRS.some(([dx, dy]) => this.grid[y + dy]?.[x + dx] === 'crate'), true) ??
      path((x, y) => this.players.some((o) => o !== p && o.alive && o.x === x && o.y === y), true);
    if (step && this.danger(p.x + step[0], p.y + step[1]) === Infinity) return { dx: step[0], dy: step[1], bomb: false };
    return { dx: 0, dy: 0, bomb: false };
  }
}
