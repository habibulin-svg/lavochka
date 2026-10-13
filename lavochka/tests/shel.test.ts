import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import board from '../src/games/hodilki/data/shel.json';
import items from '../src/games/shel/items.json';
import { signOf } from '../src/games/hodilki/nastolki';

describe('Шёл солдат: поле', () => {
  it('сто сорок клеток по порядку, движение по возрастанию', () => {
    expect(board.cells.length).toBe(140);
    expect(board.end).toBe(board.cells.length - 1);
    expect(board.w).toBe(2435);
    expect(board.h).toBe(3094);
    // координаты внутри поля
    for (const [i, c] of board.cells.entries()) {
      expect(c.x, `клетка ${i + 1}`).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(board.w);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(board.h);
    }
  });

  it('смысловые знаки сохранены, известные переведены в коды движка', () => {
    const withSign = board.cells.filter((c) => (c as { q?: string }).q);
    expect(withSign.length).toBe(140);
    const skip = board.cells.filter((c) => (c as { s?: string }).s === 'skip').length;
    const start = board.cells.filter((c) => (c as { s?: string }).s === 'start').length;
    expect(skip, 'привалы').toBe(8);
    expect(start, 'старт').toBe(1);
    // ярмарки чудес — на 9, 48 и 88
    const fairs = board.cells
      .map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q }))
      .filter((c) => c.q === 'fair')
      .map((c) => c.i);
    expect(fairs).toEqual([9, 48, 88]);
    // нищенка — 15, 17, 19; ведьма — 21: от них зависит Конь-огонь
    const beggars = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'beggar').map((c) => c.i);
    expect(beggars).toEqual([15, 17, 19]);
    const witch = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'witch').map((c) => c.i);
    expect(witch).toEqual([21]);
  });
});

describe('Шёл солдат: предметы', () => {
  it('шестнадцать предметов с названиями и текстами', () => {
    const list = items.items as { file: string; kind: string; text: string }[];
    expect(list.length).toBe(16);
    for (const it of list) {
      expect(it.file, 'файл картинки').toMatch(/^cards\/item-\d\d\.webp$/);
      expect(it.text.length, 'текст предмета ' + it.file).toBeGreaterThan(2);
    }
    // названия, которые точно есть в игре
    const names = list.map((i) => i.text).join(' | ');
    for (const must of ['Хлеб', 'Огниво', 'Полотенце', 'Конь-огонь', 'Шапка-невидимка']) {
      expect(names, 'предмет ' + must).toContain(must);
    }
  });

  it('картинки всех предметов лежат в public/shel', () => {
    const list = items.items as { file: string }[];
    for (const it of list) {
      expect(existsSync(join(process.cwd(), 'public', 'shel', it.file)), it.file).toBe(true);
    }
  });
});

describe('Шёл солдат: знаки движка', () => {
  it('ярмарки разбираются как market, а не теряются', () => {
    const fairs = board.cells
      .map((c, i) => ({ i: i + 1, c }))
      .filter((x) => (x.c as { q?: string }).q === 'fair');
    expect(fairs.map((f) => f.i)).toEqual([9, 48, 88]);
    for (const f of fairs) {
      const sign = signOf((f.c as { s?: string }).s, f.i, undefined, undefined);
      expect(sign?.k, 'ярмарка на клетке ' + f.i).toBe('market');
    }
  });

  it('привалы остаются пропуском хода, петли разбираются как loop', () => {
    const skip = board.cells.filter((c) => (c as { s?: string }).s === 'skip');
    expect(skip.length).toBe(8);
    const loop = signOf('loop:64,65', 64, undefined, undefined);
    expect(loop?.k).toBe('loop');
    expect(loop && loop.k === 'loop' ? loop.cells : []).toEqual([64, 65]);
  });
});
