/* Партизаны: раздача и знание своих, размеры групп, голосование и пять отказов, карты операции (партизан не срывает),
 * два срыва на 4-й при 7+, победы, проверка с жетоном, разведчик и снайпер, тайна ролей и карт; боты — сложные против сложных не в одни ворота. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botSeats, simulate } from './harness';
import { def } from '../src/games/partizany/def';
import { apply, makeView, setup, teamSize, toAct, traitorsFor, type Action, type Role, type State } from '../src/games/partizany/engine';

const rng = () => new SeededRng(5);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)} (${s.phase})`).not.toBeNull();
  return r!.state;
};
function pos(roles: Role[], opts: Record<string, boolean> = {}): State {
  let s = setup(roles.map((_, i) => i), opts, rng());
  s.roles = Object.fromEntries(roles.map((r, i) => [i, r]));
  s.leader = 0;
  for (const x of s.seats) s = go(s, x, { type: 'ready' });
  s.leader = 0;
  return s;
}
const R5: Role[] = ['partisan', 'traitor', 'partisan', 'traitor', 'partisan'];
const voteAll = (s: State, yes: boolean) => {
  for (const x of s.seats) s = go(s, x, { type: 'vote', yes });
  return s;
};
/** Провести операцию группой team: срывают fails. */
function mission(s: State, team: number[], fails: number[] = []) {
  s = go(s, s.leader, { type: 'team', members: team });
  s = voteAll(s, true);
  for (const x of team) s = go(s, x, { type: 'card', fail: fails.includes(x) });
  return s;
}

describe('партизаны', () => {
  it('раздача: число предателей по таблице, предатели знают своих, партизан — никого', () => {
    for (let n = 5; n <= 10; n++) {
      const s = setup(Array.from({ length: n }, (_, i) => i), {}, new SeededRng(n));
      const t = s.seats.filter((x) => s.roles[x] === 'traitor');
      expect(t.length).toBe(traitorsFor(n));
      const p = s.seats.find((x) => s.roles[x] === 'partisan')!;
      expect(Object.keys(makeView(s, [p]).know[p])).toEqual([String(p)]);
      expect(Object.keys(makeView(s, [t[0]]).know[t[0]]).length).toBe(t.length);
      expect(JSON.stringify(makeView(s, [p]))).not.toContain('"traitor"');
    }
    expect([0, 1, 2, 3, 4].map((k) => teamSize(7, k))).toEqual([2, 3, 3, 4, 4]);
    expect([0, 1, 2, 3, 4].map((k) => teamSize(10, k))).toEqual([3, 4, 4, 5, 5]);
    const sc = setup([0, 1, 2, 3, 4, 5, 6], { scout: true }, rng());
    expect(Object.values(sc.roles).filter((r) => r === 'scout').length).toBe(1);
    expect(Object.values(sc.roles).filter((r) => r === 'sniper').length).toBe(1);
  });

  it('группа: только нужного размера и без повторов; голоса скрыты до конца; отказ — командир дальше', () => {
    let s = pos(R5);
    expect(toAct(s)).toEqual([0]);
    expect(apply(s, 0, { type: 'team', members: [0, 1, 2] }, rng())).toBeNull();
    expect(apply(s, 0, { type: 'team', members: [0, 0] }, rng())).toBeNull();
    s = go(s, 0, { type: 'team', members: [0, 2] });
    s = go(s, 1, { type: 'vote', yes: false });
    expect(makeView(s, [2]).voted).toEqual([1]);
    expect(JSON.stringify(makeView(s, [2]).myVotes)).toBe('{}');
    s = voteAll({ ...s, votes: {} }, false);
    expect(s.rejects).toBe(1);
    expect(s.leader).toBe(1);
    expect(s.phase).toBe('propose');
  });

  it('пять отказов подряд — победа предателей', () => {
    let s = pos(R5);
    for (let i = 0; i < 5; i++) {
      s = go(s, s.leader, { type: 'team', members: [0, 2] });
      s = voteAll(s, false);
    }
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('T');
  });

  it('операция: партизан не может сорвать; один срыв проваливает; карты не видны', () => {
    let s = pos(R5);
    s = go(s, 0, { type: 'team', members: [0, 1] });
    s = voteAll(s, true);
    expect(s.phase).toBe('mission');
    expect(apply(s, 0, { type: 'card', fail: true }, rng())).toBeNull();
    s = go(s, 1, { type: 'card', fail: true });
    expect(JSON.stringify(makeView(s, [0]).myCards)).toBe('{}');
    expect(makeView(s, [0]).played).toEqual([1]);
    s = go(s, 0, { type: 'card', fail: false });
    expect(s.ops[0].ok).toBe(false);
    expect(s.op).toBe(1);
    expect(s.leader).toBe(1);
  });

  it('при 7+ игроках 4-я операция проваливается только двумя срывами; три удачи — победа партизан', () => {
    const R7: Role[] = ['partisan', 'traitor', 'partisan', 'traitor', 'partisan', 'traitor', 'partisan'];
    let s = pos(R7);
    s = mission(s, [0, 2]);
    s = mission(s, [0, 2, 1], [1]);
    s = mission(s, [0, 2, 3], [3]);
    expect(s.ops[3].need).toBe(2);
    s = mission(s, [0, 1, 2, 4], [1]);
    expect(s.ops[3].ok).toBe(true);
    s = mission(s, [0, 2, 4, 6]);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('P');
    expect(def.result(s)!.winners).toEqual([0, 2, 4, 6]);
  });

  it('три провала — победа предателей', () => {
    let s = pos(R5);
    s = mission(s, [0, 1], [1]);
    s = mission(s, [1, 2, 3], [1, 3]);
    s = mission(s, [3, 4], [3]);
    expect(s.winner).toBe('T');
  });

  it('проверка: после 2-й операции хозяин узнаёт сторону, объявляет, жетон уходит; державших не проверяют', () => {
    let s = pos(R5, { check: true });
    s.holder = 4;
    s.held = [4];
    s = mission(s, [0, 2]);
    expect(s.phase).toBe('propose');
    s = mission(s, [0, 1, 2], [1]);
    expect(s.phase).toBe('check');
    expect(toAct(s)).toEqual([4]);
    expect(apply(s, 4, { type: 'check', target: 4 }, rng())).toBeNull();
    s = go(s, 4, { type: 'check', target: 1 });
    expect(makeView(s, [4]).checks).toEqual([{ by: 4, target: 1, side: 'T' }]);
    expect(makeView(s, [0]).checks).toEqual([]);
    s = go(s, 4, { type: 'claim', side: 'P' });
    expect(makeView(s, [0]).claims).toEqual([{ by: 4, target: 1, side: 'P' }]);
    expect(s.holder).toBe(1);
    expect(s.phase).toBe('propose');
    s = mission(s, [0, 2]);
    expect(s.phase).toBe('check');
    expect(apply(s, 1, { type: 'check', target: 4 }, rng())).toBeNull();
  });

  it('разведчик знает предателей; снайпер после трёх удач: попал — победа предателей, мимо — партизан', () => {
    const R: Role[] = ['scout', 'sniper', 'partisan', 'traitor', 'partisan'];
    let s = pos(R, { scout: true });
    expect(makeView(s, [0]).know[0]).toEqual({ 0: 'scout', 1: 'traitor', 3: 'traitor' });
    expect(makeView(s, [1]).know[1][0]).toBeUndefined();
    s = mission(s, [0, 2]);
    s = mission(s, [0, 2, 4]);
    s = mission(s, [0, 2]);
    expect(s.phase).toBe('hunt');
    expect(toAct(s)).toEqual([1]);
    const miss = go(s, 1, { type: 'shoot', target: 2 });
    expect(miss.winner).toBe('P');
    const hit = go(s, 1, { type: 'shoot', target: 0 });
    expect(hit.winner).toBe('T');
  });

  it('боты: партии доходят до конца на 5–10, во всех вариантах; сложные против сложных — не в одни ворота', async () => {
    for (const opts of [{ scout: false, check: false }, { scout: true, check: true }])
      for (let n = 5; n <= 10; n++) {
        const r = await simulate(def, botSeats(def, n, Array(n).fill(2)), opts, n);
        expect(r.finished, r.error).toBe(true);
      }
    const rate = async (level: number) => {
      let w = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const seats = botSeats(def, 7, Array(7).fill(level));
        const a = await simulate(def, seats, {}, seed);
        // кто победил: партизаны — если среди победителей больше 3 мест
        if (a.winners.length === 4) w++;
      }
      return w;
    };
    // сложные против сложных: игра не в одни ворота
    const hard = await rate(2);
    console.log('партизаны, сложные: побед партизан', hard, 'из 24; лёгкие:', await rate(0));
    expect(hard).toBeGreaterThanOrEqual(4);
    expect(hard).toBeLessThanOrEqual(20);
  });
});
