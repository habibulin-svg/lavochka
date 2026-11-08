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

  it('щелчок: ряд не сносится одним ударом, сильный щелчок дрожит', () => {
    // удар вдоль плотного ряда со всей силы — слетает не больше двух
    const s = cp.setup({});
    s.pieces = [{ id: 0, o: 0, x: 0.5, y: 6.5 }, ...Array.from({ length: 7 }, (_, i) => ({ id: 8 + i, o: 1, x: 1.5 + i, y: 6.5 }))];
    const r = cp.shoot(s, { type: 'shot', id: 0, angle: 0, power: 1 })!;
    expect(r.discs.filter((d) => d.gone && d.id >= 8).length).toBeLessThanOrEqual(2);
    // полный щелчок одной шашки — через доску, но не дальше полутора досок
    const one = simulate(cp.CH_FIELD, [{ id: 0, x: 4, y: 7.5, r: 0.4, m: 1, vx: 0, vy: -cp.CH_MAX }], 0);
    expect(one.discs[0].gone).toBe('off');
    expect(cp.CH_MAX ** 2 / (2 * cp.CH_FIELD.friction)).toBeLessThan(12);
    // разброс: с rng угол уходит, у слабого меньше, чем у сильного
    expect(cp.spread(0.3)).toBeLessThan(cp.spread(1) / 2);
    const t = cp.setup({});
    const ev = cp.apply(t, 0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 1 }, new SeededRng(7))!.events[0] as Extract<cp.Event, { type: 'shot' }>;
    expect(ev.angle).not.toBe(-Math.PI / 2);
    expect(Math.abs(ev.angle + Math.PI / 2)).toBeLessThanOrEqual(cp.spread(1));
  });

  it('варианты: дом отбивает, лунка ловит медленную, танк тяжёлый, ветер сносит, песок вязнет', () => {
    // дом: прямой удар в коробку — шашка отскакивает назад
    const h = cp.setup({ houses: true });
    h.pieces = [{ id: 3, o: 0, x: 4, y: 6.2 }, { id: 11, o: 1, x: 4, y: 2.9 }];
    const rh = cp.shoot(h, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.8 })!;
    expect(rh.discs.find((d) => d.id === 3)!.y).toBeGreaterThan(cp.HOUSES[0].y + cp.HOUSES[0].hh);
    expect(rh.discs.find((d) => d.id === 11)!.gone).toBeUndefined();
    // ряд не встаёт на дом
    const h2 = cp.setup({ houses: true });
    h2.line = [3, 0];
    for (const p of cp.newState(h2.cfg, [0, 1]).pieces) for (const b of cp.HOUSES) expect(Math.abs(p.x - b.x) < b.hw + cp.CH_R && Math.abs(p.y - b.y) < b.hh + cp.CH_R).toBe(false);
    // лунка: медленная проваливается, быстрая проскакивает
    const tr = cp.TRAPS[0];
    const slow = simulate({ ...cp.CH_FIELD, traps: cp.TRAPS }, [{ id: 0, x: tr.x, y: 5.5, r: 0.4, m: 1, vx: 0, vy: -3.8 }], 0);
    expect(slow.discs[0].gone).toBe('trap');
    const fast = simulate({ ...cp.CH_FIELD, traps: cp.TRAPS }, [{ id: 0, x: tr.x, y: 5.5, r: 0.4, m: 1, vx: 0, vy: -8 }], 0);
    expect(fast.discs[0].gone).not.toBe('trap');
    // танки: стопка в рядах, вдвое тяжелее
    const tk = cp.setup({ tanks: true });
    expect(tk.pieces.filter((p) => p.t).length).toBe(4);
    tk.pieces = [{ id: 3, o: 0, x: 3.5, y: 3 }, { id: 11, o: 1, x: 3.5, y: 1.6, t: 1 }];
    const rt = cp.shoot(tk, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.6 })!;
    expect(rt.discs.find((d) => d.id === 11)!.gone).toBeUndefined();
    // а танк тем же щелчком простую выбивает
    tk.pieces = [{ id: 3, o: 0, x: 3.5, y: 3, t: 1 }, { id: 11, o: 1, x: 3.5, y: 1.6 }];
    expect(cp.shoot(tk, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.6 })!.discs.find((d) => d.id === 11)!.gone).toBe('off');
    // ветер: есть, сносит катящуюся, меняется при переходе хода
    const w = cp.setup({ wind: true });
    expect(w.wind).toBeDefined();
    const calm = cp.setup({});
    const a = { type: 'shot' as const, id: 3, angle: -Math.PI / 2, power: 0.5 };
    expect(cp.shoot(w, a)!.discs.find((d) => d.id === 3)!.x).not.toBeCloseTo(cp.shoot(calm, a)!.discs.find((d) => d.id === 3)!.x, 2);
    const w2 = cp.apply(w, 0, a)!.state;
    expect(w2.turn).toBe(1);
    expect(w2.wind).not.toEqual(w.wind);
    // песок: шашка вязнет раньше, чем на голой доске
    const z = cp.ZONES[1];
    const sand = simulate({ ...cp.CH_FIELD, zones: cp.ZONES }, [{ id: 0, x: z.x, y: 6.8, r: 0.4, m: 1, vx: 0, vy: -6.9 }], 0);
    const bare = simulate(cp.CH_FIELD, [{ id: 0, x: z.x, y: 6.8, r: 0.4, m: 1, vx: 0, vy: -6.9 }], 0);
    expect(sand.discs[0].y).toBeGreaterThan(bare.discs[0].y + 1);
  });

  it('король: сбил чужого — раунд твой, слетел свой — проиграл', () => {
    const s = cp.setup({ king: true });
    expect(s.pieces.filter((p) => p.k).map((p) => p.x)).toEqual([4.5, 4.5]);
    s.pieces = [
      { id: 4, o: 0, x: 4.5, y: 7.5, k: 1 },
      { id: 2, o: 0, x: 2.5, y: 2.2 },
      { id: 12, o: 1, x: 2.5, y: 0.9, k: 1 },
      { id: 13, o: 1, x: 5.5, y: 0.5 },
    ];
    const r = cp.apply(s, 0, { type: 'shot', id: 2, angle: -Math.PI / 2, power: 0.6 })!;
    const rd = r.events.find((e) => e.type === 'round') as Extract<cp.Event, { type: 'round' }>;
    expect(rd.winner).toBe(0);
    expect(r.state.line[0]).toBe(1);
    // свой король со своей же шашкой улетел — раунд сопернику
    const t = cp.setup({ king: true });
    t.pieces = [
      { id: 4, o: 0, x: 4.5, y: 7.2, k: 1 },
      { id: 2, o: 0, x: 4.5, y: 5.8 },
      { id: 13, o: 1, x: 5.5, y: 0.5 },
    ];
    const r2 = cp.apply(t, 0, { type: 'shot', id: 2, angle: Math.PI / 2, power: 0.6 })!;
    expect((r2.events.find((e) => e.type === 'round') as Extract<cp.Event, { type: 'round' }>).winner).toBe(1);
  });

  it('боты доигрывают все варианты Чапаева', async () => {
    const breathe = breather();
    const all: Record<string, boolean>[] = [{ houses: true }, { houses: true, king: true }, { traps: true }, { tanks: true }, { wind: true }, { terrain: true }];
    for (const opts of all) {
      const r = new SeededRng(5);
      let s = cp.setup(opts);
      for (let i = 0; i < 1500 && !s.over; i++) {
        await breathe();
        const a = choose(s, s.turn, i % 3, r)!;
        const res = cp.apply(s, s.turn, a, r);
        expect(res, `${JSON.stringify(opts)} ${JSON.stringify(a)}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, JSON.stringify(opts)).toBe(true);
    }
  }, 300000);

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
