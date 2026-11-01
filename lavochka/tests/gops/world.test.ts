import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type LevelData, dealSpawns, decodeMask } from '../../src/gops/level';
import { toFx, toPx } from '../../src/gops/sim/fx';
import { Mask } from '../../src/gops/sim/mask';
import { CORE_AMMO } from '../../src/gops/sim/weapons';
import { CHARGE_MAX, DEFAULT_SCHEME, type Input, type World, createWorld, dropCrate, explode, step, wormById, worldHash } from '../../src/gops/sim/world';

const level = (id: string): LevelData =>
  JSON.parse(readFileSync(join(__dirname, `../../public/gops/levels/${id}.json`), 'utf8'));

/** Плоская карта 1200×500, земля с y=400, жидкость на 480; бригады по одному бойцу. */
function duel(xs: number[][] = [[300], [700]], hp = 100, crates = 0): World {
  const m = new Mask(1200, 500);
  m.fillRect(0, 400, 1200, 100);
  return createWorld({
    mask: m, waterY: 480, seed: 7, scheme: { ...DEFAULT_SCHEME, crates },
    teams: xs.map((t) => ({ spawns: t.map((x) => [x, 400] as [number, number]), hp, ammo: { ...CORE_AMMO } })),
  });
}

/** Крутить кадры, пока не начнётся чей-то ход (или игра не кончится). */
function untilTurn(w: World, max = 3000) {
  for (let i = 0; i < max && w.phase !== 'turn' && w.phase !== 'over'; i++) step(w, {});
}

function run(w: World, inp: Input, n: number) {
  for (let i = 0; i < n; i++) step(w, inp);
}

describe('gops/level: уровни из terrain.py', () => {
  it('маска раскодирована целиком, точки высадки стоят на земле над воздухом', () => {
    for (const id of ['m01', 'm03', 'm12', 'r01']) {
      const lv = level(id);
      const m = decodeMask(lv);
      expect(m.w * m.h).toBe(lv.size[0] * lv.size[1]);
      expect(m.count()).toBeGreaterThan(m.w * m.h * 0.1);
      expect(lv.spawns.length).toBeGreaterThanOrEqual(8);
      for (const [x, y] of lv.spawns.slice(0, 8)) {
        expect(m.solid(x, y)).toBe(true);
        expect(m.solid(x, y - 1)).toBe(false);
      }
    }
  });

  it('dealSpawns: по кругу первые N', () => {
    const s: [number, number][] = [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]];
    expect(dealSpawns(s, 2, 3)).toEqual([[[1, 0], [3, 0], [5, 0]], [[2, 0], [4, 0], [6, 0]]]);
  });
});

describe('gops/world: партия', () => {
  it('после высадки — ход первой бригады', () => {
    const w = duel();
    untilTurn(w);
    expect(w.phase).toBe('turn');
    expect(w.team).toBe(0);
    expect(wormById(w, w.active)!.team).toBe(0);
  });

  it('«Муха» в упор по соседу: взрыв, урон, воронка, ход переходит', () => {
    const w = duel([[300], [360]]);
    untilTurn(w);
    w.wind = 0;
    w.aim = 0;
    const holeBefore = w.mask.count();
    run(w, { fire: true }, 20);
    run(w, { fire: false }, 1);
    const evs: string[] = [];
    for (let i = 0; i < 2000 && w.team === 0 && w.phase !== 'over'; i++) {
      step(w, {});
      evs.push(...w.events.map((e) => e.t));
    }
    expect(evs).toContain('explode');
    expect(wormById(w, 2)!.hp).toBeLessThan(100);
    expect(w.mask.count()).toBeLessThan(holeBefore);
    expect(w.team).toBe(1);
  });

  it('граната ждёт таймер, потом взрывается', () => {
    const w = duel();
    untilTurn(w);
    run(w, { weapon: 'limonka', fuse: 2 }, 1);
    w.aim = -300;
    run(w, { fire: true }, 30);
    let t = 0, boom = -1;
    for (; t < 400 && boom < 0; t++) {
      step(w, {});
      if (w.events.some((e) => e.t === 'explode')) boom = t;
    }
    expect(boom).toBeGreaterThan(100); // 2 с = 120 кадров с момента броска
    expect(boom).toBeLessThan(130);
  });

  it('обрез: два выстрела за ход, урон по лучу', () => {
    const w = duel([[300], [500]]);
    untilTurn(w);
    run(w, { weapon: 'obrez' }, 1);
    w.aim = 0;
    step(w, { fire: true });
    step(w, { fire: false });
    expect(w.phase).toBe('turn');
    step(w, { fire: true });
    expect(w.phase).toBe('retreat');
    expect(wormById(w, 2)!.hp).toBe(50);
  });

  it('сброшенный в жидкость выбывает, у бригады без бойцов — поражение', () => {
    const w = duel();
    untilTurn(w);
    const enemy = wormById(w, 2)!;
    enemy.y = toFx(495); // ниже верха жидкости
    enemy.state = 'air';
    run(w, { weapon: 'kuryu' }, 1);
    step(w, { fire: true });
    for (let i = 0; i < 1000 && w.phase !== 'over'; i++) step(w, {});
    expect(w.phase).toBe('over');
    expect(w.winner).toBe(0);
    expect(w.caps.length).toBe(0); // утонувший кепки не оставляет
  });

  it('ходы чередуются по бригадам и по бойцам внутри', () => {
    const w = duel([[200, 400], [700, 900]]);
    const order: number[] = [];
    for (let k = 0; k < 4; k++) {
      untilTurn(w);
      order.push(w.active);
      step(w, { weapon: 'kuryu' });
      step(w, { fire: true });
      step(w, {});
    }
    expect(order).toEqual([1, 3, 2, 4]);
  });

  it('детерминизм: партия на настоящем уровне с одинаковым вводом — один и тот же хеш', () => {
    const play = () => {
      const lv = level('m03');
      const sp = dealSpawns(lv.spawns, 2, 3);
      const w = createWorld({
        mask: decodeMask(lv), waterY: lv.water_y, seed: 99,
        teams: sp.map((s) => ({ spawns: s, hp: 100, ammo: { ...CORE_AMMO } })),
      });
      const weapons = ['mukha', 'limonka', 'obrez', 'tnt', 'sling'];
      for (let turn = 0; turn < 12 && w.phase !== 'over'; turn++) {
        untilTurn(w);
        step(w, { weapon: weapons[turn % weapons.length] });
        run(w, { move: turn % 2 ? 1 : -1 }, 40);
        run(w, { aim: -1 }, 10 + turn * 3);
        run(w, { fire: true }, (turn * 17) % CHARGE_MAX);
        run(w, { fire: false }, 2);
        untilTurn(w, 2000);
      }
      return [worldHash(w), w.tick, w.worms.map((x) => x.hp).join(',')];
    };
    const a = play();
    expect(play()).toEqual(a);
    expect(toPx(1)).toBe(0);
  });
});

describe('gops/world: верёвка', () => {
  /** Пол на 400 и потолок-балка 100…120 над всей картой. */
  function cave(): World {
    const w = duel([[300], [1000]]);
    w.mask.fillRect(0, 100, 1200, 20);
    return w;
  }

  it('крюк в потолок: висит, раскачивается, подтягивается, отцепляется — ход не кончился', () => {
    const w = cave();
    untilTurn(w);
    const me = wormById(w, w.active)!;
    step(w, { weapon: 'rope' });
    w.aim = -960; // почти вертикально вверх
    step(w, { fire: true });
    step(w, { fire: false });
    expect(me.state).toBe('rope');
    expect(w.rope).not.toBeNull();
    expect(toPx(w.rope!.ay)).toBeLessThan(121);
    const len0 = w.rope!.len;
    run(w, { aim: -1 }, 40); // подтянуться
    expect(w.rope!.len).toBeLessThan(len0);
    const x0 = me.x;
    run(w, { move: 1 }, 120); // раскачка вправо
    expect(me.x).not.toBe(x0);
    expect(me.state).toBe('rope');
    step(w, { jump: 1 });
    expect(me.state).toBe('air');
    expect(w.rope).toBeNull();
    for (let i = 0; i < 600 && me.state === 'air'; i++) step(w, {});
    expect(me.state).toBe('stand');
    // верёвка ход не кончает (кончит только урон от падения после высокого отцепа)
    if (me.hp === 100) expect(w.active).toBe(me.id);
    expect(w.teams[me.team].ammo.rope).toBe(4); // списано один раз
  });

  it('цепочка крюков в полёте бесплатна; промах крюка — ничего не списано', () => {
    const w = cave();
    untilTurn(w);
    const me = wormById(w, w.active)!;
    step(w, { weapon: 'rope' });
    w.aim = 0; // по горизонтали — до стены не долетает
    step(w, { fire: true });
    step(w, { fire: false });
    expect(me.state).toBe('stand');
    expect(w.teams[w.team].ammo.rope).toBe(5);
    w.aim = -900;
    step(w, { fire: true });
    step(w, { fire: false });
    expect(me.state).toBe('rope');
    step(w, { fire: true }); // новый крюк прямо с верёвки
    step(w, { fire: false });
    expect(me.state).toBe('rope');
    expect(w.teams[w.team].ammo.rope).toBe(4);
  });

  it('конец хода на верёвке — отцепляется и падает', () => {
    const w = cave();
    untilTurn(w);
    const me = wormById(w, w.active)!;
    step(w, { weapon: 'rope' });
    w.aim = -960;
    step(w, { fire: true });
    step(w, { fire: false });
    w.left = 1;
    step(w, {});
    step(w, {});
    expect(me.state).not.toBe('rope');
    expect(w.rope).toBeNull();
  });
});

describe('gops/world: ящики', () => {
  it('падает медленно, приземляется; боец подбирает — оружие в запас', () => {
    const w = duel([[300], [1000]]);
    untilTurn(w);
    const c = dropCrate(w, 'weapon', 'tnt', 360)!;
    let t = 0;
    for (; t < 1200 && c.falling; t++) step(w, {});
    expect(t).toBeGreaterThan(80); // с зонтом — не камнем
    expect(toPx(c.y)).toBeGreaterThan(385);
    const before = w.teams[0].ammo.tnt;
    const got: string[] = [];
    for (let i = 0; i < 900 && w.crates.length; i++) {
      step(w, { move: 1 });
      for (const e of w.events) if (e.t === 'crate') got.push(e.content);
    }
    expect(got).toEqual(['tnt']);
    expect(w.teams[0].ammo.tnt).toBe(before + 1);
  });

  it('аптечка лечит, взрыв уничтожает ящик', () => {
    const w = duel([[300], [1000]]);
    untilTurn(w);
    const me = wormById(w, w.active)!;
    me.hp = 40;
    dropCrate(w, 'health', '25', toPx(me.x));
    for (let i = 0; i < 1500 && w.crates.length; i++) step(w, {});
    expect(me.hp).toBe(65);
    const c = dropCrate(w, 'weapon', 'mine', 700)!;
    for (let i = 0; i < 1500 && c.falling; i++) step(w, {});
    explode(w, toPx(c.x), toPx(c.y), 30, 10);
    expect(w.crates.length).toBe(0);
  });

  it('по схеме ящики падают перед ходами', () => {
    const w = duel([[300], [1000]], 100, 100);
    let drops = 0;
    for (let k = 0; k < 4; k++) {
      untilTurn(w);
      step(w, { weapon: 'kuryu' });
      for (let i = 0; i < 6; i++) {
        step(w, i === 0 ? { fire: true } : {});
        drops += w.events.filter((e) => e.t === 'crate-drop').length;
      }
    }
    expect(drops).toBeGreaterThanOrEqual(3);
  });
});
