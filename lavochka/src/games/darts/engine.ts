/* Дартс — правила партии (без DOM). Подход — три дротика; дротики торчат в мишени до конца подхода, потом их вынимают.
 *
 * Игры:
 * - «501»/«301» (x01): со счёта отнимают выбитое; закончить ровно в ноль, при double out — последним дротиком в удвоение
 *   (или «яблочко»). Перебор (меньше нуля, ровно 1 при double out, ноль не удвоением) — счёт возвращается к началу подхода,
 *   подход окончен. При double in счёт «открывают» удвоением. Леги: кто первым выиграл нужное число.
 * - «Вокруг света»: сектора 1…20 по порядку (по желанию — в конце «яблочко»); засчитывается любое поле нужного сектора,
 *   с «прыжками» удвоение двигает на 2, утроение — на 3. Первый прошедший круг — победил.
 * - «Крикет»: 15…20 и бык. Одиночное — одна метка, удвоение — две, утроение — три (бык 25 — одна, 50 — две). Три метки —
 *   число закрыто; дальше по нему идут очки, пока его не закрыли все соперники. Победа — всё закрыто и очков не меньше всех.
 *   «Головорез»: очки достаются соперникам, у кого число открыто, и побеждает закрывший всё с наименьшими очками.
 * - «Шанхай»: в раунде N в счёт идёт только сектор N (N × множитель). Одиночное, удвоение и утроение N в одном подходе —
 *   «Шанхай», мгновенная победа. После последнего раунда — больше очков.
 * - «Убийца»: у каждого своё число (по жребию). Попал в удвоение своего — стал «убийцей»; убийца удвоением чужого числа
 *   снимает жизнь, своего — теряет свою. Остался один — победил.
 * Страховка от бесконечной партии — предел раундов (у x01 — на лег): кончились — решает счёт. */
import type { Options, Rng } from '../../core/types';
import { hitAt, isDouble, label, MISS, value, type Hit } from './board';
import { clampThrow, land, type Landing, type Outcome, type Stuck, type Throw } from './physics';

export type Mode = 'x01' | 'clock' | 'cricket' | 'shanghai' | 'killer';

export interface Cfg {
  mode: Mode;
  start: number;
  din: boolean;
  dout: boolean;
  legs: number;
  skip: boolean;
  bull: boolean;
  cut: boolean;
  rounds: number;
  lives: number;
  /** Предел раундов. */
  max: number;
}

export const CRICKET = [20, 19, 18, 17, 16, 15, 25];

export interface PState {
  /** x01 — остаток, крикет и шанхай — очки. */
  score: number;
  /** x01 с double in: счёт открыт. */
  opened: boolean;
  legs: number;
  /** «Вокруг света»: нужный сектор (1…20, 25 — бык, 26 — круг пройден). */
  target: number;
  /** Крикет: метки по CRICKET. */
  marks: number[];
  /** «Убийца»: своё число, жизни, убийца ли, выбыл ли. */
  num: number;
  lives: number;
  killer: boolean;
  out: boolean;
  /** Дротиков брошено за партию / в текущем леге. */
  darts: number;
  legDarts: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Номер в seats того, кто бросает. */
  cur: number;
  /** Какой дротик подхода: 0, 1, 2. */
  dart: number;
  /** Счёт на начало подхода (x01: вернуть при переборе). */
  turnStart: number;
  /** Попадания текущего подхода. */
  hits: Hit[];
  /** Дротики в мишени. */
  stuck: Stuck[];
  /** Раунд (с 1); у шанхая — номер сектора. */
  round: number;
  /** Кто начинал лег (номер в seats). */
  starter: number;
  leg: number;
  p: PState[];
  over: boolean;
  winners: number[];
  /** Только превью карточки. */
  shot?: boolean;
}

export type Action = { type: 'throw' } & Throw;

export type Event =
  | {
      k: 'throw';
      seat: number;
      t: Throw;
      /** Номер дротика в подходе. */
      dart: number;
      land: Landing;
      hit: Hit;
      /** Сколько очков (x01 — отнято, крикет/шанхай — прибавлено), если важно. */
      pts: number;
      /** Короткая подпись броска для табло: «T20», «D16 — закрыл!», «мимо». */
      note: string;
      stuck: Stuck | null;
    }
  | { k: 'bust'; seat: number; back: number; why: string }
  | { k: 'open'; seat: number }
  | { k: 'close'; seat: number; n: number }
  | { k: 'killer'; seat: number }
  | { k: 'life'; seat: number; victim: number; lives: number }
  | { k: 'dead'; seat: number }
  | { k: 'shanghai'; seat: number; n: number }
  | { k: 'leg'; seat: number; legs: number; darts: number }
  | { k: 'turn'; seat: number; round: number; total: number; text: string }
  | { k: 'end'; winners: number[] };

const opt = <T,>(o: Options, k: string, d: T): T => (o[k] === undefined ? d : (o[k] as unknown as T));

export function cfgFrom(o: Options): Cfg {
  const mode = (['x01', 'clock', 'cricket', 'shanghai', 'killer'].includes(String(o.mode)) ? String(o.mode) : 'x01') as Mode;
  const start = [301, 501, 701].includes(Number(o.start)) ? Number(o.start) : 501;
  const rounds = Number(o.rounds) === 20 ? 20 : 7;
  return {
    mode,
    start,
    din: !!opt(o, 'din', false),
    dout: !!opt(o, 'dout', true),
    legs: Math.max(1, Math.min(3, Number(opt(o, 'legs', 1)) || 1)),
    skip: !!opt(o, 'skip', false),
    bull: !!opt(o, 'bull', true),
    cut: !!opt(o, 'cut', false),
    rounds,
    lives: Number(o.lives) === 5 ? 5 : 3,
    max: mode === 'x01' ? (start >= 701 ? 30 : start >= 501 ? 20 : 15) : mode === 'clock' ? 30 : mode === 'cricket' ? 25 : mode === 'killer' ? 30 : rounds,
  };
}

function fresh(cfg: Cfg): PState {
  return {
    score: cfg.mode === 'x01' ? cfg.start : 0,
    opened: !(cfg.mode === 'x01' && cfg.din),
    legs: 0,
    target: 1,
    marks: CRICKET.map(() => 0),
    num: 0,
    lives: cfg.lives,
    killer: false,
    out: false,
    darts: 0,
    legDarts: 0,
  };
}

export function newState(cfg: Cfg, seats: number[]): State {
  const p = seats.map(() => fresh(cfg));
  return { cfg, seats, cur: 0, dart: 0, turnStart: p[0].score, hits: [], stuck: [], round: 1, starter: 0, leg: 1, p, over: false, winners: [] };
}

export function setup(o: Options, seats: number[], rng: Rng): State {
  const s = newState(cfgFrom(o), seats);
  if (s.cfg.mode === 'killer') {
    // своё число каждому — по жребию, без повторов
    const pool = Array.from({ length: 20 }, (_, i) => i + 1);
    for (const p of s.p) p.num = pool.splice(rng.int(pool.length), 1)[0];
  }
  return s;
}

export function toAct(s: State): number[] {
  return s.over ? [] : [s.seats[s.cur]];
}

const clone = (s: State): State => ({
  ...s,
  hits: [...s.hits],
  stuck: s.stuck.map((d) => ({ ...d })),
  p: s.p.map((p) => ({ ...p, marks: [...p.marks] })),
  winners: [...s.winners],
});

/** Нужный сектор «Вокруг света» подписью. */
export const targetName = (t: number) => (t === 25 ? 'бык' : t > 25 ? '—' : String(t));

/** Метки крикета подписью. */
export const markSym = (n: number) => (n <= 0 ? '' : n === 1 ? '/' : n === 2 ? '✕' : 'ⓧ');

function alive(s: State): number[] {
  return s.p.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
}

/** Применить бросок. */
export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !a || a.type !== 'throw') return null;
  const i = s0.seats.indexOf(seat);
  if (i < 0 || i !== s0.cur) return null;
  const s = clone(s0);
  const t = clampThrow(a);
  const L = land(t, s.stuck, (n) => rng.int(n));
  const hit = L.res === 'stick' && L.x != null && L.y != null ? hitAt(L.x, L.y) : MISS;
  const st: Stuck | null = L.res === 'stick' && L.x != null && L.y != null ? { x: L.x, y: L.y, inc: L.inc, lat: L.lat, seat } : null;
  if (st) s.stuck.push(st);
  const p = s.p[i];
  p.darts++;
  p.legDarts++;
  s.hits.push(hit);
  const events: Event[] = [];
  const ev: Extract<Event, { k: 'throw' }> = { k: 'throw', seat, t, dart: s.dart, land: L, hit, pts: 0, note: noteOf(L.res, hit), stuck: st };
  events.push(ev);
  let endTurn = false;

  const c = s.cfg;
  if (c.mode === 'x01') {
    let v = value(hit);
    if (!p.opened) {
      if (isDouble(hit)) {
        p.opened = true;
        events.push({ k: 'open', seat });
      } else v = 0;
    }
    const rem = p.score - v;
    const bust = rem < 0 || (c.dout && rem === 1) || (rem === 0 && c.dout && !isDouble(hit));
    if (bust) {
      const why = rem < 0 ? 'больше, чем осталось' : rem === 1 ? 'осталась единица — её удвоением не закрыть' : 'закрывать надо удвоением';
      ev.note = `${label(hit)} — перебор`;
      p.score = s.turnStart;
      events.push({ k: 'bust', seat, back: s.turnStart, why });
      endTurn = true;
    } else {
      ev.pts = v;
      p.score = rem;
      if (rem === 0) {
        p.legs++;
        events.push({ k: 'leg', seat, legs: p.legs, darts: p.legDarts });
        if (p.legs >= c.legs) return finish(s, [seat], events);
        newLeg(s, events);
        return { state: s, events };
      }
    }
  } else if (c.mode === 'clock') {
    if (hit.n && hit.n === p.target) {
      const step = c.skip && p.target !== 25 ? hit.m : 1;
      let nt = p.target === 25 ? 26 : p.target + step;
      if (nt > 20 && p.target !== 25) nt = c.bull ? 25 : 26;
      p.target = nt;
      ev.note = `${label(hit)} — ${nt > 25 ? 'круг пройден!' : `дальше ${targetName(nt)}`}`;
      if (nt > 25) return finish(s, [seat], events);
    }
  } else if (c.mode === 'cricket') {
    const k = CRICKET.indexOf(hit.n);
    if (k >= 0) {
      let marks = hit.m;
      let pts = 0;
      while (marks > 0) {
        marks--;
        if (p.marks[k] < 3) {
          p.marks[k]++;
          if (p.marks[k] === 3) events.push({ k: 'close', seat, n: hit.n });
        } else {
          const open = s.p.filter((q, j) => j !== i && q.marks[k] < 3);
          if (!open.length) continue;
          if (c.cut) for (const q of open) q.score += hit.n;
          else p.score += hit.n;
          pts += hit.n;
        }
      }
      ev.pts = pts;
      if (pts) ev.note = `${label(hit)} — ${c.cut ? `соперникам +${pts}` : `+${pts}`}`;
      const w = cricketWinner(s);
      if (w != null) return finish(s, [s.seats[w]], events);
    }
  } else if (c.mode === 'shanghai') {
    if (hit.n === s.round) {
      p.score += value(hit);
      ev.pts = value(hit);
      const ms = new Set(s.hits.filter((h) => h.n === s.round).map((h) => h.m));
      if (ms.has(1) && ms.has(2) && ms.has(3)) {
        events.push({ k: 'shanghai', seat, n: s.round });
        return finish(s, [seat], events);
      }
    }
  } else if (c.mode === 'killer') {
    if (isDouble(hit) && hit.n !== 25) {
      if (!p.killer && hit.n === p.num) {
        p.killer = true;
        ev.note = `D${hit.n} — теперь убийца!`;
        events.push({ k: 'killer', seat });
      } else if (p.killer) {
        const j = s.p.findIndex((q) => !q.out && q.num === hit.n);
        if (j >= 0) {
          const q = s.p[j];
          q.lives--;
          events.push({ k: 'life', seat, victim: s.seats[j], lives: q.lives });
          if (q.lives <= 0) {
            q.out = true;
            events.push({ k: 'dead', seat: s.seats[j] });
          }
          const al = alive(s);
          if (al.length <= 1) return finish(s, al.map((x) => s.seats[x]), events);
          if (p.out) endTurn = true;
        }
      }
    }
  }

  s.dart++;
  if (s.dart >= 3) endTurn = true;
  if (endTurn) nextTurn(s, events);
  return { state: s, events };
}

function noteOf(res: Outcome, hit: Hit): string {
  if (res === 'wire') return 'отскок от проволоки';
  if (res === 'dart') return 'в свой дротик — отскок';
  if (res === 'off') return 'мимо мишени';
  if (res === 'weak') return 'не долетел';
  return label(hit);
}

function cricketWinner(s: State): number | null {
  for (let i = 0; i < s.p.length; i++) {
    const p = s.p[i];
    if (p.marks.some((m) => m < 3)) continue;
    const others = s.p.filter((_, j) => j !== i).map((q) => q.score);
    if (!others.length) return i;
    if (s.cfg.cut ? p.score <= Math.min(...others) : p.score >= Math.max(...others)) return i;
  }
  return null;
}

function finish(s: State, winners: number[], events: Event[]): { state: State; events: Event[] } {
  s.over = true;
  s.winners = winners;
  events.push({ k: 'end', winners });
  return { state: s, events };
}

function turnText(s: State, i: number): string {
  const sum = s.hits.reduce((a, h) => a + value(h), 0);
  if (s.cfg.mode === 'x01') return `${sum} за подход, осталось ${s.p[i].score}`;
  if (s.cfg.mode === 'clock') return `нужен ${targetName(s.p[i].target)}`;
  return `очков: ${s.p[i].score}`;
}

/** Следующий подход: дротики вынуть, ход дальше (выбывших в «Убийце» пропускаем), раунды и их предел. */
function nextTurn(s: State, events: Event[]) {
  const n = s.p.length;
  const prev = s.cur;
  const total = s.hits.reduce((a, h) => a + value(h), 0);
  const text = turnText(s, prev);
  let k = s.cur;
  for (let step = 0; step < n; step++) {
    k = (k + 1) % n;
    if (!s.p[k].out) break;
  }
  // раунд кончился, когда очередь снова дошла до начинавшего (или перешагнула его)
  let wrapped = false;
  const dist = (k - prev + n) % n || n;
  for (let j = 1; j <= dist; j++) if ((prev + j) % n === s.starter) wrapped = true;
  s.cur = k;
  s.dart = 0;
  s.hits = [];
  s.stuck = [];
  if (wrapped) s.round++;
  s.turnStart = s.p[k].score;
  events.push({ k: 'turn', seat: s.seats[k], round: s.round, total, text });
  if (wrapped && s.round > s.cfg.max) byScore(s, events);
}

/** Раунды кончились: решает счёт. */
function byScore(s: State, events: Event[]) {
  const c = s.cfg;
  const idx = s.p.map((_, i) => i);
  let key: (i: number) => number;
  if (c.mode === 'x01') key = (i) => -s.p[i].score;
  else if (c.mode === 'clock') key = (i) => s.p[i].target;
  else if (c.mode === 'cricket') key = (i) => (c.cut ? -s.p[i].score : s.p[i].score) * 100 + s.p[i].marks.reduce((a, m) => a + m, 0);
  else if (c.mode === 'killer') key = (i) => (s.p[i].out ? -1 : s.p[i].lives * 10 + (s.p[i].killer ? 1 : 0));
  else key = (i) => s.p[i].score;
  if (c.mode === 'x01') {
    // лег закончился по пределу: выигрывает меньший остаток
    const best = Math.max(...idx.map(key));
    const w = idx.filter((i) => key(i) === best);
    const wi = w[0];
    s.p[wi].legs++;
    events.push({ k: 'leg', seat: s.seats[wi], legs: s.p[wi].legs, darts: s.p[wi].legDarts });
    if (s.p[wi].legs >= c.legs) {
      finish(s, [s.seats[wi]], events);
      return;
    }
    newLeg(s, events);
    return;
  }
  const best = Math.max(...idx.map(key));
  finish(
    s,
    idx.filter((i) => key(i) === best).map((i) => s.seats[i]),
    events
  );
}

function newLeg(s: State, events: Event[]) {
  s.leg++;
  s.starter = (s.starter + 1) % s.p.length;
  for (const p of s.p) {
    p.score = s.cfg.start;
    p.opened = !s.cfg.din;
    p.legDarts = 0;
  }
  s.cur = s.starter;
  s.dart = 0;
  s.hits = [];
  s.stuck = [];
  s.round = 1;
  s.turnStart = s.p[s.cur].score;
  events.push({ k: 'turn', seat: s.seats[s.cur], round: 1, total: 0, text: `лег ${s.leg}` });
}

export const modeName = (c: Cfg): string =>
  c.mode === 'x01'
    ? `${c.start}${c.din ? ', double in' : ''}${c.dout ? ', double out' : ''}`
    : c.mode === 'clock'
      ? 'Вокруг света'
      : c.mode === 'cricket'
        ? c.cut
          ? 'Крикет «головорез»'
          : 'Крикет'
        : c.mode === 'shanghai'
          ? 'Шанхай'
          : 'Убийца';
