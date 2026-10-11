/* «За рулём»: машинки едут по диску, по траве вязнут, опоры эстакады, знаки, заборчики — авария; гонка до N кругов, на дальность —
 * три аварии и сход. Боты держат дорогу, сильный обгоняет слабого. */
import { describe, expect, it } from 'vitest';
import { botInput } from '../src/games/zarulem/ai';
import { def } from '../src/games/zarulem/def';
import { cleanInput, hitAt, newGame, onRoad, step, TAU, track, type TrackId, type ZrIn, type ZrState } from '../src/games/zarulem/engine';
import { SeededRng } from '../src/core/rng';

const TRACKS: TrackId[] = ['wide', 'narrow'];

/** Прогон ботов: levels — уровень каждого места. */
function run(st: ZrState, levels: number[], maxSec = 600) {
  const rng = new SeededRng(5);
  const mem = levels.map(() => ({}));
  const crashes: string[] = [];
  for (let i = 0; i < maxSec * 60 && !st.over; i++) {
    const inp = st.cars.map((c) => cleanInput(JSON.parse(JSON.stringify(botInput(st, c.seat, levels[c.seat], mem[c.seat], rng)))));
    for (const e of step(st, inp)) if (e.k === 'crash') crashes.push(`${e.seat}:${e.why}@${st.cars[e.seat].a.toFixed(2)}`);
  }
  return crashes;
}

describe('За рулём', () => {
  it('трасса: препятствия не на дороге, старт свободен', () => {
    for (const id of TRACKS) {
      const t = track(id);
      for (const o of t.solid) expect(onRoad(t, o.a, o.r), `${id} ${o.kind}`).toBe(false);
      const st = newGame([0, 1, 2, 3], 'race', id, 3, 0);
      for (const c of st.cars) {
        expect(onRoad(t, c.a, c.r)).toBe(true);
        expect(hitAt(t, c.a, c.r)).toBeNull();
      }
      // вся дорога (машинка по самый край) свободна от опор, знаков и заборов
      for (let a = 0; a < TAU; a += 0.01)
        for (const k of [-1, 0, 1]) expect(hitAt(t, a, t.rc(a) + k * t.w), `${id} ${a.toFixed(2)} ${k}`).toBeNull();
    }
  });

  it('отсчёт, потом едет; по траве вязнет, но не разбивается; опора — авария', () => {
    const st = newGame([0], 'race', 'wide', 3, 0);
    const go: ZrIn[] = [{ s: 0, g: 2 }];
    const ev = [];
    for (let i = 0; i < 200; i++) ev.push(...step(st, go));
    expect(ev.filter((e) => e.k === 'count').map((e) => (e as { n: number }).n)).toEqual([3, 2, 1]);
    expect(ev.some((e) => e.k === 'go')).toBe(true);
    expect(st.cars[0].w).toBeGreaterThan(0);
    // у самого центра — трава, там ничего не стоит: едет медленно, без аварий
    st.cars[0].r = 0.2;
    for (let i = 0; i < 60 * 8; i++) step(st, [{ s: 1, g: 2 }]);
    expect(st.cars[0].crashes).toBe(0);
    expect(st.cars[0].w).toBeLessThan(0.25);
    // прямо на опору эстакады
    const p = track('wide').pillars[0];
    Object.assign(st.cars[0], { a: p.a - 0.12 + TAU * 2, r: p.r, w: 0.3 });
    let why = '';
    for (let i = 0; i < 60 * 3 && !why; i++) for (const e of step(st, [{ s: 0, g: 1 }])) if (e.k === 'crash') why = e.why;
    expect(why).toBe('pillar');
    expect(st.cars[0].stun).toBeGreaterThan(0);
  });

  it('на дальность: три аварии — сход, партия кончается', () => {
    const st = newGame([0], 'distance', 'wide', 3, 0);
    // рулить к опорам: машинка у самого центра не держится — гоним её на внутренние опоры
    const p = track('wide').pillars.filter((x) => x.r < 0.5)[0];
    for (let n = 0; n < 3; n++) {
      Object.assign(st.cars[0], { a: p.a - 0.2 + TAU * (n + 1), r: p.r, stun: 0 });
      for (let i = 0; i < 60 * 4 && st.cars[0].crashes <= n; i++) step(st, [{ s: 0, g: 1 }]);
    }
    for (let i = 0; i < 60 * 5 && !st.over; i++) step(st, [{ s: 0, g: 0 }]);
    expect(st.over).toBe(true);
    expect(st.cars[0].out).toBe(true);
    expect(st.cars[0].crashes).toBe(3);
    expect(def.result(st)?.winners).toEqual([0]);
  });

  it('сильный бот проезжает гонку почти без аварий на обеих трассах', () => {
    for (const id of TRACKS) {
      const st = newGame([0], 'race', id, 5, 0);
      const crashes = run(st, [2]);
      expect(st.over, id).toBe(true);
      expect(st.cars[0].fin, id).toBeGreaterThan(0);
      expect(crashes.length, `${id}: ${crashes.join(' ')}`).toBeLessThanOrEqual(1);
    }
  });

  it('сильный обгоняет слабого', () => {
    let strong = 0;
    for (const id of TRACKS) {
      const st = newGame([0, 1], 'race', id, 5, 0);
      run(st, [0, 2]);
      const res = def.result(st)!;
      if (res.winners[0] === 1) strong++;
    }
    expect(strong).toBe(2);
  });

  it('вчетвером — машинки толкаются, но гонка доезжает', () => {
    const st = newGame([0, 1, 2, 3], 'race', 'narrow', 3, 0);
    run(st, [2, 1, 1, 0]);
    expect(st.over).toBe(true);
    expect(st.cars.filter((c) => c.fin >= 0).length).toBeGreaterThanOrEqual(3);
  });

  it('ввод по сети проверяется', () => {
    expect(cleanInput({ s: 5, g: 2 })).toEqual({ s: 1, g: 2 });
    expect(cleanInput({ s: 'x', g: 7 })).toEqual({ s: 0, g: -1 });
    expect(cleanInput(null)).toBeNull();
  });
});
