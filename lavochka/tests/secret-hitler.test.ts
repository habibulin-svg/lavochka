/* Тайный Гитлер: роли и знание своих, ограничение сроков, голосование, сессия, хаос, полномочия по размеру стола, вето, победы, тайна карт. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botSeats, simulate } from './harness';
import { def } from '../src/games/secret-hitler/def';
import { apply, boardPowers, eligible, makeView, setup, toAct, type Action, type Party, type Role, type State } from '../src/games/secret-hitler/engine';

const rng = () => new SeededRng(5);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)} (${s.phase})`).not.toBeNull();
  return r!.state;
};
/** Позиция: роли по порядку, колода задана, ночь пройдена, президент — pres. */
function pos(roles: Role[], deck: string, pres = 0, extra: Partial<State> = {}): State {
  const s = setup(roles.map((_, i) => i), {}, rng());
  s.roles = Object.fromEntries(roles.map((r, i) => [i, r]));
  s.deck = deck.split('') as Party[];
  s.phase = 'nominate';
  s.round = 1;
  s.rot = pres;
  s.pres = pres;
  return Object.assign(s, extra);
}
const R5: Role[] = ['liberal', 'fascist', 'liberal', 'hitler', 'liberal'];
const R7: Role[] = ['liberal', 'fascist', 'liberal', 'hitler', 'liberal', 'fascist', 'liberal'];
const voteAll = (s: State, ja: number[]) => {
  for (const x of s.seats.filter((y) => !s.dead.includes(y) && !(y in s.votes))) s = go(s, x, { type: 'vote', ja: ja.includes(x) });
  return s;
};

describe('тайный гитлер', () => {
  it('раздача: число ролей по таблице, фашисты знают своих, Гитлер — только при 5–6', () => {
    for (let n = 5; n <= 10; n++) {
      const s = setup(Array.from({ length: n }, (_, i) => i), {}, new SeededRng(n));
      const roles = Object.values(s.roles);
      expect(roles.filter((r) => r === 'hitler').length).toBe(1);
      expect(roles.filter((r) => r === 'fascist').length).toBe(n <= 6 ? 1 : n <= 8 ? 2 : 3);
      expect(s.deck.length).toBe(17);
      const h = s.seats.find((x) => s.roles[x] === 'hitler')!;
      const f = s.seats.find((x) => s.roles[x] === 'fascist')!;
      const l = s.seats.find((x) => s.roles[x] === 'liberal')!;
      expect(Object.keys(makeView(s, [l]).know[l])).toEqual([String(l)]);
      expect(makeView(s, [f]).know[f][h]).toBe('hitler');
      expect(f in makeView(s, [h]).know[h]).toBe(n <= 6);
      // чужие роли и колода не утекают
      const lv = JSON.stringify(makeView(s, [l]));
      expect(lv).not.toContain('"hitler"');
      expect(lv).not.toContain('"deck":[');
    }
  });

  it('ночь: все посмотрели — первый раунд у случайного президента', () => {
    let s = setup([0, 1, 2, 3, 4], {}, rng());
    const first = s.pres;
    for (const x of s.seats) s = go(s, x, { type: 'ready' });
    expect(s.phase).toBe('nominate');
    expect(s.pres).toBe(first);
    expect(s.round).toBe(1);
  });

  it('ограничение сроков: экс-президент и экс-канцлер; при пяти живых — только экс-канцлер', () => {
    const s = pos(R7, 'LLLFFFFFF', 2, { lastPres: 0, lastChanc: 1 });
    expect(eligible(s).sort()).toEqual([3, 4, 5, 6]);
    s.dead = [5, 6];
    expect(eligible(s).sort()).toEqual([0, 3, 4]);
    expect(apply(s, 2, { type: 'nominate', target: 1 }, rng())).toBeNull();
  });

  it('голосование: ничья — провал, президент дальше по кругу, трекер растёт; голоса скрыты до конца', () => {
    let s = pos(['liberal', 'fascist', 'liberal', 'hitler', 'liberal', 'liberal'], 'LLLFFFFFF');
    s = go(s, 0, { type: 'nominate', target: 1 });
    s = go(s, 0, { type: 'vote', ja: true });
    const v = makeView(s, [2]);
    expect(v.voted).toEqual([0]);
    expect(JSON.stringify(v)).not.toContain('"votes":{"0"');
    s = voteAll(s, [0, 1, 2]);
    expect(s.tracker).toBe(1);
    expect(s.pres).toBe(1);
    expect(s.phase).toBe('nominate');
    expect(s.lastChanc).toBeNull();
  });

  it('сессия: президент сбрасывает один, канцлер принимает один; карты видят только участники; заявления', () => {
    let s = pos(R5, 'LFFLLFFFF');
    s = go(s, 0, { type: 'nominate', target: 2 });
    s = voteAll(s, [0, 1, 2]);
    expect(s.phase).toBe('pres');
    expect(makeView(s, [0]).hand).toEqual(['L', 'F', 'F']);
    expect(makeView(s, [2]).hand).toBeNull();
    s = go(s, 0, { type: 'discard', index: 1 });
    expect(makeView(s, [2]).hand).toEqual(['L', 'F']);
    expect(makeView(s, [0]).hand).toBeNull();
    s = go(s, 2, { type: 'enact', index: 0 });
    expect(s.lib).toBe(1);
    expect(s.discard.length).toBe(2);
    expect(s.phase).toBe('claim');
    expect(toAct(s).sort()).toEqual([0, 2]);
    // заявление «передал больше фашистских, чем пришло» — нельзя
    expect(apply(s, 0, { type: 'claim', drew: 1, passed: 2 }, rng())).toBeNull();
    s = go(s, 0, { type: 'claim', drew: 3, passed: 2 });
    s = go(s, 2, { type: 'claim', got: 1 });
    expect(s.phase).toBe('nominate');
    expect(s.pres).toBe(1);
    // чужим — заявления видны, карты сессии нет
    const g = makeView(s, [4]).govs[0];
    expect(g.presClaim).toEqual({ drew: 3, passed: 2 });
    expect(g.drew).toBeUndefined();
    expect(g.gave).toBeUndefined();
    expect(makeView(s, [2]).govs[0].gave).toEqual(['L', 'F']);
    expect(makeView(s, [2]).govs[0].drew).toBeUndefined();
  });

  it('хаос: третий провал — принят верхний закон без полномочия, сроки сняты; колода пополняется', () => {
    let s = pos(R5, 'FLLFF', 0, { tracker: 2, fas: 2, lastPres: 3, lastChanc: 4, discard: ['L', 'F', 'F'] as Party[] });
    s = go(s, 0, { type: 'nominate', target: 1 });
    s = voteAll(s, []);
    expect(s.fas).toBe(3);
    expect(s.tracker).toBe(0);
    expect(s.lastPres).toBeNull();
    expect(s.lastChanc).toBeNull();
    expect(s.phase).toBe('nominate');
    expect(s.deck.length + s.discard.length).toBe(7);
  });

  it('Гитлер канцлер после трёх фашистских — победа фашистов; не Гитлер — отмечен', () => {
    let s = pos(R5, 'LLLFFFFFF', 0, { fas: 3 });
    s = go(s, 0, { type: 'nominate', target: 2 });
    s = voteAll(s, [0, 1, 2]);
    expect(s.notHitler).toEqual([2]);
    s = pos(R5, 'LLLFFFFFF', 0, { fas: 3 });
    s = go(s, 0, { type: 'nominate', target: 3 });
    s = voteAll(s, [0, 1, 3]);
    expect(s.winner).toBe('F');
    expect(def.result(s)!.winners.sort()).toEqual([1, 3]);
  });

  it('полномочия по столу; проверка видна только президенту; казнь Гитлера — победа либералов', () => {
    expect(boardPowers(5)).toEqual([null, null, 'peek', 'kill', 'kill']);
    expect(boardPowers(8)).toEqual([null, 'investigate', 'special', 'kill', 'kill']);
    expect(boardPowers(10)).toEqual(['investigate', 'investigate', 'special', 'kill', 'kill']);
    let s = pos(R7, 'FFFLLLFFF', 0, { fas: 1 });
    s = go(s, 0, { type: 'nominate', target: 2 });
    s = voteAll(s, [0, 2, 4, 6]);
    s = go(s, 0, { type: 'discard', index: 0 });
    s = go(s, 2, { type: 'enact', index: 0 });
    s = go(s, 0, { type: 'claim', drew: 3, passed: 2 });
    s = go(s, 2, { type: 'claim', got: 2 });
    expect(s.phase).toBe('power');
    expect(s.power).toBe('investigate');
    s = go(s, 0, { type: 'investigate', target: 3 });
    expect(makeView(s, [0]).inv).toEqual([{ by: 0, target: 3, party: 'F' }]);
    expect(makeView(s, [3]).inv).toEqual([]);
    s = go(s, 0, { type: 'claim', party: 'L' });
    expect(s.govs[0].powerClaim).toEqual({ party: 'L' });
    expect(s.phase).toBe('nominate');
    expect(s.pres).toBe(1);
    // внеочередные выборы: потом круг продолжается от назначившего
    let t = pos(R7, 'FFFLLLFFF', 4, { fas: 2 });
    t.phase = 'power';
    t.power = 'special';
    t.govs = [{ round: 1, pres: 4, chanc: 0 }];
    t = go(t, 4, { type: 'special', target: 1 });
    expect(t.pres).toBe(1);
    t = go(t, 1, { type: 'nominate', target: 2 });
    t = voteAll(t, []);
    expect(t.pres).toBe(5);
    // казнь
    let k = pos(R7, 'FFFLLLFFF', 4, { fas: 4 });
    k.phase = 'power';
    k.power = 'kill';
    k.govs = [{ round: 1, pres: 4, chanc: 0 }];
    const k2 = go(k, 4, { type: 'kill', target: 1 });
    expect(k2.dead).toEqual([1]);
    expect(k2.phase).toBe('nominate');
    expect(toAct({ ...k2, phase: 'vote' } as State)).not.toContain(1);
    k = go(k, 4, { type: 'kill', target: 3 });
    expect(k.winner).toBe('L');
  });

  it('вето: после пяти фашистских; президент против — канцлер принимает; согласен — трекер +1', () => {
    let s = pos(R5, 'FFLFFFFFF', 0, { fas: 5 });
    s = go(s, 0, { type: 'nominate', target: 2 });
    s = voteAll(s, [0, 2, 4]);
    s = go(s, 0, { type: 'discard', index: 2 });
    s = go(s, 2, { type: 'veto' });
    s = go(s, 0, { type: 'vetoAnswer', yes: false });
    expect(s.phase).toBe('chanc');
    expect(apply(s, 2, { type: 'veto' }, rng())).toBeNull();
    const won = go(s, 2, { type: 'enact', index: 0 });
    expect(won.winner).toBe('F');
    s = pos(R5, 'FFLFFFFFF', 0, { fas: 5 });
    s = go(s, 0, { type: 'nominate', target: 2 });
    s = voteAll(s, [0, 2, 4]);
    s = go(s, 0, { type: 'discard', index: 2 });
    s = go(s, 2, { type: 'veto' });
    s = go(s, 0, { type: 'vetoAnswer', yes: true });
    expect(s.tracker).toBe(1);
    expect(s.fas).toBe(5);
    expect(s.phase).toBe('claim');
  });

  it('пять либеральных — победа либералов', () => {
    let s = pos(R5, 'LLFFFFFFF', 0, { lib: 4 });
    s = go(s, 0, { type: 'nominate', target: 2 });
    s = voteAll(s, [0, 2, 4]);
    s = go(s, 0, { type: 'discard', index: 2 });
    s = go(s, 2, { type: 'enact', index: 0 });
    expect(s.winner).toBe('L');
    expect(def.result(s)!.winners.sort()).toEqual([0, 2, 4]);
  });

  it('боты: партии доигрываются, сложные либералы выигрывают чаще лёгких', async () => {
    const wins = { easy: 0, hard: 0 };
    const N = 40;
    for (let k = 0; k < N; k++) {
      for (const [lv, key] of [[0, 'easy'], [2, 'hard']] as const) {
        const seats = botSeats(def, 7, [lv]);
        const opts = {};
        const st = def.setup(seats, opts, new SeededRng(500 + k));
        const res = await simulate(def, seats, opts, 500 + k);
        expect(res.finished).toBe(true);
        if (res.winners.some((x) => st.roles[x] === 'liberal')) wins[key]++;
      }
    }
    console.log('либералы выиграли из', N, wins);
    expect(wins.hard).toBeGreaterThan(0);
  }, 120_000);
});
