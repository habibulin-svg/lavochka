/* Общее для аркад на canvas (Шарики, Клад, Яйца динозавров): картинки из public/arcade/<игра>/ (собирает tools/arcade-art),
 * частицы-осколки и искры, всплывающие очки и надписи («Комбо ×3»), тряска поля. Без зависимостей от игры. */

const BASE = import.meta.env.BASE_URL;

/** Картинки игры: пока не загрузилась — `get` отдаёт null, и игра рисует запасной вариант кодом. */
export class Sprites<K extends string> {
  private imgs = new Map<K, HTMLImageElement>();

  constructor(game: string, names: readonly K[]) {
    for (const n of names) {
      const im = new Image();
      im.decoding = 'async';
      im.src = `${BASE}arcade/${game}/${n}.webp`;
      this.imgs.set(n, im);
    }
  }

  get(n: K): HTMLImageElement | null {
    const im = this.imgs.get(n);
    return im && im.complete && im.naturalWidth ? im : null;
  }

  url(n: K): string {
    return this.imgs.get(n)?.src ?? '';
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
  kind: 'spark' | 'chip' | 'ring';
  rot: number;
  vr: number;
}

interface Float {
  x: number;
  y: number;
  /** На сколько всплыла (вверх по экрану). */
  rise: number;
  text: string;
  life: number;
  max: number;
  size: number;
  color: string;
}

/** Частицы, надписи и тряска. update(dt мс) каждый кадр, draw(g) — поверх поля (кроме shake — его применяют до поля). */
export class Fx {
  private ps: Particle[] = [];
  private fl: Float[] = [];
  private shakeT = 0;
  private shakeA = 0;
  /** Вниз тянет осколки (единиц поля в с²). */
  gravity = 900;
  /** Поворот надписей относительно поля — если поле на экране повёрнуто, надписи разворачиваем обратно. */
  textAngle = 0;

  /** Взрыв: искры и осколки цвета color. */
  burst(x: number, y: number, color: string, n = 12, speed = 220, size = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.8);
      const chip = i % 3 !== 0;
      this.ps.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (chip ? speed * 0.4 : 0),
        life: 0, max: chip ? 0.55 + Math.random() * 0.35 : 0.35 + Math.random() * 0.2,
        r: size * (chip ? 0.7 + Math.random() * 0.8 : 0.5 + Math.random() * 0.4),
        color: chip ? color : '#fff', kind: chip ? 'chip' : 'spark', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
      });
    }
  }

  /** Расходящееся кольцо (спецфишка, взрыв). */
  ring(x: number, y: number, color: string, r = 40) {
    this.ps.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.45, r, color, kind: 'ring', rot: 0, vr: 0 });
  }

  /** Всплывающая надпись: «+30», «Комбо ×2». */
  text(x: number, y: number, text: string, color = '#fff6c0', size = 22) {
    this.fl.push({ x, y, rise: 0, text, life: 0, max: 1.1, size, color });
  }

  shake(amount = 6, time = 0.25) {
    this.shakeA = Math.max(this.shakeA, amount);
    this.shakeT = Math.max(this.shakeT, time);
  }

  get busy(): boolean {
    return this.ps.length > 0 || this.fl.length > 0 || this.shakeT > 0;
  }

  update(ms: number) {
    const dt = Math.min(0.05, ms / 1000);
    for (const p of this.ps) {
      p.life += dt;
      if (p.kind === 'ring') continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'chip') p.vy += this.gravity * dt;
      p.vx *= 0.985;
      p.rot += p.vr * dt;
    }
    this.ps = this.ps.filter((p) => p.life < p.max);
    for (const f of this.fl) {
      f.life += dt;
      f.rise += 40 * dt;
    }
    this.fl = this.fl.filter((f) => f.life < f.max);
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (!this.shakeT) this.shakeA = 0;
  }

  /** Сдвиг для тряски — применить g.translate(...) перед рисованием поля. */
  offset(): [number, number] {
    if (!this.shakeT) return [0, 0];
    const a = this.shakeA * Math.min(1, this.shakeT / 0.15);
    return [(Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a];
  }

  draw(g: CanvasRenderingContext2D) {
    for (const p of this.ps) {
      const k = 1 - p.life / p.max;
      g.save();
      if (p.kind === 'ring') {
        g.globalAlpha = k;
        g.strokeStyle = p.color;
        g.lineWidth = 6 * k + 1;
        g.beginPath();
        g.arc(p.x, p.y, p.r * (0.4 + (1 - k) * 1.2), 0, Math.PI * 2);
        g.stroke();
      } else if (p.kind === 'spark') {
        g.globalAlpha = k;
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.r * (0.5 + k), 0, Math.PI * 2);
        g.fill();
      } else {
        g.globalAlpha = Math.min(1, k * 1.6);
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(-p.r, -p.r * 0.6);
        g.lineTo(p.r, -p.r * 0.2);
        g.lineTo(p.r * 0.2, p.r * 0.8);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.fillRect(-p.r * 0.5, -p.r * 0.4, p.r * 0.5, p.r * 0.25);
      }
      g.restore();
    }
    for (const f of this.fl) {
      const k = f.life / f.max;
      const s = f.size * (k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.3));
      g.save();
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      g.translate(f.x, f.y);
      g.rotate(this.textAngle);
      g.font = `900 ${s}px 'PT Sans', Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(3, s / 6);
      g.strokeStyle = 'rgba(40,20,0,0.85)';
      g.strokeText(f.text, 0, -f.rise);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, -f.rise);
      g.restore();
    }
  }
}

/** Картинка «как cover» на прямоугольник. */
export function cover(g: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}
