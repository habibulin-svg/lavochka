/* Покер — расчёты тренажёра (без DOM): ауты, шансы банка, M и зона Харрингтона, пуш/фолд по Нэшу для стека, ICM-цена
 * решения и разбор «лучший ход» после раздачи.
 *   Пуш/фолд-споты холдема (до 20 ББ, безлимит, до игрока все спасовали — или один ва-банк перед ним) считаются по
 *   таблицам Нэша (data/preflop.json): соперники коллируют / пушат ровно по своим диапазонам Нэша, шансы против диапазона —
 *   розыгрышем наугад с фиксированным зерном; итог — в ББ и, в турнире, по ICM в процентах призовых. Упрощение, как в
 *   калькуляторах Sit&Go: на ва-банк отвечает не больше одного соперника.
 *   Остальные решения — оценка: шансы против диапазонов «по действию до флопа» против нужных шансов банка. */
import type { Card } from '../../cards/deck';
import { SeededRng } from '../../core/rng';
import type { Rng } from '../../core/types';
import { classIndex, classOf, fastHigh } from './eval';
import { contenders, GAMES, potSize, toCall, type HandRecord, type View } from './engine';
import { allCards, highCat } from './hands';
import { icm, icmCallEquity } from './icm';
import { PREFLOP, prePct } from './ranges';
import { frames } from './replay';
import { positions } from './stats';

const key = (c: Card) => c.s + c.r;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const fmtBB = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0)} ББ`;

// ---------------------------------------------------------------- M и зона

export interface Zone {
  m: number;
  name: string;
  color: string;
  advice: string;
}

/** M Харрингтона: стек / (блайнды + все анте за круг) и зона. */
export function zoneOf(stack: number, small: number, big: number, antes: number): Zone {
  const m = stack / Math.max(1, small + big + antes);
  if (m >= 20) return { m, name: 'зелёная', color: '#3fa34d', advice: 'играйте обычный покер: стек позволяет всё' };
  if (m >= 10) return { m, name: 'жёлтая', color: '#d9b82c', advice: 'спекулятивные руки (мелкие пары, одномастные коннекторы) теряют цену — играйте старшими картами' };
  if (m >= 6) return { m, name: 'оранжевая', color: '#e07b28', advice: 'нужна инициатива: входите рейзом или ва-банком, лимп и колл почти не годятся' };
  if (m >= 1) return { m, name: 'красная', color: '#d0402c', advice: 'только ва-банк или пас — первым в банк, с любой приличной рукой' };
  return { m, name: 'мёртвая', color: '#7a1a12', advice: 'ва-банк с любыми двумя при первой возможности' };
}

/** Анте за круг по истории раздачи. */
export function antesOf(r: Pick<HandRecord, 'ante' | 'anteKind' | 'seats'>): number {
  if (!r.ante) return 0;
  return r.anteKind === 'all' || r.anteKind === 'stud' ? r.ante * r.seats.length : r.ante;
}

// ---------------------------------------------------------------- ауты

const CAT_RU = ['старшая карта', 'пара', 'две пары', 'сет', 'стрит', 'флеш', 'фулл-хаус', 'каре', 'стрит-флеш'];

/** Ауты холдема (две своих, флоп или тёрн): карты, после которых рука становится сильнее категорией, и усиливает её
 * именно своя карта (а не доска для всех). Группы — по новой комбинации. */
export function outs(hole: Card[], board: Card[], sd = false): { n: number; groups: { name: string; n: number }[] } | null {
  if (hole.length !== 2 || board.length < 3 || board.length > 4) return null;
  const known = new Set([...hole, ...board].map(key));
  const now = highCat(fastHigh([...hole, ...board], sd));
  const groups = new Map<string, number>();
  let n = 0;
  for (const c of allCards(sd)) {
    if (known.has(key(c))) continue;
    const b2 = [...board, c];
    const mine = highCat(fastHigh([...hole, ...b2], sd));
    // пара от доски — не аут; аутом считаем только то, что делает моя карта
    const boardOnly = highCat(fastHigh(b2, sd));
    if (mine > now && mine > boardOnly && mine >= 2 - (now === 0 ? 1 : 0)) {
      n++;
      const name = CAT_RU[mine];
      groups.set(name, (groups.get(name) ?? 0) + 1);
    }
  }
  return { n, groups: [...groups.entries()].map(([name, k]) => ({ name, n: k })).sort((a, b) => b.n - a.n) };
}

/** Точная вероятность собрать за оставшиеся карты (ауты из unseen, cards — 1 или 2 карты впереди). */
export const hitChance = (outsN: number, unseen: number, cards: number) => (cards >= 2 ? 1 - ((unseen - outsN) * (unseen - outsN - 1)) / (unseen * (unseen - 1)) : outsN / unseen);

// ---------------------------------------------------------------- шансы против диапазона (холдем)

type Combo = [Card, Card];

/** Все сочетания двух карт, кроме известных, где вес класса > 0. */
function rangeCombos(dead: Card[], w: (cls: number) => number, sd = false): { c: Combo; w: number }[] {
  const ks = new Set(dead.map(key));
  const pool = allCards(sd).filter((c) => !ks.has(key(c)));
  const out: { c: Combo; w: number }[] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const x = w(classIndex(pool[i], pool[j]));
      if (x > 0) out.push({ c: [pool[i], pool[j]], w: x });
    }
  return out;
}

/** Шансы двух карт против диапазона одного соперника (розыгрыш наугад до пяти карт доски). */
export function eqVsRange(hero: Card[], board: Card[], range: { c: Combo; w: number }[], samples: number, rng: Rng, sd = false): number {
  if (!range.length) return 1;
  const cum: number[] = [];
  let t = 0;
  for (const r of range) cum.push((t += r.w));
  const deck = allCards(sd).filter((c) => !hero.some((h) => key(h) === key(c)) && !board.some((b) => key(b) === key(c)));
  let s = 0;
  for (let k = 0; k < samples; k++) {
    const x = rng.next() * t;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m] >= x) hi = m;
      else lo = m + 1;
    }
    const o = range[lo].c;
    const used = new Set([key(o[0]), key(o[1])]);
    const b = board.slice();
    while (b.length < 5) {
      const c = deck[rng.int(deck.length)];
      if (used.has(key(c))) continue;
      used.add(key(c));
      b.push(c);
    }
    const a = fastHigh([...hero, ...b], sd);
    const v = fastHigh([o[0], o[1], ...b], sd);
    s += a > v ? 1 : a === v ? 0.5 : 0;
  }
  return s / samples;
}

// ---------------------------------------------------------------- пуш/фолд

export interface PFSpot {
  kind: 'push' | 'call';
  hero: number;
  hole: Card[];
  big: number;
  /** Стеки на начало раздачи и что уже поставлено (блайнды, анте) — по местам раздачи. */
  stacks: Record<number, number>;
  posted: Record<number, number>;
  /** push: кто ходит после меня (по порядку); call: кто пошёл ва-банк и сколько игроков было позади него. */
  behind: number[];
  pusher?: number;
  pusherBehind?: number;
  /** Выплаты турнира — для ICM. */
  prizes?: number[];
}

export interface PFResult {
  kind: 'push' | 'call';
  best: 'push' | 'call' | 'fold';
  /** Ожидание хода относительно паса, в ББ. */
  evBB: number;
  /** ICM: доля призовых при ходе и при пасе (0…1 от фонда). */
  icmAct?: number;
  icmFold?: number;
  /** Нэш: до скольких ББ ход верен с этой рукой (20 — «и больше»). */
  nash: number;
  eff: number;
  /** Шансы на вскрытии против диапазона и как часто коллируют (для пуша). */
  eq: number;
  callP?: number;
  /** Нужные шансы для колла: без ICM и с ICM. */
  need?: number;
  needIcm?: number;
}

const tbl = (k: number) => Math.max(1, Math.min(8, k));

/** Посчитать пуш/фолд-спот. */
export function solvePF(sp: PFSpot, samples = 1600, seed = 7): PFResult {
  const rng = new SeededRng(seed);
  const cls = classIndex(sp.hole[0], sp.hole[1]);
  const seats = Object.keys(sp.stacks).map(Number);
  const H = sp.hero;
  const st = sp.stacks;
  const post = (p: number) => sp.posted[p] ?? 0;
  const foldStack = () => {
    const out = { ...st };
    for (const p of seats) out[p] -= post(p);
    return out;
  };
  /** Стеки после спора hero и v: c — сколько ставит каждый, dead — чужие поставленные. */
  const duel = (v: number, heroWins: boolean) => {
    const c = Math.min(st[H], st[v]);
    const out = foldStack();
    let pot = 0;
    for (const p of seats) if (p !== H && p !== v) pot += post(p);
    out[H] = st[H] - c;
    out[v] = st[v] - c;
    pot += 2 * c;
    if (heroWins) out[H] += pot;
    else out[v] += pot;
    return out;
  };
  const vec = (m: Record<number, number>) => seats.map((p) => Math.max(0, m[p]));
  const pool = sp.prizes?.length ? sp.prizes.reduce((a, b) => a + b, 0) : 0;
  const icmOf = (m: Record<number, number>) => (pool ? icm(vec(m), sp.prizes!)[seats.indexOf(H)] / pool : 0);
  const base = st[H] - post(H);
  if (sp.kind === 'push') {
    const k = sp.behind.length;
    const eff = Math.min(st[H], Math.max(...sp.behind.map((p) => st[p]))) / sp.big;
    let pAllFold = 1;
    let ev = 0;
    let icmA = 0;
    let eqAvg = 0;
    let callAny = 0;
    sp.behind.forEach((v, i) => {
      const risk = Math.min(st[H], st[v]) / sp.big;
      const range = rangeCombos(sp.hole, (c) => ((PREFLOP.call[tbl(k)]?.[Math.min(i, tbl(k) - 1)]?.[c] ?? 0) >= risk ? 1 : 0));
      const all = rangeCombos(sp.hole, () => 1).length;
      const pCall = range.length / all;
      const pHere = pAllFold * pCall;
      pAllFold *= 1 - pCall;
      if (!pHere) return;
      const eq = eqVsRange(sp.hole, [], range, samples, rng);
      const win = duel(v, true);
      const lose = duel(v, false);
      ev += pHere * (eq * win[H] + (1 - eq) * lose[H]);
      if (pool) icmA += pHere * (eq * icmOf(win) + (1 - eq) * icmOf(lose));
      eqAvg += pHere * eq;
      callAny += pHere;
    });
    const steal = foldStack();
    for (const p of seats) if (p !== H) steal[H] += post(p);
    steal[H] += post(H);
    ev += pAllFold * steal[H];
    if (pool) icmA += pAllFold * icmOf(steal);
    const fold = foldStack();
    // пасую — блайнды забирает большой блайнд (обычное упрощение калькуляторов)
    const bb = sp.behind[sp.behind.length - 1];
    if (bb != null) fold[bb] += seats.reduce((a, p) => a + post(p), 0);
    const icmF = pool ? icmOf(fold) : undefined;
    const evBB = (ev - base) / sp.big;
    const better = pool ? icmA > icmF! : evBB > 0;
    return { kind: 'push', best: better ? 'push' : 'fold', evBB, icmAct: pool ? icmA : undefined, icmFold: icmF, nash: PREFLOP.push[tbl(k)][cls], eff, eq: callAny ? eqAvg / callAny : 1, callP: callAny };
  }
  // колл ва-банка
  const P = sp.pusher!;
  const kP = tbl(sp.pusherBehind ?? 1);
  const pushTh = st[P] / sp.big;
  let range = rangeCombos(sp.hole, (c) => (PREFLOP.push[kP][c] >= Math.min(20, pushTh) ? 1 : 0));
  // пушнул то, что Нэш не пушит, — считаем против самых сильных рук
  if (!range.length) range = rangeCombos(sp.hole, (c) => (PREFLOP.pct[c] < 0.1 ? 1 : 0));
  const eq = eqVsRange(sp.hole, [], range, samples, rng);
  const win = duel(P, true);
  const lose = duel(P, false);
  const evCall = eq * win[H] + (1 - eq) * lose[H];
  const evBB = (evCall - base) / sp.big;
  const c = Math.min(st[H], st[P]);
  const dead = seats.reduce((a, p) => a + (p !== H && p !== P ? post(p) : 0), 0);
  const callAmt = c - post(H);
  const potNow = c + dead + post(H);
  const need = callAmt / (potNow + callAmt);
  let icmA: number | undefined;
  let icmF: number | undefined;
  let needIcm: number | undefined;
  if (pool) {
    icmA = eq * icmOf(win) + (1 - eq) * icmOf(lose);
    const fold = foldStack();
    fold[P] += seats.reduce((a, p) => a + post(p), 0);
    icmF = icmOf(fold);
    const s1 = foldStack();
    s1[P] = st[P] - c;
    const s0 = vec(s1);
    needIcm = icmCallEquity(s0, sp.prizes!, seats.indexOf(H), seats.indexOf(P), callAmt, potNow);
  }
  const better = pool ? icmA! > icmF! : evBB > 0;
  const iCaller = Math.max(0, sp.behind.indexOf(H));
  return { kind: 'call', best: better ? 'call' : 'fold', evBB, icmAct: icmA, icmFold: icmF, nash: PREFLOP.call[kP]?.[Math.min(iCaller, kP - 1)]?.[cls] ?? 0, eff: Math.min(st[H], st[P]) / sp.big, eq, need, needIcm };
}

/** Порядок хода до флопа по истории: от первого после большого блайнда до большого блайнда. */
function preOrder(r: HandRecord): number[] {
  const pos = positions(r);
  const out: number[] = [];
  let x = pos.bb;
  for (let i = 0; i < pos.ring.length; i++) {
    x = pos.next(x);
    out.push(x);
  }
  return out;
}

type Act = Extract<HandRecord['acts'][number], { k: 'act' }>;

/** Найти в раздаче пуш/фолд-спот героя (холдем, безлимит, до 20 ББ). */
export function findPF(r: HandRecord, me: number, prizes?: number[]): { spot: PFSpot; did: 'push' | 'call' | 'fold' | 'other' } | null {
  if (r.game !== 'holdem' || r.struct !== 'nl') return null;
  const hole = r.hole[me];
  if (!hole || hole.length !== 2 || hole.some((c) => !c)) return null;
  const stacks: Record<number, number> = {};
  for (const x of r.seats) stacks[x.seat] = x.stack;
  const posted: Record<number, number> = {};
  for (const a of r.acts) if (a.k === 'post') posted[a.seat] = (posted[a.seat] ?? 0) + a.amount;
  const pre = r.acts.filter((a): a is Act => a.k === 'act' && a.street === 0);
  const hi = pre.findIndex((a) => a.seat === me);
  if (hi < 0) return null;
  const before = pre.slice(0, hi);
  const mine = pre[hi];
  const order = preOrder(r);
  const big = r.big;
  const pushLike = (a: Act, stack: number) => a.allin || ((a.a === 'raise' || a.a === 'bet') && a.to >= stack * 0.85);
  if (before.every((a) => a.a === 'fold')) {
    const behind = order.slice(order.indexOf(me) + 1);
    if (!behind.length) return null;
    const eff = Math.min(stacks[me], Math.max(...behind.map((p) => stacks[p]))) / big;
    if (eff > 20) return null;
    const did = mine.a === 'fold' ? 'fold' : pushLike(mine, stacks[me]) ? 'push' : 'other';
    return { spot: { kind: 'push', hero: me, hole: hole as Card[], big, stacks, posted, behind, prizes }, did };
  }
  const aggr = before.filter((a) => a.a !== 'fold');
  if (aggr.length !== 1 || !pushLike(aggr[0], stacks[aggr[0].seat])) return null;
  const P = aggr[0].seat;
  if (stacks[P] / big > 20 && stacks[me] / big > 20) return null;
  const behindP = order.slice(order.indexOf(P) + 1);
  const did = mine.a === 'fold' ? 'fold' : mine.a === 'call' || mine.allin ? 'call' : 'other';
  return { spot: { kind: 'call', hero: me, hole: hole as Card[], big, stacks, posted, behind: behindP, pusher: P, pusherBehind: behindP.length, prizes }, did };
}

// ---------------------------------------------------------------- лучший ход после раздачи

export interface Verdict {
  /** exact — пуш/фолд по Нэшу; estimate — оценка по шансам. */
  kind: 'exact' | 'estimate' | 'none';
  ok: boolean;
  /** Коротко — в журнал раздачи и историю. */
  short: string;
  /** Подробно (HTML). */
  html: string;
}

const ACT_RU = { push: 'ва-банк', call: 'колл', fold: 'пас', other: 'другой ход' };

/** Разбор раздачи для места me (по своей истории — чужие закрытые карты не нужны). */
export function bestMove(r: HandRecord, me: number, prizes?: number[], name: (seat: number) => string = (p) => `место ${p + 1}`): Verdict {
  const pf = findPF(r, me, prizes);
  if (pf) {
    const res = solvePF(pf.spot);
    const cls = classOf(pf.spot.hole[0], pf.spot.hole[1]);
    const lossBB = Math.abs(res.evBB);
    const icmLoss = res.icmAct != null && res.icmFold != null ? Math.abs(res.icmAct - res.icmFold) * 100 : null;
    const did = pf.did === 'other' ? 'other' : pf.did;
    const right = did === res.best;
    const bestRu = ACT_RU[res.best];
    const nashTxt = res.nash >= 20 ? 'при любом стеке до 20 ББ' : `до ${res.nash} ББ`;
    const what =
      res.kind === 'push'
        ? `До вас все спасовали, стек ${res.eff.toFixed(1)} ББ. По Нэшу ва-банк с ${cls} верен ${nashTxt}. Соперники ответят примерно в ${pct(res.callP ?? 0)} случаев, против их диапазона колла у вас ${pct(res.eq)}.`
        : `${name(pf.spot.pusher!)} пошёл ва-банк (${(pf.spot.stacks[pf.spot.pusher!] / r.big).toFixed(1)} ББ). По Нэшу колл с ${cls} верен ${nashTxt}. Против его диапазона пуша у вас ${pct(res.eq)}, нужно ${pct(res.need ?? 0)}${res.needIcm != null ? ` (по ICM — ${pct(res.needIcm)})` : ''}.`;
    const evTxt = `${res.kind === 'push' ? 'Ва-банк' : 'Колл'} против паса: ${fmtBB(res.evBB)}${icmLoss != null ? `, по ICM ${res.icmAct! >= res.icmFold! ? '+' : '−'}${icmLoss.toFixed(2)}% призовых` : ''}.`;
    const lossTxt = icmLoss != null ? `${icmLoss.toFixed(2)}% призовых (${lossBB.toFixed(1)} ББ в фишках)` : `${lossBB.toFixed(1)} ББ`;
    const short = right ? `Пуш/фолд: верно — ${bestRu}` : `Пуш/фолд: лучше ${bestRu} — потеряно ${lossTxt}`;
    return {
      kind: 'exact',
      ok: right,
      short,
      html: `<p><b>${right ? '✅ Верно' : '❌ Лучше — ' + bestRu}.</b> Вы сыграли: ${ACT_RU[did]}.</p><p>${what}</p><p>${evTxt}${right ? '' : ` Вы потеряли <b>${lossTxt}</b>.`}</p><p><small>Точно по таблицам Нэша (соперники играют по своим диапазонам Нэша; отвечает не больше одного).</small></p>`,
    };
  }
  if ((r.game !== 'holdem' && r.game !== 'shortdeck') || !r.hole[me]?.every((c) => c)) {
    return { kind: 'none', ok: true, short: '', html: '<p>Разбор по шансам — пока для холдема и Short Deck.</p>' };
  }
  return estimate(r, me, name);
}

/** Оценка решений «пас/колл» по шансам против диапазонов (по действию соперников до флопа; дальше не сужаем). */
function estimate(r: HandRecord, me: number, name: (seat: number) => string): Verdict {
  const sd = r.game === 'shortdeck';
  const hero = r.hole[me] as Card[];
  const rng = new SeededRng(11);
  const fr = frames(r, name);
  const pre = r.acts.filter((a): a is Act => a.k === 'act' && a.street === 0);
  // диапазон соперника по его действию до флопа
  const width = (p: number) => {
    const mine = pre.filter((a) => a.seat === p);
    if (mine.some((a) => a.a === 'raise' || a.a === 'bet')) return pre.filter((a) => a.a === 'raise' || a.a === 'bet').length > 1 ? 0.08 : 0.2;
    if (mine.some((a) => a.a === 'call')) return 0.45;
    return 1;
  };
  const notes: string[] = [];
  let bad = 0;
  for (const f of fr) {
    const a = f.act;
    if (!a || a.k !== 'act' || a.seat !== me || !f.toCall || (a.a !== 'fold' && a.a !== 'call')) continue;
    // соперники, ещё не спасовавшие к этому ходу
    const alive = r.seats.map((x) => x.seat).filter((p) => p !== me && !f.folded.includes(p));
    if (!alive.length) continue;
    const eq = multiEq(hero, f.board, alive.map(width), 500, rng, sd);
    const need = f.toCall / (f.potBefore! + f.toCall);
    const where = streetRu(f.street);
    if (a.a === 'fold' && eq > need + 0.08) {
      bad++;
      notes.push(`${where}: пас при шансах ~${pct(eq)}, а для колла хватало ${pct(need)} — колл, похоже, выгоднее.`);
    } else if (a.a === 'call' && eq < need - 0.08) {
      bad++;
      notes.push(`${where}: колл ${f.toCall} при шансах ~${pct(eq)}, а нужно ${pct(need)} — дорого (если не ждёте выигрыша на следующих улицах).`);
    } else notes.push(`${where}: ${a.a === 'fold' ? 'пас' : `колл ${f.toCall}`} — шансы ~${pct(eq)}, нужно ${pct(need)}: ${a.a === 'fold' ? 'пас оправдан' : 'колл оправдан'}.`);
  }
  if (!notes.length) return { kind: 'estimate', ok: true, short: '', html: '<p>В этой раздаче не было решений «пас или колл» — разбирать по шансам нечего.</p>' };
  return {
    kind: 'estimate',
    ok: !bad,
    short: bad ? `Оценка: ${bad} сомнительн${bad === 1 ? 'ое решение' : 'ых решения'}` : 'Оценка: решения по шансам в порядке',
    html: `<ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul><p><small>Это оценка, а не точный расчёт: диапазоны соперников — по их действию до флопа («рейз» — топ 20%, «колл» — топ 45%), после флопа не сужаются; будущие ставки не учитываются.</small></p>`,
  };
}

const streetRu = (st: number) => ['До флопа', 'На флопе', 'На тёрне', 'На ривере'][st] ?? 'Дальше';

/** Шансы против нескольких соперников, у каждого — верх его диапазона доли w (1 — любые карты). */
function multiEq(hero: Card[], board: Card[], widths: number[], samples: number, rng: Rng, sd: boolean): number {
  const known = new Set([...hero, ...board].map(key));
  const deck = allCards(sd).filter((c) => !known.has(key(c)));
  const pctOf = (a: Card, b: Card) => (sd ? prePct('shortdeck', [a, b]) : PREFLOP.pct[classIndex(a, b)]);
  let s = 0;
  let n = 0;
  for (let k = 0; k < samples; k++) {
    const used = new Set<string>();
    const take = () => {
      for (;;) {
        const c = deck[rng.int(deck.length)];
        if (!used.has(key(c))) {
          used.add(key(c));
          return c;
        }
      }
    };
    const opps: Card[][] = [];
    let okDeal = true;
    for (const w of widths) {
      let tries = 0;
      let h: Card[] = [];
      for (;;) {
        const a = take();
        const b = take();
        if (w >= 1 || pctOf(a, b) <= w || ++tries > 40) {
          h = [a, b];
          break;
        }
        used.delete(key(a));
        used.delete(key(b));
      }
      if (tries > 40) okDeal = false;
      opps.push(h);
    }
    if (!okDeal) continue;
    const b = board.slice();
    while (b.length < 5) b.push(take());
    const mine = fastHigh([...hero, ...b], sd);
    let top = mine;
    let ties = 1;
    let lost = false;
    for (const o of opps) {
      const v = fastHigh([...o, ...b], sd);
      if (v > top) lost = true;
      else if (v === top) ties++;
    }
    s += lost ? 0 : 1 / ties;
    n++;
  }
  return n ? s / n : 0;
}

// ---------------------------------------------------------------- подсказки по ходу раздачи

export interface Tips {
  /** Сила руки. */
  str?: string;
  /** Шансы и ауты. */
  odds?: string;
  /** Шансы банка и нужные шансы для колла. */
  pot?: string;
  /** M и зона. */
  m?: string;
  /** Пуш/фолд по Нэшу. */
  nash?: string;
  /** ICM-цена решения. */
  icm?: string;
}

export type TipKey = keyof Tips;
export const TIP_KEYS: { key: TipKey; label: string }[] = [
  { key: 'str', label: 'Сила руки' },
  { key: 'odds', label: 'Шансы и ауты' },
  { key: 'pot', label: 'Шансы банка' },
  { key: 'm', label: 'M и зона' },
  { key: 'nash', label: 'Пуш/фолд по Нэшу' },
  { key: 'icm', label: 'ICM-цена' },
];

/** Подсказки для своего места — только по своему виду: свои карты, доска, ставки и стеки. eq — шансы на банк (их
 * считает вызывающий, тяжёлым розыгрышем; null — не считали). */
export function tipsFor(v: View, seat: number, eq: number | null, nameOf: (seat: number) => string = (p) => `место ${p + 1}`): Tips {
  const t: Tips = {};
  const g = GAMES[v.game];
  const hole = v.hole[seat].filter(Boolean);
  if (!hole.length || !v.inHand.includes(seat) || v.folded[seat]) return t;
  const sd = !!g.short;
  // сила руки
  if (g.family === 'flop' && !v.board.length && hole.length === 2 && !g.omaha) {
    const p = sd ? prePct('shortdeck', hole) : PREFLOP.pct[classIndex(hole[0], hole[1])];
    t.str = `<b>${classOf(hole[0], hole[1])}</b> — сильнее ${pct(1 - p)} стартовых рук (в верхних ${pct(Math.max(0.01, p))})`;
  } else if (!v.board.length && g.family !== 'stud') {
    const p = prePct(v.game, hole, v.hilo);
    t.str = `Старт сильнее ${pct(1 - p)} рук этого вида`;
  } else if (g.pot === 'hi' && (g.family !== 'flop' || v.board.length >= 3)) {
    const cs = g.family === 'flop' ? [...hole, ...v.board] : hole;
    if (cs.length >= 5 && !g.omaha) t.str = `Сейчас у вас: <b>${CAT_RU[highCat(fastHigh(cs, sd))]}</b>`;
  }
  // шансы и ауты
  if (eq != null) {
    const n = contenders(v).length - 1;
    t.odds = `Шансы на банк ≈ <b>${pct(eq)}</b> против ${n} ${n === 1 ? 'соперника' : 'соперников'}${g.family === 'flop' && v.board.length ? ' (диапазоны — по их ходам)' : ''}`;
  }
  if (g.family === 'flop' && !g.omaha && hole.length === 2 && (v.board.length === 3 || v.board.length === 4)) {
    const o = outs(hole, v.board, sd);
    if (o && o.n) {
      const unseen = (sd ? 36 : 52) - 2 - v.board.length;
      const left = 5 - v.board.length;
      const ch = hitChance(o.n, unseen, left);
      t.odds = `${t.odds ? t.odds + '<br>' : ''}Аутов: <b>${o.n}</b> (${o.groups.map((x) => `${x.name} — ${x.n}`).join(', ')}): собрать ${left === 2 ? 'к риверу' : 'на ривере'} — ${pct(ch)} <small>(правило «${left === 2 ? '×4' : '×2'}»: ~${o.n * (left === 2 ? 4 : 2)}%)</small>`;
    }
  }
  // шансы банка
  const call = toCall(v, seat);
  const pot = potSize(v);
  if (call > 0) {
    const need = call / (pot + call);
    t.pot = `В банке ${pot}, колл ${call}: шансы банка ${(pot / call).toFixed(1)} к 1 — для колла нужно <b>${pct(need)}</b>${eq != null ? ` — ${eq >= need ? '<span class="pk-good">шансов хватает</span>' : '<span class="pk-bad">шансов мало</span>'}` : ''}`;
  }
  // M и зона
  if (g.family !== 'stud' && v.rec) {
    const stack = v.chips[seat] + v.total[seat];
    const z = zoneOf(stack, v.small, v.big, antesOf(v.rec));
    t.m = `M = <b style="color:${z.color}">${z.m.toFixed(1)}</b> (${z.name} зона, ${(stack / v.big).toFixed(1)} ББ): ${z.advice}`;
  }
  // пуш/фолд по Нэшу (холдем, безлимит, до флопа, до 20 ББ)
  if (v.game === 'holdem' && v.struct === 'nl' && v.street === 0 && hole.length === 2 && v.rec && !v.rec.acts.some((a) => a.k === 'act' && a.seat === seat)) {
    const pf = findPF({ ...v.rec, acts: [...v.rec.acts, { k: 'act', street: 0, seat, a: 'fold', amount: 0, to: v.bet[seat] }] }, seat, v.cfg.prizes);
    if (pf) {
      const cls = classIndex(hole[0], hole[1]);
      if (pf.spot.kind === 'push') {
        const k = tbl(pf.spot.behind.length);
        const th = PREFLOP.push[k][cls];
        const eff = Math.min(pf.spot.stacks[seat], Math.max(...pf.spot.behind.map((p) => pf.spot.stacks[p]))) / v.big;
        t.nash = `Нэш: ва-банк с ${classOf(hole[0], hole[1])} верен ${th >= 20 ? 'при любом стеке до 20 ББ' : `до ${th} ББ`}; у вас ${eff.toFixed(1)} ББ — <b>${th >= eff ? 'ва-банк' : 'пас'}</b>`;
      } else {
        const kP = tbl(pf.spot.pusherBehind ?? 1);
        const i = Math.max(0, pf.spot.behind.indexOf(seat));
        const th = PREFLOP.call[kP]?.[Math.min(i, kP - 1)]?.[cls] ?? 0;
        const risk = Math.min(pf.spot.stacks[seat], pf.spot.stacks[pf.spot.pusher!]) / v.big;
        t.nash = `Нэш: колл ва-банка ${nameOf(pf.spot.pusher!)} с ${classOf(hole[0], hole[1])} верен ${th >= 20 ? 'всегда (до 20 ББ)' : `до ${th} ББ`}; на кону ${risk.toFixed(1)} ББ — <b>${th >= risk ? 'колл' : 'пас'}</b>`;
      }
    }
  }
  // ICM-цена
  const prizes = v.cfg.prizes;
  if (prizes?.length && v.seats.length > 1) {
    const st = v.seats.map((p) => v.chips[p] + v.total[p]);
    const hero = v.seats.indexOf(seat);
    const opp = contenders(v).filter((p) => p !== seat);
    // спор — с тем, кто поставил больше всех (против ставки), иначе — с самым большим стеком
    const by = (p: number) => (call > 0 ? v.bet[p] : v.chips[p] + v.total[p]);
    const vil = opp.length ? opp.reduce((a, b) => (by(b) > by(a) ? b : a)) : -1;
    if (vil >= 0) {
      const vi = v.seats.indexOf(vil);
      const risk = Math.min(st[hero], st[vi]);
      const base = st.slice();
      const now = icm(base, prizes)[hero];
      const win = base.slice();
      win[hero] += risk;
      win[vi] -= risk;
      const lose = base.slice();
      lose[hero] -= risk;
      lose[vi] += risk;
      const gain = icm(win, prizes)[hero] - now;
      const loss = now - icm(lose, prizes)[hero];
      const bf = gain > 0 ? loss / gain : 1;
      const poolSum = prizes.reduce((a, b) => a + b, 0);
      let txt = `ICM: ваш стек стоит ${pct(now / poolSum, 1)} призовых. Спор на все с ${nameOf(vil)}: проигрыш −${pct(loss / poolSum, 1)}, выигрыш +${pct(gain / poolSum, 1)} — фактор пузыря <b>${bf.toFixed(2)}</b>`;
      if (call > 0 && call >= v.chips[seat] * 0.5) {
        const need = icmCallEquity(v.seats.map((p) => v.chips[p]), prizes, hero, vi, Math.min(call, v.chips[seat]), pot);
        txt += `; для колла нужно ${pct(need)} по ICM (без ICM — ${pct(call / (pot + call))})`;
      }
      t.icm = txt;
    }
  }
  return t;
}
