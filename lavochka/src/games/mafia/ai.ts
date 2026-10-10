/* Мафия — боты. Видят свою роль, своих (если мафия), свои проверки и всё открытое: кто кого выставлял, кто за кого голосовал,
 * кто чем назвался, открытые роли ушедших. Пишут в чат по шаблонам.
 *   Лёгкий — подозревает почти наугад, комиссаром не «вскрывается»;
 *   Средний — подозревает тех, кто голосовал против мирных и защищал выбывших мафиози; комиссар открывается, найдя мафию;
 *   Сложный — ещё и проверяет заявления: «комиссар», чей «мирный» оказался мафией, теряет доверие; мафия бьёт по заявившемуся комиссару. */
import type { Rng } from '../../core/types';
import { isMafia, type Action, type State } from './engine';

/** Метка имени в реплике: журнал заменит её на имя игрока. */
const NAMES_IN_TEXT = (_s: State, seat: number) => `{@${seat}}`;

const pick = <T>(a: T[], rng: Rng): T => a[rng.int(a.length)];

/** Подозрительность каждого живого с точки зрения seat (больше — подозрительнее). */
function suspicion(s: State, seat: number, level: number, rng: Rng): Map<number, number> {
  const sc = new Map<number, number>();
  for (const x of s.alive) sc.set(x, rng.next() * (level === 0 ? 4 : 1));
  const add = (x: number, v: number) => sc.has(x) && sc.set(x, sc.get(x)! + v);
  // ушедшие с открытой ролью: кто голосовал против мирного — подозрителен, против мафии — молодец
  for (const d of s.history) {
    if (d.out == null) continue;
    const role = s.shown[d.out];
    if (!role) continue;
    const bad = !isMafia(role);
    for (const [v, t] of d.votes) if (t === d.out) add(v, bad ? 1.5 : -1);
    for (const [by, t] of d.nominations) if (t === d.out) add(by, bad ? 1 : -1.2);
  }
  // заявления комиссара
  for (const [c, list] of Object.entries(s.claims)) {
    const claimant = +c;
    let liar = false;
    for (const cl of list) {
      const real = s.shown[cl.target];
      if (real && isMafia(real) !== cl.mafia) liar = true;
    }
    if (level === 2 && liar) add(claimant, 4);
    else for (const cl of list) add(cl.target, cl.mafia ? (level >= 1 ? 3 : 1) : -1.5);
  }
  // свои проверки (комиссар)
  for (const ch of s.checks[seat] ?? []) if (s.roles[seat] === 'sheriff') add(ch.target, ch.result ? 10 : -10);
  sc.delete(seat);
  return sc;
}

const mostSuspicious = (sc: Map<number, number>, among?: number[]) => {
  let best = -1;
  let v = -Infinity;
  for (const [k, x] of sc) if ((!among || among.includes(k)) && x > v) [best, v] = [k, x];
  return best;
};

const CIV_TALK = [
  'Я мирный. Мне не нравится {n}.',
  'Город, присмотритесь к {n} — слишком тихо сидит.',
  'Ничего не знаю, но {n} вызывает вопросы.',
  'Я за город. Давайте проверим {n}.',
  'Честно, сложно. Пока подозреваю {n}.',
];
const QUIET = ['Пока сказать нечего, я мирный.', 'Пас, послушаю других.', 'Я мирный житель, всем удачи.'];

/** В кого стреляет мафиози: туда же, куда свои; сложный — по заявившемуся комиссару; средний — по самому «доверенному». */
function mafiaShot(s: State, seat: number, level: number, rng: Rng, victims: number[], sc: Map<number, number>): number {
  const mate = s.alive.find((x) => isMafia(s.roles[x]) && x !== seat && s.night[x] != null);
  if (mate != null && level > 0) return s.night[mate];
  const claimed = victims.filter((x) => s.claims[x]?.length);
  if (level === 2 && claimed.length) return claimed[0];
  if (level >= 1) {
    const trusted = victims.slice().sort((a, b) => (sc.get(a) ?? 0) - (sc.get(b) ?? 0));
    return trusted[0] ?? pick(victims, rng);
  }
  return pick(victims, rng);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  const role = s.roles[seat];
  const others = s.alive.filter((x) => x !== seat);
  if (s.phase === 'night') {
    if (s.meet) return { type: 'night', target: seat };
    const sc = suspicion(s, seat, level, rng);
    if (isMafia(role)) {
      const victims = others.filter((x) => !isMafia(s.roles[x]));
      const shot = mafiaShot(s, seat, level, rng, victims, sc);
      if (role === 'don' && s.cfg.variant === 'sport') {
        // дон ещё и ищет комиссара — среди непроверенных
        const checked = new Set((s.checks[seat] ?? []).map((c) => c.target));
        const pool = victims.filter((x) => !checked.has(x));
        return { type: 'night', target: shot, check: pool.length ? (level === 0 ? pick(pool, rng) : mostSuspicious(sc, pool)) : pick(victims, rng) };
      }
      return { type: 'night', target: shot };
    }
    if (role === 'sheriff') {
      const checked = new Set((s.checks[seat] ?? []).map((c) => c.target));
      const pool = others.filter((x) => !checked.has(x));
      const list = pool.length ? pool : others;
      return { type: 'night', target: level === 0 ? pick(list, rng) : mostSuspicious(sc, list) };
    }
    if (role === 'doctor') {
      const claimed = s.alive.filter((x) => s.claims[x]?.length && x !== seat);
      if (level >= 1 && claimed.length) return { type: 'night', target: claimed[0] };
      if (s.lastHeal !== seat && rng.next() < 0.4) return { type: 'night', target: seat };
      return { type: 'night', target: pick(others, rng) };
    }
    if (role === 'putana') return { type: 'night', target: pick(others, rng) };
    // мирный — «подозреваю»
    return { type: 'night', target: mostSuspicious(sc) >= 0 ? mostSuspicious(sc) : pick(others, rng) };
  }
  if (s.phase === 'day') {
    const sc = suspicion(s, seat, level, rng);
    const free = (x: number) => s.alive.includes(x) && !s.nominees.includes(x) && x !== seat;
    // комиссар нашёл мафию — открывается
    if (role === 'sheriff' && level >= 1) {
      const found = (s.checks[seat] ?? []).filter((c) => c.result && s.alive.includes(c.target));
      if (found.length) {
        const t = found[found.length - 1].target;
        return { type: 'speak', text: `Я комиссар! ${NAMES_IN_TEXT(s, t)} — мафия, проверено.`, claim: { target: t, mafia: true }, nominate: free(t) ? t : undefined };
      }
    }
    if (isMafia(role)) {
      // мафия выставляет мирного — по возможности того, кто на неё «катит»
      const civs = s.alive.filter((x) => !isMafia(s.roles[x]) && free(x));
      const onUs = civs.filter((x) => (s.claims[x] ?? []).some((c) => isMafia(s.roles[c.target])));
      const t = level === 2 && onUs.length ? onUs[0] : civs.length && rng.next() < 0.6 ? pick(civs, rng) : undefined;
      // сложный дон может «вскрыться» лже-комиссаром
      if (level === 2 && t != null && rng.next() < 0.15) return { type: 'speak', text: `Я комиссар. ${NAMES_IN_TEXT(s, t)} — мафия!`, claim: { target: t, mafia: true }, nominate: t };
      return t != null ? { type: 'speak', text: pick(CIV_TALK, rng).replace('{n}', NAMES_IN_TEXT(s, t)), nominate: t } : { type: 'speak', text: pick(QUIET, rng) };
    }
    const cand = [...sc.keys()].filter(free);
    const t = cand.length ? mostSuspicious(sc, cand) : -1;
    const want = level === 0 ? rng.next() < 0.5 : (sc.get(t) ?? 0) > 1.2 || rng.next() < 0.35;
    if (t >= 0 && want) return { type: 'speak', text: pick(CIV_TALK, rng).replace('{n}', NAMES_IN_TEXT(s, t)), nominate: t };
    return { type: 'speak', text: pick(QUIET, rng) };
  }
  // голосование
  const noms = s.nominees.filter((x) => x !== seat);
  const pool = noms.length ? noms : s.nominees;
  if (isMafia(role)) {
    const civ = pool.filter((x) => !isMafia(s.roles[x]));
    return { type: 'vote', target: civ.length ? (level === 0 ? pick(civ, rng) : civ[0]) : pick(pool, rng) };
  }
  const sc = suspicion(s, seat, level, rng);
  return { type: 'vote', target: level === 0 && rng.next() < 0.4 ? pick(pool, rng) : mostSuspicious(sc, pool) >= 0 ? mostSuspicious(sc, pool) : pick(pool, rng) };
}
