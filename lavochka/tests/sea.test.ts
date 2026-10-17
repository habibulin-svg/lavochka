import { describe, expect, it } from 'vitest';
import { SeededRng, RiggedRng } from '../src/core/rng';
import { apply, newState, reach, targetsOf, view, type Action, type State } from '../src/games/sea/engine';
import { MAPS, isWater, portAt } from '../src/games/sea/maps';
import { angleFor, spinAt } from '../src/games/sea/spinner';

const rig = (...v: number[]) => {
  const r = new RiggedRng(new SeededRng(1));
  r.rig(v);
  return r;
};

function piraty(): State {
  const s = newState([0, 1], { game: 'piraty' }, new SeededRng(1));
  s.ships[0].gold = true;
  s.phase = 'spin';
  return s;
}

const act = (s: State, seat: number, a: Action, ...r: number[]) => {
  const res = apply(s, seat, a, rig(...r));
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
};

describe('морские игры: поля', () => {
  it('порты стоят на клетках карты, у каждого есть выход в море', () => {
    for (const m of Object.values(MAPS))
      for (const p of m.ports) {
        expect(isWater(m, p.x, p.y), `${m.id}: ${p.name}`).toBe(true);
        const sea = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => m.rows[p.y + dy]?.[p.x + dx] === '.'));
        expect(sea, `${m.id}: ${p.name} без моря рядом`).toBe(true);
      }
  });
  it('«Пираты»: шесть пиратских баз, Вера-Круц и Кадикс', () => {
    const m = MAPS.piraty;
    expect(m.ports.filter((p) => p.kind === 'pi').length).toBe(6);
    expect(m.ports.some((p) => p.name === 'Кадикс')).toBe(true);
    expect(m.ports.some((p) => p.name === 'Вера-Круц')).toBe(true);
  });
  it('«Захват колоний»: квадратик старта в левом нижнем углу', () => {
    const m = MAPS.kolonii;
    expect(m.home.length).toBeGreaterThanOrEqual(15);
    for (const k of m.home) expect(k % m.w).toBeLessThan(5);
  });
});

describe('вертушка', () => {
  it('ближайший румб — откуда ветер; жёлтый сектор — штиль, красный — ураган', () => {
    expect(spinAt(0)).toMatchObject({ from: 'N', weather: 'breeze', main: true });
    expect(spinAt(45)).toMatchObject({ from: 'NE', main: false });
    expect(spinAt(angleFor('S', 'calm')).weather).toBe('calm');
    expect(spinAt(angleFor('W', 'storm'))).toMatchObject({ from: 'W', weather: 'storm' });
    const w = Array.from({ length: 360 }, (_, a) => spinAt(a).weather);
    expect(w.filter((x) => x === 'calm').length).toBe(64);
    expect(w.filter((x) => x === 'storm').length).toBe(56);
  });
});

describe('«Пираты»', () => {
  it('вдвоём: три галиона в Вера-Круце, шесть бригантин на шести базах', () => {
    const s = newState([0, 1], { game: 'piraty' }, new SeededRng(1));
    const m = MAPS.piraty;
    expect(s.ships.filter((x) => x.side === 'es').every((x) => portAt(m, x.x, x.y)?.name === 'Вера-Круц')).toBe(true);
    const bases = new Set(s.ships.filter((x) => x.side === 'pi').map((x) => portAt(m, x.x, x.y)?.name));
    expect(bases.size).toBe(6);
    expect(s.phase).toBe('gold');
  });

  it('золото пираты не видят, испанцы видят', () => {
    const s = piraty();
    expect(view(s, [1]).ships.some((x) => x.gold)).toBe(false);
    expect(view(s, [0]).ships[0].gold).toBe(true);
  });

  it('скорость по ветру: фордевинд 3, галфвинд 2, бейдевинд 1, против — нельзя', () => {
    let s = piraty();
    Object.assign(s.ships[0], { x: 24, y: 14 });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    const r = reach(s, s.ships[0]);
    const max = (c: string) => Math.max(0, ...r.filter((x) => x.course === c).map((x) => x.steps));
    expect(max('S')).toBe(3);
    expect(max('SW')).toBe(3);
    expect(max('E')).toBe(2);
    expect(max('NE')).toBe(1);
    expect(max('N')).toBe(0);
  });

  it('штиль: галионы стоят, бригантины на вёслах идут на клетку', () => {
    let s = piraty();
    Object.assign(s.ships[0], { x: 24, y: 14 });
    Object.assign(s.ships[3], { x: 28, y: 14 });
    s = act(s, 0, { type: 'spin' }, angleFor('N', 'calm'));
    expect(reach(s, s.ships[0])).toEqual([]);
    s = act(s, 0, { type: 'end' });
    s = act(s, 1, { type: 'spin' }, angleFor('N', 'calm'));
    const r = reach(s, s.ships[3]);
    expect(r.length).toBe(8);
    expect(r.every((x) => x.steps === 1)).toBe(true);
  });

  it('основной румб — попадание, четвертной — промах; бригантина тонет со второго', () => {
    let s = piraty();
    Object.assign(s.ships[0], { x: 24, y: 14 });
    Object.assign(s.ships[3], { x: 25, y: 14 });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    expect(targetsOf(s, s.ships[0])).toEqual([{ ship: 3 }]);
    s = act(s, 0, { type: 'shoot', ships: [0], target: { ship: 3 } }, angleFor('NE'));
    expect(s.ships[3].hits).toBe(0);
    expect(apply(s, 0, { type: 'shoot', ships: [0], target: { ship: 3 } }, rig(0))).toBeNull(); // второй выстрел тем же кораблём
    s = act(s, 0, { type: 'end' });
    s = act(s, 1, { type: 'spin' }, angleFor('N'));
    s = act(s, 1, { type: 'end' });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    s = act(s, 0, { type: 'shoot', ships: [0], target: { ship: 3 } }, angleFor('S'));
    expect(s.ships[3].hits).toBe(1);
    expect(s.ships[3].sunk).toBeFalsy();
  });

  it('золотой галион не тонет: его берут пираты, испанцы отбивают одним попаданием', () => {
    let s = piraty();
    Object.assign(s.ships[0], { x: 24, y: 14, hits: 2 });
    Object.assign(s.ships[3], { x: 25, y: 14 });
    Object.assign(s.ships[1], { x: 22, y: 14 });
    s.turn = 1;
    s = act(s, 1, { type: 'spin' }, angleFor('N'));
    s = act(s, 1, { type: 'shoot', ships: [3], target: { ship: 0 } }, angleFor('W'));
    expect(s.ships[0]).toMatchObject({ side: 'pi', owner: 1 });
    expect(s.ships[0].sunk).toBeFalsy();
    expect(view(s, [1]).ships[0].gold).toBe(true);
    s = act(s, 1, { type: 'end' });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    s = act(s, 0, { type: 'shoot', ships: [1], target: { ship: 0 } }, angleFor('E'));
    expect(s.ships[0]).toMatchObject({ side: 'es', owner: 0 });
  });

  it('золото в Кадиксе — победа испанцев', () => {
    let s = piraty();
    const cadiz = MAPS.piraty.ports.find((p) => p.name === 'Кадикс')!;
    Object.assign(s.ships[0], { x: cadiz.x - 1, y: cadiz.y });
    s = act(s, 0, { type: 'spin' }, angleFor('W'));
    s = act(s, 0, { type: 'move', ship: 0, course: 'E', steps: 1 });
    expect(s.result?.winners).toEqual([0]);
  });

  it('ураган сносит на клетку по ветру; в порту не страшен', () => {
    let s = piraty();
    Object.assign(s.ships[1], { x: 24, y: 14 });
    s = act(s, 0, { type: 'spin' }, angleFor('W', 'storm'));
    expect(s.ships[1]).toMatchObject({ x: 25, y: 14 });
    expect(s.ships[2]).toMatchObject({ x: 2, y: 20 }); // в Вера-Круце
  });
});

describe('«Захват колоний»', () => {
  const kol = () => {
    const s = newState([0, 1], { game: 'kolonii' }, new SeededRng(1));
    s.seats = [0, 1];
    s.turn = 0;
    return s;
  };
  it('вдвоём по три корабля, впятером по два, у каждого пять боеприпасов', () => {
    expect(kol().ships.length).toBe(6);
    expect(newState([0, 1, 2, 3, 4], { game: 'kolonii' }, new SeededRng(1)).ships.length).toBe(10);
    expect(kol().ships.every((x) => x.ammo === 5)).toBe(true);
  });

  it('порт сбивают половиной цены попаданий и занимают, войдя в него', () => {
    let s = kol();
    const i = MAPS.kolonii.ports.findIndex((p) => p.name === 'Кокосовые о-ва');
    const p = MAPS.kolonii.ports[i];
    Object.assign(s.ships[0], { x: p.x, y: p.y - 2 });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    s = act(s, 0, { type: 'shoot', ships: [0], target: { port: i } }, angleFor('E'));
    expect(s.ports[i].down).toBe(true);
    s = act(s, 0, { type: 'move', ship: 0, course: 'S', steps: 2 });
    expect(s.ports[i].owner).toBe(0);
  });

  it('промах по ничейному порту — батареи отвечают в конце хода', () => {
    let s = kol();
    const i = MAPS.kolonii.ports.findIndex((p) => p.name === 'Коломбо');
    const p = MAPS.kolonii.ports[i];
    Object.assign(s.ships[0], { x: p.x + 1, y: p.y + 1 });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    s = act(s, 0, { type: 'shoot', ships: [0], target: { port: i } }, angleFor('NE'));
    const r = apply(s, 0, { type: 'end' }, rig(angleFor('S')))!;
    expect(r.events.some((e) => e.t === 'portFire')).toBe(true);
    expect(r.state.ships[0].hits).toBe(1);
  });

  it('без колонии на чужие корабли не нападают', () => {
    let s = kol();
    Object.assign(s.ships[0], { x: 10, y: 20 });
    Object.assign(s.ships[3], { x: 11, y: 20 });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    expect(targetsOf(s, s.ships[0])).toEqual([]);
    s.ports[0].owner = 0;
    expect(targetsOf(s, s.ships[0])).toEqual([{ ship: 3 }]);
  });

  it('укрепление: боеприпасы в порту прибавляются к прочности', () => {
    let s = kol();
    const i = MAPS.kolonii.ports.findIndex((p) => p.name === 'Сингапур');
    const p = MAPS.kolonii.ports[i];
    s.ports[i].owner = 0;
    Object.assign(s.ships[0], { x: p.x, y: p.y });
    s = act(s, 0, { type: 'spin' }, angleFor('N'));
    s = act(s, 0, { type: 'unload', ship: 0 });
    expect(s.ports[i].ammo).toBe(5);
    expect(s.ships[0].ammo).toBe(0);
  });
});
