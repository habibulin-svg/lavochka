/* «Воздушный бой»: разметка полей, операции «Игрушки», удар в лоб/бок/хвост, зенитки обеих версий, штаб, очередь
 * вчетвером, партии ботов. */
import { describe, expect, it } from 'vitest';
import { breather } from './harness';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/vozboy/ai';
import { apply, cfgFrom, fly, legal, newState, toAct, type Dir, type Kind, type State } from '../src/games/vozboy/engine';
import { AEROFOTO, IGRUSHKA } from '../src/games/vozboy/grid';
import { AEROFOTO_MAP, IGRUSHKA_MAP } from '../src/games/vozboy/maps';

const A = (c: number, r: number) => r * 30 + c;
function pos(ver: 'a' | 'b', list: [number, Kind, number, Dir][], side = 0): State {
  const s = newState(cfgFrom({ ver }), 2);
  s.planes = list.map(([sd, kind, p, dir], id) => ({ id, side: sd, kind, p, dir, up: true }));
  s.side = side;
  return s;
}

describe('Воздушный бой', () => {
  it('поля: узлы сеток и разметка сторон', () => {
    expect(IGRUSHKA.xs.length).toBe(IGRUSHKA_MAP.w);
    expect(IGRUSHKA.ys.length).toBe(IGRUSHKA_MAP.h);
    expect(AEROFOTO.xs.length).toBe(AEROFOTO_MAP.w);
    expect(AEROFOTO.ys.length).toBe(AEROFOTO_MAP.h);
    for (const m of [IGRUSHKA_MAP, AEROFOTO_MAP])
      for (const sd of m.sides) {
        expect(sd.fighters.length).toBe(10);
        expect(sd.bombers.length).toBe(6);
        expect(sd.guns.length).toBe(12);
        expect(sd.guns.filter((g) => g.rocket).length).toBe(4);
      }
  });

  it('«Игрушка»: с аэродрома — только прямо; операции бомбардировщика', () => {
    const s = newState(cfgFrom({ ver: 'a' }), 2);
    const acts = legal(s, 0);
    expect(acts.every((a) => a.seq === 'FF' || a.seq === 'FFF')).toBe(true);
    const air = pos('a', [[0, 'b', A(10, 6), 'e'], [1, 'f', A(25, 6), 'w']]);
    const seqs = new Set(legal(air, 0).map((a) => a.seq));
    expect([...seqs].every((q) => ['FF', 'LL', 'RR', 'LR', 'RL', 'LF', 'RF'].includes(q))).toBe(true);
  });

  it('удар: в бок и хвост — любой, в лоб — только бомбардировщик истребителя', () => {
    // истребитель летит на восток, жертва смотрит на запад — лоб
    const head = pos('a', [[0, 'f', A(10, 6), 'e'], [1, 'f', A(13, 6), 'w']]);
    expect(fly(head, head.planes[0], 'FFF')).toBeNull();
    const headB = pos('a', [[0, 'b', A(11, 6), 'e'], [1, 'f', A(13, 6), 'w']]);
    expect(fly(headB, headB.planes[0], 'FF')!.took).not.toBeNull();
    const tail = pos('a', [[0, 'f', A(10, 6), 'e'], [1, 'b', A(13, 6), 'e']]);
    expect(fly(tail, tail.planes[0], 'FFF')!.took!.kind).toBe('b');
  });

  it('«Игрушка»: огневая точка не бьёт с тыла, ракетная — с любой стороны', () => {
    // синяя огневая точка (9, 7): красный, летящий на запад (спереди), сбит; на восток (с тыла) — цел
    const front = pos('a', [[1, 'f', A(12, 7), 'w'], [0, 'b', A(2, 11), 'e']], 1);
    expect(fly(front, front.planes[0], 'FFF')!.shot).toBe(A(9, 7));
    const rear = pos('a', [[1, 'f', A(8, 7), 'e'], [0, 'b', A(2, 11), 'e']], 1);
    rear.planes[0].p = A(6, 7);
    expect(fly(rear, rear.planes[0], 'FFF')!.shot).toBe(-1);
    // синяя ракетная (7, 5): с тыла тоже сбит
    const rocket = pos('a', [[1, 'f', A(5, 5), 'e'], [0, 'b', A(2, 11), 'e']], 1);
    expect(fly(rocket, rocket.planes[0], 'FFF')!.shot).toBe(A(7, 5));
  });

  it('штаб: бомбардировщик над штабом — победа', () => {
    const s = pos('a', [[0, 'b', A(29, 2), 'n'], [1, 'f', A(20, 6), 'w']]);
    const r = apply(s, 0, { type: 'fly', id: 0, seq: 'FF' })!;
    expect(r.state.over).toBe(true);
    expect(r.state.why).toBe('hq');
  });

  it('«Аэрофото»: за ход — истребитель и бомбардировщик', () => {
    const s = newState(cfgFrom({ ver: 'b' }), 2);
    const f = legal(s, 0).find((a) => s.planes[a.id].kind === 'f')!;
    const s2 = apply(s, 0, f)!.state;
    expect(toAct(s2)).toEqual([0]);
    expect(legal(s2, 0).every((a) => s2.planes.find((x) => x.id === a.id)!.kind === 'b')).toBe(true);
    const b = legal(s2, 0)[0];
    expect(apply(s2, 0, b)!.state.side).toBe(1);
  });

  it('вчетвером ходят по очереди: бомбардировщики, истребители', () => {
    let s = newState(cfgFrom({ ver: 'a' }), 4);
    const order: number[] = [];
    for (let i = 0; i < 4; i++) {
      const seat = toAct(s)[0];
      order.push(seat);
      s = apply(s, seat, legal(s, seat)[0])!.state;
    }
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('партии ботов доходят до конца в обоих изданиях', async () => {
    const breathe = breather();
    for (const ver of ['a', 'b'] as const)
      for (const n of [2, 4]) {
        const rng = new SeededRng(n * 10 + (ver === 'a' ? 1 : 2));
        let s = newState(cfgFrom({ ver }), n);
        for (let i = 0; i < 3000 && !s.over; i++) {
          await breathe();
          const seat = toAct(s)[0];
          const a = choose(s, seat, i % 3, rng)!;
          s = apply(s, seat, a)!.state;
        }
        expect(s.over).toBe(true);
      }
  }, 300000);
});
