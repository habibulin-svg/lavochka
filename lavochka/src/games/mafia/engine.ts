/* Мафия — правила (без DOM). 6–16 игроков. Роли раздаются втайне: мафия (в спортивной — с доном), комиссар, мирные;
 * по желанию — доктор и путана.
 *
 * Ночь: все роли действуют втайне и одновременно. Мафия выбирает, кого убить (решает большинство, при разногласии — дон / первый мафиози);
 * комиссар проверяет игрока (узнаёт, мафия ли он); дон проверяет, комиссар ли игрок; доктор лечит (себя — не два раза подряд);
 * путана приходит к игроку: его ночное действие не срабатывает, и убить его этой ночью нельзя.
 * Утро: объявляют, кого убили (или «ночь прошла спокойно»). В классике роль убитого открывают.
 * День: по кругу каждый говорит и может выставить одного игрока на голосование. Потом все по очереди голосуют за одного из выставленных.
 * Больше всех голосов — уходит из игры. Поровну — переголосовка между лидерами; снова поровну — никто не уходит.
 * Победа города — мафия выбыла вся; победа мафии — мафии не меньше, чем остальных.
 */
import type { Options, Rng } from '../../core/types';

export type Role = 'civ' | 'mafia' | 'don' | 'sheriff' | 'doctor' | 'putana';
export type Variant = 'classic' | 'extended' | 'sport';

export interface Cfg {
  variant: Variant;
  /** Открывать роль ушедшего. */
  reveal: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const v = String(o.variant);
  const variant: Variant = v === 'extended' || v === 'sport' ? v : 'classic';
  return { variant, reveal: o.reveal == null ? variant !== 'sport' : !!o.reveal };
}

export const ROLE_NAME: Record<Role, string> = { civ: 'мирный житель', mafia: 'мафия', don: 'дон мафии', sheriff: 'комиссар', doctor: 'доктор', putana: 'путана' };
export const isMafia = (r: Role) => r === 'mafia' || r === 'don';

/** Состав ролей на n игроков. */
export function roleSet(n: number, v: Variant): Role[] {
  const mafia = v === 'sport' ? 3 : Math.max(1, Math.floor(n / 3.5));
  const out: Role[] = [];
  if (v === 'sport') out.push('don', 'mafia', 'mafia');
  else for (let i = 0; i < mafia; i++) out.push('mafia');
  out.push('sheriff');
  if (v === 'extended') {
    out.push('doctor');
    if (n >= 8) out.push('putana');
  }
  while (out.length < n) out.push('civ');
  return out.slice(0, n);
}

export type Phase = 'night' | 'day' | 'vote' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  roles: Role[];
  alive: number[];
  phase: Phase;
  /** Номер ночи/дня (ночь 1, день 1, …). */
  day: number;
  /** Ночные действия: кто что выбрал (секретно). */
  night: Record<number, number>;
  /** Проверка дона этой ночью. */
  donCheck: number;
  /** Кто ещё должен сделать ночной ход. */
  pending: number[];
  /** Доктор: кого лечил прошлой ночью. */
  lastHeal: number;
  /** Проверки комиссара и дона — видят только они. */
  checks: Record<number, { target: number; result: boolean }[]>;
  /** День: очередь речей, выставленные, голоса. */
  order: number[];
  speaker: number;
  nominees: number[];
  /** Кто кого выставил. */
  nominatedBy: Record<number, number>;
  votes: Record<number, number>;
  voter: number;
  /** Переголосовка между этими (поровну). */
  revote: boolean;
  /** Открытые роли (ушедших — если по правилам открывают). */
  shown: Record<number, Role>;
  winner: 'city' | 'mafia' | null;
  /** Последнее, что сказал игрок (для отображения пузырём). */
  said: Record<number, string>;
  /** Ночь знакомства (спортивная): мафия только узнаёт друг друга. */
  meet: boolean;
  /** Заявления «я комиссар: такой-то — мафия / мирный» (публично; могут быть и враньём). */
  claims: Record<number, { target: number; mafia: boolean }[]>;
  /** Прошедшие дни: кто кого выставлял, кто за кого голосовал, кто ушёл. */
  history: { nominations: [number, number][]; votes: [number, number][]; out: number | null }[];
}

export interface View extends State {
  me: number[];
}

export type Action =
  /** Ночной ход; дон в спортивной ещё и проверяет (check). */
  | { type: 'night'; target: number; check?: number }
  | { type: 'speak'; nominate?: number; text?: string; claim?: { target: number; mafia: boolean } }
  | { type: 'vote'; target: number };

export type Event =
  | { type: 'night'; day: number; meet: boolean }
  /** Ночной ход: виден только to (сам игрок и, для мафии, остальная мафия). */
  | { type: 'act'; seat: number; role?: Role; target?: number; to: number[] }
  | { type: 'check'; seat: number; target: number; result: boolean; who: 'sheriff' | 'don'; to: number[] }
  | { type: 'dawn'; day: number; killed: number | null; role?: Role; saved: boolean }
  | { type: 'speak'; seat: number; text: string; nominate?: number; claim?: { target: number; mafia: boolean } }
  | { type: 'vote'; seat: number; target: number }
  | { type: 'revote'; between: number[] }
  | { type: 'out'; seat: number; votes: number; role?: Role }
  | { type: 'nobody'; reason: 'tie' | 'none' }
  | { type: 'end'; winner: 'city' | 'mafia'; roles: Role[] };

function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const cfg = cfgFrom(opts);
  const roles: Role[] = Array(16).fill('civ');
  const dealt = shuffle(roleSet(seats.length, cfg.variant), rng);
  seats.forEach((x, i) => (roles[x] = dealt[i]));
  const s: State = {
    cfg,
    seats: seats.slice(),
    roles,
    alive: seats.slice(),
    phase: 'night',
    day: 1,
    night: {},
    donCheck: -1,
    pending: [],
    lastHeal: -1,
    checks: {},
    order: [],
    speaker: -1,
    nominees: [],
    nominatedBy: {},
    votes: {},
    voter: -1,
    revote: false,
    shown: {},
    winner: null,
    said: {},
    meet: cfg.variant === 'sport',
    claims: {},
    history: [],
  };
  startNight(s);
  return s;
}

function startNight(s: State) {
  s.phase = 'night';
  s.night = {};
  s.donCheck = -1;
  // ночью «ходят» все: по очереди ходящих не должно быть видно, у кого есть роль (мирные выбирают, кого подозревают)
  s.pending = s.alive.slice();
}

export const toAct = (s: State): number[] => {
  if (s.phase === 'over') return [];
  if (s.phase === 'night') return s.pending.slice();
  if (s.phase === 'day') return [s.speaker];
  return [s.voter];
};

const mafiaAlive = (s: State) => s.alive.filter((x) => isMafia(s.roles[x]));

function checkWin(s: State, ev: Event[]): boolean {
  const m = mafiaAlive(s).length;
  const c = s.alive.length - m;
  if (m === 0 || m >= c) {
    s.winner = m === 0 ? 'city' : 'mafia';
    s.phase = 'over';
    ev.push({ type: 'end', winner: s.winner, roles: s.roles.slice() });
    return true;
  }
  return false;
}

/** Утро: кого убили, проверки, потом — день. */
function dawn(s: State, ev: Event[]) {
  const n = s.night;
  const of = (r: Role) => s.alive.find((x) => s.roles[x] === r);
  const ext = s.cfg.variant === 'extended';
  const putana = ext ? of('putana') : undefined;
  const visited = putana != null && n[putana] != null ? n[putana] : -1;
  // кто «под путаной» — его действие не срабатывает
  const works = (x: number | undefined) => x != null && x !== visited && n[x] != null;
  let killed: number | null = null;
  let saved = false;
  if (!s.meet) {
    // выстрел мафии: большинство; поровну — решает дон (или первый мафиози)
    const shooters = mafiaAlive(s).filter((x) => works(x));
    const tally = new Map<number, number>();
    for (const m of shooters) tally.set(n[m], (tally.get(n[m]) ?? 0) + 1);
    if (tally.size) {
      const best = Math.max(...tally.values());
      const leaders = [...tally.entries()].filter(([, v]) => v === best).map(([k]) => k);
      const boss = shooters.find((x) => s.roles[x] === 'don') ?? shooters[0];
      killed = leaders.length === 1 ? leaders[0] : leaders.includes(n[boss]) ? n[boss] : leaders[0];
    }
    const doc = ext ? of('doctor') : undefined;
    if (killed != null && works(doc) && n[doc!] === killed) {
      saved = true;
      killed = null;
    }
    if (killed != null && killed === visited) {
      saved = true;
      killed = null;
    }
    if (doc != null) s.lastHeal = works(doc) ? n[doc] : -1;
    // проверки
    for (const who of (s.cfg.variant === 'sport' ? ['sheriff', 'don'] : ['sheriff']) as ('sheriff' | 'don')[]) {
      const x = of(who);
      if (x == null || !works(x)) continue;
      const t = who === 'don' ? s.donCheck : n[x];
      if (t < 0) continue;
      const result = who === 'sheriff' ? isMafia(s.roles[t]) : s.roles[t] === 'sheriff';
      s.checks = { ...s.checks, [x]: [...(s.checks[x] ?? []), { target: t, result }] };
      ev.push({ type: 'check', seat: x, target: t, result, who, to: [x] });
    }
  }
  if (killed != null) {
    s.alive = s.alive.filter((x) => x !== killed);
    if (s.cfg.reveal) s.shown = { ...s.shown, [killed]: s.roles[killed] };
  }
  ev.push({ type: 'dawn', day: s.day, killed, role: killed != null && s.cfg.reveal ? s.roles[killed] : undefined, saved });
  s.meet = false;
  if (checkWin(s, ev)) return;
  // день: речи по кругу, начиная со следующего за прошлым первым
  s.phase = 'day';
  const start = s.alive[(s.day - 1) % s.alive.length];
  const i = s.alive.indexOf(start);
  s.order = [...s.alive.slice(i), ...s.alive.slice(0, i)];
  s.speaker = s.order[0];
  s.nominees = [];
  s.nominatedBy = {};
  s.votes = {};
  s.revote = false;
  s.said = {};
}

export function apply(s0: State, seat: number, a: Action, _rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || !toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, night: { ...s0.night }, pending: s0.pending.slice(), nominees: s0.nominees.slice(), nominatedBy: { ...s0.nominatedBy }, votes: { ...s0.votes }, said: { ...s0.said } };
  const ev: Event[] = [];
  if (s0.phase === 'night') {
    if (a.type !== 'night' || !s.alive.includes(a.target)) return null;
    const role = s.roles[seat];
    // мафия не стреляет в своих, комиссар не проверяет себя, доктор не лечит себя второй раз подряд
    if (isMafia(role) && !s.meet && isMafia(s.roles[a.target])) return null;
    // мирным и ролям без хода (в классике — доктор и путана не ходят) — выбор «подозреваю», ни на что не влияет
    if (!s.meet && (role === 'sheriff' || role === 'putana') && a.target === seat) return null;
    if (role === 'doctor' && a.target === seat && s.lastHeal === seat) return null;
    s.night[seat] = a.target;
    if (role === 'don' && !s.meet && s.cfg.variant === 'sport') {
      if (a.check == null || !s.alive.includes(a.check) || a.check === seat) return null;
      s.donCheck = a.check;
    }
    s.pending = s.pending.filter((x) => x !== seat);
    ev.push({ type: 'act', seat, role, target: a.target, to: isMafia(role) ? mafiaAlive(s) : [seat] });
    if (!s.pending.length) dawn(s, ev);
    return { state: s, events: ev };
  }
  if (s0.phase === 'day') {
    if (a.type !== 'speak') return null;
    if (a.nominate != null) {
      if (!s.alive.includes(a.nominate) || s.nominees.includes(a.nominate) || a.nominate === seat) return null;
      s.nominees.push(a.nominate);
      s.nominatedBy[a.nominate] = seat;
    }
    const text = (a.text ?? '').toString().slice(0, 200);
    s.said[seat] = text;
    let claim: { target: number; mafia: boolean } | undefined;
    if (a.claim && s.alive.includes(a.claim.target) && a.claim.target !== seat) {
      claim = { target: a.claim.target, mafia: !!a.claim.mafia };
      s.claims = { ...s.claims, [seat]: [...(s.claims[seat] ?? []), claim] };
    }
    ev.push({ type: 'speak', seat, text, nominate: a.nominate, claim });
    const i = s.order.indexOf(seat);
    if (i < s.order.length - 1) {
      s.speaker = s.order[i + 1];
      return { state: s, events: ev };
    }
    // все высказались
    if (!s.nominees.length) {
      ev.push({ type: 'nobody', reason: 'none' });
      return toNight(s, ev);
    }
    s.phase = 'vote';
    s.votes = {};
    s.voter = s.order[0];
    return { state: s, events: ev };
  }
  // голосование
  if (a.type !== 'vote' || !s.nominees.includes(a.target)) return null;
  s.votes[seat] = a.target;
  ev.push({ type: 'vote', seat, target: a.target });
  const i = s.order.indexOf(seat);
  if (i < s.order.length - 1) {
    s.voter = s.order[i + 1];
    return { state: s, events: ev };
  }
  const tally = new Map<number, number>();
  for (const t of Object.values(s.votes)) tally.set(t, (tally.get(t) ?? 0) + 1);
  const best = Math.max(...tally.values());
  const leaders = [...tally.entries()].filter(([, v]) => v === best).map(([k]) => k);
  if (leaders.length > 1) {
    if (!s.revote) {
      ev.push({ type: 'revote', between: leaders });
      s.revote = true;
      s.nominees = leaders;
      s.votes = {};
      s.voter = s.order[0];
      return { state: s, events: ev };
    }
    ev.push({ type: 'nobody', reason: 'tie' });
    return toNight(s, ev);
  }
  const out = leaders[0];
  s.alive = s.alive.filter((x) => x !== out);
  if (s.cfg.reveal) s.shown = { ...s.shown, [out]: s.roles[out] };
  ev.push({ type: 'out', seat: out, votes: best, role: s.cfg.reveal ? s.roles[out] : undefined });
  if (checkWin(s, ev)) return { state: s, events: ev };
  return toNight(s, ev, out);
}

function toNight(s: State, ev: Event[], out: number | null = null): { state: State; events: Event[] } {
  s.history = [...s.history, { nominations: Object.entries(s.nominatedBy).map(([t, by]) => [by, +t] as [number, number]), votes: Object.entries(s.votes).map(([v, t]) => [+v, t] as [number, number]), out }];
  s.day += 1;
  startNight(s);
  ev.push({ type: 'night', day: s.day, meet: false });
  return { state: s, events: ev };
}

/** Что видит игрок: свою роль; мафия — своих; комиссар и дон — свои проверки; ушедшие — открытые роли. В конце — всё. */
export function makeView(s: State, seats: number[] | 'all'): View {
  if (seats === 'all' || s.phase === 'over') return { ...s, me: seats === 'all' ? s.seats.slice() : seats.slice() };
  const mine = seats;
  const mafiaMe = mine.some((x) => isMafia(s.roles[x]));
  const roles = s.roles.map((r, i): Role => {
    if (mine.includes(i)) return r;
    if (s.shown[i]) return s.shown[i];
    if (mafiaMe && isMafia(r)) return r;
    return 'civ';
  });
  const night: Record<number, number> = {};
  // ночью мафия видит выбор своих
  for (const [k, v] of Object.entries(s.night)) if (mine.includes(+k) || (mafiaMe && isMafia(s.roles[+k]))) night[+k] = v;
  const checks: State['checks'] = {};
  for (const x of mine) if (s.checks[x]) checks[x] = s.checks[x];
  return { ...s, roles, night, checks, pending: s.pending.filter((x) => mine.includes(x)), me: mine.slice() };
}

/** Знает ли игрок роль места (своя, своя мафия, открытая). */
export const knownRole = (v: View, seat: number) => v.me.includes(seat) || !!v.shown[seat] || (v.me.some((x) => isMafia(v.roles[x])) && isMafia(v.roles[seat]));
