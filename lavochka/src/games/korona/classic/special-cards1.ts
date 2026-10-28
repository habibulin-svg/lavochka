/**
 * «Корона Эмбера», «Классика 1994» — особые правила карт приключений №1–100 (cards/c1.ts, c2.ts).
 *
 * Файл регистрирует в SPECIAL обработчики `special`-операций и ответов `answer:c1_*`, а наружу отдаёт хуки,
 * которые подключает index.ts (см. `hooks1`): pre1/post1 (средства до боя и после поражения), arrive1/skipCell1
 * (приход на поле), before1 (начало своего хода), use1 (действие «применить вещь»), meet1 (встреча с картой на поле),
 * drawPick1 (выбор из 3 карт), ghostDied1 (погиб заменивший тебя боец), regentDone1, officeClosed1, alarmScheme1.
 *
 * Длительные состояния хранятся в `hero.c1` (список «работ»), вещи в руке — `Thing` с id `a<номер>`,
 * деньги и вещи под охраной — `FieldCard.gold/things/pts`. Всё JSON-сериализуемо.
 */
import { ADV } from './cards';
import { ITEMS, TRAVELLERS, advText, cellName, itemsAt, norm } from './data';
import type { ItemCard } from './data';
import type { Op, Pts } from './script';
import { STATS } from './script';
import { SPECIAL } from './special-base';
import type { SpecialFn } from './special-base';
import type { CHero, CState, Fight, FieldCard, Frame, Thing } from './state';
import {
  H, TROPHIES, add, advOf, arrived, ask, bump, cardOf, counts, distances, dropThing, drawTop, friendOk, giveThing,
  isAmulet, isMagic, itemOf, leaveFoe, lose, moveTo, myPower, neighbours, placeAt, push, putCard, say, statOfWorld,
  stopCard, takeCard, takeItem, thingName, toMiddle, who, worldOf,
} from './engine';
import type { X } from './engine';
import { isImmune } from './special-cards2';

type Opt = { label: string; key: string };
type Ex = Thing & Record<string, unknown>;
const ex = (t: Thing) => t as Ex;

// ---------- состояние ----------

type Job =
  | { k: 'regen'; left: number }
  | { k: 'after'; n: number; left: number; ops: Op[] }
  | { k: 'cham'; left: number }
  | { k: 'pent'; ps: number; pu: number }
  | { k: 'pick3'; st: 'armed' | 'active' }
  | { k: 'wear'; id: string; pm: number };
const jobs = (h: CHero): Job[] => ((h as CHero & { c1?: Job[] }).c1 ??= []);

interface C1 {
  pend: { seat: number; card: number }[];
  bypass?: boolean;
}
const C = (s: CState): C1 => ((s as CState & { c1?: C1 }).c1 ??= { pend: [] });

type FX = Fight & { c1?: boolean; c1champ?: string };

// ---------- мелочи ----------

const reg = (id: string, fn: SpecialFn) => {
  SPECIAL[id] = fn;
};
const ans = (kind: string, fn: SpecialFn) => {
  SPECIAL['answer:' + kind] = fn;
};
const die6 = (x: X, seat: number, why?: string) => {
  const d = 1 + x.rng.int(6);
  x.ev.push({ type: 'roll', seat, die: d, why });
  return d;
};
const askRoll = (s: CState, seat: number, kind: string, q: string, data?: Record<string, unknown>) =>
  ask(s, { seat, q, kind, opts: [{ label: 'Бросить кубик', key: 'roll' }], data });
const askYes = (s: CState, seat: number, kind: string, q: string, data?: Record<string, unknown>, yes = 'Да', no = 'Нет') =>
  ask(s, { seat, q, kind, opts: [{ label: yes, key: 'yes' }, { label: no, key: 'no' }], data });
const dat = <T>(p: { data?: Record<string, unknown> } | undefined) => (p?.data ?? {}) as T;

const outer = (s: CState): (Frame & { guard?: FieldCard }) | undefined => {
  for (let k = s.run.length - 1; k >= 0; k--) if (s.run[k].card) return s.run[k] as Frame & { guard?: FieldCard };
  return undefined;
};
const guardOf = (s: CState) => outer(s)?.guard;
/** Убрать из ещё не исполненных операций кадра первую подходящую (копией — статичные сценарии не портим). */
const dropNext = (fr: Frame | undefined, pred: (o: Op) => boolean) => {
  if (!fr) return;
  const k = fr.ops.findIndex((o, i) => i >= fr.i && pred(o));
  if (k >= 0) fr.ops = fr.ops.filter((_, i) => i !== k);
};
const handThing = (h: CHero, n: number) => h.things.find((t) => t.id === `a${n}`);
const friendOf = (h: CHero, n: number) => h.friends.find((t) => t.id === `a${n}`);
const discardHand = (s: CState, x: X, seat: number, n: number) => {
  const t = handThing(H(s, seat), n);
  if (t) dropThing(s, x, seat, t, 'discard');
};
const note = (s: CState, text: string) => {
  s.log.push(text);
};
const setStat = (x: X, h: CHero, p: 'ПС' | 'ПУ' | 'ПМ', v: number) => {
  const d = v - h.st[p];
  h.st[p] = v;
  if (d) x.ev.push({ type: 'pts', seat: h.seat, p, delta: d });
};
const isFoeCard = (n: number) => ['враг', 'нечисть', 'зверь', 'змеи и драконы'].includes(ADV[n]?.kind ?? '');
const title = (n: number) => advText(n)?.title.toLowerCase() ?? `карта ${n}`;
const alive = (s: CState, o: number) => H(s, o).zone === 'world';
const POLICE = { cell: 'Полицейский участок' };

const findOp = (v: unknown, t: string): Op | undefined => {
  if (Array.isArray(v)) {
    for (const e of v) {
      const r = findOp(e, t);
      if (r) return r;
    }
    return undefined;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.t === t) return o as unknown as Op;
    for (const k of Object.keys(o)) {
      const r = findOp(o[k], t);
      if (r) return r;
    }
  }
  return undefined;
};
/** Друг из карты приключений: как он идёт с путником (с карты). */
function friendThingOf(n: number): Thing | undefined {
  const op = findOp(ADV[n]?.ops, 'friend') as Extract<Op, { t: 'friend' }> | undefined;
  return op ? { id: `a${n}`, with: op.with, hunts: op.hunts, carries: op.carries } : undefined;
}

/**
 * Вещи, отнятые у путника в этом действии (события `thing` без gain после последнего боя): возвращаем их
 * из колоды/поля предметов — чтобы положить под охрану противника.
 */
function lostThings(s: CState, x: X, seat: number): Thing[] {
  let from = 0;
  x.ev.forEach((e, i) => {
    if (e.type === 'fight') from = i + 1;
  });
  const out: Thing[] = [];
  for (const e of x.ev.slice(from)) {
    if (e.type !== 'thing' || e.gain || e.seat !== seat) continue;
    const num = Number(e.id.slice(1));
    if (e.id.startsWith('i')) {
      const k = s.shelf.lastIndexOf(num);
      if (k >= 0) {
        s.shelf.splice(k, 1);
        out.push({ id: e.id, uses: ITEMS[num].uses ?? undefined });
      }
    } else {
      const k = s.discard.lastIndexOf(num);
      if (k >= 0) {
        s.discard.splice(k, 1);
        out.push(friendThingOf(num) ?? { id: e.id });
      }
    }
  }
  return out;
}

/** Оставить карту противника на поле битвы вместе с деньгами/вещами под охраной (+ то, что там уже лежало). */
function leaveGuard(s: CState, seat: number, n: number, more: { gold?: number; things?: Thing[] }) {
  const h = H(s, seat);
  const g = guardOf(s);
  const fc: FieldCard = { n };
  const gold = (g?.gold ?? 0) + (more.gold ?? 0);
  const things = [...(g?.things ?? []), ...(more.things ?? [])];
  if (gold) fc.gold = gold;
  if (things.length) fc.things = things;
  if (g?.pts != null) fc.pts = g.pts;
  if (g?.settled) fc.settled = true;
  if (g?.bewitched) fc.bewitched = true;
  const of = outer(s);
  if (of) of.fated = true;
  putCard(s, h.cell, fc);
}

const foeSkips = (s: CState, x: X, f: Fight, text: string) => {
  s.fight = null;
  say(s, x, f.seat, text);
  leaveFoe(s, f);
};

// ---------- простые «свойства» друзей и карт в руке (работают через таблицы и хуки) ----------

for (const id of [
  'witch_friend', 'elf_friend', 'telepath_friend', 'gnome_friend', 'jubilee_weapon', 'jubilee_magshop', 'documents_bureau',
  'tokens_slots', 'mineral_auction', 'treasure_map', 'debtor_casino', 'alarm_scheme', 'sorcery', 'sorcery_storm', 'roach_free',
  'dragon_hide', 'ring_prebattle', 'book_use', 'grenade', 'pentagram_use', 'thief_friend', 'thief_closes', 'regent_um',
]) reg(id, () => {});
// Заготконтора закрыта, пока на ней лежит вор: карта на поле встречается раньше условий поля (office не исполняется),
// остальное — officeClosed1.

/** Беспечность друзей: на каких полях можно не выполнять условия. */
const CARELESS: Record<number, string[]> = {
  15: ['Эпицентр'],
  18: ['Эпицентр', 'Кладбище'],
  22: ['Заросли кактусов', 'Перевал'],
  25: ['Маковые заросли'],
};

// ---------- длинные состояния ----------

reg('after_status', (s, x, seat, _op, f) => {
  const h = H(s, seat);
  const n = cardOf(s) ?? f.card ?? 0;
  const left = Math.max(1, ...h.status.map((st) => ('turns' in st && typeof st.turns === 'number' ? st.turns : 0)));
  const fr = f;
  jobs(h).push({ k: 'after', n, left, ops: fr.ops.slice(fr.i) });
  fr.i = fr.ops.length;
  const of = outer(s);
  if (of) of.fated = true;
  note(s, `${who(s, seat)}: «${title(n)}» подействует и закончится через ${left} хода.`);
});
function runTail(s: CState, x: X, seat: number, j: Extract<Job, { k: 'after' }>) {
  let discarded = false;
  for (const op of j.ops) {
    if (op.t === 'add') add(s, x, seat, op.p, op.n);
    else if (op.t === 'say') say(s, x, seat, op.s);
    else if (op.t === 'card' && op.fate === 'discard') {
      s.discard.push(j.n);
      discarded = true;
    } else push(s, { seat, ops: [op] });
  }
  if (!discarded) s.discard.push(j.n);
}

reg('humbaba_regen', (s, _x, seat, op) => {
  jobs(H(s, seat)).push({ k: 'regen', left: op.n ?? 5 });
});

reg('restore_start', (s, x, seat) => {
  const h = H(s, seat);
  const base = baseOf(h);
  if (h.life < base.life) bump(s, x, seat, 'ПЖ', base.life - h.life);
  for (const k of STATS) if (h.st[k] < base.st[k]) bump(s, x, seat, k, base.st[k] - h.st[k]);
  if (h.gold < base.gold) bump(s, x, seat, 'т', base.gold - h.gold);
});
const baseOf = (h: CHero) => TRAVELLERS[h.tr];

reg('midas', (s, x, seat) => {
  const h = H(s, seat);
  const total = h.st.ПС + h.st.ПУ + h.st.ПМ;
  bump(s, x, seat, 'т', 5 * total);
  for (const k of STATS) bump(s, x, seat, k, 1 - h.st[k]);
});

reg('chameleon_skin', (s, x, seat) => {
  const h = H(s, seat);
  if (h.po >= 6 || h.prince != null) return;
  jobs(h).push({ k: 'cham', left: 3 });
  say(s, x, seat, `${who(s, seat)}: нет 6 ПО — шкуру хамелеона надо сдать за 3 хода.`);
});

reg('wear_bat_hide', (s, x, seat) => {
  const h = H(s, seat);
  const t = handThing(h, 56);
  if (!t) return;
  bump(s, x, seat, 'ПМ', 2);
  jobs(h).push({ k: 'wear', id: t.id, pm: 2 });
  say(s, x, seat, `${who(s, seat)} носит шкуру нетопыря: +2 ПМ.`);
});

reg('pick_cards', (s, x, seat) => {
  jobs(H(s, seat)).push({ k: 'pick3', st: 'armed' });
  say(s, x, seat, `${who(s, seat)}: цыгане нагадали — со следующего хода можно выбрать из 3 карт.`);
});

/** Снятие проклятия: награда и отбой карты, когда статус пропал. */
const REL: Record<number, string> = { 58: 'world', 71: 'noamulets', 83: 'nogold' };
reg('release_reward', (s, _x, seat, op) => {
  const n = cardOf(s);
  const t = n != null ? handThing(H(s, seat), n) : undefined;
  if (t) ex(t).rw = op.n ?? 1;
});
function releaseCheck(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  for (const t of [...h.things]) {
    const rw = ex(t).rw as number | undefined;
    const n = advOf(t);
    if (rw == null || n == null) continue;
    const kind = REL[n];
    const active = h.status.some((st) => st.k === kind && (kind !== 'world' || 'dice' in st));
    if (active) continue;
    add(s, x, seat, 'ПО', rw);
    dropThing(s, x, seat, t, 'discard');
    say(s, x, seat, `${who(s, seat)} избавился от «${title(n)}»: +${rw} ПО.`);
  }
}

reg('friend_life', (s, x, seat) => {
  const h = H(s, seat);
  if (!h.friends.length) return;
  if (h.friends.length === 1) return killFriend(s, x, seat, h.friends[0]);
  ask(s, { seat, q: 'Чей друг теряет жизнь?', kind: 'c1_friend_life', opts: h.friends.map((f) => ({ label: thingName(f), key: f.id })) });
});
const killFriend = (s: CState, x: X, seat: number, fr: Thing) => {
  dropThing(s, x, seat, fr, 'discard');
  say(s, x, seat, `${thingName(fr)} погиб (потерял жизнь).`); // ? у друзей нет ПЖ — друг погибает (как «жизнь друга» в №110)
};
ans('c1_friend_life', (s, x, seat, _o, _f, _p, key) => {
  const fr = H(s, seat).friends.find((t) => t.id === key);
  if (fr) killFriend(s, x, seat, fr);
});

// ---------- карты, которые ждут на поле: деньги и вещи под охраной ----------

reg('troll_pot', (s, x, seat) => {
  leaveGuard(s, seat, 31, { gold: 20 });
  say(s, x, seat, `20 талеров остались под охраной тролля.`);
  stopCard(s);
});
reg('troll_loot', (s, x, seat) => {
  const g = guardOf(s);
  if (g?.gold) {
    bump(s, x, seat, 'т', g.gold);
    say(s, x, seat, `${who(s, seat)} забирает ${g.gold} т, оставленные троллю.`);
    g.gold = 0;
  }
});
reg('guard_gold_leave', (s, x, seat, _op, f) => {
  const h = H(s, seat);
  const gold = h.gold;
  if (gold) bump(s, x, seat, 'т', -gold);
  leaveGuard(s, seat, 54, { gold });
  dropNext(f, (o) => o.t === 'card' && o.fate === 'leave');
  say(s, x, seat, `Всадники забирают ${gold} т — деньги остаются под их охраной.`);
});
reg('guard_gold_take', (s, x, seat) => {
  const g = guardOf(s);
  if (g?.gold) {
    bump(s, x, seat, 'т', g.gold);
    say(s, x, seat, `${who(s, seat)} забирает золото всадников: ${g.gold} т.`);
    g.gold = 0;
  }
});

const keepOwn = (s: CState, x: X, seat: number, lost: Thing[]): Thing[] => {
  // магические и принадлежащие владельцу предметы остаются у путника (Приложения 43, 84)
  const rest: Thing[] = [];
  for (const t of lost) {
    const i = itemOf(t);
    if (isMagic(t) || i?.kind === 'magic' || i?.kind === 'owned') giveThing(s, x, seat, t);
    else rest.push(t);
  }
  return rest;
};
reg('chekist_hold', (s, x, seat) => {
  const rest = keepOwn(s, x, seat, lostThings(s, x, seat));
  leaveGuard(s, seat, 43, { things: rest });
  say(s, x, seat, `Чекист держит отнятое под охраной (${rest.length} вещей и друзей).`);
});
reg('chekist_loot', (s, x, seat) => {
  const h = H(s, seat);
  const g = guardOf(s);
  for (const t of g?.things ?? []) takeLoot(s, x, seat, t, h);
  if (g) g.things = [];
});
reg('guard_items_leave', (s, x, seat, _op, f) => {
  const rest = keepOwn(s, x, seat, lostThings(s, x, seat));
  leaveGuard(s, seat, 84, { things: rest });
  dropNext(f, (o) => o.t === 'card' && o.fate === 'leave');
  say(s, x, seat, `Коммандо охраняет отнятые предметы (${rest.length}).`);
});
reg('guard_items_take', (s, x, seat) => {
  const g = guardOf(s);
  for (const t of g?.things ?? []) takeLoot(s, x, seat, t, H(s, seat));
  if (g) g.things = [];
});
/** Взять добычу: предмет — себе; друг по характеру — себе, враг — его условия. */
function takeLoot(s: CState, x: X, seat: number, t: Thing, h: CHero) {
  const n = advOf(t);
  if (n != null && ADV[n]?.kind === 'друг') {
    if (friendOk(h, n)) {
      h.friends.push(t);
      x.ev.push({ type: 'thing', seat, id: t.id, gain: true });
      say(s, x, seat, `«${title(n)}» идёт с ${who(s, seat)}.`);
    } else push(s, { seat, ops: ADV[n].ops, card: n, at: h.cell });
    return;
  }
  giveThing(s, x, seat, t);
}

reg('pioneer_loot', (s, x, seat) => {
  const h = H(s, seat);
  const stolen = lostThings(s, x, seat).slice(-1);
  const nb = neighbours(h.cell);
  const to = nb.length ? nb[x.rng.int(nb.length)] : h.cell;
  const g = guardOf(s);
  const fc: FieldCard = { n: 25, things: [...(g?.things ?? []), ...stolen] };
  const of = outer(s);
  if (of) of.fated = true;
  putCard(s, to, fc);
  say(s, x, seat, `Пионер скрылся на соседнем поле с добычей.`);
  stopCard(s);
});
reg('pioneer_friend', (s, x, seat) => {
  const g = guardOf(s);
  for (const t of g?.things ?? []) giveThing(s, x, seat, t);
  if (g) g.things = [];
});

// Багдадский вор: отнятое копится на карте (gold — талеры, pts — ПУ), карта остаётся на поле
reg('thief_keep_gold', (s, x, seat) => thiefKeep(s, x, seat, 3, 0));
reg('thief_keep_pu', (s, x, seat) => thiefKeep(s, x, seat, 0, 1));
function thiefKeep(s: CState, x: X, seat: number, gold: number, pu: number) {
  const g = guardOf(s);
  leaveGuard(s, seat, 44, { gold });
  const fc = (s.field[H(s, seat).cell] ?? []).find((c) => c.n === 44);
  if (fc) {
    fc.pts = (g?.pts ?? 0) + pu;
    fc.settled = true;
  }
  say(s, x, seat, `Багдадский вор прячет добычу и остаётся на поле.`);
  stopCard(s);
}
reg('thief_give', (s, x, seat) => {
  const g = guardOf(s);
  if (g?.gold) bump(s, x, seat, 'т', g.gold);
  if (g?.pts) bump(s, x, seat, 'ПУ', g.pts);
  if (g?.gold || g?.pts) say(s, x, seat, `Вор отдаёт всё, что отнял у других.`);
});
/** Заготконтора закрыта, пока там лежит вор (карта 44). */
export function officeClosed1(s: CState): boolean {
  return Object.entries(s.field).some(([c, l]) => norm(cellName(Number(c))) === 'ЗАГОТКОНТОРА' && l.some((k) => k.n === 44));
}

// источники: запас на карте
const setSource = (s: CState, seat: number, n: number) => {
  const c = cardOf(s);
  const fc = (s.field[H(s, seat).cell] ?? []).find((k) => k.n === c);
  if (fc) fc.pts = n;
};
reg('source_life', (s, _x, seat, op) => setSource(s, seat, op.n ?? 4));
reg('source_power', (s, _x, seat, op) => setSource(s, seat, op.n ?? 4));
/** Встреча с источником на поле: true — обработано (движок не запускает сценарий карты). */
export function meet1(s: CState, x: X, seat: number, fc: FieldCard): boolean {
  if (fc.n === 62) return meetSource1(s, seat, fc, 'ПЖ', true);
  if (fc.n === 67) return meetSource1(s, seat, fc, 'ПС', false);
  return false;
}
/** Общий источник: №62 (ПЖ, с броском 1-3), №67 (ПС), для №148, 182 — тем же вызовом с другим пунктом. */
export function meetSource1(s: CState, seat: number, fc: FieldCard, p: Pts, roll: boolean): boolean {
  const h = H(s, seat);
  if (fc.pts == null) fc.pts = 4;
  const data = { cell: h.cell, n: fc.n, p };
  if (roll) askRoll(s, seat, 'c1_source_roll', `«${title(fc.n)}»: брось кубик (1-3 — можешь взять 1 ${p}); осталось ${fc.pts}`, data);
  else askYes(s, seat, 'c1_source_take', `«${title(fc.n)}»: взять 1 ${p}? (осталось ${fc.pts})`, data, 'Взять', 'Не брать');
  return true;
}
const sourceTake = (s: CState, x: X, seat: number, d: { cell: number; n: number; p: Pts }) => {
  const fc = (s.field[d.cell] ?? []).find((k) => k.n === d.n);
  if (!fc || !(fc.pts ?? 0)) return;
  fc.pts = (fc.pts ?? 1) - 1;
  bump(s, x, seat, d.p, 1);
  say(s, x, seat, `${who(s, seat)} берёт 1 ${d.p} с источника.`);
  if (fc.pts <= 0) {
    takeCard(s, d.cell, d.n);
    s.discard.push(d.n);
    say(s, x, seat, `Источник иссяк.`);
  }
};
ans('c1_source_roll', (s, x, seat, _o, _f, p) => {
  if (die6(x, seat, 'источник') <= 3) sourceTake(s, x, seat, dat(p));
});
ans('c1_source_take', (s, x, seat, _o, _f, p, key) => {
  if (key === 'yes') sourceTake(s, x, seat, dat(p));
});

reg('charmed_flee', (s, x, seat) => {
  const h = H(s, seat);
  for (const fr of [...h.friends]) {
    const n = advOf(fr);
    if (!fr.charm || n == null) continue;
    const nb = neighbours(h.cell);
    dropThing(s, x, seat, fr, 'none');
    putCard(s, nb.length ? nb[x.rng.int(nb.length)] : h.cell, { n });
    say(s, x, seat, `Приворожённый «${title(n)}» убегает на соседнее поле.`);
  }
});

reg('mirror_foe', (s, _x, seat) => {
  C(s).pend.push({ seat, card: cardOf(s) ?? 72 });
});
reg('telepath_pu', (s, _x, seat) => {
  C(s).pend.push({ seat, card: cardOf(s) ?? 18 });
});

reg('colt_broken', (s, x, seat) => {
  const h = H(s, seat);
  const colt = h.things.find((t) => /кольт/.test(itemOf(t)?.name ?? ''));
  if (colt) {
    colt.broken = true;
    say(s, x, seat, `${who(s, seat)}: кольт сломан до починки в «Оружейной лавке».`);
  }
});

reg('magnet_break', (s, x, seat) => {
  const h = H(s, seat);
  h.status = h.status.filter((st) => st.k !== 'broken');
  for (const t of [...h.things]) {
    const i = itemOf(t);
    if (!counts(t) || isAmulet(t) || isMagic(t) || i?.kind === 'owned' || i?.kind === 'crown' || advOf(t) === 66) continue;
    if (t.from != null) {
      t.broken = true;
      say(s, x, seat, `«${thingName(t)}» сломан до ремонта (3 т) там, где куплен.`);
    } else {
      say(s, x, seat, `«${thingName(t)}» найден, а не куплен — ремонту не подлежит и пропадает.`);
      dropThing(s, x, seat, t, 'discard');
    }
  }
});

reg('madness', (s, x, seat) => {
  const h = H(s, seat);
  if (h.st.ПУ > 0) setStat(x, h, 'ПУ', 0);
  say(s, x, seat, `${who(s, seat)} безумен (ПУ 0).`);
  // потеря «3 ПУ» дальше по карте уже случилась (ПУ 0) — иначе безумный заплатил бы жизнью
  dropNext(outer(s), (o) => o.t === 'add' && o.p === 'ПУ' && o.n < 0);
});

reg('nature_inspection', (s, x, seat) => {
  const h = H(s, seat);
  const price = (t: Thing) => {
    const tr = TROPHIES.get(advOf(t) ?? 0);
    const office = tr?.sales.find((sl) => norm(sl.cell) === 'ЗАГОТКОНТОРА');
    return office?.т ?? Math.max(0, ...(tr?.sales.map((sl) => sl.т ?? 0) ?? [0]));
  };
  const skins = h.things.filter((t) => advOf(t) != null && TROPHIES.has(advOf(t)!));
  const best = [...skins].sort((a, b) => price(b) - price(a))[0];
  const fee = (best ? price(best) : 0) + 10;
  if (best) dropThing(s, x, seat, best, 'discard');
  if (h.gold >= fee) {
    bump(s, x, seat, 'т', -fee);
    s.bank += fee;
    add(s, x, seat, 'ПО', 2);
    discardHand(s, x, seat, 93);
    say(s, x, seat, `${who(s, seat)} рассчитался с инспекцией: ${fee} т.`);
  } else {
    // ? нечем платить — долг на всю сумму (шкура отобрана сразу)
    h.status.push({ k: 'debt', т: fee, adv: 93, po: 2, to: 'bank' });
    say(s, x, seat, `${who(s, seat)} должен инспекции ${fee} т: в Провал нельзя, пока не заплатит.`);
  }
});

reg('regent_um', () => {});
/** По завершении маршрута глашатая (вызывается из SPECIAL.regent при n === 82). */
export function regentDone1(s: CState, x: X, seat: number, adv: number): boolean {
  if (adv !== 82) return false;
  const h = H(s, seat);
  takeItem(s, x, seat, 'корона регента мира ума');
  h.regent = 'Ум';
  add(s, x, seat, 'ПО', 3);
  discardHand(s, x, seat, 82);
  say(s, x, seat, `${who(s, seat)} — регент Мира Ума.`);
  return true;
}

reg('beggar_swap', (s, _x, seat) => askSwap(s, seat, 'ПУ'));
function askSwap(s: CState, seat: number, p: 'ПУ' | 'ПМ') {
  const h = H(s, seat);
  const max = Math.min(h.st[p], Math.max(0, 14 - h.st.ПС));
  if (max <= 0) {
    if (p === 'ПУ') askSwap(s, seat, 'ПМ');
    return;
  }
  const opts: Opt[] = Array.from({ length: max }, (_, k) => ({ label: `Поменять ${k + 1} ${p} на ПС`, key: String(k + 1) }));
  opts.push({ label: 'Не менять', key: '0' });
  ask(s, { seat, q: `Нищеброд: сколько ${p} поменять на ПС (1:1)?`, kind: 'c1_swap', opts, data: { p } });
}
ans('c1_swap', (s, x, seat, _o, _f, p, key) => {
  const d = dat<{ p: 'ПУ' | 'ПМ' }>(p);
  const k = Number(key);
  if (k > 0) {
    bump(s, x, seat, d.p, -k);
    bump(s, x, seat, 'ПС', k);
  }
  if (d.p === 'ПУ') askSwap(s, seat, 'ПМ');
});

reg('recruiter_send', (s, _x, seat) => {
  const h = H(s, seat);
  const q = s.seats.filter((o) => o !== seat && alive(s, o) && !isImmune(s, o) && H(s, o).cell === h.cell && H(s, o).sector == null);
  if (q.length) recruitAsk(s, seat, q);
});
const recruitAsk = (s: CState, seat: number, queue: number[]) =>
  askYes(s, seat, 'c1_recruit', `Отправить ${who(s, queue[0])} на «Храм Бааля»? (+10 т)`, { queue }, 'Отправить', 'Не отправлять');
ans('c1_recruit', (s, x, seat, _o, _f, p, key) => {
  const q = dat<{ queue: number[] }>(p).queue;
  if (key === 'yes') {
    bump(s, x, seat, 'т', 10);
    moveTo(s, x, q[0], { cell: 'Храм Бааля' }, true);
  }
  if (q.length > 1) recruitAsk(s, seat, q.slice(1));
});

reg('dig_free', (s, _x, seat, op) => askRoll(s, seat, 'c1_dig', 'Золотая шахта: копаешь бесплатно', { left: op.n ?? 3 }));
ans('c1_dig', (s, x, seat, _o, _f, p) => {
  let left = dat<{ left: number }>(p).left;
  const d = die6(x, seat, 'шахта');
  if (d === 6) {
    say(s, x, seat, `${who(s, seat)} без лицензии — на «Полицейский участок».`);
    moveTo(s, x, seat, POLICE, true);
    return;
  }
  const gain = [0, 0, 5, 8, 10, 12][d - 1];
  if (gain) bump(s, x, seat, 'т', gain);
  if (--left > 0) askRoll(s, seat, 'c1_dig', `Золотая шахта: ещё раз (осталось ${left})`, { left });
});

// ---------- приход на поле: карты в руке и предметы, ждущие своего поля ----------

const AT: Record<number, string> = {
  4: 'Оружейная лавка', 6: 'Детективное бюро', 8: 'Игровые автоматы', 37: 'Магшоп', 50: 'Казино', 63: 'Кабак',
  66: 'Оружейная лавка', 68: 'Тараканьи бега', 79: 'Покинутый дом', 86: 'Биржа',
};

/** Вызывается в начале `cellConditions` (без `again`): ставит в стек кадры карт в руке; условия поля встанут выше. */
export function arrive1(s: CState, _x: X, seat: number) {
  const h = H(s, seat);
  if (h.zone !== 'world' || h.sector != null) return;
  const here = norm(cellName(h.cell));
  for (const t of h.things) {
    const n = advOf(t);
    if (n != null && AT[n] && norm(AT[n]) === here) push(s, { seat, ops: [{ t: 'special', id: 'c1_at', n }] });
  }
  if (h.things.some((t) => t.broken && t.from === h.cell)) push(s, { seat, ops: [{ t: 'special', id: 'c1_repair' }] });
  if (friendOf(h, 3) && s.seats.some((o) => o !== seat && alive(s, o) && H(s, o).cell === h.cell && H(s, o).sex === 'ж')) {
    push(s, { seat, ops: [{ t: 'special', id: 'c1_witch' }] });
  }
  if (h.things.some((t) => ex(t).rw != null)) push(s, { seat, ops: [{ t: 'special', id: 'c1_release' }] });
}
reg('c1_release', (s, x, seat) => releaseCheck(s, x, seat));
reg('c1_at', (s, x, seat, op) => AT_FN[op.n ?? 0]?.(s, x, seat));

const AT_FN: Record<number, (s: CState, x: X, seat: number) => void> = {
  4: (s, _x, seat) => jubilee(s, seat, 4, 'Оружейная лавка', 2, 0),
  37: (s, _x, seat) => jubilee(s, seat, 37, 'Магшоп', 1, 0),
  6: (s, x, seat) => {
    bump(s, x, seat, 'т', 15);
    if (!takeItem(s, x, seat, 'телохранитель')) say(s, x, seat, 'Телохранителя на поле предметов нет.');
    say(s, x, seat, `${who(s, seat)} сдаёт документы: 15 т и телохранитель.`);
    discardHand(s, x, seat, 6);
  },
  8: (s, _x, seat) => tokensAsk(s, seat, 3, 0),
  50: (s, x, seat) => {
    bump(s, x, seat, 'т', 15);
    discardHand(s, x, seat, 50);
    say(s, x, seat, `Должник отдаёт ${who(s, seat)} 15 т.`);
    ask(s, {
      seat, q: 'Казино: сыграть в рулетку бесплатно?', kind: 'c1_roul_mode',
      opts: [{ label: '1 цифру (25 т)', key: '1' }, { label: '2 цифры (15 т)', key: '2' }, { label: 'Не играть', key: 'no' }],
    });
  },
  63: (s, _x, seat) => askYes(s, seat, 'c1_alarm', 'Кабак: продать схему сигнализации за 15 т?', undefined, 'Продать', 'Оставить'),
  66: (s, _x, seat) => {
    if (H(s, seat).gold >= 3) askYes(s, seat, 'c1_colt', 'Починить кольт (3 т, пропуск хода)?', undefined, 'Починить', 'Нет');
  },
  68: (s, _x, seat) => {
    if (handThing(H(s, seat), 68)) askYes(s, seat, 'c1_roach', 'Сдать таракана-мутанта (10 т) и сыграть два раза бесплатно?', undefined, 'Сдать', 'Нет');
  },
  79: (s, x, seat) => {
    bump(s, x, seat, 'т', 25);
    discardHand(s, x, seat, 79);
    say(s, x, seat, `${who(s, seat)} находит клад: 25 т.`);
  },
  86: (s, _x, seat) => askYes(s, seat, 'c1_mineral', 'Биржа: выставить редкий минерал на торги (8 т)?', undefined, 'Выставить', 'Нет'),
};

// юбилейный посетитель: покупка за половину цены
const shelfItems = (s: CState, place: string): ItemCard[] => {
  const m = new Map<string, ItemCard>();
  for (const i of itemsAt(place)) if (i.kind === 'item' && i.price && s.shelf.includes(i.id) && !m.has(i.name)) m.set(i.name, i);
  return [...m.values()];
};
function jubilee(s: CState, seat: number, card: number, place: string, left: number, bought: number) {
  const h = H(s, seat);
  const list = shelfItems(s, place).filter((i) => Math.ceil(i.price! / 2) <= h.gold);
  if (!list.length) return note(s, 'Юбилейный посетитель: покупать нечего или не хватает денег.');
  ask(s, {
    seat, q: `Юбилейный посетитель: купить предмет за полцены (осталось ${left})`, kind: 'c1_jub',
    opts: [...list.map((i) => ({ label: `${i.name} — ${Math.ceil(i.price! / 2)} т`, key: String(i.id) })), { label: bought ? 'Хватит' : 'Не покупать', key: 'no' }],
    data: { card, place, left, bought },
  });
}
ans('c1_jub', (s, x, seat, _o, _f, p, key) => {
  const d = dat<{ card: number; place: string; left: number; bought: number }>(p);
  if (key === 'no') {
    if (d.bought) discardHand(s, x, seat, d.card);
    return;
  }
  const card = ITEMS[Number(key)];
  const h = H(s, seat);
  const k = s.shelf.indexOf(card.id);
  if (k < 0) return;
  s.shelf.splice(k, 1);
  bump(s, x, seat, 'т', -Math.ceil(card.price! / 2));
  giveThing(s, x, seat, { id: `i${card.id}`, uses: card.uses ?? undefined, from: h.cell });
  if (d.left > 1) jubilee2(s, x, seat, d.card, d.place, d.left - 1, d.bought + 1);
  else discardHand(s, x, seat, d.card);
});
function jubilee2(s: CState, x: X, seat: number, card: number, place: string, left: number, bought: number) {
  const h = H(s, seat);
  if (!shelfItems(s, place).some((i) => Math.ceil(i.price! / 2) <= h.gold)) return discardHand(s, x, seat, card);
  jubilee(s, seat, card, place, left, bought);
}

// жетоны
const tokensAsk = (s: CState, seat: number, left: number, played: number) =>
  askYes(s, seat, 'c1_tokens', `Игровые автоматы: сыграть бесплатно? (жетонов: ${left})`, { left, played }, 'Сыграть', played ? 'Хватит' : 'Не играть');
ans('c1_tokens', (s, x, seat, _o, _f, p, key) => {
  const d = dat<{ left: number; played: number }>(p);
  if (key === 'yes') askRoll(s, seat, 'c1_tokens_roll', 'Игровые автоматы: брось кубик', d);
  else if (d.played) discardHand(s, x, seat, 8);
});
ans('c1_tokens_roll', (s, x, seat, _o, _f, p) => {
  const d = dat<{ left: number; played: number }>(p);
  const r = die6(x, seat, 'автоматы');
  if (r === 3) {
    say(s, x, seat, `${who(s, seat)} ломал автоматы — на «Полицейский участок».`);
    discardHand(s, x, seat, 8);
    moveTo(s, x, seat, POLICE, true);
    return;
  }
  if (r === 2 || r === 4 || r === 6) bump(s, x, seat, 'т', 15);
  if (d.left > 1) tokensAsk(s, seat, d.left - 1, d.played + 1);
  else discardHand(s, x, seat, 8);
});

// рулетка в «Казино»
ans('c1_roul_mode', (s, _x, seat, _o, _f, _p, key) => {
  if (key === '1' || key === '2') roulDigit(s, seat, Number(key), []);
});
function roulDigit(s: CState, seat: number, need: number, got: number[]) {
  ask(s, {
    seat, q: `Рулетка: загадай цифру (${got.length + 1} из ${need})`, kind: 'c1_roul_d',
    opts: [1, 2, 3, 4, 5, 6].filter((d) => !got.includes(d)).map((d) => ({ label: String(d), key: String(d) })), data: { need, got },
  });
}
ans('c1_roul_d', (s, _x, seat, _o, _f, p, key) => {
  const d = dat<{ need: number; got: number[] }>(p);
  const got = [...d.got, Number(key)];
  if (got.length < d.need) roulDigit(s, seat, d.need, got);
  else askRoll(s, seat, 'c1_roul_roll', 'Рулетка: брось кубик', { got });
});
ans('c1_roul_roll', (s, x, seat, _o, _f, p) => {
  const got = dat<{ got: number[] }>(p).got;
  const r = die6(x, seat, 'рулетка');
  if (got.includes(r)) bump(s, x, seat, 'т', got.length === 1 ? 25 : 15);
  else say(s, x, seat, `Не угадал (${r}).`);
});

ans('c1_alarm', (s, x, seat, _o, _f, _p, key) => {
  if (key !== 'yes') return;
  bump(s, x, seat, 'т', 15);
  discardHand(s, x, seat, 63);
});
ans('c1_colt', (s, x, seat, _o, _f, _p, key) => {
  if (key !== 'yes') return;
  const h = H(s, seat);
  const colt = h.things.find((t) => t.broken && /кольт/.test(itemOf(t)?.name ?? ''));
  bump(s, x, seat, 'т', -3);
  h.skip += 1;
  if (colt) colt.broken = false;
  add(s, x, seat, 'ПО', 1);
  discardHand(s, x, seat, 66);
  say(s, x, seat, `${who(s, seat)} чинит кольт и пропускает ход.`);
});

// таракан-мутант
ans('c1_roach', (s, x, seat, _o, _f, _p, key) => {
  if (key !== 'yes') return;
  const t = handThing(H(s, seat), 68);
  if (!t) return;
  bump(s, x, seat, 'т', 10);
  dropThing(s, x, seat, t, 'discard');
  askRoll(s, seat, 'c1_roach_roll', 'Тараканьи бега (бесплатно): брось кубик за забег', { left: 2 });
});
ans('c1_roach_roll', (s, x, seat, _o, _f, p) => {
  const left = dat<{ left: number }>(p).left;
  const dice = [0, 0, 0, 0].map(() => 1 + x.rng.int(6));
  x.ev.push({ type: 'roll', seat, die: dice.reduce((a, b) => a + b, 0), dice, why: 'забег' });
  const win = dice.filter((d) => d >= 5).length;
  if (win) bump(s, x, seat, 'т', 4 * win);
  if (left > 1) askRoll(s, seat, 'c1_roach_roll', 'Тараканьи бега (бесплатно): второй забег', { left: left - 1 });
});

// редкий минерал на бирже
ans('c1_mineral', (s, _x, seat, _o, _f, _p, key) => {
  if (key === 'yes') askRoll(s, seat, 'c1_mineral_roll', 'Биржа: брось кубик (цена торгов)');
});
ans('c1_mineral_roll', (s, x, seat) => {
  const r = die6(x, seat, 'биржа');
  if (r === 1 || r === 5) return say(s, x, seat, 'Минерал не пользуется спросом — забери его обратно.');
  if (r === 6) {
    discardHand(s, x, seat, 86);
    say(s, x, seat, 'Минерал в «чёрных списках» — конфискован, ты на «Полицейском участке».');
    return moveTo(s, x, seat, POLICE, true);
  }
  const price = 8 + (r === 2 ? 5 : r === 3 ? 10 : 15);
  bump(s, x, seat, 'т', price - 2);
  s.bank += 2;
  discardHand(s, x, seat, 86);
  say(s, x, seat, `Минерал продан за ${price} т (2 т — в «Банк»).`);
});

// ремонт после магнитного удара
reg('c1_repair', (s, _x, seat) => repairAsk(s, seat));
function repairAsk(s: CState, seat: number) {
  const h = H(s, seat);
  const list = h.things.filter((t) => t.broken && t.from === h.cell);
  if (!list.length || h.gold < 3) return;
  ask(s, {
    seat, q: 'Ремонт предметов (3 т за предмет)', kind: 'c1_repair',
    opts: [...list.map((t) => ({ label: `Починить «${thingName(t)}»`, key: t.id })), { label: 'Не чинить', key: 'no' }],
  });
}
ans('c1_repair', (s, x, seat, _o, _f, _p, key) => {
  if (key === 'no') return;
  const t = H(s, seat).things.find((k) => k.id === key);
  if (!t) return;
  bump(s, x, seat, 'т', -3);
  t.broken = false;
  say(s, x, seat, `«${thingName(t)}» отремонтирован.`);
  repairAsk(s, seat);
});

// влюблённая ведьма отправляет женщину на постоялый двор
reg('c1_witch', (s, _x, seat) => {
  const h = H(s, seat);
  const q = s.seats.filter((o) => o !== seat && alive(s, o) && !isImmune(s, o) && H(s, o).cell === h.cell && H(s, o).sex === 'ж');
  if (q.length && friendOf(h, 3)) askYes(s, seat, 'c1_witch', `Ведьма отправит ${who(s, q[0])} на постоялый двор?`, { target: q[0] }, 'Отправить', 'Нет');
});
ans('c1_witch', (s, x, seat, _o, _f, p, key) => {
  if (key !== 'yes') return;
  const t = dat<{ target: number }>(p).target;
  const h = H(s, seat);
  const fr = friendOf(h, 3);
  if (!fr || !alive(s, t)) return;
  dropThing(s, x, seat, fr, 'none');
  push(s, { seat: t, ops: ADV[3].ops, card: 3, at: h.cell });
});

// беспечные друзья: можно не выполнять условия поля
/** Вызывается в `placeAt` после постановки фишки (cond = true): true — спросили, движок дальше не идёт. */
export function skipCell1(s: CState, x: X, seat: number, target: number): boolean {
  void x;
  if (C(s).bypass) return false;
  const h = H(s, seat);
  if ((s.field[target] ?? []).some((c) => c.n > 0)) return false;
  const name = norm(cellName(target));
  const fr = h.friends.find((f) => {
    const n = advOf(f);
    return n != null && CARELESS[n]?.some((c) => norm(c) === name);
  });
  if (!fr) return false;
  askYes(s, seat, 'c1_careless', `${thingName(fr)}: можно не выполнять условия поля «${cellName(target)}». Выполнять?`, { target }, 'Выполнить', 'Не выполнять');
  return true;
}
ans('c1_careless', (s, x, seat, _o, _f, p, key) => {
  const target = dat<{ target: number }>(p).target;
  if (key === 'yes') {
    C(s).bypass = true;
    placeAt(s, x, seat, target, true);
    C(s).bypass = false;
  } else arrived(s, x, seat);
});

// ---------- начало своего хода ----------

export function before1(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (h.zone === 'dead' || h.zone === 'out') return;
  const js = jobs(h);
  const rm = (j: Job) => js.splice(js.indexOf(j), 1);
  for (const j of [...js]) {
    if (j.k === 'regen') {
      bump(s, x, seat, 'ПС', 1);
      if (--j.left <= 0) {
        rm(j);
        add(s, x, seat, 'ПО', 1);
        say(s, x, seat, `${who(s, seat)}: ПС восстановились, хумбаб отложен (+1 ПО).`);
      }
    } else if (j.k === 'after') {
      if (--j.left <= 0) {
        rm(j);
        runTail(s, x, seat, j);
      }
    } else if (j.k === 'cham') {
      const t = handThing(h, 24);
      if (!t || h.po >= 6) rm(j);
      else if (j.left <= 0) {
        rm(j);
        dropThing(s, x, seat, t, 'field');
        say(s, x, seat, `Не сдал шкуру за 3 хода: хамелеон оживает и остаётся на этом поле.`);
      } else j.left--;
    } else if (j.k === 'pent') {
      rm(j);
      const give = Math.min(h.st.ПМ, j.ps + j.pu);
      setStat(x, h, 'ПМ', h.st.ПМ - give);
      setStat(x, h, 'ПС', h.st.ПС + j.ps);
      setStat(x, h, 'ПУ', h.st.ПУ + j.pu);
      say(s, x, seat, `${who(s, seat)}: качества вернулись.`);
    } else if (j.k === 'pick3') {
      if (j.st === 'active') rm(j);
      else j.st = 'active';
    } else if (j.k === 'wear') {
      if (!h.things.some((t) => t.id === j.id)) {
        rm(j);
        bump(s, x, seat, 'ПМ', -Math.min(j.pm, h.st.ПМ));
      }
    }
  }
  releaseCheck(s, x, seat);
}

/** Выбор из 3 карт (цыгане): вызывается из `drawCards`; true — движок дальше не берёт карты. */
export function drawPick1(s: CState, x: X, seat: number, n: number): boolean {
  const j = jobs(H(s, seat)).find((k) => k.k === 'pick3' && k.st === 'active');
  if (!j || n !== 1) return false;
  const cards: number[] = [];
  for (let k = 0; k < 3; k++) {
    const c = drawTop(s, x);
    if (c != null) cards.push(c);
  }
  jobs(H(s, seat)).splice(jobs(H(s, seat)).indexOf(j), 1);
  if (!cards.length) return false;
  ask(s, { seat, q: 'Цыгане нагадали: выбери карту приключений', kind: 'c1_pick3', opts: cards.map((c) => ({ label: `№${c} ${title(c)}`, key: String(c) })), data: { cards } });
  return true;
}
ans('c1_pick3', (s, _x, seat, _o, _f, p, key) => {
  const cards = dat<{ cards: number[] }>(p).cards;
  for (const c of cards) if (String(c) !== key) toMiddle(s, c);
  const c = Number(key);
  push(s, { seat, ops: ADV[c].ops, card: c, at: H(s, seat).cell });
});

// ---------- бой: средства до и после ----------

const SK = 'c1skin';
function mods(s: CState, f: Fight) {
  const fx = f as FX;
  if (fx.c1) return;
  fx.c1 = true;
  const c = C(s);
  const k = c.pend.findIndex((p) => p.seat === f.seat && p.card === f.card);
  if (k >= 0) {
    c.pend.splice(k, 1);
    f.foe.v = myPower(s, f.seat, f); // чёрный двойник / телепат-враг: качества равны твоим
  }
  const h = H(s, f.seat);
  if (f.card === 43 && friendOf(h, 25)) {
    const v = ADV[25].stats?.[f.foe.stat];
    if (v) {
      f.foe.v += v; // ? пионер переходит к чекисту: в карте «складываются», в Приложении «удваиваются» — берём карту
      note(s, 'Пионер перешёл на сторону чекиста.');
    }
  }
}

export function pre1(s: CState, f: Fight): Opt[] {
  const h = H(s, f.seat);
  mods(s, f);
  const out: Opt[] = [];
  if (f.champion.kind !== 'self' || h.zone !== 'world') return out;
  const sub = h.sector != null || norm(cellName(h.cell)) === 'ПОЛЫЕ ХОЛМЫ';
  const wo = (k: string) => f.without.includes(k);
  const po = (n: number) => h.prince != null || h.po >= n;
  const w = worldOf(h.cell);
  const magic = !sub && !wo('magic');
  if (magic && handThing(h, 9) && po(6)) out.push({ label: 'Книга заклинаний', key: 'c1book' });
  if (magic && handThing(h, 51) && po(8)) out.push({ label: 'Перстень', key: 'c1ring' });
  if (handThing(h, 24) && po(6) && (w === 'Ум' || w === 'Магия')) out.push({ label: 'Шкура хамелеона', key: `${SK}24` });
  if (handThing(h, 40)) out.push({ label: 'Шкура дракона', key: `${SK}40` });
  if (friendOf(h, 18) && !wo('friends')) {
    if ((w === 'Ум' || w === 'Магия') && f.foe.stat === statOfWorld(w)) out.push({ label: 'Телепат отводит глаза', key: 'c1avert' });
    out.push({ label: 'Пусть бьётся Телепат (умом)', key: 'c1tchamp' });
  }
  if (friendOf(h, 15) && !wo('friends')) out.push({ label: 'Эльф: уйти на соседнее поле', key: 'c1elf' });
  if (handThing(h, 85) && magic && !wo('items') && f.foe.stat === 'ПМ' && h.st.ПС + h.st.ПУ > 0) out.push({ label: 'Пентаграмма', key: 'c1pent' });
  if (handThing(h, 69) && !sub && !wo('items')) out.push({ label: 'Бросить гранату', key: 'c1gren' });
  return out;
}
/** После поражения у карт №1–100 средств нет. */
export function post1(_s: CState, _f: Fight): Opt[] {
  return [];
}

const ROLL_Q: Record<string, string> = {
  book: 'Книга заклинаний: брось кубик (1-2 призрак, 3-4 невидимка, 5-6 книга исчезла)',
  ring: 'Перстень: брось кубик (1-2 невидимка, 3-4 качества ×2, 5-6 перстень исчез)',
  skin24: 'Шкура хамелеона: брось кубик (1-3 — противник не нападает)',
  skin40: 'Шкура дракона: брось кубик (1-2 — противник не нападает)',
  avert: 'Телепат отводит глаза: брось кубик (1-3 — противник не нападает)',
  elf: 'Эльф: брось кубик (1-2 — уйти на соседнее поле)',
};
const preRoll = (what: string): SpecialFn => (s, _x, seat, op) => {
  if (!s.fight) return;
  s.fight.used.push(op.id);
  askRoll(s, seat, 'c1_fight_roll', ROLL_Q[what], { what });
};
reg('pre:c1book', preRoll('book'));
reg('pre:c1ring', preRoll('ring'));
reg(`pre:${SK}24`, preRoll('skin24'));
reg(`pre:${SK}40`, preRoll('skin40'));
reg('pre:c1avert', preRoll('avert'));
reg('pre:c1elf', preRoll('elf'));

ans('c1_fight_roll', (s, x, seat, _o, _f, p) => {
  const f = s.fight as FX | null;
  if (!f) return;
  const h = H(s, seat);
  const what = dat<{ what: string }>(p).what;
  const d = die6(x, seat, what);
  const ghost = (id: string) => {
    f.champion = { kind: 'ghost', v: 10 };
    f.c1champ = id;
    say(s, x, seat, 'Призрак (10/10/10) бьётся вместо тебя.');
  };
  switch (what) {
    case 'book':
      if (d <= 2) ghost('a9');
      else if (d <= 4) foeSkips(s, x, f, `${who(s, seat)} невидим — противник не нападает.`);
      else {
        discardHand(s, x, seat, 9);
        const pm = Math.min(2, h.st.ПМ);
        if (pm) bump(s, x, seat, 'ПМ', -pm);
        if (pm < 2) lose(s, x, seat, 'ПЖ', 2 - pm);
        say(s, x, seat, 'Книга исчезла.');
      }
      return;
    case 'ring':
      if (d <= 2) foeSkips(s, x, f, `${who(s, seat)} невидим — противник не нападает.`);
      else if (d <= 4) {
        f.double = true;
        say(s, x, seat, 'Качества удвоены на время битвы.');
      } else {
        discardHand(s, x, seat, 51);
        say(s, x, seat, 'Перстень исчез — бейся сам.');
      }
      return;
    case 'skin24':
    case 'avert':
      if (d <= 3) foeSkips(s, x, f, 'Противнику отвели глаза — он не нападает.');
      return;
    case 'skin40':
      if (d <= 2) foeSkips(s, x, f, 'Шкура дракона защитила — противник не нападает.');
      return;
    case 'elf': {
      if (d > 2) return;
      const opts = neighbours(h.cell).filter((c) => ![25, 26, 28, 29].includes(c)).map((c) => ({ label: cellName(c), key: String(c) }));
      if (opts.length) ask(s, { seat, q: 'Эльф уводит тебя на соседнее поле', kind: 'c1_elf_go', opts });
    }
  }
});
ans('c1_elf_go', (s, x, seat, _o, _f, _p, key) => {
  const f = s.fight;
  if (f) {
    s.fight = null;
    leaveFoe(s, f);
  }
  placeAt(s, x, seat, Number(key), false); // ? условия нового поля не выполняем
});

reg('pre:c1tchamp', (s, _x, _seat, op) => {
  const f = s.fight as FX | null;
  if (!f) return;
  f.used.push(op.id);
  const v = ADV[f.card ?? 0]?.stats?.ПУ ?? (f.foe.stat === 'ПУ' ? f.foe.v : 0);
  f.foe.stat = 'ПУ';
  f.foe.v = v;
  f.champion = { kind: 'ghost', v };
  f.c1champ = 'a18';
});
reg('pre:c1pent', (s, x, seat, op) => {
  s.fight?.used.push(op.id);
  usePentagram(s, x, seat);
});
reg('pre:c1gren', (s, x, seat, op) => {
  const f = s.fight;
  if (!f) return;
  f.used.push(op.id);
  discardHand(s, x, seat, 69);
  say(s, x, seat, `${who(s, seat)} бросает гранату — ${f.foe.name} уничтожен.`);
  s.fight = null;
  const of = outer(s);
  if (f.card && of && !of.fated) {
    of.fated = true;
    s.discard.push(f.card);
  }
  for (const t of of?.guard?.things ?? []) {
    const i = itemOf(t);
    if (i) s.shelf.push(i.id);
    else if (advOf(t) != null) s.discard.push(advOf(t)!);
  }
  stopCard(s);
});

/** Погиб тот, кто бился вместо путника (призрак книги — книга в отбой, телепат — друг в отбой). */
export function ghostDied1(s: CState, x: X, f: Fight) {
  const id = (f as FX).c1champ;
  if (!id) return;
  const h = H(s, f.seat);
  const t = h.friends.find((k) => k.id === id) ?? h.things.find((k) => k.id === id);
  if (t) {
    dropThing(s, x, f.seat, t, 'discard');
    say(s, x, f.seat, `«${thingName(t)}» погиб в битве.`);
  }
}

// ---------- «применить вещь» ----------

function usePentagram(s: CState, x: X, seat: number): boolean {
  const h = H(s, seat);
  const t = handThing(h, 85);
  if (!t) return false;
  const give = h.st.ПС + h.st.ПУ;
  if (give <= 0) return false;
  jobs(h).push({ k: 'pent', ps: h.st.ПС, pu: h.st.ПУ });
  setStat(x, h, 'ПМ', h.st.ПМ + give);
  setStat(x, h, 'ПС', 0);
  setStat(x, h, 'ПУ', 0);
  dropThing(s, x, seat, t, 'discard');
  say(s, x, seat, `${who(s, seat)} применяет пентаграмму: ПС и ПУ переходят в ПМ (+${give}) на 1 ход.`);
  return true;
}

export function use1(s: CState, x: X, seat: number, id: string): boolean {
  const h = H(s, seat);
  const t = h.things.find((k) => k.id === id) ?? h.friends.find((k) => k.id === id);
  const n = t ? advOf(t) : undefined;
  if (!t || n == null) return false;
  switch (n) {
    case 85:
      return usePentagram(s, x, seat);
    case 29: {
      const opts: Opt[] = [];
      for (const [c, list] of Object.entries(s.field))
        for (const fc of list) if (fc.n > 0 && isFoeCard(fc.n) && !fc.bewitched) opts.push({ label: `${title(fc.n)} — «${cellName(Number(c))}»`, key: `${c}:${fc.n}` });
      if (!opts.length) return false;
      opts.push({ label: 'Не колдовать', key: 'no' });
      ask(s, { seat, q: 'Колдовство: чьи качества удвоить?', kind: 'c1_sorcery', opts });
      return true;
    }
    case 96:
      if (s.storm || h.zone !== 'world' || !worldOf(h.cell)) return false;
      s.storm = { world: worldOf(h.cell)!, turns: 3, by: seat } as CState['storm'];
      discardHand(s, x, seat, 96);
      say(s, x, seat, `Буря колдовства в Мире ${s.storm!.world}: 3 хода все (кроме колдовавшего) ходят на 1 поле по часовой.`);
      return true;
    case 69: {
      const d = distances(h.cell);
      const opts: Opt[] = [];
      for (const o of s.seats) {
        const oh = H(s, o);
        if (o === seat || !alive(s, o) || isImmune(s, o) || (d.get(oh.cell) ?? 9) > 1) continue;
        opts.push({ label: `Граната в ${who(s, o)} (−1 ПЖ)`, key: `p:${o}` });
        for (const fr of oh.friends) opts.push({ label: `Граната в друга «${thingName(fr)}» (${who(s, o)})`, key: `f:${o}:${fr.id}` });
      }
      if ((s.field[h.cell] ?? []).some((c) => c.n === 44)) opts.push({ label: 'Уничтожить Багдадского вора', key: 'thief' });
      if (!opts.length) return false;
      opts.push({ label: 'Не бросать', key: 'no' });
      ask(s, { seat, q: 'Граната: куда бросить?', kind: 'c1_gren', opts });
      return true;
    }
    case 44:
      if (!friendOf(h, 44)) return false;
      askRoll(s, seat, 'c1_thief_roll', 'Багдадский вор: брось кубик (1-4 украдёт, 5-6 погибнет)');
      return true;
  }
  return false;
}
ans('c1_sorcery', (s, x, seat, _o, _f, _p, key) => {
  if (key === 'no' || !key) return;
  const [c, n] = key.split(':').map(Number);
  const fc = (s.field[c] ?? []).find((k) => k.n === n);
  if (!fc) return;
  fc.bewitched = true;
  discardHand(s, x, seat, 29);
  note(s, 'Колдовство применено.'); // тайно: кто и на кого — не объявляется
});
ans('c1_gren', (s, x, seat, _o, _f, _p, key) => {
  if (!key || key === 'no') return;
  if (key === 'thief') {
    takeCard(s, H(s, seat).cell, 44);
    s.discard.push(44);
  } else if (key.startsWith('p:')) bump(s, x, Number(key.slice(2)), 'ПЖ', -1);
  else {
    const [, o, id] = key.split(':');
    const fr = H(s, Number(o)).friends.find((k) => k.id === id);
    if (fr) dropThing(s, x, Number(o), fr, 'discard');
  }
  discardHand(s, x, seat, 69);
  say(s, x, seat, `${who(s, seat)} бросает гранату.`);
});
ans('c1_thief_roll', (s, x, seat) => {
  const h = H(s, seat);
  const d = die6(x, seat, 'вор');
  const fr = friendOf(h, 44);
  if (d >= 5) {
    if (fr) dropThing(s, x, seat, fr, 'discard');
    return say(s, x, seat, 'Вор погиб на месте преступления.');
  }
  const near = distances(h.cell);
  const opts: Opt[] = [];
  const ok = (t: Thing) => counts(t) && itemOf(t)?.kind !== 'owned' && itemOf(t)?.kind !== 'crown';
  for (const o of s.seats) {
    const oh = H(s, o);
    if (o === seat || !alive(s, o) || isImmune(s, o) || (near.get(oh.cell) ?? 9) > 3) continue;
    for (const t of oh.things) if (ok(t)) opts.push({ label: `${thingName(t)} (у ${who(s, o)})`, key: `p:${o}:${t.id}` });
  }
  for (const [c, list] of Object.entries(s.field)) {
    if ((near.get(Number(c)) ?? 9) > 3) continue;
    for (const fc of list) for (const t of fc.things ?? []) if (ok(t)) opts.push({ label: `${thingName(t)} (на поле «${cellName(Number(c))}»)`, key: `f:${c}:${fc.n}:${t.id}` });
  }
  if (!opts.length) return say(s, x, seat, 'Красть нечего.');
  ask(s, { seat, q: 'Вор крадёт для тебя: что?', kind: 'c1_thief_pick', opts });
});
ans('c1_thief_pick', (s, x, seat, _o, _f, _p, key) => {
  const k = (key ?? '').split(':');
  if (k[0] === 'p') {
    const oh = H(s, Number(k[1]));
    const t = oh.things.find((q) => q.id === k[2]);
    if (!t) return;
    dropThing(s, x, Number(k[1]), t, 'none');
    giveThing(s, x, seat, t);
  } else {
    const list = s.field[Number(k[1])] ?? [];
    const fc = list.find((q) => q.n === Number(k[2]) && q.things?.some((u) => u.id === k[3]));
    const t = fc?.things?.find((u) => u.id === k[3]);
    if (!fc || !t) return;
    fc.things = fc.things!.filter((u) => u !== t);
    if (fc.n === 0 && !fc.things.length) s.field[Number(k[1])] = list.filter((q) => q !== fc);
    giveThing(s, x, seat, t);
  }
  say(s, x, seat, 'Вор украл для тебя вещь.');
});

/** Схема сигнализации: охранники банка и чёрной кассы слабее на 3 ПС; карта отбрасывается (вызывать при начале налёта). */
export function alarmScheme1(s: CState, x: X, seat: number): number {
  if (!handThing(H(s, seat), 63)) return 0;
  discardHand(s, x, seat, 63);
  return 3;
}

/** Всё, что подключает index.ts. */
export const hooks1 = { pre1, post1, arrive1, skipCell1, before1, use1, meet1, meetSource1, drawPick1, ghostDied1, regentDone1, officeClosed1, alarmScheme1 };
