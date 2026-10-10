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
