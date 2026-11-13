/* Глубокое ревью «Заколдованной страны»: зависания после гибели вне очереди, ввод из сети, пульт ведущего. */
import { describe, expect, it } from 'vitest';
import type { Rng, SeatSpec } from '../src/core/types';
import { def } from '../src/games/zakoldovannaya/def';
import type { State } from '../src/games/zakoldovannaya/state';
import { startScene } from '../src/games/zakoldovannaya/interp';

/** Кубики всегда на максимуме: всё попадает, бросок «N и более» удаётся. */
const MAX: Rng = { next: () => 0.9999, int: (n: number) => n - 1, getState: () => 0 } as unknown as Rng;
const SEATS: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: seat ? 'human' : 'bot', name: `м${seat}`, level: 1 }) as SeatSpec);

function start(seats = SEATS): State {
  const s = def.setup(seats, { quick: true }, MAX) as State;
  s.scene = null;
  s.phase = 'travel';
  s.where = { k: 'map', node: s.where.k === 'map' ? s.where.node : 0 };
  s.story = [];
  return s;
}

describe('Заколдованная страна: ревью', () => {
  it('бросок удачи павшего в тот же ход не оставляет бой без очереди', () => {
    const s = start();
    for (const h of s.heroes) Object.assign(h, { hp: 50, hpMax: 50 });
    const foe = (uid: number, m: string, dmg: number[]) => ({ uid, m, name: m, hp: 5, hpMax: 5, kd: 8, attacks: [{ name: null, dmg }], morale: null, value: 0, flee: null, group: `${m}:${m}`, gold: 0 });
    s.combat = {
      foes: [foe(1, 'pauk_krab', [0.5]), foe(2, 'ort', [100])], allies: [], round: 1, phase: 'foes', first: 'foes', queue: [0], buffs: {}, fled: [],
      noFlee: false, untilHit: false, capture: false, bound: [], saves: [], ret: {}, uid: 3,
    } as State['combat'];
    // оба бьют героя 1: паук отравляет (бросок удачи), орт добивает
    const r = def.apply(s, 0, { t: 'gm-foes', targets: { 1: 1, 2: 1 } }, MAX);
    expect(r).not.toBeNull();
    const n = r!.state;
    expect(n.heroes[0].dead).toBe(true);
    expect(n.heroes[1].dead).toBeFalsy();
    expect(def.toAct(n).length).toBeGreaterThan(0);
  });

  it('герой выпил смертельный яд, пока лавка ждала только его — лавка не зависает', () => {
    const s = start();
    s.custom = [{ shop: { kind: 'trurl' } }, { say: 'Дальше.' }];
    startScene({ s, rng: MAX, ev: [] }, 'custom');
    expect(s.scene?.wait?.k).toBe('shop');
    const a = def.apply(s, 1, { t: 'shop-done' }, MAX)!.state;
    expect(def.toAct(a)).toEqual([2]);
    a.heroes[1].items.push({ id: 'bottle', n: 1, bottle: 9 });
    const c = def.apply(a, 2, { t: 'drink', bottle: 9 }, MAX)!.state;
    expect(c.heroes[1].dead).toBe(true);
    expect(c.scene).toBeNull();
    expect(def.toAct(c)).toEqual([1]);
  });

  it('весь отряд погиб от яда вне боя — партия кончается, а не зависает', () => {
    const s = start([SEATS[0], SEATS[1]]);
    s.heroes[0].items.push({ id: 'bottle', n: 1, bottle: 9 });
    const r = def.apply(s, 1, { t: 'drink', bottle: 9 }, MAX)!.state;
    expect(def.result(r)?.winners).toEqual([0]);
  });

  it('обмен и передача денег: не число — отказ, деньги остаются числом', () => {
    const s = start();
    s.custom = [{ shop: { kind: 'trurl', exchange: true } }];
    startScene({ s, rng: MAX, ev: [] }, 'custom');
    const g = s.heroes[0].gold;
    const r = def.apply(s, 1, { t: 'exchange', n: 'много' as unknown as number }, MAX);
    expect(r === null || Number.isFinite(r.state.heroes[0].gold)).toBe(true);
    expect(def.apply(s, 1, { t: 'buy', id: 'dagger', n: 1.5 }, MAX)).toBeNull();
    const t = start();
    expect(def.apply(t, 1, { t: 'give', to: 2, gold: 'x' as unknown as number }, MAX)).toBeNull();
    expect(g).toBeGreaterThanOrEqual(0);
  });

  it('карты: ставка на несколько номеров не больше денег героя', () => {
    const s = start();
    s.custom = [{ gamble: { game: 'cards', vs: 'Гоблуры', stake: 20, gold: 100 } }];
    startScene({ s, rng: MAX, ev: [] }, 'custom');
    s.heroes[0].gold = 10;
    expect(def.apply(s, 1, { t: 'bet', n: 5, picks: [1, 2, 3] }, MAX)).toBeNull();
    expect(def.apply(s, 1, { t: 'bet', n: 5, picks: [1, 2] }, MAX)).not.toBeNull();
  });

  it('пульт ведущего: число опасностей и награда ограничены', () => {
    const s = start();
    const r = def.apply(s, 0, { t: 'gm-fight', foes: [{ m: 'ort', n: 1e9, hp: '99999d6' as unknown as number }] }, MAX)!.state;
    expect(r.combat!.foes.length).toBeLessThanOrEqual(12);
    expect(def.apply(s, 0, { t: 'gm-give', seat: 1, give: { gold: -500 } }, MAX)).toBeNull();
    expect(def.apply(s, 0, { t: 'gm-give', seat: 1, give: { xp: '999999d999999' as unknown as number } }, MAX)).toBeNull();
    expect(def.apply(s, 0, { t: 'gm-give', seat: 1, give: { item: 'sword_long' } }, MAX)).toBeNull();
    expect(def.apply(s, 0, { t: 'gm-give', seat: 1, give: { gold: 30 } }, MAX)).not.toBeNull();
  });
});
