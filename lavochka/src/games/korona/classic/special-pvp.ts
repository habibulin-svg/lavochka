/**
 * «Корона Эмбера», «Классика 1994» — путники друг против друга: дуэльный кодекс, торговые сделки,
 * «натравить друга». Всё по книге правил (раздел «Дуэльный кодекс», «Торговые сделки», карты №69 и друзья).
 *
 * Действия: `{type:'duel', target}` и `{type:'offer', …}`; вопросы — `duelRoll`, `trade`, `sic`, `sicDef`.
 */
import { ADV } from './cards';
import { cellKind } from './cells';
import { advText } from './data';
import type { Offer, CState, Thing } from './state';
import {
  H, TROPHIES, advOf, ask, askRoll, bump, capacity, counts, deathCheck, distances, dropThing, giveThing, itemOf, myPower, push, say,
  statOfWorld, thingName, who, worldOf,
} from './engine';
import type { X } from './engine';
import { SPECIAL } from './special-base';
import type { SpecialFn } from './special-base';
import type { Stat } from './script';
import { isImmune } from './special-cards2';

const ans = (kind: string, fn: SpecialFn) => {
  SPECIAL['answer:' + kind] = fn;
};

/** Лазарет, заготконтора и обменные пункты: поединки там запрещены. */
const NO_DUEL = new Set(['hospital', 'office', 'exchange']);
const onMap = (s: CState, o: number) => {
  const h = H(s, o);
  return h.zone === 'world' && h.sector == null;
};

// ---------- дуэль ----------

/** Кого может вызвать на дуэль путник `seat` (в свою очередь, вместо броска). */
export function duelTargets(s: CState, seat: number): number[] {
  if (s.winner != null || s.turn !== seat || s.phase !== 'roll' || s.prompt || s.fight) return [];
  const h = H(s, seat);
  if (!onMap(s, seat) || NO_DUEL.has(cellKind(h.cell))) return [];
  const d = distances(h.cell);
  return s.seats.filter((o) => {
    if (o === seat || !onMap(s, o) || isImmune(s, o)) return false;
    const oh = H(s, o);
    if (NO_DUEL.has(cellKind(oh.cell)) || (d.get(oh.cell) ?? 9) > 1) return false;
    return !(h.align === 'добрый' && oh.align === 'добрый'); // добрые с добрыми не дерутся
  });
}

/** Показатель дуэлянта: свой качество Мира + предметы + друзья ВМЕСТЕ (как в обычной битве). */
export function duelPower(s: CState, seat: number, stat: Stat): number {
  const fake = { seat, foe: { name: '', v: 0, stat }, left: 1, hunt: false, without: [], win: [], lose: [], champion: { kind: 'self' }, stage: 'roll', boost: 0, used: [] };
  return myPower(s, seat, fake as unknown as Parameters<typeof myPower>[2]);
}

/** Мир, чьим качеством бьются: там, где стоит вызывающий. */
export const duelStat = (s: CState, seat: number): Stat => statOfWorld(worldOf(H(s, seat).cell));

export function duelStart(s: CState, x: X, seat: number, target: number): boolean {
  if (!duelTargets(s, seat).includes(target)) return false;
  s.phase = 'run';
  s.duel = { a: seat, b: target, stat: duelStat(s, seat) };
  say(s, x, seat, `${who(s, seat)} вызывает на дуэль: ${who(s, target)}!`);
  askRoll(s, seat, 'duelRoll', `Дуэль с ${who(s, target)}: бросьте кубик`, {});
  return true;
}

ans('duelRoll', (s, x, seat) => {
  const d = s.duel;
  if (!d) return;
  const die = 1 + x.rng.int(6);
  x.ev.push({ type: 'roll', seat, die, why: 'дуэль' });
  if (seat === d.a && d.ra == null) {
    d.ra = die;
    askRoll(s, d.b, 'duelRoll', `${who(s, d.a)} вызвал вас на дуэль: бросьте кубик`, {});
    return;
  }
  // оба бросили
  const pa = duelPower(s, d.a, d.stat);
  const pb = duelPower(s, d.b, d.stat);
  const ta = pa + (d.ra ?? 0);
  const tb = pb + die;
  s.duel = null;
  say(s, x, d.a, `Дуэль (${d.stat}): ${who(s, d.a)} ${pa}+${d.ra} = ${ta}, ${who(s, d.b)} ${pb}+${die} = ${tb}.`);
  if (ta === tb) {
    say(s, x, d.a, 'Ничья — дуэль закончилась ничем.');
    return;
  }
  const win = ta > tb ? d.a : d.b;
  const lost = win === d.a ? d.b : d.a;
  say(s, x, win, `${who(s, win)} побеждает: ${who(s, lost)} теряет 1 ПЖ, победитель забирает его себе.`);
  const took = -bump(s, x, lost, 'ПЖ', -1);
  if (took) bump(s, x, win, 'ПЖ', took);
  deathCheck(s, x, lost);
});

// ---------- торговые сделки ----------

/** Предмет торговой сделки: трофеи, предметы, магические предметы, амулеты (но не принадлежащие владельцу, не друзья и не пункты). */
export function tradable(t: Thing): boolean {
  const i = itemOf(t);
  if (i) return i.kind === 'item' || i.kind === 'magic' || i.kind === 'amulet';
  const a = advOf(t);
  if (a == null) return false;
  return TROPHIES.has(a) || a === 63 || ADV[a]?.kind === 'предмет' || ADV[a]?.kind === 'магический предмет';
}

export const MAX_OFFERS = 3;

/** Кому путник `seat` может предложить сделку (тот же или соседний с ним путник) — в свой ход, до броска. */
export function tradePartners(s: CState, seat: number): number[] {
  if (s.winner != null || s.turn !== seat || s.phase !== 'roll' || s.prompt || s.fight || (s.offers ?? 0) >= MAX_OFFERS) return [];
  if (!onMap(s, seat)) return [];
  const d = distances(H(s, seat).cell);
  return s.seats.filter((o) => o !== seat && onMap(s, o) && !isImmune(s, o) && (d.get(H(s, o).cell) ?? 9) <= 1);
}

const names = (s: CState, o: number, ids: string[]) => ids.map((id) => thingName(H(s, o).things.find((t) => t.id === id) ?? { id })).join(', ');

/** Причина, по которой сделка невозможна (`null` — можно). */
export function offerError(s: CState, o: Offer): string | null {
  const a = H(s, o.from);
  const b = H(s, o.to);
  if (o.from === o.to || !a || !b || !onMap(s, o.from) || !onMap(s, o.to)) return 'нет с кем';
  if ((distances(a.cell).get(b.cell) ?? 9) > 1) return 'не на одном и не на соседнем поле';
  if (![o.gg, o.tg].every((n) => Number.isInteger(n) && n >= 0)) return 'плохая сумма';
  if (new Set(o.give).size !== o.give.length || new Set(o.take).size !== o.take.length) return 'повтор';
  const give = o.give.map((id) => a.things.find((t) => t.id === id));
  const take = o.take.map((id) => b.things.find((t) => t.id === id));
  if (give.some((t) => !t || !tradable(t)) || take.some((t) => !t || !tradable(t))) return 'эта вещь не продаётся';
  if (!give.length && !take.length && !o.gg && !o.tg) return 'пустая сделка';
  if (o.gg > a.gold || o.tg > b.gold) return 'не хватает талеров';
  const fit = (h: typeof a, out: Thing[], inn: Thing[]) => {
    const things = [...h.things.filter((t) => !out.includes(t)), ...inn];
    return things.filter(counts).length <= capacity({ ...h, things });
  };
  if (!fit(a, give as Thing[], take as Thing[]) || !fit(b, take as Thing[], give as Thing[])) return 'вещей не унести';
  return null;
}

/** Описание сделки для вопроса адресату. */
export function offerText(s: CState, o: Offer): string {
  const part = (list: string, gold: number) => [list, gold ? `${gold} т.` : ''].filter(Boolean).join(' + ') || 'ничего';
  return `${who(s, o.from)} предлагает сделку: отдаёт — ${part(names(s, o.from, o.give), o.gg)}; просит у вас — ${part(names(s, o.to, o.take), o.tg)}.`;
}

export function offerTrade(s: CState, x: X, seat: number, a: { to: number; give: string[]; giveGold: number; take: string[]; takeGold: number }): boolean {
  if (!tradePartners(s, seat).includes(a.to)) return false;
  const o: Offer = { from: seat, to: a.to, give: a.give ?? [], gg: a.giveGold ?? 0, take: a.take ?? [], tg: a.takeGold ?? 0 };
  if (offerError(s, o)) return false;
  s.offers = (s.offers ?? 0) + 1;
  s.trade = o;
  say(s, x, seat, `${who(s, seat)} предлагает сделку: ${who(s, a.to)}.`);
  ask(s, { seat: a.to, q: offerText(s, o), kind: 'trade', opts: [{ label: 'Принять', key: 'yes' }, { label: 'Отказаться', key: 'no' }] });
  return true;
}

ans('trade', (s, x, seat, _o, _f, _p, key) => {
  const o = s.trade;
  s.trade = null;
  if (!o) return;
  if (key !== 'yes') return say(s, x, seat, `${who(s, seat)} отказывается от сделки.`);
  const err = offerError(s, o);
  if (err) return say(s, x, seat, `Сделка сорвалась: ${err}.`);
  const text = `${names(s, o.from, o.give) || '—'}${o.gg ? ` + ${o.gg} т.` : ''} ↔ ${names(s, o.to, o.take) || '—'}${o.tg ? ` + ${o.tg} т.` : ''}`;
  const a = H(s, o.from);
  const b = H(s, o.to);
  const give = o.give.map((id) => a.things.find((t) => t.id === id)!);
  const take = o.take.map((id) => b.things.find((t) => t.id === id)!);
  for (const t of give) dropThing(s, x, o.from, t, 'none');
  for (const t of take) dropThing(s, x, o.to, t, 'none');
  for (const t of give) giveThing(s, x, o.to, t);
  for (const t of take) giveThing(s, x, o.from, t);
  if (o.gg) bump(s, x, o.to, 'т', -bump(s, x, o.from, 'т', -o.gg));
  if (o.tg) bump(s, x, o.from, 'т', -bump(s, x, o.to, 'т', -o.tg));
  say(s, x, o.from, `Сделка: ${who(s, o.from)} и ${who(s, o.to)} обменялись — ${text}.`);
});

// ---------- «натравить друга» ----------

/** Пришёл на поле, где стоит другой путник: по желанию можно заставить его выполнить условия карты своего друга. */
export function sicOffer(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (!onMap(s, seat) || !h.friends.length) return;
  const vs = s.seats.filter((o) => o !== seat && onMap(s, o) && H(s, o).cell === h.cell && !isImmune(s, o));
  const opts: { label: string; key: string }[] = [];
  for (const fr of h.friends) {
    const n = advOf(fr);
    if (n == null || !ADV[n]?.ops.length) continue;
    for (const v of vs) opts.push({ label: `Натравить «${thingName(fr)}» на ${who(s, v)}`, key: `${fr.id}:${v}` });
  }
  if (!opts.length) return;
  ask(s, { seat, q: 'На поле стоит другой путник: заставить его выполнить условия карты вашего друга?', kind: 'sic', opts: [...opts, { label: 'Нет', key: 'no' }] });
}

ans('sic', (s, x, seat, _o, _f, _p, key) => {
  if (!key || key === 'no') return;
  const [fid, v] = key.split(':');
  const victim = Number(v);
  const fr = H(s, seat).friends.find((f) => f.id === fid);
  if (!fr || !onMap(s, victim)) return;
  const defs: { label: string; key: string }[] = [{ label: 'Выполнить условия карты', key: 'obey' }];
  for (const t of H(s, victim).things) {
    const i = itemOf(t);
    if (t.broken) continue;
    if (i?.name === 'граната' || advOf(t) === 69) defs.push({ label: 'Бросить гранату в карту друга', key: `g:${t.id}` });
    else if (i?.kind === 'amulet' && i.num != null && i.num <= 3 && !H(s, victim).status.some((k) => k.k === 'noamulets')) defs.push({ label: `Амулет №${i.num}: отбросить карту`, key: `a:${t.id}` });
  }
  say(s, x, seat, `${who(s, seat)} натравливает друга «${thingName(fr)}» на ${who(s, victim)}.`);
  ask(s, { seat: victim, q: `${who(s, seat)} натравил на вас друга «${thingName(fr)}»: выполнить условия его карты или защищаться?`, kind: 'sicDef', opts: defs, data: { fid, owner: seat } });
});

ans('sicDef', (s, x, seat, _o, _f, p, key) => {
  const d = (p?.data ?? {}) as { fid: string; owner: number };
  const owner = H(s, d.owner);
  const fr = owner?.friends.find((f) => f.id === d.fid);
  if (!fr) return;
  const n = advOf(fr)!;
  dropThing(s, x, d.owner, fr, 'none');
  const k = key ?? 'obey';
  if (k !== 'obey') {
    const h = H(s, seat);
    const t = h.things.find((q) => q.id === k.slice(2));
    if (t) {
      const i = itemOf(t);
      if (k.startsWith('g:')) dropThing(s, x, seat, t, i ? 'shelf' : 'discard');
      else if (i) {
        t.uses = (t.uses ?? i.uses ?? 1) - 1;
        if (t.uses <= 0) dropThing(s, x, seat, t, 'shelf');
      }
      s.discard.push(n);
      say(s, x, seat, `${who(s, seat)} защищается (${i?.name ?? 'граната'}): карта друга «${advText(n)?.title ?? ''}» уходит в отбой.`);
      return;
    }
  }
  say(s, x, seat, `${who(s, seat)} выполняет условия карты «${advText(n)?.title ?? ''}».`);
  push(s, { seat, ops: ADV[n].ops, card: n, at: H(s, seat).cell });
});
