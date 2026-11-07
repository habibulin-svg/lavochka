/* Танчики — логика без DOM (её гоняют тесты). Поле 208×208 «пикселей» (как у приставки), время — кадры (60 в секунду).
 * Клетка карты — 8×8 (26×26 полуклеток): бетон, вода, лес, лёд — по 8; кирпич — кусками 4×4 (52×52), снаряд выбивает полосу.
 * Танк 16×16; поворачивая поперёк, выравнивается по сетке 8 (так проезжают в проёмы). Враги: обычный, быстрый, скорострел,
 * броневик (4 попадания); 20 на уровень, на поле не больше 4 (вдвоём — 6); четвёртый, одиннадцатый и восемнадцатый мигают —
 * несут бонус. База в центре снизу: попал по ней кто угодно — конец игры. Механика — как у старых «танчиков», карты свои. */

export const FW = 208;
export const T = 16;
export const N8 = 26;
export const N4 = 52;

export type Dir = 0 | 1 | 2 | 3; // вверх, вправо, вниз, влево
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export type EnemyKind = 0 | 1 | 2 | 3;
export const ENEMY_NAMES = ['Обычный', 'Быстрый', 'Скорострел', 'Броневик'];
const ENEMY_SPEED = [0.5, 1.1, 0.75, 0.5];
const ENEMY_BULLET = [2.2, 2.2, 4, 3];
export const ENEMY_PTS = [100, 200, 300, 400];

export type BonusKind = 'helmet' | 'clock' | 'shovel' | 'star' | 'grenade' | 'tank';
export const BONUSES: BonusKind[] = ['helmet', 'clock', 'shovel', 'star', 'grenade', 'tank'];

export interface Tank {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  /** Игрок: 0/1; враг: -1. */
  pl: number;
  kind: EnemyKind;
  hp: number;
  /** Бонусный (мигает). */
  bonus: boolean;
  /** Щит (кадров), заморозка (кадров — попал напарник), появление (кадров «звезды»). */
  shield: number;
  stun: number;
  spawn: number;
  /** Прокачка игрока 0…3. */
  star: number;
  /** Скольжение по льду (кадров) и шаг гусениц (для отрисовки). */
  slide: number;
  tread: number;
  moving: boolean;
  /** Перезарядка, остаток пути до смены направления (враг). */
  cool: number;
  think: number;
  dead: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  dir: Dir;
  speed: number;
  owner: number;
  /** Игрок: 0/1, враг: -1. */
  pl: number;
  power: boolean;
}

export interface Bonus {
  kind: BonusKind;
  x: number;
  y: number;
  t: number;
}

export interface Player {
  lives: number;
  score: number;
  kills: number[];
  /** Ждёт возрождения (кадров), выбыл совсем. */
  respawn: number;
  out: boolean;
  /** Прокачка сохраняется между уровнями. */
  star: number;
  extra: boolean;
}

export interface Map26 {
  brick: number[];
  steel: number[];
  water: number[];
  trees: number[];
  ice: number[];
}

export interface TkState {
  stage: number;
  diff: number;
  map: Map26;
  tanks: Tank[];
  bullets: Bullet[];
  bonus: Bonus | null;
  players: Player[];
  /** Очередь врагов (виды), сколько вышло, сколько убито. */
  queue: EnemyKind[];
  sent: number;
  killed: number;
  spawnT: number;
  spawnAt: number;
  freeze: number;
  shovel: number;
  baseDead: boolean;
  phase: 'intro' | 'play' | 'tally' | 'over' | 'won';
  phaseT: number;
  frame: number;
  seed: number;
  nextId: number;
  /** Своя карта (конструктор) — играть её одну. */
  custom: boolean;
}

export interface TkIn {
  /** Направление (−1 — стоит) и огонь. */
  dir: number;
  fire: boolean;
}

export type TkEvent =
  | { k: 'fire'; pl: number }
  | { k: 'brick'; x: number; y: number }
  | { k: 'steel'; x: number; y: number }
  | { k: 'hit'; x: number; y: number }
  | { k: 'boom'; x: number; y: number; big: boolean; kind: number; pts: number }
  | { k: 'bonusShow' }
  | { k: 'bonus'; kind: BonusKind; pl: number }
  | { k: 'life'; pl: number }
  | { k: 'stun'; pl: number }
  | { k: 'base' }
  | { k: 'stage'; stage: number }
  | { k: 'clear' }
  | { k: 'over' };

// ---------------------------------------------------------------- случайность (своя, для повторяемости)

export function rnd(st: { seed: number }): number {
  st.seed = (Math.imul(st.seed, 1103515245) + 12345) >>> 0;
  return (st.seed >>> 8) / 16777216;
}
const ri = (st: { seed: number }, n: number) => Math.floor(rnd(st) * n);

// ---------------------------------------------------------------- карта

export const BASE_X = 96;
export const BASE_Y = 192;
const SPAWN_E: [number, number][] = [
  [0, 0],
  [96, 0],
  [192, 0],
];
export const SPAWN_P: [number, number][] = [
  [64, 192],
  [128, 192],
];

/** Карта из 26 строк по 26 знаков: '.' пусто, '#' кирпич, '@' бетон, '~' вода, '%' лес, '-' лёд. */
export function parseMap(rows: string[]): Map26 {
  const m: Map26 = { brick: new Array(N4 * N4).fill(0), steel: new Array(N8 * N8).fill(0), water: new Array(N8 * N8).fill(0), trees: new Array(N8 * N8).fill(0), ice: new Array(N8 * N8).fill(0) };
  for (let y = 0; y < N8; y++)
    for (let x = 0; x < N8; x++) {
      const c = rows[y]?.[x] ?? '.';
      const i = y * N8 + x;
      if (c === '#') for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.brick[(y * 2 + dy) * N4 + x * 2 + dx] = 1;
      else if (c === '@') m.steel[i] = 1;
      else if (c === '~') m.water[i] = 1;
      else if (c === '%') m.trees[i] = 1;
      else if (c === '-') m.ice[i] = 1;
    }
  clearBaseArea(m);
  return m;
}

export function mapRows(m: Map26): string[] {
  const out: string[] = [];
  for (let y = 0; y < N8; y++) {
    let s = '';
    for (let x = 0; x < N8; x++) {
      const i = y * N8 + x;
      const b = m.brick[y * 2 * N4 + x * 2] || m.brick[y * 2 * N4 + x * 2 + 1] || m.brick[(y * 2 + 1) * N4 + x * 2] || m.brick[(y * 2 + 1) * N4 + x * 2 + 1];
      s += m.steel[i] ? '@' : m.water[i] ? '~' : m.trees[i] ? '%' : m.ice[i] ? '-' : b ? '#' : '.';
    }
    out.push(s);
  }
  return out;
}

/** Вокруг базы — кирпичная стенка; сама база и места появления — пустые. */
function clearBaseArea(m: Map26) {
  for (let y = 23; y < 26; y++)
    for (let x = 11; x < 15; x++) {
      const i = y * N8 + x;
      m.steel[i] = m.water[i] = m.trees[i] = 0;
      const inner = y >= 24 && x >= 12 && x < 14;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.brick[(y * 2 + dy) * N4 + x * 2 + dx] = inner ? 0 : 1;
    }
  for (const [sx, sy] of [...SPAWN_E, ...SPAWN_P]) clearRect(m, sx, sy, 16, 16);
}

function clearRect(m: Map26, px: number, py: number, w: number, h: number) {
  for (let y = py / 8; y < (py + h) / 8; y++)
    for (let x = px / 8; x < (px + w) / 8; x++) {
      const i = y * N8 + x;
      m.steel[i] = m.water[i] = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.brick[(y * 2 + dy) * N4 + x * 2 + dx] = 0;
    }
}

/** Лопата: стенка вокруг базы — бетон (on) или снова кирпич. */
function baseWall(m: Map26, steel: boolean) {
  for (let y = 23; y < 26; y++)
    for (let x = 11; x < 15; x++) {
      if (y >= 24 && x >= 12 && x < 14) continue;
      m.steel[y * N8 + x] = steel ? 1 : 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) m.brick[(y * 2 + dy) * N4 + x * 2 + dx] = steel ? 0 : 1;
    }
}

// ---------------------------------------------------------------- партия

/** Состав двадцати врагов по уровню: чем дальше, тем больше быстрых, скорострелов и броневиков. */
export function waveOf(stage: number, diff: number, seed: number): EnemyKind[] {
  const s = { seed: seed ^ (stage * 7919) };
  const k = Math.min(1, (stage - 1) / 30 + diff * 0.08);
  const armor = Math.round(2 + 8 * k);
  const power = Math.round(2 + 4 * k);
  const fast = Math.round(2 + 4 * k);
  const out: EnemyKind[] = [];
  for (let i = 0; i < 20; i++) out.push(i < armor ? 3 : i < armor + power ? 2 : i < armor + power + fast ? 1 : 0);
  // обычные и быстрые — пораньше, броневики — к концу
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.max(0, i - 1 - ri(s, 6));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.sort((a, b) => (a === 3 ? 1 : 0) - (b === 3 ? 1 : 0) || 0);
}

export function newGame(opts: { players: number; diff: number; stage?: number; seed?: number; map?: string[] }): TkState {
  const st: TkState = {
    stage: opts.stage ?? 1,
    diff: opts.diff,
    map: parseMap(opts.map ?? []),
    tanks: [],
    bullets: [],
    bonus: null,
    players: Array.from({ length: opts.players }, () => ({ lives: opts.diff === 0 ? 4 : 3, score: 0, kills: [0, 0, 0, 0], respawn: 0, out: false, star: 0, extra: false })),
    queue: [],
    sent: 0,
    killed: 0,
    spawnT: 0,
    spawnAt: 0,
    freeze: 0,
    shovel: 0,
    baseDead: false,
    phase: 'intro',
    phaseT: 90,
    frame: 0,
    seed: (opts.seed ?? 12345) >>> 0 || 1,
    nextId: 1,
    custom: !!opts.map,
  };
  startStage(st, opts.map);
  return st;
}

export function startStage(st: TkState, custom?: string[]) {
  st.map = parseMap(custom ?? genMap(st.stage, st.seed));
  st.tanks = [];
  st.bullets = [];
  st.bonus = null;
  st.queue = waveOf(st.stage, st.diff, st.seed);
  st.sent = 0;
  st.killed = 0;
  st.spawnAt = Math.max(60, 190 - st.stage * 4 - (st.players.length - 1) * 20 - st.diff * 20);
  st.spawnT = 30;
  st.freeze = 0;
  st.shovel = 0;
  st.phase = 'intro';
  st.phaseT = 90;
  st.players.forEach((p, i) => {
    p.kills = [0, 0, 0, 0];
    if (!p.out) spawnPlayer(st, i, false);
  });
}

function spawnPlayer(st: TkState, i: number, fresh: boolean) {
  const p = st.players[i];
  if (fresh) p.star = 0;
  const [x, y] = SPAWN_P[i];
  st.tanks = st.tanks.filter((t) => t.pl !== i);
  st.tanks.push({ id: st.nextId++, x, y, dir: 0, pl: i, kind: 0, hp: 1, bonus: false, shield: 180, stun: 0, spawn: 40, star: p.star, slide: 0, tread: 0, moving: false, cool: 0, think: 0, dead: false });
}

const maxAlive = (st: TkState) => (st.players.length > 1 ? 6 : 4);

function spawnEnemy(st: TkState) {
  const alive = st.tanks.filter((t) => t.pl < 0 && !t.dead).length;
  if (st.sent >= st.queue.length || alive >= maxAlive(st)) return;
  const start = st.sent % 3 === 0 ? 1 : st.sent % 3 === 1 ? 2 : 0;
  for (let k = 0; k < 3; k++) {
    const [x, y] = SPAWN_E[(start + k) % 3];
    if (st.tanks.some((t) => !t.dead && overlap(t.x, t.y, T, T, x, y, T, T))) continue;
    const kind = st.queue[st.sent];
    const bonus = st.sent === 3 || st.sent === 10 || st.sent === 17;
    st.tanks.push({ id: st.nextId++, x, y, dir: 2, pl: -1, kind, hp: kind === 3 ? 4 : 1, bonus, shield: 0, stun: 0, spawn: 50, star: 0, slide: 0, tread: 0, moving: false, cool: 30, think: 0, dead: false });
    st.sent++;
    return;
  }
}

// ---------------------------------------------------------------- столкновения

const overlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;

/** Танку здесь нельзя стоять: край поля, кирпич, бетон, вода, база. */
function blocked(st: TkState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > FW - T || y > FW - T) return true;
  const m = st.map;
  const x0 = Math.floor(x / 4);
  const y0 = Math.floor(y / 4);
  const x1 = Math.ceil((x + T) / 4);
  const y1 = Math.ceil((y + T) / 4);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (m.brick[yy * N4 + xx]) return true;
  for (let yy = Math.floor(y / 8); yy < Math.ceil((y + T) / 8); yy++)
    for (let xx = Math.floor(x / 8); xx < Math.ceil((x + T) / 8); xx++) {
      const i = yy * N8 + xx;
      if (m.steel[i] || m.water[i]) return true;
    }
  if (overlap(x, y, T, T, BASE_X, BASE_Y, T, T)) return true;
  return false;
}

function tankBlocks(st: TkState, me: Tank, x: number, y: number): boolean {
  for (const o of st.tanks) {
    if (o === me || o.dead) continue;
    // уже налезли (появились рядом) — не мешаем разъехаться
    if (overlap(me.x, me.y, T, T, o.x, o.y, T, T)) continue;
    if (overlap(x, y, T, T, o.x, o.y, T, T)) return true;
  }
  return false;
}

const onIce = (st: TkState, t: Tank) => !!st.map.ice[Math.floor((t.y + 8) / 8) * N8 + Math.floor((t.x + 8) / 8)];

/** Повернуть и проехать на speed; поворот поперёк — выравнивание по 8 (как у приставки). */
function drive(st: TkState, t: Tank, dir: Dir, speed: number): boolean {
  if (dir !== t.dir) {
    if (dir % 2 !== t.dir % 2) {
      if (dir % 2 === 0) t.x = Math.round(t.x / 8) * 8;
      else t.y = Math.round(t.y / 8) * 8;
    }
    t.dir = dir;
  }
  const nx = t.x + DX[dir] * speed;
  const ny = t.y + DY[dir] * speed;
  if (blocked(st, nx, ny) || tankBlocks(st, t, nx, ny)) {
    // доезжаем вплотную по целым
    const ix = t.x + DX[dir] * Math.floor(speed);
    const iy = t.y + DY[dir] * Math.floor(speed);
    if (Math.floor(speed) >= 1 && !blocked(st, ix, iy) && !tankBlocks(st, t, ix, iy)) {
      t.x = ix;
      t.y = iy;
    }
    return false;
  }
  t.x = nx;
  t.y = ny;
  t.tread++;
  return true;
}

function fire(st: TkState, t: Tank, ev: TkEvent[]) {
  const max = t.pl >= 0 && t.star >= 2 ? 2 : 1;
  if (st.bullets.filter((b) => b.owner === t.id).length >= max || t.cool > 0) return;
  const speed = t.pl >= 0 ? (t.star >= 1 ? 4.5 : 3) : ENEMY_BULLET[t.kind];
  const bx = t.x + 8 - 2 + DX[t.dir] * 8;
  const by = t.y + 8 - 2 + DY[t.dir] * 8;
  st.bullets.push({ x: bx, y: by, dir: t.dir, speed, owner: t.id, pl: t.pl, power: t.pl >= 0 && t.star >= 3 });
  t.cool = t.pl >= 0 ? 10 : 20;
  if (t.pl >= 0) ev.push({ k: 'fire', pl: t.pl });
}

/** Снаряд упёрся в кирпич/бетон: выбить полосу шириной 16 на глубину 4 (с прокачкой — 8 и бетон). */
function hitWall(st: TkState, b: Bullet, ev: TkEvent[]): boolean {
  const m = st.map;
  const cx = b.x + 2;
  const cy = b.y + 2;
  const tipX = cx + DX[b.dir] * 2;
  const tipY = cy + DY[b.dir] * 2;
  if (tipX < 0 || tipY < 0 || tipX >= FW || tipY >= FW) {
    ev.push({ k: 'steel', x: cx, y: cy });
    return true;
  }
  const c4x = Math.floor(tipX / 4);
  const c4y = Math.floor(tipY / 4);
  const c8 = Math.floor(tipY / 8) * N8 + Math.floor(tipX / 8);
  const horiz = b.dir % 2 === 1;
  // полоса поперёк полёта: ±2 куска по 4 от центра
  const band = (fn: (x: number, y: number) => void) => {
    for (let k = -2; k < 2; k++) {
      const x = horiz ? c4x : Math.floor(cx / 4) + k;
      const y = horiz ? Math.floor(cy / 4) + k : c4y;
      if (x >= 0 && y >= 0 && x < N4 && y < N4) fn(x, y);
    }
  };
  if (m.steel[c8]) {
    if (b.power) {
      const sx = Math.floor(tipX / 8);
      const sy = Math.floor(tipY / 8);
      for (let k = -1; k <= 0; k++) {
        const x = horiz ? sx : Math.floor((cx + (k ? -4 : 4)) / 8);
        const y = horiz ? Math.floor((cy + (k ? -4 : 4)) / 8) : sy;
        if (x >= 0 && y >= 0 && x < N8 && y < N8) m.steel[y * N8 + x] = 0;
      }
    }
    ev.push({ k: 'steel', x: cx, y: cy });
    return true;
  }
  let hit = false;
  band((x, y) => {
    if (m.brick[y * N4 + x]) hit = true;
  });
  if (!hit) return false;
  const depth = b.power ? 2 : 1;
  for (let d = 0; d < depth; d++)
    band((x, y) => {
      const xx = x + (horiz ? DX[b.dir] * d : 0);
      const yy = y + (horiz ? 0 : DY[b.dir] * d);
      if (xx >= 0 && yy >= 0 && xx < N4 && yy < N4) m.brick[yy * N4 + xx] = 0;
    });
  ev.push({ k: 'brick', x: cx, y: cy });
  return true;
}

function killTank(st: TkState, t: Tank, by: number, ev: TkEvent[]) {
  t.dead = true;
  if (t.pl >= 0) {
    const p = st.players[t.pl];
    p.star = 0;
    p.lives--;
    if (p.lives > 0) p.respawn = 60;
    else p.out = true;
    ev.push({ k: 'boom', x: t.x + 8, y: t.y + 8, big: true, kind: -1, pts: 0 });
    return;
  }
  st.killed++;
  const pts = ENEMY_PTS[t.kind];
  if (by >= 0) {
    const p = st.players[by];
    p.score += pts;
    p.kills[t.kind]++;
    extraLife(st, by, ev);
  }
  ev.push({ k: 'boom', x: t.x + 8, y: t.y + 8, big: true, kind: t.kind, pts: by >= 0 ? pts : 0 });
}

function extraLife(st: TkState, i: number, ev: TkEvent[]) {
  const p = st.players[i];
  if (!p.extra && p.score >= 20000) {
    p.extra = true;
    p.lives++;
    ev.push({ k: 'life', pl: i });
  }
}

function dropBonus(st: TkState, ev: TkEvent[]) {
  for (let k = 0; k < 40; k++) {
    const x = 16 + ri(st, 11) * 16;
    const y = 16 + ri(st, 10) * 16;
    if (overlap(x, y, T, T, BASE_X - 16, BASE_Y - 16, 48, 32)) continue;
    st.bonus = { kind: BONUSES[ri(st, BONUSES.length)], x, y, t: 0 };
    ev.push({ k: 'bonusShow' });
    return;
  }
}

function takeBonus(st: TkState, t: Tank, ev: TkEvent[]) {
  const b = st.bonus!;
  const p = st.players[t.pl];
  st.bonus = null;
  p.score += 500;
  extraLife(st, t.pl, ev);
  switch (b.kind) {
    case 'helmet':
      t.shield = 600;
      break;
    case 'clock':
      st.freeze = 600;
      break;
    case 'shovel':
      st.shovel = 1200;
      baseWall(st.map, true);
      break;
    case 'star':
      t.star = p.star = Math.min(3, p.star + 1);
      break;
    case 'grenade':
      for (const e of st.tanks) if (e.pl < 0 && !e.dead && e.spawn <= 0) killTank(st, e, -1, ev);
      break;
    case 'tank':
      p.lives++;
      break;
  }
  ev.push({ k: 'bonus', kind: b.kind, pl: t.pl });
}

// ---------------------------------------------------------------- враги

function enemyThink(st: TkState, t: Tank, ev: TkEvent[]) {
  const speed = ENEMY_SPEED[t.kind];
  const moved = drive(st, t, t.dir, speed);
  t.moving = moved;
  const aligned = Math.abs(t.x - Math.round(t.x / 8) * 8) < 0.6 && Math.abs(t.y - Math.round(t.y / 8) * 8) < 0.6;
  t.think--;
  if (!moved || (aligned && t.think <= 0 && rnd(st) < 0.08)) {
    t.think = 30 + ri(st, 90);
    // куда: к базе, к игроку или куда придётся (на трудном — чаще к базе)
    const r = rnd(st);
    const toBase = 0.25 + st.diff * 0.1;
    let target: [number, number] | null = null;
    if (r < toBase) target = [BASE_X, BASE_Y];
    else if (r < toBase + 0.25) {
      const pl = st.tanks.find((x) => x.pl >= 0 && !x.dead);
      if (pl) target = [pl.x, pl.y];
    }
    let d: Dir;
    if (target) {
      const dx = target[0] - t.x;
      const dy = target[1] - t.y;
      d = Math.abs(dx) > Math.abs(dy) === rnd(st) < 0.6 ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    } else d = [2, 2, 1, 3, 0][ri(st, 5)] as Dir;
    if (!moved && d === t.dir) d = ((t.dir + 1 + ri(st, 3)) % 4) as Dir;
    drive(st, t, d, 0);
  }
  const fireP = [1 / 70, 1 / 45, 1 / 30][st.diff] ?? 1 / 45;
  if (rnd(st) < fireP * (t.kind === 2 ? 1.5 : 1)) fire(st, t, ev);
}

// ---------------------------------------------------------------- шаг

export function step(st: TkState, inputs: (TkIn | undefined)[]): TkEvent[] {
  const ev: TkEvent[] = [];
  st.frame++;
  if (st.phase === 'over' || st.phase === 'won') {
    st.phaseT--;
    return ev;
  }
  if (st.phase === 'intro') {
    if (--st.phaseT <= 0) {
      st.phase = 'play';
      ev.push({ k: 'stage', stage: st.stage });
    }
    return ev;
  }
  if (st.phase === 'tally') {
    if (--st.phaseT <= 0) {
      if (st.custom) {
        st.phase = 'won';
        st.phaseT = 200;
        return ev;
      }
      st.stage++;
      startStage(st);
    }
    return ev;
  }
  // враги выходят
  if (--st.spawnT <= 0) {
    st.spawnT = st.spawnAt;
    spawnEnemy(st);
  }
  if (st.freeze > 0) st.freeze--;
  if (st.shovel > 0 && --st.shovel === 0) baseWall(st.map, false);
  if (st.bonus) st.bonus.t++;
  // игроки возрождаются
  st.players.forEach((p, i) => {
    if (p.out || p.respawn <= 0) return;
    if (--p.respawn === 0) spawnPlayer(st, i, true);
  });
  for (const t of st.tanks) {
    if (t.dead) continue;
    if (t.cool > 0) t.cool--;
    if (t.shield > 0) t.shield--;
    if (t.spawn > 0) {
      t.spawn--;
      continue;
    }
    if (t.pl >= 0) {
      const inp = inputs[t.pl];
      if (t.stun > 0) {
        t.stun--;
        continue;
      }
      const speed = 0.9;
      if (inp && inp.dir >= 0) {
        t.moving = drive(st, t, inp.dir as Dir, speed);
        t.slide = onIce(st, t) ? 24 : 0;
      } else if (t.slide > 0) {
        t.slide--;
        t.moving = drive(st, t, t.dir, speed);
      } else t.moving = false;
      if (inp?.fire) fire(st, t, ev);
      if (st.bonus && overlap(t.x, t.y, T, T, st.bonus.x, st.bonus.y, T, T)) takeBonus(st, t, ev);
    } else if (st.freeze <= 0) enemyThink(st, t, ev);
    else t.moving = false;
  }
  // снаряды: по пикселю, чтобы не пролетать сквозь кирпич
  const dead = new Set<Bullet>();
  for (const b of st.bullets) {
    for (let s = 0; s < Math.ceil(b.speed) && !dead.has(b); s++) {
      const stepLen = Math.min(1, b.speed - s);
      b.x += DX[b.dir] * stepLen;
      b.y += DY[b.dir] * stepLen;
      if (hitWall(st, b, ev)) {
        dead.add(b);
        break;
      }
      // база
      if (overlap(b.x, b.y, 4, 4, BASE_X, BASE_Y, T, T) && !st.baseDead) {
        st.baseDead = true;
        dead.add(b);
        ev.push({ k: 'boom', x: BASE_X + 8, y: BASE_Y + 8, big: true, kind: -2, pts: 0 });
        ev.push({ k: 'base' });
        break;
      }
      // танки
      for (const t of st.tanks) {
        if (t.dead || t.id === b.owner || t.spawn > 0 || !overlap(b.x, b.y, 4, 4, t.x, t.y, T, T)) continue;
        if (b.pl < 0 && t.pl < 0) continue; // враги своих не бьют
        dead.add(b);
        if (b.pl >= 0 && t.pl >= 0) {
          // напарника — оглушить
          t.stun = 120;
          ev.push({ k: 'stun', pl: t.pl });
        } else if (t.pl >= 0) {
          if (t.shield <= 0) killTank(st, t, -1, ev);
          else ev.push({ k: 'hit', x: b.x, y: b.y });
        } else {
          if (t.bonus) {
            t.bonus = false;
            dropBonus(st, ev);
          }
          t.hp--;
          if (t.hp <= 0) killTank(st, t, b.pl, ev);
          else ev.push({ k: 'hit', x: b.x, y: b.y });
        }
        break;
      }
    }
  }
  // снаряд в снаряд
  for (const a of st.bullets)
    for (const b of st.bullets) {
      if (a === b || dead.has(a) || dead.has(b) || (a.pl < 0 && b.pl < 0)) continue;
      if (overlap(a.x - 1, a.y - 1, 6, 6, b.x - 1, b.y - 1, 6, 6)) {
        dead.add(a);
        dead.add(b);
      }
    }
  st.bullets = st.bullets.filter((b) => !dead.has(b) && st.tanks.some((t) => t.id === b.owner));
  st.tanks = st.tanks.filter((t) => !t.dead);
  // конец: база, все игроки, все враги
  if (st.baseDead || st.players.every((p) => p.out)) {
    st.phase = 'over';
    st.phaseT = 200;
    ev.push({ k: 'over' });
  } else if (st.killed >= st.queue.length && !st.tanks.some((t) => t.pl < 0)) {
    st.phase = 'tally';
    st.phaseT = 200;
    ev.push({ k: 'clear' });
  }
  return ev;
}

export const totalScore = (st: TkState) => st.players.reduce((a, p) => a + p.score, 0);

// ---------------------------------------------------------------- генератор карт

/** Куски 2×2 клетки (4×4 полуклетки): '#' кирпич, '@' бетон, '~' вода, '%' лес, '-' лёд, '.' пусто. */
const PIECES: string[][] = [
  ['####', '####', '####', '####'],
  ['####', '####', '....', '....'],
  ['##..', '##..', '##..', '##..'],
  ['@@@@', '@@@@', '....', '....'],
  ['@@..', '@@..', '....', '....'],
  ['####', '#@@#', '#@@#', '####'],
  ['##..', '##..', '####', '####'],
  ['....', '.##.', '.##.', '....'],
  ['#..#', '#..#', '#..#', '#..#'],
];

/** Карта уровня: симметричная, из кусков; чем дальше — тем больше бетона, воды и леса. Своя на каждый уровень и сид. */
export function genMap(stage: number, seed: number): string[] {
  const s = { seed: (seed ^ Math.imul(stage, 2654435761)) >>> 0 || 1 };
  const g: string[][] = Array.from({ length: N8 }, () => new Array(N8).fill('.'));
  const put = (tx: number, ty: number, p: string[], mirror: boolean) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const c = p[y][mirror ? 3 - x : x];
        const gx = tx * 2 + x;
        const gy = ty * 2 + y;
        if (gx < N8 && gy < N8 && c !== '.') g[gy][gx] = c;
      }
  };
  const steelK = Math.min(0.35, 0.05 + stage * 0.012);
  const style = ri(s, 4); // 0 — кварталы, 1 — крепость, 2 — река, 3 — лес
  // кварталы: блоки по сетке через одну клетку
  for (let ty = 1; ty < 11; ty += 2)
    for (let tx = 0; tx < 6; tx += 2) {
      if (rnd(s) < (style === 1 ? 0.75 : 0.6)) {
        let p = PIECES[ri(s, PIECES.length)];
        if (p.join('').includes('@') && rnd(s) > steelK * 2) p = PIECES[ri(s, 3)];
        if (style === 3 && rnd(s) < 0.35) p = ['%%%%', '%%%%', '%%%%', '%%%%'];
        put(tx, ty, p, false);
        put(12 - tx - 1, ty, p, true);
      }
    }
  // река поперёк с бродами
  if (style === 2 || (stage > 5 && rnd(s) < 0.3)) {
    const ry = 10 + ri(s, 6);
    for (let x = 0; x < N8; x++) if (x < 4 || (x > 8 && x < 17) || x > 21) g[ry][x] = g[ry + 1][x] = '~';
  }
  // ледовые пятна
  if (stage > 3 && rnd(s) < 0.35) {
    const iy = 6 + ri(s, 10);
    for (let y = iy; y < iy + 4; y++) for (let x = 6; x < 20; x++) if (g[y][x] === '.') g[y][x] = '-';
  }
  // лес по краям
  if (rnd(s) < 0.5) for (let y = 4 + ri(s, 8), k = 0; k < 4; k++) for (const x of [0, 1, 24, 25]) if (g[y + k]?.[x] === '.') g[y + k][x] = '%';
  // проходы: центральная полоса без бетона и воды, верхний ряд свободен
  for (let y = 0; y < N8; y++) for (const x of [12, 13]) if (g[y][x] === '@' || g[y][x] === '~') g[y][x] = '#';
  for (let x = 0; x < N8; x++) g[0][x] = g[1][x] = '.';
  for (let y = 20; y < 23; y++) for (let x = 6; x < 20; x++) if (g[y][x] === '@' || g[y][x] === '~') g[y][x] = '.';
  return g.map((r) => r.join(''));
}
