/* Кто я?: загадывание соседу, тайна своего персонажа, большинство ответов, «да» — ход остаётся, догадка, свои персонажи только без ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botSeats, simulate } from './harness';
import { def } from '../src/games/whoami/def';
import { CHARS, QUESTIONS } from '../src/games/whoami/chars';
import { apply, makeView, redact, setup, toAct, type Action, type State } from '../src/games/whoami/engine';

const rng = () => new SeededRng(5);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!.state;
};
const ids = ['gagarin', 'cheburashka_char', 'shrek_char', 'pushkin'];
function picked(humans: number[] = []): State {
  let s = setup([0, 1, 2, 3], { pool: 'all' }, rng(), humans);
  // место i загадывает для i+1: для места j — ids[j]
  for (const x of [0, 1, 2, 3]) s = go(s, x, { type: 'pick', id: ids[(x + 1) % 4] });
  return s;
}

describe('кто я', () => {
  it('у всех вопросов на каждого персонажа есть ответ', () => {
    for (const c of CHARS) for (const q of QUESTIONS) expect(['y', 'n', '?']).toContain(q.test(c));
    expect(CHARS.length).toBeGreaterThanOrEqual(100);
  });

  it('загадывает сосед; свой персонаж не виден ни в view, ни в событии', () => {
    let s = setup([0, 1, 2, 3], { pool: 'all' }, rng());
    expect(toAct(s)).toEqual([0, 1, 2, 3]);
    const r = apply(s, 0, { type: 'pick', id: 'gagarin' }, rng())!;
    expect(r.state.chars[1].id).toBe('gagarin');
    expect(redact(r.events[0], [1])).toMatchObject({ who: null });
    expect(redact(r.events[0], [2])).toMatchObject({ who: { id: 'gagarin' } });
    s = picked();
    expect(s.phase).toBe('ask');
    const v = makeView(s, [1]);
    expect(v.chars[1]).toBeUndefined();
    expect(v.chars[2].id).toBe('shrek_char');
    // тот же персонаж второй раз — нельзя
    expect(apply(setup([0, 1, 2], {}, rng()), 0, { type: 'pick', id: 'x' }, rng())).toBeNull();
  });

  it('с ботами — только из списка и только готовые вопросы', () => {
    const s = setup([0, 1, 2], {}, rng(), [0]);
    expect(apply(s, 0, { type: 'pick', name: 'Мой сосед Петя' }, rng())).toBeNull();
    const h = setup([0, 1, 2], {}, rng(), [0, 1, 2]);
    expect(apply(h, 0, { type: 'pick', name: 'Мой сосед Петя' }, rng())).not.toBeNull();
    const p = picked([0]);
    expect(apply(p, 0, { type: 'ask', text: 'Я высокий?' }, rng())).toBeNull();
  });

  it('большинство «да» — спрашивает дальше, «нет» — ход переходит', () => {
    let s = picked();
    expect(s.turn).toBe(0);
    s = go(s, 0, { type: 'ask', q: 0 });
    s = go(s, 1, { type: 'answer', ans: 'y' });
    s = go(s, 2, { type: 'answer', ans: 'y' });
    s = go(s, 3, { type: 'answer', ans: 'n' });
    expect(s.log[0].result).toBe('y');
    expect(s.turn).toBe(0);
    s = go(s, 0, { type: 'ask', q: 11 });
    for (const x of [1, 2, 3]) s = go(s, x, { type: 'answer', ans: 'n' });
    expect(s.turn).toBe(1);
  });

  it('догадка: угадал — место, не угадал — ход дальше; до последнего', () => {
    let s = picked();
    // место 0: ids[0] = Гагарин
    s = go(s, 0, { type: 'guess', id: 'pushkin' });
    expect(s.turn).toBe(1);
    s = go(s, 1, { type: 'guess', id: 'cheburashka_char' });
    expect(s.done).toEqual([1]);
    s = go(s, 2, { type: 'guess', id: 'shrek_char' });
    s = go(s, 3, { type: 'guess', id: 'pushkin' });
    expect(s.phase).toBe('over');
    expect(def.result(s)?.winners).toEqual([1]);
  });

  it('свой персонаж угадывается текстом без регистра и ё', () => {
    let s = setup([0, 1, 2], {}, rng(), [0, 1, 2]);
    s = go(s, 2, { type: 'pick', name: 'Дядя Фёдор' });
    s = go(s, 0, { type: 'pick', name: 'Почтальон Печкин' });
    s = go(s, 1, { type: 'pick', name: 'Галчонок' });
    s = go(s, 0, { type: 'guess', name: 'дядя федор' });
    expect(s.done).toEqual([0]);
  });

  it('боты доигрывают на каждом уровне и в каждой подборке, загадывают и случайно', async () => {
    for (const pool of ['all', 'real', 'fiction', 'ours'])
      for (const lv of [0, 1, 2]) {
        const r = await simulate(def, botSeats(def, 5, [lv]), { pool, pick: lv === 1 ? 'random' : 'neighbor', goal: 'all' }, 11 + lv);
        expect(r.error, `${pool} ${lv}`).toBeUndefined();
        expect(r.finished, `${pool} ${lv}`).toBe(true);
      }
  });
});
