/* Покер — боты «как живые». Видят свои карты, открытые карты стада, общие карты, ставки и историю раздачи (свой вид).
 * Стиль (profiles.ts) закреплён за именем бота, уровень — сила внутри стиля.
 *
 * Флоп-игры (холдем, Short Deck, пайнэппл, Омаха, Куршевель):
 *   префлоп — таблицы-«чарты»: открытие по числу игроков позади, колл/3-бет/4-бет по действию до бота, ширина — от стиля;
 *     короткий стек в безлимите — пуш/фолд по таблицам Нэша (tools/poker/preflop.ts), на пузыре — поправка на ICM;
 *   постфлоп — шансы против диапазона каждого соперника: диапазон до флопа по его действиям (открыл, заколлировал,
 *     3-бет…), дальше сужается по ставкам/коллам на каждой улице (madeStr); размер ставки — по текстуре доски и силе;
 *     продолженная ставка, чек-рейз, полублеф с дро, вэлью-бет и блеф на ривере.
 * Стад, дро, лоуболл — шансы против случайных карт (открытые карты и обмены видны), пороги — от стиля.
 *   Лёгкий — шум в оценках, против «любых карт», размер ставки наугад; Средний — диапазоны «как у регуляра»;
 *   Сложный — больше розыгрышей, знает стиль соперника-бота (как по HUD), учитывает выигрыш потом у дро. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { allCards, badugi, combos, high } from './hands';
import { classIndex, fastHigh, fastLow8, fastLow8Omaha, fastOmaha } from './eval';
import { contenders, GAMES, info, potSize, raiseRange, toCall, values, type Action, type State, type View } from './engine';
import { profileOf, type Profile } from './profiles';
import { bestClass, holdemPct, madeStr, openWidth, prePct, PREFLOP, wet } from './ranges';
import { icm, icmCallEquity } from './icm';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** Быстрый режим (тесты): меньше розыгрышей. */
export const tune = { fast: !!env?.VITEST && !env?.SIM_GAMES };

const key = (c: Card) => c.s + c.r;

/** Какие карты сменить (правила обмена для каждого вида). */
export function discards(game: State['game'], hand: Card[]): Card[] {
  const low = (r: number, aceLow: boolean) => (r === 14 ? (aceLow ? 1 : 14) : r);
  if (game === 'badugi') {
    // оставить лучшее бадуги; карты старше девятки в неполном бадуги — менять
    let best: Card[] = [];
    let bv = -Infinity;
    for (let k = Math.min(4, hand.length); k >= 1; k--)
      for (const c of combos(hand, k)) {
        const v = badugi(c);
        if (c.length === new Set(c.map((x) => x.s)).size && c.length === new Set(c.map((x) => low(x.r, true))).size && v > bv) {
          bv = v;
          best = c;
        }
      }
    const keep = best.length === 4 ? best : best.filter((c) => low(c.r, true) <= 9);
    return hand.filter((c) => !keep.includes(c));
  }
  if (game === 'td27' || game === 'tda5' || game === 'badeucy' || game === 'badacey') {
    const aceLow = game === 'tda5' || game === 'badacey';
    const seen = new Set<number>();
    const keep: Card[] = [];
    for (const c of hand.slice().sort((a, b) => low(a.r, aceLow) - low(b.r, aceLow))) {
      const r = low(c.r, aceLow);
      if (r <= 8 && !seen.has(r) && !(game === 'td27' && c.r === 14)) {
        seen.add(r);
        keep.push(c);
      }
    }
    // 2–7: стрит или флеш на пяти — сломать старшей
    if (keep.length === 5 && (game === 'td27' || game === 'badeucy')) {
      const flush = keep.every((c) => c.s === keep[0].s);
      const rs = keep.map((c) => c.r).sort((a, b) => a - b);
      if (flush || rs[4] - rs[0] === 4) keep.splice(keep.indexOf(keep.reduce((a, c) => (c.r > a.r ? c : a))), 1);
    }
    return hand.filter((c) => !keep.includes(c));
  }
  // старшее дро: пары и выше оставить; иначе 4 к флешу; иначе две старших
  const cnt = new Map<number, number>();
  for (const c of hand) cnt.set(c.r, (cnt.get(c.r) ?? 0) + 1);
  const made = hand.filter((c) => cnt.get(c.r)! >= 2);
  if (made.length) {
    const v = high(hand);
    if (Math.floor(v / 15 ** 5) >= 4) return [];
    return hand.filter((c) => !made.includes(c));
  }
  for (const s of ['S', 'H', 'D', 'C']) {
    const f = hand.filter((c) => c.s === s);
    if (f.length >= 4) return hand.filter((c) => !f.includes(c)).slice(0, 1);
  }
  const top = hand.slice().sort((a, b) => b.r - a.r).slice(0, 2);
  return hand.filter((c) => !top.includes(c));
}

/** Пайнэппл: какую из трёх карт сбросить — оставить лучшую пару карт (до флопа — по таблице, после — по комбинации с доской). */
export function pineDiscard(game: State['game'], hand: Card[], board: Card[]): Card {
  const sd = !!GAMES[game].short;
  const score = (two: Card[]) => (board.length >= 3 ? fastHigh([...two, ...board], sd) : -holdemPct(two[0], two[1]));
  let best = hand[0];
  let bv = -Infinity;
  for (const c of hand) {
    const v = score(hand.filter((x) => x !== c));
    if (v > bv) {
      bv = v;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- шансы против случайных карт (стад, дро, лоуболл)

/** Доля банка, которую в среднем возьмёт seat, если чужие закрытые карты — любые. */
export function equity(v: View, seat: number, samples: number, rng: Rng): number {
  const g = info(v);
  const known = new Set<string>();
  for (const h of v.hole) for (const c of h) if (c) known.add(key(c));
  for (const c of v.board) known.add(key(c));
  const pool = allCards(g.short).filter((c) => !known.has(key(c)));
  const opp = contenders(v).filter((p) => p !== seat);
  const drawsLeft = g.family === 'draw' ? g.draws - v.street : 0;
  let share = 0;
  for (let k = 0; k < samples; k++) {
    const d = pool.slice();
    let di = 0;
    const take = () => {
      const j = di + rng.int(d.length - di);
      [d[di], d[j]] = [d[j], d[di]];
      return d[di++];
    };
    const hole = v.hole.map((h) => h.map((c) => c ?? take()));
    let board = v.board.slice();
    if (g.family === 'flop') while (board.length < 5) board.push(take());
    if (g.family === 'stud') for (const p of [seat, ...opp]) while (hole[p].length < g.cards) hole[p].push(take());
    if (g.discard) for (const p of [seat, ...opp]) if (hole[p].length > 2) hole[p] = hole[p].filter((c) => c !== pineDiscard(v.game, hole[p], v.board));
    if (g.family === 'draw')
      for (let r = 0; r < drawsLeft; r++)
        for (const p of [seat, ...opp]) {
          const out = discards(v.game, hole[p]);
          if (out.length && di + out.length <= d.length) hole[p] = [...hole[p].filter((c) => !out.includes(c)), ...out.map(() => take())];
        }
    share += showdownShare(v, hole, board, seat, opp);
  }
  return share / samples;
}

/** Доля банка seat на вскрытии (хай-лоу — половины). Флоп-игры без лоу — быстрой оценкой. */
function showdownShare(v: View, hole: Card[][], board: Card[], seat: number, opp: number[]): number {
  const g = info(v);
  const all = [seat, ...opp];
  if (g.family === 'flop' && g.pot === 'hi' && !v.hilo) {
    let mine = 0;
    let top = -1;
    let ties = 0;
    for (const p of all) {
      const val = g.omaha ? fastOmaha(hole[p], board) : fastHigh([...hole[p], ...board], !!g.short);
      if (p === seat) mine = val;
      if (val > top) {
        top = val;
        ties = 1;
      } else if (val === top) ties++;
    }
    return mine === top ? 1 / ties : 0;
  }
  const t = { ...(v as State), hole, board };
  const fast = (p: number) =>
    g.omaha && g.pot === 'hi'
      ? { hi: fastOmaha(hole[p], board), lo: fastLow8Omaha(hole[p], board) }
      : g.family === 'stud' && g.pot === 'hi'
        ? { hi: fastHigh(hole[p]), lo: v.hilo ? fastLow8(hole[p]) : null }
        : values(t, p);
  const val = new Map(all.map((p) => [p, fast(p)]));
  const part = (k2: 'hi' | 'lo') => {
    const vs = all.map((p) => val.get(p)![k2]).filter((x): x is number => x != null);
    if (!vs.length) return null;
    const top = Math.max(...vs);
    const ws = all.filter((p) => val.get(p)![k2] === top);
    return ws.includes(seat) ? 1 / ws.length : 0;
  };
  const hi = part('hi')!;
  const lo = v.hilo || g.pot === 'bad27' || g.pot === 'badA5' ? part('lo') : null;
  return lo == null ? hi : (hi + lo) / 2;
}

// ---------------------------------------------------------------- диапазоны соперников

type PreKind = 'open' | 'three' | 'four' | 'flat' | 'limp' | 'blind';
type PostKind = 'bet' | 'raise' | 'call' | 'check';

interface OppModel {
  seat: number;
  /** Вес руки с местом pct (0 — лучшая) по действию до флопа. */
  pre: (pct: number, cls: number) => number;
  streets: { board: Card[]; kind: PostKind }[];
  /** Доля блефа в ставках соперника и «липкость» его коллов. */
  bluff: number;
  loose: number;
}

/** Предфлоп: порядок хода (от первого после большого блайнда до большого блайнда). */
function preOrder(v: View): number[] {
  const ps = v.inHand.slice().sort((a, b) => a - b);
  const nx = (p: number) => ps[(ps.indexOf(p) + 1) % ps.length];
  const sb = ps.length === 2 ? v.button : nx(v.button);
  const bb = nx(sb);
  const out: number[] = [];
  let x = bb;
  for (let i = 0; i < ps.length; i++) {
    x = nx(x);
    out.push(x);
  }
  return out;
}

type Act = Extract<NonNullable<View['rec']>['acts'][number], { k: 'act' }>;
const actsOf = (v: View, street?: number): Act[] => (v.rec?.acts ?? []).filter((a): a is Act => a.k === 'act' && (street == null || a.street === street));
const aggressive = (a: Act) => a.a === 'bet' || a.a === 'raise';

/** Как соперник видится боту уровня level: лёгкий — «любые карты», средний — «как регуляр», сложный — знает стиль бота. */
function oppModels(v: View, seat: number, level: number): OppModel[] | null {
  if (level === 0) return null;
  const order = preOrder(v);
  const pre = actsOf(v, 0);
  const out: OppModel[] = [];
  for (const o of contenders(v)) {
    if (o === seat) continue;
    const pr = level === 2 ? profileOf(o) : null;
    const openK = pr ? pr.open : 1.25;
    const threeW = pr ? pr.three * (1 + pr.bluff3) + 0.01 : 0.06;
    const flatW = pr ? pr.flat + 0.03 : 0.16;
    // последнее действие до флопа и сколько рейзов было перед ним
    let kind: PreKind = 'blind';
    let raisesBefore = 0;
    let behind = 1;
    let seen = 0;
    for (const a of pre) {
      if (a.seat === o) {
        if (aggressive(a)) kind = seen === 0 ? 'open' : seen === 1 ? 'three' : 'four';
        else if (a.a === 'call') kind = seen === 0 ? 'limp' : 'flat';
        else if (a.a === 'check') kind = 'blind';
        raisesBefore = seen;
        behind = order.length - 1 - order.indexOf(o);
      }
      if (aggressive(a)) seen++;
    }
    const W = Math.min(0.95, openWidth(behind, order.length) * openK);
    const opened = kind === 'flat' && pre.some((a) => a.seat === o && aggressive(a));
    const preW = (p: number): number => {
      switch (kind) {
        case 'open':
          return p < W ? 1 : p < W + 0.1 ? 0.25 : 0.03;
        case 'three':
          return p < threeW ? 1 : p < threeW + 0.08 ? 0.2 : 0.02;
        case 'four':
          return p < 0.035 + (pr ? pr.three * 0.3 : 0) ? 1 : 0.03;
        case 'flat': {
          const F = opened ? W * 0.5 : flatW;
          return p < F ? (p < 0.025 && raisesBefore < 2 ? 0.35 : 1) : p < F + 0.1 ? 0.2 : 0.03;
        }
        case 'limp':
          return p < 0.04 ? 0.3 : p < 0.65 ? 1 : 0.35;
        default:
          return p < 0.06 ? 0.4 : 1;
      }
    };
    const streets: OppModel['streets'] = [];
    for (let st = 1; st <= v.street; st++) {
      const mine = actsOf(v, st).filter((a) => a.seat === o);
      if (!mine.length) continue;
      const last = mine[mine.length - 1];
      const kd: PostKind = mine.some((a) => a.a === 'raise') ? 'raise' : mine.some((a) => a.a === 'bet') ? 'bet' : last.a === 'call' ? 'call' : 'check';
      streets.push({ board: v.board.slice(0, st + 2), kind: kd });
    }
    out.push({ seat: o, pre: preW, streets, bluff: pr ? 0.08 + pr.bluff * 0.5 : 0.22, loose: pr ? 0.2 + pr.stick * 2.5 : 0.28 });
  }
  return out;
}

function postW(m: OppModel, s: number, kind: PostKind): number {
  switch (kind) {
    case 'bet':
      return s >= 0.42 ? 1 : m.bluff;
    case 'raise':
      return s >= 0.65 ? 1 : m.bluff * 0.45;
    case 'call':
      return s >= 0.2 ? 1 : m.loose;
    default:
      return s > 0.85 ? 0.4 : 1;
  }
}

/** Вес конкретных карт соперника. */
function weightOf(v: View, m: OppModel, hole: Card[]): number {
  const g = info(v);
  const p = hole.length === 2 && !g.omaha ? (v.game === 'shortdeck' ? prePct('shortdeck', hole) : holdemPct(hole[0], hole[1])) : prePct(v.game, hole, v.hilo);
  let w = m.pre(p, 0);
  for (const st of m.streets) {
    if (w < 0.005) break;
    w *= postW(m, madeStr(hole, st.board, !!g.omaha, !!g.short).s, st.kind);
  }
  return w;
}

/** Шансы флоп-игры против диапазонов (models = null — против любых карт). */
function flopEquity(v: View, seat: number, samples: number, rng: Rng, models: OppModel[] | null): number {
  const g = info(v);
  const known = new Set<string>();
  for (const h of v.hole) for (const c of h) if (c) known.add(key(c));
  for (const c of v.board) known.add(key(c));
  const pool = allCards(g.short).filter((c) => !known.has(key(c)));
  const opp = contenders(v).filter((p) => p !== seat);
  // двухкарточные соперники — перебором всех сочетаний с весами; у остальных (Омаха, три карты пайнэппла) —
  // взвешенная выборка случайных рук (вес считается один раз на руку, а не на каждый розыгрыш)
  type Hand = { cards: Card[]; cum: number };
  const lists = new Map<number, Hand[]>();
  if (models)
    for (const m of models) {
      const need = v.counts[m.seat];
      const list: Hand[] = [];
      let cum = 0;
      const add = (cards: Card[]) => {
        const w = weightOf(v, m, cards);
        if (w <= 0) return;
        cum += w;
        list.push({ cards, cum });
      };
      if (need === 2 && !g.omaha) {
        for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) add([pool[i], pool[j]]);
      } else
        for (let t = 0; t < Math.min(90, samples * 2); t++) {
          const h: Card[] = [];
          while (h.length < need) {
            const c = pool[rng.int(pool.length)];
            if (!h.includes(c)) h.push(c);
          }
          add(h);
        }
      if (cum > 0) lists.set(m.seat, list);
    }
  const pick = (list: Hand[]) => {
    const x = rng.next() * list[list.length - 1].cum;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].cum < x) lo = mid + 1;
      else hi = mid;
    }
    return list[lo].cards;
  };
  let share = 0;
  let n = 0;
  for (let k = 0; k < samples; k++) {
    const used = new Set<string>();
    const hole = v.hole.map((h) => h.slice());
    let ok = true;
    for (const o of opp) {
      const list = lists.get(o);
      let got: Card[] | null = null;
      for (let t = 0; t < 6 && list && !got; t++) {
        const cs = pick(list);
        if (!cs.some((c) => used.has(key(c)))) got = cs;
      }
      if (!got && list && list.length > 30) {
        ok = false;
        break;
      }
      if (!got) {
        got = [];
        while (got.length < v.counts[o]) {
          const c = pool[rng.int(pool.length)];
          if (!used.has(key(c)) && !got.includes(c)) got.push(c);
        }
      }
      hole[o] = got;
      for (const c of got) used.add(key(c));
    }
    if (!ok) continue;
    const board = v.board.slice();
    while (board.length < 5) {
      const c = pool[rng.int(pool.length)];
      if (used.has(key(c))) continue;
      used.add(key(c));
      board.push(c);
    }
    if (g.discard) for (const p of [seat, ...opp]) if (hole[p].length > 2) hole[p] = hole[p].filter((c) => c !== pineDiscard(v.game, hole[p], board.slice(0, Math.max(3, v.board.length))));
    share += showdownShare(v, hole, board, seat, opp);
    n++;
  }
  return n ? share / n : 1 / (opp.length + 1);
}

// ---------------------------------------------------------------- решения

interface Ctx {
  v: View;
  seat: number;
  level: number;
  prof: Profile;
  rng: Rng;
  call: number;
  pot: number;
  bb: number;
  /** Эффективный стек в больших блайндах (меньший из своего и самого большого из соперников). */
  eff: number;
  rr: [number, number] | null;
}

const prizesOf = (v: View): number[] | undefined => v.cfg.prizes;

function raiseTo(c: Ctx, to: number): Action {
  const { v, seat, rr, call } = c;
  if (!rr) return call > 0 ? { type: 'call' } : { type: 'check' };
  const t = Math.round(Math.max(rr[0], Math.min(rr[1], to)));
  if (t >= v.chips[seat] + v.bet[seat]) return { type: 'allin' };
  return { type: 'raise', to: t };
}
const potRaise = (c: Ctx, frac: number) => raiseTo(c, c.v.current + (c.pot + c.call) * frac);
const callOr = (c: Ctx): Action => (c.call <= 0 ? { type: 'check' } : c.call >= c.v.chips[c.seat] ? { type: 'allin' } : { type: 'call' });
const foldOr = (c: Ctx): Action => (c.call <= 0 ? { type: 'check' } : { type: 'fold' });
const shove = (c: Ctx): Action => (c.v.struct === 'nl' ? { type: 'allin' } : c.rr ? raiseTo(c, c.rr[1]) : callOr(c));

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'discard') return { type: 'discard', card: pineDiscard(v.game, v.hole[seat], v.board) };
  if (v.phase === 'draw') {
    const out = discards(v.game, v.hole[seat]);
    if (level === 0 && out.length < v.hole[seat].length && rng.next() < 0.25) {
      const extra = v.hole[seat].find((c) => !out.includes(c));
      if (extra) out.push(extra);
    }
    return { type: 'draw', cards: out };
  }
  const prof = profileOf(seat);
  const opp = contenders(v).filter((p) => p !== seat);
  const deepest = Math.max(0, ...opp.map((p) => v.chips[p] + v.bet[p]));
  const c: Ctx = {
    v,
    seat,
    level,
    prof,
    rng,
    call: toCall(v, seat),
    pot: potSize(v),
    bb: v.big,
    eff: Math.min(v.chips[seat] + v.bet[seat], deepest) / Math.max(1, v.big),
    rr: raiseRange(v, seat),
  };
  if (info(v).family === 'flop') return v.street === 0 ? preflop(c) : postflop(c);
  return otherBet(c);
}

// ---------------------------------------------------------------- префлоп

function preflop(c: Ctx): Action {
  const { v, seat, level, prof, rng } = c;
  const hole = v.hole[seat];
  let hp = prePct(v.game, hole, v.hilo);
  hp = Math.max(0, Math.min(1, hp + (level === 0 ? (rng.next() - 0.5) * 0.16 : level === 1 ? (rng.next() - 0.5) * 0.05 : 0)));
  const order = preOrder(v);
  const me = order.indexOf(seat);
  const behind = order.slice(me + 1).filter((p) => !v.folded[p]).length;
  const n = order.length;
  const pre = actsOf(v, 0);
  const raises = pre.filter(aggressive);
  const limpers = raises.length ? 0 : pre.filter((a) => a.a === 'call').length;
  const isBB = me === n - 1;
  const isSB = n === 2 ? v.button === seat : me === n - 2;

  // короткий стек в безлимите — пуш/фолд по Нэшу
  const pfLimit = level === 2 ? 15 : level === 1 ? 13 : 10;
  if (v.struct === 'nl' && !info(v).omaha && c.eff <= pfLimit) {
    const r = pushFold(c, order, me, behind, raises, limpers, isBB);
    if (r) return r;
  }

  const bb = c.bb;
  // никто не повышал
  if (!raises.length) {
    const W = Math.min(0.95, openWidth(Math.max(1, behind), n) * prof.open * (limpers ? 0.8 : 1));
    if (isBB && c.call <= 0) return hp < Math.min(0.3, 0.1 * prof.open) && rng.next() < 0.85 ? raiseTo(c, bb * (3 + limpers)) : { type: 'check' };
    if (hp < W) {
      if (rng.next() < prof.limp && hp > 0.03) return callOr(c);
      const size = n === 2 ? 2.5 : level === 0 ? 2 + rng.next() * 2 : prof.id === 'maniac' ? 3.5 : prof.id === 'fish' ? 4 : 2.5 + (behind > 2 ? 0.5 : 0);
      return raiseTo(c, bb * (size + limpers));
    }
    // доплатить малый блайнд или войти за лимперами — со спекулятивными; любители лимпа входят широко и сами
    const limpW = prof.limp > 0 ? prof.flat * 0.9 + (limpers || isSB ? 0.1 : 0) : limpers || isSB ? W * 1.3 : 0;
    if (hp < limpW) return callOr(c);
    return foldOr(c);
  }

  const raiser = raises[raises.length - 1].seat;
  const rIdx = order.indexOf(raiser);
  const rPr = level === 2 ? profileOf(raiser) : null;
  const callBB = c.call / bb;
  const potOdds = c.call / (c.pot + c.call);
  if (raises.length === 1) {
    const rW = Math.min(0.95, openWidth(Math.max(1, order.length - 1 - rIdx), n) * (rPr ? rPr.open : 1.15));
    const rel = Math.sqrt(rW / 0.2);
    let three = Math.min(0.25, Math.max(0.015, prof.three * rel));
    let flat = Math.min(0.6, prof.flat * rel + (isBB ? 0.08 : 0) - (isSB ? 0.02 : 0));
    // дорогой колл (больше трёх открытий или четверти стека) — уже
    if (callBB > 4 || c.call > v.chips[seat] * 0.25) flat *= 0.55;
    // против маньяка сложный шире защищается и 3-бетит на вэлью
    if (rPr?.id === 'maniac') {
      three *= 1.6;
      flat *= 1.3;
    } else if (rPr?.id === 'nit') {
      three *= 0.6;
      flat *= 0.6;
    }
    if (hp < three) return raiseTo(c, v.current * (behind >= 2 || isSB || isBB ? 3.5 : 3) + (pre.filter((a) => a.a === 'call').length) * v.current);
    if (hp < flat) return potOdds < 0.4 || hp < flat * 0.5 ? callOr(c) : foldOr(c);
    if (hp < flat + 0.07 && rng.next() < prof.bluff3) return raiseTo(c, v.current * 3.2);
    return foldOr(c);
  }
  // против 3-бета и дальше
  const mineRaised = raises.some((a) => a.seat === seat);
  const k = raises.length;
  const four = Math.min(0.2, (k === 2 ? 0.025 : 0.014) * (prof.three / 0.035) * (rPr?.id === 'maniac' ? 2.2 : 1));
  const cont = Math.min(0.35, (mineRaised ? 0.07 : 0.03) * (prof.flat / 0.09) ** 0.5 * (rPr?.id === 'maniac' ? 1.8 : 1));
  if (hp < four) return c.eff <= 40 || k >= 3 ? shove(c) : raiseTo(c, v.current * 2.3);
  if (hp < cont && (potOdds < 0.45 || hp < four * 2)) return callOr(c);
  if (k === 2 && mineRaised && hp < cont + 0.05 && rng.next() < prof.bluff3 * 0.25) return raiseTo(c, v.current * 2.3);
  return foldOr(c);
}

/** Пуш/фолд: null — стек слишком глубокий для этой ситуации, решать обычным путём. */
function pushFold(c: Ctx, order: number[], me: number, behind: number, raises: Act[], limpers: number, isBB: boolean): Action | null {
  const { v, seat, level, prof, rng } = c;
  const hole = v.hole[seat];
  const cls = bestClass(hole);
  const n = order.length;
  const prizes = prizesOf(v);
  const S = c.eff;
  // на пузыре фишку проигрывать дороже: ва-банк уже (только средний и сложный знают ICM)
  let icmK = 1;
  if (prizes && level > 0) {
    const st = v.seats.map((p) => v.chips[p] + v.bet[p]);
    const eq = icm(st, prizes);
    const tot = st.reduce((a, b) => a + b, 0);
    const i = v.seats.indexOf(seat);
    const chipShare = st[i] / tot;
    const prizeShare = eq[i] / prizes.reduce((a, b) => a + b, 0);
    icmK = Math.max(0.55, Math.min(1, prizeShare / Math.max(0.01, chipShare)));
  }
  if (level === 0) {
    if (!raises.length) return c.call <= 0 && isBB ? { type: 'check' } : PREFLOP.pct[cls] < 0.2 * prof.shove + (S < 6 ? 0.2 : 0) ? shove(c) : foldOr(c);
    return PREFLOP.pct[cls] < 0.12 * prof.shove + (S < 5 ? 0.15 : 0) ? shove(c) : foldOr(c);
  }
  if (!raises.length) {
    const k = n === 2 ? 1 : Math.max(1, Math.min(8, behind));
    if (isBB && c.call <= 0) return PREFLOP.push[2][cls] * 0.8 * icmK >= S && limpers ? shove(c) : { type: 'check' };
    const th = PREFLOP.push[k][cls] * prof.shove * icmK * (limpers ? 0.8 : 1);
    return th >= S ? shove(c) : foldOr(c);
  }
  const last = raises[raises.length - 1];
  const raiser = last.seat;
  const big = last.allin || c.call >= v.chips[seat] * 0.35 || c.call >= (v.chips[seat] + v.bet[seat]) * 0.3;
  if (!big) {
    // маленький рейз от короткого стека — ре-пуш уже, чем первый ва-банк
    const k = n === 2 ? 1 : Math.max(1, Math.min(8, behind + 1));
    return PREFLOP.push[k][cls] * 0.6 * prof.shove * icmK >= S ? shove(c) : foldOr(c);
  }
  const rIdx = order.indexOf(raiser);
  const kP = n === 2 ? 1 : Math.max(1, Math.min(8, n - 1 - rIdx));
  const i = Math.max(0, Math.min(kP - 1, me > rIdx ? me - rIdx - 1 : kP - 1));
  const callAdj = 1 + prof.stick * 2 - (prof.id === 'nit' ? 0.15 : 0);
  // ставка коллера — его стек или стек пушера
  const risk = Math.min(v.chips[seat] + v.bet[seat], v.chips[raiser] + v.bet[raiser]) / c.bb;
  if (prizes && level === 2) {
    // ICM: нужные шансы против диапазона пушера по Нэшу
    const st = v.seats.map((p) => v.chips[p] + v.bet[p]);
    const hero = v.seats.indexOf(seat);
    const vil = v.seats.indexOf(raiser);
    const dead = c.pot - v.bet[raiser] - v.bet[seat];
    const need = icmCallEquity(st, prizes, hero, vil, risk * c.bb, Math.max(0, dead) + v.bet[raiser] + v.bet[seat] - risk * c.bb);
    const rangeTh = Math.max(1, risk);
    const models: OppModel[] = [{ seat: raiser, pre: (_p, k2) => (PREFLOP.push[kP][k2] >= rangeTh ? 1 : 0.02), streets: [], bluff: 0, loose: 0 }];
    const eq = holdemVsClasses(v, seat, models, tune.fast ? 30 : 120, rng);
    return eq >= need ? callOr(c) : foldOr(c);
  }
  const th = (PREFLOP.call[kP]?.[i]?.[cls] ?? 0) * callAdj * (prizes ? icmK : 1);
  if (th >= risk || (c.call / (c.pot + c.call) < 0.2 && PREFLOP.pct[cls] < 0.5)) return callOr(c);
  if (rng.next() < 0.03 * prof.bluff) return callOr(c);
  return foldOr(c);
}

/** Шансы двух своих карт против диапазона, заданного весом по классу холдема (для пуш/фолда с ICM). */
function holdemVsClasses(v: View, seat: number, models: OppModel[], samples: number, rng: Rng): number {
  const m = models[0];
  const known = new Set(v.hole[seat].map(key).concat(v.board.map(key)));
  const pool = allCards(info(v).short).filter((c) => !known.has(key(c)));
  const list: { a: Card; b: Card; cum: number }[] = [];
  let cum = 0;
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const w = m.pre(0, classIndex(pool[i], pool[j]));
      if (w <= 0) continue;
      cum += w;
      list.push({ a: pool[i], b: pool[j], cum });
    }
  const hero = bestTwo(v, seat);
  let s = 0;
  for (let k = 0; k < samples; k++) {
    const x = rng.next() * cum;
    const o = list.find((e) => e.cum >= x)!;
    const used = new Set([key(o.a), key(o.b)]);
    const board = v.board.slice();
    while (board.length < 5) {
      const c = pool[rng.int(pool.length)];
      if (used.has(key(c))) continue;
      used.add(key(c));
      board.push(c);
    }
    const a = fastHigh([...hero, ...board]);
    const b = fastHigh([o.a, o.b, ...board]);
    s += a > b ? 1 : a === b ? 0.5 : 0;
  }
  return s / samples;
}
const bestTwo = (v: View, seat: number): Card[] => {
  const h = v.hole[seat];
  if (h.length === 2) return h;
  const k = bestClass(h);
  for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) if (bestClass([h[i], h[j]]) === k) return [h[i], h[j]];
  return h.slice(0, 2);
};

// ---------------------------------------------------------------- после флопа

function postflop(c: Ctx): Action {
  const { v, seat, level, prof, rng } = c;
  const g = info(v);
  const opp = contenders(v).filter((p) => p !== seat);
  const nOpp = opp.length;
  const models = oppModels(v, seat, level);
  const samples = tune.fast ? 24 : g.omaha ? (g.cards === 5 ? [40, 80, 120] : [50, 100, 160])[level] : [80, 220, 400][level];
  let eq = flopEquity(v, seat, samples, rng, models);
  if (level === 0) eq += (rng.next() - 0.5) * 0.24;
  const ms = madeStr(v.hole[seat].length > 2 && !g.omaha ? bestTwo(v, seat) : v.hole[seat], v.board, !!g.omaha, !!g.short);
  const river = v.street >= 3;
  const tex = wet(v.board);
  const pre = actsOf(v, 0);
  const preAgg = pre.filter(aggressive).pop()?.seat === seat;
  const here = actsOf(v, v.street);
  const iChecked = here.some((a) => a.seat === seat && a.a === 'check');
  const prev = v.street > 1 ? actsOf(v, v.street - 1) : [];
  const iBetPrev = prev.some((a) => a.seat === seat && aggressive(a));
  // сложный подстраивается под стиль главного соперника
  const vil = level === 2 && nOpp === 1 ? profileOf(opp[0]) : null;
  const bluffK = vil ? (vil.id === 'station' ? 0.25 : vil.id === 'nit' ? 1.6 : vil.id === 'maniac' ? 0.5 : 1) : 1;
  const callK = vil ? (vil.id === 'maniac' ? -0.06 : vil.id === 'nit' ? 0.05 : vil.id === 'lag' ? -0.03 : 0) : 0;
  const size = (base: number) => (level === 0 ? 0.4 + rng.next() * 0.6 : base);

  if (c.call <= 0) {
    const valueTh = (river ? 0.58 : 0.53) + 0.07 * (nOpp - 1) - (vil?.id === 'station' ? 0.05 : 0);
    if (eq >= valueTh) {
      // очень сильная на сухой доске — иногда «медленно», дать соперникам догнать или поблефовать
      if (eq > 0.88 && !river && tex < 0.4 && rng.next() < 0.25 / prof.aggr) return { type: 'check' };
      if (rng.next() < Math.min(1, 0.72 * prof.aggr)) return potRaise(c, size(river && eq > 0.85 ? 0.75 + tex * 0.2 : tex >= 0.6 ? 0.7 : 0.5));
    }
    // продолженная ставка
    if (preAgg && v.street === 1 && !here.some(aggressive)) {
      const p = prof.cbet * (tex < 0.4 ? 1.1 : 0.85) * (nOpp > 1 ? 0.55 : 1) * (level === 2 && vil?.id === 'station' && eq < 0.4 ? 0.6 : 1);
      if (rng.next() < p) return potRaise(c, size(tex < 0.4 ? 0.33 : 0.6));
    }
    // второй ствол на тёрне
    if (v.street === 2 && iBetPrev && (eq > 0.45 || ms.draw > 0.15) && rng.next() < 0.45 * prof.aggr) return potRaise(c, size(0.6));
    // полублеф с дро
    if (!river && ms.draw >= 0.15 && rng.next() < 0.33 * prof.aggr) return potRaise(c, size(0.6));
    // все до меня прочекали — забрать банк ставкой (в позиции, вдвоём или втроём)
    const checkedToMe = here.length > 0 && here.every((a) => a.a === 'check') && !iChecked;
    if (checkedToMe && nOpp <= 2 && rng.next() < (0.28 * prof.aggr * bluffK) / nOpp) return potRaise(c, size(0.5));
    // блеф на ривере, когда соперники показали слабость (чек)
    if (river && eq < 0.3 && rng.next() < (prof.bluff * 0.4 * bluffK) / nOpp) return potRaise(c, size(0.7));
    return { type: 'check' };
  }

  const odds = c.call / (c.pot + c.call);
  const margin = (level === 2 ? 0 : level === 1 ? 0.02 : -0.04) - prof.stick + callK;
  // у дро выигрыш потом: на глубоких стеках сложный и средний доплачивают чуть дороже шансов банка
  const implied = level > 0 && !river && ms.draw >= 0.15 && c.eff > 30 ? 0.05 : 0;
  const raiseTh = 0.72 + 0.05 * (nOpp - 1) - (vil?.id === 'maniac' ? 0.08 : 0);
  if (eq >= raiseTh && c.rr && rng.next() < Math.min(1, 0.6 * prof.aggr * (iChecked ? 1.25 : 1))) return raiseTo(c, v.current * 2.8 + (c.pot - v.current) * 0.3);
  if (!river && ms.draw >= 0.2 && c.rr && rng.next() < 0.14 * prof.aggr * (vil?.id === 'nit' ? 1.5 : 1)) return raiseTo(c, v.current * 3);
  if (c.rr && rng.next() < prof.bluff * 0.05 * bluffK) return raiseTo(c, v.current * 2.6);
  if (eq >= odds + margin - implied) return callOr(c);
  // колл-станция не отпускает пару
  if (prof.stick > 0.1 && ms.s >= 0.2 && rng.next() < 0.6) return callOr(c);
  return { type: 'fold' };
}

// ---------------------------------------------------------------- стад, дро, лоуболл

function otherBet(c: Ctx): Action {
  const { v, seat, level, prof, rng, call, pot } = c;
  // первая улица — по силе старта, ширина от стиля (как чарты во флоп-играх)
  if (v.street === 0) {
    let hp = prePct(v.game, v.hole[seat], v.hilo);
    if (level === 0) hp = Math.max(0, Math.min(1, hp + (rng.next() - 0.5) * 0.16));
    const playW = Math.min(0.9, 0.2 * Math.sqrt(prof.open) + prof.flat * 0.5);
    const raiseW = playW * Math.min(1, 0.35 * prof.aggr);
    if (v.raises === 0) {
      if (hp < raiseW && c.rr) return potRaise(c, 0.5);
      return hp < playW ? callOr(c) : foldOr(c);
    }
    if (hp < raiseW * 0.4 && c.rr) return potRaise(c, 0.5);
    return hp < playW * (0.5 + prof.stick * 2) ? callOr(c) : foldOr(c);
  }
  const opp = contenders(v).length - 1;
  const samples = tune.fast ? 12 : level === 0 ? 25 : level === 1 ? 70 : 160;
  let eq = equity(v, seat, samples, rng);
  if (level === 0) eq += (rng.next() - 0.5) * 0.25;
  const fair = 1 / (opp + 1);
  const odds = call > 0 ? call / (pot + call) : 0;
  const strong = eq > (fair * (level === 2 ? 1.6 : 1.8)) / Math.sqrt(prof.aggr) && eq > 0.4;
  if (strong && c.rr && (level > 0 || rng.next() < 0.5) && rng.next() < Math.min(1, 0.85 * prof.aggr)) return potRaise(c, level === 2 ? 0.5 + rng.next() * 0.4 : 0.6);
  if (!call && c.rr && rng.next() < (level === 2 ? 0.07 : 0.03) * (prof.bluff / 0.25)) return potRaise(c, 0.5);
  if (call === 0) return { type: 'check' };
  // на первой улице стиль решает, с чем входить
  const loose = v.street === 0 ? (prof.flat - 0.09) * 0.4 : 0;
  if (eq >= odds + (level === 2 ? 0.02 : 0.05) - prof.stick - loose || (level === 0 && rng.next() < 0.2)) return callOr(c);
  return { type: 'fold' };
}

