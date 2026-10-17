/* «Астронавты»: разметка, взлёт с потерей 2 очков, карточки, пропуски, викторина второго варианта, маршрут и возвращение на Землю. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { CARDS, HOME, POINTS, ROUTE, cardAt } from '../src/games/astro/data';
import { choose } from '../src/games/astro/def';
import { apply, newState, rightAnswer, type Action, type State } from '../src/games/astro/engine';

const rng = (seed = 3) => new RiggedRng(new SeededRng(seed));

function act(s: State, seat: number, a: Action, rig?: number[]): State {
  const r = rng();
  if (rig) r.rig(rig);
  const res = apply(s, seat, a, r);
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
}
/** Бросок; если корабль летит — игрок сам переставляет его (move). */
const roll = (s: State, seat: number, d: number) => {
  const r = act(s, seat, { type: 'roll' }, [d - 1]);
  return r.phase === 'move' ? act(r, seat, { type: 'move' }) : r;
};

describe('Астронавты', () => {
  it('ход сам: после броска корабль стоит, пока игрок его не переставит', () => {
    let s = newState([0, 1]);
    s = act(s, 0, { type: 'roll' }, [4]);
    expect(s.phase).toBe('move');
    expect(s.pos[0]).toBe(0);
    expect(s.target).toBe(3);
    expect(apply(s, 0, { type: 'roll' }, rng())).toBeNull();
    expect(choose(s, 0, 1, rng())).toEqual({ type: 'move' });
    s = act(s, 0, { type: 'move' });
    expect(s.pos[0]).toBe(3);
    expect(s.turn).toBe(1);
  });

  it('разметка: Земля и 190 точек, карточки и маршрут на разных точках', () => {
    expect(POINTS.length).toBe(191);
    expect(HOME).toBe(191);
    expect(CARDS.length).toBe(40);
    const cardNs = new Set(CARDS.map((c) => c.n));
    for (const r of ROUTE) expect(cardNs.has(r.n), `точка ${r.n}`).toBe(false);
    // соседние точки — не дальше, чем линия на поле
    for (let i = 1; i < POINTS.length; i++) {
      const d = Math.hypot(POINTS[i][0] - POINTS[i - 1][0], POINTS[i][1] - POINTS[i - 1][1]);
      expect(d, `${i - 1}→${i}`).toBeLessThan(380);
      expect(d).toBeGreaterThan(50);
    }
  });

  it('взлёт: минус 2 очка с первого хода', () => {
    let s = newState([0, 1], { variant: 'cards' });
    s = roll(s, 0, 2);
    expect(s.pos[0]).toBe(0);
    s = roll(s, 1, 5);
    expect(s.pos[1]).toBe(3);
    s = roll(s, 0, 4);
    expect(s.pos[0]).toBe(4);
  });

  it('карточка: очки в следующем ходе, пропуск хода', () => {
    let s = newState([0, 1], { variant: 'cards' });
    s.pos = [3, 15];
    s.bonus = [0, 0];
    s = roll(s, 0, 2);
    expect(s.pos[0]).toBe(5);
    expect(s.bonus[0]).toBe(2);
    s = roll(s, 1, 4);
    expect(s.pos[1]).toBe(19);
    expect(s.skip[1]).toBe(1);
    s = roll(s, 0, 3);
    expect(s.pos[0]).toBe(10);
    // Ленка пропускает — снова Вовка
    expect(s.turn).toBe(0);
    expect(s.skip[1]).toBe(0);
  });

  it('второй вариант: название и звёзды — 5 очков, только созвездие — минус 1, ошибка — минус 2', () => {
    let s = newState([0, 1], { variant: 'quiz', route: true });
    s.pos = [3, 60];
    s.bonus = [0, 0];
    s = roll(s, 0, 2);
    expect(s.phase).toBe('quiz');
    expect(s.quiz!.options).toContain('Орион');
    const s1 = act(s, 0, { type: 'answer', pick: 'Орион' });
    expect(s1.quiz!.step).toBe('stars');
    const ok = act(s1, 0, { type: 'answer', pick: rightAnswer(s1.quiz!) });
    expect(ok.bonus[0]).toBe(5);
    expect(ok.turn).toBe(1);
    const wrongStars = act(s1, 0, { type: 'answer', pick: s1.quiz!.options.find((o) => o !== rightAnswer(s1.quiz!))! });
    expect(wrongStars.bonus[0]).toBe(-1);
    const wrong = act(s, 0, { type: 'answer', pick: s.quiz!.options.find((o) => o !== 'Орион')! });
    expect(wrong.bonus[0]).toBe(-2);
    // планета — одно очко, созвездие без ориентиров — два
    let p = newState([0, 1], { variant: 'quiz' });
    p.pos = [8, 0];
    p.bonus = [0, 0];
    p = roll(p, 0, 2);
    expect(cardAt(10)!.planet).toBe(true);
    expect(act(p, 0, { type: 'answer', pick: 'Венера' }).bonus[0]).toBe(1);
    let k = newState([0, 1], { variant: 'quiz' });
    k.pos = [12, 0];
    k.bonus = [0, 0];
    k = roll(k, 0, 2);
    expect(act(k, 0, { type: 'answer', pick: 'Телец' }).bonus[0]).toBe(2);
  });

  it('маршрут второго варианта: пропуск и прибавка', () => {
    let s = newState([0, 1], { variant: 'quiz', route: true });
    s.pos = [25, 46];
    s.bonus = [0, 0];
    s = roll(s, 0, 3);
    expect(s.skip[0]).toBe(1);
    s = roll(s, 1, 4);
    expect(s.bonus[1]).toBe(2);
    expect(s.turn).toBe(1);
    s = roll(s, 1, 1);
    expect(s.pos[1]).toBe(53);
    // в первом варианте без настройки маршрута кружки ничего не делают
    let c = newState([0, 1], { variant: 'cards' });
    c.pos = [25, 0];
    c.bonus = [0, 0];
    c = roll(c, 0, 3);
    expect(c.skip[0]).toBe(0);
  });

  it('возвращение на Землю: с перелётом и точным броском', () => {
    let s = newState([0, 1], { variant: 'cards' });
    s.pos = [187, 0];
    s.bonus = [0, 0];
    s = roll(s, 0, 6);
    expect(s.winner).toBe(0);
    let e = newState([0, 1], { variant: 'cards', exact: true });
    e.pos = [187, 0];
    e.bonus = [0, 0];
    e = roll(e, 0, 6);
    expect(e.winner).toBeNull();
    expect(e.pos[0]).toBe(187);
    e.turn = 0;
    e = roll(e, 0, 4);
    expect(e.winner).toBe(0);
  });

  it('бот отвечает правильно чаще на сложном уровне', () => {
    let s = newState([0, 1], { variant: 'quiz' });
    s.pos = [3, 0];
    s.bonus = [0, 0];
    s = roll(s, 0, 2);
    const hits = [0, 2].map((level) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const a = choose(s, 0, level, new SeededRng(i + 1)) as { type: 'answer'; pick: string };
        if (a.pick === 'Орион') n++;
      }
      return n;
    });
    expect(hits[1]).toBeGreaterThan(hits[0]);
  });
});
