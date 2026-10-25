/* «Конверсия»: курсы и зоны, цены, добыча и производство, импорт по двойной цене, поездка с картой, гос. груз, конец игры, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/konversiya/ai';
import * as kv from '../src/games/konversiya/engine';

const fresh = (n = 2, variant = 'short', deck: string[] = []) => {
  const s = kv.newState(kv.cfgFrom({ variant }), n, new SeededRng(1));
  s.deck = [...deck.map((id) => kv.CARD_KINDS.findIndex((c) => c.id === id)), ...s.deck];
  return s;
};
function act(s: kv.State, a: kv.Action) {
  const r = kv.apply(s, s.turn, a, new SeededRng(2));
  if (!r) throw new Error(`нельзя: ${JSON.stringify(a)}`);
  return r.state;
}

describe('Конверсия', () => {
  it('колода — 50 карт; таблицы — 100, 125, 190', () => {
    expect(kv.DECK.length).toBe(50);
    expect(kv.total('short')).toBe(100);
    expect(kv.total('medium')).toBe(125);
    expect(kv.total('long')).toBe(190);
    const s = fresh(2, 'medium');
    expect(kv.rate(s)).toBe(1);
    s.ind = 15;
    expect(kv.rate(s)).toBe(2);
    s.ind = 124;
    expect(kv.rate(s)).toBe(4);
  });

  it('цены по курсу, импорт вдвое дороже', () => {
    const s = fresh();
    expect(kv.buyPrice(s, 'factory')).toBe(60);
    expect(kv.sellPrice(s, 'machI')).toBe(36);
    s.ind = 30;
    expect(kv.buyPrice(s, 'machS')).toBe(16);
  });

  it('добыча и производство', () => {
    let s = fresh();
    s = act(s, { type: 'buy', items: { equipS: 2 } });
    expect(s.p[0].rub).toBe(20);
    s = act(s, { type: 'skip' });
    s = act(s, { type: 'mine' });
    expect(s.p[0].own.raw).toBe(2);
    expect(s.p[0].rub).toBe(18);
    const t = fresh();
    Object.assign(t.p[0].own, { factory: 1, machS: 1, machI: 1, raw: 5, comp: 1 });
    // импортный с компьютером — 3, советский с компьютером — 2
    expect(kv.produceYield(t.p[0])).toEqual({ units: 5, cost: 4 });
  });

  it('поездка: карта «досрочно прибыли» — ещё ход; вывоз товара за доллары двигает индикатор', () => {
    let s = fresh(2, 'short', ['extra']);
    Object.assign(s.p[0].own, { truckS: 2, goods: 2 });
    s = act(s, { type: 'trip', to: 'europe', mode: 'truck', goods: 2 });
    expect(s.p[0].loc).toBe('europe');
    expect(s.ind).toBe(2);
    expect(s.turn).toBe(0);
    s = act(s, { type: 'sell', items: { goods: 2 } });
    expect(s.p[0].usd).toBe(8);
    expect(s.turn).toBe(1);
  });

  it('один игрок на континенте; флот — не в Европу', () => {
    const s = fresh();
    s.p[1].loc = 'asia';
    s.p[0].own.fleetS = 1;
    const ts = kv.trips(s, 0);
    expect(ts.some((t) => t.to === 'asia')).toBe(false);
    expect(ts.some((t) => t.to === 'europe' && t.mode === 'fleet')).toBe(false);
    expect(ts.some((t) => t.to === 'africa' && t.mode === 'fleet')).toBe(true);
  });

  it('импорт: купленное за границей — груз, дома — имущество по двойной цене; тайфун — назад и пропуск', () => {
    let s = fresh(2, 'short', ['typhoon', 'usd1']);
    Object.assign(s.p[0].own, { truckS: 3 });
    s.p[0].loc = 'europe';
    s.p[0].lastMode = 'truck';
    s.p[0].usd = 6;
    s = act(s, { type: 'buy', items: { machI: 3 } });
    expect(s.p[0].cargo.imports.machI).toBe(3);
    s = act(s, { type: 'skip' });
    s = act(s, { type: 'trip', to: 'ussr', mode: 'truck', goods: 0 });
    expect(s.p[0].loc).toBe('europe');
    expect(s.p[0].skip).toBe(1);
    s = act(s, { type: 'skip' }); // ход второго; первый пропускает
    expect(s.turn).toBe(1);
    s = act(s, { type: 'skip' });
    s = act(s, { type: 'trip', to: 'ussr', mode: 'truck', goods: 0 });
    expect(s.p[0].own.machI).toBe(3);
    expect(s.p[0].usd).toBe(1);
  });

  it('гос. груз: деньги при погрузке, импорт поступает на внутренний рынок', () => {
    let s = fresh(2, 'short', ['extra', 'extra']);
    s.p[0].own.truckS = 2;
    s = act(s, { type: 'load', n: 2 });
    expect(s.p[0].rub).toBe(120);
    s = act(s, { type: 'skip' });
    s = act(s, { type: 'trip', to: 'africa', mode: 'truck', goods: 0 });
    s = act(s, { type: 'unload' });
    s = act(s, { type: 'skip' });
    s = act(s, { type: 'load', n: 2 });
    expect(s.p[0].cargo.stateKind).toBe('truckI');
    s = act(s, { type: 'skip' });
    s = act(s, { type: 'trip', to: 'ussr', mode: 'truck', goods: 0 });
    s = act(s, { type: 'unload' });
    expect(s.market.truckI).toBe(2);
  });

  it('пятый курс — конец, итог по пятому курсу', () => {
    let s = fresh(2, 'short', ['usd1']);
    s.ind = 99;
    Object.assign(s.p[0].own, { truckS: 1, goods: 1, factory: 1 });
    s = act(s, { type: 'trip', to: 'asia', mode: 'truck', goods: 1 });
    expect(s.over).toBe(true);
    expect(kv.worth(s, 0)).toBe(100 + 1 + 3 + 6 + 2);
  });

  it('партии ботов доходят до конца', () => {
    for (const [n, lv, variant] of [[2, 1, 'short'], [4, 2, 'medium'], [6, 0, 'short'], [3, 2, 'long']] as const) {
      const rng = new SeededRng(n + lv);
      let s = kv.newState(kv.cfgFrom({ variant }), n, rng);
      let k = 0;
      while (!s.over && k < 20000) {
        const a = choose(s, s.turn, lv, rng);
        expect(a).not.toBeNull();
        const r = kv.apply(s, s.turn, a!, rng);
        expect(r, JSON.stringify(a)).not.toBeNull();
        s = r!.state;
        k++;
      }
      expect(s.over).toBe(true);
    }
  });
});
