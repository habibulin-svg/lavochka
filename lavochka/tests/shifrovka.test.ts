/* Шифровка: раздача ключа, проверка подсказки, ход отгадчиков (число + 1, чужое/нейтральное — переход, ловушка), победа,
 * тайна ключа, одной командой, словарь ассоциаций; боты — сложный капитан с командой сильнее лёгкого. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botSeats, simulate } from './harness';
import { def } from '../src/games/shifrovka/def';
import { strength } from '../src/games/shifrovka/ai';
import { apply, clueProblem, makeView, setup, toAct, TOPO, WORDS, type Action, type Kind, type State } from '../src/games/shifrovka/engine';

const rng = () => new SeededRng(7);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)} (${s.phase})`).not.toBeNull();
  return r!.state;
};
const idx = (s: State, k: Kind) => s.key.map((x, i) => (x === k && s.opened[i] == null ? i : -1)).filter((i) => i >= 0);
const safeClue = 'абвгд';
const game = (n = 4, opts: Record<string, unknown> = {}) => {
  const s = setup(Array.from({ length: n }, (_, i) => i), { mode: 'teams', traps: 1, topo: true, ...opts } as never, rng(), [0, 1, 2, 3, 4, 5, 6, 7]);
  return s;
};

describe('шифровка', () => {
  it('словарь: 470 слов и 40 топонимов без повторов, у каждого слова ассоциации', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(450);
    expect(TOPO.length).toBeGreaterThanOrEqual(30);
    const all = [...WORDS, ...TOPO].map((w) => w.toLowerCase().replace(/ё/g, 'е'));
    expect(new Set(all).size).toBe(all.length);
    for (const w of [...WORDS, ...TOPO]) expect(strength(w, 'zzz')).toBe(0);
    expect(strength('ключ', 'замок')).toBeGreaterThan(0.8);
    expect(strength('Париж', 'франция')).toBeGreaterThan(0.8);
  });

  it('раздача: 9 у начинающей, 8 у второй, 7 нейтральных, ловушка; топонимов не больше трёх', () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = setup([0, 1, 2, 3], { mode: 'teams' }, new SeededRng(seed));
      const c = (k: Kind) => s.key.filter((x) => x === k).length;
      expect(c(s.turn as Kind)).toBe(9);
      expect(c((1 - s.turn) as Kind)).toBe(8);
      expect(c('n')).toBe(7);
      expect(c('x')).toBe(1);
      expect(new Set(s.words).size).toBe(25);
      expect(s.words.filter((w) => TOPO.includes(w)).length).toBeLessThanOrEqual(3);
      expect(s.teams).toEqual([[0, 2], [1, 3]]);
      expect(s.captains).toEqual([0, 1]);
    }
    const t = setup([0, 1, 2, 3], { mode: 'teams', traps: 3 }, new SeededRng(1));
    expect(t.key.filter((x) => x === 'x').length).toBe(3);
    expect(t.key.filter((x) => x === 'n').length).toBe(5);
  });

  it('подсказка: одно слово, не с поля и не однокоренное', () => {
    const board = ['рыба', 'лес', 'ключ'];
    const op = [null, null, null];
    expect(clueProblem('море', board, op)).toBeNull();
    expect(clueProblem('рыба', board, op)).not.toBeNull();
    expect(clueProblem('Рыбак', board, op)).not.toBeNull();
    expect(clueProblem('лесник', board, op)).not.toBeNull();
    expect(clueProblem('два слова', board, op)).not.toBeNull();
    expect(clueProblem('sea', board, op)).not.toBeNull();
    // открытое слово с поля уже можно
    expect(clueProblem('рыбак', board, [5, null, null])).toBeNull();
  });

  it('ход: своё — дальше до числа + 1, нейтральное — ход переходит; остановиться можно после первого', () => {
    let s = game();
    const t = s.turn;
    const cap = s.captains[t];
    const g = s.teams[t].find((x) => x !== cap)!;
    expect(toAct(s)).toEqual([cap]);
    expect(apply(s, g, { type: 'clue', word: safeClue, n: 1 }, rng())).toBeNull();
    s = go(s, cap, { type: 'clue', word: safeClue, n: 1 });
    expect(toAct(s)).toEqual([g]);
    expect(apply(s, g, { type: 'stop' }, rng())).toBeNull();
    const mine = idx(s, t as Kind);
    s = go(s, g, { type: 'guess', index: mine[0] });
    s = go(s, g, { type: 'guess', index: mine[1] });
    // число + 1 исчерпано — ход у соперников
    expect(s.turn).toBe(1 - t);
    expect(s.phase).toBe('clue');
    const c2 = s.captains[s.turn];
    const g2 = s.teams[s.turn].find((x) => x !== c2)!;
    s = go(s, c2, { type: 'clue', word: safeClue + 'е', n: 3 });
    s = go(s, g2, { type: 'guess', index: idx(s, 'n')[0] });
    expect(s.turn).toBe(t);
  });

  it('ловушка — поражение; последнее своё слово — победа, даже открытое соперниками', () => {
    let s = game();
    const t = s.turn;
    s = go(s, s.captains[t], { type: 'clue', word: safeClue, n: 2 });
    s = go(s, s.teams[t][1], { type: 'guess', index: idx(s, 'x')[0] });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(1 - t);
    expect(def.result(s)!.winners).toEqual(s.teams[1 - t]);

    let w = game();
    const u = w.turn;
    const theirs = idx(w, (1 - u) as Kind);
    for (const i of theirs.slice(1)) w.opened[i] = 99;
    w = go(w, w.captains[u], { type: 'clue', word: safeClue, n: 1 });
    w = go(w, w.teams[u][1], { type: 'guess', index: theirs[0] });
    expect(w.winner).toBe(1 - u);
  });

  it('тайна: отгадчик видит только открытые цвета, капитан — весь ключ; пометки не тратят ход', () => {
    let s = game();
    const t = s.turn;
    const g = s.teams[t][1];
    const vg = makeView(s, [g]);
    expect(vg.fullKey).toBe(false);
    expect(vg.key.every((k) => k === null)).toBe(true);
    expect(makeView(s, [s.captains[1 - t]]).key.every((k) => k !== null)).toBe(true);
    s = go(s, s.captains[t], { type: 'clue', word: safeClue, n: 2 });
    s = go(s, g, { type: 'mark', index: 3 });
    expect(s.marks[3]).toEqual([g]);
    expect(toAct(s)).toEqual([g]);
    const i = idx(s, 'n')[0];
    s = go(s, g, { type: 'guess', index: i });
    expect(makeView(s, [g]).key[i]).toBe('n');
    expect(s.marks).toEqual({});
  });

  it('одной командой: соперник открывает слово после каждого хода; все его слова — поражение', () => {
    let s = setup([0, 1], { mode: 'coop' }, rng(), [0, 1]);
    expect(s.teams).toEqual([[0, 1]]);
    expect(s.turn).toBe(0);
    const before = idx(s, 1).length;
    s = go(s, 0, { type: 'clue', word: safeClue, n: 1 });
    s = go(s, 1, { type: 'guess', index: idx(s, 0)[0] });
    s = go(s, 1, { type: 'stop' });
    expect(idx(s, 1).length).toBe(before - 1);
    expect(s.phase).toBe('clue');
    expect(s.rounds).toBe(2);
    for (const i of idx(s, 1).slice(1)) s.opened[i] = -1;
    s = go(s, 0, { type: 'clue', word: safeClue + 'е', n: 1 });
    s = go(s, 1, { type: 'guess', index: idx(s, 'n')[0] });
    expect(s.phase).toBe('over');
    expect(s.winner).toBeNull();
    expect(def.result(s)!.winners).toEqual([]);
  });

  it('боты: партии доходят до конца; команда сложного капитана сильнее лёгкой', async () => {
    let strong = 0;
    const N = 16;
    for (let seed = 1; seed <= N; seed++) {
      // места 0, 2 — сложные; 1, 3 — лёгкие
      const seats = botSeats(def, 4, [2, 0, 2, 0]);
      const r = await simulate(def, seats, { mode: 'teams', traps: 1, topo: true }, seed);
      expect(r.finished, r.error).toBe(true);
      if (r.winners.includes(0)) strong++;
    }
    expect(strong).toBeGreaterThanOrEqual(N * 0.6);
    for (let seed = 1; seed <= 4; seed++) {
      const r = await simulate(def, botSeats(def, 3, [2, 2, 2]), { mode: 'coop', traps: 1, topo: true }, seed);
      expect(r.finished, r.error).toBe(true);
    }
  });
});
