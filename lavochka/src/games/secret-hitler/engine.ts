/* Тайный Гитлер — движок. 5–10 игроков: либералы против фашистов и Гитлера. Раунд: президент по кругу выдвигает канцлера,
 * все разом голосуют «Ja!»/«Nein»; правительство тянет 3 закона (президент сбрасывает 1, канцлер принимает 1 из 2).
 * Три провала подряд — хаос: принимается верхний закон. Фашистские законы дают президенту полномочия (по размеру стола),
 * после пятого — вето. После сессии президент и канцлер заявляют, что им пришло (можно врать) — кнопками, чтобы боты могли рассуждать.
 * Победа либералов — 5 либеральных законов или казнь Гитлера; фашистов — 6 фашистских или Гитлер-канцлер после трёх фашистских. Без DOM. */
import type { Options, Rng } from '../../core/types';

export type Role = 'liberal' | 'fascist' | 'hitler';
export type Party = 'L' | 'F';
export type Power = 'investigate' | 'special' | 'peek' | 'kill';
export type Phase = 'night' | 'nominate' | 'vote' | 'pres' | 'chanc' | 'veto' | 'power' | 'claim' | 'over';

export const partyOf = (r: Role): Party => (r === 'liberal' ? 'L' : 'F');

/** Сколько фашистов (без Гитлера) при n игроках. */
export const fascistsFor = (n: number) => (n <= 6 ? 1 : n <= 8 ? 2 : 3);

/** Поле фашистов: полномочие за k-й (1…5) фашистский закон по размеру стола. */
export function boardPowers(n: number): (Power | null)[] {
  if (n <= 6) return [null, null, 'peek', 'kill', 'kill'];
  if (n <= 8) return [null, 'investigate', 'special', 'kill', 'kill'];
  return ['investigate', 'investigate', 'special', 'kill', 'kill'];
}

/** Заявление президента: сколько фашистских пришло из трёх и сколько передал канцлеру (из двух); канцлера — сколько получил. null — промолчал. */
export interface Claim {
  drew?: number;
  passed?: number;
  got?: number;
  silent?: boolean;
}

/** Одно правительство (выдвижение): голоса, что приняли, что заявили. Карты сессии видят только её участники. */
export interface Gov {
  round: number;
  pres: number;
  chanc: number;
  special?: boolean;
  votes?: Record<number, boolean>;
  passed?: boolean;
  /** Что принято; veto — правительство отвергло оба. */
  policy?: Party;
  veto?: boolean;
  /** Вето просили, а президент отказал. */
  vetoAsked?: boolean;
  presClaim?: Claim;
  chancClaim?: Claim;
  /** Карты (только участникам сессии): что пришло президенту, что передано канцлеру. */
  drew?: Party[];
  gave?: Party[];
  /** Полномочие после этого закона и на ком. */
  power?: Power;
  target?: number;
  /** Заявление президента о проверке/просмотре. */
  powerClaim?: { party?: Party; fas?: number; silent?: boolean };
}

export interface State {
  seats: number[];
  humans: number[];
  roles: Record<number, Role>;
  /** Какой портрет на карте роли (у либералов шесть, у фашистов три). */
  art: Record<number, number>;
  dead: number[];
  deck: Party[];
  discard: Party[];
  lib: number;
  fas: number;
  tracker: number;
  phase: Phase;
  round: number;
  /** Кто сидит «по кругу» последним президентом (после внеочередных выборов круг продолжается от него). */
  rot: number;
  special: number | null;
  pres: number;
  chanc: number | null;
  /** Последнее избранное правительство — ограничение сроков. */
  lastPres: number | null;
  lastChanc: number | null;
  votes: Record<number, boolean>;
  hand: Party[];
  vetoDenied: boolean;
  power: Power | null;
  claimWait: number[];
  /** Что делать после заявлений. */
  after: 'power' | 'round';
  investigated: number[];
  /** Результаты проверок: кто проверял → кого → партия (видит только проверявший). */
  inv: { by: number; target: number; party: Party }[];
  /** Просмотр трёх верхних (видит только президент). */
  peeks: { by: number; cards: Party[] }[];
  notHitler: number[];
  ready: number[];
  govs: Gov[];
  winner: Party | null;
  reason: string;
}

export type Action =
  | { type: 'ready' }
  | { type: 'nominate'; target: number }
  | { type: 'vote'; ja: boolean }
  | { type: 'discard'; index: number }
  | { type: 'enact'; index: number }
  | { type: 'veto' }
  | { type: 'vetoAnswer'; yes: boolean }
  | { type: 'investigate'; target: number }
  | { type: 'special'; target: number }
  | { type: 'peek' }
  | { type: 'kill'; target: number }
  | { type: 'claim'; drew?: number; passed?: number; got?: number; party?: Party; fas?: number; silent?: boolean };

export type Event =
  | { type: 'start'; n: number }
  | { type: 'night' }
  | { type: 'round'; round: number; pres: number; special: boolean }
  | { type: 'nominate'; pres: number; chanc: number }
  | { type: 'voted'; seat: number }
  | { type: 'votes'; votes: Record<number, boolean>; passed: boolean; tracker: number }
  | { type: 'notHitler'; seat: number }
  | { type: 'draw'; pres: number }
  | { type: 'pass'; pres: number; chanc: number }
  | { type: 'enact'; policy: Party; chaos: boolean; lib: number; fas: number }
  | { type: 'vetoAsk'; chanc: number }
  | { type: 'vetoAnswer'; pres: number; yes: boolean }
  | { type: 'shuffle'; deck: number }
  | { type: 'power'; pres: number; power: Power }
  | { type: 'investigate'; pres: number; target: number }
  | { type: 'special'; pres: number; target: number }
  | { type: 'peek'; pres: number }
  | { type: 'kill'; pres: number; target: number }
  | { type: 'claim'; seat: number; as: 'pres' | 'chanc' | 'power'; claim: Claim & { party?: Party; fas?: number } }
  | { type: 'over'; winner: Party; reason: string; roles: Record<number, Role> };

export interface View {
  seats: number[];
  humans: number[];
  dead: number[];
  lib: number;
  fas: number;
  tracker: number;
  deck: number;
  discard: number;
  phase: Phase;
  round: number;
  pres: number;
  chanc: number | null;
  lastPres: number | null;
  lastChanc: number | null;
  /** Кто уже проголосовал (как — откроется, когда проголосуют все). */
  voted: number[];
  vetoDenied: boolean;
  power: Power | null;
  claimWait: number[];
  investigated: number[];
  notHitler: number[];
  ready: number[];
  govs: Gov[];
  winner: Party | null;
  reason: string;
  /** Конец игры — все роли открыты. */
  revealed: Record<number, Role> | null;
  /** Для каждого своего места: своя роль и чьи роли известны (фашисты знают своих). */
  know: Record<number, Record<number, Role>>;
  art: Record<number, number>;
  /** Свои голоса в текущем голосовании. */
  myVotes: Record<number, boolean>;
  /** Карты на руке у своего места (президент 3 / канцлер 2). */
  hand: Party[] | null;
  /** Свои проверки и просмотры. */
  inv: { by: number; target: number; party: Party }[];
  peeks: { by: number; cards: Party[] }[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function setup(seats: number[], _opts: Options, rng: Rng, humans: number[] = []): State {
  const n = seats.length;
  const f = fascistsFor(n);
  const pack: Role[] = ['hitler', ...Array(f).fill('fascist'), ...Array(n - f - 1).fill('liberal')];
  shuffle(pack, rng);
  const roles: Record<number, Role> = {};
  const art: Record<number, number> = {};
  const libArt = shuffle([0, 1, 2, 3, 4, 5], rng);
  const fasArt = shuffle([0, 1, 2], rng);
  let li = 0;
  let fi = 0;
  seats.forEach((x, i) => {
    roles[x] = pack[i];
    art[x] = pack[i] === 'liberal' ? libArt[li++ % 6] : pack[i] === 'fascist' ? fasArt[fi++ % 3] : 0;
  });
  const first = seats[rng.int(n)];
  return {
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    roles,
    art,
    dead: [],
    deck: shuffle([...Array(6).fill('L'), ...Array(11).fill('F')] as Party[], rng),
    discard: [],
    lib: 0,
    fas: 0,
    tracker: 0,
    phase: 'night',
    round: 0,
    rot: first,
    special: null,
    pres: first,
    chanc: null,
    lastPres: null,
    lastChanc: null,
    votes: {},
    hand: [],
    vetoDenied: false,
    power: null,
    claimWait: [],
    after: 'round',
    investigated: [],
    inv: [],
    peeks: [],
    notHitler: [],
    ready: [],
    govs: [],
    winner: null,
    reason: '',
  };
}

export const alive = (s: Pick<State, 'seats' | 'dead'>) => s.seats.filter((x) => !s.dead.includes(x));

function nextAlive(s: State, from: number): number {
  const i = s.seats.indexOf(from);
  for (let k = 1; k <= s.seats.length; k++) {
    const x = s.seats[(i + k) % s.seats.length];
    if (!s.dead.includes(x)) return x;
  }
  return from;
}

/** Кого президент может выдвинуть в канцлеры. */
export function eligible(s: Pick<State, 'seats' | 'dead' | 'pres' | 'lastPres' | 'lastChanc'>): number[] {
  const live = alive(s);
  return live.filter((x) => x !== s.pres && x !== s.lastChanc && !(live.length > 5 && x === s.lastPres));
}

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'night':
      return s.seats.filter((x) => !s.ready.includes(x));
    case 'nominate':
    case 'pres':
    case 'veto':
    case 'power':
      return [s.pres];
    case 'vote':
      return alive(s).filter((x) => !(x in s.votes));
    case 'chanc':
      return s.chanc == null ? [] : [s.chanc];
    case 'claim':
      return s.claimWait.slice();
    default:
      return [];
  }
}

const curGov = (s: State) => s.govs[s.govs.length - 1];

function win(s: State, winner: Party, reason: string, ev: Event[]) {
  s.winner = winner;
  s.reason = reason;
  s.phase = 'over';
  s.claimWait = [];
  ev.push({ type: 'over', winner, reason, roles: { ...s.roles } });
}

/** Меньше трёх в колоде — сброс замешивается обратно. */
function refill(s: State, rng: Rng, ev: Event[]) {
  if (s.deck.length >= 3) return;
  s.deck = shuffle([...s.deck, ...s.discard], rng);
  s.discard = [];
  ev.push({ type: 'shuffle', deck: s.deck.length });
}

function newRound(s: State, ev: Event[]) {
  s.round++;
  let special = false;
  if (s.special != null && !s.dead.includes(s.special)) {
    s.pres = s.special;
    special = true;
  } else {
    s.rot = nextAlive(s, s.rot);
    s.pres = s.rot;
  }
  s.special = null;
  s.chanc = null;
  s.votes = {};
  s.hand = [];
  s.vetoDenied = false;
  s.power = null;
  s.phase = 'nominate';
  ev.push({ type: 'round', round: s.round, pres: s.pres, special });
}

/** Закон принят: счёт, победа, сброс трекера. Возвращает полномочие (если положено). */
function enact(s: State, p: Party, chaos: boolean, ev: Event[]): Power | null {
  if (p === 'L') s.lib++;
  else s.fas++;
  s.tracker = 0;
  ev.push({ type: 'enact', policy: p, chaos, lib: s.lib, fas: s.fas });
  if (s.lib >= 5) win(s, 'L', 'приняты пять либеральных законов', ev);
  else if (s.fas >= 6) win(s, 'F', 'приняты шесть фашистских законов', ev);
  if (chaos || p !== 'F' || s.winner) return null;
  return boardPowers(s.seats.length)[s.fas - 1] ?? null;
}

/** Провал выборов или вето: трекер +1, на третьем — хаос. */
function fail(s: State, rng: Rng, ev: Event[]) {
  s.tracker++;
  if (s.tracker < 3) return;
  refill(s, rng, ev);
  const top = s.deck.shift()!;
  enact(s, top, true, ev);
  s.lastPres = null;
  s.lastChanc = null;
  refill(s, rng, ev);
}

function startClaims(s: State, who: number[], after: 'power' | 'round', rng: Rng, ev: Event[]) {
  s.claimWait = who.filter((x) => !s.dead.includes(x));
  s.after = after;
  s.phase = 'claim';
  if (!s.claimWait.length) proceed(s, rng, ev);
}

function proceed(s: State, rng: Rng, ev: Event[]) {
  if (s.winner) return;
  if (s.after === 'power' && s.power) {
    s.phase = 'power';
    ev.push({ type: 'power', pres: s.pres, power: s.power });
    return;
  }
  newRound(s, ev);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat) || s0.phase === 'over') return null;
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const live = alive(s);
  const target = (a as { target?: unknown }).target;
  const okTarget = (t: unknown): t is number => typeof t === 'number' && live.includes(t) && t !== seat;
  switch (a.type) {
    case 'ready': {
      if (s.phase !== 'night') return null;
      s.ready.push(seat);
      if (s.ready.length === s.seats.length) {
        s.ready = [];
        s.round = 0;
        s.rot = s.seats[(s.seats.indexOf(s.pres) - 1 + s.seats.length) % s.seats.length];
        newRound(s, ev);
      }
      break;
    }
    case 'nominate': {
      if (s.phase !== 'nominate' || !eligible(s).includes(a.target)) return null;
      s.chanc = a.target;
      s.votes = {};
      s.phase = 'vote';
      s.govs.push({ round: s.round, pres: s.pres, chanc: a.target, ...(s.special == null && s.pres !== s.rot ? { special: true } : {}) });
      ev.push({ type: 'nominate', pres: s.pres, chanc: a.target });
      break;
    }
    case 'vote': {
      if (s.phase !== 'vote' || seat in s.votes) return null;
      s.votes[seat] = !!a.ja;
      ev.push({ type: 'voted', seat });
      if (Object.keys(s.votes).length < live.length) break;
      const ja = Object.values(s.votes).filter(Boolean).length;
      const passed = ja * 2 > live.length;
      const g = curGov(s);
      g.votes = { ...s.votes };
      g.passed = passed;
      if (!passed) {
        // tracker в событии — сколько провалов подряд (3 — хаос)
        ev.push({ type: 'votes', votes: { ...s.votes }, passed, tracker: s.tracker + 1 });
        fail(s, rng, ev);
        if (!s.winner) newRound(s, ev);
        break;
      }
      ev.push({ type: 'votes', votes: { ...s.votes }, passed, tracker: s.tracker });
      s.lastPres = s.pres;
      s.lastChanc = s.chanc;
      if (s.fas >= 3) {
        if (s.roles[s.chanc!] === 'hitler') {
          win(s, 'F', 'Гитлер избран канцлером', ev);
          break;
        }
        if (!s.notHitler.includes(s.chanc!)) s.notHitler.push(s.chanc!);
        ev.push({ type: 'notHitler', seat: s.chanc! });
      }
      refill(s, rng, ev);
      s.hand = s.deck.splice(0, 3);
      g.drew = s.hand.slice();
      s.phase = 'pres';
      ev.push({ type: 'draw', pres: s.pres });
      break;
    }
    case 'discard': {
      if (s.phase !== 'pres' || !Number.isInteger(a.index) || a.index < 0 || a.index >= s.hand.length) return null;
      s.discard.push(...s.hand.splice(a.index, 1));
      curGov(s).gave = s.hand.slice();
      s.phase = 'chanc';
      ev.push({ type: 'pass', pres: s.pres, chanc: s.chanc! });
      break;
    }
    case 'enact': {
      if (s.phase !== 'chanc' || !Number.isInteger(a.index) || a.index < 0 || a.index >= s.hand.length) return null;
      const p = s.hand.splice(a.index, 1)[0];
      s.discard.push(...s.hand);
      s.hand = [];
      const g = curGov(s);
      g.policy = p;
      const pw = enact(s, p, false, ev);
      if (s.winner) break;
      refill(s, rng, ev);
      s.power = pw;
      if (pw) g.power = pw;
      startClaims(s, [s.pres, s.chanc!], 'power', rng, ev);
      break;
    }
    case 'veto': {
      if (s.phase !== 'chanc' || s.fas < 5 || s.vetoDenied) return null;
      s.phase = 'veto';
      curGov(s).vetoAsked = true;
      ev.push({ type: 'vetoAsk', chanc: seat });
      break;
    }
    case 'vetoAnswer': {
      if (s.phase !== 'veto') return null;
      ev.push({ type: 'vetoAnswer', pres: seat, yes: !!a.yes });
      if (!a.yes) {
        s.vetoDenied = true;
        s.phase = 'chanc';
        break;
      }
      s.discard.push(...s.hand);
      s.hand = [];
      curGov(s).veto = true;
      fail(s, rng, ev);
      if (s.winner) break;
      refill(s, rng, ev);
      startClaims(s, [s.pres, s.chanc!], 'round', rng, ev);
      break;
    }
    case 'investigate': {
      if (s.phase !== 'power' || s.power !== 'investigate' || !okTarget(target) || s.investigated.includes(target)) return null;
      s.investigated.push(target);
      s.inv.push({ by: seat, target, party: partyOf(s.roles[target]) });
      curGov(s).target = target;
      ev.push({ type: 'investigate', pres: seat, target });
      s.power = null;
      startClaims(s, [seat], 'round', rng, ev);
      break;
    }
    case 'special': {
      if (s.phase !== 'power' || s.power !== 'special' || !okTarget(target)) return null;
      s.special = target;
      curGov(s).target = target;
      ev.push({ type: 'special', pres: seat, target });
      s.power = null;
      newRound(s, ev);
      break;
    }
    case 'peek': {
      if (s.phase !== 'power' || s.power !== 'peek') return null;
      s.peeks.push({ by: seat, cards: s.deck.slice(0, 3) });
      ev.push({ type: 'peek', pres: seat });
      s.power = null;
      startClaims(s, [seat], 'round', rng, ev);
      break;
    }
    case 'kill': {
      if (s.phase !== 'power' || s.power !== 'kill' || !okTarget(target)) return null;
      s.dead.push(target);
      curGov(s).target = target;
      ev.push({ type: 'kill', pres: seat, target });
      s.power = null;
      if (s.roles[target] === 'hitler') {
        win(s, 'L', 'Гитлер казнён', ev);
        break;
      }
      newRound(s, ev);
      break;
    }
    case 'claim': {
      if (s.phase !== 'claim' || !s.claimWait.includes(seat)) return null;
      const g = curGov(s);
      const silent = !!a.silent;
      const int = (x: unknown, max: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max ? (x as number) : undefined);
      let as: 'pres' | 'chanc' | 'power';
      let claim: Claim & { party?: Party; fas?: number };
      if (g.power && (g.power === 'investigate' || g.power === 'peek') && g.presClaim && seat === g.pres) {
        // заявление о проверке или о трёх верхних
        as = 'power';
        if (silent) claim = { silent };
        else if (g.power === 'investigate') {
          if (a.party !== 'L' && a.party !== 'F') return null;
          claim = { party: a.party };
        } else {
          const f = int(a.fas, 3);
          if (f == null) return null;
          claim = { fas: f };
        }
        g.powerClaim = claim;
      } else if (seat === g.pres && !g.presClaim) {
        as = 'pres';
        const drew = int(a.drew, 3);
        const passed = int(a.passed, 2);
        if (!silent && (drew == null || passed == null || passed > drew || drew - passed > 1)) return null;
        claim = silent ? { silent } : { drew, passed };
        g.presClaim = claim;
      } else if (seat === g.chanc && !g.chancClaim) {
        as = 'chanc';
        const got = int(a.got, 2);
        if (!silent && got == null) return null;
        claim = silent ? { silent } : { got };
        g.chancClaim = claim;
      } else return null;
      s.claimWait = s.claimWait.filter((x) => x !== seat);
      ev.push({ type: 'claim', seat, as, claim });
      if (!s.claimWait.length) proceed(s, rng, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

/** Что знает место x о ролях: себя; фашист — всех фашистов и Гитлера; Гитлер — фашиста, если игроков 5–6. Конец игры — всё. */
export function knowledge(s: State, x: number): Record<number, Role> {
  if (s.phase === 'over') return { ...s.roles };
  const me = s.roles[x];
  const k: Record<number, Role> = { [x]: me };
  const team = me === 'fascist' || (me === 'hitler' && s.seats.length <= 6);
  if (team) for (const y of s.seats) if (s.roles[y] !== 'liberal') k[y] = s.roles[y];
  return k;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const mine = seats === 'all' ? s.seats : s.seats.filter((x) => seats.includes(x));
  const know: Record<number, Record<number, Role>> = {};
  for (const x of mine) know[x] = seats === 'all' ? { ...s.roles } : knowledge(s, x);
  const myVotes: Record<number, boolean> = {};
  for (const x of mine) if (x in s.votes) myVotes[x] = s.votes[x];
  const holder = s.phase === 'pres' || s.phase === 'veto' ? s.pres : s.phase === 'chanc' ? s.chanc : null;
  const over = s.phase === 'over';
  // карты сессии видят только её участники: президент — что пришло и что передал, канцлер — что получил
  const govs = s.govs.map((g) => {
    const out: Gov = { ...g };
    const p = over || mine.includes(g.pres);
    const c = over || mine.includes(g.chanc);
    if (!p) delete out.drew;
    if (!p && !c) delete out.gave;
    return out;
  });
  return {
    seats: s.seats,
    humans: s.humans,
    dead: s.dead,
    lib: s.lib,
    fas: s.fas,
    tracker: s.tracker,
    deck: s.deck.length,
    discard: s.discard.length,
    phase: s.phase,
    round: s.round,
    pres: s.pres,
    chanc: s.chanc,
    lastPres: s.lastPres,
    lastChanc: s.lastChanc,
    voted: Object.keys(s.votes).map(Number),
    vetoDenied: s.vetoDenied,
    power: s.power,
    claimWait: s.claimWait,
    investigated: s.investigated,
    notHitler: s.notHitler,
    ready: s.ready,
    govs,
    winner: s.winner,
    reason: s.reason,
    revealed: over ? { ...s.roles } : null,
    know,
    art: Object.fromEntries(Object.entries(s.art).filter(([x]) => over || mine.includes(+x))),
    myVotes,
    hand: holder != null && mine.includes(holder) ? s.hand.slice() : null,
    inv: s.inv.filter((r) => over || mine.includes(r.by)),
    peeks: s.peeks.filter((r) => over || mine.includes(r.by)),
  };
}

export const ROLE_NAME: Record<Role, string> = { liberal: 'Либерал', fascist: 'Фашист', hitler: 'Гитлер' };
export const POWER_NAME: Record<Power, string> = {
  investigate: 'проверка партии',
  special: 'внеочередные выборы',
  peek: 'просмотр трёх законов',
  kill: 'казнь',
};

/** «ЛЛФ» по числу фашистских из n. */
export const cardsText = (fas: number, n: number) => 'Л'.repeat(n - fas) + 'Ф'.repeat(fas);
export const ROLE_LOW: Record<Role, string> = { liberal: 'либерал', fascist: 'фашист', hitler: 'Гитлер' };
