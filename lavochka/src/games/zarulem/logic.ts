/* «За рулём» (Томский приборный завод) — логика без DOM. Сверху вращается диск с трассой, машинка на магните стоит у правого края
 * окна и ездит рулём только поперёк — от центра диска к краю. Диск крутится против часовой (дорога «бежит» на машинку),
 * рычаг — скорость 0–3, ключ — включить. В оригинале счёта не было; здесь одометр считает метры по дороге,
 * а наехать на дерево, опору моста или человечка, или долго ехать по траве — авария (три аварии — конец).
 * Координаты диска — доли радиуса, угол φ — в системе диска (против часовой от правого края). */

export type Mode = 'outer' | 'inner';

export interface Path {
  /** Где действует: весь круг (null) или сектор [от, до] по φ. */
  from: number | null;
  to: number;
  /** Радиус середины дороги и полуширина. */
  r: (phi: number) => number;
  w: number;
}

export interface Thing {
  phi: number;
  r: number;
  /** Размер препятствия (доля радиуса); 0 — только украшение. */
  size: number;
  kind: 'tree' | 'pillar' | 'man' | 'house' | 'cone' | 'light' | 'sign';
}

export interface Bridge {
  phi: number;
  path: number;
}

export const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Плавный горб на секторе [a, b]: 0 на краях, 1 посередине. */
const bump = (phi: number, a: number, b: number) => {
  const t = (norm(phi - a) / norm(b - a)) * Math.PI;
  return norm(phi - a) <= norm(b - a) ? Math.sin(t) ** 2 : 0;
};

export interface Track {
  paths: Path[];
  things: Thing[];
  bridges: Bridge[];
}

export function makeTrack(mode: Mode): Track {
  if (mode === 'inner') {
    const r = (p: number) => 0.47 + 0.11 * Math.sin(2 * p + 0.5) + 0.05 * Math.sin(5 * p);
    const paths: Path[] = [
      { from: null, to: 0, r, w: 0.062 },
      // ответвление наружу и обратно
      { from: 3.6, to: 5.0, r: (p) => r(p) + 0.17 * bump(p, 3.6, 5.0), w: 0.05 },
    ];
    const things: Thing[] = [];
    // человечки и конусы прямо на дороге — объезжать в пределах полосы
    for (const [phi, off, kind] of [
      [0.6, 0.032, 'man'],
      [1.5, -0.034, 'cone'],
      [2.3, 0.03, 'cone'],
      [2.9, -0.03, 'man'],
      [4.3, 0.0, 'cone'],
      [5.6, 0.033, 'cone'],
    ] as [number, number, Thing['kind']][])
      things.push({ phi, r: r(phi) + off, size: 0.022, kind });
    decorate(things, paths);
    return { paths, things, bridges: [{ phi: 1.1, path: 0 }, { phi: 3.3, path: 0 }, { phi: 5.25, path: 0 }] };
  }
  const r = (p: number) => 0.76 + 0.06 * Math.sin(3 * p) + 0.025 * Math.sin(7 * p + 1);
  const paths: Path[] = [
    { from: null, to: 0, r, w: 0.078 },
    { from: 1.0, to: 2.3, r: (p) => r(p) - 0.2 * bump(p, 1.0, 2.3), w: 0.06 },
  ];
  const things: Thing[] = [{ phi: 4.6, r: r(4.6) + 0.04, size: 0.02, kind: 'man' }];
  decorate(things, paths);
  return { paths, things, bridges: [{ phi: 0.5, path: 0 }, { phi: 2.9, path: 0 }, { phi: 4.9, path: 0 }] };
}

/** Деревья, домики, светофоры вдоль дороги (по траве) — тоже препятствия, кроме домиков подальше. */
function decorate(things: Thing[], paths: Path[]) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    const phi = rnd() * TAU;
    const r = 0.18 + rnd() * 0.78;
    if (r > 0.97) continue;
    const near = paths.some((p) => active(p, phi) && Math.abs(r - p.r(phi)) < p.w + 0.05);
    if (near) continue;
    const k = rnd();
    things.push({ phi, r, size: k < 0.65 ? 0.03 : 0, kind: k < 0.65 ? 'tree' : k < 0.85 ? 'house' : k < 0.93 ? 'light' : 'sign' });
  }
}

export const active = (p: Path, phi: number) => p.from == null || norm(phi - p.from) <= norm(p.to - p.from);

export function onRoad(t: Track, phi: number, r: number): boolean {
  return t.paths.some((p) => active(p, phi) && Math.abs(r - p.r(phi)) <= p.w);
}

/** Опоры мостов — по краям дороги. */
export function pillars(t: Track): Thing[] {
  return t.bridges.flatMap((b) => {
    const p = t.paths[b.path];
    const rc = p.r(b.phi);
    return [
      { phi: b.phi, r: rc - p.w - 0.05, size: 0.025, kind: 'pillar' as const },
      { phi: b.phi, r: rc + p.w + 0.05, size: 0.025, kind: 'pillar' as const },
    ];
  });
}

/** Скорость диска по передаче, рад/с. */
export const GEARS = [0, 0.32, 0.55, 0.85];
/** Метров в радиусе диска (для одометра). */
export const METERS = 120;
const CAR_R = 0.028;
const STEER = 0.55;
export const POS_MIN = 0.16;
export const POS_MAX = 0.95;

export class Drive {
  readonly track: Track;
  /** Поворот диска (рад). */
  rot = 0;
  /** Машинка: доля радиуса от центра. */
  pos: number;
  gear = 1;
  on = false;
  meters = 0;
  crashes = 0;
  over = false;
  /** После аварии диск стоит, машинка мигает. */
  stun = 0;
  /** Сколько секунд подряд по траве. */
  grass = 0;
  laps = 0;
  sounds: ('crash' | 'grass' | 'lap')[] = [];
  private all: Thing[];
  private lastLap = 0;

  constructor(readonly mode: Mode) {
    this.track = makeTrack(mode);
    this.all = [...this.track.things, ...pillars(this.track)];
    this.pos = this.track.paths[0].r(this.phi());
  }

  /** Угол диска под машинкой (машинка — у правого края окна, φ экрана = 0). */
  phi(): number {
    return norm(-this.rot);
  }

  get onRoad() {
    return onRoad(this.track, this.phi(), this.pos);
  }

  /** Руль: −1 — к центру, +1 — к краю. */
  update(ms: number, steer: number) {
    if (this.over) return;
    const dt = Math.min(0.1, ms / 1000);
    if (this.stun > 0) {
      this.stun -= dt;
      return;
    }
    this.pos = Math.min(POS_MAX, Math.max(POS_MIN, this.pos + steer * STEER * dt));
    if (!this.on || !this.gear) return;
    const road = this.onRoad;
    const w = GEARS[this.gear] * (road ? 1 : 0.45);
    this.rot += w * dt;
    if (road) {
      this.meters += w * dt * this.pos * METERS;
      this.grass = 0;
    } else {
      if (this.grass === 0) this.sounds.push('grass');
      this.grass += dt;
      if (this.grass > 2.5) return this.crash();
    }
    const lap = Math.floor(this.rot / TAU);
    if (lap > this.lastLap) {
      this.lastLap = lap;
      this.laps = lap;
      this.sounds.push('lap');
    }
    if (this.hit()) this.crash();
  }

  /** Наехал на препятствие. */
  hit(): Thing | null {
    const phi = this.phi();
    const cx = Math.cos(phi) * this.pos;
    const cy = Math.sin(phi) * this.pos;
    for (const t of this.all) {
      if (!t.size) continue;
      const dx = Math.cos(t.phi) * t.r - cx;
      const dy = Math.sin(t.phi) * t.r - cy;
      if (dx * dx + dy * dy < (t.size + CAR_R) ** 2) return t;
    }
    return null;
  }

  private crash() {
    this.crashes++;
    this.sounds.push('crash');
    this.grass = 0;
    this.stun = 1.3;
    // машинку ставят обратно на середину дороги чуть дальше
    this.rot += 0.12;
    const phi = this.phi();
    const p = this.track.paths.find((x) => active(x, phi) && x.from == null) ?? this.track.paths[0];
    this.pos = p.r(phi);
    if (this.crashes >= 3) this.over = true;
  }

  /** Очки — метры по дороге, на высокой передаче дороже. */
  get score() {
    return Math.floor(this.meters);
  }
}
