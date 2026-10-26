import { describe, expect, it } from 'vitest';
import { choose } from '../src/games/puluk/ai';
import { def } from '../src/games/puluk/def';
import { apply, applyMove, applyRoll, cfgFrom, legalMoves, newState, sideFree, throwValue, type Stack, type State } from '../src/games/puluk/engine';
import { SeededRng } from '../src/core/rng';

const kern = (v: number) => [0, 1, 2, 3].map((i) => (v < 5 && i < v ? 1 : 0));

/** Позиция: стопки [поле, место, пленные, направление?], воины дома. Ходит место turn. */
function pos(list: [number, number, number[], (1 | -1)?][], home: number[], opts = {}, turn = 0): State {
  const s = newState(cfgFrom(opts), turn);
  for (const [c, seat, pris, dir] of list) s.track[c] = { seat, dir: dir ?? (seat % 2 === 0 ? 1 : -1), pris } as Stack;
  s.home = home;
  return s;
}

function game(levels: number[], seed: number, opts = {}): State {
  const rng = new SeededRng(seed);
  let s = def.setup([], { ...opts }, rng) as State;
  for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
    const a = choose(s, s.turn, levels[s.turn], rng);
    if (!a) throw new Error('бот не нашёл хода');
    const r = apply(s, s.turn, a, rng);
    if (!r) throw new Error('недопустимый ход бота');
    s = r.state;
  }
  return s;
}

describe('пулук', () => {
  it('зёрна: число меток, ни одной — 5', () => {
    expect(throwValue([1, 0, 0, 0])).toBe(1);
    expect(throwValue([1, 1, 1, 1])).toBe(4);
    expect(throwValue([0, 0, 0, 0])).toBe(5);
  });

  it('вход: каждый от своего дома, навстречу', () => {
    let s = applyRoll(newState(cfgFrom({}), 0), kern(3)).state;
    s = applyMove(s, -1)!.state;
    expect(s.track[2]?.seat).toBe(0);
    s = applyRoll(s, kern(5)).state;
    s = applyMove(s, -1)!.state;
    expect(s.track[5]?.seat).toBe(1);
  });

  it('на своего встать нельзя, перескакивать можно', () => {
    const s = applyRoll(pos([[1, 0, []], [3, 0, []], [2, 1, []]], [3, 4]), kern(2)).state;
    expect(legalMoves(s).map((m) => m.from)).toEqual([3]);
  });

  it('плен: враг едет под захватчиком; захват стопки освобождает своих', () => {
    let s = applyRoll(pos([[2, 0, []], [5, 1, []]], [4, 4]), kern(3)).state;
    s = applyMove(s, 2)!.state;
    expect(s.track[5]).toMatchObject({ seat: 0, pris: [1] });
    s = applyRoll(s, kern(1)).state;
    // чёрные выходят прямо на захватчика: он в плену, свой пленный свободен и дома
    const t = applyRoll(pos([[9, 0, [1]]], [4, 3], {}, 1), kern(1)).state;
    const r = applyMove(t, -1)!.state;
    expect(r.track[9]).toMatchObject({ seat: 1, pris: [0] });
    expect(r.home[1]).toBe(3); // 3 − 1 вышедший + 1 освобождённый
  });

  it('конец дорожки: воин домой, пленные убиты; перебор не нужен', () => {
    let s = applyRoll(pos([[8, 0, [1, 1]]], [4, 3]), kern(4)).state;
    s = applyMove(s, 8)!.state;
    expect(s.track.every((t) => !t)).toBe(true);
    expect(s.home[0]).toBe(5);
    expect(s.dead[1]).toBe(2);
  });

  it('домой с добычей: взявший разворачивается и уводит пленного к своему дому', () => {
    let s = applyRoll(pos([[2, 0, []], [4, 1, []]], [4, 4], { back: true }), kern(2)).state;
    s = applyMove(s, 2)!.state;
    expect(s.track[4]).toMatchObject({ seat: 0, dir: -1, pris: [1] });
    s = applyMove(applyRoll(s, kern(1)).state, -1)!.state;
    s = applyMove(applyRoll(s, kern(5)).state, 4)!.state;
    expect(s.dead[1]).toBe(1);
    expect(s.home[0]).toBe(5);
  });

  it('победа: у соперника не осталось свободных воинов', () => {
    let s = applyRoll(pos([[2, 0, []], [5, 1, [0]]], [3, 0]), kern(3)).state;
    s = applyMove(s, 2)!.state;
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(def.result(s)?.winners).toEqual([0]);
  });

  it('командная: четверо, ходят по кругу, напарник не встаёт на напарника', () => {
    const s0 = newState(cfgFrom({ teams: true }), 0);
    expect(s0.n).toBe(4);
    expect(def.teams!({ teams: true }, [0, 1, 2, 3])).toEqual([[0, 2], [1, 3]]);
    let s = applyMove(applyRoll(s0, kern(2)).state, -1)!.state;
    expect(s.turn).toBe(1);
    s = applyMove(applyRoll(s, kern(1)).state, -1)!.state;
    expect(s.turn).toBe(2);
    const r = applyRoll(s, kern(2)); // поле 1 занято напарником — ход пропал, ходит следующий
    expect(r.events[0]).toMatchObject({ seat: 2, none: true });
    expect(r.state.turn).toBe(3);
  });

  it('партии ботов доходят до конца на всех пресетах', () => {
    const presets = def.presets!;
    presets.forEach((p, k) => {
      for (let g = 0; g < 3; g++) {
        const n = p.options.teams ? 4 : 2;
        const levels = Array.from({ length: n }, (_, i) => (g + i + k) % 3);
        const s = game(levels, 100 + g * 7 + k, p.options);
        expect(s.phase, p.id).toBe('over');
        expect(s.why).toBe('all');
        expect(sideFree(s, 1 - s.winner!)).toBe(0);
      }
    });
  });

  it('сложный бот чаще побеждает лёгкого', () => {
    let wins = 0;
    for (let g = 0; g < 16; g++) {
      const hard = g % 2;
      const s = game(hard ? [0, 2] : [2, 0], 500 + g);
      if (s.winner === (hard ? 1 : 0)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(11);
  });
});
