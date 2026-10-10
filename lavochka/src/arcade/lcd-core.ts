/* ЖК-игры («Электроника ИМ»): общее без DOM — логика игры, сегменты цифр.
 * Экран — набор сегментов (SVG-фигур с id); логика на каждом тике говорит, какие горят. Негорящие видны еле-еле — как на настоящем ЖК. */

/** Звук тика: высота писка (Гц). */
export type LcdBeep = number;

export interface LcdLogic {
  readonly score: number;
  readonly over: boolean;
  /** Положить в out id горящих сегментов. */
  lit(out: Set<string>): void;
  /** Нажатие кнопки (id из спецификации устройства). */
  press(btn: string): void;
  /** Шаг игры: что пищит. */
  tick(): LcdBeep[];
  /** Через сколько мс следующий тик. */
  interval(): number;
}

export interface LcdButton {
  id: string;
  /** Подпись-стрелка. */
  label: string;
  side: 'left' | 'right';
  row: 0 | 1;
  keys: string[];
}

export interface LcdSpec {
  id: string;
  title: string;
  /** Подпись модели: «ИМ-02». */
  model: string;
  /** Цвет корпуса и деталей. */
  body: { color: string; dark: string; trim: string; label: string };
  /** Размер экрана в единицах SVG. */
  w: number;
  h: number;
  /** Цветная картинка под ЖК (как плёнка под стеклом). */
  art: string;
  /** Сегменты: id → SVG-разметка (рисуется цветом сегмента). */
  segs: Record<string, string>;
  buttons: LcdButton[];
  /** Где на экране цифры счёта/часов: 4 знакоместа и двоеточие. */
  digits: { x: number; y: number; size: number };
  create(mode: string, seed: number): LcdLogic;
  modes: { id: string; label: string }[];
}

// ---------------------------------------------------------------- семисегментные цифры

const DIGIT: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  ' ': '',
  '-': 'g',
};

/** Сегменты четырёх знакомест и двоеточия: id «d0a»…«d3g», «col». */
export function digitSegs(x0: number, y0: number, size: number): Record<string, string> {
  const out: Record<string, string> = {};
  const w = size * 0.55;
  const t = size * 0.11;
  const hh = size / 2;
  for (let d = 0; d < 4; d++) {
    const x = x0 + d * (w + size * 0.3) + (d >= 2 ? size * 0.25 : 0);
    const y = y0;
    const H = (yy: number) => `<polygon points="${x + t},${yy} ${x + w - t},${yy} ${x + w - t * 1.6},${yy + t} ${x + t * 1.6},${yy + t}"/>`;
    const V = (xx: number, yy: number) => `<polygon points="${xx},${yy + t * 0.6} ${xx + t},${yy + t * 1.4} ${xx + t},${yy + hh - t * 0.6} ${xx},${yy + hh - t * 0.2}"/>`;
    out[`d${d}a`] = H(y);
    out[`d${d}g`] = `<polygon points="${x + t * 1.2},${y + hh - t / 2} ${x + w - t * 1.2},${y + hh - t / 2} ${x + w - t * 1.6},${y + hh + t / 2} ${x + t * 1.6},${y + hh + t / 2}"/>`;
    out[`d${d}d`] = `<polygon points="${x + t * 1.6},${y + size - t} ${x + w - t * 1.6},${y + size - t} ${x + w - t},${y + size} ${x + t},${y + size}"/>`;
    out[`d${d}f`] = V(x, y);
    out[`d${d}e`] = V(x, y + hh);
    out[`d${d}b`] = `<polygon points="${x + w},${y + t * 0.6} ${x + w - t},${y + t * 1.4} ${x + w - t},${y + hh - t * 0.6} ${x + w},${y + hh - t * 0.2}"/>`;
    out[`d${d}c`] = `<polygon points="${x + w},${y + hh + t * 0.6} ${x + w - t},${y + hh + t * 1.4} ${x + w - t},${y + size - t * 0.6} ${x + w},${y + size - t * 0.2}"/>`;
  }
  const cx = x0 + 2 * (w + size * 0.3) + size * 0.02;
  out.col = `<circle cx="${cx}" cy="${y0 + size * 0.3}" r="${t * 0.7}"/><circle cx="${cx}" cy="${y0 + size * 0.7}" r="${t * 0.7}"/>`;
  return out;
}

/** Зажечь цифры строки (до 4 знаков, выравнивание вправо). */
export function litDigits(text: string, out: Set<string>, colon = false) {
  const s = text.slice(-4).padStart(4, ' ');
  for (let d = 0; d < 4; d++) for (const seg of DIGIT[s[d]] ?? '') out.add(`d${d}${seg}`);
  if (colon) out.add('col');
}

/** Простой генератор случайных чисел для логики (свой, чтобы игра повторялась по сиду). */
export function lcdRng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
