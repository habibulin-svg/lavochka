import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { CELLS, DECK, EDGES1, PLAY_CELLS, ROAD, ROAD_BY_ID, ROSETTES } from '../src/games/korona/data';
import { def } from '../src/games/korona/def';
import { apply, botAction, distances, kindOf, legalPath, neighbours, newState, result, routes, type Action, type State } from '../src/games/korona/engine';
import { START, STATS } from '../src/games/korona/rules';

const seats = [0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: 'Игрок ' + seat, level: 1 }));
const fresh = (seed = 7, need = 6) => newState(seats, { need }, new SeededRng(seed));

/** Ход с подкрученными кубиками (значения rng.int — бросок минус один). */
function act(s: State, a: Action, rig: number[] = []): State | null {
  const rng = new RiggedRng(new SeededRng(3));
  rng.rig(rig);
  const r = apply(s, s.turn, a, rng);
  return r ? r.state : null;
}

describe('Корона Эмбера: данные', () => {
  it('поле 1 собрано из отчёта, колода — только целые карточки', () => {
    expect(CELLS.length).toBe(81);
    expect(PLAY_CELLS.length).toBe(78);
    expect(DECK.length).toBeGreaterThan(120);
    for (const c of DECK) {
      expect(c.title.length, `карточка ${c.n}`).toBeGreaterThan(2);
      // обрывки соседних карточек (начинаются со строчной) в колоду не попадают; строка сил «магия ум сила» — можно
      expect(c.text, `карточка ${c.n}`).not.toMatch(/^(?!магия|ум|сила)[а-яё]/);
    }
  });

  it('дорога поля 2 замкнута: у каждой клетки есть выход, в столицу ведёт только «up»', () => {
    for (const r of ROAD) {
      const outs = [r.next, r.even, r.odd].filter(Boolean) as string[];
      expect(outs.length, r.id).toBeGreaterThan(0);
      for (const o of outs) expect(o === 'capital' || ROAD_BY_ID.has(o), `${r.id} → ${o}`).toBe(true);
    }
    expect(ROAD.filter((r) => r.next === 'capital').map((r) => r.id)).toEqual(['up']);
  });
});

describe('Корона Эмбера: проходы поля 1', () => {
  it('соседство симметрично, без петель, все игровые клетки (кроме подполей) связаны', () => {
    for (const [a, b] of EDGES1) {
      expect(a).not.toBe(b);
      expect(neighbours(b)).toContain(a);
    }
    const d = distances(1);
    // двери подполей — тупики при обходе, поэтому считаем связность от двери тоже
    const reach = new Set([...d.keys(), ...distances(33).keys(), ...distances(35).keys()]);
    for (const c of PLAY_CELLS) {
      if (c.subfield) continue;
      expect(reach.has(c.n), `клетка ${c.n} ${c.name}`).toBe(true);
    }
  });

  it('стены держат: через тёмную рамку и змей не пройти, через стрелки — можно', () => {
    expect(neighbours(14)).not.toContain(15); // Древний тракт | Караван-сарай — рамка
    expect(neighbours(7)).not.toContain(8); // чёрт между Миром Магии и Миром Ума
    expect(neighbours(26)).not.toContain(27); // змея
    expect(neighbours(7)).toContain(18); // стрелка в лазарет
    expect(neighbours(61)).toContain(70); // Пустошь → Аэропорт
  });

  it('маршруты: ровно на бросок, без разворота, с остановкой «проходом»', () => {
    const r = routes(72, 3);
    for (const [end, path] of r) {
      expect(legalPath(72, 3, path)).toBe(true);
      expect(path[path.length - 1]).toBe(end);
      expect(path.length === 3 || kindOf(end) !== 'plain').toBe(true);
    }
    expect(r.has(70)).toBe(true);
    // разворот на только что пройденную клетку запрещён
    expect(legalPath(72, 2, [73, 72])).toBe(false);
    // ЛАЗАРЕТ — «останавливаешься здесь проходом»
    expect(routes(7, 4).get(18)).toEqual([18]);
  });
});

describe('Корона Эмбера: ход', () => {
  it('бросок → выбор пути → клетка срабатывает → «Дальше» передаёт ход', () => {
    const s0 = fresh(5);
    const s1 = act(s0, { type: 'roll' }, [2])!;
    expect(s1.die).toBe(3);
    expect(s1.phase).toBe('pick');
    expect(act(s1, { type: 'go', path: [73, 74] })).toBeNull();
    const r2 = apply(s1, 0, { type: 'go', path: [73, 74, 70] }, new SeededRng(3))!;
    const s2 = r2.state;
    expect(r2.events.filter((e) => e.type === 'step').map((e) => (e as { cell: number }).cell).slice(0, 3)).toEqual([73, 74, 70]);
    // карточка могла ранить до нуля ПЖ — тогда путник очнулся в лазарете
    expect([70, 18]).toContain(s2.heroes[0].cell);
    expect(s2.phase).toBe('card');
    expect(s2.card?.n).not.toBeNull();
    const s3 = act(s2, { type: 'ok' })!;
    expect(s3.turn).toBe(1);
    expect(s3.phase).toBe('roll');
  });

  it('лицей учит по таблице с поля: 5 и 6 — по 2 ПС, ПУ, ПМ', () => {
    const s0 = fresh(5);
    const s = { ...s0, heroes: { ...s0.heroes, 0: { ...s0.heroes[0], cell: 10 } } };
    const s1 = act(s, { type: 'roll' }, [1])!;
    const s2 = act(s1, { type: 'go', path: [9, 8] }, [4, 5])!;
    expect(s2.card?.title).toBe('ЛИЦЕЙ');
    for (const k of ['ПС', 'ПУ', 'ПМ'] as const) expect(s2.heroes[0].st[k]).toBe(START[k] + 2);
  });

  it('Храм Бааля затягивает в подполе, выход — сектор 8 на Лысую гору', () => {
    const s0 = fresh(5);
    const s = { ...s0, heroes: { ...s0.heroes, 0: { ...s0.heroes[0], cell: 18 } } };
    const s1 = act(s, { type: 'roll' }, [0])!;
    const s2 = act(s1, { type: 'go', path: [26] })!;
    expect(s2.heroes[0].cell).toBe(25);
    expect(s2.heroes[0].sector).toBe(0);
    const back = { ...act(s2, { type: 'ok' })!, turn: 0 };
    // из сектора 0 бросок 6 → сектор 6; ещё 2 → сектор 8, выход
    const s3 = act(back, { type: 'roll' }, [5])!;
    expect(s3.heroes[0].sector).toBe(6);
    const s4 = act({ ...act(s3, { type: 'ok' })!, turn: 0 }, { type: 'roll' }, [1])!;
    expect(s4.heroes[0].sector).toBeNull();
    expect(s4.heroes[0].cell).toBe(ROSETTES[0].exit);
  });

  it('ПРОВАЛ пускает только с порогом по всем характеристикам', () => {
    const s0 = fresh(21, 6);
    const weak = { ...s0, heroes: { ...s0.heroes, 0: { ...s0.heroes[0], cell: 12 } } };
    const w = act(act(weak, { type: 'roll' }, [0])!, { type: 'go', path: [22] })!;
    expect(w.heroes[0].zone).toBe('world');
    expect(w.heroes[0].st['ПУ']).toBe(START['ПУ'] - 1);

    const strong = { ...s0, heroes: { ...s0.heroes, 0: { ...s0.heroes[0], cell: 12, st: { ПС: 6, ПУ: 6, ПМ: 6, ПО: 6 } } } };
    const o = act(act(strong, { type: 'roll' }, [0])!, { type: 'go', path: [22] })!;
    expect(o.heroes[0].zone).toBe('road');
    expect(o.heroes[0].st['ПО']).toBe(0);
  });

  it('дорога поля 2: развилка по чётности, столица делает принцем', () => {
    const s0 = fresh(21);
    // от верхней развилки чётный бросок ведёт наверх, в столицу
    const s = { ...s0, heroes: { ...s0.heroes, 0: { ...s0.heroes[0], zone: 'road' as const, node: 'FT' } } };
    const s1 = act(s, { type: 'roll' }, [1])!;
    expect(s1.heroes[0].zone).toBe('capital');
    expect(s1.heroes[0].prince).toBe(true);
    expect(s1.heroes[0].pj).toBeGreaterThan(4);
    // нечётный — вниз, к центру
    const s2 = act(s, { type: 'roll' }, [0])!;
    expect(s2.heroes[0].node).toBe('d1');
  });

  it('лабиринт, покои и коронация', () => {
    const s0 = fresh(21);
    let s: State = { ...s0, heroes: { ...s0.heroes, 0: { ...s0.heroes[0], zone: 'capital', prince: true, pj: 8, thalers: 30 } } };
    s = act(s, { type: 'buyPj' })!;
    expect(s.heroes[0].pj).toBe(9);
    s = { ...act(s, { type: 'labyrinth' })!, turn: 0 };
    expect(s.heroes[0].thalers).toBe(0);
    for (const r of [5, 5, 5]) s = { ...act(s, { type: 'roll' }, [r])!, turn: 0 };
    expect(s.heroes[0].zone).toBe('palace');
    expect(s.heroes[0].pj).toBe(9 + 1 + 2 + 3);
    for (let i = 0; i < 4; i++) s = { ...act(s, { type: 'climb' })!, turn: 0 };
    expect(s.heroes[0].room).toBe(3);
    const end = act(s, { type: 'climb' })!;
    expect(end.winner).toBe(0);
    expect(result(end)?.winner).toBe(0);
  });

  it('поединок: проигравший возвращается в столицу', () => {
    const s0 = fresh(21);
    const s: State = {
      ...s0,
      heroes: {
        0: { ...s0.heroes[0], zone: 'palace', prince: true, pj: 1 },
        1: { ...s0.heroes[1], zone: 'chambers', prince: true, pj: 1, room: 2 },
      },
    };
    const d = act(s, { type: 'challenge', target: 1 }, [5, 5, 0, 0])!;
    expect(d.heroes[1].zone).toBe('capital');
    expect(d.heroes[0].zone).toBe('chambers');
  });

  it('бот доводит партию двоих до коронации', () => {
    let s = def.setup(seats, { rules: 'simple', need: '6', deck: 'all' }, new SeededRng(9)) as State;
    const rng = new SeededRng(4);
    let n = 0;
    while (s.winner == null && n < 20000) {
      const a = botAction(s, s.turn, 1, rng)!;
      const r = def.apply(s, s.turn, a, rng);
      expect(r, JSON.stringify(a)).not.toBeNull();
      s = r!.state as State;
      n++;
    }
    expect(s.winner).not.toBeNull();
    for (const k of STATS) expect(typeof s.heroes[0].st[k]).toBe('number');
  });
});
