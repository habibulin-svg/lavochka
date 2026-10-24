/* «Бородино»: таблица боя, местность и передвижение, зоны контроля, артиллерия, бой с отступлением и преследованием, командующие, сбор, итог. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { choose } from '../src/games/borodino/ai';
import { byLabel, dist, isRoad, stepCost } from '../src/games/borodino/hex';
import { apply, canJoin, cfgFrom, crtCol, newState, reach, toAct, U, verdict, type State } from '../src/games/borodino/engine';
import { RIVER, SPRITE_IDS } from '../src/games/borodino/terrain';
import { RUSSIAN_TOTAL } from '../src/games/borodino/units';

const id = (s: string) => U.findIndex((u) => u.id === s);
const H = byLabel;

function only(place: Record<string, string>, side: 0 | 1 = 0, phase: State['phase'] = 'move'): State {
  const s = newState(cfgFrom({}));
  s.u.forEach((st) => (st.hex = -1));
  for (const [k, h] of Object.entries(place)) s.u[id(k)].hex = H(h);
  s.side = side;
  s.phase = phase;
  s.u.forEach((st, i) => (st.mp = U[i].kind === 'art' ? 0 : U[i].mp));
  return s;
}

describe('Бородино', () => {
  it('данные: 314 очков у русских, у каждой фишки есть картинка, в начале нет двух частей в одной клетке', () => {
    expect(RUSSIAN_TOTAL).toBe(314);
    expect(U.filter((u) => !SPRITE_IDS.includes(u.id))).toEqual([]);
    const s = newState(cfgFrom({}));
    const seen = new Set<number>();
    U.forEach((u, i) => {
      if (u.kind === 'cmd') return;
      expect(seen.has(s.u[i].hex), u.id).toBe(false);
      seen.add(s.u[i].hex);
    });
  });

  it('столбцы таблицы боя', () => {
    expect(crtCol(0)).toBe(5);
    expect(crtCol(1)).toBe(6);
    expect(crtCol(2)).toBe(6);
    expect(crtCol(3)).toBe(7);
    expect(crtCol(-1)).toBe(4);
    expect(crtCol(-10)).toBe(0);
    expect(crtCol(40)).toBe(14);
  });

  it('цена движения: дорога 1, лес 2, речка +4, артиллерии через речку нельзя', () => {
    expect(stepCost(H('1018'), H('1119'), 'inf')).toBe(1);
    // любая сторона-речка без моста
    const river = RIVER.find(([a, b]) => !isRoad(a, b))!;
    expect(stepCost(river[0], river[1], 'wheels')).toBe(Infinity);
    expect(stepCost(river![0], river![1], 'inf')).toBeGreaterThanOrEqual(5);
  });

  it('пехота останавливается в зоне контроля, кавалерия — нет', () => {
    const s = only({ III10: '1016', IIIc: '1015', r7: '1314' });
    const inf = reach(s, id('III10'));
    expect(inf.has(H('1215'))).toBe(true);
    // дальше 1215 по той же линии — уже нельзя: 1215 в зоне контроля
    const beyond = [...inf.keys()].filter((h) => dist(h, H('1314')) === 1);
    for (const h of beyond) expect([...inf.keys()].some((x) => inf.get(x)!.prev === h && x !== h)).toBe(false);
    expect(reach(s, id('IIIc')).has(H('1413'))).toBe(true);
  });

  it('батарея: к бою не двигается, на колёса — 2 очка', () => {
    let s = only({ Ia: '1421' });
    expect(reach(s, id('Ia')).size).toBe(0);
    s = apply(s, 0, { type: 'wheels', u: id('Ia') }, new SeededRng(1))!.state;
    expect(s.u[id('Ia')].mp).toBe(3);
    expect(reach(s, id('Ia')).size).toBeGreaterThan(0);
  });

  it('бой: З2 — отступление на 2 и деморализация, затем преследование', () => {
    const s = only({ I4: '1717', I5: '1718', r24: '1817' }, 0, 'combat');
    const rng = new RiggedRng(new SeededRng(1));
    rng.rig([2]);
    const a = apply(s, 0, { type: 'attack', def: id('r24'), att: [id('I4'), id('I5')] }, rng)!;
    const t = a.state;
    expect(t.u[id('r24')].dem).toBe(true);
    expect(dist(t.u[id('r24')].hex, H('1817'))).toBe(2);
    expect(t.phase).toBe('pursue');
    const p = apply(t, 0, { type: 'pursue', u: id('I5') }, rng)!.state;
    expect(p.u[id('I5')].hex).toBe(H('1817'));
    // проигравший второй раз в этот ход не атакуется
    expect(p.beaten).toContain(id('r24'));
  });

  it('командующий удерживает часть от отступления, если бросок не больше рейтинга', () => {
    const s = only({ r12: '1915', Raevsky: '1915', I3: '1814', I1: '1815' }, 0, 'combat');
    const rng = new RiggedRng(new SeededRng(1));
    rng.rig([2, 3, 4]);
    const t = apply(s, 0, { type: 'attack', def: id('r12'), att: [id('I3'), id('I1')] }, rng)!.state;
    expect(t.u[id('r12')].hex).toBe(H('1915'));
    expect(t.u[id('r12')].dem).toBe(false);
  });

  it('через речку не атакуют, а батарея бьёт на 3 клетки', () => {
    const s = only({ Ga: '1420', r7: '1619' }, 0, 'combat');
    expect(canJoin(s, id('Ga'), id('r7'))).toBeNull();
    s.u[id('r7')].hex = H('1820');
    expect(canJoin(s, id('Ga'), id('r7'))).not.toBeNull();
  });

  it('сбор: русские 2+, немцы и итальянцы 4+', () => {
    const s = only({ III10: '1016', III25: '1117' }, 0, 'rally');
    s.u[id('III10')].dem = true;
    s.u[id('III25')].dem = true;
    const rng = new RiggedRng(new SeededRng(1));
    rng.rig([2, 2]);
    const t = apply(s, 0, { type: 'rally' }, rng)!.state;
    expect(t.u[id('III10')].dem).toBe(false);
    expect(t.u[id('III25')].dem).toBe(true);
  });

  it('итог по потерям русских', () => {
    expect(verdict(200).level).toBe(1);
    expect(verdict(120).level).toBe(2);
    expect(verdict(90).level).toBe(3);
    expect(verdict(30).level).toBe(4);
    expect(verdict(30).winners).toEqual([1]);
  });

  it('боты доигрывают оба сценария', () => {
    for (const scenario of ['history', 'free']) {
      const rng = new SeededRng(3);
      let s = newState(cfgFrom({ scenario, turns: 6 }));
      let n = 0;
      while (s.phase !== 'over' && n < 8000) {
        const p = toAct(s)[0];
        const a = choose(s, p, n % 3, rng)!;
        const r = apply(s, p, a, rng);
        expect(r, `${scenario}: ${JSON.stringify(a)} в фазе ${s.phase}`).not.toBeNull();
        s = r!.state;
        n++;
      }
      expect(s.phase).toBe('over');
    }
  });
});
