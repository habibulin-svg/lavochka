/* «Чудовище Джио-Джанги»: правила движка — сборы, болото, звери, туземцы, переправы, гибель, возвращение домой.
 * Кубик подкручен: dice(…) отдаёт грани по порядку. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Rng } from '../src/core/types';
import { CELLS, HOTEL, NEIGH, RIVER, apply, intoRiver, isAnimal, isStop, newState, scoreOf, type State } from '../src/games/djio/engine';
import { ANIMALS, START_MONEY, SHOT_PRICE } from '../src/games/djio/rules';

/** Кубик с заданными гранями (d6 = int(6) + 1); прочие броски — 0. */
function dice(...faces: number[]): Rng {
  const q = faces.slice();
  return {
    next: () => 0,
    int: (n: number) => (n === 6 ? (q.length ? q.shift()! - 1 : 0) : 0),
    getState: () => 0,
  };
}

/** Партия на двоих сразу после сборов: ход места 0. */
function game(): State {
  const s = newState([0, 1], new SeededRng(7));
  s.phase = 'roll';
  s.done = [true, true];
  s.rounds = 1;
  return s;
}

/** Встать на клетку cell последним шагом (с соседней клетки, откуда туда можно шагнуть). */
function landOn(s: State, seat: number, cell: number, rng: Rng, from = NEIGH[cell][0]) {
  s.turn = seat;
  s.pos[seat] = from;
  s.phase = 'move';
  s.left = 1;
  s.die = 1;
  s.back = -1;
  s.from = from;
  const r = apply(s, seat, { type: 'step', to: cell }, rng);
  expect(r, `шаг на клетку ${cell}`).not.toBeNull();
  return r!;
}

const first = (pred: (i: number) => boolean) => CELLS.findIndex((_, i) => pred(i));
const SWAMP = first((i) => CELLS[i].kind === 'swamp' && !NEIGH[i].some((n) => isStop(n)));
const NATIVES = first((i) => CELLS[i].kind === 'danger' && CELLS[i].what === 'natives');
const ANIMAL = first((i) => isAnimal(i));
const STOP = first((i) => isStop(i) && CELLS[i].kind !== 'hotel' && CELLS[i].kind !== 'fire');
// берег переправы, на который приходят с суши
const CROSS = first((i) => CELLS[i].kind === 'cross' && NEIGH[i].some((n) => RIVER[n] < 0 && intoRiver(n, i)));
const CROSS_FROM = NEIGH[CROSS].find((n) => RIVER[n] < 0 && intoRiver(n, CROSS))!;

describe('Джио-Джанги: движок', () => {
  it('нашлись клетки всех видов', () => {
    for (const [name, i] of Object.entries({ SWAMP, NATIVES, ANIMAL, STOP, CROSS })) expect(i, name).toBeGreaterThanOrEqual(0);
  });

  it('сборы: по предмету за ход, по кругу, пока все не скажут «готово»', () => {
    const s = newState([0, 1], new SeededRng(1));
    expect(s.phase).toBe('buy');
    expect(s.money[0]).toBe(START_MONEY);
    let r = apply(s, 0, { type: 'buy', item: 'gun' }, dice())!;
    expect(r.state.money[0]).toBe(START_MONEY - 50000);
    expect(r.state.items[0]).toEqual(['gun']);
    expect(r.state.turn).toBe(1);
    r = apply(r.state, 1, { type: 'done' }, dice())!;
    expect(r.state.turn).toBe(0);
    expect(r.state.phase).toBe('buy');
    r = apply(r.state, 0, { type: 'done' }, dice())!;
    expect(r.state.phase).toBe('roll');
    // видеокамера одна на всю партию, вторую лошадь не купить
    const t = r.state;
    t.items[1] = ['video', 'horse'];
    t.phase = 'buy';
    expect(apply(t, 0, { type: 'buy', item: 'video' }, dice())).toBeNull();
  });

  it('лошадь прибавляет 6 к броску, на поводу — нет', () => {
    const s = game();
    s.items[0] = ['horse'];
    let r = apply(s, 0, { type: 'roll' }, dice(3))!;
    expect(r.events.find((e) => e.type === 'roll')).toMatchObject({ die: 3, bonus: 6 });
    const t = game();
    t.items[0] = ['horse'];
    t.lead[0] = true;
    r = apply(t, 0, { type: 'roll' }, dice(3))!;
    expect(r.events.find((e) => e.type === 'roll')).toMatchObject({ die: 3, bonus: 0 });
  });

  it('лихорадка: ждёт шестёрку — без неё ход пропадает', () => {
    const s = game();
    s.wait[0] = 6;
    const r = apply(s, 0, { type: 'roll' }, dice(4))!;
    expect(r.state.pos[0]).toBe(HOTEL);
    expect(r.state.turn).toBe(1);
    const t = game();
    t.wait[0] = 6;
    const ok = apply(t, 0, { type: 'roll' }, dice(6))!;
    expect(ok.state.wait[0]).toBe(0);
  });

  it('болото, москиты: спецодежда спасает, без неё — ждать шестёрку', () => {
    const a = game();
    expect(landOn(a, 0, SWAMP, dice(2)).state.wait[0]).toBe(6);
    const b = game();
    b.items[0] = ['suit'];
    expect(landOn(b, 0, SWAMP, dice(2)).state.wait[0]).toBe(0);
  });

  it('болото, трясина: сначала лошадь, потом вещи (оружие остаётся), потом верёвка', () => {
    const a = game();
    a.items[0] = ['horse', 'aid', 'gun'];
    expect(landOn(a, 0, SWAMP, dice(5)).state.items[0]).toEqual(['aid', 'gun']);
    const b = game();
    b.items[0] = ['aid', 'gun'];
    b.skins[0] = ['lion'];
    const rb = landOn(b, 0, SWAMP, dice(5)).state;
    expect(rb.items[0]).toEqual(['gun']);
    expect(rb.skins[0]).toEqual([]);
    // ничего нет: три броска верёвки, ни разу 4–6 — гибель, всё сначала
    const c = game();
    c.money[0] = 3000;
    const rc = landOn(c, 0, SWAMP, dice(5, 1, 2, 3)).state;
    expect(rc.pos[0]).toBe(HOTEL);
    expect(rc.money[0]).toBe(START_MONEY);
    const d = game();
    expect(landOn(d, 0, SWAMP, dice(5, 1, 2, 4)).state.pos[0]).toBe(SWAMP);
  });

  it('зверь спокоен: съёмка лучшим аппаратом, редкость умножает цену', () => {
    const s = game();
    s.items[0] = ['photo', 'cine'];
    const r = landOn(s, 0, ANIMAL, dice(2)).state;
    const an = ANIMALS.find((a) => a.id === CELLS[ANIMAL].what)!;
    expect(r.money[0]).toBe(START_MONEY + SHOT_PRICE.cine * an.rare);
    expect(r.films[0]).toBe(1);
    expect(r.away[0]).toBe(true);
  });

  it('зверь нападает: без оружия и шашек — его броски, 4–6 — гибель', () => {
    const an = ANIMALS.find((a) => a.id === CELLS[ANIMAL].what)!;
    const live = game();
    const r1 = landOn(live, 0, ANIMAL, dice(5, ...Array(an.attacks).fill(2))).state;
    expect(r1.pos[0]).toBe(ANIMAL);
    const dead = game();
    const r2 = landOn(dead, 0, ANIMAL, dice(5, 6)).state;
    expect(r2.pos[0]).toBe(HOTEL);
  });

  it('перестрелка: серия лучшим оружием, убитый зверь — шкура', () => {
    const an = ANIMALS.find((a) => a.id === CELLS[ANIMAL].what)!;
    const s = game();
    s.items[0] = ['revolver', 'carbine'];
    let st = landOn(s, 0, ANIMAL, dice(5)).state;
    expect(st.phase).toBe('ask');
    st = apply(st, 0, { type: 'pick', pick: 'shoot' }, dice())!.state;
    expect(st.fight).toMatchObject({ shots: 5, need: an.hits });
    // карабин бьёт на 3–6
    for (let k = 0; k < an.hits; k++) st = apply(st, 0, { type: 'shoot' }, dice(3))!.state;
    expect(st.skins[0]).toEqual([an.id]);
    expect(st.turn).toBe(1);
  });

  it('туземцы: откуп подарком; откупиться нечем — съедят', () => {
    const s = game();
    s.items[0] = ['presents'];
    let st = landOn(s, 0, NATIVES, dice()).state;
    expect(st.ask?.kind).toBe('natives');
    expect(st.ask!.options).toContain('presents');
    st = apply(st, 0, { type: 'pick', pick: 'presents' }, dice())!.state;
    expect(st.items[0]).toEqual([]);
    const poor = game();
    poor.money[0] = 0;
    expect(landOn(poor, 0, NATIVES, dice()).state.pos[0]).toBe(HOTEL);
  });

  it('переправа: лодка местных набрала воду — назад на берег, вещь утонула; пороги — гибель', () => {
    const s = game();
    s.items[0] = ['aid', 'gun'];
    let st = landOn(s, 0, CROSS, dice(), CROSS_FROM).state;
    expect(st.ask?.kind).toBe('cross');
    st = apply(st, 0, { type: 'pick', pick: 'local' }, dice(1))!.state;
    expect(st.pos[0]).toBe(CROSS_FROM);
    expect(st.money[0]).toBe(START_MONEY - 20000);
    expect(st.items[0]).toEqual(['gun']);
    const r = game();
    let rt = landOn(r, 0, CROSS, dice(), CROSS_FROM).state;
    rt = apply(rt, 0, { type: 'pick', pick: 'rapids' }, dice(2))!.state;
    expect(rt.pos[0]).toBe(HOTEL);
    const ok = game();
    let ot = landOn(ok, 0, CROSS, dice(), CROSS_FROM).state;
    ot = apply(ot, 0, { type: 'pick', pick: 'rapids' }, dice(3))!.state;
    expect(ot.pos[0]).toBe(CROSS);
  });

  it('привал: подарок только первому пришедшему', () => {
    const s = game();
    let st = landOn(s, 0, STOP, dice()).state;
    expect(st.ask?.kind).toBe('gift');
    const gift = st.ask!.options[0];
    st = apply(st, 0, { type: 'pick', pick: gift }, dice())!.state;
    expect(st.items[0]).toEqual([gift]);
    st = landOn(st, 1, STOP, dice()).state;
    expect(st.ask).toBeNull();
    expect(st.turn).toBe(0);
  });

  it('вернулся в гостиницу после зверей — конец, побеждает больший капитал', () => {
    const s = game();
    s.away[0] = true;
    s.money[1] = START_MONEY + 70000;
    s.skins[0] = [ANIMALS[0].id];
    const st = landOn(s, 0, HOTEL, dice()).state;
    expect(st.over).toBe(true);
    const best = scoreOf(st, 0) > scoreOf(st, 1) ? 0 : 1;
    expect(st.winner).toBe(best);
    // не побывав у зверей, в гостинице игра не кончается
    const t = game();
    expect(landOn(t, 0, HOTEL, dice()).state.over).toBe(false);
  });
});
