/* «Путешествие в Швамбранию» (Л. Кассиль; «Малыш») — движок. Без DOM.
 *
 * Маршрут — чёрная линия с узлами на карте, снятая с поля (tools/sea/shv-route.py → route.json): «ноги» пути от развилки
 * до развилки. Корабль стоит на ноге leg в узле i (i = −1 — в узле, откуда нога начинается). Ход: компас показывает 1…12,
 * перед ходом в кассу — одна марка «топлива» (на суше — «продовольствия»); без марок — вдвое меньше узлов (округление вверх).
 * Порты (красные кружки) — обязательная остановка, лишние узлы теряются; в порту отвечают на вопросник
 * (в начале следующего хода: верно — плывут дальше в тот же ход, неверно — ход пропущен).
 * Развилки: у пункта 4 — через льды (до замерзания на 7-м круге) или Южным проливом мимо батарей; у мыса Маяка (12) —
 * Фиолетовым морем или в Бухту Добычи; у пункта 10 — проливом Семи Мудрых Школяров (лоцман и бежавшие из плена)
 * или западным берегом через три гавани; кто разбился у Мыса Бурь (14) — идёт сушей.
 * Побеждает первый, кто придёт на Большой рейд Швамбраэны. */
import type { Rng } from '../../../core/types';
import route from './route.json';
import { BOOKS, LETTER_SECTORS, known, letterOk, norm, sectionOf, type BookId } from './words';

export type LegId =
  | 'start'
  | 'ice'
  | 'south'
  | 'p8'
  | 'coast'
  | 'strait'
  | 'north'
  | 'straight'
  | 'bay'
  | 'sea'
  | 'land'
  | 'lake'
  | 'river'
  | 'plen8'
  | 'plen9'
  | 'escN'
  | 'escW'
  | 'rep5'
  | 'rep6'
  | 'rep7'
  | 'afterZR';

export const NODES = route.nodes as unknown as Record<string, [number, number]>;
export const LEGS = route.legs as unknown as Record<LegId, string[]>;
export const MAP = { w: route.w, h: route.h, img: '/shv/field.webp', mini: '/shv/field-small.webp', src: 6725 };

/** Узел, из которого нога начинается (i = −1). */
const ORIGIN: Record<LegId, string> = {
  start: 'ANCHOR',
  ice: 'N4',
  south: 'N4',
  p8: 'd279',
  coast: 'N10',
  strait: 'N10',
  north: 'N11',
  straight: 'N12',
  bay: 'N12',
  sea: 'N14',
  land: 'N14',
  lake: 'N19',
  river: 'N20',
  plen8: 'N8',
  plen9: 'N9',
  escN: 'P_PLEN',
  escW: 'P_PLEN',
  rep5: 'N5',
  rep6: 'N6',
  rep7: 'N7',
  afterZR: 'P_ZR',
};

/** Порты (красные кружки на карте) и что в них спрашивают. */
export const PORTS: Record<string, { name: string; book?: BookId }> = {
  P_OHOTA: { name: 'Берег Охоты', book: 'zoo' },
  P_ZR: { name: 'Берег Золотых Рук', book: 'tech' },
  P_NAS: { name: 'гавань полуострова Насаждений', book: 'bot' },
  P_LUK: { name: 'остров Лукоморья', book: 'lit' },
  P_DP: { name: 'остров Доброй Памяти', book: 'hist' },
  P_IMB: { name: 'Порт Имбирь', book: 'bot' },
  P_GROT: { name: 'грот Великого Лоцмана' },
  P_PLEN: { name: 'Остров Плена' },
  P_DOB: { name: 'Бухта Добычи', book: 'geo' },
};

export const isPort = (n: string) => n in PORTS;
export const pointNo = (n: string) => (/^N\d+$/.test(n) ? Number(n.slice(1)) : null);

export interface Pos {
  leg: LegId;
  i: number;
}

export interface QuizNeed {
  book: BookId;
  /** start — экзамен на капитана, port — гавань, bay — Бухта Добычи (+8 марок; можно не отвечать). */
  why: 'start' | 'port' | 'bay';
}

export interface Ship {
  seat: number;
  leg: LegId;
  i: number;
  marks: number;
  /** Где был до каждого из последних шагов — чтобы отходить назад. */
  trail: Pos[];
  quiz: QuizNeed | null;
  skip: number;
  /** На подводных рифах (пункт 3): снимется, когда выпадет число, кратное трём; подаёт SOS. */
  reef?: boolean;
  /** Захвачен пиратами: идёт на Остров Плена. */
  captive?: boolean;
  /** Сидит в плену: бежит, когда выпадет чётное. */
  inPlen?: boolean;
  escaped?: boolean;
  /** Вымпел Великого Лоцмана на борту. */
  lotsman?: boolean;
  /** Под огнём батарей — идёт чиниться к Берегу Золотых Рук. */
  repair?: boolean;
  /** Починился: у пункта 7 может пройти лишний узел. */
  repaired?: boolean;
  /** Разбит у Мыса Бурь: идёт сушей, марки — «продовольствие». */
  wrecked?: boolean;
  /** Брал на буксир: в следующий ход, сделав ход, отходит на 4 узла. */
  tow?: boolean;
  /** Дошёл до пункта 4 до замерзания — может идти через льды. */
  iceOk?: boolean;
  choice: { n4?: 'ice' | 'south'; n12?: 'straight' | 'bay' };
}

export interface ShvOpts {
  game: 'shv';
  /** Вопросники: по правилам (номер и буква), облегчённый вариант (только номер), без вопросников. */
  quiz: 'letters' | 'easy' | 'none';
  marks: number;
  /** На каком круге Лазурный океан у острова Благоразумия сковывают льды. */
  ice: number;
  /** Предел кругов (0 — без предела; всё равно не больше 300): тогда побеждает ближайший к цели. */
  limit: number;
}

export const SHV_DEFAULTS: ShvOpts = { game: 'shv', quiz: 'letters', marks: 30, ice: 7, limit: 0 };

export interface Quiz {
  seat: number;
  book: BookId;
  why: QuizNeed['why'];
  q: number;
  /** Буквы сектора («ГД», «ЕЖЗИ»…); пусто — облегчённый вариант. */
  letters: string;
  answer?: string;
  /** Кто судит ответ, которого нет в словаре. */
  judge?: number;
}

/** sail — компас показал число, корабль игрок ведёт сам (как в кинь-двинь). */
export type Phase = 'quiz' | 'answer' | 'judge' | 'spin' | 'sail' | 'fork' | 'pirates' | 'escape' | 'tow' | 'bayFail';

export interface Result {
  winners: number[];
  text: string;
}

export interface ShvState {
  game: 'shv';
  o: ShvOpts;
  seats: number[];
  /** Места, за которыми люди (они судят ответы, которых нет в словаре). */
  humans: number[];
  turn: number;
  round: number;
  phase: Phase;
  ships: Record<number, Ship>;
  quiz: Quiz | null;
  /** Ход ждёт выбора: сколько узлов идти, бесплатный ли он. */
  pending: { steps: number; free: boolean; fork?: 'n4' | 'n12' } | null;
  /** Кому предложить буксир. */
  towOffer: { victim: number } | null;
  /** Ход вне очереди (попутный ветер у пункта 1): без топлива. */
  free: boolean;
  /** Вымпел ещё в гроте. */
  pennant: boolean;
  frozen: boolean;
  /** Последний компас: угол и число. */
  needle: number;
  result: Result | null;
}

export type ShvAction =
  | { type: 'qspin' }
  | { type: 'pass' }
  | { type: 'answer'; text: string }
  | { type: 'giveup' }
  | { type: 'judge'; ok: boolean }
  | { type: 'spin' }
  | { type: 'sail' }
  | { type: 'fork'; way: 'ice' | 'south' | 'straight' | 'bay' }
  | { type: 'pirates'; pay: boolean }
  | { type: 'escape'; way: 'N' | 'W' }
  | { type: 'tow'; yes: boolean }
  | { type: 'bay'; retry: boolean };

export type ShvEvent =
  | { t: 'turn'; seat: number; round: number }
  | { t: 'qspin'; seat: number; book: BookId; q: number; letters: string; a1: number; a2: number | null }
  | { t: 'answer'; seat: number; text: string; how: 'dict' | 'honor' | 'judge' | 'letter' | 'giveup' | 'wait' }
  | { t: 'judged'; seat: number; ok: boolean }
  | { t: 'quiz'; seat: number; ok: boolean; book: BookId; why: QuizNeed['why']; gain?: number }
  | { t: 'compass'; seat: number; angle: number; n: number }
  | { t: 'pay'; seat: number; left: number; half?: boolean }
  | { t: 'go'; seat: number; path: string[]; free?: boolean }
  | { t: 'point'; seat: number; node: string; kind: PointKind; n?: number }
  | { t: 'skip'; seat: number; why: 'skip' | 'quiz' | 'reef' | 'plen' }
  | { t: 'back'; seat: number; path: string[]; why: 'wind' | 'tow' | 'lotsman' }
  | { t: 'pirates'; seat: number; paid: number | null }
  | { t: 'escape'; seat: number; way: 'N' | 'W' }
  | { t: 'tow'; seat: number; victim: number; marks: number }
  | { t: 'ice' }
  | { t: 'end'; result: Result };

/** Типы событий Швамбрании — по ним журнал карточки отличает их от событий «Пиратов» и «Колоний». */
export const SHV_EVENTS = new Set(['qspin', 'answer', 'judged', 'quiz', 'compass', 'pay', 'go', 'point', 'skip', 'back', 'pirates', 'escape', 'tow', 'ice']);

export type PointKind =
  | 'wind'
  | 'headwind'
  | 'reef'
  | 'unreef'
  | 'battery'
  | 'pirates'
  | 'plen'
  | 'lotsman'
  | 'current'
  | 'storm'
  | 'fire'
  | 'quarantine'
  | 'caravan'
  | 'volcano'
  | 'flood'
  | 'boat'
  | 'port'
  | 'repaired'
  | 'plus1'
  | 'home';

/* ---------- маршрут ---------- */

export const nodeOf = (p: Pos) => (p.i >= 0 ? LEGS[p.leg][p.i] : ORIGIN[p.leg]);
export const xy = (p: Pos) => NODES[nodeOf(p)];

type Next = Pos | { fork: 'n4' | 'n12' } | null;

/** Следующий узел пути корабля (null — дальше идти некуда: пришёл на рейд или в плен). */
export function next(s: ShvState, sh: Ship, p: Pos = sh): Next {
  const leg = LEGS[p.leg];
  if (p.i + 1 < leg.length) return { leg: p.leg, i: p.i + 1 };
  const go = (l: LegId): Pos => ({ leg: l, i: 0 });
  switch (p.leg) {
    case 'start':
      if (sh.choice.n4) return go(sh.choice.n4);
      if (s.frozen && !sh.iceOk) return go('south');
      return { fork: 'n4' };
    case 'ice':
    case 'south':
    case 'afterZR':
      return go('p8');
    case 'p8':
    case 'escN':
    case 'escW':
      return go(sh.escaped || sh.lotsman ? 'strait' : 'coast');
    case 'coast':
    case 'strait':
      return go('north');
    case 'north':
      return sh.choice.n12 ? go(sh.choice.n12) : { fork: 'n12' };
    case 'straight':
    case 'bay':
      return go(sh.wrecked ? 'land' : 'sea');
    case 'lake':
      return { leg: 'land', i: LEGS.land.indexOf('N20') + 1 };
    case 'rep5':
    case 'rep6':
    case 'rep7':
      return go('afterZR');
    default:
      return null;
  }
}

/** Сколько узлов до рейда (развилки — по короткому пути). Для предела кругов и ботов. */
export function left(s: ShvState, sh: Ship): number {
  const tmp: Ship = { ...sh, choice: { n4: sh.choice.n4 ?? 'south', n12: sh.choice.n12 ?? 'straight' } };
  let p: Pos = { leg: sh.leg, i: sh.i };
  let n = sh.inPlen || sh.captive ? 12 : 0;
  if (sh.inPlen) {
    p = { leg: 'escN', i: -1 };
    tmp.escaped = true;
  }
  for (let k = 0; k < 400; k++) {
    const nx = next(s, tmp, p);
    if (!nx || 'fork' in nx) break;
    p = nx;
    n++;
    if (nodeOf(p) === 'ANCHOR') break;
  }
  return n + sh.skip * 6 + (sh.reef ? 6 : 0) + (sh.quiz ? 3 : 0);
}

/* ---------- компас ---------- */

/** Угол стрелки (полградуса, никогда не на границе секторов) из rng.int(720). */
const angleOf = (k: number) => (k + 0.5) / 2;
export const numberAt = (a: number) => Math.floor((((a % 360) + 360) % 360) / 30) + 1;
export const lettersAt = (a: number) => LETTER_SECTORS[Math.floor((((a % 360) + 360) % 360) / 22.5)];
/** Для подкрутки в показе: rng.int(720), при котором стрелка встанет на число n. */
export const rigNumber = (n: number) => 60 * (n - 1) + 30;
/** …и на сектор букв с номером k (0 — «А»). */
export const rigLetters = (k: number) => Math.round(45 * k + 22);

/* ---------- партия ---------- */

export function newShv(seatList: number[], humans: number[], o: Partial<ShvOpts>, _rng: Rng): ShvState {
  const opts: ShvOpts = { ...SHV_DEFAULTS, ...o, game: 'shv' };
  const ships: Record<number, Ship> = {};
  for (const seat of seatList)
    ships[seat] = {
      seat,
      leg: 'start',
      i: -1,
      marks: opts.marks,
      trail: [],
      quiz: opts.quiz === 'none' ? null : { book: 'cap', why: 'start' },
      skip: 0,
      choice: {},
    };
  const s: ShvState = {
    game: 'shv',
    o: opts,
    seats: seatList.slice(),
    humans: humans.filter((x) => seatList.includes(x)),
    turn: 0,
    round: 1,
    phase: 'spin',
    ships,
    quiz: null,
    pending: null,
    towOffer: null,
    free: false,
    pennant: true,
    frozen: false,
    needle: 0,
    result: null,
  };
  begin(s, []);
  return s;
}

export const seatNow = (s: ShvState) => s.seats[s.turn];

export function toAct(s: ShvState): number[] {
  if (s.result) return [];
  if (s.phase === 'judge' && s.quiz?.judge !== undefined) return [s.quiz.judge];
  return [seatNow(s)];
}

const clone = (s: ShvState): ShvState => JSON.parse(JSON.stringify(s));

/** Начало хода текущего игрока: пропуски, вопросник или компас. */
function begin(s: ShvState, ev: ShvEvent[]) {
  for (let guard = 0; guard < s.seats.length * 4 + 4; guard++) {
    const sh = s.ships[seatNow(s)];
    s.free = false;
    s.quiz = null;
    s.pending = null;
    s.towOffer = null;
    if (sh.skip > 0) {
      sh.skip--;
      ev.push({ t: 'skip', seat: sh.seat, why: 'skip' });
      advance(s, ev);
      if (s.result) return;
      continue;
    }
    s.phase = sh.quiz ? 'quiz' : 'spin';
    return;
  }
  s.phase = 'spin';
}

function advance(s: ShvState, ev: ShvEvent[]) {
  s.turn = (s.turn + 1) % s.seats.length;
  if (s.turn === 0) {
    s.round++;
    if (!s.frozen && s.round > s.o.ice) {
      s.frozen = true;
      ev.push({ t: 'ice' });
    }
    const cap = Math.min(s.o.limit || 300, 300);
    if (s.round > cap) {
      const best = Math.min(...s.seats.map((x) => left(s, s.ships[x])));
      const winners = s.seats.filter((x) => left(s, s.ships[x]) === best);
      finish(s, ev, winners, 'Время вышло — ближе всех к Большому рейду');
      return;
    }
  }
  ev.push({ t: 'turn', seat: seatNow(s), round: s.round });
}

function endTurn(s: ShvState, ev: ShvEvent[]) {
  if (s.result) return;
  advance(s, ev);
  if (s.result) return;
  begin(s, ev);
}

function finish(s: ShvState, ev: ShvEvent[], winners: number[], text: string) {
  s.result = { winners, text };
  s.phase = 'spin';
  ev.push({ t: 'end', result: s.result });
}

/** Отойти назад на n узлов по своему следу. */
function back(s: ShvState, sh: Ship, n: number, why: 'wind' | 'tow' | 'lotsman', ev: ShvEvent[]) {
  const path: string[] = [];
  for (let k = 0; k < n && sh.trail.length; k++) {
    const p = sh.trail.pop()!;
    sh.leg = p.leg;
    sh.i = p.i;
    path.push(nodeOf(p));
  }
  if (path.length) ev.push({ t: 'back', seat: sh.seat, path, why });
}

/** Корабль с вымпелом стоит в пункте 10 или 11 — через него не пройти. */
const blocked = (s: ShvState, sh: Ship, node: string) =>
  (node === 'N10' || node === 'N11') && Object.values(s.ships).some((o) => o !== sh && o.lotsman && nodeOf(o) === node);

/** Пройти до n узлов. Возвращает пройденные узлы, или развилку, на которой нужен выбор. */
function walk(s: ShvState, sh: Ship, n: number): { path: string[]; fork?: 'n4' | 'n12'; passed: Set<string> } {
  const path: string[] = [];
  const passed = new Set<string>();
  for (let k = 0; k < n; k++) {
    const nx = next(s, sh);
    if (!nx) break;
    if ('fork' in nx) return { path, fork: nx.fork, passed };
    const node = nodeOf(nx);
    if (blocked(s, sh, node)) break;
    sh.trail.push({ leg: sh.leg, i: sh.i });
    if (sh.trail.length > 16) sh.trail.shift();
    sh.leg = nx.leg;
    sh.i = nx.i;
    path.push(node);
    passed.add(node);
    if (node === 'N4' && !s.frozen) sh.iceOk = true;
    if (isPort(node) || node === 'ANCHOR') break;
  }
  return { path, passed };
}

/** Куда пойдёт корабль в фазе sail: узлы пути (до развилки, если она на пути). */
export function sailPath(s: ShvState): string[] {
  if (s.phase !== 'sail' || !s.pending) return [];
  const c = clone(s);
  return walk(c, c.ships[seatNow(c)], s.pending.steps).path;
}

/** Компас указал ход — игрок сам ведёт корабль (фаза sail); пустой ход — сразу дальше. */
function sail(s: ShvState, sh: Ship, steps: number, free: boolean, ev: ShvEvent[]) {
  if (steps > 0 && walkable(s, sh)) {
    s.pending = { steps, free };
    s.phase = 'sail';
    return;
  }
  s.phase = 'spin';
  move(s, sh, steps, free, ev);
}

/** Есть ли куда сделать хоть шаг (стоит на развилке — сначала выбор пути, без фазы sail). */
function walkable(s: ShvState, sh: Ship) {
  const c = clone(s);
  return walk(c, c.ships[sh.seat], 1).path.length > 0;
}

/** Бесплатный перенос вперёд (течение, караванная тропа, лодка, лишний узел у 7): без событий в конце. */
function jump(s: ShvState, sh: Ship, n: number, ev: ShvEvent[]) {
  const { path } = walk(s, sh, n);
  if (path.length) ev.push({ t: 'go', seat: sh.seat, path, free: true });
  if (nodeOf(sh) === 'ANCHOR' && sh.leg !== 'start') home(s, sh, ev);
}

function home(s: ShvState, sh: Ship, ev: ShvEvent[]) {
  ev.push({ t: 'point', seat: sh.seat, node: 'ANCHOR', kind: 'home' });
  finish(s, ev, [sh.seat], sh.wrecked ? 'Пешим путником первым пришёл на Большой рейд Швамбраэны' : 'Первым бросил якорь на Большом рейде Швамбраэны');
}

/** Ход по компасу: n узлов (уже оплаченный). Развилка — ждём выбора. */
function move(s: ShvState, sh: Ship, n: number, free: boolean, ev: ShvEvent[]) {
  const { path, fork, passed } = walk(s, sh, n);
  if (path.length) ev.push({ t: 'go', seat: sh.seat, path, free });
  if (fork) {
    s.pending = { steps: n - path.length, free, fork };
    s.phase = 'fork';
    return;
  }
  s.pending = null;
  if (!path.length) {
    endTurn(s, ev);
    return;
  }
  land(s, sh, ev);
  if (s.result || s.phase !== 'spin' || s.free) return;
  if (sh.tow && !free) {
    sh.tow = false;
    back(s, sh, 4, 'tow', ev);
  }
  // буксир: прошёл мимо пункта 3, а там на рифах кто-то подаёт SOS
  const node = nodeOf(sh);
  if (!free && passed.has('N3') && node !== 'N3') {
    const victim = s.seats.find((x) => x !== sh.seat && s.ships[x].reef);
    if (victim !== undefined) {
      s.towOffer = { victim };
      s.phase = 'tow';
      return;
    }
  }
  endTurn(s, ev);
}

const point = (ev: ShvEvent[], sh: Ship, node: string, kind: PointKind, n?: number) => ev.push({ t: 'point', seat: sh.seat, node, kind, ...(n !== undefined ? { n } : {}) });

/** Что случилось там, где корабль остановился. */
function land(s: ShvState, sh: Ship, ev: ShvEvent[]) {
  const node = nodeOf(sh);
  if (node === 'ANCHOR' && sh.leg !== 'start') return home(s, sh, ev);
  const port = PORTS[node];
  if (port) {
    if (node === 'P_PLEN' && sh.captive) {
      sh.inPlen = true;
      point(ev, sh, node, 'plen');
      return;
    }
    if (node === 'P_GROT') {
      if (s.pennant) {
        s.pennant = false;
        sh.lotsman = true;
        sh.skip += 1;
        point(ev, sh, node, 'lotsman');
      }
      return;
    }
    if (node === 'P_ZR') {
      sh.repair = false;
      sh.repaired = true;
      point(ev, sh, node, 'repaired');
    } else point(ev, sh, node, 'port');
    if (port.book) {
      if (s.o.quiz !== 'none') sh.quiz = { book: port.book, why: node === 'P_DOB' ? 'bay' : 'port' };
      else if (node === 'P_DOB') sh.marks += 8;
    }
    return;
  }
  const no = pointNo(node);
  switch (no) {
    case 1:
      if (sh.leg !== 'start') return;
      point(ev, sh, node, 'wind');
      s.free = true;
      s.phase = 'spin';
      return;
    case 2:
      if (sh.leg !== 'start') return;
      point(ev, sh, node, 'headwind');
      back(s, sh, 4, 'wind', ev);
      return;
    case 3:
      if (sh.leg !== 'start') return;
      sh.reef = true;
      point(ev, sh, node, 'reef');
      return;
    case 5:
    case 6:
    case 7:
      if (sh.leg === 'south') {
        point(ev, sh, node, 'battery');
        sh.repair = true;
        sh.leg = no === 5 ? 'rep5' : no === 6 ? 'rep6' : 'rep7';
        sh.i = -1;
      } else if (no === 7 && sh.leg === 'afterZR' && sh.repaired) {
        point(ev, sh, node, 'plus1');
        jump(s, sh, 1, ev);
      }
      return;
    case 8:
    case 9:
      if (sh.leg !== 'p8' || sh.captive) return;
      point(ev, sh, node, 'pirates');
      if (sh.marks > 0) s.phase = 'pirates';
      else capture(s, sh, ev);
      return;
    case 10:
    case 11:
      if (!sh.lotsman) return;
      for (const o of Object.values(s.ships))
        if (o !== sh && nodeOf(o) === node) {
          point(ev, o, node, 'lotsman');
          back(s, o, 4, 'lotsman', ev);
        }
      return;
    case 13:
      if (sh.leg !== 'bay') return;
      point(ev, sh, node, 'current', 6);
      jump(s, sh, 6, ev);
      return;
    case 14:
      sh.wrecked = true;
      point(ev, sh, node, 'storm');
      return;
    case 15: {
      const lost = Math.floor(sh.marks / 2);
      sh.marks -= lost;
      point(ev, sh, node, 'fire', lost);
      return;
    }
    case 16:
      if (sh.lotsman) return;
      sh.skip += 1;
      point(ev, sh, node, 'quarantine');
      return;
    case 17:
      point(ev, sh, node, 'caravan', 3);
      jump(s, sh, 3, ev);
      return;
    case 18:
      sh.skip += 1;
      point(ev, sh, node, 'volcano');
      return;
    case 19:
      if (sh.leg !== 'land') return;
      point(ev, sh, node, 'flood');
      sh.leg = 'lake';
      sh.i = -1;
      return;
    case 20:
      point(ev, sh, node, 'boat', 4);
      sh.leg = 'river';
      sh.i = -1;
      jump(s, sh, 4, ev);
      return;
  }
}

function capture(s: ShvState, sh: Ship, ev: ShvEvent[]) {
  sh.captive = true;
  sh.choice = { ...sh.choice };
  const node = nodeOf(sh);
  sh.leg = node === 'N9' ? 'plen9' : 'plen8';
  sh.i = -1;
  ev.push({ t: 'pirates', seat: sh.seat, paid: null });
}

export const ransom = (marks: number) => Math.max(1, Math.floor(marks / 3));

/** Заплатить за ход (одна марка) и узнать, сколько узлов идти. */
function pay(s: ShvState, sh: Ship, n: number, ev: ShvEvent[]): number {
  if (s.free) return n;
  if (sh.marks > 0) {
    sh.marks--;
    ev.push({ t: 'pay', seat: sh.seat, left: sh.marks });
    return n;
  }
  ev.push({ t: 'pay', seat: sh.seat, left: 0, half: true });
  return Math.ceil(n / 2);
}

function quizResult(s: ShvState, ok: boolean, ev: ShvEvent[]) {
  const q = s.quiz!;
  const sh = s.ships[q.seat];
  const gain = ok && q.why === 'bay' ? 8 : undefined;
  ev.push({ t: 'quiz', seat: q.seat, ok, book: q.book, why: q.why, ...(gain ? { gain } : {}) });
  s.quiz = null;
  if (ok) {
    sh.quiz = null;
    if (gain) sh.marks += gain;
    s.phase = 'spin';
    return;
  }
  if (q.why === 'bay') {
    s.phase = 'bayFail';
    return;
  }
  ev.push({ t: 'skip', seat: q.seat, why: 'quiz' });
  endTurn(s, ev);
}

/** Есть ли за столом кто-то живой, кроме отвечающего, — тогда незнакомое слово судит он. */
const judgeFor = (s: ShvState, seat: number) => {
  const k = s.seats.indexOf(seat);
  for (let d = 1; d < s.seats.length; d++) {
    const x = s.seats[(k + d) % s.seats.length];
    if (s.humans.includes(x)) return x;
  }
  return undefined;
};

export function apply(s0: ShvState, seat: number, a: ShvAction, rng: Rng): { state: ShvState; events: ShvEvent[] } | null {
  if (s0.result) return null;
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: ShvEvent[] = [];
  const sh = s.ships[seatNow(s)];
  switch (a.type) {
    case 'qspin': {
      if (s.phase !== 'quiz' || !sh.quiz) return null;
      const a1 = angleOf(rng.int(720));
      const q = numberAt(a1);
      const a2 = s.o.quiz === 'letters' ? angleOf(rng.int(720)) : null;
      const letters = a2 === null ? '' : lettersAt(a2);
      s.needle = a2 ?? a1;
      s.quiz = { seat: sh.seat, book: sh.quiz.book, why: sh.quiz.why, q, letters };
      s.phase = 'answer';
      ev.push({ t: 'qspin', seat: sh.seat, book: sh.quiz.book, q, letters, a1, a2 });
      break;
    }
    case 'pass': {
      if (s.phase !== 'quiz' || sh.quiz?.why !== 'bay') return null;
      sh.quiz = null;
      s.phase = 'spin';
      break;
    }
    case 'answer':
    case 'giveup': {
      if (s.phase !== 'answer' || !s.quiz) return null;
      const q = s.quiz;
      const text = a.type === 'answer' ? String(a.text ?? '').slice(0, 60).trim() : '';
      if (!norm(text)) {
        ev.push({ t: 'answer', seat: q.seat, text: '', how: 'giveup' });
        quizResult(s, false, ev);
        break;
      }
      q.answer = text;
      if (!letterOk(text, q.letters)) {
        ev.push({ t: 'answer', seat: q.seat, text, how: 'letter' });
        quizResult(s, false, ev);
        break;
      }
      if (known(q.book, q.q, text)) {
        ev.push({ t: 'answer', seat: q.seat, text, how: 'dict' });
        quizResult(s, true, ev);
        break;
      }
      const j = judgeFor(s, q.seat);
      if (j === undefined) {
        ev.push({ t: 'answer', seat: q.seat, text, how: 'honor' });
        quizResult(s, true, ev);
        break;
      }
      q.judge = j;
      s.phase = 'judge';
      ev.push({ t: 'answer', seat: q.seat, text, how: 'wait' });
      break;
    }
    case 'judge': {
      if (s.phase !== 'judge' || !s.quiz) return null;
      ev.push({ t: 'judged', seat, ok: !!a.ok });
      quizResult(s, !!a.ok, ev);
      break;
    }
    case 'bay': {
      if (s.phase !== 'bayFail') return null;
      if (a.retry) {
        ev.push({ t: 'skip', seat: sh.seat, why: 'quiz' });
        endTurn(s, ev);
      } else {
        sh.quiz = null;
        s.phase = 'spin';
      }
      break;
    }
    case 'spin': {
      if (s.phase !== 'spin') return null;
      const angle = angleOf(rng.int(720));
      const n = numberAt(angle);
      s.needle = angle;
      ev.push({ t: 'compass', seat: sh.seat, angle, n });
      if (sh.inPlen) {
        if (n % 2) {
          ev.push({ t: 'skip', seat: sh.seat, why: 'plen' });
          endTurn(s, ev);
        } else {
          s.pending = { steps: n, free: false };
          s.phase = 'escape';
        }
        break;
      }
      if (sh.reef) {
        if (n % 3) {
          ev.push({ t: 'skip', seat: sh.seat, why: 'reef' });
          endTurn(s, ev);
          break;
        }
        sh.reef = false;
        ev.push({ t: 'point', seat: sh.seat, node: 'N3', kind: 'unreef' });
      }
      const free = s.free;
      const steps = pay(s, sh, n, ev);
      s.free = false;
      sail(s, sh, steps, free, ev);
      break;
    }
    case 'sail': {
      if (s.phase !== 'sail' || !s.pending) return null;
      const { steps, free } = s.pending;
      s.phase = 'spin';
      move(s, sh, steps, free, ev);
      break;
    }
    case 'fork': {
      if (s.phase !== 'fork' || !s.pending?.fork) return null;
      const f = s.pending.fork;
      if (f === 'n4') {
        if (a.way !== 'ice' && a.way !== 'south') return null;
        if (a.way === 'ice' && s.frozen && !sh.iceOk) return null;
        sh.choice.n4 = a.way;
      } else {
        if (a.way !== 'straight' && a.way !== 'bay') return null;
        sh.choice.n12 = a.way;
      }
      const { steps, free } = s.pending;
      sail(s, sh, steps, free, ev);
      break;
    }
    case 'pirates': {
      if (s.phase !== 'pirates') return null;
      if (a.pay && sh.marks > 0) {
        const cost = ransom(sh.marks);
        sh.marks -= cost;
        ev.push({ t: 'pirates', seat: sh.seat, paid: cost });
      } else capture(s, sh, ev);
      s.phase = 'spin';
      endTurn(s, ev);
      break;
    }
    case 'escape': {
      if (s.phase !== 'escape' || !s.pending) return null;
      if (a.way !== 'N' && a.way !== 'W') return null;
      sh.inPlen = false;
      sh.captive = false;
      sh.escaped = true;
      sh.leg = a.way === 'N' ? 'escN' : 'escW';
      sh.i = -1;
      sh.trail = [];
      ev.push({ t: 'escape', seat: sh.seat, way: a.way });
      const steps = pay(s, sh, s.pending.steps, ev);
      sail(s, sh, steps, false, ev);
      break;
    }
    case 'tow': {
      if (s.phase !== 'tow' || !s.towOffer) return null;
      const v = s.ships[s.towOffer.victim];
      s.towOffer = null;
      if (a.yes) {
        const prize = Math.min(3, v.marks);
        v.marks -= prize;
        sh.marks += prize;
        v.reef = false;
        const from = nodeOf(v);
        v.trail.push({ leg: v.leg, i: v.i });
        v.leg = sh.leg;
        v.i = sh.i;
        if (sh.iceOk) v.iceOk = true;
        sh.tow = true;
        ev.push({ t: 'tow', seat: sh.seat, victim: v.seat, marks: prize });
        ev.push({ t: 'go', seat: v.seat, path: [from, nodeOf(v)], free: true });
      }
      s.phase = 'spin';
      endTurn(s, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export const view = (s: ShvState): ShvState => s;

export const BOOK_TITLE = (b: BookId) => BOOKS[b].title;
export const questionText = (q: Pick<Quiz, 'book' | 'q'>) => sectionOf(q.book, q.q).title;
