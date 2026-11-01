import { describe, expect, it } from 'vitest';
import { ONE, toPx } from '../../src/gops/sim/fx';
import { Mask } from '../../src/gops/sim/mask';
import { ARSENAL_AMMO, WEAPONS } from '../../src/gops/sim/weapons';
import { DEFAULT_SCHEME, type Input, type World, createWorld, explode, step, wormById, worldHash } from '../../src/gops/sim/world';

/** Плоская карта 1200×500, земля с y=400, жидкость на 480; бригады — бойцы по x. Ящиков и ветра нет. */
function duel(xs: number[][] = [[300], [700]], hp = 100): World {
  const m = new Mask(1200, 500);
  m.fillRect(0, 400, 1200, 100);
  const w = createWorld({
    mask: m, waterY: 480, seed: 11, scheme: { ...DEFAULT_SCHEME, crates: 0, wind: 0 },
    teams: xs.map((t) => ({ spawns: t.map((x) => [x, 400] as [number, number]), hp, ammo: { ...ARSENAL_AMMO, kirpichi: 1, truba: 1, ponyatiya: 1 } })),
  });
  untilTurn(w);
  return w;
}

function untilTurn(w: World, max = 3000) {
  for (let i = 0; i < max && w.phase !== 'turn' && w.phase !== 'over'; i++) step(w, {});
}

function run(w: World, inp: Input, n: number) {
  for (let i = 0; i < n; i++) step(w, inp);
}

/** Взять оружие (и подождать кадр), при надобности — указать точку. */
function take(w: World, weapon: string, target?: [number, number]) {
  step(w, { weapon });
  if (target) step(w, { target });
  expect(w.weapon).toBe(weapon);
}

/** Выстрел с силой charge кадров (или одно нажатие). */
function shoot(w: World, charge = 1) {
  run(w, { fire: true }, charge);
  step(w, {});
}

/** Дождаться конца хода (следующий ход или конец партии). */
function finish(w: World) {
  const t = w.team;
  for (let i = 0; i < 4000 && w.team === t && w.phase !== 'over'; i++) step(w, {});
}

const enemy = (w: World) => w.worms.find((x) => x.team !== w.team)!;
const me = (w: World) => wormById(w, w.active)!;

describe('gops/arsenal: оружие и утилиты второй волны', () => {
  it('у всего готового оружия описано поведение; осколки в арсенал не попадают', () => {
    for (const id of Object.keys(ARSENAL_AMMO)) expect(WEAPONS[id], id).toBeDefined();
    for (const id of ['shard', 'petarda', 'brick', 'vanna-drop']) {
      expect(WEAPONS[id].hidden).toBe(true);
      expect(ARSENAL_AMMO[id]).toBeUndefined();
    }
  });

  it('банка с карбидом рвётся на осколки, осколки тоже взрываются', () => {
    const w = duel([[300], [340]]);
    take(w, 'carbide');
    step(w, { fuse: 1 });
    let shards = 0, booms = 0;
    run(w, { fire: true }, 20);
    for (let i = 0; i < 600; i++) {
      step(w, {});
      shards = Math.max(shards, w.projs.filter((p) => p.weapon === 'shard').length);
      booms += w.events.filter((e) => e.t === 'explode').length;
    }
    expect(shards).toBe(5);
    expect(booms).toBeGreaterThanOrEqual(4);
  });

  it('«Калаш»: очередь, пока держат огонь; отпустил — ход кончен, патрон списан', () => {
    const w = duel();
    take(w, 'kalash');
    const before = w.teams[w.team].ammo.kalash;
    let shots = 0;
    for (let i = 0; i < 16; i++) {
      step(w, { fire: true });
      shots += w.events.filter((e) => e.t === 'shot').length;
    }
    step(w, {});
    expect(shots).toBeGreaterThan(2);
    expect(shots).toBeLessThan(12);
    expect(w.phase).toBe('retreat');
    expect(w.teams[w.team].ammo.kalash).toBe(before - 1);
  });

  it('кукурузник роняет кирпичи над точкой — враг ранен', () => {
    const w = duel();
    const e = enemy(w);
    take(w, 'kukuruznik', [toPx(e.x), toPx(e.y)]);
    shoot(w);
    expect(w.projs.filter((p) => p.weapon === 'brick').length).toBe(5);
    finish(w);
    expect(e.hp).toBeLessThan(100);
  });

  it('без точки авиаудар не срабатывает и запас не тратится', () => {
    const w = duel();
    take(w, 'vanna');
    shoot(w);
    expect(w.projs.length).toBe(0);
    expect(w.phase).toBe('turn');
    expect(w.teams[w.team].ammo.vanna).toBe(1);
  });

  it('ракета с наводкой огибает стенку и попадает в точку', () => {
    const w = duel();
    w.mask.fillRect(480, 300, 20, 100); // стенка между бойцами
    const e = enemy(w);
    take(w, 'homing', [toPx(e.x), toPx(e.y)]);
    w.aim = -700; // вверх-вперёд
    shoot(w, 50);
    finish(w);
    expect(e.hp).toBeLessThan(80);
  });

  it('маршрутка переносит бойца в свободную точку; в землю — нельзя', () => {
    const w = duel();
    take(w, 'marshrutka', [900, 450]);
    shoot(w);
    expect(w.phase).toBe('turn'); // в земле — не поехал
    step(w, { target: [900, 300] });
    shoot(w);
    expect(toPx(me(w).x)).toBe(900);
    expect(w.phase).toBe('retreat');
  });

  it('бетонная плита добавляет землю, на бойца не ставится', () => {
    const w = duel();
    const e = enemy(w);
    take(w, 'plita', [toPx(e.x), toPx(e.y)]);
    shoot(w);
    expect(w.phase).toBe('turn');
    const n = w.mask.count();
    step(w, { target: [600, 250] });
    shoot(w);
    expect(w.mask.count()).toBeGreaterThan(n + 300);
    expect(w.mask.solid(600, 250)).toBe(true);
  });

  it('отбойник роет вниз, лампа — вбок; ход потом кончается', () => {
    const w = duel();
    const y0 = me(w).y;
    take(w, 'otboinik');
    shoot(w);
    run(w, {}, 200);
    expect(me(w).y - y0).toBeGreaterThan(10 * ONE);
    finish(w);
    const w2 = duel();
    const x0 = w2.worms[0].x;
    take(w2, 'payalnik');
    w2.aim = 0;
    shoot(w2);
    run(w2, {}, 200);
    expect(Math.abs(w2.worms[0].x - x0)).toBeGreaterThan(30 * ONE);
  });

  it('усилители хода не кончают: «Буратино», кеды, энергетик (двойной урон)', () => {
    const w = duel([[300], [330]]);
    take(w, 'buratino');
    shoot(w);
    expect(w.phase).toBe('turn');
    expect(w.grav).toBeLessThan(38);
    take(w, 'kedy');
    shoot(w);
    expect(w.fast).toBe(true);
    take(w, 'yagga');
    shoot(w);
    expect(w.dmgMul).toBe(2);
    take(w, 'armatura');
    me(w).facing = 1;
    w.aim = 0;
    shoot(w);
    expect(enemy(w).hp).toBe(40); // 30 × 2
    finish(w);
    expect(w.grav).toBe(38);
    expect(w.dmgMul).toBe(1);
  });

  it('«ты иди» передаёт ход другому бойцу бригады', () => {
    const w = duel([[200, 300], [700]]);
    const a = w.active;
    take(w, 'tyidi');
    shoot(w);
    expect(w.active).not.toBe(a);
    expect(w.phase).toBe('turn');
  });

  it('«по понятиям» — здоровье поровну, прорыв трубы — вода выше', () => {
    const w = duel([[300], [700]]);
    me(w).hp = 20;
    take(w, 'ponyatiya');
    shoot(w);
    expect(w.worms.map((x) => x.hp)).toEqual([60, 60]);
    finish(w);
    const y = w.waterY;
    take(w, 'truba');
    shoot(w);
    expect(w.waterY).toBe(y - 48);
  });

  it('зонтик раскрывают в прыжке: падение медленное, без урона', () => {
    const w = duel();
    const m = me(w);
    m.y = 100 * ONE;
    m.state = 'air';
    take(w, 'zontik');
    shoot(w);
    expect(w.chute).toBe(true);
    run(w, {}, 900);
    expect(m.state).toBe('stand');
    expect(m.hp).toBe(100);
  });

  it('кирпичный град без точки — по всей карте; партия детерминирована', () => {
    const play = () => {
      const w = duel([[300, 500], [700, 900]]);
      take(w, 'kirpichi');
      shoot(w);
      expect(w.projs.filter((p) => p.weapon === 'brick').length).toBe(24);
      finish(w);
      take(w, 'korsar');
      shoot(w, 40);
      finish(w);
      return worldHash(w);
    };
    expect(play()).toBe(play());
  });
});

describe('gops/arsenal: третья волна — бегущие, летуны, ранец, заморозка, огонь', () => {
  it('дворняга бежит к врагу, повторное нажатие — взрыв; ход кончается', () => {
    const w = duel([[300], [420]]);
    const e = enemy(w);
    me(w).facing = 1;
    take(w, 'dog');
    shoot(w);
    expect(w.ctrl).toBe('dog');
    const dog = w.projs[0];
    run(w, {}, 80);
    expect(toPx(dog.x)).toBeGreaterThan(350);
    step(w, { fire: true });
    expect(w.projs.length).toBe(0);
    step(w, {});
    expect(w.phase).toBe('retreat');
    expect(e.hp).toBeLessThan(100);
  });

  it('дворняга перепрыгивает стенку', () => {
    const w = duel([[300], [700]]);
    w.mask.fillRect(400, 385, 10, 15);
    me(w).facing = 1;
    take(w, 'dog');
    shoot(w);
    run(w, {}, 300);
    expect(toPx(w.projs[0].x)).toBeGreaterThan(410);
  });

  it('козы стадом: три штуки, взрываются о бойца сами', () => {
    const w = duel([[300], [460]]);
    const e = enemy(w);
    me(w).facing = 1;
    take(w, 'kozy');
    shoot(w);
    expect(w.projs.filter((p) => p.weapon === 'kozy').length).toBe(3);
    finish(w);
    expect(e.hp).toBeLessThan(100);
  });

  it('голубя рулят стрелками, о землю — взрыв', () => {
    const w = duel();
    me(w).facing = 1;
    w.aim = -400;
    take(w, 'pigeon');
    shoot(w);
    const p = w.projs[0];
    const a0 = p.ang;
    run(w, { move: 1 }, 5);
    expect(p.ang).not.toBe(a0);
    let boom = false;
    for (let i = 0; i < 600 && !boom; i++) {
      step(w, { move: 1 });
      boom = w.events.some((e) => e.t === 'explode');
    }
    expect(boom).toBe(true);
  });

  it('змей сбрасывает бомбу и улетает', () => {
    const w = duel();
    me(w).facing = 1;
    w.aim = -500;
    take(w, 'kite');
    shoot(w);
    run(w, {}, 40);
    step(w, { fire: true });
    expect(w.projs.map((p) => p.weapon)).toEqual(['kite-bomb']);
  });

  it('ледобур ввинчивается в грунт и рвётся глубже точки касания', () => {
    const w = duel();
    w.aim = 200;
    take(w, 'auger');
    shoot(w, 60);
    let at = 0;
    for (let i = 0; i < 600 && !at; i++) {
      step(w, {});
      const e = w.events.find((x) => x.t === 'explode');
      if (e && e.t === 'explode') at = e.y;
    }
    expect(at).toBeGreaterThan(415); // пологий курс: ~0,6 px за кадр × 150 кадров под углом
  });

  it('«За пацанов!»: боец летит, взрыв, сам выбывает', () => {
    const w = duel([[300], [500]]);
    const e = enemy(w);
    const m = me(w);
    m.facing = 1;
    w.aim = 0;
    take(w, 'zapacanov');
    shoot(w);
    finish(w);
    expect(m.state).toBe('dead');
    expect(e.hp).toBeLessThan(100);
  });

  it('ранец: ↑ — взлёт, топливо тратится, ход не кончается', () => {
    const w = duel();
    const m = me(w);
    take(w, 'ognetushitel');
    shoot(w);
    const fuel = w.jet;
    const y0 = m.y;
    run(w, { aim: -1 }, 30);
    expect(m.y).toBeLessThan(y0 - 20 * ONE);
    expect(w.jet).toBe(fuel - 30);
    expect(w.phase).toBe('turn');
  });

  it('резинка ловит при падении с обрыва', () => {
    const w = duel();
    const m = me(w);
    take(w, 'rezinka');
    shoot(w);
    m.y = 100 * ONE;
    m.state = 'air';
    run(w, {}, 60);
    expect(m.state).toBe('rope');
  });

  it('заморозка: замороженного не ранить, невидимок бот не видит', () => {
    const w = duel([[300], [360]]);
    const e = enemy(w);
    take(w, 'holodilnik');
    step(w, { fuse: 1 });
    me(w).facing = 1;
    w.aim = 200;
    shoot(w, 8);
    run(w, {}, 120);
    expect(e.frozen).toBeGreaterThan(0);
    explodeNear(w, e);
    expect(e.hp).toBe(100);
    const w2 = duel();
    take(w2, 'nevidimka');
    shoot(w2);
    expect(w2.teams[w2.team].hidden).toBe(true);
  });

  it('кукурузник-химик: огонь горит и жжёт', () => {
    const w = duel();
    const e = enemy(w);
    take(w, 'napalm', [toPx(e.x), toPx(e.y)]);
    shoot(w);
    expect(w.projs.filter((p) => p.weapon === 'flame').length).toBe(10);
    finish(w);
    expect(e.hp).toBeLessThan(100);
    expect(w.projs.length).toBe(0);
  });
});

function explodeNear(w: World, x: { x: number; y: number }) {
  explode(w, toPx(x.x) + 10, toPx(x.y), 40, 50);
}
