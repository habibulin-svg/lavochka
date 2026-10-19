/* Детективы: ключ дел цел, очки (наводки, ошибки, срок), «кто быстрее» (выбыл — ждёт, все выбыли — дело закрыто),
 * бригада (общие очки), свободный ответ с самооценкой, разгадка не уходит игроку до закрытия дела. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SeededRng } from '../src/core/rng';
import { apply, cfgOf, keyOf, KEYS, newState, result, SHARED, toAct, view, type Action, type State } from '../src/games/detektiv/engine';

const rng = () => new SeededRng(5);
const go = (s: State, seat: number, a: Action, now = 1000) => {
  const r = apply(s, seat, a, rng(), now);
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!.state;
};
function at(opts: Record<string, unknown>, seats = [0]): State {
  return newState(cfgOf({ count: 3, lvl: 0, ...opts }), seats, rng(), 0);
}

describe('детективы', () => {
  it('ключ: у каждого дела книга, сложность, верная версия, две наводки и разгадка; тексты есть в public', () => {
    expect(KEYS.length).toBeGreaterThan(100);
    const books = new Map<string, Record<string, { options: string[]; text: string; question: string }>>();
    for (const k of KEYS) {
      expect([1, 2, 3]).toContain(k.lv);
      expect(k.ok).toBeGreaterThanOrEqual(0);
      expect(k.ok).toBeLessThan(4);
      expect(k.hints.length).toBe(2);
      expect(k.short.length).toBeGreaterThan(5);
      if (!books.has(k.book)) {
        const f = `public/detektiv/cases/${k.book}.json`;
        expect(existsSync(f), f).toBe(true);
        books.set(k.book, JSON.parse(readFileSync(f, 'utf8')));
      }
      const c = books.get(k.book)![String(k.id)];
      expect(c, `${k.book}/${k.id}`).toBeTruthy();
      expect(c.options.length).toBe(4);
      expect(c.text.length + c.question.length).toBeGreaterThan(20);
    }
  });

  it('сыщик: неверная версия −2, наводка −1, в срок +1; разгадка видна только после закрытия', () => {
    let s = at({ mode: 'solo' });
    const k = keyOf(s.list[0]);
    expect(view(s, [0]).boards[0].cur!.sol).toBeUndefined();
    s = go(s, 0, { t: 'hint' });
    expect(view(s, [0]).boards[0].cur!.hints).toEqual([k.hints[0]]);
    s = go(s, 0, { t: 'pick', k: (k.ok + 1) % 4 });
    expect(apply(s, 0, { t: 'pick', k: (k.ok + 1) % 4 }, rng(), 1000)).toBeNull(); // зачёркнутую второй раз не выбрать
    s = go(s, 0, { t: 'pick', k: k.ok }, 5000);
    const base = { 1: 3, 2: 4, 3: 5 }[k.lv];
    expect(s.scores[0]).toBe(Math.max(1, base - 1 - 2) + 1);
    expect(view(s, [0]).boards[0].cur!.sol!.ok).toBe(k.ok);
  });

  it('три неверные версии — дело закрыто без очков', () => {
    let s = at({ mode: 'solo' });
    const k = keyOf(s.list[0]);
    for (const n of [0, 1, 2, 3].filter((x) => x !== k.ok)) s = go(s, 0, { t: 'pick', k: n });
    expect(s.boards[0].phase).toBe('done');
    expect(s.scores[0]).toBe(0);
  });

  it('кто быстрее: ошибся — выбыл; верно ответил другой — очки ему; «дальше» ждёт всех', () => {
    let s = at({ mode: 'race' }, [0, 1]);
    const k = keyOf(s.list[0]);
    s = go(s, 0, { t: 'pick', k: (k.ok + 1) % 4 });
    expect(toAct(s)).toEqual([1]);
    expect(apply(s, 0, { t: 'pick', k: k.ok }, rng(), 1000)).toBeNull();
    s = go(s, 1, { t: 'pick', k: k.ok });
    expect(s.scores[1]).toBeGreaterThan(0);
    expect(s.scores[0]).toBe(0);
    s = go(s, 0, { t: 'next' });
    expect(s.boards[SHARED].i).toBe(0);
    s = go(s, 1, { t: 'next' });
    expect(s.boards[SHARED].i).toBe(1);
    expect(s.boards[SHARED].out).toEqual([]);
  });

  it('кто быстрее: все выбыли — дело закрыто без очков', () => {
    let s = at({ mode: 'race' }, [0, 1]);
    const k = keyOf(s.list[0]);
    s = go(s, 0, { t: 'pick', k: (k.ok + 1) % 4 });
    s = go(s, 1, { t: 'skip' });
    expect(s.boards[SHARED].phase).toBe('done');
  });

  it('бригада: отвечает любой, очки общие; свободный ответ и самооценка «частично» — половина', () => {
    let s = at({ mode: 'team', answer: 'free', count: 1 }, [0, 1]);
    s = go(s, 1, { t: 'free', text: 'это он' });
    expect(view(s, [0]).boards[SHARED].cur!.sol).toBeTruthy();
    s = go(s, 0, { t: 'self', v: 1 }, 1000);
    expect(s.scores[0]).toBe(s.scores[1]);
    expect(s.scores[0]).toBeGreaterThan(0);
    s = go(s, 0, { t: 'next' });
    const r = result(s)!;
    expect(r.winners).toEqual([0, 1]);
  });
});
