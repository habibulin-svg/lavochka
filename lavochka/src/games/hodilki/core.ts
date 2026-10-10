/* Кинь-двинь — общее про ходилки на оригинальных советских полях (картинки — public/hodilki/). Без DOM.
 * Поле — список клеток по ходу (координаты на картинке) со знаками: пропуск хода, ещё ход, «начать сначала», переход на другую клетку
 * (вверх/вниз, вперёд/назад — заранее посчитанный номер клетки). Кубик d6; знак срабатывает один раз (на клетке, куда перенесло, — уже нет).
 * До финиша считать точно не нужно: дошёл или перешёл — победил. */
export type Sign = { k: 'skip' } | { k: 'again' } | { k: 'start' } | { k: 'jump'; to: number; text: string; good: boolean };

export interface Cell {
  x: number;
  y: number;
  sign: Sign | null;
  /** Подпись (номер на поле), если есть. */
  label?: string;
}

export interface Board {
  id: string;
  title: string;
  img: { w: number; h: number; url: string };
  cells: Cell[];
  /** Размер пуговицы — доля ширины картинки. */
  token: number;
  goal: string;
  rules: string;
  winText: string;
  /** Показ правил: шаги с подкрученным кубиком. */
  demo?: { rig: number; caption: string; seat?: number }[];
}

export interface State {
  /** Поле (id из BOARDS). */
  map: string;
  seats: number[];
  pos: number[];
  skip: boolean[];
  turn: number;
  last: number | null;
  winner: number | null;
}

export type Action = { type: 'roll' };

export type Event =
  | { type: 'roll'; seat: number; die: number }
  | { type: 'move'; seat: number; path: number[] }
  | { type: 'sign'; seat: number; sign: Sign; to: number }
  | { type: 'skip'; seat: number }
  | { type: 'win'; seat: number };

export const SEATS = [
  { name: 'Вовка', color: '#d8241c', light: '#ff6a5a', dark: '#7a1210' },
  { name: 'Ленка', color: '#2060d0', light: '#6a9aff', dark: '#103a80' },
  { name: 'Серёга', color: '#2a9a3a', light: '#6ad07a', dark: '#145a20' },
  { name: 'Танька', color: '#e8b020', light: '#ffd870', dark: '#8a6408', ink: '#8a6408' },
  { name: 'Димон', color: '#8a3ac8', light: '#c08aff', dark: '#4a1a7a' },
  { name: 'Колян', color: '#5a5a5a', light: '#9a9a9a', dark: '#2a2a2a' },
  { name: 'Светка', color: '#e85a9a', light: '#ffa0c8', dark: '#8a2050' },
  { name: 'Жека', color: '#1a9a9a', light: '#60d0d0', dark: '#0a5a5a' },
  { name: 'Маринка', color: '#f07a1a', light: '#ffb070', dark: '#8a400a' },
  { name: 'Петька', color: '#6a4a2a', light: '#a07a50', dark: '#3a2410' },
];

export const signText = (g: Sign) => (g.k === 'skip' ? 'пропускает ход' : g.k === 'again' ? 'ходит ещё раз' : g.k === 'start' ? 'начинает сначала' : g.text);

const rowWord = (n: number) => (n === 1 ? 'ряд' : n < 5 ? 'ряда' : 'рядов');

/** Поле-«змейка» Феликса Шапиро: ряды снизу вверх, нижний — слева направо, дальше поворот на каждом ряду.
 * `signs` — знаки по клеткам `'ряд,колонка'` (ряды сверху 1…N, колонки слева 1…M): `skip`, `again`, `start`, `upN`/`downN` — на N рядов
 * в той же колонке, `RN`/`LN` — на N делений по стрелке (по ходу «змейки» — вперёд, против — назад).
 * `cols(ряд)` — первая и последняя клетка ряда (где-то клетки заняты табличкой правил или заголовком); `xs`/`ys` — границы колонок и рядов. */
export function snake(o: { signs: Record<string, string>; xs: number[]; ys: number[]; k?: number; cols: (row: number) => [number, number] }): Cell[] {
  const k = o.k ?? 1;
  const rows = o.ys.length - 1;
  const geo: { row: number; col: number; dir: 1 | -1; code?: string }[] = [];
  for (let row = rows; row >= 1; row--) {
    const [a, b] = o.cols(row);
    const dir: 1 | -1 = (rows - row) % 2 === 0 ? 1 : -1;
    for (let i = 0; i <= b - a; i++) {
      const col = dir === 1 ? a + i : b - i;
      geo.push({ row, col, dir, code: o.signs[`${row},${col}`] });
    }
  }
  const at = (row: number, col: number) => geo.findIndex((c) => c.row === row && c.col === col);
  return geo.map((c, idx): Cell => {
    const x = ((o.xs[c.col - 1] + o.xs[c.col]) / 2) * k;
    const y = ((o.ys[c.row - 1] + o.ys[c.row]) / 2) * k;
    const code = c.code;
    let sign: Sign | null = null;
    if (code === 'skip' || code === 'again' || code === 'start') sign = { k: code };
    else if (code?.startsWith('up') || code?.startsWith('down')) {
      const up = code.startsWith('up');
      const n = +code.slice(up ? 2 : 4);
      const to = at(up ? c.row - n : c.row + n, c.col);
      if (to >= 0) sign = { k: 'jump', to, good: up, text: up ? `взлетает на ${n} ${rowWord(n)} вверх` : `падает на ${n} ${rowWord(n)} вниз` };
    } else if (code) {
      // стрелка вбок: по ходу «змейки» — вперёд, против — назад
      const n = +code.slice(1);
      const fwd = (code[0] === 'R' ? 1 : -1) === c.dir;
      sign = { k: 'jump', to: idx + (fwd ? n : -n), good: fwd, text: fwd ? `вперёд на ${n}` : `назад на ${n}` };
    }
    return { x, y, sign };
  });
}

/** Правила полей Шапиро — одни и те же. */
export const SNAKE_RULES = `<p>Бросьте кубик и передвиньте пуговицу на столько делений, сколько выпало, — по пунктирным стрелкам. Старт — левая клетка нижнего ряда.</p>
    <p>Знаки: <b>кружок</b> — пропуск хода, <b>квадрат</b> — ещё ход, <b>треугольник вверх/вниз</b> — на столько рядов вверх или вниз, сколько написано,
    <b>треугольник вбок</b> — на столько делений вперёд или назад, <b>чёрный кружок</b> — начинайте сначала.</p>`;
