/* Физика щелчков (без DOM): плоские шашки скользят по доске с трением, упруго сталкиваются друг с другом,
 * без бортов — падают за край (центр вышел за доску), с бортами — отскакивают и проваливаются в лузы (карром).
 * Единицы — клетки доски (Чапаев: доска 8×8) и секунды. Шаг по времени постоянный, расчёт детерминированный —
 * один и тот же удар у всех игроков и у сервера даёт одно и то же (только сложения и умножения, без случайности). */

export interface Disc {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Масса (биток каррома чуть тяжелее). */
  m: number;
  vx: number;
  vy: number;
  /** Упала с доски / в лузу. */
  gone?: 'off' | 'pocket';
}

export interface Field {
  w: number;
  h: number;
  /** Борта: отскок от краёв (иначе — падение за край). */
  walls: boolean;
  /** Лузы: центры и радиус «провала» (центр шашки ближе — упала). */
  pockets: { x: number; y: number; r: number }[];
  /** Замедление от трения (клеток/с²). */
  friction: number;
  /** Упругость соударения шашек и с бортом. */
  e: number;
  eWall: number;
}

export interface SimResult {
  discs: Disc[];
  /** Кадры для показа: положения (x, y, gone) по id, раз в frameDt. */
  frames: { t: number; p: [number, number, number][] }[];
  /** Удары (для звука): время и сила. */
  hits: { t: number; v: number; wall?: boolean }[];
  /** Первое касание битка: id шашки, по которой попал (−1 — ни по какой). */
  first: number;
}

const DT = 1 / 240;
/** Длина вектора: sqrt точен везде одинаково (у Math.hypot точность в разных движках разная). */
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
const MAX_T = 12;

/** Прогнать удар до остановки. Исходные шашки не меняются. */
export function simulate(field: Field, discs0: Disc[], strikerId: number, frameDt = 1 / 30): SimResult {
  const ds = discs0.map((d) => ({ ...d }));
  const live = () => ds.filter((d) => !d.gone);
  const frames: SimResult['frames'] = [];
  const hits: SimResult['hits'] = [];
  let first = -1;
  let nextFrame = 0;
  const snap = (t: number) => frames.push({ t, p: ds.map((d) => [Math.round(d.x * 1000) / 1000, Math.round(d.y * 1000) / 1000, d.gone ? 1 : 0]) });
  snap(0);
  let t = 0;
  for (; t < MAX_T; t += DT) {
    let moving = false;
    for (const d of ds) {
      if (d.gone) continue;
      const v = len(d.vx, d.vy);
      if (v <= 1e-4) {
        d.vx = d.vy = 0;
        continue;
      }
      moving = true;
      const dv = field.friction * DT;
      const k = v > dv ? (v - dv) / v : 0;
      d.vx *= k;
      d.vy *= k;
      d.x += d.vx * DT;
      d.y += d.vy * DT;
    }
    // соударения шашек
    const L = live();
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i];
        const b = L[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = len(dx, dy);
        const min = a.r + b.r;
        if (dist >= min || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        // развести, чтобы не слипались
        const over = (min - dist) / 2;
        a.x -= nx * over;
        a.y -= ny * over;
        b.x += nx * over;
        b.y += ny * over;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        const jimp = ((1 + field.e) * rel) / (1 / a.m + 1 / b.m);
        a.vx -= (jimp / a.m) * nx;
        a.vy -= (jimp / a.m) * ny;
        b.vx += (jimp / b.m) * nx;
        b.vy += (jimp / b.m) * ny;
        hits.push({ t, v: rel });
        if (first < 0 && (a.id === strikerId || b.id === strikerId)) first = a.id === strikerId ? b.id : a.id;
      }
    // борта, лузы, край
    for (const d of ds) {
      if (d.gone) continue;
      for (const p of field.pockets)
        if (len(d.x - p.x, d.y - p.y) < p.r) {
          d.gone = 'pocket';
          d.vx = d.vy = 0;
        }
      if (d.gone) continue;
      if (field.walls) {
        if (d.x < d.r && d.vx < 0) (d.x = d.r), (d.vx = -d.vx * field.eWall), hits.push({ t, v: Math.abs(d.vx), wall: true });
        if (d.x > field.w - d.r && d.vx > 0) (d.x = field.w - d.r), (d.vx = -d.vx * field.eWall), hits.push({ t, v: Math.abs(d.vx), wall: true });
        if (d.y < d.r && d.vy < 0) (d.y = d.r), (d.vy = -d.vy * field.eWall), hits.push({ t, v: Math.abs(d.vy), wall: true });
        if (d.y > field.h - d.r && d.vy > 0) (d.y = field.h - d.r), (d.vy = -d.vy * field.eWall), hits.push({ t, v: Math.abs(d.vy), wall: true });
      } else if (d.x < 0 || d.y < 0 || d.x > field.w || d.y > field.h) {
        d.gone = 'off';
      }
    }
    if (t >= nextFrame) {
      snap(t);
      nextFrame += frameDt;
    }
    if (!moving) break;
  }
  for (const d of ds) if (!d.gone) (d.vx = 0), (d.vy = 0);
  snap(t);
  return { discs: ds, frames, hits, first };
}

/** Скорость удара по силе 0…1 (максимум — через всю доску с запасом). */
export const shotSpeed = (power: number, max: number) => Math.max(0.05, Math.min(1, power)) * max;
