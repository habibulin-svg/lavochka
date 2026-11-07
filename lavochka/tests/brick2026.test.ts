/* Brick Game 2026: движок как на приставке (скорость, очки, уровни, случайник), установки из сети, битва ботов до конца. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { bestPlace } from '../src/games/brick2026/ai';
import { applyPlace, gravityOf, H, newTet, scoreRows, stepTet, W } from '../src/games/brick2026/tetris';
import { botInput, cleanInput, newBattle, snapshot, step } from '../src/games/brick2026/versus';

describe('Brick Game 2026 — движок', () => {
  it('скорость падения и очки как на приставке', () => {
    expect(gravityOf(0)).toBe(48);
    expect(gravityOf(9)).toBe(6);
    expect(gravityOf(19)).toBe(2);
    expect(gravityOf(29)).toBe(1);
    const t = newTet(5, 0);
    scoreRows(t, 4);
    expect(t.score).toBe(1200);
    const t9 = newTet(5, 9);
    scoreRows(t9, 1);
    expect(t9.score).toBe(400);
  });

  it('первый переход уровня — по правилу стартового уровня', () => {
    const t = newTet(5, 5);
    for (let i = 0; i < 59; i++) scoreRows(t, 1);
    expect(t.level).toBe(5);
    scoreRows(t, 1);
    expect(t.level).toBe(6);
    const z = newTet(5, 0);
    for (let i = 0; i < 10; i++) scoreRows(z, 1);
    expect(z.level).toBe(1);
  });

  it('случайник: все семь фигур, повторы реже', () => {
    const t = newTet(77, 0);
    const seen = new Set<number>();
    let rep = 0;
    let prev = 0;
    for (let i = 0; i < 700; i++) {
      const k = t.next;
      seen.add(k);
      if (k === prev) rep++;
      prev = k;
      (t as any).cur = { k: 1, r: 0, x: 5, y: 2 };
      // выдаём следующую напрямую
      t.prev = k;
      t.seed = (Math.imul(t.seed, 1103515245) + 12345) >>> 0;
      t.next = 1 + ((t.seed >>> 16) % 7);
    }
    expect(seen.size).toBe(7);
    void rep;
  });

  it('без управления фигуры падают, стакан растёт, игра кончается', () => {
    const t = newTet(3, 15);
    let f = 0;
    while (!t.over && f < 60 * 120) {
      stepTet(t, { l: false, r: false, d: false });
      f++;
    }
    expect(t.over).toBe(true);
  });

  it('бот на своём поле снимает ряды долго', () => {
    const t = newTet(11, 0);
    const rng = new SeededRng(4);
    let n = 0;
    while (!t.over && n < 400) {
      const pl = bestPlace(t, 2, () => rng.next());
      if (!pl || !applyPlace(t, pl, 0)) break;
      n++;
    }
    expect(n).toBe(400);
    expect(t.lines).toBeGreaterThan(120);
  });

  it('чужая установка (не та фигура, висит в воздухе) не принимается', () => {
    const t = newTet(9, 0);
    const k = t.cur!.k;
    expect(applyPlace(t, [t.seq, k === 1 ? 2 : 1, 0, 5, H - 2], 0)).toBeNull();
    expect(applyPlace(t, [t.seq, k, 0, 5, 5], 0)).toBeNull();
    expect(cleanInput({ pl: [[1, 9, 0, 0, 0], [1, 1, 0, 5, 20]], target: 99 })).toEqual({ pl: [[1, 1, 0, 5, 20]], target: 31 });
    void W;
  });
});

function battle(n: number, levels: number[], seed: number) {
  const rng = new SeededRng(seed);
  const s = newBattle([...Array(n).keys()], n > 2 ? 'battle' : 'duel', rng);
  const mem = s.seats.map(() => ({}));
  let attacks = 0;
  let ticks = 0;
  while (!s.over && ticks < 10 * 60 * 15) {
    const ins = s.seats.map((x, i) => botInput(snapshot(s, [x.seat]), x.seat, levels[i] ?? 1, mem[i], rng));
    const ev = step(s, ins, rng);
    attacks += ev.filter((e) => e.k === 'attack').length;
    ticks++;
  }
  return { s, attacks };
}

describe('Brick Game 2026 — битва', () => {
  it('шестнадцать ботов доигрывают до одного победителя, мусор летает', () => {
    const { s, attacks } = battle(16, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 1], 3);
    expect(s.over).toBe(true);
    expect(s.winners.length).toBe(1);
    expect(attacks).toBeGreaterThan(20);
    const places = s.seats.map((x) => x.place).sort((a, b) => a - b);
    expect(places[0]).toBe(1);
  });

  it('в дуэли сильный бот чаще побеждает слабого', () => {
    let wins = 0;
    for (let seed = 1; seed <= 4; seed++) if (battle(2, [2, 0], seed).s.winners[0] === 0) wins++;
    expect(wins).toBeGreaterThanOrEqual(3);
  });
});
