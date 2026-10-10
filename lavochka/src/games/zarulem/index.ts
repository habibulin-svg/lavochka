/* «За рулём» — корпус и экран: голубая приборная панель (спидометр, одометр, три лампы аварий, ключ зажигания, рычаг скоростей, руль)
 * и круглое окно с вращающимся диском: трасса с ответвлением, три моста, деревья, домики, светофоры, человечки.
 * Машинка — у правого края окна, руль двигает её поперёк дороги. Мосты рисуются поверх машинки — она проезжает под ними.
 * Управление: ← → — руль (или тянуть руль мышью/пальцем), ↑ ↓ — передача, пробел/Enter — ключ. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { Drive, GEARS, pillars, POS_MAX, POS_MIN, TAU, type Mode, type Thing } from './logic';
import './zarulem.css';

const CW = 640;
const CH = 760;
const CX = 320;
const CY = 300;
const R = 262;

class Device {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private d: Drive;
  private raf = 0;
  private last = 0;
  private t = 0;
  private keys = new Set<string>();
  private drag: { x: number; pos: number } | null = null;
  private reported = false;
  private disc: HTMLCanvasElement;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    root: HTMLElement,
    private mode: Mode,
    private opts: ArcadeOpts
  ) {
    this.el = h(`<div class="zr-dev"><canvas width="${CW * 2}" height="${CH * 2}"></canvas></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.scale(2, 2);
    this.d = new Drive(mode);
    this.disc = this.paintDisc();
    this.cv.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.cv.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.cv.addEventListener('pointerup', () => (this.drag = null));
    this.cv.addEventListener('pointercancel', () => (this.drag = null));
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- управление

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(k) || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    if (!down) return void this.keys.delete(k);
    if (e.repeat) return;
    this.keys.add(k);
    Sound.unlock();
    if (k === 'ArrowUp') this.shift(1);
    else if (k === 'ArrowDown') this.shift(-1);
    else if (k === ' ' || k === 'Enter') this.ignition();
  }

  private shift(dir: number) {
    const g = Math.max(0, Math.min(3, this.d.gear + dir));
    if (g !== this.d.gear) {
      this.d.gear = g;
      Sound.ui();
    }
  }

  private ignition() {
    if (this.d.over) {
      this.d = new Drive(this.mode);
      this.reported = false;
      this.d.on = true;
    } else this.d.on = !this.d.on;
    Sound.ui();
  }

  private local(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move') {
    const p = this.local(e);
    if (kind === 'down') {
      Sound.unlock();
      // ключ, рычаг — по месту; ниже окна — руль
      if (Math.hypot(p.x - 520, p.y - 618) < 34) return this.ignition();
      if (p.x > 90 && p.x < 150 && p.y > 580 && p.y < 720) return this.shift(p.y < 650 ? 1 : -1);
      if (p.y > 560) {
        this.cv.setPointerCapture(e.pointerId);
        this.drag = { x: p.x, pos: this.d.pos };
      }
      return;
    }
    if (!this.drag) return;
    this.d.pos = Math.max(POS_MIN, Math.min(POS_MAX, this.drag.pos + (p.x - this.drag.x) / 320));
  }

  // ---------------------------------------------------------------- кадр

  private frame(t: number) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    this.t += dt;
    const steer = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    this.d.update(dt, steer);
    for (const s of this.d.sounds) {
      if (s === 'crash') Sound.capture();
      else if (s === 'lap') Sound.beep(1800, 0.06, 0.08);
      else if (s === 'grass') Sound.beep(300, 0.08, 0.06);
    }
    this.d.sounds.length = 0;
    if (this.d.over && !this.reported) {
      this.reported = true;
      this.opts.onScore(this.d.score);
    }
    this.draw();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  /** Точка диска (φ, r) на экране: диск повёрнут на rot, ось y вниз — по экрану он идёт по часовой, дорога бежит вниз. */
  private xy(phi: number, r: number, rot = this.d.rot): [number, number] {
    const a = phi + rot;
    return [CX + Math.cos(a) * r * R, CY + Math.sin(a) * r * R];
  }

  /** Неподвижная картинка диска (поворачивается целиком): трава, дороги, украшения. */
  private paintDisc(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = R * 4;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.translate(R, R);
    const P = (phi: number, r: number): [number, number] => [Math.cos(phi) * r * R, Math.sin(phi) * r * R];
    // трава
    const grad = g.createRadialGradient(0, 0, 20, 0, 0, R);
    grad.addColorStop(0, '#9fcf6a');
    grad.addColorStop(1, '#6faa44');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    for (let i = 0; i < 500; i++) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * R * 0.98;
      g.fillStyle = `rgba(40,90,20,${Math.random() * 0.25})`;
      g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2, 2);
    }
    // дороги: асфальт, бордюр, пунктир
    const road = (p: (typeof this.d.track.paths)[number]) => {
      const a0 = p.from ?? 0;
      const span = p.from == null ? TAU : (((p.to - p.from) % TAU) + TAU) % TAU;
      const line = (dr: number) => {
        g.beginPath();
        for (let i = 0; i <= 240; i++) {
          const phi = a0 + (span * i) / 240;
          const [x, y] = P(phi, p.r(phi) + dr);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      };
      g.lineCap = 'round';
      g.strokeStyle = '#e8e2d0';
      g.lineWidth = p.w * 2 * R + 6;
      line(0);
      g.strokeStyle = '#4a4a50';
      g.lineWidth = p.w * 2 * R;
      line(0);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.setLineDash([10, 9]);
      line(0);
      g.setLineDash([]);
    };
    for (const p of this.d.track.paths) road(p);
    // заборчик по краю диска
    g.strokeStyle = '#f4f0e4';
    g.lineWidth = 3;
    g.setLineDash([4, 5]);
    g.beginPath();
    g.arc(0, 0, R - 6, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    for (const th of this.d.track.things) this.thing(g, th, P);
    return c;
  }

  private thing(g: CanvasRenderingContext2D, th: Thing, P: (phi: number, r: number) => [number, number]) {
    const [x, y] = P(th.phi, th.r);
    const s = R * Math.max(th.size, 0.025);
    g.save();
    g.translate(x, y);
    switch (th.kind) {
      case 'tree':
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.beginPath();
        g.arc(3, 3, s, 0, TAU);
        g.fill();
        g.fillStyle = '#2f7a2a';
        g.beginPath();
        g.arc(0, 0, s, 0, TAU);
        g.fill();
        g.fillStyle = '#4a9a3a';
        g.beginPath();
        g.arc(-s * 0.3, -s * 0.3, s * 0.55, 0, TAU);
        g.fill();
        break;
      case 'house':
        g.rotate(th.phi);
        g.fillStyle = '#e8d8b0';
        g.fillRect(-11, -9, 22, 18);
        g.fillStyle = '#b8402a';
        g.beginPath();
        g.moveTo(-13, -9);
        g.lineTo(0, -18);
        g.lineTo(13, -9);
        g.fill();
        g.fillStyle = '#6aa8d8';
        g.fillRect(-6, -4, 5, 5);
        g.fillRect(2, -4, 5, 5);
        break;
      case 'light':
        g.fillStyle = '#333';
        g.fillRect(-3, -9, 6, 18);
        for (const [c, dy] of [
          ['#e33', -5],
          ['#ec3', 0],
          ['#3c4', 5],
        ] as [string, number][]) {
          g.fillStyle = c;
          g.beginPath();
          g.arc(0, dy, 2, 0, TAU);
          g.fill();
        }
        break;
      case 'sign':
        g.fillStyle = '#888';
        g.fillRect(-1, 0, 2, 8);
        g.fillStyle = '#fff';
        g.strokeStyle = '#d22';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(0, -3, 6, 0, TAU);
        g.fill();
        g.stroke();
        break;
      case 'man':
        g.fillStyle = '#2a4aa8';
        g.beginPath();
        g.ellipse(0, 2, 4, 6, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#f0c8a0';
        g.beginPath();
        g.arc(0, -5, 3.2, 0, TAU);
        g.fill();
        break;
      case 'cone':
        g.fillStyle = '#ff7a1a';
        g.beginPath();
        g.moveTo(0, -7);
        g.lineTo(6, 6);
        g.lineTo(-6, 6);
        g.fill();
        g.fillStyle = '#fff';
        g.fillRect(-3.5, 0, 7, 2);
        break;
      default:
        break;
    }
    g.restore();
  }

  private draw() {
    const c = this.g;
    const d = this.d;
    // панель
    c.fillStyle = '#5f9fd0';
    c.fillRect(0, 0, CW, CH);
    const hl = c.createLinearGradient(0, 0, 0, CH);
    hl.addColorStop(0, 'rgba(255,255,255,0.25)');
    hl.addColorStop(0.5, 'rgba(255,255,255,0)');
    hl.addColorStop(1, 'rgba(0,0,30,0.25)');
    c.fillStyle = hl;
    c.fillRect(0, 0, CW, CH);
    // окно и рамка
    c.fillStyle = '#1e2a38';
    c.beginPath();
    c.arc(CX, CY, R + 16, 0, TAU);
    c.fill();
    c.strokeStyle = '#c8d8e8';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(CX, CY, R + 15, 0, TAU);
    c.stroke();
    // диск
    c.save();
    c.translate(CX, CY);
    c.rotate(d.rot);
    c.drawImage(this.disc, -R, -R, R * 2, R * 2);
    c.restore();
    // машинка у правого края
    const [mx, my] = [CX + d.pos * R, CY];
    const blink = d.stun > 0 && Math.floor(this.t / 120) % 2 === 0;
    if (!blink) this.car(c, mx, my, d.onRoad || !d.on ? 0 : Math.sin(this.t / 40) * 0.08);
    // мосты поверх
    for (const b of d.track.bridges) this.bridge(c, b.phi, d.track.paths[b.path]);
    for (const p of pillars(d.track)) {
      const [x, y] = this.xy(p.phi, p.r);
      c.fillStyle = '#6a6a72';
      c.fillRect(x - 6, y - 6, 12, 12);
    }
    // стекло: блик
    const glass = c.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
    glass.addColorStop(0, 'rgba(255,255,255,0.18)');
    glass.addColorStop(0.4, 'rgba(255,255,255,0)');
    c.fillStyle = glass;
    c.beginPath();
    c.arc(CX, CY, R, 0, TAU);
    c.fill();
    this.dash(c);
    if (d.over) this.banner(c, 'АВАРИЯ!', `проехали ${d.score} м · ключ — ещё раз`);
    else if (!d.on) this.banner(c, 'ЗА РУЛЁМ', 'ключ (пробел) — завести');
  }

  private car(c: CanvasRenderingContext2D, x: number, y: number, wobble: number) {
    c.save();
    c.translate(x, y);
    c.rotate(wobble);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(-9, -15, 22, 34);
    c.fillStyle = '#d8241c';
    c.beginPath();
    c.roundRect(-11, -18, 22, 36, 6);
    c.fill();
    c.fillStyle = '#9fd0f0';
    c.fillRect(-8, -10, 16, 7);
    c.fillRect(-8, 7, 16, 5);
    c.fillStyle = '#fff4a0';
    c.fillRect(-9, -18, 4, 3);
    c.fillRect(5, -18, 4, 3);
    c.restore();
  }

  private bridge(c: CanvasRenderingContext2D, phi: number, p: (typeof this.d.track.paths)[number]) {
    const rc = p.r(phi);
    const [x1, y1] = this.xy(phi, rc - p.w - 0.065);
    const [x2, y2] = this.xy(phi, rc + p.w + 0.065);
    c.save();
    c.lineCap = 'butt';
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 24;
    c.beginPath();
    c.moveTo(x1 + 4, y1 + 4);
    c.lineTo(x2 + 4, y2 + 4);
    c.stroke();
    c.strokeStyle = '#b8b0a0';
    c.lineWidth = 22;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.strokeStyle = '#7a7268';
    c.lineWidth = 2;
    for (const off of [-10, 10]) {
      const nx = (-(y2 - y1) / Math.hypot(x2 - x1, y2 - y1)) * off;
      const ny = ((x2 - x1) / Math.hypot(x2 - x1, y2 - y1)) * off;
      c.beginPath();
      c.moveTo(x1 + nx, y1 + ny);
      c.lineTo(x2 + nx, y2 + ny);
      c.stroke();
    }
    c.restore();
  }

  /** Приборная панель: спидометр, одометр, лампы аварий, рычаг, ключ, руль. */
  private dash(c: CanvasRenderingContext2D) {
    const d = this.d;
    // щиток
    c.fillStyle = '#2a4a6a';
    c.beginPath();
    c.roundRect(40, 572, 560, 70, 18);
    c.fill();
    // спидометр
    const sx = 210;
    const sy = 607;
    c.fillStyle = '#f4f0e0';
    c.beginPath();
    c.arc(sx, sy, 28, 0, TAU);
    c.fill();
    c.strokeStyle = '#333';
    c.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * 0.8 + (i / 6) * Math.PI * 1.4;
      c.beginPath();
      c.moveTo(sx + Math.cos(a) * 22, sy + Math.sin(a) * 22);
      c.lineTo(sx + Math.cos(a) * 26, sy + Math.sin(a) * 26);
      c.stroke();
    }
    const v = d.on && d.stun <= 0 ? GEARS[d.gear] / GEARS[3] * (d.onRoad ? 1 : 0.45) : 0;
    const na = Math.PI * 0.8 + v * Math.PI * 1.4 + Math.sin(this.t / 70) * 0.02 * v;
    c.strokeStyle = '#d22';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(na) * 22, sy + Math.sin(na) * 22);
    c.stroke();
    // одометр
    c.fillStyle = '#111';
    c.fillRect(268, 592, 104, 30);
    c.font = 'bold 22px "Courier New", monospace';
    c.fillStyle = '#f4f0e0';
    c.textAlign = 'center';
    c.fillText(String(d.score).padStart(6, '0'), 320, 615);
    c.font = '10px Arial';
    c.fillStyle = '#c8d8e8';
    c.fillText('метров', 320, 636);
    // лампы аварий
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i < d.crashes ? '#ff3a2a' : '#5a1a14';
      c.beginPath();
      c.arc(400 + i * 22, 607, 8, 0, TAU);
      c.fill();
    }
    // ключ
    c.fillStyle = '#c8c8d0';
    c.beginPath();
    c.arc(520, 618, 22, 0, TAU);
    c.fill();
    c.save();
    c.translate(520, 618);
    c.rotate(d.on ? Math.PI / 2 : 0);
    c.fillStyle = '#e8c860';
    c.fillRect(-4, -18, 8, 26);
    c.beginPath();
    c.arc(0, -20, 8, 0, TAU);
    c.fill();
    c.restore();
    // рычаг скоростей
    c.fillStyle = '#1a2a3a';
    c.fillRect(112, 584, 16, 130);
    c.font = 'bold 11px Arial';
    c.textAlign = 'left';
    for (let g = 0; g <= 3; g++) {
      c.fillStyle = g === d.gear ? '#fff' : '#9ab';
      c.fillText(String(g), 134, 708 - g * 38);
    }
    const ky = 704 - d.gear * 38;
    c.fillStyle = '#222';
    c.beginPath();
    c.arc(120, ky, 12, 0, TAU);
    c.fill();
    c.fillStyle = '#555';
    c.beginPath();
    c.arc(116, ky - 4, 4, 0, TAU);
    c.fill();
    // руль: угол — по положению машинки
    const ang = ((d.pos - (POS_MIN + POS_MAX) / 2) / (POS_MAX - POS_MIN)) * 2.2;
    c.save();
    c.translate(320, 770);
    c.rotate(ang);
    c.strokeStyle = '#1a1a1e';
    c.lineWidth = 22;
    c.beginPath();
    c.arc(0, 0, 118, 0, TAU);
    c.stroke();
    c.strokeStyle = '#3a3a40';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(0, 0, 124, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
    c.fillStyle = '#1a1a1e';
    for (const a of [-Math.PI / 2 - 1.1, -Math.PI / 2 + 1.1]) {
      c.save();
      c.rotate(a + Math.PI / 2);
      c.fillRect(-7, -118, 14, 118);
      c.restore();
    }
    c.fillStyle = '#2a2a30';
    c.beginPath();
    c.arc(0, 0, 34, 0, TAU);
    c.fill();
    c.fillStyle = '#c8241c';
    c.beginPath();
    c.arc(0, 0, 12, 0, TAU);
    c.fill();
    c.restore();
    c.textAlign = 'start';
  }

  private banner(c: CanvasRenderingContext2D, title: string, sub: string) {
    c.fillStyle = 'rgba(10,20,30,0.72)';
    c.beginPath();
    c.roundRect(CX - 170, CY - 48, 340, 96, 16);
    c.fill();
    c.textAlign = 'center';
    c.fillStyle = '#ffe9a0';
    c.font = 'bold 34px "PT Serif", Georgia, serif';
    c.fillText(title, CX, CY);
    c.font = '15px "PT Sans", Arial, sans-serif';
    c.fillStyle = '#e8f0f8';
    c.fillText(sub, CX, CY + 28);
    c.textAlign = 'start';
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'zarulem',
  title: 'За рулём',
  about: 'Томская игрушка: под стеклом крутится диск с трассой, а вы рулём ведёте машинку — не съехать, не задеть мост и деревья.',
  controls: `<p><kbd>←</kbd> <kbd>→</kbd> — руль (или тянуть руль мышью/пальцем), <kbd>↑</kbd> <kbd>↓</kbd> — передача 0–3 (или рычаг слева), <kbd>Пробел</kbd> — ключ зажигания.</p>
    <p>Одометр считает метры по дороге. По траве машинка вязнет; три аварии (дерево, опора моста, человечек, долго по траве) — конец.</p>`,
  modes: [
    { id: 'outer', label: 'Внешнее кольцо', hint: 'Широкая дорога, для начинающих' },
    { id: 'inner', label: 'Внутреннее кольцо', hint: 'Узко, крутые повороты, конусы и пешеходы' },
  ],
  mount(root, opts) {
    return new Device(root, opts.mode === 'inner' ? 'inner' : 'outer', opts);
  },
};

export default mod;
