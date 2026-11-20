/* Симулятор дирижёра — лента-партитура: строки групп (и «Палочка»), отметки едут к линии палочки.
 * Широкий экран — лента горизонтальная внизу (время → вправо), узкий (портрет) — вертикальная дорожка (время → вверх).
 * Рисует canvas 2D; кнопки групп — у начала строк (тач), подписи клавиш. */
import type { Chart, Mark } from '../core/chart';
import type { Grade, Performance } from '../core/perform';
import { barsOf, type ScoreJson } from '../core/score';

export const KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
export const KEY_LABEL = ['A', 'S', 'D', 'F', 'J', 'K', 'L', ';'];

/** Раскладка клавиш по числу строк: 3 — A S D … */
export function keysFor(n: number): number[] {
  if (n <= 4) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: n }, (_, i) => (i < n / 2 ? i : 4 + (i - Math.ceil(n / 2))));
}

interface Pop {
  lane: number;
  text: string;
  color: string;
  t: number;
}

const GRADE: Record<Grade, [string, string]> = {
  bravo: ['Браво!', '#ffe27a'],
  good: ['Хорошо', '#9fe0a0'],
  early: ['Рано', '#9ac8ff'],
  late: ['Поздно', '#ffb37a'],
  miss: ['Мимо', '#ff6a6a'],
};

export class Ribbon {
  readonly el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private btns: HTMLButtonElement[] = [];
  private pops: Pop[] = [];
  private flash: number[] = [];
  private bars: number[];
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Вертикальная дорожка (портрет). */
  vertical = false;
  /** Секунд видно вперёд. */
  ahead = 3.2;
  /** Подсказки клавиш. */
  showKeys = true;
  onLane: (lane: number) => void = () => {};
  /** Кнопка строки «Палочка»: нажали / отпустили (держать — фермата). */
  onBaton: (down: boolean) => void = () => {};
  private batonBtn: HTMLButtonElement | null = null;

  constructor(
    private score: ScoreJson,
    private chart: Chart,
    private moodOf: (lane: number) => number
  ) {
    this.el = document.createElement('div');
    this.el.className = 'dz-ribbon';
    this.cv = document.createElement('canvas');
    this.el.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
    this.bars = barsOf(score).map((b) => b.tick);
    const keys = keysFor(chart.lanes.length);
    chart.lanes.forEach((l, i) => {
      const b = document.createElement('button');
      b.className = 'dz-lane-btn';
      b.style.setProperty('--c', l.color);
      b.innerHTML = `<b>${l.short}</b><i>${KEY_LABEL[keys[i]]}</i>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onLane(i);
      });
      this.el.appendChild(b);
      this.btns.push(b);
      this.flash.push(0);
    });
    if (chart.baton) {
      const b = document.createElement('button');
      b.className = 'dz-lane-btn baton';
      b.style.setProperty('--c', '#c8c0ff');
      b.innerHTML = '<b>Палочка</b><i>␣</i>';
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        this.onBaton(true);
      });
      const up = () => {
        b.classList.remove('on');
        this.onBaton(false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      this.el.appendChild(b);
      this.batonBtn = b;
    }
  }

  private rows(): number {
    return this.chart.lanes.length + (this.chart.baton ? 1 : 0);
  }

  /** Строка на экране: палочка — первой (сверху/слева). */
  private rowOf(lane: number): number {
    return lane < 0 ? 0 : lane + (this.chart.baton ? 1 : 0);
  }

  resize(): void {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    this.cv.style.width = `${r.width}px`;
    this.cv.style.height = `${r.height}px`;
    // кнопки: у линии палочки
    const n = this.rows();
    [...this.btns, ...(this.batonBtn ? [this.batonBtn] : [])].forEach((b, i) => {
      const row = i < this.btns.length ? this.rowOf(i) : 0;
      if (this.vertical) {
        const cw = this.w / n;
        Object.assign(b.style, { left: `${row * cw + 2}px`, top: `${this.h - 56}px`, width: `${cw - 4}px`, height: '52px' });
      } else {
        const rh = this.h / n;
        Object.assign(b.style, { left: '2px', top: `${row * rh + 2}px`, width: '86px', height: `${rh - 4}px` });
      }
    });
  }

  judged(lane: number, grade: Grade): void {
    const [text, color] = GRADE[grade];
    this.pops.push({ lane, text, color, t: 0 });
    if (lane >= 0 && grade !== 'miss') this.flash[lane] = 1;
  }

  pressed(lane: number): void {
    const b = this.btns[lane];
    if (!b) return;
    b.classList.add('on');
    setTimeout(() => b.classList.remove('on'), 110);
  }

  /** Перевод (строка, секунды от линии) → точка; длина строки поперёк. */
  private geo() {
    const n = this.rows();
    if (this.vertical) {
      const cw = this.w / n;
      const lineY = this.h - 70;
      const pps = (lineY - 10) / this.ahead;
      return {
        at: (row: number, s: number) => [row * cw + cw / 2, lineY - s * pps] as const,
        cross: cw,
        pps,
        line: (ctx: CanvasRenderingContext2D) => {
          ctx.moveTo(0, lineY);
          ctx.lineTo(this.w, lineY);
        },
        before: 70 / pps,
      };
    }
    const rh = this.h / n;
    const lineX = 120;
    const pps = (this.w - lineX - 10) / this.ahead;
    return {
      at: (row: number, s: number) => [lineX + s * pps, row * rh + rh / 2] as const,
      cross: rh,
      pps,
      line: (ctx: CanvasRenderingContext2D) => {
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, this.h);
      },
      before: (lineX - 92) / pps,
    };
  }

  draw(perf: Performance, dt: number): void {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const G = this.geo();
    const n = this.rows();
    const V = this.vertical;
    // полосы строк
    for (let r = 0; r < n; r++) {
      const lane = this.chart.baton ? r - 1 : r;
      const color = lane < 0 ? '#c8c0ff' : this.chart.lanes[lane].color;
      g.fillStyle = r % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)';
      const [x, y] = G.at(r, 0);
      if (V) g.fillRect(x - G.cross / 2, 0, G.cross, this.h);
      else g.fillRect(0, y - G.cross / 2, this.w, G.cross);
      // линия строки
      g.strokeStyle = color + '55';
      g.lineWidth = 1;
      g.beginPath();
      if (V) {
        g.moveTo(x, 0);
        g.lineTo(x, this.h);
      } else {
        g.moveTo(0, y);
        g.lineTo(this.w, y);
      }
      g.stroke();
      if (lane >= 0) this.flash[lane] = Math.max(0, this.flash[lane] - dt * 4);
    }
    // такты
    const spt = perf.secPerTick();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    for (const t of this.bars) {
      const s = (t - perf.tick) * spt;
      if (s < -G.before) continue;
      if (s > this.ahead) break;
      const [x, y] = G.at(0, s);
      if (V) {
        g.moveTo(0, y);
        g.lineTo(this.w, y);
      } else {
        g.moveTo(x, 0);
        g.lineTo(x, this.h);
      }
    }
    g.stroke();
    // буквы репетиций
    g.fillStyle = 'rgba(255,240,200,0.6)';
    g.font = 'bold 12px "PT Sans", sans-serif';
    for (const [t, label] of this.score.marks ?? []) {
      const s = (t - perf.tick) * spt;
      if (s < -G.before || s > this.ahead) continue;
      const [x, y] = G.at(0, s);
      g.fillText(label, V ? 4 : x + 3, V ? y - 3 : 12);
    }
    // фразы (полоса «группа играет») и отметки
    for (const m of this.chart.marks) {
      const s = (m.tick - perf.tick) * spt;
      const sEnd = (m.tick + m.len - perf.tick) * spt;
      if (sEnd < -G.before) continue;
      if (s > this.ahead) break;
      this.drawMark(m, s, sEnd, perf, G);
    }
    // линия палочки
    g.strokeStyle = '#fff6d8';
    g.lineWidth = 3;
    g.shadowColor = '#ffd27a';
    g.shadowBlur = 10;
    g.beginPath();
    G.line(g);
    g.stroke();
    g.shadowBlur = 0;
    // всплывающие оценки
    g.textAlign = 'center';
    g.font = 'bold 18px "Russo One", sans-serif';
    this.pops = this.pops.filter((p) => (p.t += dt) < 0.8);
    for (const p of this.pops) {
      const [x, y] = G.at(this.rowOf(p.lane), 0);
      g.globalAlpha = 1 - p.t / 0.8;
      g.fillStyle = p.color;
      g.fillText(p.text, V ? x : x + 40, V ? y - 30 - p.t * 40 : y - 10 - p.t * 30);
    }
    g.globalAlpha = 1;
    g.textAlign = 'left';
    // настрой на кнопках
    this.btns.forEach((b, i) => {
      const m = this.moodOf(i);
      b.style.setProperty('--mood', `${m}%`);
      b.classList.toggle('sad', m < 35);
      b.classList.toggle('flash', this.flash[i] > 0.5);
    });
  }

  private drawMark(m: Mark, s: number, sEnd: number, perf: Performance, G: ReturnType<Ribbon['geo']>): void {
    const g = this.g;
    const row = this.rowOf(m.lane);
    // палочка: доля — сиреневая, ускорение — золотая, хлопки зала — розовая с ладошкой
    const color = m.lane >= 0 ? this.chart.lanes[m.lane].color : m.clap ? '#ff8fb8' : m.tempo ? '#ffd166' : '#c8c0ff';
    const done = perf.quality.has(m.id);
    const q = perf.quality.get(m.id);
    const [x, y] = G.at(row, s);
    const r = Math.min(G.cross * 0.36, 20);
    // полоса фразы
    if (m.kind === 'cue' && m.len > 0) {
      const [x2, y2] = G.at(row, Math.min(sEnd, this.ahead + 1));
      g.strokeStyle = color + (done && q === 0 ? '30' : '70');
      g.lineWidth = Math.max(4, G.cross * 0.22);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      g.lineCap = 'butt';
    }
    if (m.kind === 'hold') {
      const [x2, y2] = G.at(row, sEnd);
      g.strokeStyle = '#c8c0ff';
      g.lineWidth = Math.max(6, G.cross * 0.4);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = '#2a2050';
      g.font = 'bold 16px serif';
      g.textAlign = 'center';
      g.fillText('𝄐', x, y + 5);
      g.textAlign = 'left';
      return;
    }
    // уже судили и прошла линию — гаснет
    if (s < -0.05 && done) return;
    g.save();
    g.translate(x, y);
    g.fillStyle = color;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    if (m.kind === 'cue') g.arc(0, 0, r, 0, Math.PI * 2);
    else if (m.kind === 'cut') g.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
    else if (m.kind === 'solo') {
      for (let k = 0; k < 10; k++) {
        const a = (k * Math.PI) / 5 - Math.PI / 2;
        const rr = k % 2 ? r * 0.5 : r * 1.1;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
    } else if (m.kind === 'beat') g.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    else if (m.kind === 'up' || m.kind === 'down') {
      const d = m.kind === 'up' ? -1 : 1;
      g.moveTo(0, d * r);
      g.lineTo(r, -d * r * 0.4);
      g.lineTo(-r, -d * r * 0.4);
      g.closePath();
    }
    g.fill();
    g.stroke();
    if (m.clap) {
      g.font = `${Math.round(r * 1.1)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('👏', r * 1.9, 0);
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
    }
    g.restore();
  }
}
