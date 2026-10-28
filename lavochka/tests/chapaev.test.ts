/* Чапаев и карром: физика (трение, удар, падение за край, лузы), повторный удар, раунды и сдвиг рядов, карром — королева и штраф, боты. */
import { describe, expect, it } from 'vitest';
import { breather } from './harness';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/chapaev/ai';
import * as cp from '../src/games/chapaev/engine';
import { simulate } from '../src/games/chapaev/physics';

describe('Чапаев', () => {
  it('физика: шашка останавливается, удар передаётся, за краем — падает', () => {
    const r = simulate(cp.CH_FIELD, [{ id: 0, x: 4, y: 7.5, r: 0.4, m: 1, vx: 0, vy: -3 }], 0);
    expect(r.discs[0].gone).toBeUndefined();
    expect(r.discs[0].y).toBeLessThan(7.5);
    const hit = simulate(
      cp.CH_FIELD,
      [
        { id: 0, x: 4, y: 7.5, r: 0.4, m: 1, vx: 0, vy: -12 },
        { id: 1, x: 4, y: 0.5, r: 0.4, m: 1, vx: 0, vy: 0 },
      ],
      0
    );
    expect(hit.first).toBe(1);
    expect(hit.discs[1].gone).toBe('off');
    expect(hit.discs[0].gone).toBeUndefined();
    // одинаковый удар — одинаковый итог
    const again = simulate(cp.CH_FIELD, [{ id: 0, x: 4, y: 7.5, r: 0.4, m: 1, vx: 0.3, vy: -12 }], 0);
    const again2 = simulate(cp.CH_FIELD, [{ id: 0, x: 4, y: 7.5, r: 0.4, m: 1, vx: 0.3, vy: -12 }], 0);
    expect(again.discs).toEqual(again2.discs);
  });

  it('выбил и осталась — бьёшь ещё; строго по очереди — переход', () => {
    const s = cp.setup({});
    s.pieces = [
      { id: 3, o: 0, x: 3.5, y: 7.5 },
      { id: 4, o: 0, x: 5.5, y: 7.5 },
      { id: 11, o: 1, x: 3.5, y: 0.5 },
      { id: 12, o: 1, x: 6.5, y: 0.5 },
    ];
    const r = cp.apply(s, 0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.95 })!;
    const ev = r.events.find((e) => e.type === 'shot') as Extract<cp.Event, { type: 'shot' }>;
    expect(ev.gone).toContain(11);
    expect(ev.again).toBe(true);
    expect(r.state.turn).toBe(0);
    const t = cp.setup({ strict: true });
    t.pieces = s.pieces.map((p) => ({ ...p }));
    expect(cp.apply(t, 0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.95 })!.state.turn).toBe(1);
  });

  it('раунд: победитель сдвигает ряд (без потерь — на два)', () => {
    const s = cp.setup({});
    s.pieces = [...s.pieces.filter((p) => p.o === 0), { id: 11, o: 1, x: 3.5, y: 0.5 }];
    const r = cp.apply(s, 0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.95 })!;
    expect(r.state.line[0]).toBe(2);
    expect(r.state.round).toBe(2);
    expect(r.state.pieces.filter((p) => p.o === 0).every((p) => p.y === 5.5)).toBe(true);
  });

  it('карром: забил свою — ещё удар; биток в лузе — штраф', () => {
    const s = cp.setup({ mode: 'carrom' });
    // одна своя фишка у лузы, биток бьёт её точно в лузу
    s.pieces = [
      { id: 1, o: 0, x: 1.0, y: 1.0 },
      { id: 2, o: 1, x: 6, y: 3 },
      { id: 3, o: 0, x: 6, y: 5 },
    ];
    const sx = 4;
    const by = cp.CR.base;
    const ang = Math.atan2(1.0 - by, 1.0 - sx);
    const r = cp.apply(s, 0, { type: 'strike', x: sx, angle: ang, power: 0.5 })!;
    expect(r.events.some((e) => e.type === 'foul')).toBe(false);
    const ev = r.events.find((e) => e.type === 'shot') as Extract<cp.Event, { type: 'shot' }>;
    expect(ev.gone).toContain(1);
    expect(r.state.turn).toBe(0);
    expect(r.state.pocketed[0]).toBe(1);
  });

  it('боты доигрывают Чапаева и карром', async () => {
    const breathe = breather();
    for (const mode of ['chapaev', 'carrom']) {
      const r = new SeededRng(3);
      let s = cp.setup({ mode, target: 13 });
      for (let i = 0; i < 2000 && !s.over; i++) {
        await breathe();
        const a = choose(s, s.turn, i % 2 ? 1 : 2, r)!;
        const res = cp.apply(s, s.turn, a);
        expect(res, `${mode} ${JSON.stringify(a)}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, mode).toBe(true);
    }
  }, 300000);
});
