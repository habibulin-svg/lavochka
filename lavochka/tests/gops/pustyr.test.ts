import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type LevelData, decodeMask } from '../../src/gops/level';

const DIR = join(__dirname, '../../public/gops/levels');

describe('gops/pustyr: карты Пустыря', () => {
  it('список и карты на месте: маска читается, точек высадки хватает на 4 бригады по 3, тема известна', () => {
    const list: { id: string; theme: string; time: string }[] = JSON.parse(readFileSync(join(DIR, 'pustyr-index.json'), 'utf8'));
    expect(list.length).toBeGreaterThanOrEqual(40);
    const themes = ['yard', 'garages', 'construction', 'dacha', 'depot', 'dump', 'factory', 'heating', 'market', 'school', 'beach', 'winter'];
    for (const p of list) {
      const lv: LevelData = JSON.parse(readFileSync(join(DIR, `${p.id}.json`), 'utf8'));
      const m = decodeMask(lv);
      expect(m.count(), p.id).toBeGreaterThan(m.w * m.h * 0.05);
      expect(lv.spawns.length, p.id).toBeGreaterThanOrEqual(12);
      expect(themes, p.id).toContain(p.theme);
    }
  });
});
