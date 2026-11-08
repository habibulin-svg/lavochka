/* Физика щелчков (без DOM): плоские шашки скользят по доске с трением, сталкиваются друг с другом с потерей энергии
 * (дерево о дерево — не бильярд), без бортов — падают за край (центр вышел за доску), с бортами — отскакивают и проваливаются
 * в лузы (карром). Чапаев с вариантами: неподвижные «дома» (прямоугольники — спичечные коробки), от которых шашки отскакивают;
 * лунки-ловушки (медленная шашка над лункой проваливается, быстрая перескакивает); пятна льда и песка (трение меньше/больше);
 * ветер (постоянный снос всех движущихся шашек).
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
  /** Упала с доски / в лузу / в лунку-ловушку. */
  gone?: 'off' | 'pocket' | 'trap';
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
  /** Неподвижные прямоугольники (центр, полуширина, полувысота): шашки отскакивают с упругостью eBox. */
  boxes?: Box[];
  eBox?: number;
  /** Пятна с другим трением: круг и множитель трения (лёд < 1, песок > 1). */
  zones?: Zone[];
  /** Лунки: шашка, чей центр над лункой, проваливается, если скорость меньше v. */
  traps?: Trap[];
  /** Ветер: ускорение движущихся шашек (клеток/с²). */
  wind?: { x: number; y: number };
}

export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}
export interface Zone {
  x: number;
  y: number;
  r: number;
  k: number;
}
export interface Trap {
  x: number;
  y: number;
  r: number;
  v: number;
}

export interface SimResult {
  discs: Disc[];
  /** Кадры для показа: положения (x, y, gone) по id, раз в frameDt. */
  frames: { t: number; p: [number, number, number][] }[];
  /** Удары (для звука): время и сила. */
  hits: { t: number; v: number; wall?: boolean; box?: boolean }[];
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
  const snap = (t: number) => frames.push({ t, p: ds.map((d) => [Math.round(d.x * 1000) / 1000, Math.round(d.y * 1000) / 1000, d.gone === 'trap' ? 2 : d.gone ? 1 : 0]) });
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
      let fr = field.friction;
      if (field.zones) for (const z of field.zones) if (len(d.x - z.x, d.y - z.y) < z.r) fr *= z.k;
      const dv = fr * DT;
      const k = v > dv ? (v - dv) / v : 0;
      d.vx *= k;
      d.vy *= k;
      // ветер сносит только то, что едет (и не разгоняет стоящую)
      if (field.wind && k > 0) {
        d.vx += field.wind.x * DT;
        d.vy += field.wind.y * DT;
      }
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
    // борта, лузы, край, дома, лунки
    for (const d of ds) {
      if (d.gone) continue;
      if (field.boxes)
        for (const b of field.boxes) {
          // ближайшая точка прямоугольника к центру шашки
          const cx = Math.max(b.x - b.hw, Math.min(b.x + b.hw, d.x));
          const cy = Math.max(b.y - b.hh, Math.min(b.y + b.hh, d.y));
          let nx = d.x - cx;
          let ny = d.y - cy;
          let dist = len(nx, ny);
          if (dist >= d.r) continue;
          if (dist === 0) {
            // центр внутри — выталкиваем по ближайшей стороне
            const px = b.hw - Math.abs(d.x - b.x);
            const py = b.hh - Math.abs(d.y - b.y);
            if (px < py) (nx = Math.sign(d.x - b.x) || 1), (ny = 0), (dist = -px);
            else (nx = 0), (ny = Math.sign(d.y - b.y) || 1), (dist = -py);
          } else (nx /= dist), (ny /= dist);
          d.x += nx * (d.r - dist);
          d.y += ny * (d.r - dist);
          const vn = d.vx * nx + d.vy * ny;
          if (vn < 0) {
            const eb = field.eBox ?? 0.5;
            d.vx -= (1 + eb) * vn * nx;
            d.vy -= (1 + eb) * vn * ny;
            hits.push({ t, v: -vn, box: true });
          }
        }
      if (field.traps) {
        const v = len(d.vx, d.vy);
        for (const p of field.traps)
          if (v < p.v && len(d.x - p.x, d.y - p.y) < p.r) {
            d.gone = 'trap';
            d.x = p.x;
            d.y = p.y;
            d.vx = d.vy = 0;
          }
        if (d.gone) continue;
      }
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
