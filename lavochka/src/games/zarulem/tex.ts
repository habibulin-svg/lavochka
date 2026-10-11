/* «За рулём» — рисунки (canvas) для 3D: диск с трассой как на томской игрушке (светло-серый асфальт с белым пунктиром,
 * бирюзово-зелёная трава с полосой жёлтых и белых цветочков вдоль дороги, «зебры», линия старта), знаки, шкала спидометра,
 * табличка передач и наклейка «ЗА РУЛЁМ». */
import { TAU, track, type Sign, type TrackId } from './engine';

function rnd(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const DISK_PX = 2048;

/** Диск: координаты диска (x = r·cos a, z = r·sin a, r ≤ 1) → пиксели ((x+1)/2, (z+1)/2). */
export function diskCanvas(id: TrackId): HTMLCanvasElement {
  const S = DISK_PX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const t = track(id);
  const R = S / 2;
  const P = (a: number, r: number): [number, number] => [R + Math.cos(a) * r * R, R + Math.sin(a) * r * R];
  const rand = rnd(17);
  // трава
  g.fillStyle = '#2e9474';
  g.beginPath();
  g.arc(R, R, R, 0, TAU);
  g.fill();
  for (let i = 0; i < 9000; i++) {
    const a = rand() * TAU;
    const r = Math.sqrt(rand()) * R;
    g.fillStyle = rand() < 0.5 ? 'rgba(10,60,40,0.18)' : 'rgba(120,200,150,0.14)';
    g.fillRect(R + Math.cos(a) * r, R + Math.sin(a) * r, 3, 3);
  }
  const N = 720;
  const along = (off: number) => {
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const [x, y] = P(a, t.rc(a) + off);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
  };
  // полоса цветов вдоль обочин: жёлтые точки и белые ромашки
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5200; i++) {
      const a = rand() * TAU;
      const off = side * (t.w + 0.012 + rand() * 0.05);
      const [x, y] = P(a, t.rc(a) + off);
      const k = rand();
      if (k < 0.7) {
        g.fillStyle = k < 0.35 ? '#f4d23a' : '#d8c020';
        g.beginPath();
        g.arc(x, y, 2 + rand() * 2.5, 0, TAU);
        g.fill();
      } else if (k < 0.82) {
        g.fillStyle = '#fbfbf2';
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * TAU;
          g.beginPath();
          g.arc(x + Math.cos(pa) * 3.2, y + Math.sin(pa) * 3.2, 2.2, 0, TAU);
          g.fill();
        }
        g.fillStyle = '#f0c020';
        g.beginPath();
        g.arc(x, y, 1.8, 0, TAU);
        g.fill();
      }
    }
  }
  // асфальт: светло-серый, в крапинку
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = '#d6d8d2';
  g.lineWidth = (t.w * 2 + 0.012) * R;
  along(0);
  g.stroke();
  g.strokeStyle = '#b3b6b2';
  g.lineWidth = t.w * 2 * R;
  along(0);
  g.stroke();
  g.restore();
  g.save();
  along(t.w);
  along(-t.w);
  g.clip('evenodd');
  for (let i = 0; i < 26000; i++) {
    const a = rand() * TAU;
    const off = (rand() * 2 - 1) * t.w;
    const [x, y] = P(a, t.rc(a) + off);
    g.fillStyle = rand() < 0.5 ? 'rgba(60,60,60,0.12)' : 'rgba(255,255,255,0.14)';
    g.fillRect(x, y, 2, 2);
  }
  g.restore();
  // разметка: белый пунктир посередине и сплошные у краёв
  g.save();
  g.strokeStyle = 'rgba(250,250,245,0.92)';
  g.lineWidth = 5;
  g.setLineDash([34, 30]);
  along(0);
  g.stroke();
  g.setLineDash([]);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(250,250,245,0.7)';
  along(t.w - 0.018);
  g.stroke();
  along(-t.w + 0.018);
  g.stroke();
  g.restore();
  // «зебры» — поперёк дороги
  for (const za of t.zebras) {
    for (let k = -4; k <= 4; k++) {
      const off = (k / 4.6) * t.w;
      const a0 = za;
      const [x, y] = P(a0, t.rc(a0) + off);
      g.save();
      g.translate(x, y);
      g.rotate(a0 + Math.PI / 2);
      g.fillStyle = '#f6f6f0';
      g.fillRect(-26, -7, 52, 14);
      g.restore();
    }
  }
  // старт: шашечки поперёк дороги
  {
    const a = t.start;
    const n = 10;
    for (let k = 0; k < n; k++)
      for (let row = 0; row < 2; row++) {
        const off = -t.w + ((k + 0.5) / n) * 2 * t.w;
        const [x, y] = P(a, t.rc(a) + off);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.fillStyle = (k + row) % 2 ? '#1a1a1a' : '#f8f8f4';
        const sz = ((2 * t.w) / n) * R;
        g.fillRect(-sz / 2, -sz + row * sz, sz, sz);
        g.restore();
      }
  }
  // кромка диска — светлая полоска под бортиком
  g.strokeStyle = '#e9e2c4';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(R, R, R - 7, 0, TAU);
  g.stroke();
  return cv;
}

/** Знак: круг, треугольник или ромб — по виду. */
export function signCanvas(kind: Sign['kind']): HTMLCanvasElement {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const c = S / 2;
  if (kind === 'warn' || kind === 'walk') {
    g.fillStyle = '#d42a1e';
    g.beginPath();
    g.moveTo(c, 10);
    g.lineTo(S - 8, S - 16);
    g.lineTo(8, S - 16);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(c, 34);
    g.lineTo(S - 28, S - 28);
    g.lineTo(28, S - 28);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    if (kind === 'warn') {
      g.lineWidth = 6;
      g.strokeStyle = '#111';
      g.beginPath();
      g.moveTo(c - 6, S - 34);
      g.lineTo(c - 6, 66);
      g.lineTo(c + 10, 56);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(c, 56, 5, 0, TAU);
      g.fill();
      g.fillRect(c - 3, 62, 6, 18);
      g.fillRect(c - 9, 78, 5, 14);
      g.fillRect(c + 4, 78, 5, 14);
    }
  } else if (kind === 'main') {
    g.translate(c, c);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#fff';
    g.fillRect(-40, -40, 80, 80);
    g.fillStyle = '#f2c400';
    g.fillRect(-28, -28, 56, 56);
  } else {
    g.fillStyle = kind === 'stop' ? '#d42a1e' : '#fff';
    g.beginPath();
    g.arc(c, c, 56, 0, TAU);
    g.fill();
    if (kind === 'stop') {
      g.fillStyle = '#2a5ac8';
      g.beginPath();
      g.arc(c, c, 44, 0, TAU);
      g.fill();
      g.strokeStyle = '#d42a1e';
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(c - 30, c - 30);
      g.lineTo(c + 30, c + 30);
      g.moveTo(c + 30, c - 30);
      g.lineTo(c - 30, c + 30);
      g.stroke();
    } else {
      g.strokeStyle = '#d42a1e';
      g.lineWidth = 11;
      g.beginPath();
      g.arc(c, c, 49, 0, TAU);
      g.stroke();
      g.fillStyle = '#111';
      g.font = 'bold 52px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('50', c, c + 3);
    }
  }
  return cv;
}

/** Шкала спидометра под рулём: 0…110, «КМ/ЧАС», красная риска внизу. */
export function speedoCanvas(): HTMLCanvasElement {
  const W = 1024;
  const H = 200;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#b8c4c8';
  g.beginPath();
  g.roundRect(0, 0, W, H, 40);
  g.fill();
  g.fillStyle = '#f1ede0';
  g.beginPath();
  g.roundRect(40, 30, W - 80, H - 60, 50);
  g.fill();
  g.fillStyle = '#222';
  g.font = 'bold 42px Arial';
  g.textAlign = 'center';
  for (let i = 0; i <= 11; i++) {
    const x = 90 + (i / 11) * (W - 180);
    g.fillText(String(i * 10), x, 82);
    g.fillRect(x - 2, 96, 4, 22);
  }
  g.fillStyle = '#c8261c';
  g.fillRect(90, 120, W - 180, 10);
  g.fillStyle = '#333';
  g.font = 'bold 26px Arial';
  g.fillText('КМ/ЧАС', W / 2, 160);
  return cv;
}

/** Табличка передач слева от рычага: Н сверху, ниже 1, 2, 3. */
export function gearCanvas(): HTMLCanvasElement {
  const W = 96;
  const H = 384;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1f8da0';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#8fd0dc';
  g.lineWidth = 4;
  g.font = 'bold 58px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['Н', '1', '2', '3'].forEach((s, i) => {
    g.strokeRect(6, 6 + i * 94, W - 12, 88);
    g.fillStyle = '#bfe8ef';
    g.fillText(s, W / 2, 52 + i * 94);
  });
  return cv;
}

/** Наклейка «ЗА РУЛЁМ»: пейзаж с лесом и надпись. */
export function labelCanvas(): HTMLCanvasElement {
  const W = 512;
  const H = 160;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#bfe6f0');
  sky.addColorStop(0.5, '#d8f0e0');
  sky.addColorStop(1, '#6ab04a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const rand = rnd(5);
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const h = 30 + rand() * 40;
    g.fillStyle = rand() < 0.5 ? '#2f6a3a' : '#3f8a3a';
    g.beginPath();
    g.ellipse(x, 70, 14 + rand() * 10, h / 2, 0, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#5aa040';
  g.fillRect(0, 96, W, H - 96);
  g.fillStyle = '#c8b030';
  g.fillRect(0, 128, W, 6);
  g.font = 'bold italic 64px "PT Sans", Arial, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 8;
  g.strokeStyle = '#1a4a20';
  g.strokeText('„ЗА РУЛЁМ“', W / 2, 112);
  g.fillStyle = '#f4e020';
  g.fillText('„ЗА РУЛЁМ“', W / 2, 112);
  g.strokeStyle = '#fff';
  g.lineWidth = 10;
  g.strokeRect(0, 0, W, H);
  return cv;
}
