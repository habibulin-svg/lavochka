import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { CARDS, CELLS, LINKS, PLAY_CELLS } from '../src/games/korona/data';
import { apply, kindOf, neighbours, newState, result, stepTargets, type Action, type State } from '../src/games/korona/engine';
import { DECK_SIZE, START, STATS } from '../src/games/korona/rules';

const seats = [0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: 'Игрок ' + seat, level: 2 }));
const fresh = (seed = 7) => newState(seats, {}, new SeededRng(seed));

/** Сделать ход, если он законен; вернуть новое состояние или null. */
function act(s: State, a: Action): State | null {
  const r = apply(s, s.turn, a, new SeededRng(3));
  return r ? r.state : null;
}

/** Простой бот: бросает, идёт к ближайшей клетке с ПРОВАЛОМ, иначе к соседу с меньшим номером. */
function auto(s: State): Action | null {
  if (s.phase === 'roll') return { type: 'roll' };
  if (s.phase === 'card') return { type: 'ok' };
  if (s.phase === 'step') {
    const targets = stepTargets(s, s.turn);
    if (!targets.length) return null;
    const fall = targets.find((n) => kindOf(n) === 'fall');
    return { type: 'step', to: fall ?? targets[0] };
  }
  return null;
}

describe('Корона Эмбера: данные', () => {
  it('поле 1 собрано из отчёта', () => {
    expect(CELLS.length).toBe(81);
    expect(PLAY_CELLS.length).toBe(78);
    expect(LINKS.length).toBe(37);
    expect(CARDS.length).toBeGreaterThanOrEqual(189);
  });

  it('колода — двести разных карточек', () => {
    expect(DECK_SIZE).toBe(200);
    const s = fresh(11);
    expect(s.deck.length).toBe(200);
    expect(new Set(s.deck).size).toBe(200);
  });
});

describe('Корона Эмбера: граф движения', () => {
  it('соседство симметрично и без петель', () => {
    for (const c of PLAY_CELLS) {
      for (const n of neighbours(c.n)) {
        expect(n, `клетка ${c.n}`).not.toBe(c.n);
        expect(neighbours(n), `сосед ${n} клетки ${c.n}`).toContain(c.n);
      }
    }
  });

  it('у каждой клетки сетки есть хотя бы один сосед', () => {
    for (const c of PLAY_CELLS) {
      if (c.subfield) continue;
      expect(neighbours(c.n).length, `клетка ${c.n}`).toBeGreaterThan(0);
    }
  });
});

describe('Корона Эмбера: ход', () => {
  it('бросок даёт шаги, шаг идёт только к соседу, ход переходит дальше', () => {
    const s0 = fresh(5);
    const s1 = act(s0, { type: 'roll' })!;
    expect(s1.die).toBeGreaterThanOrEqual(1);
    expect(s1.die).toBeLessThanOrEqual(6);
    expect(s1.left).toBe(s1.die);
    // шаг не к соседу отклоняется
    const here = s1.heroes[s1.turn].cell;
    const alien = PLAY_CELLS.map((c) => c.n).find((n) => n !== here && !neighbours(here).includes(n))!;
    expect(act(s1, { type: 'step', to: alien })).toBeNull();
    // шаг к соседу проходит
    const to = neighbours(here)[0];
    const s2 = act(s1, { type: 'step', to })!;
    expect(s2.heroes[s2.turn].cell).toBe(to);
    expect(s2.left).toBe(s1.left - 1);
  });

  it('партия продвигается: ходы сменяются, никто не застревает', () => {
    // до самого Эмбера простым ботом не дойти — там нужно 13 по всем характеристикам,
    // это и есть долгая игра; проверяем, что ход не залипает и фишки двигаются.
    let s = fresh(13);
    const visited = new Set<number>([s.heroes[0].cell]);
    const turns = new Set<number>();
    for (let i = 0; i < 60 && s.winner == null; i++) {
      const a = auto(s);
      if (!a) break;
      const next = act(s, a);
      if (!next) break;
      s = next;
      turns.add(s.turn);
      for (const seat of s.seats) visited.add(s.heroes[seat].cell);
    }
    expect(turns.size, 'ходят разные игроки').toBeGreaterThan(1);
    expect(visited.size, 'фишки побывали на разных клетках').toBeGreaterThan(3);
  });

  it('итог партии считается, когда кто-то вышел в Эмбер', () => {
    const s0 = fresh(21);
    const fallCell = PLAY_CELLS.map((c) => c.n).find((n) => kindOf(n) === 'fall')!;
    const h = s0.heroes[0];
    const strong: State = {
      ...s0,
      turn: 0,
      phase: 'roll',
      heroes: { ...s0.heroes, [0]: { ...h, cell: fallCell, items: [], st: { ПС: 13, ПУ: 13, ПМ: 13, ПО: 13 } } },
    };
    const end = act(strong, { type: 'roll' })!;
    expect(end.winner).toBe(0);
    expect(result(end)?.winner).toBe(0);
    expect(result(end)?.scores.length).toBe(2);
  });

  it('ПРОВАЛ пускает в Эмбер только с 13 по всем характеристикам и пустой котомкой', () => {
    const s0 = fresh(21);
    const fallCell = PLAY_CELLS.map((c) => c.n).find((n) => kindOf(n) === 'fall')!;
    const h = s0.heroes[0];
    const weak: State = { ...s0, heroes: { ...s0.heroes, [0]: { ...h, cell: fallCell } }, turn: 0, phase: 'roll' };
    const played = act(weak, { type: 'roll' })!;
    expect(played.winner).toBeNull();
    expect(played.heroes[0].st['ПУ']).toBeLessThan(START['ПУ']);

    const strong: State = {
      ...s0,
      turn: 0,
      phase: 'roll',
      heroes: { ...s0.heroes, [0]: { ...h, cell: fallCell, items: [], st: { ПС: 13, ПУ: 13, ПМ: 13, ПО: 13 } } },
    };
    const out = act(strong, { type: 'roll' })!;
    expect(out.winner).toBe(0);
    for (const k of STATS) expect(out.heroes[0].st[k]).toBeGreaterThanOrEqual(13);
  });
});
