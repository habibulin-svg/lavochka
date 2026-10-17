/* «Магия»: поле, ход по лабиринту и стрелкам, знаки, «чёрный квадрат», посвящение. */
import { describe, expect, it } from 'vitest';
import { APEX, BSQ_START, BSQ_WEB, CELLS, LINES, MAIN, START, WEBS, cellByName, mazeNext } from '../src/games/magiya/data';
import { optsOf } from '../src/games/magiya/def';
import { apply, botAction, moves, newState, routes, type Opts, type State } from '../src/games/magiya/engine';
import type { Rng } from '../src/core/types';

const dice = (...v: number[]): Rng => {
  const q = [...v];
  return { next: () => 0.5, int: (n) => Math.min(n - 1, (q.shift() ?? 1) - 1), getState: () => 0 };
};
const game = (o: Partial<Opts> = {}): State => newState([{ seat: 0, name: 'А' }, { seat: 1, name: 'Б' }], { ...optsOf({}), ...o });
const put = (s: State, cell: number, more: Partial<State['heroes'][number]> = {}) => {
  s.heroes[0] = { ...s.heroes[0], cell, prev: -1, ...more };
};
/** Бросок; если путь один — игрок сам ставит фишку (go), при развилке — ждёт выбора. */
const roll = (s: State, d: number) => {
  const r = apply(s, 0, { type: 'roll' }, dice(d))!;
  if (r.state.phase !== 'move') return r;
  const ends = [...moves(r.state, 0, d).keys()];
  if (ends.length !== 1) return r;
  const g = apply(r.state, 0, { type: 'go', to: ends[0] }, dice())!;
  return { state: g.state, events: [...r.events, ...g.events] };
};
const before = (name: string, n: number) => MAIN[(MAIN.indexOf(cellByName(name)) - n + MAIN.length) % MAIN.length];

describe('ход сам', () => {
  it('после броска фишка стоит, пока игрок её не переставит — даже когда путь один', () => {
    const s = game();
    put(s, MAIN[5]);
    const r = apply(s, 0, { type: 'roll' }, dice(3))!.state;
    expect(r.phase).toBe('move');
    expect(r.heroes[0].cell).toBe(MAIN[5]);
    expect(botAction(r, 0, 1, dice())).toMatchObject({ type: 'go' });
  });
});

describe('поле', () => {
  it('основной путь замкнут, у всех клеток есть ход дальше', () => {
    expect(MAIN.length).toBeGreaterThan(130);
    for (const c of CELLS) {
      const out = c.region === 'maze' ? mazeNext(c.id) : c.next;
      expect(out.length, `клетка ${c.id} (${c.region})`).toBeGreaterThan(0);
    }
  });
  it('знаки на местах: 6 туннелей, 7 «Т», 8 духов по три владения, 12 красных стрелок', () => {
    expect(WEBS.length).toBe(6);
    expect(CELLS.filter((c) => c.sign.k === 'talisman').length).toBe(7);
    const dom = CELLS.filter((c) => c.sign.k === 'domain');
    expect(dom.length).toBe(24);
    expect(new Set(dom.map((c) => (c.sign as { spirit: string }).spirit)).size).toBe(8);
    expect(CELLS.filter((c) => c.sign.k === 'power').length).toBe(12);
    expect(CELLS.filter((c) => c.region === 'maze' && c.sign.k === 'gain').length).toBe(20);
  });
});

describe('ход', () => {
  it('в лабиринте не ходят на запад', () => {
    for (const c of CELLS.filter((x) => x.region === 'maze')) for (const n of mazeNext(c.id)) if (CELLS[n].rc) expect(CELLS[n].rc![1]).toBeGreaterThanOrEqual(c.rc![1]);
  });
  it('из «Начала пути» — в лабиринт', () => {
    const s = game();
    for (let d = 1; d <= 6; d++) for (const [end] of routes(s, 0, d)) expect(CELLS[end].region).toBe('maze');
    expect(s.heroes[0].cell).toBe(START);
  });
  it('по правилам в карман сворачивают только с остановки на зелёной стрелке', () => {
    const s = game({ arrows: 'stop' });
    put(s, cellByName('gAnkh'));
    expect([...routes(s, 0, 3).keys()].some((c) => CELLS[c].region === 'pocket')).toBe(true);
    put(s, before('gAnkh', 1));
    expect([...routes(s, 0, 3).keys()].some((c) => CELLS[c].region === 'pocket')).toBe(false);
    const p = game({ arrows: 'pass' });
    put(p, before('gAnkh', 1));
    expect([...routes(p, 0, 3).keys()].some((c) => CELLS[c].region === 'pocket')).toBe(true);
  });
});

describe('знаки', () => {
  it('владения духа: без защиты платят, с защитой — нет, с властью — получают', () => {
    const target = cellByName('koldun3');
    const s = game();
    put(s, before('koldun3', 2), { tri: 5 });
    expect(roll(s, 2).state.heroes[0].tri).toBe(2);
    put(s, before('koldun3', 2), { tri: 5, prot: ['koldun'] });
    expect(roll(s, 2).state.heroes[0].tri).toBe(5);
    put(s, before('koldun3', 2), { tri: 5, prot: ['koldun'], power: ['ankh', 'circles', 'candle', 'flame'] });
    const r = roll(s, 2).state.heroes[0];
    expect(r.cell).toBe(target);
    expect(r.tri).toBe(8);
  });
  it('нечем откупиться — портрет спасает, второй раз — «чёрный квадрат»', () => {
    const s = game();
    put(s, before('koldun3', 2), { tri: 0 });
    const a = roll(s, 2).state.heroes[0];
    expect(a.portrait).toBe(false);
    expect(a.cell).toBe(cellByName('koldun3'));
    put(s, before('koldun3', 2), { tri: 0, portrait: false });
    expect(roll(s, 2).state.heroes[0].cell).toBe(BSQ_START);
  });
  it('«чёрный квадрат»: девять шагов против часовой — туннель, выйти обязательно', () => {
    const s = game();
    put(s, BSQ_START, { portrait: false });
    let st = roll(s, 5).state;
    expect(st.turn).toBe(1);
    st.turn = 0;
    st = roll(st, 4).state;
    expect(st.heroes[0].cell).toBe(BSQ_WEB);
    expect(st.phase).toBe('tunnel');
    expect(apply(st, 0, { type: 'tunnel', to: null }, dice())).toBeNull();
    const out = apply(st, 0, { type: 'tunnel', to: WEBS[2] }, dice())!.state;
    expect(out.heroes[0].cell).toBe(WEBS[2]);
  });
  it('конверт: нет треугольников — пропуск ходов', () => {
    const s = game();
    put(s, before('envA', 1), { tri: 1 });
    const st = roll(s, 1).state;
    expect(st.heroes[0].skip).toBe(3);
  });
  it('синий кружок: переход по голубой линии со знаком клетки', () => {
    const s = game();
    put(s, before('Lb', 1), { tri: 3 });
    const st = roll(s, 1).state;
    expect(st.phase).toBe('line');
    const t = cellByName('tB');
    expect(LINES.B).toContain(t);
    const after = apply(st, 0, { type: 'line', to: t }, dice())!.state;
    expect(after.heroes[0].cell).toBe(t);
    expect(after.phase).toBe('take');
  });
  it('посвящение: все талисманы и точный бросок на вершину', () => {
    const s = game();
    const full = { prot: ['ghost', 'koldun', 'death', 'witch', 'vampire', 'night', 'dragon', 'leshy'] as never, power: ['ankh', 'circles', 'candle', 'flame'] as never };
    put(s, cellByName('blue'), full);
    const st = roll(s, 4).state;
    expect(st.phase).toBe('move');
    const won = apply(st, 0, { type: 'go', to: APEX }, dice())!.state;
    expect(won.heroes[0].mag).toBe(1);
    expect(won.over?.winners).toEqual([0]);
    // без талисманов вершина ничего не даёт
    put(s, cellByName('blue'), { prot: [], power: [] });
    const no = apply(roll(s, 4).state, 0, { type: 'go', to: APEX }, dice())!.state;
    expect(no.over).toBeNull();
  });
});
