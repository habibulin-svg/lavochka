/* «Освоение галактики»: раздача, бой на кубиках, взятие с карточкой, обмен, цели, союзник вдвоём, партии ботов. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { choose, winProb } from '../src/games/galaktika/ai';
import { ADJ, PLANET_TERRS, TERRS } from '../src/games/galaktika/data';
import { apply, cfgFrom, goalDone, newState, setKind, syncCounts, toAct, tradeValue, view, type State } from '../src/games/galaktika/engine';

const T = (n: string) => TERRS.findIndex((t) => t.name === n);

function board(n = 3): State {
  const s = newState(n, cfgFrom({}), new SeededRng(3));
  s.owner = s.owner.map(() => 2);
  s.ships = s.ships.map(() => 2);
  s.phase = 'attack';
  s.turn = 0;
  s.pending = 0;
  s.hand = [[], [], []];
  syncCounts(s);
  return s;
}

describe('Освоение галактики', () => {
  it('42 территории на 6 планетах, соседство симметрично', () => {
    expect(TERRS.length).toBe(42);
    expect(PLANET_TERRS.map((p) => p.length)).toEqual([4, 4, 6, 7, 9, 12]);
    ADJ.forEach((a, i) => a.forEach((j) => expect(ADJ[j]).toContain(i)));
  });

  it('раздача: втроём по 35 звездолётов, джокер территории не даёт', () => {
    const s = newState(3, cfgFrom({}), new SeededRng(1));
    expect(s.owner.every((o) => o >= 0 && o < 3)).toBe(true);
    const own = [0, 1, 2].map((p) => s.owner.filter((o) => o === p).length);
    expect(own.reduce((a, b) => a + b)).toBe(42);
    expect(s.pending).toBe(35 - own[0]);
  });

  it('равенство — в пользу защиты; взятие — вход звездолётами последнего броска и карточка', () => {
    const s = board();
    s.owner[T('Квадрат поисков')] = 0;
    s.ships[T('Квадрат поисков')] = 6;
    s.owner[T('Горы изломов')] = 1;
    s.ships[T('Горы изломов')] = 2;
    const rng = new RiggedRng(new SeededRng(1));
    rng.rig([5, 3, 1, 4, 3]); // 6 4 2 против 5 4
    const a = apply(s, 0, { type: 'attack', from: T('Квадрат поисков'), to: T('Горы изломов'), dice: 3 }, rng)!.state;
    expect(a.ships[T('Квадрат поисков')]).toBe(5);
    expect(a.ships[T('Горы изломов')]).toBe(1);
    rng.rig([5, 3, 1, 2]);
    const b = apply(a, 0, { type: 'attack', from: T('Квадрат поисков'), to: T('Горы изломов'), dice: 3 }, rng)!.state;
    expect(b.owner[T('Горы изломов')]).toBe(0);
    expect(b.ships[T('Горы изломов')]).toBe(3);
    expect(b.ships[T('Квадрат поисков')]).toBe(2);
    expect(b.hand[0]!.length).toBe(1);
  });

  it('с территории с одним звездолётом не нападают; соседство обязательно', () => {
    const s = board();
    s.owner[T('Квадрат поисков')] = 0;
    s.ships[T('Квадрат поисков')] = 1;
    expect(apply(s, 0, { type: 'attack', from: T('Квадрат поисков'), to: T('Горы изломов'), dice: 1 }, new SeededRng(1))).toBeNull();
    s.ships[T('Квадрат поисков')] = 5;
    expect(apply(s, 0, { type: 'attack', from: T('Квадрат поисков'), to: T('Глубинный район'), dice: 3 }, new SeededRng(1))).toBeNull();
  });

  it('обмен карточек: 4/6/8, по одной — 10, джокер — 12', () => {
    const s = board();
    const mil = [T('Синий континент'), T('Зона холмов'), T('Опасный район')];
    expect(tradeValue(s, mil)).toBe(4);
    expect(tradeValue(s, [T('Долина ветров'), T('Лувер'), T('Морской район')])).toBe(6);
    expect(tradeValue(s, [T('Материк бурь'), T('Зелёная зона'), T('Тёмная равнина')])).toBe(8);
    expect(tradeValue(s, [T('Синий континент'), T('Лувер'), T('Материк бурь')])).toBe(10);
    expect(tradeValue(s, [42, T('Синий континент'), T('Зона холмов')])).toBe(12);
    expect(setKind([42, T('Синий континент'), T('Лувер')])).toBeNull();
  });

  it('пять карточек — обмен обязателен до освоения', () => {
    const s = board();
    s.phase = 'reinforce';
    s.hand[0] = [T('Синий континент'), T('Зона холмов'), T('Опасный район'), T('Лувер'), T('Материк бурь')];
    expect(apply(s, 0, { type: 'go' }, new SeededRng(1))).toBeNull();
    const a = apply(s, 0, { type: 'trade', cards: [T('Синий континент'), T('Зона холмов'), T('Опасный район')] }, new SeededRng(1))!.state;
    expect(a.pending).toBe(4);
  });

  it('цель «две планеты» и победа сразу', () => {
    const s = board();
    s.goal[0] = 3; // Тариэль-7 и Трон-3
    for (const t of [...PLANET_TERRS[3], ...PLANET_TERRS[2]]) s.owner[t] = 0;
    expect(goalDone(s, 0)).toBe(true);
    s.owner[PLANET_TERRS[2][0]] = 1;
    expect(goalDone(s, 0)).toBe(false);
  });

  it('вдвоём: союзник занимает 14 территорий по 2, получает половину подкреплений', () => {
    const s = newState(2, cfgFrom({ mode: 'duel' }), new SeededRng(4));
    expect(s.owner.filter((o) => o === 2).length).toBe(14);
    expect(s.pending).toBe(26);
    expect(s.deck.length).toBe(42);
  });

  it('шансы боя: 3 против 1 почти наверняка, 1 против 2 — плохо', () => {
    expect(winProb(5, 1)).toBeGreaterThan(0.95);
    expect(winProb(1, 2)).toBeLessThan(0.15);
  });

  it('боты доигрывают все варианты', () => {
    for (const [mode, n] of [
      ['goals', 3],
      ['goals', 4],
      ['duel', 2],
      ['galaxy', 3],
    ] as const) {
      const rng = new SeededRng(77);
      let s = newState(n, cfgFrom({ mode, limit: 30 }), rng);
      let k = 0;
      while (s.phase !== 'over' && k < 30000) {
        const p = toAct(s)[0];
        const a = choose(view(s, [p]), p, k % 3, rng)!;
        const r = apply(s, p, a, rng);
        expect(r, `${mode}: ${JSON.stringify(a)} в фазе ${s.phase}`).not.toBeNull();
        s = r!.state;
        k++;
      }
      expect(s.phase).toBe('over');
    }
  });
});
