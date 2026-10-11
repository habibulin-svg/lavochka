/* Бильярд — кий сверху: наклейка с мелом, белый пятак, кленовое древко с волокнами, металлическое кольцо соединения,
 * эбеновый турняк с кленовыми «пиками», обмотка, кольца и резиновый упор. Цилиндр — светотень поперёк, тень на сукне.
 * Рисуется в осях стола (метры). */

export interface CueLook {
  /** Длина, радиус наклейки и турняка, м. */
  len: number;
  tip: number;
  butt: number;
}

export const CUE_POOL: CueLook = { len: 1.47, tip: 0.0065, butt: 0.0155 };
export const CUE_RUSSIAN: CueLook = { len: 1.6, tip: 0.0062, butt: 0.016 };
export const CUE_SNOOKER: CueLook = { len: 1.45, tip: 0.0049, butt: 0.015 };

/**
 * tipX, tipY — где кончик наклейки; angle — направление удара (от кия к битку); px — пикселей в метре; alpha — прозрачность (исчезает после удара).
 */
export function drawCue(g: CanvasRenderingContext2D, tipX: number, tipY: number, angle: number, look: CueLook, px: number, alpha = 1, rotated = false) {
  const L = look.len;
  const rad = (x: number) => look.tip + (look.butt - look.tip) * Math.pow(x / L, 1.25);
  g.save();
  g.globalAlpha = alpha;
  g.translate(tipX, tipY);
  g.rotate(angle + Math.PI);
  // контур всего кия
  const outline = () => {
    g.beginPath();
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * L;
      g.lineTo(x, -rad(x));
    }
    for (let i = n; i >= 0; i--) {
      const x = (i / n) * L;
      g.lineTo(x, rad(x));
    }
    g.closePath();
  };
  // тень: кий над столом, лампы сверху — смещение и размытие
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 0.018 * px;
  // смещение тени задаётся в пикселях экрана; на повёрнутом столе — свои оси
  const sx = 0.016 * px;
  const sy = 0.03 * px;
  g.shadowOffsetX = rotated ? -sy : sx;
  g.shadowOffsetY = rotated ? sx : sy;
  g.fillStyle = '#000';
  outline();
  g.fill();
  g.restore();

  g.save();
  outline();
  g.clip();
  const band = (x0: number, x1: number, fill: string | CanvasGradient) => {
    g.fillStyle = fill;
    g.fillRect(x0, -look.butt * 1.2, x1 - x0, look.butt * 2.4);
  };
  const lg = (x0: number, x1: number, stops: [number, string][]) => {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    for (const [k, c] of stops) gr.addColorStop(k, c);
    return gr;
  };
  // наклейка с мелом, пятак
  band(0, 0.011, '#3c6aa8');
  band(0.011, 0.013, '#5a4632');
  band(0.013, 0.036, lg(0.013, 0.036, [[0, '#f6f2e6'], [1, '#e9e2cf']]));
  // древко — клён, светлеет к пятаку
  band(0.036, L * 0.5, lg(0.036, L * 0.5, [[0, '#f0dcb0'], [1, '#d9b47a']]));
  // волокна клёна
  g.strokeStyle = 'rgba(150,100,40,0.22)';
  g.lineWidth = 0.0006;
  for (let i = 0; i < 9; i++) {
    const y = (i / 8 - 0.5) * look.tip * 1.6;
    g.beginPath();
    g.moveTo(0.04, y);
    for (let x = 0.04; x < L * 0.5; x += 0.05) g.lineTo(x, y + Math.sin(x * 37 + i * 2.1) * 0.0005);
    g.stroke();
  }
  // соединение: металл
  const j = L * 0.5;
  band(j, j + 0.022, lg(j, j + 0.022, [[0, '#2a2a2a'], [0.2, '#d8dde2'], [0.5, '#7d858c'], [0.8, '#e4e8ec'], [1, '#2a2a2a']]));
  // турняк: эбен с кленовыми пиками
  const fx0 = j + 0.022;
  const fx1 = L * 0.72;
  band(fx0, fx1, '#1c120c');
  g.fillStyle = '#e2c792';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(fx0, s * look.butt * 0.25);
    g.lineTo(fx0 + (fx1 - fx0) * 0.75, 0);
    g.lineTo(fx0, s * look.butt * 1.1);
    g.closePath();
    g.fill();
  }
  // перламутровые вставки
  g.fillStyle = '#f2efe8';
  for (const x of [fx0 + (fx1 - fx0) * 0.35, fx0 + (fx1 - fx0) * 0.55]) {
    g.beginPath();
    g.ellipse(x, 0, 0.006, rad(x) * 0.28, 0, 0, Math.PI * 2);
    g.fill();
  }
  band(fx1, fx1 + 0.008, '#c9cdd2');
  // обмотка: тёмный лён в косую
  const wx1 = L * 0.9;
  band(fx1 + 0.008, wx1, '#26211d');
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 0.0012;
  for (let x = fx1 + 0.008; x < wx1; x += 0.004) {
    g.beginPath();
    g.moveTo(x, -look.butt);
    g.lineTo(x + 0.006, look.butt);
    g.stroke();
  }
  band(wx1, wx1 + 0.008, '#c9cdd2');
  band(wx1 + 0.008, L - 0.012, '#1c120c');
  band(L - 0.012, L, '#0c0c0c');
  // цилиндр: светотень поперёк (лампы чуть сбоку)
  const sh = g.createLinearGradient(0, -look.butt, 0, look.butt);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)');
  sh.addColorStop(0.28, 'rgba(255,255,255,0.18)');
  sh.addColorStop(0.4, 'rgba(255,255,255,0.32)');
  sh.addColorStop(0.55, 'rgba(255,255,255,0.0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = sh;
  // градиент — в масштабе толщины: растягиваем по участкам
  for (let i = 0; i < 12; i++) {
    const x0 = (i / 12) * L;
    const x1 = ((i + 1) / 12) * L;
    const rr = rad((x0 + x1) / 2);
    g.save();
    g.translate(0, 0);
    g.scale(1, rr / look.butt);
    g.fillRect(x0, -look.butt, x1 - x0 + 0.001, look.butt * 2);
    g.restore();
  }
  g.restore();
  g.restore();
}
