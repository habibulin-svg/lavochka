/* Мафия: состав ролей, ночь (выстрел, доктор, путана, проверки), день (выставление, голосование, переголосовка), победы, тайна ролей. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/mafia/def';
import { apply, makeView, roleSet, setup, toAct, type Action, type Role, type State } from '../src/games/mafia/engine';

const rng = () => new SeededRng(2);
function pos(roles: Role[], opts: Record<string, unknown> = {}): State {
  const seats = roles.map((_, i) => i);
  const s = setup(seats, opts as never, rng());
  roles.forEach((r, i) => (s.roles[i] = r));
  return s;
}
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!;
};
/** Ночь: targets[i] — цель места i (все живые). */
function night(s: State, targets: Record<number, number>, extra: Record<number, Partial<Action>> = {}) {
  let r = { state: s, events: [] as ReturnType<typeof apply> extends infer X ? (X extends { events: infer E } ? E : never) : never };
  for (const x of s.alive) r = go(r.state, x, { type: 'night', target: targets[x] ?? (s.meet ? x : s.alive.find((y) => y !== x)!), ...(extra[x] as object) } as Action) as typeof r;
  return r;
}

describe('роли', () => {
  it('составы', () => {
    expect(roleSet(8, 'classic').filter((r) => r === 'mafia').length).toBe(2);
    expect(roleSet(10, 'sport').sort()).toEqual(['civ', 'civ', 'civ', 'civ', 'civ', 'civ', 'don', 'mafia', 'mafia', 'sheriff']);
    expect(roleSet(8, 'extended')).toContain('doctor');
    expect(roleSet(8, 'extended')).toContain('putana');
  });
  it('ночью ходят все живые — по очереди ходящих роли не видны', () => {
    const s = pos(['civ', 'mafia', 'sheriff', 'civ', 'civ', 'civ']);
    expect(toAct(s).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('ночь', () => {
  it('выстрел мафии и проверка комиссара (видит только он)', () => {
    const s = pos(['civ', 'mafia', 'sheriff', 'civ', 'civ', 'civ']);
    const r = night(s, { 1: 3, 2: 1 });
    expect(r.state.alive).not.toContain(3);
    expect(r.state.checks[2]).toEqual([{ target: 1, result: true }]);
    const chk = r.events.find((e) => e.type === 'check')!;
    expect(def.redact!(chk, [0])).toBeNull();
    expect(def.redact!(chk, [2])).not.toBeNull();
    expect(r.state.phase).toBe('day');
  });
  it('доктор спасает; путана защищает и блокирует ход', () => {
    const roles: Role[] = ['civ', 'mafia', 'sheriff', 'doctor', 'putana', 'civ', 'civ', 'civ'];
    const healed = night(pos(roles, { variant: 'extended' }), { 1: 5, 3: 5, 4: 0 });
    expect(healed.state.alive).toContain(5);
    expect(healed.events.find((e) => e.type === 'dawn')).toMatchObject({ killed: null, saved: true });
    // путана у мафиози — выстрел не срабатывает
    const blocked = night(pos(roles, { variant: 'extended' }), { 1: 5, 3: 0, 4: 1 });
    expect(blocked.state.alive).toContain(5);
    // доктор себя дважды подряд не лечит
    const s = { ...pos(roles, { variant: 'extended' }), lastHeal: 3 };
    expect(apply(s, 3, { type: 'night', target: 3 }, rng())).toBeNull();
  });
  it('спортивная: ночь знакомства без выстрела, дон проверяет комиссара', () => {
    const roles: Role[] = ['don', 'mafia', 'mafia', 'sheriff', 'civ', 'civ', 'civ', 'civ', 'civ', 'civ'];
    let s = pos(roles, { variant: 'sport' });
    expect(s.meet).toBe(true);
    let r = night(s, {});
    expect(r.state.alive.length).toBe(10);
    // день: никого не выставили
    s = r.state;
    for (const x of s.order) s = go(s, x, { type: 'speak', text: 'привет' }).state;
    expect(s.phase).toBe('night');
    expect(apply(s, 0, { type: 'night', target: 4 }, rng())).toBeNull();
    r = night(s, { 0: 4, 1: 4, 2: 4 }, { 0: { check: 3 } });
    expect(r.state.checks[0]).toEqual([{ target: 3, result: true }]);
    expect(r.state.alive).not.toContain(4);
  });
});

describe('день', () => {
  function dayPos(): State {
    const s = pos(['civ', 'mafia', 'sheriff', 'civ', 'civ', 'civ']);
    Object.assign(s, { phase: 'day', order: [0, 1, 2, 3, 4, 5], speaker: 0 });
    return s;
  }
  it('выставили — голосуют — больше всех уходит; мафия вся ушла — город победил', () => {
    let s = dayPos();
    s = go(s, 0, { type: 'speak', text: '…', nominate: 1 }).state;
    expect(apply(s, 1, { type: 'speak', nominate: 1 }, rng())).toBeNull();
    for (const x of [1, 2, 3, 4, 5]) s = go(s, x, { type: 'speak', text: '…' }).state;
    expect(s.phase).toBe('vote');
    for (const x of [0, 1, 2, 3, 4, 5]) s = go(s, x, { type: 'vote', target: 1 }).state;
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('city');
  });
  it('поровну — переголосовка, снова поровну — никто', () => {
    let s = dayPos();
    s = go(s, 0, { type: 'speak', nominate: 3 }).state;
    s = go(s, 1, { type: 'speak', nominate: 4 }).state;
    for (const x of [2, 3, 4, 5]) s = go(s, x, { type: 'speak' }).state;
    const split = (st: State) => {
      for (const [x, t] of [[0, 3], [1, 4], [2, 3], [3, 4], [4, 3], [5, 4]]) st = go(st, x, { type: 'vote', target: t }).state;
      return st;
    };
    s = split(s);
    expect(s.revote).toBe(true);
    s = split(s);
    expect(s.phase).toBe('night');
    expect(s.alive.length).toBe(6);
  });
  it('мафии столько же, сколько остальных — мафия победила', () => {
    const s = pos(['civ', 'mafia', 'civ', 'mafia', 'civ']);
    const r = night(s, { 1: 0, 3: 0 });
    expect(r.state.winner).toBe('mafia');
  });
});

describe('тайна ролей и боты', () => {
  it('мирный не видит ролей, мафия видит своих', () => {
    const s = pos(['civ', 'mafia', 'sheriff', 'mafia', 'civ', 'civ', 'civ', 'civ']);
    const civ = makeView(s, [0]);
    expect(civ.roles.slice(0, 8)).toEqual(['civ', 'civ', 'civ', 'civ', 'civ', 'civ', 'civ', 'civ']);
    const maf = makeView(s, [1]);
    expect(maf.roles[3]).toBe('mafia');
    expect(maf.roles[2]).toBe('civ');
  });
  it('ходы ботов допустимы', async () => {
    const s = pos(['civ', 'mafia', 'sheriff', 'civ', 'civ', 'civ']);
    for (const lv of [0, 1, 2])
      for (const x of s.alive) {
        const a = (await def.bot.choose(makeView(s, [x]), x, lv, rng())) as Action;
        expect(apply(s, x, a, rng()), `${lv}/${x}`).not.toBeNull();
      }
  });
});
