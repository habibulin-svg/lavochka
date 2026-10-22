/* Каталог и сервер согласованы. Проверки каждой игры — games-suite.ts (части games-1…8.test.ts). */
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog';
import { DEFS } from '../src/games/defs';

describe('каталог', () => {
  it('готовые игры каталога зарегистрированы для сервера и наоборот', () => {
    const ready = CATALOG.filter((g) => g.load && (!g.arcade || g.net)).map((g) => g.id).sort();
    expect(Object.keys(DEFS).sort()).toEqual(ready);
  });
  it('id в каталоге уникальны', () => {
    const ids = CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
