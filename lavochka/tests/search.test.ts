import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog';
import { NAMES } from '../src/site/names';
import { searchGames, skeleton, swapLayout } from '../src/site/search';

const first = (q: string) => searchGames(q)[0]?.id;

describe('поиск игр', () => {
  it('находит по названию, другому названию и по-английски', () => {
    expect(first('нарды')).toBe('nardy');
    expect(first('backgammon')).toBe('nardy');
    expect(first('косынка')).toBe('solitaire');
    expect(first('minesweeper')).toBe('saper');
    expect(first('блекджек')).toBe('ochko');
    expect(first('ludo')).toBe('shishbesh');
  });

  it('понимает транслит, чужую раскладку и опечатки', () => {
    expect(first('nardy')).toBe('nardy');
    expect(first('durak')).toBe('durak');
    expect(swapLayout('yfhls')).toBe('нарды');
    expect(first('yfhls')).toBe('nardy');
    expect(first('шахмоты')).toBe('chess');
    expect(first('сапер')).toBe('saper');
    expect(skeleton('Шиш-беш')).toBe(skeleton('shish besh'));
  });

  it('короткое слово ищется с начала слова, пустой запрос — ничего', () => {
    expect(searchGames('уно').map((g) => g.id)).toEqual(['101']);
    expect(searchGames('  ')).toEqual([]);
    expect(searchGames('жвачка бубльгум')).toEqual([]);
  });

  it('имена заданы только для карточек каталога', () => {
    const ids = new Set(CATALOG.map((g) => g.id));
    for (const id of Object.keys(NAMES)) expect(ids.has(id), id).toBe(true);
  });
});
