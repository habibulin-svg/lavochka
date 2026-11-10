import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def, DEMOS } from '../src/games/chizh/def';
import { botInput } from '../src/games/chizh/ai';
import { BODY } from '../src/core/dvorsport/sim';
import { chFlight, cleanInput, hitQuality, inKon, newGame, popBody, step, SWING, throwBody, type Event, type In, type State } from '../src/games/chizh/engine';

/** Прогнать показ: события по шагам. */
function playDemo(d: (typeof DEMOS)[keyof typeof DEMOS]) {
  const rng = new SeededRng(20240607);
  let s = d.setup!(def as never, rng) as State;
  const out: Event[][] = [];
  for (const st of d.steps) {
    const r = def.apply(s, st.seat, st.action, rng);
    expect(r, st.caption).toBeTruthy();
    s = r!.state;
    out.push((r!.events[0] as unknown as { evs: Event[][] }).evs.flat());
  }
  return { s, out };
}
const has = (evs: Event[], k: Event['k']) => evs.some((e) => e.k === k);

describe('чиж: физика', () => {
  it('подбитый чиж проходит «пояс», в пояс — качество 1', () => {
    const f = chFlight(popBody(0, 0));
    expect(Math.max(...f.frames.map((q) => q[3]))).toBeGreaterThan(SWING.best + 0.1);
    expect(hitQuality(SWING.best)).toBe(1);
    expect(hitQuality(0.05)).toBeNull();
  });
  it('бросок в кон: с 15 м есть сила, при которой чиж ложится в кон', () => {
    const c = newGame({}, [0, 1]).cfg;
    let ok = false;
    for (let p = 0; p <= 1; p += 0.01) if (inKon(c, ...(chFlight(throwBody(-5, 15, p, 0)).rest.slice(0, 2) as [number, number]))) ok = true;
    expect(ok).toBe(true);
  });
  it('ввод чистится', () => {
    expect(cleanInput({ mx: 5, my: -9, th: { n: 2, pow: 3, yaw: -4 }, s: 1.4 })).toEqual({ mx: 1, my: -1, th: { n: 2, pow: 1, yaw: -1 }, s: 1 });
    expect(cleanInput(null)).toBeNull();
  });
});

describe('чиж: показы правил дают то, что в подписи', () => {
  it('подбил — бей: удар и чиж в поле', () => {
    const { s, out } = playDemo(DEMOS.kon);
    expect(has(out[0], 'pop')).toBe(true);
    expect(has(out[1], 'hit')).toBe(true);
    expect(s.phase).toBe('field');
  });
  it('рано махнул — промах', () => {
    const { s, out } = playDemo(DEMOS.miss);
    expect(has(out[1], 'whiff')).toBe(true);
    expect(has(out[1], 'miss')).toBe(true);
    expect(s.tries).toBe(2);
  });
  it('поймал с лёта — бьёт Вова', () => {
    const { s, out } = playDemo(DEMOS.catch);
    expect(out[1].find((e) => e.k === 'catch')).toMatchObject({ who: 1 });
    expect(s.batter).toBe(1);
  });
  it('бросок в кон — бьёт Вова', () => {
    const { s, out } = playDemo(DEMOS.throw);
    expect(has(out[0], 'pick')).toBe(true);
    expect(out[1].find((e) => e.k === 'kon')).toMatchObject({ who: 1 });
    expect(s.batter).toBe(1);
  });
  it('отбил бросок — чиж не в кону, добивание', () => {
    const { s, out } = playDemo(DEMOS.def);
    expect(has(out[1], 'def')).toBe(true);
    expect(has(out[1], 'kon')).toBe(false);
    expect(s.phase).toBe('bonus');
  });
  it('добивание и мерки', () => {
    const { out } = playDemo(DEMOS.bonus);
    expect(has(out[1], 'hit')).toBe(true);
    expect((out[2].find((e) => e.k === 'score') as { pts: number }).pts).toBeGreaterThan(5);
  });
  it('город: очки сгорели, бьёт Вова', () => {
    const { s, out } = playDemo(DEMOS.gorod);
    expect(out[0].find((e) => e.k === 'kon')).toMatchObject({ who: 1, burnt: 3 });
    expect(s.men[0].score).toBe(0);
    expect(s.batter).toBe(1);
  });
});

describe('чиж: боты', () => {
  /** Партия ботов: уровни по местам, сколько минут игры. */
  function game(levels: number[], seed: number, opts: Record<string, string | number | boolean> = {}) {
    const s = newGame({ speed: 1, ...opts }, levels.map((_, i) => i), 1);
    const rng = new SeededRng(seed);
    const brng = new SeededRng(seed * 31 + 7);
    const mem = levels.map(() => ({}));
    let t = 0;
    while (!s.over && t < 60 * 60 * 30) {
      const inp: In[] = levels.map((lv, i) => botInput(JSON.parse(JSON.stringify(s)), i, lv, mem[i], brng));
      step(s, inp, rng);
      t++;
    }
    return { s, min: t / 3600 };
  }
  it('сильный обыгрывает слабого чаще', () => {
    let hard = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { s } = game(seed % 2 ? [2, 0] : [0, 2], seed, { target: 100 });
      expect(s.over).toBe(true);
      if (s.winners.includes(seed % 2 ? 0 : 1)) hard++;
    }
    expect(hard).toBeGreaterThanOrEqual(4);
  });
  it('розыгрыш у ботов кончается быстрее 25 с (и на 6 игроках), таймаутов ожидания нет', () => {
    for (const n of [3, 6]) {
      const s = newGame({}, Array.from({ length: n }, (_, i) => i));
      expect(s.speed).toBe(1);
      const rng = new SeededRng(11 + n);
      const brng = new SeededRng(5 + n);
      const mem = s.seats.map(() => ({}));
      let run = 0;
      let worst = 0;
      let slow = 0;
      for (let t = 0; t < 60 * 60 * 20 && !s.over; t++) {
        const inp: In[] = s.seats.map((seat, i) => botInput(JSON.parse(JSON.stringify(s)), seat, i % 3, mem[i], brng));
        slow += step(s, inp, rng).filter((e) => e.k === 'slow').length;
        run = s.phase === 'tee' || s.phase === 'pause' ? 0 : run + 1 / 60;
        worst = Math.max(worst, run);
      }
      expect(s.over).toBe(true);
      expect(worst).toBeLessThan(25);
      expect(slow).toBe(0);
    }
  });
  it('обучение: «подожди» во вводе — время стоит, свой пацан бегает, подбив проходит', () => {
    const s = newGame({}, [0, 1, 2]);
    const rng = new SeededRng(1);
    const t0 = s.t;
    for (let k = 0; k < 60; k++) step(s, [{ mx: 0, my: 0, hold: true }, { mx: 1, my: 0 }, null], rng);
    expect(s.t).toBe(t0);
    expect(s.men[1].x).toBeCloseTo(newGame({}, [0, 1, 2]).men[1].x);
    step(s, [{ mx: 0, my: 0, hold: true, th: { n: 1, pow: 0.9, yaw: 0 } }, null, null], rng);
    expect(s.phase).toBe('pop');
  });
  it('на старте никто не стоит друг в друге', () => {
    const s = newGame({}, [0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) expect(Math.hypot(s.men[i].x - s.men[j].x, s.men[i].y - s.men[j].y)).toBeGreaterThan(2 * BODY.r);
  });
  it('город доигрывается', () => {
    const { s, min } = game([1, 1, 1], 5, { kon: 'square', score: 'hits', burn: true, targetHits: 5 });
    expect(s.over).toBe(true);
    expect(min).toBeLessThan(25);
  });
});
