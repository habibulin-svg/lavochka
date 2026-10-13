/* Бот «Звезды Африки»: идёт по кратчайшей дороге к ближайшей цели. Без алмаза — к закрытым жетонам,
 * с алмазом — к Танжеру или Каиру (обходя открытых разбойников), а сам разбойник-соперник охотится
 * за владельцем алмаза. Видит только своё view: что лежит под закрытыми жетонами, ему неизвестно. */
import type { Rng } from '../../core/types';
import { AIR, CELLS, FINISH, NEIGH, TOKEN_AT, type Action, type State } from './engine';

/** Кратчайший путь по числу переходов: расстояния и «откуда пришли» (граф небольшой — считаем по надобности). */
interface Paths {
  dist: number[];
  from: number[];
}
const cache = new Map<number, Paths>();
type Block = (cell: number) => boolean;

function paths(goal: number, block?: Block): Paths {
  if (!block) {
    const hit = cache.get(goal);
    if (hit) return hit;
  }
  const dist = CELLS.map(() => -1);
  const from = CELLS.map(() => -1);
  const q = [goal];
  dist[goal] = 0;
  for (let i = 0; i < q.length; i++) {
    for (const n of NEIGH[q[i]]) {
      if (dist[n] < 0 && !(block && block(n) && n !== goal)) {
        dist[n] = dist[q[i]] + 1;
        from[n] = q[i];
        q.push(n);
      }
    }
  }
  const p = { dist, from };
  if (!block) cache.set(goal, p);
  return p;
}

/** Открытые разбойники: владельцу алмаза через них нельзя. */
const blockedFor = (v: State, seat: number): Block => (c: number) =>
  v.diamond === seat && v.open[c] && v.tokens[c] === 'robber';

function closedTokens(v: State): number[] {
  return CELLS.map((_, i) => i).filter((i) => TOKEN_AT[i] && !v.open[i]);
}

/** Куда идти: финиш с алмазом, брошенный алмаз, владелец алмаза (для разбойника) или закрытые жетоны. */
function goalFor(v: State, seat: number, cell: number, block: Block): number {
  const goals = v.diamond === seat
    ? FINISH.slice()
    : v.diamondSite >= 0
      ? [v.diamondSite]
      : v.bandit[seat]
        ? v.diamond >= 0
          ? [v.pos[v.diamond]]
          : []
        : v.diamond >= 0
          ? CELLS.map((_, i) => i).filter((i) => TOKEN_AT[i] && v.open[i] && v.tokens[i] === 'robber').concat(closedTokens(v))
          : closedTokens(v);
  let best = -1;
  let bestD = 999;
  for (const g of goals) {
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
function stepTo(goal: number, cell: number, block: Block): number {
  const { from, dist } = paths(goal, block);
  if (dist[cell] <= 0) return -1; // уже на месте (или цель недостижима)
  return from[cell] >= 0 ? from[cell] : -1;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.winner != null) return null;
  if (v.phase === 'roll') {
    // сложный бот может срезать путь самолётом
    if (level > 1) {
      const fly = wantAir(v, seat);
      if (fly != null) return { type: 'air', to: fly };
    }
    // подкову тратим: лёгкий — на деньги, средний и сложный — на лишний бросок
    if (v.horses[seat] > 0 && level > 0) return { type: 'horse', use: level > 1 ? 'move' : 'money' };
    return { type: 'roll' };
  }
  if (v.phase !== 'step' || v.left <= 0) return { type: 'stop' };
  const block = blockedFor(v, seat);
  // пройденный жетон можно открыть за 100: идём на это, пока денег немного (разбойник не так страшен)
  if (level > 1 && v.diamond !== seat) {
    const passed = v.passed.filter((c) => TOKEN_AT[c] && !v.open[c]);
    if (passed.length && v.money[seat] <= 250) return { type: 'open', cell: passed[0] };
  }
  const here = v.pos[seat];
  const ns = NEIGH[here].filter((n) => !block(n));
  if (!ns.length) return { type: 'stop' };
  // лёгкий бот нет-нет да и забредёт наугад — так он и остаётся лёгким
  if (level === 0 && rng.int(3) === 0) return { type: 'step', to: ns[rng.int(ns.length)] };
  const goal = goalFor(v, seat, here, block);
  const next = goal >= 0 ? stepTo(goal, here, block) : -1;
  // цели нет или она недостижима (например, владельцу алмаза перекрыли дорогу разбойники) —
  // всё равно идём куда-нибудь, чтобы партия не застыла на месте
  if (next < 0 || !ns.includes(next)) return { type: 'step', to: ns[rng.int(ns.length)] };
  return { type: 'step', to: next };
}

/** Стоит ли лететь: сложный бот сравнивает путь по земле и по воздуху. */
export function wantAir(v: State, seat: number): number | null {
  if (v.phase !== 'roll' || v.money[seat] < 300) return null;
  const here = v.pos[seat];
  const block = blockedFor(v, seat);
  const here_goal = goalFor(v, seat, here, block);
  if (here_goal < 0) return null;
  const own = paths(here_goal, block).dist[here];
  let best: number | null = null;
  let bestD = own;
  for (const to of AIR[here]) {
    if (to === here_goal) return to; // перелёт прямо в цель
    const d = paths(here_goal, block).dist[to] + 1;
    if (d < bestD) {
      bestD = d;
      best = to;
    }
  }
  return best;
}
