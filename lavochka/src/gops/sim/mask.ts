/* Маска ландшафта ГОПС: d[y·w + x] = 1 — земля, 0 — воздух. За картой — воздух.
 * Пиксель в круге (cx, cy, r), если (x−cx)² + (y−cy)² ≤ r². Всё на целых. */

/** Полуширины строк круга радиуса r: hw[|dy|] = наибольшее целое с hw² ≤ r² − dy². */
const spans = new Map<number, Int32Array>();
function halfWidths(r: number): Int32Array {
  let s = spans.get(r);
  if (!s) {
    s = new Int32Array(r + 1);
    let hw = r;
    for (let dy = 0; dy <= r; dy++) {
      while (hw * hw > r * r - dy * dy) hw--;
      s[dy] = hw;
    }
    spans.set(r, s);
  }
  return s;
}

export class Mask {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8Array;

  constructor(w: number, h: number, data?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.d = data ? new Uint8Array(data) : new Uint8Array(w * h);
  }

  solid(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[y * this.w + x] === 1;
  }

  set(x: number, y: number, v: 0 | 1): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = v;
  }

  count(): number {
    let c = 0;
    for (let i = 0; i < this.d.length; i++) c += this.d[i];
    return c;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, x), x1 = Math.min(this.w, x + w);
    const y0 = Math.max(0, y), y1 = Math.min(this.h, y + h);
    if (x0 >= x1) return;
    for (let yy = y0; yy < y1; yy++) this.d.fill(1, yy * this.w + x0, yy * this.w + x1);
  }

  /**
   * Обход строк круга, обрезанных по карте: fn(начало, конец) — индексы в d, конец не включён.
   * fn возвращает true — обход прерывается (для «есть ли земля»).
   */
  private eachRow(cx: number, cy: number, r: number, fn: (a: number, b: number, y: number) => boolean | void): void {
    const hw = halfWidths(r);
    const ya = Math.max(0, cy - r), yb = Math.min(this.h - 1, cy + r);
    for (let y = ya; y <= yb; y++) {
      const s = hw[Math.abs(y - cy)];
      const xa = Math.max(0, cx - s), xb = Math.min(this.w - 1, cx + s);
      if (xa > xb) continue;
      if (fn(y * this.w + xa, y * this.w + xb + 1, y)) return;
    }
  }

  fillCircle(cx: number, cy: number, r: number): number {
    let n = 0;
    const d = this.d;
    this.eachRow(cx, cy, r, (a, b) => {
      for (let i = a; i < b; i++) if (d[i] === 0) { d[i] = 1; n++; }
    });
    return n;
  }

  carveCircle(cx: number, cy: number, r: number): number {
    let n = 0;
    const d = this.d;
    this.eachRow(cx, cy, r, (a, b) => {
      for (let i = a; i < b; i++) if (d[i] === 1) { d[i] = 0; n++; }
    });
    return n;
  }

  countCircle(cx: number, cy: number, r: number): number {
    let n = 0;
    const d = this.d;
    this.eachRow(cx, cy, r, (a, b) => {
      for (let i = a; i < b; i++) n += d[i];
    });
    return n;
  }

  hitsCircle(cx: number, cy: number, r: number): boolean {
    let hit = false;
    const d = this.d;
    this.eachRow(cx, cy, r, (a, b) => {
      for (let i = a; i < b; i++) if (d[i] === 1) return (hit = true);
    });
    return hit;
  }

  /** Сумма (cx−x, cy−y) по земле в круге — смотрит от земли к центру; без земли — [0, 0]. */
  normal(cx: number, cy: number, r: number): [number, number] {
    let sx = 0, sy = 0;
    const d = this.d, w = this.w;
    this.eachRow(cx, cy, r, (a, b, y) => {
      for (let i = a; i < b; i++) {
        if (d[i] === 1) {
          sx += cx - (i - y * w);
          sy += cy - y;
        }
      }
    });
    return [sx, sy];
  }

  /** Капсула: всё, что ближе r к отрезку (x0,y0)–(x1,y1). */
  carveSegment(x0: number, y0: number, x1: number, y1: number, r: number): number {
    const dx = x1 - x0, dy = y1 - y0;
    const L = dx * dx + dy * dy;
    if (L === 0) return this.carveCircle(x0, y0, r);
    const rr = r * r;
    const xa = Math.max(0, Math.min(x0, x1) - r), xb = Math.min(this.w - 1, Math.max(x0, x1) + r);
    const ya = Math.max(0, Math.min(y0, y1) - r), yb = Math.min(this.h - 1, Math.max(y0, y1) + r);
    let n = 0;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const i = y * this.w + x;
        if (this.d[i] === 0) continue;
        const px = x - x0, py = y - y0;
        const t = px * dx + py * dy;
        let inside: boolean;
        if (t <= 0) inside = px * px + py * py <= rr;
        else if (t >= L) inside = (x - x1) * (x - x1) + (y - y1) * (y - y1) <= rr;
        else {
          const cross = px * dy - py * dx;
          inside = cross * cross <= rr * L;
        }
        if (inside) {
          this.d[i] = 0;
          n++;
        }
      }
    }
    return n;
  }

  /** Брезенхем от (x0,y0) до (x1,y1) включительно: первый твёрдый пиксель или null. */
  raycast(x0: number, y0: number, x1: number, y1: number): [number, number] | null {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (;;) {
      if (this.solid(x, y)) return [x, y];
      if (x === x1 && y === y1) return null;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  surfaceBelow(x: number, y: number): number {
    if (x < 0 || x >= this.w) return -1;
    for (let yy = Math.max(0, y); yy < this.h; yy++) if (this.d[yy * this.w + x] === 1) return yy;
    return -1;
  }

  /** FNV-1a по байтам маски. */
  hash(): number {
    let h = 0x811c9dc5;
    const d = this.d;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193);
    return h >>> 0;
  }
}
