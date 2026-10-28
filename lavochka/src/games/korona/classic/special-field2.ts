/**
 * «Корона Эмбера», «Классика 1994» — поле 2 «Королевство Эмбер»: дорога в столицу, столица и лавка, лабиринт,
 * дворцовые покои, арена, коронация и битва за корону (книга правил: «Эмбер …», «Столица», «Лабиринт», «Дворец»,
 * «Коронация», «Битва за корону»; тексты на поле — docs/analysis/korona/src/field2.json). Подключается
 * побочным импортом (`import './special-field2'`): регистрирует `SPECIAL.field2`, `SPECIAL.enterRoad` и ответы
 * `SPECIAL['answer:f2…']`.
 *
 * Где стоит путник (`CHero`):
 *  - `zone: 'road'`, `node` — клетка дороги (`ROAD_BY_ID`; 'fall' — выход из Провала, 'capital' — в столице);
 *  - `zone: 'capital'` — в столице (лавка, выбор: Провал назад или Лабиринт);
 *  - `zone: 'labyrinth'` — `ring` 0..2 — кольцо, которое пройдёт следующим ходом (0 — внешнее), `gate` — сторона
 *    последнего круга ('L' — взял ПЖ, 'R' — отдал);
 *  - `zone: 'chambers'` — дворцовые покои, `room` 0..4 (0 — у входа, 1..4 — клетки покоев снизу вверх);
 *  - `zone: 'arena'` — на арене (король — тоже), `prince` — номер карты принца в PRINCES.
 * Дополнительных полей состояния нет: бросок раунда на арене переходит от игрока к игроку в `prompt.data`,
 * «один раунд за ход» — по метке в `lastPath` (`[-раунд партии]`).
 */
import { ROAD_BY_ID, ROOM_PJ, RINGS_PJ } from '../data';
import { ADV } from './cards';
import { PRINCES, TRAVELLERS, cellName } from './data';
import { TROPHIES, advOf, ask, bump, dropThing, H, itemOf, newHero, placeAt, say, thingName, who } from './engine';
import type { X } from './engine';
import { STATS } from './script';
import type { Stat } from './script';
import { SPECIAL } from './special-base';
import type { SpecialFn } from './special-base';
import type { CHero, CState, Prompt, Thing } from './state';

/** Провалы поля 1 (клетки, откуда можно вернуться из столицы). */
const FALLS = [22, 31, 54];
/** Кто ещё может дойти до Короля. */
const CONTEND = ['road', 'capital', 'labyrinth', 'palace', 'chambers', 'arena'];
const ROLL = [{ label: 'Бросить кубик', key: 'roll' }];

const alive = (s: CState, o: number) => !['dead', 'out'].includes(H(s, o).zone);
const zoneText = (s: CState, x: X, seat: number, text: string) => {
  x.ev.push({ type: 'zone', seat, text });
  say(s, x, seat, `${who(s, seat)}: ${text}`);
};
const princeName = (h: CHero) => (h.prince != null ? PRINCES[h.prince].name : 'принц');
const die = (x: X) => 1 + x.rng.int(6);

// ---------- смерть, конец партии ----------

/**
 * ПЖ = 0: путник погибает. До коронации игрок берёт другую карту путника и начинает сначала, после — выбывает
 * («либо выходит из игры, либо берёт другую карту путника»). Движок не зовёт `deathCheck` из обработчиков хода
 * (и не считает смертью ПЖ = 0 у принца вне арены), поэтому здесь своя.
 */
function perish(s: CState, x: X, seat: number, why: string) {
  const h = H(s, seat);
  say(s, x, seat, `${who(s, seat)}: ${why}`);
  for (const t of [...h.things]) dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  for (const t of [...h.friends]) dropThing(s, x, seat, t, 'discard');
  s.run = s.run.filter((fr) => fr.seat !== seat);
  if (s.fight?.seat === seat) s.fight = null;
  if (s.king != null) {
    h.zone = 'out';
    h.life = 0;
    return;
  }
  const used = new Set(s.seats.filter((o) => alive(s, o) && o !== seat).map((o) => H(s, o).tr));
  const free = TRAVELLERS.map((t) => t.id).filter((id) => !used.has(id) && id !== h.tr);
  const next = free.length ? free[x.rng.int(free.length)] : h.tr;
  s.heroes[seat] = newHero(seat, next, s.shelf);
  say(s, x, seat, `${who(s, seat)} начинает сначала: ${TRAVELLERS[next].name}.`);
}

/** Партия кончена: Король коронован и в Эмбере больше нет желающих оспорить Корону. */
function checkEnd(s: CState, x: X) {
  if (s.winner != null || s.king == null) return;
  const k = s.king;
  const kh = H(s, k);
  if (!alive(s, k) || kh.life <= 0) return;
  if (s.seats.some((o) => o !== k && CONTEND.includes(H(s, o).zone))) return;
  s.winner = k;
  s.phase = 'over';
  s.prompt = null;
  x.ev.push({ type: 'over', winner: k });
  say(s, x, k, `${who(s, k)} коронован — Владыка Королевства Эмбер.`);
}

// ---------- вход в Эмбер и дорога ----------

/** Вышел из Провала на дорогу в столицу: ограничения в 14 пунктов снимаются, ПО откладываются. */
export function enterRoad(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  h.zone = 'road';
  h.node = 'fall';
  h.sector = null;
  h.ring = 0;
  h.gate = null;
  h.room = 0;
  h.po = 0;
  zoneText(s, x, seat, 'выходит из Провала на дорогу в столицу Королевства Эмбер (ПО отложены, пределов нет).');
}

/** Обменный пункт: ПС ↔ ПУ ↔ ПМ, по одному пункту за раз; первая кнопка — «Готово». */
function askExchange(s: CState, seat: number) {
  const h = H(s, seat);
  const opts = [{ label: 'Готово', key: 'done' }];
  for (const a of STATS) for (const b of STATS) if (a !== b && h.st[a] > 0) opts.push({ label: `1 ${a} → 1 ${b}`, key: `${a}>${b}` });
  ask(s, { seat, q: 'Обменный пункт: можешь обменять ПС ↔ ПУ ↔ ПМ.', kind: 'f2xchg', opts });
}

/** Клетка дороги, на которой остановился: «строго выполняешь условия» (не хватает — теряешь 1 ПЖ). */
function landOnRoad(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  const n = ROAD_BY_ID.get(h.node);
  if (!n) return;
  if (n.st && n.d) {
    if (n.d > 0) bump(s, x, seat, n.st, n.d);
    else if (h.st[n.st] >= -n.d) bump(s, x, seat, n.st, n.d);
    else {
      // поле важнее книги: на дороге не работает правило компенсации — «не хватает … теряешь 1 ПЖ» // ?
      say(s, x, seat, `${who(s, seat)}: не хватает ${n.st} (нужно ${-n.d}) — теряет 1 ПЖ.`);
      bump(s, x, seat, 'ПЖ', -1);
    }
  }
  if (h.life <= 0) {
    perish(s, x, seat, `${TRAVELLERS[h.tr].name} погибает в дороге.`);
    return;
  }
  if (n.exchange) askExchange(s, seat);
}

/** Ход по дороге: бросок, столько клеток по стрелкам; на развилках — по чётности броска этого хода. */
function roadTurn(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  const d = die(x);
  x.ev.push({ type: 'roll', seat, die: d });
  let node = h.node;
  for (let k = 0; k < d; k++) {
    const n = ROAD_BY_ID.get(node);
    const nx = n?.next ?? (d % 2 === 0 ? n?.even : n?.odd);
    if (!nx) break;
    node = nx;
    // дошёл до столицы раньше, чем кончились очки, — «прошли весь путь и оказались в столице»
    if (nx === 'capital') break;
  }
  h.node = node;
  if (node === 'capital') return arriveCapital(s, x, seat);
  landOnRoad(s, x, seat);
}

// ---------- столица ----------

/** Пришёл в столицу: достаёт карту принца (если ещё не принц) и заходит в лавку. */
function arriveCapital(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  h.zone = 'capital';
  h.node = 'capital';
  zoneText(s, x, seat, 'добрался до столицы Королевства Эмбер.');
  if (h.prince == null) {
    // «перетасуйте карты принцев и вытащите одну» — не ту, что у другого игрока
    const taken = new Set(s.seats.filter((o) => o !== seat && alive(s, o) && H(s, o).prince != null).map((o) => H(s, o).prince));
    const free = PRINCES.map((_, i) => i).filter((i) => !taken.has(i));
    const pool = free.length ? free : PRINCES.map((_, i) => i);
    const k = pool[x.rng.int(pool.length)];
    const p = PRINCES[k];
    h.prince = k;
    h.sex = p.sex;
    h.align = p.align;
    h.honest = p.honest;
    h.patient = p.patient;
    // «добавь свои ПЖ, ПС, ПУ и ПМ к качествам принца»; предметы, амулеты и золото остаются
    bump(s, x, seat, 'ПЖ', p.life);
    for (const st of STATS) bump(s, x, seat, st, p.st[st]);
    say(s, x, seat, `${who(s, seat)} — ${p.name}! Показатели: ПЖ ${h.life}, ПС ${h.st.ПС}, ПУ ${h.st.ПУ}, ПМ ${h.st.ПМ}.`);
  }
  askCapital(s, seat);
}

/** Цена вещи в лавке: предмет 5, трофей 7, магический предмет 10, амулет 15, принадлежащий владельцу 20, Корона Владыки 25. */
function sellPrice(t: Thing): number | null {
  const i = itemOf(t);
  if (i) {
    if (i.kind === 'friend' || i.kind === 'smuggle' || i.name.startsWith('долговой')) return null;
    if (i.kind === 'amulet') return 15;
    if (i.kind === 'owned') return 20;
    if (i.kind === 'crown') return i.name.includes('владык') ? 25 : 10; // ? короны регентов — как магические предметы
    if (i.kind === 'magic' || i.kind === 'spell') return 10; // ? заклинания в таблице не названы
    return 5;
  }
  const a = advOf(t);
  if (a == null) return null;
  if (TROPHIES.has(a)) return 7;
  const kind = ADV[a]?.kind;
  return kind === 'магический предмет' ? 10 : kind === 'предмет' ? 5 : null;
}

/** Меню лавки и выхода из столицы. Первая кнопка — «всё на ПЖ» (она же по умолчанию для бота). */
function askCapital(s: CState, seat: number) {
  const h = H(s, seat);
  const opts: Prompt['opts'] = [];
  const sellable = h.things.map((t, i) => ({ t, i, price: sellPrice(t) })).filter((e) => e.price != null);
  const fives = STATS.reduce((sum, st) => sum + Math.floor(h.st[st] / 5), 0);
  if (sellable.length || fives || h.gold >= 20) opts.push({ label: 'Всё на ПЖ: продать вещи, обменять и купить сколько можно', key: 'all' });
  for (const st of STATS) if (h.st[st] >= 5) opts.push({ label: `Обменять 5 ${st} на 1 ПЖ`, key: `x:${st}` });
  if (h.gold >= 20) opts.push({ label: 'Купить 1 ПЖ за 20 талеров', key: 'buy' });
  for (const e of sellable) opts.push({ label: `Продать «${thingName(e.t)}» за ${e.price} т`, key: `s:${e.i}` });
  opts.push({ label: 'Войти в Лабиринт (останутся только ПЖ)', key: 'lab' });
  if (s.king == null) for (const n of FALLS) opts.push({ label: `Вернуться в Мир Приключений: Провал «${cellName(n)}»`, key: `back:${n}` });
  opts.push({ label: 'Остаться в столице (ждать)', key: 'wait' });
  ask(s, { seat, q: `Столица: лавка. ПЖ ${h.life}, талеров ${h.gold}.`, kind: 'f2shop', opts });
}

/** Продать вещь по цене лавки. */
function sell(s: CState, x: X, seat: number, t: Thing) {
  const price = sellPrice(t);
  if (price == null) return;
  const h = H(s, seat);
  dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  h.gold += price;
  x.ev.push({ type: 'pts', seat, p: 'т', delta: price });
  say(s, x, seat, `${who(s, seat)} продаёт вещь в лавке за ${price} т.`);
}
const exchangeFive = (s: CState, x: X, seat: number, st: Stat) => {
  const h = H(s, seat);
  if (h.st[st] < 5) return;
  bump(s, x, seat, st, -5);
  bump(s, x, seat, 'ПЖ', 1);
};
const buyLife = (s: CState, x: X, seat: number) => {
  const h = H(s, seat);
  if (h.gold < 20) return;
  bump(s, x, seat, 'т', -20);
  bump(s, x, seat, 'ПЖ', 1);
};

/** Вход в Лабиринт: «не остаётся ничего, кроме ПЖ» — вещи на поле предметов, золото и пункты прочь. */
function enterLabyrinth(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  for (const t of [...h.things]) dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  for (const t of [...h.friends]) dropThing(s, x, seat, t, 'discard');
  for (const st of STATS) h.st[st] = 0;
  h.po = 0;
  h.gold = 0;
  h.zone = 'labyrinth';
  h.ring = 0;
  h.gate = null;
  zoneText(s, x, seat, `входит в Лабиринт; остаётся только ${h.life} ПЖ.`);
}

SPECIAL['answer:f2shop'] = (s, x, seat, _op, _f, _p, key = '') => {
  const h = H(s, seat);
  if (key === 'all') {
    for (const t of [...h.things]) if (sellPrice(t) != null) sell(s, x, seat, t);
    for (const st of STATS) while (h.st[st] >= 5) exchangeFive(s, x, seat, st);
    while (h.gold >= 20) buyLife(s, x, seat);
    return askCapital(s, seat);
  }
  if (key.startsWith('x:')) {
    exchangeFive(s, x, seat, key.slice(2) as Stat);
    return askCapital(s, seat);
  }
  if (key === 'buy') {
    buyLife(s, x, seat);
    return askCapital(s, seat);
  }
  if (key.startsWith('s:')) {
    const t = h.things[Number(key.slice(2))];
    if (t) sell(s, x, seat, t);
    return askCapital(s, seat);
  }
  if (key === 'lab') {
    enterLabyrinth(s, x, seat);
    return;
  }
  if (key.startsWith('back:') && s.king == null) {
    // принц возвращается через любой Провал, останавливаясь проходом и не выполняя условия поля
    const n = Number(key.slice(5));
    if (!FALLS.includes(n)) return askCapital(s, seat);
    h.zone = 'world';
    h.node = 'fall';
    h.sector = null;
    zoneText(s, x, seat, `${princeName(h)} возвращается в Мир Приключений через Провал «${cellName(n)}».`);
    placeAt(s, x, seat, n, false);
    return;
  }
  say(s, x, seat, `${who(s, seat)} остаётся в столице.`);
};

// ---------- лабиринт ----------

/** Один круг за ход: 4–6 — налево, возьми ПЖ; 1–3 — направо, отложи ПЖ; после третьего кольца — во дворец. */
function labTurn(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  const d = die(x);
  x.ev.push({ type: 'roll', seat, die: d });
  const ring = RINGS_PJ[Math.min(h.ring, RINGS_PJ.length - 1)];
  if (d >= 4) {
    h.gate = 'L';
    bump(s, x, seat, 'ПЖ', ring.take);
    say(s, x, seat, `${who(s, seat)}: кольцо ${h.ring + 1}, бросок ${d} — берёт ${ring.take} ПЖ.`);
  } else {
    h.gate = 'R';
    bump(s, x, seat, 'ПЖ', -ring.give);
    say(s, x, seat, `${who(s, seat)}: кольцо ${h.ring + 1}, бросок ${d} — откладывает ${ring.give} ПЖ.`);
  }
  if (h.life <= 0) return perish(s, x, seat, `${princeName(h)} погибает в Лабиринте.`);
  h.ring++;
  if (h.ring >= RINGS_PJ.length) enterPalace(s, x, seat);
}

// ---------- дворец, покои, арена ----------

/** Из центра Лабиринта — во дворец: первый принц идёт по покоям, остальные тут же на арену. */
function enterPalace(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  h.ring = 0;
  h.gate = null;
  h.room = 0;
  const others = s.seats.filter((o) => o !== seat && alive(s, o));
  const first = s.king == null && !others.some((o) => ['chambers', 'arena'].includes(H(s, o).zone));
  if (first) {
    h.zone = 'chambers';
    zoneText(s, x, seat, `${princeName(h)} первым входит во дворец и идёт по покоям.`);
  } else {
    h.zone = 'arena';
    zoneText(s, x, seat, s.king != null ? `${princeName(h)} выходит на арену — Король ожидает.` : `${princeName(h)} переносится на арену и ждёт.`);
  }
}

/** Покои: 1 клетка за ход (+1, +1, +2, +3 ПЖ снизу вверх), затем — Тронный зал и Корона. */
function chambersTurn(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (s.king != null) {
    h.zone = 'arena';
    h.room = 0;
    return zoneText(s, x, seat, `${princeName(h)} спускается на арену — вызвать Короля.`);
  }
  if (h.room < ROOM_PJ.length) {
    h.room++;
    const pj = ROOM_PJ[h.room - 1];
    bump(s, x, seat, 'ПЖ', pj);
    say(s, x, seat, `${who(s, seat)}: покои, клетка ${h.room} — +${pj} ПЖ.`);
    return;
  }
  crown(s, x, seat);
}

/** Первый принц в Тронном зале: Король, Провалы закрываются, остальные из Мира Приключений выбывают. */
function crown(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  s.king = seat;
  h.zone = 'arena';
  h.room = 0;
  zoneText(s, x, seat, `${princeName(h)} входит в Тронный зал и возлагает на себя Корону — Провалы закрыты.`);
  for (const o of s.seats) {
    const oh = H(s, o);
    if (o !== seat && oh.zone === 'world') {
      oh.zone = 'out';
      say(s, x, o, `${who(s, o)}: Провалы закрыты, для него игра закончена.`);
    }
  }
}

const onArena = (s: CState) => s.seats.filter((o) => H(s, o).zone === 'arena' && H(s, o).life > 0);

/** Игроки по кругу (по часовой) начиная с `from`. */
function clockwiseFrom(s: CState, from: number, list: number[]): number[] {
  const k = s.seats.indexOf(from);
  return s.seats.map((_, i) => s.seats[(k + i) % s.seats.length]).filter((o) => list.includes(o));
}

/** Арена: на ходу того, кого ждёт поединок или битва за корону, играется один раунд. */
function arenaTurn(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  const fighters = onArena(s);
  if (fighters.length < 2) {
    if (s.king != null) return say(s, x, seat, `${who(s, seat)} ждёт на арене претендентов.`);
    // один на арене, Короля ещё нет: вызвать принца из покоев — или идти в покои самому, если там никого
    const inChambers = s.seats.filter((o) => alive(s, o) && H(s, o).zone === 'chambers');
    if (!inChambers.length) {
      h.zone = 'chambers';
      h.room = 0;
      return zoneText(s, x, seat, `${princeName(h)} идёт по дворцовым покоям.`);
    }
    const opts: Prompt['opts'] = inChambers.map((o) => ({ label: `Вызвать на поединок: ${who(s, o)} (${princeName(H(s, o))})`, key: `call:${o}` }));
    opts.push({ label: 'Ждать на арене', key: 'wait' });
    return ask(s, { seat, q: 'Арена: вызвать на поединок принца из дворцовых покоев?', kind: 'f2arena', opts });
  }
  // «1 раунд поединка — за 1 ход участников»: если в этом туре игры раунд уже был, ждём следующего
  if (fighters.some((o) => H(s, o).lastPath[0] === -s.round)) return say(s, x, seat, `${who(s, seat)} ждёт следующего раунда.`);
  startRound(s, x, seat, fighters);
}

SPECIAL['answer:f2arena'] = (s, x, seat, _op, _f, _p, key = '') => {
  const target = key.startsWith('call:') ? Number(key.slice(5)) : -1;
  const th = s.heroes[target];
  if (!th || th.zone !== 'chambers' || H(s, seat).zone !== 'arena') return say(s, x, seat, `${who(s, seat)} ждёт на арене.`);
  th.zone = 'arena';
  zoneText(s, x, target, `${princeName(th)} вызван на поединок и выходит на арену.`);
  startRound(s, x, seat, onArena(s));
};

/** Раунд: каждый участник дважды бросает кубик (одной кнопкой на двоих), король — первым, дальше по часовой. */
function startRound(s: CState, x: X, initiator: number, fighters: number[]) {
  const crown = s.king != null && fighters.includes(s.king);
  const order = clockwiseFrom(s, crown ? s.king! : initiator, fighters);
  for (const o of order) H(s, o).lastPath = [-s.round];
  say(s, x, initiator, crown ? 'Битва за Корону: раунд.' : 'Поединок на арене: раунд.');
  askRound(s, { players: order, i: 0, sums: [], crown });
}
function askRound(s: CState, d: { players: number[]; i: number; sums: number[]; crown: boolean }) {
  const seat = d.players[d.i];
  ask(s, {
    seat,
    q: `${d.crown ? 'Битва за Корону' : 'Арена'}: ${s.names[seat]} дважды бросает кубик.`,
    kind: 'f2roll',
    opts: ROLL,
    data: d,
  });
}

SPECIAL['answer:f2roll'] = (s, x, seat, _op, _f, p) => {
  const d = p!.data as { players: number[]; i: number; sums: number[]; crown: boolean };
  const dice = [die(x), die(x)];
  const sum = dice[0] + dice[1];
  x.ev.push({ type: 'roll', seat, die: sum, dice });
  say(s, x, seat, `${who(s, seat)} бросает ${dice[0]} и ${dice[1]} — ${sum}.`);
  const next = { ...d, i: d.i + 1, sums: [...d.sums, sum] };
  if (next.i < d.players.length) return askRound(s, next);
  resolveRound(s, x, next.players, next.sums, d.crown);
};

/**
 * Итог раунда: меньшие теряют 1 ПЖ; если наибольшую сумму набрали несколько, они теряют по 1 ПЖ, остальные — по
 * стольку ПЖ, сколько их было (все равны — все по 1). В книге — «по 2»; по полю (и для двоих-троих это то же) — по числу. // ?
 */
function resolveRound(s: CState, x: X, players: number[], sums: number[], crown: boolean) {
  const max = Math.max(...sums);
  const top = sums.filter((v) => v === max).length;
  const loss = sums.map((v) => (v === max ? 1 : top));
  // все сразу погибнуть не могут — наибольшая сумма раунда остаётся с 1 ПЖ, бой идёт дальше // ?
  const left = players.map((o, i) => H(s, o).life - loss[i]);
  if (left.every((v) => v <= 0)) players.forEach((o, i) => { if (sums[i] === max) loss[i] = H(s, o).life - 1; });
  players.forEach((o, i) => bump(s, x, o, 'ПЖ', -loss[i]));
  say(s, x, players[0], `Раунд: ${players.map((o, i) => `${s.names[o]} ${sums[i]} (−${loss[i]} ПЖ)`).join(', ')}.`);
  for (const o of players) if (H(s, o).life <= 0) perish(s, x, o, `${princeName(H(s, o))} пал ${crown ? 'в битве за Корону' : 'на арене'}.`);
  const live = players.filter((o) => H(s, o).zone === 'arena' && H(s, o).life > 0);
  if (live.length === 1) {
    const w = live[0];
    if (crown) {
      if (s.king !== w) say(s, x, w, `Король умер! Да здравствует король — ${who(s, w)}!`);
      s.king = w;
    } else {
      // «победитель возвращается в дворцовые покои»
      H(s, w).zone = 'chambers';
      zoneText(s, x, w, `${princeName(H(s, w))} побеждает на арене и возвращается в покои.`);
    }
  }
  checkEnd(s, x);
}

// ---------- точка входа: ход игрока на поле 2 ----------

/** Бросок на ход, когда путник не на поле 1 (движок зовёт на `roll`): действует по месту, где стоит. */
SPECIAL.field2 = ((s, x, seat) => {
  const h = H(s, seat);
  s.phase = 'run';
  switch (h.zone) {
    case 'road':
      roadTurn(s, x, seat);
      break;
    case 'capital':
      askCapital(s, seat);
      break;
    case 'labyrinth':
      labTurn(s, x, seat);
      break;
    case 'palace':
      enterPalace(s, x, seat);
      break;
    case 'chambers':
      chambersTurn(s, x, seat);
      break;
    case 'arena':
      arenaTurn(s, x, seat);
      break;
    default:
      break;
  }
  checkEnd(s, x);
}) satisfies SpecialFn;

SPECIAL.enterRoad = ((s, x, seat) => enterRoad(s, x, seat)) satisfies SpecialFn;

SPECIAL['answer:f2xchg'] = (s, x, seat, _op, _f, _p, key = '') => {
  const m = /^(ПС|ПУ|ПМ)>(ПС|ПУ|ПМ)$/.exec(key);
  const h = H(s, seat);
  if (!m || h.st[m[1] as Stat] <= 0) return;
  bump(s, x, seat, m[1] as Stat, -1);
  bump(s, x, seat, m[2] as Stat, 1);
  askExchange(s, seat);
};

/** Ответы, после которых партия могла кончиться. */
for (const k of ['answer:f2shop', 'answer:f2arena', 'answer:f2roll', 'answer:f2xchg']) {
  const fn = SPECIAL[k];
  SPECIAL[k] = (s, x, seat, op, f, p, key) => {
    fn(s, x, seat, op, f, p, key);
    checkEnd(s, x);
  };
}
