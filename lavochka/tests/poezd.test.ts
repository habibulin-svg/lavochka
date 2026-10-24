/* «Поездом по СССР»: ключевые правила — оплата путей, паромы, тоннели, двойные пути, станции, контролёр, конец игры и подсчёт. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/poezd/ai';
import { CITIES, ROUTES } from '../src/games/poezd/board';
import { COLORS, CTRL, LOCO, TICKETS } from '../src/games/poezd/data';
import { apply, cfgFrom, longestPath, newState, syncCounts, ticketScore, toAct, view, type State } from '../src/games/poezd/engine';

const city = (n: string) => CITIES.findIndex((c) => c.name === n);
const route = (a: string, b: string, color?: string) =>
  ROUTES.findIndex((r) => ((r.a === city(a) && r.b === city(b)) || (r.a === city(b) && r.b === city(a))) && (!color || r.color === color));
const hand = (spec: Record<string, number>) => {
  const h = new Array(10).fill(0);
  for (const [k, n] of Object.entries(spec)) h[k === 'loco' ? LOCO : k === 'ctrl' ? CTRL : COLORS.indexOf(k as never)] = n;
  return h;
};

function game(n = 2, opts = {}): State {
  const s = newState(n, cfgFrom(opts), new SeededRng(5));
  s.phase = 'act';
  s.offer = s.offer.map(() => null);
  s.tickets = s.tickets.map(() => []);
  syncCounts(s);
  return s;
}

describe('Поездом по СССР', () => {
  it('разметка: 47 городов, у каждого пути — столько вагончиков, сколько длина', () => {
    expect(CITIES.length).toBe(47);
    for (const r of ROUTES) expect(r.cars.length).toBe(r.len);
    expect(TICKETS.length).toBe(57);
  });

  it('цветной путь — картами его цвета, серый — любого одного, локомотив добавляется', () => {
    const s = game();
    s.hand[0] = hand({ purple: 1, red: 2, loco: 1 });
    const rng = new SeededRng(1);
    expect(apply(s, 0, { type: 'claim', route: route('Москва', 'Казань', 'purple'), color: 0, locos: 0 }, rng)).toBeNull();
    const r = apply(s, 0, { type: 'claim', route: route('Москва', 'Казань', 'purple'), color: 5, locos: 1 }, rng)!;
    expect(r.state.owner[route('Москва', 'Казань', 'purple')]).toBe(0);
    expect(r.state.score[0]).toBe(2);
    expect(r.state.wagons[0]).toBe(43);
  });

  it('вдвоём двойной путь закрывается; втроём — нет, но оба одному нельзя', () => {
    const s = game(2);
    s.owner[route('Москва', 'Ленинград', 'blue')] = 1;
    s.hand[0] = hand({ red: 2 });
    expect(apply(s, 0, { type: 'claim', route: route('Москва', 'Ленинград', 'gray'), color: 0, locos: 0 }, new SeededRng(1))).toBeNull();
    const t = game(3);
    t.owner[route('Москва', 'Ленинград', 'blue')] = 1;
    t.hand[0] = hand({ red: 2 });
    expect(apply(t, 0, { type: 'claim', route: route('Москва', 'Ленинград', 'gray'), color: 0, locos: 0 }, new SeededRng(1))).not.toBeNull();
    t.owner[route('Москва', 'Ленинград', 'blue')] = 0;
    expect(apply(t, 0, { type: 'claim', route: route('Москва', 'Ленинград', 'gray'), color: 0, locos: 0 }, new SeededRng(1))).toBeNull();
  });

  it('паром требует локомотив за паровоз', () => {
    const s = game();
    s.hand[0] = hand({ blue: 3, loco: 1 });
    const r = route('Ростов на Дону', 'Баку');
    expect(apply(s, 0, { type: 'claim', route: r, color: 4, locos: 0 }, new SeededRng(1))).toBeNull();
    expect(apply(s, 0, { type: 'claim', route: r, color: 4, locos: 1 }, new SeededRng(1))).not.toBeNull();
  });

  it('тоннель: совпадения — доплата, отказ — карты назад', () => {
    const s = game();
    s.hand[0] = hand({ purple: 3 });
    s.deck.push(LOCO, 5, 2);
    const r = route('Норильск', 'Хатанга', 'purple');
    const a = apply(s, 0, { type: 'claim', route: r, color: 5, locos: 0 }, new SeededRng(1))!;
    expect(a.state.phase).toBe('tunnel');
    expect(a.state.tunnel!.extra).toBe(2);
    // фиолетовая одна — не хватает
    expect(apply(a.state, 0, { type: 'tunnel', pay: true }, new SeededRng(1))).toBeNull();
    const b = apply(a.state, 0, { type: 'tunnel', pay: false }, new SeededRng(1))!;
    expect(b.state.owner[r]).toBeNull();
    expect(b.state.hand[0]![5]).toBe(3);
    expect(b.state.turn).toBe(1);
  });

  it('открытый локомотив — единственная карта хода; вторым его брать нельзя', () => {
    const s = game();
    s.open = [LOCO, 0, 1, 2, 3];
    const a = apply(s, 0, { type: 'draw', slot: 0 }, new SeededRng(1))!;
    expect(a.state.turn).toBe(1);
    const t = game();
    t.open = [0, LOCO, 1, 2, 3];
    const b = apply(t, 0, { type: 'draw', slot: 0 }, new SeededRng(1))!;
    expect(b.state.phase).toBe('second');
    expect(apply(b.state, 0, { type: 'draw', slot: 1 }, new SeededRng(1))).toBeNull();
  });

  it('станция: первая — цвет пути из города, в конце — проезд по чужому пути', () => {
    const s = game();
    s.hand[0] = hand({ red: 1, blue: 1 });
    const len = city('Ленинград');
    // из Ленинграда есть серые пути — годится любой цвет
    const a = apply(s, 0, { type: 'station', city: len, color: 0, locos: 0 }, new SeededRng(1))!;
    expect(a.state.station[len]).toBe(0);
    const t = a.state;
    t.owner[route('Москва', 'Ленинград', 'blue')] = 1;
    t.tickets[0] = [TICKETS.findIndex((x) => x.a === city('Киев') && x.b === city('Ленинград'))];
    t.owner[route('Киев', 'Москва', 'red')] = 0;
    expect(ticketScore(t, 0, t.tickets[0]!).done.length).toBe(1);
  });

  it('контролёр разбирает чужой путь до 4 вагончиков', () => {
    const s = game();
    const r = route('Москва', 'Казань', 'orange');
    s.owner[r] = 1;
    s.wagons[1] = 43;
    s.score[1] = 2;
    s.hand[0] = hand({ ctrl: 1 });
    const a = apply(s, 0, { type: 'ctrl', route: r, mode: 'remove' }, new SeededRng(1))!;
    expect(a.state.owner[r]).toBeNull();
    expect(a.state.wagons[1]).toBe(45);
    expect(a.state.score[1]).toBe(0);
    expect(apply(s, 0, { type: 'ctrl', route: route('Москва', 'Воркута', 'blue'), mode: 'build' }, new SeededRng(1))).toBeNull();
  });

  it('самый длинный путь', () => {
    const s = game();
    s.owner[route('Москва', 'Казань', 'purple')] = 0;
    s.owner[route('Казань', 'Свердловск', 'blue')] = 0;
    s.owner[route('Москва', 'Ленинград', 'blue')] = 0;
    expect(longestPath(s, 0)).toBe(7);
  });

  it('последний круг: у кого ≤ 2 вагончиков — каждый ходит ещё раз', () => {
    const s = game(3);
    s.wagons[0] = 4;
    s.hand[0] = hand({ red: 2 });
    const rng = new SeededRng(3);
    let t = apply(s, 0, { type: 'claim', route: route('Москва', 'Ленинград', 'gray'), color: 0, locos: 0 }, rng)!.state;
    expect(t.finalLeft).toBe(3);
    for (const p of [1, 2, 0]) {
      expect(t.turn).toBe(p);
      t = apply(t, p, { type: 'draw', slot: -1 }, rng)!.state;
      if (t.phase === 'second') t = apply(t, p, { type: 'draw', slot: -1 }, rng)!.state;
    }
    expect(t.phase).toBe('over');
    expect(t.result!.rows.length).toBe(3);
  });

  it('боты всех уровней доигрывают партию', () => {
    for (const level of [0, 1, 2]) {
      const rng = new SeededRng(100 + level);
      let s = newState(3, cfgFrom({}), rng);
      let steps = 0;
      while (s.phase !== 'over' && steps < 3000) {
        const p = toAct(s)[0];
        const a = choose(view(s, [p]), p, level, rng)!;
        const r = apply(s, p, a, rng);
        expect(r, `уровень ${level}, ход ${steps}: ${JSON.stringify(a)} в фазе ${s.phase}`).not.toBeNull();
        s = r!.state;
        steps++;
      }
      expect(s.phase).toBe('over');
    }
  });
});
