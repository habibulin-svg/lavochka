/* «Магистраль М» — телевизионный игровой автомат на дискретной логике; правила — по руководству ПМ2.539.001 РЭ
 * (docs/analysis/magistral.md). Два игрока на двух трассах рядом; руль — машина по горизонтали в пределах трассы,
 * педаль — скорость (движение условно — бегущий парапет и машины автомата). Между трассами — индикаторы: синий
 * (левый игрок), красный (правый) и зелёный контрольный (время × средняя скорость без столкновений). Дошёл до финишной
 * ленты раньше зелёного — надпись ПРИЗ, пересечь её — призовая игра. Сеанс 2 мин, с призовой — 4 мин.
 * Единицы: трасса 400 × 800 условных точек, скорости — точек в секунду. Без интерфейса. */

export type TrackKind = 'learn' | 'race' | 'special' | 'night' | 'ice';
export const TRACKS: { id: TrackKind; title: string }[] = [
  { id: 'learn', title: 'Учебная' },
  { id: 'race', title: 'Гоночная' },
  { id: 'special', title: 'Специальная' },
  { id: 'night', title: 'Ночная' },
  { id: 'ice', title: 'Гололёд' },
];

export const TW = 400;
export const TH = 800;
export const CAR_W = 44;
export const CAR_H = 72;
/** Средняя скорость: контрольный индикатор доходит до ленты за сеанс. */
export const V_AVG = 300;
export const V_MAX = 470;
export const SESSION = 120;
export const FINISH = V_AVG * SESSION;
export const CRASH_TIME = 1.6;
export const OVER_TIME = 6;
/** Руль: скорость машины по горизонтали. */
const STEER = 330;
const POST_GAP = 64;

export type Mover = { x: number; y: number; w: number; vy: number; vx: number; kind: 'car' | 'wide' | 'spec' };

export interface Player {
  on: boolean;
  x: number;
  y: number;
  speed: number;
  /** Педаль 0…1 и руль −1…1 (вход). */
  pedal: number;
  wheel: number;
  dist: number;
  crash: number;
  boom: { x: number; y: number; t: number } | null;
  /** Парапет: сдвиг бегущих столбиков. */
  scroll: number;
  cars: Mover[];
  /** Надпись ПРИЗ на трассе (y) — после финиша раньше контрольного. */
  prizeSign: number | null;
  won: boolean;
  prize: boolean;
  /** До появления спецмашины. */
  specIn: number;
  finished: boolean;
}

export type MagEvent = 'start' | 'crash' | 'finish' | 'prize' | 'over' | 'attract' | 'siren' | 'rejected';

export interface MagState {
  mode: 'attract' | 'ready' | 'play' | 'over';
  track: TrackKind;
  credits: number;
  time: number;
  /** Призовая игра идёт (вторые две минуты). */
  prizeRound: boolean;
  overT: number;
  players: [Player, Player];
  /** Для «случайности» без Math.random — тесты повторяемы. */
  seed: number;
  clock: number;
}

const rnd = (s: MagState) => {
  s.seed = (s.seed * 16807) % 2147483647;
  return s.seed / 2147483647;
};

const playerY = (t: TrackKind) => (t === 'learn' || t === 'night' ? TH - 110 : TH / 2 + 20);

function newPlayer(): Player {
  return { on: false, x: TW / 2, y: TH - 110, speed: 0, pedal: 0, wheel: 0, dist: 0, crash: 0, boom: null, scroll: 0, cars: [], prizeSign: null, won: false, prize: false, specIn: 12, finished: false };
}

export function newMag(seed = 12345): MagState {
  return { mode: 'attract', track: 'learn', credits: 0, time: 0, prizeRound: false, overT: 0, players: [newPlayer(), newPlayer()], seed, clock: 0 };
}

/** Монета 15 коп.: до двух игроков (30 коп. — двое). Во время игры монетный механизм не принимает. */
export function coin(s: MagState, ev: MagEvent[] = []): boolean {
  if (s.mode === 'play' || s.credits >= 2) {
    ev.push('rejected');
    return false;
  }
  s.credits++;
  if (s.mode !== 'ready') s.mode = 'ready';
  return true;
}

/** Сенсорная площадка «Выбор трассы». */
export function chooseTrack(s: MagState, t: TrackKind) {
  if (s.mode !== 'play') s.track = t;
}

/** Площадка «Старт»: играют столько, сколько оплачено (1 — левая трасса, 2 — обе). */
export function start(s: MagState, ev: MagEvent[] = []): boolean {
  if (s.mode !== 'ready' || s.credits < 1) return false;
  const n = s.credits;
  s.credits = 0;
  s.mode = 'play';
  s.time = 0;
  s.prizeRound = false;
  s.players = [newPlayer(), newPlayer()];
  for (let i = 0; i < n; i++) resetRun(s, s.players[i]);
  ev.push('start');
  return true;
}

function resetRun(s: MagState, p: Player) {
  p.on = true;
  p.x = TW / 2;
  p.y = playerY(s.track);
  p.speed = 0;
  p.dist = 0;
  p.crash = 0;
  p.boom = null;
  p.cars = [];
  p.prizeSign = null;
  p.won = false;
  p.finished = false;
  p.specIn = 8 + rnd(s) * 10;
  fill(s, p, true);
}

/** Сколько машин автомата держим на трассе. */
const quota = (t: TrackKind) => (t === 'night' ? 2 : t === 'race' ? 4 : 3);

function spawn(s: MagState, p: Player, initial: boolean): Mover {
  const t = s.track;
  const lane = (lo: number, hi: number) => lo + rnd(s) * (hi - lo);
  const yTop = initial ? -CAR_H - rnd(s) * TH * 0.9 : -CAR_H - rnd(s) * 260;
  if (t === 'race') {
    // слева от осевой — встречные (до трёх), справа — одна попутная, обычная или вдвое шире
    const ahead = p.cars.some((c) => c.vy < 0 || c.kind === 'wide' || (c.kind === 'car' && c.x > TW / 2));
    if (!ahead) {
      const wide = rnd(s) < 0.4;
      const w = wide ? CAR_W * 2 : CAR_W;
      return { x: lane(TW / 2 + 10 + w / 2, TW - 22 - w / 2), y: initial ? -CAR_H * 2 : -CAR_H, w, vy: 0, vx: 0, kind: wide ? 'wide' : 'car' };
    }
    return { x: lane(26 + CAR_W / 2, TW / 2 - 10 - CAR_W / 2), y: yTop, w: CAR_W, vy: 0, vx: 0, kind: 'car' };
  }
  const x = lane(26 + CAR_W / 2, TW - 26 - CAR_W / 2);
  if (t === 'ice') return { x, y: yTop, w: CAR_W, vy: 0, vx: (rnd(s) < 0.5 ? -1 : 1) * (50 + rnd(s) * 70), kind: 'car' };
  return { x, y: yTop, w: CAR_W, vy: 0, vx: 0, kind: 'car' };
}

function fill(s: MagState, p: Player, initial: boolean) {
  let guard = 0;
  while (p.cars.filter((c) => c.kind !== 'spec').length < quota(s.track) && guard++ < 20) {
    const c = spawn(s, p, initial);
    // не ставить вплотную к другой
    if (p.cars.some((o) => Math.abs(o.y - c.y) < CAR_H * 1.6 && Math.abs(o.x - c.x) < (o.w + c.w) / 2 + 10)) continue;
    p.cars.push(c);
  }
}

/** Скорость машины автомата относительно трассы (точек/с; + — вниз по экрану при скорости игрока v). */
function relSpeed(s: MagState, c: Mover, v: number): number {
  switch (s.track) {
    case 'learn':
    case 'night':
      return v; // стоят на дороге — «едут» навстречу со скоростью игрока
    case 'race':
      return c.x < TW / 2 && c.kind === 'car' ? v + 200 : v - 290; // встречная полоса / попутная машина
    case 'special':
      return c.kind === 'spec' ? v - 700 : v - 250;
    default:
      return v - 260;
  }
}

const hit = (p: Player, c: Mover) => Math.abs(p.x - c.x) < (CAR_W + c.w) / 2 - 6 && Math.abs(p.y - c.y) < CAR_H - 10;

export function step(s: MagState, dt: number, ev: MagEvent[] = []) {
  s.clock += dt;
  if (s.mode === 'over') {
    s.overT += dt;
    if (s.overT >= OVER_TIME) {
      s.mode = s.credits ? 'ready' : 'attract';
      ev.push('attract');
    }
    return;
  }
  if (s.mode !== 'play') return;
  s.time += dt;
  const green = Math.min(1, s.time / SESSION);
  for (const p of s.players) {
    if (!p.on || p.finished) continue;
    // педаль → скорость (машина разгоняется и тормозит не мгновенно)
    const want = p.crash > 0 ? 0 : p.pedal * V_MAX;
    p.speed += Math.sign(want - p.speed) * Math.min(Math.abs(want - p.speed), (want > p.speed ? 380 : 700) * dt);
    if (p.crash > 0) {
      p.crash = Math.max(0, p.crash - dt);
      if (p.boom) p.boom.t += dt;
      if (p.crash === 0) {
        p.boom = null;
        p.x = TW / 2; // движение возобновляется автоматически
      }
    } else {
      p.x = Math.max(26 + CAR_W / 2, Math.min(TW - 26 - CAR_W / 2, p.x + p.wheel * STEER * dt));
    }
    const v = p.speed;
    p.dist += v * dt;
    p.scroll = (p.scroll + v * dt) % POST_GAP;
    // машины автомата
    if (s.track === 'special') {
      p.specIn -= dt;
      if (p.specIn <= 0 && !p.cars.some((c) => c.kind === 'spec')) {
        p.cars.push({ x: 26 + CAR_W / 2 + rnd(s) * (TW - 52 - CAR_W), y: TH + CAR_H, w: CAR_W, vy: 0, vx: 0, kind: 'spec' });
        p.specIn = 12 + rnd(s) * 10;
        ev.push('siren');
      }
    }
    for (const c of p.cars) {
      c.vy = relSpeed(s, c, v);
      c.y += c.vy * dt;
      if (c.vx) {
        c.x += c.vx * dt;
        const lo = 26 + c.w / 2, hi = TW - 26 - c.w / 2;
        if (c.x < lo || c.x > hi) {
          c.x = Math.max(lo, Math.min(hi, c.x));
          c.vx = -c.vx;
        }
      }
    }
    p.cars = p.cars.filter((c) => c.y < TH + CAR_H * 1.5 && c.y > -TH * 1.2);
    fill(s, p, false);
    // столкновение
    if (p.crash === 0) {
      const c = p.cars.find((x) => hit(p, x));
      if (c) {
        p.crash = CRASH_TIME;
        p.boom = { x: (p.x + c.x) / 2, y: (p.y + c.y) / 2, t: 0 };
        p.speed = 0;
        p.cars = p.cars.filter((x) => x !== c);
        ev.push('crash');
      }
    }
    // финиш раньше контрольного — надпись ПРИЗ, которую надо пересечь
    if (!p.won && !s.prizeRound && p.dist >= FINISH && green < 1) {
      p.won = true;
      p.prizeSign = -60;
      ev.push('finish');
    }
    if (p.prizeSign !== null) {
      p.prizeSign += v * dt;
      if (Math.abs(p.prizeSign - p.y) < 40 && p.crash === 0) {
        p.prize = true;
        p.prizeSign = null;
        ev.push('prize');
      } else if (p.prizeSign > TH + 40) p.prizeSign = null;
    }
  }
  if (s.time >= SESSION) {
    const winners = s.players.filter((p) => p.on && p.prize && !s.prizeRound);
    if (winners.length) {
      // призовая игра — ещё сеанс для тех, кто пересёк ПРИЗ
      s.prizeRound = true;
      s.time = 0;
      for (const p of s.players) {
        if (p.on && p.prize) resetRun(s, p);
        else p.finished = true;
      }
      return;
    }
    s.mode = 'over';
    s.overT = 0;
    for (const p of s.players) {
      p.speed = 0;
      p.finished = true;
    }
    ev.push('over');
  }
}

/** Индикаторы 0…1: игрок — пройденный путь, зелёный — время × средняя скорость. */
export const indicator = (p: Player) => Math.min(1, p.dist / FINISH);
export const greenIndicator = (s: MagState) => Math.min(1, s.time / SESSION);
export const postOffset = (p: Player) => p.scroll;
export { POST_GAP };
