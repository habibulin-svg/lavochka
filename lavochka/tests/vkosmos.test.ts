/* «В космос»: разметка поля, вопросы, взлёт, полёт и топливо, движение планет, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/vkosmos/ai';
import { apply, BIG, cfgFrom, isRight, makeQuestion, newState, rightOf, setup, START, toAct } from '../src/games/vkosmos/engine';
import { CATEGORIES, PLANETS, TECH, WORDS } from '../src/games/vkosmos/quiz';
import * as vk from '../src/games/vkosmos/engine';

describe('В космос', () => {
  it('поле: 6/10/18 больших кружков, «Старт» на Земле; вопросы на месте', () => {
    expect(BIG.venus.length).toBe(6);
    expect(BIG.earth.length).toBe(10);
    expect(BIG.mars.length).toBe(18);
    expect(BIG.earth).toContain(START);
    expect(CATEGORIES.length).toBe(10);
    expect(WORDS.length).toBe(10);
    expect(PLANETS.length).toBe(10);
    expect(TECH.length).toBe(10);
  });

  it('вопрос: ровно один верный вариант', () => {
    const rng = new SeededRng(4);
    for (let k = 0; k < 200; k++) {
      const q = makeQuestion((['depart', 'planets', 'tech'] as const)[k % 3], rng);
      expect(q.options.filter((_, i) => isRight(q, i)).length).toBe(1);
    }
  });

  it('взлёт после верного ответа, полёт тратит бак', () => {
    const rng = new SeededRng(7);
    let s = newState(cfgFrom({}), 1, rng);
    expect(s.phase).toBe('question');
    s = apply(s, 0, { type: 'answer', i: rightOf(s.question!) }, rng)!.state;
    expect(s.phase).toBe('roll');
    s = apply(s, 0, { type: 'roll' }, rng)!.state;
    expect(s.phase).toBe('move');
    const fuel = s.ships[0].fuel;
    s = apply(s, 0, { type: 'move', i: 0 }, rng)!.state;
    expect(s.ships[0].fuel).toBeLessThan(fuel);
  });

  it('не ответил — остаётся на Земле и едет с ней', () => {
    const rng = new SeededRng(8);
    let s = newState(cfgFrom({}), 1, rng);
    const wrong = s.question!.options.findIndex((_, i) => !isRight(s.question!, i));
    s = apply(s, 0, { type: 'answer', i: wrong }, rng)!.state;
    expect(s.ships[0].on).toBe('earth');
    expect(s.ships[0].node).not.toBe(START);
  });

  it('партии ботов доходят до конца', () => {
    for (const n of [1, 3]) {
      const rng = new SeededRng(n * 11);
      let s = setup({}, n, rng);
      for (let i = 0; i < 30000 && s.phase !== 'over'; i++) {
        const seat = toAct(s)[0];
        s = apply(s, seat, choose(s, seat, 1, rng)!, rng)!.state;
      }
      expect(s.phase).toBe('over');
    }
  }, 120000);
});

describe('В космос: уехал с Землёй — назад к «Старту» по орбите', () => {
  it('после взлёта не со «Старта» маршруты идут только по земной орбите, пока не пройден «Старт»', () => {
    const rng = new SeededRng(5);
    let s = vk.newState(vk.cfgFrom({}), 2, rng);
    // Земля сдвинулась: космолёт уехал с ней на соседний большой кружок
    const away = vk.BIG.earth[(vk.BIG.earth.indexOf(vk.START) + 2) % vk.BIG.earth.length];
    s.planets.earth = vk.BIG.earth.indexOf(away);
    s.ships[0].node = away;
    const q = s.question!;
    s = vk.apply(s, 0, { type: 'answer', i: vk.rightOf(q) }, rng)!.state;
    expect(s.ships[0].home).toBe(true);
    const routes = vk.routesFor(s, s.ships[0], 3);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const upto = r.path.includes(vk.START) ? r.path.slice(0, r.path.indexOf(vk.START) + 1) : r.path;
      let prev = s.ships[0].node;
      for (const n of upto) {
        expect(vk.LINKS[prev].some(([m, ch]) => m === n && ch === 'earth'), `шаг ${prev}→${n}`).toBe(true);
        prev = n;
      }
    }
  });
});
