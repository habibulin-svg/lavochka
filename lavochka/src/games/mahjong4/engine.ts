/* Маджонг вчетвером — движок стола без DOM: стена, раздача, цветы, ход «взял — сбросил», заявки (чи, пон, кан, рон),
 * закрытый и добавленный конг (с ограблением), риичи с фуритэном и дорой, сычуаньская «кровавая битва», ничья, смена дилера и кругов.
 * Набор правил — Cfg; подсчёт руки — score.ts.
 * Кость — номер 0–143 (tiles.ts): kind = id >> 2, цветы и сезоны — 136–143. Красная пятёрка (риичи) — номер kind*4 у пятёрок. */
import type { Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { isBonus, isSuit, kindOf, suitOf } from '../mahjong/tiles';
import { counts, isComplete, shanten, waits, type HandRules } from './hand';
import { riichiBase, riichiLabel, scoreWin, type Item, type Meld, type Style, type WinInfo } from './score';

export interface Cfg {
  style: Style;
  flowers: boolean;
  honors: boolean;
  /** 13 или 16 костей на руке. */
  hand: 13 | 16;
  chow: boolean;
  /** Порог: фань (Гонконг), таи (Тайвань); в риичи — нужно яку. */
  min: number;
  aka: boolean;
  kuitan: boolean;
  seven: boolean;
  thirteen: boolean;
  /** Сколько кругов ветров: 1 — восточный, 2 — восток и юг, 4 — все. */
  rounds: number;
  start: number;
  /** Потолок ценности (фань в Гонконге, фань в Сычуани). */
  limit: number;
  /** Несколько выигравших на одном сбросе (иначе — ближайший по ходу). */
  multiRon: boolean;
  /** Сычуань: отсутствующая масть и игра до трёх выигравших. */
  sichuan: boolean;
  /** Подсказки новичку: ожидания, лучший сброс. */
  hints: boolean;
}

export interface Disc {
  id: number;
  riichi?: boolean;
  /** Забрана заявкой. */
  taken?: boolean;
}

export interface PlayerS {
  hand: number[];
  melds: Meld[];
  discards: Disc[];
  flowers: number[];
  riichi: 0 | 1 | 2;
  ippatsu: boolean;
  /** Риичи пропустил выигрыш — до конца раздачи. */
  furiten: boolean;
  /** Пропустил выигрыш на этом круге — до своего следующего сброса. */
  tempFuriten: boolean;
  /** Нельзя сбросить кость этого вида (только что взял её заявкой). */
  forbid: number;
  /** Сычуань: отсутствующая масть (−1 — ещё не выбрал). */
  missing: number;
  won: boolean;
  /** Ставка риичи внесена. */
  paid: boolean;
}

export interface Opts {
  ron?: boolean;
  pon?: boolean;
  mkan?: boolean;
  /** Чи: младшие виды возможных рядов. */
  chi?: number[];
}

export interface WinRec {
  seat: number;
  /** −1 — взял сам. */
  from: number;
  win: number;
  hand: number[];
  melds: Meld[];
  flowers: number[];
  items: Item[];
  value: number;
  fu?: number;
  label: string;
  gain: number;
}

export interface HandResult {
  kind: 'win' | 'draw';
  wins: WinRec[];
  deltas: number[];
  tenpai?: boolean[];
  /** Открытые руки темпай при ничьей. */
  shown?: (number[] | null)[];
  ura?: number[];
  text: string;
}

export type Phase = 'missing' | 'turn' | 'claim' | 'end' | 'over';

export interface State {
  cfg: Cfg;
  scores: number[];
  round: number;
  dealer: number;
  /** Дилер, с которого начался круг (место 0). */
  honba: number;
  sticks: number;
  hands: number;
  live: number[];
  dead: number[];
  /** Указатели доры (риичи). */
  dora: number[];
  ura: number[];
  kans: number;
  p: PlayerS[];
  phase: Phase;
  turn: number;
  drawn: number;
  /** Ход после кости за конг или цветок. */
  rinshan: boolean;
  last: { seat: number; id: number } | null;
  pending: Record<number, Opts>;
  answers: Record<number, Action>;
  /** Добавленный конг, который можно ограбить. */
  rob: { seat: number; id: number; k: number } | null;
  /** Первый круг без заявок (небесная и земная рука, дабл риичи). */
  calls: number;
  /** Сычуань: выигрыши этой раздачи; остальным — общее. */
  wins: WinRec[];
  deltas: number[];
  result: HandResult | null;
  acks: boolean[];
  /** Кто первым выиграл в раздаче (Сычуань: следующий дилер). */
  firstWinner: number;
}

export type Action =
  | { t: 'discard'; id: number; riichi?: boolean }
  | { t: 'tsumo' }
  | { t: 'kan'; k: number }
  | { t: 'ron' }
  | { t: 'pon' }
  | { t: 'mkan' }
  | { t: 'chi'; k: number }
  | { t: 'pass' }
  | { t: 'missing'; suit: number }
  | { t: 'next' };

export type Event =
  | { type: 'deal'; dealer: number; round: number; hands: number[][]; honba: number; dora: number[] }
  | { type: 'draw'; seat: number; id: number; back: boolean }
  | { type: 'flower'; seat: number; id: number }
  | { type: 'discard'; seat: number; id: number; riichi: boolean; auto: boolean }
  | { type: 'call'; seat: number; meld: Meld; from: number; t: 'chi' | 'pon' | 'kan' }
  | { type: 'kan'; seat: number; meld: Meld; added: boolean }
  | { type: 'dora'; id: number }
  | { type: 'missing'; seat: number; suit: number }
  | { type: 'win'; rec: WinRec }
  | { type: 'pay'; deltas: number[]; why: string }
  | { type: 'end'; result: HandResult }
  | { type: 'over'; scores: number[] };

// ---------------------------------------------------------------- правила руки

export const rulesOf = (c: Cfg): HandRules => ({ sets: c.hand === 16 ? 5 : 4, seven: c.seven, thirteen: c.thirteen });
export const seatWind = (s: Pick<State, 'dealer'>, seat: number) => (seat - s.dealer + 4) % 4;
export const isRed = (c: Cfg, id: number) => c.aka && id < 136 && id % 4 === 0 && (id >> 2 === 4 || id >> 2 === 13 || id >> 2 === 22);
const RIICHI_DEAD = 14;

/** Вид доры по указателю: следующий по кругу в своей группе. */
export function doraOf(ind: number): number {
  const k = kindOf(ind);
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k <= 30) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

const kindsOf = (ids: number[]) => ids.map(kindOf);
const openSets = (p: PlayerS) => p.melds.length;
/** Сколько костей можно ещё взять со стены. */
export const wallLeft = (s: State) => s.live.length;

// ---------------------------------------------------------------- новая партия и раздача

export function newGame(cfg: Cfg, rng: Rng): State {
  const s: State = {
    cfg,
    scores: [cfg.start, cfg.start, cfg.start, cfg.start],
    round: 0,
    dealer: 0,
    honba: 0,
    sticks: 0,
    hands: 0,
    live: [],
    dead: [],
    dora: [],
    ura: [],
    kans: 0,
    p: [],
    phase: 'turn',
    turn: 0,
    drawn: -1,
    rinshan: false,
    last: null,
    pending: {},
    answers: {},
    rob: null,
    calls: 0,
    wins: [],
    deltas: [0, 0, 0, 0],
    result: null,
    acks: [false, false, false, false],
    firstWinner: -1,
  };
  const ev: Event[] = [];
  deal(s, rng, ev);
  return s;
}

function blankPlayer(): PlayerS {
  return { hand: [], melds: [], discards: [], flowers: [], riichi: 0, ippatsu: false, furiten: false, tempFuriten: false, forbid: -1, missing: -1, won: false, paid: false };
}

function tileList(c: Cfg): number[] {
  const r: number[] = [];
  for (let id = 0; id < 136; id++) {
    const k = id >> 2;
    if (!c.honors && k >= 27) continue;
    r.push(id);
  }
  if (c.flowers) for (let id = 136; id < 144; id++) r.push(id);
  return r;
}

function deal(s: State, rng: Rng, ev: Event[]) {
  const c = s.cfg;
  const all = shuffle(tileList(c), rng);
  s.p = [0, 1, 2, 3].map(blankPlayer);
  s.dead = c.style === 'riichi' ? all.splice(0, RIICHI_DEAD) : [];
  s.live = all;
  s.kans = 0;
  s.dora = c.style === 'riichi' ? [s.dead[0]] : [];
  s.ura = c.style === 'riichi' ? [s.dead[5]] : [];
  s.calls = 0;
  s.wins = [];
  s.deltas = [0, 0, 0, 0];
  s.result = null;
  s.rob = null;
  s.last = null;
  s.pending = {};
  s.answers = {};
  s.firstWinner = -1;
  s.acks = [false, false, false, false];
  for (let k = 0; k < c.hand; k++) for (let i = 0; i < 4; i++) s.p[(s.dealer + i) % 4].hand.push(s.live.shift()!);
  // цветы — в сторону, взамен кость с хвоста стены
  for (let i = 0; i < 4; i++) {
    const p = s.p[(s.dealer + i) % 4];
    for (;;) {
      const b = p.hand.findIndex((id) => isBonus(kindOf(id)));
      if (b < 0) break;
      p.flowers.push(p.hand.splice(b, 1)[0]);
      p.hand.push(s.live.pop()!);
    }
  }
  ev.push({ type: 'deal', dealer: s.dealer, round: s.round, hands: s.p.map((p) => p.hand.slice()), honba: s.honba, dora: s.dora.slice() });
  if (c.sichuan) {
    s.phase = 'missing';
    return;
  }
  startTurn(s, s.dealer, ev, false);
}

// ---------------------------------------------------------------- ход

/** Игрок seat берёт кость (back — с хвоста: за конг или цветок). Пустая стена — ничья. */
function startTurn(s: State, seat: number, ev: Event[], back: boolean) {
  const p = s.p[seat];
  s.turn = seat;
  s.rinshan = back;
  for (;;) {
    let id: number | undefined;
    if (back && s.cfg.style === 'riichi') {
      // кость за конг — из мёртвой стены (места 10–13); чтобы в мёртвой осталось 14, живая стена теряет хвост
      id = s.live.length ? s.dead[10 + s.kans - 1] : undefined;
      if (id != null) s.live.pop();
    } else id = back ? s.live.pop() : s.live.shift();
    if (id == null) {
      exhaustive(s, ev);
      return;
    }
    ev.push({ type: 'draw', seat, id, back });
    if (isBonus(kindOf(id))) {
      p.flowers.push(id);
      ev.push({ type: 'flower', seat, id });
      back = true;
      s.rinshan = true;
      continue;
    }
    p.hand.push(id);
    s.drawn = id;
    break;
  }
  s.phase = 'turn';
  // риичи: без выбора — сбросить взятую (если не выигрыш и не конг)
  if (p.riichi && !canTsumo(s, seat) && !turnKans(s, seat).length) {
    discard(s, seat, s.drawn, false, ev, true);
  }
}

/** Карта игрока для подсчёта: закрытая часть + win (уже в руке при цумо). */
function winInfo(s: State, seat: number, winId: number, tsumo: boolean, extra: Partial<WinInfo> = {}): WinInfo {
  const p = s.p[seat];
  const hand = tsumo ? p.hand : [...p.hand, winId];
  const c = s.cfg;
  const first = s.calls === 0 && p.discards.length === 0;
  const ids = [...hand, ...p.melds.flatMap((m) => m.ids)];
  return {
    style: c.style,
    closed: counts(kindsOf(hand)),
    melds: p.melds,
    win: kindOf(winId),
    tsumo,
    seatWind: seatWind(s, seat),
    roundWind: s.round % 4,
    dealer: seat === s.dealer,
    flowers: kindsOf(p.flowers),
    sets: rulesOf(c).sets,
    riichi: p.riichi,
    ippatsu: p.ippatsu,
    lastTile: s.live.length === 0,
    rinshan: tsumo && s.rinshan,
    chankan: false,
    heaven: tsumo && first && seat === s.dealer,
    earth: tsumo && first && seat !== s.dealer && c.style !== 'classic',
    dora: s.dora.map(doraOf),
    ura: s.ura.map(doraOf),
    aka: ids.filter((id) => isRed(c, id)).length,
    repeat: s.honba,
    limit: c.limit,
    kuitan: c.kuitan,
    ...extra,
  };
}

/** Может ли выиграть с костью и проходит ли порог. */
export function canWinWith(s: State, seat: number, winId: number, tsumo: boolean, extra: Partial<WinInfo> = {}) {
  const p = s.p[seat];
  if (p.won) return null;
  const c = s.cfg;
  const hand = tsumo ? p.hand : [...p.hand, winId];
  const cnt = counts(kindsOf(hand));
  if (!isComplete(cnt, openSets(p), rulesOf(c))) return null;
  if (c.sichuan && hand.some((id) => suitOf(kindOf(id)) === p.missing)) return null;
  const w = winInfo(s, seat, winId, tsumo, extra);
  const sc = scoreWin(w);
  if (!sc) return null;
  if (c.style === 'riichi' && !sc.yaku) return null;
  if ((c.style === 'hk' || c.style === 'tw') && sc.value < c.min) return null;
  return sc;
}

export function canTsumo(s: State, seat: number): boolean {
  if (s.phase !== 'turn' || s.turn !== seat || s.drawn < 0) return false;
  return !!canWinWith(s, seat, s.drawn, true);
}

/** Конги на своём ходу: закрытые (четыре в руке) и добавленные (к своему пону). Виды. */
export function turnKans(s: State, seat: number): number[] {
  const p = s.p[seat];
  if (s.turn !== seat || s.live.length === 0 || s.kans >= 4 || p.won) return [];
  const cnt = counts(kindsOf(p.hand));
  const r: number[] = [];
  for (let k = 0; k < 34; k++) {
    if (s.cfg.sichuan && suitOf(k) === p.missing) continue;
    if (cnt[k] === 4) {
      // в риичи — только если взятая кость и ожидания не меняются
      if (p.riichi) {
        if (kindOf(s.drawn) !== k) continue;
        const before = cnt.slice();
        before[k]--;
        const after = cnt.slice();
        after[k] = 0;
        const w1 = waits(before, openSets(p), rulesOf(s.cfg)).join();
        const w2 = waits(after, openSets(p) + 1, rulesOf(s.cfg)).join();
        if (!w1 || w1 !== w2) continue;
      }
      r.push(k);
    } else if (cnt[k] >= 1 && !p.riichi && p.melds.some((m) => m.t === 'pon' && m.k === k)) r.push(k);
  }
  return r;
}

/** Какие кости можно сбросить с объявлением риичи. */
export function riichiDiscards(s: State, seat: number): number[] {
  const p = s.p[seat];
  const c = s.cfg;
  if (c.style !== 'riichi' || p.riichi || s.turn !== seat || s.phase !== 'turn') return [];
  if (p.melds.some((m) => m.open) || s.scores[seat] < 1000 || s.live.length < 4) return [];
  const r: number[] = [];
  const seen = new Set<number>();
  for (const id of p.hand) {
    const k = kindOf(id);
    if (seen.has(k)) continue;
    seen.add(k);
    const rest = p.hand.filter((x) => x !== id);
    if (waits(counts(kindsOf(rest)), openSets(p), rulesOf(c)).length) r.push(id);
  }
  // красную пятёрку — тоже, если подходит её вид
  return p.hand.filter((id) => r.some((x) => kindOf(x) === kindOf(id)));
}

/** Можно ли сбросить кость. */
export function canDiscard(s: State, seat: number, id: number): boolean {
  const p = s.p[seat];
  if (s.phase !== 'turn' || s.turn !== seat || !p.hand.includes(id)) return false;
  if (p.riichi && id !== s.drawn) return false;
  if (p.forbid >= 0 && kindOf(id) === p.forbid && p.hand.some((x) => kindOf(x) !== p.forbid)) return false;
  if (s.cfg.sichuan && p.missing >= 0) {
    const holdsMissing = p.hand.some((x) => suitOf(kindOf(x)) === p.missing);
    if (holdsMissing && suitOf(kindOf(id)) !== p.missing) return false;
  }
  return true;
}

function discard(s: State, seat: number, id: number, riichi: boolean, ev: Event[], auto = false) {
  const p = s.p[seat];
  p.hand.splice(p.hand.indexOf(id), 1);
  const first = s.calls === 0 && p.discards.length === 0;
  p.discards.push({ id, riichi: riichi || undefined });
  p.forbid = -1;
  p.tempFuriten = false;
  if (p.ippatsu && !riichi) p.ippatsu = false;
  if (riichi) {
    p.riichi = first ? 2 : 1;
    p.ippatsu = true;
  }
  s.drawn = -1;
  s.rinshan = false;
  s.last = { seat, id };
  ev.push({ type: 'discard', seat, id, riichi, auto });
  openClaims(s, seat, id, ev);
}

/** После сброса: кто может заявить. Никто — ход следующему. */
function openClaims(s: State, from: number, id: number, ev: Event[]) {
  const k = kindOf(id);
  const c = s.cfg;
  const pend: Record<number, Opts> = {};
  const lastDiscard = s.live.length === 0;
  for (let i = 1; i < 4; i++) {
    const seat = (from + i) % 4;
    const p = s.p[seat];
    if (p.won) continue;
    const o: Opts = {};
    if (!(c.style === 'riichi' && (p.furiten || p.tempFuriten || ownFuriten(s, seat))) && canWinWith(s, seat, id, false, { lastTile: lastDiscard })) o.ron = true;
    if (!p.riichi && !lastDiscard && !(c.sichuan && suitOf(k) === p.missing)) {
      const n = p.hand.filter((x) => kindOf(x) === k).length;
      if (n >= 2) o.pon = true;
      if (n >= 3 && s.kans < 4) o.mkan = true;
      if (c.chow && i === 1 && isSuit(k)) {
        const has = (kk: number) => p.hand.some((x) => kindOf(x) === kk);
        const ch: number[] = [];
        const r = k % 9;
        if (r >= 2 && has(k - 2) && has(k - 1)) ch.push(k - 2);
        if (r >= 1 && r <= 7 && has(k - 1) && has(k + 1)) ch.push(k - 1);
        if (r <= 6 && has(k + 1) && has(k + 2)) ch.push(k);
        if (ch.length) o.chi = ch;
      }
    }
    if (o.ron || o.pon || o.mkan || o.chi) pend[seat] = o;
  }
  if (Object.keys(pend).length) {
    s.phase = 'claim';
    s.pending = pend;
    s.answers = {};
    return;
  }
  afterDiscard(s, ev);
}

/** Фуритэн риичи: среди своих сбросов есть ожидание. */
function ownFuriten(s: State, seat: number): boolean {
  const p = s.p[seat];
  const w = waits(counts(kindsOf(p.hand)), openSets(p), rulesOf(s.cfg));
  return p.discards.some((d) => w.includes(kindOf(d.id)));
}

/** Сброс прошёл без заявок: риичи оплачен, ход следующему. */
function afterDiscard(s: State, ev: Event[]) {
  const from = s.last!.seat;
  const p = s.p[from];
  const d = p.discards[p.discards.length - 1];
  if (d?.riichi && p.riichi && !p.paid) {
    p.paid = true;
    s.scores[from] -= 1000;
    s.sticks++;
  }
  s.phase = 'turn';
  s.pending = {};
  s.answers = {};
  const next = nextActive(s, from);
  if (next < 0) {
    endHand(s, ev);
    return;
  }
  startTurn(s, next, ev, false);
}

/** Следующий по ходу, кто ещё играет (в Сычуани выигравшие выходят). */
function nextActive(s: State, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const x = (from + i) % 4;
    if (!s.p[x].won) return x;
  }
  return -1;
}

const active = (s: State) => [0, 1, 2, 3].filter((x) => !s.p[x].won);

// ---------------------------------------------------------------- заявки

function resolveClaims(s: State, ev: Event[], rng: Rng) {
  void rng;
  const last = s.last!;
  const order = [1, 2, 3].map((i) => (last.seat + i) % 4);
  const ans = (x: number) => s.answers[x];
  // пропустивший выигрыш — фуритэн
  for (const x of order)
    if (s.pending[x]?.ron && ans(x)?.t !== 'ron') {
      if (s.p[x].riichi) s.p[x].furiten = true;
      else s.p[x].tempFuriten = true;
    }
  const rons = order.filter((x) => ans(x)?.t === 'ron');
  if (rons.length) {
    const winners = s.cfg.multiRon ? rons : [rons[0]];
    if (s.rob) {
      const rob = s.rob;
      s.rob = null;
      // конг ограблен: кость уходит из пона к выигравшему
      const p = s.p[rob.seat];
      p.hand.splice(p.hand.indexOf(rob.id), 1);
      settleRon(s, winners, rob.seat, rob.id, ev, { chankan: true });
    } else {
      s.p[last.seat].discards[s.p[last.seat].discards.length - 1].taken = true;
      settleRon(s, winners, last.seat, last.id, ev, {});
    }
    return;
  }
  if (s.rob) {
    // никто не грабит — конг состоялся
    const rob = s.rob;
    s.rob = null;
    s.phase = 'turn';
    s.pending = {};
    finishAddedKan(s, rob.seat, rob.k, ev);
    return;
  }
  const kp = order.find((x) => ans(x)?.t === 'pon' || ans(x)?.t === 'mkan');
  const chi = order.find((x) => ans(x)?.t === 'chi');
  const who = kp ?? chi;
  s.pending = {};
  if (who == null) {
    s.answers = {};
    afterDiscard(s, ev);
    return;
  }
  const a = ans(who)!;
  s.answers = {};
  callTile(s, who, a, ev);
}

function callTile(s: State, seat: number, a: Action, ev: Event[]) {
  const last = s.last!;
  const from = s.p[last.seat];
  const disc = from.discards[from.discards.length - 1];
  disc.taken = true;
  // риичи сбросившего всё равно оплачивается
  if (disc.riichi && from.riichi && !from.paid) {
    from.paid = true;
    s.scores[last.seat] -= 1000;
    s.sticks++;
  }
  const p = s.p[seat];
  const k = kindOf(last.id);
  const take = (kk: number, n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      // красную пятёрку оставляем в руке напоследок
      const cands = p.hand.filter((x) => kindOf(x) === kk);
      const pick = cands.find((x) => !isRed(s.cfg, x)) ?? cands[0];
      p.hand.splice(p.hand.indexOf(pick), 1);
      out.push(pick);
    }
    return out;
  };
  let meld: Meld;
  if (a.t === 'chi') {
    const ids: number[] = [];
    for (let kk = a.k; kk < a.k + 3; kk++) ids.push(kk === k ? last.id : take(kk, 1)[0]);
    meld = { t: 'chi', k: a.k, open: true, ids, from: last.seat, called: last.id };
  } else if (a.t === 'pon') meld = { t: 'pon', k, open: true, ids: [...take(k, 2), last.id], from: last.seat, called: last.id };
  else meld = { t: 'kan', k, open: true, ids: [...take(k, 3), last.id], from: last.seat, called: last.id };
  p.melds.push(meld);
  s.calls++;
  for (const q of s.p) q.ippatsu = false;
  ev.push({ type: 'call', seat, meld, from: last.seat, t: meld.t });
  s.pending = {};
  if (meld.t === 'kan') {
    s.kans++;
    if (s.cfg.sichuan) pay(s, [[last.seat, seat, 2]], 'открытый конг', ev);
    newDora(s, ev);
    startTurn(s, seat, ev, true);
    return;
  }
  // нельзя сбросить ту же кость сразу (кое-где — правило «куикаэ»)
  p.forbid = s.cfg.style === 'riichi' ? k : -1;
  s.turn = seat;
  s.drawn = -1;
  s.phase = 'turn';
}

function newDora(s: State, ev: Event[]) {
  if (s.cfg.style !== 'riichi' || s.dora.length >= 5) return;
  const ind = s.dead[s.dora.length];
  s.dora.push(ind);
  s.ura.push(s.dead[5 + s.ura.length]);
  ev.push({ type: 'dora', id: ind });
}

function ownKan(s: State, seat: number, k: number, ev: Event[]) {
  const p = s.p[seat];
  const cnt = p.hand.filter((x) => kindOf(x) === k).length;
  if (cnt === 4) {
    const ids = p.hand.filter((x) => kindOf(x) === k);
    p.hand = p.hand.filter((x) => kindOf(x) !== k);
    const meld: Meld = { t: 'kan', k, open: false, ids };
    p.melds.push(meld);
    s.kans++;
    for (const q of s.p) q.ippatsu = false;
    ev.push({ type: 'kan', seat, meld, added: false });
    if (s.cfg.sichuan) pay(s, active(s).filter((x) => x !== seat).map((x) => [x, seat, 2] as [number, number, number]), 'закрытый конг', ev);
    newDora(s, ev);
    startTurn(s, seat, ev, true);
    return;
  }
  // добавленный конг: другие могут ограбить
  const id = p.hand.find((x) => kindOf(x) === k)!;
  const pend: Record<number, Opts> = {};
  for (let i = 1; i < 4; i++) {
    const x = (seat + i) % 4;
    const q = s.p[x];
    if (q.won) continue;
    if (s.cfg.style === 'riichi' && (q.furiten || q.tempFuriten || ownFuriten(s, x))) continue;
    if (canWinWith(s, x, id, false, { chankan: true })) pend[x] = { ron: true };
  }
  if (Object.keys(pend).length) {
    s.rob = { seat, id, k };
    s.last = { seat, id };
    s.phase = 'claim';
    s.pending = pend;
    s.answers = {};
    return;
  }
  finishAddedKan(s, seat, k, ev);
}

function finishAddedKan(s: State, seat: number, k: number, ev: Event[]) {
  const p = s.p[seat];
  const id = p.hand.find((x) => kindOf(x) === k)!;
  p.hand.splice(p.hand.indexOf(id), 1);
  const m = p.melds.find((x) => x.t === 'pon' && x.k === k)!;
  m.t = 'kan';
  m.ids = [...m.ids, id];
  m.added = true;
  s.kans++;
  for (const q of s.p) q.ippatsu = false;
  ev.push({ type: 'kan', seat, meld: m, added: true });
  if (s.cfg.sichuan) pay(s, active(s).filter((x) => x !== seat).map((x) => [x, seat, 1] as [number, number, number]), 'добавленный конг', ev);
  newDora(s, ev);
  startTurn(s, seat, ev, true);
}

// ---------------------------------------------------------------- расчёты

/** Платежи: [кто, кому, сколько]. */
function pay(s: State, list: [number, number, number][], why: string, ev: Event[]) {
  const d = [0, 0, 0, 0];
  for (const [a, b, n] of list) {
    d[a] -= n;
    d[b] += n;
  }
  for (let i = 0; i < 4; i++) {
    s.scores[i] += d[i];
    s.deltas[i] += d[i];
  }
  if (d.some((x) => x)) ev.push({ type: 'pay', deltas: d, why });
}

const HK_TABLE = [2, 4, 8, 16, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768];
const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

/** Сколько платит каждый проигравший: [кто, сколько]. from — сбросивший (−1 — взял сам). */
function payments(s: State, seat: number, from: number, value: number, fu: number, yakuman: number, bonus: boolean): [number, number][] {
  const c = s.cfg;
  const others = active(s).filter((x) => x !== seat);
  const dealerWin = seat === s.dealer;
  const r: [number, number][] = [];
  switch (c.style) {
    case 'riichi': {
      const b = riichiBase(value, fu, yakuman);
      const hb = bonus ? s.honba : 0;
      if (from >= 0) r.push([from, ceil100(b * (dealerWin ? 6 : 4)) + 300 * hb]);
      else for (const x of others) r.push([x, ceil100(b * (dealerWin || x === s.dealer ? 2 : 1)) + 100 * hb]);
      break;
    }
    case 'hk': {
      const full = HK_TABLE[Math.min(value, HK_TABLE.length - 1)];
      for (const x of others) r.push([x, from < 0 || x === from ? full : full / 2]);
      break;
    }
    case 'classic':
      for (const x of others) r.push([x, value * (dealerWin || x === s.dealer ? 2 : 1)]);
      break;
    case 'tw': {
      const amount = 100 + 20 * value;
      const dealerTai = 20 * (1 + 2 * s.honba);
      if (from >= 0) r.push([from, amount + (!dealerWin && from === s.dealer ? dealerTai : 0)]);
      else for (const x of others) r.push([x, amount + (!dealerWin && x === s.dealer ? dealerTai : 0)]);
      break;
    }
    case 'sc': {
      const amount = 2 ** value;
      if (from >= 0) r.push([from, amount]);
      else for (const x of others) r.push([x, amount]);
      break;
    }
  }
  return r;
}

function record(s: State, seat: number, from: number, winId: number, extra: Partial<WinInfo>): WinRec {
  const tsumo = from < 0;
  const sc = canWinWith(s, seat, winId, tsumo, extra)!;
  const p = s.p[seat];
  const hand = tsumo ? p.hand.slice() : [...p.hand, winId];
  const c = s.cfg;
  const label =
    c.style === 'riichi'
      ? riichiLabel(sc.value, sc.fu ?? 30, sc.yakuman)
      : c.style === 'hk'
        ? `${sc.value} фань`
        : c.style === 'tw'
          ? `${sc.value} тай`
          : c.style === 'sc'
            ? `${sc.value} фань`
            : `${sc.value} очков`;
  return { seat, from, win: winId, hand, melds: p.melds, flowers: p.flowers, items: sc.items, value: sc.value, fu: sc.fu, label, gain: 0 };
}

function settleRon(s: State, winners: number[], from: number, winId: number, ev: Event[], extra: Partial<WinInfo>) {
  const lastTile = s.live.length === 0 && !extra.chankan;
  winners.forEach((seat, i) => {
    const rec = record(s, seat, from, winId, { ...extra, lastTile });
    const sc = canWinWith(s, seat, winId, false, { ...extra, lastTile })!;
    const list = payments(s, seat, from, sc.value, sc.fu ?? 30, sc.yakuman, i === 0);
    const before = s.scores[seat];
    pay(s, list.map(([x, n]) => [x, seat, n] as [number, number, number]), 'выигрыш', ev);
    if (i === 0 && s.cfg.style === 'riichi' && s.sticks) {
      s.scores[seat] += s.sticks * 1000;
      s.deltas[seat] += s.sticks * 1000;
      s.sticks = 0;
    }
    rec.gain = s.scores[seat] - before;
    s.wins.push(rec);
    if (s.firstWinner < 0) s.firstWinner = seat;
    ev.push({ type: 'win', rec });
    s.p[seat].won = true;
  });
  s.pending = {};
  s.answers = {};
  if (s.cfg.sichuan && active(s).length > 1) {
    // кровавая битва: остальные доигрывают; ход — после последнего выигравшего
    const lastW = winners[winners.length - 1];
    const next = nextActive(s, lastW);
    s.phase = 'turn';
    startTurn(s, next, ev, false);
    return;
  }
  endHand(s, ev);
}

function settleTsumo(s: State, seat: number, ev: Event[]) {
  const winId = s.drawn;
  const rec = record(s, seat, -1, winId, {});
  const sc = canWinWith(s, seat, winId, true)!;
  const list = payments(s, seat, -1, sc.value, sc.fu ?? 30, sc.yakuman, true);
  const before = s.scores[seat];
  pay(s, list.map(([x, n]) => [x, seat, n] as [number, number, number]), 'выигрыш', ev);
  if (s.cfg.style === 'riichi' && s.sticks) {
    s.scores[seat] += s.sticks * 1000;
    s.deltas[seat] += s.sticks * 1000;
    s.sticks = 0;
  }
  rec.gain = s.scores[seat] - before;
  s.wins.push(rec);
  if (s.firstWinner < 0) s.firstWinner = seat;
  ev.push({ type: 'win', rec });
  s.p[seat].won = true;
  if (s.cfg.sichuan && active(s).length > 1) {
    startTurn(s, nextActive(s, seat), ev, false);
    return;
  }
  endHand(s, ev);
}

/** Стена кончилась. */
function exhaustive(s: State, ev: Event[]) {
  const c = s.cfg;
  const tenpai = [0, 1, 2, 3].map((x) => !s.p[x].won && shanten(counts(kindsOf(s.p[x].hand)), openSets(s.p[x]), rulesOf(c)) <= 0 && waits(counts(kindsOf(s.p[x].hand)), openSets(s.p[x]), rulesOf(c)).length > 0);
  if (c.style === 'riichi') {
    const t = tenpai.filter(Boolean).length;
    if (t > 0 && t < 4) {
      const list: [number, number, number][] = [];
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (!tenpai[a] && tenpai[b]) list.push([a, b, 3000 / (4 - t) / t]);
      pay(s, list, 'темпай при ничьей', ev);
    }
  }
  endHand(s, ev, tenpai);
}

function endHand(s: State, ev: Event[], tenpai?: boolean[]) {
  const drawn = s.wins.length === 0;
  const res: HandResult = {
    kind: drawn ? 'draw' : 'win',
    wins: s.wins,
    deltas: s.deltas.slice(),
    text: drawn ? 'Ничья: стена кончилась' : s.wins.map((w) => `выиграл ${w.seat}`).join(', '),
  };
  if (tenpai) {
    res.tenpai = tenpai;
    res.shown = tenpai.map((t, x) => (t ? s.p[x].hand.slice() : null));
  }
  if (s.cfg.style === 'riichi' && s.wins.some((w) => s.p[w.seat].riichi)) res.ura = s.ura.slice();
  s.result = res;
  s.phase = 'end';
  s.acks = [false, false, false, false];
  s.pending = {};
  ev.push({ type: 'end', result: res });
}

/** Все посмотрели итог — следующая раздача или конец партии. */
function nextHand(s: State, rng: Rng, ev: Event[]) {
  const c = s.cfg;
  const res = s.result!;
  const dealerWon = res.wins.some((w) => w.seat === s.dealer);
  let keep: boolean;
  if (c.sichuan) keep = false;
  else if (res.kind === 'draw') keep = c.style === 'riichi' ? !!res.tenpai?.[s.dealer] : true;
  else keep = dealerWon;
  s.hands++;
  if (c.sichuan) {
    // следующий дилер — первый выигравший (ничья — тот же)
    if (s.firstWinner >= 0) s.dealer = s.firstWinner;
    s.honba = 0;
    s.round = Math.floor(s.hands / 4);
  } else if (keep) s.honba++;
  else {
    s.honba = c.style === 'riichi' && res.kind === 'draw' ? s.honba + 1 : 0;
    s.dealer = (s.dealer + 1) % 4;
    if (s.dealer === 0) s.round++;
  }
  const bust = c.style === 'riichi' && s.scores.some((x) => x < 0);
  // страховка от бесконечных повторов дилера
  const cap = s.hands >= c.rounds * 4 * 4;
  if (s.round >= c.rounds || bust || cap) {
    s.phase = 'over';
    ev.push({ type: 'over', scores: s.scores.slice() });
    return;
  }
  deal(s, rng, ev);
}

// ---------------------------------------------------------------- очередь и действия

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'missing':
      return [0, 1, 2, 3].filter((x) => s.p[x].missing < 0);
    case 'turn':
      return [s.turn];
    case 'claim':
      return Object.keys(s.pending)
        .map(Number)
        .filter((x) => !s.answers[x]);
    case 'end':
      return [0, 1, 2, 3].filter((x) => !s.acks[x]);
    default:
      return [];
  }
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !toAct(s0).includes(seat)) return null;
  const s: State = structuredClone(s0);
  const ev: Event[] = [];
  const p = s.p[seat];
  switch (s.phase) {
    case 'missing': {
      if (a.t !== 'missing' || ![0, 1, 2].includes(a.suit)) return null;
      p.missing = a.suit;
      ev.push({ type: 'missing', seat, suit: a.suit });
      if (s.p.every((q) => q.missing >= 0)) startTurn(s, s.dealer, ev, false);
      break;
    }
    case 'turn': {
      if (a.t === 'discard') {
        if (!canDiscard(s, seat, a.id)) return null;
        if (a.riichi && !riichiDiscards(s, seat).includes(a.id)) return null;
        discard(s, seat, a.id, !!a.riichi, ev);
      } else if (a.t === 'tsumo') {
        if (!canTsumo(s, seat)) return null;
        settleTsumo(s, seat, ev);
      } else if (a.t === 'kan') {
        if (!turnKans(s, seat).includes(a.k)) return null;
        ownKan(s, seat, a.k, ev);
      } else return null;
      break;
    }
    case 'claim': {
      const o = s.pending[seat];
      if (!o) return null;
      const ok = a.t === 'pass' || (a.t === 'ron' && o.ron) || (a.t === 'pon' && o.pon) || (a.t === 'mkan' && o.mkan) || (a.t === 'chi' && o.chi?.includes(a.k));
      if (!ok) return null;
      s.answers[seat] = a;
      if (!toAct(s).length) resolveClaims(s, ev, rng);
      break;
    }
    case 'end': {
      if (a.t !== 'next') return null;
      s.acks[seat] = true;
      if (s.acks.every(Boolean)) nextHand(s, rng, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}
