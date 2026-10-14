/**
 * «Корона Эмбера» — движок обеих частей.
 *
 * Поле 1 «Мир Приключений»: бросок кубика — столько шагов по проходам (EDGES1 в data.ts: проход есть,
 * где клетки разделены тонкой линией или стрелкой «⇄»), назад на только что пройденную клетку не шагаем.
 * Игрок выбирает конечную клетку, путь к ней — маршрут (`routes`). На клетках «останавливаешься здесь
 * проходом» (обменные пункты, ЛАЗАРЕТ, ЗАГОТКОНТОРА, ПРОВАЛЫ) можно встать, не дойдя все шаги.
 * Клетки: обменный пункт (покупка и обмен характеристик), лазарет, лицей (два кубика по таблице с поля),
 * Храм Бааля и Перевал (подполя из 8 секторов: бродишь по кругу, пока не выпадет выход), ПРОВАЛ (выход
 * в Эмбер при пороге по всем характеристикам), остальные — карточка приключений.
 *
 * Поле 2 «Королевство Эмбер»: дорога от ПРОВАЛА по стрелкам (развилки — по чётности броска, клетки
 * ±ПС/ПУ/ПМ; не хватает характеристики — теряешь 1 ПЖ) → СТОЛИЦА (становишься принцем; лавка: 1 ПЖ за
 * 20 талеров или за 5 ПС/ПУ/ПМ) → ЛАБИРИНТ (три кольца ворот: 4–6 — возьми ПЖ, 1–3 — отложи ПЖ) →
 * ДВОРЕЦ (можно вызвать на поединок принца из покоев) → ДВОРЦОВЫЕ ПОКОИ (по клетке за ход, +1/+1/+2/+3 ПЖ)
 * → ТРОННЫЙ ЗАЛ: коронация и победа.
 *
 * Упрощения первой версии (помечены в коде): предметов, амулетов, друзей и боёв по карточкам нет —
 * у карточки работает только текст «возьми / теряешь N ПС…»; положительное в карточках усилено.
 */
import type { Rng } from '../../core/types';
import { DECK, EDGES1, PLACES2, RINGS_PJ, ROAD_BY_ID, ROOM_PJ, cell, deckCard, rosetteOf } from './data';
import { CELL_RULES, FALL_NEED_DEFAULT, LIFE_MAX, START, START_LIFE, START_THALERS, STATS, type Stat } from './rules';

export interface Seat {
  seat: number;
  kind: 'human' | 'bot';
  name: string;
  level?: number;
}

/** Где герой: поле 1, дорога поля 2, столица, лабиринт, дворец, покои. */
export type Zone = 'world' | 'road' | 'capital' | 'labyrinth' | 'palace' | 'chambers';

export interface Hero {
  /** клетка на поле 1 (в подполе — 25 или 28) */
  cell: number;
  /** сектор подполя (1…8), 0 — только вошёл; null — не в подполе */
  sector: number | null;
  /** клетка дороги поля 2 */
  node: string;
  life: number;
  st: Record<Stat, number>;
  thalers: number;
  /** предметы (в этой версии не выдаются — котомка всегда пуста) */
  items: number[];
  zone: Zone;
  /** жизни принца */
  pj: number;
  prince: boolean;
  /** пройдено колец лабиринта */
  ring: number;
  /** последние ворота: налево (взял ПЖ) или направо (отдал) — для места фишки */
  gate: 'L' | 'R' | null;
  /** клетка покоев (0…3 снизу вверх) */
  room: number;
  /** пропустить ходов */
  skip: number;
}

/** pick — выбор, куда идти (поле 1); card — карточка или событие клетки ждёт «Дальше»; shop — обменный пункт. */
export type Phase = 'roll' | 'pick' | 'card' | 'shop' | 'over';

export interface Shown {
  /** номер карточки приключений (n) или null — событие клетки */
  n: number | null;
  title: string;
  text: string;
  /** что изменилось: «ПС +3», «ПЖ −1» */
  lines: string[];
}

export interface State {
  seats: number[];
  kinds: Record<number, 'human' | 'bot'>;
  names: Record<number, string>;
  levels: Record<number, number>;
  heroes: Record<number, Hero>;
  turn: number;
  phase: Phase;
  die: number;
  deck: number[];
  card: Shown | null;
  need: number;
  log: string[];
  winner: number | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'go'; path: number[] }
  | { type: 'buyStat'; stat: Stat }
  | { type: 'exchange'; from: Stat; to: Stat }
  | { type: 'ok' }
  // поле 2
  | { type: 'buyPj' }
  | { type: 'exchangePj'; from: Stat }
  | { type: 'labyrinth' }
  | { type: 'climb' }
  | { type: 'challenge'; target: number };

export type Event =
  | { type: 'roll'; seat: number; die: number; dice?: number[] }
  | { type: 'step'; seat: number; cell: number }
  | { type: 'sector'; seat: number; cell: number; sector: number }
  | { type: 'road'; seat: number; node: string }
  | { type: 'card'; seat: number; card: Shown }
  | { type: 'money'; seat: number; delta: number }
  | { type: 'stat'; seat: number; stat: Stat; delta: number }
  | { type: 'life'; seat: number; delta: number }
  | { type: 'pj'; seat: number; delta: number }
  | { type: 'zone'; seat: number; zone: Zone; text: string }
  | { type: 'duel'; seat: number; target: number; a: [number, number]; b: [number, number]; lost: number[] }
  | { type: 'skip'; seat: number }
  | { type: 'turn'; seat: number }
  | { type: 'over'; winner: number };

interface X {
  ev: Event[];
}

// ---------- граф поля 1 ----------

const NEIGH: Record<number, number[]> = {};
for (const [a, b] of EDGES1) {
  (NEIGH[a] ??= []).push(b);
  (NEIGH[b] ??= []).push(a);
}
for (const k of Object.keys(NEIGH)) NEIGH[Number(k)].sort((a, b) => a - b);

export const neighbours = (n: number): number[] => NEIGH[n] ?? [];

export type CellKind = 'exchange' | 'hospital' | 'fall' | 'lyceum' | 'meadow' | 'office' | 'door' | 'plain';

/** Вид клетки по её названию (в разметке названия — единственный признак типа). */
export function kindOf(n: number): CellKind {
  if (rosetteOf(n)) return 'door';
  const name = (cell(n)?.name ?? '').toUpperCase();
  if (name.includes('ОБМЕННЫЙ')) return 'exchange';
  if (name.includes('ЛАЗАРЕТ')) return 'hospital';
  if (name.includes('ПРОВАЛ')) return 'fall';
  if (name.includes('ЛИЦЕЙ')) return 'lyceum';
  if (name.includes('ЗАГОТКОНТОРА')) return 'office';
  if (name.includes('ВЕДЬМИН') || name.includes('РОЩА')) return 'meadow';
  return 'plain';
}

/** «Останавливаешься здесь проходом»: на этих клетках можно встать, не дойдя все шаги. */
export const passStop = (n: number) => {
  const k = kindOf(n);
  return k === 'exchange' || k === 'hospital' || k === 'fall' || k === 'office';
};

/** Клетка-дверь подполя: войдя на неё, ход кончается, герой уходит бродить по секторам. */
const isDoor = (n: number) => kindOf(n) === 'door';

/** Куда можно прийти броском: конечная клетка → путь (без начальной). */
export function routes(from: number, die: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const walk = (at: number, prev: number | null, left: number, path: number[]) => {
    if (path.length) {
      if (left === 0 || isDoor(at)) {
        if (!out.has(at)) out.set(at, path);
        return;
      }
      if (passStop(at) && !out.has(at)) out.set(at, path);
    }
    let next = neighbours(at).filter((m) => m !== prev);
    if (!next.length) next = neighbours(at); // тупик — можно вернуться
    for (const m of next) walk(m, at, left - 1, [...path, m]);
  };
  walk(from, null, die, []);
  return out;
}

/** Расстояния по проходам от клетки (двери подполей — тупики). */
export function distances(from: number): Map<number, number> {
  const d = new Map<number, number>([[from, 0]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const n = q[i];
    if (n !== from && isDoor(n)) continue;
    for (const m of neighbours(n)) {
      if (!d.has(m)) {
        d.set(m, d.get(n)! + 1);
        q.push(m);
      }
    }
  }
  return d;
}

/** Старт — Золотая шахта в углу Мира Золота (на поле стартовой клетки нет, берём угол). */
export const START_CELL = 72;
/** Жизни принца сверх своих ПЖ: карта принца (колоды принцев у нас нет — берём ровное число). */
export const PRINCE_PJ = 4;

export function newState(seats: Seat[], opts: { deck?: number; need?: number } = {}, rng?: Rng): State {
  const ids = seats.map((s) => s.seat).sort((a, b) => a - b);
  const heroes: Record<number, Hero> = {};
  const kinds: Record<number, 'human' | 'bot'> = {};
  const names: Record<number, string> = {};
  const levels: Record<number, number> = {};
  for (const s of seats) {
    heroes[s.seat] = {
      cell: START_CELL, sector: null, node: 'fall', life: START_LIFE, st: { ...START }, thalers: START_THALERS, items: [],
      zone: 'world', pj: 0, prince: false, ring: 0, gate: null, room: 0, skip: 0,
    };
    kinds[s.seat] = s.kind;
    names[s.seat] = s.name;
    levels[s.seat] = s.level ?? 1;
  }
  const r = rng ?? ({ int: (n: number) => Math.floor(Math.random() * n) } as Rng);
  const deck = shuffle(DECK.map((c) => c.n), r).slice(0, Math.max(10, Math.min(opts.deck ?? DECK.length, DECK.length)));
  return {
    seats: ids, kinds, names, levels, heroes,
    turn: ids[0], phase: 'roll', die: 0, deck, card: null,
    need: opts.need ?? FALL_NEED_DEFAULT,
    log: ['Путники вышли в Мир Приключений.'],
    winner: null,
  };
}

function shuffle(a: number[], rng: Rng): number[] {
  const d = [...a];
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------- мелкие изменения героя (каждое — событие) ----------

const put = (s: State, seat: number, h: Partial<Hero>): State => ({ ...s, heroes: { ...s.heroes, [seat]: { ...s.heroes[seat], ...h } } });

const give = (s: State, x: X, seat: number, stat: Stat, d: number): State => {
  const h = s.heroes[seat];
  // путник не может иметь больше 14 собственных ПС, ПУ, ПМ, ПО (правило с поля)
  const v = Math.min(14, Math.max(0, h.st[stat] + d));
  if (v === h.st[stat]) return s;
  x.ev.push({ type: 'stat', seat, stat, delta: v - h.st[stat] });
  return put(s, seat, { st: { ...h.st, [stat]: v } });
};

const money = (s: State, x: X, seat: number, d: number): State => {
  const h = s.heroes[seat];
  const v = Math.max(0, h.thalers + d);
  if (v === h.thalers) return s;
  x.ev.push({ type: 'money', seat, delta: v - h.thalers });
  return put(s, seat, { thalers: v });
};

const life = (s: State, x: X, seat: number, d: number): State => {
  const h = s.heroes[seat];
  const v = Math.min(LIFE_MAX, Math.max(0, h.life + d));
  if (v === h.life) return s;
  x.ev.push({ type: 'life', seat, delta: v - h.life });
  return put(s, seat, { life: v });
};

const pj = (s: State, x: X, seat: number, d: number): State => {
  const h = s.heroes[seat];
  const v = Math.max(0, h.pj + d);
  if (v === h.pj) return s;
  x.ev.push({ type: 'pj', seat, delta: v - h.pj });
  return put(s, seat, { pj: v });
};

const zone = (s: State, x: X, seat: number, z: Partial<Hero> & { zone: Zone }, text: string): State => {
  x.ev.push({ type: 'zone', seat, zone: z.zone, text });
  return put(s, seat, z);
};

/** Строки «ПС +3» для карточки — из событий, случившихся после отметки mark. */
function linesSince(x: X, mark: number, seat: number): string[] {
  const out: string[] = [];
  const sign = (d: number) => (d > 0 ? `+${d}` : `−${-d}`);
  for (const e of x.ev.slice(mark)) {
    if (e.type === 'stat' && e.seat === seat) out.push(`${e.stat} ${sign(e.delta)}`);
    if (e.type === 'life' && e.seat === seat) out.push(`ПЖ ${sign(e.delta)}`);
    if (e.type === 'money' && e.seat === seat) out.push(`талеры ${sign(e.delta)}`);
    if (e.type === 'pj' && e.seat === seat) out.push(`ПЖ принца ${sign(e.delta)}`);
  }
  return out;
}

const show = (s: State, x: X, seat: number, mark: number, n: number | null, title: string, text: string): State => {
  const card: Shown = { n, title, text, lines: linesSince(x, mark, seat) };
  x.ev.push({ type: 'card', seat, card });
  return { ...s, phase: 'card', card };
};

/** Жизни кончились на поле 1: герой приходит в себя в лазарете с 1 ПЖ. */
function wounded(s: State, x: X, seat: number): State {
  const h = s.heroes[seat];
  if (h.zone !== 'world' && h.zone !== 'road') return s;
  if (h.life > 0) return s;
  let st = life(s, x, seat, 1);
  if (h.zone === 'road') {
    return zone(st, x, seat, { zone: 'world', cell: 31, node: 'fall' }, `${s.names[seat]}: жизни кончились — Провал выбросил назад в Мир Приключений.`);
  }
  st = zone(st, x, seat, { zone: 'world', cell: 18, sector: null }, `${s.names[seat]} без сил — очнулся в лазарете.`);
  return { ...st, log: [...st.log, `${s.names[seat]} без сил: очнулся в лазарете.`] };
}

// ---------- ход ----------

function pass(s: State, x: X): State {
  let st: State = { ...s, phase: 'roll', die: 0, card: null };
  let i = st.seats.indexOf(st.turn);
  for (let k = 0; k < st.seats.length * 3; k++) {
    i = (i + 1) % st.seats.length;
    const seat = st.seats[i];
    const h = st.heroes[seat];
    if (h.skip > 0) {
      st = put(st, seat, { skip: h.skip - 1 });
      x.ev.push({ type: 'skip', seat });
      continue;
    }
    st = { ...st, turn: seat };
    x.ev.push({ type: 'turn', seat });
    return st;
  }
  return { ...st, turn: st.seats[i] };
}

/** Слова-числа в текстах карточек. */
const NUM_WORDS: Record<string, number> = { один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6 };

/**
 * Действие карточки по её тексту: «возьми 2 ПУ», «теряешь 1ПС», «получи 5 талеров».
 * УПРОЩЕНИЕ ДЛЯ СБОРНИКА: боёв, предметов и ветвлений по кубику нет, поэтому берётся всё, что сказано
 * в тексте: прибавки (удвоены — в оригинале герой растёт ещё от предметов и друзей) и по первой потере
 * каждого вида (ПЖ — не больше одной); потеря характеристики не роняет её ниже единицы.
 */
function cardEffect(s: State, x: X, seat: number, text: string): State {
  let st = s;
  const t = text.replace(/\s+/g, ' ');
  const statOf = (w: string): Stat | null => (STATS as readonly string[]).find((k) => w.toUpperCase().startsWith(k)) as Stat | null;
  const num = (w: string): number => (/^\d+$/.test(w) ? Number(w) : (NUM_WORDS[w.toLowerCase()] ?? 1));
  const N = '(\\d+|один|одна|два|две|три|четыре|пять|шесть)\\s*(ПС|ПУ|ПМ|ПО|ПЖ|талер\\w*)';
  const add = new RegExp(`(возьми|возьмите|получи|получишь|прибавь)\\s+${N}`, 'gi');
  const lose = new RegExp(`(теряешь|потеряешь|отложи|отдай|лишаешься|заплати)\\s+${N}`, 'gi');
  const GAIN = 2;
  for (const m of t.matchAll(add)) {
    const n = Math.min(6, num(m[2])) * GAIN;
    const what = m[3].toUpperCase();
    if (what.startsWith('ПЖ')) st = life(st, x, seat, Math.ceil(n / 2));
    else if (what.startsWith('ТАЛЕР')) st = money(st, x, seat, n);
    else {
      const k = statOf(what);
      if (k) st = give(st, x, seat, k, n);
    }
  }
  const lost = new Set<string>();
  for (const m of t.matchAll(lose)) {
    const what = m[3].toUpperCase();
    const key = what.startsWith('ТАЛЕР') ? 'т' : what.slice(0, 2);
    if (lost.has(key)) continue;
    lost.add(key);
    // ПЖ карточка отнимает не больше одной — ветки боя здесь не разыгрываются
    const n = key === 'ПЖ' ? 1 : num(m[2]);
    if (what.startsWith('ПЖ')) st = life(st, x, seat, -n);
    else if (what.startsWith('ТАЛЕР')) st = money(st, x, seat, -n);
    else {
      const k = statOf(what);
      if (k) st = give(st, x, seat, k, -Math.min(n, Math.max(0, st.heroes[seat].st[k] - 1)));
    }
  }
  return st;
}

function draw(s: State, x: X, seat: number, rng: Rng, why = ''): State {
  let deck = s.deck;
  if (!deck.length) deck = shuffle(DECK.map((c) => c.n), rng);
  const [n, ...rest] = deck;
  const c = deckCard(n)!;
  const mark = x.ev.length;
  let st = cardEffect({ ...s, deck: rest }, x, seat, c.text);
  st = { ...st, log: [...st.log, `${s.names[seat]}${why}: «${c.title}»`] };
  // сначала карточка, потом (если ПЖ кончились) — лазарет
  st = show(st, x, seat, mark, n, c.title, c.text);
  return wounded(st, x, seat);
}

/** Пришёл на клетку поля 1 (ход кончился здесь). */
function arrive(s: State, x: X, seat: number, rng: Rng): State {
  const h = s.heroes[seat];
  const c = cell(h.cell);
  const name = c?.name ?? `клетка ${h.cell}`;
  const kind = kindOf(h.cell);
  const mark = x.ev.length;
  if (kind === 'door') {
    const r = rosetteOf(h.cell)!;
    let st = put(s, seat, { cell: r.cell, sector: 0 });
    x.ev.push({ type: 'sector', seat, cell: r.cell, sector: 0 });
    return show(st, x, seat, mark, null, r.name.toUpperCase(),
      r.cell === 25
        ? 'Ты должен бродить по храму, пока не выйдешь на поле «Лысая гора»: каждый ход бросай кубик и иди по кругу секторов; сектор 8 — выход.'
        : 'Ты должен идти через перевал, пока не выйдешь на поле «Крепость»: каждый ход бросай кубик и иди по кругу секторов; сектор 8 — выход.');
  }
  if (kind === 'exchange') {
    return { ...show(s, x, seat, mark, null, 'ОБМЕННЫЙ ПУНКТ',
      `Можешь купить характеристику за ${CELL_RULES.exchange.buyPrice} талеров или обменять 2 одной характеристики на 1 другой. Закончил — «Дальше».`), phase: 'shop' };
  }
  if (kind === 'hospital' || kind === 'office') {
    let st = s;
    if (kind === 'hospital') {
      // «бесплатно лечат только безумных (ПУ равны 0) и восстанавливают ПУ до 3»
      if (h.st['ПУ'] === 0) st = give(st, x, seat, 'ПУ', CELL_RULES.hospital.madRestorePu);
      const want = CELL_RULES.hospital.healTo - h.life;
      const can = Math.min(want, Math.floor(h.thalers / CELL_RULES.hospital.pricePerLife));
      if (can > 0) {
        st = money(st, x, seat, -can * CELL_RULES.hospital.pricePerLife);
        st = life(st, x, seat, can);
      }
      return show(st, x, seat, mark, null, 'ЛАЗАРЕТ', `Здесь лечат до ${CELL_RULES.hospital.healTo} ПЖ по ${CELL_RULES.hospital.pricePerLife} талера за ПЖ; безумных (ПУ 0) — бесплатно, с ПУ до 3.`);
    }
    // ЗАГОТКОНТОРА: здесь сдают шкуры и трофеи — их в этой версии нет, остановка просто отдых
    return show(st, x, seat, mark, null, 'ЗАГОТКОНТОРА', 'Здесь сдают шкуры и оружие врагов. Трофеев у тебя нет — отдохни и иди дальше.');
  }
  if (kind === 'fall') {
    const ready = STATS.every((k) => h.st[k] >= s.need) && h.items.length === 0;
    if (ready) {
      // «Выйдя из провала, отложи все свои ПО» — дорога поля 2 начинается у Провала
      let st = give(s, x, seat, 'ПО', -h.st['ПО']);
      st = zone(st, x, seat, { zone: 'road', node: 'fall' }, `${s.names[seat]} проходит через ${name} в Королевство Эмбер!`);
      st = { ...st, log: [...st.log, `${s.names[seat]} вышел в Королевство Эмбер.`] };
      return show(st, x, seat, mark, null, 'КОРОЛЕВСТВО ЭМБЕР',
        'Провал пропустил тебя. Дальше — дорога к столице по стрелкам: на развилках сворачиваешь по чётному или нечётному броску. Выйдя из провала, отложи все свои ПО.');
    }
    const lose: Stat = name.includes('МАГИИ') ? 'ПМ' : name.includes('СИЛЫ') ? 'ПС' : 'ПУ';
    const st = give(s, x, seat, lose, -1);
    return show(st, x, seat, mark, null, name,
      `Выйти в Эмбер можно, имея ${s.need} по всем характеристикам (ПС, ПУ, ПМ, ПО) и пустую котомку. Не вышел — теряешь 1 ${lose}.`);
  }
  if (kind === 'lyceum') {
    const d1 = 1 + rng.int(6);
    const d2 = 1 + rng.int(6);
    const sum = d1 + d2;
    x.ev.push({ type: 'roll', seat, die: sum, dice: [d1, d2] });
    // таблица с поля «Лицей»; на 4 — второй год (пропуск хода)
    const table: Record<number, [string, [Stat, number][]]> = {
      2: ['был бит розгами', [['ПС', -2]]],
      3: ['сошёл с ума', [['ПУ', -99]]],
      4: ['остался на второй год — пропусти ход', []],
      5: ['взял академический отпуск', [['ПУ', -2]]],
      6: ['отчислен', [['ПУ', -2], ['ПМ', -2]]],
      7: ['завалил сессию', [['ПС', -1], ['ПУ', -1], ['ПМ', -1]]],
      8: ['прослушал курс «История Мира»', [['ПУ', 2]]],
      9: ['прослушал курс прикладной магии', [['ПУ', 2], ['ПМ', 1]]],
      10: ['сдал курсовую', [['ПУ', 2], ['ПМ', 2]]],
      11: ['преддипломная практика', [['ПС', 2], ['ПУ', 2], ['ПМ', 2]]],
      12: ['закончил лицей', [['ПС', 2], ['ПУ', 2], ['ПМ', 2]]],
    };
    const [what, deltas] = table[sum];
    let st = s;
    for (const [k, d] of deltas) st = give(st, x, seat, k, d === -99 ? -st.heroes[seat].st[k] : d);
    if (sum === 4) st = put(st, seat, { skip: 1 });
    return show(st, x, seat, mark, null, 'ЛИЦЕЙ', `Дважды брось кубик: ${d1} и ${d2} — ${sum}: ${what}.`);
  }
  if (kind === 'meadow') {
    // ВЕДЬМИН ЛУГ и СВЯЩЕННАЯ РОЩА: добрые получают 1 ПЖ, затем карточка
    const st = life(s, x, seat, CELL_RULES.witchMeadow.goodLife);
    return draw(st, x, seat, rng, ` (${name})`);
  }
  return draw(s, x, seat, rng, ` (${name})`);
}

/** Шаг по кругу подполя. */
function inRosette(s: State, x: X, seat: number, die: number): State {
  const h = s.heroes[seat];
  const r = rosetteOf(h.cell)!;
  const sector = (((h.sector ?? 0) - 1 + die) % 8 + 8) % 8 + 1;
  x.ev.push({ type: 'sector', seat, cell: r.cell, sector });
  const mark = x.ev.length;
  let st = put(s, seat, { sector });
  if (sector === 8) {
    st = put(st, seat, { cell: r.exit, sector: null });
    x.ev.push({ type: 'step', seat, cell: r.exit });
    return show(st, x, seat, mark, null, `${r.name.toUpperCase()}: СЕКТОР 8`, `Выходишь на поле «${cell(r.exit)?.name ?? ''}».`);
  }
  const sec = r.sectors[sector - 1];
  for (const [k, d] of Object.entries(sec.st ?? {}) as [Stat, number][]) {
    if (d < 0 && sec.orLife && st.heroes[seat].st[k] < -d) st = life(st, x, seat, -1);
    else st = give(st, x, seat, k, d);
  }
  if (sec.life) st = life(st, x, seat, sec.life);
  if (sec.thalers) st = money(st, x, seat, sec.thalers);
  if (sec.swap) {
    const [a, b] = sec.swap;
    if (st.heroes[seat].st[a] > st.heroes[seat].st[b]) {
      st = give(st, x, seat, a, -1);
      st = give(st, x, seat, b, 1);
    }
  }
  return wounded(show(st, x, seat, mark, null, `${r.name.toUpperCase()}: СЕКТОР ${sector}`, sec.text), x, seat);
}

/** Ход по дороге поля 2: по стрелкам, развилки по чётности броска. */
function onRoad(s: State, x: X, seat: number, die: number): State {
  let st = s;
  let node = s.heroes[seat].node;
  for (let i = 0; i < die; i++) {
    const r = ROAD_BY_ID.get(node)!;
    const next = r.next ?? (die % 2 === 0 ? r.even! : r.odd!);
    if (next === 'capital') {
      st = put(st, seat, { node });
      const h = st.heroes[seat];
      st = zone(st, x, seat, { zone: 'capital', prince: true, pj: h.life + PRINCE_PJ }, `${s.names[seat]} приходит в столицу и становится Принцем Эмбера.`);
      x.ev.push({ type: 'pj', seat, delta: h.life + PRINCE_PJ });
      st = { ...st, log: [...st.log, `${s.names[seat]} стал Принцем Эмбера.`] };
      return st;
    }
    node = next;
    x.ev.push({ type: 'road', seat, node });
  }
  st = put(st, seat, { node });
  const r = ROAD_BY_ID.get(node)!;
  if (r.st && r.d) {
    // «Если у тебя не хватает ПС, ПУ или ПМ, чтобы выполнить условия поля, ты теряешь 1 ПЖ»
    if (r.d < 0 && st.heroes[seat].st[r.st] < -r.d) st = life(st, x, seat, -1);
    else st = give(st, x, seat, r.st, r.d);
    st = wounded(st, x, seat);
  }
  return st;
}

/** Поединок: раунды до последнего живого; в раунде каждый дважды бросает кубик, у кого меньше — теряет 1 ПЖ. */
function duel(s: State, x: X, seat: number, target: number, rng: Rng): State {
  let st = s;
  for (let round = 0; round < 60; round++) {
    const a: [number, number] = [1 + rng.int(6), 1 + rng.int(6)];
    const b: [number, number] = [1 + rng.int(6), 1 + rng.int(6)];
    const sa = a[0] + a[1];
    const sb = b[0] + b[1];
    // при равенстве оба набрали максимум — оба теряют по 1 ПЖ
    const lost = sa === sb ? [seat, target] : sa < sb ? [seat] : [target];
    x.ev.push({ type: 'duel', seat, target, a, b, lost });
    for (const l of lost) st = pj(st, x, l, -1);
    const pa = st.heroes[seat].pj;
    const pb = st.heroes[target].pj;
    if (pa <= 0 || pb <= 0) {
      for (const [who, p] of [[seat, pa], [target, pb]] as const) {
        if (p > 0) continue;
        const h = st.heroes[who];
        st = zone(st, x, who, { zone: 'capital', pj: h.life + PRINCE_PJ, room: 0, ring: 0, gate: null }, `${s.names[who]} пал на арене — снова в столицу, к колоде принцев.`);
      }
      // победитель возвращается в дворцовые покои
      if (pa > 0) st = zone(st, x, seat, { zone: 'chambers', room: 0 }, `${s.names[seat]} победил и уходит в дворцовые покои.`);
      return st;
    }
  }
  return st;
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.winner != null || seat !== s.turn) return null;
  const x: X = { ev: [] };
  const h = s.heroes[seat];
  const done = (st: State) => ({ state: st, events: x.ev });

  if (a.type === 'ok') {
    if (s.phase !== 'card' && s.phase !== 'shop') return null;
    return done(pass({ ...s, card: null }, x));
  }

  if (a.type === 'buyStat') {
    if (s.phase !== 'shop' || h.thalers < CELL_RULES.exchange.buyPrice || !STATS.includes(a.stat)) return null;
    let st = money(s, x, seat, -CELL_RULES.exchange.buyPrice);
    st = give(st, x, seat, a.stat, 1);
    return done(st);
  }
  if (a.type === 'exchange') {
    if (s.phase !== 'shop' || a.from === a.to || !STATS.includes(a.from) || !STATS.includes(a.to) || h.st[a.from] < 2) return null;
    let st = give(s, x, seat, a.from, -2);
    st = give(st, x, seat, a.to, 1);
    return done(st);
  }

  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    if (h.zone === 'world') {
      const die = 1 + rng.int(6);
      x.ev.push({ type: 'roll', seat, die });
      if (h.sector != null) return done(inRosette({ ...s, die }, x, seat, die));
      return done({ ...s, die, phase: 'pick' });
    }
    if (h.zone === 'road') {
      const die = 1 + rng.int(6);
      x.ev.push({ type: 'roll', seat, die });
      return done(pass(onRoad({ ...s, die }, x, seat, die), x));
    }
    if (h.zone === 'labyrinth') {
      const die = 1 + rng.int(6);
      x.ev.push({ type: 'roll', seat, die });
      const g = RINGS_PJ[Math.min(h.ring, 2)];
      const left = die >= 4;
      let st = pj(s, x, seat, left ? g.take : -g.give);
      const ring = h.ring + 1;
      st = put(st, seat, { ring, gate: left ? 'L' : 'R' });
      if (st.heroes[seat].pj <= 0) {
        st = zone(st, x, seat, { zone: 'capital', pj: h.life + PRINCE_PJ, ring: 0, gate: null }, `${s.names[seat]} сгинул в лабиринте — новый принц начинает из столицы.`);
      } else if (ring >= 3) {
        st = zone(st, x, seat, { zone: 'palace', ring: 0, gate: null }, `${s.names[seat]} дошёл до центра лабиринта и оказывается во дворце.`);
      } else {
        x.ev.push({ type: 'zone', seat, zone: 'labyrinth', text: left ? `Налево: возьми ${g.take} ПЖ.` : `Направо: отложи ${g.give} ПЖ.` });
      }
      return done(pass(st, x));
    }
    return null;
  }

  if (a.type === 'go') {
    if (s.phase !== 'pick' || h.zone !== 'world' || !Array.isArray(a.path)) return null;
    // путь: по соседям, без разворота, длиной в бросок или до клетки «проходом» / двери подполя
    if (!legalPath(h.cell, s.die, a.path)) return null;
    for (const c of a.path) x.ev.push({ type: 'step', seat, cell: c });
    const st0 = put({ ...s, phase: 'roll' }, seat, { cell: a.path[a.path.length - 1] });
    const st = arrive(st0, x, seat, rng);
    return done(st.phase === 'card' || st.phase === 'shop' ? st : pass(st, x));
  }

  // ---- поле 2 ----
  if (a.type === 'buyPj') {
    if (s.phase !== 'roll' || h.zone !== 'capital' || h.thalers < 20) return null;
    return done(pj(money(s, x, seat, -20), x, seat, 1));
  }
  if (a.type === 'exchangePj') {
    if (s.phase !== 'roll' || h.zone !== 'capital' || a.from === 'ПО' || !STATS.includes(a.from) || h.st[a.from] < 5) return null;
    return done(pj(give(s, x, seat, a.from, -5), x, seat, 1));
  }
  if (a.type === 'labyrinth') {
    if (s.phase !== 'roll' || h.zone !== 'capital') return null;
    // «При входе в Лабиринт у тебя не остаётся ничего, кроме ПЖ»
    let st = money(s, x, seat, -h.thalers);
    st = zone(st, x, seat, { zone: 'labyrinth', ring: 0, gate: null, items: [] }, `${s.names[seat]} входит в лабиринт: при себе только ПЖ.`);
    return done(pass(st, x));
  }
  if (a.type === 'climb') {
    if (s.phase !== 'roll') return null;
    if (h.zone === 'palace') {
      let st = zone(s, x, seat, { zone: 'chambers', room: 0 }, `${s.names[seat]} входит в дворцовые покои.`);
      st = pj(st, x, seat, ROOM_PJ[0]);
      return done(pass(st, x));
    }
    if (h.zone === 'chambers') {
      if (h.room >= 3) {
        x.ev.push({ type: 'zone', seat, zone: 'chambers', text: `${s.names[seat]} входит в тронный зал.` });
        x.ev.push({ type: 'over', winner: seat });
        return done({ ...s, winner: seat, phase: 'over', log: [...s.log, `${s.names[seat]} коронован — Владыка Королевства Эмбер.`] });
      }
      let st = zone(s, x, seat, { zone: 'chambers', room: h.room + 1 }, `${s.names[seat]} поднимается по покоям.`);
      st = pj(st, x, seat, ROOM_PJ[h.room + 1]);
      return done(pass(st, x));
    }
    return null;
  }
  if (a.type === 'challenge') {
    if (s.phase !== 'roll' || h.zone !== 'palace') return null;
    const t = s.heroes[a.target];
    if (!t || a.target === seat || t.zone !== 'chambers') return null;
    return done(pass(duel(s, x, seat, a.target, rng), x));
  }
  return null;
}

/** Законен ли путь: по проходам, без разворота (кроме тупика), длины броска или до клетки «проходом»/двери. */
export function legalPath(from: number, die: number, path: number[]): boolean {
  if (!path.length || path.length > die) return false;
  let at = from;
  let prev: number | null = null;
  for (let i = 0; i < path.length; i++) {
    const m = path[i];
    const nb = neighbours(at);
    if (!nb.includes(m)) return false;
    if (m === prev && nb.length > 1) return false;
    if (i < path.length - 1 && isDoor(m)) return false;
    prev = at;
    at = m;
  }
  return path.length === die || isDoor(at) || passStop(at);
}

/** Где фишка героя на поле 2 (пиксели field2.webp). */
export function place2(h: Hero): { x: number; y: number } {
  if (h.zone === 'road') return ROAD_BY_ID.get(h.node) ?? PLACES2.capital;
  if (h.zone === 'capital') return PLACES2.capital;
  if (h.zone === 'labyrinth') {
    if (!h.ring || !h.gate) return PLACES2.labyrinthIn;
    return (h.gate === 'L' ? PLACES2.ringL : PLACES2.ringR)[Math.min(h.ring, 3) - 1];
  }
  if (h.zone === 'palace') return PLACES2.palace;
  if (h.zone === 'chambers') return PLACES2.rooms[Math.min(3, h.room)];
  return PLACES2.throne;
}

/** Итог партии. */
export function result(s: State): { winner: number; text: string; scores: number[] } | null {
  if (s.winner == null) return null;
  const scores = s.seats.map((seat) => progress(s.heroes[seat], s.need));
  return { winner: s.winner, text: `${s.names[s.winner]} коронован — Владыка Королевства Эмбер.`, scores };
}

/** Насколько герой продвинулся к короне (для очков и ботов). */
export function progress(h: Hero, need: number): number {
  const order: Record<Zone, number> = { world: 0, road: 1000, capital: 2000, labyrinth: 3000, palace: 4000, chambers: 5000 };
  if (h.zone === 'world') return STATS.reduce((sum, k) => sum + Math.min(need, h.st[k]), 0) * 10 + h.life;
  return order[h.zone] + h.ring * 100 + h.room * 100 + h.pj;
}

// ---------- бот ----------

/** Действие бота. Видит то же, что игрок: вся информация «Короны» открыта, кроме порядка колоды. */
export function botAction(s: State, seat: number, level: number, rng?: Rng): Action | null {
  if (s.winner != null || seat !== s.turn) return null;
  const h = s.heroes[seat];
  const rnd = (n: number) => (rng ? rng.int(n) : 0);
  if (s.phase === 'card') return { type: 'ok' };
  if (s.phase === 'shop') {
    const sorted = [...STATS].sort((a, b) => h.st[a] - h.st[b]);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (h.st[low] < s.need) {
      if (h.thalers >= CELL_RULES.exchange.buyPrice) return { type: 'buyStat', stat: low };
      if (h.st[high] >= s.need + 2) return { type: 'exchange', from: high, to: low };
    }
    return { type: 'ok' };
  }
  if (s.phase === 'pick') {
    const opts = [...routes(h.cell, s.die).entries()];
    if (!opts.length) return null;
    const ready = STATS.every((k) => h.st[k] >= s.need);
    if (level === 0) {
      // лёгкий бродит наугад, но мимо открытого Провала не пройдёт
      const fall = ready ? opts.find((o) => kindOf(o[0]) === 'fall') : undefined;
      return { type: 'go', path: (fall ?? opts[rnd(opts.length)])[1] };
    }
    const weak = STATS.some((k) => h.st[k] === 0) || h.life <= 1;
    const want = (n: number): number => {
      const k = kindOf(n);
      if (ready) return k === 'fall' ? 100 : 0;
      if (weak && k === 'hospital') return 60;
      if (k === 'exchange' && h.thalers >= CELL_RULES.exchange.buyPrice * 2) return 40;
      if (k === 'lyceum') return 30;
      if (k === 'meadow') return 20;
      if (k === 'door') return level >= 2 ? -10 : 0;
      if (k === 'plain') return 12;
      return 2;
    };
    // цель на будущее: ближайшая желанная клетка — оцениваем конечную точку по расстоянию до неё
    const goals = ready ? [22, 31, 54] : weak ? [18] : h.thalers >= 10 ? [1, 2] : [8];
    let best = opts[0];
    let bs = -Infinity;
    for (const o of opts) {
      const d = distances(o[0]);
      const far = Math.min(...goals.map((g) => d.get(g) ?? 99));
      const sc = want(o[0]) - far * (level >= 2 ? 3 : 1) + rnd(4);
      if (sc > bs) {
        bs = sc;
        best = o;
      }
    }
    return { type: 'go', path: best[1] };
  }
  if (s.phase !== 'roll') return null;
  if (h.zone === 'capital') {
    if (h.thalers >= 20 && level > 0) return { type: 'buyPj' };
    const rich = (['ПС', 'ПУ', 'ПМ'] as Stat[]).find((k) => h.st[k] >= 5);
    if (rich && level > 0 && h.pj < 9) return { type: 'exchangePj', from: rich };
    return { type: 'labyrinth' };
  }
  if (h.zone === 'palace') {
    // вызывать стоит того, кто близко к трону, если ПЖ хватает
    const rivals = s.seats.filter((o) => o !== seat && s.heroes[o].zone === 'chambers');
    const t = rivals.sort((a, b) => s.heroes[b].room - s.heroes[a].room)[0];
    if (t != null && level > 0 && (h.pj >= s.heroes[t].pj || s.heroes[t].room >= 2)) return { type: 'challenge', target: t };
    return { type: 'climb' };
  }
  if (h.zone === 'chambers') return { type: 'climb' };
  return { type: 'roll' };
}

/** Что сейчас можно сделать (для подсказок вида). */
export const status = (s: State) => ({ seat: s.turn, phase: s.phase, die: s.die });
