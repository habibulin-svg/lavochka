/* Кто я? — боты. Отвечают про чужих по данным; про себя ведут список кандидатов: вычёркивают несовпавших по ответам, неудачные догадки
 * и (средний, сложный) тех, кого видят на лбу у других. Лёгкий спрашивает наугад и называет себя рано; сложный выбирает вопрос,
 * который делит кандидатов пополам, и называет, когда остался один. */
import type { Rng } from '../../core/types';
import type { Action, View } from './engine';
import { truth } from './engine';
import { poolOf, QUESTIONS, type Char } from './chars';

const pick = <T>(a: T[], rng: Rng): T => a[rng.int(a.length)];

export function candidates(v: View, me: number, level: number): Char[] {
  // кого вижу на лбу у других — это не я (кроме того, кого загадал соседу сам: со мной он мог совпасть)
  const mine = v.pickFor[me];
  const seen = new Set(Object.entries(v.chars).filter(([x]) => +x !== me && +x !== mine).map(([, w]) => w.id));
  const wrong = new Set(v.log.filter((l) => l.seat === me && l.guess && !l.right).map((l) => l.guess));
  return poolOf(v.pool).filter((c) => {
    if (wrong.has(c.name)) return false;
    if (level >= 1 && seen.has(c.id)) return false;
    for (const l of v.log) {
      if (l.seat !== me || l.q == null || !l.result || l.result === '?') continue;
      const t = QUESTIONS[l.q].test(c);
      if (t !== '?' && t !== l.result) return false;
    }
    return true;
  });
}

export function choose(v: View, me: number, level: number, rng: Rng): Action | null {
  switch (v.phase) {
    case 'pick': {
      const used = new Set(Object.values(v.chars).map((w) => w.id));
      const free = poolOf(v.pool).filter((c) => !used.has(c.id));
      return { type: 'pick', id: pick(free, rng).id };
    }
    case 'answer':
      // про спрашивающего бот знает правду (если персонаж из списка); на свой вопрос людей — «не знаю»
      {
        const q = v.log[v.log.length - 1];
        if (q.q == null) return { type: 'answer', ans: '?' };
        const t = truth(v, v.turn, q.q);
        // лёгкий иногда путается
        if (level === 0 && t !== '?' && rng.next() < 0.08) return { type: 'answer', ans: t === 'y' ? 'n' : 'y' };
        return { type: 'answer', ans: t };
      }
    case 'ask': {
      if (v.turn !== me) return null;
      const cands = candidates(v, me, level);
      if (!cands.length) {
        // ответы противоречат друг другу (кто-то ошибся) — перебираем ещё не названных
        const wrong = new Set(v.log.filter((l) => l.seat === me && l.guess).map((l) => l.guess));
        const rest = poolOf(v.pool).filter((c) => !wrong.has(c.name));
        return { type: 'guess', id: pick(rest.length ? rest : poolOf(v.pool), rng).id };
      }
      const asked = new Set(v.log.filter((l) => l.seat === me && l.q != null).map((l) => l.q!));
      // сколько кандидатов отсекает вопрос: лучше всего — пополам
      const split = (q: number) => {
        const y = cands.filter((c) => QUESTIONS[q].test(c) === 'y').length;
        const n = cands.filter((c) => QUESTIONS[q].test(c) === 'n').length;
        return Math.min(y, n);
      };
      const useful = QUESTIONS.map((_, i) => i).filter((i) => !asked.has(i) && split(i) > 0);
      const sure = cands.length === 1 || !useful.length;
      if (sure || (level === 0 && cands.length <= 4 && rng.next() < 0.4) || (level === 1 && cands.length <= 2 && rng.next() < 0.5)) {
        return { type: 'guess', id: pick(cands, rng).id };
      }
      if (level >= 2) {
        const best = Math.max(...useful.map(split));
        return { type: 'ask', q: pick(useful.filter((i) => split(i) === best), rng) };
      }
      if (level === 1) return { type: 'ask', q: pick(useful, rng) };
      const fresh = QUESTIONS.map((_, i) => i).filter((i) => !asked.has(i));
      return { type: 'ask', q: pick(fresh.length ? fresh : useful, rng) };
    }
  }
  return null;
}
