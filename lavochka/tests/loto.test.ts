/* Лото: карточки 3×9, режим «каждый бочонок» (мешок ждёт ответа человека, «нет» при своём числе — прозевано),
 * «как за столом» (закрывать вне очереди), призы; «Вокруг света» обоих изданий. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { SeatSpec } from '../src/core/types';
import { apply, cardNums, free, lastCalled, makeCard, openWith, setup, toAct, type Action, type State } from '../src/games/loto/engine';
import { EDITIONS } from '../src/games/loto/world-data';

const seats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Я', level: 0 },
  { seat: 1, kind: 'bot', name: 'Бот', level: 2 },
];
const rng = new SeededRng(3);
const act = (s: State, seat: number, a: Action) => apply(s, seat, a, rng)?.state ?? null;

describe('Лото: карточки', () => {
  it('3 ряда по 5 чисел, столбцы по десяткам, в каждом столбце есть число', () => {
    for (let k = 0; k < 200; k++) {
      const c = makeCard(new SeededRng(k), 0);
      expect(c.rows.map((r) => r.filter((n) => n).length)).toEqual([5, 5, 5]);
      for (let col = 0; col < 9; col++) {
        const nums = c.rows.map((r) => r[col]).filter((n) => n);
        expect(nums.length).toBeGreaterThan(0);
        const lo = col === 0 ? 1 : col * 10;
        const hi = col === 8 ? 90 : col * 10 + 9;
        for (const n of nums) expect(n >= lo && n <= hi).toBe(true);
        expect(nums).toEqual([...nums].sort((a, b) => a - b));
      }
      expect(new Set(cardNums(c)).size).toBe(15);
    }
  });
});

describe('Лото: «каждый бочонок»', () => {
  it('мешок ждёт ответа человека; закрыть можно только последний бочонок', () => {
    let s = setup(seats, { mode: 'russian', cards: 2, mark: 'turn' }, new SeededRng(1));
    expect(toAct(s)).toEqual([0]);
    s = act(s, 0, { type: 'draw' })!;
    expect(s.pending).toEqual([0]);
    expect(toAct(s)).toEqual([0]);
    // тянуть, пока человек не ответил, нельзя
    expect(act(s, 1, { type: 'draw' })).toBeNull();
    expect(free(s, 0, { type: 'mark', card: 0, n: 1 })).toBe(false);
    for (let i = 0; i < 30 && !s.over; i++) {
      const n = lastCalled(s);
      const open = openWith(s, 0, n);
      if (open.length) {
        // старый бочонок закрыть нельзя
        const old = s.called.slice(0, -1).find((x) => openWith(s, 0, x).length);
        if (old != null) expect(act(s, 0, { type: 'mark', card: openWith(s, 0, old)[0], n: old })).toBeNull();
        for (const c of open) s = act(s, 0, { type: 'mark', card: c, n })!;
      } else s = act(s, 0, { type: 'pass' })!;
      expect(s.pending).toEqual([]);
      const who = toAct(s)[0];
      if (s.over) break;
      s = act(s, who, { type: 'draw' })!;
      expect(s.pending).toEqual([0]);
    }
  });

  it('«Нет у меня», когда число есть, — прозевано, закрыть потом нельзя', () => {
    let s = setup(seats, { mode: 'russian', cards: 3, mark: 'turn' }, new SeededRng(2));
    let missed = false;
    for (let i = 0; i < 90 && !missed && !s.over; i++) {
      if (!s.pending.length) {
        s = act(s, toAct(s)[0], { type: 'draw' })!;
        continue;
      }
      const n = lastCalled(s);
      const has = openWith(s, 0, n).length > 0;
      const r = apply(s, 0, { type: 'pass' }, rng)!;
      if (has) {
        expect(r.events.some((e) => e.type === 'pass' && e.missed)).toBe(true);
        expect(apply(r.state, 0, { type: 'mark', card: openWith(r.state, 0, n)[0], n }, rng)).toBeNull();
        missed = true;
      }
      s = r.state;
    }
    expect(missed).toBe(true);
  });

  it('«как за столом»: закрывать вне очереди и любые вышедшие числа', () => {
    let s = setup(seats, { mode: 'russian', cards: 3, mark: 'race' }, new SeededRng(4));
    for (let i = 0; i < 20; i++) s = act(s, toAct(s)[0], { type: 'draw' })!;
    expect(s.pending).toEqual([]);
    const n = s.called.find((x) => openWith(s, 0, x).length)!;
    expect(free(s, 0, { type: 'mark', card: 0, n })).toBe(true);
    expect(act(s, 0, { type: 'mark', card: openWith(s, 0, n)[0], n })).not.toBeNull();
  });
});

describe('Лото «Вокруг света»', () => {
  it('издания: 1972 — 15 карт по 8, 1980 — 20 по 6; у каждой картинки есть вопрос и ответ', () => {
    expect(EDITIONS['72'].sheets.length).toBe(15);
    expect(EDITIONS['80'].sheets.length).toBe(20);
    for (const ed of Object.values(EDITIONS)) {
      const all = ed.sheets.flat();
      expect(new Set(all).size).toBe(120);
      for (const n of all) {
        expect(ed.q[n], `${ed.id}: вопрос ${n}`).toBeTruthy();
        expect(ed.a[n], `${ed.id}: ответ ${n}`).toBeTruthy();
      }
    }
  });

  it('1980: карты раздаются поровну, колода — только картинки в игре', () => {
    const s = setup(seats, { mode: 'world', edition: '80' }, new SeededRng(5));
    expect(s.sheets[0].length).toBe(10);
    expect(s.sheets[1].length).toBe(10);
    expect(s.deck.length + 1).toBe(120);
  });
});
