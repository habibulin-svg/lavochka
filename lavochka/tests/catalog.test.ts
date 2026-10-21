import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog';
import { DEFS } from '../src/games/defs';

const parse = (s: string): [number, number] => {
  const t = s.replace(/\s/g, '');
  const range = t.match(/^(\d+)[–\-—](\d+)$/);
  if (range) return [Number(range[1]), Number(range[2])];
  const one = t.match(/^(\d+)$/); // одиночная игра: «1» или «2»
  if (one) return [Number(one[1]), Number(one[1])];
  throw new Error('не разобрал число игроков: ' + s);
};

describe('каталог: карточки согласованы с играми', () => {
  it('карточек в каталоге достаточно много', () => {
    expect(CATALOG.length).toBeGreaterThan(20);
  });

  it('число игроков на карточке совпадает с тем, что допускает игра', async () => {
    const checked: string[] = [];
    for (const card of CATALOG) {
      const load = (DEFS as Record<string, (() => Promise<{ players: { min: number; max: number } }>) | undefined>)[card.id];
      if (!load) continue;
      const def = await load();
      const [min, max] = parse(card.players);
      // аркада с сетевым режимом: одному — сама аркада, вдвоём и больше — стол
      expect([min, max], 'карточка ' + card.id).toEqual([card.net ? 1 : def.players.min, def.players.max]);
      checked.push(card.id);
    }
    // проверяем, что сверка действительно что-то проверила
    expect(checked.length).toBeGreaterThan(20);
    // грузит все игры подряд: в полном прогоне рядом с партиями ботов это дольше 30 с
  }, 120_000);
});
