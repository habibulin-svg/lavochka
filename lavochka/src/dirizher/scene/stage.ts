/* Симулятор дирижёра — сцена над лентой. Интерфейс общий: 3D-зал (scene3d.ts) и запасной план рассадки (этот файл:
 * пока грузится 3D или если WebGL нет). */
import type { Chart, Mark } from '../core/chart';
import type { Grade, Performance } from '../core/perform';

export interface Stage {
  bind(perf: Performance, chart: Chart): void;
  update(dt: number, perf: Performance): void;
  judge(m: Mark, g: Grade): void;
  fermata(on: boolean): void;
  dynamics(level: number): void;
  /** Дирижёр показывает группе (нажали её кнопку). */
  point(lane: number): void;
  /** Зал хлопает: дирижёр поворачивается к публике (и обратно). */
  audience?(on: boolean): void;
  /** Игрок взмахнул палочкой. */
  beat?(): void;
  /** Какая группа под указателем (координаты окна); −1 — никакая. */
  pick?(x: number, y: number): number;
  /** Подсветить группу под курсором мыши (−1 — снять). */
  hover?(lane: number): void;
  /** Палочка поднята перед началом. */
  raise?(on: boolean): void;
  /** Облёт зала перед началом. */
  intro?(): Promise<void>;
  /** Пропустить облёт. */
  skip?(): void;
  /** Поклон после концерта. */
  outro?(): Promise<void>;
  /** Игра пошла: сцену рисует цикл концерта. */
  playing?(): void;
  resize(): void;
  destroy(): void;
}

/** Рассадка на плане: доля ширины (−1..1) и глубины (0 — у дирижёра, 1 — задний ряд). */
export const SEAT_PLAN: Record<string, [number, number]> = {
  vn1: [-0.62, 0.22], vn2: [-0.3, 0.42], va: [0.3, 0.42], vc: [0.62, 0.22], cb: [0.85, 0.62], harp: [-0.85, 0.55],
  fl: [-0.18, 0.62], picc: [-0.3, 0.62], ob: [0.18, 0.62], eh: [0.3, 0.62], cl: [-0.18, 0.76], bcl: [-0.3, 0.76], bn: [0.18, 0.76], cbn: [0.3, 0.76],
  hn: [-0.5, 0.86], tp: [0.1, 0.92], tb: [0.38, 0.92], tu: [0.55, 0.92], timp: [-0.1, 0.98], perc: [0.7, 0.98], cel: [-0.75, 0.8],
};

export class FlatStage implements Stage {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private chart: Chart | null = null;
  private glow: number[] = [];
  private w = 0;
  private h = 0;

  constructor(private host: HTMLElement) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'dz-flat';
    host.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
  }

  bind(_p: Performance, chart: Chart): void {
    this.chart = chart;
    this.glow = chart.lanes.map(() => 0);
    this.resize();
  }

  resize(): void {
    const r = this.host.getBoundingClientRect();
    const d = Math.min(2, devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.cv.width = r.width * d;
    this.cv.height = r.height * d;
    this.g.setTransform(d, 0, 0, d, 0, 0);
  }

  update(dt: number, perf: Performance): void {
    const c = this.chart;
    if (!c) return;
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2;
    const base = this.h * 0.92;
    const depth = this.h * 0.8;
    c.lanes.forEach((l, li) => {
      this.glow[li] = Math.max(0, this.glow[li] - dt * 1.5);
      const q = [...perf.quality.entries()].filter(([id]) => c.marks[id]?.lane === li).pop()?.[1] ?? 1;
      for (const id of l.instr) {
        const s = SEAT_PLAN[id];
        if (!s) continue;
        const x = cx + s[0] * this.w * 0.42;
        const y = base - s[1] * depth;
        const r = 10 + 14 * (1 - s[1]);
        g.globalAlpha = 0.35 + 0.65 * q;
        g.fillStyle = l.color;
        g.beginPath();
        g.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
        g.fill();
        if (this.glow[li] > 0) {
          g.globalAlpha = this.glow[li];
          g.strokeStyle = '#fff';
          g.lineWidth = 3;
          g.stroke();
        }
      }
    });
    g.globalAlpha = 1;
  }

  judge(m: Mark, g: Grade): void {
    if (m.lane >= 0 && g !== 'miss') this.glow[m.lane] = 1;
  }
  fermata(): void {}
  dynamics(): void {}
  point(): void {}
  destroy(): void {
    this.cv.remove();
  }
}
