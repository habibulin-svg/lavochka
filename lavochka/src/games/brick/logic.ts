/* Brick Game («тетрис 9999 в 1») — логика без DOM. Экран — матрица 10×20 точек, справа табло: счёт, «следующая» 4×4, скорость, уровень.
 * Игры: Тетрис, Змейка, Гонки, Арканоид, Стрелялка. Скорость 1–10 — темп, уровень 1–10 — сложность на старте
 * (в тетрисе — заполненные снизу ряды, в змейке — стенки, в гонках — плотность машин, в арканоиде — ряды кирпичей, в стрелялке — ряды сверху).
 * Время идёт через update(ms); кнопки — press/release. Звуки — очередь sounds (интерфейс проигрывает и очищает). */

export const W = 10;
export const H = 20;

export type Key = 'left' | 'right' | 'up' | 'down' | 'rotate';
export type BrickSound = 'move' | 'turn' | 'drop' | 'line' | 'eat' | 'hit' | 'crash' | 'shot' | 'level';
export type GameId = 'tetris' | 'snake' | 'race' | 'arkanoid' | 'shooter';

export interface Rng {
  next(): number;
}

/** Простой генератор (mulberry32). */
export function rngFrom(seed: number): Rng {
  let s = seed | 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
const ri = (r: Rng, n: number) => Math.floor(r.next() * n);

export interface Game {
  readonly id: GameId;
  score: number;
  over: boolean;
  speed: number;
  level: number;
  /** Жизни (если есть) — в табло вместо «следующей». */
  lives?: number;
  sounds: BrickSound[];
  update(ms: number): void;
  press(k: Key): void;
  release(k: Key): void;
  /** Матрица 10×20 (1 — точка горит) и картинка 4×4 в табло. */
  draw(m: Uint8Array, next: Uint8Array): void;
}

/** Интервал шага по скорости: 1 — неспешно, 10 — бегом. */
export const stepMs = (speed: number, slow = 700, fast = 90) => slow * Math.pow(fast / slow, (Math.min(10, Math.max(1, speed)) - 1) / 9);

const at = (x: number, y: number) => y * W + x;
const inside = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;

// ---------------------------------------------------------------- тетрис

/** Фигуры: клетки в рамке 4×4, поворот — по часовой вокруг центра рамки. */
const PIECES: [number, number][][] = [
  [[0, 1], [1, 1], [2, 1], [3, 1]], // I
  [[1, 0], [2, 0], [1, 1], [2, 1]], // O
  [[1, 0], [0, 1], [1, 1], [2, 1]], // T
  [[1, 0], [2, 0], [0, 1], [1, 1]], // S
  [[0, 0], [1, 0], [1, 1], [2, 1]], // Z
  [[0, 0], [0, 1], [1, 1], [2, 1]], // J
  [[2, 0], [0, 1], [1, 1], [2, 1]], // L
];

export function rotate(cells: [number, number][], kind: number): [number, number][] {
  if (kind === 1) return cells.map(([x, y]) => [x, y]);
  const n = kind === 0 ? 4 : 3;
  return cells.map(([x, y]) => [n - 1 - y, x]);
}

export class Tetris implements Game {
  readonly id = 'tetris';
  score = 0;
  over = false;
  lines = 0;
  sounds: BrickSound[] = [];
  board = new Uint8Array(W * H);
  kind = 0;
  cells: [number, number][] = [];
  px = 3;
  py = 0;
  nextKind = 0;
  private acc = 0;
  private soft = false;
  private rng: Rng;

  constructor(
    public speed: number,
    public level: number,
    seed: number
  ) {
    this.rng = rngFrom(seed);
    // уровень: снизу (уровень − 1) рядов с дырками
    for (let r = 0; r < Math.min(12, level - 1); r++) {
      const y = H - 1 - r;
      for (let x = 0; x < W; x++) this.board[at(x, y)] = this.rng.next() < 0.55 ? 1 : 0;
      this.board[at(ri(this.rng, W), y)] = 0;
    }
    this.nextKind = ri(this.rng, 7);
    this.spawn();
  }

  private spawn() {
    this.kind = this.nextKind;
    this.nextKind = ri(this.rng, 7);
    this.cells = PIECES[this.kind].map(([x, y]) => [x, y]);
    this.px = 3;
    this.py = this.kind === 0 ? -1 : 0;
    if (!this.fits(this.cells, this.px, this.py)) this.over = true;
  }

  fits(cells: [number, number][], px: number, py: number): boolean {
    return cells.every(([x, y]) => {
      const X = px + x;
      const Y = py + y;
      return X >= 0 && X < W && Y < H && (Y < 0 || !this.board[at(X, Y)]);
    });
  }

  private lock() {
    for (const [x, y] of this.cells) {
      const Y = this.py + y;
      if (Y < 0) {
        this.over = true;
        this.sounds.push('crash');
        return;
      }
      this.board[at(this.px + x, Y)] = 1;
    }
    let cleared = 0;
    for (let y = H - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < W; x++) if (!this.board[at(x, y)]) full = false;
      if (!full) continue;
      cleared++;
      this.board.copyWithin(W, 0, y * W);
      this.board.fill(0, 0, W);
      y++;
    }
    if (cleared) {
      this.score += [0, 100, 300, 700, 1500][cleared] * this.speed;
      this.lines += cleared;
      this.sounds.push('line');
      // каждые 20 рядов — быстрее
      if (Math.floor(this.lines / 20) > Math.floor((this.lines - cleared) / 20) && this.speed < 10) {
        this.speed++;
        this.sounds.push('level');
      }
    } else this.sounds.push('drop');
    this.spawn();
  }

  private fall(): boolean {
    if (this.fits(this.cells, this.px, this.py + 1)) {
      this.py++;
      return true;
    }
    this.lock();
    return false;
  }

  update(ms: number) {
    if (this.over) return;
    this.acc += ms;
    const iv = this.soft ? 40 : stepMs(this.speed, 800, 100);
    while (this.acc >= iv && !this.over) {
      this.acc -= iv;
      this.fall();
    }
  }

  press(k: Key) {
    if (this.over) return;
    if (k === 'left' || k === 'right') {
      const dx = k === 'left' ? -1 : 1;
      if (this.fits(this.cells, this.px + dx, this.py)) {
        this.px += dx;
        this.sounds.push('move');
      }
    } else if (k === 'rotate' || k === 'up') {
      const r = rotate(this.cells, this.kind);
      // поворот у стенки — со сдвигом
      for (const dx of [0, -1, 1, -2, 2]) {
        if (this.fits(r, this.px + dx, this.py)) {
          this.cells = r;
          this.px += dx;
          this.sounds.push('turn');
          break;
        }
      }
    } else if (k === 'down') {
      this.soft = true;
      this.acc = 1000;
    }
  }

  release(k: Key) {
    if (k === 'down') this.soft = false;
  }

  draw(m: Uint8Array, next: Uint8Array) {
    m.set(this.board);
    if (!this.over) for (const [x, y] of this.cells) if (inside(this.px + x, this.py + y)) m[at(this.px + x, this.py + y)] = 1;
    next.fill(0);
    for (const [x, y] of PIECES[this.nextKind]) next[y * 4 + x] = 1;
  }
}

// ---------------------------------------------------------------- змейка

export class Snake implements Game {
  readonly id = 'snake';
  score = 0;
  over = false;
  lives = 4;
  sounds: BrickSound[] = [];
  body: [number, number][] = [];
  dir: [number, number] = [0, -1];
  private want: [number, number] = [0, -1];
  food: [number, number] = [0, 0];
  walls = new Uint8Array(W * H);
  eaten = 0;
  private acc = 0;
  private blink = 0;
  private fast = false;
  private rng: Rng;

  constructor(
    public speed: number,
    public level: number,
    seed: number
  ) {
    this.rng = rngFrom(seed);
    this.reset();
  }

  /** Стенки уровня: чем выше уровень, тем больше перегородок. */
  private buildWalls() {
    this.walls.fill(0);
    const lv = this.level;
    if (lv >= 2) for (let x = 2; x < 8; x++) this.walls[at(x, 5)] = 1;
    if (lv >= 3) for (let x = 2; x < 8; x++) this.walls[at(x, 14)] = 1;
    if (lv >= 4) for (let y = 8; y < 12; y++) (this.walls[at(0, y)] = 1), (this.walls[at(9, y)] = 1);
    if (lv >= 5) for (let y = 0; y < 3; y++) (this.walls[at(4, y)] = 1), (this.walls[at(5, H - 1 - y)] = 1);
    if (lv >= 6) for (let i = 0; i < Math.min(12, (lv - 5) * 3); i++) this.walls[at(1 + ri(this.rng, 8), 7 + ri(this.rng, 6))] = 1;
    // место старта свободно
    for (let y = 15; y < 20; y++) this.walls[at(4, y)] = 0;
    for (let y = 9; y < 11; y++) for (let x = 3; x < 6; x++) this.walls[at(x, y)] = 0;
  }

  private reset() {
    this.buildWalls();
    this.body = [
      [4, 16],
      [4, 17],
      [4, 18],
    ];
    this.dir = [0, -1];
    this.want = [0, -1];
    this.placeFood();
  }

  private free(x: number, y: number) {
    return inside(x, y) && !this.walls[at(x, y)] && !this.body.some(([bx, by]) => bx === x && by === y);
  }

  private placeFood() {
    for (let i = 0; i < 500; i++) {
      const x = ri(this.rng, W);
      const y = ri(this.rng, H);
      if (this.free(x, y)) {
        this.food = [x, y];
        return;
      }
    }
  }

  private step() {
    this.dir = this.want;
    const [hx, hy] = this.body[0];
    const nx = hx + this.dir[0];
    const ny = hy + this.dir[1];
    const tail = this.body[this.body.length - 1];
    const hitsTail = nx === tail[0] && ny === tail[1];
    if (!inside(nx, ny) || this.walls[at(nx, ny)] || (!hitsTail && this.body.some(([x, y]) => x === nx && y === ny))) {
      this.sounds.push('crash');
      this.lives!--;
      if (this.lives! <= 0) this.over = true;
      else this.reset();
      return;
    }
    this.body.unshift([nx, ny]);
    if (nx === this.food[0] && ny === this.food[1]) {
      this.score += 10 * this.speed;
      this.eaten++;
      this.sounds.push('eat');
      // десять яблок — следующий уровень
      if (this.eaten % 10 === 0) {
        this.level = Math.min(10, this.level + 1);
        this.sounds.push('level');
        this.reset();
        return;
      }
      this.placeFood();
    } else this.body.pop();
  }

  update(ms: number) {
    if (this.over) return;
    this.acc += ms;
    this.blink += ms;
    const iv = this.fast ? stepMs(this.speed, 700, 90) / 3 : stepMs(this.speed, 700, 90);
    while (this.acc >= iv && !this.over) {
      this.acc -= iv;
      this.step();
    }
  }

  press(k: Key) {
    if (this.over) return;
    const d: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    if (k === 'rotate') {
      this.fast = true;
      return;
    }
    const nd = d[k];
    // назад развернуться нельзя
    if (nd[0] === -this.dir[0] && nd[1] === -this.dir[1]) return;
    this.want = nd;
  }

  release(k: Key) {
    if (k === 'rotate') this.fast = false;
  }

  draw(m: Uint8Array, next: Uint8Array) {
    m.set(this.walls);
    for (const [x, y] of this.body) m[at(x, y)] = 1;
    // еда мигает
    if (Math.floor(this.blink / 200) % 2 === 0) m[at(this.food[0], this.food[1])] = 1;
    lifeIcons(next, this.lives!);
  }
}

/** Жизни в табло — точками по углам 4×4. */
function lifeIcons(next: Uint8Array, lives: number) {
  next.fill(0);
  const spots = [0, 3, 12, 15];
  for (let i = 0; i < Math.min(4, lives); i++) next[spots[i]] = 1;
}

// ---------------------------------------------------------------- гонки

/** Машинка 3×4: нос сверху. */
export const CAR = [
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [1, 2],
  [0, 3],
  [2, 3],
];

export class Race implements Game {
  readonly id = 'race';
  score = 0;
  over = false;
  lives = 4;
  sounds: BrickSound[] = [];
  /** Полоса игрока: 0 — левая (x = 2), 1 — правая (x = 5). */
  lane = 0;
  cars: { lane: number; y: number }[] = [];
  private acc = 0;
  private road = 0;
  private gap = 0;
  private turbo = false;
  private rng: Rng;

  constructor(
    public speed: number,
    public level: number,
    seed: number
  ) {
    this.rng = rngFrom(seed);
  }

  static laneX = (l: number) => (l === 0 ? 2 : 5);

  private crash() {
    this.sounds.push('crash');
    this.lives!--;
    this.cars = [];
    this.gap = 6;
    if (this.lives! <= 0) this.over = true;
  }

  private collides(): boolean {
    // машина игрока — ряды 16…19
    return this.cars.some((c) => c.lane === this.lane && c.y + 3 >= 16 && c.y <= 19);
  }

  private step() {
    this.road = (this.road + 1) % 4;
    for (const c of this.cars) c.y++;
    const before = this.cars.length;
    this.cars = this.cars.filter((c) => c.y < H);
    const passed = before - this.cars.length;
    if (passed) {
      this.score += passed * 10 * this.speed;
      this.sounds.push('hit');
    }
    if (this.collides()) return this.crash();
    // новые машины: чем выше уровень, тем чаще
    if (--this.gap <= 0) {
      this.cars.push({ lane: ri(this.rng, 2), y: -4 });
      this.gap = Math.max(5, 12 - this.level) + ri(this.rng, 4);
    }
    if (this.score >= this.speed * 1000 && this.speed < 10) {
      this.speed++;
      this.sounds.push('level');
    }
  }

  update(ms: number) {
    if (this.over) return;
    this.acc += ms;
    const iv = stepMs(this.speed, 260, 50) / (this.turbo ? 2 : 1);
    while (this.acc >= iv && !this.over) {
      this.acc -= iv;
      this.step();
    }
  }

  press(k: Key) {
    if (this.over) return;
    if (k === 'left' || k === 'right') {
      const l = k === 'left' ? 0 : 1;
      if (l !== this.lane) {
        this.lane = l;
        this.sounds.push('move');
        if (this.collides()) this.crash();
      }
    } else if (k === 'up' || k === 'rotate') this.turbo = true;
  }

  release(k: Key) {
    if (k === 'up' || k === 'rotate') this.turbo = false;
  }

  draw(m: Uint8Array, next: Uint8Array) {
    m.fill(0);
    // обочины: три горят, одна нет — бегут вниз
    for (let y = 0; y < H; y++) if ((y + 4 - this.road) % 4 !== 0) m[at(0, y)] = m[at(9, y)] = 1;
    const car = (lx: number, y0: number) => {
      for (const [x, y] of CAR) if (inside(lx + x, y0 + y)) m[at(lx + x, y0 + y)] = 1;
    };
    for (const c of this.cars) car(Race.laneX(c.lane), c.y);
    car(Race.laneX(this.lane), 16);
    lifeIcons(next, this.lives!);
  }
}

// ---------------------------------------------------------------- арканоид

export class Arkanoid implements Game {
  readonly id = 'arkanoid';
  score = 0;
  over = false;
  lives = 4;
  sounds: BrickSound[] = [];
  bricks = new Uint8Array(W * H);
  /** Ракетка — левая клетка из трёх, нижний ряд. */
  pad = 3;
  bx = 4;
  by = 18;
  dx = 1;
  dy = -1;
  stuck = true;
  private acc = 0;
  private rng: Rng;

  constructor(
    public speed: number,
    public level: number,
    seed: number
  ) {
    this.rng = rngFrom(seed);
    this.fill();
  }

  private fill() {
    const rows = Math.min(8, 2 + this.level);
    for (let y = 1; y < 1 + rows; y++) for (let x = 0; x < W; x++) this.bricks[at(x, y)] = this.level >= 4 && this.rng.next() < 0.15 ? 0 : 1;
  }

  private serve() {
    this.stuck = true;
    this.bx = this.pad + 1;
    this.by = 18;
    this.dx = this.rng.next() < 0.5 ? -1 : 1;
    this.dy = -1;
  }

  private brick(x: number, y: number): boolean {
    if (!inside(x, y) || !this.bricks[at(x, y)]) return false;
    this.bricks[at(x, y)] = 0;
    this.score += 10 * this.speed;
    this.sounds.push('hit');
    if (!this.bricks.some((b) => b)) {
      this.level = Math.min(10, this.level + 1);
      this.sounds.push('level');
      this.fill();
      this.serve();
    }
    return true;
  }

  private step() {
    if (this.stuck) {
      this.bx = this.pad + 1;
      return;
    }
    let nx = this.bx + this.dx;
    let ny = this.by + this.dy;
    // стенки
    if (nx < 0 || nx >= W) {
      this.dx = -this.dx;
      nx = this.bx + this.dx;
    }
    if (ny < 0) {
      this.dy = 1;
      ny = this.by + 1;
    }
    // кирпичи: по вертикали, по горизонтали, по диагонали
    if (this.brick(this.bx, ny)) {
      this.dy = -this.dy;
      return;
    }
    if (this.brick(nx, this.by)) {
      this.dx = -this.dx;
      return;
    }
    if (this.brick(nx, ny)) {
      this.dx = -this.dx;
      this.dy = -this.dy;
      return;
    }
    // ракетка
    if (ny === H - 1) {
      if (nx >= this.pad - 1 && nx <= this.pad + 3) {
        // край ракетки отбивает в свою сторону
        if (nx <= this.pad) this.dx = -1;
        else if (nx >= this.pad + 2) this.dx = 1;
        this.dy = -1;
        this.sounds.push('turn');
        return;
      }
      this.sounds.push('crash');
      this.lives!--;
      if (this.lives! <= 0) this.over = true;
      else this.serve();
      return;
    }
    this.bx = nx;
    this.by = ny;
  }

  update(ms: number) {
    if (this.over) return;
    this.acc += ms;
    const iv = stepMs(this.speed, 260, 60);
    while (this.acc >= iv && !this.over) {
      this.acc -= iv;
      this.step();
    }
  }

  press(k: Key) {
    if (this.over) return;
    if (k === 'left' && this.pad > 0) this.pad--;
    else if (k === 'right' && this.pad < W - 3) this.pad++;
    else if (k === 'rotate' || k === 'up') {
      if (this.stuck) {
        this.stuck = false;
        this.sounds.push('shot');
      }
      return;
    } else return;
    if (this.stuck) this.bx = this.pad + 1;
    this.sounds.push('move');
  }

  release() {}

  draw(m: Uint8Array, next: Uint8Array) {
    m.set(this.bricks);
    for (let i = 0; i < 3; i++) m[at(this.pad + i, H - 1)] = 1;
    if (inside(this.bx, this.by)) m[at(this.bx, this.by)] = 1;
    lifeIcons(next, this.lives!);
  }
}

// ---------------------------------------------------------------- стрелялка

export class Shooter implements Game {
  readonly id = 'shooter';
  score = 0;
  over = false;
  sounds: BrickSound[] = [];
  /** Стена сверху: опускается рядами. */
  wall = new Uint8Array(W * H);
  gun = 4;
  shots: [number, number][] = [];
  private acc = 0;
  private shotAcc = 0;
  private firing = false;
  private fireCd = 0;
  private rng: Rng;

  constructor(
    public speed: number,
    public level: number,
    seed: number
  ) {
    this.rng = rngFrom(seed);
    for (let r = 0; r < Math.min(10, 2 + level); r++) this.addRow();
  }

  private addRow() {
    this.wall.copyWithin(W, 0, (H - 1) * W);
    for (let x = 0; x < W; x++) this.wall[x] = this.rng.next() < 0.7 ? 1 : 0;
    // пушка — ряды 18…19: стена дошла — конец
    for (let x = 0; x < W; x++) if (this.wall[at(x, 17)]) this.over = true;
    if (this.over) this.sounds.push('crash');
  }

  private fire() {
    this.shots.push([this.gun, 17]);
    this.sounds.push('shot');
  }

  update(ms: number) {
    if (this.over) return;
    this.acc += ms;
    this.shotAcc += ms;
    this.fireCd -= ms;
    if (this.firing && this.fireCd <= 0) {
      this.fire();
      this.fireCd = 160;
    }
    // пули летят быстро
    while (this.shotAcc >= 35) {
      this.shotAcc -= 35;
      const left: [number, number][] = [];
      for (const [x, y0] of this.shots) {
        const y = y0 - 1;
        if (y < 0) continue;
        if (this.wall[at(x, y)]) {
          this.wall[at(x, y)] = 0;
          this.score += 10 * this.speed;
          this.sounds.push('hit');
          continue;
        }
        left.push([x, y]);
      }
      this.shots = left;
    }
    const iv = stepMs(this.speed, 4000, 900);
    while (this.acc >= iv && !this.over) {
      this.acc -= iv;
      this.addRow();
    }
  }

  press(k: Key) {
    if (this.over) return;
    if (k === 'left' && this.gun > 0) this.gun--;
    else if (k === 'right' && this.gun < W - 1) this.gun++;
    else if (k === 'rotate' || k === 'up') {
      this.firing = true;
      this.fire();
      this.fireCd = 220;
      return;
    } else return;
    this.sounds.push('move');
  }

  release(k: Key) {
    if (k === 'rotate' || k === 'up') this.firing = false;
  }

  draw(m: Uint8Array, next: Uint8Array) {
    m.set(this.wall);
    for (const [x, y] of this.shots) if (inside(x, y)) m[at(x, y)] = 1;
    m[at(this.gun, 18)] = 1;
    for (let dx = -1; dx <= 1; dx++) if (inside(this.gun + dx, 19)) m[at(this.gun + dx, 19)] = 1;
    next.fill(0);
    next[1] = next[2] = 1;
    next[4] = next[5] = next[6] = next[7] = 1;
  }
}

export const GAMES: { id: GameId; label: string; letter: string; hint: string }[] = [
  { id: 'tetris', label: 'Тетрис', letter: 'A', hint: 'Собирайте ряды из падающих фигур' },
  { id: 'snake', label: 'Змейка', letter: 'B', hint: 'Ешьте мигающие точки, не врезайтесь' },
  { id: 'race', label: 'Гонки', letter: 'C', hint: 'Объезжайте машины' },
  { id: 'arkanoid', label: 'Арканоид', letter: 'D', hint: 'Отбивайте мяч, разбивайте кирпичи' },
  { id: 'shooter', label: 'Стрелялка', letter: 'E', hint: 'Сбивайте опускающуюся стену' },
];

export function makeGame(id: GameId, speed: number, level: number, seed: number): Game {
  switch (id) {
    case 'snake':
      return new Snake(speed, level, seed);
    case 'race':
      return new Race(speed, level, seed);
    case 'arkanoid':
      return new Arkanoid(speed, level, seed);
    case 'shooter':
      return new Shooter(speed, level, seed);
    default:
      return new Tetris(speed, level, seed);
  }
}
