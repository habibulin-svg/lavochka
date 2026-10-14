/* Бот «Звезды Африки»: идёт по кратчайшей дороге к ближайшей цели. Без алмаза — к закрытым жетонам
 * (дошёл до квадрата — останавливается и открывает), с алмазом — к Танжеру или Каиру (обходя открытых
 * разбойников), а разбойник-соперник охотится за владельцем алмаза. Видит только своё view: что лежит
 * под закрытыми жетонами, ему неизвестно. */
import type { Rng } from '../../core/types';
import {
  AIR, AIR_FEE, CELLS, EDGE, FINISH, HALT_AT, NEIGH, OPEN_FEE, PORT, SEA_FEE, START, TOKEN_AT,
  canStep, openable, robberOpen,
  type Action, type State,
} from './engine';

/** Кратчайший путь по числу переходов: расстояния и «откуда пришли» (граф небольшой — считаем по надобности). */
interface Paths {
  dist: number[];
  from: number[];
}
const cache = new Map<string, Paths>();
type Block = (cell: number) => boolean;
/** Без денег из порта в море не выйти: такие рёбра для поиска пути закрыты. */
let broke = false;
const seaFromPort = (from: number, to: number) => PORT[from] && EDGE[from][NEIGH[from].indexOf(to)] === 'sea';

function paths(goal: number, block?: Block): Paths {
  const key = `${goal}:${broke ? 1 : 0}`;
  if (!block) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const dist = CELLS.map(() => -1);
  const from = CELLS.map(() => -1);
  const q = [goal];
  dist[goal] = 0;
  for (let i = 0; i < q.length; i++) {
    for (const n of NEIGH[q[i]]) {
      if (dist[n] < 0 && !(block && block(n) && n !== goal) && !(broke && seaFromPort(n, q[i]))) {
        dist[n] = dist[q[i]] + 1;
        from[n] = q[i];
        q.push(n);
      }
    }
  }
  const p = { dist, from };
  if (!block) cache.set(key, p);
  return p;
}

/** Открытые разбойники: владельцу алмаза через них нельзя. */
const blockedFor = (v: State, seat: number): Block | undefined =>
  v.diamond === seat ? (c: number) => robberOpen(v, c) : undefined;

const closedTokens = (v: State) => CELLS.map((_, i) => i).filter((i) => TOKEN_AT[i] && !v.open[i]);

/** Куда идти: финиш с алмазом, брошенный алмаз, владелец алмаза (для разбойника) или закрытые жетоны. */
function goals(v: State, seat: number): number[] {
  if (v.diamond === seat) return FINISH.slice();
  if (v.diamondSite >= 0) return [v.diamondSite];
  if (v.bandit[seat]) return v.diamond >= 0 ? [v.pos[v.diamond]] : closedTokens(v);
  // алмаз найден: стать разбойником (через открытого разбойника) и догнать владельца
  if (v.diamond >= 0) {
    const robbers = CELLS.map((_, i) => i).filter((i) => robberOpen(v, i));
    if (robbers.length) return robbers;
    const closed = closedTokens(v);
    return closed.length ? closed : [v.pos[v.diamond]];
  }
  return closedTokens(v);
}

function goalFor(v: State, seat: number, cell: number, block?: Block): number {
  let best = -1;
  let bestD = 999;
  for (const g of goals(v, seat)) {
    const d = paths(g, block).dist[cell];
    // d = 0 — цель уже под нами: искать нечего, иначе фишка застынет на месте
    if (d > 0 && d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** Первый шаг по кратчайшей дороге к цели: в поиске от цели «откуда пришли» и есть дорога назад. */
function stepTo(goal: number, cell: number, block?: Block): number {
  const { from, dist } = paths(goal, block);
  if (dist[cell] <= 0) return -1; // уже на месте (или цель недостижима)
  return from[cell];
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.winner != null) return null;
  // начало партии: откуда начинать — Танжер или Каир. Лёгкий выбирает наугад, остальные — из Танжера
  if (v.phase === 'start') return { type: 'start', at: level > 0 ? START : FINISH[rng.int(FINISH.length)] };
  const owner = v.diamond === seat;
  broke = v.money[seat] < SEA_FEE && !v.served[seat];
  if (v.phase === 'open') {
    // пройденные жетоны за 100: средний и сложный открывают, пока риск потерять деньги невелик
    const can = openable(v);
    if (level > 0 && !owner && can.length && v.money[seat] >= OPEN_FEE && v.money[seat] <= (level > 1 ? 700 : 400)) {
      return { type: 'open', cell: can[0] };
    }
    return { type: 'stop' };
  }
  if (v.phase === 'roll') {
    if (v.horses[seat] > 0 && level > 0) {
      // без денег подкову меняют на 100 (на выход в море), иначе сложный берёт лишний ход
      if (v.money[seat] < SEA_FEE) return { type: 'horse', use: 'money' };
      if (level > 1) return { type: 'horse', use: 'move' };
    }
    // сложный бот может срезать путь самолётом
    if (level > 1) {
      const fly = wantAir(v, seat);
      if (fly != null) return { type: 'air', to: fly };
    }
    return { type: 'roll' };
  }
  if (v.phase !== 'step' || v.left <= 0) return { type: 'stop' };
  const here = v.pos[seat];
  const moved = v.left < v.die;
  // дошёл до закрытого жетона — встаём и открываем (владельцу алмаза некогда, разбойник охотится)
  if (moved && TOKEN_AT[here] && !v.open[here] && !owner && !v.bandit[seat]) return { type: 'stop' };
  const ns = NEIGH[here].filter((_, k) => canStep(v, seat, here, k));
  if (!ns.length) return { type: 'stop' };
  // лёгкий бот нет-нет да и забредёт наугад — так он и остаётся лёгким
  if (level === 0 && rng.int(3) === 0) return { type: 'step', to: ns[rng.int(ns.length)] };
  const block = blockedFor(v, seat);
  const goal = goalFor(v, seat, here, block);
  const next = goal >= 0 ? stepTo(goal, here, block) : -1;
  // цели нет или шаг туда закрыт (нет денег на море, разбойник) — идём куда-нибудь, чтобы партия не застыла
  if (next < 0 || !ns.includes(next)) return { type: 'step', to: ns[rng.int(ns.length)] };
  // сложный не встаёт последним шагом на обведённый кружок (пропуск хода)
  if (level > 1 && v.left === 1 && HALT_AT[next] && moved) return { type: 'stop' };
  return { type: 'step', to: next };
}

/** Стоит ли лететь: сложный бот сравнивает путь по земле и по воздуху. */
export function wantAir(v: State, seat: number): number | null {
  if (v.phase !== 'roll' || v.money[seat] < AIR_FEE + (v.diamond === seat ? 0 : 200)) return null;
  broke = false;
  const here = v.pos[seat];
  const block = blockedFor(v, seat);
  const goal = goalFor(v, seat, here, block);
  if (goal < 0) return null;
  const p = paths(goal, block);
  const own = p.dist[here];
  let best: number | null = null;
  // лететь есть смысл, если так выходит заметно короче (кубик в среднем — 3,5 шага)
  let bestD = own - 4;
  for (const to of AIR[here]) {
    if (v.diamond === seat && robberOpen(v, to)) continue;
    if (to === goal) return to; // перелёт прямо в цель
    const d = p.dist[to];
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = to;
    }
  }
  return best;
}
