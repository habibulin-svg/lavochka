/* «Заколдованная страна»: содержимое без ошибок, планы связны, правила боя и бросков. */
import { describe, expect, it } from 'vitest';
import { lintAll, uncovered } from '../src/games/zakoldovannaya/content/lint';
import { needToHit, statMod } from '../src/games/zakoldovannaya/book';
import { MAP, PLANS, ADJ } from '../src/games/zakoldovannaya/world';
import { MONSTERS } from '../src/games/zakoldovannaya/monsters';

describe('Заколдованная страна: данные', () => {
  it('содержимое приключений ссылается только на существующее', () => {
    expect(lintAll()).toEqual([]);
  });
  it('100 карточек опасностей с уникальными id', () => {
    expect(MONSTERS.length).toBe(100);
    expect(new Set(MONSTERS.map((m) => m.id)).size).toBe(100);
  });
  it('карта связна: из Форпоста достижим каждый кружок', () => {
    const seen = new Set([MAP.start]);
    const q = [MAP.start];
    while (q.length) for (const n of ADJ[q.shift()!]) if (!seen.has(n)) (seen.add(n), q.push(n));
    expect(seen.size).toBe(MAP.nodes.length);
    expect(MAP.castles.length).toBe(15);
  });
  it('в каждом замке все комнаты достижимы от входа', () => {
    for (const [id, p] of Object.entries(PLANS)) {
      const adj = new Map<string, string[]>();
      for (const l of p.links) {
        adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
        adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
      }
      const seen = new Set(p.entry);
      const q = [...p.entry];
      while (q.length) for (const n of adj.get(q.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), q.push(n));
      const lost = p.rooms.map((r) => r.id).filter((r) => !seen.has(r));
      expect(lost, id).toEqual([]);
    }
  });
  it('ВРЕМЕННО: комнаты книги без сцены', () => {
    console.log('без сцены:', uncovered().length);
  });
});

describe('Заколдованная страна: правила', () => {
  it('таблица попадания: КД 8 → 9, 0 → 17, −2 → 18, −3 → только заклинанием, КД 9 → 8', () => {
    expect(needToHit(8)).toBe(9);
    expect(needToHit(2)).toBe(15);
    expect(needToHit(0)).toBe(17);
    expect(needToHit(-1)).toBe(18);
    expect(needToHit(-2)).toBe(18);
    expect(needToHit(-3)).toBeNull();
    expect(needToHit(9)).toBe(8);
  });
  it('поправки качеств', () => {
    expect([3, 5, 8, 12, 15, 17, 18].map((v) => statMod(v))).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(statMod(18, 'wis')).toBe(4);
  });
});
