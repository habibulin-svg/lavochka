/* «Вкладыши» — бой. Два игрока, у каждого «терпение» (здоровье героя), копейки (растут на 1 за ход, до 10), колода 20, рука до 7,
 * лавочка на 5 мест. Вкладыш на лавочке бьёт вкладыш соперника или его самого; вышедший в этот ход ждёт (кроме «Рывка»).
 * Состояние не мутируется: apply копирует. Без DOM. */
import type { Rng } from '../../core/types';
import { card, deckFrom, type Card, type Fx, type Kw } from './cards';

export const HERO_HP = 30;
export const MAX_MANA = 10;
export const HAND_MAX = 7;
export const BOARD_MAX = 5;
export const START_HAND = 3;
/** Сколько терпения сверху получает второй игрок. */
export const SECOND_BONUS = 2;
/** Ходов всего (на двоих): дальше — по терпению, чтобы партия не тянулась вечно. */
export const TURN_LIMIT = 80;

export interface Unit {
  uid: number;
  id: string;
  atk: number;
  hp: number;
  maxHp: number;
  kw: Kw[];
  /** вышел в этот ход — ещё не бьёт */
  sleep: boolean;
  /** уже бил в этот ход */
  done: boolean;
  /** «Броня» ещё цела */
  armor: boolean;
  /** пропускает свой следующий ход */
  stun: boolean;
}

export interface Player {
  seat: number;
  hero: number;
  mana: number;
  maxMana: number;
  deck: string[];
  hand: string[];
  board: Unit[];
  fatigue: number;
}

export interface State {
  players: Player[];
  /** индекс в players, чей ход */
  cur: number;
  turnNo: number;
  uid: number;
  heroHp: number;
  over: boolean;
  /** индекс победителя в players; -1 — ничья */
  winner: number | null;
}

/** Цель: сторона (индекс игрока) и вкладыш (uid) или сам игрок (uid нет). */
export interface Tgt {
  p: number;
  uid?: number;
}

export type Action = { t: 'play'; i: number; slot?: number; tgt?: Tgt } | { t: 'attack'; uid: number; tgt: Tgt } | { t: 'end' };

export type Event =
  | { t: 'turn'; p: number; turnNo: number }
  | { t: 'draw'; p: number; seat: number; id: string | null; burn?: boolean }
  | { t: 'fatigue'; p: number; n: number }
  | { t: 'play'; p: number; id: string; uid?: number; slot?: number; tgt?: Tgt }
  | { t: 'attack'; p: number; uid: number; tgt: Tgt }
  | { t: 'dmg'; tgt: Tgt; n: number; armor?: boolean }
  | { t: 'heal'; tgt: Tgt; n: number }
  | { t: 'buff'; tgt: Tgt; atk: number; hp: number }
  | { t: 'armor'; tgt: Tgt }
  | { t: 'stun'; tgt: Tgt }
  | { t: 'mana'; p: number; n: number }
  | { t: 'die'; p: number; uid: number; id: string }
  | { t: 'over'; winner: number | null };

export interface PlayerView {
  seat: number;
  hero: number;
  mana: number;
  maxMana: number;
  deck: number;
  /** своя рука — id; чужая — null на каждую карту */
  hand: (string | null)[];
  board: Unit[];
}

export interface View {
  players: PlayerView[];
  cur: number;
  turnNo: number;
  heroHp: number;
  over: boolean;
  winner: number | null;
  /** индексы игроков, чьи руки видит этот экран */
  me: number[];
}

// ---------------------------------------------------------------- начало
export function newState(seats: number[], decks: string[], rng: Rng, heroHp = HERO_HP): State {
  const players: Player[] = seats.map((seat, i) => {
    const deck = shuffle(deckFrom(decks[i] ?? 'garage'), rng);
    return { seat, hero: heroHp, mana: 0, maxMana: 0, deck, hand: [], board: [], fatigue: 0 };
  });
  const s: State = { players, cur: 0, turnNo: 0, uid: 1, heroHp, over: false, winner: null };
  // первый — START_HAND, второй — на одну больше (компенсация хода)
  for (let k = 0; k < START_HAND; k++) for (const p of players) p.hand.push(p.deck.shift()!);
  players[1]?.hand.push(players[1].deck.shift()!);
  // второму — ещё и терпения побольше: первый ход в жанре — большое преимущество (по прогонам ботов ~70 % побед)
  if (players[1]) players[1].hero += SECOND_BONUS;
  startTurn(s, [], true);
  return s;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clone = (s: State): State => ({
  ...s,
  players: s.players.map((p) => ({ ...p, deck: p.deck.slice(), hand: p.hand.slice(), board: p.board.map((u) => ({ ...u, kw: u.kw.slice() })) })),
});

// ---------------------------------------------------------------- ход
function draw(s: State, pi: number, ev: Event[]) {
  const p = s.players[pi];
  const id = p.deck.shift();
  if (!id) {
    p.fatigue += 1;
    p.hero -= p.fatigue;
    ev.push({ t: 'fatigue', p: pi, n: p.fatigue });
    return;
  }
  if (p.hand.length >= HAND_MAX) {
    ev.push({ t: 'draw', p: pi, seat: p.seat, id, burn: true });
    return;
  }
  p.hand.push(id);
  ev.push({ t: 'draw', p: pi, seat: p.seat, id });
}

function startTurn(s: State, ev: Event[], first = false) {
  s.turnNo += 1;
  const p = s.players[s.cur];
  p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
  p.mana = p.maxMana;
  for (const u of p.board) {
    u.sleep = false;
    u.done = false;
    if (u.stun) {
      u.done = true; // загляделся — этот ход пропускает
      u.stun = false;
    }
  }
  ev.push({ t: 'turn', p: s.cur, turnNo: s.turnNo });
  if (!first) draw(s, s.cur, ev); // первый игрок в самый первый ход не берёт
  checkOver(s, ev);
}

function checkOver(s: State, ev: Event[]) {
  if (s.over) return;
  const dead = s.players.map((p) => p.hero <= 0);
  let winner: number | undefined;
  if (dead[0] && dead[1]) winner = -1;
  else if (dead[0]) winner = 1;
  else if (dead[1]) winner = 0;
  else if (s.turnNo > TURN_LIMIT) {
    const [a, b] = s.players.map((p) => p.hero);
    winner = a === b ? -1 : a > b ? 0 : 1;
  }
  if (winner === undefined) return;
  s.over = true;
  s.winner = winner;
  ev.push({ t: 'over', winner: winner < 0 ? null : winner });
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.players[s.cur].seat]);

/** Атака вкладыша с учётом «Пары»: +1 за соседа той же сборной (у Final) или той же коллекции. */
export function atkOf(board: Unit[], u: Unit): number {
  if (!u.kw.includes('pair')) return u.atk;
  const i = board.findIndex((x) => x.uid === u.uid);
  const me = card(u.id);
  const same = (x?: Unit) => !!x && (me.team ? card(x.id).team === me.team : card(x.id).coll === me.coll);
  return u.atk + (same(board[i - 1]) ? 1 : 0) + (same(board[i + 1]) ? 1 : 0);
}

const findUnit = (s: State, t: Tgt) => (t.uid === undefined ? undefined : s.players[t.p]?.board.find((u) => u.uid === t.uid));

/** Можно ли бить эту цель (стенка прикрывает героя и остальных). */
export function canHit(s: State, attacker: number, t: Tgt): boolean {
  if (t.p === attacker) return false;
  const foe = s.players[t.p];
  if (!foe) return false;
  if (t.uid !== undefined && !foe.board.some((u) => u.uid === t.uid)) return false;
  const walls = foe.board.filter((u) => u.kw.includes('wall'));
  if (!walls.length) return true;
  return t.uid !== undefined && walls.some((u) => u.uid === t.uid);
}

function damage(s: State, t: Tgt, n: number, ev: Event[]) {
  if (n <= 0) return;
  if (t.uid === undefined) {
    s.players[t.p].hero -= n;
    ev.push({ t: 'dmg', tgt: t, n });
    return;
  }
  const u = findUnit(s, t);
  if (!u) return;
  if (u.armor) {
    u.armor = false;
    ev.push({ t: 'dmg', tgt: t, n: 0, armor: true });
    return;
  }
  u.hp -= n;
  ev.push({ t: 'dmg', tgt: t, n });
}

/** Убрать погибших (с «Прощанием»), повторять, пока цепочка не кончится. */
function reap(s: State, ev: Event[]) {
  for (let guard = 0; guard < 10; guard++) {
    const dead: [number, Unit][] = [];
    s.players.forEach((p, pi) => p.board.forEach((u) => u.hp <= 0 && dead.push([pi, u])));
    if (!dead.length) return;
    for (const [pi, u] of dead) {
      s.players[pi].board = s.players[pi].board.filter((x) => x.uid !== u.uid);
      ev.push({ t: 'die', p: pi, uid: u.uid, id: u.id });
    }
    for (const [pi, u] of dead) {
      const fx = card(u.id).death;
      if (fx) runFx(s, pi, fx, undefined, ev, u.uid);
    }
  }
}

/** Нужна ли эффекту цель, выбранная игроком, и годится ли она. */
export function fxTargets(s: State, pi: number, fx: Fx | undefined): Tgt[] | null {
  if (!fx || fx.to === 'none') return null;
  const out: Tgt[] = [];
  s.players.forEach((p, i) => {
    const mine = i === pi;
    if (fx.to === 'enemy' && !mine) out.push({ p: i });
    for (const u of p.board) {
      if (fx.to === 'anyUnit' || (fx.to === 'allyUnit' && mine) || ((fx.to === 'enemyUnit' || fx.to === 'enemy') && !mine)) out.push({ p: i, uid: u.uid });
    }
  });
  return out;
}

const sameTgt = (a: Tgt, b: Tgt) => a.p === b.p && a.uid === b.uid;

function runFx(s: State, pi: number, fx: Fx, tgt: Tgt | undefined, ev: Event[], selfUid?: number) {
  const p = s.players[pi];
  const foe = 1 - pi;
  switch (fx.k) {
    case 'dmg':
      if (tgt) damage(s, tgt, fx.n, ev);
      break;
    case 'aoe':
      for (const u of s.players[foe].board.slice()) damage(s, { p: foe, uid: u.uid }, fx.n, ev);
      break;
    case 'heal':
      if (fx.to === 'none' || !tgt) {
        const n = Math.min(fx.n, s.heroHp - p.hero);
        if (n > 0) {
          p.hero += n;
          ev.push({ t: 'heal', tgt: { p: pi }, n });
        }
      } else {
        const u = findUnit(s, tgt);
        if (u) {
          const n = Math.min(fx.n, u.maxHp - u.hp);
          u.hp += n;
          ev.push({ t: 'heal', tgt, n });
        }
      }
      break;
    case 'buff': {
      const u = tgt && findUnit(s, tgt);
      if (u) {
        u.atk += fx.n;
        u.hp += fx.m ?? 0;
        u.maxHp += fx.m ?? 0;
        ev.push({ t: 'buff', tgt: tgt!, atk: fx.n, hp: fx.m ?? 0 });
      }
      break;
    }
    case 'team': {
      const team = selfUid !== undefined ? card(p.board.find((u) => u.uid === selfUid)?.id ?? '')?.team : undefined;
      for (const u of p.board) {
        if (u.uid === selfUid || !team || card(u.id).team !== team) continue;
        u.atk += fx.n;
        u.hp += fx.m ?? 0;
        u.maxHp += fx.m ?? 0;
        ev.push({ t: 'buff', tgt: { p: pi, uid: u.uid }, atk: fx.n, hp: fx.m ?? 0 });
      }
      break;
    }
    case 'draw':
      for (let k = 0; k < fx.n; k++) draw(s, pi, ev);
      break;
    case 'armor': {
      const u = tgt && findUnit(s, tgt);
      if (u) {
        u.armor = true;
        if (!u.kw.includes('armor')) u.kw.push('armor');
        ev.push({ t: 'armor', tgt: tgt! });
      }
      break;
    }
    case 'stun': {
      const u = tgt && findUnit(s, tgt);
      if (u) {
        u.stun = true;
        ev.push({ t: 'stun', tgt: tgt! });
      }
      break;
    }
    case 'all':
      for (const u of p.board) {
        u.atk += fx.n;
        u.hp += fx.m ?? 0;
        u.maxHp += fx.m ?? 0;
        ev.push({ t: 'buff', tgt: { p: pi, uid: u.uid }, atk: fx.n, hp: fx.m ?? 0 });
      }
      break;
    case 'mana':
      p.mana = Math.min(MAX_MANA, p.mana + fx.n);
      ev.push({ t: 'mana', p: pi, n: fx.n });
      break;
  }
}

export function canPlay(s: State, pi: number, c: Card): boolean {
  const p = s.players[pi];
  if (c.cost > p.mana) return false;
  if (!c.spell && p.board.length >= BOARD_MAX) return false;
  if (c.spell) {
    const t = fxTargets(s, pi, c.play);
    if (t && !t.length) return false;
    if (c.play?.k === 'all' && !p.board.length) return false; // усиливать некого
  }
  return true;
}

export function apply(s0: State, seat: number, a: Action, _rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over) return null;
  const pi = s0.cur;
  if (s0.players[pi].seat !== seat) return null;
  const s = clone(s0);
  const p = s.players[pi];
  const ev: Event[] = [];
  if (a.t === 'end') {
    for (const u of p.board) u.done = false;
    s.cur = 1 - s.cur;
    startTurn(s, ev);
    return { state: s, events: ev };
  }
  if (a.t === 'play') {
    const id = p.hand[a.i];
    if (!id) return null;
    const c = card(id);
    if (!canPlay(s, pi, c)) return null;
    const targets = fxTargets(s, pi, c.play);
    let tgt: Tgt | undefined;
    if (targets) {
      if (a.tgt && targets.some((t) => sameTgt(t, a.tgt!))) tgt = a.tgt;
      else if (c.spell) return null; // приёму цель обязательна
    }
    p.hand.splice(a.i, 1);
    p.mana -= c.cost;
    if (c.spell) {
      ev.push({ t: 'play', p: pi, id, tgt });
      runFx(s, pi, c.play!, tgt, ev);
    } else {
      const slot = Math.max(0, Math.min(p.board.length, a.slot ?? p.board.length));
      const u: Unit = { uid: s.uid++, id, atk: c.atk, hp: c.hp, maxHp: c.hp, kw: c.kw.slice(), sleep: !c.kw.includes('rush'), done: false, armor: c.kw.includes('armor'), stun: false };
      p.board.splice(slot, 0, u);
      ev.push({ t: 'play', p: pi, id, uid: u.uid, slot, tgt });
      if (c.play) runFx(s, pi, c.play, tgt, ev, u.uid);
    }
    reap(s, ev);
    checkOver(s, ev);
    return { state: s, events: ev };
  }
  if (a.t === 'attack') {
    const u = p.board.find((x) => x.uid === a.uid);
    if (!u || u.sleep || u.done || !canHit(s, pi, a.tgt)) return null;
    const atk = atkOf(p.board, u);
    if (atk <= 0) return null;
    u.done = true;
    ev.push({ t: 'attack', p: pi, uid: u.uid, tgt: a.tgt });
    const target = findUnit(s, a.tgt);
    damage(s, a.tgt, atk, ev);
    if (target) damage(s, { p: pi, uid: u.uid }, atkOf(s.players[a.tgt.p].board, target), ev); // ответный удар
    reap(s, ev);
    checkOver(s, ev);
    return { state: s, events: ev };
  }
  return null;
}

/** Все допустимые действия (для бота и тестов). */
export function legal(s: State): Action[] {
  if (s.over) return [];
  const pi = s.cur;
  const p = s.players[pi];
  const out: Action[] = [{ t: 'end' }];
  p.hand.forEach((id, i) => {
    const c = card(id);
    if (!canPlay(s, pi, c)) return;
    const t = fxTargets(s, pi, c.play);
    if (t && t.length) for (const tgt of t) out.push({ t: 'play', i, tgt });
    else out.push({ t: 'play', i });
  });
  for (const u of p.board) {
    if (u.sleep || u.done || atkOf(p.board, u) <= 0) continue;
    const foe = 1 - pi;
    const cands: Tgt[] = [{ p: foe }, ...s.players[foe].board.map((x) => ({ p: foe, uid: x.uid }))];
    for (const tgt of cands) if (canHit(s, pi, tgt)) out.push({ t: 'attack', uid: u.uid, tgt });
  }
  return out;
}

export function view(s: State, seats: number[] | 'all'): View {
  const me = s.players.map((p, i) => (seats === 'all' || seats.includes(p.seat) ? i : -1)).filter((i) => i >= 0);
  return {
    players: s.players.map((p, i) => ({
      seat: p.seat,
      hero: p.hero,
      mana: p.mana,
      maxMana: p.maxMana,
      deck: p.deck.length,
      hand: me.includes(i) ? p.hand.slice() : p.hand.map(() => null),
      board: p.board.map((u) => ({ ...u, kw: u.kw.slice() })),
    })),
    cur: s.cur,
    turnNo: s.turnNo,
    heroHp: s.heroHp,
    over: s.over,
    winner: s.winner,
    me,
  };
}

export function redact(e: Event, seats: number[] | 'all'): Event | null {
  if (e.t !== 'draw' || seats === 'all' || seats.includes(e.seat)) return e;
  return e.burn ? e : { ...e, id: null }; // сгоревший из-за полной руки виден всем, как в жизни
}

/** Восстановить «состояние» из view — для бота: чужая рука и колоды неизвестны, но для оценки хватит. */
export function stateFromView(v: View): State {
  return {
    players: v.players.map((p) => ({
      seat: p.seat,
      hero: p.hero,
      mana: p.mana,
      maxMana: p.maxMana,
      deck: Array(p.deck).fill(''),
      hand: p.hand.map((h) => h ?? ''),
      board: p.board.map((u) => ({ ...u, kw: u.kw.slice() })),
      fatigue: 0,
    })),
    cur: v.cur,
    turnNo: v.turnNo,
    uid: 1 + Math.max(0, ...v.players.flatMap((p) => p.board.map((u) => u.uid))),
    heroHp: v.heroHp,
    over: v.over,
    winner: v.winner,
  };
}
