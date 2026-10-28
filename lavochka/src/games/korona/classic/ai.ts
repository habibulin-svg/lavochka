/**
 * «Корона Эмбера», «Классика 1994» — бот. Отвечает на любой вопрос своего места (`s.prompt`), в фазе `roll` бросает,
 * в `pick` выбирает конечную клетку хода. Колоду бот не читает — только то, что видел бы игрок.
 * Уровни: 0 — «Лёгкий» (часто наугад), 1 — «Средний», 2 — «Сложный».
 */
import type { Rng } from '../../../core/types';
import { CELL_OPS, FALL_NEED } from './cells';
import type { Action } from './engine';
import { ADV } from './cards';
import { ITEMS, cellsNamed } from './data';
import { H, advOf, distances, hasGun, itemOf, myPower, routes, statOfWorld, worldOf } from './engine';
import { duelPower, duelStat, duelTargets, offerError, tradable, tradePartners } from './special-pvp';
import type { Stat } from './script';
import type { CHero, CState } from './state';

const STATS: Stat[] = ['ПС', 'ПУ', 'ПМ'];
const NEED = FALL_NEED.min;
const FALLS = [22, 31, 54];
const SPEND = /Отдать|Заплат|Откуп|талер| т\)|Купить|Плат|Пожертв|Ставк/i;
const NO_LABEL = /^(Нет|Не |Отказ|Уйти|Ничего|Хватит|Остаться|Пусть)/;

/** Сколько талеров копит бот азартом (автоматы, отель), прежде чем ехать в обменный пункт. */
const GOLD_TRIP = 25;
const hasDraw = (c: number) => JSON.stringify(CELL_OPS[c] ?? []).includes('"draw"');

/** Готов ли путник к Провалу: все ПС, ПУ, ПМ и ПО не меньше порога. */
function ready(h: CHero, need: number = NEED): boolean {
  // долги можно выплатить прямо в Провале (меню Провала) — были бы деньги
  const debts = h.status.reduce((a, st) => a + (st.k === 'debt' ? st.т : 0), 0);
  return STATS.every((p) => h.st[p] >= need) && h.po >= need && h.gold >= debts;
}

/** Куда идти: список клеток-целей по важности (первая непустая группа выигрывает). */
function goals(s: CState, h: CHero, level = 2): number[] {
  if (s.king == null && ready(h)) {
    const ok = FALLS.filter((f) => ready(h, FALL_NEED[f as 22 | 31 | 54] as number));
    if (ok.length) return ok;
  }
  // статусы с целью: «пока не придёшь на поле …» (проклятие мира, болезнь), маршрут регента
  const aims: number[] = [];
  for (const st of h.status) {
    if ('until' in st && st.until) aims.push(...cellsNamed(st.until));
  }
  if (aims.length) return aims;
  if (h.st.ПУ === 0) return [18];
  // жизнь — главное: смерть сбрасывает всё накопленное (в лазарете лечат до 4 за 2 т)
  if (level > 0 && h.life < 4 && h.gold >= 2) return [18];
  if (h.life <= 1) return [18];
  const need = STATS.some((p) => h.st[p] < NEED);
  // азарт с хорошим ожиданием: автоматы (80), отель (76), картежники (69, если не честный) — пока денег мало
  if (level > 0 && need && h.gold >= 6 && h.gold < GOLD_TRIP) return h.honest ? [80, 76] : [80, 76, 69];
  if (need && h.gold >= (level > 0 ? GOLD_TRIP : 5)) return [1, 2];
  return Object.keys(CELL_OPS).map(Number).filter(hasDraw);
}

/** Штраф за поле, где лежит карта сильного противника (карты на поле видны всем). */
function dangerAt(s: CState, h: CHero, c: number): number {
  let pen = 0;
  const stat = statOfWorld(worldOf(c));
  for (const fc of s.field[c] ?? []) {
    const st = ADV[fc.n]?.stats;
    if (!st) continue;
    const v = (st[stat] ?? Math.max(...Object.values(st))) * (fc.bewitched ? 2 : 1);
    const mine = h.st[stat] + (h.things.length ? 2 : 0);
    if (v > mine) pen += 4 + (v - mine);
  }
  return pen;
}

function choosePath(s: CState, seat: number, level: number, rng: Rng): Action | null {
  const h = H(s, seat);
  const r = routes(s, seat, h.cell, s.die);
  const ends = [...r.keys()];
  if (!ends.length) return null;
  const pickRand = () => ends[rng.int(ends.length)];
  let end: number;
  if (level === 0 && rng.next() < 0.5) end = pickRand();
  else {
    const gs = goals(s, h, level);
    // слабому здоровью опасные поля — вдвое страшнее
    const fear = level > 0 && h.life <= 3 ? 2 : 1;
    const dist = ends.map((e) => {
      const d = distances(e);
      return { e, d: Math.min(...gs.map((g) => d.get(g) ?? 99)) + (e === 26 || e === 29 ? 3 : 0) + (level > 0 ? dangerAt(s, h, e) * fear : 0) + rng.next() * 0.5 };
    });
    dist.sort((a, b) => a.d - b.d);
    end = dist[0].e;
  }
  return { type: 'go', path: r.get(end)! };
}

/** Ответ на вопрос своего места. */
function answerPrompt(s: CState, seat: number, level: number, rng: Rng): Action {
  const p = s.prompt!;
  const h = H(s, seat);
  const keys = p.opts.map((o) => o.key);
  const ans = (key: string): Action => ({ type: 'answer', key });
  const first = () => ans(keys[0]);
  const rand = () => ans(keys[rng.int(keys.length)]);
  const has = (k: string) => keys.includes(k);
  if (keys.length === 1) return first();
  if (has('roll') && keys.length === 1) return ans('roll');
  const random = level === 0 && rng.next() < 0.35;
  const sensible = () => ans((p.opts.find((o) => !NO_LABEL.test(o.label)) ?? p.opts[0]).key);

  switch (p.kind) {
    case 'pre': {
      const f = s.fight!;
      const me = myPower(s, seat, f);
      const margin = level === 0 ? 3 : level === 1 ? 1 : 0;
      const means = p.opts.filter((o) => o.key !== 'fight' && o.key !== 'pass');
      if (random) return has('pass') && rng.next() < 0.5 ? ans('pass') : ans('fight');
      if (me >= f.foe.v - margin + (f.hunt ? 1 : 0)) return ans('fight');
      if (means.length) return ans(means[rng.int(means.length)].key);
      if (has('pass')) return ans('pass');
      return ans('fight');
    }
    case 'post': {
      const means = p.opts.filter((o) => o.key !== 'accept');
      if (means.length && !random) return ans(means[0].key);
      return ans('accept');
    }
    case 'goldCell':
      // в Мире Золота условия поля — по желанию: выполняем только там, где азарт выгоден (автоматы, отель, картежники)
      if (level > 0) return ans([80, 76, 69].includes(h.cell) && h.gold >= 5 ? 'yes' : 'no');
      return ans(h.gold >= 10 && !random ? 'yes' : 'no');
    case 'exchange': {
      const def: Record<string, number> = {};
      for (const st of STATS) def[st] = Math.max(0, NEED - h.st[st]);
      const deficit = [...STATS].sort((a, b) => def[b] - def[a]);
      for (const st of deficit) if (def[st] > 0 && has(`b${st}`) && h.gold >= 5) return ans(`b${st}`);
      const conv: Record<string, [Stat, number, Stat]> = { m3s: ['ПМ', 3, 'ПС'], u3s: ['ПУ', 3, 'ПС'], m2u: ['ПМ', 2, 'ПУ'], u3m: ['ПУ', 3, 'ПМ'], m2s: ['ПМ', 2, 'ПС'] };
      for (const k of keys) {
        const c = conv[k];
        if (c && def[c[2]] > 0 && h.st[c[0]] - c[1] >= NEED) return ans(k);
      }
      return ans('exit');
    }
    case 'hospital':
      if (has('heal')) return ans('heal');
      return ans('no');
    case 'office': {
      const sell = p.opts.find((o) => o.key !== 'exit');
      return ans(sell ? sell.key : 'exit');
    }
    case 'shop': {
      const ok = p.opts.filter((o) => o.key !== 'no');
      // по важности: шлем, кольт, броня, затем книги ума; покупать только то, чем сможем пользоваться
      const has = (nm: string) => h.things.some((q) => itemOf(q)?.name === nm);
      const score = (key: string): number => {
        const i = ITEMS[Number(key)];
        if (!i || i.price == null || h.gold < i.price || i.po > h.po) return -1;
        if (i.name === 'шлем') return has('шлем') ? -1 : 9;
        if (i.name === 'кольт') return hasGun(h) ? -1 : 8;
        if (i.name === 'бронежилет' || i.name === 'кольчуга') return has('бронежилет') || has('кольчуга') || h.gold < i.price + 5 ? -1 : 7;
        if (level > 1 && (i.name === 'книга' || i.name === 'папирус') && h.gold >= i.price + 10) return 3;
        return -1;
      };
      const best = ok.map((o) => ({ key: o.key, v: score(o.key) })).sort((a, b) => b.v - a.v)[0];
      if (level > 0 && best && best.v > 0) return ans(best.key);
      return ans(ok.length && h.gold >= 25 && !random ? ok[rng.int(ok.length)].key : 'no');
    }
    case 'trade': {
      const o = s.trade;
      if (!o || level === 0) return ans('no');
      const val = (th: { id: string }, mine: boolean) => {
        const i = itemOf(th);
        const base = i?.price ?? (advOf(th) != null ? 6 : 4);
        return !mine || !i || h.po >= i.po ? base : base * 0.3;
      };
      const get = o.give.map((id) => val(H(s, o.from).things.find((q) => q.id === id) ?? { id }, true)).reduce((a, b) => a + b, 0) + o.gg;
      const giv = o.take.map((id) => val(h.things.find((q) => q.id === id) ?? { id }, true)).reduce((a, b) => a + b, 0) + o.tg;
      return ans(get - giv >= 1 ? 'yes' : 'no');
    }
    case 'sic':
      return ans('no');
    case 'sicDef':
      return ans(keys.find((k) => k !== 'obey') ?? 'obey');
    case 'diceGo': {
      const n = Number((p.data as { n?: number } | undefined)?.n ?? 0);
      return ans(level > 0 && (n === 80 || n === 76 || (n === 69 && !h.honest)) ? 'y' : 'n');
    }
    case 'fallMenu': {
      if (has('go')) return ans('go');
      const pay = keys.find((k) => k.startsWith('pay:'));
      return ans(pay ?? 'stay');
    }
    case 'f2shop': {
      if (has('all')) return ans('all');
      const sell = keys.find((k) => k.startsWith('s:'));
      if (sell) return ans(sell);
      return ans('lab');
    }
    case 'f2xchg':
      return ans('done');
    case 'f2arena':
      return ans('wait');
    case 'moveTo': {
      const cells = keys.map(Number);
      const d = distances(h.cell);
      const gs = goals(s, h);
      const dist = (c: number) => {
        const dc = distances(c);
        return Math.min(...gs.map((g) => dc.get(g) ?? 99));
      };
      void d;
      if (random) return rand();
      return ans(String([...cells].sort((a, b) => dist(a) - dist(b))[0]));
    }
    case 'usurer': {
      const repay = keys.find((k) => k.startsWith('repay:'));
      return ans(repay ?? 'no');
    }
    case 'scholar':
      return ans('y');
    case 'moveMod':
      return ans(p.opts.find((o) => /Прибавить|Взять/.test(o.label)) ? 'y' : 'n');
    case 'gainPick':
    case 'losePick':
      return level === 0 ? rand() : first();
    case 'choice': {
      if (random) return rand();
      // не тратить деньги и вещи без нужды
      const cheap = p.opts.find((o) => !NO_LABEL.test(o.label) && !SPEND.test(o.label));
      return ans((cheap ?? p.opts.find((o) => NO_LABEL.test(o.label)) ?? p.opts[0]).key);
    }
    case 'moveName':
      return ans(String(1 + rng.int(keys.length)));
    case 'moveScout':
      return rand();
    case 'c1_gren':
    case 'c1_sorcery':
    case 'c1_thief_pick':
      return ans(has('no') ? 'no' : keys[0]);
    case 'draw':
    case 'c2_pick':
      return random ? rand() : sensible();
    default:
      if (keys.includes('yes') && keys.includes('no')) return ans(random ? (rng.next() < 0.5 ? 'yes' : 'no') : 'yes');
      if (random) return rand();
      // необязательные меню (ростовщик, казино, легион, аэропорт …) — отказаться
      for (const k of ['no', 'n', 'exit', 'done']) if (has(k)) return ans(k);
      return sensible();
  }
}


/** Вероятность выиграть бросок «показатель + кубик» при перевесе `edge` (ничья — не победа). */
function winProb(edge: number): [number, number] {
  let w = 0;
  let l = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      if (a + edge > b) w++;
      else if (a + edge < b) l++;
    }
  return [w / 36, l / 36];
}

/** Дуэль и торговля перед броском: бот вызывает слабого и предлагает выгодные сделки. */
function pvpAction(s: CState, seat: number, level: number, rng: Rng): Action | null {
  if (level === 0) return null;
  const h = H(s, seat);
  // дуэль: победа даёт +1 ПЖ (у соперника −1), поражение — −1 ПЖ; ход при этом пропадает, поэтому нужен ощутимый перевес
  const foes = duelTargets(s, seat);
  if (foes.length && h.life >= 3 && !ready(h)) {
    const stat = duelStat(s, seat);
    const mine = duelPower(s, seat, stat);
    let best: { o: number; v: number } | null = null;
    for (const o of foes) {
      const [w, l] = winProb(mine - duelPower(s, o, stat));
      // добить умирающего соперника — отдельная выгода: он потеряет всё накопленное
      const v = w - l + (H(s, o).life <= 1 ? w * 0.6 : 0);
      if (!best || v > best.v) best = { o, v };
    }
    if (best && best.v >= (level > 1 ? 0.4 : 0.6) && rng.next() < 0.8) return { type: 'duel', target: best.o };
  }
  // сделки: продать то, чем сам пользоваться не можешь; купить шлем или кольт у соседа, если нет своих
  if ((s.offers ?? 0) === 0 && rng.next() < 0.5) {
    for (const o of tradePartners(s, seat)) {
      const oh = H(s, o);
      for (const th of h.things) {
        const i = itemOf(th);
        if (!tradable(th) || !i || i.price == null || i.kind === 'amulet' || h.po >= i.po) continue;
        const price = Math.max(1, Math.round(i.price * 0.8));
        if (oh.gold < price || oh.po < i.po) continue;
        const offer = { to: o, give: [th.id], giveGold: 0, take: [], takeGold: price };
        if (!offerError(s, { from: seat, to: o, give: offer.give, gg: 0, take: [], tg: price })) return { type: 'offer', ...offer, takeGold: price };
      }
      if (level > 1) {
        for (const th of oh.things) {
          const i = itemOf(th);
          if (!tradable(th) || !i || i.price == null || i.po > h.po) continue;
          const want = (i.name === 'шлем' && !h.things.some((q) => itemOf(q)?.name === 'шлем')) || (i.name === 'кольт' && !hasGun(h));
          const price = Math.round(i.price * 1.3);
          if (!want || h.gold < price + 5) continue;
          if (!offerError(s, { from: seat, to: o, give: [], gg: price, take: [th.id], tg: 0 })) return { type: 'offer', to: o, give: [], giveGold: price, take: [th.id], takeGold: 0 };
        }
      }
    }
  }
  return null;
}

/**
 * Следующее действие бота `seat`: `null`, если сейчас не его очередь (чужой вопрос, чужой ход) — или если играть
 * нечем (баг: при открытом вопросе своего места null быть не должно).
 */
export function botAction(s: CState, seat: number, level: number, rng: Rng): Action | null {
  if (s.winner != null) return null;
  if (s.prompt) return s.prompt.seat === seat ? answerPrompt(s, seat, level, rng) : null;
  if (s.fight) return null;
  if (s.turn !== seat) return null;
  if (s.phase === 'roll') return pvpAction(s, seat, level, rng) ?? { type: 'roll' };
  if (s.phase === 'pick') return choosePath(s, seat, level, rng);
  return null;
}

void advOf;
void itemOf;
