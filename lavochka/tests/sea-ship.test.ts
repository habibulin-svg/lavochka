import { describe, expect, it } from 'vitest';
import {
  AMMO_START,
  canRepair,
  canShoot,
  HITS_TO_SINK,
  isSunk,
  repaired,
  repairTurns,
  shoot,
  sinkScore,
  takeHit,
  type Ship,
} from '../src/games/sea/ship';

const ship = (over: Partial<Ship> = {}): Ship => ({
  id: 's1',
  cls: 'galleon',
  side: 'spanish',
  hits: 0,
  ammo: AMMO_START,
  ...over,
});

describe('корабли: пробоины, бой и ремонт', () => {
  it('галион тонет с трёх попаданий, бригантина — с двух', () => {
    expect(HITS_TO_SINK.galleon).toBe(3);
    expect(HITS_TO_SINK.brigantine).toBe(2);

    let g = ship();
    g = takeHit(takeHit(g));
    expect(isSunk(g)).toBe(false); // двух попаданий галиону мало
    g = takeHit(g);
    expect(isSunk(g)).toBe(true);

    let b = ship({ cls: 'brigantine' });
    b = takeHit(b);
    expect(isSunk(b)).toBe(false);
    b = takeHit(b);
    expect(isSunk(b)).toBe(true);
  });

  it('выстрел тратит боеприпас, попадание делает пробоину, промах — нет', () => {
    const shooter = ship({ side: 'pirate', cls: 'brigantine' });
    const hitRes = shoot(shooter, ship(), true);
    expect(hitRes.shooter.ammo).toBe(AMMO_START - 1);
    expect(hitRes.target.hits).toBe(1);

    const missRes = shoot(shooter, ship(), false);
    expect(missRes.shooter.ammo).toBe(AMMO_START - 1);
    expect(missRes.target.hits).toBe(0);
  });

  it('стрелять нельзя из порта, без боеприпасов и с потопленного корабля', () => {
    expect(canShoot(ship())).toBe(true);
    expect(canShoot(ship(), true)).toBe(false); // в порту
    expect(canShoot(ship({ ammo: 0 }))).toBe(false);
    expect(canShoot(ship({ hits: 3 }))).toBe(false);
  });

  it('ремонт: ход за каждую пробоину, испанцы только в своих портах, пираты — в чужих', () => {
    const hurt = ship({ hits: 2 });
    expect(repairTurns(hurt)).toBe(2);
    expect(repaired(hurt).hits).toBe(0);

    const spanish = ship({ hits: 1, side: 'spanish' });
    expect(canRepair(spanish, { side: 'spanish' })).toBe(true);
    expect(canRepair(spanish, { side: 'pirate' })).toBe(false);
    expect(canRepair(spanish, null)).toBe(false);

    const pirate = ship({ hits: 1, side: 'pirate' });
    expect(canRepair(pirate, { side: 'pirate' })).toBe(true);
    expect(canRepair(pirate, { side: 'spanish' })).toBe(false);

    // целому кораблю чиниться нечего
    expect(canRepair(ship(), { side: 'spanish' })).toBe(false);
  });

  it('потопление даёт очки: галион два, бригантина одно', () => {
    expect(sinkScore(ship())).toBe(2);
    expect(sinkScore(ship({ cls: 'brigantine' }))).toBe(1);
  });
});
