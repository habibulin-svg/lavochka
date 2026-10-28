/**
 * «Корона Эмбера», «Классика 1994» — особые правила карт №101–200, карты в руке («взяв карту — можешь не выполнять»),
 * особенности путников (до боя / после поражения / на одном поле / перед ходом).
 *
 * Регистрирует обработчики в SPECIAL при загрузке модуля. Экспорт для сборки (index.ts / правки engine) — внизу файла
 * и в докладе: pre2, post2, onDraw, onSameField, turnStart2, arrived2, carefreeAsk, thingLost, useThing, useList, isImmune.
 * Хуки setSpecialPre/Post здесь НЕ вызываются.
 *
 * Вопросы игроку: kind `c2_roll` (кубик; человек жмёт «Бросить кубик») и `c2_pick` (выбор); продолжения — в таблицах
 * ROLLS / PICKS по метке `tag` (данные вопроса — чистый JSON).
 */
import type { Rng } from '../../../core/types';
import { cell as cellGeo } from '../data';
import { ADV } from './cards';
import { cellKind } from './cells';
import { ITEMS, TRAVELLERS, advText, cellName, cellsNamed, norm } from './data';
import type { X } from './engine';
import {
  H, TROPHIES, advOf, ask, bump, cardOf, counts, dropThing, giveThing, hasItem, isAmulet, isMagic, itemOf, leaveFoe, lose, myPower, neighbours,
  cellConditions, pass, placeAt, push, putCard, say, startFight, stopCard, takeCard, thingName, toMiddle, usable, who, worldOf, distances,
} from './engine';
import type { Op, Stat, Status, World } from './script';
import { STATS } from './script';
import { SPECIAL } from './special-base';
import type { SpecialFn } from './special-base';
import type { CHero, CState, FieldCard, Fight, Frame, Thing } from './state';

void (null as unknown as Rng);

// ---------- общее ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D = Record<string, any>;
type FX = Frame & { guard?: FieldCard; c2go?: boolean; c2used?: string[]; c2init?: number; parent?: number };
type Opt = { label: string; key: string };

const sp = (id: string, fn: SpecialFn) => {
  SPECIAL[id] = fn;
};
const SPELL: Record<string, true> = {};
void SPELL;

/** Карты, на которые не действуют амулеты, магические предметы и заклинания (сфинксы). */
const NOSKIP = new Set([134, 139, 196]);
/** Карты колдовства, скрытые от других игроков (для view/redact). */
export const HIDDEN_CARDS = new Set([138, 142, 194, 29, 96]);

interface Hx {
  captive?: { po: number };
  raven?: { friends: Thing[]; cell: number; world: string };
  mush?: { after: Record<Stat, number>; orig: Record<Stat, number>; left: number };
  charm?: number;
  prep?: { i: number; peeked?: boolean };
}
const hx = (h: CHero): Hx => ((h as CHero & { c2?: Hx }).c2 ??= {});
interface C2 {
  moon?: { w: number; v: number }[];
  moonCur?: { w: number; v: number };
  pvp?: { att: number; v: number };
}
const c2 = (s: CState): C2 => ((s as CState & { c2?: C2 }).c2 ??= {});

const trName = (h: CHero) => TRAVELLERS[h.tr].name;
const isTr = (h: CHero, re: RegExp) => h.zone === 'world' && re.test(trName(h));
/** «Другие путники никаким образом не могут воздействовать на Звездочёта.» */
export const isImmune = (s: CState, seat: number) => /ЗВЕЗДОЧ/.test(trName(H(s, seat)));
export const holdsReflect = (s: CState, seat: number) => H(s, seat).things.some((t) => advOf(t) === 138);

function outer(s: CState): FX | undefined {
  for (let k = s.run.length - 1; k >= 0; k--) if (s.run[k].card) return s.run[k] as FX;
  return undefined;
}
/** Вложенный кадр того же контекста карты. */
function sub(s: CState, f: Frame, ops: Op[]) {
  push(s, { seat: f.seat, ops, at: f.at, cell: f.cell });
  (s.run[s.run.length - 1] as FX).parent = cardOf(s);
}
const fate = (s: CState) => {
  const of = outer(s);
  if (of) of.fated = true;
};
const lastRoll = (x: X, seat: number) => {
  for (let k = x.ev.length - 1; k >= 0; k--) {
    const e = x.ev[k];
    if (e.type === 'roll' && e.seat === seat) return e.die;
  }
  return 1;
};
const alive = (s: CState, o: number) => !['dead', 'out'].includes(H(s, o).zone);
function nextSeat(s: CState, seat: number): number | null {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k < s.seats.length; k++) {
    const o = s.seats[(i + k) % s.seats.length];
    if (alive(s, o)) return o;
  }
  return null;
}
/** Проверить смерть путника, не стоящего в исполняемом кадре (ПЖ мог упасть до 0). */
const pokeDeath = (s: CState, seat: number) => push(s, { seat, ops: [{ t: 'add', p: 'ПО', n: 0 }] });
const can = (h: CHero, t: Thing) => usable(h, t) && (!!itemOf(t) || h.po >= (t.pts ?? 0));
const things = (h: CHero, a: number) => h.things.find((t) => advOf(t) === a);

// ---------- вопросы ----------

type RollFn = (s: CState, x: X, who: number, d: number, data: D) => void;
type PickFn = (s: CState, x: X, seat: number, key: string, data: D) => void;
const ROLLS: Record<string, RollFn> = {};
const PICKS: Record<string, PickFn> = {};

function askRoll(s: CState, seat: number, tag: string, q: string, data: D = {}, dice = 1) {
  ask(s, { seat, q, kind: 'c2_roll', opts: [{ label: dice === 2 ? 'Дважды бросить кубик' : 'Бросить кубик', key: 'roll' }], data: { who: seat, ...data, tag, dice } });
}
sp('answer:c2_roll', (s, x, seat, _op, _f, p) => {
  const d = (p?.data ?? {}) as D;
  const ds = Array.from({ length: d.dice ?? 1 }, () => 1 + x.rng.int(6));
  const v = ds.reduce((a, b) => a + b, 0);
  x.ev.push({ type: 'roll', seat, die: v, dice: ds.length > 1 ? ds : undefined });
  ROLLS[d.tag]?.(s, x, d.who ?? seat, v, d);
  void d;
});
function pick(s: CState, x: X, seat: number, tag: string, q: string, opts: Opt[], data: D = {}) {
  if (!opts.length) return;
  if (opts.length === 1 && !data.noauto) {
    PICKS[tag](s, x, seat, opts[0].key, { ...data, tag });
    return;
  }
  ask(s, { seat, q, kind: 'c2_pick', opts, data: { ...data, tag } });
}
sp('answer:c2_pick', (s, x, seat, _op, _f, p, key) => {
  const d = (p?.data ?? {}) as D;
  PICKS[d.tag]?.(s, x, seat, key ?? '', d);
});
const YN: Opt[] = [
  { label: 'Да', key: 'yes' },
  { label: 'Нет', key: 'no' },
];
const pickCell = (s: CState, x: X, seat: number, tag: string, q: string, cells: number[], data: D = {}) =>
  pick(s, x, seat, tag, q, cells.map((c) => ({ label: `${cellName(c)} (${c})`, key: String(c) })), data);

// ---------- поле: расстояния ----------

/** Клетки на ровно d шагов (без возврата на шаг назад); в своём Мире или в любом. */
function reach(from: number, d: number, sameWorld: boolean): number[] {
  const w = worldOf(from);
  const out = new Set<number>();
  const walk = (at: number, prev: number | null, left: number) => {
    if (left === 0) {
      out.add(at);
      return;
    }
    let nx = neighbours(at).filter((m) => m !== prev);
    if (sameWorld && w) nx = nx.filter((m) => worldOf(m) === w);
    if (!nx.length) nx = neighbours(at);
    for (const m of nx) walk(m, at, left - 1);
  };
  walk(from, null, d);
  return [...out].filter((c) => c !== from && !['door', 'fall'].includes(cellKind(c)) && (!sameWorld || !w || worldOf(c) === w));
}
/** Карту n — на d полей от путника (выбирает игрок). */
function moveCardAway(s: CState, x: X, seat: number, n: number, d: number, sameWorld: boolean) {
  const h = H(s, seat);
  let cells = reach(h.cell, d, sameWorld);
  if (!cells.length) cells = neighbours(h.cell);
  pickCell(s, x, seat, 'cardAway', `Куда отправить «${advText(n)?.title ?? n}» (${d} пол.)?`, cells, { n });
}
PICKS.cardAway = (s, x, seat, key, d) => {
  putCard(s, Number(key), { n: d.n });
  say(s, x, seat, `«${advText(d.n)?.title}» уходит на поле «${cellName(Number(key))}».`);
};

// против часовой стрелки
const CENTRE: Partial<Record<World, { x: number; y: number }>> = {};
function centre(w: World) {
  if (!CENTRE[w]) {
    const cs = [];
    for (let n = 1; n < 120; n++) if (neighbours(n).length && worldOf(n) === w && cellGeo(n)) cs.push(cellGeo(n)!);
    CENTRE[w] = { x: cs.reduce((a, c) => a + c.x + c.w / 2, 0) / cs.length, y: cs.reduce((a, c) => a + c.y + c.h / 2, 0) / cs.length };
  }
  return CENTRE[w]!;
}
const angle = (n: number, w: World) => {
  const c = cellGeo(n)!;
  const o = centre(w);
  return Math.atan2(c.y + c.h / 2 - o.y, c.x + c.w / 2 - o.x);
};
function ccwStep(n: number, prev?: number): number {
  const w = worldOf(n);
  const nb = neighbours(n).filter((m) => m !== prev);
  const same = w ? nb.filter((m) => worldOf(m) === w) : nb;
  const list = same.length ? same : nb.length ? nb : neighbours(n);
  if (!w || list.length === 1) return list[0];
  const a0 = angle(n, w);
  const turn = (m: number) => {
    let d = a0 - angle(m, w);
    while (d <= 0) d += Math.PI * 2;
    return d;
  };
  return [...list].sort((a, b) => turn(a) - turn(b))[0];
}

// ---------- маркеры «поселения» ----------

/**
 * on_settled / meet: операции до маркера — при взятии из колоды, после — при встрече с картой на поле. Из колоды дойдя
 * до маркера, сценарий кончается. Встреча на поле (кадр с `guard` от runFieldCard) — продолжаем. Нужна правка engine
 * (runFieldCard начинает с места после маркера) — см. доклад.
 */
const marker: SpecialFn = (s) => {
  const of = outer(s);
  if (!of || of.guard) return;
  stopCard(s);
};
sp('on_settled', marker);
sp('meet', marker);
sp('settled_split', marker);

/** Сфинксы: амулеты, магические предметы и заклинания не действуют (onDraw не предлагает их для NOSKIP). */
sp('no_skip', () => {});
sp('immune_amulets', () => {});
sp('horseshoe_treasure', () => {}); // награда — в arrived2
sp('sorcery_reflect', () => {}); // 138: карта в руке, отражение — holdsReflect
sp('sorcery_pass', () => {}); // 142: передача — onDraw
sp('witchcraft', () => {});

// ---------- 102 единорог ----------

sp('unicorn_give', (s, x, seat) => {
  const g = outer(s)?.guard;
  if (g?.pts) {
    bump(s, x, seat, 'ПУ', g.pts);
    say(s, x, seat, `Единорог отдаёт ${who(s, seat)} ${g.pts} ПУ.`);
  }
});
sp('unicorn_steal', (s, x, seat, _op, f) => {
  const h = H(s, seat);
  const of = outer(s);
  const n = cardOf(s)!;
  const got = bump(s, x, seat, 'ПУ', -1);
  const pts = (of?.guard?.pts ?? 0) + (got ? 1 : 0);
  if (of) of.fated = true;
  if (f.ops[f.i]?.t === 'card') f.i++; // карту кладём сами — вместе с ПУ на ней
  putCard(s, h.cell, { n, pts });
  say(s, x, seat, got ? `Единорог забирает 1 ПУ у ${who(s, seat)}.` : 'Единорог ничего не забрал (нет ПУ).');
});

// ---------- 103 маг ----------

sp('restore_initial', (s, x, seat) => {
  const h = H(s, seat);
  const t = TRAVELLERS[h.tr];
  if (h.life < t.life) bump(s, x, seat, 'ПЖ', t.life - h.life);
  for (const k of STATS) if (h.st[k] < t.st[k]) bump(s, x, seat, k, t.st[k] - h.st[k]);
});

// ---------- 109 боевая ведьма ----------

sp('witch_fly', (s, x, seat) => {
  const n = cardOf(s)!;
  fate(s);
  moveCardAway(s, x, seat, n, 2, false);
});

// ---------- 111 страж сокровищ ----------

sp('guard_depleted', (s, _x, seat) => {
  const n = cardOf(s)!;
  const left = ['магический меч', 'мифриловая кольчуга'].some((nm) => ITEMS.some((i) => i.name === nm && s.shelf.includes(i.id)));
  if (left) return;
  if (takeCard(s, H(s, seat).cell, n)) s.discard.push(n);
  fate(s);
});

// ---------- 119 долг ----------

/** Победитель состязания «спор» — по событиям бросков (воспроизводим перебросы). */
function lastContestWinner(s: CState, x: X): number | undefined {
  const run: { seat: number; die: number }[] = [];
  for (let k = x.ev.length - 1; k >= 0; k--) {
    const e = x.ev[k];
    if (e.type === 'roll' && e.why === 'спор') run.unshift({ seat: e.seat, die: e.die });
    else if (run.length) break;
  }
  let pool = s.seats.filter((o) => alive(s, o));
  let i = 0;
  while (pool.length > 1 && i + pool.length <= run.length) {
    const r = run.slice(i, i + pool.length);
    i += pool.length;
    const top = Math.max(...r.map((e) => e.die));
    pool = r.filter((e) => e.die === top).map((e) => e.seat);
  }
  return pool.length === 1 ? pool[0] : undefined;
}
sp('debt_settle', (s, x, seat) => {
  const h = H(s, seat);
  const n = cardOf(s)!;
  const st = [...h.status].reverse().find((k) => k.k === 'debt' && !(k as D).adv && (k as D).to === 'player') as D | undefined;
  fate(s);
  if (st) {
    st.adv = n;
    st.po = 1;
    st.creditor = lastContestWinner(s, x);
    if (!h.things.some((t) => advOf(t) === n)) giveThing(s, x, seat, { id: `a${n}` });
    say(s, x, seat, `${who(s, seat)} не может рассчитаться сразу — карта долга (вексель) остаётся у него.`);
  } else {
    bump(s, x, seat, 'ПО', 1);
    s.discard.push(n);
  }
});

// ---------- 123 кошелёк, 128 горилла ----------

sp('purse_win', (s, x, seat) => {
  const g = outer(s)?.guard;
  bump(s, x, seat, 'т', 16 + (g?.gold ?? 0));
  say(s, x, seat, `${who(s, seat)} берёт кошелёк (16 т) и деньги грабителя.`);
});
sp('purse_lose', (s, x, seat, _op, f) => {
  const h = H(s, seat);
  const of = outer(s);
  const n = cardOf(s)!;
  const g = h.gold;
  bump(s, x, seat, 'т', -g);
  if (of) of.fated = true;
  if (f.ops[f.i]?.t === 'card') f.i++;
  putCard(s, h.cell, { n, gold: (of?.guard?.gold ?? 0) + g });
  say(s, x, seat, `Кошелёк и ${g} т остаются под охраной грабителя.`);
});
sp('gorilla_loot', (s, x, seat) => {
  const g = outer(s)?.guard;
  for (const t of g?.things ?? []) giveThing(s, x, seat, t);
  if (g?.things?.length) say(s, x, seat, `${who(s, seat)} забирает добычу гориллы.`);
});
sp('gorilla_steal', (s, x, seat, _op, f) => {
  const h = H(s, seat);
  const of = outer(s);
  const n = cardOf(s)!;
  const list = h.things.filter((t) => counts(t) && itemOf(t)?.kind !== 'owned');
  if (f.ops[f.i]?.t === 'settle') f.i++;
  if (of) of.fated = true;
  const stash = [...(of?.guard?.things ?? [])];
  const data = { n, stash };
  if (!list.length) {
    lose(s, x, seat, 'ПС', 2); // ? нечего отдать — компенсация за предмет
    PICKS.gorilla(s, x, seat, '', data);
    return;
  }
  pick(s, x, seat, 'gorilla', 'Что отнимет горилла?', list.map((t) => ({ label: thingName(t), key: t.id })), data);
});
PICKS.gorilla = (s, x, seat, key, d) => {
  const h = H(s, seat);
  const stash: Thing[] = d.stash;
  const t = h.things.find((k) => k.id === key);
  if (t) {
    dropThing(s, x, seat, t, 'none');
    stash.push(t);
    say(s, x, seat, `Горилла забирает: ${thingName(t)}.`);
  }
  const c = cellsNamed('Джунгли')[0];
  putCard(s, c, { n: d.n, settled: true, things: stash });
  say(s, x, seat, 'Горилла уходит в «Джунгли».');
};

// ---------- 124/125 импат, граната ----------

sp('ccw_to_lazaret', (s, x, seat) => {
  const h = H(s, seat);
  let at = h.cell;
  let prev: number | undefined;
  for (let k = 0; k < 80 && !neighbours(at).includes(18) && at !== 18; k++) {
    const nx = ccwStep(at, prev);
    prev = at;
    at = nx;
    x.ev.push({ type: 'step', seat, cell: at });
  }
  // уже на «Лазарете» — карту импата, оставленную здесь, заново не встречаем: только условия поля
  if (h.cell === 18) cellConditions(s, x, seat, true);
  else placeAt(s, x, seat, 18, true);
});
sp('use_grenade', (s, x, seat) => {
  const t = H(s, seat).things.find((k) => itemOf(k)?.name === 'граната');
  if (!t) return;
  dropThing(s, x, seat, t, 'shelf');
  say(s, x, seat, `${who(s, seat)} бросает гранату — импат уничтожен.`);
});

// ---------- 129 проклятие на друга ----------

sp('curse_friend', (s, x, seat) => {
  const h = H(s, seat);
  const of = outer(s);
  const n = cardOf(s)!;
  let fn: number | undefined;
  const fieldFriend = (s.field[h.cell] ?? []).find((c) => c.n > 0 && c.n !== n && (advText(c.n)?.kind ?? '').toLowerCase().startsWith('друг'));
  if (of?.guard && fieldFriend) fn = fieldFriend.n;
  else {
    const fr = [...h.friends].sort((a, b) => (ADV[advOf(a)!]?.stats?.ПМ ?? 0) - (ADV[advOf(b)!]?.stats?.ПМ ?? 0))[0]; // ? равные ПМ — первый
    fn = fr ? advOf(fr) : undefined;
  }
  if (fn == null) return;
  const st = ADV[fn]?.stats ?? {};
  const m = (v?: number) => (v == null ? undefined : v * 5);
  const title = advText(fn)?.title ?? 'друг';
  say(s, x, seat, `«${title}» под проклятием нападает на ${who(s, seat)}: все качества ×5.`);
  startFight(
    s, x, seat,
    {
      t: 'battle',
      foe: { name: `${title} (×5)`, ПС: m(st.ПС), ПУ: m(st.ПУ), ПМ: m(st.ПМ), kind: 'враг' },
      win: [{ t: 'special', id: 'curse_win', n: fn }],
      lose: [{ t: 'special', id: 'curse_lose', n: fn }],
      draw: [{ t: 'special', id: 'curse_draw', n: fn }],
    },
    undefined,
  );
});
/** Забрать карту друга n у путника или с поля; вернуть, откуда. */
function pullFriend(s: CState, x: X, seat: number, fn: number, to: 'discard' | 'field') {
  const h = H(s, seat);
  const own = h.friends.find((k) => advOf(k) === fn);
  if (own) dropThing(s, x, seat, own, to);
  else if (takeCard(s, h.cell, fn)) {
    if (to === 'discard') s.discard.push(fn);
    else putCard(s, h.cell, { n: fn });
  }
}
sp('curse_win', (s, x, seat, op) => {
  bump(s, x, seat, 'ПО', 2);
  pullFriend(s, x, seat, op.n!, 'discard');
  const n = cardOf(s);
  fate(s);
  if (n) s.discard.push(n);
});
sp('curse_lose', (s, x, seat, op) => {
  const h = H(s, seat);
  const n = cardOf(s);
  lose(s, x, seat, 'ПЖ', 1);
  bump(s, x, seat, 'ПО', 2);
  pullFriend(s, x, seat, op.n!, 'field');
  fate(s);
  if (n) putCard(s, h.cell, { n });
});
sp('curse_draw', (s, x, seat, op) => {
  const h = H(s, seat);
  const n = cardOf(s);
  pullFriend(s, x, seat, op.n!, 'field'); // ? обе карты остаются на поле
  fate(s);
  if (n) putCard(s, h.cell, { n });
});

// ---------- 131 ночь полнолуния ----------

sp('full_moon', (s, x, seat) => {
  const queue: { w: number; v: number }[] = [];
  const act = s.seats.filter((o) => H(s, o).zone === 'world' && H(s, o).sector == null);
  for (const w of act.filter((o) => H(s, o).align === 'злой')) {
    const dist = distances(H(s, w).cell);
    const ww = worldOf(H(s, w).cell);
    const power = STATS.reduce((a, k) => a + H(s, w).st[k], 0);
    say(s, x, w, `${who(s, w)} превращается в волка (сила ${power}).`);
    for (const v of act) {
      const vh = H(s, v);
      if (v === w || vh.align === 'злой' || isImmune(s, v) || worldOf(vh.cell) !== ww) continue;
      if ((dist.get(vh.cell) ?? 99) <= 6) queue.push({ w, v });
    }
  }
  if (!queue.length) return;
  c2(s).moon = queue;
  // драйвер — под кадром карты: stopCard при боях не срежет очередь
  const of = outer(s);
  const k = of ? s.run.indexOf(of) : s.run.length;
  s.run.splice(k, 0, { seat, ops: [{ t: 'special', id: 'moon_next' }], i: 0 });
});
sp('moon_next', (s, _x, _seat, _op, f) => {
  const q = c2(s).moon;
  let nx = q?.shift();
  while (nx && (!alive(s, nx.w) || !alive(s, nx.v))) nx = q?.shift();
  if (!nx) return;
  c2(s).moonCur = nx;
  push(s, { seat: f.seat, ops: [{ t: 'special', id: 'moon_attack' }, { t: 'special', id: 'moon_next' }] });
});
sp('moon_attack', (s, x, seat) => {
  const cur = c2(s).moonCur;
  if (!cur) return;
  const power = STATS.reduce((a, k) => a + H(s, cur.w).st[k], 0);
  startFight(
    s, x, cur.v,
    { t: 'battle', stat: 'ПС', foe: { name: `волк (${who(s, cur.w)})`, ПС: power }, win: [], lose: [{ t: 'special', id: 'moon_win' }], draw: [] },
    undefined,
  );
  if (s.fight) (s.fight as D).moon = cur.w;
  say(s, x, seat, `Волк (${who(s, cur.w)}) нападает на ${who(s, cur.v)}.`);
});
sp('moon_win', (s, x) => {
  const cur = c2(s).moonCur;
  if (!cur) return;
  const took = -lose2(s, x, cur.v, 'ПЖ', 2);
  bump(s, x, cur.w, 'ПЖ', took);
  say(s, x, cur.v, `Волк отнимает ${took} ПЖ у ${who(s, cur.v)}.`);
  pokeDeath(s, cur.v);
});
/** Потеря ПЖ напрямую; возвращает изменение (<= 0). */
const lose2 = (s: CState, x: X, seat: number, p: 'ПЖ' | 'ПУ', n: number) => bump(s, x, seat, p, -n);

// ---------- 132 волколак ----------

interface Wolf {
  life: number;
  ps: number;
  pm: number;
  pj: number;
}
const wolfOf = (fc?: FieldCard): Wolf => ((fc as D | undefined)?.wolf as Wolf | undefined) ?? { life: ADV[132].stats?.ПЖ ?? 2, ps: 0, pm: 0, pj: 0 };
sp('werewolf_wound', (s, x, seat) => {
  const h = H(s, seat);
  const w = wolfOf(outer(s)?.guard);
  w.life -= 1;
  fate(s);
  if (w.life <= 0) {
    bump(s, x, seat, 'ПЖ', w.pj);
    bump(s, x, seat, 'ПС', w.ps);
    bump(s, x, seat, 'ПМ', w.pm);
    s.discard.push(132);
    say(s, x, seat, `Волколак убит — ${who(s, seat)} забирает отнятые им пункты.`);
  } else putCard(s, h.cell, { n: 132, wolf: w } as FieldCard);
});
sp('werewolf_absorb', (s, x, seat) => {
  const h = H(s, seat);
  const w = wolfOf(outer(s)?.guard);
  w.life++;
  w.pj++;
  w.ps++;
  w.pm++;
  fate(s);
  putCard(s, h.cell, { n: 132, wolf: w } as FieldCard);
  say(s, x, seat, 'Волколак присоединяет отнятые пункты к своим.');
});

// ---------- 139/134 заклинания, 148/182 источники, 149 бизон, 150 палица ----------

sp('discard_spell1', (s, x, seat) => {
  for (const t of [...H(s, seat).things]) if (itemOf(t)?.name === 'заклинание №1') dropThing(s, x, seat, t, 'shelf');
});
sp('drop_spells12', (s, x, seat) => {
  for (const t of [...H(s, seat).things]) if (/^заклинание №[12]$/.test(itemOf(t)?.name ?? '')) dropThing(s, x, seat, t, 'shelf');
});
sp('settle_prairie', (s, x, seat) => {
  const of = outer(s);
  if (!of || of.guard) return;
  of.fated = true;
  pickCell(s, x, seat, 'prairie', 'На какой «Прерии» пасётся бизон?', cellsNamed('Прерия'), { n: of.card });
});
PICKS.prairie = (s, x, seat, key, d) => {
  putCard(s, Number(key), { n: d.n, settled: true });
  say(s, x, seat, `Бизон поселяется на поле «${cellName(Number(key))}».`);
  const of = outer(s);
  if (of) s.run.length = Math.max(0, s.run.indexOf(of));
};
sp('thunder_club', (s, x, seat) => {
  const h = H(s, seat);
  const n = cardOf(s)!;
  fate(s);
  const t: Thing = { id: `a${n}` };
  giveThing(s, x, seat, t);
  if (h.things.includes(t)) {
    (t as D).c2bonus = true;
    bump(s, x, seat, 'ПС', 2);
    bump(s, x, seat, 'ПМ', 2);
  }
});
/** Вещь потеряна (вызывать из dropThing): палица грома забирает свои +2 ПС, +2 ПМ. */
export function thingLost(s: CState, x: X, seat: number, t: Thing) {
  if (advOf(t) === 150 && (t as D).c2bonus) {
    (t as D).c2bonus = false;
    lose(s, x, seat, 'ПС', 2);
    lose(s, x, seat, 'ПМ', 2);
  }
}

// ---------- 167/187 снятие проклятий, 168 зомби, 173 круг, 175 дождь ----------

sp('after_status_po', (s, x, seat, op) => {
  const n = cardOf(s)!;
  fate(s);
  giveThing(s, x, seat, { id: `a${n}`, c2po: op.n ?? 2 } as Thing);
});
sp('zombie_power', () => {}); // ПС зомби считает adjustFoe (пересчёт в pre2)
sp('zombie_away', (s, x, seat) => {
  const n = cardOf(s)!;
  fate(s);
  moveCardAway(s, x, seat, n, lastRoll(x, seat), true);
});
sp('again', (s, _x, _seat, _op, f) => {
  const n = cardOf(s);
  if (n && ADV[n]) sub(s, f, ADV[n].ops);
});

const WEAPON = /кольт|бластер|ружь|меч/;
function bloodList(h: CHero): Thing[] {
  return h.things.filter((t) => {
    const a = advOf(t);
    if (a != null) return TROPHIES.has(a) || ADV[a]?.kind === 'предмет';
    const i = itemOf(t);
    return !!i && (i.kind === 'item' || (i.kind === 'owned' && WEAPON.test(i.name)));
  });
}
const bloodPrice = (t: Thing) => (advOf(t) != null && TROPHIES.has(advOf(t)!) ? 3 : 5);
sp('blood_rain', (s, x, seat) => PICKS.blood(s, x, seat, 'start', { ids: bloodList(H(s, seat)).map((t) => t.id) }));
PICKS.blood = (s, x, seat, key, d) => {
  const h = H(s, seat);
  let ids: string[] = d.ids;
  if (key !== 'start') {
    if (key === 'stop') {
      for (const id of ids) {
        const t = h.things.find((k) => k.id === id);
        if (t) dropThing(s, x, seat, t, 'shelf');
      }
      return;
    }
    const t = h.things.find((k) => k.id === key);
    if (t) bump(s, x, seat, 'т', -bloodPrice(t));
    ids = ids.filter((i) => i !== key);
  }
  const left = ids.map((i) => h.things.find((k) => k.id === i)).filter((t): t is Thing => !!t);
  if (!left.length) return;
  const total = left.reduce((a, t) => a + bloodPrice(t), 0);
  if (total <= h.gold) {
    bump(s, x, seat, 'т', -total);
    say(s, x, seat, `${who(s, seat)} оплачивает ремонт: ${total} т.`);
    return;
  }
  const ok = left.filter((t) => bloodPrice(t) <= h.gold);
  if (!ok.length) {
    for (const t of left) dropThing(s, x, seat, t, 'shelf');
    say(s, x, seat, 'Денег на ремонт не хватило — остальное отложено.');
    return;
  }
  pick(s, x, seat, 'blood', `Кровавый дождь: что починить (у тебя ${h.gold} т)?`, [...ok.map((t) => ({ label: `${thingName(t)} — ${bloodPrice(t)} т`, key: t.id })), { label: 'Больше не платить (остальное отложить)', key: 'stop' }], { ids: left.map((t) => t.id), noauto: true });
};

// ---------- 188 пленник эпицентра, 197 ворон ----------

sp('epicenter_captive', (s, x, seat, op) => {
  hx(H(s, seat)).captive = { po: op.n ?? 2 };
  say(s, x, seat, `${who(s, seat)} остаётся в плену на «Эпицентре».`);
});
sp('raven', (s, x, seat) => {
  const h = H(s, seat);
  const n = cardOf(s)!;
  fate(s);
  pickCell(s, x, seat, 'raven', 'На какое соседнее поле уйдут друзья?', neighbours(h.cell), { n });
});
PICKS.raven = (s, x, seat, key, d) => {
  const h = H(s, seat);
  const cell = Number(key);
  const friends: Thing[] = JSON.parse(JSON.stringify(h.friends));
  for (const fr of [...h.friends]) {
    dropThing(s, x, seat, fr, 'none');
    putCard(s, cell, { n: advOf(fr)! });
  }
  hx(h).raven = { friends, cell, world: worldOf(h.cell) ?? '' };
  giveThing(s, x, seat, { id: `a${d.n}` });
  say(s, x, seat, 'Друзья покидают путника; ворон улетит, когда он покинет Мир.');
};

// ---------- хук прихода на поле: снятие проклятий, ворон, подкова ----------

export function arrived2(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (h.zone !== 'world') return;
  for (const t of [...h.things]) {
    const a = advOf(t);
    if (a == null) continue;
    if ((t as D).c2po != null) {
      const free = a === 167 ? !h.status.some((st) => st.k === 'drain' && st.p === 'ПМ') : a === 187 ? !h.status.some((st) => st.k === 'cap') : false;
      if (free) {
        bump(s, x, seat, 'ПО', (t as D).c2po);
        dropThing(s, x, seat, t, 'discard');
        say(s, x, seat, `«${advText(a)?.title}» снято: +${(t as D).c2po} ПО.`);
      }
    }
    if (a === 140 && norm(cellName(h.cell)) === 'ВЕДЬМИН ЛУГ') {
      bump(s, x, seat, 'т', 20);
      bump(s, x, seat, 'ПО', 1);
      dropThing(s, x, seat, t, 'discard');
      say(s, x, seat, `${who(s, seat)} находит клад на «Ведьмином лугу»: 20 т и 1 ПО.`); // ? без срока в 3 хода
    }
  }
  const rv = hx(h).raven;
  const w = worldOf(h.cell);
  if (rv && w && w !== rv.world) {
    for (const fr of rv.friends) if (takeCard(s, rv.cell, advOf(fr)!)) h.friends.push(fr);
    delete hx(h).raven;
    bump(s, x, seat, 'ПО', 1);
    const raven = things(h, 197);
    if (raven) dropThing(s, x, seat, raven, 'discard');
    say(s, x, seat, `Ворон улетел — друзья вернулись к ${who(s, seat)}.`);
  }
}

// ---------- беспечность друзей ----------

const CAREFREE: Record<number, string[]> = {
  15: ['Эпицентр'], 18: ['Эпицентр', 'Кладбище'], 22: ['Заросли кактусов', 'Перевал'], 25: ['Маковые заросли'],
  130: ['Выжженная земля', 'Маковые заросли'], 145: ['Заросли кактусов', 'Эпицентр'], 154: ['Перевал'], 195: ['Топь', 'Пустыня'],
};
/** Условия поля можно не выполнять (друг-беспечник, бурдюк на «Пустыне»). true — задан вопрос (engine дальше не идёт). */
export function carefreeAsk(s: CState, x: X, seat: number, ops: Op[]): boolean {
  const h = H(s, seat);
  if (h.zone !== 'world') return false;
  const here = norm(cellName(h.cell));
  const by = h.friends.some((f) => CAREFREE[advOf(f) ?? 0]?.some((c) => norm(c) === here)) || (here === 'ПУСТЫНЯ' && hasItem(h, 'бурдюк с водой'));
  if (!by) return false;
  pick(s, x, seat, 'carefree', `Беспечность: не выполнять условия поля «${cellName(h.cell)}»?`, [{ label: 'Не выполнять', key: 'yes' }, { label: 'Выполнить', key: 'no' }], { ops, cell: h.cell, noauto: true });
  return true;
}
PICKS.carefree = (s, _x, seat, key, d) => {
  if (key === 'no') push(s, { seat, ops: d.ops, cell: d.cell });
};

// ---------- мухомор, корень лофофоры ----------

export const useList = (s: CState, seat: number): { id: string; label: string }[] =>
  H(s, seat).things.filter((t) => advOf(t) === 163 || advOf(t) === 164).map((t) => ({ id: t.id, label: advOf(t) === 163 ? 'Съесть мухомор' : 'Съесть корень лофофоры' }));
/** Применить вещь в удобный момент; true — это моя вещь и она применена. */
export function useThing(s: CState, x: X, seat: number, id: string): boolean {
  const h = H(s, seat);
  const t = h.things.find((k) => k.id === id);
  const a = t && advOf(t);
  if (!t || (a !== 163 && a !== 164) || hx(h).mush) return false;
  const orig = { ...h.st };
  const sum = orig.ПС + orig.ПУ + orig.ПМ;
  const to: Stat = a === 163 ? 'ПС' : 'ПУ';
  const after = { ПС: 0, ПУ: 0, ПМ: 0 };
  after[to] = sum;
  h.st = { ...after };
  hx(h).mush = { after, orig, left: s.turn === seat ? 1 : 2 };
  dropThing(s, x, seat, t, 'discard');
  say(s, x, seat, `${who(s, seat)} съедает ${a === 163 ? 'мухомор' : 'корень лофофоры'}: ${sum} в ${to} на 1 ход.`);
  return true;
}
function revertMush(s: CState, seat: number) {
  const h = H(s, seat);
  const m = hx(h).mush;
  if (!m || --m.left > 0) return;
  for (const k of STATS) h.st[k] = Math.max(0, h.st[k] - m.after[k] + m.orig[k]);
  delete hx(h).mush;
}

// ---------- карты в руке: «взяв карту приключений» ----------

function findFrame(s: CState, n: number): FX | undefined {
  return [...s.run].reverse().find((fr) => fr.card === n && fr.i === 0) as FX | undefined;
}
/** Не выполнять карту n (кадр снимаем): судьба — leave / middle / discard / none. */
function cancelDrawn(s: CState, seat: number, n: number, how: 'leave' | 'middle' | 'discard' | 'none') {
  const f = findFrame(s, n);
  if (f) s.run.splice(s.run.indexOf(f), 1);
  const h = H(s, seat);
  if (how === 'leave') putCard(s, h.cell, { n });
  else if (how === 'middle') toMiddle(s, n);
  else if (how === 'discard') s.discard.push(n);
}
function passCard(s: CState, x: X, seat: number, n: number): boolean {
  const nx = nextSeat(s, seat);
  if (nx == null || isImmune(s, nx)) return false;
  cancelDrawn(s, seat, n, 'none');
  push(s, { seat: nx, ops: ADV[n].ops, card: n, at: H(s, nx).cell });
  say(s, x, seat, `Карта «${advText(n)?.title}» уходит к ${who(s, nx)}.`);
  return true;
}
function consume(s: CState, x: X, seat: number, t: Thing) {
  const left = (t.uses ?? itemOf(t)?.uses ?? 1) - 1;
  if (left <= 0) dropThing(s, x, seat, t, 'shelf');
  else t.uses = left;
}

/**
 * Хук «взял карту — можешь не выполнять». Вызывать в run(), когда `f.i === 0 && f.card`, ПЕРЕД событием карты:
 * `if (onDraw(s, x, f.seat, f.card)) continue;` — true: вопрос задан или карта снята, шаг кадра не делать, цикл run
 * крутить дальше (кадр, если остался, при следующем заходе сам вернёт false после «Выполнить карту»).
 */
export function onDraw(s: CState, x: X, seat: number, n: number): boolean {
  const h = H(s, seat);
  const f = [...s.run].reverse().find((fr) => fr.card === n && fr.seat === seat) as FX | undefined;
  if (!f || f.c2go) return false;
  if (NOSKIP.has(n) || h.zone !== 'world' || h.sector != null) {
    f.c2go = true;
    return false;
  }
  const used = (f.c2used ??= []);
  const drawn = !f.guard;
  const opts: Opt[] = [];
  const add = (label: string, key: string) => {
    if (!used.includes(key)) opts.push({ label, key });
  };
  const nx = nextSeat(s, seat);
  const passOk = nx != null && !isImmune(s, nx);
  for (const t of h.things) {
    if (!can(h, t)) continue;
    const i = itemOf(t);
    const a = advOf(t);
    if (i?.kind === 'amulet' && i.num === 7) add('Амулет №7: не выполнять карту', `a7:${t.id}`);
    if (i?.name === 'бутылка виски') add('Бутылка виски: не выполнять (карта — в середину колоды)', `wsk:${t.id}`);
    if (drawn && i?.name === 'заклинание №2') add('Заклинание №2', `sp2:${t.id}`);
    if (drawn && i?.name === 'заклинание №3') add('Заклинание №3', `sp3:${t.id}`);
    if (drawn && a === 165) add('Волшебный посох', `staff:${t.id}`);
    if (drawn && passOk && (a === 142 || a === 194)) add('Колдовство: передать карту следующему игроку', `sorc:${t.id}`);
  }
  if (drawn && isTr(h, /МОНАХ/)) add('Монах: прочитать молитву', 'monk');
  if (drawn && isTr(h, /КОРОЛЕВА ВЕДЬМ/)) add('Королева ведьм: заколдовать карту', 'queen');
  if (h.status.some((st) => st.k === 'invisible')) add('Невидимость: не выполнять карту', 'invis');
  if (!opts.length) {
    f.c2go = true;
    return false;
  }
  pick(s, x, seat, 'draw', `Взята карта №${n} «${advText(n)?.title}». Что делаешь?`, [{ label: 'Выполнить карту', key: 'go' }, ...opts], { card: n, noauto: true });
  return true;
}
PICKS.draw = (s, x, seat, key, d) => {
  const n: number = d.card;
  const f = findFrame(s, n);
  if (!f) return;
  if (key === 'go') {
    f.c2go = true;
    return;
  }
  (f.c2used ??= []).push(key);
  const h = H(s, seat);
  const [kind, id] = key.split(':');
  const t = h.things.find((k) => k.id === id);
  const data = { card: n, id };
  switch (kind) {
    case 'a7':
      if (t) consume(s, x, seat, t);
      say(s, x, seat, `${who(s, seat)} не выполняет карту (амулет №7).`);
      cancelDrawn(s, seat, n, 'leave');
      return;
    case 'wsk':
      if (t) dropThing(s, x, seat, t, 'shelf');
      say(s, x, seat, `${who(s, seat)} не выполняет карту (виски).`);
      cancelDrawn(s, seat, n, 'middle');
      return;
    case 'sp2':
    case 'sp3':
      if (t) consume(s, x, seat, t);
      askRoll(s, seat, kind, `Заклинание №${kind === 'sp2' ? 2 : 3}: брось кубик`, data);
      return;
    case 'staff':
      askRoll(s, seat, 'staff', 'Посох: брось кубик', data);
      return;
    case 'sorc':
      if (t) dropThing(s, x, seat, t, 'discard');
      passCard(s, x, seat, n);
      return;
    case 'monk':
      askRoll(s, seat, 'monk', 'Молитва: брось кубик', data);
      return;
    case 'queen':
      askRoll(s, seat, 'queen', 'Заколдовать карту: брось кубик', data);
      return;
    case 'invis':
      say(s, x, seat, `${who(s, seat)} невидим и не выполняет карту.`);
      cancelDrawn(s, seat, n, 'leave'); // ? карта остаётся на поле
  }
};
ROLLS.sp2 = (s, x, seat, d, data) => {
  if (d <= 3) {
    say(s, x, seat, 'Заклинание подействовало: карту можно не выполнять.');
    cancelDrawn(s, seat, data.card, 'leave');
  } else {
    bump(s, x, seat, 'ПЖ', 1);
    bump(s, x, seat, 'ПС', 1);
  }
};
ROLLS.sp3 = (s, x, seat, d, data) => {
  if (d <= 4) {
    say(s, x, seat, 'Заклинание подействовало: карту можно не выполнять.');
    cancelDrawn(s, seat, data.card, 'leave');
  } else bump(s, x, seat, 'ПЖ', 2);
};
ROLLS.monk = (s, x, seat, d, data) => {
  if (d !== 6) return;
  say(s, x, seat, 'Молитва подействовала: карта остаётся на поле.');
  cancelDrawn(s, seat, data.card, 'leave');
};
ROLLS.queen = (s, x, seat, d, data) => {
  if (d !== 6) return;
  cancelDrawn(s, seat, data.card, 'none');
  say(s, x, seat, 'Карта заколдована и уходит.');
  moveCardAway(s, x, seat, data.card, 6, false);
};
ROLLS.staff = (s, x, seat, d, data) => {
  const h = H(s, seat);
  if (d <= 2) {
    cancelDrawn(s, seat, data.card, 'none');
    moveCardAway(s, x, seat, data.card, 1, false);
  } else if (d <= 4) {
    passCard(s, x, seat, data.card);
  } else {
    lose(s, x, seat, 'ПС', 2);
    const st = things(h, 165);
    if (st) dropThing(s, x, seat, st, 'discard');
    say(s, x, seat, 'Посох исчез.');
  }
};

// ---------- до боя / после поражения ----------

/** Пересчёт показателей противника (зомби, волколак) — один раз за бой. */
function adjustFoe(s: CState, f: Fight) {
  const ff = f as Fight & { c2adj?: boolean };
  if (ff.c2adj) return;
  ff.c2adj = true;
  if (f.card === 168) f.foe.v = TRAVELLERS[H(s, f.seat).tr].st.ПС + 6;
  if (f.card === 132) {
    const w = wolfOf(outer(s)?.guard);
    f.foe.v += f.foe.stat === 'ПС' ? w.ps : f.foe.stat === 'ПМ' ? w.pm : 0;
  }
}
const foeStays = (s: CState, f: Fight) => {
  s.fight = null;
  leaveFoe(s, f);
};
function foeAway(s: CState, x: X, f: Fight, dist: number) {
  s.fight = null;
  const of = outer(s);
  if (f.card && of && !of.fated) {
    of.fated = true;
    moveCardAway(s, x, f.seat, f.card, dist, false);
  }
  stopCard(s);
}

export function pre2(s: CState, f: Fight): Opt[] {
  adjustFoe(s, f);
  const h = H(s, f.seat);
  const out: Opt[] = [];
  if (h.sector != null || h.zone !== 'world') return out;
  const w = worldOf(h.cell);
  const stat = f.foe.stat;
  for (const t of h.things) {
    const a = advOf(t);
    if (a == null || !can(h, t)) continue;
    if (a === 153 && w === 'Магия' && f.card) out.push({ label: 'Зеркало', key: 'mirror' });
    if (a === 199 && f.card) out.push({ label: 'Нергал', key: 'nergal' });
    if (a === 163 && stat === 'ПС') out.push({ label: 'Съесть мухомор (ПС = ПС+ПУ+ПМ)', key: 'mush' });
    if (a === 164 && stat === 'ПУ') out.push({ label: 'Съесть корень лофофоры (ПУ = ПС+ПУ+ПМ)', key: 'loph' });
  }
  if (f.card && h.friends.some((k) => advOf(k) === 102)) out.push({ label: 'Единорог защитит?', key: 'unicorn' });
  if ((f as D).moon != null && h.things.some((t) => counts(t) && itemOf(t)?.kind !== 'owned')) out.push({ label: 'Откупиться от волка вещью', key: 'moonpay' });
  if (isTr(h, /ЦЫГАН/) && f.foe.kind === 'змеи и драконы') out.push({ label: 'Цыган: заклинание на змей и драконов', key: 'gypsy' });
  if (isTr(h, /ОБОРОТЕНЬ/) && f.card && !h.friends.some((k) => (k as D).wolf)) out.push({ label: 'Оборотень: подружиться с противником', key: 'wolf' });
  if (isTr(h, /УЧ[ЕЁ]НЫЙ/) && stat === 'ПУ') out.push({ label: 'Учёный: добавить 1 ПУ', key: 'sage' });
  if (isTr(h, /РАЗРУШИТЕЛЬ/) && stat === 'ПС') out.push({ label: 'Разрушитель: добавить 2 ПС', key: 'destroyer' });
  if (isTr(h, /ГУСАР/) && f.card) out.push({ label: 'Гусар: устрашить противника', key: 'hussar' });
  return out;
}
export function post2(s: CState, f: Fight): Opt[] {
  const h = H(s, f.seat);
  const out: Opt[] = [];
  if (h.sector != null || h.zone !== 'world') return out;
  if (h.things.some((t) => itemOf(t)?.name === 'заклинание №1' && can(h, t))) out.push({ label: 'Заклинание №1', key: 'sp1' });
  if (isTr(h, /ЗНАХАРКА/)) out.push({ label: 'Знахарка: залечить раны', key: 'healer' });
  if (isTr(h, /ГЛАДИАТОР/) && nextSeat(s, f.seat) != null) out.push({ label: 'Гладиатор: судьбу решит следующий игрок', key: 'glad' });
  if (isTr(h, /ИНОПЛАНЕТЯНИН/)) out.push({ label: 'Инопланетянин: телепортироваться', key: 'alien' });
  if (isTr(h, /НАЁМНИК/) && f.diff === -1) out.push({ label: 'Наёмник: не засчитывать поражение (на 1 очко)', key: 'merc' });
  if (isTr(h, /НИНДЗЯ/)) out.push({ label: 'Ниндзя: стать невидимым', key: 'ninja' });
  if (isTr(h, /РАЗРУШИТЕЛЬ/)) out.push({ label: 'Разрушитель: защитное поле', key: 'shield' });
  return out;
}

const preRoll = (tag: string, q: string): SpecialFn => (s, _x, seat, op) => {
  const f = s.fight!;
  f.used.push(op.id);
  askRoll(s, seat, tag, q);
};
sp('pre:unicorn', preRoll('unicorn', 'Единорог: брось кубик (1–4 защитил)'));
sp('pre:mirror', preRoll('mirror', 'Зеркало: брось кубик (1–4 противник уходит)'));
sp('pre:nergal', preRoll('nergal', 'Нергал: брось кубик'));
sp('pre:gypsy', preRoll('gypsy', 'Заклинание Цыгана: брось кубик (1–2)'));
sp('pre:sage', preRoll('sage', 'Учёный: брось кубик (1–2 — +1 ПУ)'));
sp('pre:destroyer', preRoll('destroyer', 'Разрушитель: брось кубик (5–6 — +2 ПС)'));
sp('pre:hussar', preRoll('hussar', 'Гусар: брось кубик (1 — противник устрашен)'));
sp('pre:wolf', (s, _x, seat, op) => {
  s.fight!.used.push(op.id);
  askRoll(s, seat, 'wolf', 'Оборотень: дважды брось кубик (11–12 — друг)', {}, 2);
});
ROLLS.unicorn = (s, x, seat, d) => {
  const f = s.fight;
  if (!f) return;
  if (d <= 4) {
    say(s, x, seat, 'Единорог защитил путника — противник не нападает.');
    foeStays(s, f);
    return;
  }
  const h = H(s, seat);
  const u = h.friends.find((k) => advOf(k) === 102);
  if (u) dropThing(s, x, seat, u, 'none');
  say(s, x, seat, 'Единорог уходит — бейся сам.');
  moveCardAway(s, x, seat, 102, 1, false);
};
ROLLS.mirror = (s, x, seat, d) => {
  const f = s.fight;
  if (!f) return;
  if (d <= 4) {
    say(s, x, seat, 'Зеркало: противник уходит.');
    foeAway(s, x, f, 1);
    return;
  }
  const t = things(H(s, seat), 153);
  if (t) dropThing(s, x, seat, t, 'discard');
  say(s, x, seat, 'Зеркало исчезло — бейся сам.');
};
ROLLS.nergal = (s, x, seat, d) => {
  const f = s.fight;
  const h = H(s, seat);
  const t = things(h, 199);
  if (!f) return;
  if (d <= 2) {
    if (t) dropThing(s, x, seat, t, 'none');
    say(s, x, seat, 'Нергал улетел — бейся сам.');
    moveCardAway(s, x, seat, 199, 1, false);
  } else if (d <= 5) {
    say(s, x, seat, 'Нергал защитил: противник не нападает.');
    foeStays(s, f);
  } else {
    if (t) dropThing(s, x, seat, t, 'discard');
    say(s, x, seat, 'Нергал исчез — бейся сам.');
  }
};
ROLLS.gypsy = (s, x, seat, d) => {
  const f = s.fight;
  if (f && d <= 2) {
    say(s, x, seat, 'Заклинание подействовало: змеи и драконы не нападают.');
    foeStays(s, f);
  }
};
ROLLS.sage = (s, x, seat, d) => {
  if (s.fight && d <= 2) {
    s.fight.boost += 1;
    say(s, x, seat, 'Учёный добавляет себе 1 ПУ на время битвы.');
  }
};
ROLLS.destroyer = (s, x, seat, d) => {
  if (s.fight && d >= 5) {
    s.fight.boost += 2;
    say(s, x, seat, 'Разрушитель добавляет себе 2 ПС на время битвы.');
  }
};
ROLLS.hussar = (s, x, seat, d) => {
  const f = s.fight;
  if (f && d === 1) {
    say(s, x, seat, 'Противник устрашён и уходит.');
    foeAway(s, x, f, 1);
  }
};
ROLLS.wolf = (s, x, seat, d) => {
  const f = s.fight;
  if (!f || d < 11 || !f.card) return;
  const h = H(s, seat);
  const n = f.card;
  s.fight = null;
  const of = outer(s);
  if (of) of.fated = true;
  const fr: Thing = { id: `a${n}`, with: 'вместо' };
  (fr as D).wolf = true;
  h.friends.push(fr);
  x.ev.push({ type: 'thing', seat, id: fr.id, gain: true });
  say(s, x, seat, `«${advText(n)?.title}» становится другом Оборотня и бьётся вместо него.`);
  stopCard(s);
};
sp('pre:mush', (s, x, seat, op) => {
  s.fight!.used.push(op.id);
  const t = things(H(s, seat), 163);
  if (t) useThing(s, x, seat, t.id);
});
sp('pre:loph', (s, x, seat, op) => {
  s.fight!.used.push(op.id);
  const t = things(H(s, seat), 164);
  if (t) useThing(s, x, seat, t.id);
});
sp('pre:moonpay', (s, x, seat, op) => {
  s.fight!.used.push(op.id);
  const h = H(s, seat);
  pick(s, x, seat, 'moonpay', 'Что отдаёшь волку?', h.things.filter((t) => counts(t) && itemOf(t)?.kind !== 'owned').map((t) => ({ label: thingName(t), key: t.id })), { wolf: (s.fight as D).moon, noauto: true });
});
PICKS.moonpay = (s, x, seat, key, d) => {
  const t = H(s, seat).things.find((k) => k.id === key);
  if (!t) return;
  dropThing(s, x, seat, t, 'none');
  giveThing(s, x, d.wolf, t);
  say(s, x, seat, `${who(s, seat)} откупается от волка: ${thingName(t)}.`);
  s.fight = null;
};

// после поражения
const postRoll = (tag: string, q: string, whoRolls?: (s: CState, seat: number) => number): SpecialFn => (s, _x, seat) => {
  const roller = whoRolls ? whoRolls(s, seat) : seat;
  askRoll(s, roller, tag, q, { who: seat });
};
sp('post:sp1', (s, x, seat) => {
  const t = H(s, seat).things.find((k) => itemOf(k)?.name === 'заклинание №1');
  if (t) consume(s, x, seat, t);
  askRoll(s, seat, 'sp1', 'Заклинание №1: брось кубик (1–4 — невидим, 5–6 — +1 ПЖ и условия карты противника)', { who: seat });
});
ROLLS.sp1 = (s, x, seat, d) => {
  if (!s.fight) return;
  if (d <= 4) {
    say(s, x, seat, 'Заклинание №1: путник невидим — условия карты противника не выполняются.');
    foeStays(s, s.fight);
  } else bump(s, x, seat, 'ПЖ', 1);
};
sp('post:healer', postRoll('healer', 'Знахарка лечит раны: брось кубик (5)'));
sp('post:glad', postRoll('glad', 'Судьба Гладиатора: брось кубик (4 — помилован)', (s, seat) => nextSeat(s, seat) ?? seat));
sp('post:alien', postRoll('alien', 'Телепортация: брось кубик (5–6)'));
sp('post:ninja', postRoll('ninja', 'Невидимость Ниндзя: брось кубик (3–4)'));
sp('post:shield', postRoll('shield', 'Защитное поле: брось кубик (1–2)'));
sp('post:merc', (s) => {
  const f = s.fight;
  if (f) foeStays(s, f);
});
ROLLS.healer = (s, x, seat, d) => {
  if (s.fight && d === 5) {
    say(s, x, seat, 'Знахарка вылечилась — условия карты противника не выполняются.');
    foeStays(s, s.fight);
  }
};
ROLLS.glad = (s, x, seat, d) => {
  if (s.fight && d === 4) {
    say(s, x, seat, 'Гладиатор помилован.');
    foeStays(s, s.fight);
  }
};
ROLLS.alien = (s, x, seat, d) => {
  const f = s.fight;
  if (!f || d < 5) return;
  foeStays(s, f);
  say(s, x, seat, 'Инопланетянин телепортируется на «Пик «Олимп».');
  placeAt(s, x, seat, cellsNamed('Пик «Олимп»')[0], false); // ? условия поля не выполняются
};
ROLLS.shield = (s, x, seat, d) => {
  if (s.fight && d <= 2) {
    say(s, x, seat, 'Защитное поле сработало.');
    foeStays(s, s.fight);
  }
};
ROLLS.ninja = (s, x, seat, d) => {
  const f = s.fight;
  if (!f || d < 3 || d > 4) return;
  foeStays(s, f);
  pickCell(s, x, seat, 'ninja', 'Ниндзя исчез и появился на соседнем поле', neighbours(H(s, seat).cell));
};
PICKS.ninja = (s, x, seat, key) => placeAt(s, x, seat, Number(key), false);

// ---------- на одном поле с другим путником ----------

const FEATS: [RegExp, string, string][] = [
  [/ФЕЯ/, 'fairy', 'Зачаровать'],
  [/ЦЫГАН/, 'gypsy2', 'Обмануть'],
  [/НАЁМНИК/, 'merc', 'Напасть на'],
  [/ГУСАР/, 'hussar2', 'Сыграть в гусарскую рулетку с'],
  [/МУТАНТ/, 'mutant', 'Загипнотизировать'],
];
/** Вызывать после прихода на поле (placeAt, перед условиями поля): особенность «оказавшись на одном поле с путником». */
export function onSameField(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (h.zone !== 'world' || h.sector != null) return;
  const ft = FEATS.find(([re]) => re.test(trName(h)));
  if (!ft) return;
  if (['hospital', 'office', 'exchange'].includes(cellKind(h.cell)) && ft[1] !== 'fairy') return; // поединки там запрещены
  const vs = s.seats.filter((o) => o !== seat && alive(s, o) && H(s, o).zone === 'world' && H(s, o).sector == null && H(s, o).cell === h.cell && !isImmune(s, o));
  if (!vs.length) return;
  pick(s, x, seat, 'feat', `${trName(h)}: применить особенность?`, [...vs.map((v) => ({ label: `${ft[2]} ${who(s, v)}`, key: String(v) })), { label: 'Нет', key: 'no' }], { f: ft[1], noauto: true });
}
PICKS.feat = (s, x, seat, key, d) => {
  if (key === 'no') return;
  const v = Number(key);
  const f: string = d.f;
  if (f === 'merc') {
    push(s, { seat, ops: [{ t: 'special', id: 'merc_attack', n: v }] });
    return;
  }
  const q: Record<string, string> = { fairy: 'Зачаровать: брось кубик (1–2)', gypsy2: 'Обмануть: брось кубик', hussar2: 'Гусарская рулетка: брось кубик (1–4)', mutant: 'Гипноз: брось кубик (1)' };
  askRoll(s, seat, f, q[f], { v });
};
ROLLS.fairy = (s, x, seat, d, data) => {
  if (d > 2) return;
  const v = H(s, data.v);
  v.skip += 1;
  hx(v).charm = seat;
  say(s, x, seat, `${who(s, data.v)} зачарован и пропускает ход; Фея может сделать ход за него.`);
};
ROLLS.gypsy2 = (s, x, seat, d, data) => {
  const v = H(s, data.v);
  const lim = v.align === 'добрый' ? 1 : v.align === 'нейтральный' ? 2 : 3;
  if (d > lim) return;
  const list = v.things.filter((t) => counts(t) && itemOf(t)?.kind !== 'owned');
  const opts: Opt[] = [];
  if (v.gold > 0) opts.push({ label: `Забрать ${Math.min(10, v.gold)} талеров`, key: 'gold' });
  if (list.length) opts.push({ label: 'Забрать предмет', key: 'item' });
  pick(s, x, seat, 'gypsyTake', `Цыган обманул ${who(s, data.v)}: что забрать?`, opts, { v: data.v, noauto: true });
};
PICKS.gypsyTake = (s, x, seat, key, d) => {
  const v = H(s, d.v);
  if (key === 'gold') {
    const k = Math.min(10, v.gold);
    bump(s, x, d.v, 'т', -k);
    bump(s, x, seat, 'т', k);
    say(s, x, seat, `Цыган забирает ${k} т у ${who(s, d.v)}.`);
    return;
  }
  pick(s, x, seat, 'gypsyItem', 'Какой предмет забрать?', v.things.filter((t) => counts(t) && itemOf(t)?.kind !== 'owned').map((t) => ({ label: thingName(t), key: t.id })), { v: d.v, noauto: true });
};
PICKS.gypsyItem = (s, x, seat, key, d) => {
  const t = H(s, d.v).things.find((k) => k.id === key);
  if (!t) return;
  dropThing(s, x, d.v, t, 'none');
  giveThing(s, x, seat, t);
  say(s, x, seat, `Цыган забирает: ${thingName(t)}.`);
};
ROLLS.hussar2 = (s, x, seat, d, data) => {
  if (d > 4) return;
  const k = -bump(s, x, data.v, 'ПЖ', -1);
  bump(s, x, seat, 'ПЖ', k);
  say(s, x, seat, `Гусар выигрывает: ${who(s, data.v)} теряет 1 ПЖ.`);
  pokeDeath(s, data.v);
};
ROLLS.mutant = (s, x, seat, d, data) => {
  if (d !== 1) return;
  const k = -bump(s, x, data.v, 'ПУ', -1);
  bump(s, x, seat, 'ПУ', k);
  say(s, x, seat, `Гипноз подействовал: ${who(s, data.v)} теряет 1 ПУ.`);
};
sp('merc_attack', (s, x, seat, op) => {
  const v = op.n!;
  c2(s).pvp = { att: seat, v };
  startFight(s, x, v, { t: 'battle', stat: 'ПС', foe: { name: 'Наёмник', ПС: 0 }, win: [], lose: [{ t: 'special', id: 'merc_win' }], draw: [] }, undefined);
  if (s.fight) {
    s.fight.foe.v = myPower(s, v, s.fight) + 1; // сила Наёмника на 1 ПС больше силы путника
    (s.fight as D).pvp = true;
  }
  say(s, x, seat, `${who(s, seat)} (Наёмник) нападает на ${who(s, v)}.`);
});
sp('merc_win', (s, x) => {
  const p = c2(s).pvp;
  if (!p) return;
  const k = -bump(s, x, p.v, 'ПЖ', -1);
  bump(s, x, p.att, 'ПЖ', k);
  say(s, x, p.att, `Наёмник побеждает и берёт 1 ПЖ у ${who(s, p.v)}.`);
  pokeDeath(s, p.v);
});

// ---------- перед ходом ----------

function peek(s: CState, x: X, seat: number, prep: boolean) {
  const n = s.deck[0] ?? s.discard[0];
  const hh = hx(H(s, seat));
  if (hh.prep) hh.prep.peeked = true;
  const t = n != null ? advText(n) : undefined;
  pick(s, x, seat, 'ack', t ? `Верхняя карта: №${n} «${t.title}» — ${t.text.replace(/\s+/g, ' ')}` : 'Колода пуста.', [{ label: 'Понятно', key: 'ok' }], { prep, noauto: true });
}
PICKS.ack = (s, x, seat, _key, d) => {
  if (d.prep) prepStep(s, x, seat);
};

/** Перед ходом (вызывать из beforeTurn): плен, зачарованный, взгляд на верхнюю карту (Звездочёт, Эльф, Детектив, Шаман). */
export function turnStart2(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (h.zone !== 'world') return mainBefore(s, x, seat);
  hx(h).prep = { i: 0 };
  prepStep(s, x, seat);
}
/** Остальное «перед ходом» (потери, полёт, легион) — SPECIAL.beforeTurn из special-turn. */
function mainBefore(s: CState, x: X, seat: number) {
  SPECIAL.beforeTurn?.(s, x, seat, { t: 'special', id: 'beforeTurn' }, { seat, ops: [], i: 0 });
}
function prepStep(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  const pr = hx(h).prep;
  if (!pr) return;
  while (pr.i < 8) {
    const i = pr.i++;
    if (prepTask(s, x, seat, i)) return;
  }
  delete hx(h).prep;
  mainBefore(s, x, seat);
}
/** true — задан вопрос. */
function prepTask(s: CState, x: X, seat: number, i: number): boolean {
  const h = H(s, seat);
  const pr = hx(h).prep!;
  switch (i) {
    case 0:
      revertMush(s, seat);
      return false;
    case 1:
      if (!hx(h).captive) return false;
      askRoll(s, seat, 'captive', `«Эпицентр»: брось кубик (1–4 — освободился)`, { prep: true });
      return true;
    case 2: {
      if (!isTr(h, /ФЕЯ/)) return false;
      const v = s.seats.find((o) => alive(s, o) && hx(H(s, o)).charm === seat);
      if (v == null) return false;
      if (H(s, v).skip <= 0) {
        delete hx(H(s, v)).charm;
        return false;
      }
      pick(s, x, seat, 'fairy1', `Фея: сделать ход за зачарованного ${who(s, v)}?`, YN, { v, prep: true, noauto: true });
      return true;
    }
    case 3:
      if (pr.peeked || !h.status.some((st) => st.k === 'peek')) return false;
      peek(s, x, seat, true);
      return true;
    case 4:
      if (pr.peeked || !isTr(h, /ЭЛЬФ/)) return false;
      pick(s, x, seat, 'elf', 'Эльф: попытаться узнать будущее?', YN, { prep: true, noauto: true });
      return true;
    case 5:
      if (pr.peeked || !isTr(h, /ЗВЕЗДОЧ/) || h.gold < 1) return false;
      pick(s, x, seat, 'pay1', 'Звездочёт: заплатить 1 талер и посмотреть верхнюю карту?', YN, { prep: true, noauto: true });
      return true;
    case 7: {
      const spy = h.things.find((t) => itemOf(t)?.name === 'карманный шпион' && can(h, t));
      if (pr.peeked || !spy) return false;
      pick(s, x, seat, 'spy', 'Карманный шпион: бросить кубик (1–5 — посмотреть верхнюю карту, 6 — шпион утерян)?', YN, { prep: true, noauto: true });
      return true;
    }
    default:
      if (pr.peeked || !h.friends.some((k) => advOf(k) === 154) || h.gold < 1) return false;
      pick(s, x, seat, 'pay1', 'Детектив: за 1 талер посмотреть верхнюю карту?', YN, { prep: true, noauto: true });
      return true;
  }
}
const resume = (s: CState, x: X, seat: number, d: D) => {
  if (d.prep) prepStep(s, x, seat);
};
PICKS.pay1 = (s, x, seat, key, d) => {
  if (key !== 'yes') return resume(s, x, seat, d);
  bump(s, x, seat, 'т', -1);
  peek(s, x, seat, !!d.prep);
};
PICKS.spy = (s, x, seat, key, d) => {
  if (key !== 'yes') return resume(s, x, seat, d);
  askRoll(s, seat, 'spy', 'Карманный шпион: брось кубик', { prep: d.prep });
};
ROLLS.spy = (s, x, seat, d, data) => {
  if (d <= 5) return peek(s, x, seat, !!data.prep);
  const spy = H(s, seat).things.find((t) => itemOf(t)?.name === 'карманный шпион');
  if (spy) dropThing(s, x, seat, spy, 'shelf');
  say(s, x, seat, 'Карманный шпион утерян.');
  resume(s, x, seat, data);
};
PICKS.elf = (s, x, seat, key, d) => {
  if (key !== 'yes') return resume(s, x, seat, d);
  askRoll(s, seat, 'elf', 'Узнать будущее: брось кубик (2–3)', { prep: d.prep });
};
ROLLS.elf = (s, x, seat, d, data) => {
  if (d >= 2 && d <= 3) peek(s, x, seat, !!data.prep);
  else resume(s, x, seat, data);
};
ROLLS.captive = (s, x, seat, d, data) => {
  const h = H(s, seat);
  const cap = hx(h).captive;
  if (d <= 4) {
    delete hx(h).captive;
    bump(s, x, seat, 'ПО', cap?.po ?? 2);
    say(s, x, seat, `${who(s, seat)} освободился из плена.`);
    resume(s, x, seat, data);
    return;
  }
  say(s, x, seat, `${who(s, seat)} остаётся в плену.`);
  push(s, { seat, ops: [{ t: 'cell' }] });
  pass(s, x);
};
PICKS.fairy1 = (s, x, seat, key, d) => {
  const v: number = d.v;
  delete hx(H(s, v)).charm;
  if (key !== 'yes') return resume(s, x, seat, d);
  askRoll(s, seat, 'fairydie', `Ход за ${who(s, v)}: брось кубик`, { v, prep: d.prep });
};
ROLLS.fairydie = (s, x, seat, die, data) => {
  const v: number = data.v;
  const paths = walkPaths(s, v, die);
  if (!paths.length) return resume(s, x, seat, data);
  pick(s, x, seat, 'fairypath', `Куда пойдёт ${who(s, v)}?`, paths.map((p, k) => ({ label: cellName(p[p.length - 1]), key: String(k) })), { v, paths, prep: data.prep, noauto: true });
};
PICKS.fairypath = (s, x, seat, key, d) => {
  const path: number[] = d.paths[Number(key)];
  for (const c of path) x.ev.push({ type: 'step', seat: d.v, cell: c });
  placeAt(s, x, d.v, path[path.length - 1], true);
  resume(s, x, seat, d);
};
/** Пути путника v на die полей (конечная клетка — один путь). */
function walkPaths(s: CState, v: number, die: number): number[][] {
  const h = H(s, v);
  const lockW = h.st.ПУ === 0 || h.status.some((st) => st.k === 'world' || st.k === 'even') ? worldOf(h.cell) : undefined;
  const out = new Map<number, number[]>();
  const walk = (at: number, prev: number | null, left: number, path: number[]) => {
    if (left === 0) {
      if (!out.has(at)) out.set(at, path);
      return;
    }
    let nx = neighbours(at).filter((m) => m !== prev);
    if (!nx.length) nx = neighbours(at);
    if (lockW !== undefined) nx = nx.filter((m) => worldOf(m) === lockW);
    for (const m of nx) walk(m, at, left - 1, [...path, m]);
  };
  walk(h.cell, null, die, []);
  return [...out.values()].filter((p) => !['door'].includes(cellKind(p[p.length - 1])));
}

// ---------- для сборки ----------

export const SPECIAL_CARDS2 = true;
export { isAmulet, isMagic };
void (null as unknown as Status);
