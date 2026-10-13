/* Кинь-двинь — общее про ходилки на оригинальных советских полях (картинки — public/hodilki/). Без DOM.
 * Поле — список клеток по ходу (координаты на картинке) со знаками: пропуск хода, ещё ход, «начать сначала», переход на другую клетку
 * (вверх/вниз, вперёд/назад — заранее посчитанный номер клетки). Кубик d6; знак срабатывает один раз (на клетке, куда перенесло, — уже нет).
 * До финиша считать точно не нужно: дошёл или перешёл — победил. */
export type Sign =
  | { k: 'skip'; n?: number }
  | { k: 'again' }
  | { k: 'start' }
  /** Переход на клетку to; skip — и ещё пропустить столько ходов (Шегерян: «после пропуска хода — до 24»). */
  | { k: 'jump'; to: number; text: string; good: boolean; skip?: number }
  /** Ветка «туда и обратно» (Шегерян: «до г. Крей и обратно», тупик): следующими бросками фишка идёт по cells (до конца ветки и назад), потом — дальше по пути. */
  | { k: 'route'; cells: number[]; text: string };

/** Гонка с голами («Шайба»): у каждой дорожки свой путь из общих клеток, финиш — не победа, а гол.
 * Места делятся на дорожки по кругу (0,2,4 — первая, 1,3,5 — вторая): вдвоём это две шайбы, вчетвером — две команды по два. */
export interface Race {
  /** Дорожки: номера клеток в порядке хода (у каждой свой старт — центр поля — и свои ворота в конце). */
  tracks: number[][];
  /** Сколько голов до победы, если настройка партии не задаёт своё. */
  target: number;
  /** Особый кубик: грани 1…pips — очки, грань stick — красная клюшка (назад), последняя — зелёная (вперёд).
   * Клюшка тянет картонный квадратик с 1–3 очками. */
  die: { pips: number; stick: number };
  /** Картинки шайб по дорожкам (public/hodilki/…). */
  pucks?: string[];
}

export interface Cell {
  x: number;
  y: number;
  sign: Sign | null;
  /** Подпись (номер на поле), если есть. */
  label?: string;
  /** Текст клетки с поля или из правил («Забыли взять ружья. Возвратиться в лагерь»). */
  text?: string;
  /** Клетка ветки, а не основного пути: на неё попадают только по знаку route. */
  off?: boolean;
}

export interface Board {
  id: string;
  title: string;
  /** Картинка поля: w×h — система координат клеток; tiles — пирамида тайлов из исходного скана (tools/hodilki/tiles.py):
   * dir/tiny.webp, dir/view.webp — общая карта, dir/<уровень>/<c>_<r>.webp — тайлы 512 px; уровень 0 — скан src целиком. */
  img: { w: number; h: number; dir: string; src: [number, number]; levels: number };
  cells: Cell[];
  /** Размер пуговицы — доля ширины картинки. */
  token: number;
  goal: string;
  rules: string;
  winText: string;
  /** Финиш — номер клетки; по умолчанию последняя (после неё в списке могут идти клетки веток). */
  end?: number;
  /** Кто издал, откуда поле — строка под правилами. */
  credit?: string;
  /** Гонка с голами («Шайба»): своя дорожка каждому месту, кубик с клюшками, квадратики. */
  race?: Race;
  /** Показ правил: шаги с подкрученным кубиком. rig — значения для rng.int (у клюшки их два: грань и квадратик). */
  demo?: { rig: number | number[]; caption: string; seat?: number }[];
}

export interface State {
  /** Поле (id из BOARDS). */
  map: string;
  seats: number[];
  pos: number[];
  /** Сколько ходов пропустить (старые сохранения — true/false). */
  skip: (boolean | number)[];
  /** Ветка, по которой фишка идёт сейчас (остаток пути); нет — по основному пути. */
  route?: (number[] | null)[];
  turn: number;
  /** 'roll' — бросать кубик, 'move' — кубик брошен, игрок сам переставляет пуговицу. Нет поля — старая партия, значит 'roll'. */
  phase?: 'roll' | 'move';
  /** Сколько шагов идти: у гонки с голами шаг бывает отрицательным (красная клюшка — назад). */
  last: number | null;
  winner: number | null;
  /** Гонка с голами: забитые шайбы по дорожкам. */
  goals?: number[];
  /** Гонка с голами: сколько голов до победы (настройка партии). */
  target?: number;
  /** Гонка с голами: что выпало на кубике — очки или клюшка. */
  kind?: 'pips' | 'red' | 'green' | null;
  /** Гонка с голами: очки на вытянутом квадратике (1–3). */
  card?: number | null;
  /** Гонка с голами: какой из пяти квадратиков с этими очками вытянули (0–14) — чтобы показать ту же картинку. */
  cardSlot?: number | null;
}

export type Action = { type: 'roll' } | { type: 'move' };

export type Event =
  | { type: 'roll'; seat: number; die: number; /** Что выпало: очки или клюшка (гонка с голами). */ kind?: 'pips' | 'red' | 'green'; card?: number; slot?: number }
  | { type: 'move'; seat: number; path: number[] }
  | { type: 'sign'; seat: number; sign: Sign; to: number; /** Текст клетки (что случилось). */ text?: string }
  | { type: 'skip'; seat: number }
  /** Гонка с голами: шайба в воротах, возвращается в центр. */
  | { type: 'goal'; seat: number; track: number; goals: number; target: number }
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

export const finishOf = (b: Board) => b.end ?? b.cells.length - 1;

/** Дорожка места: у обычных полей путь один на всех, у гонки с голами — по кругу (0, 2, 4… — первая шайба). */
export const trackOf = (b: Board, seat: number) => (b.race ? seat % b.race.tracks.length : 0);

/** Клетки дорожки места: у обычных полей нет (идут по общему пути). */
export const trailOf = (b: Board, seat: number) => b.race?.tracks[trackOf(b, seat)] ?? null;

/** Гонка с голами: путь по своей дорожке — вперёд по ходу или назад (красная клюшка). За воротами путь кончается:
 * лишние очки пропадают, а сама шайба в воротах — это гол (его считает apply). */
function racePath(s: State, b: Board, seat: number): number[] {
  const trail = trailOf(b, seat)!;
  const at = Math.max(0, trail.indexOf(s.pos[seat]));
  const n = s.last ?? 0;
  const out: number[] = [];
  if (n > 0) for (let i = at + 1; i < trail.length && out.length < n; i++) out.push(trail[i]);
  else for (let i = at - 1; i >= 0 && out.length < -n; i--) out.push(trail[i]);
  return out;
}

/** Клетки, по которым пройдёт пуговица за бросок: сначала остаток ветки, потом основной путь. До финиша считать точно не нужно. */
export function pathFor(s: State, b: Board, seat: number): number[] {
  if (b.race) return racePath(s, b, seat);
  const out: number[] = [];
  let n = s.last ?? 0;
  const route = s.route?.[seat] ?? [];
  for (let i = 0; i < route.length && n > 0; i++, n--) out.push(route[i]);
  // ветка кончается на клетке входа — лишние очки пропадают (дошёл «и обратно» — стоп)
  if (route.length) return out;
  let at = s.pos[seat];
  const end = finishOf(b);
  for (; n > 0 && at < end; n--) out.push(++at);
  return out;
}

/** Куда встанет пуговица после броска (до знака). */
export const target = (s: State, b: Board, seat: number) => {
  const p = pathFor(s, b, seat);
  return p.length ? p[p.length - 1] : s.pos[seat];
};

export const skipsOf = (s: State, seat: number) => Number(s.skip[seat] || 0);

export const signText = (g: Sign) =>
  g.k === 'skip' ? (g.n && g.n > 1 ? `пропускает ${g.n} хода` : 'пропускает ход') : g.k === 'again' ? 'ходит ещё раз' : g.k === 'start' ? 'начинает сначала' : g.text;

export const signGood = (g: Sign) => g.k === 'again' || (g.k === 'jump' && g.good);

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
