/* «За рулём»: машинка на дороге набирает метры, по траве вязнет и после 2,5 с — авария, наезд на опору моста — авария, три аварии — конец. */
import { describe, expect, it } from 'vitest';
import { Drive, makeTrack, onRoad, pillars, TAU } from '../src/games/zarulem/logic';

describe('За рулём', () => {
  it('по середине дороги — едет и считает метры', () => {
    for (const mode of ['outer', 'inner'] as const) {
      const d = new Drive(mode);
      d.on = true;
      expect(d.onRoad).toBe(true);
      d.update(200, 0);
      expect(d.meters).toBeGreaterThan(0);
    }
  });
  it('по траве — авария через 2,5 с', () => {
    const d = new Drive('outer');
    d.on = true;
    d.pos = 0.3;
    expect(d.onRoad).toBe(false);
    for (let i = 0; i < 40 && !d.crashes; i++) d.update(100, 0);
    expect(d.crashes).toBe(1);
    expect(d.stun).toBeGreaterThan(0);
  });
  it('опора моста — авария; три аварии — конец', () => {
    const d = new Drive('outer');
    d.on = true;
    const p = pillars(d.track)[0];
    d.rot = -p.phi;
    d.pos = p.r;
    d.update(16, 0);
    expect(d.crashes).toBe(1);
    d.crashes = 2;
    d.stun = 0;
    d.rot = -p.phi;
    d.pos = p.r;
    d.update(16, 0);
    expect(d.over).toBe(true);
  });
  it('идеальный водитель проезжает круг по середине без аварий', () => {
    for (const mode of ['outer', 'inner'] as const) {
      const d = new Drive(mode);
      d.on = true;
      d.gear = 2;
      const main = d.track.paths[0];
      for (let i = 0; i < 4000 && d.laps < 1; i++) {
        // держим середину основной дороги, объезжая препятствия на ней сбоку
        const phi = d.phi();
        const ahead = d.track.things.filter((t) => t.size && Math.abs(((t.phi - phi + TAU * 1.5) % TAU) - Math.PI) < 0.25);
        let target = main.r(phi);
        for (const t of ahead) if (Math.abs(t.r - target) < 0.058) target = t.r >= main.r(t.phi) ? t.r - 0.058 : t.r + 0.058;
        d.pos = target;
        d.update(16, 0);
      }
      expect(d.laps, mode).toBeGreaterThanOrEqual(1);
      expect(d.crashes, mode).toBe(0);
    }
  });
  it('деревья не стоят на дороге', () => {
    for (const mode of ['outer', 'inner'] as const) {
      const t = makeTrack(mode);
      for (const th of t.things) if (th.kind === 'tree') expect(onRoad(t, th.phi, th.r)).toBe(false);
    }
  });
});
