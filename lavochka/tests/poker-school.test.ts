/* Школа покера: контент уроков валиден (столы собираются движком, карты не повторяются, ходы по очереди, ответ каждой
 * задачи совпадает с расчётом и не висит на волоске), игры-закрепления садят ботов нужного стиля, прогресс сохраняется. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { icm, icmCallNeed } from '../src/games/poker/icm';
import { SEAT_PROFILE } from '../src/games/poker/profiles';
import { loadSchool, rankOf, recordGame, recordLesson, resetSchool } from '../src/games/poker/school/progress';
import { buildScene, positionOf } from '../src/games/poker/school/scene';
import { parseRange, solve } from '../src/games/poker/school/solve';
import type { Lesson } from '../src/games/poker/school/types';
import { checkLesson } from '../src/games/poker/school/validate';

// прогресс хранится в localStorage — в node подставляем память
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const dir = join(__dirname, '../src/games/poker/school/lessons');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const lessons = files.map((f) => ({ f, l: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Lesson }));

// места под стили — без DOM (ui.ts тянет стили), та же формула
const seatsFor = (bots: string[]) => {
  const out = [0];
  for (const b of bots) {
    const p = SEAT_PROFILE.findIndex((x, i) => i > 0 && x === b && !out.includes(i));
    out.push(p >= 0 ? p : SEAT_PROFILE.findIndex((_, i) => i > 0 && !out.includes(i)));
  }
  return out;
};

describe('школа покера: уроки', () => {
  it('12 уроков по порядку, имя файла — NN-id', () => {
    expect(lessons.length).toBe(12);
    lessons.forEach(({ f, l }, i) => {
      expect(l.n).toBe(i + 1);
      expect(f).toBe(`${String(l.n).padStart(2, '0')}-${l.id}.json`);
    });
  });

  for (const { f, l } of lessons)
    it(`${f}: столы, ходы и ответы задач сходятся с расчётом`, () => {
      expect(checkLesson(l)).toEqual([]);
    });

  it('id задач не повторяются во всей школе', () => {
    const ids = lessons.flatMap(({ l }) => l.tasks.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('игра-закрепление: боты нужных стилей на своих местах', () => {
    for (const { l } of lessons) {
      const g = l.game;
      expect(['cash', 'sng']).toContain(g.kind);
      if (g.kind === 'sng') continue;
      const seats = seatsFor(g.bots);
      expect(new Set(seats).size).toBe(seats.length);
      expect(seats.length).toBeLessThanOrEqual(9);
      // если место со стилем нашлось — стиль совпадает
      const counts = new Map<string, number>();
      for (const b of g.bots) counts.set(b, (counts.get(b) ?? 0) + 1);
      for (const [b, n] of counts) expect(seats.slice(1).filter((p) => SEAT_PROFILE[p] === b).length).toBe(Math.min(n, SEAT_PROFILE.slice(1).filter((x) => x === b).length));
    }
  });
});

describe('школа покера: расчёт', () => {
  it('стол: карты по местам, доска по улицам, позиции', () => {
    const b = buildScene({ n: 6, hands: { '0': 'AH KH' }, board: 'QH JH 2C 9S 4D', pre: [[2, 'fold'], [3, 'fold'], [4, 'fold'], [5, 'raise', 60], [0, 'call'], [1, 'fold']] });
    expect(b.error).toBeUndefined();
    expect(b.s.board.map((c) => c.s + c.r)).toEqual(['H12', 'H11', 'C2']);
    expect(positionOf(b.s, 5)).toBe('BTN');
    expect(positionOf(b.s, 0)).toBe('SB');
    expect(positionOf(b.s, 2)).toBe('UTG');
    expect(buildScene({ n: 2, hands: { '0': 'AH KH', '1': 'AH 2C' } }).error).toMatch(/дважды/);
    expect(buildScene({ n: 6, pre: [[0, 'fold']] }).error).toMatch(/не подошёл/);
  });

  it('диапазоны', () => {
    expect([...parseRange('QQ+')].sort()).toEqual(['AA', 'KK', 'QQ']);
    expect(parseRange('ATs+').size).toBe(4);
    expect(parseRange('AK').size).toBe(2);
    expect(parseRange('77-55').size).toBe(3);
    expect(() => parseRange('XYZ')).toThrow();
  });

  it('пуш/фолд и ICM считаются одинаково с вердиктом', () => {
    // туз-девять на баттоне с 10 ББ — ва-банк; 7-2 из ранней — пас
    expect(solve({ id: 'a', q: '', why: '', kind: 'pushfold', answer: '', scene: { n: 6, button: 4, hero: 4, stack: [1500, 1500, 1500, 1500, 200, 1500], hands: { '4': 'AS 9D' }, foldTo: true } }).answer).toBe('push');
    expect(solve({ id: 'b', q: '', why: '', kind: 'pushfold', answer: '', scene: { n: 6, hero: 2, stack: 200, hands: { '2': '7C 2D' }, foldTo: true } }).answer).toBe('fold');
    // нужные шансы по ICM: пас — банк сопернику; на пузыре нужно больше, чем без ICM
    const st = [3000, 3000, 3000, 1000];
    const need = icmCallNeed(st, [50, 30, 20], 0, 1, 1000, 1150);
    expect(need).toBeGreaterThan(1000 / 2150);
    // без выплат за места (все — 1-му) ICM = доля фишек → совпадает с шансами банка
    expect(icmCallNeed(st, [100], 0, 1, 1000, 1150)).toBeCloseTo(1000 / 2150, 6);
    expect(icm([5000, 3000, 2000], [100]).map((x) => Math.round(x))).toEqual([50, 30, 20]);
  });
});

describe('школа покера: прогресс', () => {
  it('лучшие звёзды остаются, игра отмечается, разряд по сумме', () => {
    resetSchool();
    recordLesson('auty', 7, 0, 1000);
    recordLesson('auty', 7, 4, 2000);
    let p = loadSchool();
    expect(p.lessons.auty.stars).toBe(3);
    expect(p.lessons.auty.first).toBe(7);
    recordGame('auty', 3000);
    recordLesson('auty', 7, 1, 4000);
    p = loadSchool();
    expect(p.lessons.auty.played).toBe(true);
    expect(p.lessons.auty.stars).toBe(3);
    recordLesson('icm', 8, 2, 5000);
    expect(rankOf(loadSchool())).toMatchObject({ stars: 5, name: 'Любитель' });
    resetSchool();
    expect(loadSchool().lessons).toEqual({});
  });
});
