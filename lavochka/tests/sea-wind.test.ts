import { describe, expect, it } from 'vitest';
import { angle, drift, POINTS, POINT_STEP, sailSteps, stepsFor } from '../src/games/sea/wind';

describe('ветер и вертушка: углы и курсы', () => {
  it('угол между курсом и ветром считается по восьми румбам', () => {
    expect(angle('N', 'N')).toBe(0);
    expect(angle('N', 'NE')).toBe(1);
    expect(angle('N', 'E')).toBe(2);
    expect(angle('N', 'SW')).toBe(3);
    expect(angle('N', 'S')).toBe(4);
    // угол не зависит от порядка румбов
    expect(angle('S', 'N')).toBe(4);
    expect(angle('W', 'NW')).toBe(1);
  });

  it('скорость по курсу: 3 — фордевинд и бакштаг, 2 — галфвинд, 1 — бейдевинд, 0 — против ветра', () => {
    expect(sailSteps('N', 'N')).toBe(3); // ветер в корму
    expect(sailSteps('N', 'NE')).toBe(3); // наискосок
    expect(sailSteps('N', 'NW')).toBe(3);
    expect(sailSteps('N', 'E')).toBe(2); // под прямым углом
    expect(sailSteps('N', 'W')).toBe(2);
    expect(sailSteps('N', 'SW')).toBe(1); // круто против ветра
    expect(sailSteps('N', 'SE')).toBe(1);
    expect(sailSteps('N', 'S')).toBe(0); // прямо в нос
  });

  it('штиль останавливает парусники, но на вёслах можно одну клетку', () => {
    const calm = { from: 'N', weather: 'calm' } as const;
    expect(stepsFor(calm, 'N')).toBe(0);
    expect(stepsFor(calm, 'S')).toBe(0);
    expect(stepsFor(calm, 'S', true)).toBe(1);
  });

  it('в свежий ветер парусник идёт по курсу, а на вёслах — и против ветра одну клетку', () => {
    const fresh = { from: 'E', weather: 'breeze' } as const;
    expect(stepsFor(fresh, 'E')).toBe(3);
    expect(stepsFor(fresh, 'N')).toBe(2);
    expect(stepsFor(fresh, 'W')).toBe(0);
    expect(stepsFor(fresh, 'W', true)).toBe(1);
  });

  it('в ураган своим курсом не идут — корабль дрейфует по ветру на клетку', () => {
    const storm = { from: 'N', weather: 'storm' } as const;
    expect(stepsFor(storm, 'S')).toBe(0);
    expect(stepsFor(storm, 'S', true)).toBe(0);
    expect(drift(storm)).toEqual(POINT_STEP.S); // ветер с норда несёт на зюйд
    expect(drift({ from: 'W', weather: 'storm' })).toEqual(POINT_STEP.E);
  });

  it('у каждого румба есть шаг и название', () => {
    expect(POINTS.length).toBe(8);
    for (const p of POINTS) expect(POINT_STEP[p]).toHaveLength(2);
  });
});
