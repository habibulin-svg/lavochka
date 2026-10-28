/* Партизаны — движок. 5–10 игроков: партизаны против предателей, которые знают друг друга. Пять операций: командир по кругу
 * набирает группу, все разом голосуют «за»/«против»; пять отказов подряд на одной операции — победа предателей.
 * Группа втайне кладёт карты «успех»/«срыв» (партизан — только успех); один срыв (на 4-й операции при 7+ игроках — два) — операция провалена.
 * Три удачные операции — победа партизан, три проваленные — предателей. По желанию: разведчик (партизан, знает предателей) и
 * снайпер (предатель: после трёх удач может застрелить разведчика и победить); проверка — после 2-й, 3-й и 4-й операции
 * хозяин жетона втайне узнаёт сторону игрока и объявляет её (можно соврать), жетон уходит к проверенному. Без DOM. */
import type { Options, Rng } from '../../core/types';

export type Role = 'partisan' | 'scout' | 'traitor' | 'sniper';
export type Side = 'P' | 'T';
export type Phase = 'night' | 'propose' | 'vote' | 'mission' | 'check' | 'claim' | 'hunt' | 'over';

export const sideOf = (r: Role): Side => (r === 'partisan' || r === 'scout' ? 'P' : 'T');

/** Сколько предателей при n игроках. */
export const traitorsFor = (n: number) => (n <= 6 ? 2 : n <= 9 ? 3 : 4);

/** Размер группы на операции k (0…4) при n игроках. */
export function teamSize(n: number, k: number): number {
  const t: Record<number, number[]> = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };
  return (t[Math.max(5, Math.min(10, n))] ?? t[5])[k];
}

/** Сколько срывов проваливает операцию k: на 4-й при 7+ игроках — два. */
export const failsNeeded = (n: number, k: number) => (k === 3 && n >= 7 ? 2 : 1);

/** После каких операций (номер 0…4) работает проверка. */
export const CHECK_AFTER = [1, 2, 3];

/** Попытка собрать группу: командир, состав, голоса. */
export interface Try {
  leader: number;
  team: number[];
  votes?: Record<number, boolean>;
  passed?: boolean;
}

/** Операция: попытки, итог (сколько срывов). */
export interface Op {
  size: number;
  need: number;
  tries: Try[];
  fails?: number;
  ok?: boolean;
}

export interface State {
  seats: number[];
  humans: number[];
  roles: Record<number, Role>;
  scout: boolean;
  check: boolean;
  phase: Phase;
  /** Номер операции (0…4). */
  op: number;
  ops: Op[];
  leader: number;
  /** Отказов подряд на этой операции. */
  rejects: number;
  team: number[];
  votes: Record<number, boolean>;
  /** Карты группы: true — срыв. */
  cards: Record<number, boolean>;
  ready: number[];
  /** Жетон проверки: у кого, кто уже держал. */
  holder: number | null;
  held: number[];
  /** Проверки: кто → кого → сторона (видит только проверявший). */
  checks: { by: number; target: number; side: Side; claim?: Side | null }[];
  /** Выстрел снайпера. */
  shot: number | null;
  winner: Side | null;
  reason: string;
}

export type Action =
  | { type: 'ready' }
  | { type: 'team'; members: number[] }
  | { type: 'vote'; yes: boolean }
  | { type: 'card'; fail: boolean }
  | { type: 'check'; target: number }
  | { type: 'claim'; side: Side | null }
  | { type: 'shoot'; target: number };

export type Event =
  | { type: 'night' }
  | { type: 'op'; op: number; size: number; need: number }
  | { type: 'leader'; leader: number; tryNo: number }
  | { type: 'team'; leader: number; team: number[] }
  | { type: 'voted'; seat: number }
  | { type: 'votes'; votes: Record<number, boolean>; passed: boolean; rejects: number }
  | { type: 'played'; seat: number }
  | { type: 'result'; op: number; fails: number; ok: boolean; done: number; failed: number }
  | { type: 'checked'; by: number; target: number }
  | { type: 'claim'; by: number; target: number; side: Side | null }
  | { type: 'hunt'; sniper: number }
  | { type: 'shoot'; sniper: number; target: number; hit: boolean }
  | { type: 'over'; winner: Side; reason: string; roles: Record<number, Role> };

export interface View {
  seats: number[];
  humans: number[];
  scout: boolean;
  check: boolean;
  phase: Phase;
  op: number;
  ops: Op[];
  leader: number;
  rejects: number;
  team: number[];
  /** Кто уже проголосовал / сыграл карту (как — не видно). */
  voted: number[];
  played: number[];
  ready: number[];
  holder: number | null;
  held: number[];
  /** Открытые заявления о проверках (без правды). */
  claims: { by: number; target: number; side: Side | null }[];
  shot: number | null;
  winner: Side | null;
  reason: string;
  /** Конец игры — все роли открыты. */
  revealed: Record<number, Role> | null;
  /** Для своих мест: своя роль и чьи роли известны. */
  know: Record<number, Record<number, Role>>;
  myVotes: Record<number, boolean>;
  myCards: Record<number, boolean>;
  /** Свои проверки (с правдой). */
  checks: { by: number; target: number; side: Side }[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  const n = seats.length;
  const scout = opts.scout === true;
  const check = opts.check === true;
  const t = traitorsFor(n);
  const pack: Role[] = [...Array(t).fill('traitor'), ...Array(n - t).fill('partisan')];
  if (scout) {
    pack[0] = 'sniper';
    pack[t] = 'scout';
  }
  shuffle(pack, rng);
  const roles: Record<number, Role> = {};
  seats.forEach((x, i) => (roles[x] = pack[i]));
  const leader = seats[rng.int(n)];
  // жетон проверки — у сидящего перед первым командиром
  const holder = check ? seats[(seats.indexOf(leader) - 1 + n) % n] : null;
  return {
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    roles,
    scout,
    check,
    phase: 'night',
    op: 0,
    ops: [{ size: teamSize(n, 0), need: failsNeeded(n, 0), tries: [] }],
    leader,
    rejects: 0,
    team: [],
    votes: {},
    cards: {},
    ready: [],
    holder,
    held: holder != null ? [holder] : [],
    checks: [],
    shot: null,
    winner: null,
    reason: '',
  };
}

const nextSeat = (s: Pick<State, 'seats'>, x: number) => s.seats[(s.seats.indexOf(x) + 1) % s.seats.length];
export const sniperOf = (s: State) => s.seats.find((x) => s.roles[x] === 'sniper') ?? null;
export const done = (ops: Op[]) => ops.filter((o) => o.ok === true).length;
export const failed = (ops: Op[]) => ops.filter((o) => o.ok === false).length;

/** Кого можно проверить: не себя и не тех, кто уже держал жетон. */
export const checkable = (s: Pick<State, 'seats' | 'held' | 'holder'>) => s.seats.filter((x) => x !== s.holder && !s.held.includes(x));

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'night':
      return s.seats.filter((x) => !s.ready.includes(x));
    case 'propose':
      return [s.leader];
    case 'vote':
      return s.seats.filter((x) => !(x in s.votes));
    case 'mission':
      return s.team.filter((x) => !(x in s.cards));
    case 'check':
    case 'claim':
      return s.holder == null ? [] : [s.holder];
    case 'hunt': {
      const sn = sniperOf(s);
      return sn == null ? [] : [sn];
    }
    default:
      return [];
  }
}

function win(s: State, winner: Side, reason: string, ev: Event[]) {
  s.winner = winner;
  s.reason = reason;
  s.phase = 'over';
  ev.push({ type: 'over', winner, reason, roles: { ...s.roles } });
}

function newTry(s: State, ev: Event[]) {
  s.team = [];
  s.votes = {};
  s.phase = 'propose';
  ev.push({ type: 'leader', leader: s.leader, tryNo: s.rejects + 1 });
}

function nextOp(s: State, ev: Event[]) {
  s.op++;
  const n = s.seats.length;
  s.ops.push({ size: teamSize(n, s.op), need: failsNeeded(n, s.op), tries: [] });
  s.rejects = 0;
  s.cards = {};
  s.leader = nextSeat(s, s.leader);
  ev.push({ type: 'op', op: s.op, size: s.ops[s.op].size, need: s.ops[s.op].need });
  newTry(s, ev);
}

/** Операция закончена: три удачи — к снайперу или победа, три провала — победа предателей, иначе проверка или следующая. */
function afterOp(s: State, ev: Event[]) {
  if (failed(s.ops) >= 3) return win(s, 'T', 'провалены три операции', ev);
  if (done(s.ops) >= 3) {
    const sn = sniperOf(s);
    if (s.scout && sn != null) {
      s.phase = 'hunt';
      ev.push({ type: 'hunt', sniper: sn });
      return;
    }
    return win(s, 'P', 'три операции удались', ev);
  }
  if (s.check && s.holder != null && CHECK_AFTER.includes(s.op) && checkable(s).length) {
    s.phase = 'check';
    return;
  }
  nextOp(s, ev);
}

export function apply(s0: State, seat: number, a: Action, _rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat) || s0.phase === 'over') return null;
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const op = s.ops[s.op];
  switch (a.type) {
    case 'ready': {
      if (s.phase !== 'night') return null;
      s.ready.push(seat);
      if (s.ready.length === s.seats.length) {
        s.ready = [];
        ev.push({ type: 'op', op: 0, size: op.size, need: op.need });
        newTry(s, ev);
      }
      break;
    }
    case 'team': {
      if (s.phase !== 'propose' || !Array.isArray(a.members)) return null;
      const m = [...new Set(a.members)];
      if (m.length !== op.size || m.length !== a.members.length || m.some((x) => !s.seats.includes(x))) return null;
      s.team = m.sort((x, y) => s.seats.indexOf(x) - s.seats.indexOf(y));
      s.votes = {};
      s.phase = 'vote';
      op.tries.push({ leader: s.leader, team: s.team.slice() });
      ev.push({ type: 'team', leader: s.leader, team: s.team.slice() });
      break;
    }
    case 'vote': {
      if (s.phase !== 'vote' || seat in s.votes) return null;
      s.votes[seat] = !!a.yes;
      ev.push({ type: 'voted', seat });
      if (Object.keys(s.votes).length < s.seats.length) break;
      const yes = Object.values(s.votes).filter(Boolean).length;
      const passed = yes * 2 > s.seats.length;
      const t = op.tries[op.tries.length - 1];
      t.votes = { ...s.votes };
      t.passed = passed;
      if (!passed) {
        s.rejects++;
        ev.push({ type: 'votes', votes: { ...s.votes }, passed, rejects: s.rejects });
        if (s.rejects >= 5) {
          win(s, 'T', 'пять групп подряд не утверждены', ev);
          break;
        }
        s.leader = nextSeat(s, s.leader);
        newTry(s, ev);
        break;
      }
      ev.push({ type: 'votes', votes: { ...s.votes }, passed, rejects: s.rejects });
      s.cards = {};
      s.phase = 'mission';
      break;
    }
    case 'card': {
      if (s.phase !== 'mission' || seat in s.cards) return null;
      const fail = !!a.fail;
      if (fail && sideOf(s.roles[seat]) === 'P') return null;
      s.cards[seat] = fail;
      ev.push({ type: 'played', seat });
      if (Object.keys(s.cards).length < s.team.length) break;
      const fails = Object.values(s.cards).filter(Boolean).length;
      op.fails = fails;
      op.ok = fails < op.need;
      ev.push({ type: 'result', op: s.op, fails, ok: op.ok, done: done(s.ops), failed: failed(s.ops) });
      afterOp(s, ev);
      break;
    }
    case 'check': {
      if (s.phase !== 'check' || !checkable(s).includes(a.target)) return null;
      s.checks.push({ by: seat, target: a.target, side: sideOf(s.roles[a.target]) });
      ev.push({ type: 'checked', by: seat, target: a.target });
      s.phase = 'claim';
      break;
    }
    case 'claim': {
      if (s.phase !== 'claim') return null;
      const c = s.checks[s.checks.length - 1];
      const side = a.side === 'P' || a.side === 'T' ? a.side : null;
      c.claim = side;
      ev.push({ type: 'claim', by: seat, target: c.target, side });
      s.holder = c.target;
      s.held.push(c.target);
      nextOp(s, ev);
      break;
    }
    case 'shoot': {
      if (s.phase !== 'hunt' || !s.seats.includes(a.target) || a.target === seat) return null;
      s.shot = a.target;
      const hit = s.roles[a.target] === 'scout';
      ev.push({ type: 'shoot', sniper: seat, target: a.target, hit });
      if (hit) win(s, 'T', 'снайпер нашёл разведчика', ev);
      else win(s, 'P', 'три операции удались, разведчик уцелел', ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

/** Что знает место x: себя; предатели — друг друга; разведчик — предателей (не зная, кто снайпер). Конец игры — всё. */
export function knowledge(s: State, x: number): Record<number, Role> {
  if (s.phase === 'over') return { ...s.roles };
  const me = s.roles[x];
  const k: Record<number, Role> = { [x]: me };
  if (sideOf(me) === 'T') for (const y of s.seats) if (sideOf(s.roles[y]) === 'T') k[y] = s.roles[y];
  if (me === 'scout') for (const y of s.seats) if (sideOf(s.roles[y]) === 'T') k[y] = 'traitor';
  return k;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const mine = seats === 'all' ? s.seats : s.seats.filter((x) => seats.includes(x));
  const over = s.phase === 'over';
  const know: Record<number, Record<number, Role>> = {};
  for (const x of mine) know[x] = seats === 'all' ? { ...s.roles } : knowledge(s, x);
  const myVotes: Record<number, boolean> = {};
  const myCards: Record<number, boolean> = {};
  for (const x of mine) {
    if (x in s.votes) myVotes[x] = s.votes[x];
    if (x in s.cards && s.phase === 'mission') myCards[x] = s.cards[x];
  }
  return {
    seats: s.seats,
    humans: s.humans,
    scout: s.scout,
    check: s.check,
    phase: s.phase,
    op: s.op,
    ops: clone(s.ops),
    leader: s.leader,
    rejects: s.rejects,
    team: s.team.slice(),
    voted: Object.keys(s.votes).map(Number),
    played: s.phase === 'mission' ? Object.keys(s.cards).map(Number) : [],
    ready: s.ready.slice(),
    holder: s.holder,
    held: s.held.slice(),
    claims: s.checks.filter((c) => c.claim !== undefined).map((c) => ({ by: c.by, target: c.target, side: c.claim ?? null })),
    shot: s.shot,
    winner: s.winner,
    reason: s.reason,
    revealed: over ? { ...s.roles } : null,
    know,
    myVotes,
    myCards,
    checks: s.checks.filter((c) => over || mine.includes(c.by)).map((c) => ({ by: c.by, target: c.target, side: c.side })),
  };
}

export const ROLE_NAME: Record<Role, string> = { partisan: 'Партизан', scout: 'Разведчик', traitor: 'Предатель', sniper: 'Снайпер' };
export const ROLE_LOW: Record<Role, string> = { partisan: 'партизан', scout: 'разведчик', traitor: 'предатель', sniper: 'снайпер' };
export const SIDE_NAME: Record<Side, string> = { P: 'партизан', T: 'предатель' };
