/* «Мо-но-пол»: поле, развилка, плата с вкладами, сберкнижки, зал и касса, подвал, колесо, бега, баня, банкротство, партии ботов. */
import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/core/types';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/monopol/ai';
import { BIG, FIRMS, next, SM, SMALL, WHEEL } from '../src/games/monopol/board';
import * as mp from '../src/games/monopol/engine';

/** Кубик с заданными бросками (rng.int(6) вернёт die − 1). */
function dice(...v: number[]): Rng {
  const q = v.map((d) => d - 1);
  return { next: () => 0, int: () => q.shift() ?? 0, getState: () => 0 };
}
const fresh = (n = 2) => mp.newState(mp.cfgFrom({}), n);
function act(s: mp.State, a: mp.Action, rng: Rng = dice(1)) {
  const r = mp.apply(s, s.turn, a, rng);
  if (!r) throw new Error(`нельзя: ${JSON.stringify(a)} в фазе ${s.phase}`);
  // после броска пуговицу переставляет игрок — отдельным действием (остаток подкрутки — на то, что случится на клетке)
  if (a.type === 'roll' && r.state.phase === 'move') return act(r.state, { type: 'move' }, rng);
  return r.state;
}

describe('Монопол', () => {
  it('после броска пуговицу переставляет сам игрок: фаза move и место на поле', () => {
    const s0 = mp.newState(mp.cfgFrom({}), 2);
    const r = mp.apply(s0, 0, { type: 'roll' }, dice(2))!;
    expect(r.state.phase).toBe('move');
    expect(r.events.some((e) => e.type === 'move')).toBe(false);
    const t = mp.moveTarget(r.state)!;
    expect(mp.legal(r.state)).toEqual([{ type: 'move' }]);
    const m = mp.apply(r.state, 0, { type: 'move' }, dice(1))!;
    expect(m.state.loc[0]).toBe(t.loc);
    expect(m.events.some((e) => e.type === 'move')).toBe(true);
  });

  it('поле: 30 клеток большого круга, 5 малого, 22 фирмы', () => {
    expect(BIG.length).toBe(30);
    expect(SMALL.length).toBe(5);
    expect(FIRMS.length).toBe(22);
    expect(next(5, true)).toBe(SM);
    expect(next(5, false)).toBe(6);
    expect(next(SM + 4, true)).toBe(19);
  });

  it('развилка: чётный — малый круг, нечётный — большой', () => {
    let s = fresh();
    s.loc = [4, 4];
    s = act(s, { type: 'roll' }, dice(2));
    expect(s.loc[0]).toBe(SM);
    s = act(s, { type: 'roll' }, dice(3));
    expect(s.loc[1]).toBe(7);
  });

  it('плата: дробь от цены с вкладами; +500 за проход', () => {
    let s = fresh();
    s.owner[3] = 1;
    s.inv[3] = 300;
    s.loc = [1, 8];
    s = act(s, { type: 'roll' }, dice(2));
    expect(s.cash).toEqual([300, 700]);
    let t = fresh();
    t.loc = [7, 0];
    t = act(t, { type: 'roll' }, dice(3)); // 8, 9 (+500), 10
    expect(t.cash[0]).toBe(1000);
  });

  it('сберкнижка: кредит до двух капиталов, потом процент или возврат', () => {
    let s = fresh();
    s.loc = [29, 8];
    s = act(s, { type: 'roll' }, dice(1));
    expect(s.phase).toBe('bank');
    expect(mp.loanLimit(s, 0)).toBe(1000);
    s = act(s, { type: 'loan', amount: 1000 });
    expect(s.cash[0]).toBe(1500);
    expect(s.debt[0][0]).toBe(1000);
    s.turn = 0;
    s.loc = [29, 8];
    s = act(s, { type: 'roll' }, dice(1));
    expect(mp.legal(s).map((a) => a.type).sort()).toEqual(['interest', 'repay']);
    s = act(s, { type: 'interest' });
    expect(s.cash[0]).toBe(1400);
    expect(s.debt[0][0]).toBe(1000);
  });

  it('зал: 200 в кассу, с зала шестёркой — касса твоя', () => {
    let s = fresh();
    s.loc = [4, 4];
    s = act(s, { type: 'roll' }, dice(1));
    expect(s.pot).toBe(200);
    s = act(s, { type: 'roll' }, dice(2)); // второй — мимо зала на малый круг
    expect(s.zal[0]).toBe(true);
    s = act(s, { type: 'roll' }, dice(6));
    expect(s.loc[0]).toBe(19);
    expect(s.pot).toBe(0);
    expect(s.cash[0]).toBe(500);
  });

  it('подвал: шесть бросков, не вышел — штраф 500', () => {
    let s = fresh();
    s.loc = [12, 8];
    s = act(s, { type: 'roll' }, dice(1));
    expect(s.where[0]).toBe('cellar');
    for (let i = 0; i < 6; i++) {
      s = act(s, { type: 'roll' }, dice(2));
      const stay = mp.legal(s).find((a) => a.type === 'go' && a.cell === s.sub[0])!;
      s = act(s, stay);
    }
    expect(s.where[0]).toBe('board');
    expect(s.cash[0]).toBe(0);
  });

  it('белка в колесе: до пустого сектора; бега: ½ и ×2', () => {
    let s = fresh();
    s.loc = [SM + 1, 8];
    s = act(s, { type: 'roll' }, dice(1));
    expect(s.phase).toBe('wheel');
    s = act(s, { type: 'roll' }, dice(1)); // −200
    expect(s.cash[0]).toBe(300);
    s = act(s, { type: 'roll' }, dice(2)); // пусто
    expect(WHEEL[3]).toBeNull();
    expect(s.loc[0]).toBe(12);
    let r = fresh();
    r.loc = [19, 8];
    r = act(r, { type: 'roll' }, dice(1));
    r = act(r, { type: 'roll' }, dice(5)); // +1000
    expect(r.sum).toBe(1000);
    for (const d of [6, 6]) r = act(r, { type: 'roll' }, dice(d)); // −100 (10), −700 (16)
    expect(r.sum).toBe(200);
    r = act(r, { type: 'roll' }, dice(2)); // ½
    expect(r.sum).toBe(100);
    r = act(r, { type: 'roll' }, dice(1)); // ×2 — и на Пекарню
    expect(r.cash[0]).toBe(700);
    expect(r.loc[0]).toBe(21);
  });

  it('банкротство: вклады, потом фирмы за полцены, иначе выбывает', () => {
    let s = fresh(3);
    s.owner[23] = 1; // Планетарий 4000, 1/10
    s.inv[23] = 6000;
    s.owner[1] = 0;
    s.inv[1] = 100;
    s.cash[0] = 100;
    s.loc = [22, 0, 0];
    s = act(s, { type: 'roll' }, dice(1)); // платит 1000
    expect(s.alive[0]).toBe(false);
    expect(s.owner[1]).toBe(-1);
    expect(s.cash[1]).toBe(500 + 100 + 100 + 250);
  });

  it('партии ботов доходят до конца', () => {
    for (const [n, lv, rounds] of [[2, 2, 25], [4, 1, 15], [6, 0, 15], [3, 2, 0]] as const) {
      const rng = new SeededRng(n * 7 + lv);
      let s = mp.newState(mp.cfgFrom({ rounds }), n);
      let k = 0;
      while (!s.over && k < 30000) {
        const a = choose(s, s.turn, lv, rng);
        expect(a).not.toBeNull();
        const r = mp.apply(s, s.turn, a!, rng);
        expect(r, `${JSON.stringify(a)} в фазе ${s.phase}`).not.toBeNull();
        s = r!.state;
        k++;
      }
      expect(s.over).toBe(true);
    }
  });
});
