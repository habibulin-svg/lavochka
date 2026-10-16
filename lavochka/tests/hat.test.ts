/* Шляпа: пары по кругу и командами, слово видит только объясняющий, угадано/ошибка/пропуск, время и последнее слово,
 * свои слова только без ботов, боты угадывают по подсказкам словаря, три круга. */
import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Options } from '../src/core/types';
import { loadClues } from '../src/words/clues';
import { botSeats, defaults, simulate } from './harness';
import { def } from '../src/games/hat/def';
import { apply, makeView, pairOf, redact, setup, toAct, type Action, type State } from '../src/games/hat/engine';
import { byHint, hintsFor, WORDS } from '../src/games/hat/words';

const rng = () => new SeededRng(7);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!.state;
};
const people = (n: number, opts: Record<string, unknown> = {}) =>
  setup(Array.from({ length: n }, (_, i) => i), { per: 3, time: 30, ...opts } as never, rng(), Array.from({ length: n }, (_, i) => i));

beforeAll(() => loadClues());

describe('шляпа', () => {
  it('словарь: три уровня, у слов есть подсказки, по подсказке находится слово', () => {
    expect(WORDS.length).toBeGreaterThan(10000);
    for (const d of [1, 2, 3]) expect(WORDS.filter((e) => e.d === d).length).toBeGreaterThan(1000);
    const i = WORDS.findIndex((e) => e.w === 'самолёт');
    const hs = hintsFor(i, 0);
    expect(hs.map((x) => x.kind)).toEqual(['long', 'short']);
    expect(byHint(hs[0].kind, hs[0].text)).toContain(i);
    expect(hintsFor(i, 2)).toEqual([{ kind: 'one', text: 'Аппарат' }]);
  });

  it('каждый с каждым: за n(n−1) ходов каждый объяснил каждому', () => {
    for (const n of [2, 3, 5, 6]) {
      const seats = Array.from({ length: n }, (_, i) => i);
      const pairs = new Set<string>();
      for (let t = 0; t < n * (n - 1); t++) {
        const [e, g] = pairOf({ seats, pairs: 'circle' }, t);
        expect(e).not.toBe(g);
        pairs.add(`${e}>${g}`);
      }
      expect(pairs.size).toBe(n * (n - 1));
    }
  });

  it('команды: постоянные пары, роли меняются', () => {
    const seats = [0, 1, 2, 3, 4, 5];
    const got = Array.from({ length: 6 }, (_, t) => pairOf({ seats, pairs: 'teams' }, t));
    expect(got).toEqual([[0, 3], [1, 4], [2, 5], [3, 0], [4, 1], [5, 2]]);
  });

  it('слово видит только объясняющий — и в view, и в событии', () => {
    const s = people(3);
    const r = apply(s, 0, { type: 'start' }, rng())!;
    const st = r.state;
    expect(makeView(st, [0]).word).toBeTruthy();
    expect(makeView(st, [1]).word).toBeNull();
    const draw = r.events.find((e) => e.type === 'draw')!;
    expect(redact(draw, [1])).toMatchObject({ w: null });
    expect(redact(draw, [0])).toMatchObject({ w: makeView(st, [0]).word });
  });

  it('угадано, ошибка, пропуск со штрафом', () => {
    let s = people(3, { skip: 'penalty', miss: 'burn' });
    s = go(s, 0, { type: 'start' });
    s = go(s, 0, { type: 'got' });
    expect(s.expl[0]).toBe(1);
    expect(s.gues[1]).toBe(1);
    const burned = s.cur!;
    s = go(s, 0, { type: 'miss' });
    expect(s.burned).toContain(burned);
    const skipped = s.cur!;
    s = go(s, 0, { type: 'skip' });
    expect(s.expl[0]).toBe(0);
    expect(s.gues[1]).toBe(0);
    expect(s.hat).toContain(skipped);
    // пропущенное в этот ход второй раз не тянется
    expect(s.cur).not.toBe(skipped);
    // угадывание голосом отмечает объясняющий, не угадывающий
    expect(apply(s, 1, { type: 'got' }, rng())).toBeNull();
  });

  it('пропуск запрещён; ошибка — слово возвращается', () => {
    let s = people(3, { skip: 'off', miss: 'return' });
    s = go(s, 0, { type: 'start' });
    expect(apply(s, 0, { type: 'skip' }, rng())).toBeNull();
    const k = s.cur!;
    s = go(s, 0, { type: 'miss' });
    expect(s.hat).toContain(k);
    expect(s.burned).toEqual([]);
  });

  it('время вышло: слово в шляпу; с последним словом — ещё шанс', () => {
    let s = people(3, { last: false });
    s = go(s, 0, { type: 'start' });
    const k = s.cur!;
    s = go(s, 1, { type: 'timeup' });
    expect(s.phase).toBe('review');
    expect(s.hat).toContain(k);
    expect(makeView(s, [2]).turn[0].w).toBe('');
    s = people(3);
    s = go(s, 0, { type: 'start' });
    s = go(s, 0, { type: 'timeup' });
    expect(s.phase).toBe('last');
    s = go(s, 0, { type: 'got' });
    expect(s.phase).toBe('review');
    expect(s.gues[1]).toBe(1);
    // чужой (не из пары) время не кончает
    s = go(go(s, 0, { type: 'next' }), 1, { type: 'start' });
    expect(apply(s, 0, { type: 'timeup' }, rng())).toBeNull();
  });

  it('свои слова: пишут тайно, только без ботов', () => {
    let s = people(3, { source: 'own', per: 2 });
    expect(s.phase).toBe('write');
    expect(toAct(s)).toEqual([0, 1, 2]);
    s = go(s, 0, { type: 'words', list: ['Самовар', 'двоечник'] });
    expect(makeView(s, [1]).myWords[0]).toBeUndefined();
    expect(apply(s, 1, { type: 'words', list: ['самовар'] }, rng())).toBeNull();
    s = go(s, 1, { type: 'words', list: ['трамвай', 'бабушка'] });
    s = go(s, 2, { type: 'words', list: ['чебурашка', 'каток'] });
    expect(s.phase).toBe('ready');
    expect(s.slips).toHaveLength(6);
    const withBots = setup([0, 1, 2], { source: 'own', per: 2 }, rng(), [0]);
    expect(withBots.phase).toBe('ready');
    expect(withBots.slips.every((x) => x.i != null)).toBe(true);
  });

  it('человек объясняет боту подсказками; бот угадывает', () => {
    let s = setup([0, 1, 2], { per: 2, time: 30 }, rng(), [0]);
    s = go(s, 0, { type: 'start' });
    expect(toAct(s)).toEqual([0, 1]);
    expect(apply(s, 0, { type: 'got' }, rng())).toBeNull();
    s = go(s, 0, { type: 'hint' });
    expect(s.hints).toHaveLength(1);
    const w = s.slips[s.cur!].w;
    const r = apply(s, 1, { type: 'guess', text: w.toUpperCase() }, rng())!;
    expect(r.state.gues[1]).toBe(1);
  });

  it('бот объясняет человеку: у человека варианты с верным словом', () => {
    let s = setup([0, 1, 2], { per: 2, time: 30 }, rng(), [1]);
    // начинает человек из пары
    expect(toAct(s)).toEqual([1]);
    s = go(s, 1, { type: 'start' });
    const v = makeView(s, [1]);
    expect(v.word).toBeNull();
    expect(v.options).toContain(s.slips[s.cur!].w);
    expect(v.options!.length).toBeGreaterThanOrEqual(4);
  });

  it('боты доигрывают: три круга, команды, без пропусков', async () => {
    for (const opts of [{ rounds: 3, per: 3 }, { pairs: 'teams' }, { skip: 'off', level: 'hard' }] as Options[]) {
      for (const lv of [[0], [2]]) {
        const res = await simulate(def, botSeats(def, 4, lv), { ...defaults(def), ...opts }, 11);
        expect(res.error, JSON.stringify(opts)).toBeUndefined();
        expect(res.finished, JSON.stringify(opts)).toBe(true);
      }
    }
  });

  it('сильные боты объясняют больше слов за ход', async () => {
    const perTurn = async (lv: number) => {
      let got = 0;
      let turns = 0;
      for (let k = 0; k < 6; k++) {
        const s0 = def.setup(botSeats(def, 4, [lv]), { ...defaults(def), per: 10 }, new SeededRng(100 + k));
        const res = await simulate(def, botSeats(def, 4, [lv]), { ...defaults(def), per: 10 }, 100 + k);
        expect(res.finished).toBe(true);
        got += s0.slips.length;
        turns += res.steps;
      }
      return got / turns;
    };
    // на ту же шляпу сильным нужно меньше действий
    expect(await perTurn(2)).toBeGreaterThan(await perTurn(0));
  });
});
