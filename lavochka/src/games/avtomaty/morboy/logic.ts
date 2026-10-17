/* «Морской бой» (электромеханический, 1974) — логика по заводскому техописанию (docs/analysis/seafight.md).
 * Без интерфейса: шаг по времени, монета, пуск, поворот перископа. Единицы — сантиметры панорамы и секунды.
 * Два корабля на цепи через полцепи; восемь трасс по 10 лампочек; торпеда идёт по такту генератора; попадание —
 * если в конце трассы корабль стоит в точке трассы (ламель под контактом цепи); после попадания — реверс целей. */

export const TRACKS = 8;
/** Видимая полуширина панорамы и точки трасс на линии горизонта. */
export const HALF_W = 24;
export const trackX = (k: number) => -21 + 6 * k;
/** Скорость цепи, см/с. */
export const SHIP_V = 4.5;
/** Такт генератора коммутатора трассы, с: 1-й такт — выбор трассы, 2…11-й — лампочки, 12-й — конец трассы. */
export const TICK = 0.15;
export const TRACK_TIME = 11 * TICK;
/** Зона поражения: ±2 см (не более 4 см по техописанию). */
export const HIT_ZONE = 2;
/** Затемнение панорамы при взрыве — пока корабль разворачивается. */
export const BLAST_TIME = 1.6;
export const LAUNCHES = 10;
export const PRIZE_LAUNCHES = 3;
/** Длина корабля, см. */
export const SHIP_LEN = 7.5;
/** Перископ: пределы поворота (центр поля зрения) и поле зрения, см. */
export const AIM_MAX = 19;
export const FOV = 30;

/** Цепь: передний (видимый) участок с запасом за боковыми щитами, задний — скрыт. */
const MARGIN = 6;
const FRONT = 2 * (HALF_W + MARGIN);
const LOOP = 2 * FRONT + 14;

export type SeaEvent = 'start' | 'launch' | 'hit' | 'miss' | 'prize' | 'over' | 'rejected';

export interface Ship {
  /** Тип силуэта: 0 — крейсер, 1 — эсминец. */
  kind: number;
  x: number;
  /** Куда смотрит нос: +1 вправо, −1 влево. */
  dir: 1 | -1;
}

export interface SeaState {
  playing: boolean;
  launches: number;
  hits: number;
  prize: boolean;
  /** Транспарант «ПУСК» горит — можно пускать. */
  ready: boolean;
  alarm: boolean;
  /** Горит «ТОРПЕДИРОВАНО» (с первого попадания до конца игры). */
  torpedoed: boolean;
  torpedo: { track: number; t: number } | null;
  /** Остаток затемнения после взрыва и трасса взрыва. */
  blast: number;
  blastTrack: number;
  /** Положение цепи и направление. */
  chain: number;
  dir: 1 | -1;
  /** Перископ: центр поля зрения (средний визир) на линии горизонта, см. */
  aim: number;
  /** Счётчики табло: номера, что горят (0 — ни один). */
  litLaunch: number;
  litHit: number;
  /** Время с включения — для «розы ветров» и тревоги. */
  time: number;
}

export function newSea(): SeaState {
  return {
    playing: false,
    launches: 0,
    hits: 0,
    prize: false,
    ready: false,
    alarm: false,
    torpedoed: false,
    torpedo: null,
    blast: 0,
    blastTrack: 0,
    chain: 9,
    dir: 1,
    aim: 0,
    litLaunch: 0,
    litHit: 0,
    time: 0,
  };
}

/** Трасса, которую выбирает перископ: ближайшая к среднему визиру ламель колодки. */
export const trackOfAim = (aim: number) => Math.max(0, Math.min(TRACKS - 1, Math.round((aim - trackX(0)) / 6)));

/** Видимые корабли (на переднем участке цепи). */
export function ships(s: SeaState): Ship[] {
  const out: Ship[] = [];
  for (let i = 0; i < 2; i++) {
    const p = (((s.chain + (i * LOOP) / 2) % LOOP) + LOOP) % LOOP;
    if (p < FRONT) out.push({ kind: i, x: -HALF_W - MARGIN + p, dir: s.dir });
  }
  return out;
}

/** Номер на счётчике: пуски/попадания 11–13 призовой игры идут как 1–3 (десятый продолжает гореть). */
const shown = (n: number) => (n > LAUNCHES ? n - LAUNCHES : n);

/** Монета (или кнопка «ПРОВЕРКА»). Во время игры монетный механизм обесточен — монета уходит в возврат. */
export function coin(s: SeaState, ev: SeaEvent[] = []): boolean {
  if (s.playing) {
    ev.push('rejected');
    return false;
  }
  Object.assign(s, { playing: true, launches: 0, hits: 0, prize: false, ready: true, alarm: true, torpedoed: false, torpedo: null, blast: 0, litLaunch: 0, litHit: 0 });
  ev.push('start');
  return true;
}

/** Кнопка «ПУСК» на правой рукоятке (нажатие). */
export function fire(s: SeaState, ev: SeaEvent[] = []): boolean {
  if (!s.playing || !s.ready || s.torpedo || s.blast > 0) return false;
  s.ready = false;
  s.alarm = false;
  s.launches++;
  s.litLaunch = shown(s.launches);
  s.torpedo = { track: trackOfAim(s.aim), t: 0 };
  ev.push('launch');
  return true;
}

export function turn(s: SeaState, aim: number) {
  s.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, aim));
}

/** Попал бы корабль: точка трассы в зоне поражения от центра видимого корабля. */
export function shipAt(s: SeaState, x: number): Ship | null {
  for (const sh of ships(s)) if (Math.abs(sh.x - x) <= HIT_ZONE) return sh;
  return null;
}

function afterShot(s: SeaState, ev: SeaEvent[]) {
  const total = LAUNCHES + (s.prize ? PRIZE_LAUNCHES : 0);
  if (s.launches >= total) {
    s.playing = false;
    s.ready = false;
    s.prize = false;
    s.litLaunch = 0;
    ev.push('over');
  } else s.ready = true;
}

export function step(s: SeaState, dt: number, ev: SeaEvent[] = []) {
  s.time += dt;
  if (s.playing) s.chain = (((s.chain + s.dir * SHIP_V * dt) % LOOP) + LOOP) % LOOP;
  if (s.torpedo) {
    s.torpedo.t += dt;
    if (s.torpedo.t >= TRACK_TIME) {
      const k = s.torpedo.track;
      s.torpedo = null;
      if (shipAt(s, trackX(k))) {
        s.hits++;
        s.litHit = shown(s.hits);
        s.torpedoed = true;
        s.blast = BLAST_TIME;
        s.blastTrack = k;
        s.dir = s.dir === 1 ? -1 : 1; // реверс целей после каждого поражения
        ev.push('hit');
        if (s.hits === LAUNCHES && s.launches === LAUNCHES) {
          s.prize = true;
          ev.push('prize');
        }
      } else {
        ev.push('miss');
        afterShot(s, ev);
      }
    }
  }
  if (s.blast > 0) {
    s.blast = Math.max(0, s.blast - dt);
    if (s.blast === 0) afterShot(s, ev);
  }
}

/** Какая лампочка трассы горит (1…10) или 0. */
export function torpedoLamp(s: SeaState): number {
  if (!s.torpedo) return 0;
  const n = Math.floor(s.torpedo.t / TICK); // 0 — такт выбора трассы
  return n >= 1 && n <= 10 ? n : 0;
}

/** «Роза ветров» и пачки тревоги: мультивибратор ≈2 Гц. */
export const roseOn = (s: SeaState) => Math.floor(s.time * 4) % 2 === 0;
