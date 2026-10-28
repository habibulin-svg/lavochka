/**
 * «Корона Эмбера», «Классика 1994» — особые правила хода и клеток поля 1 (подключается побочным импортом).
 *
 * Регистрирует в `SPECIAL`: `moveRoll` (бросок на ход), `beforeTurn`, `afterMove`, `endTurn`, `rosette` (Перевал и Храм
 * Бааля), `shop`, `regent`, `use`, `arrive:smuggle` и все `sp(...)` клеток поля 1 (cells.ts). Решения и броски человека —
 * вопросами (`ask` / `askRoll`) и ответами `SPECIAL['answer:<kind>']`; за человека ничего не делается.
 *
 * Договорённости с engine.ts:
 *  - `moveRoll` сам ставит `s.die` и фазу (pick — выбрать путь, run — ход без движения) или задаёт вопрос;
 *  - `afterMove` зовётся после каждого хода по `go` (чёрный двойник, вакеро);
 *  - `endTurn` — в конце хода (возврат временных качеств); `arrive:*` — после выполнения условий поля;
 *  - `statusEnd` (необязательный, зовётся из `endStatus`) — статус снят выбросом (для наград карт).
 * Разовые пометки путника — поля `HX` (лежат в самом CHero, ходят по сети вместе с ним).
 */
import { ITEMS, TRAVELLERS, advText, cellName, cellsNamed, norm } from './data';
import { FALL_NEED, LYCEUM } from './cells';
import {
  DOOR, H, TROPHIES, add, advOf, ask, askRoll, bump, capOf, capacity, clockwise, counts, deathCheck, distances, dropThing, drawCards,
  drawTop, friendOk, giveThing, hasItem, isAmulet, isMagic, itemOf, lose, neighbours, placeAt, push, putCard, rollDice, say, startFight,
  thingName, toMiddle, usable, who, worldOf,
} from './engine';
import type { X } from './engine';
import { enterRoad } from './special-field2';
import type { Op, Pts, Stat, Status } from './script';
import { SPECIAL } from './special';
import type { CHero, CState, Thing } from './state';
import { STATS } from './script';

/** Разовые пометки путника. */
type HX = CHero & {
  /** прибавка Мутанта (до следующего хода) */
  mut?: Partial<Record<Stat, number>>;
  /** качества до превращения (мухомор, лофофора, пентаграмма) — вернуть в конце хода */
  saved?: Record<Stat, number>;
  /** в лицее выпала 4: следующим ходом снова бросать */
  again?: boolean;
  /** «пропусти ход, затем возьми n карт» */
  later?: number;
  /** сидит в участке, пока не выбросит на ход 4–6 */
  jailed?: boolean;
  /** право на жетон детектива: 1 или 2 класс */
  badgeRight?: 1 | 2;
};
const hx = (s: CState, seat: number) => H(s, seat) as HX;
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Debt = Extract<Status, { k: 'debt' }> & { interest?: number; vex?: string };

// ---------- мелочи ----------

const have = (h: CHero, p: Pts) => (p === 'ПЖ' ? h.life : p === 'ПО' ? h.po : p === 'т' ? h.gold : h.st[p]);
const menu = (s: CState, seat: number, q: string, kind: string, opts: [string, string][], data?: D) =>
  ask(s, { seat, q, kind, opts: opts.map(([label, key]) => ({ label, key })), data });
const reg = (kind: string, fn: (s: CState, x: X, seat: number, key: string, d: D) => void) => {
  SPECIAL['answer:' + kind] = (s, x, seat, _o, _f, p, key) => fn(s, x, seat, key ?? '', (p?.data ?? {}) as D);
};
const roll1 = (x: X, seat: number, why?: string) => {
  const d = 1 + x.rng.int(6);
  x.ev.push({ type: 'roll', seat, die: d, why });
  return d;
};
const rollN = (x: X, seat: number, n: number, why?: string) => {
  const dice = rollDice(x, n);
  const sum = dice.reduce((a, b) => a + b, 0);
  x.ev.push({ type: 'roll', seat, die: sum, dice, why });
  return sum;
};
/** Заплатить n талеров (в банк / кассу мафии / в никуда); возвращает, сколько реально заплачено. */
const pay = (s: CState, x: X, seat: number, n: number, to?: 'bank' | 'mafia') => {
  const got = -bump(s, x, seat, 'т', -n);
  if (to === 'bank') s.bank += got;
  else if (to === 'mafia') s.mafia += got;
  return got;
};
const goPolice = (s: CState, x: X, seat: number) => placeAt(s, x, seat, cellsNamed('Полицейский участок')[0], true);
const isMad = (h: CHero) => h.st.ПУ === 0 && h.prince == null;
const tname = (h: CHero) => TRAVELLERS[h.tr].name;
const room = (h: CHero, p: Stat) => h.st[p] < capOf(h, p);

/** Взять карту предмета с поля предметов по имени и месту. */
function takeAt(s: CState, x: X, seat: number, name: string, place: string): boolean {
  const id = s.shelf.find((i) => ITEMS[i].name === name.toLowerCase() && ITEMS[i].place && norm(ITEMS[i].place!) === norm(place));
  if (id == null) return false;
  s.shelf.splice(s.shelf.indexOf(id), 1);
  giveThing(s, x, seat, { id: `i${id}`, uses: ITEMS[id].uses ?? undefined });
  return true;
}

/** Статус снят условием (выброс и т.п.): убрать и сообщить картам. */
function endStatus(s: CState, x: X, seat: number, st: Status) {
  const h = H(s, seat);
  h.status = h.status.filter((q) => q !== st);
  SPECIAL.statusEnd?.(s, x, seat, { t: 'special', id: 'statusEnd:' + st.k }, { seat, ops: [], i: 0 });
}

/** Можно ли держать предмет: два амулета (кроме №7), два кольта (кроме гусара) нельзя. */
function canHold(h: CHero, item: (typeof ITEMS)[number]): boolean {
  if (item.kind === 'amulet' && item.num !== 7 && h.things.some((t) => itemOf(t)?.kind === 'amulet' && itemOf(t)?.num !== 7)) return false;
  if (item.name === 'кольт' && hasItem(h, 'кольт') && !/ГУСАР/.test(tname(h))) return false;
  if (item.kind === 'crown' && h.things.some((t) => itemOf(t)?.kind === 'crown')) return false;
  return true;
}

// ---------- бросок на ход ----------

const ORDER = ['jail', 'special', 'cw', 'even', 'gob', 'queen', 'horse', 'burnt', 'fin'];

function endRoll(s: CState, die: number) {
  s.die = die > 0 ? die : 0;
  s.phase = die > 0 ? 'pick' : 'run';
}

SPECIAL.moveRoll = (s, x, seat) => {
  const h = hx(s, seat);
  const par = h.status.find((st) => st.k === 'paralysed') as Extract<Status, { k: 'paralysed' }> | undefined;
  if (par) {
    const sum = rollN(x, seat, 2, 'паралич');
    if (sum < par.need) {
      say(s, x, seat, `${who(s, seat)} парализован (${sum} — нужно ${par.need}+) и стоит на месте.`);
      return endRoll(s, 0);
    }
    endStatus(s, x, seat, par);
    if (par.po) bump(s, x, seat, 'ПО', par.po);
    say(s, x, seat, `${who(s, seat)} освободился от паралича.`);
    return askRoll(s, seat, 'moveRoll', 'Освободился! Брось кубик на ход');
  }
  const wd = h.status.find((st) => st.k === 'world' && st.dice) as Extract<Status, { k: 'world' }> | undefined;
  if (wd) {
    // «пока перед ходом не выбросишь с 2-х бросков …»: двигаться по Миру можно и под проклятием
    const sum = rollN(x, seat, 2, 'проклятие');
    if (sum >= wd.dice!) {
      endStatus(s, x, seat, wd);
      say(s, x, seat, `${who(s, seat)} снял проклятие (${sum}).`);
    } else say(s, x, seat, `${who(s, seat)}: проклятие держит (${sum}, нужно ${wd.dice}+).`);
    return askRoll(s, seat, 'moveRoll', 'Брось кубик на ход');
  }
  core(s, x, seat);
};
reg('moveRoll', (s, x, seat) => core(s, x, seat));

function core(s: CState, x: X, seat: number) {
  const h = hx(s, seat);
  if (!isMad(h)) {
    const nm = h.status.find((st) => st.k === 'name') as Extract<Status, { k: 'name' }> | undefined;
    if (nm) {
      menu(s, seat, 'Назови число вместо броска', 'moveName', Array.from({ length: nm.max }, (_, k) => [String(k + 1), String(k + 1)] as [string, string]));
      return;
    }
    if (h.status.some((st) => st.k === 'unlucky')) {
      const n = nextSeat(s, seat);
      if (n !== seat) {
        askRoll(s, n, 'moveUnlucky', `Невезение: ${who(s, n)} бросает кубик за ${who(s, seat)}`, { for: seat });
        return;
      }
    }
  }
  proceed(s, x, seat, roll1(x, seat), 'jail');
}
reg('moveName', (s, x, seat, key) => proceed(s, x, seat, Number(key), 'jail'));
reg('moveUnlucky', (s, x, seat, _k, d) => proceed(s, x, d.for, roll1(x, seat, 'за соседа'), 'jail'));

function nextSeat(s: CState, seat: number): number {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k <= s.seats.length; k++) {
    const o = s.seats[(i + k) % s.seats.length];
    if (H(s, o).zone !== 'out' && H(s, o).zone !== 'dead') return o;
  }
  return seat;
}

const after = (st: string) => ORDER[ORDER.indexOf(st) + 1];

/** Последовательность поправок к броску; вопрос — выход с продолжением в ответе. */
function proceed(s: CState, x: X, seat: number, d: number, stage: string): void {
  const h = hx(s, seat);
  const tn = tname(h);
  const next = () => proceed(s, x, seat, d, after(stage));
  const ask2 = (q: string, yes: string) => menu(s, seat, q, 'moveMod', [[yes, 'y'], ['Нет', 'n']], { d, stage });
  switch (stage) {
    case 'jail':
      if (h.jailed) {
        if (d < 4) {
          say(s, x, seat, `${who(s, seat)} сидит в участке (выпало ${d}, нужно 4–6).`);
          return endRoll(s, 0);
        }
        h.jailed = false;
        say(s, x, seat, `${who(s, seat)} вышел из участка.`);
      }
      return next();
    case 'special':
      if (/ЗНАХАРКА/.test(tn) && d === 4) return menu(s, seat, 'Знахарка: на броске 4 можешь взять 1 талер', 'moveMod', [['Взять 1 т', 'y'], ['Нет', 'n']], { d, stage });
      if (/МУТАНТ/.test(tn) && d === 6) {
        const m: Partial<Record<Stat, number>> = { ПС: bump(s, x, seat, 'ПС', 1), ПУ: bump(s, x, seat, 'ПУ', 1) };
        h.mut = m;
        say(s, x, seat, `${who(s, seat)} (Мутант): на 6 +1 ПС и +1 ПУ до следующего хода.`);
      }
      if (/СЛЕДОПЫТ/.test(tn) && d === 3 && h.prince == null) return ask2('Следопыт: идти на любое из 3-х полей своего Мира?', 'Выбрать поле');
      return next();
    case 'cw': {
      const cw = h.status.find((st) => st.k === 'cw') as Extract<Status, { k: 'cw' }> | undefined;
      if (isMad(h)) return autoMove(s, x, seat, d, 18);
      if (cw) {
        // ? «на 1 или 2 поля, выбрасывая соответственно чет или нечет»: чёт — 1 поле, нечёт — 2
        const steps = cw.sleepy ? (d % 2 === 0 ? 1 : 2) : d;
        return autoMove(s, x, seat, steps, cw.until ? cellsNamed(cw.until)[0] : undefined);
      }
      return next();
    }
    case 'even':
      if (h.status.some((st) => st.k === 'even') && d % 2 === 1) {
        say(s, x, seat, `${who(s, seat)}: выпало ${d} — нечётное, стоит на месте.`);
        return endRoll(s, 0);
      }
      return next();
    case 'gob':
      if (/ГОБЛИН|НИНДЗЯ/.test(tn) && d > 1) return ask2('Вычесть 1 из результата броска?', 'Вычесть 1');
      return next();
    case 'queen':
      if (/КОРОЛЕВА ВЕДЬМ/.test(tn)) return ask2('Королева ведьм: прибавить 1 к броску?', 'Прибавить 1');
      return next();
    case 'horse':
      if (h.cell !== 62 && h.things.some((t) => itemOf(t)?.name === 'лошадь' && usable(h, t))) return ask2('Лошадь: прибавить 1 к броску?', 'Прибавить 1');
      return next();
    case 'burnt':
      if (h.cell === 42 && d > 0) return askRoll(s, seat, 'moveBurnt', 'Выжженная земля: уходя, брось кубик (5–6 — заблудился)', { d });
      return next();
    default: {
      // уходя со «Скал» и «Речки» −1
      const die = d - (h.cell === 6 || h.cell === 67 ? 1 : 0);
      if (die <= 0) {
        say(s, x, seat, `${who(s, seat)}: ход без движения.`);
        return endRoll(s, 0);
      }
      endRoll(s, die);
    }
  }
}
reg('moveMod', (s, x, seat, key, d) => {
  const h = hx(s, seat);
  const st = d.stage as string;
  let v = d.d as number;
  if (st === 'special') {
    if (key === 'y') {
      if (/ЗНАХАРКА/.test(tname(h))) bump(s, x, seat, 'т', 1);
      else return scoutMenu(s, seat, v);
    }
    return proceed(s, x, seat, v, 'cw');
  }
  if (key === 'y') v += st === 'gob' ? -1 : 1;
  proceed(s, x, seat, v, after(st));
});
function scoutMenu(s: CState, seat: number, d: number) {
  const h = H(s, seat);
  const w = worldOf(h.cell);
  const opts: [string, string][] = [];
  for (const [c, dist] of distances(h.cell)) if (dist >= 1 && dist <= 3 && worldOf(c) === w) opts.push([cellName(c), String(c)]);
  opts.push(['Передумал — идти обычно', 'no']);
  menu(s, seat, 'Следопыт: на какое поле?', 'moveScout', opts, { d });
}
reg('moveScout', (s, x, seat, key, d) => {
  if (key === 'no') return proceed(s, x, seat, d.d, 'cw');
  const h = H(s, seat);
  h.lastPath = [h.cell, Number(key)];
  endRoll(s, 0);
  placeAt(s, x, seat, Number(key), true);
  afterMove(s, x, seat);
});
reg('moveBurnt', (s, x, seat, _k, d) => {
  const v = roll1(x, seat, 'Выжженная земля');
  if (v >= 5) {
    say(s, x, seat, `${who(s, seat)} заблудился и оказался на поле «Покинутый дом».`);
    endRoll(s, 0);
    placeAt(s, x, seat, cellsNamed('Покинутый дом')[0], true);
    return afterMove(s, x, seat);
  }
  proceed(s, x, seat, d.d, 'fin');
});

/** Ход, который делается сам (сонная болезнь, безумие): по часовой стрелке, `target` — поле, где останавливаешься. */
function autoMove(s: CState, x: X, seat: number, steps: number, target?: number) {
  const h = H(s, seat);
  let at = h.cell;
  let prev: number | undefined;
  const path: number[] = [];
  for (let k = 0; k < steps; k++) {
    let nx = target != null && neighbours(at).includes(target) ? target : clockwise(at, prev);
    // ? в двери подполей по часовой не заходим
    if (DOOR[nx] && nx !== target) nx = neighbours(at).find((m) => m !== prev && !DOOR[m]) ?? nx;
    prev = at;
    at = nx;
    path.push(at);
    x.ev.push({ type: 'step', seat, cell: at });
    if (target != null && at === target) break;
  }
  if (!path.length) return endRoll(s, 0);
  h.lastPath = [h.cell, ...path];
  endRoll(s, 0);
  say(s, x, seat, `${who(s, seat)} идёт по часовой стрелке на ${path.length} поля.`);
  placeAt(s, x, seat, at, true);
  afterMove(s, x, seat);
}

// ---------- после хода, в начале и в конце хода ----------

/** После каждого хода: чёрный двойник нападает; вакеро уходит из Мира Силы. */
function afterMove(s: CState, x: X, seat: number) {
  const h = hx(s, seat);
  // вакеро возвращается в салун, когда покидаешь Мир Силы
  for (const f of [...h.friends]) {
    if (itemOf(f)?.name === 'вакеро' && worldOf(h.cell) !== 'Сила') {
      dropThing(s, x, seat, f, 'shelf');
      say(s, x, seat, 'Вакеро вернулся в салун.');
    }
  }
  if (h.sector != null || h.zone !== 'world') return;
  const tw = h.status.find((st) => st.k === 'haunt' && st.when === 'turn');
  if (!tw) return;
  say(s, x, seat, `${who(s, seat)}: чёрный двойник нападает после хода.`);
  startFight(s, x, seat, {
    t: 'battle', foe: { name: 'Чёрный двойник', ПС: h.st.ПС, ПУ: h.st.ПУ, ПМ: h.st.ПМ }, without: ['weapons', 'amulets', 'magic'],
    win: [{ t: 'add', p: 'ПС', n: 2 }, { t: 'add', p: 'ПО', n: 1 }, { t: 'special', id: 'twinGone' }],
    lose: [{ t: 'add', p: 'ПЖ', n: -1 }],
    draw: [],
  });
}
SPECIAL.afterMove = (s, x, seat) => afterMove(s, x, seat);
SPECIAL.twinGone = (s, x, seat) => {
  const h = H(s, seat);
  h.status = h.status.filter((st) => !(st.k === 'haunt' && st.adv === 72));
  const t = h.things.find((q) => advOf(q) === 72);
  if (t) dropThing(s, x, seat, t, 'discard');
  say(s, x, seat, 'Чёрный двойник побеждён.');
};

SPECIAL.endTurn = (s, x, seat) => {
  const h = hx(s, seat);
  if (h.saved) {
    for (const k of STATS) h.st[k] = h.saved[k];
    delete h.saved;
  }
};

SPECIAL.beforeTurn = (s, x, seat) => {
  let h = hx(s, seat);
  if (h.mut) {
    for (const k of STATS) if (h.mut[k]) h.st[k] = Math.max(0, h.st[k] - h.mut[k]!);
    delete h.mut;
  }
  // книга, папирус: прибавка по 1 за ход
  for (const st of [...h.status]) {
    if (st.k === 'study') {
      bump(s, x, seat, st.p, 1);
      if (--st.left <= 0) h.status = h.status.filter((q) => q !== st);
    }
  }
  // сухотка и прочее: теряешь пункт; нет пункта — ПЖ
  for (const st of h.status) {
    if (st.k === 'drain') {
      if (have(h, st.p) >= 1) bump(s, x, seat, st.p, -1);
      else bump(s, x, seat, 'ПЖ', -1);
      say(s, x, seat, `${who(s, seat)} теряет 1 ${st.p} перед ходом.`);
    }
  }
  deathCheck(s, x, seat);
  h = hx(s, seat);
  const fl = h.status.find((st) => st.k === 'fly') as Extract<Status, { k: 'fly' }> | undefined;
  if (fl) {
    // «следующим ходом оказываешься на поле» — это и есть ход
    h.status = h.status.filter((q) => q !== fl);
    const to = cellsNamed(fl.cell)[0];
    s.phase = 'run';
    if (to != null) {
      say(s, x, seat, `${who(s, seat)} оказывается на поле «${cellName(to)}».`);
      if (fl.then) {
        placeAt(s, x, seat, to, false);
        push(s, { seat, ops: fl.then, at: to });
      } else placeAt(s, x, seat, to, true);
    }
    return;
  }
  if (h.again) {
    h.again = false;
    return askRoll(s, seat, 'lyceumRoll', 'Лицей: снова дважды брось кубик');
  }
  if (h.later) {
    const n = h.later;
    h.later = 0;
    say(s, x, seat, `${who(s, seat)} берёт ${n} карты.`);
    drawCards(s, x, seat, n);
    return;
  }
  beforeSteps(s, x, seat, 0);
};

function beforeSteps(s: CState, x: X, seat: number, stage: number) {
  const h = hx(s, seat);
  if (stage <= 0) {
    const lg = h.status.find((st) => st.k === 'legion');
    if (lg && h.skip === 0) return askRoll(s, seat, 'legionRoll', 'Срок службы окончен: брось кубик');
  }
  if (stage <= 1 && /БЕЗУМНЫЙ УЧ/.test(tname(h)) && h.gold === 0) {
    return menu(s, seat, 'Безумный учёный: деньги кончились — взять 5 талеров?', 'scholar', [['Взять 5 т', 'y'], ['Нет', 'n']]);
  }
}
reg('legionRoll', (s, x, seat) => {
  const h = H(s, seat);
  const lg = h.status.find((st) => st.k === 'legion') as Extract<Status, { k: 'legion' }> | undefined;
  const d = roll1(x, seat, 'легион');
  if (lg) {
    h.status = h.status.filter((q) => q !== lg);
    if (d <= 4) {
      bump(s, x, seat, 'т', lg.pay);
      say(s, x, seat, `${who(s, seat)} отслужил и получил ${lg.pay} т.`);
    } else {
      // ? «теряешь 1 ПЖ и половину выслуженных денег» — получает вторую половину (округление вниз)
      bump(s, x, seat, 'ПЖ', -1);
      bump(s, x, seat, 'т', Math.floor(lg.pay / 2));
      say(s, x, seat, `${who(s, seat)} объявлен дезертиром: −1 ПЖ, деньги пополам.`);
    }
  }
  beforeSteps(s, x, seat, 1);
});
reg('scholar', (s, x, seat, key) => {
  if (key === 'y') bump(s, x, seat, 'т', 5);
});

// ---------- подполя: Храм Бааля и Перевал ----------

const c = (p: Pts, n: number): Op => ({ t: 'add', p, n });
const ROSETTE: Record<number, { name: string; exit: number; sectors: Op[][] }> = {
  25: {
    name: 'Храм Бааля', exit: 33,
    sectors: [
      [{ t: 'special', id: 'swapPS' }],
      [c('ПМ', -2)],
      [{ t: 'if', c: { pts: 'ПС', min: 3 }, then: [c('ПС', -3)], else: [c('ПЖ', -1)] }],
      [{ t: 'special', id: 'baalAmulet' }],
      [c('т', 10)],
      [{ t: 'lose', what: 'amulets' }],
      [c('ПС', 3)],
    ],
  },
  28: {
    name: 'Перевал', exit: 35,
    sectors: [
      [{ t: 'convert', from: ['ПС', 1], to: ['ПУ', 1] }],
      [c('ПЖ', 1)],
      [{ t: 'lose', what: 'item', else: [c('ПС', -1)] }],
      [{ t: 'lose', what: 'amulet', else: [c('ПС', -1)] }],
      [c('ПЖ', -1)],
      [{ t: 'if', c: { any: [{ item: 'тюк с провизией' }, { item: 'бурдюк с водой' }] }, then: [c('ПС', 1)] }],
      [c('ПУ', 1)],
    ],
  },
};

SPECIAL.rosette = (s, x, seat) => {
  const h = H(s, seat);
  const r = ROSETTE[h.cell];
  if (!r) return;
  if (!h.sector) {
    // «автоматически переходите на сектор 1» (осыпь / первый сектор храма) и двигаетесь по стрелкам
    h.sector = 1;
    x.ev.push({ type: 'sector', seat, cell: h.cell, sector: 1 });
    push(s, { seat, ops: [...r.sectors[0], { t: 'special', id: 'rosette' }] });
    // контрабанда с пунктом назначения «Перевал» / «Храм Бааля»
    deliverFrame(s, seat, r.name);
    return;
  }
  askRoll(s, seat, 'rosetteRoll', `${r.name}: брось кубик (сектор ${h.sector}, сектор 8 — выход)`);
};
reg('rosetteRoll', (s, x, seat) => {
  const h = H(s, seat);
  const r = ROSETTE[h.cell];
  if (!r) return;
  const d = roll1(x, seat);
  // ? ходим по кругу секторов на выпавшее число; выходит тот, кто остановился на секторе 8
  const sec = (((h.sector ?? 1) - 1 + d) % 8) + 1;
  x.ev.push({ type: 'sector', seat, cell: h.cell, sector: sec });
  if (sec === 8) {
    h.sector = null;
    say(s, x, seat, `${who(s, seat)} выходит на поле «${cellName(r.exit)}».`);
    placeAt(s, x, seat, r.exit, true);
    return;
  }
  h.sector = sec;
  push(s, { seat, ops: [...r.sectors[sec - 1], { t: 'special', id: 'rosette' }] });
});
SPECIAL.baalAmulet = (s, x, seat) => {
  if (!takeAt(s, x, seat, 'амулет №7', 'Храм Бааля')) say(s, x, seat, 'Амулетов №7 в храме не осталось.');
};
/** Сектор 1 храма: «можешь обменять ПС на ПМ» — по одному пункту, пока хочешь. */
SPECIAL.swapPS = (s, x, seat) => {
  if (H(s, seat).st.ПС < 1) return;
  menu(s, seat, 'Обменять 1 ПС на 1 ПМ?', 'swapPS', [['Обменять', 'y'], ['Хватит', 'n']]);
};
reg('swapPS', (s, x, seat, key) => {
  if (key !== 'y') return;
  bump(s, x, seat, 'ПС', -1);
  bump(s, x, seat, 'ПМ', 1);
  SPECIAL.swapPS(s, x, seat, { t: 'special', id: 'swapPS' }, { seat, ops: [], i: 0 });
});

// ---------- контрабанда ----------

const smuggleInfo = (i: (typeof ITEMS)[number]) => ({
  dest: /^(.*?)\s+ЗАЛОГ/.exec(i.text)?.[1] ?? '',
  deposit: Number(/ЗАЛОГ\s+(\d+)/.exec(i.text)?.[1] ?? 0),
  reward: Number(/НАГРАДА\s+(\d+)/.exec(i.text)?.[1] ?? 0),
  ok: ((m) => (m ? [Number(m[1]), Number(m[2] ?? m[1])] : [1, 0]))(/(\d)(?:\s*-\s*(\d))?:\s*получи\s+\d+\s+талер/.exec(i.text)),
});

SPECIAL.smugglers = (s, x, seat) => smuggleMenu(s, seat);
function smuggleMenu(s: CState, seat: number) {
  const h = H(s, seat);
  const seen = new Set<string>();
  const opts: [string, string][] = [];
  for (const id of s.shelf) {
    const i = ITEMS[id];
    if (i.kind !== 'smuggle') continue;
    const sm = smuggleInfo(i);
    const lbl = `${sm.dest}: залог ${sm.deposit} т, награда ${sm.reward} т (нужно ${i.po} ПО)`;
    if (seen.has(lbl) || h.po < i.po || h.gold < sm.deposit) continue;
    seen.add(lbl);
    opts.push([lbl, String(id)]);
  }
  if (!opts.length) return;
  opts.push(['Не надо', 'no']);
  menu(s, seat, 'Контрабандисты: доставить груз?', 'smuggle', opts);
}
reg('smuggle', (s, x, seat, key) => {
  if (key === 'no') return;
  const id = Number(key);
  if (!s.shelf.includes(id)) return;
  const sm = smuggleInfo(ITEMS[id]);
  pay(s, x, seat, sm.deposit, 'mafia');
  s.shelf.splice(s.shelf.indexOf(id), 1);
  giveThing(s, x, seat, { id: `i${id}` });
  say(s, x, seat, `${who(s, seat)} берёт груз: «${sm.dest}».`);
});
function deliverFrame(s: CState, seat: number, place: string) {
  const h = H(s, seat);
  const t = h.things.find((q) => itemOf(q)?.kind === 'smuggle' && norm(smuggleInfo(itemOf(q)!).dest) === norm(place));
  if (t) push(s, { seat, ops: [{ t: 'special', id: 'deliver' }] });
}
SPECIAL['arrive:smuggle'] = (s, x, seat) => deliverFrame(s, seat, cellName(H(s, seat).cell));
SPECIAL.deliver = (s, x, seat) => {
  const h = H(s, seat);
  const t = h.things.find((q) => itemOf(q)?.kind === 'smuggle' && norm(smuggleInfo(itemOf(q)!).dest) === norm(cellName(h.cell).replace(/^ПОДПОЛЕ\s+/, '')));
  if (t) askRoll(s, seat, 'smuggleRoll', 'Контрабанда: брось кубик', { id: t.id });
};
reg('smuggleRoll', (s, x, seat, _k, d) => {
  const h = H(s, seat);
  const t = h.things.find((q) => q.id === d.id);
  if (!t) return;
  const sm = smuggleInfo(itemOf(t)!);
  const v = roll1(x, seat, 'контрабанда');
  dropThing(s, x, seat, t, 'shelf');
  if (v >= sm.ok[0] && v <= sm.ok[1]) {
    bump(s, x, seat, 'т', sm.reward);
    say(s, x, seat, `${who(s, seat)} доставил груз: +${sm.reward} т.`);
  } else say(s, x, seat, 'Товар испортился.');
});

// ---------- обменные пункты ----------

SPECIAL.exchange = (s, x, seat, op) => exchangeMenu(s, seat, op.n === 2 ? 2 : 1, false);
function exchangeMenu(s: CState, seat: number, n: 1 | 2, acted: boolean) {
  const h = H(s, seat);
  const o: [string, string][] = [];
  const has = (p: Stat, k: number) => h.st[p] >= k;
  if (n === 1) {
    if (has('ПМ', 3) && room(h, 'ПС')) o.push(['3 ПМ → 1 ПС', 'm3s']);
    if (has('ПУ', 3) && room(h, 'ПС')) o.push(['3 ПУ → 1 ПС', 'u3s']);
    if (has('ПМ', 2) && room(h, 'ПУ')) o.push(['2 ПМ → 1 ПУ', 'm2u']);
    if (h.gold >= 5 && room(h, 'ПС')) o.push(['Купить 1 ПС (5 т)', 'bПС']);
    if (h.gold >= 5 && room(h, 'ПУ')) o.push(['Купить 1 ПУ (5 т)', 'bПУ']);
  } else {
    if (has('ПУ', 3) && room(h, 'ПМ')) o.push(['3 ПУ → 1 ПМ', 'u3m']);
    if (has('ПУ', 3) && room(h, 'ПС')) o.push(['3 ПУ → 1 ПС', 'u3s']);
    if (has('ПМ', 2) && room(h, 'ПС')) o.push(['2 ПМ → 1 ПС', 'm2s']);
    if (h.gold >= 5 && room(h, 'ПС')) o.push(['Купить 1 ПС (5 т)', 'bПС']);
    if (h.gold >= 5 && room(h, 'ПМ')) o.push(['Купить 1 ПМ (5 т)', 'bПМ']);
  }
  o.push([acted ? 'Готово' : 'Ничего не менять (вход 5 т)', 'exit']);
  menu(s, seat, `Обменный пункт: обменять или купить пункты (не больше 14)`, 'exchange', o, { n, acted });
}
reg('exchange', (s, x, seat, key, d) => {
  const n = d.n as 1 | 2;
  const R: Record<string, [Stat, number, Stat]> = { m3s: ['ПМ', 3, 'ПС'], u3s: ['ПУ', 3, 'ПС'], m2u: ['ПМ', 2, 'ПУ'], u3m: ['ПУ', 3, 'ПМ'], m2s: ['ПМ', 2, 'ПС'] };
  if (key === 'exit') {
    if (d.acted) return;
    if (H(s, seat).gold >= 5) {
      pay(s, x, seat, 5);
      return;
    }
    const alt = n === 1 ? 'ПМ' : 'ПУ';
    menu(s, seat, 'Нет денег за вход: чем платишь?', 'exchangeFee', [['−1 ПЖ', 'life'], ...(H(s, seat).st[alt] > 0 ? ([[`−1 ${alt}`, alt]] as [string, string][]) : [])]);
    return;
  }
  if (R[key]) {
    const [from, k, to] = R[key];
    bump(s, x, seat, from, -k);
    bump(s, x, seat, to, 1);
  } else if (key.startsWith('b')) {
    pay(s, x, seat, 5);
    bump(s, x, seat, key.slice(1) as Stat, 1);
  }
  exchangeMenu(s, seat, n, true);
});
reg('exchangeFee', (s, x, seat, key) => bump(s, x, seat, key === 'life' ? 'ПЖ' : (key as Stat), -1));

// ---------- лазарет ----------

SPECIAL.hospital = (s, x, seat) => {
  const h = H(s, seat);
  if (isMad(h)) {
    bump(s, x, seat, 'ПУ', 3);
    say(s, x, seat, `${who(s, seat)} вылечен от безумия: ПУ до 3 бесплатно.`);
  }
  hospitalMenu(s, seat);
};
function hospitalMenu(s: CState, seat: number) {
  const h = H(s, seat);
  const o: [string, string][] = [];
  if (h.life < 4 && h.gold >= 2) {
    const k = Math.min(4 - h.life, Math.floor(h.gold / 2));
    o.push([`Лечиться: +${k} ПЖ за ${2 * k} т`, 'heal']);
  }
  if (h.gold >= 1) o.push(['Профилактическое обследование (1 т)', 'prof']);
  o.push(['Уйти', 'no']);
  if (o.length === 1) return;
  menu(s, seat, 'Лазарет', 'hospital', o);
}
reg('hospital', (s, x, seat, key) => {
  const h = H(s, seat);
  if (key === 'heal') {
    const k = Math.min(4 - h.life, Math.floor(h.gold / 2));
    pay(s, x, seat, 2 * k);
    bump(s, x, seat, 'ПЖ', k);
  } else if (key === 'prof') pay(s, x, seat, 1);
});

// ---------- заготконтора ----------

const OFFICE = norm('Заготконтора');
SPECIAL.office = (s, x, seat) => {
  const h = H(s, seat);
  if ((s.field[h.cell] ?? []).some((f) => f.n === 44)) {
    say(s, x, seat, 'Заготконтора закрыта: в ней багдадский вор.');
    return;
  }
  officeMenu(s, seat, false);
};
const saleHere = (t: Thing, place = OFFICE) => {
  const a = advOf(t);
  const tr = a != null ? TROPHIES.get(a) : undefined;
  const sl = tr?.sales.find((q) => norm(q.cell) === place);
  return tr && sl ? { tr, sl } : undefined;
};
function officeMenu(s: CState, seat: number, sold: boolean) {
  const h = H(s, seat);
  const o: [string, string][] = [];
  for (const t of h.things) {
    const r = saleHere(t);
    if (r) o.push([`Сдать «${thingName(t)}»${r.sl.т ? ` — ${r.sl.т} т` : ''}`, t.id]);
  }
  if (!o.length && sold) return;
  o.push([sold ? 'Готово' : 'Ничего не сдавать (вход 2 т)', 'exit']);
  menu(s, seat, 'Заготконтора: сдать трофеи', 'office', o, { sold });
}
reg('office', (s, x, seat, key, d) => {
  const h = H(s, seat);
  if (key === 'exit') {
    if (d.sold) return;
    if (h.gold >= 2) pay(s, x, seat, 2);
    else menu(s, seat, 'Нет денег за вход: чем платишь?', 'officeFee', [['−1 ПС', 'ПС'], ['−1 ПЖ', 'ПЖ']].filter((q) => q[1] !== 'ПС' || h.st.ПС > 0) as [string, string][]);
    return;
  }
  const t = h.things.find((q) => q.id === key);
  const r = t && saleHere(t);
  if (t && r) {
    dropThing(s, x, seat, t, 'discard');
    if (r.sl.т) bump(s, x, seat, 'т', r.sl.т);
    if (r.sl.ops) push(s, { seat, ops: r.sl.ops });
    if (r.tr.po) bump(s, x, seat, 'ПО', r.tr.po);
    say(s, x, seat, `${who(s, seat)} сдаёт «${thingName(t)}».`);
  }
  officeMenu(s, seat, true);
});
reg('officeFee', (s, x, seat, key) => bump(s, x, seat, key as Pts, -1));

// ---------- Провалы ----------

const FALL_LOSS: Record<number, Stat> = { 22: 'ПУ', 31: 'ПМ', 54: 'ПС' };
const FALL_ROLL: Record<number, (d: number) => number | 'back' | 'out'> = {
  22: (d) => (d <= 2 ? 'back' : d === 3 ? 54 : d === 4 ? 31 : 'out'),
  31: (d) => (d === 1 ? 'back' : d === 2 ? 22 : d === 3 ? 54 : 'out'),
  54: (d) => (d === 1 ? 'back' : d === 2 ? 31 : d === 3 ? 22 : 'out'),
};

SPECIAL.fall = (s, x, seat, op) => {
  const n = op.n ?? H(s, seat).cell;
  const h = H(s, seat);
  if (s.king != null) return void say(s, x, seat, 'Король коронован — Провалы закрыты.');
  if (h.fallUsed) return void say(s, x, seat, 'За 1 ход можно пройти только 1 Провал.');
  fallMenu(s, x, seat, n);
};
function fallMenu(s: CState, x: X, seat: number, n: number) {
  const h = H(s, seat);
  const need = FALL_NEED[n as 22 | 31 | 54];
  const debts = h.status.filter((st) => st.k === 'debt') as Debt[];
  const stats = h.st.ПС >= need && h.st.ПУ >= need && h.st.ПМ >= need && h.po >= need;
  const o: [string, string][] = [];
  if (stats && !debts.length) o.push(['Выйти в Эмбер (бросить кубик)', 'go']);
  debts.forEach((d, k) => {
    if (h.gold >= d.т) o.push([`Заплатить долг ${d.т} т`, 'pay:' + k]);
  });
  if (!o.length) {
    // нечем и нельзя — просто плата за остановку
    say(s, x, seat, stats ? `${who(s, seat)}: пока долг не выплачен, в Провал не пускают.` : `${who(s, seat)}: для выхода нужно ${need} ПС, ПУ, ПМ и ПО (без друзей, предметов и магических предметов).`);
    return void lose(s, x, seat, FALL_LOSS[n], 1);
  }
  o.push([`Остаться (−1 ${FALL_LOSS[n]})`, 'stay']);
  menu(s, seat, `Провал: нужно ${need} ПС, ПУ, ПМ, ПО`, 'fallMenu', o, { n });
}
reg('fallMenu', (s, x, seat, key, d) => {
  const n = d.n as number;
  if (key === 'stay') return lose(s, x, seat, FALL_LOSS[n], 1);
  if (key.startsWith('pay:')) {
    payDebt(s, x, seat, Number(key.slice(4)));
    return fallMenu(s, x, seat, n);
  }
  askRoll(s, seat, 'fallRoll', 'Провал: брось кубик', { n });
});
reg('fallRoll', (s, x, seat, _k, d) => {
  const h = H(s, seat);
  const v = roll1(x, seat, 'Провал');
  const r = FALL_ROLL[d.n as number](v);
  if (r === 'back') return void say(s, x, seat, 'Провал отбросил тебя — покинь это поле.');
  if (r === 'out') {
    // друзья остаются на соседнем поле, предметы и магические предметы остаются
    if (h.friends.length) {
      const nb = neighbours(h.cell);
      return menu(s, seat, 'Друзья дальше не пойдут: на каком соседнем поле они остаются?', 'fallFriends', nb.map((q) => [cellName(q), String(q)] as [string, string]));
    }
    return fallOut(s, x, seat, h.cell);
  }
  // в другой Провал; больше за ход не проходишь
  say(s, x, seat, `Провал перенёс ${who(s, seat)} в «${cellName(r)}».`);
  h.cell = r;
  h.fallUsed = true;
  x.ev.push({ type: 'step', seat, cell: r });
});
reg('fallFriends', (s, x, seat, key) => fallOut(s, x, seat, Number(key)));
function fallOut(s: CState, x: X, seat: number, friendsAt: number) {
  const h = H(s, seat);
  for (const f of [...h.friends]) {
    const a = advOf(f);
    dropThing(s, x, seat, f, 'none');
    if (a != null) putCard(s, friendsAt, { n: a });
    else {
      const i = itemOf(f);
      if (i) s.shelf.push(i.id);
    }
  }
  for (const t of [...h.things]) if (counts(t) && !isAmulet(t)) dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  h.fallUsed = true;
  enterRoad(s, x, seat);
}

function payDebt(s: CState, x: X, seat: number, k: number) {
  const h = H(s, seat);
  const d = (h.status.filter((st) => st.k === 'debt') as Debt[])[k];
  if (!d || h.gold < d.т) return;
  pay(s, x, seat, d.т);
  s.bank += d.interest ?? (d.to === 'bank' ? d.т : 0);
  if (d.po) bump(s, x, seat, 'ПО', d.po);
  h.status = h.status.filter((q) => q !== d);
  const t = h.things.find((q) => (d.vex && q.id === d.vex) || (d.adv != null && advOf(q) === d.adv));
  if (t) dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  say(s, x, seat, `${who(s, seat)} расплатился по долгу.`);
}

// ---------- лицей, «пропусти ход, затем», постоялый двор ----------

SPECIAL.lyceum = (s, x, seat) => askRoll(s, seat, 'lyceumRoll', 'Лицей: дважды брось кубик');
reg('lyceumRoll', (s, x, seat) => {
  const v = rollN(x, seat, 2, 'лицей');
  push(s, { seat, ops: LYCEUM[v] ?? [] });
});
SPECIAL.lyceumAgain = (s, x, seat) => {
  hx(s, seat).again = true;
};
SPECIAL.later = (s, x, seat, op) => {
  hx(s, seat).later = op.n ?? 1;
};
SPECIAL.innSwap = (s, x, seat) => {
  bump(s, x, seat, 'ПС', -1);
  bump(s, x, seat, 'ПМ', -1);
  bump(s, x, seat, 'ПЖ', 1);
};
SPECIAL.changeTraveller = (s, x, seat) => {
  const h = H(s, seat);
  const used = new Set(s.seats.map((o) => H(s, o).tr));
  const free = TRAVELLERS.map((t) => t.id).filter((id) => !used.has(id));
  if (!free.length) return;
  const old = h.tr;
  h.tr = free[x.rng.int(free.length)];
  const t = TRAVELLERS[h.tr];
  h.sex = t.sex;
  h.align = t.align;
  h.honest = t.honest;
  h.patient = t.patient;
  say(s, x, seat, `${who(s, seat)} превратился: ${TRAVELLERS[old].name} → ${t.name}.`);
  // имущество остаётся; личный предмет нового путника, если он есть на поле предметов
  if (t.own) takeAt(s, x, seat, t.own, t.name);
  for (const f of [...h.friends]) {
    const a = advOf(f);
    if (a != null && !friendOk(h, a)) {
      dropThing(s, x, seat, f, 'field');
      say(s, x, seat, `${thingName(f)} уходит.`);
    }
  }
};
SPECIAL.vaquero = (s, x, seat) => {
  const h = H(s, seat);
  const id = s.shelf.find((i) => ITEMS[i].name === 'вакеро');
  if (id == null) return void say(s, x, seat, 'Вакеро уже чей-то друг.');
  if (h.po < ITEMS[id].po) return void say(s, x, seat, `Вакеро станет другом при ${ITEMS[id].po} ПО.`);
  s.shelf.splice(s.shelf.indexOf(id), 1);
  // ? сила вакеро в данных не указана — в бою его пункты берёт движок
  h.friends.push({ id: `i${id}`, with: 'вместо' });
  x.ev.push({ type: 'thing', seat, id: `i${id}`, gain: true });
  say(s, x, seat, 'Вакеро стал твоим другом.');
};

// ---------- «отдай или заплати» ----------

SPECIAL.repairOrLose = (s, x, seat, op) => {
  const h = H(s, seat);
  const items = h.things.filter((t) => counts(t) && !isAmulet(t) && !isMagic(t));
  if (!items.length) return void say(s, x, seat, 'Ломать нечего.');
  const price = op.n ?? 2;
  menu(s, seat, `Поломал предмет: заплатить ${price} т за ремонт или отложить карту предмета?`, 'breakPay', [
    ...(h.gold >= price ? ([[`Заплатить ${price} т`, 'pay']] as [string, string][]) : []), ['Отложить предмет', 'drop'],
  ], { price, what: 'item' });
};
SPECIAL.horseCure = (s, x, seat, op) => {
  const h = H(s, seat);
  if (!hasItem(h, 'лошадь')) return void say(s, x, seat, 'Лошади нет — лечить некого.');
  const price = op.n ?? 3;
  menu(s, seat, `Лошадь поранилась: заплатить ${price} т за отвар или отложить карту лошади?`, 'breakPay', [
    ...(h.gold >= price ? ([[`Заплатить ${price} т`, 'pay']] as [string, string][]) : []), ['Отложить лошадь', 'drop'],
  ], { price, what: 'horse' });
};
reg('breakPay', (s, x, seat, key, d) => {
  if (key === 'pay') pay(s, x, seat, d.price);
  else push(s, { seat, ops: [{ t: 'lose', what: d.what, else: [] }] });
});

// ---------- Олимп ----------

SPECIAL.olympus = (s, x, seat) => {
  const h = H(s, seat);
  menu(s, seat, 'Пик «Олимп»: купить за 3 талера горное снаряжение и попытаться покорить пик?', 'olympus', [
    ...(h.gold >= 3 ? ([['Купить и покорять', 'y']] as [string, string][]) : []), ['Нет', 'n'],
  ]);
};
reg('olympus', (s, x, seat, key) => {
  if (key !== 'y') return;
  pay(s, x, seat, 3);
  askRoll(s, seat, 'olympusRoll', 'Покорение пика: брось кубик');
});
reg('olympusRoll', (s, x, seat) => {
  const v = roll1(x, seat, 'Олимп');
  if (v <= 4) return void add(s, x, seat, 'ПЖ', -1);
  menu(s, seat, 'Пик покорён: что берёшь у пришельцев?', 'olympusGift', [['Бластер', 'бластер'], ['Телепатическое ружьё', 'телепатическое ружье'], ['Ничего', 'no']]);
});
reg('olympusGift', (s, x, seat, key) => {
  if (key !== 'no') takeAt(s, x, seat, key, 'Пик «Олимп»');
});

// ---------- обсерватория: выбрать 1 из n ----------

SPECIAL.pickOf = (s, x, seat, op) => {
  const got: number[] = [];
  for (let k = 0; k < (op.n ?? 3); k++) {
    const c1 = drawTop(s, x);
    if (c1 != null) got.push(c1);
  }
  if (!got.length) return;
  menu(s, seat, 'Выбери одну карту (остальные вернутся в середину колоды)', 'pickOf', got.map((n) => [`${n}. ${advText(n)?.title ?? ''}`, String(n)] as [string, string]), { got });
};
reg('pickOf', (s, x, seat, key, d) => {
  const h = H(s, seat);
  const pick = Number(key);
  for (const n of d.got as number[]) if (n !== pick) toMiddle(s, n);
  push(s, { seat, ops: (ADV_OPS(pick) ?? []) as Op[], card: pick, at: h.cell });
});
import { ADV } from './cards';
const ADV_OPS = (n: number) => ADV[n]?.ops;

// ---------- азартные и денежные клетки ----------

interface Game {
  q: string;
  /** сколько и куда платишь за игру */
  cost: [number, 'bank' | 'mafia'][];
  dice: number;
  times?: number;
}
const GAMES: Record<number, Game> = {
  37: { q: 'Заставный: сыграть в кости? Ставка 5 т (в «Банк»), дважды бросаешь кубик: 9–12 — выиграл 15 т', cost: [[5, 'bank']], dice: 2 },
  46: { q: 'Кабак: перекинуться в карты? Ставка 5 т (в кассу мафии), трижды бросаешь кубик: 14–18 — 20 т, 3–7 — жульничал', cost: [[5, 'mafia']], dice: 3 },
  57: { q: 'Тараканьи бега: поставить 5 т (в кассу мафии)? Кубик 4 раза, на 5–6 получаешь по 4 т', cost: [[5, 'mafia']], dice: 1, times: 4 },
  69: { q: 'Картежники: поставить 5 т (в кассу мафии) и бросить кубик?', cost: [[5, 'mafia']], dice: 1 },
  72: { q: 'Золотая шахта: купить снаряжение за 5 т (в «Банк») и бросить кубик?', cost: [[5, 'bank']], dice: 1 },
  76: { q: 'Отель: зайти за 1 т (в «Банк») и бросить кубик?', cost: [[1, 'bank']], dice: 1 },
  80: { q: 'Игровые автоматы: жетон 5 т (в кассу мафии), бросить кубик?', cost: [[5, 'mafia']], dice: 1 },
};
SPECIAL.dice = (s, x, seat, op) => {
  const n = op.n ?? 0;
  if (n === 75) return casino(s, seat);
  const g = GAMES[n];
  if (!g) return;
  const total = g.cost.reduce((a, b) => a + b[0], 0);
  if (H(s, seat).gold < total) return void say(s, x, seat, `${who(s, seat)}: не хватает денег (${total} т).`);
  menu(s, seat, g.q, 'diceGo', [['Играть', 'y'], ['Нет', 'n']], { n });
};
reg('diceGo', (s, x, seat, key, d) => {
  if (key !== 'y') return;
  const g = GAMES[d.n as number];
  for (const [k, to] of g.cost) pay(s, x, seat, k, to);
  askRoll(s, seat, 'diceRoll', g.q.split(':')[0], { n: d.n, left: g.times ?? 1, acc: 0 });
});
reg('diceRoll', (s, x, seat, _k, d) => {
  const n = d.n as number;
  const g = GAMES[n];
  const h = H(s, seat);
  const v = rollN(x, seat, g.dice);
  const gain = (k: number) => void bump(s, x, seat, 'т', k);
  if (n === 57) {
    const acc = (d.acc as number) + (v >= 5 ? 4 : 0);
    if ((d.left as number) > 1) return askRoll(s, seat, 'diceRoll', 'Тараканьи бега: ещё бросок', { n, left: d.left - 1, acc });
    return gain(acc);
  }
  switch (n) {
    case 37:
      if (v >= 9) gain(15);
      break;
    case 46:
      if (v >= 14) gain(20);
      else if (v <= 7) {
        say(s, x, seat, 'Ты жульничал!');
        goPolice(s, x, seat);
      }
      break;
    case 69: {
      const t = h.honest ? [10, 0, 10, 0, 15, 0] : [15, 0, 20, -1, 20, 10];
      if (t[v - 1] > 0) gain(t[v - 1]);
      else if (t[v - 1] < 0) add(s, x, seat, 'ПС', -1);
      break;
    }
    case 72:
      if (v === 6) {
        say(s, x, seat, 'Нет лицензии!');
        goPolice(s, x, seat);
      } else gain([0, 5, 8, 10, 12][v - 1]);
      break;
    case 76:
      if (v === 1) add(s, x, seat, 'т', -10);
      else if (v === 2) gain(20);
      else if (v === 3) goPolice(s, x, seat);
      else if (v === 4) gain(15);
      else if (v === 5) add(s, x, seat, 'ПЖ', -1);
      else gain(10);
      break;
    case 80:
      if (v === 3) goPolice(s, x, seat);
      else if (v === 2 || v === 4 || v === 6) gain(15);
      break;
  }
});
/** Казино: 2 т за вход и 5 т за игру; загадать 1 или 2 цифры. */
function casino(s: CState, seat: number) {
  if (H(s, seat).gold < 7) return;
  menu(s, seat, 'Казино: вход 2 т и игра 5 т (в кассу мафии). Загадать 1 или 2 цифры?', 'casinoMode', [['Одну цифру (25 т)', '1'], ['Две цифры (15 т)', '2'], ['Не играть', 'no']]);
}
reg('casinoMode', (s, x, seat, key) => {
  if (key === 'no') return;
  // ? «положи их» — и вход, и игра уходят в кассу мафии
  pay(s, x, seat, 7, 'mafia');
  casinoPick(s, seat, Number(key), []);
});
function casinoPick(s: CState, seat: number, need: number, picked: number[]) {
  menu(s, seat, `Загадай цифру (${picked.length + 1} из ${need})`, 'casinoPick', [1, 2, 3, 4, 5, 6].filter((v) => !picked.includes(v)).map((v) => [String(v), String(v)] as [string, string]), { need, picked });
}
reg('casinoPick', (s, x, seat, key, d) => {
  const picked = [...(d.picked as number[]), Number(key)];
  if (picked.length < d.need) return casinoPick(s, seat, d.need, picked);
  askRoll(s, seat, 'casinoRoll', 'Рулетка: брось кубик', { picked });
});
reg('casinoRoll', (s, x, seat, _k, d) => {
  const v = roll1(x, seat, 'рулетка');
  const picked = d.picked as number[];
  if (picked.includes(v)) bump(s, x, seat, 'т', picked.length === 1 ? 25 : 15);
});

// ---------- участок, штрафы ----------

SPECIAL.fine = (s, x, seat, op) => {
  const n = op.n ?? 10;
  const h = hx(s, seat);
  if (h.gold >= n) {
    pay(s, x, seat, n, 'bank');
    return;
  }
  if (n === 10) return void lose(s, x, seat, 'ПУ', 1);
  h.jailed = true;
  say(s, x, seat, `${who(s, seat)} нечем платить штраф — сидит, пока не выбросит на ход 4–6.`);
};
/** Право на жетон детектива; сам жетон — в детективном бюро. */
SPECIAL.badgeRight = (s, x, seat, op) => {
  const h = hx(s, seat);
  const k = (op.n ?? 2) as 1 | 2;
  h.badgeRight = h.badgeRight ? (Math.min(h.badgeRight, k) as 1 | 2) : k;
  say(s, x, seat, `${who(s, seat)} получает право на жетон детектива ${k}-го класса (взять в детективном бюро).`);
};

// ---------- ограбление банка и кассы мафии ----------

SPECIAL.rob = (s, x, seat, op) => {
  const n = op.n ?? 78;
  if ((n === 73 ? s.mafia : s.bank) <= 0) return void say(s, x, seat, 'В кассе пусто.');
  menu(s, seat, `Ограбить ${n === 73 ? 'кассу мафии' : 'банк'}? Охрана — 3 ${n === 73 ? 'боевика' : 'полицейских'} с Силой 14; проиграешь одному — −1 ПЖ и налёт кончен`, 'robGo', [['Ограбить', 'y'], ['Нет', 'n']], { n });
};
reg('robGo', (s, x, seat, key, d) => {
  if (key !== 'y') return;
  const n = d.n as number;
  startFight(s, x, seat, {
    t: 'battle', foe: { name: n === 73 ? 'Боевик' : 'Полицейский', ПС: 14 }, stat: 'ПС', count: 3,
    win: [{ t: 'special', id: 'robWin', n }], lose: [{ t: 'add', p: 'ПЖ', n: -1 }], draw: [],
  });
});
SPECIAL.robWin = (s, x, seat, op) => {
  const sum = op.n === 73 ? s.mafia : s.bank;
  if (op.n === 73) s.mafia = 0;
  else s.bank = 0;
  bump(s, x, seat, 'т', sum);
  say(s, x, seat, `${who(s, seat)} ограбил: +${sum} т.`);
};

// ---------- аэропорт ----------

const FLIGHTS: [string, number][] = [['Ранчо', 7], ['Лазарет', 5], ['Магшоп', 8], ['Оружейная лавка', 8]];
SPECIAL.airport = (s, x, seat) => {
  const h = H(s, seat);
  const o = FLIGHTS.filter(([, p]) => h.gold >= p).map(([n, p]) => [`Авиабилет на «${n}» — ${p} т`, n] as [string, string]);
  if (!o.length) return;
  menu(s, seat, 'Аэропорт: купить авиабилет (следующим ходом окажешься на поле)?', 'airport', [...o, ['Нет', 'no']]);
};
reg('airport', (s, x, seat, key) => {
  if (key === 'no') return;
  const p = FLIGHTS.find(([n]) => n === key)![1];
  pay(s, x, seat, p, 'bank');
  H(s, seat).status.push({ k: 'fly', cell: key });
});

// ---------- иностранный легион ----------

SPECIAL.legion = (s, x, seat) =>
  menu(s, seat, 'Иностранный легион: завербоваться? (остаёшься здесь на срок службы)', 'legion', [['1 ход — 5 т', '1'], ['2 хода — 10 т', '2'], ['3 хода — 15 т', '3'], ['Нет', 'no']]);
reg('legion', (s, x, seat, key) => {
  if (key === 'no') return;
  const n = Number(key);
  const h = H(s, seat);
  h.skip += n;
  h.status.push({ k: 'legion', turns: n, pay: 5 * n });
  say(s, x, seat, `${who(s, seat)} завербовался в легион на ${n} ход.`);
});

// ---------- ростовщик ----------

SPECIAL.usurer = (s, x, seat) => usurerMenu(s, seat);
function usurerMenu(s: CState, seat: number) {
  const h = H(s, seat);
  const seen = new Set<string>();
  const o: [string, string][] = [];
  for (const id of s.shelf) {
    const i = ITEMS[id];
    if (!i.name.startsWith('долговой') || h.po < i.po) continue;
    const back = Number(/вернуть ростовщику (\d+)/.exec(i.text)?.[1] ?? 0);
    const key = String(back);
    if (seen.has(key)) continue;
    seen.add(key);
    o.push([`Занять ${loanOf(i)} т (вернуть ${back})`, String(id)]);
  }
  h.status.forEach((st, k) => {
    const d = st as Debt;
    if (st.k === 'debt' && d.vex && h.gold >= st.т) o.push([`Вернуть долг ${st.т} т`, 'repay:' + k]);
  });
  if (!o.length) return;
  menu(s, seat, 'Ростовщик: занять под проценты или вернуть долг', 'usurer', [...o, ['Уйти', 'no']]);
}
/** Сумма займа по карте векселя (цена в items.json — «на 20 талеров проценты — 8 талеров»). */
function loanOf(i: (typeof ITEMS)[number]): number {
  const back = Number(/вернуть ростовщику (\d+)/.exec(i.text)?.[1] ?? 0);
  return back - interestOf(i);
}
function interestOf(i: (typeof ITEMS)[number]): number {
  const back = Number(/вернуть ростовщику (\d+)/.exec(i.text)?.[1] ?? 0);
  return ({ 28: 8, 15: 5, 20: 5, 8: 3 } as Record<number, number>)[back] ?? 0;
}
reg('usurer', (s, x, seat, key) => {
  const h = H(s, seat);
  if (key === 'no') return;
  if (key.startsWith('repay:')) {
    const debts = h.status.filter((st) => st.k === 'debt') as Debt[];
    const idx = debts.indexOf(h.status[Number(key.slice(6))] as Debt);
    payDebt(s, x, seat, idx);
    return usurerMenu(s, seat);
  }
  const id = Number(key);
  if (!s.shelf.includes(id)) return;
  const i = ITEMS[id];
  s.shelf.splice(s.shelf.indexOf(id), 1);
  giveThing(s, x, seat, { id: `i${id}` });
  bump(s, x, seat, 'т', loanOf(i));
  const back = loanOf(i) + interestOf(i);
  const debt: Debt = { k: 'debt', т: back, to: 'bank', interest: interestOf(i), vex: `i${id}` };
  h.status.push(debt);
  say(s, x, seat, `${who(s, seat)} занял ${loanOf(i)} т: вернуть ${back} (пока не расплатишься — в Провал нельзя).`);
});

// ---------- детективное бюро ----------

SPECIAL.detective = (s, x, seat) => detectiveMenu(s, seat);
function detectiveMenu(s: CState, seat: number) {
  const h = hx(s, seat);
  const o: [string, string][] = [];
  const class1 = hasItem(h, 'жетон детектива 1-го класса');
  const class2 = hasItem(h, 'жетон детектива 2-го класса');
  // ? в тексте поля телохранитель — 5 т, на карте — 7 (3 для 2-го класса, даром для 1-го): беру цену карты
  const guard = class1 ? 0 : class2 ? 3 : 7;
  const gid = s.shelf.find((i) => ITEMS[i].name === 'телохранитель');
  if (gid != null && h.po >= ITEMS[gid].po && h.gold >= guard) o.push([`Нанять телохранителя (${guard} т)`, 'guard']);
  const sid = s.shelf.find((i) => ITEMS[i].name === 'карманный шпион');
  if (sid != null && h.gold >= 12) o.push(['Купить карманного шпиона (12 т)', 'spy']);
  if (h.badgeRight && s.shelf.some((i) => ITEMS[i].name === `жетон детектива ${h.badgeRight}-го класса`) && !(h.badgeRight === 2 && class1)) o.push([`Взять жетон детектива ${h.badgeRight}-го класса`, 'badge']);
  if (!o.length) return;
  menu(s, seat, 'Детективное бюро', 'detective', [...o, ['Уйти', 'no']]);
}
reg('detective', (s, x, seat, key) => {
  const h = hx(s, seat);
  if (key === 'no') return;
  if (key === 'guard') {
    const guard = hasItem(h, 'жетон детектива 1-го класса') ? 0 : hasItem(h, 'жетон детектива 2-го класса') ? 3 : 7;
    const gid = s.shelf.find((i) => ITEMS[i].name === 'телохранитель');
    if (gid == null) return;
    pay(s, x, seat, guard, 'bank');
    s.shelf.splice(s.shelf.indexOf(gid), 1);
    // ? сила телохранителя в данных не указана — в бою его пункты берёт движок
    h.friends.push({ id: `i${gid}`, with: 'вместо' });
    x.ev.push({ type: 'thing', seat, id: `i${gid}`, gain: true });
  } else if (key === 'spy') {
    const sid = s.shelf.find((i) => ITEMS[i].name === 'карманный шпион');
    if (sid == null) return;
    pay(s, x, seat, 12, 'bank');
    s.shelf.splice(s.shelf.indexOf(sid), 1);
    giveThing(s, x, seat, { id: `i${sid}` });
  } else if (key === 'badge') {
    const old = h.things.find((t) => /жетон детектива/.test(itemOf(t)?.name ?? ''));
    if (old) dropThing(s, x, seat, old, 'shelf');
    takeAt(s, x, seat, `жетон детектива ${h.badgeRight}-го класса`, 'Детективное бюро');
    h.badgeRight = undefined;
  }
  detectiveMenu(s, seat);
});

// ---------- биржа и пещера сокровищ ----------

/** Первоначальная цена вещи на бирже: каталог, у трофея — цена заготконторы. */
function marketPrice(t: Thing): number {
  const i = itemOf(t);
  if (i) return i.price ?? 0;
  const a = advOf(t);
  const tr = a != null ? TROPHIES.get(a) : undefined;
  return tr?.sales.find((q) => norm(q.cell) === OFFICE)?.т ?? tr?.sales[0]?.т ?? 0;
}
const sellable = (t: Thing) => {
  const i = itemOf(t);
  if (i) return (i.kind === 'item' || i.kind === 'amulet' || i.kind === 'magic') && t.id !== '';
  const a = advOf(t);
  return a != null && (TROPHIES.has(a) || isMagic(t) || counts(t));
};
SPECIAL.exchangeMarket = (s, x, seat) => marketMenu(s, seat);
function marketMenu(s: CState, seat: number) {
  const h = H(s, seat);
  const o = h.things.filter(sellable).map((t) => [`Выставить «${thingName(t)}» (${marketPrice(t)} т)`, t.id] as [string, string]);
  if (!o.length) return;
  menu(s, seat, 'Биржа: выставить вещь на торги (с проданной — 2 т в «Банк»)', 'market', [...o, ['Хватит', 'no']]);
}
reg('market', (s, x, seat, key) => {
  if (key === 'no') return;
  askRoll(s, seat, 'marketRoll', 'Торги: брось кубик', { id: key });
});
reg('marketRoll', (s, x, seat, _k, d) => {
  const h = H(s, seat);
  const t = h.things.find((q) => q.id === d.id);
  if (!t) return;
  const v = roll1(x, seat, 'биржа');
  if (v === 1 || v === 5) {
    say(s, x, seat, `«${thingName(t)}» не пользуется спросом.`);
    return marketMenu(s, seat);
  }
  const price = marketPrice(t);
  dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  if (v === 6) {
    say(s, x, seat, `«${thingName(t)}» в чёрных списках — конфискован.`);
    return goPolice(s, x, seat);
  }
  const gain = price + { 2: 5, 3: 10, 4: 15 }[v]!;
  bump(s, x, seat, 'т', gain);
  pay(s, x, seat, 2, 'bank');
  say(s, x, seat, `«${thingName(t)}» продан за ${gain} т.`);
  marketMenu(s, seat);
});
SPECIAL.treasureCave = (s, x, seat) => {
  const h = H(s, seat);
  const passes = h.things.filter((t) => {
    const a = advOf(t);
    return a != null && TROPHIES.get(a)?.pass;
  });
  if (!passes.length) return void say(s, x, seat, 'В пещеру пускают только с пропуском (трофеем-пропуском).');
  if (passes.length === 1) return caveGo(s, x, seat, passes[0].id);
  menu(s, seat, 'Каким трофеем-пропуском платишь?', 'cavePass', passes.map((t) => [thingName(t), t.id] as [string, string]));
};
reg('cavePass', (s, x, seat, key) => caveGo(s, x, seat, key));
function caveGo(s: CState, x: X, seat: number, id: string) {
  const t = H(s, seat).things.find((q) => q.id === id);
  if (t) dropThing(s, x, seat, t, 'discard');
  askRoll(s, seat, 'caveRoll', 'Пещера сокровищ: брось кубик');
}
reg('caveRoll', (s, x, seat) => bump(s, x, seat, 'т', 5 + 5 * roll1(x, seat, 'пещера')));

// ---------- места торговли ----------

SPECIAL.shop = (s, x, seat) => shopMenu(s, seat);
/** Скидка юбилейного посетителя: карта №4 — оружейная лавка (два предмета), №37 — магшоп. */
function jubilee(h: CHero, place: string): Thing | undefined {
  const n = norm(place) === norm('Оружейная лавка') ? 4 : norm(place) === norm('Магшоп') ? 37 : 0;
  return n ? h.things.find((t) => advOf(t) === n) : undefined;
}
function shopMenu(s: CState, seat: number) {
  const h = H(s, seat);
  const place = cellName(h.cell);
  const jub = jubilee(h, place);
  const full = h.things.filter(counts).length >= capacity(h);
  const seen = new Set<string>();
  const o: [string, string][] = [];
  for (const id of s.shelf) {
    const i = ITEMS[id];
    if (!i.place || norm(i.place) !== norm(place) || i.price == null || !['item', 'amulet', 'magic'].includes(i.kind)) continue;
    const price = jub ? Math.ceil(i.price / 2) : i.price;
    const lbl = `${i.name} — ${price} т (нужно ${i.po} ПО)`;
    if (seen.has(lbl) || h.gold < price || full || !canHold(h, i)) continue;
    seen.add(lbl);
    o.push([lbl, String(id)]);
  }
  if (!o.length) return;
  menu(s, seat, `«${place}»: купить?${jub ? ' (юбилейный посетитель — половина цены)' : ''}`, 'shop', [...o, ['Не надо', 'no']]);
}
reg('shop', (s, x, seat, key) => {
  const h = H(s, seat);
  const place = cellName(h.cell);
  if (key === 'no') {
    // юбилейный в магшопе — одно посещение
    const j = jubilee(h, place);
    if (j && advOf(j) === 37 && h.things.includes(j)) dropThing(s, x, seat, j, 'discard');
    return;
  }
  const id = Number(key);
  const i = ITEMS[id];
  if (!s.shelf.includes(id)) return;
  const jub = jubilee(h, place);
  pay(s, x, seat, jub ? Math.ceil((i.price ?? 0) / 2) : i.price ?? 0);
  s.shelf.splice(s.shelf.indexOf(id), 1);
  giveThing(s, x, seat, { id: `i${id}`, uses: i.uses ?? undefined });
  if (jub && advOf(jub) === 4) {
    jub.uses = (jub.uses ?? 2) - 1;
    if (jub.uses <= 0) dropThing(s, x, seat, jub, 'discard');
  }
  shopMenu(s, seat);
});

// ---------- регент Мира ----------

const REGENTS: Record<number, { w: 'Сила' | 'Ум' | 'Магия'; crown: string; po: number }> = {
  1: { w: 'Сила', crown: 'корона регента мира силы', po: 2 },
  82: { w: 'Ум', crown: 'корона регента мира ума', po: 3 },
  126: { w: 'Магия', crown: 'корона регента мира магии', po: 2 },
};
SPECIAL.regent = (s, x, seat, op) => {
  const r = REGENTS[op.n ?? 0];
  if (!r) return;
  const h = H(s, seat);
  h.regent = r.w;
  const id = s.shelf.find((i) => ITEMS[i].name === r.crown);
  if (id != null && !h.things.some((t) => itemOf(t)?.kind === 'crown')) {
    s.shelf.splice(s.shelf.indexOf(id), 1);
    h.things.push({ id: `i${id}` });
    x.ev.push({ type: 'thing', seat, id: `i${id}`, gain: true });
  }
  bump(s, x, seat, 'ПО', r.po);
  const card = h.things.find((t) => advOf(t) === op.n);
  if (card) dropThing(s, x, seat, card, 'discard');
  say(s, x, seat, `${who(s, seat)} становится регентом Мира ${r.w === 'Сила' ? 'Силы' : r.w === 'Ум' ? 'Ума' : 'Магии'}.`);
};

// ---------- вещи «в любой удобный момент» ----------

const CONVERT: Record<number, Stat> = { 163: 'ПС', 164: 'ПУ', 85: 'ПМ' };
SPECIAL.use = (s, x, seat, op) => {
  const h = hx(s, seat);
  const t = h.things.find((q) => q.id === op.id);
  if (!t || h.zone === 'dead' || h.zone === 'out') return;
  const i = itemOf(t);
  const a = advOf(t);
  if (i) {
    if (!usable(h, t)) return void say(s, x, seat, `${who(s, seat)}: не хватает ПО для «${i.name}».`);
    if (i.name === 'тюк с провизией') {
      bump(s, x, seat, 'ПЖ', 2);
      dropThing(s, x, seat, t, 'shelf');
      say(s, x, seat, `${who(s, seat)} подкрепился: +2 ПЖ.`);
    } else if (i.name === 'бурдюк с водой') {
      bump(s, x, seat, 'ПЖ', 1);
      bump(s, x, seat, 'ПС', 1);
      dropThing(s, x, seat, t, 'shelf');
      say(s, x, seat, `${who(s, seat)} утолил жажду: +1 ПЖ, +1 ПС.`);
    } else if (i.kind === 'amulet' && i.num === 6) {
      bump(s, x, seat, 'ПЖ', 2);
      t.uses = (t.uses ?? i.uses ?? 1) - 1;
      if (t.uses <= 0) dropThing(s, x, seat, t, 'shelf');
      say(s, x, seat, `${who(s, seat)}: амулет №6 — +2 ПЖ.`);
    }
    return;
  }
  const to = a != null ? CONVERT[a] : undefined;
  if (to && s.turn === seat && !h.saved) {
    // на 1 ход свои ПС, ПУ, ПМ переходят в одно качество и суммируются (без предметов и друзей)
    h.saved = { ...h.st };
    const sum = h.st.ПС + h.st.ПУ + h.st.ПМ;
    for (const k of STATS) h.st[k] = k === to ? sum : 0;
    dropThing(s, x, seat, t, 'discard');
    say(s, x, seat, `${who(s, seat)}: на этот ход все качества переходят в ${to} (${sum}).`);
  }
};
