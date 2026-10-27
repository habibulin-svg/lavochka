/* «Поездом по СССР» — боты. Видят только свой view: руку, свои маршруты, открытые карты и поле.
 * Лёгкий — берёт маршруты наугад и строит, что получается; средний — кратчайшие пути к своим маршрутам, нужные цвета, новые маршруты,
 * когда старые готовы; сложный — ещё и выбор маршрутов с общими путями (перебор наборов) и тяга к длинным путям, а ходит как средний. */
import type { Rng } from '../../core/types';
import { CITIES, ROUTES } from './board';
import { CTRL, LOCO, TICKETS } from './data';
import { anyMove, canDrawDeck, canDrawOpen, connected, payOptions, routeColor, routeOpen, stationOptions, tunnelPayable, type Action, type State } from './engine';

const INF = 1e9;

/** Цена пути для игрока: свои — 0, свободные — длина (тоннель и паром дороже), чужие — нельзя (кроме одного «по станции»). */
let LONG_BIAS = 0;
function edgeCost(v: State, seat: number, r: number, viaStation: boolean): number {
  const o = v.owner[r];
  if (o === seat) return 0;
  if (o != null) return viaStation ? 0.5 : INF;
  if (!routeOpen({ ...v, wagons: v.wagons.map(() => 99) }, seat, r)) return INF;
  const R = ROUTES[r];
  return R.len + (R.tunnel ? 0.6 : 0) + R.ferry * 0.8 - LONG_BIAS * Math.max(0, R.len - 2) * 0.25;
}

/** Кратчайший путь между городами: пути и цена (с allowOne — можно пройти один чужой путь, для станции). */
export function shortest(v: State, seat: number, a: number, b: number, allowOne = false): { cost: number; routes: number[] } {
  const N = CITIES.length;
  // состояние: город × использован ли чужой путь
  const L = allowOne ? 2 : 1;
  const dist = new Array(N * L).fill(INF);
  const prev: [number, number][] = new Array(N * L).fill(null as unknown as [number, number]);
  const done = new Array(N * L).fill(false);
  dist[a] = 0;
  for (;;) {
    let u = -1;
    let best = INF;
    for (let i = 0; i < N * L; i++)
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    if (u < 0) break;
    done[u] = true;
    const c = u % N;
    const used = u >= N ? 1 : 0;
    if (c === b) break;
    for (let r = 0; r < ROUTES.length; r++) {
      const R = ROUTES[r];
      if (R.a !== c && R.b !== c) continue;
      const d = R.a === c ? R.b : R.a;
      const theirs = v.owner[r] != null && v.owner[r] !== seat;
      if (theirs && (!allowOne || used)) continue;
      const w = edgeCost(v, seat, r, theirs);
      if (w >= INF) continue;
      const to = d + (theirs ? N : used * N);
      if (dist[u] + w < dist[to]) {
        dist[to] = dist[u] + w;
        prev[to] = [u, r];
      }
    }
  }
  let end = b;
  if (allowOne && dist[b + N] < dist[b]) end = b + N;
  if (dist[end] >= INF) return { cost: INF, routes: [] };
  const routes: number[] = [];
  for (let x = end; x !== a; x = prev[x][0]) routes.push(prev[x][1]);
  return { cost: dist[end], routes };
}

const mineRoutes = (v: State, seat: number) => ROUTES.map((_, i) => i).filter((i) => v.owner[i] === seat);

/** Нужные пути для невыполненных маршрутов (самые дорогие маршруты — первыми). */
function needed(v: State, seat: number): { routes: number[]; blocked: number[]; open: number[] } {
  const mine = mineRoutes(v, seat);
  const tickets = (v.tickets[seat] ?? []).filter((t) => !connected(mine, TICKETS[t].a, TICKETS[t].b));
  tickets.sort((x, y) => TICKETS[y].pts - TICKETS[x].pts);
  const routes = new Set<number>();
  const blocked: number[] = [];
  for (const t of tickets) {
    const p = shortest(v, seat, TICKETS[t].a, TICKETS[t].b);
    if (p.cost >= INF) blocked.push(t);
    else for (const r of p.routes) if (v.owner[r] == null) routes.add(r);
  }
  return { routes: [...routes], blocked, open: tickets };
}

/** Сколько вагончиков стоит маршрут при уже построенных путях. */
function ticketCost(v: State, seat: number, t: number, extra: number[] = []): number {
  const vv = extra.length ? { ...v, owner: v.owner.map((o, i) => (extra.includes(i) ? seat : o)) } : v;
  return shortest(vv, seat, TICKETS[t].a, TICKETS[t].b).cost;
}

function chooseKeep(v: State, seat: number, level: number, rng: Rng, start: boolean): number[] {
  const offer = v.offer[seat] ?? [];
  if (level === 0) {
    if (start) {
      const l = offer.filter((t) => TICKETS[t].long);
      const s = offer.filter((t) => !TICKETS[t].long);
      return [l[rng.int(l.length)], s[rng.int(s.length)]];
    }
    return [offer[rng.int(offer.length)]];
  }
  const left = v.wagons[seat];
  // сложный: перебор подмножеств — общие пути дешевле
  const subsets: number[][] = [];
  for (let m = 1; m < 1 << offer.length; m++) subsets.push(offer.filter((_, i) => m & (1 << i)));
  let best: number[] = [];
  let bestV = -INF;
  for (const sub of subsets) {
    if (start && (!sub.some((t) => TICKETS[t].long) || !sub.some((t) => !TICKETS[t].long))) continue;
    let built: number[] = [];
    let cost = 0;
    let pts = 0;
    for (const t of [...sub].sort((x, y) => TICKETS[y].pts - TICKETS[x].pts)) {
      const vv = { ...v, owner: v.owner.map((o, i) => (built.includes(i) ? seat : o)) };
      const p = shortest(vv, seat, TICKETS[t].a, TICKETS[t].b);
      if (p.cost >= INF) {
        cost += 99;
        continue;
      }
      cost += level === 2 ? p.cost : ticketCost(v, seat, t);
      built = [...built, ...p.routes];
      pts += TICKETS[t].pts;
    }
    const budget = start ? left - (level === 2 ? 16 : 8) : left - (level === 2 ? 10 : 6);
    const over = Math.max(0, cost - budget);
    const val = pts * 1.6 - cost * (level === 2 && !start ? 1.15 : 0.9) - over * (level === 2 ? 9 : 6) - sub.length * (start ? 0 : level === 2 ? 2.5 : 1.5);
    if (val > bestV) {
      bestV = val;
      best = sub;
    }
  }
  if (!best.length) {
    if (start) {
      const l = offer.filter((t) => TICKETS[t].long);
      const s = offer.filter((t) => !TICKETS[t].long);
      return [l[0], s[0]];
    }
    best = [offer.reduce((a, b) => (ticketCost(v, seat, a) <= ticketCost(v, seat, b) ? a : b))];
  }
  return best;
}

/** Самый удобный способ оплаты: меньше локомотивов, по цвету — где карт больше всего (останется меньше «лишних»). */
function bestPay(v: State, seat: number, r: number, keep: Set<number>): { color: number; locos: number } | null {
  const opts = payOptions(v, seat, r);
  if (!opts.length) return null;
  const h = v.hand[seat]!;
  opts.sort((x, y) => x.locos - y.locos || (keep.has(x.color) ? 1 : 0) - (keep.has(y.color) ? 1 : 0) || (x.color < 0 ? 1 : 0) - (y.color < 0 ? 1 : 0) || h[y.color] - h[x.color]);
  return opts[0];
}

/** Какие цвета нужны для оставшихся путей (цветные — свой цвет, серые — любой). */
function wantColors(v: State, seat: number, routes: number[]): Map<number, number> {
  const want = new Map<number, number>();
  const h = v.hand[seat]!;
  for (const r of routes) {
    const c = routeColor(r);
    if (c >= 0) want.set(c, (want.get(c) ?? 0) + ROUTES[r].len);
  }
  for (const [c, n] of want) want.set(c, Math.max(0, n - h[c]));
  return want;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const h = v.hand[seat];
  if (!h) return null;
  LONG_BIAS = level === 2 ? 1 : 0;
  if (v.phase === 'start') return { type: 'keep', keep: chooseKeep(v, seat, level, rng, true) };
  if (v.phase === 'tickets') return { type: 'keep', keep: chooseKeep(v, seat, level, rng, false) };
  // дальше сложный ходит как средний: его особые ходы (контролёр «по-крупному», станции, осторожность с тоннелями, ранняя
  // спешка в конце) партиями не окупились — 18:22 против среднего; с игрой среднего и своим выбором маршрутов — 24:16
  if (level === 2) level = 1;
  if (v.phase === 'tunnel') return { type: 'tunnel', pay: tunnelPayable(v, seat) && (level > 0 || rng.next() < 0.7) };
  const need = needed(v, seat);
  const endgame = v.finalLeft != null || v.wagons.some((w) => w <= 6);
  if (v.phase === 'second') return drawCard(v, seat, level, rng, need.routes, true);

  const keepColors = new Set<number>();
  for (const r of need.routes) if (routeColor(r) >= 0) keepColors.add(routeColor(r));

  // лёгкий: строит любой нужный путь, иначе тянет карты; иногда — случайный путь
  if (level === 0) {
    const can = need.routes.filter((r) => routeOpen(v, seat, r) && payOptions(v, seat, r).length);
    if (can.length) {
      const r = can[rng.int(can.length)];
      return { type: 'claim', route: r, ...bestPay(v, seat, r, keepColors)! };
    }
    if (!need.open.length && v.tdeckN && v.wagons[seat] > 15 && rng.next() < 0.5) return { type: 'tickets' };
    if (!canDrawDeck(v) && ![0, 1, 2, 3, 4].some((i) => canDrawOpen(v, i))) return fallback(v, seat);
    if (rng.next() < 0.15 || !need.routes.length) {
      const any = ROUTES.map((_, i) => i).filter((r) => routeOpen(v, seat, r) && payOptions(v, seat, r).length && ROUTES[r].len >= 3);
      if (any.length && (v.handN[seat] > 10 || !need.routes.length)) {
        const r = any[rng.int(any.length)];
        return { type: 'claim', route: r, ...bestPay(v, seat, r, keepColors)! };
      }
    }
    return drawCard(v, seat, level, rng, need.routes, false);
  }

  // контролёр: построить свой нужный путь (до 4 вагончиков) даром или разобрать мешающий
  if (h[CTRL] > 0) {
    const free = need.routes.filter((r) => ROUTES[r].len <= 4 && routeOpen(v, seat, r)).sort((a, b) => ROUTES[b].len + (ROUTES[b].tunnel ? 2 : 0) + ROUTES[b].ferry * 2 - (ROUTES[a].len + (ROUTES[a].tunnel ? 2 : 0) + ROUTES[a].ferry * 2));
    if (free.length) return { type: 'ctrl', route: free[0], mode: 'build' };
  }

  // строить нужный путь: длинные и «спорные» (мало обходов) — раньше
  const can = need.routes.filter((r) => routeOpen(v, seat, r) && payOptions(v, seat, r).length);
  if (can.length) {
    const score = (r: number) => ROUTES[r].len * 2 + rng.next();
    // средний не тратит много локомотивов на короткие пути, пока карт мало
    can.sort((a, b) => score(b) - score(a));
    for (const r of can) {
      const pay = bestPay(v, seat, r, keepColors)!;
      if (level === 1 && pay.locos > 1 && ROUTES[r].len <= 2 && !endgame) continue;
      return { type: 'claim', route: r, ...pay };
    }
  }

  // маршруты выполнены — новые или очки за длинные пути
  if (!need.open.length) {
    if (!endgame && v.tdeckN && v.wagons[seat] >= 18) return { type: 'tickets' };
    const any = ROUTES.map((_, i) => i).filter((r) => routeOpen(v, seat, r) && payOptions(v, seat, r).length);
    any.sort((a, b) => ROUTES[b].len - ROUTES[a].len);
    if (any.length && (ROUTES[any[0]].len >= 4 || endgame || v.handN[seat] > 12)) return { type: 'claim', route: any[0], ...bestPay(v, seat, any[0], keepColors)! };
  }

  // в конце партии — всё, что можно построить, пока не поздно
  if (endgame) {
    const any = ROUTES.map((_, i) => i).filter((r) => routeOpen(v, seat, r) && payOptions(v, seat, r).length);
    any.sort((a, b) => (need.routes.includes(b) ? 10 : 0) + ROUTES[b].len - (need.routes.includes(a) ? 10 : 0) - ROUTES[a].len);
    if (any.length && (v.finalLeft != null || ROUTES[any[0]].len >= 3)) return { type: 'claim', route: any[0], ...bestPay(v, seat, any[0], keepColors)! };
  }

  if (canDrawDeck(v) || [0, 1, 2, 3, 4].some((i) => canDrawOpen(v, i))) return drawCard(v, seat, level, rng, need.routes, false);
  return fallback(v, seat);
}

function fallback(v: State, seat: number): Action {
  const any = ROUTES.map((_, i) => i).filter((r) => routeOpen(v, seat, r) && payOptions(v, seat, r).length);
  if (any.length) {
    any.sort((a, b) => ROUTES[b].len - ROUTES[a].len);
    return { type: 'claim', route: any[0], ...payOptions(v, seat, any[0])[0] };
  }
  if (v.tdeckN && v.phase === 'act') return { type: 'tickets' };
  if (v.cfg.stations && v.stations[seat] > 0)
    for (let c = 0; c < CITIES.length; c++) {
      const o = stationOptions(v, seat, c);
      if (o.length) return { type: 'station', city: c, ...o[0] };
    }
  if (v.hand[seat]![CTRL] > 0) {
    const r = ROUTES.findIndex((R, i) => R.len <= 4 && routeOpen(v, seat, i));
    if (r >= 0) return { type: 'ctrl', route: r, mode: 'build' };
  }
  if (!anyMove(v, seat)) return { type: 'pass' };
  return { type: 'pass' };
}

function drawCard(v: State, seat: number, level: number, rng: Rng, routes: number[], second: boolean): Action {
  const want = wantColors(v, seat, routes);
  const h = v.hand[seat]!;
  // серые пути: копим цвет, которого больше всего
  const grayNeed = routes.filter((r) => routeColor(r) < 0).reduce((a, r) => a + ROUTES[r].len, 0);
  let grayColor = -1;
  if (grayNeed) {
    let m = -1;
    for (let c = 0; c < 8; c++)
      if (h[c] > m) {
        m = h[c];
        grayColor = c;
      }
  }
  const slots = [0, 1, 2, 3, 4].filter((i) => canDrawOpen(v, i));
  if (level > 0) {
    let best = -1;
    let bestV = 0;
    for (const i of slots) {
      const c = v.open[i];
      let val = 0;
      if (c === LOCO) val = 0;
      else if ((want.get(c) ?? 0) > 0) val = 2 + Math.min(3, want.get(c)!) * 0.3;
      else if (c === grayColor) val = 1.2;
      if (val > bestV) {
        bestV = val;
        best = i;
      }
    }
    if (best >= 0 && (bestV > 1.1 || !canDrawDeck(v))) return { type: 'draw', slot: best };
  } else if (slots.length && rng.next() < 0.4) {
    const ok = slots.filter((i) => v.open[i] !== LOCO);
    if (ok.length) return { type: 'draw', slot: ok[rng.int(ok.length)] };
  }
  if (canDrawDeck(v)) return { type: 'draw', slot: -1 };
  return { type: 'draw', slot: slots.find((i) => v.open[i] !== LOCO) ?? slots[0] };
}


